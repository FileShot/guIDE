import React, { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { FileIcon } from './FileIcon';
import { formatFileSize } from '@/utils/helpers';
import type { FileNode } from '@/types/file';
import { cn } from '@/utils/helpers';

interface FileNodeComponentProps {
  node: FileNode;
  level: number;
  isExpanded: boolean;
  isSelected: boolean;
  selectedNodes: Set<string>;
  expandedNodes: Set<string>;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  creating: { type: 'file' | 'folder'; parentPath: string } | null;
  createValue: string;
  onCreateChange: (v: string) => void;
  onCreateCommit: () => void;
  onCreateCancel: () => void;
  onToggle: (node: FileNode) => void;
  onSelect: (node: FileNode, event?: React.MouseEvent) => void;
  onExpand: (node: FileNode) => void;
  onCollapse: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onDragStart?: (e: React.DragEvent, node: FileNode) => void;
  onDragOver?: (e: React.DragEvent, path: string) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, node: FileNode) => void;
  onDragEnd?: () => void;
  dragOverTarget?: string | null;
  rootPath: string;
}

export const FileNodeComponent: React.FC<FileNodeComponentProps> = ({
  node, level, isExpanded, isSelected, selectedNodes, expandedNodes,
  isRenaming, renameValue, onRenameChange, onRenameCommit, onRenameCancel,
  creating, createValue, onCreateChange, onCreateCommit, onCreateCancel,
  onToggle, onSelect, onExpand, onCollapse, onContextMenu,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, dragOverTarget,
  rootPath,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'directory') onToggle(node);
    onSelect(node, event);
  }, [node, onToggle, onSelect]);

  const handleExpandClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'directory') {
      if (isExpanded) onCollapse(node); else onExpand(node);
    }
  }, [node, isExpanded, onExpand, onCollapse]);

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'directory') {
      if (isExpanded) onCollapse(node); else onExpand(node);
    } else {
      onSelect(node);
    }
  }, [node, isExpanded, onCollapse, onExpand, onSelect]);

  const handleRightClick = useCallback((event: React.MouseEvent) => {
    onContextMenu(event, node);
  }, [node, onContextMenu]);

  // Check if inline create should appear inside this directory
  const showInlineCreate = creating && creating.parentPath === node.path && node.type === 'directory';

  return (
    <div className="select-none">
      <div
        className={cn(
          'flex items-center px-1.5 py-[2px] cursor-pointer group transition-colors duration-100',
          'hover:bg-[#2a2d2e]',
          isSelected && 'bg-[#094771] hover:bg-[#094771]',
          dragOverTarget === node.path && node.type === 'directory' && 'bg-[#094771]/50',
          'text-foreground'
        )}
        style={{ paddingLeft: `${level * 14 + 6}px` }}
        draggable
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleRightClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDragStart={(e) => onDragStart?.(e, node)}
        onDragOver={(e) => { if (node.type === 'directory') { e.preventDefault(); e.stopPropagation(); onDragOver?.(e, node.path); } }}
        onDragLeave={(e) => onDragLeave?.(e)}
        onDrop={(e) => { if (node.type === 'directory') { e.preventDefault(); e.stopPropagation(); onDrop?.(e, node); } }}
        onDragEnd={() => onDragEnd?.()}
      >
        {/* Expand/Collapse Arrow */}
        {node.type === 'directory' ? (
          <button
            className={cn(
              'mr-0.5 p-0 rounded transition-transform duration-150',
              'hover:bg-background-tertiary',
              !hasChildren && 'invisible'
            )}
            onClick={handleExpandClick}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-foreground-subtle" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-foreground-subtle" />
            )}
          </button>
        ) : (
          <div className="w-3.5 mr-0.5" />
        )}

        {/* Icon */}
        <FileIcon file={node} className="mr-1.5 flex-shrink-0" isOpen={isExpanded} />

        {/* Name or Rename Input */}
        {isRenaming ? (
          <input
            autoFocus
            className="flex-1 text-[12px] bg-[#3c3c3c] text-[#cccccc] border border-[#007acc] rounded px-1.5 py-0 outline-none"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel(); }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={cn(
              'flex-1 truncate text-[12px] leading-[18px]',
              node.isHidden && 'text-foreground-subtle italic',
              isSelected && 'font-medium'
            )}
            title={node.name}
          >
            {node.name}
          </span>
        )}

        {/* File Info on hover */}
        {isHovered && !isRenaming && node.type === 'file' && (
          <div className="flex items-center space-x-2 text-[10px] text-foreground-subtle ml-2 flex-shrink-0">
            {node.size !== undefined && <span>{formatFileSize(node.size)}</span>}
          </div>
        )}
      </div>

      {/* Children + inline create */}
      {node.type === 'directory' && isExpanded && (
        <div>
          {/* Inline create input inside this directory */}
          {showInlineCreate && (
            <div className="flex items-center px-1.5 py-[2px]" style={{ paddingLeft: `${(level + 1) * 14 + 6}px` }}>
              <span className="mr-2 text-[12px] opacity-70">{creating!.type === 'folder' ? '+' : '+'}</span>
              <input
                autoFocus
                className="flex-1 text-[12px] bg-[#3c3c3c] text-[#cccccc] border border-[#007acc] rounded px-1.5 py-0 outline-none"
                value={createValue}
                onChange={(e) => onCreateChange(e.target.value)}
                onBlur={() => setTimeout(onCreateCommit, 150)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreateCommit(); } if (e.key === 'Escape') onCreateCancel(); }}
                placeholder={creating!.type === 'folder' ? 'Folder name' : 'File name'}
              />
            </div>
          )}

          {node.children?.map((child) => (
            <FileNodeComponent
              key={child.id}
              node={child}
              level={level + 1}
              isExpanded={expandedNodes.has(child.path)}
              isSelected={selectedNodes.has(child.path)}
              selectedNodes={selectedNodes}
              expandedNodes={expandedNodes}
              isRenaming={false}
              renameValue=""
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              creating={creating}
              createValue={createValue}
              onCreateChange={onCreateChange}
              onCreateCommit={onCreateCommit}
              onCreateCancel={onCreateCancel}
              onToggle={onToggle}
              onSelect={onSelect}
              onExpand={onExpand}
              onCollapse={onCollapse}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              dragOverTarget={dragOverTarget}
              rootPath={rootPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};
