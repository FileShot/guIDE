/**
 * guIDE — Web Server (dev.graysoft.dev)
 *
 * Runs the EXACT same backend pipeline as electron-main.js, with the only
 * difference being transport: WebSocket + HTTP instead of Electron IPC.
 *
 * ALL main/ and main/ipc/ files are loaded UNCHANGED.
 * The electron-stub module is injected into require.cache so that every
 * `const { ipcMain } = require('electron')` in those files resolves to our
 * in-memory IPC registry. webContents.send() broadcasts to all WebSocket clients.
 *
 * Usage: node server.js
 * Port:  3200 (matches Cloudflare tunnel → http://localhost:3200)
 */
'use strict';

// ─── Step 1: Inject electron-stub BEFORE any handler module is loaded ──────
// All main/ipc/*.js files do `require('electron')` — this ensures they get
// our stub instead of throwing "Cannot find module 'electron'".
const Module = require('module');
const electronStub = require('./main/electron-stub');

const _origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return _origLoad(request, parent, isMain);
};
// Belt-and-suspenders: also place in cache with the resolved key
require.cache['electron'] = {
  id: 'electron', filename: 'electron', loaded: true, exports: electronStub,
};

// ─── Step 2: Standard node modules ──────────────────────────────────────────
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const fsP     = require('fs').promises;
const os      = require('os');
const { WebSocketServer } = require('ws');

// ─── Step 3: Persistent logging (same first-load requirement as electron-main.js) ─
const log = require('./main/logger');
log.installConsoleIntercepts();

// ─── Step 4: The ipcMain from the stub IS our registry ──────────────────────
const { ipcMain } = electronStub;

// ─── Step 5: WebSocket broadcast shim replaces mainWindow.webContents.send ──
// This is assigned after WSS is created.
let _wss = null; // set in startServer()

const WIN_SHIM = {
  isDestroyed: () => false,
  webContents: {
    send(channel, ...args) {
      if (!_wss) return;
      const payload = args.length === 1 ? args[0] : args;
      const msg = JSON.stringify({ type: 'event', channel, payload });
      for (const client of _wss.clients) {
        if (client.readyState === 1 /* OPEN */) {
          try { client.send(msg); } catch (_) {}
        }
      }
    },
    isDestroyed: () => false,
    on() {}, once() {}, openDevTools() {}, setWindowOpenHandler() {},
  },
  on() { return WIN_SHIM; },
  once() { return WIN_SHIM; },
  off() { return WIN_SHIM; },
  removeListener() { return WIN_SHIM; },
};

// Also intercept the stub's ipcMain broadcast path so modules that do
// `require('electron').app.getPath(...)` still resolve (already handled by stub).

// ─── Step 6: Service class imports (IDENTICAL to electron-main.js lines 53-76) ─
const { LLMEngine }               = require('./main/llmEngine');
const { ModelManager }            = require('./main/modelManager');
const { RAGEngine }               = require('./main/ragEngine');
const { TerminalManager }         = require('./main/terminalManager');
const { WebSearch }               = require('./main/webSearch');
const { MCPToolServer }           = require('./main/mcpToolServer');
const { BrowserManager }          = require('./main/browserManager');
const { PlaywrightBrowser }       = require('./main/playwrightBrowser');
const { MemoryStore }             = require('./main/memoryStore');
const { CloudLLMService }         = require('./main/cloudLLMService');
const { ImageGenerationService }  = require('./main/imageGenerationService');
const { LocalImageEngine }        = require('./main/localImageEngine');
const { GitManager }              = require('./main/gitManager');
const LicenseManager              = require('./main/licenseManager');
const { DebugService }            = require('./main/debugService');
const { ConversationSummarizer }  = require('./main/conversationSummarizer');

// ─── Step 7: Utility / extracted module imports (IDENTICAL to electron-main.js) ─
const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE }
  = require('./main/constants');
const { createPathValidator }
  = require('./main/pathValidator');
const { createSettingsManager, registerSettingsHandlers }
  = require('./main/settingsManager');
const { encryptApiKey, decryptApiKey, loadSavedApiKeys }
  = require('./main/apiKeyStore');
const { _truncateResult, _detectGPU, getCpuUsage }
  = require('./main/mainUtils');
const { register: registerAgenticChat }
  = require('./main/agenticChat');

// ─── Step 8: IPC handler imports — Core (IDENTICAL to electron-main.js lines 84-104) ─
const { register: registerFileSystem }  = require('./main/ipc/fileSystemHandlers');
const { register: registerDialogs }     = require('./main/ipc/dialogHandlers');
const { register: registerTerminal }    = require('./main/ipc/terminalHandlers');
const { register: registerLicense }     = require('./main/ipc/licenseHandlers');
const { register: registerGit }         = require('./main/ipc/gitHandlers');
const { register: registerMemory }      = require('./main/ipc/memoryHandlers');
const { register: registerBrowser }     = require('./main/ipc/browserHandlers');
const { register: registerLlm }         = require('./main/ipc/llmHandlers');
const { register: registerModels }      = require('./main/ipc/modelHandlers');
const { register: registerRag }         = require('./main/ipc/ragHandlers');
const { register: registerMcp }         = require('./main/ipc/mcpHandlers');
const { register: registerDebug }       = require('./main/ipc/debugHandlers');
const { register: registerAgents }      = require('./main/ipc/agentHandlers');
const { register: registerCloudLlm }    = require('./main/ipc/cloudLlmHandlers');
const { register: registerEditor }      = require('./main/ipc/editorHandlers');
const { register: registerUtility }     = require('./main/ipc/utilityHandlers');
const { register: registerImageGen }    = require('./main/ipc/imageGenHandlers');
const { register: registerBenchmark }   = require('./main/ipc/benchmarkHandlers');
const { register: registerTemplates }   = require('./main/ipc/templateHandlers');
const { register: registerTodoTree }    = require('./main/ipc/todoTreeHandlers');
const { register: registerLiveServer }  = require('./main/ipc/liveServerHandlers');
const { register: registerRestClient }  = require('./main/ipc/restClientHandlers');

// Deferred handler modules (same as electron-main.js — loaded after startup)
let _deferredRegistered = false;
function registerDeferredHandlers(ctx) {
  if (_deferredRegistered) return;
  _deferredRegistered = true;
  const t0 = Date.now();
  require('./main/ipc/databaseHandlers').register(ctx);
  require('./main/ipc/codeReviewHandlers').register(ctx);
  require('./main/ipc/profilerHandlers').register(ctx);
  require('./main/ipc/smartSearchHandlers').register(ctx);
  require('./main/ipc/docsHandlers').register(ctx);
  require('./main/ipc/sshHandlers').register(ctx);
  require('./main/ipc/pluginHandlers').register(ctx);
  require('./main/ipc/collabHandlers').register(ctx);
  require('./main/ipc/notebookHandlers').register(ctx);
  console.log(`[WEB] Deferred handlers registered in ${Date.now() - t0}ms`);
}

// ─── Step 9: Brand identity (IDENTICAL to electron-main.js) ─────────────────
const _B = {
  n: '\x67\x75\x49\x44\x45',
  a: '\x42\x72\x65\x6e\x64\x61\x6e\x20\x47\x72\x61\x79',
  g: '\x46\x69\x6c\x65\x53\x68\x6f\x74',
  y: '2025-2026',
};

// ─── Step 10: Globals (IDENTICAL to electron-main.js) ───────────────────────
const isDev          = process.env.NODE_ENV === 'development';
const appBasePath    = __dirname;
const userDataPath   = path.join(os.homedir(), 'AppData', 'Roaming', 'guide-ide');
// Scan D:\models\qwen3.5\ first, then fall back to app directory
const modelsBasePath = fs.existsSync('D:\\models\\qwen3.5') ? 'D:\\models\\qwen3.5' : __dirname;

// ─── Step 11: Service instances (IDENTICAL to electron-main.js lines 141-170) ─
const llmEngine        = new LLMEngine();
let agenticCancelled   = false;
const modelManager     = new ModelManager(modelsBasePath);
const ragEngine        = new RAGEngine();
const terminalManager  = new TerminalManager();
const webSearch        = new WebSearch();
const browserManager   = new BrowserManager();
const playwrightBrowser= new PlaywrightBrowser();
const memoryStore      = new MemoryStore(userDataPath);
const cloudLLM         = new CloudLLMService();
const imageGen         = new ImageGenerationService();
const localImageEngine = new LocalImageEngine();
const gitManager       = new GitManager();
const licenseManager   = new LicenseManager();
licenseManager.loadLicense();
cloudLLM.setLicenseManager(licenseManager);
const debugService     = new DebugService();

// ─── Step 12: MCPToolServer wiring (IDENTICAL to electron-main.js lines 172-203) ─
const mcpToolServer = new MCPToolServer({ webSearch, ragEngine, terminalManager });
mcpToolServer.setPlaywrightBrowser(playwrightBrowser);
mcpToolServer.setBrowserManager(browserManager);
mcpToolServer.setGitManager(gitManager);
mcpToolServer.setImageGen(imageGen);

mcpToolServer.onTodoUpdate = (todos) => {
  WIN_SHIM.webContents.send('todo-update', todos);
};

mcpToolServer._spawnSubagent = async (goal, context) => {
  const subPrompt = `You are a subagent. Complete this task:\n\nGOAL: ${goal}\n\nCONTEXT: ${context || 'None provided'}\n\nRespond with the result of your work.`;
  const result = await cloudLLM.chat([{ role: 'user', content: subPrompt }], { maxTokens: 2000 });
  return result?.text || result?.content || 'Subagent completed without response';
};

mcpToolServer.onPermissionRequest = null;

// ─── Step 13: Path validator + settings manager (IDENTICAL) ─────────────────
let currentProjectPath = null;
const isPathAllowed = createPathValidator(appBasePath, modelsBasePath, () => currentProjectPath);
const { _readConfig, _writeConfig } = createSettingsManager(userDataPath);

// ─── Step 14: Shared context (IDENTICAL to electron-main.js ctx object) ──────
const ctx = {
  // Window (returns WIN_SHIM — webContents.send → WebSocket broadcast)
  getMainWindow: () => WIN_SHIM,
  get currentProjectPath()  { return currentProjectPath; },
  set currentProjectPath(v) { currentProjectPath = v; },
  get agenticCancelled()    { return agenticCancelled; },
  set agenticCancelled(v)   { agenticCancelled = v; },

  // Paths & config
  appBasePath, userDataPath, modelsBasePath, isDev,
  isPathAllowed, _readConfig, _writeConfig,
  encryptApiKey, decryptApiKey, loadSavedApiKeys,

  // Services
  llmEngine, modelManager, ragEngine, terminalManager,
  webSearch, browserManager, playwrightBrowser,
  memoryStore, cloudLLM, imageGen, localImageEngine, gitManager, licenseManager,
  debugService, mcpToolServer, ConversationSummarizer,

  // Utilities
  _truncateResult, _detectGPU, getCpuUsage,
  DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE, _B,

  // Functions shared between modules
  createWindow: () => {},            // noop — no Electron window
  autoIndexProject,
  scheduleIncrementalReindex,
};

// ─── Step 15: Register all IPC handlers (IDENTICAL to electron-main.js) ──────
registerSettingsHandlers(ctx);
registerFileSystem(ctx);
registerDialogs(ctx);
registerTerminal(ctx);
registerLicense(ctx);
registerGit(ctx);
registerMemory(ctx);
registerBrowser(ctx);
registerLlm(ctx);
registerModels(ctx);
registerRag(ctx);
registerMcp(ctx);
registerDebug(ctx);
registerAgents(ctx);
registerCloudLlm(ctx);
registerEditor(ctx);
registerUtility(ctx);
registerImageGen(ctx);
registerBenchmark(ctx);
registerTemplates(ctx);
registerTodoTree(ctx);
registerLiveServer(ctx);
registerRestClient(ctx);
registerAgenticChat(ctx);

// Extra channels that live in electron-main.js directly (not in handler files)
ipcMain.handle('install-update', () => {
  console.log('[WEB] install-update: no-op in web mode');
});
ipcMain.handle('set-titlebar-overlay', () => {
  // no-op — no native titlebar in web mode
});

// Defer non-critical handlers to after startup
setImmediate(() => registerDeferredHandlers(ctx));

// ─── Step 16: Service event wiring ──────────────────────────────────────────
function wireServiceEvents() {
  llmEngine.on('status', (status) => {
    WIN_SHIM.webContents.send('llm-status', status);
  });

  // Forward console output as dev-log events (same filter as electron-main.js)
  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);
  const _devLogPrefixRe = /\[(LLM|GPU|AI|Model|IDE|Cloud|RAG|MCP|Debug|Reset|Agentic|License)\]/i;
  const _devLogKeywordRe = /model|context|token|generat|load|dispos|abort|session|layer|backend|flash/i;
  const devLog = (level, ...args) => {
    const firstStr = typeof args[0] === 'string' ? args[0] : '';
    if (!_devLogPrefixRe.test(firstStr) && !_devLogKeywordRe.test(firstStr)) return;
    const text = args.map(a =>
      typeof a === 'string' ? a : (typeof a === 'number' ? String(a) : JSON.stringify(a, null, 0))
    ).join(' ');
    WIN_SHIM.webContents.send('dev-log', { level, text, timestamp: Date.now() });
  };
  console.log   = (...a) => { _origLog(...a);   devLog('info',  ...a); };
  console.warn  = (...a) => { _origWarn(...a);  devLog('warn',  ...a); };
  console.error = (...a) => { _origError(...a); devLog('error', ...a); };

  modelManager.on('models-updated', (models) => {
    WIN_SHIM.webContents.send('models-available', models);
  });

  terminalManager.on('data', ({ id, data }) => {
    WIN_SHIM.webContents.send('terminal-data', { id, data });
  });
  terminalManager.on('exit', ({ id, exitCode }) => {
    WIN_SHIM.webContents.send('terminal-exit', { id, exitCode });
  });

  debugService.setEventCallback((event) => {
    WIN_SHIM.webContents.send('debug-event', event);
  });
}

// ─── Step 17: Service initialization (mirrors electron-main.js initializeServices) ─
async function initializeServices() {
  console.log('[WEB] Initializing services...');

  await Promise.all([
    memoryStore.initialize(),
    Promise.resolve(loadSavedApiKeys(userDataPath, cloudLLM)),
  ]);

  // Pollinations API keys (IDENTICAL to electron-main.js)
  try {
    const config = _readConfig();
    if (config.apiKeys?.pollinations) {
      const key = decryptApiKey(config.apiKeys.pollinations);
      if (key) imageGen.addPollinationsKey(key);
    }
    if (config.userSettings?.pollinationsApiKey) {
      const k = config.userSettings.pollinationsApiKey.trim();
      if (k) imageGen.addPollinationsKey(k);
    }
  } catch (_) {}

  const _S = 'guIDE-built-in-2026';
  const _d = (e) => {
    const b = Buffer.from(e, 'base64');
    let r = '';
    for (let i = 0; i < b.length; i++) r += String.fromCharCode(b[i] ^ _S.charCodeAt(i % _S.length));
    return r;
  };
  const _pk = [
    _d('FB4WJiNlMUQwAjhADC1MX1oDVCggDSUXfCBBPAM1Zzk0X0Y='),
    _d('FB4WFgtFLCwuX0VgIBRueEVeD1UHKhM9RTQMPBQyZg42Q1U='),
    _d('FB4WMBxmEDI/BE1DOCtnc394B1U2OR42ZVEcOwEkSAIde3E='),
  ];
  for (const k of _pk) imageGen.addPollinationsKey(k);

  // Load GPU preference
  try {
    const config = _readConfig();
    if (config.userSettings?.gpuPreference) {
      llmEngine.setGPUPreference(config.userSettings.gpuPreference);
    }
    if (typeof config.userSettings?.requireMinContextForGpu === 'boolean') {
      llmEngine.setRequireMinContextForGpu(config.userSettings.requireMinContextForGpu);
    }
  } catch (_) {}

  try {
    await modelManager.initialize();
    // ModelManager's default scan is non-recursive. If modelsBasePath has models
    // inside subdirectories (e.g. D:\models\qwen3.5\Qwen3.5-4B-GGUF\model.gguf),
    // do a recursive scan of the base path to pick them all up.
    if (fs.existsSync(modelsBasePath) && modelsBasePath !== __dirname) {
      await modelManager._scanDir(modelsBasePath, true);
      modelManager.availableModels.sort((a, b) => a.name.localeCompare(b.name));
    }
    const models = modelManager.availableModels;
    console.log(`[WEB] Found ${models.length} model(s)`);

    // Send initial state to any already-connected WS clients (queued until first client connects)
    setTimeout(() => {
      WIN_SHIM.webContents.send('models-available', models);
      WIN_SHIM.webContents.send('memory-stats', memoryStore.getStats());
      WIN_SHIM.webContents.send('mcp-tools-available', mcpToolServer.getToolDefinitions());
    }, 500);

    // Auto-load last used model
    const settingsPath = path.join(userDataPath, 'settings.json');
    let lastUsedModel = null;
    try {
      const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (config.lastUsedModel && fs.existsSync(config.lastUsedModel)) {
        lastUsedModel = config.lastUsedModel;
      }
    } catch (_) {}

    if (lastUsedModel) {
      const modelName = path.basename(lastUsedModel).replace(/\.gguf$/i, '');
      console.log(`[WEB] Auto-loading last used model: ${modelName}`);
      WIN_SHIM.webContents.send('llm-status', { state: 'loading', message: `Loading ${modelName}...` });
      llmEngine.initialize(lastUsedModel).then((modelInfo) => {
        console.log(`[WEB] Auto-loaded model: ${modelName}`);
        WIN_SHIM.webContents.send('llm-status', { state: 'ready', message: `Model loaded: ${modelName}` });
        if (modelInfo?.contextSize) {
          WIN_SHIM.webContents.send('context-usage', { used: 0, total: modelInfo.contextSize });
        }
        WIN_SHIM.webContents.send('model-auto-loaded', { path: lastUsedModel, name: modelName });
      }).catch((err) => {
        console.warn(`[WEB] Auto-load failed: ${err.message}`);
        WIN_SHIM.webContents.send('llm-status', { state: 'idle', message: 'Auto-load failed. Click a model to load.' });
      });
    } else {
      WIN_SHIM.webContents.send('llm-status', {
        state: 'idle',
        message: 'Cloud AI active. Download a .gguf model to enable local GPU inference.',
      });
    }
  } catch (e) {
    console.error('[WEB] Failed to initialize model manager:', e);
  }
}

// ─── Step 18: RAG auto-index (IDENTICAL to electron-main.js) ────────────────
let _reindexTimer = null;

async function autoIndexProject(projectPath) {
  if (!projectPath) return;
  console.log(`[WEB] Auto-indexing project: ${projectPath}`);
  try {
    const result = await ragEngine.indexProject(projectPath, (progress, done, total) => {
      WIN_SHIM.webContents.send('rag-progress', { progress, done, total });
    });
    console.log(`[WEB] Indexing complete: ${result.totalFiles} files, ${result.totalChunks} chunks`);
    memoryStore.learnFact('project_path', projectPath);
    memoryStore.learnFact('project_files', `${result.totalFiles} files indexed`);
    WIN_SHIM.webContents.send('rag-status', ragEngine.getStatus());
  } catch (e) {
    console.error('[WEB] Auto-indexing failed:', e.message);
  }
}

function scheduleIncrementalReindex() {
  if (_reindexTimer) clearTimeout(_reindexTimer);
  _reindexTimer = setTimeout(async () => {
    _reindexTimer = null;
    if (!ragEngine.projectPath || ragEngine.isIndexing) return;
    try {
      const result = await ragEngine.reindexChanged();
      if (result.updated || result.added || result.removed) {
        console.log(`[WEB] Incremental re-index: ${result.updated} updated, ${result.added} added, ${result.removed} removed`);
        WIN_SHIM.webContents.send('rag-status', ragEngine.getStatus());
      }
    } catch (e) {
      console.error('[WEB] Incremental re-index failed:', e.message);
    }
  }, 3000);
}

// ─── Step 19: Static file server ────────────────────────────────────────────
const DIST_DIR = path.join(__dirname, 'dist');
const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json',
  '.wasm': 'application/wasm',
};

function serveStatic(req, res) {
  // Only GET/HEAD for static files
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end();
    return;
  }

  let urlPath = req.url.split('?')[0]; // strip query string
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.join(DIST_DIR, urlPath);

  // Security: prevent path traversal
  if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) {
    res.writeHead(400); res.end();
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback — serve index.html for all unmatched routes
      const indexPath = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexPath, (err2, data) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type':  mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Length': stat.size,
    });

    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

// ─── Step 20: HTTP + WebSocket server ───────────────────────────────────────
async function startServer() {
  const PORT = parseInt(process.env.PORT || '3200', 10);

  const httpServer = http.createServer((req, res) => {
    // CORS headers for tunnel access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    serveStatic(req, res);
  });

  // ── WebSocket server — upgrades from the same http server ──
  _wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  _wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).slice(2, 8);
    console.log(`[WEB-WS] Client connected: ${clientId}`);

    // On first connection, send initial state
    setTimeout(() => {
      try {
        const models = modelManager.availableModels;
        if (models?.length) ws.send(JSON.stringify({ type: 'event', channel: 'models-available', payload: models }));
        ws.send(JSON.stringify({ type: 'event', channel: 'memory-stats', payload: memoryStore.getStats() }));
        ws.send(JSON.stringify({ type: 'event', channel: 'mcp-tools-available', payload: mcpToolServer.getToolDefinitions() }));
        const llmStatus = llmEngine.getStatus?.();
        if (llmStatus) ws.send(JSON.stringify({ type: 'event', channel: 'llm-status', payload: llmStatus }));
      } catch (_) {}
    }, 200);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); }
      catch (_) { return; }

      if (msg.type === 'invoke') {
        // Route to registered ipcMain handler
        try {
          const result = await ipcMain._invoke(msg.channel, ...(msg.args || []));
          ws.send(JSON.stringify({ type: 'invoke-reply', id: msg.id, result }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'invoke-reply', id: msg.id, result: null,
            error: err?.message || String(err),
          }));
        }
      }
    });

    ws.on('close', () => {
      console.log(`[WEB-WS] Client disconnected: ${clientId}`);
      // Cancel any active generation when ALL clients disconnect — prevents an orphaned
      // backend loop from streaming ghost tokens into a reconnected session.
      // agenticCancelled will be reset to false at the start of the next ai-chat request.
      if (_wss.clients.size === 0) {
        ctx.agenticCancelled = true;
        try { ctx.llmEngine.cancelGeneration(); } catch (_) {}
      }
    });

    ws.on('error', (err) => {
      console.error(`[WEB-WS] Client error (${clientId}):`, err.message);
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(PORT, '0.0.0.0', () => {
      resolve();
      console.log('');
      console.log('  ╔═══════════════════════════════════════════════════╗');
      console.log('  ║  guIDE Web Server                                 ║');
      console.log(`  ║  http://localhost:${PORT}                           ║`);
      console.log('  ║  Tunnel: https://dev.graysoft.dev                 ║');
      console.log('  ║  Copyright © 2025-2026 Brendan Gray (FileShot)    ║');
      console.log('  ╚═══════════════════════════════════════════════════╝');
      console.log('');
    });
  });

  return httpServer;
}

// ─── Step 21: Bootstrap ─────────────────────────────────────────────────────
(async () => {
  try {
    wireServiceEvents();
    await startServer();
    await initializeServices();
    console.log('[WEB] All services ready.');
  } catch (err) {
    console.error('[WEB] Fatal startup error:', err);
    process.exit(1);
  }
})();

// ─── Step 22: Graceful shutdown ──────────────────────────────────────────────
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function gracefulShutdown(signal) {
  console.log(`\n[WEB] Received ${signal} — shutting down...`);
  try { playwrightBrowser.dispose(); }   catch (_) {}
  try { terminalManager.disposeAll(); } catch (_) {}
  try { browserManager.dispose(); }     catch (_) {}
  try { modelManager.dispose(); }       catch (_) {}
  try { await memoryStore.dispose(); }  catch (_) {}
  try { await llmEngine.dispose(); }    catch (_) {}
  console.log('[WEB] Shutdown complete.');
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  console.error('[WEB] Uncaught exception:', err);
  // Log to crash dir same as electron-main.js
  try {
    const crashDir = path.join(userDataPath, 'crash-logs');
    fs.mkdirSync(crashDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(crashDir, `server-crash-${ts}.txt`),
      `Uncaught Exception at ${new Date().toISOString()}\n\n${err?.stack || err}\n`);
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[WEB] Unhandled rejection:', reason);
});
