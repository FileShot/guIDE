/**
 * guIDE — Electron Stub for Pipeline Runner
 *
 * Faithful Node.js stub of the Electron API surface.
 * Used ONLY by pipeline-runner.js — injected into require.cache as 'electron'
 * before any main/ module is loaded. NOT used by the actual Electron app.
 *
 * Every API that main/ modules touch is stubbed here so require() chains
 * resolve without an Electron process. Handlers registered via ipcMain.handle()
 * can be invoked by the runner via ipcMain._invoke().
 */
'use strict';

const path = require('path');
const os = require('os');

/* ================================================================== */
/*  app                                                                */
/* ================================================================== */

const _userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'guide-ide');

const app = {
  isPackaged: false,
  commandLine: { appendSwitch() {} },

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
      exe:        process.execPath,
      module:     process.execPath,
    };
    return map[name] || path.join(_userDataPath, name);
  },

  getAppPath() { return path.resolve(__dirname, '..'); },

  getVersion() {
    try { return require('../package.json').version; } catch { return '0.0.0'; }
  },

  requestSingleInstanceLock() { return true; },
  quit()      { process.exit(0); },
  exit(code)  { process.exit(code || 0); },
  disableHardwareAcceleration() {},
  focus() {},
  whenReady() { return Promise.resolve(); },

  _listeners: {},
  on(event, fn)   { (this._listeners[event] ??= []).push(fn); },
  once(event, fn)  { this.on(event, fn); },
  off(event, fn)   { const a = this._listeners[event]; if (a) this._listeners[event] = a.filter(f => f !== fn); },
  emit(event, ...a){ (this._listeners[event] || []).forEach(f => f(...a)); },
};

/* ================================================================== */
/*  ipcMain — fully functional in-memory IPC                           */
/* ================================================================== */

const _handlers  = new Map();
const _listeners = new Map();

const ipcMain = {
  handle(ch, fn)        { _handlers.set(ch, fn); },
  removeHandler(ch)     { _handlers.delete(ch); },

  on(ch, fn)  { if (!_listeners.has(ch)) _listeners.set(ch, []); _listeners.get(ch).push(fn); return ipcMain; },
  off(ch, fn) { const a = _listeners.get(ch); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } return ipcMain; },
  once(ch, fn) {
    const w = (...a) => { ipcMain.off(ch, w); fn(...a); };
    return ipcMain.on(ch, w);
  },
  removeAllListeners(ch) { ch ? _listeners.delete(ch) : _listeners.clear(); return ipcMain; },

  // ── Harness helpers (not part of real Electron) ──
  async _invoke(ch, ...args) {
    const handler = _handlers.get(ch);
    if (!handler) throw new Error(`[electron-stub] No handler for channel: "${ch}"`);
    return handler({ sender: { id: 1 }, frameId: 0, processId: process.pid }, ...args);
  },
  _emit(ch, ...args) {
    const fakeEvt = { sender: { id: 1 } };
    for (const fn of (_listeners.get(ch) || [])) {
      try { fn(fakeEvt, ...args); } catch (_) {}
    }
  },
  _registeredChannels() { return [..._handlers.keys()]; },
};

/* ================================================================== */
/*  BrowserWindow                                                      */
/* ================================================================== */

class BrowserWindow {
  constructor(opts) {
    this._options = opts || {};
    this._destroyed = false;
    this.webContents = {
      send(ch, ...a) { console.log(`[webContents.send] ${ch}`, ...a); },
      on() {}, once() {}, setWindowOpenHandler() {}, openDevTools() {},
    };
  }

  loadURL() {} loadFile() {} show() {} hide() {} close() {}
  restore() {} focus() {} maximize() {} minimize() {} unmaximize() {}
  setSize() {} setPosition() {} setTitle() {} setProgressBar() {}
  setThumbarButtons() {} flashFrame() {} setMenuBarVisibility() {}

  isDestroyed()  { return this._destroyed; }
  isMinimized()  { return false; }
  isMaximized()  { return false; }
  isVisible()    { return true; }
  isFocused()    { return true; }
  getSize()      { return [1600, 1000]; }
  getPosition()  { return [0, 0]; }
  getContentSize() { return [1600, 1000]; }

  on()  { return this; }  once() { return this; }
  off() { return this; }  removeListener() { return this; }
  removeAllListeners() { return this; }

  static getAllWindows()    { return []; }
  static fromId()          { return null; }
  static getFocusedWindow(){ return null; }
}

/* ================================================================== */
/*  safeStorage — XOR round-trip substitute for DPAPI                  */
/* ================================================================== */

const _SAFE_KEY = 'guide-runner-safe-storage-2026';
const safeStorage = {
  isEncryptionAvailable() { return true; },
  encryptString(str) {
    const buf = Buffer.from(str, 'utf8');
    for (let i = 0; i < buf.length; i++) buf[i] ^= _SAFE_KEY.charCodeAt(i % _SAFE_KEY.length);
    return buf;
  },
  decryptString(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const out = Buffer.alloc(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[i] ^ _SAFE_KEY.charCodeAt(i % _SAFE_KEY.length);
    return out.toString('utf8');
  },
};

/* ================================================================== */
/*  dialog                                                             */
/* ================================================================== */

const dialog = {
  showErrorBox(title, content) { console.error(`[DIALOG ERROR] ${title}\n${content}`); },
  showMessageBoxSync(opts) { console.log(`[DIALOG] ${opts.title || ''}: ${opts.message || ''}`); return 0; },
  showMessageBox(win, opts) {
    if (!opts) { opts = win; }
    console.log(`[DIALOG] ${opts.title || ''}: ${opts.message || ''}`);
    return Promise.resolve({ response: 0, checkboxChecked: false });
  },
  showOpenDialog(win, opts) {
    if (!opts) { opts = win; }
    return Promise.resolve({ canceled: true, filePaths: [] });
  },
  showSaveDialog(win, opts) {
    if (!opts) { opts = win; }
    return Promise.resolve({ canceled: true, filePath: undefined });
  },
};

/* ================================================================== */
/*  shell                                                              */
/* ================================================================== */

const shell = {
  openExternal(url)      { console.log(`[SHELL] openExternal: ${url}`); return Promise.resolve(); },
  showItemInFolder(p)    { console.log(`[SHELL] showItemInFolder: ${p}`); },
  openPath(p)            { return Promise.resolve(''); },
  moveItemToTrash()      { return false; },
  beep() {},
};

/* ================================================================== */
/*  Menu                                                               */
/* ================================================================== */

const Menu = {
  buildFromTemplate(t) { return { popup() {}, closePopup() {}, items: t || [] }; },
  setApplicationMenu() {},
  getApplicationMenu() { return null; },
};
Menu.Menu = Menu;

/* ================================================================== */
/*  session                                                            */
/* ================================================================== */

const _fakeSession = {
  setPermissionRequestHandler() {},
  setPermissionCheckHandler() {},
  webRequest: { onHeadersReceived() {}, onBeforeRequest() {}, onBeforeSendHeaders() {} },
  setProxy()        { return Promise.resolve(); },
  clearCache()      { return Promise.resolve(); },
  clearStorageData(){ return Promise.resolve(); },
  fromPartition()   { return _fakeSession; },
};

const session = {
  defaultSession: _fakeSession,
  fromPartition() { return _fakeSession; },
};

/* ================================================================== */
/*  Misc Electron modules                                              */
/* ================================================================== */

const nativeTheme  = { shouldUseDarkColors: true, themeSource: 'system', on() {}, once() {}, off() {} };
const powerMonitor = { on() {}, once() {}, off() {}, getSystemIdleState() { return 'active'; }, getSystemIdleTime() { return 0; } };
const clipboard    = { readText() { return ''; }, writeText() {}, readHTML() { return ''; }, writeHTML() {}, clear() {} };
const screen       = { getPrimaryDisplay() { return { workAreaSize: { width: 1920, height: 1080 }, scaleFactor: 1 }; }, getAllDisplays() { return [this.getPrimaryDisplay()]; }, on() {} };
const net          = { request() { throw new Error('[electron-stub] net.request() not supported in pipeline'); }, isOnline() { return true; } };

/* ================================================================== */
/*  Exports                                                            */
/* ================================================================== */

module.exports = {
  app, ipcMain, BrowserWindow, safeStorage, dialog, shell, Menu,
  session, nativeTheme, powerMonitor, clipboard, screen, net,
  ipcRenderer: null, // never used in main process code
};
