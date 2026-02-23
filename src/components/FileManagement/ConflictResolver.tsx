import React, { useState } from 'react';
import { AlertTriangle, Check, X, GitMerge, Eye, FileText } from 'lucide-react';
import type { FileConflict } from '@/types/fileManagement';
import { cn } from '@/utils/helpers';

interface ConflictResolverProps {
  conflict: FileConflict;
  onResolve: (conflictId: string, resolution: FileConflict['resolution']) => void;
  className?: string;
}

export const ConflictResolver: React.FC<ConflictResolverProps> = ({
  conflict,
  onResolve,
  className
}) => {
  const [selectedResolution, setSelectedResolution] = useState<FileConflict['resolution']>('manual');
  const [showDiff, setShowDiff] = useState(false);

  const handleResolve = () => {
    onResolve(conflict.id, selectedResolution);
  };

  const getConflictTypeText = () => {
    switch (conflict.type) {
      case 'content':
        return 'Content Conflict';
      case 'existence':
        return 'File Exists';
      case 'permission':
        return 'Permission Issue';
      default:
        return 'Unknown Conflict';
    }
  };

  const getConflictDescription = () => {
    switch (conflict.type) {
      case 'content':
        return 'The file has been modified both locally and externally.';
      case 'existence':
        return 'A file already exists at the target location.';
      case 'permission':
        return 'Insufficient permissions to perform the operation.';
      default:
        return 'An unknown conflict occurred.';
    }
  };

  const renderDiff = () => {
    if (!showDiff) return null;

    const lines = {
      original: conflict.originalContent.split('\n'),
      current: conflict.currentContent?.split('\n') || [],
      new: conflict.newContent.split('\n')
    };

    const maxLines = Math.max(lines.original.length, lines.current.length, lines.new.length);

    return (
      <div className="mt-4 border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-3 bg-background-tertiary">
          <div className="px-3 py-2 text-xs font-medium text-foreground border-r border-border">
            Original
          </div>
          <div className="px-3 py-2 text-xs font-medium text-foreground border-r border-border">
            Current
          </div>
          <div className="px-3 py-2 text-xs font-medium text-foreground">
            New
          </div>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {Array.from({ length: maxLines }, (_, index) => (
            <div key={index} className="grid grid-cols-3 border-t border-border">
              <div className="px-3 py-1 text-xs font-mono border-r border-border bg-editor">
                {lines.original[index] || ''}
              </div>
              <div className="px-3 py-1 text-xs font-mono border-r border-border bg-editor">
                {lines.current[index] || ''}
              </div>
              <div className="px-3 py-1 text-xs font-mono bg-editor">
                {lines.new[index] || ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={cn('bg-warning/10 border border-warning/20 rounded-lg p-4', className)}>
      {/* Header */}
      <div className="flex items-start space-x-3">
        <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {getConflictTypeText()}
          </h3>
          <p className="text-xs text-foreground-subtle mb-2">
            {conflict.filePath}
          </p>
          <p className="text-sm text-foreground mb-3">
            {getConflictDescription()}
          </p>
        </div>
      </div>

      {/* Resolution Options */}
      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Resolution:</label>
          
          <div className="space-y-2">
            {conflict.type === 'content' && (
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name={`resolution-${conflict.id}`}
                  value="merge"
                  checked={selectedResolution === 'merge'}
                  onChange={(e) => setSelectedResolution(e.target.value as FileConflict['resolution'])}
                  className="text-primary"
                />
                <GitMerge className="w-4 h-4 text-foreground-subtle" />
                <span className="text-sm text-foreground">Merge changes</span>
              </label>
            )}
            
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name={`resolution-${conflict.id}`}
                value="accept_new"
                checked={selectedResolution === 'accept_new'}
                onChange={(e) => setSelectedResolution(e.target.value as FileConflict['resolution'])}
                className="text-primary"
              />
              <Check className="w-4 h-4 text-success" />
              <span className="text-sm text-foreground">Accept new changes</span>
            </label>
            
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name={`resolution-${conflict.id}`}
                value="accept_current"
                checked={selectedResolution === 'accept_current'}
                onChange={(e) => setSelectedResolution(e.target.value as FileConflict['resolution'])}
                className="text-primary"
              />
              <X className="w-4 h-4 text-error" />
              <span className="text-sm text-foreground">Keep current version</span>
            </label>
            
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name={`resolution-${conflict.id}`}
                value="manual"
                checked={selectedResolution === 'manual'}
                onChange={(e) => setSelectedResolution(e.target.value as FileConflict['resolution'])}
                className="text-primary"
              />
              <FileText className="w-4 h-4 text-foreground-subtle" />
              <span className="text-sm text-foreground">Resolve manually</span>
            </label>
          </div>
        </div>

        {/* Diff View Toggle */}
        {(conflict.type === 'content' || conflict.currentContent) && (
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="flex items-center space-x-2 px-3 py-1.5 text-xs bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
          >
            <Eye className="w-3 h-3" />
            <span>{showDiff ? 'Hide' : 'Show'} Diff</span>
          </button>
        )}

        {/* Diff View */}
        {renderDiff()}

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-warning/20">
          <div className="text-xs text-foreground-subtle">
            {selectedResolution === 'manual' && (
              <span>You'll need to resolve this conflict manually in the editor.</span>
            )}
            {selectedResolution === 'merge' && (
              <span>The system will attempt to merge the changes automatically.</span>
            )}
            {selectedResolution === 'accept_new' && (
              <span>New changes will overwrite the current version.</span>
            )}
            {selectedResolution === 'accept_current' && (
              <span>Current version will be preserved, new changes will be discarded.</span>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onResolve(conflict.id, 'manual')}
              className="px-3 py-1.5 text-xs bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleResolve}
              disabled={selectedResolution === 'manual'}
              className={cn(
                'px-3 py-1.5 text-xs rounded transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Resolve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
