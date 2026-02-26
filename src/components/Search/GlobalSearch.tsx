import React, { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, CaseSensitive, Regex, WholeWord, Sparkles } from 'lucide-react';

interface GlobalSearchProps {
  rootPath: string;
  onResultClick: (filePath: string, line: number) => void;
}

interface SearchResultGroup {
  file: string;
  relativePath: string;
  matches: {
    line: number;
    column: number;
    lineContent: string;
    matchText: string;
  }[];
}

interface SemanticResultGroup {
  file: string;
  relativePath: string;
  score: number;
  chunks: {
    startLine: number;
    endLine: number;
    content: string;
    score: number;
  }[];
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ rootPath, onResultClick }) => {
  const [query, setQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [results, setResults] = useState<SearchResultGroup[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [includePattern, setIncludePattern] = useState('');
  const [excludePattern, setExcludePattern] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [semanticMode, setSemanticMode] = useState(false);
  const [semanticResults, setSemanticResults] = useState<SemanticResultGroup[]>([]);
  const [semanticExpanded, setSemanticExpanded] = useState<Set<string>>(new Set());

  const doSearch = useCallback(async () => {
    if (!query.trim() || !rootPath) return;
    setIsSearching(true);
    setResults([]);
    setSemanticResults([]);
    setTotalMatches(0);

    try {
      const api = window.electronAPI;

      if (semanticMode) {
        // AI semantic search via RAG engine
        if (!api?.ragSearch) return;
        const ragResults = await api.ragSearch(query, 50);
        if (ragResults && ragResults.length > 0) {
          // Group by file
          const groups = new Map<string, SemanticResultGroup>();
          for (const r of ragResults) {
            const key = r.path || r.relativePath;
            if (!groups.has(key)) {
              groups.set(key, {
                file: r.path,
                relativePath: r.relativePath,
                score: r.score,
                chunks: [],
              });
            }
            const g = groups.get(key)!;
            g.score = Math.max(g.score, r.score);
            g.chunks.push({
              startLine: r.startLine,
              endLine: r.endLine,
              content: r.content,
              score: r.score,
            });
          }
          const groupArray = Array.from(groups.values()).sort((a, b) => b.score - a.score);
          setSemanticResults(groupArray);
          setTotalMatches(ragResults.length);
          setSemanticExpanded(new Set(groupArray.map(g => g.file)));
        }
      } else {
        // Text search
        if (!api?.searchInFiles) return;

        const result = await api.searchInFiles(rootPath, query, {
          caseSensitive, wholeWord, isRegex,
          include: includePattern, exclude: excludePattern,
          maxResults: 500,
        });

        if (result.success && result.results) {
          // Group by file
          const groups = new Map<string, SearchResultGroup>();
          let matchCount = 0;

          for (const match of result.results) {
            if (!groups.has(match.file)) {
              groups.set(match.file, {
                file: match.file,
                relativePath: match.relativePath,
                matches: [],
              });
            }
            groups.get(match.file)!.matches.push({
              line: match.line,
              column: match.column,
              lineContent: match.lineContent,
              matchText: match.matches[0]?.text || query,
            });
            matchCount++;
          }

          const groupArray = Array.from(groups.values());
          setResults(groupArray);
          setTotalMatches(matchCount);
          // Expand all by default
          setExpandedFiles(new Set(groupArray.map(g => g.file)));
        }
      }
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setIsSearching(false);
    }
  }, [query, rootPath, caseSensitive, wholeWord, isRegex, includePattern, excludePattern, semanticMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch();
  };

  const toggleFile = (file: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const toggleSemanticFile = (file: string) => {
    setSemanticExpanded(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const highlightMatch = (text: string, matchText: string) => {
    const idx = text.toLowerCase().indexOf(matchText.toLowerCase());
    if (idx === -1) return <span>{text}</span>;
    return (
      <>
        <span>{text.substring(0, idx)}</span>
        <span className="bg-[#613214] text-[#e8ab53] rounded-sm">{text.substring(idx, idx + matchText.length)}</span>
        <span>{text.substring(idx + matchText.length)}</span>
      </>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search inputs */}
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {/* Search row */}
        <div className="flex items-center gap-1">
          <button
            className="p-0.5 text-[#858585] hover:text-white"
            onClick={() => setShowReplace(!showReplace)}
            title="Toggle Replace"
          >
            <ChevronRight size={14} className={`transition-transform ${showReplace ? 'rotate-90' : ''}`} />
          </button>
          <div className="flex-1 flex items-center bg-[#3c3c3c] border border-[#3c3c3c] focus-within:border-[#007acc] rounded">
            <input
              className="flex-1 bg-transparent text-[#cccccc] text-[13px] px-2 py-1 outline-none"
              placeholder="Search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              className={`p-1 mx-0.5 rounded ${caseSensitive ? 'bg-[#007acc] text-white' : 'text-[#858585] hover:text-white'}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Match Case"
            >
              <CaseSensitive size={14} />
            </button>
            <button
              className={`p-1 mx-0.5 rounded ${wholeWord ? 'bg-[#007acc] text-white' : 'text-[#858585] hover:text-white'}`}
              onClick={() => setWholeWord(!wholeWord)}
              title="Match Whole Word"
            >
              <WholeWord size={14} />
            </button>
            <button
              className={`p-1 mx-0.5 rounded ${isRegex ? 'bg-[#007acc] text-white' : 'text-[#858585] hover:text-white'}`}
              onClick={() => setIsRegex(!isRegex)}
              title="Use Regular Expression"
            >
              <Regex size={14} />
            </button>
          </div>
          <button
            className={`p-1 rounded flex-shrink-0 ${semanticMode ? 'bg-[#7c3aed] text-white' : 'text-[#858585] hover:text-white'}`}
            onClick={() => setSemanticMode(!semanticMode)}
            title="AI Semantic Search (uses RAG embeddings)"
          >
            <Sparkles size={14} />
          </button>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className="flex items-center gap-1 ml-[22px]">
            <div className="flex-1 flex items-center bg-[#3c3c3c] border border-[#3c3c3c] focus-within:border-[#007acc] rounded">
              <input
                className="flex-1 bg-transparent text-[#cccccc] text-[13px] px-2 py-1 outline-none"
                placeholder="Replace"
                value={replaceQuery}
                onChange={e => setReplaceQuery(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Filters */}
        <button
          className="text-[11px] text-[#858585] hover:text-[#cccccc] text-left ml-[22px]"
          onClick={() => setShowFilters(!showFilters)}
        >
          {showFilters ? '⌄ filters' : '⌃ filters'}
        </button>
        {showFilters && (
          <div className="ml-[22px] flex flex-col gap-1">
            <input
              className="bg-[#3c3c3c] text-[#cccccc] text-[12px] px-2 py-0.5 rounded outline-none border border-[#3c3c3c] focus:border-[#007acc]"
              placeholder="files to include (e.g. *.ts)"
              value={includePattern}
              onChange={e => setIncludePattern(e.target.value)}
            />
            <input
              className="bg-[#3c3c3c] text-[#cccccc] text-[12px] px-2 py-0.5 rounded outline-none border border-[#3c3c3c] focus:border-[#007acc]"
              placeholder="files to exclude"
              value={excludePattern}
              onChange={e => setExcludePattern(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Results summary */}
      {totalMatches > 0 && (
        <div className="px-4 py-1 text-[11px] text-[#858585] border-b border-[#2a2d2e]">
          {semanticMode
            ? <>{totalMatches} semantic matches in {semanticResults.length} files</>
            : <>{totalMatches} results in {results.length} files</>
          }
        </div>
      )}

      {isSearching && (
        <div className="px-4 py-2 text-[12px] text-[#858585]">
          {semanticMode ? 'Searching with AI...' : 'Searching...'}
        </div>
      )}

      {/* Semantic mode hint */}
      {semanticMode && !isSearching && totalMatches === 0 && !query && (
        <div className="px-4 py-3 text-[12px] text-[#858585]">
          <Sparkles size={14} className="inline mr-1 text-[#7c3aed]" />
          AI Semantic Search — describe what you're looking for in natural language
        </div>
      )}

      {/* Results tree */}
      <div className="flex-1 overflow-auto">
        {/* Text search results */}
        {!semanticMode && results.map(group => (
          <div key={group.file}>
            {/* File header */}
            <div
              className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-[#2a2d2e] text-[13px]"
              onClick={() => toggleFile(group.file)}
            >
              {expandedFiles.has(group.file)
                ? <ChevronDown size={14} className="text-[#858585] flex-shrink-0" />
                : <ChevronRight size={14} className="text-[#858585] flex-shrink-0" />
              }
              <File size={14} className="text-[#858585] flex-shrink-0" />
              <span className="truncate text-[#cccccc]">{group.relativePath.split(/[/\\]/).pop()}</span>
              <span className="text-[#858585] text-[11px] ml-1 truncate">{group.relativePath}</span>
              <span className="ml-auto text-[11px] text-[#858585] bg-[#3c3c3c] px-1.5 rounded-full flex-shrink-0">{group.matches.length}</span>
            </div>

            {/* Matches */}
            {expandedFiles.has(group.file) && group.matches.map((match, i) => (
              <div
                key={`${group.file}:${match.line}:${i}`}
                className="flex items-center gap-2 pl-[44px] pr-2 py-0.5 cursor-pointer hover:bg-[#2a2d2e] text-[12px]"
                onClick={() => onResultClick(group.file, match.line)}
              >
                <span className="text-[#858585] w-[30px] text-right flex-shrink-0">{match.line}</span>
                <span className="truncate font-mono text-[11px]">
                  {highlightMatch(match.lineContent.trim(), match.matchText)}
                </span>
              </div>
            ))}
          </div>
        ))}

        {/* Semantic search results */}
        {semanticMode && semanticResults.map(group => (
          <div key={group.file}>
            {/* File header */}
            <div
              className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-[#2a2d2e] text-[13px]"
              onClick={() => toggleSemanticFile(group.file)}
            >
              {semanticExpanded.has(group.file)
                ? <ChevronDown size={14} className="text-[#858585] flex-shrink-0" />
                : <ChevronRight size={14} className="text-[#858585] flex-shrink-0" />
              }
              <File size={14} className="text-[#858585] flex-shrink-0" />
              <span className="truncate text-[#cccccc]">{group.relativePath.split(/[/\\]/).pop()}</span>
              <span className="text-[#858585] text-[11px] ml-1 truncate">{group.relativePath}</span>
              <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px] text-[#7c3aed]">{Math.round(group.score * 100)}%</span>
                <span className="text-[11px] text-[#858585] bg-[#3c3c3c] px-1.5 rounded-full">{group.chunks.length}</span>
              </span>
            </div>

            {/* Semantic chunks */}
            {semanticExpanded.has(group.file) && group.chunks.map((chunk, i) => (
              <div
                key={`${group.file}:${chunk.startLine}:${i}`}
                className="pl-[44px] pr-2 py-1 cursor-pointer hover:bg-[#2a2d2e] text-[12px] border-b border-[#2a2d2e]"
                onClick={() => onResultClick(group.file, chunk.startLine)}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[#858585] text-[11px]">L{chunk.startLine}-{chunk.endLine}</span>
                  <span className="text-[10px] text-[#7c3aed]">{Math.round(chunk.score * 100)}% match</span>
                </div>
                <pre className="text-[11px] text-[#9d9d9d] font-mono whitespace-pre-wrap overflow-hidden max-h-[60px] leading-tight">
                  {chunk.content.trim().substring(0, 200)}{chunk.content.trim().length > 200 ? '...' : ''}
                </pre>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
