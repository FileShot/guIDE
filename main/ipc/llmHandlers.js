/**
 * IPC Handlers: LLM Operations & GPU Management
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ipcMain.handle('llm-get-status', () => {
    const status = ctx.llmEngine.getStatus();
    const win = ctx.getMainWindow();
    if (win && status.modelInfo?.contextSize) {
      let used = 0;
      try {
        const seq = ctx.llmEngine.context?.getSequence?.();
        if (seq?.nTokens) used = seq.nTokens;
      } catch (_) {}
      win.webContents.send('context-usage', { used, total: status.modelInfo.contextSize });
    }
    return status;
  });

  // ─── GPU Monitoring & Preference ──────────────────────────────────
  ipcMain.handle('gpu-get-info', () => {
    try { return { success: true, gpu: ctx.llmEngine.getGPUInfo() }; }
    catch (e) { return { success: false, error: e.message, gpu: null }; }
  });

  ipcMain.handle('gpu-set-preference', async (_, pref) => {
    ctx.llmEngine.setGPUPreference(pref);
    const config = ctx._readConfig();
    if (!config.userSettings) config.userSettings = {};
    config.userSettings.gpuPreference = pref;
    ctx._writeConfig(config);

    if (ctx.llmEngine.currentModelPath && ctx.llmEngine.isReady) {
      try {
        const modelInfo = await ctx.llmEngine.initialize(ctx.llmEngine.currentModelPath);
        const win = ctx.getMainWindow();
        if (win && modelInfo?.contextSize) {
          win.webContents.send('context-usage', { used: 0, total: modelInfo.contextSize });
        }
        return { success: true, preference: pref, reloaded: true, modelInfo };
      } catch (e) {
        console.error('[GPU] Failed to reload model with new preference:', e.message);
        return { success: true, preference: pref, reloaded: false, error: e.message };
      }
    }
    return { success: true, preference: pref };
  });

  ipcMain.handle('gpu-get-preference', () => {
    return { success: true, preference: ctx.llmEngine.gpuPreference };
  });

  // ─── LLM Operations ────────────────────────────────────────────────
  ipcMain.handle('llm-load-model', async (_, modelPath) => {
    try {
      if (ctx.llmEngine.abortController) {
        console.log('[LLM] Cancelling active generation before model switch');
        ctx.llmEngine.cancelGeneration();
        await new Promise(r => setTimeout(r, 100));
      }
      const modelInfo = await ctx.llmEngine.initialize(modelPath);
      const win = ctx.getMainWindow();
      if (win && modelInfo?.contextSize) {
        win.webContents.send('context-usage', { used: 0, total: modelInfo.contextSize });
      }
      return { success: true, modelInfo };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('llm-generate', async (_, prompt, params) => {
    const access = ctx.licenseManager.checkAccess();
    if (!access.allowed) {
      return { success: false, error: '__LICENSE_BLOCKED__', reason: access.reason };
    }
    try { return { success: true, ...(await ctx.llmEngine.generate(prompt, params)) }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('llm-generate-stream', async (_, prompt, params) => {
    const access = ctx.licenseManager.checkAccess();
    if (!access.allowed) {
      return { success: false, error: '__LICENSE_BLOCKED__', reason: access.reason };
    }
    try {
      const win = ctx.getMainWindow();
      const result = await ctx.llmEngine.generateStream(prompt, params, (token) => {
        if (win) win.webContents.send('llm-token', token);
      }, (thinkToken) => {
        if (win) win.webContents.send('llm-thinking-token', thinkToken);
      });
      return { success: true, ...result };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('llm-cancel', async () => {
    ctx.agenticCancelled = true;
    ctx.llmEngine.cancelGeneration();
    try { await ctx.llmEngine.resetSession(); } catch (_) {}
    return { success: true };
  });

  ipcMain.handle('llm-reset-session', async () => {
    await ctx.llmEngine.resetSession();
    // Clear todo state from previous session — prevents ghost todos
    if (ctx.mcpToolServer) {
      ctx.mcpToolServer._todos = [];
      ctx.mcpToolServer._todoNextId = 1;
    }
    if (ctx.playwrightBrowser.isLaunched) {
      try { await ctx.playwrightBrowser.close(); } catch (_) {}
      console.log('[Reset] Closed Playwright browser for fresh session');
    }
    return { success: true };
  });

  ipcMain.handle('llm-update-params', (_, params) => { ctx.llmEngine.updateParams(params); return { success: true }; });

  ipcMain.handle('llm-set-context-size', async (_, contextSize) => {
    try {
      ctx.llmEngine.contextSizeOverride = contextSize;
      if (ctx.llmEngine.currentModelPath && ctx.llmEngine.isReady) {
        const modelInfo = await ctx.llmEngine.initialize(ctx.llmEngine.currentModelPath);
        const win = ctx.getMainWindow();
        if (win && modelInfo?.contextSize) {
          win.webContents.send('context-usage', { used: 0, total: modelInfo.contextSize });
        }
        return { success: true, contextSize: modelInfo.contextSize };
      }
      return { success: true, contextSize };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('llm-set-reasoning-effort', (_, level) => {
    const budgetMap = { low: 256, medium: 1024, high: -1 };
    ctx.llmEngine.reasoningEffort = level;
    ctx.llmEngine.thoughtTokenBudget = budgetMap[level] ?? 2048;
    console.log(`[LLM] Reasoning effort set to: ${level} (thought budget: ${budgetMap[level] === -1 ? 'unlimited' : budgetMap[level]})`);
    return { success: true };
  });
}

module.exports = { register };
