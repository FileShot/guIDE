/**
 * guIDE — Secure API Key Storage
 *
 * Encrypts/decrypts API keys via Electron's safeStorage (OS keychain: DPAPI/Keychain/libsecret).
 * Falls back to plaintext when safeStorage is unavailable (CI, headless, Linux without gnome-keyring).
 *
 * Config stored at: <projectRoot>/.guide-config.json
 *   - apiKeys: { provider: "enc:<base64>" }
 *   - keyPools: { provider: ["enc:<base64>", ...] }
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { safeStorage } = require('electron');
const log = require('./logger');

/* ------------------------------------------------------------------ */
/*  Encrypt / Decrypt                                                  */
/* ------------------------------------------------------------------ */

function encryptApiKey(key) {
  if (!key || typeof key !== 'string') return key;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(key).toString('base64');
    }
  } catch (_) { /* safeStorage unavailable */ }
  return key;
}

function decryptApiKey(stored) {
  if (!stored || typeof stored !== 'string') return stored;
  if (!stored.startsWith('enc:')) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  } catch (e) {
    log.warn('Security', 'Failed to decrypt API key — may need re-entry:', e.message);
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Load from config                                                   */
/* ------------------------------------------------------------------ */

function loadSavedApiKeys(appBasePath, cloudLLM) {
  const configPath = path.join(appBasePath, '.guide-config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return; // no config file yet
  }

  let dirty = false;

  // -- Single keys per provider --
  if (config.apiKeys && typeof config.apiKeys === 'object') {
    for (const [provider, stored] of Object.entries(config.apiKeys)) {
      if (!stored) continue;
      const key = decryptApiKey(stored);
      if (!key) continue;
      cloudLLM.setApiKey(provider, key);
      if (typeof stored === 'string' && !stored.startsWith('enc:')) {
        config.apiKeys[provider] = encryptApiKey(stored);
        dirty = true;
      }
    }
    const loaded = Object.keys(config.apiKeys).filter(k => config.apiKeys[k]);
    if (loaded.length) log.info('IDE', `Loaded API keys for: ${loaded.join(', ')}`);
  }

  // -- Key pools (rotation / failover) --
  if (config.keyPools && typeof config.keyPools === 'object') {
    for (const [provider, keys] of Object.entries(config.keyPools)) {
      if (!Array.isArray(keys)) continue;
      for (let i = 0; i < keys.length; i++) {
        if (!keys[i]) continue;
        const key = decryptApiKey(keys[i]);
        if (!key) continue;
        cloudLLM.addKeyToPool(provider, key);
        if (typeof keys[i] === 'string' && !keys[i].startsWith('enc:')) {
          keys[i] = encryptApiKey(keys[i]);
          dirty = true;
        }
      }
    }
  }

  // Atomic write-back if any plaintext keys were auto-encrypted
  if (dirty) {
    const tmp = configPath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
      fs.renameSync(tmp, configPath);
      log.info('Security', 'Auto-migrated plaintext API keys to encrypted storage');
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = { encryptApiKey, decryptApiKey, loadSavedApiKeys };
