export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
  created?: Date;
  children?: FileNode[];
  extension?: string;
  isHidden?: boolean;
  parent?: FileNode;
  level?: number;
}

export interface FileStats {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isFile: boolean;
  isDirectory: boolean;
  permissions: string;
}

export interface FileEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
  timestamp: Date;
}

export interface SearchResult {
  file: string;
  matches: SearchMatch[];
}

export interface SearchMatch {
  line: number;
  column: number;
  text: string;
  context: string;
  matchLength: number;
}

export interface FileOperation {
  type: 'create' | 'read' | 'update' | 'delete' | 'move' | 'copy';
  source?: string;
  destination?: string;
  content?: string;
  timestamp: Date;
}

export interface FileWatcher {
  path: string;
  callback: (event: FileEvent) => void;
  dispose: () => void;
}

export type FileSortBy = 'name' | 'size' | 'modified' | 'type';
export type SortOrder = 'asc' | 'desc';

export interface FileSortOptions {
  sortBy: FileSortBy;
  sortOrder: SortOrder;
  foldersFirst: boolean;
  showHidden: boolean;
}

export interface FileFilter {
  extensions?: string[];
  pattern?: RegExp;
  minSize?: number;
  maxSize?: number;
  modifiedAfter?: Date;
  modifiedBefore?: Date;
}
