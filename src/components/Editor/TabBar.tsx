import React, { useState, useRef } from 'react';
import { X, Plus, Save, SaveAll, GitBranch, Search } from 'lucide-react';
import { editorService } from '@/services/editorService';
import type { EditorTab } from '@/types/editor';
import { cn } from '@/utils/helpers';

interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewFile: () => void;
  onSave: (tabId: string) => void;
  onSaveAll: () => void;
  className?: string;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewFile,
  onSave,
  onSaveAll,
  className
}) => {
  const [draggedTab, setDraggedTab] = useState<string | null>(null);
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleTabClick = (tabId: string) => {
    onTabSelect(tabId);
  };

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onTabClose(tabId);
  };

  const handleTabMiddleClick = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    onTabClose(tabId);
  };

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTab(tabId);
  };

  const handleDragLeave = () => {
    setDragOverTab(null);
  };

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    setDragOverTab(null);
    
    if (draggedTab && draggedTab !== targetTabId) {
      editorService.reorderTab(draggedTab, targetTabId);
    }
    setDraggedTab(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTabSelect(tabId);
    }
  };

  const getTabDisplayName = (tab: EditorTab): string => {
    const maxLength = 20;
    if (tab.fileName.length <= maxLength) {
      return tab.fileName;
    }
    
    const extension = tab.fileName.includes('.') ? '.' + tab.fileName.split('.').pop() : '';
    const nameWithoutExt = tab.fileName.substring(0, tab.fileName.length - extension.length);
    
    if (nameWithoutExt.length > maxLength - extension.length - 3) {
      return nameWithoutExt.substring(0, maxLength - extension.length - 3) + '...' + extension;
    }
    
    return tab.fileName;
  };

  const getTabTooltip = (tab: EditorTab): string => {
    const parts = [tab.fileName];
    if (tab.filePath) {
      parts.push(tab.filePath);
    }
    if (tab.isDirty) {
      parts.push('Unsaved changes');
    }
    return parts.join('\n');
  };

  const hasUnsavedChanges = tabs.some(tab => tab.isDirty);

  return (
    <div className={cn('flex flex-col bg-background-secondary border-b border-border', className)}>
      {/* Tab Actions Bar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border">
        <div className="flex items-center space-x-2">
          <button
            onClick={onNewFile}
            className="p-1 rounded hover:bg-background-tertiary transition-colors"
            title="New File"
            aria-label="New File"
          >
            <Plus className="w-4 h-4 text-foreground" />
          </button>
          <button
            onClick={() => activeTabId && onSave(activeTabId)}
            disabled={!activeTabId}
            className={cn(
              'p-1 rounded transition-colors',
              'hover:bg-background-tertiary',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            title="Save"
            aria-label="Save"
          >
            <Save className="w-4 h-4 text-foreground" />
          </button>
          <button
            onClick={onSaveAll}
            disabled={tabs.length === 0}
            className={cn(
              'p-1 rounded transition-colors',
              'hover:bg-background-tertiary',
              hasUnsavedChanges && 'text-warning',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            title="Save All"
            aria-label="Save All"
          >
            <SaveAll className="w-4 h-4" />
          </button>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            className="p-1 rounded hover:bg-background-tertiary transition-colors"
            title="Search in Files"
            aria-label="Search in Files"
          >
            <Search className="w-4 h-4 text-foreground" />
          </button>
          <button
            className="p-1 rounded hover:bg-background-tertiary transition-colors"
            title="Git"
            aria-label="Git"
          >
            <GitBranch className="w-4 h-4 text-foreground" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center overflow-x-auto scrollbar-thin">
        {tabs.length === 0 ? (
          <div className="flex items-center justify-center w-full h-10 text-foreground-subtle text-sm">
            No open files
          </div>
        ) : (
          <>
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const isDragged = tab.id === draggedTab;
              const isDragOver = tab.id === dragOverTab;

              return (
                <div
                  key={tab.id}
                  ref={(el) => {
                    if (el) {
                      tabRefs.current.set(tab.id, el);
                    } else {
                      tabRefs.current.delete(tab.id);
                    }
                  }}
                  className={cn(
                    'flex items-center group min-w-0 max-w-xs px-3 py-2 border-r border-border cursor-pointer transition-colors',
                    'hover:bg-background-tertiary',
                    isActive && 'bg-background border-t-2 border-t-border-focus',
                    isDragged && 'opacity-50',
                    isDragOver && 'bg-background-tertiary border-t-2 border-t-info'
                  )}
                  onClick={() => handleTabClick(tab.id)}
                  onAuxClick={(e) => handleTabMiddleClick(e, tab.id)}
                  onKeyDown={(e) => handleKeyDown(e, tab.id)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, tab.id)}
                  onDragOver={(e) => handleDragOver(e, tab.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, tab.id)}
                  title={getTabTooltip(tab)}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                >
                  {/* File Icon */}
                  <div className="flex-shrink-0 mr-2">
                    <FileIcon fileName={tab.fileName} language={tab.language} />
                  </div>

                  {/* File Name */}
                  <span
                    className={cn(
                      'flex-1 truncate text-sm',
                      isActive ? 'text-foreground font-medium' : 'text-foreground-subtle',
                      tab.isDirty && 'italic'
                    )}
                  >
                    {getTabDisplayName(tab)}
                  </span>

                  {/* Dirty Indicator */}
                  {tab.isDirty && (
                    <div className="flex-shrink-0 w-2 h-2 ml-2 bg-warning rounded-full" title="Unsaved changes" />
                  )}

                  {/* Close Button */}
                  <button
                    onClick={(e) => handleTabClose(e, tab.id)}
                    className={cn(
                      'flex-shrink-0 ml-2 p-0.5 rounded transition-colors',
                      'opacity-0 group-hover:opacity-100',
                      'hover:bg-background',
                      'focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-border-focus'
                    )}
                    title="Close"
                    aria-label="Close tab"
                  >
                    <X className="w-3 h-3 text-foreground-subtle hover:text-foreground" />
                  </button>
                </div>
              );
            })}
            
            {/* Spacer to push scroll area to the right */}
            <div className="flex-1 min-w-4" />
          </>
        )}
      </div>
    </div>
  );
};

// Simple file icon component for tabs
const FileIcon: React.FC<{ fileName: string; language: string }> = ({ fileName, language }) => {
  const getIcon = () => {
    const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        return ext === 'jsx' || ext === 'tsx' ? 'TS' : 'JS';
      case 'html':
        return 'H';
      case 'css':
      case 'scss':
      case 'less':
        return '#';
      case 'json':
        return '{}';
      case 'markdown':
        return 'M';
      case 'python':
        return 'py';
      case 'java':
        return 'J';
      case 'cpp':
      case 'c':
        return 'C';
      case 'csharp':
        return 'C#';
      case 'php':
        return 'P';
      case 'ruby':
        return 'rb';
      case 'go':
        return 'Go';
      case 'rust':
        return 'rs';
      case 'sql':
        return 'DB';
      case 'shell':
        return '$';
      case 'powershell':
        return 'PS';
      case 'dockerfile':
        return 'D';
      case 'xml':
        return '<>';
      case 'yaml':
        return 'Y';
      case 'plaintext':
      default:
        return 'F';
    }
  };

  return (
    <span className="text-sm" title={language}>
      {getIcon()}
    </span>
  );
};
