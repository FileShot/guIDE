/**
 * IPC Handlers: Dialogs & External URLs
 */
const { ipcMain, dialog, shell } = require('electron');

function register(ctx) {
  ipcMain.handle('show-save-dialog', async (_, options) => dialog.showSaveDialog(ctx.getMainWindow(), options));
  ipcMain.handle('show-open-dialog', async (_, options) => dialog.showOpenDialog(ctx.getMainWindow(), options));
  ipcMain.handle('show-message-box', async (_, options) => dialog.showMessageBox(ctx.getMainWindow(), options));

  ipcMain.handle('open-external', async (_, url) => {
    if (!url || typeof url !== 'string') return;
    const parsed = new URL(url).protocol;
    if (parsed !== 'http:' && parsed !== 'https:') {
      console.warn(`[Security] Blocked open-external for non-http URL: ${url}`);
      return;
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('reveal-in-explorer', (_, filePath) => {
    if (!filePath || typeof filePath !== 'string') return;
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('open-containing-folder', (_, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string') return;
    shell.openPath(folderPath);
  });
}

module.exports = { register };
