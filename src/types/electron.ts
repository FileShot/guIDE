/* ─── Global Type Declarations for Electron IPC Bridge ─── */
export {};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// ── Service-layer types ──
export interface MenuEvent {
  type: string;
  data?: any;
}

export interface DialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: { name: string; extensions: string[] }[];
  properties?: string[];
  message?: string;
}

export interface AppSettings {
  theme: string;
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  autoSave: boolean;
  autoSaveInterval: number;
  showMinimap: boolean;
  showLineNumbers: boolean;
  renderWhitespace: string;
  [key: string]: any;
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: Date;
}

export interface ElectronAPI {
  // App Info
  getAppVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  getHomeDir(): Promise<string>;
  getAppPath(): Promise<string>;
  getSystemInfo(): Promise<SystemInfo>;

  // File Operations
  readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
  readDirectory(dirPath: string): Promise<{ success: boolean; items?: DirectoryItem[]; error?: string }>;
  getFileStats(filePath: string): Promise<{ success: boolean; size?: number; mtime?: string; isDirectory?: boolean; isFile?: boolean; error?: string }>;
  createDirectory(dirPath: string): Promise<{ success: boolean; error?: string }>;
  deleteFile(filePath: string): Promise<{ success: boolean; error?: string }>;
  deleteDirectory(dirPath: string): Promise<{ success: boolean; error?: string }>;
  copyFile(src: string, dest: string): Promise<{ success: boolean; error?: string }>;
  moveFile(src: string, dest: string): Promise<{ success: boolean; error?: string }>;
  renameFile(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }>;
  fileExists(filePath: string): Promise<{ success: boolean; exists: boolean }>;
  listDirectory(dirPath: string): Promise<{ success: boolean; items?: any[]; error?: string }>;
  searchInFiles(rootPath: string, query: string, options?: SearchInFilesOptions): Promise<SearchInFilesResult>;

  // Dialogs
  showSaveDialog(options: any): Promise<any>;
  showOpenDialog(options: any): Promise<any>;
  showMessageBox(options: any): Promise<any>;
  openExternal(url: string): Promise<void>;
  revealInExplorer(filePath: string): Promise<void>;
  openContainingFolder(folderPath: string): Promise<void>;
  updateRecentFolders(folders: string[]): void;

  // Terminal
  terminalCreate(options?: TerminalCreateOptions): Promise<TerminalInfo>;
  terminalWrite(id: number, data: string): Promise<boolean>;
  terminalResize(id: number, cols: number, rows: number): Promise<boolean>;
  terminalDestroy(id: number): Promise<boolean>;
  terminalList(): Promise<TerminalInfo[]>;
  onTerminalData(callback: (data: { id: number; data: string }) => void): (() => void) | void;
  onTerminalExit(callback: (data: { id: number; exitCode: number }) => void): (() => void) | void;

  // LLM
  llmGetStatus(): Promise<LLMStatus>;
  llmLoadModel(modelPath: string): Promise<{ success: boolean; modelInfo?: ModelInfo; error?: string }>;
  llmGenerate(prompt: string, params?: LLMParams): Promise<LLMResult>;
  llmGenerateStream(prompt: string, params?: LLMParams): Promise<LLMResult>;
  llmCancel(): Promise<{ success: boolean }>;
  llmResetSession(): Promise<{ success: boolean }>;
  llmUpdateParams(params: Partial<LLMParams>): Promise<{ success: boolean }>;
  llmSetContextSize(contextSize: number): Promise<any>;
  onLlmStatus(callback: (status: LLMStatusEvent) => void): (() => void) | void;
  onLlmToken(callback: (token: string) => void): (() => void) | void;
  onLlmThinkingToken(callback: (token: string) => void): (() => void) | void;
  onLlmReplaceLast(callback: (text: string) => void): (() => void) | void;
  onDevLog(callback: (entry: { level: string; text: string; timestamp: number }) => void): (() => void) | void;
  onToolExecuting(callback: (data: { tool: string; params: any }) => void): (() => void) | void;
  onMcpToolResults(callback: (data: any) => void): (() => void) | void;
  onAgenticProgress(callback: (data: { iteration: number; maxIterations: number }) => void): (() => void) | void;
  onAgenticPhase(callback: (data: { phase: string; status?: 'start' | 'done' | 'clear'; label?: string }) => void): (() => void) | void;
  onTodoUpdate(callback: (data: { id: number; text: string; status: string }[]) => void): (() => void) | void;
  onContextUsage(callback: (data: { used: number; total: number }) => void): (() => void) | void;

  // GPU
  gpuGetInfo(): Promise<{ success: boolean; gpu: GPUInfo | null }>;
  gpuSetPreference(pref: 'auto' | 'cpu'): Promise<{ success: boolean; preference: string }>;
  gpuGetPreference(): Promise<{ success: boolean; preference: string }>;

  // Models
  modelsList(): Promise<AvailableModel[]>;
  modelsScan(): Promise<AvailableModel[]>;
  modelsGetDefault(): Promise<AvailableModel | null>;
  modelsDir(): Promise<string>;
  modelsAdd(): Promise<{ success: boolean; models: AvailableModel[] }>;
  modelsRemove(modelPath: string): Promise<{ success: boolean }>;
  onModelsAvailable(callback: (models: AvailableModel[]) => void): (() => void) | void;

  // Hardware & Model Recommendations
  getHardwareInfo(): Promise<{ vramGB: number; gpuName: string; totalRAM: number; freeRAM: number; cpuModel: string; cpuCores: number }>;
  getRecommendedModels(): Promise<{ recommended: RecommendedModel[]; other: RecommendedModel[]; maxModelGB: number; vramGB: number }>;
  modelsDownloadHF(opts: { url: string; fileName: string }): Promise<{ success: boolean; path?: string; error?: string; alreadyExists?: boolean }>;
  modelsCancelDownload(fileName: string): Promise<{ success: boolean }>;
  onModelDownloadProgress(callback: (data: { fileName: string; progress: number; downloadedMB: string; totalMB: string; complete?: boolean }) => void): (() => void) | void;

  // License Management
  licenseGetStatus(): Promise<LicenseStatus>;
  licenseActivate(key: string): Promise<{ success: boolean; message?: string; error?: string; license?: any }>;
  licenseActivateWithAccount(email: string, password: string): Promise<{ success: boolean; message?: string; error?: string; license?: any }>;
  licenseOAuthSignIn(provider: 'google' | 'github'): Promise<{ success: boolean; message?: string; error?: string; license?: any; authenticated?: boolean; email?: string }>;
  licenseDeactivate(): Promise<{ success: boolean }>;
  licenseLoad(): Promise<{ activated: boolean; authenticated?: boolean; needsRevalidation?: boolean; license?: any }>;
  licenseRevalidate(): Promise<{ success: boolean; error?: string }>;
  licenseCheckAccess(): Promise<{ allowed: boolean; reason: string; activated?: boolean }>;

  // RAG
  ragIndexProject(projectPath: string): Promise<{ success: boolean; totalFiles?: number; totalChunks?: number; error?: string }>;
  ragSearch(query: string, maxResults?: number): Promise<RAGResult[]>;
  ragSearchFiles(query: string, maxResults?: number): Promise<RAGFileResult[]>;
  ragGetContext(query: string, maxChunks?: number, maxTokens?: number): Promise<RAGContext>;
  ragFindError(errorMessage: string, stackTrace?: string): Promise<ErrorContext>;
  ragGetStatus(): Promise<RAGStatus>;
  ragGetProjectSummary(): Promise<ProjectSummary>;
  ragGetFileContent(filePath: string): Promise<string | null>;
  onRagProgress(callback: (data: { progress: number; done: number; total: number }) => void): (() => void) | void;

  // Web Search
  webSearch(query: string, maxResults?: number): Promise<WebSearchResult>;
  webSearchCode(query: string): Promise<WebSearchResult>;
  webFetchPage(url: string): Promise<{ url: string; title: string; content: string; error?: string }>;

  // Benchmark
  benchmarkGetTests(): Promise<BenchmarkTestCase[]>;
  benchmarkSaveResults(results: any): Promise<{ success: boolean; path?: string; error?: string }>;
  benchmarkLoadResults(): Promise<{ success: boolean; results: any[]; error?: string }>;
  benchmarkCancel(): Promise<{ success: boolean }>;
  onBenchmarkProgress(callback: (data: BenchmarkProgress) => void): (() => void) | void;
  onBenchmarkTestResult(callback: (data: BenchmarkTestResult) => void): (() => void) | void;

  // AI Chat
  aiChat(message: string, context?: AIChatContext): Promise<AIChatResult>;
  findBug(errorMessage: string, stackTrace: string, projectPath: string): Promise<{ success: boolean; text?: string; errorContext?: any; error?: string }>;

  // Inline Edit (Ctrl+I)
  inlineEdit(params: { filePath: string; fileContent?: string; selectedText?: string; cursorLine?: number; instruction: string; surrounding?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; code?: string; error?: string }>;
  nextEditSuggestion(params: { filePath: string; fileContent: string; recentEdit: string; cursorLine: number; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; suggestion?: { line: number; oldText: string; newText: string } }>;

  // AI Code Actions
  codeAction(params: { action: string; filePath: string; selectedText: string; fileContent: string; cursorLine: number; language: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; result?: string; error?: string }>;

  // Project Templates
  templateList(): Promise<{ id: string; name: string; description: string; icon: string; category: string; tags: string[] }[]>;
  templateCreate(params: { templateId: string; projectName: string; parentDir: string }): Promise<{ success: boolean; projectDir?: string; projectName?: string; filesCreated?: string[]; error?: string }>;
  templateDetails(templateId: string): Promise<{ id: string; name: string; fileList: string[] } | null>;

  // Terminal IntelliSense
  terminalSuggest(params: { partialCommand: string; cwd?: string; recentCommands?: string[] }): Promise<{ success: boolean; suggestions: { command: string; description: string }[] }>;

  // Custom Instructions
  loadCustomInstructions(projectPath: string): Promise<{ success: boolean; instructions?: string | null; source?: string }>;

  // Context Token Tracking
  estimateTokens(text: string): Promise<{ tokens: number }>;
  getContextUsage(): Promise<{ contextSize: number; modelName: string }>;

  // Debug Service (DAP)
  debugStart(config: DebugConfig): Promise<{ success: boolean; id?: number; state?: string; error?: string }>;
  debugStop(sessionId: number): Promise<{ success: boolean; error?: string }>;
  debugSetBreakpoints(sessionId: number, filePath: string, breakpoints: DebugBreakpoint[]): Promise<{ success: boolean; breakpoints?: DebugBreakpoint[]; error?: string }>;
  debugContinue(sessionId: number): Promise<{ success: boolean; error?: string }>;
  debugStepOver(sessionId: number): Promise<{ success: boolean; error?: string }>;
  debugStepInto(sessionId: number): Promise<{ success: boolean; error?: string }>;
  debugStepOut(sessionId: number): Promise<{ success: boolean; error?: string }>;
  debugPause(sessionId: number): Promise<{ success: boolean; error?: string }>;
  debugStackTrace(sessionId: number): Promise<{ success: boolean; stackFrames?: DebugStackFrame[]; error?: string }>;
  debugScopes(sessionId: number, frameId: number): Promise<{ success: boolean; scopes?: DebugScope[]; error?: string }>;
  debugVariables(sessionId: number, variablesReference: number | string): Promise<{ success: boolean; variables?: DebugVariable[]; error?: string }>;
  debugEvaluate(sessionId: number, expression: string, frameId?: number): Promise<{ success: boolean; result?: string; error?: string }>;
  debugGetSessions(): Promise<{ sessions: { id: number; state: string; config: DebugConfig }[] }>;
  onDebugEvent(callback: (event: DebugEvent) => void): (() => void) | void;

  // Background Agents (Multi-Agent)
  agentSpawn(task: string, context?: { projectPath?: string; maxIterations?: number }): Promise<{ success: boolean; id?: number }>;
  agentCancel(agentId: number): Promise<{ success: boolean; error?: string }>;
  agentGetResult(agentId: number): Promise<{ success: boolean; id?: number; status?: string; task?: string; result?: string; error?: string }>;
  agentList(): Promise<{ agents: { id: number; task: string; status: string; startedAt: number }[] }>;
  onAgentStatus(callback: (data: { id: number; status: string; task: string; result?: string; error?: string; completedAt?: number }) => void): (() => void) | void;

  // Cloud LLM APIs
  cloudLLMSetKey(provider: string, key: string): Promise<{ success: boolean }>;
  cloudLLMGetProviders(): Promise<CloudLLMProvider[]>;
  cloudLLMGetAllProviders(): Promise<(CloudLLMProvider & { hasKey: boolean })[]>;
  cloudLLMFetchOpenRouterModels(): Promise<{ success: boolean; free?: OpenRouterModel[]; paid?: OpenRouterModel[]; total?: number; error?: string }>;
  cloudLLMGetStatus(): Promise<CloudLLMStatus>;
  cloudLLMGenerate(prompt: string, options?: CloudLLMOptions): Promise<{ success: boolean; text?: string; model?: string; tokensUsed?: number; error?: string }>;
  cloudLLMTestKey(provider: string, model?: string | null): Promise<
    | { success: true; provider: string; model: string; latencyMs: number; tokensUsed: number; text: string }
    | { success: false; provider?: string; model?: string | null; category?: string; code?: number; message?: string; error?: string }
  >;
  cloudLLMTestAllConfiguredKeys(): Promise<{ success: boolean; results?: any[]; error?: string }>;

  // Git Integration
  gitStatus(): Promise<{ files: GitFileStatus[]; branch: string; error?: string }>;
  gitDiff(filePath?: string, staged?: boolean): Promise<string>;
  gitStage(filePath: string): Promise<void>;
  gitStageAll(): Promise<void>;
  gitUnstage(filePath: string): Promise<void>;
  gitUnstageAll(): Promise<void>;
  gitDiscard(filePath: string): Promise<void>;
  gitCommit(message: string): Promise<{ success: boolean; error?: string }>;
  gitLog(count?: number): Promise<GitLogEntry[]>;
  gitBranches(): Promise<{ current: string; all: string[] }>;
  gitCheckout(branch: string): Promise<{ success: boolean; error?: string }>;
  gitInit(): Promise<{ success: boolean; error?: string }>;
  gitAheadBehind(): Promise<{ ahead: number; behind: number }>;
  gitBlame(filePath: string): Promise<{ success: boolean; blame: { line: number; hash: string; author: string; date: string; summary: string }[]; error?: string }>;

  // Git: Push / Pull / Fetch
  gitPush(remote?: string, branch?: string): Promise<{ success: boolean; output?: string; setUpstream?: boolean; error?: string }>;
  gitPull(remote?: string, branch?: string): Promise<{ success: boolean; output?: string; error?: string }>;
  gitFetch(remote?: string): Promise<{ success: boolean; output?: string; error?: string }>;

  // Git: Branch Management
  gitCreateBranch(name: string, checkout?: boolean): Promise<{ success: boolean; branch?: string; error?: string }>;
  gitDeleteBranch(name: string, force?: boolean): Promise<{ success: boolean; error?: string }>;
  gitMerge(branch: string): Promise<{ success: boolean; output?: string; conflict?: boolean; conflictFiles?: string[]; error?: string }>;
  gitMergeAbort(): Promise<{ success: boolean; error?: string }>;
  gitMergeState(): Promise<{ inMerge: boolean; conflictFiles: string[] }>;

  // Git: Commit Details
  gitCommitDetail(hash: string): Promise<{ success: boolean; commit?: { hash: string; author: string; email: string; date: string; subject: string; body: string; stats: string }; error?: string }>;
  gitCommitDiff(hash: string): Promise<{ success: boolean; diff: string; error?: string }>;
  gitStagedDiff(): Promise<{ success: boolean; diff: string; error?: string }>;

  // AI Git
  gitAiCommitMessage(params?: { cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; message?: string; error?: string }>;
  gitAiExplainCommit(params: { hash: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; explanation?: string; commit?: any; error?: string }>;
  gitAiResolveConflict(params: { filePath: string; fileContent: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; resolved?: string; error?: string }>;

  // Voice Commands
  voiceCommand(params: { transcription: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; command?: { action: string; [key: string]: any }; error?: string }>;

  // Database Viewer
  dbOpen(filePath: string): Promise<{ success: boolean; id?: string; filePath?: string; tables?: { name: string; type: string }[]; error?: string }>;
  dbCreate(filePath: string): Promise<{ success: boolean; id?: string; filePath?: string; tables?: { name: string; type: string }[]; error?: string }>;
  dbClose(dbId: string): Promise<{ success: boolean; error?: string }>;
  dbTables(dbId: string): Promise<{ success: boolean; tables?: { name: string; type: string }[]; error?: string }>;
  dbTableSchema(dbId: string, tableName: string): Promise<{ success: boolean; columns?: any[]; rowCount?: number; indexes?: any[]; error?: string }>;
  dbTableData(dbId: string, tableName: string, offset?: number, limit?: number, orderBy?: string, orderDir?: string): Promise<{ success: boolean; columns?: string[]; rows?: Record<string, any>[]; totalRows?: number; hasMore?: boolean; error?: string }>;
  dbQuery(dbId: string, sql: string): Promise<{ success: boolean; type?: string; columns?: string[]; rows?: Record<string, any>[]; rowCount?: number; rowsAffected?: number; duration?: number; error?: string }>;
  dbAiQuery(params: { dbId: string; description: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; sql?: string; error?: string }>;
  dbSave(dbId: string, filePath?: string): Promise<{ success: boolean; filePath?: string; error?: string }>;
  dbExportCsv(dbId: string, sql: string, outputPath: string): Promise<{ success: boolean; filePath?: string; rowCount?: number; error?: string }>;
  dbListConnections(): Promise<{ success: boolean; connections?: { id: string; filePath: string; fileName: string; type: string }[]; error?: string }>;

  // AI Code Review
  codeReviewFile(params: { filePath: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; findings?: any[]; rawReview?: string; truncated?: boolean; error?: string }>;
  codeReviewStaged(params?: { cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; findings?: any[]; rawReview?: string; truncated?: boolean; error?: string }>;
  codeReviewDiff(params: { diff: string; context?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; findings?: any[]; rawReview?: string; truncated?: boolean; error?: string }>;
  codeReviewApplyFix(params: { filePath: string; line?: number | null; fix: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Performance Profiler
  profilerRunNode(params: { scriptPath: string; args?: string[]; cwd?: string }): Promise<ProfileResult>;
  profilerRunPython(params: { scriptPath: string; args?: string[]; cwd?: string }): Promise<ProfileResult>;
  profilerTimeCommand(params: { command: string; cwd?: string; iterations?: number }): Promise<{ success: boolean; command?: string; iterations?: number; timings?: TimingResult[]; summary?: TimingSummary; error?: string }>;
  profilerMemorySnapshot(): Promise<MemorySnapshot>;
  profilerAiAnalyze(params: { profileData: any; scriptPath?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; analysis?: ProfileAnalysis; rawAnalysis?: string; error?: string }>;
  profilerCancel(sessionId: number): Promise<{ success: boolean; error?: string }>;
  profilerListSessions(): Promise<{ success: boolean; sessions: { id: number; scriptPath: string; startTime: number; elapsed: number }[] }>;

  // Smart Search & Navigation
  smartSearchSymbols(params: { filePath: string }): Promise<{ success: boolean; symbols?: CodeSymbol[]; filePath?: string; error?: string }>;
  smartSearchReferences(params: { symbol: string; rootPath?: string }): Promise<{ success: boolean; symbol?: string; references?: SearchReference[]; totalFiles?: number; error?: string }>;
  smartSearchDefinition(params: { symbol: string; rootPath?: string }): Promise<{ success: boolean; symbol?: string; definitions?: SearchReference[]; error?: string }>;
  smartSearchSemantic(params: { query: string; rootPath?: string; cloudProvider?: string; cloudModel?: string; maxResults?: number }): Promise<{ success: boolean; results?: SemanticSearchResult[]; source?: string; rawResponse?: string; error?: string }>;
  smartSearchSimilar(params: { code: string; rootPath?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; similar?: SimilarCodeResult[]; identifiers?: string[]; error?: string }>;
  smartSearchBreadcrumb(params: { filePath: string; line: number }): Promise<{ success: boolean; breadcrumb?: string[]; enclosingSymbols?: CodeSymbol[]; error?: string }>;
  smartSearchProjectSymbols(params: { query?: string; rootPath?: string; filter?: string }): Promise<{ success: boolean; symbols?: CodeSymbol[]; totalFound?: number; error?: string }>;

  // Documentation Generator
  docsGenerateFile(params: { filePath: string; cloudProvider?: string; cloudModel?: string; style?: string }): Promise<{ success: boolean; documentedCode?: string; filePath?: string; docStyle?: string; truncated?: boolean; error?: string }>;
  docsGenerateReadme(params: { rootPath?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; readme?: string; projectName?: string; projectTypes?: string[]; error?: string }>;
  docsGenerateApi(params: { rootPath?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; apiDocs?: string; routeFilesFound?: number; error?: string }>;
  docsGenerateArchitecture(params: { rootPath?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; markdown?: string; mermaidDiagrams?: string[]; projectName?: string; projectTypes?: string[]; error?: string }>;
  docsExplainCodebase(params: { rootPath?: string; cloudProvider?: string; cloudModel?: string }): Promise<{ success: boolean; overview?: string; projectName?: string; projectTypes?: string[]; fileCount?: number; error?: string }>;

  // SSH Remote Development
  sshAvailable(): Promise<{ available: boolean }>;
  sshGetProfiles(): Promise<{ success: boolean; profiles?: SSHProfile[]; error?: string }>;
  sshSaveProfile(profile: Partial<SSHProfile>): Promise<{ success: boolean; profiles?: SSHProfile[]; error?: string }>;
  sshDeleteProfile(profileId: string): Promise<{ success: boolean; profiles?: SSHProfile[]; error?: string }>;
  sshConnect(params: { host: string; port?: number; username: string; password?: string; privateKey?: string; privateKeyPath?: string; passphrase?: string }): Promise<{ success: boolean; connectionId?: string; host?: string; username?: string; error?: string }>;
  sshDisconnect(connectionId: string): Promise<{ success: boolean; error?: string }>;
  sshListDir(connectionId: string, remotePath: string): Promise<{ success: boolean; path?: string; items?: SSHFileItem[]; error?: string }>;
  sshReadFile(connectionId: string, remotePath: string): Promise<{ success: boolean; content?: string; path?: string; name?: string; error?: string }>;
  sshWriteFile(connectionId: string, remotePath: string, content: string): Promise<{ success: boolean; path?: string; error?: string }>;
  sshDelete(connectionId: string, remotePath: string, isDir?: boolean): Promise<{ success: boolean; error?: string }>;
  sshRename(connectionId: string, oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }>;
  sshMkdir(connectionId: string, remotePath: string): Promise<{ success: boolean; error?: string }>;
  sshExec(connectionId: string, command: string): Promise<{ success: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string }>;
  sshStat(connectionId: string, remotePath: string): Promise<{ success: boolean; isDir?: boolean; isFile?: boolean; size?: number; modified?: string; permissions?: string; error?: string }>;
  sshListConnections(): Promise<{ success: boolean; connections?: SSHConnection[]; error?: string }>;

  // Plugin / Extension System
  pluginMarketplace(params?: { search?: string; category?: string }): Promise<{ success: boolean; plugins?: PluginInfo[]; error?: string }>;
  pluginListInstalled(): Promise<{ success: boolean; plugins?: PluginInfo[]; error?: string }>;
  pluginInstall(pluginId: string): Promise<{ success: boolean; plugin?: PluginInfo; error?: string }>;
  pluginUninstall(pluginId: string): Promise<{ success: boolean; error?: string }>;
  pluginToggle(pluginId: string, enabled: boolean): Promise<{ success: boolean; plugin?: PluginInfo; error?: string }>;
  pluginGetDetails(pluginId: string): Promise<{ success: boolean; plugin?: PluginInfo | null; installed?: boolean; enabled?: boolean; error?: string }>;
  pluginCategories(): Promise<{ success: boolean; categories?: string[]; error?: string }>;

  // Collaborative Editing (Live Share)
  collabAvailable(): Promise<{ available: boolean }>;
  collabHost(params: { filePath?: string; content?: string; username?: string; port?: number }): Promise<{ success: boolean; sessionId?: string; port?: number; password?: string; localIPs?: string[]; shareLink?: string; error?: string }>;
  collabStopHost(): Promise<{ success: boolean; error?: string }>;
  collabJoin(params: { host: string; port: number; password: string; username?: string }): Promise<{ success: boolean; peerId?: string; color?: string; doc?: CollabDoc; peers?: CollabPeer[]; error?: string }>;
  collabLeave(): Promise<{ success: boolean; error?: string }>;
  collabSendEdit(params: { content: string; selection?: any }): Promise<{ success: boolean; error?: string }>;
  collabSendCursor(cursor: { line: number; column: number }): Promise<{ success: boolean }>;
  collabSendChat(message: string): Promise<{ success: boolean; error?: string }>;
  collabGetSession(): Promise<{ success: boolean; role?: 'host' | 'client' | null; session?: any; peers?: CollabPeer[]; peerId?: string; doc?: any; error?: string }>;
  collabUpdateDoc(content: string): Promise<{ success: boolean; version?: number; error?: string }>;
  onCollabEvent(callback: (event: CollabEvent) => void): (() => void) | void;

  // Notebook / REPL
  notebookExecNode(params: { code: string; cellId: string; timeout?: number }): Promise<NotebookCellResult>;
  notebookExecPython(params: { code: string; cellId: string; timeout?: number }): Promise<NotebookCellResult>;
  notebookExecShell(params: { code: string; cellId: string; timeout?: number }): Promise<NotebookCellResult>;
  notebookSaveIpynb(params: { filePath: string; cells: NotebookCell[] }): Promise<{ success: boolean; path?: string; error?: string }>;
  notebookLoadIpynb(filePath: string): Promise<{ success: boolean; cells?: NotebookCell[]; metadata?: any; error?: string }>;
  notebookAiGenerate(params: { prompt: string; context?: string; language?: string }): Promise<{ success: boolean; code?: string; language?: string; error?: string }>;
  notebookClearOutputs(): Promise<{ success: boolean }>;

  // MCP Tools
  mcpGetTools(): Promise<MCPToolDefinition[]>;
  mcpExecuteTool(toolName: string, params: Record<string, any>): Promise<{ success: boolean; result?: any; error?: string }>;
  mcpGetHistory(): Promise<MCPToolHistoryEntry[]>;
  onMcpToolsAvailable(callback: (tools: MCPToolDefinition[]) => void): (() => void) | void;
  onMcpToolResults(callback: (results: MCPToolResult[]) => void): (() => void) | void;
  onToolExecuting(callback: (data: { tool: string; params: any }) => void): (() => void) | void;

  // MCP Server Management
  mcpListServers(): Promise<MCPServerInfo[]>;
  mcpAddServer(config: MCPServerConfig): Promise<{ success: boolean; id?: string; error?: string }>;
  mcpRemoveServer(serverId: string): Promise<{ success: boolean; error?: string }>;
  mcpRestartServer(serverId: string): Promise<{ success: boolean; status?: string; error?: string }>;
  onMcpServerStatus(callback: (data: { id: string; status: string; error?: string }) => void): (() => void) | void;

  // File Change Undo
  fileUndoList(): Promise<{ filePath: string; fileName: string; timestamp: number; tool: string; isNew: boolean }[]>;
  fileUndo(filePath: string): Promise<{ success: boolean; action?: string; error?: string }>;
  fileUndoAll(): Promise<{ success: boolean; action?: string; error?: string }[]>;
  fileAcceptChanges(filePaths?: string[]): Promise<{ success: boolean }>;

  // Context Usage
  onContextUsage(callback: (data: { used: number; total: number }) => void): (() => void) | void;

  // Files Changed (auto-refresh)
  onFilesChanged(callback: () => void): (() => void) | void;

  // Browser Automation
  browserNavigate(url: string): Promise<{ success: boolean; url?: string; title?: string; error?: string }>;
  browserShow(bounds?: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean }>;
  browserHide(): Promise<{ success: boolean }>;
  browserSetBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean }>;
  browserGoBack(): Promise<{ success: boolean; error?: string }>;
  browserGoForward(): Promise<{ success: boolean; error?: string }>;
  browserReload(): Promise<{ success: boolean }>;
  browserGetState(): Promise<BrowserState>;
  browserScreenshot(): Promise<{ success: boolean; dataUrl?: string; width?: number; height?: number; error?: string }>;
  browserGetContent(selector?: string, html?: boolean): Promise<{ success: boolean; content?: string; url?: string; title?: string; error?: string }>;
  browserEvaluate(code: string): Promise<{ success: boolean; result?: string; error?: string }>;
  browserClick(selector: string): Promise<{ success: boolean; error?: string }>;
  browserType(selector: string, text: string): Promise<{ success: boolean; error?: string }>;
  browserLaunchExternal(url: string): Promise<{ success: boolean; mode?: string; error?: string }>;
  onShowBrowser(callback: (data: { url: string }) => void): (() => void) | void;
  onBrowserRestore?(callback: () => void): (() => void) | void;
  onBrowserStateChanged?(callback: (state: BrowserState) => void): (() => void) | void;

  // Memory Store
  memoryGetStats(): Promise<MemoryStats>;
  memoryGetContext(): Promise<string>;
  memoryLearnFact(key: string, value: string): Promise<{ success: boolean }>;
  memoryFindErrors(errorMsg: string): Promise<MemoryErrorEntry[]>;
  memoryClear(): Promise<{ success: boolean }>;
  onMemoryStats(callback: (stats: MemoryStats) => void): (() => void) | void;

  // Events
  onMenuAction(callback: (action: string) => void): (() => void) | void;
  onMenuNewProject?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuOpenProject?(callback: (event: any, projectPath: string) => void): (() => void) | void;
  onMenuSaveFile?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuSave?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuSaveAll?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuToggleExplorer?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuToggleChat?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuToggleTasks?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuFontSizeIncrease?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuFontSizeDecrease?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuFontSizeReset?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuRunTask?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuDebug?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onMenuSettings?(callback: (event: any, ...args: any[]) => void): (() => void) | void;
  onOpenFile(callback: (filePath: string) => void): (() => void) | void;
  onOpenFolder(callback: (folderPath: string) => void): (() => void) | void;
  onRagStatus(callback: (status: RAGStatus) => void): (() => void) | void;
  onFolderOpened(callback: (event: any, folderPath: string) => void): (() => void) | void;

  // Audio Transcription (Speech-to-Text)
  transcribeAudio?(audioBase64: string): Promise<{ success: boolean; text?: string; error?: string }>;

  // Image Generation
  imageGenerate?(prompt: string, options?: { width?: number; height?: number; provider?: string }): Promise<{ success: boolean; imageBase64?: string; mimeType?: string; prompt?: string; provider?: string; model?: string; error?: string }>;
  imageSave?(imageBase64: string, mimeType: string, suggestedName?: string): Promise<{ success: boolean; filePath?: string; error?: string }>;
  imageSaveToProject?(imageBase64: string, mimeType: string, fileName?: string): Promise<{ success: boolean; filePath?: string; error?: string }>;
  imageGenStatus?(): Promise<{ providers: { id: string; label: string; model: string; available: boolean }[]; googleKeysCount: number }>;

  // Settings & Chat Persistence
  saveSettings?(settings: Record<string, any>): Promise<{ success: boolean }>;
  loadSettings?(): Promise<{ success: boolean; settings?: Record<string, any> }>;
  saveChatSessions?(sessions: any[]): Promise<{ success: boolean }>;
  loadChatSessions?(): Promise<{ success: boolean; sessions?: any[] }>;

  // System Resources
  getSystemResources?(): Promise<{ cpu: number; ram: { used: number; total: number; percent: number } }>;

  // Cleanup
  removeAllListeners(channel: string): void;
  removeListener(channel: string, callback: any): void;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  nodeVersion: string;
  electronVersion: string;
}

export interface DirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
  created?: string;
  type?: string;
}

export interface SearchInFilesOptions {
  maxResults?: number;
  isRegex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  include?: string;
  exclude?: string;
}

export interface SearchInFilesResult {
  success: boolean;
  results?: SearchFileMatch[];
  totalResults?: number;
  truncated?: boolean;
  error?: string;
}

export interface SearchFileMatch {
  file: string;
  relativePath: string;
  line: number;
  column: number;
  lineContent: string;
  matches: { start: number; end: number; text: string }[];
  preview: string;
}

export interface TerminalCreateOptions {
  cwd?: string;
  title?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface TerminalInfo {
  id: number;
  pid?: number;
  shell?: string;
  title: string;
  fallback?: boolean;
}

export interface LLMStatus {
  isReady: boolean;
  isLoading: boolean;
  modelInfo: ModelInfo | null;
  currentModelPath: string | null;
}

export interface LLMStatusEvent {
  state: 'loading' | 'ready' | 'error';
  message?: string;
  modelInfo?: ModelInfo;
  progress?: number; // 0..1 for loading progress bar
  cpuFallback?: boolean; // true when model is running on CPU only (no GPU layers)
  thinkingWarning?: boolean; // true when thinking model loaded with limited GPU context (<8192)
}

export interface ModelInfo {
  path: string;
  name: string;
  size: number;
  contextSize: number;
  gpuLayers?: number;
  gpuBackend?: string;
  flashAttention?: boolean;
}

export interface GPUInfo {
  name: string;
  vramTotalMB: number;
  vramUsedMB: number;
  vramFreeMB: number;
  utilizationPercent: number;
  temperatureC: number;
  vramTotalGB: string;
  vramUsedGB: string;
  vramFreeGB: string;
  vramUsagePercent: number;
  isActive: boolean;
  gpuLayers: number;
  backend: string;
}

export interface LLMParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  seed?: number;
}

export interface LLMResult {
  success: boolean;
  text?: string;
  model?: string;
  tokensUsed?: number;
  error?: string;
}

export interface AvailableModel {
  name: string;
  fileName: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  directory: string;
  details: {
    quantization: string;
    parameters: string;
    family: string;
  };
}

export interface RecommendedModel {
  name: string;
  file: string;
  size: number;
  hfRepo: string;
  desc: string;
  category: 'coding' | 'general' | 'vision' | 'reasoning';
  vision: boolean;
  fits: boolean;
  maxModelGB: number;
  downloadUrl: string;
}

export interface RAGResult {
  docId: string;
  score: number;
  path: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

export interface RAGFileResult {
  path: string;
  relativePath: string;
  score: number;
  fileName: string;
}

export interface RAGContext {
  chunks: { file: string; startLine: number; endLine: number; content: string; score: number }[];
  totalTokens: number;
  filesSearched: number;
  chunksSearched: number;
}

export interface RAGStatus {
  isIndexing: boolean;
  indexProgress: number;
  totalFiles: number;
  totalChunks: number;
  totalTerms: number;
  projectPath: string | null;
}

export interface ErrorContext {
  results: RAGResult[];
  fileReferences: { path: string; line: number; col: number }[];
  identifiers: string[];
}

export interface ProjectSummary {
  projectPath: string;
  totalFiles: number;
  totalChunks: number;
  directories: string[];
  files: string[];
}

export interface WebSearchResult {
  success?: boolean;
  results: { title: string; url: string; snippet: string; position: number }[];
  query?: string;
  totalResults?: number;
  error?: string;
}

export interface AIChatContext {
  projectPath?: string;
  currentFile?: { path: string; content?: string };
  selectedCode?: string;
  errorMessage?: string;
  stackTrace?: string;
  webSearch?: string;
  params?: LLMParams;
  maxIterations?: number;
  cloudProvider?: string;
  cloudModel?: string;
  conversationHistory?: { role: string; content: string }[];
  images?: { data: string; mimeType: string; name: string }[];
  autoMode?: boolean;
}

export interface AIChatResult {
  success: boolean;
  text?: string;
  model?: string;
  tokensUsed?: number;
  toolResults?: MCPToolResult[];
  error?: string;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface MCPToolResult {
  tool: string;
  params: Record<string, any>;
  result: any;
}

export interface MCPToolHistoryEntry {
  tool: string;
  params: Record<string, any>;
  result: any;
  duration: number;
  timestamp: number;
}

export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

export interface MCPServerInfo {
  id: string;
  name: string;
  type: 'built-in' | 'stdio' | 'sse';
  status: 'running' | 'stopped' | 'starting' | 'error';
  toolCount: number;
  tools: { name: string; description: string }[];
  command?: string;
  url?: string;
  error?: string | null;
}

export interface BrowserState {
  isVisible: boolean;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface MemoryStats {
  conversations: number;
  projectFacts: number;
  codePatterns: number;
  errorHistory: number;
  memoryDir: string;
}

export interface MemoryErrorEntry {
  error: string;
  resolution: string;
  files: string[];
  timestamp: number;
  similarity: number;
}

export interface CloudLLMProvider {
  provider: string;
  label: string;
  models: { id: string; name: string }[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context: number;
  free: boolean;
  promptCost: number;
  completionCost: number;
}

export interface CloudLLMStatus {
  hasKeys: boolean;
  providers: string[];
  activeProvider: string | null;
  activeModel: string | null;
}

export interface CloudLLMOptions {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface LicenseStatus {
  isActivated: boolean;
  isAuthenticated?: boolean;
  license: {
    key: string | null;
    activatedAt: number | null;
    lastValidated: number | null;
    email: string | null;
    plan: string | null;
    expiresAt: number | null;
    authMethod?: string;
  } | null;
  machineId: string;
  access?: {
    allowed: boolean;
    reason: string;
  };
}

// ── Debug Service Types ──
export interface DebugConfig {
  type: 'node' | 'node-terminal' | 'python' | 'attach';
  program?: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  port?: number;
}

export interface DebugBreakpoint {
  line: number;
  id?: string | number;
  verified?: boolean;
  condition?: string;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string };
  line: number;
  column: number;
}

export interface DebugScope {
  name: string;
  variablesReference: number | string;
  expensive?: boolean;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number | string;
}

export interface DebugEvent {
  event: string;
  sessionId?: number;
  reason?: string;
  threadId?: number;
  allThreadsStopped?: boolean;
  category?: string;
  output?: string;
  exitCode?: number;
}

// ── Benchmark Types ──
export interface BenchmarkTestCase {
  id: string;
  category: string;
  prompt: string;
  expectedTools: string[];
  refusalPatterns?: string[];
  description: string;
  maxIterations: number;
}

export interface BenchmarkTestResult {
  testId: string;
  category?: string;
  description?: string;
  modelName: string;
  passed: boolean;
  score: number;
  toolsCalled: string[];
  response: string;
  htmlOutput?: string;
  errors: string[];
  refusalDetected: boolean;
  durationMs: number;
}

export interface BenchmarkProgress {
  phase: 'loading' | 'testing' | 'complete';
  modelIndex: number;
  totalModels: number;
  modelName?: string;
  testIndex?: number;
  totalTests?: number;
  testId?: string;
  testDescription?: string;
}

export interface BenchmarkModelResult {
  modelName: string;
  modelPath: string;
  error?: string;
  tests: BenchmarkTestResult[];
  overallScore: number;
  totalPassed: number;
  totalTests: number;
}

// ── Performance Profiler Types ──
export interface ProfileResult {
  success: boolean;
  sessionId?: number;
  scriptPath?: string;
  runtime?: string;
  duration?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  profile?: any;
  message?: string;
  error?: string;
}

export interface TimingResult {
  iteration: number;
  duration: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TimingSummary {
  min: number;
  max: number;
  avg: number;
  median: number;
}

export interface MemorySnapshot {
  success: boolean;
  process?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
  };
  system?: {
    totalGB: number;
    freeGB: number;
    usedPercent: number;
  };
  uptime?: number;
  platform?: string;
  nodeVersion?: string;
  cpuCount?: number;
  error?: string;
}

export interface ProfileAnalysis {
  summary: string;
  hotspots: { function: string; issue: string; impact: string }[];
  recommendations: { title: string; description: string; priority: string; estimatedImprovement: string }[];
  complexity: string;
}

// ── Smart Search Types ──
export interface CodeSymbol {
  name: string;
  type: string;
  line: number;
  filePath: string;
  context: string;
  relativePath?: string;
}

export interface SearchReference {
  filePath: string;
  line: number;
  column?: number;
  context: string;
  relativePath: string;
}

export interface SemanticSearchResult {
  filePath: string;
  line: number;
  score?: number;
  snippet: string;
  reason?: string;
  relativePath: string;
}

export interface SimilarCodeResult {
  filePath: string;
  line: number;
  score: number;
  matchedIdentifiers: number;
  totalIdentifiers: number;
  context: string;
  relativePath: string;
}

// ── SSH Types ──
export interface SSHProfile {
  id: string;
  name?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface SSHFileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions: string | null;
}

export interface SSHConnection {
  id: string;
  host: string;
  username: string;
  port: number;
}

// ── Plugin Types ──
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  downloads?: number;
  rating?: number;
  enabled?: boolean;
  installedAt?: string;
}

// ── Collaboration Types ──
export interface CollabPeer {
  id: string;
  username: string;
  color: string;
  cursor?: { line: number; column: number };
}

export interface CollabDoc {
  content: string;
  version: number;
  filePath: string;
}

export interface CollabEvent {
  type: 'peer-joined' | 'peer-left' | 'edit' | 'cursor' | 'chat' | 'init' | 'disconnected' | 'auth-failed';
  peerId?: string;
  username?: string;
  color?: string;
  content?: string;
  version?: number;
  cursor?: { line: number; column: number };
  message?: string;
  timestamp?: number;
  peers?: CollabPeer[];
  doc?: CollabDoc;
}

// ── Notebook Types ──
export interface NotebookCellOutput {
  type: 'log' | 'error' | 'warn' | 'result';
  text: string;
}

export interface NotebookCell {
  id: string;
  type: 'code' | 'markdown';
  language: string;
  code: string;
  outputs?: NotebookCellOutput[];
  executionCount?: number | null;
}

export interface NotebookCellResult {
  success: boolean;
  cellId: string;
  outputs?: NotebookCellOutput[];
  exitCode?: number;
  outputType?: string;
  error?: string;
}