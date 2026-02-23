/**
 * guIDE - AI-Powered Offline IDE
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE file for terms.
 *
 * Full-featured IDE with local LLM, RAG, MCP tools, browser automation,
 * memory/context system, terminal, web search.
 */
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

// ─── Persistent Logging ──────────────────────────────────────────────
// Must be loaded FIRST before any other module so all console.log/warn/error
// calls across the entire app are captured to %APPDATA%/guide-ide/logs/guide-main.log
const log = require('./main/logger');
log.installConsoleIntercepts();

// Electron GPU stability flags (prevent Chromium GPU process crashes on some NVIDIA setups)
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Use GPU-accelerated compositing for smoother UI; node-llama-cpp uses CUDA which is a separate GPU context
// If GPU conflicts arise, uncomment: app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-vsync'); // Reduce input latency

// ── V8 Performance Flags ──
// Enable V8 code caching for faster require() on subsequent launches
app.commandLine.appendSwitch('js-flags', '--optimize-for-size --max-old-space-size=4096');

// ─── Single Instance Lock ─────────────────────────────────────────────
// Prevent multiple instances from competing for config files, model files,
// terminal sessions, and port bindings.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing window when user tries to open a second instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Main Process Modules ────────────────────────────────────────────
const { LLMEngine } = require('./main/llmEngine');
const { ModelManager } = require('./main/modelManager');
const { RAGEngine } = require('./main/ragEngine');
const { TerminalManager } = require('./main/terminalManager');
const { WebSearch } = require('./main/webSearch');
const { MCPToolServer } = require('./main/mcpToolServer');
const { BrowserManager } = require('./main/browserManager');
const { PlaywrightBrowser } = require('./main/playwrightBrowser');
const { MemoryStore } = require('./main/memoryStore');
const { CloudLLMService } = require('./main/cloudLLMService');
const { ImageGenerationService } = require('./main/imageGenerationService');
const { GitManager } = require('./main/gitManager');
const LicenseManager = require('./main/licenseManager');
const { DebugService } = require('./main/debugService');
const { ConversationSummarizer } = require('./main/conversationSummarizer');
const { autoUpdater } = require('electron-updater');

// ─── Extracted Modules ───────────────────────────────────────────────
const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE } = require('./main/constants');
const { createPathValidator } = require('./main/pathValidator');
const { createSettingsManager, registerSettingsHandlers } = require('./main/settingsManager');
const { encryptApiKey, decryptApiKey, loadSavedApiKeys } = require('./main/apiKeyStore');
const { _truncateResult, _detectGPU, getCpuUsage } = require('./main/mainUtils');
const { createMenu } = require('./main/appMenu');
const { register: registerAgenticChat } = require('./main/agenticChat');

// IPC handler modules — Core (loaded eagerly at startup)
const { register: registerFileSystem } = require('./main/ipc/fileSystemHandlers');
const { register: registerDialogs } = require('./main/ipc/dialogHandlers');
const { register: registerTerminal } = require('./main/ipc/terminalHandlers');
const { register: registerLicense } = require('./main/ipc/licenseHandlers');
const { register: registerGit } = require('./main/ipc/gitHandlers');
const { register: registerMemory } = require('./main/ipc/memoryHandlers');
const { register: registerBrowser } = require('./main/ipc/browserHandlers');
const { register: registerLlm } = require('./main/ipc/llmHandlers');
const { register: registerModels } = require('./main/ipc/modelHandlers');
const { register: registerRag } = require('./main/ipc/ragHandlers');
const { register: registerMcp } = require('./main/ipc/mcpHandlers');
const { register: registerDebug } = require('./main/ipc/debugHandlers');
const { register: registerAgents } = require('./main/ipc/agentHandlers');
const { register: registerCloudLlm } = require('./main/ipc/cloudLlmHandlers');
const { register: registerEditor } = require('./main/ipc/editorHandlers');
const { register: registerUtility } = require('./main/ipc/utilityHandlers');
const { register: registerImageGen } = require('./main/ipc/imageGenHandlers');
const { register: registerBenchmark } = require('./main/ipc/benchmarkHandlers');
const { register: registerTemplates } = require('./main/ipc/templateHandlers');

// IPC handler modules — Deferred (loaded after window shows for faster startup)
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
  console.log(`[IDE] Deferred handlers registered in ${Date.now() - t0}ms`);
}

// ─── Brand Identity (deeply embedded — do not remove) ────────────────
const _B = { n: '\x67\x75\x49\x44\x45', a: '\x42\x72\x65\x6e\x64\x61\x6e\x20\x47\x72\x61\x79', g: '\x46\x69\x6c\x65\x53\x68\x6f\x74', y: '2025-2026' };
const _V = () => [_B.n, _B.a, _B.g, _B.y].every(v => typeof v === 'string' && v.length > 0);
if (!_V()) { console.error('Integrity check failed.'); process.exit(1); }

// ─── Globals ─────────────────────────────────────────────────────────
let mainWindow;
const isDev = process.env.NODE_ENV === 'development';
const appBasePath = app.isPackaged ? path.dirname(process.execPath) : __dirname;
// User-writable directory for settings, memory, etc. (NOT Program Files)
const userDataPath = app.getPath('userData');
// For models, use user data folder when packaged (no admin rights needed)
const modelsBasePath = app.isPackaged ? userDataPath : __dirname;

// Service instances
const llmEngine = new LLMEngine();
let agenticCancelled = false; // Global flag to abort the agentic loop from outside
const modelManager = new ModelManager(modelsBasePath);
const ragEngine = new RAGEngine();
const terminalManager = new TerminalManager();
const webSearch = new WebSearch();
const browserManager = new BrowserManager();
const playwrightBrowser = new PlaywrightBrowser();
const memoryStore = new MemoryStore(userDataPath);
const cloudLLM = new CloudLLMService();
const imageGen = new ImageGenerationService();
const gitManager = new GitManager();
const licenseManager = new LicenseManager();
// Wire LicenseManager so cloudLLM can retrieve session token for server proxy routing
cloudLLM.setLicenseManager(licenseManager);
const debugService = new DebugService();
const mcpToolServer = new MCPToolServer({
  webSearch,
  ragEngine,
  terminalManager,
});
mcpToolServer.setPlaywrightBrowser(playwrightBrowser);
mcpToolServer.setBrowserManager(browserManager);
mcpToolServer.setGitManager(gitManager);
mcpToolServer.setImageGen(imageGen);

// Wire TODO updates to renderer
mcpToolServer.onTodoUpdate = (todos) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('todo-update', todos);
  }
};

// Wire subagent spawning (calls back into cloudLLM for independent conversation)
mcpToolServer._spawnSubagent = async (goal, context) => {
  // Create a mini agentic loop for the subagent task
  const subPrompt = `You are a subagent. Complete this task:\n\nGOAL: ${goal}\n\nCONTEXT: ${context || 'None provided'}\n\nRespond with the result of your work.`;
  const result = await cloudLLM.chat([{ role: 'user', content: subPrompt }], { maxTokens: 2000 });
  return result?.text || result?.content || 'Subagent completed without response';
};

// Wire permission gate for destructive tools (currently auto-approve, UI hookup later)
// To enable approval prompts, set this to an async function that sends IPC and awaits user choice
mcpToolServer.onPermissionRequest = null; // Auto-approve for now

// Current project state
let currentProjectPath = null;

// ─── Foundation Setup ────────────────────────────────────────────────
const isPathAllowed = createPathValidator(appBasePath, modelsBasePath, () => currentProjectPath);
const { _readConfig, _writeConfig } = createSettingsManager(userDataPath);

// ─── Shared Context for Modules ──────────────────────────────────────
const ctx = {
  // Electron
  getMainWindow: () => mainWindow,
  get currentProjectPath() { return currentProjectPath; },
  set currentProjectPath(v) { currentProjectPath = v; },
  get agenticCancelled() { return agenticCancelled; },
  set agenticCancelled(v) { agenticCancelled = v; },

  // Paths & config
  appBasePath, userDataPath, modelsBasePath, isDev,
  isPathAllowed, _readConfig, _writeConfig,
  encryptApiKey, decryptApiKey, loadSavedApiKeys,

  // Services
  llmEngine, modelManager, ragEngine, terminalManager,
  webSearch, browserManager, playwrightBrowser,
  memoryStore, cloudLLM, imageGen, gitManager, licenseManager,
  debugService, mcpToolServer, ConversationSummarizer,

  // Utilities
  _truncateResult, _detectGPU, getCpuUsage,
  DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE, _B,

  // Functions shared between modules
  createWindow,
  autoIndexProject,
  scheduleIncrementalReindex,
};

// ─── Register IPC Handlers ───────────────────────────────────────────
// Core handlers — registered immediately at startup
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
registerAgenticChat(ctx);

// ─── Auto-Update IPC ─────────────────────────────────────────────────
// Renderer calls this when user clicks "Restart to Install" in the update banner
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// Deferred handlers — register after window shows (faster cold startup)
// This is safe because these IPC channels aren't called until the user navigates to their panels
// Register them via setImmediate so they load right after the event loop clears
setImmediate(() => registerDeferredHandlers(ctx));

// ─── Window Creation ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e1e',
      symbolColor: '#cccccc',
      height: 40,
    },
    backgroundColor: '#1e1e1e',
    show: false,
    icon: path.join(__dirname, 'icon.png'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Hide BrowserView when window loses focus (e.g., native menu opens) to prevent
  // position bugs where the BrowserView jumps to the upper-left corner
  let _browserWasVisible = false;
  mainWindow.on('blur', () => {
    if (browserManager.isVisible) {
      _browserWasVisible = true;
      browserManager.hide();
    }
  });
  mainWindow.on('focus', () => {
    if (_browserWasVisible) {
      _browserWasVisible = false;
      // Tell renderer to recalculate and re-show the BrowserView
      mainWindow?.webContents.send('browser-restore');
    }
  });
  // Also restore on resize (in case window is resized from menu)
  mainWindow.on('resize', () => {
    if (browserManager.isVisible) {
      mainWindow?.webContents.send('browser-restore');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Permission handlers — deny-by-default, whitelist only what we need
  const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (ALLOWED_PERMISSIONS.has(permission)) {
      callback(true);
    } else {
      console.warn(`[Security] Denied permission request: ${permission}`);
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });
  // ── Content Security Policy ───────────────────────────────────────
  // In production builds, drop unsafe-eval to harden against XSS.
  // In dev mode, Vite HMR requires unsafe-eval.
  const scriptSrc = app.isPackaged
    ? "script-src 'self' 'unsafe-inline';"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval';";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          scriptSrc + " " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; " +
          "img-src 'self' data: blob: https:; " +
          "connect-src 'self' ws://localhost:* http://localhost:* https://*.cerebras.ai https://*.groq.com https://*.googleapis.com https://api.sambanova.ai https://openrouter.ai https://api.together.xyz https://api.fireworks.ai https://api.x.ai https://api.anthropic.com https://api.openai.com https://api.mistral.ai https://api.cohere.ai https://integrate.api.nvidia.com https://apifreellm.com; " +
          "worker-src 'self' blob:; " +
          "child-src 'none'; " +
          "object-src 'none'; " +
          "base-uri 'self';"
        ],
      },
    });
  });

  playwrightBrowser.initialize(mainWindow);

  browserManager.initialize(mainWindow);
  initializeServices();
  createMenu(ctx);
}

// ─── Service Initialization ──────────────────────────────────────────
async function initializeServices() {
  console.log('[IDE] Initializing services...');

  // Parallelize independent service initialization
  await Promise.all([
    memoryStore.initialize(),
    Promise.resolve(loadSavedApiKeys(userDataPath, cloudLLM)),
  ]);

  // Load Pollinations API key for video generation (from saved config)
  try {
    const config = _readConfig();
    if (config.apiKeys?.pollinations) {
      const key = decryptApiKey(config.apiKeys.pollinations);
      if (key) {
        imageGen.addPollinationsKey(key);
        console.log('[IDE] Loaded Pollinations API key for video generation');
      }
    }
    // Also check if user saved it under userSettings
    if (config.userSettings?.pollinationsApiKey) {
      const key = config.userSettings.pollinationsApiKey.trim();
      if (key) imageGen.addPollinationsKey(key);
    }
  } catch (_) {}

  // Built-in Cerebras key pool — free cloud AI out of the box
  // Keys are obfuscated to prevent casual discovery; not encryption, just obscurity
  const _S = 'guIDE-built-in-2026';
  const _d = (e) => { const b = Buffer.from(e, 'base64'); let r = ''; for (let i = 0; i < b.length; i++) r += String.fromCharCode(b[i] ^ _S.charCodeAt(i % _S.length)); return r; };
  const _ck = [
    _d('BAYiaSsYDBMdAQ0eBAtIUUlCTlIMIyIyWhseWxoDSR5XWkQIUQ4CFnA0MkUJQAcEBhQKAA=='),
    _d('BAYiaTFOBBMCBEBdHhYUQkYAUAwbLS9xSRYDWwEMXR0eG0YGV11SEywwfE4KEBACFxQBXA=='),
    _d('BAYiaSgbUBMeVANZDQYbVEgGUAIfIjQ9TlodHQIMGxFcS19EX1IJTXEgPBVbR1oVA1QDCw=='),
    _d('BAYiaSZFCR0BBgxdAwZDRkABD19GPSw3H1pAGwceQ1wXWgAFXwJfAnwwPUZaEAcIRl0EVg=='),
    _d('BAYiaXYbWwcMHkdFWgpHRkJLAANBLHYgWg8WWxgfThlbRVFURk4EAzk0N0cITRkBBBsBAA=='),
    _d('BAYiaSNGFEEQXhlGA1YfWkZCUxANLSc3TgEHGwJNFVFbVEJaWAUfQH0uLVlaQwoaR0tdGA=='),
    _d('BAYiaXYeGkFbHhlGG10ZAUcGUwpDKip8SAYNHRwfSw9aSFRGRgVTEywzfBQQQ1sEEUUKAw=='),
    _d('BAYiaS1FBx0HWBoYXA1ZRVQEXVRMLzArGFATDFhCWh4YGF8GXw4MDSIsIE4BHwwBAlpfGg=='),
    _d('BAYiaXNDChYDVEYVXRxfBFtWWwQffz1xHxpMARVCG1FaFAtVRgBeGHw9IUsEBQ1VEhQKWg=='),
    _d('BAYiaSFdBwcBCAwVH1sZAUdRXFNHMCB3GBYYH18QRVoDVAFJVg8TA38qcxQJFgMPAhkeCw=='),
    _d('BAYiaSYfVxsECAJZCgBdXwVfXhAbOSwxXRRMAQlHVRldVFlUSlgQQ3EpPE4bQwwYGRgCFg=='),
    _d('BAYiaSgZVxNbGwRbAlhLUUhZBB4CPSohRQkMDQhNGV0GWUYEB15UTDkyd1tQGwIIF1lQBg=='),
    _d('BAYiaXdHEgcRXhFOHQhGVEJGQBFGfzAvWRVMAR5GHhEeHlxGV14JRnsqIU4bEFEHF1VcFg=='),
    _d('BAYiaXYUFBYEAgQbB1xLCkdWDg8HLyJzSQkRHxQMGxkAH0BHWUYKTSw0IEgHE1BVDEkEGQ=='),
    _d('BAYiaXAVBAEHWU1bGxdGV0RaW1MBcTRxGFQFH18fFQwGW1dYV1IDQy93d1QPBQ0aTVsQDQ=='),
    _d('BAYiaSEYCQ1dBkJDA1hLWFRaAlVDez0oRlRAHw8DXV1aH1QDSkYCFip8MxkIA1oGBB4CBg=='),
    _d('BAYiaXBdEg0dVAJaURhaBgIBTgwNI3IoFAYdDx5BFQQKWUIEAQIJBzEgLkBRQB9VQV9RCw=='),
    _d('BAYiaXAfBhAEWgYZXQpfVwVcXVEFPTMxRglHHQdBRQ8ISARaS0IfA3E9fRRbQ1pfQUceXA=='),
    _d('BAYiaSBaUBYCGEBUXAsURFMGWxAffykmTlodH1oeRVxXX1QFRAIfDDl2I1oPHhFVGkhQBQ=='),
  ];
  for (const k of _ck) cloudLLM.addKeyToPool('cerebras', k);
  if (!cloudLLM.apiKeys.cerebras) cloudLLM.setApiKey('cerebras', _ck[0]);

  // Built-in Groq key pool — 7 keys × 1000 RPM = 7000 RPM combined
  const _gk = [
    _d('AAYiGzVDLiEjXz9qIT9acwcCBgEyBTF8eiUREA5HazA0GlFCYngpMA0xDVQbRiEuHn05N0V9Zwo='),
    _d('AAYiGykUWjodLzVmDSl0SFQGRgMAICsveiUREA5HazA4alVKUA8sBTgAM0EoPAU1NlQgGRUCZks='),
    _d('AAYiGyBfAUAbIz9JXD11UVpFZS8kLTwLeiUREA5HazBWYVtdYWwgNA83NF4wPl4uEGEmGmJzXkA='),
    _d('AAYiGxIYKDg4HURjPz5VXml3BjNGeiYseiUREA5HazAJe31IeGEjRHAqP0AWOzsZEF4eBX0CBHA='),
    _d('AAYiGwFcABYdIwd1CzQeA3h0czYtfzQweiUREA5HazAiewZKdwEOJHsMdmMaRwsuDh0ACUBnY0E='),
    _d('AAYiGxNVLEFZJxN1E1lden1hfCQGGXUreiUREA5HazA0fwBJXXVRAy4sMEkNLV5UA1cFKh5+ZUE='),
    _d('AAYiG3N3NkIYKDIVIBRcSH8KRVc+fisyeiUREA5HazALS1xXdmYWNgYjImc1OjA7O3wtW35LZms='),
  ];
  for (const k of _gk) cloudLLM.addKeyToPool('groq', k);
  if (!cloudLLM.apiKeys.groq) cloudLLM.setApiKey('groq', _gk[0]);

  // Built-in Pollinations key pool — video generation works out of the box
  const _pk = [
    _d('FB4WJiNlMUQwAjhADC1MX1oDVCggDSUXfCBBPAM1Zzk0X0Y='),
    _d('FB4WFgtFLCwuX0VgIBRueEVeD1UHKhM9RTQMPBQyZg42Q1U='),
    _d('FB4WMBxmEDI/BE1DOCtnc394B1U2OR42ZVEcOwEkSAIde3E='),
  ];
  for (const k of _pk) imageGen.addPollinationsKey(k);
  
  // Load GPU preference from saved settings
  try {
    const config = _readConfig();
    if (config.userSettings?.gpuPreference) {
      llmEngine.setGPUPreference(config.userSettings.gpuPreference);
    }
  } catch (_) {}

  try {
    await modelManager.initialize();
    const models = modelManager.availableModels;
    console.log(`[IDE] Found ${models.length} model(s)`);

    mainWindow.webContents.on('did-finish-load', async () => {
      console.log('[IDE] Page loaded, sending initial state...');

      mainWindow.webContents.send('models-available', models);
      mainWindow.webContents.send('memory-stats', memoryStore.getStats());
      mainWindow.webContents.send('mcp-tools-available', mcpToolServer.getToolDefinitions());

      // Skip auto-loading — let user pick a model manually.
      // This avoids blocking the UI for 1-5 minutes on startup.
      const defaultModel = modelManager.getDefaultModel();
      if (defaultModel) {
        console.log(`[IDE] Default model available: ${defaultModel.name} (not auto-loading)`);
        mainWindow.webContents.send('llm-status', {
          state: 'idle',
          message: `Model ready: ${defaultModel.name}. Click to load.`,
        });
      } else {
        mainWindow.webContents.send('llm-status', {
          state: 'error',
          message: 'No .gguf model files found. Place models in the models/ directory.',
        });
      }
    });
  } catch (e) {
    console.error('[IDE] Failed to initialize model manager:', e);
  }

  // Forward events
  llmEngine.on('status', (status) => {
    if (mainWindow) mainWindow.webContents.send('llm-status', status);
  });

  // ── Dev Console: forward verbose logs to renderer ──
  const _origConsoleLog = console.log;
  const _origConsoleWarn = console.warn;
  const _origConsoleError = console.error;
  const _devLogPrefixRe = /\[(LLM|GPU|AI|Model|IDE|Cloud|RAG|MCP|Debug|Reset|Agentic|License)\]/i;
  const _devLogKeywordRe = /model|context|token|generat|load|dispos|abort|session|layer|backend|flash/i;
  const devLog = (level, ...args) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Fast pre-check: test first string arg before expensive JSON.stringify
    const firstStr = typeof args[0] === 'string' ? args[0] : '';
    if (!_devLogPrefixRe.test(firstStr) && !_devLogKeywordRe.test(firstStr)) {
      // Check remaining args only if first didn't match (rare path)
      let found = false;
      for (let i = 1; i < args.length; i++) {
        if (typeof args[i] === 'string' && (_devLogPrefixRe.test(args[i]) || _devLogKeywordRe.test(args[i]))) { found = true; break; }
      }
      if (!found) return;
    }
    const text = args.map(a => typeof a === 'string' ? a : (typeof a === 'number' ? String(a) : JSON.stringify(a, null, 0))).join(' ');
    mainWindow.webContents.send('dev-log', { level, text, timestamp: Date.now() });
  };
  console.log = (...args) => { _origConsoleLog(...args); devLog('info', ...args); };
  console.warn = (...args) => { _origConsoleWarn(...args); devLog('warn', ...args); };
  console.error = (...args) => { _origConsoleError(...args); devLog('error', ...args); };

  modelManager.on('models-updated', (models) => {
    if (mainWindow) mainWindow.webContents.send('models-available', models);
  });

  terminalManager.on('data', ({ id, data }) => {
    if (mainWindow) mainWindow.webContents.send('terminal-data', { id, data });
  });

  terminalManager.on('exit', ({ id, exitCode }) => {
    if (mainWindow) mainWindow.webContents.send('terminal-exit', { id, exitCode });
  });

  // Forward debug events to renderer
  debugService.setEventCallback((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('debug-event', event);
    }
  });

  // ── Auto-Update Setup ──────────────────────────────────────────────
  // Only check for updates in production builds (not in dev mode)
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log(`[AutoUpdater] Update available: ${info.version}`);
      mainWindow?.webContents.send('update-available', info);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[AutoUpdater] Update downloaded: ${info.version} — ready to install`);
      mainWindow?.webContents.send('update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdater] Error:', err.message);
    });

    // Delay first check by 15s so it doesn't compete with model loading / indexing at startup
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[AutoUpdater] checkForUpdates failed:', err.message);
      });
    }, 15000);
  }
}

// ─── Auto-Index Project ──────────────────────────────────────────────
let _reindexTimer = null;

async function autoIndexProject(projectPath) {
  if (!projectPath) return;
  console.log(`[IDE] Auto-indexing project: ${projectPath}`);
  try {
    const result = await ragEngine.indexProject(projectPath, (progress, done, total) => {
      if (mainWindow) mainWindow.webContents.send('rag-progress', { progress, done, total });
    });
    console.log(`[IDE] Indexing complete: ${result.totalFiles} files, ${result.totalChunks} chunks`);
    memoryStore.learnFact('project_path', projectPath);
    memoryStore.learnFact('project_files', `${result.totalFiles} files indexed`);
    if (mainWindow) mainWindow.webContents.send('rag-status', ragEngine.getStatus());
  } catch (e) {
    console.error('[IDE] Auto-indexing failed:', e.message);
  }
}

/**
 * Debounced incremental re-index — called when files change via MCP tools.
 * Waits 3s after last change to batch consecutive edits.
 */
function scheduleIncrementalReindex() {
  if (_reindexTimer) clearTimeout(_reindexTimer);
  _reindexTimer = setTimeout(async () => {
    _reindexTimer = null;
    if (!ragEngine.projectPath || ragEngine.isIndexing) return;
    try {
      const result = await ragEngine.reindexChanged();
      if (result.updated || result.added || result.removed) {
        console.log(`[IDE] Incremental re-index: ${result.updated} updated, ${result.added} added, ${result.removed} removed`);
        if (mainWindow) mainWindow.webContents.send('rag-status', ragEngine.getStatus());
      }
    } catch (e) {
      console.error('[IDE] Incremental re-index failed:', e.message);
    }
  }, 3000);
}

// ─── App Lifecycle ───────────────────────────────────────────────────
console.log('[IDE] App starting, NODE_ENV:', process.env.NODE_ENV);

process.on('uncaughtException', (err) => {
  console.error('[IDE] Uncaught exception:', err);
  // Write crash log
  try {
    const crashDir = path.join(app.getPath('userData'), 'crash-logs');
    fsSync.mkdirSync(crashDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fsSync.writeFileSync(path.join(crashDir, `crash-${ts}.txt`),
      `Uncaught Exception at ${new Date().toISOString()}\n\n${err?.stack || err}\n`);
  } catch (_) {}
  // Attempt graceful cleanup before exit
  try { playwrightBrowser.dispose(); } catch (_) {}
  try { terminalManager.disposeAll(); } catch (_) {}
  try { browserManager.dispose(); } catch (_) {}
  // Show error dialog and exit — continuing after uncaughtException is unsafe
  try {
    dialog.showErrorBox('guIDE — Fatal Error',
      `An unexpected error occurred. The application will restart.\n\n${err?.message || err}\n\nCrash details saved to:\n${path.join(app.getPath('userData'), 'crash-logs')}`);
  } catch (_) {}
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[IDE] Unhandled rejection:', reason);
  // Log but don't exit — unhandled rejections are recoverable
  try {
    const crashDir = path.join(app.getPath('userData'), 'crash-logs');
    fsSync.mkdirSync(crashDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fsSync.writeFileSync(path.join(crashDir, `rejection-${ts}.txt`),
      `Unhandled Rejection at ${new Date().toISOString()}\n\n${reason?.stack || reason}\n`);
  } catch (_) {}
});

app.whenReady().then(() => {
  // ─── Startup Integrity & Watermark ───────────────────────────────
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════╗');
  console.log('  ║  guIDE — AI-Powered Offline IDE                  ║');
  console.log('  ║  Copyright © 2025-2026 Brendan Gray               ║');
  console.log('  ║  GitHub: github.com/FileShot                      ║');
  console.log('  ║  Licensed under Source Available License           ║');
  console.log('  ║  Unauthorized redistribution/rebranding prohibited ║');
  console.log('  ╚═══════════════════════════════════════════════════╝');
  console.log('');

  // Runtime integrity checks — verify branding was not tampered
  const _appDir = app.getAppPath();
  const integrityChecks = [
    () => _B.n === 'guIDE',
    () => _B.a === 'Brendan Gray',
    () => _B.g === 'FileShot',
    () => _B.y.startsWith('2025'),
    () => {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(path.join(_appDir, 'package.json'), 'utf8'));
        return pkg.name === 'guide-ide' && (pkg.author || '').includes('Brendan');
      } catch { return false; }
    },
    () => {
      try {
        const lic = fsSync.readFileSync(path.join(_appDir, 'LICENSE'), 'utf8');
        return lic.includes('Brendan Gray') && lic.includes('guIDE');
      } catch { return false; }
    },
  ];

  const passed = integrityChecks.filter(c => { try { return c(); } catch { return false; } }).length;
  // Allow minor tolerance (5/6) — LICENSE or package.json may not always be present in all build configurations
  if (passed < integrityChecks.length - 1) {
    console.warn(`[guIDE] [!] Integrity: ${passed}/${integrityChecks.length} checks passed`);
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'guIDE — Integrity Warning',
      message: 'This copy of guIDE may have been tampered with.',
      detail: 'guIDE is created by Brendan Gray (github.com/FileShot).\n\nRedistribution, rebranding, or resale is prohibited\nunder the Source Available License.\n\nVisit github.com/FileShot for the official release.',
    });
  }

  console.log('[IDE] App ready, creating window...');
  createWindow();
}).catch((err) => {
  console.error('[IDE] Failed to create window:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('before-quit', () => {
  // Synchronous cleanup — Electron does not await async before-quit handlers
  try { playwrightBrowser.dispose(); } catch (_) {}
  try { terminalManager.disposeAll(); } catch (_) {}
  try { browserManager.dispose(); } catch (_) {}
  try { modelManager.dispose(); } catch (_) {}
  try { log.close(); } catch (_) {} // Flush persistent log file
  // Fire-and-forget async cleanup with a hard deadline
  const cleanupDone = Promise.all([
    memoryStore.dispose().catch(() => {}),
    llmEngine.dispose().catch(() => {}),
  ]);
  // Give async cleanup 3 seconds max, then force exit
  const forceTimer = setTimeout(() => {
    console.log('[IDE] Shutdown timeout — forcing exit');
    process.exit(0);
  }, 3000);
  forceTimer.unref(); // Don't keep the process alive just for this timer
  cleanupDone.then(() => clearTimeout(forceTimer)).catch(() => {});
});
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    // Allow navigations in non-default sessions (OAuth windows, etc.)
    // OAuth uses session.fromPartition('oauth-signin') which is non-persistent,
    // so storagePath is null — compare by identity instead.
    if (contents.session !== session.defaultSession) return;
    event.preventDefault();
  });
});
