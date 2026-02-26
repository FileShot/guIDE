import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ChevronRight, ChevronDown, ListTodo } from 'lucide-react';

interface TodoItem {
  file: string;
  relativePath: string;
  line: number;
  type: string;
  text: string;
}

interface Props {
  rootPath: string;
  onOpenFile: (filePath: string, line: number) => void;
}

const TYPE_COLORS: Record<string, string> = {
  TODO:  '#4fc1ff',
  FIXME: '#f48771',
  BUG:   '#f48771',
  HACK:  '#f0a070',
  NOTE:  '#89d185',
  XXX:   '#cc99cd',
};

const ALL_TYPES = ['TODO', 'FIXME', 'HACK', 'NOTE', 'BUG', 'XXX'] as const;

export const TodoTreePanel: React.FC<Props> = ({ rootPath, onOpenFile }) => {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const scan = useCallback(async () => {
    if (!rootPath) return;
    const api = window.electronAPI;
    if (!api?.scanTodos) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.scanTodos(rootPath);
      if (result.success && result.todos) {
        setTodos(result.todos);
      } else {
        setError(result.error || 'Scan failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  // Initial scan and re-scan when rootPath changes
  useEffect(() => {
    setTodos([]);
    scan();
  }, [scan]);

  // Re-scan when files are saved
  useEffect(() => {
    const handler = () => scan();
    const api = window.electronAPI;
    const cleanup = api?.onFilesChanged?.(handler);
    return () => { cleanup?.(); };
  }, [scan]);

  // Filtered & grouped todos
  const filtered = useMemo(() => {
    return todos.filter(t => {
      if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
      if (filter.trim()) {
        const q = filter.toLowerCase();
        return t.text.toLowerCase().includes(q) || t.relativePath.toLowerCase().includes(q);
      }
      return true;
    });
  }, [todos, filter, typeFilter]);

  // Group by relativePath
  const grouped = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const t of filtered) {
      const arr = map.get(t.relativePath) || [];
      arr.push(t);
      map.set(t.relativePath, arr);
    }
    return map;
  }, [filtered]);

  const toggleCollapse = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Count types in current todos for badge display
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of todos) {
      counts[t.type] = (counts[t.type] || 0) + 1;
    }
    return counts;
  }, [todos]);

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <span className="flex-1 text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
          {filtered.length} item{filtered.length !== 1 ? 's' : ''} across {grouped.size} file{grouped.size !== 1 ? 's' : ''}
        </span>
        <button
          className="p-1 rounded hover:opacity-100 transition-all flex-shrink-0"
          style={{ color: 'var(--theme-foreground-muted)' }}
          onClick={scan}
          disabled={loading}
          title="Refresh TODO tree"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filter input */}
      <div className="px-3 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <input
          type="text"
          placeholder="Filter todos..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full text-[12px] px-2 py-1 rounded outline-none"
          style={{
            backgroundColor: 'var(--theme-input-bg, #3c3c3c)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-foreground)',
          }}
        />
      </div>

      {/* Type filter pills */}
      <div className="flex items-center gap-1 px-3 py-1.5 flex-shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <button
          className="px-2 py-0.5 rounded text-[11px] transition-colors"
          style={{
            backgroundColor: typeFilter === 'ALL' ? 'var(--theme-accent)' : 'var(--theme-selection)',
            color: typeFilter === 'ALL' ? '#fff' : 'var(--theme-foreground-muted)',
          }}
          onClick={() => setTypeFilter('ALL')}
        >
          ALL {todos.length > 0 && <span className="ml-1 opacity-70">{todos.length}</span>}
        </button>
        {ALL_TYPES.filter(t => typeCounts[t] > 0).map(t => (
          <button
            key={t}
            className="px-2 py-0.5 rounded text-[11px] transition-colors"
            style={{
              backgroundColor: typeFilter === t ? TYPE_COLORS[t] + '33' : 'var(--theme-selection)',
              color: typeFilter === t ? TYPE_COLORS[t] : 'var(--theme-foreground-muted)',
              border: typeFilter === t ? `1px solid ${TYPE_COLORS[t]}55` : '1px solid transparent',
            }}
            onClick={() => setTypeFilter(prev => prev === t ? 'ALL' : t)}
          >
            {t}
            <span className="ml-1 opacity-70">{typeCounts[t]}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!rootPath && (
          <div className="flex flex-col items-center justify-center h-32 gap-2" style={{ color: 'var(--theme-foreground-muted)' }}>
            <ListTodo size={24} className="opacity-40" />
            <span className="text-[11px]">Open a folder to scan TODOs</span>
          </div>
        )}

        {rootPath && loading && todos.length === 0 && (
          <div className="flex items-center justify-center h-20" style={{ color: 'var(--theme-foreground-muted)' }}>
            <RefreshCw size={14} className="animate-spin mr-2" />
            <span>Scanning...</span>
          </div>
        )}

        {rootPath && error && (
          <div className="px-3 py-2 text-[11px] text-[#f48771]">{error}</div>
        )}

        {rootPath && !loading && !error && filtered.length === 0 && todos.length > 0 && (
          <div className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
            No items match the current filter
          </div>
        )}

        {rootPath && !loading && !error && todos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2" style={{ color: 'var(--theme-foreground-muted)' }}>
            <ListTodo size={24} className="opacity-40" />
            <span className="text-[11px]">No TODOs found in this project</span>
          </div>
        )}

        {/* Grouped file list */}
        {Array.from(grouped.entries()).map(([relPath, items]) => {
          const isCollapsed = collapsed.has(relPath);
          const fileName = relPath.split('/').pop() || relPath;
          return (
            <div key={relPath}>
              {/* File header */}
              <button
                className="w-full flex items-center gap-1 px-2 py-1.5 text-left hover:opacity-80 transition-opacity"
                style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 60%, transparent)' }}
                onClick={() => toggleCollapse(relPath)}
              >
                {isCollapsed
                  ? <ChevronRight size={12} style={{ color: 'var(--theme-foreground-muted)', flexShrink: 0 }} />
                  : <ChevronDown size={12} style={{ color: 'var(--theme-foreground-muted)', flexShrink: 0 }} />
                }
                <span className="font-medium truncate" style={{ color: 'var(--theme-foreground)' }} title={relPath}>
                  {fileName}
                </span>
                <span className="ml-1 text-[10px] flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }}>
                  {items.length}
                </span>
                <span className="ml-auto text-[10px] truncate max-w-[120px]" style={{ color: 'var(--theme-foreground-muted)', direction: 'rtl' }} title={relPath}>
                  {relPath.split('/').slice(0, -1).join('/')}
                </span>
              </button>

              {/* Items */}
              {!isCollapsed && items.map((item, idx) => (
                <button
                  key={`${item.line}-${idx}`}
                  className="w-full flex items-start gap-2 pl-7 pr-3 py-1 text-left hover:opacity-80 transition-opacity group"
                  style={{ backgroundColor: 'transparent' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-selection-hover, rgba(255,255,255,0.04))'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  onClick={() => onOpenFile(item.file, item.line)}
                  title={`${item.relativePath}:${item.line}`}
                >
                  {/* Type badge */}
                  <span
                    className="text-[10px] font-bold flex-shrink-0 mt-0.5 px-1 py-0.5 rounded"
                    style={{
                      color: TYPE_COLORS[item.type] || '#858585',
                      backgroundColor: (TYPE_COLORS[item.type] || '#858585') + '22',
                    }}
                  >
                    {item.type}
                  </span>
                  {/* Text */}
                  <span className="flex-1 truncate text-[11px]" style={{ color: 'var(--theme-foreground)' }}>
                    {item.text}
                  </span>
                  {/* Line number */}
                  <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                    :{item.line}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
