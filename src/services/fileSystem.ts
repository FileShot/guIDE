import type { FileNode, FileStats, FileEvent, FileWatcher, SearchResult, SearchMatch, FileFilter } from '@/types/file';
import { generateId, buildFileTree } from '@/utils/helpers';

export class FileSystemService {
  private watchers: Map<string, FileWatcher> = new Map();
  private eventListeners: Map<string, ((event: FileEvent) => void)[]> = new Map();

  async scanDirectory(path: string, recursive: boolean = true): Promise<FileNode[]> {
    try {
      const result = await window.electronAPI.readDirectory(path);
      
      if (!result.success || !result.items) {
        throw new Error(result.error || 'Failed to read directory');
      }

      const fileTree = buildFileTree(result.items, path);
      
      if (recursive) {
        for (const node of fileTree) {
          if (node.type === 'directory') {
            try {
              node.children = await this.scanDirectory(node.path, true);
            } catch (error) {
              console.warn(`Failed to scan directory ${node.path}:`, error);
              node.children = [];
            }
          }
        }
      }

      return fileTree;
    } catch (error) {
      console.error('Error scanning directory:', error);
      throw error;
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      const result = await window.electronAPI.readFile(path);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to read file');
      }
      
      return result.content || '';
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      const result = await window.electronAPI.writeFile(path, content);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to write file');
      }
    } catch (error) {
      console.error('Error writing file:', error);
      throw error;
    }
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.fileExists(path);
      return result?.exists ?? false;
    } catch {
      return false;
    }
  }

  async directoryExists(path: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.getFileStats(path);
      return result?.success && result?.isDirectory === true;
    } catch {
      return false;
    }
  }
  async getFileStats(path: string): Promise<FileStats> {
    try {
      const result = await window.electronAPI.getFileStats(path);
      
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to get file stats');
      }

      return {
        size: result.size || 0,
        created: result.mtime ? new Date(result.mtime) : new Date(),
        modified: result.mtime ? new Date(result.mtime) : new Date(),
        accessed: result.mtime ? new Date(result.mtime) : new Date(),
        isFile: result.isFile ?? false,
        isDirectory: result.isDirectory ?? false,
        permissions: 'rw-r--r--'
      };
    } catch (error) {
      console.error('Error getting file stats:', error);
      throw error;
    }
  }

  watchDirectory(path: string, callback: (event: FileEvent) => void): FileWatcher {
    const watcherId = generateId();
    
    // In a real implementation, we'd use Node.js fs.watch or chokidar
    // For now, we'll simulate with polling
    let previousState = new Map<string, { modified: Date; size: number }>();
    
    const poll = async () => {
      try {
        const result = await window.electronAPI.readDirectory(path);
        
        if (result.success && result.items) {
          const currentState = new Map();
          
          for (const item of result.items) {
            currentState.set(item.path, {
              modified: new Date(item.modified || Date.now()),
              size: item.size || 0
            });
          }
          
          // Check for changes
          for (const [filePath, current] of currentState) {
            const previous = previousState.get(filePath);
            
            if (!previous) {
              // File created
              callback({
                type: 'created',
                path: filePath,
                timestamp: new Date()
              });
            } else if (current.modified > previous.modified || current.size !== previous.size) {
              // File modified
              callback({
                type: 'modified',
                path: filePath,
                timestamp: new Date()
              });
            }
          }
          
          // Check for deletions
          for (const [filePath] of previousState) {
            if (!currentState.has(filePath)) {
              callback({
                type: 'deleted',
                path: filePath,
                timestamp: new Date()
              });
            }
          }
          
          previousState = currentState;
        }
      } catch (error) {
        console.error('Error watching directory:', error);
      }
    };
    
    // Start polling
    const intervalId = setInterval(poll, 1000);
    
    // Initial scan
    poll();
    
    const watcher: FileWatcher = {
      path,
      callback,
      dispose: () => {
        clearInterval(intervalId);
        this.watchers.delete(watcherId);
      }
    };
    
    this.watchers.set(watcherId, watcher);
    
    return watcher;
  }

  async searchFiles(path: string, pattern: string, filter?: FileFilter): Promise<SearchResult[]> {
    try {
      const files = await this.scanDirectory(path, true);
      const results: SearchResult[] = [];
      const regex = new RegExp(pattern, 'gi');
      
      const searchInFile = async (fileNode: FileNode): Promise<void> => {
        if (fileNode.type === 'file') {
          // Apply filter if provided
          if (filter) {
            const fileMatches = [fileNode].filter(_file => {
              if (filter.extensions && filter.extensions.length > 0) {
                if (fileNode.type === 'file' && fileNode.extension) {
                  if (!filter.extensions.includes(fileNode.extension)) {
                    return false;
                  }
                }
              }
              
              if (filter.pattern && !filter.pattern.test(fileNode.name)) {
                return false;
              }
              
              return true;
            });
            
            if (fileMatches.length === 0) return;
          }
          
          try {
            const content = await this.readFile(fileNode.path);
            const lines = content.split('\\n');
            const matches: SearchMatch[] = [];
            
            lines.forEach((line, index) => {
              let match;
              while ((match = regex.exec(line)) !== null) {
                matches.push({
                  line: index + 1,
                  column: match.index + 1,
                  text: match[0],
                  context: line.trim(),
                  matchLength: match[0].length
                });
              }
            });
            
            if (matches.length > 0) {
              results.push({
                file: fileNode.path,
                matches
              });
            }
          } catch (error) {
            console.warn(`Could not search in file ${fileNode.path}:`, error);
          }
        } else if (fileNode.children) {
          for (const child of fileNode.children) {
            await searchInFile(child);
          }
        }
      };
      
      for (const file of files) {
        await searchInFile(file);
      }
      
      return results;
    } catch (error) {
      console.error('Error searching files:', error);
      throw error;
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.createDirectory) {
      const result = await api.createDirectory(dirPath);
      if (!result.success) throw new Error(result.error || 'Failed to create directory');
    } else {
      throw new Error('File system API not available');
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.deleteFile) {
      const result = await api.deleteFile(filePath);
      if (!result.success) throw new Error(result.error || 'Failed to delete file');
    } else {
      throw new Error('File system API not available');
    }
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.deleteDirectory) {
      const result = await api.deleteDirectory(dirPath);
      if (!result.success) throw new Error(result.error || 'Failed to delete directory');
    } else {
      throw new Error('File system API not available');
    }
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.copyFile) {
      const result = await api.copyFile(source, destination);
      if (!result.success) throw new Error(result.error || 'Failed to copy file');
    } else {
      throw new Error('File system API not available');
    }
  }

  async moveFile(source: string, destination: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.moveFile) {
      const result = await api.moveFile(source, destination);
      if (!result.success) throw new Error(result.error || 'Failed to move file');
    } else {
      throw new Error('File system API not available');
    }
  }

  addEventListener(event: 'file-changed', callback: (event: FileEvent) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  removeEventListener(event: 'file-changed', callback: (event: FileEvent) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  dispose(): void {
    // Clean up all watchers
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this.eventListeners.clear();
  }
}

// Singleton instance
export const fileSystemService = new FileSystemService();
