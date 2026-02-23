import React from 'react';
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
  if (!rootPath) {
    return (
      <div className={cn('h-full flex flex-col items-center justify-start pt-10 px-5', className)}>
        <FolderOpen size={32} style={{ color: 'var(--theme-foreground-subtle)', opacity: 0.4 }} className="mb-4" />
        <p className="text-[12px] text-center mb-5" style={{ color: 'var(--theme-foreground-muted)' }}>No folder opened</p>
        <div className="flex flex-col gap-2 w-full">
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
        <p className="text-[11px] mt-4 text-center" style={{ color: 'var(--theme-foreground-subtle)' }}>
          or <kbd className="px-1 py-0.5 rounded text-[10px] mx-0.5" style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground-muted)' }}>Ctrl+K O</kbd>
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
