'use strict';
/**
 * Application Menu — File, Edit, Selection, View, Go, Run, Terminal, Help
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */

const { Menu, dialog, shell, ipcMain } = require('electron');

let _recentFolders = [];
let _ctx = null;
let _rebuildTimeout = null;

/* ── helpers ────────────────────────────────────────────────────── */

function send(action) { _ctx?.getMainWindow()?.webContents.send('menu-action', action); }

function buildOpenRecentSubmenu() {
  if (!_recentFolders.length) return [{ label: 'No Recent Folders', enabled: false }];
  const items = _recentFolders.map(fp => ({
    label: fp,
    click: () => {
      const win = _ctx?.getMainWindow();
      if (!win) return;
      _ctx.currentProjectPath = fp;
      if (_ctx.mcpToolServer) _ctx.mcpToolServer.projectPath = fp;
      if (_ctx.gitManager) _ctx.gitManager.setProjectPath(fp);
      win.webContents.send('open-folder', fp);
      _ctx.autoIndexProject?.(fp);
    },
  }));
  items.push({ type: 'separator' }, { label: 'Clear Recent Folders', click: () => { _recentFolders = []; rebuildMenu(); } });
  return items;
}

function rebuildMenu() {
  if (!_ctx) return;
  clearTimeout(_rebuildTimeout);
  _rebuildTimeout = setTimeout(() => {
    try { Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate())); }
    catch (e) { console.error('[AppMenu] rebuild failed:', e.message); }
  }, 50);
}

/* ── template ───────────────────────────────────────────────────── */

function buildTemplate() {
  return [
    /* File */
    { label: 'File', submenu: [
      { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => send('new-file') },
      { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => _ctx?.createWindow() },
      { label: 'New Project from Template...', click: () => send('new-project') },
      { type: 'separator' },
      { label: 'Open File...', accelerator: 'CmdOrCtrl+O', click: async () => {
        const win = _ctx?.getMainWindow();
        const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Open File' });
        if (!r.canceled && r.filePaths[0]) win?.webContents.send('open-file', r.filePaths[0]);
      }},
      { label: 'Open Folder...', accelerator: 'CmdOrCtrl+K CmdOrCtrl+O', click: async () => {
        const win = _ctx?.getMainWindow();
        const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open Folder' });
        if (!r.canceled && r.filePaths[0]) {
          if (_ctx) _ctx.currentProjectPath = r.filePaths[0];
          if (_ctx?.mcpToolServer) _ctx.mcpToolServer.projectPath = r.filePaths[0];
          if (_ctx?.gitManager) _ctx.gitManager.setProjectPath(r.filePaths[0]);
          win?.webContents.send('open-folder', r.filePaths[0]);
          _ctx?.autoIndexProject(r.filePaths[0]);
        }
      }},
      { label: 'Open Recent', submenu: buildOpenRecentSubmenu() },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
      { label: 'Save All', accelerator: 'Ctrl+K S', click: () => send('save-all') },
      { label: 'Revert File', click: () => send('revert-file') },
      { type: 'separator' },
      { label: 'Reveal in Explorer', click: () => send('reveal-in-explorer') },
      { label: 'Open Containing Folder', click: () => send('open-containing-folder') },
      { type: 'separator' },
      { label: 'Auto Save', type: 'checkbox', checked: false, click: () => send('toggle-autosave') },
      { type: 'separator' },
      { label: 'Preferences', submenu: [
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') },
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+K CmdOrCtrl+S', click: () => send('open-keybindings') },
        { label: 'Theme', click: () => send('open-theme') },
      ]},
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab') },
      { label: 'Close All Tabs', accelerator: 'CmdOrCtrl+K CmdOrCtrl+W', click: () => send('close-all-tabs') },
      { label: 'Close Folder', click: () => send('close-folder') },
      { type: 'separator' },
      { label: 'Exit', accelerator: 'Alt+F4', click: () => require('electron').app.quit() },
    ]},

    /* Edit */
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
      { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('find-in-files') },
      { type: 'separator' },
      { label: 'Toggle Line Comment', accelerator: 'CmdOrCtrl+/', click: () => send('toggle-comment') },
      { label: 'Toggle Block Comment', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('toggle-block-comment') },
      { type: 'separator' },
      { label: 'Format Document', accelerator: 'Shift+Alt+F', click: () => send('format-document') },
    ]},

    /* Selection */
    { label: 'Selection', submenu: [
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      { label: 'Expand Selection', accelerator: 'Shift+Alt+Right', click: () => send('expand-selection') },
      { label: 'Shrink Selection', accelerator: 'Shift+Alt+Left', click: () => send('shrink-selection') },
      { type: 'separator' },
      { label: 'Copy Line Up', accelerator: 'Shift+Alt+Up', click: () => send('copy-line-up') },
      { label: 'Copy Line Down', accelerator: 'Shift+Alt+Down', click: () => send('copy-line-down') },
      { label: 'Move Line Up', accelerator: 'Alt+Up', click: () => send('move-line-up') },
      { label: 'Move Line Down', accelerator: 'Alt+Down', click: () => send('move-line-down') },
      { type: 'separator' },
      { label: 'Add Cursor Above', accelerator: 'CmdOrCtrl+Alt+Up', click: () => send('add-cursor-above') },
      { label: 'Add Cursor Below', accelerator: 'CmdOrCtrl+Alt+Down', click: () => send('add-cursor-below') },
      { label: 'Add Cursors to Line Ends', accelerator: 'Shift+Alt+I', click: () => send('cursors-line-ends') },
      { type: 'separator' },
      { label: 'Duplicate Selection', accelerator: 'Shift+Alt+D', click: () => send('duplicate-selection') },
      { type: 'separator' },
      { label: 'Add Next Occurrence', accelerator: 'CmdOrCtrl+D', click: () => send('add-next-occurrence') },
      { label: 'Add Previous Occurrence', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('add-prev-occurrence') },
      { label: 'Select All Occurrences', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('select-all-occurrences') },
      { type: 'separator' },
      { label: 'Column Selection Mode', accelerator: 'Shift+Alt+Insert', click: () => send('column-selection-mode') },
    ]},

    /* View */
    { label: 'View', submenu: [
      { label: 'Command Palette...', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('command-palette') },
      { type: 'separator' },
      { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('toggle-explorer') },
      { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('toggle-search') },
      { label: 'Source Control', accelerator: 'Ctrl+Shift+G', click: () => send('toggle-git') },
      { label: 'Debug', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('toggle-debug') },
      { label: 'MCP Servers', click: () => send('toggle-extensions') },
      { label: 'Model Benchmark', click: () => send('toggle-benchmark') },
      { type: 'separator' },
      { label: 'AI Chat', accelerator: 'CmdOrCtrl+L', click: () => send('toggle-chat') },
      { label: 'Browser', click: () => send('toggle-browser') },
      { label: 'Terminal', accelerator: 'Ctrl+`', click: () => send('toggle-terminal') },
      { type: 'separator' },
      { label: 'Appearance', submenu: [
        { label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-sidebar') },
        { label: 'Toggle Activity Bar', click: () => send('toggle-activity-bar') },
        { label: 'Toggle Status Bar', click: () => send('toggle-status-bar') },
        { label: 'Toggle Minimap', click: () => send('toggle-minimap') },
        { label: 'Toggle Word Wrap', accelerator: 'Alt+Z', click: () => send('toggle-word-wrap') },
      ]},
      { type: 'separator' },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
    ]},

    /* Go */
    { label: 'Go', submenu: [
      { label: 'Go to File...', accelerator: 'CmdOrCtrl+P', click: () => send('quick-open') },
      { label: 'Go to Symbol...', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('go-to-symbol') },
      { label: 'Go to Line...', accelerator: 'CmdOrCtrl+G', click: () => send('go-to-line') },
      { type: 'separator' },
      { label: 'Go to Definition', accelerator: 'F12', click: () => send('go-to-definition') },
      { label: 'Go to References', accelerator: 'Shift+F12', click: () => send('go-to-references') },
      { type: 'separator' },
      { label: 'Go Back', accelerator: 'Alt+Left', click: () => send('navigate-back') },
      { label: 'Go Forward', accelerator: 'Alt+Right', click: () => send('navigate-forward') },
    ]},

    /* Run */
    { label: 'Run', submenu: [
      { label: 'Run File', click: () => send('run-file') },
      { label: 'Run Without Debugging', accelerator: 'Ctrl+F5', click: () => send('run-file') },
      { type: 'separator' },
      { label: 'Start Debugging', accelerator: 'F5', click: () => send('start-debugging') },
      { label: 'Stop Debugging', accelerator: 'Shift+F5', click: () => send('stop-debugging') },
      { label: 'Restart Debugging', accelerator: 'Ctrl+Shift+F5', click: () => send('restart-debugging') },
      { type: 'separator' },
      { label: 'Continue', accelerator: 'F5', click: () => send('continue-debugging') },
      { label: 'Step Over', accelerator: 'F10', click: () => send('step-over') },
      { label: 'Step Into', accelerator: 'F11', click: () => send('step-into') },
      { label: 'Step Out', accelerator: 'Shift+F11', click: () => send('step-out') },
      { label: 'Pause', accelerator: 'F6', click: () => send('pause-debugging') },
      { type: 'separator' },
      { label: 'Run Build Task', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('run-build') },
      { label: 'Run Task...', click: () => send('run-task') },
      { type: 'separator' },
      { label: 'Toggle Breakpoint', accelerator: 'F9', click: () => send('toggle-breakpoint') },
      { label: 'New Breakpoint', submenu: [
        { label: 'Conditional Breakpoint...', click: () => send('add-conditional-breakpoint') },
        { label: 'Logpoint...', click: () => send('add-logpoint') },
      ]},
      { type: 'separator' },
      { label: 'Enable All Breakpoints', click: () => send('enable-all-breakpoints') },
      { label: 'Disable All Breakpoints', click: () => send('disable-all-breakpoints') },
      { label: 'Remove All Breakpoints', click: () => send('remove-all-breakpoints') },
      { type: 'separator' },
      { label: 'Open Configurations', click: () => send('open-debug-config') },
      { label: 'Add Configuration...', click: () => send('add-debug-config') },
    ]},

    /* Terminal */
    { label: 'Terminal', submenu: [
      { label: 'New Terminal', accelerator: 'Ctrl+Shift+`', click: () => send('new-terminal') },
      { label: 'Split Terminal', click: () => send('split-terminal') },
      { type: 'separator' },
      { label: 'Run Build Task', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('run-build') },
      { label: 'Run Active File', click: () => send('run-file') },
      { type: 'separator' },
      { label: 'Clear Terminal', click: () => send('clear-terminal') },
    ]},

    /* Help */
    { label: 'Help', submenu: [
      { label: 'Welcome', click: () => send('show-welcome') },
      { label: 'Documentation', click: () => shell.openExternal('https://graysoft.dev/faq') },
      { label: 'Release Notes', click: () => shell.openExternal('https://graysoft.dev/blog') },
      { type: 'separator' },
      { label: 'Report Issue', click: () => shell.openExternal('https://github.com/FileShot/guIDE/issues') },
      { label: 'GitHub Repository', click: () => shell.openExternal('https://github.com/FileShot/guIDE') },
      { label: 'Sponsor / Donate', click: () => shell.openExternal('https://github.com/sponsors/FileShot') },
      { type: 'separator' },
      { label: 'Check for Updates...', click: () => send('check-updates') },
      { type: 'separator' },
      { label: 'About guIDE', click: () => {
        dialog.showMessageBox(_ctx?.getMainWindow(), {
          type: 'info', title: 'About guIDE',
          message: 'guIDE v2.0.0 — AI-Powered Offline IDE',
          detail: 'Created by Brendan Gray\nhttps://graysoft.dev\n\nLocal LLM \u2022 RAG \u2022 MCP Tools \u2022 Browser Automation\nWeb Search \u2022 Memory Context\n\nYour code, your models, your machine.\nNo cloud required.',
        });
      }},
      { type: 'separator' },
      { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
    ]},
  ];
}

/* ── entry point ────────────────────────────────────────────────── */

function createMenu(ctx) {
  _ctx = ctx;
  if (!ipcMain.listenerCount('update-recent-folders')) {
    ipcMain.on('update-recent-folders', (_, folders) => {
      _recentFolders = Array.isArray(folders) ? folders : [];
      rebuildMenu();
    });
  }
  rebuildMenu();
}

module.exports = { createMenu };
