/**
 * electron-stub.js — Faithful Node.js stub of the Electron API.
 *
 * Used ONLY by pipeline-runner.js to run the full guIDE pipeline without
 * an Electron process. Every API that any main/ module touches is stubbed
 * faithfully — no shortcuts, no "return null" no-ops for things that matter.
 *
 * This file is injected into require.cache as 'electron' before any other
 * module is loaded. It is NOT used by the real Electron app.
 */

'use strict';

const path = require('path');
const os = require('os');

// ─── app ──────────────────────────────────────────────────────────────────────

const _userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'guide-ide');

const app = {
  isPackaged: false,

  commandLine: {
    appendSwitch(flag, value) {
      // GPU/Chromium flags — no-op in Node context
    },
  },

  getPath(name) {
    const map = {
      userData:   _userDataPath,
      appData:    path.join(os.homedir(), 'AppData', 'Roaming'),
      desktop:    path.join(os.homedir(), 'Desktop'),
      downloads:  path.join(os.homedir(), 'Downloads'),
      documents:  path.join(os.homedir(), 'Documents'),
      home:       os.homedir(),
      temp:       os.tmpdir(),
      logs:       path.join(_userDataPath, 'logs'),
      crashDumps: path.join(_userDataPath, 'crashDumps'),
      music:      path.join(os.homedir(), 'Music'),
      pictures:   path.join(os.homedir(), 'Pictures'),
      videos:     path.join(os.homedir(), 'Videos'),
      exe:        process.execPath,
      module:     process.execPath,
    };
    if (map[name]) return map[name];
    // Fallback — don't throw
    return path.join(_userDataPath, name);
  },

  getAppPath() {
    // Return the IDE root (one level up from main/)
    return path.resolve(__dirname, '..');
  },

  getVersion() {
    try {
      return require('../package.json').version;
    } catch (_) {
      return '0.0.0';
    }
  },

  requestSingleInstanceLock() {
    return true; // Always succeed — no real lock needed in test context
  },

  quit() {
    process.exit(0);
  },

  exit(code) {
    process.exit(code || 0);
  },

  disableHardwareAcceleration() {},

  focus() {},

  whenReady() {
    return Promise.resolve();
  },

  // Event emitter methods — used for app lifecycle events
  // Most of these are called in electron-main.js but we don't need them
  // in the pipeline runner since we don't use electron-main.js at all.
  _listeners: {},
  on(event, listener) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(listener);
  },
  once(event, listener) {
    this.on(event, listener);
  },
  off(event, listener) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(l => l !== listener);
    }
  },
  emit(event, ...args) {
    if (this._listeners[event]) {
      for (const l of this._listeners[event]) l(...args);
    }
  },
};


// ─── ipcMain ──────────────────────────────────────────────────────────────────
// Fully functional in-memory IPC — handlers registered via .handle() can be
// invoked by the runner via ._invoke(). Listeners registered via .on() are
// also stored and can be triggered via ._emit().

const _handlers = new Map();   // channel → async handler fn
const _listeners = new Map();  // channel → [listener fn, ...]

const ipcMain = {
  // Register an invoke-style handler (used by all ipcMain.handle() calls)
  handle(channel, handler) {
    _handlers.set(channel, handler);
  },

  // Remove a handler
  removeHandler(channel) {
    _handlers.delete(channel);
  },

  // Register a fire-and-forget listener (used by ipcMain.on() calls)
  on(channel, listener) {
    if (!_listeners.has(channel)) _listeners.set(channel, []);
    _listeners.get(channel).push(listener);
    return ipcMain; // chainable
  },

  off(channel, listener) {
    if (_listeners.has(channel)) {
      const arr = _listeners.get(channel);
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    }
    return ipcMain;
  },

  once(channel, listener) {
    const wrapper = (...args) => {
      ipcMain.off(channel, wrapper);
      listener(...args);
    };
    ipcMain.on(channel, wrapper);
    return ipcMain;
  },

  removeAllListeners(channel) {
    if (channel) {
      _listeners.delete(channel);
    } else {
      _listeners.clear();
    }
    return ipcMain;
  },

  // ── Harness-only methods (not part of real Electron API) ──────────────────

  // Invoke a registered handle() handler directly from the runner.
  // First arg is a fake event object (Electron passes the IpcMainInvokeEvent).
  async _invoke(channel, ...args) {
    const handler = _handlers.get(channel);
    if (!handler) {
      throw new Error(`[electron-stub] No ipcMain handler registered for channel: "${channel}"`);
    }
    // Fake event object — matches the shape agenticChat.js expects (it ignores it)
    const fakeEvent = {
      sender: { id: 1 },
      frameId: 0,
      processId: process.pid,
    };
    return handler(fakeEvent, ...args);
  },

  // Emit a fire-and-forget event to registered .on() listeners.
  _emit(channel, ...args) {
    const fakeEvent = { sender: { id: 1 } };
    if (_listeners.has(channel)) {
      for (const listener of _listeners.get(channel)) {
        try { listener(fakeEvent, ...args); } catch (_) {}
      }
    }
  },

  // Inspect registered handlers (for debugging)
  _registeredChannels() {
    return [..._handlers.keys()];
  },
};


// ─── BrowserWindow ────────────────────────────────────────────────────────────
// The runner creates its OWN fake mainWindow with a custom webContents.send()
// callback that prints to the terminal. This class is here so any code that
// does `new BrowserWindow(...)` doesn't throw — but in the runner we construct
// our own instance manually.

class BrowserWindow {
  constructor(options) {
    this._options = options || {};
    this._destroyed = false;
    this._minimized = false;

    // webContents.send is the primary output channel — overridden by runner
    this.webContents = {
      send(channel, ...args) {
        // Default: print to stdout. Runner replaces this with its own handler.
        console.log(`[webContents.send] ${channel}`, ...args);
      },
      on() {},
      once() {},
      setWindowOpenHandler() {},
      openDevTools() {},
    };
  }

  loadURL(url) {}
  loadFile(filePath) {}
  show() {}
  hide() {}
  close() {}
  restore() {}
  focus() {}
  maximize() {}
  minimize() {}
  unmaximize() {}
  setSize(w, h) {}
  setPosition(x, y) {}
  setTitle(t) {}
  setProgressBar(v) {}
  setThumbarButtons() {}
  flashFrame(flag) {}
  setMenuBarVisibility() {}

  isDestroyed() { return this._destroyed; }
  isMinimized() { return this._minimized; }
  isMaximized() { return false; }
  isVisible() { return true; }
  isFocused() { return true; }
  getSize() { return [1600, 1000]; }
  getPosition() { return [0, 0]; }
  getContentSize() { return [1600, 1000]; }

  on(event, listener) { return this; }
  once(event, listener) { return this; }
  off(event, listener) { return this; }
  removeListener(event, listener) { return this; }
  removeAllListeners(event) { return this; }

  static getAllWindows() { return []; }
  static fromId() { return null; }
  static getFocusedWindow() { return null; }
}


// ─── safeStorage ──────────────────────────────────────────────────────────────
// The real safeStorage uses DPAPI (Windows) to encrypt/decrypt. In Node context
// there's no DPAPI, so we use XOR with a fixed key as a transparent round-trip
// substitute. The important guarantee: encryptString(s) → decryptString() → s.

const _SAFE_KEY = 'guide-runner-safe-storage-2026';

const safeStorage = {
  isEncryptionAvailable() { return true; },

  encryptString(str) {
    // XOR-encode so the round-trip is lossless
    const buf = Buffer.from(str, 'utf8');
    for (let i = 0; i < buf.length; i++) {
      buf[i] ^= _SAFE_KEY.charCodeAt(i % _SAFE_KEY.length);
    }
    return buf;
  },

  decryptString(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const out = Buffer.alloc(b.length);
    for (let i = 0; i < b.length; i++) {
      out[i] = b[i] ^ _SAFE_KEY.charCodeAt(i % _SAFE_KEY.length);
    }
    return out.toString('utf8');
  },
};


// ─── dialog ───────────────────────────────────────────────────────────────────

const dialog = {
  showErrorBox(title, content) {
    console.error(`\n[DIALOG ERROR] ${title}\n${content}\n`);
  },

  showMessageBoxSync(opts) {
    console.log(`\n[DIALOG] ${opts.title || ''}: ${opts.message || ''}\n${opts.detail || ''}`);
    return 0; // OK button
  },

  showMessageBox(window, opts) {
    if (!opts) { opts = window; window = null; }
    console.log(`\n[DIALOG] ${opts.title || ''}: ${opts.message || ''}`);
    return Promise.resolve({ response: 0, checkboxChecked: false });
  },

  showOpenDialog(window, opts) {
    if (!opts) { opts = window; window = null; }
    return Promise.resolve({ canceled: true, filePaths: [] });
  },

  showSaveDialog(window, opts) {
    if (!opts) { opts = window; window = null; }
    return Promise.resolve({ canceled: true, filePath: undefined });
  },
};


// ─── shell ────────────────────────────────────────────────────────────────────

const shell = {
  openExternal(url) {
    console.log(`[SHELL] openExternal: ${url}`);
    return Promise.resolve();
  },
  showItemInFolder(fullPath) {
    console.log(`[SHELL] showItemInFolder: ${fullPath}`);
  },
  openPath(fullPath) {
    console.log(`[SHELL] openPath: ${fullPath}`);
    return Promise.resolve('');
  },
  moveItemToTrash(fullPath) {
    return false;
  },
  beep() {},
};


// ─── Menu ─────────────────────────────────────────────────────────────────────

const Menu = {
  buildFromTemplate(template) {
    return { popup() {}, closePopup() {}, items: template || [] };
  },
  setApplicationMenu(menu) {},
  getApplicationMenu() { return null; },
};

Menu.Menu = Menu; // Some code does require('electron').Menu.Menu


// ─── session ──────────────────────────────────────────────────────────────────

const _fakeSession = {
  setPermissionRequestHandler() {},
  setPermissionCheckHandler() {},
  webRequest: {
    onHeadersReceived(listener) {},
    onBeforeRequest(listener) {},
    onBeforeSendHeaders(listener) {},
  },
  setProxy() { return Promise.resolve(); },
  clearCache() { return Promise.resolve(); },
  clearStorageData() { return Promise.resolve(); },
  fromPartition() { return _fakeSession; },
};

const session = {
  defaultSession: _fakeSession,
  fromPartition(partition) { return _fakeSession; },
};


// ─── nativeTheme ──────────────────────────────────────────────────────────────

const nativeTheme = {
  shouldUseDarkColors: true,
  themeSource: 'system',
  on() {},
  once() {},
  off() {},
};


// ─── powerMonitor ─────────────────────────────────────────────────────────────

const powerMonitor = {
  on() {},
  once() {},
  off() {},
  getSystemIdleState() { return 'active'; },
  getSystemIdleTime() { return 0; },
};


// ─── clipboard ────────────────────────────────────────────────────────────────

const clipboard = {
  readText() { return ''; },
  writeText(text) {},
  readHTML() { return ''; },
  writeHTML(markup) {},
  clear() {},
};


// ─── screen ───────────────────────────────────────────────────────────────────

const screen = {
  getPrimaryDisplay() {
    return { workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 };
  },
  getAllDisplays() { return [screen.getPrimaryDisplay()]; },
  on() {},
};


// ─── net / netLog ─────────────────────────────────────────────────────────────

const net = {
  request(opts) {
    // Should not be called in pipeline context
    throw new Error('[electron-stub] net.request() not supported in pipeline runner');
  },
  isOnline() { return true; },
};


// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  app,
  ipcMain,
  BrowserWindow,
  safeStorage,
  dialog,
  shell,
  Menu,
  session,
  nativeTheme,
  powerMonitor,
  clipboard,
  screen,
  net,
  // Some code destructures these from electron
  ipcRenderer: null, // Should never be used in main process code
};
