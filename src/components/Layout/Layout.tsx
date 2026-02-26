import React, { useState, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import {
  Files, Search, GitBranch, Bug, MessageSquare, Settings, Globe, Palette, Server, BarChart3, UserCircle, Database, Shield, Activity, Compass, FileText, Monitor, Puzzle, Users, BookOpen, MoreHorizontal, ListTodo, Webhook, PanelLeft, PanelBottom, PanelRight,
} from 'lucide-react';
import { FileExplorer } from '../FileExplorer/FileExplorer';
import { Editor, EditorHandle } from '../Editor/Editor';
import { ChatPanel } from '../Chat/ChatPanel';
import { TerminalPanel } from '../Terminal/TerminalPanel';
import { GlobalSearch } from '../Search/GlobalSearch';
import { SourceControlPanel } from '../SourceControl/SourceControlPanel';
import { DebugPanel } from '../Debug/DebugPanel';
import { MCPServerPanel } from '../Settings/MCPServerPanel';
import { AdvancedSettingsPanel } from '../Settings/AdvancedSettingsPanel';
import { AccountPanel } from '../Account/AccountPanel';
import { NewProjectDialog } from '../Templates/NewProjectDialog';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { MenuBar } from './MenuBar';
import { ToastContainer, toast } from './Toast';
import { WelcomeGuide } from './WelcomeGuide';
import { TodoTreePanel } from '../Sidebar/TodoTreePanel';
import { RestClientPanel } from '../RestClient/RestClientPanel';
import { useTheme, themes } from './ThemeProvider';
import type { FileNode } from '@/types/file';
import type { LLMStatusEvent, AvailableModel } from '@/types/electron';

// Lazy-loaded panels — only loaded when the user opens them (code-split chunks)
const BenchmarkPanel = lazy(() => import('../Benchmark/BenchmarkPanel').then(m => ({ default: m.BenchmarkPanel })));
const DatabasePanel = lazy(() => import('../Database/DatabasePanel').then(m => ({ default: m.DatabasePanel })));
const CodeReviewPanel = lazy(() => import('../CodeReview/CodeReviewPanel').then(m => ({ default: m.CodeReviewPanel })));
const ProfilerPanel = lazy(() => import('../Profiler/ProfilerPanel').then(m => ({ default: m.ProfilerPanel })));
const SmartSearchPanel = lazy(() => import('../SmartSearch/SmartSearchPanel').then(m => ({ default: m.SmartSearchPanel })));
const DocsPanel = lazy(() => import('../Docs/DocsPanel').then(m => ({ default: m.DocsPanel })));
const SSHPanel = lazy(() => import('../SSH/SSHPanel').then(m => ({ default: m.SSHPanel })));
const PluginPanel = lazy(() => import('../Plugins/PluginPanel').then(m => ({ default: m.PluginPanel })));
const CollabPanel = lazy(() => import('../Collab/CollabPanel').then(m => ({ default: m.CollabPanel })));
const NotebookPanel = lazy(() => import('../Notebook/NotebookPanel').then(m => ({ default: m.NotebookPanel })));

// Suspense fallback for lazy panels
const PanelLoader = () => (
  <div className="flex items-center justify-center h-32 text-[12px]" style={{ color: 'var(--theme-foreground-muted)' }}>
    Loading...
  </div>
);

type SidebarView = 'explorer' | 'search' | 'git' | 'debug' | 'extensions' | 'benchmark' | 'settings' | 'account' | 'database' | 'codereview' | 'profiler' | 'smartsearch' | 'docs' | 'ssh' | 'plugins' | 'collab' | 'notebook' | 'todos' | 'restclient';
// Note: 'benchmark' is the model benchmark view

export const Layout: React.FC = () => {
  const [rootPath, setRootPath] = useState<string>('');
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [chatVisible, setChatVisible] = useState(true);
  const [chatWidth, setChatWidth] = useState(340);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(250);
  const [_editorHasOpenTabs, setEditorHasOpenTabs] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LLMStatusEvent>({ state: 'loading', message: 'Initializing...' });
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [ragStatus, setRagStatus] = useState<{ isIndexing: boolean; progress: number; totalFiles: number }>({ isIndexing: false, progress: 0, totalFiles: 0 });
  const [currentFile, setCurrentFile] = useState<string>('');
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [editorLanguage, setEditorLanguage] = useState('plaintext');
  const [errorCount, setErrorCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [selectedText, setSelectedText] = useState('');
  const [showWelcomeGuide, setShowWelcomeGuide] = useState(() => {
    return localStorage.getItem('guIDE-hideWelcome') !== 'true';
  });
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);

  const editorRef = useRef<EditorHandle>(null);

  // Notify BrowserView to hide/show when overlays are active
  const notifyBrowserOverlay = useCallback((visible: boolean) => {
    window.dispatchEvent(new Event(visible ? 'browser-overlay-show' : 'browser-overlay-hide'));
  }, []);
  const { theme, setThemeById } = useTheme();

  // ── Electron IPC ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const cleanups: ((() => void) | void)[] = [];
    cleanups.push(api.onMenuAction?.((action: string) => {
      switch (action) {
        case 'toggle-explorer': setSidebarView('explorer'); setSidebarVisible(v => !v); break;
        case 'toggle-search': setSidebarView('search'); setSidebarVisible(true); break;
        case 'toggle-terminal': setTerminalVisible(v => !v); break;
        case 'toggle-chat': setChatVisible(v => !v); break;
        case 'toggle-browser': editorRef.current?.openBrowserTab(); break;
        case 'command-palette': setCommandPaletteOpen(true); notifyBrowserOverlay(true); break;
        case 'find-in-files': setSidebarView('search'); setSidebarVisible(true); break;
        case 'save': editorRef.current?.saveFile(); break;
        case 'save-all': editorRef.current?.saveAllFiles(); break;
        case 'find': editorRef.current?.toggleSearch(); break;
        case 'new-file': editorRef.current?.createNewFile(); break;
        case 'new-project': setShowNewProject(true); break;
        case 'new-terminal': setTerminalVisible(true); break;
      }
    }));
    cleanups.push(api.onOpenFolder?.((folderPath: string) => setRootPath(folderPath)));
    cleanups.push(api.onOpenFile?.((filePath: string) => { editorRef.current?.openFile(filePath); }));
    cleanups.push(api.onFolderOpened?.((_: any, folderPath: string) => setRootPath(folderPath)));
    cleanups.push(api.onMenuOpenProject?.((_: any, folderPath: string) => setRootPath(folderPath)));
    cleanups.push(api.onLlmStatus?.((status: LLMStatusEvent) => setLlmStatus(status)));
    cleanups.push(api.onModelsAvailable?.((models: AvailableModel[]) => setAvailableModels(models)));
    cleanups.push(api.onRagProgress?.((data: { progress: number; done: number; total: number }) => {
      setRagStatus({ isIndexing: true, progress: data.progress, totalFiles: data.total });
      if (data.progress >= 100) {
        setTimeout(() => setRagStatus(s => ({ ...s, isIndexing: false })), 1000);
        toast(`Codebase indexed — ${data.total} file${data.total !== 1 ? 's' : ''}`, 'success');
      }
    }));
    // Listen for AI-triggered browser open — open as editor tab
    // Also force a delayed show to handle timing races where BrowserPanel hasn't mounted yet
    cleanups.push(api.onShowBrowser?.((data: { url: string }) => {
      editorRef.current?.openBrowserTab(data?.url);
      // Delayed fallback: after BrowserPanel should have mounted, dispatch layout-resize
      // to force bounds recalculation and show the BrowserView on-screen
      setTimeout(() => window.dispatchEvent(new Event('layout-resize')), 200);
      setTimeout(() => window.dispatchEvent(new Event('layout-resize')), 500);
    }));

    // Listen for code runner requesting terminal
    const handleShowTerminal = () => setTerminalVisible(true);
    window.addEventListener('show-terminal', handleShowTerminal);

    // Listen for app-action custom events (e.g. from WelcomeScreen)
    const handleAppAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const action = typeof detail === 'string' ? detail : detail?.action;
      if (action === 'new-project') setShowNewProject(true);
      if (action === 'open-recent' && detail?.path) setRootPath(detail.path);
    };
    window.addEventListener('app-action', handleAppAction);

    return () => {
      window.removeEventListener('show-terminal', handleShowTerminal);
      window.removeEventListener('app-action', handleAppAction);
      cleanups.forEach(fn => fn?.());
    };
  }, []);

  // Auto-index project
  useEffect(() => {
    if (rootPath && window.electronAPI?.ragIndexProject) {
      window.electronAPI.ragIndexProject(rootPath).catch(() => {});
    }
  }, [rootPath]);

  // Save recent folders to localStorage whenever rootPath changes
  useEffect(() => {
    if (!rootPath) return;
    try {
      const MAX_RECENT = 5;
      const existing = JSON.parse(localStorage.getItem('recent-folders') || '[]') as string[];
      const updated = [rootPath, ...existing.filter((p: string) => p !== rootPath)].slice(0, MAX_RECENT);
      localStorage.setItem('recent-folders', JSON.stringify(updated));
      // Update the native app menu's Open Recent submenu
      window.electronAPI?.updateRecentFolders?.(updated);
    } catch { /* ignore */ }
  }, [rootPath]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setCommandPaletteOpen(true); notifyBrowserOverlay(true); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); setSidebarView('explorer'); setSidebarVisible(v => !v); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setSidebarView('search'); setSidebarVisible(true); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setSidebarView('debug'); setSidebarVisible(true); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); setSidebarView('git'); setSidebarVisible(true); }
      else if (ctrl && e.key === '`') { e.preventDefault(); setTerminalVisible(v => !v); }
      else if (ctrl && e.key === 'b') { e.preventDefault(); setSidebarVisible(v => !v); }
      else if (ctrl && e.key === 'l') { e.preventDefault(); setChatVisible(v => !v); }
      else if (ctrl && e.key === 'j') { e.preventDefault(); setTerminalVisible(v => !v); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // When WelcomeGuide is visible, hide the native BrowserView so it doesn't overlay the modal
  useEffect(() => {
    notifyBrowserOverlay(showWelcomeGuide);
  }, [showWelcomeGuide, notifyBrowserOverlay]);

  const handleFileSelect = useCallback(async (file: FileNode) => {
    if (file.type === 'file' && editorRef.current) {
      await editorRef.current.openFile(file.path);
      setCurrentFile(file.path);
    }
  }, []);

  const handleSearchResultClick = useCallback((filePath: string, line: number) => {
    editorRef.current?.openFile(filePath, line);
    setCurrentFile(filePath);
  }, []);

  const startResize = useCallback((type: 'sidebar' | 'chat' | 'terminal') => {
    // Minimum center panel width — enforced on both sidebar and chat drags.
    // 360px = narrowest mobile viewport (iPhone SE). Browser becomes unusable below this.
    const MIN_CENTER_WIDTH = 360;
    // Hide browser during resize to prevent distortion
    window.electronAPI?.browserHide?.();
    let rafId: number | null = null;
    const onMouseMove = (e: MouseEvent) => {
      if (rafId) return; // Throttle to 1 update per animation frame (~60fps)
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (type === 'sidebar') {
          // Cap sidebar so center panel always keeps MIN_CENTER_WIDTH
          // 48px activity bar + 4px handle + chatWidth + 4px handle = right-side overhead
          const maxSidebar = window.innerWidth - 48 - 8 - chatWidth - MIN_CENTER_WIDTH;
          setSidebarWidth(Math.max(180, Math.min(500, maxSidebar, e.clientX - 48)));
        } else if (type === 'chat') {
          // Cap chat so the center panel always keeps MIN_CENTER_WIDTH
          // 48px activity bar + sidebarWidth + 8px handles
          const maxChatBySpace = Math.max(280, window.innerWidth - 48 - sidebarWidth - 8 - MIN_CENTER_WIDTH);
          setChatWidth(Math.max(280, Math.min(600, maxChatBySpace, window.innerWidth - e.clientX)));
        }
        else if (type === 'terminal') setTerminalHeight(Math.max(100, Math.min(600, window.innerHeight - e.clientY - 24)));
        // Notify BrowserPanel to recalculate native overlay bounds during any panel resize
        window.dispatchEvent(new Event('layout-resize'));
      });
    };
    const onMouseUp = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Final bounds update + restore browser after drag ends
      window.dispatchEvent(new Event('layout-resize'));
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = type === 'terminal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatWidth, sidebarWidth]);

  const handleOpenFolderDialog = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const result = await api.showOpenDialog({ properties: ['openDirectory'], title: 'Open Folder' });
    if (!result.canceled && result.filePaths?.[0]) {
      setRootPath(result.filePaths[0]);
      api.ragIndexProject?.(result.filePaths[0]).catch(() => {});
    }
  }, []);

  const handleMenuAction = useCallback((action: string) => {
    switch (action) {
      case 'new-file': editorRef.current?.createNewFile(); break;
      case 'new-project': setShowNewProject(true); break;
      case 'open-file-dialog':
        window.electronAPI?.showOpenDialog({ properties: ['openFile'], title: 'Open File' }).then((result: any) => {
          if (!result.canceled && result.filePaths?.[0]) editorRef.current?.openFile(result.filePaths[0]);
        }).catch(() => {});
        break;
      case 'open-folder-dialog': handleOpenFolderDialog(); break;
      case 'save': editorRef.current?.saveFile(); break;
      case 'save-all': editorRef.current?.saveAllFiles(); break;
      case 'revert-file':
        if (currentFile) {
          editorRef.current?.openFile(currentFile).catch(() => {});
        }
        break;
      case 'reveal-in-explorer':
        if (currentFile) window.electronAPI?.revealInExplorer?.(currentFile);
        break;
      case 'open-containing-folder':
        if (rootPath) window.electronAPI?.openContainingFolder?.(rootPath);
        break;
      case 'exit': window.close(); break;
      case 'find': editorRef.current?.toggleSearch(); break;
      case 'find-in-files': setSidebarView('search'); setSidebarVisible(true); break;
      case 'command-palette': setCommandPaletteOpen(true); notifyBrowserOverlay(true); break;
      case 'toggle-explorer': setSidebarView('explorer'); setSidebarVisible(v => !v); break;
      case 'toggle-search': setSidebarView('search'); setSidebarVisible(true); break;
      case 'toggle-git': setSidebarView('git'); setSidebarVisible(true); break;
      case 'toggle-terminal': setTerminalVisible(v => !v); break;
      case 'toggle-chat': setChatVisible(v => !v); break;
      case 'toggle-browser': editorRef.current?.openBrowserTab(); break;
      case 'toggle-fullscreen':
        window.electronAPI?.getSystemInfo?.().then(() => {
          document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        }).catch(() => {});
        break;
      case 'new-terminal': setTerminalVisible(true); break;
      case 'about':
        window.electronAPI?.showMessageBox({
          type: 'info', title: 'About guIDE',
          message: 'guIDE v2.0.0 — AI-Powered Offline IDE',
          detail: 'Copyright © 2025-2026 Brendan Gray\nGitHub: github.com/FileShot\n\nLocal LLM • RAG • MCP Tools • Browser Automation\nWeb Search • Git • Memory Context • Cloud APIs\n\nYour code, your models, your machine.\nNo cloud required.\n\nThis software is source-available. Redistribution,\nrebranding, or resale is prohibited without written\npermission from the author.',
        });
        break;
      case 'welcome-guide': setShowWelcomeGuide(true); notifyBrowserOverlay(true); break;
      case 'toggle-devtools': break; // handled by Electron
    }
  }, [handleOpenFolderDialog]);

  // Primary sidebar items — always visible at top of activity bar
  const primaryBarItems = [
    { id: 'explorer' as SidebarView, icon: Files, label: 'Explorer', shortcut: 'Ctrl+Shift+E' },
    { id: 'search' as SidebarView, icon: Search, label: 'Search', shortcut: 'Ctrl+Shift+F' },
    { id: 'git' as SidebarView, icon: GitBranch, label: 'Source Control', shortcut: 'Ctrl+Shift+G' },
    { id: 'debug' as SidebarView, icon: Bug, label: 'Debug', shortcut: 'Ctrl+Shift+D' },
    { id: 'extensions' as SidebarView, icon: Server, label: 'MCP Servers', shortcut: 'Ctrl+Shift+X' },
    { id: 'database' as SidebarView, icon: Database, label: 'Database', shortcut: 'Ctrl+Shift+B' },
  ];

  // Secondary tools — accessible via "More Tools" popover
  const moreToolsItems = [
    { id: 'codereview' as SidebarView, icon: Shield, label: 'Code Review' },
    { id: 'profiler' as SidebarView, icon: Activity, label: 'Profiler' },
    { id: 'smartsearch' as SidebarView, icon: Compass, label: 'Smart Search' },
    { id: 'docs' as SidebarView, icon: FileText, label: 'Docs Generator' },
    { id: 'ssh' as SidebarView, icon: Monitor, label: 'SSH Remote' },
    { id: 'plugins' as SidebarView, icon: Puzzle, label: 'Extensions' },
    { id: 'collab' as SidebarView, icon: Users, label: 'Live Share' },
    { id: 'notebook' as SidebarView, icon: BookOpen, label: 'Notebook' },
    { id: 'todos' as SidebarView, icon: ListTodo, label: 'TODO Tree' },
    { id: 'restclient' as SidebarView, icon: Webhook, label: 'REST Client' },
  ];

  // Check if current sidebar view is from "more tools" (to highlight the more button)
  const isMoreToolActive = moreToolsItems.some(item => item.id === sidebarView && sidebarVisible);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-foreground)' }}>
      {/* Title Bar with Menu */}
      <div className="h-[40px] flex items-center select-none flex-shrink-0 relative z-50 pt-[2px]"
           style={{ backgroundColor: 'var(--theme-title-bar)', WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center text-[12px]" style={{ color: 'var(--theme-foreground)', opacity: 0.8, WebkitAppRegion: 'no-drag' } as any}>
          <span className="px-2 flex items-center" title="guIDE by Brendan Gray">
            <img src="zzz.png" alt="guIDE" className="w-5 h-5" style={{ filter: 'brightness(1.2)' }} />
          </span>
          <MenuBar onAction={handleMenuAction} />
        </div>
        <div className="flex-1" />
        {/* VS Code–style layout toggle buttons */}
        <div className="flex items-center gap-0.5 mr-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            className="w-[28px] h-[28px] flex items-center justify-center rounded hover:bg-[#ffffff15] transition-colors"
            style={{ color: sidebarVisible ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)' }}
            onClick={() => setSidebarVisible(v => !v)}
            title="Toggle Primary Sidebar (Ctrl+B)"
          >
            <PanelLeft size={14} />
          </button>
          <button
            className="w-[28px] h-[28px] flex items-center justify-center rounded hover:bg-[#ffffff15] transition-colors"
            style={{ color: terminalVisible ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)' }}
            onClick={() => setTerminalVisible(v => !v)}
            title="Toggle Panel (Ctrl+J)"
          >
            <PanelBottom size={14} />
          </button>
          <button
            className="w-[28px] h-[28px] flex items-center justify-center rounded hover:bg-[#ffffff15] transition-colors"
            style={{ color: chatVisible ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)' }}
            onClick={() => setChatVisible(v => !v)}
            title="Toggle Secondary Sidebar (Ctrl+L)"
          >
            <PanelRight size={14} />
          </button>
        </div>
        {currentFile && <span className="text-[12px] mr-2 truncate max-w-[150px] flex-shrink" style={{ color: 'var(--theme-foreground)', opacity: 0.4 }}>{currentFile.split(/[/\\]/).pop()}</span>}
        <span className="text-[10px] mr-[140px] select-none brand-font flex-shrink-0" style={{ color: 'var(--theme-foreground)', opacity: 0.2 }} title="guIDE by Brendan Gray">guIDE</span>
      </div>

      {/* Main */}
      <div className="flex flex-1 min-h-0">
        {/* Activity Bar */}
        <div className="w-[48px] flex flex-col items-center py-0 flex-shrink-0" style={{ backgroundColor: 'var(--theme-activity-bar)', borderRight: '1px solid var(--theme-sidebar-border)', overflow: 'visible', position: 'relative', zIndex: 10 }}>
          {/* Primary icons */}
          {primaryBarItems.map(item => (
            <button
              key={item.id}
              className="w-[48px] h-[48px] flex items-center justify-center transition-colors flex-shrink-0"
              style={{
                color: sidebarView === item.id && sidebarVisible ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)',
                backgroundColor: sidebarView === item.id && sidebarVisible ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
                borderRadius: '8px',
              }}
              onClick={() => {
                if (sidebarView === item.id && sidebarVisible) setSidebarVisible(false);
                else { setSidebarView(item.id); setSidebarVisible(true); }
              }}
              title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
              aria-label={item.label}
            >
              <item.icon size={24} />
            </button>
          ))}
          {/* More Tools button */}
          <div className="relative flex-shrink-0">
            <button
              className="w-[48px] h-[48px] flex items-center justify-center transition-colors"
              style={{
                color: isMoreToolActive || moreToolsOpen ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)',
                backgroundColor: isMoreToolActive || moreToolsOpen ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
                borderRadius: '8px',
              }}
              onClick={() => { setMoreToolsOpen(v => !v); notifyBrowserOverlay(true); }}
              title="More Tools"
              aria-label="More Tools"
            >
              <MoreHorizontal size={24} />
            </button>
            {/* More Tools popover */}
            {moreToolsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setMoreToolsOpen(false); notifyBrowserOverlay(false); }} />
                <div className="absolute left-[48px] top-0 z-50 py-1 rounded-r-lg shadow-xl min-w-[180px] glass"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 85%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-border) 60%, transparent)' }}>
                  {moreToolsItems.map(item => (
                    <button
                      key={item.id}
                      className="w-full flex items-center gap-3 px-3 py-2 text-[12px] transition-colors hover:opacity-100"
                      style={{
                        color: sidebarView === item.id && sidebarVisible ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)',
                        backgroundColor: sidebarView === item.id && sidebarVisible ? 'var(--theme-selection)' : 'transparent',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-selection-hover)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = sidebarView === item.id && sidebarVisible ? 'var(--theme-selection)' : 'transparent'; }}
                      onClick={() => {
                        if (sidebarView === item.id && sidebarVisible) setSidebarVisible(false);
                        else { setSidebarView(item.id); setSidebarVisible(true); }
                        setMoreToolsOpen(false);
                        notifyBrowserOverlay(false);
                      }}
                    >
                      <item.icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex-1" />
          <button
            className="w-[48px] h-[48px] flex items-center justify-center transition-colors"
            style={{ color: 'var(--theme-foreground-muted)', borderLeft: '2px solid transparent' }}
            onClick={() => editorRef.current?.openBrowserTab()}
            title="Browser"
            aria-label="Browser"
          >
            <Globe size={24} />
          </button>
          <button
            className="w-[48px] h-[48px] flex items-center justify-center transition-colors"
            style={{
              color: chatVisible ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)',
              backgroundColor: chatVisible ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
              borderRadius: '8px',
            }}
            onClick={() => setChatVisible(v => !v)}
            title="AI Chat"
            aria-label="AI Chat"
          >
            <MessageSquare size={24} />
          </button>
          <button
            className="w-[48px] h-[48px] flex items-center justify-center transition-colors"
            style={{
              color: sidebarView === 'benchmark' && sidebarVisible ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)',
              backgroundColor: sidebarView === 'benchmark' && sidebarVisible ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
              borderRadius: '8px',
            }}
            onClick={() => {
              if (sidebarView === 'benchmark' && sidebarVisible) setSidebarVisible(false);
              else { setSidebarView('benchmark'); setSidebarVisible(true); }
            }}
            title="Model Benchmark"
            aria-label="Model Benchmark"
          >
            <BarChart3 size={22} />
          </button>
          <button
            className="w-[48px] h-[48px] flex items-center justify-center transition-colors"
            style={{ color: showThemePicker ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)', borderLeft: '2px solid transparent' }}
            onClick={() => { setShowThemePicker(v => { const next = !v; notifyBrowserOverlay(next); return next; }); }}
            title="Theme"
            aria-label="Theme"
          >
            <Palette size={22} />
          </button>
          <button
            className="w-[48px] h-[48px] flex items-center justify-center transition-colors relative group"
            style={{
              color: sidebarView === 'account' && sidebarVisible ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)',
              backgroundColor: sidebarView === 'account' && sidebarVisible ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
              borderRadius: '8px',
            }}
            onClick={() => {
              if (sidebarView === 'account' && sidebarVisible) setSidebarVisible(false);
              else { setSidebarView('account'); setSidebarVisible(true); }
            }}
            title="Account &amp; Sign In"
            aria-label="Account &amp; Sign In"
          >
            <div className="relative">
              <UserCircle size={24} />
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-accent)', boxShadow: '0 0 8px var(--theme-accent)' }} />
            </div>
          </button>
          <button
            className="w-[48px] h-[48px] flex items-center justify-center transition-colors"
            style={{
              color: sidebarView === 'settings' && sidebarVisible ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)',
              backgroundColor: sidebarView === 'settings' && sidebarVisible ? 'color-mix(in srgb, var(--theme-accent) 12%, transparent)' : 'transparent',
              borderRadius: '8px',
            }}
            onClick={() => {
              if (sidebarView === 'settings' && sidebarVisible) setSidebarVisible(false);
              else { setSidebarView('settings'); setSidebarVisible(true); }
            }}
            title="Advanced Settings"
            aria-label="Advanced Settings"
          >
            <Settings size={22} />
          </button>
        </div>

        {/* Sidebar — always mounted so panels stay alive; width animates open/close */}
        <div className="flex flex-col flex-shrink-0 overflow-hidden" style={{ width: sidebarVisible ? sidebarWidth : 0, backgroundColor: 'var(--theme-sidebar)', borderRight: sidebarVisible ? '1px solid var(--theme-sidebar-border)' : 'none', transition: 'width 200ms cubic-bezier(0.4,0,0.2,1)' }}>
              <div className="h-[35px] flex items-center px-4 text-[12px] font-medium flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)', borderBottom: '1px solid var(--theme-sidebar-border)' }}>
                {sidebarView === 'explorer' && 'Explorer'}
                {sidebarView === 'search' && 'Search'}
                {sidebarView === 'git' && 'Source Control'}
                {sidebarView === 'debug' && 'Debug'}
                {sidebarView === 'extensions' && 'MCP Servers'}
                {sidebarView === 'benchmark' && 'Model Benchmark'}
                {sidebarView === 'account' && 'Account'}
                {sidebarView === 'settings' && 'Advanced Settings'}
                {sidebarView === 'database' && 'Database'}
                {sidebarView === 'codereview' && 'Code Review'}
                {sidebarView === 'profiler' && 'Performance Profiler'}
                {sidebarView === 'smartsearch' && 'Smart Search'}
                {sidebarView === 'docs' && 'Documentation'}
                {sidebarView === 'ssh' && 'SSH Remote'}
                {sidebarView === 'plugins' && 'Extensions'}
                {sidebarView === 'collab' && 'Live Share'}
                {sidebarView === 'notebook' && 'Notebook'}
                {sidebarView === 'todos' && 'TODO Tree'}
                {sidebarView === 'restclient' && 'REST Client'}
              </div>
              <div className="flex-1 overflow-auto">
                {sidebarView === 'explorer' && <FileExplorer rootPath={rootPath} onFileSelect={handleFileSelect} onOpenFolder={handleOpenFolderDialog} />}
                {sidebarView === 'search' && <GlobalSearch rootPath={rootPath} onResultClick={handleSearchResultClick} />}
                {sidebarView === 'account' && <AccountPanel />}
                {sidebarView === 'git' && (
                  <SourceControlPanel rootPath={rootPath} onFileClick={(filePath) => handleFileSelect({ id: filePath, name: filePath.split(/[\/\\]/).pop() || filePath, path: filePath, type: 'file' })} />
                )}
                {sidebarView === 'debug' && (
                  <div className="flex flex-col h-full">
                    <DebugPanel
                      rootPath={rootPath}
                      currentFile={currentFile}
                      onOpenFile={(filePath, line) => {
                        editorRef.current?.openFile(filePath, line);
                        setCurrentFile(filePath);
                      }}
                      onClose={() => { setSidebarView('explorer'); }}
                    />
                    <div className="border-t border-[#3c3c3c]">
                      <BugFinderPanel rootPath={rootPath} onFileClick={handleSearchResultClick} />
                    </div>
                  </div>
                )}
                {sidebarView === 'extensions' && <MCPServerPanel />}
                {sidebarView === 'settings' && <AdvancedSettingsPanel />}
                {/* Lazy-loaded panels — wrapped in Suspense for code-split loading */}
                <Suspense fallback={<PanelLoader />}>
                  {sidebarView === 'benchmark' && <BenchmarkPanel availableModels={availableModels} llmStatus={llmStatus} />}
                  {sidebarView === 'database' && <DatabasePanel />}
                  {sidebarView === 'codereview' && (
                    <CodeReviewPanel
                      rootPath={rootPath}
                      currentFile={currentFile}
                      onFileClick={(filePath, line) => {
                        editorRef.current?.openFile(filePath, line);
                        setCurrentFile(filePath);
                      }}
                    />
                  )}
                  {sidebarView === 'profiler' && (
                    <ProfilerPanel rootPath={rootPath} currentFile={currentFile} />
                  )}
                  {sidebarView === 'smartsearch' && (
                    <SmartSearchPanel
                      rootPath={rootPath}
                      onFileClick={(filePath, line) => {
                        editorRef.current?.openFile(filePath, line ? line : undefined);
                        setCurrentFile(filePath);
                      }}
                    />
                  )}
                  {sidebarView === 'docs' && (
                    <DocsPanel
                      rootPath={rootPath}
                      currentFile={currentFile}
                      onApplyCode={(filePath, code) => editorRef.current?.applyCodeChange(filePath, code)}
                    />
                  )}
                  {sidebarView === 'ssh' && <SSHPanel />}
                  {sidebarView === 'plugins' && <PluginPanel />}
                  {sidebarView === 'collab' && (
                    <CollabPanel currentFile={currentFile} />
                  )}
                  {sidebarView === 'notebook' && (
                    <NotebookPanel rootPath={rootPath} />
                  )}
                </Suspense>
                {sidebarView === 'todos' && (
                  <TodoTreePanel
                    rootPath={rootPath}
                    onOpenFile={(filePath, line) => {
                      editorRef.current?.openFile(filePath, line);
                      setCurrentFile(filePath);
                    }}
                  />
                )}
                {sidebarView === 'restclient' && <RestClientPanel />}
              </div>
        </div>
        {sidebarVisible && (
          <div className="w-[4px] cursor-col-resize bg-transparent hover:bg-[#007acc] active:bg-[#007acc] transition-colors flex-shrink-0" onMouseDown={() => startResize('sidebar')} />
        )}

        {/* Center: Editor + Terminal */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0">
            <Editor
              ref={editorRef}
              className="h-full"
              onCursorChange={(line: number, col: number) => setCursorPosition({ line, column: col })}
              onLanguageChange={setEditorLanguage}
              onSelectionChange={setSelectedText}
              onFileChange={setCurrentFile}
              onTabsChange={(hasTabs: boolean) => setEditorHasOpenTabs(hasTabs)}
              onMarkersChange={(e: number, w: number) => { setErrorCount(e); setWarningCount(w); }}
            />
          </div>
          {terminalVisible && (
            <>
              <div className="h-[4px] cursor-row-resize bg-transparent hover:bg-[#007acc] active:bg-[#007acc] transition-colors flex-shrink-0" onMouseDown={() => startResize('terminal')} />
              <div className="flex-shrink-0 border-t border-[#252526] overflow-hidden" style={{ height: terminalHeight }}>
                <TerminalPanel cwd={rootPath} onClose={() => setTerminalVisible(false)} />
              </div>
            </>
          )}
        </div>

        {/* Chat Panel */}
        {chatVisible && (
          <>
            <div className="w-[4px] cursor-col-resize bg-transparent hover:bg-[#007acc] active:bg-[#007acc] transition-colors flex-shrink-0" onMouseDown={() => startResize('chat')} />
            <div className="flex-shrink-0 border-l border-[#252526] overflow-hidden" style={{ width: chatWidth }}>
              <ChatPanel
                rootPath={rootPath}
                currentFile={currentFile}
                selectedText={selectedText}
                llmStatus={llmStatus}
                availableModels={availableModels}
                onApplyCode={(filePath: string, code: string) => editorRef.current?.applyCodeChange(filePath, code)}
                onOpenFile={(filePath: string) => { editorRef.current?.openFile(filePath); setCurrentFile(filePath); }}
                onClearCurrentFile={() => setCurrentFile('')}
                onClose={() => setChatVisible(false)}
              />
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        cursorPosition={cursorPosition}
        language={editorLanguage}
        llmStatus={llmStatus}
        ragStatus={ragStatus}
        currentFile={currentFile}
        onToggleTerminal={() => setTerminalVisible(v => !v)}
        onShowProblems={() => {
          setTerminalVisible(true);
          setTimeout(() => window.dispatchEvent(new CustomEvent('guide-show-problems')), 50);
        }}
        onAction={handleMenuAction}
        onChatMessage={(msg: string) => {
          setChatVisible(true);
          window.dispatchEvent(new CustomEvent('voice-chat-message', { detail: { message: msg } }));
        }}
        errorCount={errorCount}
        warningCount={warningCount}
      />

      {/* Toast notifications */}
      <ToastContainer />

      {/* Command Palette */}
      {commandPaletteOpen && (
        <CommandPalette
          rootPath={rootPath}
          onClose={() => { setCommandPaletteOpen(false); notifyBrowserOverlay(false); }}
          onOpenFile={(filePath: string) => { editorRef.current?.openFile(filePath); setCurrentFile(filePath); }}
          onAction={(action: string) => {
            if (action === 'toggle-terminal') setTerminalVisible(v => !v);
            else if (action === 'toggle-sidebar') setSidebarVisible(v => !v);
            else if (action === 'toggle-chat') setChatVisible(v => !v);
            else if (action === 'welcome-guide') setShowWelcomeGuide(true);
            else if (action === 'new-project') setShowNewProject(true);
          }}
        />
      )}

      {/* Welcome Guide */}
      {showWelcomeGuide && (
        <WelcomeGuide
          onClose={() => { setShowWelcomeGuide(false); notifyBrowserOverlay(false); }}
          onDontShowAgain={() => localStorage.setItem('guIDE-hideWelcome', 'true')}
          onAction={(action) => {
            if (action === 'new-project') setShowNewProject(true);
          }}
        />
      )}

      {/* New Project Dialog */}
      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onProjectCreated={(projectDir: string) => {
            setRootPath(projectDir);
            setShowNewProject(false);
          }}
        />
      )}

      {/* Theme Picker */}
      {showThemePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowThemePicker(false); notifyBrowserOverlay(false); }}>
          <div className="rounded-lg shadow-2xl p-4 w-[320px] max-h-[400px] overflow-auto glass" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 85%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-border) 60%, transparent)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--theme-foreground)' }}>Theme</h3>
              <button onClick={() => { setShowThemePicker(false); notifyBrowserOverlay(false); }} className="text-[12px] hover:opacity-80" style={{ color: 'var(--theme-foreground-muted)' }} aria-label="Close theme picker">✕</button>
            </div>
            <div className="space-y-1">
              {themes.map((t) => (
                <button
                  key={t.id}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left"
                  style={{
                    backgroundColor: theme.id === t.id ? 'var(--theme-selection)' : 'transparent',
                    color: 'var(--theme-foreground)',
                  }}
                  onClick={() => { setThemeById(t.id); }}
                  onMouseEnter={(e) => { if (theme.id !== t.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-selection-hover)'; }}
                  onMouseLeave={(e) => { if (theme.id !== t.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                >
                  {/* Color preview dots */}
                  <div className="flex gap-1 flex-shrink-0">
                    <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: t.colors.bg }} />
                    <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: t.colors.accent }} />
                    <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: t.colors.statusBar }} />
                  </div>
                  <span className="text-[12px]">{t.name}</span>
                  {theme.id === t.id && <span className="ml-auto text-[11px] font-bold" style={{ color: 'var(--theme-accent)' }}>•</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Bug Finder Panel ──
const BugFinderPanel: React.FC<{ rootPath: string; onFileClick: (path: string, line: number) => void }> = ({ rootPath, onFileClick }) => {
  const [errorMessage, setErrorMessage] = useState('');
  const [stackTrace, setStackTrace] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState('');
  const [errorContext, setErrorContext] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!errorMessage.trim() || !rootPath) return;
    setIsAnalyzing(true);
    setResults('');
    try {
      const api = window.electronAPI;
      let text = '';
      api.onLlmToken((token: string) => { text += token; setResults(text); });
      const result = await api.findBug(errorMessage, stackTrace, rootPath);
      if (result.success) { setResults(result.text || text); setErrorContext(result.errorContext); }
      else setResults(`Error: ${result.error}`);
    } catch (e: any) { setResults(`Error: ${e.message}`); }
    finally { setIsAnalyzing(false); }
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <div>
        <label className="text-[11px] text-[#858585] mb-1 block">Error Message</label>
        <textarea className="w-full bg-[#3c3c3c] text-[#cccccc] text-[12px] p-2 rounded border border-[#3c3c3c] focus:border-[#007acc] outline-none resize-none" rows={3} placeholder="Paste error message..." value={errorMessage} onChange={e => setErrorMessage(e.target.value)} />
      </div>
      <div>
        <label className="text-[11px] text-[#858585] mb-1 block">Stack Trace (optional)</label>
        <textarea className="w-full bg-[#3c3c3c] text-[#cccccc] text-[12px] p-2 rounded border border-[#3c3c3c] focus:border-[#007acc] outline-none resize-none font-mono" rows={4} placeholder="Paste stack trace..." value={stackTrace} onChange={e => setStackTrace(e.target.value)} />
      </div>
      <button onClick={handleAnalyze} disabled={isAnalyzing || !errorMessage.trim()} className="bg-[#007acc] text-white text-[12px] px-3 py-1.5 rounded hover:bg-[#006bb3] disabled:opacity-50 disabled:cursor-not-allowed">
        {isAnalyzing ? 'Analyzing...' : 'Find & Fix Bug'}
      </button>
      {results && (
        <div className="mt-2 text-[12px] bg-[#1e1e1e] p-3 rounded border border-[#3c3c3c] overflow-auto max-h-[400px]">
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{results}</pre>
        </div>
      )}
      {errorContext?.results?.map((r: any, i: number) => (
        <button key={i} onClick={() => onFileClick(r.path, r.startLine + 1)} className="block w-full text-left text-[11px] text-[#4fc1ff] hover:underline py-0.5 truncate">
          {r.relativePath}:{r.startLine + 1}
        </button>
      ))}
    </div>
  );
};
