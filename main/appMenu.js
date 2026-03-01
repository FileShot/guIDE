/**
 * Application Menu — File, Edit, View, Terminal, Help
 */
const { Menu, dialog, shell, ipcMain } = require('electron');

// Keep recent folders in memory so the menu can be rebuilt when they change
let _recentFolders = [];
let _ctx = null;
let _rebuildTimeout = null;

function buildOpenRecentSubmenu() {
  if (_recentFolders.length === 0) {
    return [{ label: 'No Recent Folders', enabled: false }];
  }
  const items = _recentFolders.map(folderPath => ({
    label: folderPath,
    click: () => {
      const win = _ctx?.getMainWindow?.();
      if (!win) return;
      _ctx.currentProjectPath = folderPath;
      if (_ctx.mcpToolServer) _ctx.mcpToolServer.projectPath = folderPath;
      if (_ctx.gitManager) _ctx.gitManager.setProjectPath(folderPath);
      win.webContents.send('open-folder', folderPath);
      _ctx.autoIndexProject?.(folderPath);
    },
  }));
  items.push({ type: 'separator' });
  items.push({
    label: 'Clear Recent Folders',
    click: () => {
      _recentFolders = [];
      rebuildMenu();
    },
  });
  return items;
}

function rebuildMenu() {
  if (!_ctx) return;
  // Debounce: coalesce rapid successive calls (e.g. IPC + click firing together)
  // to prevent "Cannot set property submenu — only a getter" crash from Electron's
  // native MenuItem objects being processed concurrently.
  clearTimeout(_rebuildTimeout);
  _rebuildTimeout = setTimeout(() => {
    try {
      Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
    } catch (err) {
      console.error('[AppMenu] Failed to rebuild menu:', err.message);
    }
  }, 50);
}

function buildTemplate() {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'new-file') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => _ctx?.createWindow() },
        { label: 'New Project from Template...', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'new-project') },
        { type: 'separator' },
        {
          label: 'Open File...', accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = _ctx?.getMainWindow();
            const result = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Open File' });
            if (!result.canceled && result.filePaths[0]) win?.webContents.send('open-file', result.filePaths[0]);
          },
        },
        {
          label: 'Open Folder...', accelerator: 'CmdOrCtrl+K CmdOrCtrl+O',
          click: async () => {
            const win = _ctx?.getMainWindow();
            const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open Folder' });
            if (!result.canceled && result.filePaths[0]) {
              if (_ctx) _ctx.currentProjectPath = result.filePaths[0];
              if (_ctx?.mcpToolServer) _ctx.mcpToolServer.projectPath = result.filePaths[0];
              if (_ctx?.gitManager) _ctx.gitManager.setProjectPath(result.filePaths[0]);
              win?.webContents.send('open-folder', result.filePaths[0]);
              _ctx?.autoIndexProject(result.filePaths[0]);
            }
          },
        },
        {
          label: 'Open Recent',
          submenu: buildOpenRecentSubmenu(),
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'save-as') },
        { label: 'Save All', accelerator: 'Ctrl+K S', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'save-all') },
        { label: 'Revert File', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'revert-file') },
        { type: 'separator' },
        { label: 'Reveal in Explorer', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'reveal-in-explorer') },
        { label: 'Open Containing Folder', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'open-containing-folder') },
        { type: 'separator' },
        { label: 'Auto Save', type: 'checkbox', checked: false, click: (item) => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-autosave') },
        { type: 'separator' },
        { label: 'Preferences', submenu: [
          { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'open-settings') },
          { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+K CmdOrCtrl+S', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'open-keybindings') },
          { label: 'Theme', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'open-theme') },
        ]},
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'close-tab') },
        { label: 'Close All Tabs', accelerator: 'CmdOrCtrl+K CmdOrCtrl+W', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'close-all-tabs') },
        { label: 'Close Folder', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'close-folder') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'Alt+F4', click: () => require('electron').app.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'find') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'replace') },
        { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'find-in-files') },
        { type: 'separator' },
        { label: 'Toggle Line Comment', accelerator: 'CmdOrCtrl+/', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-comment') },
        { label: 'Toggle Block Comment', accelerator: 'CmdOrCtrl+Shift+A', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-block-comment') },
        { type: 'separator' },
        { label: 'Format Document', accelerator: 'Shift+Alt+F', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'format-document') },
        { label: 'Emmet: Expand Abbreviation', accelerator: 'Tab', enabled: false },
      ],
    },
    {
      label: 'Selection',
      submenu: [
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { label: 'Expand Selection', accelerator: 'Shift+Alt+Right', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'expand-selection') },
        { label: 'Shrink Selection', accelerator: 'Shift+Alt+Left', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'shrink-selection') },
        { type: 'separator' },
        { label: 'Copy Line Up', accelerator: 'Shift+Alt+Up', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'copy-line-up') },
        { label: 'Copy Line Down', accelerator: 'Shift+Alt+Down', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'copy-line-down') },
        { label: 'Move Line Up', accelerator: 'Alt+Up', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'move-line-up') },
        { label: 'Move Line Down', accelerator: 'Alt+Down', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'move-line-down') },
        { type: 'separator' },
        { label: 'Add Cursor Above', accelerator: 'CmdOrCtrl+Alt+Up', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-cursor-above') },
        { label: 'Add Cursor Below', accelerator: 'CmdOrCtrl+Alt+Down', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-cursor-below') },
        { label: 'Add Cursors to Line Ends', accelerator: 'Shift+Alt+I', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'cursors-line-ends') },
        { type: 'separator' },
        { label: 'Duplicate Selection', accelerator: 'Shift+Alt+D', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'duplicate-selection') },
        { type: 'separator' },
        { label: 'Add Next Occurrence', accelerator: 'CmdOrCtrl+D', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-next-occurrence') },
        { label: 'Add Previous Occurrence', accelerator: 'CmdOrCtrl+Shift+D', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-prev-occurrence') },
        { label: 'Select All Occurrences', accelerator: 'CmdOrCtrl+Shift+L', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'select-all-occurrences') },
        { type: 'separator' },
        { label: 'Switch to Ctrl+Click for Go to Definition', enabled: false },
        { label: 'Column Selection Mode', accelerator: 'Shift+Alt+Insert', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'column-selection-mode') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette...', accelerator: 'CmdOrCtrl+Shift+P', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'command-palette') },
        { type: 'separator' },
        { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-explorer') },
        { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-search') },
        { label: 'Source Control', accelerator: 'Ctrl+Shift+G', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-git') },
        { label: 'Debug', accelerator: 'CmdOrCtrl+Shift+D', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-debug') },
        { label: 'MCP Servers', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-extensions') },
        { label: 'Model Benchmark', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-benchmark') },
        { type: 'separator' },
        { label: 'AI Chat', accelerator: 'CmdOrCtrl+L', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-chat') },
        { label: 'Browser', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-browser') },
        { label: 'Terminal', accelerator: 'Ctrl+`', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-terminal') },
        { type: 'separator' },
        { label: 'Appearance', submenu: [
          { label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen' },
          { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-sidebar') },
          { label: 'Toggle Activity Bar', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-activity-bar') },
          { label: 'Toggle Status Bar', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-status-bar') },
          { label: 'Toggle Minimap', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-minimap') },
          { label: 'Toggle Word Wrap', accelerator: 'Alt+Z', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-word-wrap') },
        ]},
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Go to File...', accelerator: 'CmdOrCtrl+P', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'quick-open') },
        { label: 'Go to Symbol...', accelerator: 'CmdOrCtrl+Shift+O', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'go-to-symbol') },
        { label: 'Go to Line...', accelerator: 'CmdOrCtrl+G', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'go-to-line') },
        { type: 'separator' },
        { label: 'Go to Definition', accelerator: 'F12', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'go-to-definition') },
        { label: 'Go to References', accelerator: 'Shift+F12', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'go-to-references') },
        { type: 'separator' },
        { label: 'Go Back', accelerator: 'Alt+Left', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'navigate-back') },
        { label: 'Go Forward', accelerator: 'Alt+Right', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'navigate-forward') },
      ],
    },
    {
      label: 'Run',
      submenu: [
        { label: 'Run File', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'run-file') },
        { label: 'Run Without Debugging', accelerator: 'Ctrl+F5', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'run-file') },
        { type: 'separator' },
        { label: 'Start Debugging', accelerator: 'F5', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'start-debugging') },
        { label: 'Stop Debugging', accelerator: 'Shift+F5', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'stop-debugging') },
        { label: 'Restart Debugging', accelerator: 'Ctrl+Shift+F5', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'restart-debugging') },
        { type: 'separator' },
        { label: 'Continue', accelerator: 'F5', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'continue-debugging') },
        { label: 'Step Over', accelerator: 'F10', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'step-over') },
        { label: 'Step Into', accelerator: 'F11', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'step-into') },
        { label: 'Step Out', accelerator: 'Shift+F11', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'step-out') },
        { label: 'Pause', accelerator: 'F6', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'pause-debugging') },
        { type: 'separator' },
        { label: 'Run Build Task', accelerator: 'CmdOrCtrl+Shift+B', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'run-build') },
        { label: 'Run Task...', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'run-task') },
        { type: 'separator' },
        { label: 'Toggle Breakpoint', accelerator: 'F9', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'toggle-breakpoint') },
        { label: 'New Breakpoint', submenu: [
          { label: 'Conditional Breakpoint...', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-conditional-breakpoint') },
          { label: 'Logpoint...', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-logpoint') },
        ]},
        { type: 'separator' },
        { label: 'Enable All Breakpoints', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'enable-all-breakpoints') },
        { label: 'Disable All Breakpoints', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'disable-all-breakpoints') },
        { label: 'Remove All Breakpoints', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'remove-all-breakpoints') },
        { type: 'separator' },
        { label: 'Open Configurations', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'open-debug-config') },
        { label: 'Add Configuration...', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'add-debug-config') },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'New Terminal', accelerator: 'Ctrl+Shift+`', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'new-terminal') },
        { label: 'Split Terminal', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'split-terminal') },
        { type: 'separator' },
        { label: 'Run Build Task', accelerator: 'CmdOrCtrl+Shift+B', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'run-build') },
        { label: 'Run Active File', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'run-file') },
        { type: 'separator' },
        { label: 'Clear Terminal', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'clear-terminal') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Welcome', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'show-welcome') },
        { label: 'Documentation', click: () => shell.openExternal('https://graysoft.dev/faq') },
        { label: 'Release Notes', click: () => shell.openExternal('https://graysoft.dev/blog') },
        { type: 'separator' },
        { label: 'Report Issue', click: () => shell.openExternal('https://github.com/FileShot/guIDE/issues') },
        { label: 'GitHub Repository', click: () => shell.openExternal('https://github.com/FileShot/guIDE') },
        { label: 'Sponsor / Donate', click: () => shell.openExternal('https://github.com/sponsors/FileShot') },
        { type: 'separator' },
        { label: 'Check for Updates...', click: () => _ctx?.getMainWindow()?.webContents.send('menu-action', 'check-updates') },
        { type: 'separator' },
        {
          label: 'About guIDE',
          click: () => {
            dialog.showMessageBox(_ctx?.getMainWindow(), {
              type: 'info', title: 'About guIDE',
              message: 'guIDE v2.0.0 — AI-Powered Offline IDE',
              detail: 'Created by Brendan Gray\nhttps://graysoft.dev\n\nLocal LLM • RAG • MCP Tools • Browser Automation\nWeb Search • Memory Context\n\nYour code, your models, your machine.\nNo cloud required.',
            });
          },
        },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
  ];
}

function createMenu(ctx) {
  _ctx = ctx;
  // Register IPC for dynamic Open Recent updates (renderer sends this when rootPath changes)
  if (!ipcMain.listenerCount('update-recent-folders')) {
    ipcMain.on('update-recent-folders', (_, folders) => {
      _recentFolders = Array.isArray(folders) ? folders : [];
      rebuildMenu();
    });
  }
  rebuildMenu();
}

module.exports = { createMenu };
