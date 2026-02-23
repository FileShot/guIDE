import type { 
  SafeFileOperation, 
  FileBackup, 
  PendingChange, 
  FileConflict,
  FileVersion,
  FileManagementConfig,
  FileOperationResult,
  FileRecovery,
  SyncStatus
} from '@/types/fileManagement';
import { fileSystemService } from './fileSystem';
import { generateId } from '@/utils/helpers';

// Browser-safe path utilities (no Node.js path module in renderer)
const pathUtils = {
  dirname(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? '.' : normalized.substring(0, lastSlash);
  },
  basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? p : normalized.substring(lastSlash + 1);
  },
  join(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
  }
};

// Browser-safe checksum (no Node.js crypto in renderer)
async function calculateChecksumAsync(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple hash
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function getByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

export class FileManagementService {
  private pendingOperations: Map<string, SafeFileOperation> = new Map();
  private completedOperations: Map<string, SafeFileOperation> = new Map();
  private backups: Map<string, FileBackup[]> = new Map();
  private pendingChanges: Map<string, PendingChange[]> = new Map();
  private conflicts: Map<string, FileConflict> = new Map();
  private versions: Map<string, FileVersion[]> = new Map();
  private config: FileManagementConfig;
  private isProcessing: boolean = false;
  private lastSyncTime: Date = new Date();
  private watcher: any = null;

  constructor() {
    this.config = this.getDefaultConfig();
    this.initializeWatcher();
    this.startAutoSave();
  }

  private getDefaultConfig(): FileManagementConfig {
    return {
      backupEnabled: true,
      backupLocation: './_new/backups',
      maxBackups: 10,
      autoSave: true,
      autoSaveInterval: 30000, // 30 seconds
      conflictResolution: 'prompt',
      versionControl: true,
      maxVersions: 50,
      externalChangesHandling: 'prompt'
    };
  }

  private initializeWatcher(): void {
    // File system watcher will be initialized when a project is opened
  }

  private startAutoSave(): void {
    if (!this.config.autoSave) return;

    setInterval(() => {
      this.processPendingChanges();
    }, this.config.autoSaveInterval);
  }

  async createFile(filePath: string, content: string): Promise<FileOperationResult> {
    const operation: SafeFileOperation = {
      id: generateId(),
      type: 'create',
      status: 'pending',
      filePath,
      newContent: content,
      timestamp: new Date()
    };

    this.pendingOperations.set(operation.id, operation);

    try {
      // Create backup directory if needed
      await this.ensureBackupDirectory();

      // Check for conflicts
      const conflict = await this.checkForConflict(operation);
      if (conflict) {
        operation.status = 'failed';
        operation.error = 'File already exists';
        this.conflicts.set(conflict.id, conflict);
        return {
          success: false,
          operation,
          conflict
        };
      }

      operation.status = 'in_progress';

      // Create backup if file exists
      let backup: FileBackup | undefined;
      if (await fileSystemService.fileExists(filePath)) {
        const originalContent = await fileSystemService.readFile(filePath);
        backup = await this.createBackup(filePath, originalContent, 'create');
        operation.backupPath = backup.backupPath;
      }

      // Write to _new folder first
      const newPath = this.getNewPath(filePath);
      await this.writeToNewFolder(newPath, content);

      // Move to final location
      await this.moveFromNewFolder(newPath, filePath);

      operation.status = 'completed';
      this.completedOperations.set(operation.id, operation);
      this.pendingOperations.delete(operation.id);

      // Create version
      if (this.config.versionControl) {
        await this.createVersion(filePath, content, 'File created');
      }

      return {
        success: true,
        operation,
        backup
      };

    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        operation,
        error: operation.error
      };
    }
  }

  async updateFile(filePath: string, content: string): Promise<FileOperationResult> {
    const operation: SafeFileOperation = {
      id: generateId(),
      type: 'update',
      status: 'pending',
      filePath,
      newContent: content,
      timestamp: new Date()
    };

    this.pendingOperations.set(operation.id, operation);

    try {
      await this.ensureBackupDirectory();

      // Check if file exists
      if (!await fileSystemService.fileExists(filePath)) {
        operation.status = 'failed';
        operation.error = 'File does not exist';
        return {
          success: false,
          operation,
          error: operation.error
        };
      }

      operation.status = 'in_progress';

      // Read original content
      const originalContent = await fileSystemService.readFile(filePath);
      
      // Check for external changes
      const hasExternalChanges = await this.checkExternalChanges(filePath, originalContent);
      if (hasExternalChanges) {
        const conflict = await this.createConflict(filePath, originalContent, content, 'content');
        this.conflicts.set(conflict.id, conflict);
        operation.status = 'failed';
        operation.error = 'External changes detected';
        return {
          success: false,
          operation,
          conflict
        };
      }

      // Create backup
      const backup = await this.createBackup(filePath, originalContent, 'update');
      operation.backupPath = backup.backupPath;

      // Write to _new folder
      const newPath = this.getNewPath(filePath);
      await this.writeToNewFolder(newPath, content);

      // Move to final location
      await this.moveFromNewFolder(newPath, filePath);

      operation.status = 'completed';
      this.completedOperations.set(operation.id, operation);
      this.pendingOperations.delete(operation.id);

      // Create version
      if (this.config.versionControl) {
        await this.createVersion(filePath, content, 'File updated');
      }

      return {
        success: true,
        operation,
        backup
      };

    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        operation,
        error: operation.error
      };
    }
  }

  async deleteFile(filePath: string): Promise<FileOperationResult> {
    const operation: SafeFileOperation = {
      id: generateId(),
      type: 'delete',
      status: 'pending',
      filePath,
      timestamp: new Date()
    };

    this.pendingOperations.set(operation.id, operation);

    try {
      await this.ensureBackupDirectory();

      // Check if file exists
      if (!await fileSystemService.fileExists(filePath)) {
        operation.status = 'failed';
        operation.error = 'File does not exist';
        return {
          success: false,
          operation,
          error: operation.error
        };
      }

      operation.status = 'in_progress';

      // Create backup before deletion
      const originalContent = await fileSystemService.readFile(filePath);
      const backup = await this.createBackup(filePath, originalContent, 'delete');
      operation.backupPath = backup.backupPath;

      // Move to _new folder first (soft delete)
      const newPath = this.getNewPath(filePath);
      await this.moveFromNewFolder(filePath, newPath);

      operation.status = 'completed';
      this.completedOperations.set(operation.id, operation);
      this.pendingOperations.delete(operation.id);

      return {
        success: true,
        operation,
        backup
      };

    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        operation,
        error: operation.error
      };
    }
  }

  async moveFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
    const operation: SafeFileOperation = {
      id: generateId(),
      type: 'move',
      status: 'pending',
      filePath: newPath,
      originalPath: oldPath,
      timestamp: new Date()
    };

    this.pendingOperations.set(operation.id, operation);

    try {
      await this.ensureBackupDirectory();

      // Check if source exists
      if (!await fileSystemService.fileExists(oldPath)) {
        operation.status = 'failed';
        operation.error = 'Source file does not exist';
        return {
          success: false,
          operation,
          error: operation.error
        };
      }

      operation.status = 'in_progress';

      // Check for conflicts at destination
      if (await fileSystemService.fileExists(newPath)) {
        const conflict = await this.createConflict(newPath, '', '', 'existence');
        this.conflicts.set(conflict.id, conflict);
        operation.status = 'failed';
        operation.error = 'Destination file already exists';
        return {
          success: false,
          operation,
          conflict
        };
      }

      // Create backup of original location
      const originalContent = await fileSystemService.readFile(oldPath);
      const backup = await this.createBackup(oldPath, originalContent, 'move');
      operation.backupPath = backup.backupPath;

      // Move via _new folder
      const tempNewPath = this.getNewPath(oldPath);
      const tempOldPath = this.getNewPath(newPath);
      
      await this.moveFromNewFolder(oldPath, tempNewPath);
      await this.moveFromNewFolder(tempNewPath, tempOldPath);
      await this.moveFromNewFolder(tempOldPath, newPath);

      operation.status = 'completed';
      this.completedOperations.set(operation.id, operation);
      this.pendingOperations.delete(operation.id);

      return {
        success: true,
        operation,
        backup
      };

    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        operation,
        error: operation.error
      };
    }
  }

  async copyFile(sourcePath: string, destPath: string): Promise<FileOperationResult> {
    const operation: SafeFileOperation = {
      id: generateId(),
      type: 'copy',
      status: 'pending',
      filePath: destPath,
      originalPath: sourcePath,
      timestamp: new Date()
    };

    this.pendingOperations.set(operation.id, operation);

    try {
      await this.ensureBackupDirectory();

      // Check if source exists
      if (!await fileSystemService.fileExists(sourcePath)) {
        operation.status = 'failed';
        operation.error = 'Source file does not exist';
        return {
          success: false,
          operation,
          error: operation.error
        };
      }

      operation.status = 'in_progress';

      // Check for conflicts at destination
      if (await fileSystemService.fileExists(destPath)) {
        const conflict = await this.createConflict(destPath, '', '', 'existence');
        this.conflicts.set(conflict.id, conflict);
        operation.status = 'failed';
        operation.error = 'Destination file already exists';
        return {
          success: false,
          operation,
          conflict
        };
      }

      // Copy content
      const content = await fileSystemService.readFile(sourcePath);
      const newDestPath = this.getNewPath(destPath);
      await this.writeToNewFolder(newDestPath, content);
      await this.moveFromNewFolder(newDestPath, destPath);

      operation.status = 'completed';
      this.completedOperations.set(operation.id, operation);
      this.pendingOperations.delete(operation.id);

      return {
        success: true,
        operation
      };

    } catch (error) {
      operation.status = 'failed';
      operation.error = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        operation,
        error: operation.error
      };
    }
  }

  private async ensureBackupDirectory(): Promise<void> {
    const backupDir = this.config.backupLocation;
    if (!await fileSystemService.directoryExists(backupDir)) {
      await fileSystemService.createDirectory(backupDir);
    }
  }

  private getNewPath(originalPath: string): string {
    const dir = pathUtils.dirname(originalPath);
    const filename = pathUtils.basename(originalPath);
    const newDir = pathUtils.join(dir, '_new');
    return pathUtils.join(newDir, filename);
  }

  private async writeToNewFolder(filePath: string, content: string): Promise<void> {
    const newPath = this.getNewPath(filePath);
    const newDir = pathUtils.dirname(newPath);
    
    if (!await fileSystemService.directoryExists(newDir)) {
      await fileSystemService.createDirectory(newDir);
    }
    
    await fileSystemService.writeFile(newPath, content);
  }

  private async moveFromNewFolder(fromPath: string, toPath: string): Promise<void> {
    await fileSystemService.moveFile(fromPath, toPath);
  }

  private async createBackup(filePath: string, content: string, operation: SafeFileOperation['type']): Promise<FileBackup> {
    const backupId = generateId();
    const backupPath = pathUtils.join(this.config.backupLocation, `${pathUtils.basename(filePath)}.${backupId}.backup`);
    
    const backup: FileBackup = {
      id: backupId,
      originalPath: filePath,
      backupPath,
      timestamp: new Date(),
      operation,
      content,
      metadata: {
        size: getByteLength(content),
        checksum: await calculateChecksumAsync(content),
        encoding: 'utf8',
        lineEnding: this.detectLineEnding(content)
      }
    };

    await fileSystemService.writeFile(backupPath, content);
    
    const fileBackups = this.backups.get(filePath) || [];
    fileBackups.push(backup);
    
    // Limit backup count
    if (fileBackups.length > this.config.maxBackups) {
      const oldestBackup = fileBackups.shift();
      if (oldestBackup) {
        await fileSystemService.deleteFile(oldestBackup.backupPath);
      }
    }
    
    this.backups.set(filePath, fileBackups);
    return backup;
  }

  private async checkForConflict(operation: SafeFileOperation): Promise<FileConflict | null> {
    if (operation.type === 'create' && await fileSystemService.fileExists(operation.filePath)) {
      return this.createConflict(operation.filePath, '', operation.newContent || '', 'existence');
    }
    return null;
  }

  private async createConflict(filePath: string, originalContent: string, newContent: string, type: FileConflict['type']): Promise<FileConflict> {
    const conflict: FileConflict = {
      id: generateId(),
      filePath,
      type,
      originalContent,
      newContent,
      timestamp: new Date()
    };

    if (await fileSystemService.fileExists(filePath)) {
      conflict.currentContent = await fileSystemService.readFile(filePath);
    }

    return conflict;
  }

  private async checkExternalChanges(filePath: string, expectedContent: string): Promise<boolean> {
    if (!await fileSystemService.fileExists(filePath)) return false;
    
    const currentContent = await fileSystemService.readFile(filePath);
    const expectedChecksum = await calculateChecksumAsync(expectedContent);
    const currentChecksum = await calculateChecksumAsync(currentContent);
    
    return expectedChecksum !== currentChecksum;
  }

  private detectLineEnding(content: string): string {
    if (content.includes('\r\n')) return 'CRLF';
    if (content.includes('\r')) return 'CR';
    return 'LF';
  }

  private async createVersion(filePath: string, content: string, message: string): Promise<FileVersion> {
    const versions = this.versions.get(filePath) || [];
    const versionNumber = versions.length + 1;
    
    const version: FileVersion = {
      id: generateId(),
      filePath,
      version: versionNumber,
      timestamp: new Date(),
      content,
      message,
      metadata: {
        size: getByteLength(content),
        lines: content.split('\n').length,
        checksum: await calculateChecksumAsync(content)
      }
    };

    versions.push(version);
    
    // Limit version count
    if (versions.length > this.config.maxVersions) {
      versions.shift();
    }
    
    this.versions.set(filePath, versions);
    return version;
  }

  private async processPendingChanges(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    try {
      // Process all pending changes
      for (const [_filePath, changes] of this.pendingChanges) {
        for (const change of changes) {
          if (!change.applied) {
            await this.applyPendingChange(change);
          }
        }
      }
      
      this.lastSyncTime = new Date();
    } finally {
      this.isProcessing = false;
    }
  }

  private async applyPendingChange(change: PendingChange): Promise<void> {
    try {
      switch (change.operation) {
        case 'create':
          if (change.newContent) {
            await this.createFile(change.filePath, change.newContent);
          }
          break;
        case 'update':
          if (change.newContent) {
            await this.updateFile(change.filePath, change.newContent);
          }
          break;
        case 'delete':
          await this.deleteFile(change.filePath);
          break;
      }
      
      change.applied = true;
    } catch (error) {
      change.conflict = true;
      change.conflictReason = error instanceof Error ? error.message : 'Unknown error';
    }
  }

  // Public API methods
  async getBackup(filePath: string, backupId: string): Promise<FileBackup | null> {
    const backups = this.backups.get(filePath) || [];
    return backups.find(backup => backup.id === backupId) || null;
  }

  async restoreFromBackup(filePath: string, backupId: string): Promise<FileRecovery> {
    const backup = await this.getBackup(filePath, backupId);
    if (!backup) {
      return {
        id: generateId(),
        filePath,
        recoveryType: 'backup',
        recoveredContent: '',
        timestamp: new Date(),
        success: false
      };
    }

    try {
      await fileSystemService.writeFile(filePath, backup.content);
      return {
        id: generateId(),
        filePath,
        recoveryType: 'backup',
        recoveredContent: backup.content,
        timestamp: new Date(),
        success: true
      };
    } catch (error) {
      return {
        id: generateId(),
        filePath,
        recoveryType: 'backup',
        recoveredContent: '',
        timestamp: new Date(),
        success: false
      };
    }
  }

  async getVersions(filePath: string): Promise<FileVersion[]> {
    return this.versions.get(filePath) || [];
  }

  async restoreFromVersion(filePath: string, versionId: string): Promise<FileRecovery> {
    const versions = await this.getVersions(filePath);
    const version = versions.find(v => v.id === versionId);
    
    if (!version) {
      return {
        id: generateId(),
        filePath,
        recoveryType: 'version',
        recoveredContent: '',
        timestamp: new Date(),
        success: false
      };
    }

    try {
      await fileSystemService.writeFile(filePath, version.content);
      return {
        id: generateId(),
        filePath,
        recoveryType: 'version',
        recoveredContent: version.content,
        timestamp: new Date(),
        success: true
      };
    } catch (error) {
      return {
        id: generateId(),
        filePath,
        recoveryType: 'version',
        recoveredContent: '',
        timestamp: new Date(),
        success: false
      };
    }
  }

  getSyncStatus(): SyncStatus {
    return {
      lastSync: this.lastSyncTime,
      pendingCount: this.pendingOperations.size,
      conflictCount: this.conflicts.size,
      backupCount: Array.from(this.backups.values()).reduce((sum, backups) => sum + backups.length, 0),
      isHealthy: this.conflicts.size === 0 && !this.isProcessing,
      issues: []
    };
  }

  updateConfig(newConfig: Partial<FileManagementConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): FileManagementConfig {
    return { ...this.config };
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

// Singleton instance
export const fileManagementService = new FileManagementService();
