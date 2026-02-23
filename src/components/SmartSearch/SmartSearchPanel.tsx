import React, { useState, useCallback, useRef } from 'react';
import { Search, FileCode, ArrowRight, MapPin, Sparkles, Hash, ChevronDown, ChevronRight } from 'lucide-react';

interface CodeSymbolResult {
  name: string;
  type: string;
  line: number;
  filePath: string;
  context: string;
  relativePath?: string;
}

interface ReferenceResult {
  filePath: string;
  line: number;
  column?: number;
  context: string;
  relativePath: string;
}

type TabId = 'symbols' | 'references' | 'semantic';

export const SmartSearchPanel: React.FC<{
  rootPath: string;
  onFileClick: (filePath: string, line?: number) => void;
}> = ({ rootPath, onFileClick }) => {
  const [tab, setTab] = useState<TabId>('symbols');
  const [query, setQuery] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [symbols, setSymbols] = useState<CodeSymbolResult[]>([]);
  const [references, setReferences] = useState<ReferenceResult[]>([]);
  const [definitions, setDefinitions] = useState<ReferenceResult[]>([]);
  const [semanticResults, setSemanticResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [expandedDefs, setExpandedDefs] = useState(true);
  const [expandedRefs, setExpandedRefs] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const api = (window as any).electronAPI;

  // Search project symbols
  const searchSymbols = useCallback(async () => {
    if (!rootPath) return;
    setIsSearching(true);
    setError('');
    try {
      const result = await api.smartSearchProjectSymbols({ query, rootPath, filter: symbolFilter || undefined });
      if (result.success) {
        setSymbols(result.symbols || []);
      } else {
        setError(result.error || 'Symbol search failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSearching(false);
    }
  }, [query, rootPath, symbolFilter, api]);

  // Find references + definitions
  const findReferences = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError('');
    setReferences([]);
    setDefinitions([]);
    try {
      const [refResult, defResult] = await Promise.all([
        api.smartSearchReferences({ symbol: query, rootPath }),
        api.smartSearchDefinition({ symbol: query, rootPath }),
      ]);
      if (refResult.success) setReferences(refResult.references || []);
      if (defResult.success) setDefinitions(defResult.definitions || []);
      if (!refResult.success && !defResult.success) {
        setError(refResult.error || defResult.error || 'Search failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSearching(false);
    }
  }, [query, rootPath, api]);

  // Semantic search
  const semanticSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError('');
    try {
      const result = await api.smartSearchSemantic({ query, rootPath });
      if (result.success) {
        setSemanticResults(result.results || []);
      } else {
        setError(result.error || 'Semantic search failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSearching(false);
    }
  }, [query, rootPath, api]);

  const handleSearch = useCallback(() => {
    if (tab === 'symbols') searchSymbols();
    else if (tab === 'references') findReferences();
    else if (tab === 'semantic') semanticSearch();
  }, [tab, searchSymbols, findReferences, semanticSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  }, [handleSearch]);

  const symbolTypeIcon = (type: string) => {
    switch (type) {
      case 'function': case 'method': case 'arrow': return <span className="text-[#dcdcaa]">f</span>;
      case 'class': case 'struct': case 'trait': return <span className="text-[#4ec9b0]">C</span>;
      case 'interface': return <span className="text-[#4ec9b0]">I</span>;
      case 'type': return <span className="text-[#4ec9b0]">T</span>;
      case 'enum': return <span className="text-[#b5cea8]">E</span>;
      case 'const': case 'variable': return <span className="text-[#9cdcfe]">V</span>;
      default: return <span className="text-[#cccccc]">{type[0]?.toUpperCase()}</span>;
    }
  };

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'symbols', label: 'Symbols', icon: Hash },
    { id: 'references', label: 'References', icon: MapPin },
    { id: 'semantic', label: 'Semantic', icon: Sparkles },
  ];

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] transition-colors"
            style={{
              color: tab === t.id ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)',
              borderBottom: tab === t.id ? '2px solid var(--theme-accent)' : '2px solid transparent',
            }}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="p-2 space-y-1">
        <div className="flex gap-1">
          <input
            ref={inputRef}
            className="flex-1 text-[12px] p-1.5 rounded border outline-none"
            style={{ backgroundColor: 'var(--theme-input-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-foreground)' }}
            placeholder={tab === 'symbols' ? 'Search symbols...' : tab === 'references' ? 'Symbol name...' : 'Describe what you\'re looking for...'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="px-2 rounded"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
            onClick={handleSearch}
            disabled={isSearching}
          >
            <Search size={14} />
          </button>
        </div>
        {tab === 'symbols' && (
          <select
            className="w-full text-[11px] p-1 rounded border outline-none"
            style={{ backgroundColor: 'var(--theme-input-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-foreground)' }}
            value={symbolFilter}
            onChange={e => setSymbolFilter(e.target.value)}
          >
            <option value="">All types</option>
            <option value="function">Functions</option>
            <option value="class">Classes</option>
            <option value="interface">Interfaces</option>
            <option value="type">Types</option>
            <option value="const">Constants</option>
            <option value="method">Methods</option>
            <option value="enum">Enums</option>
          </select>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-2 p-2 rounded text-[11px]" style={{ backgroundColor: 'rgba(255,80,80,0.15)', color: '#ff5050' }}>
          {error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto px-2 pb-2">
        {isSearching && (
          <div className="text-center py-4 text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
            Searching...
          </div>
        )}

        {/* Symbols results */}
        {tab === 'symbols' && !isSearching && symbols.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] py-1" style={{ color: 'var(--theme-foreground-muted)' }}>
              {symbols.length} symbols found
            </div>
            {symbols.map((s, i) => (
              <button
                key={i}
                className="w-full flex items-center gap-2 p-1.5 rounded text-left transition-colors hover:opacity-80"
                style={{ backgroundColor: 'var(--theme-bg-secondary)' }}
                onClick={() => onFileClick(s.filePath, s.line)}
              >
                <span className="w-[14px] h-[14px] flex items-center justify-center text-[10px] font-bold rounded" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                  {symbolTypeIcon(s.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono font-bold" style={{ color: '#4fc1ff' }}>{s.name}</span>
                    <span className="text-[9px] px-1 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'var(--theme-foreground-muted)' }}>{s.type}</span>
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>
                    {s.relativePath || s.filePath}:{s.line}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* References/Definitions results */}
        {tab === 'references' && !isSearching && (definitions.length > 0 || references.length > 0) && (
          <div className="space-y-2">
            {definitions.length > 0 && (
              <div>
                <button
                  className="flex items-center gap-1 text-[11px] font-semibold py-1"
                  onClick={() => setExpandedDefs(!expandedDefs)}
                  style={{ color: 'var(--theme-foreground-muted)' }}
                >
                  {expandedDefs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Definitions ({definitions.length})
                </button>
                {expandedDefs && definitions.map((d, i) => (
                  <button
                    key={i}
                    className="w-full flex items-start gap-2 p-1.5 rounded text-left mb-0.5 transition-colors hover:opacity-80"
                    style={{ backgroundColor: 'rgba(78,201,176,0.1)' }}
                    onClick={() => onFileClick(d.filePath, d.line)}
                  >
                    <ArrowRight size={12} className="mt-0.5 flex-shrink-0" style={{ color: '#4ec9b0' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>
                        {d.relativePath}:{d.line}
                      </div>
                      <div className="font-mono text-[11px] truncate">{d.context}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {references.length > 0 && (
              <div>
                <button
                  className="flex items-center gap-1 text-[11px] font-semibold py-1"
                  onClick={() => setExpandedRefs(!expandedRefs)}
                  style={{ color: 'var(--theme-foreground-muted)' }}
                >
                  {expandedRefs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  References ({references.length})
                </button>
                {expandedRefs && references.map((r, i) => (
                  <button
                    key={i}
                    className="w-full flex items-start gap-2 p-1.5 rounded text-left mb-0.5 transition-colors hover:opacity-80"
                    style={{ backgroundColor: 'var(--theme-bg-secondary)' }}
                    onClick={() => onFileClick(r.filePath, r.line)}
                  >
                    <MapPin size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>
                        {r.relativePath}:{r.line}
                      </div>
                      <div className="font-mono text-[11px] truncate">{r.context}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Semantic results */}
        {tab === 'semantic' && !isSearching && semanticResults.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] py-1" style={{ color: 'var(--theme-foreground-muted)' }}>
              {semanticResults.length} results
            </div>
            {semanticResults.map((r, i) => (
              <button
                key={i}
                className="w-full flex items-start gap-2 p-2 rounded text-left mb-1 transition-colors hover:opacity-80"
                style={{ backgroundColor: 'var(--theme-bg-secondary)' }}
                onClick={() => onFileClick(r.filePath, r.line)}
              >
                <FileCode size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--theme-accent)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate" style={{ color: '#4fc1ff' }}>
                    {r.relativePath}:{r.line}
                  </div>
                  {r.reason && <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)' }}>{r.reason}</div>}
                  <div className="font-mono text-[10px] mt-1 truncate" style={{ color: 'var(--theme-foreground)' }}>
                    {r.snippet}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isSearching && !error &&
          ((tab === 'symbols' && symbols.length === 0) ||
           (tab === 'references' && definitions.length === 0 && references.length === 0) ||
           (tab === 'semantic' && semanticResults.length === 0)) && (
          <div className="text-center py-8 text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
            <Search size={24} className="mx-auto mb-2 opacity-30" />
            {tab === 'symbols' && 'Search project symbols (functions, classes, types...)'}
            {tab === 'references' && 'Enter a symbol name to find all references and definitions'}
            {tab === 'semantic' && 'Describe what you\'re looking for in natural language'}
          </div>
        )}
      </div>
    </div>
  );
};
