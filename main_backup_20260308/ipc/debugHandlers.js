/**
 * IPC Handlers: Debug Service (DAP)
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ctx.debugService.setEventCallback((event) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('debug-event', event);
    }
  });

  ipcMain.handle('debug-start', async (_, config) => {
    try {
      const result = await ctx.debugService.startSession(config);
      return { success: true, ...result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-stop', async (_, sessionId) => {
    try { await ctx.debugService.stopSession(sessionId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-set-breakpoints', async (_, sessionId, filePath, breakpoints) => {
    try {
      const result = await ctx.debugService.setBreakpoints(sessionId, filePath, breakpoints);
      return { success: true, breakpoints: result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-continue', async (_, sessionId) => {
    try { await ctx.debugService.continue_(sessionId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-step-over', async (_, sessionId) => {
    try { await ctx.debugService.stepOver(sessionId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-step-into', async (_, sessionId) => {
    try { await ctx.debugService.stepInto(sessionId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-step-out', async (_, sessionId) => {
    try { await ctx.debugService.stepOut(sessionId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-pause', async (_, sessionId) => {
    try { await ctx.debugService.pause(sessionId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-stack-trace', async (_, sessionId) => {
    try {
      const frames = await ctx.debugService.getStackTrace(sessionId);
      return { success: true, stackFrames: frames };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-scopes', async (_, sessionId, frameId) => {
    try {
      const scopes = await ctx.debugService.getScopes(sessionId, frameId);
      return { success: true, scopes };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-variables', async (_, sessionId, variablesReference) => {
    try {
      const variables = await ctx.debugService.getVariables(sessionId, variablesReference);
      return { success: true, variables };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-evaluate', async (_, sessionId, expression, frameId) => {
    try {
      const result = await ctx.debugService.evaluate(sessionId, expression, frameId);
      return { success: true, ...result };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('debug-get-sessions', () => {
    return { sessions: ctx.debugService.getAllSessions() };
  });
}

module.exports = { register };
