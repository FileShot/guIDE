# Technical Specifications

## System Architecture

### High-Level Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Menu     │  │   Windows   │  │   File Dialogs      │  │
│  │ Management  │  │ Management  │  │   Management       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                │
                                │ IPC Communication
                                │
┌─────────────────────────────────────────────────────────────┐
│                  Renderer Process (React)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   File      │  │    Code     │  │       Chat          │  │
│  │ Explorer    │  │   Editor    │  │      Panel          │  │
│  │             │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                │
                                │ HTTP/WebSocket
                                │
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   File      │  │    LLM      │  │      Task           │  │
│  │  System     │  │ Interface   │  │      Queue          │  │
│  │  Service    │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                │
                                │ File System / Network
                                │
┌─────────────────────────────────────────────────────────────┐
│              External Resources                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Local     │  │   Local     │  │      Temp           │  │
│  │  Files      │  │    LLM      │  │     Folder          │  │
│  │             │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

### File Operations Flow
```
User Action → React Component → File System Service → Node.js fs → Local Files
     ↑                                                      ↓
     └─────────── UI Update ← File Content ← File Read ──────┘
```

### LLM Integration Flow
```
User Input → Chat Panel → LLM Interface → Local LLM API → AI Response
     ↑                                                      ↓
     └────────── UI Update ← Response Handler ← Parsed Response ──┘
```

### Task Processing Flow
```
Task Request → Task Queue → Processor → File System/LLM → Result
     ↑                                                    ↓
     └───── UI Update ← Status Update ← Task Complete ─────┘
```

## Component Specifications

### File Explorer Component

#### Props Interface
```typescript
interface FileExplorerProps {
  rootPath: string;
  onFileSelect: (file: FileNode) => void;
  onFolderExpand: (folder: FileNode) => void;
  selectedFile?: string;
  expandedFolders: Set<string>;
}

interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
  children?: FileNode[];
  extension?: string;
  isHidden?: boolean;
}
```

#### State Management
```typescript
interface FileExplorerState {
  fileTree: FileNode | null;
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  searchTerm: string;
}
```

#### Methods
- `scanDirectory(path: string): Promise<FileNode>`
- `expandFolder(path: string): Promise<void>`
- `selectFile(path: string): void`
- `searchFiles(query: string): FileNode[]`
- `getFileIcon(extension: string): string`

### Code Editor Component

#### Props Interface
```typescript
interface EditorProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onTabClose: (tabId: string) => void;
  onTabSelect: (tabId: string) => void;
  onContentChange: (tabId: string, content: string) => void;
  onFileSave: (tabId: string) => void;
}

interface EditorTab {
  id: string;
  fileName: string;
  filePath: string;
  content: string;
  language: string;
  isActive: boolean;
  isDirty: boolean;
  isSaved: boolean;
}
```

#### Monaco Editor Configuration
```typescript
interface MonacoConfig {
  theme: 'vs-dark' | 'vs-light' | 'hc-black';
  fontSize: number;
  fontFamily: string;
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  minimap: { enabled: boolean };
  lineNumbers: 'on' | 'off' | 'relative' | 'interval';
  scrollBeyondLastLine: boolean;
}
```

#### Language Detection
```typescript
const languageMap: Record<string, string> = {
  '.js': 'javascript',
  '.ts': 'typescript',
  '.jsx': 'javascript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.md': 'markdown',
  '.py': 'python',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.rb': 'ruby',
  '.sql': 'sql',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch'
};
```

### Chat Panel Component

#### Props Interface
```typescript
interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onClearChat: () => void;
  isLoading: boolean;
  selectedFile?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  relatedFile?: string;
  type?: 'text' | 'code' | 'error';
  metadata?: {
    model?: string;
    tokens?: number;
    processingTime?: number;
  };
}
```

#### Message Types
```typescript
type MessageType = 
  | 'text'
  | 'code'
  | 'file_analysis'
  | 'edit_suggestion'
  | 'error'
  | 'status';

interface CodeBlock {
  language: string;
  code: string;
  fileName?: string;
  action?: 'analyze' | 'edit' | 'create';
}
```

## Service Specifications

### File System Service

#### Core Methods
```typescript
class FileSystemService {
  // Directory operations
  async scanDirectory(path: string, recursive: boolean = true): Promise<FileNode>;
  async createDirectory(path: string): Promise<void>;
  async deleteDirectory(path: string): Promise<void>;
  
  // File operations
  async readFile(path: string): Promise<string>;
  async writeFile(path: string, content: string): Promise<void>;
  async deleteFile(path: string): Promise<void>;
  async copyFile(source: string, destination: string): Promise<void>;
  async moveFile(source: string, destination: string): Promise<void>;
  
  // File metadata
  async getFileStats(path: string): Promise<FileStats>;
  async watchDirectory(path: string, callback: (event: FileEvent) => void): Promise<void>;
  
  // Search functionality
  async searchFiles(path: string, pattern: string): Promise<string[]>;
  async searchInFile(path: string, pattern: string): Promise<SearchResult[]>;
}

interface FileStats {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isFile: boolean;
  isDirectory: boolean;
  permissions: string;
}

interface FileEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
}

interface SearchResult {
  line: number;
  column: number;
  text: string;
  context: string;
}
```

### LLM Interface Service

#### Configuration
```typescript
interface LLMConfig {
  provider: 'ollama' | 'lmstudio' | 'localai' | 'custom';
  endpoint: string;
  model: string;
  apiKey?: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  stopSequences?: string[];
  systemPrompt?: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'content_filter';
  processingTime: number;
}
```

#### API Methods
```typescript
class LLMInterface {
  constructor(config: LLMConfig);
  
  // Chat completion
  async chat(messages: ChatMessage[]): Promise<LLMResponse>;
  
  // Code analysis
  async analyzeCode(code: string, language: string, question?: string): Promise<LLMResponse>;
  
  // Code editing
  async editCode(code: string, instruction: string): Promise<LLMResponse>;
  
  // File operations
  async processFile(filePath: string, instruction: string): Promise<LLMResponse>;
  
  // Batch processing
  async processMultipleFiles(files: FileOperation[]): Promise<LLMResponse[]>;
  
  // Model management
  async listModels(): Promise<string[]>;
  async loadModel(model: string): Promise<void>;
  async unloadModel(model: string): Promise<void>;
}

interface FileOperation {
  filePath: string;
  instruction: string;
  operation: 'analyze' | 'edit' | 'refactor' | 'document';
}
```

### Task Queue Service

#### Task Management
```typescript
interface Task {
  id: string;
  type: 'file-analysis' | 'code-edit' | 'multi-file' | 'llm-request';
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  data: any;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress?: number;
  result?: any;
  error?: string;
  dependencies?: string[];
}

class TaskQueue {
  // Queue management
  addTask(task: Omit<Task, 'id' | 'createdAt'>): string;
  removeTask(taskId: string): boolean;
  getTask(taskId: string): Task | null;
  getAllTasks(): Task[];
  getTasksByStatus(status: Task['status']): Task[];
  
  // Processing
  startProcessing(): void;
  stopProcessing(): void;
  pauseProcessing(): void;
  resumeProcessing(): void;
  
  // Priority handling
  setPriority(taskId: string, priority: number): void;
  reorderTasks(taskIds: string[]): void;
  
  // Events
  onTaskUpdate(callback: (task: Task) => void): void;
  onTaskComplete(callback: (task: Task) => void): void;
  onTaskError(callback: (task: Task, error: Error) => void): void;
}
```

## File Management System

### Safe Write Operations
```typescript
class FileManager {
  // Safe write operations
  async safeWriteFile(filePath: string, content: string): Promise<WriteResult>;
  async previewChanges(filePath: string, newContent: string): Promise<FileDiff>;
  async approveChanges(filePath: string): Promise<void>;
  async rejectChanges(filePath: string): Promise<void>;
  
  // Backup management
  async createBackup(filePath: string): Promise<string>;
  async restoreBackup(filePath: string, backupId: string): Promise<void>;
  async listBackups(filePath: string): Promise<Backup[]>;
  
  // Change tracking
  async getChangeHistory(filePath: string): Promise<ChangeRecord[]>;
  async compareVersions(filePath: string, version1: string, version2: string): Promise<FileDiff>;
}

interface WriteResult {
  success: boolean;
  tempPath: string;
  backupPath?: string;
  changes: FileDiff;
  requiresApproval: boolean;
}

interface FileDiff {
  additions: DiffLine[];
  deletions: DiffLine[];
  modifications: DiffLine[];
  summary: {
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
  };
}

interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'addition' | 'deletion' | 'modification';
}

interface Backup {
  id: string;
  filePath: string;
  backupPath: string;
  createdAt: Date;
  size: number;
}

interface ChangeRecord {
  id: string;
  filePath: string;
  type: 'create' | 'edit' | 'delete' | 'move';
  timestamp: Date;
  description: string;
  backupId?: string;
}
```

## Performance Specifications

### Memory Management
- **File Tree**: Lazy loading, virtual scrolling for large directories
- **Editor**: Tab content caching, unload inactive tabs
- **Chat**: Message pagination, limit history size
- **Tasks**: Queue size limits, automatic cleanup

### File System Optimization
- **Scanning**: Incremental updates, file watching
- **Caching**: Content caching, metadata caching
- **Search**: Indexed search, background indexing
- **Large Files**: Chunked reading, streaming for very large files

### UI Performance
- **React**: Memoization, virtualization, lazy loading
- **Monaco**: Worker threads, deferred loading
- **Rendering**: 60fps target, smooth animations
- **Memory**: <500MB baseline, <1GB with large projects

## Security Specifications

### File System Security
- **Path Validation**: Prevent path traversal attacks
- **Permission Checks**: Verify read/write permissions
- **Sandboxing**: Restrict file access to project directory
- **Backup Security**: Encrypt sensitive backups

### LLM Integration Security
- **Input Validation**: Sanitize user inputs
- **Output Filtering**: Filter potentially harmful responses
- **Model Isolation**: Run models in isolated environment
- **Data Privacy**: No data sent to external services

### Application Security
- **Code Signing**: Sign executables for distribution
- **Updates**: Secure update mechanism
- **Local Storage**: Encrypt sensitive configuration
- **Network**: Validate all external connections

## Error Handling Specifications

### Error Categories
```typescript
enum ErrorCategory {
  FILE_SYSTEM = 'file_system',
  LLM_INTERFACE = 'llm_interface',
  TASK_PROCESSING = 'task_processing',
  UI_RENDERING = 'ui_rendering',
  NETWORK = 'network',
  VALIDATION = 'validation'
}

interface AppError {
  id: string;
  category: ErrorCategory;
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  stack?: string;
  recoverable: boolean;
  userMessage: string;
}
```

### Recovery Strategies
- **File System**: Retry operations, fallback to backup
- **LLM Interface**: Reconnect, try alternative models
- **Task Processing**: Restart failed tasks, skip problematic files
- **UI**: Graceful degradation, error boundaries

### Logging Specifications
- **Levels**: Debug, Info, Warning, Error, Critical
- **Storage**: Local files, rotation, size limits
- **Format**: Structured JSON, timestamps, context
- **Privacy**: Sanitize sensitive information
