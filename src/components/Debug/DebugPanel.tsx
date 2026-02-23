import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipForward, ArrowDownRight, ArrowUpRight,
  Square, ChevronDown, ChevronRight, Bug, Trash2, Plus,
  Loader2, AlertTriangle, Terminal, Eye,
} from 'lucide-react';
import type {
  DebugConfig, DebugStackFrame, DebugScope, DebugVariable, DebugEvent, DebugBreakpoint,
} from '@/types/electron';

interface DebugPanelProps {
  rootPath: string;
  currentFile: string;
  onOpenFile?: (filePath: string, line?: number) => void;
  onClose: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  rootPath, currentFile, onOpenFile, onClose: _onClose,
}) => {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionState, setSessionState] = useState<'inactive' | 'running' | 'paused' | 'stopped'>('inactive');
  const [stackFrames, setStackFrames] = useState<DebugStackFrame[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<number>(0);
  const [scopes, setScopes] = useState<DebugScope[]>([]);
  const [variables, setVariables] = useState<Map<number | string, DebugVariable[]>>(new Map());
  const [expandedScopes, setExpandedScopes] = useState<Set<number | string>>(new Set());
  const [watchExpressions, setWatchExpressions] = useState<{ expr: string; value: string }[]>([]);
  const [newWatch, setNewWatch] = useState('');
  const [debugOutput, setDebugOutput] = useState<string[]>([]);
  const [debugType, setDebugType] = useState<'node' | 'python'>('node');
  const [debugProgram, setDebugProgram] = useState('');
  const [breakpoints, _setBreakpoints] = useState<Map<string, DebugBreakpoint[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-set debug program to current file
  useEffect(() => {
    if (currentFile && !debugProgram) {
      setDebugProgram(currentFile);
      // Auto-detect type from extension
      if (currentFile.endsWith('.py')) setDebugType('python');
      else setDebugType('node');
    }
  }, [currentFile]);

  // Listen for debug events
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onDebugEvent) return;

    const cleanupDebug = api.onDebugEvent((event: DebugEvent) => {
      switch (event.event) {
        case 'stopped':
          setSessionState('paused');
          // Fetch stack trace
          if (sessionId) fetchStackTrace(sessionId);
          break;
        case 'continued':
          setSessionState('running');
          setStackFrames([]);
          setScopes([]);
          setVariables(new Map());
          break;
        case 'terminated':
          setSessionState('stopped');
          setSessionId(null);
          addOutput(`\n--- Debug session ended (exit code: ${event.exitCode ?? 0}) ---\n`);
          break;
        case 'output':
          if (event.output) addOutput(event.output);
          break;
        case 'initialized':
          addOutput('--- Debug session initialized ---\n');
          break;
      }
    });

    return () => {
      cleanupDebug?.();
    };
  }, [sessionId]);

  const addOutput = useCallback((text: string) => {
    setDebugOutput(prev => {
      const next = [...prev, text];
      // Keep last 500 lines
      return next.length > 500 ? next.slice(-500) : next;
    });
    setTimeout(() => {
      outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
    }, 50);
  }, []);

  const fetchStackTrace = useCallback(async (sid: number) => {
    const api = window.electronAPI;
    if (!api?.debugStackTrace) return;
    const result = await api.debugStackTrace(sid);
    if (result?.success && result.stackFrames) {
      setStackFrames(result.stackFrames);
      setSelectedFrame(0);
      // Auto-fetch scopes for top frame
      if (result.stackFrames.length > 0) {
        fetchScopes(sid, result.stackFrames[0].id);
      }
      // Navigate to paused location
      const topFrame = result.stackFrames[0];
      if (topFrame?.source?.path) {
        onOpenFile?.(topFrame.source.path, topFrame.line);
      }
    }
  }, [onOpenFile]);

  const fetchScopes = useCallback(async (sid: number, frameId: number) => {
    const api = window.electronAPI;
    if (!api?.debugScopes) return;
    const result = await api.debugScopes(sid, frameId);
    if (result?.success && result.scopes) {
      setScopes(result.scopes);
      // Auto-expand local scope
      const localScope = result.scopes.find(s => s.name === 'Local');
      if (localScope) {
        setExpandedScopes(new Set([localScope.variablesReference]));
        fetchVariables(sid, localScope.variablesReference);
      }
    }
  }, []);

  const fetchVariables = useCallback(async (sid: number, ref: number | string) => {
    const api = window.electronAPI;
    if (!api?.debugVariables) return;
    const result = await api.debugVariables(sid, ref);
    if (result?.success && result.variables) {
      setVariables(prev => new Map(prev).set(ref, result.variables!));
    }
  }, []);

  const updateWatchExpressions = useCallback(async (sid: number, frameId?: number) => {
    const api = window.electronAPI;
    if (!api?.debugEvaluate) return;
    const updated = await Promise.all(
      watchExpressions.map(async (w) => {
        const result = await api.debugEvaluate(sid, w.expr, frameId);
        return { expr: w.expr, value: result?.result || 'Error' };
      })
    );
    setWatchExpressions(updated);
  }, [watchExpressions]);

  // Re-evaluate watches when frame changes
  useEffect(() => {
    if (sessionId && sessionState === 'paused' && stackFrames.length > 0) {
      updateWatchExpressions(sessionId, stackFrames[selectedFrame]?.id);
    }
  }, [selectedFrame, sessionState]);

  const startDebug = async () => {
    const api = window.electronAPI;
    if (!api?.debugStart) return;

    setError(null);
    setDebugOutput([]);
    setStackFrames([]);
    setScopes([]);
    setVariables(new Map());

    const config: DebugConfig = {
      type: debugType,
      program: debugProgram,
      cwd: rootPath,
    };

    addOutput(`Starting ${debugType} debug session for ${debugProgram}...\n`);
    const result = await api.debugStart(config);

    if (result?.success && result.id) {
      setSessionId(result.id);
      setSessionState(result.state as any || 'running');

      // Set stored breakpoints
      for (const [filePath, bps] of breakpoints) {
        await api.debugSetBreakpoints(result.id, filePath, bps);
      }
    } else {
      setError(result?.error || 'Failed to start debug session');
      addOutput(`Error: ${result?.error || 'Unknown error'}\n`);
    }
  };

  const stopDebug = async () => {
    if (!sessionId) return;
    await window.electronAPI?.debugStop(sessionId);
    setSessionState('stopped');
    setSessionId(null);
  };

  const debugAction = async (action: 'continue' | 'stepOver' | 'stepInto' | 'stepOut' | 'pause') => {
    if (!sessionId) return;
    const api = window.electronAPI;
    if (!api) return;
    switch (action) {
      case 'continue': await api.debugContinue(sessionId); break;
      case 'stepOver': await api.debugStepOver(sessionId); break;
      case 'stepInto': await api.debugStepInto(sessionId); break;
      case 'stepOut': await api.debugStepOut(sessionId); break;
      case 'pause': await api.debugPause(sessionId); break;
    }
  };

  const toggleScope = (ref: number | string) => {
    setExpandedScopes(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else {
        next.add(ref);
        if (sessionId && !variables.has(ref)) fetchVariables(sessionId, ref);
      }
      return next;
    });
  };

  const addWatch = () => {
    if (!newWatch.trim()) return;
    setWatchExpressions(prev => [...prev, { expr: newWatch.trim(), value: '(not evaluated)' }]);
    setNewWatch('');
  };

  const removeWatch = (index: number) => {
    setWatchExpressions(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] text-[#cccccc]">
      {/* Debug toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#252526] border-b border-[#1e1e1e] flex-shrink-0">
        <Bug size={14} className="text-[#f44747] mr-1" />
        <span className="text-[11px] font-medium text-[#d4d4d4] mr-2">Debug</span>

        {sessionState === 'inactive' || sessionState === 'stopped' ? (
          <>
            <select
              className="bg-[#3c3c3c] text-[11px] text-[#cccccc] px-1 py-0.5 rounded border border-[#555] outline-none"
              value={debugType}
              onChange={e => setDebugType(e.target.value as 'node' | 'python')}
            >
              <option value="node">Node.js</option>
              <option value="python">Python</option>
            </select>
            <input
              className="flex-1 bg-[#3c3c3c] text-[11px] text-[#cccccc] px-2 py-0.5 rounded border border-[#555] outline-none mx-1 min-w-0"
              value={debugProgram}
              onChange={e => setDebugProgram(e.target.value)}
              placeholder="File to debug..."
            />
            <button
              className="p-1 bg-[#89d185] text-[#1e1e1e] rounded hover:bg-[#6fbf6f] transition-colors"
              onClick={startDebug}
              title="Start Debugging (F5)"
            >
              <Play size={12} fill="currentColor" />
            </button>
          </>
        ) : (
          <>
            <button
              className={`p-1 rounded transition-colors ${sessionState === 'paused' ? 'text-[#89d185] hover:bg-[#3c3c3c]' : 'text-[#555]'}`}
              onClick={() => debugAction('continue')}
              disabled={sessionState !== 'paused'}
              title="Continue (F5)"
            >
              <Play size={14} />
            </button>
            <button
              className={`p-1 rounded transition-colors ${sessionState === 'paused' ? 'text-[#569cd6] hover:bg-[#3c3c3c]' : 'text-[#555]'}`}
              onClick={() => debugAction('stepOver')}
              disabled={sessionState !== 'paused'}
              title="Step Over (F10)"
            >
              <SkipForward size={14} />
            </button>
            <button
              className={`p-1 rounded transition-colors ${sessionState === 'paused' ? 'text-[#569cd6] hover:bg-[#3c3c3c]' : 'text-[#555]'}`}
              onClick={() => debugAction('stepInto')}
              disabled={sessionState !== 'paused'}
              title="Step Into (F11)"
            >
              <ArrowDownRight size={14} />
            </button>
            <button
              className={`p-1 rounded transition-colors ${sessionState === 'paused' ? 'text-[#569cd6] hover:bg-[#3c3c3c]' : 'text-[#555]'}`}
              onClick={() => debugAction('stepOut')}
              disabled={sessionState !== 'paused'}
              title="Step Out (Shift+F11)"
            >
              <ArrowUpRight size={14} />
            </button>
            <button
              className={`p-1 rounded transition-colors ${sessionState === 'running' ? 'text-[#dcdcaa] hover:bg-[#3c3c3c]' : 'text-[#555]'}`}
              onClick={() => debugAction('pause')}
              disabled={sessionState !== 'running'}
              title="Pause (F6)"
            >
              <Pause size={14} />
            </button>
            <div className="flex-1" />
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              sessionState === 'running' ? 'text-[#89d185] bg-[#89d18520]' : 'text-[#dcdcaa] bg-[#dcdcaa20]'
            }`}>
              {sessionState === 'running' ? '● Running' : '⏸ Paused'}
            </span>
            <button
              className="p-1 text-[#f44747] hover:bg-[#3c3c3c] rounded transition-colors ml-1"
              onClick={stopDebug}
              title="Stop (Shift+F5)"
            >
              <Square size={14} fill="currentColor" />
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="px-3 py-1.5 text-[11px] bg-[#5a1d1d] text-[#f44747] flex items-center gap-1">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {/* Main content: panels */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Call Stack */}
        {stackFrames.length > 0 && (
          <div className="border-b border-[#3c3c3c]">
            <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider font-medium bg-[#252526]">
              Call Stack
            </div>
            <div className="max-h-[120px] overflow-y-auto">
              {stackFrames.map((frame, i) => (
                <div
                  key={frame.id}
                  className={`px-3 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${
                    i === selectedFrame ? 'bg-[#04395e] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                  }`}
                  onClick={() => {
                    setSelectedFrame(i);
                    if (sessionId) fetchScopes(sessionId, frame.id);
                    if (frame.source?.path) onOpenFile?.(frame.source.path, frame.line);
                  }}
                >
                  <span className="text-[#dcdcaa] font-mono truncate">{frame.name}</span>
                  {frame.source?.name && (
                    <span className="text-[#858585] text-[10px] ml-auto flex-shrink-0">
                      {frame.source.name}:{frame.line}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Variables */}
        <div className="border-b border-[#3c3c3c] flex-1 overflow-y-auto min-h-0">
          <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider font-medium bg-[#252526] sticky top-0">
            Variables
          </div>
          {scopes.length === 0 && sessionState === 'paused' && (
            <div className="px-3 py-2 text-[11px] text-[#858585]">Loading variables...</div>
          )}
          {scopes.map(scope => (
            <div key={String(scope.variablesReference)}>
              <button
                className="w-full flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#d4d4d4] hover:bg-[#2a2d2e]"
                onClick={() => toggleScope(scope.variablesReference)}
              >
                {expandedScopes.has(scope.variablesReference) ? (
                  <ChevronDown size={10} />
                ) : (
                  <ChevronRight size={10} />
                )}
                <span className="font-medium">{scope.name}</span>
                {scope.expensive && <span className="text-[9px] text-[#858585]">(expensive)</span>}
              </button>
              {expandedScopes.has(scope.variablesReference) && (
                <div className="pl-4">
                  {(variables.get(scope.variablesReference) || []).map((v, i) => (
                    <div key={i} className="flex items-center gap-1 px-2 py-[1px] text-[11px] hover:bg-[#2a2d2e]">
                      <span className="text-[#9cdcfe]">{v.name}</span>
                      <span className="text-[#666]">=</span>
                      <span className={`truncate ${
                        v.type === 'string' ? 'text-[#ce9178]' :
                        v.type === 'number' ? 'text-[#b5cea8]' :
                        v.type === 'boolean' ? 'text-[#569cd6]' :
                        'text-[#cccccc]'
                      }`}>{v.value}</span>
                    </div>
                  ))}
                  {!variables.has(scope.variablesReference) && (
                    <div className="px-2 py-0.5 text-[10px] text-[#858585]">
                      <Loader2 size={10} className="animate-spin inline mr-1" />
                      Loading...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Watch Expressions */}
        <div className="border-b border-[#3c3c3c]">
          <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider font-medium bg-[#252526] flex items-center">
            Watch
            <button
              className="ml-auto p-0.5 text-[#858585] hover:text-white rounded"
              onClick={() => document.getElementById('watch-input')?.focus()}
              title="Add Watch Expression"
            >
              <Plus size={10} />
            </button>
          </div>
          <div className="max-h-[80px] overflow-y-auto">
            {watchExpressions.map((w, i) => (
              <div key={i} className="flex items-center gap-1 px-3 py-[1px] text-[11px] hover:bg-[#2a2d2e] group">
                <Eye size={9} className="text-[#858585] flex-shrink-0" />
                <span className="text-[#9cdcfe]">{w.expr}</span>
                <span className="text-[#666]">:</span>
                <span className="text-[#cccccc] truncate">{w.value}</span>
                <button
                  className="ml-auto text-[#858585] hover:text-[#f44747] opacity-0 group-hover:opacity-100"
                  onClick={() => removeWatch(i)}
                >
                  <Trash2 size={9} />
                </button>
              </div>
            ))}
            <div className="flex items-center px-3 py-0.5">
              <input
                id="watch-input"
                className="flex-1 bg-transparent text-[11px] text-[#cccccc] outline-none placeholder-[#555]"
                placeholder="Add expression..."
                value={newWatch}
                onChange={e => setNewWatch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addWatch(); }}
              />
            </div>
          </div>
        </div>

        {/* Debug Console Output */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider font-medium bg-[#252526] flex items-center flex-shrink-0">
            <Terminal size={10} className="mr-1" />
            Debug Console
          </div>
          <div
            ref={outputRef}
            className="flex-1 overflow-y-auto px-3 py-1 text-[11px] font-mono whitespace-pre-wrap text-[#cccccc] bg-[#1e1e1e]"
          >
            {debugOutput.length === 0 ? (
              <span className="text-[#858585]">Debug output will appear here...</span>
            ) : (
              debugOutput.map((line, i) => <span key={i}>{line}</span>)
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
