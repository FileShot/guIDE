import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { X, Circle, Undo2, Check, Search, Play, Code2, Eye, Columns, Globe, MoreHorizontal, Wifi, Settings2 } from 'lucide-react';
import { AdvancedSettingsPanel } from '../Settings/AdvancedSettingsPanel';
import { MonacoEditor } from './MonacoEditor';
import { DiffViewer } from './DiffViewer';
import { SearchReplace } from './SearchReplace';
import { InlineChat } from './InlineChat';
import { BrowserPanel } from '../Browser/BrowserPanel';
import { getFileIcon } from '@/utils/helpers';
import { getLanguageFromExtension } from '@/config/editor';
import {
  isImageFile, isBinaryFile, isHtmlFile, isMarkdownFile, isSvgFile,
  isJsonFile, isCsvFile,
  isPreviewableFile, isDataPreviewable, getPreviewLabel,
  isRunnableFile, getRunCommand,
} from './fileUtils';
import {
  ImagePreview, BinaryPreview, HtmlPreview, JsonPreview,
  CsvPreview, DataPreview, MarkdownPreview, SvgPreview, WelcomeScreen,
} from './Previews';

export interface EditorHandle {
  openFile: (filePath: string, line?: number) => Promise<void>;
  saveFile: () => Promise<void>;
  saveAllFiles: () => Promise<void>;
  toggleSearch: () => void;
  createNewFile: () => void;
  applyCodeChange: (filePath: string, newCode: string) => void;
  getCurrentContent: () => string | undefined;
  openBrowserTab: (url?: string) => void;
  closeBrowserTab: () => void;
  triggerEditorAction: (actionId: string) => void;
  openSettingsTab: () => void;
  runCurrentFile: () => void;
}

interface EditorProps {
  className?: string;
  onCursorChange?: (line: number, column: number) => void;
  onLanguageChange?: (language: string) => void;
  onSelectionChange?: (text: string) => void;
  onFileChange?: (filePath: string) => void;
  onTabsChange?: (hasTabs: boolean) => void;
  onMarkersChange?: (errors: number, warnings: number) => void;
}

interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
  isImage?: boolean;
  isBinary?: boolean;
  isBrowser?: boolean;
  browserUrl?: string;
  isSettings?: boolean;
  // For AI diff/undo
  pendingChange?: {
    originalContent: string;
    newContent: string;
    description: string;
  };
}

export const Editor = forwardRef<EditorHandle, EditorProps>(({
  className = '',
  onCursorChange,
  onLanguageChange,
  onSelectionChange,
  onFileChange,
  onTabsChange,
  onMarkersChange,
}, ref) => {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showDiffBar, setShowDiffBar] = useState(false);
  const [diffTabId, setDiffTabId] = useState<string | null>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [previewTabIds, setPreviewTabIds] = useState<Set<string>>(new Set());
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [liveServerPort, setLiveServerPort] = useState<number | null>(null);
  const [inlineChatOpen, setInlineChatOpen] = useState(false);
  const editorInstanceRef = useRef<any>(null);
  const splitEditorRef = useRef<any>(null);

  const toggleHtmlPreview = useCallback((tabId: string) => {
    setPreviewTabIds(prev => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  }, []);

  const isTabPreviewing = useCallback((tabId: string) => previewTabIds.has(tabId), [previewTabIds]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Notify parent when tabs change
  useEffect(() => {
    onTabsChange?.(tabs.length > 0);
  }, [tabs.length, onTabsChange]);

  // Close tab — defined before useImperativeHandle so it can be referenced
  const closeTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        const newActive = next[Math.min(idx, next.length - 1)]?.id || null;
        setActiveTabId(newActive);
      }
      return next;
    });
  }, [activeTabId]);

  // Tab management helpers
  const closeAllTabs = useCallback(() => { setTabs([]); setActiveTabId(null); setTabMenuOpen(false); }, []);
  const closeOtherTabs = useCallback(() => {
    setTabs(prev => prev.filter(t => t.id === activeTabId));
    setTabMenuOpen(false);
  }, [activeTabId]);
  const closeSavedTabs = useCallback(() => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.isDirty);
      if (!remaining.find(t => t.id === activeTabId)) {
        setActiveTabId(remaining[0]?.id || null);
      }
      return remaining;
    });
    setTabMenuOpen(false);
  }, [activeTabId]);
  const closeTabsToRight = useCallback(() => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === activeTabId);
      return idx >= 0 ? prev.slice(0, idx + 1) : prev;
    });
    setTabMenuOpen(false);
  }, [activeTabId]);

  // Close tab menu on click outside
  useEffect(() => {
    if (!tabMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) setTabMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tabMenuOpen]);

  // Keep refs in sync for useImperativeHandle (avoids re-creating the handle on every tab/content change)
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  // runCurrentFile is defined later in the component; use a ref so useImperativeHandle can call it without a forward-reference dep
  const runCurrentFileRef = useRef<() => void>(() => {});

  const toggleLiveServer = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    if (liveServerPort !== null) {
      await api.liveServerStop();
      setLiveServerPort(null);
    } else {
      const tab = activeTabRef.current;
      if (!tab) return;
      const result = await api.liveServerStart(tab.filePath);
      if (result.success && result.port && result.url) {
        setLiveServerPort(result.port);
        const existing = tabsRef.current.find(t => t.isBrowser);
        if (!existing) {
          const newTab: EditorTab = {
            id: `browser-tab-${Date.now()}`,
            filePath: '__browser__',
            fileName: 'Live Server',
            content: '',
            originalContent: '',
            isDirty: false,
            language: 'plaintext',
            isBrowser: true,
            browserUrl: result.url,
          };
          setTabs(prev => [...prev, newTab]);
          setActiveTabId(newTab.id);
        } else {
          setActiveTabId(existing.id);
        }
      }
    }
  }, [liveServerPort]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    openFile: async (filePath: string, line?: number) => {
      // Check if already open
      const existing = tabsRef.current.find(t => t.filePath === filePath);
      if (existing) {
        setActiveTabId(existing.id);
        if (line && editorInstanceRef.current) {
          setTimeout(() => {
            editorInstanceRef.current?.revealLineInCenter(line);
            editorInstanceRef.current?.setPosition({ lineNumber: line, column: 1 });
          }, 100);
        }
        return;
      }

      // Read file
      try {
        const api = window.electronAPI;
        if (!api) return;

        const fileName = filePath.split(/[/\\]/).pop() || 'untitled';
        const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
        const language = getLanguageFromExtension(ext);

        // Handle image files - show preview instead of text
        if (isImageFile(filePath)) {
          const newTab: EditorTab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filePath,
            fileName,
            content: '',
            originalContent: '',
            isDirty: false,
            language: 'plaintext',
            isImage: true,
          };
          setTabs(prev => [...prev, newTab]);
          setActiveTabId(newTab.id);
          onFileChange?.(filePath);
          return;
        }

        // Handle binary files - show info instead of garbled content
        if (isBinaryFile(filePath)) {
          await api.getFileStats(filePath); // verify file exists
          const newTab: EditorTab = {
            id: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filePath,
            fileName,
            content: '',
            originalContent: '',
            isDirty: false,
            language: 'plaintext',
            isBinary: true,
          };
          setTabs(prev => [...prev, newTab]);
          setActiveTabId(newTab.id);
          onFileChange?.(filePath);
          return;
        }

        const result = await api.readFile(filePath);
        if (!result.success || result.content === undefined) return;

        const newTab: EditorTab = {
          id: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filePath,
          fileName,
          content: result.content,
          originalContent: result.content,
          isDirty: false,
          language,
        };

        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
        onFileChange?.(filePath);
        onLanguageChange?.(language);

        if (line) {
          setTimeout(() => {
            editorInstanceRef.current?.revealLineInCenter(line);
            editorInstanceRef.current?.setPosition({ lineNumber: line, column: 1 });
          }, 200);
        }
      } catch (e) {
        console.error('Failed to open file:', e);
      }
    },

    saveFile: async () => {
      const currentTab = activeTabRef.current;
      if (!currentTab || !currentTab.isDirty) return;
      try {
        const api = window.electronAPI;
        if (!api) return;
        const result = await api.writeFile(currentTab.filePath, currentTab.content);
        if (result.success) {
          setTabs(prev => prev.map(t =>
            t.id === currentTab.id ? { ...t, isDirty: false, originalContent: t.content } : t
          ));
        }
      } catch (e) {
        console.error('Failed to save:', e);
      }
    },

    saveAllFiles: async () => {
      const api = window.electronAPI;
      if (!api) return;
      for (const tab of tabsRef.current) {
        if (tab.isDirty) {
          const result = await api.writeFile(tab.filePath, tab.content);
          if (result.success) {
            setTabs(prev => prev.map(t =>
              t.id === tab.id ? { ...t, isDirty: false, originalContent: t.content } : t
            ));
          }
        }
      }
    },

    toggleSearch: () => setSearchOpen(v => !v),

    createNewFile: () => {
      const newTab: EditorTab = {
        id: `tab-${Date.now()}`,
        filePath: '',
        fileName: 'Untitled',
        content: '',
        originalContent: '',
        isDirty: true,
        language: 'plaintext',
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },

    applyCodeChange: (filePath: string, newCode: string) => {
      // Find or open the file, then show diff
      const existingTab = tabsRef.current.find(t => t.filePath === filePath);
      if (existingTab) {
        setTabs(prev => prev.map(t =>
          t.id === existingTab.id ? {
            ...t,
            pendingChange: {
              originalContent: t.content,
              newContent: newCode,
              description: 'AI suggested change',
            },
          } : t
        ));
        setActiveTabId(existingTab.id);
        setDiffTabId(existingTab.id);
        setShowDiffBar(true);
      }
    },

    getCurrentContent: () => activeTabRef.current?.content,

    openBrowserTab: (url?: string) => {
      // Check if browser tab already exists
      const existing = tabsRef.current.find(t => t.isBrowser);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      // Create new browser tab
      const newTab: EditorTab = {
        id: `browser-tab-${Date.now()}`,
        filePath: '__browser__',
        fileName: 'Browser',
        content: '',
        originalContent: '',
        isDirty: false,
        language: 'plaintext',
        isBrowser: true,
        browserUrl: url,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },

    closeBrowserTab: () => {
      const browserTab = tabsRef.current.find(t => t.isBrowser);
      if (browserTab) {
        closeTab(browserTab.id);
      }
    },

    triggerEditorAction: (actionId: string) => {
      editorInstanceRef.current?.trigger('keyboard', actionId, null);
    },

    openSettingsTab: () => {
      const existing = tabsRef.current.find(t => t.isSettings);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      const newTab: EditorTab = {
        id: 'settings-tab',
        filePath: '__settings__',
        fileName: 'Settings',
        content: '',
        originalContent: '',
        isDirty: false,
        language: 'plaintext',
        isSettings: true,
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },

    runCurrentFile: () => { runCurrentFileRef.current(); },
  }), [onFileChange, onLanguageChange, closeTab]);

  // Handle content change from Monaco
  const handleContentChange = useCallback((newContent: string) => {
    if (!activeTabId) return;
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? {
        ...t,
        content: newContent,
        isDirty: newContent !== t.originalContent,
      } : t
    ));
  }, [activeTabId]);

  // Hide/show BrowserView when switching tabs
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const hasBrowserTab = tabs.some(t => t.isBrowser);
    if (!hasBrowserTab) {
      // No browser tab exists - hide BrowserView
      api.browserHide?.();
    } else if (activeTab?.isBrowser) {
      // Browser tab is active - BrowserPanel will handle showing it
      // Dispatch layout-resize so it recalculates bounds
      setTimeout(() => window.dispatchEvent(new Event('layout-resize')), 50);
    } else {
      // Browser tab exists but is not active - hide overlay
      api.browserHide?.();
    }
  }, [activeTabId, tabs.length]);

  // Ctrl+S save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTab?.isDirty) {
          const doSave = async () => {
            const api = window.electronAPI;
            if (!api || !activeTab) return;
            const result = await api.writeFile(activeTab.filePath, activeTab.content);
            if (result.success) {
              setTabs(prev => prev.map(t =>
                t.id === activeTab.id ? { ...t, isDirty: false, originalContent: t.content } : t
              ));
            }
          };
          doSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  // Ctrl+\ split editor, Ctrl+I inline chat
  useEffect(() => {
    const handleSplitKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        if (splitTabId) {
          setSplitTabId(null);
        } else if (activeTab) {
          setSplitTabId(activeTab.id);
        }
      }
      // Ctrl+I — Inline Chat
      if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setInlineChatOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleSplitKey);
    return () => window.removeEventListener('keydown', handleSplitKey);
  }, [activeTab, splitTabId]);

  // Listen for AI Code Action results (from MonacoEditor context menu)
  useEffect(() => {
    const handleCodeAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;

      if (detail.isCodeChange && detail.filePath) {
        // Code modification — apply as a pending change in diff view
        const tab = tabsRef.current.find(t => t.filePath === detail.filePath);
        if (tab) {
          // For selection-based changes, replace only the selected text in the full content
          const newContent = detail.selectedText
            ? tab.content.replace(detail.selectedText, detail.result)
            : detail.result;
          setTabs(prev => prev.map(t =>
            t.id === tab.id ? {
              ...t,
              pendingChange: {
                originalContent: t.content,
                newContent,
                description: `AI ${detail.action}`,
              },
            } : t
          ));
          setActiveTabId(tab.id);
          setDiffTabId(tab.id);
          setShowDiffBar(true);
        }
      } else {
        // Explanation or non-file result — dispatch to chat panel
        window.dispatchEvent(new CustomEvent('ai-message', {
          detail: {
            role: 'assistant',
            content: `**AI ${detail.action}:**\n\n${detail.result}`,
          },
        }));
      }
    };

    window.addEventListener('code-action-result', handleCodeAction);
    return () => window.removeEventListener('code-action-result', handleCodeAction);
  }, []);

  // Listen for agent file modifications — show green/red diff highlighting
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onAgentFileModified) return;

    const handler = (_event: any, data: { filePath: string; newContent: string; originalContent?: string; isNew: boolean; tool: string }) => {
      const tab = tabsRef.current.find(t => t.filePath === data.filePath);
      if (tab) {
        // File is currently open — show diff view with green/red highlighting
        const origContent = data.originalContent || tab.content;
        setTabs(prev => prev.map(t =>
          t.id === tab.id ? {
            ...t,
            pendingChange: {
              originalContent: origContent,
              newContent: data.newContent,
              description: `Agent ${data.tool}: ${t.fileName}`,
            },
          } : t
        ));
        setActiveTabId(tab.id);
        setDiffTabId(tab.id);
        setShowDiffBar(true);
      }
    };

    api.onAgentFileModified(handler);
  }, []);

  // Run file function — used by Run button and F5
  const runCurrentFile = useCallback(async () => {
    if (!activeTab) return;
    const fp = activeTab.filePath;

    // HTML files → toggle preview
    if (isHtmlFile(fp)) {
      toggleHtmlPreview(activeTab.id);
      return;
    }

    // Data/preview files → toggle preview instead of running
    if (isDataPreviewable(fp) || isMarkdownFile(fp) || isSvgFile(fp)) {
      toggleHtmlPreview(activeTab.id);
      return;
    }

    // Save file first if dirty
    if (activeTab.isDirty) {
      const api = window.electronAPI;
      if (api) {
        await api.writeFile(fp, activeTab.content);
        setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, isDirty: false, originalContent: t.content } : t));
      }
    }

    const cmd = getRunCommand(fp);
    if (!cmd) return;

    // Show terminal panel
    window.dispatchEvent(new CustomEvent('show-terminal'));

    // Create a new terminal and run the command
    try {
      const api = window.electronAPI;
      if (!api?.terminalCreate) return;
      const dir = fp.replace(/[/\\][^/\\]+$/, '');
      const result = await api.terminalCreate({ cwd: dir });
      // Small delay for terminal init, then write command
      setTimeout(async () => {
        await api.terminalWrite(result.id, cmd + '\r');
      }, 300);
      // Dispatch event so TerminalPanel picks up the new terminal
      window.dispatchEvent(new CustomEvent('terminal-created', { detail: result }));
    } catch (e) {
      console.error('Failed to run file:', e);
    }
  }, [activeTab, toggleHtmlPreview]);
  // Keep ref in sync so useImperativeHandle can access the latest runCurrentFile
  runCurrentFileRef.current = runCurrentFile;

  // F5 to run file
  useEffect(() => {
    const handleF5 = (e: KeyboardEvent) => {
      if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (activeTab && isRunnableFile(activeTab.filePath)) {
          e.preventDefault();
          runCurrentFile();
        }
      }
    };
    window.addEventListener('keydown', handleF5);
    return () => window.removeEventListener('keydown', handleF5);
  }, [activeTab, runCurrentFile]);

  const splitTab = splitTabId ? tabs.find(t => t.id === splitTabId) : null;

  // Handle content change from split editor
  const handleSplitContentChange = useCallback((newContent: string) => {
    if (!splitTabId) return;
    setTabs(prev => prev.map(t =>
      t.id === splitTabId ? {
        ...t,
        content: newContent,
        isDirty: newContent !== t.originalContent,
      } : t
    ));
  }, [splitTabId]);

  // Accept AI change
  const acceptChange = () => {
    if (!diffTabId) return;
    setTabs(prev => prev.map(t => {
      if (t.id === diffTabId && t.pendingChange) {
        return {
          ...t,
          content: t.pendingChange.newContent,
          isDirty: true,
          pendingChange: undefined,
        };
      }
      return t;
    }));
    setShowDiffBar(false);
    setDiffTabId(null);
  };

  // Reject AI change
  const rejectChange = () => {
    if (!diffTabId) return;
    setTabs(prev => prev.map(t =>
      t.id === diffTabId ? { ...t, pendingChange: undefined } : t
    ));
    setShowDiffBar(false);
    setDiffTabId(null);
  };

  return (
    <div className={`flex flex-col bg-[#1e1e1e] ${className}`}>
      {/* Tab Bar */}
      {tabs.length > 0 && (
        <div className="h-[30px] bg-[#252526] flex items-center flex-shrink-0">
          {/* Scrollable tabs area */}
          <div className="flex-1 min-w-0 flex items-center overflow-x-auto overflow-y-hidden scrollbar-thin h-full">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`flex items-center gap-1.5 px-3 h-[30px] cursor-pointer border-r border-[#252526] flex-shrink-0 group text-[12px] ${
                  tab.id === activeTabId
                    ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]'
                    : 'bg-[#2d2d2d] text-[#969696] hover:bg-[#2d2d2d]/80 border-t-2 border-t-transparent'
                }`}
                style={{ maxWidth: '180px' }}
                onClick={() => {
                  setActiveTabId(tab.id);
                  onFileChange?.(tab.filePath);
                  onLanguageChange?.(tab.language);
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) { e.preventDefault(); closeTab(tab.id); }
                }}
                title={tab.filePath}
              >
                <span className="text-[13px] flex-shrink-0">{tab.isSettings ? <Settings2 size={13} className="text-[#007acc]" /> : tab.isBrowser ? <Globe size={13} className="text-[#007acc]" /> : getFileIcon(tab.fileName)}</span>
                <span className="truncate text-[12px]">{tab.fileName}</span>
                {tab.isDirty && (
                  <Circle size={8} fill="currentColor" className="text-[#c5c5c5] flex-shrink-0" />
                )}
                {isPreviewableFile(tab.filePath) && (
                  <button
                    className={`flex-shrink-0 rounded p-0.5 transition-all ${
                      isTabPreviewing(tab.id)
                        ? 'text-[#007acc] opacity-100 bg-[#007acc20]'
                        : 'text-[#858585] opacity-0 group-hover:opacity-100 hover:text-[#007acc] hover:bg-[#3c3c3c]'
                    }`}
                    onClick={(e) => { e.stopPropagation(); toggleHtmlPreview(tab.id); }}
                    title={isTabPreviewing(tab.id) ? 'Show code' : getPreviewLabel(tab.filePath)}
                  >
                    {isTabPreviewing(tab.id) ? <Code2 size={12} /> : (isMarkdownFile(tab.filePath) || isDataPreviewable(tab.filePath)) ? <Eye size={12} /> : <Play size={12} />}
                  </button>
                )}
                <button
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 hover:bg-[#3c3c3c] rounded p-0.5 transition-opacity ml-1"
                  onClick={(e) => closeTab(tab.id, e)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Fixed Actions — never overflow */}
          <div className="flex items-center px-2 gap-1 flex-shrink-0 border-l border-[#3c3c3c] h-full bg-[#252526]">
            {/* Tab overflow menu */}
            <div className="relative" ref={tabMenuRef}>
              <button
                className={`p-1 rounded hover:bg-[#3c3c3c] transition-colors ${tabMenuOpen ? 'text-white bg-[#3c3c3c]' : 'text-[#858585] hover:text-white'}`}
                onClick={() => setTabMenuOpen(v => !v)}
                title="Tab actions"
              >
                <MoreHorizontal size={14} />
              </button>
              {tabMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-[#252526]/85 glass border border-[#3c3c3c]/60 rounded shadow-xl z-50 min-w-[180px] py-1 text-[12px]">
                  <button className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#094771] hover:text-white" onClick={closeAllTabs}>Close All Tabs</button>
                  <button className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#094771] hover:text-white" onClick={closeOtherTabs} disabled={!activeTabId}>Close Other Tabs</button>
                  <button className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#094771] hover:text-white" onClick={closeSavedTabs}>Close Saved Tabs</button>
                  <button className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#094771] hover:text-white" onClick={closeTabsToRight} disabled={!activeTabId}>Close Tabs to the Right</button>
                  <div className="border-t border-[#3c3c3c] my-1" />
                  <button className="w-full text-left px-3 py-1.5 text-[#cccccc] hover:bg-[#094771] hover:text-white" onClick={() => { if (activeTab) { navigator.clipboard.writeText(activeTab.filePath); } setTabMenuOpen(false); }}>Copy Path</button>
                </div>
              )}
            </div>
            {activeTab && isRunnableFile(activeTab.filePath) && (
              <button
                className="p-1 text-[#89d185] hover:text-[#6ae052] rounded hover:bg-[#3c3c3c] transition-colors"
                onClick={runCurrentFile}
                title={`Run ${activeTab.fileName} (F5)`}
              >
                <Play size={14} />
              </button>
            )}
            {activeTab && isHtmlFile(activeTab.filePath) && !activeTab.isBrowser && (
              <button
                className={`p-1 rounded hover:bg-[#3c3c3c] transition-colors flex items-center gap-1 text-[12px] font-medium ${
                  liveServerPort !== null ? 'text-[#4ec9b0]' : 'text-[#858585] hover:text-white'
                }`}
                onClick={toggleLiveServer}
                title={liveServerPort !== null ? `Live Server :${liveServerPort} (click to stop)` : 'Go Live'}
              >
                <Wifi size={13} />
                {liveServerPort !== null ? <span>:{liveServerPort}</span> : <span>Go Live</span>}
              </button>
            )}
            <button
              className={`p-1 rounded hover:bg-[#3c3c3c] transition-colors ${splitTabId ? 'text-[#007acc]' : 'text-[#858585] hover:text-white'}`}
              onClick={() => {
                if (splitTabId) setSplitTabId(null);
                else if (activeTab) setSplitTabId(activeTab.id);
              }}
              title={splitTabId ? 'Close Split (Ctrl+\\)' : 'Split Editor Right (Ctrl+\\)'}
            >
              <Columns size={14} />
            </button>
            <button
              className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
              onClick={() => setSearchOpen(v => !v)}
              title="Search (Ctrl+F)"
            >
              <Search size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Search bar */}
      {searchOpen && activeTab && (
        <SearchReplace onClose={() => setSearchOpen(false)} />
      )}

      {/* AI Diff acceptance bar */}
      {showDiffBar && diffTabId && (
        <div className="h-[38px] bg-gradient-to-r from-[#1a3a1a] via-[#2d2d2d] to-[#3a1a1a] border-b border-[#007acc] flex items-center px-4 gap-3 flex-shrink-0">
          <span className="text-[12px] text-[#dcdcaa] font-medium">
            {tabs.find(t => t.id === diffTabId)?.pendingChange?.description || 'AI suggested changes'} — review changes below
          </span>
          <div className="flex-1" />
          <button
            className="flex items-center gap-1 bg-[#2ea043] text-white text-[12px] px-3 py-1.5 rounded hover:bg-[#3fb950] font-medium"
            onClick={acceptChange}
          >
            <Check size={12} /> Accept
          </button>
          <button
            className="flex items-center gap-1 bg-[#da3633] text-white text-[12px] px-3 py-1.5 rounded hover:bg-[#f85149] font-medium"
            onClick={rejectChange}
          >
            <Undo2 size={12} /> Reject
          </button>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Main Editor Pane */}
        <div className={`flex-1 min-h-0 ${splitTabId ? 'border-r border-[#333]' : ''}`}>
          {activeTab ? (
            activeTab.isSettings ? (
              <div className="flex-1 h-full overflow-auto" style={{ backgroundColor: 'var(--theme-sidebar)' }}>
                <AdvancedSettingsPanel />
              </div>
            ) : activeTab.isBrowser ? (
              <BrowserPanel
                key="browser-tab-panel"
                onClose={() => closeTab(activeTab.id)}
                initialUrl={activeTab.browserUrl}
              />
            ) : activeTab.isImage ? (
              <ImagePreview filePath={activeTab.filePath} />
            ) : activeTab.isBinary ? (
              <BinaryPreview filePath={activeTab.filePath} fileName={activeTab.fileName} />
            ) : isTabPreviewing(activeTab.id) && isHtmlFile(activeTab.filePath) ? (
              <HtmlPreview
                content={activeTab.content}
                filePath={activeTab.filePath}
                onToggleCode={() => toggleHtmlPreview(activeTab.id)}
              />
            ) : isTabPreviewing(activeTab.id) && isMarkdownFile(activeTab.filePath) ? (
              <MarkdownPreview
                content={activeTab.content}
                filePath={activeTab.filePath}
                onToggleCode={() => toggleHtmlPreview(activeTab.id)}
              />
            ) : isTabPreviewing(activeTab.id) && isSvgFile(activeTab.filePath) ? (
              <SvgPreview
                content={activeTab.content}
                filePath={activeTab.filePath}
                onToggleCode={() => toggleHtmlPreview(activeTab.id)}
              />
            ) : isTabPreviewing(activeTab.id) && isJsonFile(activeTab.filePath) ? (
              <JsonPreview
                content={activeTab.content}
                filePath={activeTab.filePath}
                onToggleCode={() => toggleHtmlPreview(activeTab.id)}
              />
            ) : isTabPreviewing(activeTab.id) && isCsvFile(activeTab.filePath) ? (
              <CsvPreview
                content={activeTab.content}
                filePath={activeTab.filePath}
                onToggleCode={() => toggleHtmlPreview(activeTab.id)}
              />
            ) : isTabPreviewing(activeTab.id) && isDataPreviewable(activeTab.filePath) ? (
              <DataPreview
                content={activeTab.content}
                filePath={activeTab.filePath}
                onToggleCode={() => toggleHtmlPreview(activeTab.id)}
              />
            ) : activeTab.pendingChange ? (
              <DiffViewer
                key={`diff-${activeTab.id}`}
                originalContent={activeTab.pendingChange.originalContent}
                modifiedContent={activeTab.pendingChange.newContent}
                language={activeTab.language}
                filePath={activeTab.filePath}
                onAccept={acceptChange}
                onReject={rejectChange}
              />
            ) : (
              <>
                <MonacoEditor
                  key={activeTab.id}
                  content={activeTab.content}
                  language={activeTab.language}
                  filePath={activeTab.filePath}
                  onChange={handleContentChange}
                  onCursorChange={onCursorChange}
                  onSelectionChange={onSelectionChange}
                  onEditorMount={(editor: any) => { editorInstanceRef.current = editor; }}
                  onMarkersChange={onMarkersChange}
                />

                {/* Inline Chat (Ctrl+I) overlay */}
                {inlineChatOpen && activeTab && editorInstanceRef.current && (
                  <InlineChat
                    editor={editorInstanceRef.current}
                    filePath={activeTab.filePath}
                    onClose={() => setInlineChatOpen(false)}
                  />
                )}
              </>
            )
          ) : (
            <WelcomeScreen />
          )}
        </div>

        {/* Split Editor Pane */}
        {splitTabId && splitTab && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Split pane mini tab bar */}
            <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-2 gap-1 flex-shrink-0">
              <select
                className="bg-[#3c3c3c] text-[#cccccc] text-[11px] rounded px-1.5 py-0.5 border border-[#555] outline-none cursor-pointer max-w-[200px] truncate"
                value={splitTabId}
                onChange={(e) => setSplitTabId(e.target.value)}
              >
                {tabs.filter(t => !t.isImage && !t.isBinary).map(t => (
                  <option key={t.id} value={t.id}>{t.fileName}</option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                className="p-0.5 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
                onClick={() => setSplitTabId(null)}
                title="Close split"
              >
                <X size={12} />
              </button>
            </div>
            {/* Split editor content */}
            <div className="flex-1 min-h-0">
              {isTabPreviewing(splitTab.id) && isHtmlFile(splitTab.filePath) ? (
                <HtmlPreview
                  content={splitTab.content}
                  filePath={splitTab.filePath}
                  onToggleCode={() => toggleHtmlPreview(splitTab.id)}
                />
              ) : isTabPreviewing(splitTab.id) && isMarkdownFile(splitTab.filePath) ? (
                <MarkdownPreview
                  content={splitTab.content}
                  filePath={splitTab.filePath}
                  onToggleCode={() => toggleHtmlPreview(splitTab.id)}
                />
              ) : isTabPreviewing(splitTab.id) && isSvgFile(splitTab.filePath) ? (
                <SvgPreview
                  content={splitTab.content}
                  filePath={splitTab.filePath}
                  onToggleCode={() => toggleHtmlPreview(splitTab.id)}
                />
              ) : isTabPreviewing(splitTab.id) && isJsonFile(splitTab.filePath) ? (
                <JsonPreview
                  content={splitTab.content}
                  filePath={splitTab.filePath}
                  onToggleCode={() => toggleHtmlPreview(splitTab.id)}
                />
              ) : isTabPreviewing(splitTab.id) && isCsvFile(splitTab.filePath) ? (
                <CsvPreview
                  content={splitTab.content}
                  filePath={splitTab.filePath}
                  onToggleCode={() => toggleHtmlPreview(splitTab.id)}
                />
              ) : isTabPreviewing(splitTab.id) && isDataPreviewable(splitTab.filePath) ? (
                <DataPreview
                  content={splitTab.content}
                  filePath={splitTab.filePath}
                  onToggleCode={() => toggleHtmlPreview(splitTab.id)}
                />
              ) : (
                <MonacoEditor
                  key={`split-${splitTab.id}`}
                  content={splitTab.content}
                  language={splitTab.language}
                  filePath={splitTab.filePath}
                  onChange={handleSplitContentChange}
                  onCursorChange={onCursorChange}
                  onSelectionChange={onSelectionChange}
                  onEditorMount={(editor: any) => { splitEditorRef.current = editor; }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status mini-bar for active tab */}
      {activeTab && !activeTab.isBrowser && (
        <div className="h-[22px] bg-[#252526] flex items-center px-3 text-[11px] text-[#858585] border-t border-[#1e1e1e] flex-shrink-0 gap-3">
          <span>{activeTab.filePath || 'Untitled'}</span>
          <span className="ml-auto capitalize">{activeTab.language}</span>
          <span>UTF-8</span>
          {activeTab.isDirty && <span className="text-[#dcdcaa]">● Modified</span>}
        </div>
      )}
    </div>
  );
});

Editor.displayName = 'Editor';
