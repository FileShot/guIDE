/**
 * IPC Handlers: Memory Store
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ipcMain.handle('memory-get-stats', () => ctx.memoryStore.getStats());
  ipcMain.handle('memory-get-context', () => ctx.memoryStore.getContextPrompt());
  ipcMain.handle('memory-learn-fact', (_, key, value) => { ctx.memoryStore.learnFact(key, value); return { success: true }; });
  ipcMain.handle('memory-find-errors', (_, errorMsg) => ctx.memoryStore.findSimilarErrors(errorMsg));
  ipcMain.handle('memory-clear', () => { ctx.memoryStore.clear(); return { success: true }; });
  ipcMain.handle('memory-clear-conversations', () => { ctx.memoryStore.clearConversations(); return { success: true }; });
}

module.exports = { register };
