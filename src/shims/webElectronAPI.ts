/**
 * guIDE — Web Electron API Shim
 *
 * Sets window.electronAPI to a WebSocket-backed implementation when running
 * in a browser (i.e., NOT loaded via Electron's contextBridge preload).
 *
 * This file is imported at the top of src/main.tsx. When loaded inside
 * Electron, window.electronAPI is already set by preload.js so this module
 * exits immediately. When loaded in a browser, it sets up the full API
 * surface backed by a WebSocket connection to server.js on port 3200.
 *
 * Protocol:
 *   invoke  (browser → server): { type:'invoke',  id, channel, args }
 *   reply   (server → browser): { type:'invoke-reply', id, result, error? }
 *   event   (server → browser): { type:'event', channel, payload }
 */

// Do nothing if we're inside Electron (preload.js already set window.electronAPI)
if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  setupWebElectronAPI();
}

function setupWebElectronAPI() {
  // ── WebSocket connection ──────────────────────────────────────────────────
  const proto   = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl   = `${proto}//${location.host}/ws`;

  const pending   = new Map<string, { resolve: Function; reject: Function }>();
  const listeners = new Map<string, Set<Function>>();
  const sendQueue: string[] = [];
  let   socket:   WebSocket | null = null;

  function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      // Flush queued messages
      for (const msg of sendQueue) socket!.send(msg);
      sendQueue.length = 0;
    };

    // Diagnostic counter for token events
    let _tokenEventCount = 0;
    socket.onmessage = (e: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'invoke-reply') {
        const p = pending.get(msg.id);
        if (p) {
          if (msg.error) p.reject(new Error(msg.error));
          else           p.resolve(msg.result);
          pending.delete(msg.id);
        }
      } else if (msg.type === 'event') {
        if (msg.channel === 'llm-token') {
          _tokenEventCount++;
          if (_tokenEventCount <= 3 || _tokenEventCount % 100 === 0) {
            console.log('[WS-DIAG] llm-token #' + _tokenEventCount, 'listeners:', listeners.get(msg.channel)?.size || 0);
          }
        } else if (msg.channel === 'llm-replace-last' || msg.channel === 'llm-iteration-begin') {
          console.log('[WS-DIAG]', msg.channel, 'listeners:', listeners.get(msg.channel)?.size || 0);
        }
        const cbs = listeners.get(msg.channel);
        if (cbs) cbs.forEach(cb => { try { cb(msg.payload); } catch (_) {} });
      }
    };

    socket.onclose = () => {
      socket = null;
      // Reconnect after 1 second
      setTimeout(connect, 1000);
    };

    socket.onerror = () => {
      // onclose fires immediately after onerror — reconnect handled there
    };
  }

  connect();

  // ── Core helpers ─────────────────────────────────────────────────────────
  function invoke(channel: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id  = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ type: 'invoke', id, channel, args });
      if (socket?.readyState === WebSocket.OPEN) socket.send(msg);
      else sendQueue.push(msg);
    });
  }

  // Registers an event listener; returns a cleanup function (same pattern as preload.js _on)
  function on(channel: string, callback: Function): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
    return () => listeners.get(channel)?.delete(callback);
  }

  // ── Expose window.electronAPI (mirrors preload.js 1:1) ───────────────────
  (window as any).electronAPI = {
    // ── App Info ──
    getAppVersion: () => invoke('get-app-version'),
    getPlatform:   () => invoke('get-platform'),
    getHomeDir:    () => invoke('get-home-dir'),
    getAppPath:    () => invoke('get-app-path'),
    getSystemInfo: () => invoke('get-system-info'),

    // ── File Operations ──
    readFile:        (filePath: string)             => invoke('read-file', filePath),
    writeFile:       (filePath: string, content: string) => invoke('write-file', filePath, content),
    readDirectory:   (dirPath: string)              => invoke('read-directory', dirPath),
    getFileStats:    (filePath: string)             => invoke('get-file-stats', filePath),
    createDirectory: (dirPath: string)              => invoke('create-directory', dirPath),
    deleteFile:      (filePath: string)             => invoke('delete-file', filePath),
    deleteDirectory: (dirPath: string)              => invoke('delete-directory', dirPath),
    copyFile:        (src: string, dest: string)    => invoke('copy-file', src, dest),
    copyDirectory:   (src: string, dest: string)    => invoke('copy-directory', src, dest),
    moveFile:        (src: string, dest: string)    => invoke('move-file', src, dest),
    renameFile:      (oldPath: string, newPath: string) => invoke('rename-file', oldPath, newPath),
    fileExists:      (filePath: string)             => invoke('file-exists', filePath),
    listDirectory:   (dirPath: string)              => invoke('list-directory', dirPath),
    searchInFiles:   (rootPath: string, query: string, options: any) => invoke('search-in-files', rootPath, query, options),
    scanTodos:       (rootPath: string)             => invoke('scan-todos', rootPath),
    liveServerStart: (filePath: string)             => invoke('live-server-start', filePath),
    liveServerStop:  ()                             => invoke('live-server-stop'),
    liveServerStatus:()                             => invoke('live-server-status'),
    restRequest:     (opts: any)                    => invoke('rest-request', opts),
    onFileDeleted:   (cb: Function) => on('file-deleted', cb),

    // ── Dialogs ──
    showSaveDialog:        (options: any) => invoke('show-save-dialog', options),
    showOpenDialog:        (options: any) => invoke('show-open-dialog', options),
    showMessageBox:        (options: any) => invoke('show-message-box', options),
    openExternal:          (url: string)  => invoke('open-external', url),
    revealInExplorer:      (filePath: string) => invoke('reveal-in-explorer', filePath),
    openContainingFolder:  (folderPath: string) => invoke('open-containing-folder', folderPath),

    // ── Recent Folders ──
    updateRecentFolders: (_folders: any[]) => { /* no-op in web mode */ },

    // ── Terminal ──
    terminalCreate:  (options: any) => invoke('terminal-create', options),
    terminalWrite:   (id: string, data: string) => invoke('terminal-write', id, data),
    terminalResize:  (id: string, cols: number, rows: number) => invoke('terminal-resize', id, cols, rows),
    terminalDestroy: (id: string) => invoke('terminal-destroy', id),
    terminalList:    () => invoke('terminal-list'),
    onTerminalData:  (cb: Function) => on('terminal-data', cb),
    onTerminalExit:  (cb: Function) => on('terminal-exit', cb),

    // ── LLM ──
    llmGetStatus:          () => invoke('llm-get-status'),
    llmLoadModel:          (modelPath: string)           => invoke('llm-load-model', modelPath),
    llmGenerate:           (prompt: string, params: any) => invoke('llm-generate', prompt, params),
    llmGenerateStream:     (prompt: string, params: any) => invoke('llm-generate-stream', prompt, params),
    llmCancel:             () => invoke('llm-cancel'),
    llmResetSession:       () => invoke('llm-reset-session'),
    llmUpdateParams:       (params: any) => invoke('llm-update-params', params),
    llmSetContextSize:     (contextSize: number) => invoke('llm-set-context-size', contextSize),
    llmSetReasoningEffort: (level: string) => invoke('llm-set-reasoning-effort', level),
    llmSetThinkingBudget:  (budget: number) => invoke('llm-set-thinking-budget', budget),

    // ── GPU ──
    gpuGetInfo:       () => invoke('gpu-get-info'),
    gpuSetPreference: (pref: string) => invoke('gpu-set-preference', pref),
    gpuGetPreference: () => invoke('gpu-get-preference'),

    onLlmStatus:        (cb: Function) => on('llm-status', cb),
    onLlmToken:         (cb: Function) => on('llm-token', cb),
    onLlmThinkingToken: (cb: Function) => on('llm-thinking-token', cb),
    onLlmReplaceLast:   (cb: Function) => on('llm-replace-last', cb),
    onLlmIterationBegin:(cb: Function) => on('llm-iteration-begin', cb),
    onLlmToolGenerating:(cb: Function) => on('llm-tool-generating', cb),
    onLlmFileAccUpdate: (cb: Function) => on('llm-file-acc-update', cb),
    onDevLog:           (cb: Function) => on('dev-log', cb),

    // ── Model Management ──
    modelsList:          ()               => invoke('models-list'),
    modelsScan:          ()               => invoke('models-scan'),
    modelsGetDefault:    ()               => invoke('models-get-default'),
    modelsDir:           ()               => invoke('models-dir'),
    modelsAdd:           ()               => invoke('models-add'),
    modelsRemove:        (modelPath: string) => invoke('models-remove', modelPath),
    onModelsAvailable:   (cb: Function)   => on('models-available', cb),
    onModelAutoLoaded:   (cb: Function)   => on('model-auto-loaded', cb),
    setDefaultModel:     (modelPath: string) => invoke('set-default-model', modelPath),
    getDefaultModelPath: ()               => invoke('get-default-model'),

    // ── Hardware & Model Recommendations ──
    getHardwareInfo:         ()      => invoke('get-hardware-info'),
    getRecommendedModels:    ()      => invoke('get-recommended-models'),
    modelsDownloadHF:        (opts: any) => invoke('models-download-hf', opts),
    modelsCancelDownload:    (fileName: string) => invoke('models-cancel-download', fileName),
    onModelDownloadProgress: (cb: Function) => on('model-download-progress', cb),

    // ── License Management ──
    licenseGetStatus:          ()                          => invoke('license-get-status'),
    licenseActivate:           (key: string)               => invoke('license-activate', key),
    licenseActivateWithAccount:(email: string, password: string) => invoke('license-activate-account', email, password),
    licenseOAuthSignIn:        (provider: string)          => invoke('license-oauth-signin', provider),
    licenseDeactivate:         ()                          => invoke('license-deactivate'),
    licenseLoad:               ()                          => invoke('license-load'),
    licenseRevalidate:         ()                          => invoke('license-revalidate'),
    licenseCheckAccess:        ()                          => invoke('license-check-access'),

    // ── RAG Engine ──
    ragIndexProject:      (projectPath: string)                     => invoke('rag-index-project', projectPath),
    ragSearch:            (query: string, maxResults: number)        => invoke('rag-search', query, maxResults),
    ragSearchFiles:       (query: string, maxResults: number)        => invoke('rag-search-files', query, maxResults),
    ragGetContext:        (query: string, maxChunks: number, maxTokens: number) => invoke('rag-get-context', query, maxChunks, maxTokens),
    ragFindError:         (errorMessage: string, stackTrace: string) => invoke('rag-find-error', errorMessage, stackTrace),
    ragGetStatus:         ()                                        => invoke('rag-get-status'),
    ragGetProjectSummary: ()                                        => invoke('rag-get-project-summary'),
    ragGetFileContent:    (filePath: string)                        => invoke('rag-get-file-content', filePath),
    onRagProgress:        (cb: Function) => on('rag-progress', cb),
    onRagStatus:          (cb: Function) => on('rag-status', cb),

    // ── Web Search ──
    webSearch:     (query: string, maxResults: number) => invoke('web-search', query, maxResults),
    webSearchCode: (query: string)                     => invoke('web-search-code', query),
    webFetchPage:  (url: string)                       => invoke('web-fetch-page', url),

    // ── AI Chat ──
    aiChat:   (message: string, context: any)                              => invoke('ai-chat', message, context),
    findBug:  (errorMessage: string, stackTrace: string, projectPath: string) => invoke('find-bug', errorMessage, stackTrace, projectPath),

    // ── Inline Edit ──
    inlineEdit:         (params: any) => invoke('inline-edit', params),
    nextEditSuggestion: (params: any) => invoke('next-edit-suggestion', params),

    // ── AI Code Actions ──
    codeAction: (params: any) => invoke('code-action', params),

    // ── Project Templates ──
    templateList:    ()                     => invoke('template-list'),
    templateCreate:  (params: any)          => invoke('template-create', params),
    templateDetails: (templateId: string)   => invoke('template-details', templateId),

    // ── Terminal IntelliSense ──
    terminalSuggest: (params: any) => invoke('terminal-suggest', params),

    // ── Custom Instructions ──
    loadCustomInstructions: (projectPath: string) => invoke('load-custom-instructions', projectPath),

    // ── Context Token Tracking ──
    estimateTokens:  (text: string) => invoke('estimate-tokens', text),
    getContextUsage: ()             => invoke('get-context-usage'),

    // ── Cloud LLM APIs ──
    cloudLLMSetKey:                 (provider: string, key: string) => invoke('cloud-llm-set-key', provider, key),
    cloudLLMGetProviders:           ()                              => invoke('cloud-llm-get-providers'),
    cloudLLMGetAllProviders:        ()                              => invoke('cloud-llm-get-all-providers'),
    cloudLLMGetStatus:              ()                              => invoke('cloud-llm-get-status'),
    cloudLLMFetchOpenRouterModels:  ()                              => invoke('cloud-llm-fetch-openrouter-models'),
    cloudLLMGenerate:               (prompt: string, options: any)  => invoke('cloud-llm-generate', prompt, options),
    cloudLLMTestKey:                (provider: string, model: string) => invoke('cloud-llm-test-key', provider, model),
    cloudLLMTestAllConfiguredKeys:  ()                              => invoke('cloud-llm-test-all-configured-keys'),

    // ── Git Integration ──
    gitStatus:      () => invoke('git-status'),
    gitDiff:        (filePath: string, staged: boolean) => invoke('git-diff', filePath, staged),
    gitStage:       (filePath: string) => invoke('git-stage', filePath),
    gitStageAll:    () => invoke('git-stage-all'),
    gitUnstage:     (filePath: string) => invoke('git-unstage', filePath),
    gitUnstageAll:  () => invoke('git-unstage-all'),
    gitDiscard:     (filePath: string) => invoke('git-discard', filePath),
    gitCommit:      (message: string)  => invoke('git-commit', message),
    gitLog:         (count: number)    => invoke('git-log', count),
    gitBranches:    () => invoke('git-branches'),
    gitCheckout:    (branch: string)   => invoke('git-checkout', branch),
    gitInit:        () => invoke('git-init'),
    gitAheadBehind: () => invoke('git-ahead-behind'),
    gitBlame:       (filePath: string) => invoke('git-blame', filePath),
    gitPush:        (remote: string, branch: string) => invoke('git-push', remote, branch),
    gitPull:        (remote: string, branch: string) => invoke('git-pull', remote, branch),
    gitFetch:       (remote: string)   => invoke('git-fetch', remote),
    gitCreateBranch:(name: string, checkout: boolean) => invoke('git-create-branch', name, checkout),
    gitDeleteBranch:(name: string, force: boolean)    => invoke('git-delete-branch', name, force),
    gitMerge:       (branch: string)   => invoke('git-merge', branch),
    gitMergeAbort:  () => invoke('git-merge-abort'),
    gitMergeState:  () => invoke('git-merge-state'),
    gitCommitDetail:(hash: string)  => invoke('git-commit-detail', hash),
    gitCommitDiff:  (hash: string)  => invoke('git-commit-diff', hash),
    gitStagedDiff:  () => invoke('git-staged-diff'),
    gitAiCommitMessage:   (params: any) => invoke('git-ai-commit-message', params),
    gitAiExplainCommit:   (params: any) => invoke('git-ai-explain-commit', params),
    gitAiResolveConflict: (params: any) => invoke('git-ai-resolve-conflict', params),

    // ── Voice Commands ──
    voiceCommand: (params: any) => invoke('voice-command', params),

    // ── Database Viewer ──
    dbOpen:            (filePath: string)   => invoke('db-open', filePath),
    dbCreate:          (filePath: string)   => invoke('db-create', filePath),
    dbClose:           (dbId: string)       => invoke('db-close', dbId),
    dbTables:          (dbId: string)       => invoke('db-tables', dbId),
    dbTableSchema:     (dbId: string, tableName: string) => invoke('db-table-schema', dbId, tableName),
    dbTableData:       (dbId: string, tableName: string, offset: number, limit: number, orderBy: string, orderDir: string) =>
                         invoke('db-table-data', dbId, tableName, offset, limit, orderBy, orderDir),
    dbQuery:           (dbId: string, sql: string) => invoke('db-query', dbId, sql),
    dbAiQuery:         (params: any)        => invoke('db-ai-query', params),
    dbSave:            (dbId: string, filePath: string) => invoke('db-save', dbId, filePath),
    dbExportCsv:       (dbId: string, sql: string, outputPath: string) => invoke('db-export-csv', dbId, sql, outputPath),
    dbListConnections: ()                   => invoke('db-list-connections'),

    // ── AI Code Review ──
    codeReviewFile:     (params: any) => invoke('code-review-file', params),
    codeReviewStaged:   (params: any) => invoke('code-review-staged', params),
    codeReviewDiff:     (params: any) => invoke('code-review-diff', params),
    codeReviewApplyFix: (params: any) => invoke('code-review-apply-fix', params),

    // ── Performance Profiler ──
    profilerRunNode:       (params: any)       => invoke('profiler-run-node', params),
    profilerRunPython:     (params: any)       => invoke('profiler-run-python', params),
    profilerTimeCommand:   (params: any)       => invoke('profiler-time-command', params),
    profilerMemorySnapshot:()                  => invoke('profiler-memory-snapshot'),
    profilerAiAnalyze:     (params: any)       => invoke('profiler-ai-analyze', params),
    profilerCancel:        (sessionId: string) => invoke('profiler-cancel', sessionId),
    profilerListSessions:  ()                  => invoke('profiler-list-sessions'),

    // ── Smart Search & Navigation ──
    smartSearchSymbols:        (params: any) => invoke('smart-search-symbols', params),
    smartSearchReferences:     (params: any) => invoke('smart-search-references', params),
    smartSearchDefinition:     (params: any) => invoke('smart-search-definition', params),
    smartSearchSemantic:       (params: any) => invoke('smart-search-semantic', params),
    smartSearchSimilar:        (params: any) => invoke('smart-search-similar', params),
    smartSearchBreadcrumb:     (params: any) => invoke('smart-search-breadcrumb', params),
    smartSearchProjectSymbols: (params: any) => invoke('smart-search-project-symbols', params),

    // ── Documentation Generator ──
    docsGenerateFile:        (params: any) => invoke('docs-generate-file', params),
    docsGenerateReadme:      (params: any) => invoke('docs-generate-readme', params),
    docsGenerateApi:         (params: any) => invoke('docs-generate-api', params),
    docsGenerateArchitecture:(params: any) => invoke('docs-generate-architecture', params),
    docsExplainCodebase:     (params: any) => invoke('docs-explain-codebase', params),

    // ── SSH Remote Development ──
    sshAvailable:       () => invoke('ssh-available'),
    sshGetProfiles:     () => invoke('ssh-get-profiles'),
    sshSaveProfile:     (profile: any)    => invoke('ssh-save-profile', profile),
    sshDeleteProfile:   (profileId: string) => invoke('ssh-delete-profile', profileId),
    sshConnect:         (params: any)     => invoke('ssh-connect', params),
    sshDisconnect:      (connectionId: string) => invoke('ssh-disconnect', connectionId),
    sshListDir:         (connectionId: string, remotePath: string) => invoke('ssh-list-dir', connectionId, remotePath),
    sshReadFile:        (connectionId: string, remotePath: string) => invoke('ssh-read-file', connectionId, remotePath),
    sshWriteFile:       (connectionId: string, remotePath: string, content: string) => invoke('ssh-write-file', connectionId, remotePath, content),
    sshDelete:          (connectionId: string, remotePath: string, isDir: boolean) => invoke('ssh-delete', connectionId, remotePath, isDir),
    sshRename:          (connectionId: string, oldPath: string, newPath: string) => invoke('ssh-rename', connectionId, oldPath, newPath),
    sshMkdir:           (connectionId: string, remotePath: string) => invoke('ssh-mkdir', connectionId, remotePath),
    sshExec:            (connectionId: string, command: string) => invoke('ssh-exec', connectionId, command),
    sshStat:            (connectionId: string, remotePath: string) => invoke('ssh-stat', connectionId, remotePath),
    sshListConnections: () => invoke('ssh-list-connections'),

    // ── Plugin / Extension System ──
    pluginMarketplace:   (params: any)       => invoke('plugin-marketplace', params),
    pluginListInstalled: ()                  => invoke('plugin-list-installed'),
    pluginInstall:       (pluginId: string)  => invoke('plugin-install', pluginId),
    pluginUninstall:     (pluginId: string)  => invoke('plugin-uninstall', pluginId),
    pluginToggle:        (pluginId: string, enabled: boolean) => invoke('plugin-toggle', pluginId, enabled),
    pluginGetDetails:    (pluginId: string)  => invoke('plugin-get-details', pluginId),
    pluginCategories:    ()                  => invoke('plugin-categories'),

    // ── Collaborative Editing ──
    collabAvailable:  () => invoke('collab-available'),
    collabHost:       (params: any)        => invoke('collab-host', params),
    collabStopHost:   ()                   => invoke('collab-stop-host'),
    collabJoin:       (params: any)        => invoke('collab-join', params),
    collabLeave:      ()                   => invoke('collab-leave'),
    collabSendEdit:   (params: any)        => invoke('collab-send-edit', params),
    collabSendCursor: (cursor: any)        => invoke('collab-send-cursor', cursor),
    collabSendChat:   (message: string)    => invoke('collab-send-chat', message),
    collabGetSession: ()                   => invoke('collab-get-session'),
    collabUpdateDoc:  (content: string)    => invoke('collab-update-doc', content),
    onCollabEvent:    (cb: Function)       => on('collab-event', cb),

    // ── Notebook / REPL ──
    notebookExecNode:    (params: any)       => invoke('notebook-exec-node', params),
    notebookExecPython:  (params: any)       => invoke('notebook-exec-python', params),
    notebookExecShell:   (params: any)       => invoke('notebook-exec-shell', params),
    notebookSaveIpynb:   (params: any)       => invoke('notebook-save-ipynb', params),
    notebookLoadIpynb:   (filePath: string)  => invoke('notebook-load-ipynb', filePath),
    notebookAiGenerate:  (params: any)       => invoke('notebook-ai-generate', params),
    notebookClearOutputs:()                  => invoke('notebook-clear-outputs'),

    // ── MCP Tools ──
    mcpGetTools:     ()                            => invoke('mcp-get-tools'),
    mcpExecuteTool:  (toolName: string, params: any) => invoke('mcp-execute-tool', toolName, params),
    mcpGetHistory:   ()                            => invoke('mcp-get-history'),
    onMcpToolsAvailable:(cb: Function)             => on('mcp-tools-available', cb),
    onMcpToolResults:   (cb: Function)             => on('mcp-tool-results', cb),
    onToolExecuting:    (cb: Function)             => on('tool-executing', cb),

    // ── MCP Server Management ──
    mcpListServers:   ()             => invoke('mcp-list-servers'),
    mcpAddServer:     (config: any)  => invoke('mcp-add-server', config),
    mcpRemoveServer:  (serverId: string) => invoke('mcp-remove-server', serverId),
    mcpRestartServer: (serverId: string) => invoke('mcp-restart-server', serverId),
    onMcpServerStatus:(cb: Function) => on('mcp-server-status', cb),

    // ── File Change Undo ──
    fileUndoList:    ()                       => invoke('file-undo-list'),
    fileUndo:        (filePath: string)        => invoke('file-undo', filePath),
    fileUndoAll:     ()                       => invoke('file-undo-all'),
    fileAcceptChanges:(filePaths: string[])    => invoke('file-accept-changes', filePaths),
    applyChatCode:   (filePath: string, content: string) => invoke('apply-chat-code', filePath, content),

    // ── Checkpoints ──
    checkpointList:    ()             => invoke('checkpoint-list'),
    checkpointRestore: (turnId: string) => invoke('checkpoint-restore', turnId),
    onCheckpointReady: (cb: Function) => on('checkpoint-ready', cb),

    // ── Context Usage ──
    onContextUsage: (cb: Function) => on('context-usage', cb),

    // ── Agentic Progress ──
    onAgenticProgress: (cb: Function) => on('agentic-progress', cb),
    onAgenticPhase:    (cb: Function) => on('agentic-phase', cb),

    // ── Todo Updates ──
    onTodoUpdate: (cb: Function) => on('todo-update', cb),

    // ── Audio Transcription ──
    transcribeAudio: (audioBase64: string) => invoke('transcribe-audio', audioBase64),

    // ── Image Generation ──
    imageGenerate:       (prompt: string, options: any) => invoke('image-generate', prompt, options),
    imageSave:           (imageBase64: string, mimeType: string, suggestedName: string) => invoke('image-save', imageBase64, mimeType, suggestedName),
    imageSaveToProject:  (imageBase64: string, mimeType: string, fileName: string) => invoke('image-save-to-project', imageBase64, mimeType, fileName),
    imageGenStatus:      ()                             => invoke('image-gen-status'),

    // ── Local Image Generation ──
    localImageGenerate: (params: any) => invoke('local-image-generate', params),
    localImageCancel:   ()            => invoke('local-image-cancel'),
    localImageEngineStatus: ()        => invoke('local-image-engine-status'),
    onLocalImageProgress:   (cb: Function) => on('local-image-progress', cb),

    // ── Video Generation ──
    videoGenerate:      (prompt: string, options: any) => invoke('video-generate', prompt, options),
    videoSave:          (videoBase64: string, mimeType: string) => invoke('video-save', videoBase64, mimeType),
    videoSaveToProject: (videoBase64: string, mimeType: string, fileName: string) => invoke('video-save-to-project', videoBase64, mimeType, fileName),

    // ── Settings & Chat Persistence ──
    saveSettings:           (settings: any) => invoke('save-settings', settings),
    loadSettings:           ()              => invoke('load-settings'),
    getSystemPromptPreview: ()              => invoke('get-system-prompt-preview'),
    saveChatSessions:       (sessions: any) => invoke('save-chat-sessions', sessions),
    loadChatSessions:       ()              => invoke('load-chat-sessions'),
    deleteChatSession:      (sessionId: string) => invoke('delete-chat-session', sessionId),

    // ── System Resources ──
    getSystemResources: () => invoke('get-system-resources'),

    // ── Files Changed ──
    onFilesChanged:      (cb: Function) => on('files-changed', cb),
    onAgentFileModified: (cb: Function) => on('agent-file-modified', cb),

    // ── Browser Automation ──
    browserNavigate:       (url: string) => invoke('browser-navigate', url),
    browserShow:           (bounds: any) => invoke('browser-show', bounds),
    browserFocus:          ()            => invoke('browser-focus'),
    browserHide:           ()            => invoke('browser-hide'),
    browserSetBounds:      (bounds: any) => invoke('browser-set-bounds', bounds),
    browserGoBack:         ()            => invoke('browser-go-back'),
    browserGoForward:      ()            => invoke('browser-go-forward'),
    browserReload:         ()            => invoke('browser-reload'),
    browserGetState:       ()            => invoke('browser-get-state'),
    browserScreenshot:     ()            => invoke('browser-screenshot'),
    browserGetContent:     (selector: string, html: boolean) => invoke('browser-get-content', selector, html),
    browserEvaluate:       (code: string)     => invoke('browser-evaluate', code),
    browserClick:          (selector: string) => invoke('browser-click', selector),
    browserType:           (selector: string, text: string) => invoke('browser-type', selector, text),
    browserLaunchExternal: (url: string) => invoke('browser-launch-external', url),
    onShowBrowser:         (cb: Function) => on('show-browser', cb),
    onBrowserRestore:      (cb: Function) => on('browser-restore', cb),
    onBrowserStateChanged: (cb: Function) => on('browser-state-changed', cb),

    // ── Memory Store ──
    memoryGetStats:          ()                         => invoke('memory-get-stats'),
    memoryGetContext:        ()                         => invoke('memory-get-context'),
    memoryLearnFact:         (key: string, value: string) => invoke('memory-learn-fact', key, value),
    memoryFindErrors:        (errorMsg: string)         => invoke('memory-find-errors', errorMsg),
    memoryClear:             ()                         => invoke('memory-clear'),
    memoryClearConversations:()                         => invoke('memory-clear-conversations'),
    onMemoryStats:           (cb: Function)             => on('memory-stats', cb),

    // ── Debug Service ──
    debugStart:          (config: any)    => invoke('debug-start', config),
    debugStop:           (sessionId: string) => invoke('debug-stop', sessionId),
    debugSetBreakpoints: (sessionId: string, filePath: string, breakpoints: any[]) => invoke('debug-set-breakpoints', sessionId, filePath, breakpoints),
    debugContinue:       (sessionId: string) => invoke('debug-continue', sessionId),
    debugStepOver:       (sessionId: string) => invoke('debug-step-over', sessionId),
    debugStepInto:       (sessionId: string) => invoke('debug-step-into', sessionId),
    debugStepOut:        (sessionId: string) => invoke('debug-step-out', sessionId),
    debugPause:          (sessionId: string) => invoke('debug-pause', sessionId),
    debugStackTrace:     (sessionId: string) => invoke('debug-stack-trace', sessionId),
    debugScopes:         (sessionId: string, frameId: number) => invoke('debug-scopes', sessionId, frameId),
    debugVariables:      (sessionId: string, variablesReference: number) => invoke('debug-variables', sessionId, variablesReference),
    debugEvaluate:       (sessionId: string, expression: string, frameId: number) => invoke('debug-evaluate', sessionId, expression, frameId),
    debugGetSessions:    () => invoke('debug-get-sessions'),
    onDebugEvent:        (cb: Function) => on('debug-event', cb),

    // ── Benchmark ──
    benchmarkGetTests:    ()             => invoke('benchmark-get-tests'),
    benchmarkSaveResults: (results: any) => invoke('benchmark-save-results', results),
    benchmarkLoadResults: ()             => invoke('benchmark-load-results'),
    benchmarkCancel:      ()             => invoke('benchmark-cancel'),
    onBenchmarkProgress:  (cb: Function) => on('benchmark-progress', cb),
    onBenchmarkTestResult:(cb: Function) => on('benchmark-test-result', cb),

    // ── Background Agents ──
    agentSpawn:     (task: string, context: any) => invoke('agent-spawn', task, context),
    agentCancel:    (agentId: string) => invoke('agent-cancel', agentId),
    agentGetResult: (agentId: string) => invoke('agent-get-result', agentId),
    agentList:      ()                => invoke('agent-list'),
    onAgentStatus:  (cb: Function)    => on('agent-status', cb),

    // ── Menu / App Events (server → browser) ──
    onMenuAction:          (cb: Function) => on('menu-action', cb),
    onOpenFile:            (cb: Function) => on('open-file', cb),
    onOpenFolder:          (cb: Function) => on('open-folder', cb),
    onFolderOpened:        (cb: Function) => on('folder-opened', cb),
    onMenuOpenProject:     (cb: Function) => on('menu-open-project', cb),

    // electronService.ts wires these legacy names:
    onMenuNewProject:      (cb: Function) => on('menu-new-project', cb),
    onMenuSaveFile:        (cb: Function) => on('menu-save-file', cb),
    onMenuSave:            (cb: Function) => on('menu-save', cb),
    onMenuSaveAll:         (cb: Function) => on('menu-save-all', cb),
    onMenuToggleExplorer:  (cb: Function) => on('menu-toggle-explorer', cb),
    onMenuToggleChat:      (cb: Function) => on('menu-toggle-chat', cb),
    onMenuToggleTasks:     (cb: Function) => on('menu-toggle-tasks', cb),
    onMenuFontSizeIncrease:(cb: Function) => on('menu-font-size-increase', cb),
    onMenuFontSizeDecrease:(cb: Function) => on('menu-font-size-decrease', cb),
    onMenuFontSizeReset:   (cb: Function) => on('menu-font-size-reset', cb),
    onMenuRunTask:         (cb: Function) => on('menu-run-task', cb),
    onMenuDebug:           (cb: Function) => on('menu-debug', cb),
    onMenuSettings:        (cb: Function) => on('menu-settings', cb),

    // ── Auto-Update (no-op in web mode) ──
    onUpdateAvailable:  (cb: Function) => on('update-available', cb),
    onUpdateDownloaded: (cb: Function) => on('update-downloaded', cb),
    installUpdate:      ()             => Promise.resolve(),

    // ── Title Bar (no-op in web mode) ──
    setTitleBarOverlay: (_opts: any) => Promise.resolve(),

    // ── Cleanup ──
    removeAllListeners: (channel: string) => {
      if (channel) listeners.delete(channel);
      else         listeners.clear();
    },
    removeListener: (channel: string, callback: Function) => {
      listeners.get(channel)?.delete(callback);
    },
  };
}
