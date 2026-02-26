/**
 * Settings persistence — in-memory cache + debounced write-through.
 * Provides _readConfig / _writeConfig used throughout the app.
 */
const path = require('path');
const fsSync = require('fs');
const { ipcMain } = require('electron');

function createSettingsManager(appBasePath) {
  const settingsConfigPath = path.join(appBasePath, '.guide-config.json');
  let _configCache = null;
  let _configWriteTimer = null;

  // Ensure the directory exists (e.g. %APPDATA%\guide-ide)
  try { fsSync.mkdirSync(appBasePath, { recursive: true }); } catch (_) {}

  // One-time migration: if config exists in the old install directory but not
  // in the new location, copy it over so user settings are preserved.
  try {
    if (!fsSync.existsSync(settingsConfigPath)) {
      const { app } = require('electron');
      const oldPath = path.join(
        app.isPackaged ? path.dirname(process.execPath) : __dirname,
        '.guide-config.json'
      );
      if (oldPath !== settingsConfigPath && fsSync.existsSync(oldPath)) {
        fsSync.copyFileSync(oldPath, settingsConfigPath);
        console.log('[Settings] Migrated config from install dir to userData');
      }
    }
  } catch (_) {}

  function _readConfig() {
    if (_configCache) return _configCache;
    try {
      _configCache = JSON.parse(fsSync.readFileSync(settingsConfigPath, 'utf8'));
    } catch {
      _configCache = {};
    }
    return _configCache;
  }

  function _writeConfig(config) {
    _configCache = config;
    if (_configWriteTimer) clearTimeout(_configWriteTimer);
    _configWriteTimer = setTimeout(() => {
      _configWriteTimer = null;
      try {
        fsSync.writeFileSync(settingsConfigPath, JSON.stringify(config, null, 2));
      } catch (e) {
        console.error('[Settings] Save failed:', e);
      }
    }, 500);
  }

  return { _readConfig, _writeConfig };
}

function registerSettingsHandlers(ctx) {
  const { _readConfig, _writeConfig, cloudLLM, encryptApiKey, mcpToolServer, DEFAULT_SYSTEM_PREAMBLE, imageGen, llmEngine } = ctx;

  ipcMain.handle('save-settings', (_, settings) => {
    const config = _readConfig();
    config.userSettings = settings;
    _writeConfig(config);

    if (settings?.cloudProvider && settings.cloudProvider !== 'none' && settings?.cloudApiKey) {
      cloudLLM.setApiKey(settings.cloudProvider, settings.cloudApiKey);
      if (!config.apiKeys) config.apiKeys = {};
      config.apiKeys[settings.cloudProvider] = encryptApiKey(settings.cloudApiKey);
      _writeConfig(config);
    }

    // Pollinations API key (for video generation)
    if (settings?.pollinationsApiKey && typeof settings.pollinationsApiKey === 'string' && settings.pollinationsApiKey.trim()) {
      const key = settings.pollinationsApiKey.trim();
      if (imageGen) imageGen.addPollinationsKey(key);
      if (!config.apiKeys) config.apiKeys = {};
      config.apiKeys.pollinations = encryptApiKey(key);
      _writeConfig(config);
    }

    // ── Apply inference params to live engine (no model reload needed) ────────
    // These 7 params take effect on the NEXT generation call.
    // contextSize and gpuLayers require a model reload — we do NOT apply those here.
    const appliedToEngine = !!(llmEngine && llmEngine.isReady);
    if (llmEngine) {
      if (typeof settings.temperature === 'number')   llmEngine.defaultParams.temperature  = settings.temperature;
      if (typeof settings.maxTokens    === 'number')  llmEngine.defaultParams.maxTokens    = settings.maxTokens;
      if (typeof settings.topP         === 'number')  llmEngine.defaultParams.topP         = settings.topP;
      if (typeof settings.topK         === 'number')  llmEngine.defaultParams.topK         = settings.topK;
      if (typeof settings.repeatPenalty === 'number') llmEngine.defaultParams.repeatPenalty = settings.repeatPenalty;
      if (typeof settings.seed         === 'number')  llmEngine.defaultParams.seed         = settings.seed;
      if (typeof settings.generationTimeoutSec === 'number') {
        llmEngine.generationTimeoutMs = settings.generationTimeoutSec * 1000;
      }
      console.log('[Settings] Inference params applied to live engine:', {
        temperature: llmEngine.defaultParams.temperature,
        maxTokens:   llmEngine.defaultParams.maxTokens,
        topP:        llmEngine.defaultParams.topP,
        topK:        llmEngine.defaultParams.topK,
        repeatPenalty: llmEngine.defaultParams.repeatPenalty,
        seed:        llmEngine.defaultParams.seed,
        generationTimeoutMs: llmEngine.generationTimeoutMs,
      });
    }

    return {
      success: true,
      appliedToEngine,
      // Fields that require model reload to take effect
      needsReload: ['contextSize', 'gpuLayers', 'gpuPreference'],
    };
  });

  ipcMain.handle('load-settings', () => {
    const config = _readConfig();
    return { success: true, settings: config.userSettings || null };
  });

  ipcMain.handle('get-system-prompt-preview', () => {
    const savedSettings = _readConfig()?.userSettings;
    const userPreamble = savedSettings?.systemPrompt?.trim();
    const preamble = userPreamble || DEFAULT_SYSTEM_PREAMBLE;
    const toolPrompt = mcpToolServer.getToolPromptForTask('general');
    return {
      defaultPreamble: DEFAULT_SYSTEM_PREAMBLE,
      toolDefinitions: toolPrompt,
      fullPrompt: preamble + '\n\n' + toolPrompt,
    };
  });

  // Conversation History Persistence
  ipcMain.handle('save-chat-sessions', (_, sessions) => {
    const config = _readConfig();
    config.chatSessions = sessions;
    _writeConfig(config);
    return { success: true };
  });

  ipcMain.handle('load-chat-sessions', () => {
    const config = _readConfig();
    return { success: true, sessions: config.chatSessions || [] };
  });

  ipcMain.handle('delete-chat-session', (_, sessionId) => {
    const config = _readConfig();
    config.chatSessions = (config.chatSessions || []).filter(s => s.id !== sessionId);
    _writeConfig(config);
    return { success: true };
  });
}

module.exports = { createSettingsManager, registerSettingsHandlers };
