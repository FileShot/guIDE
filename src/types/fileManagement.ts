export interface SafeFileOperation {
  id: string;
  type: 'create' | 'update' | 'delete' | 'move' | 'copy';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  filePath: string;
  originalPath?: string;
  newContent?: string;
  backupPath?: string;
  timestamp: Date;
  error?: string;
  metadata?: {
    size?: number;
    checksum?: string;
    encoding?: string;
    lineEnding?: string;
  };
}

export interface FileBackup {
  id: string;
  originalPath: string;
  backupPath: string;
  timestamp: Date;
  operation: SafeFileOperation['type'];
  content: string;
  metadata: {
    size: number;
    checksum: string;
    encoding: string;
    lineEnding: string;
  };
}

export interface PendingChange {
  id: string;
  filePath: string;
  operation: 'create' | 'update' | 'delete';
  newContent?: string;
  originalContent?: string;
  timestamp: Date;
  applied: boolean;
  conflict?: boolean;
  conflictReason?: string;
}

export interface FileConflict {
  id: string;
  filePath: string;
  type: 'content' | 'existence' | 'permission';
  originalContent: string;
  newContent: string;
  currentContent?: string;
  timestamp: Date;
  resolution?: 'accept_new' | 'accept_current' | 'merge' | 'manual';
}

export interface FileVersion {
  id: string;
  filePath: string;
  version: number;
  timestamp: Date;
  content: string;
  author?: string;
  message?: string;
  metadata: {
    size: number;
    lines: number;
    checksum: string;
  };
}

export interface FileWatcherEvent {
  id: string;
  type: 'created' | 'modified' | 'deleted' | 'moved';
  filePath: string;
  oldPath?: string;
  timestamp: Date;
  isExternal: boolean;
  handled: boolean;
}

export interface BatchOperation {
  id: string;
  name: string;
  operations: SafeFileOperation[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  startTime: Date;
  endTime?: Date;
  errors: string[];
}

export interface FileManagementConfig {
  backupEnabled: boolean;
  backupLocation: string;
  maxBackups: number;
  autoSave: boolean;
  autoSaveInterval: number;
  conflictResolution: 'prompt' | 'auto_new' | 'auto_current';
  versionControl: boolean;
  maxVersions: number;
  externalChangesHandling: 'prompt' | 'auto_accept' | 'auto_reject';
}

export interface FileManagementState {
  pendingOperations: SafeFileOperation[];
  completedOperations: SafeFileOperation[];
  backups: FileBackup[];
  pendingChanges: PendingChange[];
  conflicts: FileConflict[];
  versions: Map<string, FileVersion[]>;
  watcherEvents: FileWatcherEvent[];
  batchOperations: BatchOperation[];
  config: FileManagementConfig;
  isProcessing: boolean;
  lastSyncTime: Date;
}

export interface FileOperationResult {
  success: boolean;
  operation: SafeFileOperation;
  backup?: FileBackup;
  conflict?: FileConflict;
  error?: string;
}

export interface FileDiff {
  filePath: string;
  additions: number;
  deletions: number;
  modifications: number;
  hunks: DiffHunk[];
  summary: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  lineNumber: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileRecovery {
  id: string;
  filePath: string;
  recoveryType: 'backup' | 'version' | 'auto_save';
  recoveredContent: string;
  timestamp: Date;
  success: boolean;
}

export interface SyncStatus {
  lastSync: Date;
  pendingCount: number;
  conflictCount: number;
  backupCount: number;
  isHealthy: boolean;
  issues: string[];
}
