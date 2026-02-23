import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';

interface SearchReplaceProps {
  onClose: () => void;
}

export const SearchReplace: React.FC<SearchReplaceProps> = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [matchCount, _setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Find next — this will be driven by Monaco's built-in find if it were connected
        setCurrentMatch(prev => (prev < matchCount ? prev + 1 : 1));
      }
      if (e.key === 'Enter' && e.shiftKey) {
        setCurrentMatch(prev => (prev > 1 ? prev - 1 : matchCount));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, matchCount]);

  const ToggleButton: React.FC<{ active: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
    <button
      className={`p-1 rounded text-[11px] ${active ? 'bg-[#007acc] text-white' : 'text-[#858585] hover:text-white hover:bg-[#3c3c3c]'}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );

  return (
    <div className="bg-[#252526] border-b border-[#007acc] px-3 py-2 flex flex-col gap-1.5 flex-shrink-0">
      {/* Search Row */}
      <div className="flex items-center gap-1.5">
        <button
          className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
          onClick={() => setShowReplace(!showReplace)}
          title={showReplace ? 'Hide Replace' : 'Show Replace'}
        >
          <ChevronDown size={14} className={`transition-transform ${showReplace ? '' : '-rotate-90'}`} />
        </button>
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-[13px] px-2 py-1 rounded border border-transparent focus:border-[#007acc] outline-none min-w-0"
          placeholder="Find"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="flex items-center gap-0.5">
          <ToggleButton active={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)} title="Match Case">
            Aa
          </ToggleButton>
          <ToggleButton active={wholeWord} onClick={() => setWholeWord(!wholeWord)} title="Match Whole Word">
            ab
          </ToggleButton>
          <ToggleButton active={useRegex} onClick={() => setUseRegex(!useRegex)} title="Use Regular Expression">
            .*
          </ToggleButton>
        </div>
        <span className="text-[11px] text-[#858585] min-w-[50px] text-right">
          {query ? `${currentMatch}/${matchCount}` : 'No results'}
        </span>
        <button
          className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
          onClick={() => setCurrentMatch(prev => (prev > 1 ? prev - 1 : matchCount))}
          title="Previous Match (Shift+Enter)"
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
          onClick={() => setCurrentMatch(prev => (prev < matchCount ? prev + 1 : 1))}
          title="Next Match (Enter)"
        >
          <ChevronDown size={14} />
        </button>
        <button
          className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
          onClick={onClose}
          title="Close (Escape)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Replace Row */}
      {showReplace && (
        <div className="flex items-center gap-1.5 ml-7">
          <input
            type="text"
            className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-[13px] px-2 py-1 rounded border border-transparent focus:border-[#007acc] outline-none min-w-0"
            placeholder="Replace"
            value={replaceValue}
            onChange={e => setReplaceValue(e.target.value)}
          />
          <button
            className="px-2 py-1 text-[11px] text-[#cccccc] hover:bg-[#3c3c3c] rounded"
            title="Replace"
          >
            Replace
          </button>
          <button
            className="px-2 py-1 text-[11px] text-[#cccccc] hover:bg-[#3c3c3c] rounded"
            title="Replace All"
          >
            All
          </button>
        </div>
      )}
    </div>
  );
};
