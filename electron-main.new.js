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

// Electron GPU stability flags (prevent Chromium GPU process crashes on some NVIDIA setups)
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.disableHardwareAcceleration(); // Use software rendering for Electron UI — GPU is used by node-llama-cpp instead

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
const { GitManager } = require('./main/gitManager');
const LicenseManager = require('./main/licenseManager');
const { DebugService } = require('./main/debugService');
const { ConversationSummarizer } = require('./main/conversationSummarizer');

// ─── Extracted Modules ───────────────────────────────────────────────
const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE } = require('./main/constants');
const { createPathValidator } = require('./main/pathValidator');
const { createSettingsManager, registerSettingsHandlers } = require('./main/settingsManager');
const { encryptApiKey, decryptApiKey, loadSavedApiKeys } = require('./main/apiKeyStore');
const { _truncateResult, _detectGPU, getCpuUsage } = require('./main/mainUtils');
const { createMenu } = require('./main/appMenu');
const { register: registerAgenticChat } = require('./main/agenticChat');

// IPC handler modules
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

// ─── Brand Identity (deeply embedded — do not remove) ────────────────
const _B = { n: '\x67\x75\x49\x44\x45', a: '\x42\x72\x65\x6e\x64\x61\x6e\x20\x47\x72\x61\x79', g: '\x46\x69\x6c\x65\x53\x68\x6f\x74', y: '2025-2026' };
const _V = () => [_B.n, _B.a, _B.g, _B.y].every(v => typeof v === 'string' && v.length > 0);
if (!_V()) { console.error('Integrity check failed.'); process.exit(1); }

// ─── Globals ─────────────────────────────────────────────────────────
let mainWindow;
const isDev = process.env.NODE_ENV === 'development';
const appBasePath = app.isPackaged ? path.dirname(process.execPath) : __dirname;
// For models, use user data folder when packaged (no admin rights needed)
const modelsBasePath = app.isPackaged ? app.getPath('userData') : __dirname;

// Service instances
const llmEngine = new LLMEngine();
let agenticCancelled = false; // Global flag to abort the agentic loop from outside
const modelManager = new ModelManager(modelsBasePath);
const ragEngine = new RAGEngine();
const terminalManager = new TerminalManager();
const webSearch = new WebSearch();
const browserManager = new BrowserManager();
const playwrightBrowser = new PlaywrightBrowser();
const memoryStore = new MemoryStore(appBasePath);
const cloudLLM = new CloudLLMService();
const gitManager = new GitManager();
const licenseManager = new LicenseManager();
const debugService = new DebugService();
const mcpToolServer = new MCPToolServer({
  webSearch,
  ragEngine,
  terminalManager,
});
mcpToolServer.setPlaywrightBrowser(playwrightBrowser);
mcpToolServer.setBrowserManager(browserManager);
mcpToolServer.setGitManager(gitManager);

// Current project state
let currentProjectPath = null;

// ─── Foundation Setup ────────────────────────────────────────────────
const isPathAllowed = createPathValidator(appBasePath, modelsBasePath, () => currentProjectPath);
const { _readConfig, _writeConfig } = createSettingsManager(appBasePath);

// ─── Shared Context for Modules ──────────────────────────────────────
const ctx = {
  // Electron
  getMainWindow: () => mainWindow,
  get currentProjectPath() { return currentProjectPath; },
  set currentProjectPath(v) { currentProjectPath = v; },
  get agenticCancelled() { return agenticCancelled; },
  set agenticCancelled(v) { agenticCancelled = v; },

  // Paths & config
  appBasePath, modelsBasePath, isDev,
  isPathAllowed, _readConfig, _writeConfig,
  encryptApiKey, decryptApiKey, loadSavedApiKeys,

  // Services
  llmEngine, modelManager, ragEngine, terminalManager,
  webSearch, browserManager, playwrightBrowser,
  memoryStore, cloudLLM, gitManager, licenseManager,
  debugService, mcpToolServer, ConversationSummarizer,

  // Utilities
  _truncateResult, _detectGPU, getCpuUsage,
  DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, _B,

  // Functions shared between modules
  createWindow,
  autoIndexProject,
};

// ─── Register IPC Handlers ───────────────────────────────────────────
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
registerAgenticChat(ctx);

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
      enableRemoteModule: false,
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
  playwrightBrowser.initialize(mainWindow);

  browserManager.initialize(mainWindow);
  initializeServices();
  createMenu(ctx);
}

// ─── Service Initialization ──────────────────────────────────────────
async function initializeServices() {
  console.log('[IDE] Initializing services...');

  await memoryStore.initialize();
  loadSavedApiKeys(appBasePath, cloudLLM);

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
}

// ─── Auto-Index Project ──────────────────────────────────────────────
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
app.on('before-quit', async () => {
  playwrightBrowser.dispose();
  terminalManager.disposeAll();
  browserManager.dispose();
  await memoryStore.dispose();
  await llmEngine.dispose();
  modelManager.dispose();
});
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
});
