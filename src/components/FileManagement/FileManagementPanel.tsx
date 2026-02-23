import React, { useState, useEffect } from 'react';
import { History, RotateCcw, Download, Settings, AlertTriangle } from 'lucide-react';
import { SyncStatusComponent } from './SyncStatus';
import { ConflictResolver } from './ConflictResolver';
import { fileManagementService } from '@/services/fileManagementService';
import type { FileConflict, FileBackup, FileVersion } from '@/types/fileManagement';
import { cn } from '@/utils/helpers';

interface FileManagementPanelProps {
  className?: string;
}

export const FileManagementPanel: React.FC<FileManagementPanelProps> = ({ className }) => {
  const [activeTab, setActiveTab] = useState<'status' | 'conflicts' | 'backups' | 'versions'>('status');
  const [conflicts, setConflicts] = useState<FileConflict[]>([]);
  const [backups, setBackups] = useState<FileBackup[]>([]);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // Load data based on active tab
    const loadData = () => {
      switch (activeTab) {
        case 'conflicts':
          setConflicts([]);
          break;
        case 'backups':
          // Load backups for selected file
          if (selectedFile) {
            // Load backups for selected file
            setBackups([]);
          }
          break;
        case 'versions':
          // Load versions for selected file
          if (selectedFile) {
            // Load versions for selected file
            setVersions([]);
          }
          break;
      }
    };

    loadData();
  }, [activeTab, selectedFile]);

  const handleResolveConflict = (conflictId: string, _resolution: FileConflict['resolution']) => {
    setConflicts(prev => prev.filter(c => c.id !== conflictId));
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!selectedFile) return;
    
    try {
      const recovery = await fileManagementService.restoreFromBackup(selectedFile, backupId);
      if (recovery.success) {
        // Backup restored
      }
    } catch (error) {
      console.error('Failed to restore backup:', error);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!selectedFile) return;
    
    try {
      const recovery = await fileManagementService.restoreFromVersion(selectedFile, versionId);
      if (recovery.success) {
        // Version restored
      }
    } catch (error) {
      console.error('Failed to restore version:', error);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleString();
  };

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center space-x-2">
          <History className="w-5 h-5 text-foreground" />
          <h2 className="text-lg font-semibold text-foreground">File Management</h2>
        </div>
        <div className="flex items-center space-x-2">
          <SyncStatusComponent />
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded hover:bg-background-tertiary transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-foreground" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {[
          { id: 'status', label: 'Status', icon: SyncStatusComponent },
          { id: 'conflicts', label: 'Conflicts', icon: AlertTriangle },
          { id: 'backups', label: 'Backups', icon: RotateCcw },
          { id: 'versions', label: 'Versions', icon: History }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              'flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors',
              'border-b-2',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-foreground-subtle hover:text-foreground'
            )}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {tab.id === 'conflicts' && conflicts.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-warning text-warning-foreground rounded-full">
                {conflicts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'status' && (
          <div className="space-y-4">
            <SyncStatusComponent />
            
            <div className="bg-background-tertiary rounded-lg p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">System Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-foreground-subtle">Auto-save</span>
                  <span className="text-foreground">Enabled</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-subtle">Backup Location</span>
                  <span className="text-foreground">./_new/backups</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-subtle">Max Backups</span>
                  <span className="text-foreground">10</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground-subtle">Version Control</span>
                  <span className="text-foreground">Enabled</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'conflicts' && (
          <div className="space-y-4">
            {conflicts.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="w-12 h-12 text-success mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No Conflicts</h3>
                <p className="text-sm text-foreground-subtle">
                  All file operations are in sync.
                </p>
              </div>
            ) : (
              conflicts.map((conflict) => (
                <ConflictResolver
                  key={conflict.id}
                  conflict={conflict}
                  onResolve={handleResolveConflict}
                />
              ))
            )}
          </div>
        )}

        {activeTab === 'backups' && (
          <div className="space-y-4">
            {!selectedFile ? (
              <div className="text-center py-8">
                <RotateCcw className="w-12 h-12 text-foreground-subtle mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Select a File</h3>
                <p className="text-sm text-foreground-subtle">
                  Choose a file to view its backup history.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Backups for {selectedFile}</h3>
                    <p className="text-xs text-foreground-subtle">
                      {backups.length} backup{backups.length !== 1 ? 's' : ''} available
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedFile('')}
                    className="text-xs text-foreground-subtle hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>

                {backups.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-foreground-subtle">No backups found for this file.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {backups.map((backup) => (
                      <div
                        key={backup.id}
                        className="flex items-center justify-between p-3 bg-background-tertiary rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium text-foreground">
                            {backup.operation.charAt(0).toUpperCase() + backup.operation.slice(1)} Backup
                          </div>
                          <div className="text-xs text-foreground-subtle">
                            {formatDate(backup.timestamp)} • {formatFileSize(backup.metadata.size)}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleRestoreBackup(backup.id)}
                            className="p-1.5 rounded hover:bg-background transition-colors"
                            title="Restore backup"
                          >
                            <RotateCcw className="w-4 h-4 text-foreground-subtle" />
                          </button>
                          <button
                            className="p-1.5 rounded hover:bg-background transition-colors"
                            title="Download backup"
                          >
                            <Download className="w-4 h-4 text-foreground-subtle" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'versions' && (
          <div className="space-y-4">
            {!selectedFile ? (
              <div className="text-center py-8">
                <History className="w-12 h-12 text-foreground-subtle mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Select a File</h3>
                <p className="text-sm text-foreground-subtle">
                  Choose a file to view its version history.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Versions for {selectedFile}</h3>
                    <p className="text-xs text-foreground-subtle">
                      {versions.length} version{versions.length !== 1 ? 's' : ''} available
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedFile('')}
                    className="text-xs text-foreground-subtle hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>

                {versions.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-foreground-subtle">No versions found for this file.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((version) => (
                      <div
                        key={version.id}
                        className="flex items-center justify-between p-3 bg-background-tertiary rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium text-foreground">
                            Version {version.version}
                          </div>
                          <div className="text-xs text-foreground-subtle">
                            {version.message || 'No message'}
                          </div>
                          <div className="text-xs text-foreground-subtle">
                            {formatDate(version.timestamp)} • {version.metadata.lines} lines • {formatFileSize(version.metadata.size)}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleRestoreVersion(version.id)}
                            className="p-1.5 rounded hover:bg-background transition-colors"
                            title="Restore version"
                          >
                            <RotateCcw className="w-4 h-4 text-foreground-subtle" />
                          </button>
                          <button
                            className="p-1.5 rounded hover:bg-background transition-colors"
                            title="Download version"
                          >
                            <Download className="w-4 h-4 text-foreground-subtle" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute inset-0 bg-background/95 border border-border rounded-lg p-4 z-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">File Management Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="p-1 rounded hover:bg-background-tertiary transition-colors"
            >
              ×
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm text-foreground">Enable auto-save</span>
              </label>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm text-foreground">Enable backups</span>
              </label>
            </div>
            <div>
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm text-foreground">Enable version control</span>
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Auto-save interval
              </label>
              <select className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground">
                <option value="10000">10 seconds</option>
                <option value="30000" selected>30 seconds</option>
                <option value="60000">1 minute</option>
                <option value="300000">5 minutes</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
