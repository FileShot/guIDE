import React, { useState } from 'react';
import { FolderOpen, FolderPlus } from 'lucide-react';
import { FileTree } from './FileTree';
import type { FileNode } from '@/types/file';
import { cn } from '@/utils/helpers';

interface FileExplorerProps {
  rootPath: string;
  onFileSelect: (file: FileNode) => void;
  onOpenFolder?: () => void;
  className?: string;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ rootPath, onFileSelect, onOpenFolder, className }) => {
  const [recentFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('recent-folders') || '[]') as string[]; }
    catch { return []; }
  });

  if (!rootPath) {
    return (
      <div className={cn('h-full flex flex-col px-3 pt-3 pb-3 overflow-y-auto', className)}>
        {/* Open / New buttons */}
        <div className="flex flex-col gap-1.5 mb-4">
          <button
            className="flex items-center justify-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--theme-accent-hover)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--theme-accent)')}
            onClick={onOpenFolder}
          >
            <FolderOpen size={13} />
            Open Folder
          </button>
          <button
            className="flex items-center justify-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground-muted)', border: '1px solid var(--theme-border)' }}
            onMouseEnter={e => { (e.currentTarget.style.color = 'var(--theme-foreground)'); (e.currentTarget.style.borderColor = 'var(--theme-accent)'); }}
            onMouseLeave={e => { (e.currentTarget.style.color = 'var(--theme-foreground-muted)'); (e.currentTarget.style.borderColor = 'var(--theme-border)'); }}
            onClick={() => window.dispatchEvent(new CustomEvent('app-action', { detail: 'new-project' }))}
          >
            <FolderPlus size={13} />
            New Project
          </button>
        </div>

        {/* Recent folders */}
        {recentFolders.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-widest mb-1.5 px-1" style={{ color: 'var(--theme-foreground-subtle)' }}>Recent</p>
            <div className="flex flex-col gap-0">
              {recentFolders.map((folder) => {
                const parts = folder.replace(/\\/g, '/').split('/');
                const name = parts[parts.length - 1] || folder;
                const parent = parts.slice(-3, -1).join('/');
                return (
                  <button
                    key={folder}
                    className="flex items-start gap-2 w-full text-left px-2 py-1.5 rounded transition-colors group"
                    style={{ color: 'var(--theme-foreground-muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--theme-list-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => window.dispatchEvent(new CustomEvent('app-action', { detail: { action: 'open-recent', path: folder } }))}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="mt-0.5 flex-shrink-0" style={{ color: 'var(--theme-foreground-subtle)' }}>
                      <path d="M1.5 4.5C1.5 3.67 2.17 3 3 3h3.44c.35 0 .68.13.92.37L8.5 4.5H13c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7.5z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                    </svg>
                    <div className="min-w-0">
                      <div className="text-[12px] truncate" style={{ color: 'var(--theme-foreground)' }}>{name}</div>
                      {parent && <div className="text-[10px] truncate" style={{ color: 'var(--theme-foreground-subtle)' }}>{parent}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Keyboard hint */}
        <p className="text-[11px] mt-auto pt-4 text-center" style={{ color: 'var(--theme-foreground-subtle)' }}>
          <kbd className="px-1 py-0.5 rounded text-[10px] mx-0.5" style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground-muted)' }}>Ctrl+K O</kbd> to open
        </p>
      </div>
    );
  }

  return (
    <div className={cn('h-full border-r border-border', className)}>
      <FileTree rootPath={rootPath} onFileSelect={onFileSelect} />
    </div>
  );
};
