import React, { useState } from 'react';
import { Play, Plus, Trash2, ChevronDown, ChevronRight, FileText, Code, Save, Upload, Sparkles, Square } from 'lucide-react';
import type { NotebookCell } from '@/types/electron';

interface NotebookPanelProps {
  rootPath?: string;
}

interface CellState extends NotebookCell {
  running?: boolean;
  collapsed?: boolean;
}

export const NotebookPanel: React.FC<NotebookPanelProps> = ({ rootPath }) => {
  const [cells, setCells] = useState<CellState[]>([
    { id: 'cell-0', type: 'code', language: 'javascript', code: '// Start coding here\nconsole.log("Hello from guIDE Notebook!");', outputs: [], executionCount: null },
  ]);
  const [executionCounter, setExecutionCounter] = useState(1);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  const addCell = (type: 'code' | 'markdown', afterId?: string) => {
    const newCell: CellState = {
      id: 'cell-' + Date.now().toString(36),
      type,
      language: type === 'code' ? 'javascript' : 'markdown',
      code: '',
      outputs: [],
      executionCount: null,
    };
    setCells(prev => {
      if (!afterId) return [...prev, newCell];
      const idx = prev.findIndex(c => c.id === afterId);
      const next = [...prev];
      next.splice(idx + 1, 0, newCell);
      return next;
    });
  };

  const removeCell = (id: string) => {
    setCells(prev => prev.filter(c => c.id !== id));
  };

  const updateCellCode = (id: string, code: string) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, code } : c));
  };

  const updateCellLanguage = (id: string, language: string) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, language } : c));
  };

  const toggleCollapse = (id: string) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, collapsed: !c.collapsed } : c));
  };

  const runCell = async (cell: CellState) => {
    if (cell.type === 'markdown') return;
    const api = window.electronAPI;

    setCells(prev => prev.map(c => c.id === cell.id ? { ...c, running: true, outputs: [] } : c));

    let result;
    try {
      switch (cell.language) {
        case 'python':
          result = await api.notebookExecPython({ code: cell.code, cellId: cell.id });
          break;
        case 'shell':
        case 'bash':
          result = await api.notebookExecShell({ code: cell.code, cellId: cell.id });
          break;
        default:
          result = await api.notebookExecNode({ code: cell.code, cellId: cell.id });
      }
    } catch (e: any) {
      result = { success: false, cellId: cell.id, outputs: [{ type: 'error' as const, text: e.message }] };
    }

    const count = executionCounter;
    setExecutionCounter(prev => prev + 1);
    setCells(prev => prev.map(c => c.id === cell.id ? {
      ...c,
      running: false,
      outputs: result.outputs || (result.error ? [{ type: 'error' as const, text: result.error }] : []),
      executionCount: count,
    } : c));
  };

  const runAll = async () => {
    for (const cell of cells) {
      if (cell.type === 'code') await runCell(cell);
    }
  };

  const clearAllOutputs = () => {
    setCells(prev => prev.map(c => ({ ...c, outputs: [], executionCount: null })));
    setExecutionCounter(1);
  };

  const handleSave = async () => {
    const api = window.electronAPI;
    const filePath = rootPath ? rootPath + '/notebook.ipynb' : 'notebook.ipynb';
    const result = await api.notebookSaveIpynb({ filePath, cells });
    if (result.success) {
      alert(`Saved to ${result.path}`);
    }
  };

  const handleLoad = async () => {
    try {
      const api = window.electronAPI;
      const dialogResult = await api.showOpenDialog({ filters: [{ name: 'Notebooks', extensions: ['ipynb'] }], properties: ['openFile'] });
      if (dialogResult?.filePaths?.[0]) {
        const result = await api.notebookLoadIpynb(dialogResult.filePaths[0]);
        if (result.success && result.cells) {
          setCells(result.cells.map(c => ({ ...c, running: false, collapsed: false })));
          setExecutionCounter(1);
        }
      }
    } catch { /* ignore */ }
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    const context = cells.filter(c => c.type === 'code').map(c => c.code).join('\n---\n');
    const result = await window.electronAPI.notebookAiGenerate({ prompt: aiPrompt, context, language: 'javascript' });
    setGenerating(false);
    if (result.success && result.code) {
      const newCell: CellState = {
        id: 'cell-' + Date.now().toString(36),
        type: 'code',
        language: result.language || 'javascript',
        code: result.code,
        outputs: [],
        executionCount: null,
      };
      setCells(prev => [...prev, newCell]);
      setAiPrompt('');
    }
  };

  const outputColor = (type: string) => {
    switch (type) {
      case 'error': return '#f44336';
      case 'warn': return '#ff9800';
      case 'result': return '#4fc3f7';
      default: return '#c9d1d9';
    }
  };

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b flex-shrink-0" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}>
        <button onClick={runAll} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:opacity-80" style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }} title="Run All">
          <Play size={12} /> Run All
        </button>
        <button onClick={clearAllOutputs} className="px-2 py-1 rounded text-[11px] hover:opacity-80" style={{ backgroundColor: 'var(--theme-selection)' }} title="Clear All Outputs">
          <Square size={11} className="inline mr-0.5" /> Clear
        </button>
        <div className="flex-1" />
        <button onClick={handleLoad} className="p-1 rounded hover:opacity-80" title="Open .ipynb" style={{ color: 'var(--theme-foreground-muted)' }}><Upload size={14} /></button>
        <button onClick={handleSave} className="p-1 rounded hover:opacity-80" title="Save as .ipynb" style={{ color: 'var(--theme-foreground-muted)' }}><Save size={14} /></button>
      </div>

      {/* Cells */}
      <div className="flex-1 overflow-auto px-2 py-2 space-y-1">
        {cells.map((cell) => (
          <div key={cell.id} className="rounded overflow-hidden" style={{ border: '1px solid var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}>
            {/* Cell header */}
            <div className="flex items-center gap-1 px-2 py-1" style={{ backgroundColor: 'var(--theme-selection)', borderBottom: '1px solid var(--theme-border)' }}>
              <button onClick={() => toggleCollapse(cell.id)} className="opacity-60 hover:opacity-100">
                {cell.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
              {cell.type === 'code' ? <Code size={12} style={{ color: 'var(--theme-accent)' }} /> : <FileText size={12} style={{ color: '#a78bfa' }} />}
              <span className="text-[10px] font-mono" style={{ color: 'var(--theme-foreground-muted)' }}>
                {cell.type === 'code' ? `[${cell.executionCount || ' '}]` : 'md'}
              </span>
              {cell.type === 'code' && (
                <select value={cell.language} onChange={e => updateCellLanguage(cell.id, e.target.value)}
                  className="text-[10px] px-1 py-0.5 rounded bg-transparent outline-none cursor-pointer" style={{ color: 'var(--theme-foreground-muted)', border: '1px solid var(--theme-border)' }}>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="shell">Shell</option>
                </select>
              )}
              <div className="flex-1" />
              {cell.type === 'code' && (
                <button onClick={() => runCell(cell)} disabled={cell.running} className="p-0.5 rounded hover:opacity-80 disabled:opacity-30" title="Run Cell">
                  <Play size={12} style={{ color: cell.running ? '#ff9800' : '#4caf50' }} />
                </button>
              )}
              <button onClick={() => addCell('code', cell.id)} className="p-0.5 rounded hover:opacity-80 opacity-50" title="Add Code Cell"><Plus size={12} /></button>
              <button onClick={() => addCell('markdown', cell.id)} className="p-0.5 rounded hover:opacity-80 opacity-50" title="Add Markdown Cell"><FileText size={10} /></button>
              {cells.length > 1 && <button onClick={() => removeCell(cell.id)} className="p-0.5 rounded hover:opacity-80 opacity-50" title="Delete Cell"><Trash2 size={12} /></button>}
            </div>

            {/* Cell body */}
            {!cell.collapsed && (
              <>
                <textarea
                  value={cell.code}
                  onChange={e => updateCellCode(cell.id, e.target.value)}
                  className="w-full p-2 font-mono text-[12px] outline-none resize-none"
                  style={{ backgroundColor: '#1e1e1e', color: cell.type === 'markdown' ? '#d4d4d4' : '#d4d4d4', minHeight: '60px', border: 'none' }}
                  rows={Math.max(3, cell.code.split('\n').length)}
                  placeholder={cell.type === 'code' ? 'Enter code...' : 'Enter markdown...'}
                  spellCheck={false}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
                      e.preventDefault();
                      if (cell.type === 'code') runCell(cell);
                    }
                  }}
                />

                {/* Outputs */}
                {cell.outputs && cell.outputs.length > 0 && (
                  <div className="border-t px-2 py-1.5 space-y-0.5" style={{ borderColor: 'var(--theme-border)', backgroundColor: '#0d1117' }}>
                    {cell.outputs.map((output, oi) => (
                      <pre key={oi} className="text-[11px] font-mono whitespace-pre-wrap" style={{ color: outputColor(output.type) }}>
                        {output.type === 'error' ? '! ' : output.type === 'warn' ? '» ' : output.type === 'result' ? '→ ' : ''}{output.text}
                      </pre>
                    ))}
                  </div>
                )}

                {/* Running indicator */}
                {cell.running && (
                  <div className="px-2 py-1 text-[10px] animate-pulse" style={{ color: '#ff9800' }}>Executing...</div>
                )}
              </>
            )}
          </div>
        ))}

        {/* Add cell buttons */}
        <div className="flex items-center justify-center gap-2 py-2">
          <button onClick={() => addCell('code')} className="flex items-center gap-1 px-3 py-1 rounded text-[11px] hover:opacity-80" style={{ backgroundColor: 'var(--theme-selection)', color: 'var(--theme-foreground-muted)' }}>
            <Code size={12} /> Code
          </button>
          <button onClick={() => addCell('markdown')} className="flex items-center gap-1 px-3 py-1 rounded text-[11px] hover:opacity-80" style={{ backgroundColor: 'var(--theme-selection)', color: 'var(--theme-foreground-muted)' }}>
            <FileText size={12} /> Markdown
          </button>
        </div>
      </div>

      {/* AI Generate bar */}
      <div className="px-3 py-2 border-t flex-shrink-0" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)' }}>
        <div className="flex gap-1">
          <Sparkles size={14} className="mt-1.5 flex-shrink-0" style={{ color: 'var(--theme-accent)' }} />
          <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAiGenerate(); }}
            placeholder="Ask AI to generate a cell..." disabled={generating}
            className="flex-1 px-2 py-1.5 rounded text-[12px] outline-none" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }} />
          <button onClick={handleAiGenerate} disabled={generating || !aiPrompt.trim()} className="px-2 py-1.5 rounded text-[11px] disabled:opacity-50" style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}>
            {generating ? '...' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
};
