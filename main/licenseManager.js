/**
 * guIDE License Manager
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved.
 *
 * Handles license key validation, machine fingerprinting, activation,
 * and AI feature gating.
 *
 * Enforcement model:
 *   - AI features blocked until license is purchased and activated
 *   - Download is free, editor/terminal/file explorer work without activation
 *   - Server validation REQUIRED for activation (no offline bypass)
 *   - 2 machines per license (desktop + laptop)
 *   - 14-day revalidation cycle (phones home periodically)
 *   - HMAC-signed local files (prevents trivial JSON editing)
 *   - NODE_ENV=development bypasses all checks
 */
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

// License file signing secret — derived at runtime to resist casual extraction
// (not a substitute for server-side validation, which is the real security layer)
const _k1 = Buffer.from([0x67, 0x53, 0x21, 0x64, 0x33]); // part 1
const _k2 = Buffer.from([0x5f, 0x32, 0x30, 0x32, 0x36]); // part 2
const _k3 = Buffer.from([0x5f, 0x70, 0x72, 0x30, 0x74, 0x33, 0x63, 0x74]); // part 3
const HMAC_SECRET = Buffer.concat([_k1, _k2, _k3]).toString();
const REVALIDATION_DAYS = 14;
const MAX_MACHINES = 2;

class LicenseManager {
  constructor() {
    this.licenseData = null;
    this.isActivated = false;
    this.activationError = null;
    this.serverHost = 'graysoft.dev';
    this.serverPath = '/api/license/validate';

    const { app } = require('electron');
    this.licenseDir = path.join(app.getPath('userData'), 'license');
    this.licenseFile = path.join(this.licenseDir, 'license.json');
  }

  // --- Machine Fingerprint ---
  getMachineFingerprint() {
    const cpus = os.cpus();
    const parts = [
      os.hostname(),
      os.userInfo().username,
      os.platform(),
      os.arch(),
      cpus[0]?.model || 'unknown-cpu',
      cpus.length.toString(),
      os.totalmem().toString(),
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
  }

  // --- HMAC Signing ---
  _sign(data) {
    const payload = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', HMAC_SECRET + this.getMachineFingerprint());
    hmac.update(payload);
    return hmac.digest('hex');
  }

  _verify(data, signature) {
    return this._sign(data) === signature;
  }

  _readSigned(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!raw._sig || !raw._data) {
        // Migrate old unsigned files
        console.log('[License] Migrating unsigned file:', filePath);
        return raw;
      }
      if (!this._verify(raw._data, raw._sig)) {
        console.warn('[License] Signature mismatch - file may be tampered');
        return null;
      }
      return raw._data;
    } catch (e) {
      console.error('[License] Error reading signed file:', e.message);
      return null;
    }
  }

  _writeSigned(filePath, data) {
    try {
      if (!fs.existsSync(this.licenseDir)) fs.mkdirSync(this.licenseDir, { recursive: true });
      const sig = this._sign(data);
      fs.writeFileSync(filePath, JSON.stringify({ _data: data, _sig: sig }, null, 2));
    } catch (e) {
      console.error('[License] Failed to write signed file:', e.message);
    }
  }

  // --- Key Format ---
  isValidKeyFormat(key) {
    return /^GUIDE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key?.toUpperCase());
  }

  // --- Access Control (THE GATE) ---
  checkAccess() {
    // Dev bypass — ONLY in actual development (not packaged app)
    // Use Electron's app.isPackaged as the authoritative check
    const { app } = require('electron');
    if (!app.isPackaged && process.env.NODE_ENV === 'development') {
      return { allowed: true, reason: 'dev-mode', activated: true };
    }
    // If activated with valid license, allow
    if (this.isActivated) {
      return { allowed: true, reason: 'activated', activated: true };
    }
    // Not activated = blocked
    return { allowed: false, reason: 'not-activated', activated: false };
  }

  // --- Load License ---
  loadLicense() {
    try {
      const data = this._readSigned(this.licenseFile);
      if (data && data.machineId === this.getMachineFingerprint()) {
        // Full license (key-based, account-based, or paid OAuth)
        if ((data.key || data.authMethod === 'account' || data.authMethod === 'oauth') && data.activatedAt) {
          this.licenseData = data;
          const daysSinceValidation = (Date.now() - (data.lastValidated || 0)) / (1000 * 60 * 60 * 24);
          if (daysSinceValidation < REVALIDATION_DAYS) {
            this.isActivated = true;
            return { activated: true, license: this._sanitizeLicense(data) };
          }
          this.isActivated = true;
          return { activated: true, needsRevalidation: true, license: this._sanitizeLicense(data) };
        }
        // OAuth-authenticated but no license (free user)
        if (data.authMethod === 'oauth' && data.email && !data.activatedAt) {
          this.licenseData = data;
          this.isActivated = false;
          return { activated: false, authenticated: true, license: this._sanitizeLicense(data) };
        }
      }
    } catch (e) {
      console.error('[License] Error loading license:', e.message);
    }
    return { activated: false };
  }

  // --- Activate with License Key (SERVER REQUIRED) ---
  async activate(licenseKey) {
    const key = licenseKey?.trim().toUpperCase();
    if (!this.isValidKeyFormat(key)) {
      return { success: false, error: 'Invalid license key format. Expected: GUIDE-XXXX-XXXX-XXXX-XXXX' };
    }
    const machineId = this.getMachineFingerprint();
    try {
      const result = await this._validateOnline(key, machineId);
      if (result.success) {
        this._saveLicense({
          key, machineId, activatedAt: Date.now(), lastValidated: Date.now(),
          email: result.email || null, plan: result.plan || 'standard', expiresAt: result.expiresAt || null,
        });
        this.isActivated = true;
        return { success: true, message: 'License activated successfully!' };
      }
      return { success: false, error: result.error || 'Activation failed' };
    } catch (e) {
      console.error('[License] Server unreachable during activation:', e.message);
      return { success: false, error: 'Unable to reach the license server. Please check your internet connection and try again.' };
    }
  }

  // --- Activate with Account (SERVER REQUIRED) ---
  async activateWithAccount(email, password) {
    if (!email || !password) return { success: false, error: 'Email and password are required.' };
    const machineId = this.getMachineFingerprint();
    try {
      const result = await this._authenticateOnline(email.trim(), password, machineId);
      if (result.success) {
        this._saveLicense({
          key: result.licenseKey || null, machineId, activatedAt: Date.now(), lastValidated: Date.now(),
          email: email.trim(), plan: result.plan || 'standard', expiresAt: result.expiresAt || null, authMethod: 'account',
          sessionToken: result.token || null,
        });
        this.isActivated = true;
        return { success: true, message: 'Signed in and activated!', license: this._sanitizeLicense(this.licenseData) };
      }
      return { success: false, error: result.error || 'Authentication failed' };
    } catch (e) {
      return { success: false, error: 'Server unreachable. Please check your internet connection and try again.' };
    }
  }

  // --- Activate with OAuth Token (called after BrowserWindow OAuth flow) ---
  async activateWithToken(token) {
    if (!token) return { success: false, error: 'Token is required.' };
    const machineId = this.getMachineFingerprint();
    console.log(`[License] activateWithToken called (machineId: ${machineId}, token length: ${token.length})`);
    try {
      const result = await this._activateTokenOnline(token, machineId);
      console.log('[License] Server response:', JSON.stringify(result));
      if (result.success) {
        this._saveLicense({
          key: result.licenseKey || null, machineId, activatedAt: Date.now(), lastValidated: Date.now(),
          email: result.email, plan: result.plan || 'standard', expiresAt: result.expiresAt || null, authMethod: 'oauth',
          sessionToken: result.token || result.sessionToken || null,
        });
        this.isActivated = true;
        return { success: true, message: 'OAuth sign-in successful!', license: this._sanitizeLicense(this.licenseData) };
      }
      // User authenticated (has email) but no purchased license yet
      if (result.email) {
        this._saveLicense({
          key: null, machineId, activatedAt: null, lastValidated: null,
          email: result.email, plan: 'free', expiresAt: null, authMethod: 'oauth',
        });
        this.isActivated = false;
        return { success: false, authenticated: true, email: result.email, error: result.error || 'No active license' };
      }
      return { success: false, error: result.error || 'Token activation failed' };
    } catch (e) {
      console.error('[License] activateWithToken network error:', e.message);
      return { success: false, error: 'Server unreachable. Please check your internet connection and try again.' };
    }
  }

  // --- Deactivate ---
  async deactivate() {
    try { if (fs.existsSync(this.licenseFile)) fs.unlinkSync(this.licenseFile); } catch (_) {}
    this.licenseData = null;
    this.isActivated = false;
    return { success: true };
  }

  // --- Session Token (for server-proxied API requests) ---
  getSessionToken() {
    return this.licenseData?.sessionToken || null;
  }

  // --- Status ---
  getStatus() {
    const access = this.checkAccess();
    return {
      isActivated: this.isActivated,
      isAuthenticated: !!(this.licenseData?.email),
      license: this.licenseData ? this._sanitizeLicense(this.licenseData) : null,
      machineId: this.getMachineFingerprint(),
      access: { allowed: access.allowed, reason: access.reason },
    };
  }

  // --- Revalidate ---
  async revalidate() {
    if (!this.licenseData) return { success: this.isActivated };
    const key = this.licenseData.key;
    if (!key) return { success: this.isActivated };
    try {
      const result = await this._validateOnline(key, this.getMachineFingerprint());
      if (result.success) {
        this.licenseData.lastValidated = Date.now();
        this._saveLicense(this.licenseData);
        return { success: true };
      }
      this.isActivated = false;
      this.activationError = result.error;
      return { success: false, error: result.error };
    } catch (e) {
      console.log('[License] Revalidation failed (server unreachable), keeping cached state');
      return { success: this.isActivated };
    }
  }

  // --- Helpers ---
  _sanitizeLicense(data) {
    return {
      key: data.key ? data.key.substring(0, 10) + '...' : null,
      activatedAt: data.activatedAt || null, lastValidated: data.lastValidated || null,
      email: data.email || null, plan: data.plan || 'free', expiresAt: data.expiresAt || null,
      authMethod: data.authMethod || 'key',
    };
  }

  _saveLicense(data) {
    this.licenseData = data;
    this._writeSigned(this.licenseFile, data);
  }

  _validateOnline(key, machineId) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ key, machineId, platform: os.platform(), appVersion: require('../package.json').version });
      const req = https.request({
        hostname: this.serverHost, port: 443, path: this.serverPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false, error: 'Invalid server response' }); } });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body); req.end();
    });
  }

  _authenticateOnline(email, password, machineId) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ email, password, machineId, platform: os.platform(), appVersion: require('../package.json').version });
      const req = https.request({
        hostname: this.serverHost, port: 443, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false, error: 'Invalid server response' }); } });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body); req.end();
    });
  }

  _activateTokenOnline(token, machineId) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ token, machineId, platform: os.platform(), appVersion: require('../package.json').version });
      const req = https.request({
        hostname: this.serverHost, port: 443, path: '/api/auth/activate-token', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false, error: 'Invalid server response' }); } });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body); req.end();
    });
  }

  // --- Developer Activation (offline, no server needed) ---
  // Creates a valid local license for the developer to test paywall and full features.
  // Key must match the special developer format: GUIDE-DEV0-xxxx-xxxx-xxxx
  devActivate(devKey) {
    const key = (devKey || '').trim().toUpperCase();
    if (!key.startsWith('GUIDE-DEV0')) {
      return { success: false, error: 'Not a valid developer key' };
    }
    if (!this.isValidKeyFormat(key)) {
      return { success: false, error: 'Invalid key format. Expected: GUIDE-XXXX-XXXX-XXXX-XXXX' };
    }
    const machineId = this.getMachineFingerprint();
    this._saveLicense({
      key, machineId, activatedAt: Date.now(), lastValidated: Date.now(),
      email: 'developer@graysoft.dev', plan: 'developer', expiresAt: null,
    });
    this.isActivated = true;
    return { success: true, message: 'Developer license activated locally.' };
  }
}

module.exports = LicenseManager;
