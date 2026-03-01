/**
 * guIDE — AI-Powered Offline IDE
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */
const { contextBridge, ipcRenderer } = require('electron');

// Helper: register a listener that returns a cleanup function (avoids removeAllListeners)
function _on(channel, callback) {
  const handler = (_, ...args) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Brand identity — tampering constitutes license violation
contextBridge.exposeInMainWorld('__guIDE', {
  author: 'Brendan Gray',
  github: 'FileShot',
  license: 'Source Available — redistribution/rebranding prohibited',
});

contextBridge.exposeInMainWorld('electronAPI', {
  // ── App Info ──
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // ── File Operations ──
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  deleteDirectory: (dirPath) => ipcRenderer.invoke('delete-directory', dirPath),
  copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
  copyDirectory: (src, dest) => ipcRenderer.invoke('copy-directory', src, dest),
  moveFile: (src, dest) => ipcRenderer.invoke('move-file', src, dest),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  searchInFiles: (rootPath, query, options) => ipcRenderer.invoke('search-in-files', rootPath, query, options),
  scanTodos: (rootPath) => ipcRenderer.invoke('scan-todos', rootPath),
  liveServerStart: (filePath) => ipcRenderer.invoke('live-server-start', filePath),
  liveServerStop: () => ipcRenderer.invoke('live-server-stop'),
  liveServerStatus: () => ipcRenderer.invoke('live-server-status'),
  restRequest: (opts) => ipcRenderer.invoke('rest-request', opts),

  // ── Dialogs ──
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
  openContainingFolder: (folderPath) => ipcRenderer.invoke('open-containing-folder', folderPath),

  // ── Recent Folders (sends to main to rebuild the native menu) ──
  updateRecentFolders: (folders) => ipcRenderer.send('update-recent-folders', folders),

  // ── Terminal ──
  terminalCreate: (options) => ipcRenderer.invoke('terminal-create', options),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal-write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal-resize', id, cols, rows),
  terminalDestroy: (id) => ipcRenderer.invoke('terminal-destroy', id),
  terminalList: () => ipcRenderer.invoke('terminal-list'),
  onTerminalData: (callback) => _on('terminal-data', callback),
  onTerminalExit: (callback) => _on('terminal-exit', callback),

  // ── LLM ──
  llmGetStatus: () => ipcRenderer.invoke('llm-get-status'),
  llmLoadModel: (modelPath) => ipcRenderer.invoke('llm-load-model', modelPath),
  llmGenerate: (prompt, params) => ipcRenderer.invoke('llm-generate', prompt, params),
  llmGenerateStream: (prompt, params) => ipcRenderer.invoke('llm-generate-stream', prompt, params),
  llmCancel: () => ipcRenderer.invoke('llm-cancel'),
  llmResetSession: () => ipcRenderer.invoke('llm-reset-session'),
  llmUpdateParams: (params) => ipcRenderer.invoke('llm-update-params', params),
  llmSetContextSize: (contextSize) => ipcRenderer.invoke('llm-set-context-size', contextSize),
  llmSetReasoningEffort: (level) => ipcRenderer.invoke('llm-set-reasoning-effort', level),
  llmSetThinkingBudget: (budget) => ipcRenderer.invoke('llm-set-thinking-budget', budget),
  
  // ── GPU ──
  gpuGetInfo: () => ipcRenderer.invoke('gpu-get-info'),
  gpuSetPreference: (pref) => ipcRenderer.invoke('gpu-set-preference', pref),
  gpuGetPreference: () => ipcRenderer.invoke('gpu-get-preference'),
  
  onLlmStatus: (callback) => _on('llm-status', callback),
  onLlmToken: (callback) => _on('llm-token', callback),
  onLlmThinkingToken: (callback) => _on('llm-thinking-token', callback),
  onLlmReplaceLast: (callback) => _on('llm-replace-last', callback),
  onLlmStreamReset: (callback) => _on('llm-stream-reset', callback),
  onLlmIterationBegin: (callback) => _on('llm-iteration-begin', callback),
  onDevLog: (callback) => _on('dev-log', callback),

  // ── Model Management ──
  modelsList: () => ipcRenderer.invoke('models-list'),
  modelsScan: () => ipcRenderer.invoke('models-scan'),
  modelsGetDefault: () => ipcRenderer.invoke('models-get-default'),
  modelsDir: () => ipcRenderer.invoke('models-dir'),
  modelsAdd: () => ipcRenderer.invoke('models-add'),
  modelsRemove: (modelPath) => ipcRenderer.invoke('models-remove', modelPath),
  onModelsAvailable: (callback) => _on('models-available', callback),

  // ── Hardware & Model Recommendations ──
  getHardwareInfo: () => ipcRenderer.invoke('get-hardware-info'),
  getRecommendedModels: () => ipcRenderer.invoke('get-recommended-models'),
  modelsDownloadHF: (opts) => ipcRenderer.invoke('models-download-hf', opts),
  modelsCancelDownload: (fileName) => ipcRenderer.invoke('models-cancel-download', fileName),
  onModelDownloadProgress: (callback) => _on('model-download-progress', callback),

  // ── License Management ──
  licenseGetStatus: () => ipcRenderer.invoke('license-get-status'),
  licenseActivate: (key) => ipcRenderer.invoke('license-activate', key),
  licenseActivateWithAccount: (email, password) => ipcRenderer.invoke('license-activate-account', email, password),
  licenseOAuthSignIn: (provider) => ipcRenderer.invoke('license-oauth-signin', provider),
  licenseDeactivate: () => ipcRenderer.invoke('license-deactivate'),
  licenseLoad: () => ipcRenderer.invoke('license-load'),
  licenseRevalidate: () => ipcRenderer.invoke('license-revalidate'),
  licenseCheckAccess: () => ipcRenderer.invoke('license-check-access'),

  // ── RAG Engine ──
  ragIndexProject: (projectPath) => ipcRenderer.invoke('rag-index-project', projectPath),
  ragSearch: (query, maxResults) => ipcRenderer.invoke('rag-search', query, maxResults),
  ragSearchFiles: (query, maxResults) => ipcRenderer.invoke('rag-search-files', query, maxResults),
  ragGetContext: (query, maxChunks, maxTokens) => ipcRenderer.invoke('rag-get-context', query, maxChunks, maxTokens),
  ragFindError: (errorMessage, stackTrace) => ipcRenderer.invoke('rag-find-error', errorMessage, stackTrace),
  ragGetStatus: () => ipcRenderer.invoke('rag-get-status'),
  ragGetProjectSummary: () => ipcRenderer.invoke('rag-get-project-summary'),
  ragGetFileContent: (filePath) => ipcRenderer.invoke('rag-get-file-content', filePath),
  onRagProgress: (callback) => _on('rag-progress', callback),
  onRagStatus: (callback) => _on('rag-status', callback),

  // ── Web Search ──
  webSearch: (query, maxResults) => ipcRenderer.invoke('web-search', query, maxResults),
  webSearchCode: (query) => ipcRenderer.invoke('web-search-code', query),
  webFetchPage: (url) => ipcRenderer.invoke('web-fetch-page', url),

  // ── AI Chat (RAG + LLM integrated) ──
  aiChat: (message, context) => ipcRenderer.invoke('ai-chat', message, context),
  findBug: (errorMessage, stackTrace, projectPath) => ipcRenderer.invoke('find-bug', errorMessage, stackTrace, projectPath),

  // ── Inline Edit (Ctrl+I) ──
  inlineEdit: (params) => ipcRenderer.invoke('inline-edit', params),
  nextEditSuggestion: (params) => ipcRenderer.invoke('next-edit-suggestion', params),

  // ── AI Code Actions ──
  codeAction: (params) => ipcRenderer.invoke('code-action', params),

  // ── Project Templates ──
  templateList: () => ipcRenderer.invoke('template-list'),
  templateCreate: (params) => ipcRenderer.invoke('template-create', params),
  templateDetails: (templateId) => ipcRenderer.invoke('template-details', templateId),

  // ── Terminal IntelliSense ──
  terminalSuggest: (params) => ipcRenderer.invoke('terminal-suggest', params),

  // ── Custom Instructions ──
  loadCustomInstructions: (projectPath) => ipcRenderer.invoke('load-custom-instructions', projectPath),

  // ── Context Token Tracking ──
  estimateTokens: (text) => ipcRenderer.invoke('estimate-tokens', text),
  getContextUsage: () => ipcRenderer.invoke('get-context-usage'),

  // ── Cloud LLM APIs ──
  cloudLLMSetKey: (provider, key) => ipcRenderer.invoke('cloud-llm-set-key', provider, key),
  cloudLLMGetProviders: () => ipcRenderer.invoke('cloud-llm-get-providers'),
  cloudLLMGetAllProviders: () => ipcRenderer.invoke('cloud-llm-get-all-providers'),
  cloudLLMGetStatus: () => ipcRenderer.invoke('cloud-llm-get-status'),
  cloudLLMFetchOpenRouterModels: () => ipcRenderer.invoke('cloud-llm-fetch-openrouter-models'),
  cloudLLMGenerate: (prompt, options) => ipcRenderer.invoke('cloud-llm-generate', prompt, options),
  cloudLLMTestKey: (provider, model) => ipcRenderer.invoke('cloud-llm-test-key', provider, model),
  cloudLLMTestAllConfiguredKeys: () => ipcRenderer.invoke('cloud-llm-test-all-configured-keys'),

  // ── Git Integration ──
  gitStatus: () => ipcRenderer.invoke('git-status'),
  gitDiff: (filePath, staged) => ipcRenderer.invoke('git-diff', filePath, staged),
  gitStage: (filePath) => ipcRenderer.invoke('git-stage', filePath),
  gitStageAll: () => ipcRenderer.invoke('git-stage-all'),
  gitUnstage: (filePath) => ipcRenderer.invoke('git-unstage', filePath),
  gitUnstageAll: () => ipcRenderer.invoke('git-unstage-all'),
  gitDiscard: (filePath) => ipcRenderer.invoke('git-discard', filePath),
  gitCommit: (message) => ipcRenderer.invoke('git-commit', message),
  gitLog: (count) => ipcRenderer.invoke('git-log', count),
  gitBranches: () => ipcRenderer.invoke('git-branches'),
  gitCheckout: (branch) => ipcRenderer.invoke('git-checkout', branch),
  gitInit: () => ipcRenderer.invoke('git-init'),
  gitAheadBehind: () => ipcRenderer.invoke('git-ahead-behind'),
  gitBlame: (filePath) => ipcRenderer.invoke('git-blame', filePath),

  // ── Git: Push / Pull / Fetch ──
  gitPush: (remote, branch) => ipcRenderer.invoke('git-push', remote, branch),
  gitPull: (remote, branch) => ipcRenderer.invoke('git-pull', remote, branch),
  gitFetch: (remote) => ipcRenderer.invoke('git-fetch', remote),

  // ── Git: Branch Management ──
  gitCreateBranch: (name, checkout) => ipcRenderer.invoke('git-create-branch', name, checkout),
  gitDeleteBranch: (name, force) => ipcRenderer.invoke('git-delete-branch', name, force),
  gitMerge: (branch) => ipcRenderer.invoke('git-merge', branch),
  gitMergeAbort: () => ipcRenderer.invoke('git-merge-abort'),
  gitMergeState: () => ipcRenderer.invoke('git-merge-state'),

  // ── Git: Commit Details ──
  gitCommitDetail: (hash) => ipcRenderer.invoke('git-commit-detail', hash),
  gitCommitDiff: (hash) => ipcRenderer.invoke('git-commit-diff', hash),
  gitStagedDiff: () => ipcRenderer.invoke('git-staged-diff'),

  // ── AI Git ──
  gitAiCommitMessage: (params) => ipcRenderer.invoke('git-ai-commit-message', params),
  gitAiExplainCommit: (params) => ipcRenderer.invoke('git-ai-explain-commit', params),
  gitAiResolveConflict: (params) => ipcRenderer.invoke('git-ai-resolve-conflict', params),

  // ── Voice Commands ──
  voiceCommand: (params) => ipcRenderer.invoke('voice-command', params),

  // ── Database Viewer ──
  dbOpen: (filePath) => ipcRenderer.invoke('db-open', filePath),
  dbCreate: (filePath) => ipcRenderer.invoke('db-create', filePath),
  dbClose: (dbId) => ipcRenderer.invoke('db-close', dbId),
  dbTables: (dbId) => ipcRenderer.invoke('db-tables', dbId),
  dbTableSchema: (dbId, tableName) => ipcRenderer.invoke('db-table-schema', dbId, tableName),
  dbTableData: (dbId, tableName, offset, limit, orderBy, orderDir) => ipcRenderer.invoke('db-table-data', dbId, tableName, offset, limit, orderBy, orderDir),
  dbQuery: (dbId, sql) => ipcRenderer.invoke('db-query', dbId, sql),
  dbAiQuery: (params) => ipcRenderer.invoke('db-ai-query', params),
  dbSave: (dbId, filePath) => ipcRenderer.invoke('db-save', dbId, filePath),
  dbExportCsv: (dbId, sql, outputPath) => ipcRenderer.invoke('db-export-csv', dbId, sql, outputPath),
  dbListConnections: () => ipcRenderer.invoke('db-list-connections'),

  // ── AI Code Review ──
  codeReviewFile: (params) => ipcRenderer.invoke('code-review-file', params),
  codeReviewStaged: (params) => ipcRenderer.invoke('code-review-staged', params),
  codeReviewDiff: (params) => ipcRenderer.invoke('code-review-diff', params),
  codeReviewApplyFix: (params) => ipcRenderer.invoke('code-review-apply-fix', params),

  // ── Performance Profiler ──
  profilerRunNode: (params) => ipcRenderer.invoke('profiler-run-node', params),
  profilerRunPython: (params) => ipcRenderer.invoke('profiler-run-python', params),
  profilerTimeCommand: (params) => ipcRenderer.invoke('profiler-time-command', params),
  profilerMemorySnapshot: () => ipcRenderer.invoke('profiler-memory-snapshot'),
  profilerAiAnalyze: (params) => ipcRenderer.invoke('profiler-ai-analyze', params),
  profilerCancel: (sessionId) => ipcRenderer.invoke('profiler-cancel', sessionId),
  profilerListSessions: () => ipcRenderer.invoke('profiler-list-sessions'),

  // ── Smart Search & Navigation ──
  smartSearchSymbols: (params) => ipcRenderer.invoke('smart-search-symbols', params),
  smartSearchReferences: (params) => ipcRenderer.invoke('smart-search-references', params),
  smartSearchDefinition: (params) => ipcRenderer.invoke('smart-search-definition', params),
  smartSearchSemantic: (params) => ipcRenderer.invoke('smart-search-semantic', params),
  smartSearchSimilar: (params) => ipcRenderer.invoke('smart-search-similar', params),
  smartSearchBreadcrumb: (params) => ipcRenderer.invoke('smart-search-breadcrumb', params),
  smartSearchProjectSymbols: (params) => ipcRenderer.invoke('smart-search-project-symbols', params),

  // ── Documentation Generator ──
  docsGenerateFile: (params) => ipcRenderer.invoke('docs-generate-file', params),
  docsGenerateReadme: (params) => ipcRenderer.invoke('docs-generate-readme', params),
  docsGenerateApi: (params) => ipcRenderer.invoke('docs-generate-api', params),
  docsGenerateArchitecture: (params) => ipcRenderer.invoke('docs-generate-architecture', params),
  docsExplainCodebase: (params) => ipcRenderer.invoke('docs-explain-codebase', params),

  // ── SSH Remote Development ──
  sshAvailable: () => ipcRenderer.invoke('ssh-available'),
  sshGetProfiles: () => ipcRenderer.invoke('ssh-get-profiles'),
  sshSaveProfile: (profile) => ipcRenderer.invoke('ssh-save-profile', profile),
  sshDeleteProfile: (profileId) => ipcRenderer.invoke('ssh-delete-profile', profileId),
  sshConnect: (params) => ipcRenderer.invoke('ssh-connect', params),
  sshDisconnect: (connectionId) => ipcRenderer.invoke('ssh-disconnect', connectionId),
  sshListDir: (connectionId, remotePath) => ipcRenderer.invoke('ssh-list-dir', connectionId, remotePath),
  sshReadFile: (connectionId, remotePath) => ipcRenderer.invoke('ssh-read-file', connectionId, remotePath),
  sshWriteFile: (connectionId, remotePath, content) => ipcRenderer.invoke('ssh-write-file', connectionId, remotePath, content),
  sshDelete: (connectionId, remotePath, isDir) => ipcRenderer.invoke('ssh-delete', connectionId, remotePath, isDir),
  sshRename: (connectionId, oldPath, newPath) => ipcRenderer.invoke('ssh-rename', connectionId, oldPath, newPath),
  sshMkdir: (connectionId, remotePath) => ipcRenderer.invoke('ssh-mkdir', connectionId, remotePath),
  sshExec: (connectionId, command) => ipcRenderer.invoke('ssh-exec', connectionId, command),
  sshStat: (connectionId, remotePath) => ipcRenderer.invoke('ssh-stat', connectionId, remotePath),
  sshListConnections: () => ipcRenderer.invoke('ssh-list-connections'),

  // ── Plugin / Extension System ──
  pluginMarketplace: (params) => ipcRenderer.invoke('plugin-marketplace', params),
  pluginListInstalled: () => ipcRenderer.invoke('plugin-list-installed'),
  pluginInstall: (pluginId) => ipcRenderer.invoke('plugin-install', pluginId),
  pluginUninstall: (pluginId) => ipcRenderer.invoke('plugin-uninstall', pluginId),
  pluginToggle: (pluginId, enabled) => ipcRenderer.invoke('plugin-toggle', pluginId, enabled),
  pluginGetDetails: (pluginId) => ipcRenderer.invoke('plugin-get-details', pluginId),
  pluginCategories: () => ipcRenderer.invoke('plugin-categories'),

  // ── Collaborative Editing (Live Share) ──
  collabAvailable: () => ipcRenderer.invoke('collab-available'),
  collabHost: (params) => ipcRenderer.invoke('collab-host', params),
  collabStopHost: () => ipcRenderer.invoke('collab-stop-host'),
  collabJoin: (params) => ipcRenderer.invoke('collab-join', params),
  collabLeave: () => ipcRenderer.invoke('collab-leave'),
  collabSendEdit: (params) => ipcRenderer.invoke('collab-send-edit', params),
  collabSendCursor: (cursor) => ipcRenderer.invoke('collab-send-cursor', cursor),
  collabSendChat: (message) => ipcRenderer.invoke('collab-send-chat', message),
  collabGetSession: () => ipcRenderer.invoke('collab-get-session'),
  collabUpdateDoc: (content) => ipcRenderer.invoke('collab-update-doc', content),
  onCollabEvent: (callback) => _on('collab-event', callback),

  // ── Notebook / REPL ──
  notebookExecNode: (params) => ipcRenderer.invoke('notebook-exec-node', params),
  notebookExecPython: (params) => ipcRenderer.invoke('notebook-exec-python', params),
  notebookExecShell: (params) => ipcRenderer.invoke('notebook-exec-shell', params),
  notebookSaveIpynb: (params) => ipcRenderer.invoke('notebook-save-ipynb', params),
  notebookLoadIpynb: (filePath) => ipcRenderer.invoke('notebook-load-ipynb', filePath),
  notebookAiGenerate: (params) => ipcRenderer.invoke('notebook-ai-generate', params),
  notebookClearOutputs: () => ipcRenderer.invoke('notebook-clear-outputs'),

  // ── MCP Tools ──
  mcpGetTools: () => ipcRenderer.invoke('mcp-get-tools'),
  mcpExecuteTool: (toolName, params) => ipcRenderer.invoke('mcp-execute-tool', toolName, params),
  mcpGetHistory: () => ipcRenderer.invoke('mcp-get-history'),
  onMcpToolsAvailable: (callback) => _on('mcp-tools-available', callback),
  onMcpToolResults: (callback) => _on('mcp-tool-results', callback),
  onToolExecuting: (callback) => _on('tool-executing', callback),

  // ── MCP Server Management ──
  mcpListServers: () => ipcRenderer.invoke('mcp-list-servers'),
  mcpAddServer: (config) => ipcRenderer.invoke('mcp-add-server', config),
  mcpRemoveServer: (serverId) => ipcRenderer.invoke('mcp-remove-server', serverId),
  mcpRestartServer: (serverId) => ipcRenderer.invoke('mcp-restart-server', serverId),
  onMcpServerStatus: (callback) => _on('mcp-server-status', callback),

  // ── File Change Undo ──
  fileUndoList: () => ipcRenderer.invoke('file-undo-list'),
  fileUndo: (filePath) => ipcRenderer.invoke('file-undo', filePath),
  fileUndoAll: () => ipcRenderer.invoke('file-undo-all'),
  fileAcceptChanges: (filePaths) => ipcRenderer.invoke('file-accept-changes', filePaths),

  // ── Checkpoints ──
  checkpointList: () => ipcRenderer.invoke('checkpoint-list'),
  checkpointRestore: (turnId) => ipcRenderer.invoke('checkpoint-restore', turnId),
  onCheckpointReady: (callback) => _on('checkpoint-ready', callback),

  // ── Context Usage ──
  onContextUsage: (callback) => _on('context-usage', callback),

  // ── Agentic Progress ──
  onAgenticProgress: (callback) => _on('agentic-progress', callback),
  onAgenticPhase: (callback) => _on('agentic-phase', callback),

  // ── Todo Updates ──
  onTodoUpdate: (callback) => _on('todo-update', callback),

  // ── Audio Transcription (Speech-to-Text) ──
  transcribeAudio: (audioBase64) => ipcRenderer.invoke('transcribe-audio', audioBase64),

  // ── Image Generation (cloud) ──
  imageGenerate: (prompt, options) => ipcRenderer.invoke('image-generate', prompt, options),
  imageSave: (imageBase64, mimeType, suggestedName) => ipcRenderer.invoke('image-save', imageBase64, mimeType, suggestedName),
  imageSaveToProject: (imageBase64, mimeType, fileName) => ipcRenderer.invoke('image-save-to-project', imageBase64, mimeType, fileName),
  imageGenStatus: () => ipcRenderer.invoke('image-gen-status'),

  // ── Local Image Generation (stable-diffusion.cpp) ──
  localImageGenerate: (params) => ipcRenderer.invoke('local-image-generate', params),
  localImageCancel: () => ipcRenderer.invoke('local-image-cancel'),
  localImageEngineStatus: () => ipcRenderer.invoke('local-image-engine-status'),
  onLocalImageProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('local-image-progress', handler);
    return () => ipcRenderer.removeListener('local-image-progress', handler);
  },

  // ── Video Generation ──
  videoGenerate: (prompt, options) => ipcRenderer.invoke('video-generate', prompt, options),
  videoSave: (videoBase64, mimeType) => ipcRenderer.invoke('video-save', videoBase64, mimeType),
  videoSaveToProject: (videoBase64, mimeType, fileName) => ipcRenderer.invoke('video-save-to-project', videoBase64, mimeType, fileName),

  // ── Settings & Chat Persistence ──
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  getSystemPromptPreview: () => ipcRenderer.invoke('get-system-prompt-preview'),
  saveChatSessions: (sessions) => ipcRenderer.invoke('save-chat-sessions', sessions),
  loadChatSessions: () => ipcRenderer.invoke('load-chat-sessions'),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),

  // ── System Resources ──
  getSystemResources: () => ipcRenderer.invoke('get-system-resources'),

  // ── Files Changed (auto-refresh) ──
  onFilesChanged: (callback) => _on('files-changed', callback),

  // ── Agent File Modifications (diff highlighting) ──
  onAgentFileModified: (callback) => _on('agent-file-modified', callback),

  // ── Browser Automation ──
  browserNavigate: (url) => ipcRenderer.invoke('browser-navigate', url),
  browserShow: (bounds) => ipcRenderer.invoke('browser-show', bounds),
  browserFocus: () => ipcRenderer.invoke('browser-focus'),
  browserHide: () => ipcRenderer.invoke('browser-hide'),
  browserSetBounds: (bounds) => ipcRenderer.invoke('browser-set-bounds', bounds),
  browserGoBack: () => ipcRenderer.invoke('browser-go-back'),
  browserGoForward: () => ipcRenderer.invoke('browser-go-forward'),
  browserReload: () => ipcRenderer.invoke('browser-reload'),
  browserGetState: () => ipcRenderer.invoke('browser-get-state'),
  browserScreenshot: () => ipcRenderer.invoke('browser-screenshot'),
  browserGetContent: (selector, html) => ipcRenderer.invoke('browser-get-content', selector, html),
  browserEvaluate: (code) => ipcRenderer.invoke('browser-evaluate', code),
  browserClick: (selector) => ipcRenderer.invoke('browser-click', selector),
  browserType: (selector, text) => ipcRenderer.invoke('browser-type', selector, text),
  browserLaunchExternal: (url) => ipcRenderer.invoke('browser-launch-external', url),
  onShowBrowser: (callback) => _on('show-browser', callback),
  onBrowserRestore: (callback) => _on('browser-restore', callback),
  onBrowserStateChanged: (callback) => _on('browser-state-changed', callback),

  // ── Memory Store ──
  memoryGetStats: () => ipcRenderer.invoke('memory-get-stats'),
  memoryGetContext: () => ipcRenderer.invoke('memory-get-context'),
  memoryLearnFact: (key, value) => ipcRenderer.invoke('memory-learn-fact', key, value),
  memoryFindErrors: (errorMsg) => ipcRenderer.invoke('memory-find-errors', errorMsg),
  memoryClear: () => ipcRenderer.invoke('memory-clear'),
  memoryClearConversations: () => ipcRenderer.invoke('memory-clear-conversations'),
  onMemoryStats: (callback) => _on('memory-stats', callback),

  // ── Debug Service (DAP) ──
  debugStart: (config) => ipcRenderer.invoke('debug-start', config),
  debugStop: (sessionId) => ipcRenderer.invoke('debug-stop', sessionId),
  debugSetBreakpoints: (sessionId, filePath, breakpoints) => ipcRenderer.invoke('debug-set-breakpoints', sessionId, filePath, breakpoints),
  debugContinue: (sessionId) => ipcRenderer.invoke('debug-continue', sessionId),
  debugStepOver: (sessionId) => ipcRenderer.invoke('debug-step-over', sessionId),
  debugStepInto: (sessionId) => ipcRenderer.invoke('debug-step-into', sessionId),
  debugStepOut: (sessionId) => ipcRenderer.invoke('debug-step-out', sessionId),
  debugPause: (sessionId) => ipcRenderer.invoke('debug-pause', sessionId),
  debugStackTrace: (sessionId) => ipcRenderer.invoke('debug-stack-trace', sessionId),
  debugScopes: (sessionId, frameId) => ipcRenderer.invoke('debug-scopes', sessionId, frameId),
  debugVariables: (sessionId, variablesReference) => ipcRenderer.invoke('debug-variables', sessionId, variablesReference),
  debugEvaluate: (sessionId, expression, frameId) => ipcRenderer.invoke('debug-evaluate', sessionId, expression, frameId),
  debugGetSessions: () => ipcRenderer.invoke('debug-get-sessions'),
  onDebugEvent: (callback) => _on('debug-event', callback),

  // ── Benchmark ──
  benchmarkGetTests: () => ipcRenderer.invoke('benchmark-get-tests'),
  benchmarkSaveResults: (results) => ipcRenderer.invoke('benchmark-save-results', results),
  benchmarkLoadResults: () => ipcRenderer.invoke('benchmark-load-results'),
  benchmarkCancel: () => ipcRenderer.invoke('benchmark-cancel'),
  onBenchmarkProgress: (callback) => _on('benchmark-progress', callback),
  onBenchmarkTestResult: (callback) => _on('benchmark-test-result', callback),

  // ── Background Agents (Multi-Agent) ──
  agentSpawn: (task, context) => ipcRenderer.invoke('agent-spawn', task, context),
  agentCancel: (agentId) => ipcRenderer.invoke('agent-cancel', agentId),
  agentGetResult: (agentId) => ipcRenderer.invoke('agent-get-result', agentId),
  agentList: () => ipcRenderer.invoke('agent-list'),
  onAgentStatus: (callback) => _on('agent-status', callback),

  // ── Menu/App Events (main → renderer) ──
  onMenuAction: (callback) => _on('menu-action', callback),
  onOpenFile: (callback) => _on('open-file', callback),
  onOpenFolder: (callback) => _on('open-folder', callback),

  // Legacy event compatibility
  onFolderOpened: (callback) => _on('folder-opened', callback),
  onMenuOpenProject: (callback) => _on('menu-open-project', callback),

  // ── Auto-Update ──
  onUpdateAvailable: (callback) => _on('update-available', callback),
  onUpdateDownloaded: (callback) => _on('update-downloaded', callback),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // ── Title Bar Theming ──
  setTitleBarOverlay: (opts) => ipcRenderer.invoke('set-titlebar-overlay', opts),

  // ── Cleanup (prefer cleanup functions returned by on* methods) ──
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel), // deprecated
  removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),
});
