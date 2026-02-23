/**
 * IPC Handlers: Browser Automation (BrowserView)
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ipcMain.handle('browser-navigate', async (_, url) => ctx.browserManager.navigate(url));
  ipcMain.handle('browser-show', (_, bounds) => { ctx.browserManager.show(bounds); return { success: true }; });
  ipcMain.handle('browser-hide', () => { ctx.browserManager.hide(); return { success: true }; });
  ipcMain.handle('browser-set-bounds', (_, bounds) => { ctx.browserManager.setBounds(bounds); return { success: true }; });
  ipcMain.handle('browser-go-back', () => ctx.browserManager.goBack());
  ipcMain.handle('browser-go-forward', () => ctx.browserManager.goForward());
  ipcMain.handle('browser-reload', () => ctx.browserManager.reload());
  ipcMain.handle('browser-get-state', () => ctx.browserManager.getState());
  ipcMain.handle('browser-screenshot', async () => ctx.browserManager.screenshot());
  ipcMain.handle('browser-get-content', async (_, selector, html) => ctx.browserManager.getContent(selector, html));
  ipcMain.handle('browser-evaluate', async (_, code) => ctx.browserManager.evaluate(code));
  ipcMain.handle('browser-click', async (_, selector) => ctx.browserManager.click(selector));
  ipcMain.handle('browser-type', async (_, selector, text) => ctx.browserManager.type(selector, text));
  ipcMain.handle('browser-launch-external', async (_, url) => ctx.browserManager.launchExternalChrome(url));
}

module.exports = { register };
