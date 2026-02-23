import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FILE_ICONS, LANGUAGE_MAP, IGNORED_PATTERNS } from './constants';
import type { FileNode, FileSortOptions, FileFilter } from '@/types/file';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getFileIcon(fileName: string, isDirectory: boolean = false): string {
  if (isDirectory) {
    return fileName.startsWith('.') ? FILE_ICONS.folderHidden : FILE_ICONS.folder;
  }
  
  const extension = getFileExtension(fileName);
  return FILE_ICONS[extension as keyof typeof FILE_ICONS] || FILE_ICONS.default;
}

export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return '';
  }
  return fileName.substring(lastDot + 1).toLowerCase();
}

export function getLanguageFromExtension(fileName: string): string {
  const extension = '.' + getFileExtension(fileName);
  return LANGUAGE_MAP[extension] || 'plaintext';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function sortFiles(files: FileNode[], options: FileSortOptions): FileNode[] {
  const { sortBy, sortOrder, foldersFirst, showHidden } = options;
  
  let filteredFiles = files.filter(file => {
    if (!showHidden && file.isHidden) return false;
    return true;
  });
  
  return filteredFiles.sort((a, b) => {
    // Folders first
    if (foldersFirst) {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
    }
    
    let comparison = 0;
    
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        break;
      case 'size':
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case 'modified':
        comparison = (a.modified?.getTime() || 0) - (b.modified?.getTime() || 0);
        break;
      case 'type':
        comparison = (a.extension || '').localeCompare(b.extension || '');
        break;
    }
    
    return sortOrder === 'desc' ? -comparison : comparison;
  });
}

export function filterFiles(files: FileNode[], filter: FileFilter): FileNode[] {
  return files.filter(file => {
    // Extension filter
    if (filter.extensions && filter.extensions.length > 0) {
      if (file.type === 'file' && file.extension) {
        if (!filter.extensions.includes(file.extension)) {
          return false;
        }
      }
    }
    
    // Pattern filter
    if (filter.pattern) {
      if (!filter.pattern.test(file.name)) {
        return false;
      }
    }
    
    // Size filter
    if (filter.minSize && file.size && file.size < filter.minSize) {
      return false;
    }
    
    if (filter.maxSize && file.size && file.size > filter.maxSize) {
      return false;
    }
    
    // Date filter
    if (filter.modifiedAfter && file.modified && file.modified < filter.modifiedAfter) {
      return false;
    }
    
    if (filter.modifiedBefore && file.modified && file.modified > filter.modifiedBefore) {
      return false;
    }
    
    return true;
  });
}

export function shouldIgnoreFile(path: string, name: string): boolean {
  const fullPath = path + '/' + name;
  
  return IGNORED_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(name) || regex.test(fullPath);
    }
    return name === pattern || fullPath.includes(pattern);
  });
}

export function buildFileTree(items: any[], _parentPath: string = ''): FileNode[] {
  const tree: FileNode[] = [];
  
  for (const item of items) {
    if (shouldIgnoreFile(item.path || '', item.name)) {
      continue;
    }

    // Support both `type` field and `isDirectory`/`isFile` booleans
    const nodeType: 'file' | 'directory' = item.type
      ? item.type
      : item.isDirectory
      ? 'directory'
      : 'file';
    
    const node: FileNode = {
      id: generateId(),
      name: item.name,
      path: item.path,
      type: nodeType,
      size: item.size,
      modified: item.modified ? new Date(item.modified) : undefined,
      created: item.created ? new Date(item.created) : undefined,
      isHidden: item.isHidden || item.name.startsWith('.'),
      extension: nodeType === 'file' ? getFileExtension(item.name) : undefined,
    };
    
    if (nodeType === 'directory') {
      node.children = [];
    }
    
    tree.push(node);
  }
  
  return tree;
}

export function findFileInTree(tree: FileNode[], path: string): FileNode | null {
  for (const node of tree) {
    if (node.path === path) {
      return node;
    }
    
    if (node.children) {
      const found = findFileInTree(node.children, path);
      if (found) return found;
    }
  }
  
  return null;
}

export function updateFileInTree(tree: FileNode[], path: string, updates: Partial<FileNode>): FileNode[] {
  return tree.map(node => {
    if (node.path === path) {
      return { ...node, ...updates };
    }
    
    if (node.children) {
      return {
        ...node,
        children: updateFileInTree(node.children, path, updates)
      };
    }
    
    return node;
  });
}

export function removeFileFromTree(tree: FileNode[], path: string): FileNode[] {
  return tree.filter(node => node.path !== path).map(node => {
    if (node.children) {
      return {
        ...node,
        children: removeFileFromTree(node.children, path)
      };
    }
    return node;
  });
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function isValidPath(path: string): boolean {
  // Basic path validation
  if (!path || typeof path !== 'string') return false;
  
  // Check for invalid characters (Windows)
  const invalidChars = /[<>:"|?*]/;
  if (invalidChars.test(path)) return false;
  
  // Check for reserved names (Windows)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  if (reservedNames.test(path)) return false;
  
  return true;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function getRelativePath(from: string, to: string): string {
  const fromParts = normalizePath(from).split('/');
  const toParts = normalizePath(to).split('/');
  
  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }
  
  // Build relative path
  const upLevels = fromParts.length - commonLength - 1;
  const relativeParts = Array(upLevels).fill('..').concat(toParts.slice(commonLength));
  
  return relativeParts.join('/') || '.';
}
