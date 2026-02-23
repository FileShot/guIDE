export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  relatedFile?: string;
  type?: 'text' | 'code' | 'error' | 'system';
  metadata?: {
    model?: string;
    tokens?: number;
    processingTime?: number;
    temperature?: number;
    maxTokens?: number;
  };
  codeBlocks?: CodeBlock[];
}

export interface CodeBlock {
  id: string;
  language: string;
  code: string;
  fileName?: string;
  action?: 'analyze' | 'edit' | 'create' | 'replace';
  explanation?: string;
  canApply?: boolean;
  applied?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  model?: string;
  context?: ChatContext;
}

export interface ChatContext {
  currentFile?: string;
  selectedCode?: string;
  openFiles?: string[];
  projectPath?: string;
  language?: string;
}

export interface LLMConfig {
  provider: 'local-gguf' | 'ollama' | 'lmstudio' | 'custom';
  modelPath?: string;
  endpoint?: string;
  model: string;
  parameters: {
    temperature: number;
    maxTokens: number;
    topP: number;
    topK: number;
    repeatPenalty: number;
    stopSequences?: string[];
  };
  contextWindow: number;
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'content_filter';
  processingTime: number;
  metadata?: any;
}

export interface ChatCommand {
  id: string;
  name: string;
  description: string;
  category: 'analysis' | 'editing' | 'generation' | 'utility';
  parameters?: CommandParameter[];
  handler: (params: any, context: ChatContext) => Promise<string>;
}

export interface CommandParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file' | 'code';
  description: string;
  required: boolean;
  default?: any;
}

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  config: LLMConfig;
  isConnected: boolean;
  availableCommands: ChatCommand[];
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  command: string;
  description: string;
  category: 'code' | 'file' | 'analysis';
}

export interface ChatSuggestion {
  type: 'command' | 'file' | 'code';
  text: string;
  description?: string;
  action?: () => void;
}

export interface ModelInfo {
  name: string;
  path: string;
  size: number;
  contextWindow: number;
  supportedFormats: string[];
  description?: string;
}

export interface ChatHistory {
  sessions: ChatSession[];
  globalSettings: {
    theme: 'light' | 'dark' | 'auto';
    fontSize: number;
    maxHistoryItems: number;
    autoSave: boolean;
  };
}

export interface FileAnalysis {
  filePath: string;
  language: string;
  summary: string;
  functions: FunctionInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  issues: CodeIssue[];
  complexity: number;
  linesOfCode: number;
}

export interface FunctionInfo {
  name: string;
  line: number;
  parameters: ParameterInfo[];
  returnType?: string;
  description?: string;
  complexity: number;
}

export interface ParameterInfo {
  name: string;
  type?: string;
  optional: boolean;
  description?: string;
}

export interface ImportInfo {
  module: string;
  line: number;
  isExternal: boolean;
  imports: string[];
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'type';
  line: number;
  isDefault: boolean;
}

export interface CodeIssue {
  type: 'error' | 'warning' | 'info';
  line: number;
  column: number;
  message: string;
  severity: number;
  rule?: string;
}

export interface RefactoringSuggestion {
  id: string;
  type: 'extract' | 'rename' | 'inline' | 'simplify' | 'optimize';
  title: string;
  description: string;
  originalCode: string;
  suggestedCode: string;
  line: number;
  confidence: number;
  canAutoApply: boolean;
}

export interface CodeGenerationRequest {
  type: 'function' | 'class' | 'test' | 'documentation' | 'comment';
  language: string;
  context: string;
  requirements: string;
  style?: string;
  framework?: string;
}

export interface CodeGenerationResult {
  code: string;
  explanation: string;
  language: string;
  confidence: number;
  alternatives?: string[];
}
