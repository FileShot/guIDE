/**
 * debugService.js — Debug Adapter Protocol (DAP) Service for guIDE
 * 
 * Provides integrated debugging for Node.js, Python, and generic DAP adapters.
 * Manages debug sessions, breakpoints, call stack, variables, and stepping.
 */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const EventEmitter = require('events');

class DebugSession extends EventEmitter {
  constructor(id, config) {
    super();
    this.id = id;
    this.config = config;
    this.process = null;
    this.socket = null;
    this.seq = 1;
    this.pendingRequests = new Map();
    this.breakpoints = new Map(); // filePath -> [{line, id, verified}]
    this.threads = [];
    this.stackFrames = [];
    this.variables = new Map(); // variablesReference -> variables[]
    this.state = 'inactive'; // inactive, running, paused, stopped
    this._buffer = '';
    this._contentLength = -1;
  }

  /**
   * Start a debug session based on the config type
   */
  async start() {
    const { type, program, cwd, args, env, port } = this.config;

    switch (type) {
      case 'node':
      case 'node-terminal':
        return this._startNodeDebug(program, cwd, args, env);
      case 'python':
        return this._startPythonDebug(program, cwd, args, env);
      case 'attach':
        return this._attachToPort(port || 9229);
      default:
        throw new Error(`Unsupported debug type: ${type}`);
    }
  }

  async _startNodeDebug(program, cwd, args = [], env = {}) {
    const nodeArgs = ['--inspect-brk=0', ...(args || [])];
    
    this.process = spawn('node', [...nodeArgs, program], {
      cwd: cwd || path.dirname(program),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.state = 'running';

    return new Promise((resolve, reject) => {
      let output = '';
      
      this.process.stderr.on('data', (data) => {
        output += data.toString();
        // Node.js inspector outputs the debug URL to stderr
        const match = output.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) {
          const port = parseInt(match[1]);
          this._connectCDP(port).then(resolve).catch(reject);
        }
      });

      this.process.stdout.on('data', (data) => {
        this.emit('output', { category: 'stdout', output: data.toString() });
      });

      this.process.on('exit', (code) => {
        this.state = 'stopped';
        this.emit('terminated', { exitCode: code });
      });

      this.process.on('error', (err) => {
        reject(err);
      });

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Debug session start timeout')), 10000);
    });
  }

  async _startPythonDebug(program, cwd, args = [], env = {}) {
    // Use debugpy for Python debugging
    const pythonArgs = ['-m', 'debugpy', '--listen', '0', '--wait-for-client', program, ...(args || [])];

    this.process = spawn('python', pythonArgs, {
      cwd: cwd || path.dirname(program),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.state = 'running';

    return new Promise((resolve, reject) => {
      let output = '';

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        this.emit('output', { category: 'stderr', output: text });
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        this.emit('output', { category: 'stdout', output: text });
        
        // debugpy outputs the port it's listening on
        const match = text.match(/listening on .*?:(\d+)/i) || output.match(/listening on .*?:(\d+)/i);
        if (match) {
          const port = parseInt(match[1]);
          setTimeout(() => {
            this._connectDAP(port).then(resolve).catch(reject);
          }, 500);
        }
      });

      this.process.on('exit', (code) => {
        this.state = 'stopped';
        this.emit('terminated', { exitCode: code });
      });

      this.process.on('error', reject);
      setTimeout(() => reject(new Error('Python debug session start timeout')), 15000);
    });
  }

  async _connectCDP(port) {
    // For Node.js, we use Chrome DevTools Protocol via WebSocket
    // Simplified: connect to the inspector and translate to DAP-like events
    try {
      const http = require('http');
      
      // Get the WebSocket URL
      const jsonUrl = `http://127.0.0.1:${port}/json`;
      const wsUrl = await new Promise((resolve, reject) => {
        http.get(jsonUrl, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              const targets = JSON.parse(data);
              resolve(targets[0]?.webSocketDebuggerUrl);
            } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });

      if (!wsUrl) throw new Error('No WebSocket URL found');

      // Use ws or built-in WebSocket
      const WebSocket = require('ws');
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        this.state = 'running';
        this.emit('initialized');
        
        // Enable debugger
        this._cdpSend('Debugger.enable');
        this._cdpSend('Runtime.enable');
        this._cdpSend('Runtime.runIfWaitingForDebugger');
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleCDPMessage(msg);
        } catch (e) { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        this.state = 'stopped';
        this.emit('terminated', { exitCode: 0 });
      });

      this.ws.on('error', (err) => {
        this.emit('output', { category: 'stderr', output: `Debug connection error: ${err.message}\n` });
      });

    } catch (e) {
      throw new Error(`Failed to connect to Node.js inspector: ${e.message}`);
    }
  }

  _cdpSend(method, params = {}) {
    if (!this.ws) return Promise.reject(new Error('No WebSocket connection'));
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`CDP request ${method} timed out`));
        }
      }, 5000);
    });
  }

  _handleCDPMessage(msg) {
    // Handle responses
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }

    // Handle events
    switch (msg.method) {
      case 'Debugger.paused':
        this.state = 'paused';
        this._processPausedEvent(msg.params);
        break;
      case 'Debugger.resumed':
        this.state = 'running';
        this.emit('continued', { threadId: 1 });
        break;
      case 'Runtime.consoleAPICalled':
        if (msg.params?.args) {
          const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
          this.emit('output', { category: 'console', output: text + '\n' });
        }
        break;
      case 'Runtime.exceptionThrown':
        if (msg.params?.exceptionDetails) {
          const detail = msg.params.exceptionDetails;
          this.emit('output', {
            category: 'stderr',
            output: `Exception: ${detail.text}\n${detail.exception?.description || ''}\n`,
          });
        }
        break;
    }
  }

  async _processPausedEvent(params) {
    const callFrames = params.callFrames || [];
    this.stackFrames = callFrames.map((frame, i) => ({
      id: i,
      name: frame.functionName || '(anonymous)',
      source: {
        path: frame.url?.replace('file://', ''),
        name: path.basename(frame.url || ''),
      },
      line: (frame.location?.lineNumber || 0) + 1, // CDP is 0-based
      column: (frame.location?.columnNumber || 0) + 1,
      scopeChain: frame.scopeChain,
      callFrameId: frame.callFrameId,
    }));

    const reason = params.reason || 'pause';
    this.emit('stopped', {
      reason: reason === 'breakpoint' ? 'breakpoint' : reason === 'exception' ? 'exception' : 'step',
      threadId: 1,
      allThreadsStopped: true,
    });
  }

  async _connectDAP(port) {
    // For Python debugpy, connect via DAP socket
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
        this.state = 'running';
        this._dapSend('initialize', {
          clientID: 'guIDE',
          clientName: 'guIDE',
          adapterID: 'python',
          pathFormat: 'path',
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsVariableType: true,
          supportsVariablePaging: true,
        }).then(() => {
          this.emit('initialized');
          resolve();
        }).catch(reject);
      });

      this.socket.on('data', (data) => {
        this._handleDAPData(data.toString());
      });

      this.socket.on('error', reject);
      this.socket.on('close', () => {
        this.state = 'stopped';
        this.emit('terminated', { exitCode: 0 });
      });
    });
  }

  _dapSend(command, args = {}) {
    const seq = this.seq++;
    const body = JSON.stringify({
      seq,
      type: 'request',
      command,
      arguments: args,
    });
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(seq, { resolve, reject });
      if (this.socket) {
        this.socket.write(header + body);
      }
      setTimeout(() => {
        if (this.pendingRequests.has(seq)) {
          this.pendingRequests.delete(seq);
          reject(new Error(`DAP request ${command} timed out`));
        }
      }, 10000);
    });
  }

  _handleDAPData(data) {
    this._buffer += data;
    
    while (true) {
      if (this._contentLength === -1) {
        const headerEnd = this._buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = this._buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) { this._buffer = this._buffer.substring(headerEnd + 4); continue; }
        this._contentLength = parseInt(match[1]);
        this._buffer = this._buffer.substring(headerEnd + 4);
      }

      if (this._buffer.length < this._contentLength) break;

      const body = this._buffer.substring(0, this._contentLength);
      this._buffer = this._buffer.substring(this._contentLength);
      this._contentLength = -1;

      try {
        const msg = JSON.parse(body);
        this._handleDAPMessage(msg);
      } catch (e) { /* ignore */ }
    }
  }

  _handleDAPMessage(msg) {
    if (msg.type === 'response' && this.pendingRequests.has(msg.request_seq)) {
      const { resolve, reject } = this.pendingRequests.get(msg.request_seq);
      this.pendingRequests.delete(msg.request_seq);
      if (msg.success) resolve(msg.body || {});
      else reject(new Error(msg.message || 'DAP request failed'));
      return;
    }

    if (msg.type === 'event') {
      switch (msg.event) {
        case 'stopped':
          this.state = 'paused';
          this.emit('stopped', msg.body);
          break;
        case 'continued':
          this.state = 'running';
          this.emit('continued', msg.body);
          break;
        case 'terminated':
          this.state = 'stopped';
          this.emit('terminated', msg.body || {});
          break;
        case 'output':
          this.emit('output', msg.body);
          break;
        case 'thread':
          this.emit('thread', msg.body);
          break;
        case 'breakpoint':
          this.emit('breakpointChanged', msg.body);
          break;
      }
    }
  }

  // ── Public API ──

  async setBreakpoints(filePath, breakpoints) {
    this.breakpoints.set(filePath, breakpoints);

    if (this.ws) {
      // CDP mode (Node.js)
      const scriptUrl = `file://${filePath.replace(/\\/g, '/')}`;
      for (const bp of breakpoints) {
        try {
          const result = await this._cdpSend('Debugger.setBreakpointByUrl', {
            lineNumber: bp.line - 1, // CDP is 0-based
            url: scriptUrl,
          });
          bp.id = result?.breakpointId;
          bp.verified = true;
        } catch {
          bp.verified = false;
        }
      }
    } else if (this.socket) {
      // DAP mode (Python)
      try {
        const result = await this._dapSend('setBreakpoints', {
          source: { path: filePath },
          breakpoints: breakpoints.map(bp => ({ line: bp.line })),
        });
        if (result?.breakpoints) {
          result.breakpoints.forEach((rbp, i) => {
            if (breakpoints[i]) {
              breakpoints[i].id = rbp.id;
              breakpoints[i].verified = rbp.verified;
            }
          });
        }
      } catch { /* ignore */ }
    }

    return breakpoints;
  }

  async continue_() {
    if (this.ws) {
      await this._cdpSend('Debugger.resume');
    } else if (this.socket) {
      await this._dapSend('continue', { threadId: 1 });
    }
    this.state = 'running';
  }

  async stepOver() {
    if (this.ws) {
      await this._cdpSend('Debugger.stepOver');
    } else if (this.socket) {
      await this._dapSend('next', { threadId: 1 });
    }
  }

  async stepInto() {
    if (this.ws) {
      await this._cdpSend('Debugger.stepInto');
    } else if (this.socket) {
      await this._dapSend('stepIn', { threadId: 1 });
    }
  }

  async stepOut() {
    if (this.ws) {
      await this._cdpSend('Debugger.stepOut');
    } else if (this.socket) {
      await this._dapSend('stepOut', { threadId: 1 });
    }
  }

  async pause() {
    if (this.ws) {
      await this._cdpSend('Debugger.pause');
    } else if (this.socket) {
      await this._dapSend('pause', { threadId: 1 });
    }
  }

  async getStackTrace() {
    if (this.ws) {
      return this.stackFrames;
    } else if (this.socket) {
      try {
        const result = await this._dapSend('stackTrace', { threadId: 1 });
        this.stackFrames = (result?.stackFrames || []).map(f => ({
          id: f.id,
          name: f.name,
          source: f.source ? { path: f.source.path, name: f.source.name } : undefined,
          line: f.line,
          column: f.column,
        }));
        return this.stackFrames;
      } catch { return []; }
    }
    return [];
  }

  async getScopes(frameId) {
    if (this.ws) {
      // CDP — use the scopeChain from the stored frame
      const frame = this.stackFrames.find(f => f.id === frameId);
      if (!frame?.scopeChain) return [];
      return frame.scopeChain.map((scope, i) => ({
        name: scope.type === 'local' ? 'Local' : scope.type === 'closure' ? 'Closure' : scope.type === 'global' ? 'Global' : scope.type,
        variablesReference: scope.object?.objectId || `scope-${frameId}-${i}`,
        expensive: scope.type === 'global',
      }));
    } else if (this.socket) {
      try {
        const result = await this._dapSend('scopes', { frameId });
        return result?.scopes || [];
      } catch { return []; }
    }
    return [];
  }

  async getVariables(variablesReference) {
    if (this.ws && typeof variablesReference === 'string') {
      // CDP — use Runtime.getProperties
      try {
        const result = await this._cdpSend('Runtime.getProperties', {
          objectId: variablesReference,
          ownProperties: true,
        });
        return (result?.result || []).filter(p => !p.isAccessor).map(p => ({
          name: p.name,
          value: p.value?.description || p.value?.value?.toString() || 'undefined',
          type: p.value?.type || 'unknown',
          variablesReference: p.value?.objectId || 0,
        })).slice(0, 100); // Limit to 100 variables
      } catch { return []; }
    } else if (this.socket) {
      try {
        const result = await this._dapSend('variables', { variablesReference });
        return (result?.variables || []).map(v => ({
          name: v.name,
          value: v.value,
          type: v.type || '',
          variablesReference: v.variablesReference || 0,
        }));
      } catch { return []; }
    }
    return [];
  }

  async evaluate(expression, frameId) {
    if (this.ws) {
      // CDP — use frame callFrameId if available
      const frame = this.stackFrames.find(f => f.id === frameId);
      try {
        if (frame?.callFrameId) {
          const result = await this._cdpSend('Debugger.evaluateOnCallFrame', {
            callFrameId: frame.callFrameId,
            expression,
          });
          return { result: result?.result?.description || result?.result?.value?.toString() || 'undefined' };
        }
        const result = await this._cdpSend('Runtime.evaluate', { expression });
        return { result: result?.result?.description || result?.result?.value?.toString() || 'undefined' };
      } catch (e) {
        return { result: `Error: ${e.message}` };
      }
    } else if (this.socket) {
      try {
        const result = await this._dapSend('evaluate', {
          expression,
          frameId,
          context: 'watch',
        });
        return { result: result?.result || 'undefined' };
      } catch (e) {
        return { result: `Error: ${e.message}` };
      }
    }
    return { result: 'No active debug session' };
  }

  async stop() {
    try {
      if (this.ws) {
        this.ws.close();
      }
      if (this.socket) {
        await this._dapSend('disconnect', { terminateDebuggee: true }).catch(() => {});
        this.socket.destroy();
      }
      if (this.process) {
        this.process.kill('SIGTERM');
        setTimeout(() => {
          try { this.process?.kill('SIGKILL'); } catch {}
        }, 3000);
      }
    } catch { /* ignore cleanup errors */ }
    this.state = 'stopped';
    this.emit('terminated', { exitCode: 0 });
  }
}

/**
 * DebugService — manages multiple debug sessions
 */
class DebugService {
  constructor() {
    this.sessions = new Map();
    this.nextId = 1;
    this.eventCallback = null;
  }

  setEventCallback(callback) {
    this.eventCallback = callback;
  }

  _emitEvent(event, data) {
    if (this.eventCallback) {
      this.eventCallback({ event, ...data });
    }
  }

  async startSession(config) {
    const id = this.nextId++;
    const session = new DebugSession(id, config);

    // Wire up events
    session.on('stopped', (data) => {
      this._emitEvent('stopped', { sessionId: id, ...data });
    });
    session.on('continued', (data) => {
      this._emitEvent('continued', { sessionId: id, ...data });
    });
    session.on('terminated', (data) => {
      this._emitEvent('terminated', { sessionId: id, ...data });
      this.sessions.delete(id);
    });
    session.on('output', (data) => {
      this._emitEvent('output', { sessionId: id, ...data });
    });
    session.on('initialized', () => {
      this._emitEvent('initialized', { sessionId: id });
    });

    this.sessions.set(id, session);

    try {
      await session.start();
      return { id, state: session.state };
    } catch (e) {
      this.sessions.delete(id);
      throw e;
    }
  }

  async stopSession(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`No debug session with id ${id}`);
    await session.stop();
  }

  async setBreakpoints(sessionId, filePath, breakpoints) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.setBreakpoints(filePath, breakpoints);
  }

  async continue_(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.continue_();
  }

  async stepOver(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.stepOver();
  }

  async stepInto(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.stepInto();
  }

  async stepOut(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.stepOut();
  }

  async pause(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.pause();
  }

  async getStackTrace(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.getStackTrace();
  }

  async getScopes(sessionId, frameId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.getScopes(frameId);
  }

  async getVariables(sessionId, variablesReference) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.getVariables(variablesReference);
  }

  async evaluate(sessionId, expression, frameId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No debug session with id ${sessionId}`);
    return session.evaluate(expression, frameId);
  }

  getActiveSession() {
    // Return the most recently created active session
    let latest = null;
    for (const [id, session] of this.sessions) {
      if (session.state !== 'stopped') latest = { id, state: session.state };
    }
    return latest;
  }

  getAllSessions() {
    const sessions = [];
    for (const [id, session] of this.sessions) {
      sessions.push({ id, state: session.state, config: session.config });
    }
    return sessions;
  }
}

module.exports = { DebugService };
