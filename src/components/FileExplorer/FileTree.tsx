import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Search, RefreshCw, FolderOpen, Filter, Grid, List, Folder, FileText } from 'lucide-react';
import { FileNodeComponent } from './FileNode';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { ExplainFileModal } from './ExplainFileModal';
import { FileIcon } from './FileIcon';
import { fileSystemService } from '@/services/fileSystem';
import { sortFiles, filterFiles, debounce } from '@/utils/helpers';
import type { FileNode, FileSortOptions, FileFilter } from '@/types/file';
import { cn } from '@/utils/helpers';

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (file: FileNode) => void;
  className?: string;
}

type ViewMode = 'list' | 'grid';

export const FileTree: React.FC<FileTreeProps> = ({ rootPath, onFileSelect, className }) => {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortOptions, setSortOptions] = useState<FileSortOptions>({
    sortBy: 'name',
    sortOrder: 'asc',
    foldersFirst: true,
    showHidden: false
  });
  const [filter, _setFilter] = useState<FileFilter>({});

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null);
  // Explain file modal state
  const [explainFile, setExplainFile] = useState<{ path: string; name: string } | null>(null);
  // Inline rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Inline new file/folder state
  const [creating, setCreating] = useState<{ type: 'file' | 'folder'; parentPath: string } | null>(null);
  const [createValue, setCreateValue] = useState('');

  // Clipboard state for copy/paste
  const [clipboard, setClipboard] = useState<{ paths: string[]; operation: 'copy' | 'cut' } | null>(null);
  // Drag & drop state
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(260);

  // Track container width for auto-switch to list when narrow
  useEffect(() => {
    if (!treeContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setContainerWidth(w);
        if (w < 200 && viewMode === 'grid') {
          setViewMode('list');
        }
      }
    });
    observer.observe(treeContainerRef.current);
    return () => observer.disconnect();
  }, [viewMode]);

  // Load directory tree
  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const tree = await fileSystemService.scanDirectory(path, true);
      setFileTree(tree);
    } catch (error) {
      console.error('Failed to load directory:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (rootPath) {
      loadDirectory(rootPath);
    }
  }, [rootPath, loadDirectory]);

  // Auto-refresh when AI creates/edits files
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onFilesChanged) return;
    const handler = () => {
      if (rootPath) {
        console.log('[FileTree] Auto-refreshing after file change');
        loadDirectory(rootPath);
      }
    };
    const cleanup = api.onFilesChanged(handler);
    return () => { cleanup?.(); };
  }, [rootPath, loadDirectory]);

  // Debounced search
  const debouncedSearch = useMemo(
    () => debounce((query: string) => { setSearchQuery(query); }, 300),
    []
  );

  const handleExpand = useCallback((node: FileNode) => {
    setExpandedNodes(prev => new Set(prev).add(node.path));
  }, []);

  const handleCollapse = useCallback((node: FileNode) => {
    setExpandedNodes(prev => { const s = new Set(prev); s.delete(node.path); return s; });
  }, []);

  const handleToggle = useCallback((node: FileNode) => {
    if (expandedNodes.has(node.path)) handleCollapse(node);
    else handleExpand(node);
  }, [expandedNodes, handleExpand, handleCollapse]);

  // Selection with Ctrl+click multi-select
  const handleSelect = useCallback((node: FileNode, event?: React.MouseEvent) => {
    if (event?.ctrlKey || event?.metaKey) {
      setSelectedNodes(prev => {
        const s = new Set(prev);
        if (s.has(node.path)) s.delete(node.path); else s.add(node.path);
        return s;
      });
    } else {
      setSelectedNodes(new Set([node.path]));
    }
    if (node.type === 'file') onFileSelect(node);
  }, [onFileSelect]);

  const handleRefresh = useCallback(() => { if (rootPath) loadDirectory(rootPath); }, [rootPath, loadDirectory]);

  // ── File Operations ──
  const sep = rootPath.includes('\\') ? '\\' : '/';

  const handleNewFile = useCallback((parentPath: string) => {
    setExpandedNodes(prev => new Set(prev).add(parentPath));
    // Delay setting creating state so the expanded re-render completes first
    setTimeout(() => {
      setCreating({ type: 'file', parentPath });
      setCreateValue('');
    }, 50);
  }, []);

  const handleNewFolder = useCallback((parentPath: string) => {
    setExpandedNodes(prev => new Set(prev).add(parentPath));
    setTimeout(() => {
      setCreating({ type: 'folder', parentPath });
      setCreateValue('');
    }, 50);
  }, []);

  // Use a ref to track if commitCreate is in progress
  const commitInProgress = useRef(false);
  const commitCreate = useCallback(async () => {
    if (commitInProgress.current) return;
    if (!creating || !createValue.trim()) { setCreating(null); return; }
    commitInProgress.current = true;
    const api = (window as any).electronAPI;
    const newPath = creating.parentPath + sep + createValue.trim();
    try {
      const result = creating.type === 'folder' 
        ? await api.createDirectory(newPath)
        : await api.writeFile(newPath, '');
      if (!result?.success) {
        console.error('Create failed:', result?.error || 'Unknown error');
      }
      setCreating(null);
      loadDirectory(rootPath);
    } catch (e) { console.error('Create failed:', e); setCreating(null); }
    commitInProgress.current = false;
  }, [creating, createValue, sep, rootPath, loadDirectory]);

  const handleRename = useCallback((node: FileNode) => {
    setRenamingPath(node.path);
    setRenameValue(node.name);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) { setRenamingPath(null); return; }
    const api = (window as any).electronAPI;
    const parts = renamingPath.split(sep);
    parts[parts.length - 1] = renameValue.trim();
    const newPath = parts.join(sep);
    if (newPath !== renamingPath) {
      try { await api.renameFile(renamingPath, newPath); loadDirectory(rootPath); }
      catch (e) { console.error('Rename failed:', e); }
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, sep, rootPath, loadDirectory]);

  const handleDelete = useCallback(async (nodes: FileNode[]) => {
    const api = (window as any).electronAPI;
    const names = nodes.map(n => n.name).join(', ');
    const confirm = await api.showMessageBox?.({
      type: 'warning', title: 'Delete',
      message: `Delete ${nodes.length > 1 ? nodes.length + ' items' : `"${names}"`}?`,
      detail: 'This action cannot be undone.',
      buttons: ['Cancel', 'Delete'], defaultId: 0,
    });
    if (confirm?.response === 1) {
      for (const node of nodes) { try { await api.deleteFile(node.path); } catch {} }
      loadDirectory(rootPath);
    }
  }, [rootPath, loadDirectory]);

  const handleCopyPath = useCallback((node: FileNode) => { navigator.clipboard.writeText(node.path); }, []);

  const handleCopyRelativePath = useCallback((node: FileNode) => {
    navigator.clipboard.writeText(node.path.replace(rootPath, '').replace(/^[\/\\]/, ''));
  }, [rootPath]);

  // ── Drag & Drop (internal) ──
  const handleDragStart = useCallback((e: React.DragEvent, node: FileNode) => {
    e.stopPropagation();
    const paths = selectedNodes.has(node.path) ? Array.from(selectedNodes) : [node.path];
    setDraggedPaths(paths);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.setData('application/x-guide-files', JSON.stringify(paths));
  }, [selectedNodes]);

  const handleDragOver = useCallback((e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetPath);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOverTarget(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetNode: FileNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    const api = (window as any).electronAPI;
    const targetDir = targetNode
      ? (targetNode.type === 'directory' ? targetNode.path : targetNode.path.substring(0, targetNode.path.lastIndexOf(sep)))
      : rootPath;

    // Check for external files (from Windows Explorer)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const externalFiles = Array.from(e.dataTransfer.files);
      for (const file of externalFiles) {
        const srcPath = (file as any).path;
        if (srcPath) {
          const fileName = srcPath.split(/[\/\\]/).pop() || file.name;
          const destPath = targetDir + sep + fileName;
          try {
            // Check if it's a directory
            const stat = await api.getFileStats?.(srcPath);
            if (stat?.isDirectory) {
              await api.copyDirectory(srcPath, destPath);
            } else {
              await api.copyFile(srcPath, destPath);
            }
          } catch (err) { console.error('External drop failed:', err); }
        }
      }
      loadDirectory(rootPath);
      return;
    }

    // Internal drag
    const guideFilesData = e.dataTransfer.getData('application/x-guide-files');
    const paths = guideFilesData ? JSON.parse(guideFilesData) as string[] : draggedPaths;
    if (paths.length === 0) return;

    // Don't drop onto self or descendant
    for (const srcPath of paths) {
      if (targetDir === srcPath || targetDir.startsWith(srcPath + sep)) return;
      const fileName = srcPath.split(sep).pop() || '';
      const destPath = targetDir + sep + fileName;
      if (srcPath === destPath) continue;
      try { await api.moveFile(srcPath, destPath); } catch (err) { console.error('Move failed:', err); }
    }
    setDraggedPaths([]);
    loadDirectory(rootPath);
  }, [draggedPaths, rootPath, sep, loadDirectory]);

  const handleDragEnd = useCallback(() => {
    setDraggedPaths([]);
    setDragOverTarget(null);
  }, []);

  // ── Copy/Paste ──
  const handleCopyFiles = useCallback(() => {
    const paths = Array.from(selectedNodes);
    if (paths.length > 0) setClipboard({ paths, operation: 'copy' });
  }, [selectedNodes]);

  const handleCutFiles = useCallback(() => {
    const paths = Array.from(selectedNodes);
    if (paths.length > 0) setClipboard({ paths, operation: 'cut' });
  }, [selectedNodes]);

  const handlePasteFiles = useCallback(async (targetDir: string) => {
    if (!clipboard || clipboard.paths.length === 0) return;
    const api = (window as any).electronAPI;
    for (const srcPath of clipboard.paths) {
      const fileName = srcPath.split(sep).pop() || '';
      let destPath = targetDir + sep + fileName;
      // Avoid overwrite — add (copy) suffix if needed
      if (clipboard.operation === 'copy') {
        try {
          const exists = await api.fileExists?.(destPath);
          if (exists?.exists) {
            const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
            const base = ext ? fileName.slice(0, -ext.length) : fileName;
            destPath = targetDir + sep + base + ' (copy)' + ext;
          }
        } catch {}
      }
      try {
        // Check if directory
        const stat = await api.getFileStats?.(srcPath);
        if (stat?.isDirectory) {
          await api.copyDirectory(srcPath, destPath);
        } else {
          await api.copyFile(srcPath, destPath);
        }
        if (clipboard.operation === 'cut') {
          if (stat?.isDirectory) await api.deleteDirectory(srcPath);
          else await api.deleteFile(srcPath);
        }
      } catch (err) { console.error('Paste failed:', err); }
    }
    if (clipboard.operation === 'cut') setClipboard(null);
    loadDirectory(rootPath);
  }, [clipboard, sep, rootPath, loadDirectory]);

  // ── Context Menu ──
  const getContextMenuItems = useCallback((node: FileNode | null): ContextMenuItem[] => {
    const collectSelected = (nodes: FileNode[]): FileNode[] => {
      const result: FileNode[] = [];
      for (const n of nodes) {
        if (selectedNodes.has(n.path)) result.push(n);
        if (n.children) result.push(...collectSelected(n.children));
      }
      return result;
    };

    if (!node) {
      return [
        { label: 'New File', icon: '+', shortcut: 'Ctrl+N', action: () => handleNewFile(rootPath) },
        { label: 'New Folder', icon: '+', action: () => handleNewFolder(rootPath) },
        { label: '', action: () => {}, divider: true },
        ...(clipboard ? [{ label: 'Paste', icon: '', shortcut: 'Ctrl+V', action: () => handlePasteFiles(rootPath) }] : []),
        { label: 'Refresh', icon: '', action: handleRefresh },
      ];
    }

    const items: ContextMenuItem[] = [];
    if (node.type === 'directory') {
      items.push({ label: 'New File', icon: '+', action: () => handleNewFile(node.path) });
      items.push({ label: 'New Folder', icon: '+', action: () => handleNewFolder(node.path) });
      items.push({ label: '', action: () => {}, divider: true });
    }
    if (node.type === 'file') {
      items.push({ label: 'Open', icon: '', action: () => onFileSelect(node) });
      items.push({ label: 'Explain File', icon: '', action: () => setExplainFile({ path: node.path, name: node.name }) });
      items.push({ label: '', action: () => {}, divider: true });
    }

    items.push({ label: 'Copy', icon: '', shortcut: 'Ctrl+C', action: () => { if (!selectedNodes.has(node.path)) setSelectedNodes(new Set([node.path])); handleCopyFiles(); } });
    items.push({ label: 'Cut', icon: '', shortcut: 'Ctrl+X', action: () => { if (!selectedNodes.has(node.path)) setSelectedNodes(new Set([node.path])); handleCutFiles(); } });
    if (clipboard) {
      const pasteDir = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf(sep));
      items.push({ label: 'Paste', icon: '', shortcut: 'Ctrl+V', action: () => handlePasteFiles(pasteDir) });
    }
    items.push({ label: '', action: () => {}, divider: true });

    items.push({ label: 'Rename', icon: '', shortcut: 'F2', action: () => handleRename(node) });

    const selected = collectSelected(fileTree);
    if (selected.length > 1) {
      items.push({ label: `Delete ${selected.length} Items`, icon: '', danger: true, action: () => handleDelete(selected) });
    } else {
      items.push({ label: 'Delete', icon: '', shortcut: 'Del', danger: true, action: () => handleDelete([node]) });
    }

    items.push({ label: '', action: () => {}, divider: true });
    items.push({ label: 'Copy Path', icon: '', action: () => handleCopyPath(node) });
    items.push({ label: 'Copy Relative Path', icon: '', shortcut: 'Shift+Alt+C', action: () => handleCopyRelativePath(node) });

    return items;
  }, [selectedNodes, fileTree, rootPath, handleNewFile, handleNewFolder, handleRename, handleDelete, handleCopyPath, handleCopyRelativePath, handleRefresh, onFileSelect, clipboard, handleCopyFiles, handleCutFiles, handlePasteFiles, sep]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (node && !selectedNodes.has(node.path)) {
      setSelectedNodes(new Set([node.path]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, [selectedNodes]);

  // Filter and sort
  const filteredAndSortedTree = useMemo(() => {
    let processedTree = [...fileTree];
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      const filterBySearch = (nodes: FileNode[]): FileNode[] => {
        return nodes.reduce<FileNode[]>((acc, node) => {
          const match = node.name.toLowerCase().includes(searchLower);
          if (node.type === 'directory' && node.children) {
            const filteredChildren = filterBySearch(node.children);
            if (match || filteredChildren.length > 0) {
              acc.push({ ...node, children: filteredChildren });
            }
          } else if (match) {
            acc.push(node);
          }
          return acc;
        }, []);
      };
      processedTree = filterBySearch(processedTree);
    }
    if (Object.keys(filter).length > 0) {
      const filterNodes = (nodes: FileNode[]): FileNode[] => {
        return nodes.reduce<FileNode[]>((acc, node) => {
          if (node.type === 'directory' && node.children) {
            const filteredChildren = filterNodes(node.children);
            if (filteredChildren.length > 0) {
              acc.push({ ...node, children: filteredChildren });
            }
          } else if (filterFiles([node], filter).length > 0) {
            acc.push(node);
          }
          return acc;
        }, []);
      };
      processedTree = filterNodes(processedTree);
    }
    const sortNodes = (nodes: FileNode[]): FileNode[] => {
      return sortFiles(nodes, { ...sortOptions, showHidden }).map(node => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }));
    };
    return sortNodes(processedTree);
  }, [fileTree, searchQuery, filter, sortOptions, showHidden]);

  const gridIconSize = containerWidth < 250 ? 40 : containerWidth < 350 ? 52 : 60;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when focus is within the file tree
      if (!treeContainerRef.current?.contains(document.activeElement) && 
          !treeContainerRef.current?.matches(':hover')) return;

      if (e.key === 'F2' && selectedNodes.size === 1) {
        const path = Array.from(selectedNodes)[0];
        const node = findNodeByPath(fileTree, path);
        if (node) { e.preventDefault(); handleRename(node); }
      }
      if (e.key === 'Delete' && selectedNodes.size > 0) {
        const nodes = Array.from(selectedNodes).map(p => findNodeByPath(fileTree, p)).filter(Boolean) as FileNode[];
        if (nodes.length > 0) { e.preventDefault(); handleDelete(nodes); }
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'c' && selectedNodes.size > 0) {
        e.preventDefault(); e.stopPropagation(); handleCopyFiles();
      }
      if (ctrl && e.key.toLowerCase() === 'x' && selectedNodes.size > 0) {
        e.preventDefault(); e.stopPropagation(); handleCutFiles();
      }
      if (ctrl && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault(); e.stopPropagation();
        // Paste into selected directory or root
        const selPath = selectedNodes.size === 1 ? Array.from(selectedNodes)[0] : null;
        const selNode = selPath ? findNodeByPath(fileTree, selPath) : null;
        const targetDir = selNode?.type === 'directory' ? selNode.path : rootPath;
        handlePasteFiles(targetDir);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodes, fileTree, handleRename, handleDelete, handleCopyFiles, handleCutFiles, handlePasteFiles, clipboard, rootPath]);

  return (
    <div ref={treeContainerRef} className={cn('flex flex-col h-full bg-sidebar', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-sidebar-border">
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center space-x-2 min-w-0">
            <FolderOpen className="w-4 h-4 text-sidebar-foreground flex-shrink-0" />
            <span className="text-sm font-medium text-sidebar-foreground truncate">
              {rootPath ? rootPath.split(/[\/\\]/).pop() || rootPath : 'No folder opened'}
            </span>
          </div>
          {rootPath && (
            <span className="text-[10px] text-foreground-subtle truncate pl-6 mt-0.5" title={rootPath}>
              {rootPath}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')} className="p-1 rounded hover:bg-background-secondary" title={viewMode === 'list' ? 'Grid View' : 'List View'}>
            {viewMode === 'list' ? <Grid className="w-3.5 h-3.5 text-sidebar-foreground" /> : <List className="w-3.5 h-3.5 text-sidebar-foreground" />}
          </button>
          <button onClick={handleRefresh} disabled={isLoading} className="p-1 rounded hover:bg-background-secondary disabled:opacity-50" title="Refresh">
            <RefreshCw className={cn('w-3.5 h-3.5 text-sidebar-foreground', isLoading && 'animate-spin')} />
          </button>
          <button onClick={() => handleNewFile(rootPath)} className="p-1 rounded hover:bg-background-secondary" title="New File">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-sidebar-foreground"><path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-4-4zm0 1.4L12.1 5H9V2.4zM4 14V2h4v4h4v8H4z"/><path d="M9 8H7v2H6v1h1v2h1v-2h2v-1H9V8z"/></svg>
          </button>
          <button onClick={() => handleNewFolder(rootPath)} className="p-1 rounded hover:bg-background-secondary" title="New Folder">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-sidebar-foreground"><path d="M14 4H8l-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm0 8H2V4h4.5l1 1H14v7z"/><path d="M9 7H7v2H6v1h1v2h1v-2h2v-1H9V7z"/></svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-sidebar-border space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-foreground-subtle" />
          <input
            type="text"
            placeholder="Search files..."
            className="w-full pl-7 pr-3 py-1 text-[12px] bg-background-input border border-border rounded focus:outline-none focus:ring-1 focus:ring-border-focus text-foreground placeholder-foreground-subtle"
            onChange={(e) => debouncedSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={cn('flex items-center space-x-1 px-2 py-0.5 text-[11px] rounded hover:bg-background-secondary', showHidden && 'bg-background-tertiary')}
          >
            <Filter className="w-3 h-3" />
            <span>Hidden</span>
          </button>
          <select
            value={sortOptions.sortBy}
            onChange={(e) => setSortOptions(prev => ({ ...prev, sortBy: e.target.value as any }))}
            className="text-[11px] bg-background-input border border-border rounded px-1.5 py-0.5 text-foreground"
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="modified">Modified</option>
            <option value="type">Type</option>
          </select>
        </div>
      </div>

      {/* File Tree / Grid */}
      <div
        className="flex-1 overflow-auto"
        onClick={() => {
          // Clicks that reach here bypassed all file/folder nodes (they stopPropagation),
          // so this must be empty space — deselect everything.
          setSelectedNodes(new Set());
        }}
        onContextMenu={(e) => handleContextMenu(e, null)}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverTarget(rootPath); }}
        onDragLeave={() => setDragOverTarget(null)}
        onDrop={(e) => handleDrop(e, null)}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-6 h-6 animate-spin text-foreground-subtle" />
          </div>
        ) : filteredAndSortedTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-foreground-subtle">
            {creating && creating.parentPath === rootPath ? (
              <div className="flex items-center px-4 py-2 w-full max-w-xs">
                {creating.type === 'folder'
                  ? <Folder size={12} className="mr-2 opacity-70 flex-shrink-0 text-[#e8b87c]" />
                  : <FileText size={12} className="mr-2 opacity-70 flex-shrink-0" />}
                <input
                  autoFocus
                  className="flex-1 text-[12px] bg-[#3c3c3c] text-[#cccccc] border border-[#007acc] rounded px-2 py-1 outline-none"
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  onBlur={() => setTimeout(commitCreate, 150)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCreate(); } if (e.key === 'Escape') setCreating(null); }}
                  placeholder={creating.type === 'folder' ? 'Folder name' : 'File name'}
                />
              </div>
            ) : (
              <>
                <FolderOpen className="w-8 h-8 mb-2" />
                <span className="text-sm">{searchQuery ? 'No files found' : 'Empty folder'}</span>
              </>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-2 flex flex-wrap gap-1 content-start">
            {creating && creating.parentPath === rootPath && (
              <div className="flex flex-col items-center p-1.5" style={{ width: gridIconSize + 24 }}>
                <div style={{ width: gridIconSize, height: gridIconSize }} className="flex items-center justify-center">
                  <FileIcon file={{ id: '', name: creating.type === 'folder' ? 'folder' : createValue || 'file', path: '', type: creating.type === 'folder' ? 'directory' : 'file' }} isOpen={false} size={gridIconSize - 8} />
                </div>
                <input
                  autoFocus
                  className="mt-1 w-full text-[10px] bg-[#3c3c3c] text-[#cccccc] border border-[#007acc] rounded px-1 py-0.5 text-center outline-none"
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  onBlur={() => setTimeout(commitCreate, 150)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCreate(); } if (e.key === 'Escape') setCreating(null); }}
                  placeholder={creating.type === 'folder' ? 'folder' : 'file'}
                />
              </div>
            )}
            {filteredAndSortedTree.map((node) => (
              <GridItem
                key={node.id}
                node={node}
                isSelected={selectedNodes.has(node.path)}
                iconSize={gridIconSize}
                isRenaming={renamingPath === node.path}
                renameValue={renameValue}
                isDragOver={dragOverTarget === node.path}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingPath(null)}
                onSelect={handleSelect}
                onToggle={handleToggle}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e, n) => handleDrop(e, n)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        ) : (
          <div className="py-1">
            {creating && creating.parentPath === rootPath && (
              <div className="flex items-center px-2 py-1" style={{ paddingLeft: '24px' }}>
                <span className="mr-2 text-[12px] opacity-70">{creating.type === 'folder' ? '+' : '+'}</span>
                <input
                  autoFocus
                  className="flex-1 text-[12px] bg-[#3c3c3c] text-[#cccccc] border border-[#007acc] rounded px-2 py-0.5 outline-none"
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                  onBlur={() => setTimeout(commitCreate, 150)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCreate(); } if (e.key === 'Escape') setCreating(null); }}
                  placeholder={creating.type === 'folder' ? 'Folder name' : 'File name'}
                />
              </div>
            )}
            {filteredAndSortedTree.map((node) => (
              <FileNodeComponent
                key={node.id}
                node={node}
                level={0}
                isExpanded={expandedNodes.has(node.path)}
                isSelected={selectedNodes.has(node.path)}
                selectedNodes={selectedNodes}
                expandedNodes={expandedNodes}
                isRenaming={renamingPath === node.path}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingPath(null)}
                creating={creating}
                createValue={createValue}
                onCreateChange={setCreateValue}
                onCreateCommit={commitCreate}
                onCreateCancel={() => setCreating(null)}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onExpand={handleExpand}
                onCollapse={handleCollapse}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e, n) => handleDrop(e, n)}
                onDragEnd={handleDragEnd}
                dragOverTarget={dragOverTarget}
                rootPath={rootPath}
              />
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {explainFile && (
        <ExplainFileModal
          filePath={explainFile.path}
          fileName={explainFile.name}
          onClose={() => setExplainFile(null)}
        />
      )}
    </div>
  );
};

// ── Grid Item ──
const GridItem: React.FC<{
  node: FileNode;
  isSelected: boolean;
  iconSize: number;
  isRenaming: boolean;
  renameValue: string;
  isDragOver: boolean;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onSelect: (node: FileNode, e?: React.MouseEvent) => void;
  onToggle: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onDragStart: (e: React.DragEvent, node: FileNode) => void;
  onDragOver: (e: React.DragEvent, path: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, node: FileNode) => void;
  onDragEnd: () => void;
}> = ({ node, isSelected, iconSize, isRenaming, renameValue, isDragOver, onRenameChange, onRenameCommit, onRenameCancel, onSelect, onToggle, onContextMenu, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }) => (
  <div
    className={cn(
      'flex flex-col items-center p-1.5 rounded cursor-pointer transition-colors select-none',
      isSelected ? 'bg-[#094771]' : isDragOver && node.type === 'directory' ? 'bg-[#094771]/50' : 'hover:bg-[#2a2d2e]',
    )}
    style={{ width: iconSize + 24 }}
    draggable
    onClick={(e) => { e.stopPropagation(); if (node.type === 'directory') onToggle(node); onSelect(node, e); }}
    onDoubleClick={() => { if (node.type === 'file') onSelect(node); }}
    onContextMenu={(e) => onContextMenu(e, node)}
    onDragStart={(e) => onDragStart(e, node)}
    onDragOver={(e) => { if (node.type === 'directory') onDragOver(e, node.path); }}
    onDragLeave={onDragLeave}
    onDrop={(e) => { if (node.type === 'directory') onDrop(e, node); }}
    onDragEnd={onDragEnd}
    title={node.name}
  >
    <div style={{ width: iconSize, height: iconSize }} className="flex items-center justify-center mb-1">
      <FileIcon file={node} isOpen={false} size={iconSize - 8} />
    </div>
    {isRenaming ? (
      <input
        autoFocus
        className="w-full text-[10px] bg-[#3c3c3c] text-[#cccccc] border border-[#007acc] rounded px-1 py-0.5 text-center outline-none"
        value={renameValue}
        onChange={(e) => onRenameChange(e.target.value)}
        onBlur={onRenameCommit}
        onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel(); }}
      />
    ) : (
      <span className={cn('text-[10px] text-center leading-tight w-full truncate', node.isHidden ? 'text-[#858585] italic' : 'text-[#cccccc]')}>
        {node.name}
      </span>
    )}
  </div>
);

function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) { const f = findNodeByPath(node.children, path); if (f) return f; }
  }
  return null;
}
