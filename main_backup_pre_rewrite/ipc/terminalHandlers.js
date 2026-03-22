/**
 * IPC Handlers: Terminal Management
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ipcMain.handle('terminal-create', (_, options) => {
    // Validate terminal cwd is within allowed paths
    if (options?.cwd && !ctx.isPathAllowed(options.cwd)) {
      throw new Error('Access denied: terminal cwd outside allowed directories');
    }
    return ctx.terminalManager.create(options);
  });
  ipcMain.handle('terminal-write', (_, id, data) => ctx.terminalManager.write(id, data));
  ipcMain.handle('terminal-resize', (_, id, cols, rows) => ctx.terminalManager.resize(id, cols, rows));
  ipcMain.handle('terminal-destroy', (_, id) => ctx.terminalManager.destroy(id));
  ipcMain.handle('terminal-list', () => ctx.terminalManager.list());
}

module.exports = { register };
