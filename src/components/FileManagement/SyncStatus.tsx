import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Clock, Database, Shield } from 'lucide-react';
import { fileManagementService } from '@/services/fileManagementService';
import type { SyncStatus } from '@/types/fileManagement';
import { cn } from '@/utils/helpers';

interface SyncStatusProps {
  className?: string;
}

export const SyncStatusComponent: React.FC<SyncStatusProps> = ({ className }) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateStatus = () => {
      const status = fileManagementService.getSyncStatus();
      setSyncStatus(status);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!syncStatus) return null;

  const getStatusIcon = () => {
    if (!syncStatus.isHealthy) {
      return <AlertTriangle className="w-4 h-4 text-warning" />;
    }
    if (syncStatus.pendingCount > 0) {
      return <Clock className="w-4 h-4 text-info animate-pulse" />;
    }
    return <CheckCircle className="w-4 h-4 text-success" />;
  };

  const getStatusText = () => {
    if (!syncStatus.isHealthy) {
      return 'Sync Issues';
    }
    if (syncStatus.pendingCount > 0) {
      return `Syncing (${syncStatus.pendingCount} pending)`;
    }
    return 'All Synced';
  };

  const getStatusColor = () => {
    if (!syncStatus.isHealthy) return 'text-warning';
    if (syncStatus.pendingCount > 0) return 'text-info';
    return 'text-success';
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={cn('relative', className)}>
      {/* Status Indicator */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center space-x-2 px-3 py-1.5 rounded-lg transition-colors',
          'bg-background-secondary hover:bg-background-tertiary',
          'border border-border'
        )}
      >
        {getStatusIcon()}
        <span className={cn('text-sm font-medium', getStatusColor())}>
          {getStatusText()}
        </span>
        <RefreshCw className={cn(
          'w-3 h-3 transition-transform',
          isExpanded && 'rotate-180'
        )} />
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-lg p-4 z-50 min-w-64">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">File Sync Status</h3>
              <div className="flex items-center space-x-1">
                {getStatusIcon()}
                <span className={cn('text-xs font-medium', getStatusColor())}>
                  {getStatusText()}
                </span>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-foreground-subtle" />
                <div>
                  <div className="text-xs text-foreground-subtle">Last Sync</div>
                  <div className="text-sm font-medium text-foreground">
                    {formatTime(syncStatus.lastSync)}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-foreground-subtle" />
                <div>
                  <div className="text-xs text-foreground-subtle">Backups</div>
                  <div className="text-sm font-medium text-foreground">
                    {syncStatus.backupCount}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 text-foreground-subtle" />
                <div>
                  <div className="text-xs text-foreground-subtle">Pending</div>
                  <div className="text-sm font-medium text-foreground">
                    {syncStatus.pendingCount}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-foreground-subtle" />
                <div>
                  <div className="text-xs text-foreground-subtle">Conflicts</div>
                  <div className="text-sm font-medium text-foreground">
                    {syncStatus.conflictCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Issues */}
            {syncStatus.issues.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span className="text-sm font-medium text-warning">Issues</span>
                </div>
                <div className="space-y-1">
                  {syncStatus.issues.map((issue, index) => (
                    <div key={index} className="text-xs text-warning bg-warning/10 rounded px-2 py-1">
                      {issue}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Health Indicator */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-foreground-subtle" />
                <span className="text-xs text-foreground-subtle">System Health</span>
              </div>
              <div className={cn(
                'px-2 py-1 rounded text-xs font-medium',
                syncStatus.isHealthy 
                  ? 'bg-success/20 text-success' 
                  : 'bg-warning/20 text-warning'
              )}>
                {syncStatus.isHealthy ? 'Healthy' : 'Issues Detected'}
              </div>
            </div>

            {/* Actions */}
            <div className="flex space-x-2 pt-2 border-t border-border">
              <button
                className="flex-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                onClick={() => {
                  // Force sync
                  fileManagementService.getSyncStatus();
                }}
              >
                Force Sync
              </button>
              <button
                className="flex-1 px-3 py-1.5 text-xs bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
                onClick={() => {
                  fileManagementService.getSyncStatus();
                }}
              >
                Refresh Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
