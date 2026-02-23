import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, File, Terminal as TerminalIcon, Settings, MessageSquare, X, FolderPlus } from 'lucide-react';

interface CommandPaletteProps {
  rootPath: string;
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
  onAction: (action: string) => void;
}

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: 'command' | 'file';
  action: () => void;
}

const COMMANDS: Omit<CommandItem, 'action'>[] = [
  { id: 'toggle-terminal', label: 'Toggle Terminal', description: 'Ctrl+`', icon: <TerminalIcon size={14} />, category: 'command' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', description: 'Ctrl+B', icon: <Settings size={14} />, category: 'command' },
  { id: 'toggle-chat', label: 'Toggle AI Chat', description: '', icon: <MessageSquare size={14} />, category: 'command' },
  { id: 'new-file', label: 'New File', description: 'Ctrl+N', icon: <File size={14} />, category: 'command' },
  { id: 'save', label: 'Save File', description: 'Ctrl+S', icon: <File size={14} />, category: 'command' },
  { id: 'find-in-files', label: 'Search in Files', description: 'Ctrl+Shift+F', icon: <Search size={14} />, category: 'command' },
  { id: 'new-project', label: 'New Project from Template', description: 'Create a new project', icon: <FolderPlus size={14} />, category: 'command' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ rootPath, onClose, onOpenFile, onAction }) => {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CommandItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [_isFileMode, _setIsFileMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build items based on query
  useEffect(() => {
    const buildItems = async () => {
      const q = query.toLowerCase();
      const results: CommandItem[] = [];

      // If query doesn't start with >, search files first
      if (!q.startsWith('>') && q.length > 0 && rootPath && window.electronAPI?.ragSearchFiles) {
        try {
          const fileResults = await window.electronAPI.ragSearchFiles(q, 10);
          for (const f of fileResults) {
            results.push({
              id: `file:${f.path}`,
              label: f.fileName,
              description: f.relativePath,
              icon: <File size={14} />,
              category: 'file',
              action: () => { onOpenFile(f.path); onClose(); },
            });
          }
        } catch (e) { /* fallback */ }
      }

      // Filter commands
      const cmdQuery = q.startsWith('>') ? q.slice(1).trim() : q;
      for (const cmd of COMMANDS) {
        if (!cmdQuery || cmd.label.toLowerCase().includes(cmdQuery)) {
          results.push({
            ...cmd,
            action: () => {
              onAction(cmd.id);
              onClose();
            },
          });
        }
      }

      setItems(results);
      setSelectedIndex(0);
    };

    buildItems();
  }, [query, rootPath, onAction, onClose, onOpenFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && items[selectedIndex]) { items[selectedIndex].action(); }
  }, [items, selectedIndex, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[15%]" onClick={onClose}>
      <div
        className="w-[600px] max-h-[400px] bg-[#252526]/85 glass-strong border border-[#454545]/60 rounded-md shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center px-3 border-b border-[#454545]">
          <Search size={14} className="text-[#858585] mr-2 flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[#cccccc] text-[14px] py-2 outline-none placeholder-[#858585]"
            placeholder={`Search files or type > for commands`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={onClose} className="text-[#858585] hover:text-white ml-2">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto">
          {items.length === 0 && query && (
            <div className="p-4 text-[13px] text-[#858585] text-center">No results found</div>
          )}
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px] ${
                i === selectedIndex ? 'bg-[#094771] text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
              }`}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="flex-shrink-0 text-[#858585]">{item.icon}</span>
              <span className="truncate">{item.label}</span>
              {item.description && (
                <span className="ml-auto text-[11px] text-[#858585] truncate">{item.description}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
