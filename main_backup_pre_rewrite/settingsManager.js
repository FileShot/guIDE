/**
 * guIDE — Settings Manager
 *
 * Handles persistence and IPC for user settings, system prompt preview,
 * and chat session management. Settings stored at <userData>/settings.json.
 * Chat sessions at <userData>/chat-sessions.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, app } = require('electron');
const log = require('./logger');

/* ------------------------------------------------------------------ */
/*  Settings persistence                                               */
/* ------------------------------------------------------------------ */

function _settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function _chatSessionsPath() {
  return path.join(app.getPath('userData'), 'chat-sessions.json');
}

function _readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function _writeJson(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

/* ------------------------------------------------------------------ */
/*  Factory + IPC registration                                         */
/* ------------------------------------------------------------------ */

function createSettingsManager(ctx) {
  function _readConfig() {
    const data = _readJson(_settingsPath());
    return data || {};
  }

  function _writeConfig(settings) {
    try {
      _writeJson(_settingsPath(), settings);
      log.info('Settings', 'Saved');
      return { success: true };
    } catch (e) {
      log.error('Settings', 'Save failed:', e.message);
      return { success: false, error: e.message };
    }
  }

  return { _readConfig, _writeConfig };
}

function registerSettingsHandlers(ctx) {
  const { _readConfig, _writeConfig } = createSettingsManager(ctx);

  ipcMain.handle('save-settings', (_evt, settings) => _writeConfig(settings));
  ipcMain.handle('load-settings', () => _readConfig());

  // ── Model persistence ──
  ipcMain.handle('set-last-used-model', (_evt, modelPath) => {
    try {
      const config = _readConfig();
      config.lastUsedModel = modelPath || null;
      return _writeConfig(config);
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('get-last-used-model', () => {
    const config = _readConfig();
    return config.lastUsedModel || null;
  });

  ipcMain.handle('set-default-model', (_evt, modelPath) => {
    try {
      const config = _readConfig();
      config.defaultModelPath = modelPath || null;
      return _writeConfig(config);
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('get-default-model', () => {
    const config = _readConfig();
    return config.defaultModelPath || null;
  });

  ipcMain.handle('get-system-prompt-preview', (_evt, opts) => {
    // Return the effective system prompt that would be sent to the model
    const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE } = require('./constants');
    const compact = opts?.compact;
    return compact ? DEFAULT_COMPACT_PREAMBLE : DEFAULT_SYSTEM_PREAMBLE;
  });

  // ── Chat session persistence ──
  ipcMain.handle('save-chat-sessions', (_evt, sessions) => {
    try {
      _writeJson(_chatSessionsPath(), sessions);
      return { success: true };
    } catch (e) {
      log.error('Settings', 'Failed to save chat sessions:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('load-chat-sessions', () => {
    return _readJson(_chatSessionsPath()) || [];
  });

  ipcMain.handle('delete-chat-session', (_evt, sessionId) => {
    try {
      const sessions = _readJson(_chatSessionsPath()) || [];
      const filtered = sessions.filter(s => s.id !== sessionId);
      _writeJson(_chatSessionsPath(), filtered);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  log.info('Settings', 'IPC handlers registered');
}

module.exports = { createSettingsManager, registerSettingsHandlers };
