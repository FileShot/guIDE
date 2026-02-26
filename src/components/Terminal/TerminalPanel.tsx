import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, Terminal as TerminalIcon, Sparkles } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  cwd?: string;
  onClose: () => void;
}

interface TerminalTab {
  id: number;
  title: string;
  pid?: number;
}

interface TerminalSuggestion {
  command: string;
  description?: string;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ cwd, onClose }) => {
  const [terminals, setTerminals] = useState<TerminalTab[]>([]);
  const [activeTerminal, setActiveTerminal] = useState<number | null>(null);
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems' | 'output'>('terminal');
  const [suggestions, setSuggestions] = useState<TerminalSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [_currentInput, setCurrentInput] = useState('');
  const terminalRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const xtermInstances = useRef<Map<number, any>>(new Map());
  const inputBufferRef = useRef<string>('');
  const recentCommandsRef = useRef<string[]>([]);

  // Create initial terminal
  useEffect(() => {
    if (terminals.length === 0) {
      createTerminal();
    }
  }, []);

  // Re-fit terminal when active tab changes or panel becomes visible
  useEffect(() => {
    if (activeTerminal !== null && bottomTab === 'terminal') {
      const instance = xtermInstances.current.get(activeTerminal);
      if (instance?.fitAddon && instance?.term) {
        const doFit = () => {
          try { instance.fitAddon.fit(); } catch (e) { /* ignore */ }
        };
        requestAnimationFrame(doFit);
        setTimeout(doFit, 50);
      }
    }
  }, [activeTerminal, bottomTab]);

  // Switch to Problems tab when status bar is clicked
  useEffect(() => {
    const handler = () => setBottomTab('problems');
    window.addEventListener('guide-show-problems', handler);
    return () => window.removeEventListener('guide-show-problems', handler);
  }, []);

  // Listen for externally-created terminals (e.g. code runner)
  useEffect(() => {
    const handleExternalTerminal = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        const newTab: TerminalTab = {
          id: detail.id,
          title: detail.title || `Run`,
          pid: detail.pid,
        };
        setTerminals(prev => {
          // Avoid duplicates
          if (prev.some(t => t.id === detail.id)) return prev;
          return [...prev, newTab];
        });
        setActiveTerminal(detail.id);
        setBottomTab('terminal');
        // Init xterm for it
        setTimeout(() => initXterm(detail.id), 100);
      }
    };
    window.addEventListener('terminal-created', handleExternalTerminal);
    return () => window.removeEventListener('terminal-created', handleExternalTerminal);
  }, []);

  const createTerminal = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.terminalCreate) {
        // Fallback: create a dummy terminal
        const id = Date.now();
        setTerminals(prev => [...prev, { id, title: `Terminal ${prev.length + 1}` }]);
        setActiveTerminal(id);
        return;
      }

      const result = await api.terminalCreate({ cwd: cwd || undefined });
      const newTab: TerminalTab = {
        id: result.id,
        title: result.title || `Terminal ${terminals.length + 1}`,
        pid: result.pid,
      };
      setTerminals(prev => [...prev, newTab]);
      setActiveTerminal(result.id);

      // Initialize xterm for this terminal after render
      setTimeout(() => initXterm(result.id), 50);
    } catch (e) {
      console.error('Failed to create terminal:', e);
      // Create a basic fallback terminal
      const id = Date.now();
      setTerminals(prev => [...prev, { id, title: `Terminal ${prev.length + 1}` }]);
      setActiveTerminal(id);
      setTimeout(() => initFallbackTerminal(id), 50);
    }
  };

  const initXterm = async (termId: number) => {
    const container = terminalRefs.current.get(termId);
    if (!container) return;

    try {
      // Dynamic import xterm
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      const term = new Terminal({
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        theme: {
          background: '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#aeafad',
          cursorAccent: '#1e1e1e',
          selectionBackground: '#264f78',
          black: '#1e1e1e',
          red: '#f44747',
          green: '#6a9955',
          yellow: '#dcdcaa',
          blue: '#569cd6',
          magenta: '#c586c0',
          cyan: '#4ec9b0',
          white: '#d4d4d4',
          brightBlack: '#808080',
          brightRed: '#f44747',
          brightGreen: '#6a9955',
          brightYellow: '#dcdcaa',
          brightBlue: '#569cd6',
          brightMagenta: '#c586c0',
          brightCyan: '#4ec9b0',
          brightWhite: '#ffffff',
        },
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(container);

      // Ensure container has dimensions before fitting — defer fit slightly
      const doFit = () => {
        try {
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            fitAddon.fit();
          }
        } catch (e) { /* ignore */ }
      };
      // Fit after layout settles
      requestAnimationFrame(doFit);
      setTimeout(doFit, 100);
      setTimeout(doFit, 300);

      // Handle terminal input -> send to pty
      term.onData((data: string) => {
        // Track input buffer for IntelliSense
        if (data === '\r' || data === '\n') {
          // Enter pressed — record command and clear buffer
          if (inputBufferRef.current.trim()) {
            recentCommandsRef.current.push(inputBufferRef.current.trim());
            if (recentCommandsRef.current.length > 50) recentCommandsRef.current.shift();
          }
          inputBufferRef.current = '';
          setShowSuggestions(false);
          setSuggestions([]);
        } else if (data === '\x7f' || data === '\b') {
          // Backspace
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          setCurrentInput(inputBufferRef.current);
        } else if (data === '\t') {
          // Tab — trigger AI suggestions if we have input and no suggestions showing
          if (showSuggestions && suggestions.length > 0) {
            // Apply selected suggestion
            applySuggestion(suggestions[selectedSuggestion]);
            return; // Don't send tab to pty  
          } else if (inputBufferRef.current.length >= 2) {
            fetchSuggestions(inputBufferRef.current);
            // Still send tab to pty for normal completion
          }
        } else if (data === '\x1b[A' || data === '\x1b[B') {
          // Arrow up/down with suggestions open
          if (showSuggestions && suggestions.length > 0) {
            if (data === '\x1b[A') setSelectedSuggestion(s => Math.max(0, s - 1));
            else setSelectedSuggestion(s => Math.min(suggestions.length - 1, s + 1));
            return; // Don't send to pty
          }
        } else if (data === '\x1b') {
          // Escape — close suggestions
          setShowSuggestions(false);
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
          // Normal printable character
          inputBufferRef.current += data;
          setCurrentInput(inputBufferRef.current);
        }
        window.electronAPI?.terminalWrite(termId, data);
      });

      // Handle resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        window.electronAPI?.terminalResize(termId, cols, rows);
      });

      // Observe container resize
      const resizeObserver = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch (e) { /* ignore */ }
      });
      resizeObserver.observe(container);

      xtermInstances.current.set(termId, { term, fitAddon, resizeObserver });

      // Listen for terminal data from pty
      window.electronAPI?.onTerminalData((data: { id: number; data: string }) => {
        if (data.id === termId) {
          term.write(data.data);
        }
      });

      // Handle terminal exit
      window.electronAPI?.onTerminalExit((data: { id: number; exitCode: number }) => {
        if (data.id === termId) {
          term.write(`\r\n\x1b[33mProcess exited with code ${data.exitCode}\x1b[0m\r\n`);
        }
      });

      // Initial resize
      setTimeout(() => {
        try {
          fitAddon.fit();
          const { cols, rows } = term;
          window.electronAPI?.terminalResize(termId, cols, rows);
        } catch (e) { /* ignore */ }
      }, 100);

    } catch (e) {
      console.error('Failed to initialize xterm:', e);
      initFallbackTerminal(termId);
    }
  };

  const initFallbackTerminal = (termId: number) => {
    const container = terminalRefs.current.get(termId);
    if (!container) return;

    // Basic fallback terminal (text-based)
    container.innerHTML = `
      <div style="padding: 8px; font-family: 'Consolas', monospace; font-size: 13px; color: #cccccc; height: 100%; overflow: auto;">
        <div style="color: #6a9955;">Terminal ready. xterm not loaded - using fallback mode.</div>
        <div style="color: #858585;">Install @xterm/xterm for full terminal support.</div>
      </div>
    `;
  };

  // ── Terminal IntelliSense — AI-powered command suggestions ──
  const fetchSuggestions = useCallback(async (partial: string) => {
    if (!partial || partial.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const api = (window as any).electronAPI;
      if (!api?.terminalSuggest) return;
      const result = await api.terminalSuggest({
        partialCommand: partial,
        cwd: cwd || '',
        recentCommands: recentCommandsRef.current.slice(-10),
      });
      if (result?.suggestions && result.suggestions.length > 0) {
        setSuggestions(result.suggestions.slice(0, 6));
        setSelectedSuggestion(0);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [cwd]);

  const applySuggestion = useCallback((suggestion: TerminalSuggestion) => {
    const instance = activeTerminal !== null ? xtermInstances.current.get(activeTerminal) : null;
    if (!instance?.term) return;
    // Clear current input and write the suggestion
    const backspaces = '\b'.repeat(inputBufferRef.current.length);
    const spaces = ' '.repeat(inputBufferRef.current.length);
    instance.term.write(backspaces + spaces + backspaces); // clear visible text
    // Write to pty: send Ctrl+U to clear line then type suggestion
    window.electronAPI?.terminalWrite(activeTerminal!, '\x15' + suggestion.command);
    inputBufferRef.current = suggestion.command;
    setShowSuggestions(false);
    setSuggestions([]);
  }, [activeTerminal]);

  const closeTerminal = async (id: number) => {
    const instance = xtermInstances.current.get(id);
    if (instance) {
      instance.resizeObserver?.disconnect();
      instance.term?.dispose();
      xtermInstances.current.delete(id);
    }
    await window.electronAPI?.terminalDestroy(id);
    setTerminals(prev => prev.filter(t => t.id !== id));
    if (activeTerminal === id) {
      const remaining = terminals.filter(t => t.id !== id);
      setActiveTerminal(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Tab bar */}
      <div className="h-[35px] bg-[#252526] flex items-center border-b border-[#1e1e1e] flex-shrink-0">
        {/* Panel tabs */}
        <div className="flex items-center h-full">
          {(['terminal', 'problems', 'output'] as const).map((tab, i) => (
            <React.Fragment key={tab}>
              {i > 0 && (
                <span className="text-[11px] select-none pointer-events-none px-0.5" style={{ color: 'var(--theme-foreground-subtle)' }}>/</span>
              )}
              <button
                className={`px-2 h-full text-[11px] uppercase tracking-wider font-medium transition-colors border-b-2 ${
                  bottomTab === tab
                    ? 'text-white border-white'
                    : 'text-[#858585] border-transparent hover:text-[#cccccc]'
                }`}
                onClick={() => setBottomTab(tab)}
              >
                {tab}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1" />

        {/* Terminal tabs (only show when terminal tab is active) */}
        {bottomTab === 'terminal' && (
          <div className="flex items-center gap-0.5 mr-1">
            {terminals.map(t => (
              <div
                key={t.id}
                className={`flex items-center gap-1 px-2 h-[24px] text-[11px] rounded cursor-pointer ${
                  activeTerminal === t.id ? 'bg-[#1e1e1e] text-white' : 'text-[#858585] hover:text-white hover:bg-[#2a2d2e]'
                }`}
                onClick={() => setActiveTerminal(t.id)}
              >
                <TerminalIcon size={11} />
                <span className="whitespace-nowrap max-w-[96px] truncate">{t.title}</span>
                <button
                  className="ml-1 hover:text-[#f44747] opacity-60 hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); closeTerminal(t.id); }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 px-2">
          {bottomTab === 'terminal' && (
            <button
              className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#2a2d2e]"
              onClick={createTerminal}
              title="New Terminal"
            >
              <Plus size={14} />
            </button>
          )}
          <button
            className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#2a2d2e]"
            onClick={onClose}
            title="Close Panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {bottomTab === 'terminal' && terminals.map(t => (
          <div
            key={t.id}
            ref={(el) => { if (el) terminalRefs.current.set(t.id, el); }}
            className={`absolute inset-0 ${activeTerminal === t.id ? '' : 'hidden'}`}
          />
        ))}
        {/* Terminal IntelliSense suggestion overlay */}
        {bottomTab === 'terminal' && showSuggestions && suggestions.length > 0 && (
          <div className="absolute bottom-2 left-4 z-50 bg-[#252526] border border-[#454545] rounded-md shadow-xl max-w-[400px] overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-[#858585] border-b border-[#3c3c3c]">
              <Sparkles size={9} className="text-[#dcdcaa]" />
              AI Suggestions
              <span className="ml-auto text-[9px]">Tab to accept · Esc to dismiss</span>
            </div>
            {suggestions.map((s, i) => (
              <div
                key={i}
                className={`px-3 py-1.5 cursor-pointer flex items-start gap-2 transition-colors ${
                  i === selectedSuggestion ? 'bg-[#04395e] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                }`}
                onClick={() => applySuggestion(s)}
                onMouseEnter={() => setSelectedSuggestion(i)}
              >
                <code className="text-[12px] font-mono text-[#dcdcaa] flex-shrink-0">{s.command}</code>
                {s.description && (
                  <span className="text-[10px] text-[#858585] mt-0.5 truncate">{s.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {bottomTab === 'problems' && (
          <div className="p-3 text-[13px] text-[#858585]">
            No problems detected in workspace.
          </div>
        )}
        {bottomTab === 'output' && (
          <div className="p-3 text-[13px] text-[#858585] font-mono">
            Output channel
          </div>
        )}
      </div>
    </div>
  );
};
