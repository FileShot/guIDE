/**
 * Secure API key storage — uses Electron's safeStorage (OS keychain via DPAPI/Keychain/libsecret).
 * Falls back to plaintext if safeStorage is unavailable (e.g. CI, headless).
 */
const path = require('path');
const fsSync = require('fs');
const { safeStorage } = require('electron');

function encryptApiKey(key) {
  if (!key || typeof key !== 'string') return key;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key);
      return 'enc:' + encrypted.toString('base64');
    }
  } catch (_) {}
  return key;
}

function decryptApiKey(stored) {
  if (!stored || typeof stored !== 'string') return stored;
  if (stored.startsWith('enc:')) {
    try {
      const buf = Buffer.from(stored.slice(4), 'base64');
      return safeStorage.decryptString(buf);
    } catch (e) {
      console.warn('[Security] Failed to decrypt API key, it may need to be re-entered:', e.message);
      return '';
    }
  }
  return stored;
}

function loadSavedApiKeys(appBasePath, cloudLLM) {
  const configPath = path.join(appBasePath, '.guide-config.json');
  try {
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    if (config.apiKeys) {
      let migrated = false;
      for (const [provider, storedKey] of Object.entries(config.apiKeys)) {
        if (!storedKey) continue;
        const key = decryptApiKey(storedKey);
        if (key) {
          cloudLLM.setApiKey(provider, key);
          if (typeof storedKey === 'string' && !storedKey.startsWith('enc:')) {
            config.apiKeys[provider] = encryptApiKey(storedKey);
            migrated = true;
          }
        }
      }
      if (migrated) {
        // Atomic write: write to temp file, then rename
        const tmpPath = configPath + '.tmp';
        try { fsSync.writeFileSync(tmpPath, JSON.stringify(config, null, 2)); fsSync.renameSync(tmpPath, configPath); } catch (_) {}
        console.log('[Security] Auto-migrated plaintext API keys to encrypted storage');
      }
      console.log(`[IDE] Loaded API keys for: ${Object.keys(config.apiKeys).filter(k => config.apiKeys[k]).join(', ')}`);
    }

    // Load key pools: { provider: ["key1", "key2", ...] }
    // Each key is added to the provider's rotation pool for automatic failover
    if (config.keyPools && typeof config.keyPools === 'object') {
      let poolMigrated = false;
      for (const [provider, keys] of Object.entries(config.keyPools)) {
        if (!Array.isArray(keys)) continue;
        for (let i = 0; i < keys.length; i++) {
          const storedKey = keys[i];
          if (!storedKey) continue;
          const key = decryptApiKey(storedKey);
          if (key) {
            cloudLLM.addKeyToPool(provider, key);
            if (typeof storedKey === 'string' && !storedKey.startsWith('enc:')) {
              keys[i] = encryptApiKey(storedKey);
              poolMigrated = true;
            }
          }
        }
      }
      if (poolMigrated) {
        config.keyPools = config.keyPools; // updated in-place
        const tmpPath = configPath + '.tmp';
        try { fsSync.writeFileSync(tmpPath, JSON.stringify(config, null, 2)); fsSync.renameSync(tmpPath, configPath); } catch (_) {}
        console.log('[Security] Auto-encrypted key pool entries');
      }
    }
  } catch {
    // No config file yet
  }
}

module.exports = { encryptApiKey, decryptApiKey, loadSavedApiKeys };
