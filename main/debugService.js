'use strict';
/**
 * Debug Service — DAP/CDP debugging for Node.js and Python
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * DebugSession  — single debug session (Node via CDP, Python via DAP)
 * DebugService  — manages multiple concurrent sessions
 */

const { spawn }      = require('child_process');
const net             = require('net');
const path            = require('path');
const EventEmitter    = require('events');

/* ══════════════════════════════════════════════════════════════════
   DebugSession
   ══════════════════════════════════════════════════════════════════ */

class DebugSession extends EventEmitter {
  constructor(id, config) {
    super();
    this.id              = id;
    this.config          = config;
    this.process         = null;
    this.socket          = null;
    this.ws              = null;
    this.seq             = 1;
    this.pendingRequests = new Map();
    this.breakpoints     = new Map();
    this.threads         = [];
    this.stackFrames     = [];
    this.variables       = new Map();
    this.state           = 'inactive';
    this._buffer         = '';
    this._contentLength  = -1;
  }

  /* ── start ────────────────────────────────────────────────────── */

  async start() {
    const { type, program, cwd, args, env, port } = this.config;
    switch (type) {
      case 'node': case 'node-terminal': return this._startNode(program, cwd, args, env);
      case 'python':                     return this._startPython(program, cwd, args, env);
      case 'attach':                     return this._attachCDP(port || 9229);
      default: throw new Error(`Unsupported debug type: ${type}`);
    }
  }

  /* ── Node.js (CDP) ────────────────────────────────────────────── */

  _startNode(program, cwd, args = [], env = {}) {
    this.process = spawn('node', ['--inspect-brk=0', ...(args || []), program], {
      cwd: cwd || path.dirname(program),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.state = 'running';

    return new Promise((resolve, reject) => {
      let output = '';
      this.process.stderr.on('data', d => {
        output += d.toString();
        const m = output.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) this._connectCDP(+m[1]).then(resolve).catch(reject);
      });
      this.process.stdout.on('data', d => this.emit('output', { category: 'stdout', output: d.toString() }));
      this.process.on('exit', code => { this.state = 'stopped'; this.emit('terminated', { exitCode: code }); });
      this.process.on('error', reject);
      setTimeout(() => reject(new Error('Debug session start timeout')), 10000);
    });
  }

  async _connectCDP(port) {
    const http = require('http');
    const wsUrl = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json`, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)[0]?.webSocketDebuggerUrl); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    if (!wsUrl) throw new Error('No WebSocket URL found');

    const WebSocket = require('ws');
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.state = 'running';
      this.emit('initialized');
      this._cdpSend('Debugger.enable');
      this._cdpSend('Runtime.enable');
      this._cdpSend('Runtime.runIfWaitingForDebugger');
    });
    this.ws.on('message', d => { try { this._handleCDP(JSON.parse(d.toString())); } catch {} });
    this.ws.on('close', () => { this.state = 'stopped'; this.emit('terminated', { exitCode: 0 }); });
    this.ws.on('error', e => this.emit('output', { category: 'stderr', output: `Debug connection error: ${e.message}\n` }));
  }

  async _attachCDP(port) { return this._connectCDP(port); }

  _cdpSend(method, params = {}) {
    if (!this.ws) return Promise.reject(new Error('No WebSocket'));
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pendingRequests.delete(id)) reject(new Error(`CDP ${method} timeout`)); }, 5000);
    });
  }

  _handleCDP(msg) {
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      return msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
    switch (msg.method) {
      case 'Debugger.paused':  this.state = 'paused'; this._onPaused(msg.params); break;
      case 'Debugger.resumed': this.state = 'running'; this.emit('continued', { threadId: 1 }); break;
      case 'Runtime.consoleAPICalled':
        if (msg.params?.args) {
          this.emit('output', { category: 'console', output: msg.params.args.map(a => a.value || a.description || '').join(' ') + '\n' });
        }
        break;
      case 'Runtime.exceptionThrown':
        if (msg.params?.exceptionDetails) {
          const d = msg.params.exceptionDetails;
          this.emit('output', { category: 'stderr', output: `Exception: ${d.text}\n${d.exception?.description || ''}\n` });
        }
        break;
    }
  }

  _onPaused(params) {
    this.stackFrames = (params.callFrames || []).map((f, i) => ({
      id: i, name: f.functionName || '(anonymous)',
      source: { path: f.url?.replace('file://', ''), name: path.basename(f.url || '') },
      line: (f.location?.lineNumber || 0) + 1, column: (f.location?.columnNumber || 0) + 1,
      scopeChain: f.scopeChain, callFrameId: f.callFrameId,
    }));
    this.emit('stopped', { reason: params.reason === 'breakpoint' ? 'breakpoint' : params.reason === 'exception' ? 'exception' : 'step', threadId: 1, allThreadsStopped: true });
  }

  /* ── Python (DAP) ─────────────────────────────────────────────── */

  _startPython(program, cwd, args = [], env = {}) {
    this.process = spawn('python', ['-m', 'debugpy', '--listen', '0', '--wait-for-client', program, ...(args || [])], {
      cwd: cwd || path.dirname(program),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.state = 'running';

    return new Promise((resolve, reject) => {
      let output = '';
      const check = txt => {
        output += txt;
        const m = (txt + output).match(/listening on .*?:(\d+)/i);
        if (m) setTimeout(() => this._connectDAP(+m[1]).then(resolve).catch(reject), 500);
      };
      this.process.stderr.on('data', d => { const t = d.toString(); this.emit('output', { category: 'stderr', output: t }); check(t); });
      this.process.stdout.on('data', d => { const t = d.toString(); this.emit('output', { category: 'stdout', output: t }); check(t); });
      this.process.on('exit', code => { this.state = 'stopped'; this.emit('terminated', { exitCode: code }); });
      this.process.on('error', reject);
      setTimeout(() => reject(new Error('Python debug start timeout')), 15000);
    });
  }

  _connectDAP(port) {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
        this.state = 'running';
        this._dapSend('initialize', {
          clientID: 'guIDE', clientName: 'guIDE', adapterID: 'python',
          pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
          supportsVariableType: true, supportsVariablePaging: true,
        }).then(() => { this.emit('initialized'); resolve(); }).catch(reject);
      });
      this.socket.on('data', d => this._handleDAPData(d.toString()));
      this.socket.on('error', reject);
      this.socket.on('close', () => { this.state = 'stopped'; this.emit('terminated', { exitCode: 0 }); });
    });
  }

  _dapSend(command, args = {}) {
    const seq = this.seq++;
    const body = JSON.stringify({ seq, type: 'request', command, arguments: args });
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(seq, { resolve, reject });
      if (this.socket) this.socket.write(header + body);
      setTimeout(() => { if (this.pendingRequests.delete(seq)) reject(new Error(`DAP ${command} timeout`)); }, 10000);
    });
  }

  _handleDAPData(data) {
    this._buffer += data;
    while (true) {
      if (this._contentLength === -1) {
        const i = this._buffer.indexOf('\r\n\r\n');
        if (i === -1) break;
        const m = this._buffer.substring(0, i).match(/Content-Length:\s*(\d+)/i);
        if (!m) { this._buffer = this._buffer.substring(i + 4); continue; }
        this._contentLength = +m[1];
        this._buffer = this._buffer.substring(i + 4);
      }
      if (this._buffer.length < this._contentLength) break;
      const body = this._buffer.substring(0, this._contentLength);
      this._buffer = this._buffer.substring(this._contentLength);
      this._contentLength = -1;
      try { this._handleDAPMsg(JSON.parse(body)); } catch {}
    }
  }

  _handleDAPMsg(msg) {
    if (msg.type === 'response' && this.pendingRequests.has(msg.request_seq)) {
      const { resolve, reject } = this.pendingRequests.get(msg.request_seq);
      this.pendingRequests.delete(msg.request_seq);
      return msg.success ? resolve(msg.body || {}) : reject(new Error(msg.message || 'DAP failed'));
    }
    if (msg.type === 'event') {
      switch (msg.event) {
        case 'stopped':    this.state = 'paused';  this.emit('stopped', msg.body); break;
        case 'continued':  this.state = 'running'; this.emit('continued', msg.body); break;
        case 'terminated': this.state = 'stopped'; this.emit('terminated', msg.body || {}); break;
        case 'output':     this.emit('output', msg.body); break;
        case 'thread':     this.emit('thread', msg.body); break;
        case 'breakpoint': this.emit('breakpointChanged', msg.body); break;
      }
    }
  }

  /* ── Public debug API ─────────────────────────────────────────── */

  async setBreakpoints(filePath, breakpoints) {
    this.breakpoints.set(filePath, breakpoints);
    if (this.ws) {
      const url = `file://${filePath.replace(/\\/g, '/')}`;
      for (const bp of breakpoints) {
        try {
          const r = await this._cdpSend('Debugger.setBreakpointByUrl', { lineNumber: bp.line - 1, url });
          bp.id = r?.breakpointId; bp.verified = true;
        } catch { bp.verified = false; }
      }
    } else if (this.socket) {
      try {
        const r = await this._dapSend('setBreakpoints', {
          source: { path: filePath },
          breakpoints: breakpoints.map(bp => ({ line: bp.line })),
        });
        (r?.breakpoints || []).forEach((rb, i) => { if (breakpoints[i]) { breakpoints[i].id = rb.id; breakpoints[i].verified = rb.verified; } });
      } catch {}
    }
    return breakpoints;
  }

  async continue_() {
    if (this.ws) await this._cdpSend('Debugger.resume');
    else if (this.socket) await this._dapSend('continue', { threadId: 1 });
    this.state = 'running';
  }

  async stepOver() {
    if (this.ws) await this._cdpSend('Debugger.stepOver');
    else if (this.socket) await this._dapSend('next', { threadId: 1 });
  }

  async stepInto() {
    if (this.ws) await this._cdpSend('Debugger.stepInto');
    else if (this.socket) await this._dapSend('stepIn', { threadId: 1 });
  }

  async stepOut() {
    if (this.ws) await this._cdpSend('Debugger.stepOut');
    else if (this.socket) await this._dapSend('stepOut', { threadId: 1 });
  }

  async pause() {
    if (this.ws) await this._cdpSend('Debugger.pause');
    else if (this.socket) await this._dapSend('pause', { threadId: 1 });
  }

  async getStackTrace() {
    if (this.ws) return this.stackFrames;
    if (this.socket) {
      try {
        const r = await this._dapSend('stackTrace', { threadId: 1 });
        this.stackFrames = (r?.stackFrames || []).map(f => ({
          id: f.id, name: f.name,
          source: f.source ? { path: f.source.path, name: f.source.name } : undefined,
          line: f.line, column: f.column,
        }));
        return this.stackFrames;
      } catch { return []; }
    }
    return [];
  }

  async getScopes(frameId) {
    if (this.ws) {
      const frame = this.stackFrames.find(f => f.id === frameId);
      if (!frame?.scopeChain) return [];
      return frame.scopeChain.map((s, i) => ({
        name: s.type === 'local' ? 'Local' : s.type === 'closure' ? 'Closure' : s.type === 'global' ? 'Global' : s.type,
        variablesReference: s.object?.objectId || `scope-${frameId}-${i}`,
        expensive: s.type === 'global',
      }));
    }
    if (this.socket) {
      try { return (await this._dapSend('scopes', { frameId }))?.scopes || []; } catch { return []; }
    }
    return [];
  }

  async getVariables(ref) {
    if (this.ws && typeof ref === 'string') {
      try {
        const r = await this._cdpSend('Runtime.getProperties', { objectId: ref, ownProperties: true });
        return (r?.result || []).filter(p => !p.isAccessor).map(p => ({
          name: p.name, value: p.value?.description || p.value?.value?.toString() || 'undefined',
          type: p.value?.type || 'unknown', variablesReference: p.value?.objectId || 0,
        })).slice(0, 100);
      } catch { return []; }
    }
    if (this.socket) {
      try {
        const r = await this._dapSend('variables', { variablesReference: ref });
        return (r?.variables || []).map(v => ({ name: v.name, value: v.value, type: v.type || '', variablesReference: v.variablesReference || 0 }));
      } catch { return []; }
    }
    return [];
  }

  async evaluate(expression, frameId) {
    if (this.ws) {
      const frame = this.stackFrames.find(f => f.id === frameId);
      try {
        const r = frame?.callFrameId
          ? await this._cdpSend('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression })
          : await this._cdpSend('Runtime.evaluate', { expression });
        return { result: r?.result?.description || r?.result?.value?.toString() || 'undefined' };
      } catch (e) { return { result: `Error: ${e.message}` }; }
    }
    if (this.socket) {
      try {
        const r = await this._dapSend('evaluate', { expression, frameId, context: 'watch' });
        return { result: r?.result || 'undefined' };
      } catch (e) { return { result: `Error: ${e.message}` }; }
    }
    return { result: 'No active debug session' };
  }

  async stop() {
    try {
      if (this.ws) this.ws.close();
      if (this.socket) { await this._dapSend('disconnect', { terminateDebuggee: true }).catch(() => {}); this.socket.destroy(); }
      if (this.process) { this.process.kill('SIGTERM'); setTimeout(() => { try { this.process?.kill('SIGKILL'); } catch {} }, 3000); }
    } catch {}
    this.state = 'stopped';
    this.emit('terminated', { exitCode: 0 });
  }
}

/* ══════════════════════════════════════════════════════════════════
   DebugService — multi-session manager
   ══════════════════════════════════════════════════════════════════ */

class DebugService {
  constructor() {
    this.sessions      = new Map();
    this.nextId        = 1;
    this.eventCallback = null;
  }

  setEventCallback(cb) { this.eventCallback = cb; }

  _emit(event, data) { if (this.eventCallback) this.eventCallback({ event, ...data }); }

  async startSession(config) {
    const id = this.nextId++;
    const s  = new DebugSession(id, config);
    s.on('stopped',     d => this._emit('stopped',     { sessionId: id, ...d }));
    s.on('continued',   d => this._emit('continued',   { sessionId: id, ...d }));
    s.on('terminated',  d => { this._emit('terminated', { sessionId: id, ...d }); this.sessions.delete(id); });
    s.on('output',      d => this._emit('output',      { sessionId: id, ...d }));
    s.on('initialized', () => this._emit('initialized', { sessionId: id }));
    this.sessions.set(id, s);
    try { await s.start(); return { id, state: s.state }; }
    catch (e) { this.sessions.delete(id); throw e; }
  }

  _get(id) { const s = this.sessions.get(id); if (!s) throw new Error(`No session ${id}`); return s; }

  async stopSession(id)                        { await this._get(id).stop(); }
  async setBreakpoints(id, filePath, bps)      { return this._get(id).setBreakpoints(filePath, bps); }
  async continue_(id)                          { return this._get(id).continue_(); }
  async stepOver(id)                           { return this._get(id).stepOver(); }
  async stepInto(id)                           { return this._get(id).stepInto(); }
  async stepOut(id)                            { return this._get(id).stepOut(); }
  async pause(id)                              { return this._get(id).pause(); }
  async getStackTrace(id)                      { return this._get(id).getStackTrace(); }
  async getScopes(id, frameId)                 { return this._get(id).getScopes(frameId); }
  async getVariables(id, ref)                  { return this._get(id).getVariables(ref); }
  async evaluate(id, expression, frameId)      { return this._get(id).evaluate(expression, frameId); }

  getActiveSession() {
    let latest = null;
    for (const [id, s] of this.sessions) { if (s.state !== 'stopped') latest = { id, state: s.state }; }
    return latest;
  }

  getAllSessions() {
    return [...this.sessions.entries()].map(([id, s]) => ({ id, state: s.state, config: s.config }));
  }
}

module.exports = { DebugService };
