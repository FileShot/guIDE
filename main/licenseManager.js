'use strict';
/**
 * guIDE License Manager
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved.
 *
 * HMAC-signed license.json, server validation at graysoft.dev,
 * machine fingerprinting, OAuth + key-based activation.
 *
 * Enforcement: AI features blocked until activated. Editor/terminal/file
 * explorer work without activation. 14-day revalidation cycle.
 * NODE_ENV=development bypasses all checks.
 */

const crypto = require('crypto');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');

/* ── HMAC secret (split to resist casual grep) ────────────────────── */
const _k1 = Buffer.from([0x67, 0x53, 0x21, 0x64, 0x33]);
const _k2 = Buffer.from([0x5f, 0x32, 0x30, 0x32, 0x36]);
const _k3 = Buffer.from([0x5f, 0x70, 0x72, 0x30, 0x74, 0x33, 0x63, 0x74]);
const HMAC_SECRET       = Buffer.concat([_k1, _k2, _k3]).toString();
const REVALIDATION_DAYS = 14;
const KEY_RE            = /^GUIDE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

class LicenseManager {
  constructor() {
    this.licenseData     = null;
    this.isActivated     = false;
    this.activationError = null;
    this.serverHost      = 'graysoft.dev';
    this.serverPath      = '/api/license/validate';

    const { app } = require('electron');
    this.licenseDir  = path.join(app.getPath('userData'), 'license');
    this.licenseFile = path.join(this.licenseDir, 'license.json');
  }

  /* ── Machine fingerprint ──────────────────────────────────────── */

  getMachineFingerprint() {
    const cpus = os.cpus();
    const parts = [
      os.hostname(), os.userInfo().username, os.platform(), os.arch(),
      cpus[0]?.model || 'unknown-cpu', cpus.length.toString(), os.totalmem().toString(),
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
  }

  /* ── HMAC signing ─────────────────────────────────────────────── */

  _sign(data) {
    const payload = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', HMAC_SECRET + this.getMachineFingerprint());
    hmac.update(payload);
    return hmac.digest('hex');
  }

  _verify(data, signature) { return this._sign(data) === signature; }

  _readSigned(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!raw._sig || !raw._data) return raw;               // migrate unsigned
      if (!this._verify(raw._data, raw._sig)) return null;   // tampered
      return raw._data;
    } catch { return null; }
  }

  _writeSigned(filePath, data) {
    try {
      if (!fs.existsSync(this.licenseDir)) fs.mkdirSync(this.licenseDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ _data: data, _sig: this._sign(data) }, null, 2));
    } catch (e) { console.error('[License] write error:', e.message); }
  }

  /* ── Key format ───────────────────────────────────────────────── */

  isValidKeyFormat(key) { return KEY_RE.test(key?.toUpperCase()); }

  /* ── Access control (the gate) ────────────────────────────────── */

  checkAccess() {
    const { app } = require('electron');
    if (!app.isPackaged && process.env.NODE_ENV === 'development') {
      return { allowed: true, reason: 'dev-mode', activated: true };
    }
    if (this.isActivated) return { allowed: true, reason: 'activated', activated: true };
    return { allowed: false, reason: 'not-activated', activated: false };
  }

  /* ── Load from disk ───────────────────────────────────────────── */

  loadLicense() {
    try {
      const data = this._readSigned(this.licenseFile);
      if (!data || data.machineId !== this.getMachineFingerprint()) return { activated: false };

      // Full license (key / account / paid oauth)
      if ((data.key || data.authMethod === 'account' || data.authMethod === 'oauth') && data.activatedAt) {
        this.licenseData = data;
        const days = (Date.now() - (data.lastValidated || 0)) / 864e5;
        this.isActivated = true;
        if (days >= REVALIDATION_DAYS) {
          return { activated: true, needsRevalidation: true, license: this._sanitize(data) };
        }
        return { activated: true, license: this._sanitize(data) };
      }
      // OAuth-authenticated but free (no license)
      if (data.authMethod === 'oauth' && data.email && !data.activatedAt) {
        this.licenseData = data;
        this.isActivated = false;
        return { activated: false, authenticated: true, license: this._sanitize(data) };
      }
    } catch (e) { console.error('[License] load error:', e.message); }
    return { activated: false };
  }

  /* ── Activate with license key (server required) ──────────────── */

  async activate(licenseKey) {
    const key = licenseKey?.trim().toUpperCase();
    if (!this.isValidKeyFormat(key)) {
      return { success: false, error: 'Invalid license key format. Expected: GUIDE-XXXX-XXXX-XXXX-XXXX' };
    }
    try {
      const result = await this._validateOnline(key, this.getMachineFingerprint());
      if (result.success) {
        this._save({
          key, machineId: this.getMachineFingerprint(),
          activatedAt: Date.now(), lastValidated: Date.now(),
          email: result.email || null, plan: result.plan || 'standard',
          expiresAt: result.expiresAt || null,
        });
        this.isActivated = true;
        return { success: true, message: 'License activated successfully!' };
      }
      return { success: false, error: result.error || 'Activation failed' };
    } catch (e) {
      return { success: false, error: 'Unable to reach the license server. Please check your internet connection.' };
    }
  }

  /* ── Activate with account (server required) ──────────────────── */

  async activateWithAccount(email, password) {
    if (!email || !password) return { success: false, error: 'Email and password are required.' };
    const machineId = this.getMachineFingerprint();
    try {
      const result = await this._authenticateOnline(email.trim(), password, machineId);
      if (result.success) {
        this._save({
          key: result.licenseKey || null, machineId,
          activatedAt: Date.now(), lastValidated: Date.now(),
          email: email.trim(), plan: result.plan || 'standard',
          expiresAt: result.expiresAt || null, authMethod: 'account',
          sessionToken: result.token || null,
        });
        this.isActivated = true;
        return { success: true, message: 'Signed in and activated!', license: this._sanitize(this.licenseData) };
      }
      return { success: false, error: result.error || 'Authentication failed' };
    } catch {
      return { success: false, error: 'Server unreachable. Please check your internet connection.' };
    }
  }

  /* ── Activate with OAuth token ────────────────────────────────── */

  async activateWithToken(token) {
    if (!token) return { success: false, error: 'Token is required.' };
    const machineId = this.getMachineFingerprint();
    try {
      const result = await this._activateTokenOnline(token, machineId);
      if (result.success) {
        this._save({
          key: result.licenseKey || null, machineId,
          activatedAt: Date.now(), lastValidated: Date.now(),
          email: result.email, plan: result.plan || 'standard',
          expiresAt: result.expiresAt || null, authMethod: 'oauth',
          sessionToken: result.token || result.sessionToken || null,
        });
        this.isActivated = true;
        return { success: true, message: 'OAuth sign-in successful!', license: this._sanitize(this.licenseData) };
      }
      if (result.email) {
        this._save({
          key: null, machineId, activatedAt: null, lastValidated: null,
          email: result.email, plan: 'free', expiresAt: null, authMethod: 'oauth',
        });
        this.isActivated = false;
        return { success: false, authenticated: true, email: result.email, error: result.error || 'No active license' };
      }
      return { success: false, error: result.error || 'Token activation failed' };
    } catch (e) {
      return { success: false, error: 'Server unreachable. Please check your internet connection.' };
    }
  }

  /* ── Deactivate ───────────────────────────────────────────────── */

  async deactivate() {
    try { if (fs.existsSync(this.licenseFile)) fs.unlinkSync(this.licenseFile); } catch {}
    this.licenseData = null;
    this.isActivated = false;
    return { success: true };
  }

  /* ── Session token (for server-proxied requests) ──────────────── */

  getSessionToken() { return this.licenseData?.sessionToken || null; }

  /* ── Status ───────────────────────────────────────────────────── */

  getStatus() {
    const access = this.checkAccess();
    return {
      isActivated: this.isActivated,
      isAuthenticated: !!(this.licenseData?.email),
      license: this.licenseData ? this._sanitize(this.licenseData) : null,
      machineId: this.getMachineFingerprint(),
      access: { allowed: access.allowed, reason: access.reason },
    };
  }

  /* ── Revalidate ───────────────────────────────────────────────── */

  async revalidate() {
    if (!this.licenseData?.key) return { success: this.isActivated };
    try {
      const result = await this._validateOnline(this.licenseData.key, this.getMachineFingerprint());
      if (result.success) {
        this.licenseData.lastValidated = Date.now();
        this._save(this.licenseData);
        return { success: true };
      }
      this.isActivated = false;
      this.activationError = result.error;
      return { success: false, error: result.error };
    } catch {
      return { success: this.isActivated };
    }
  }

  /* ── Developer activation (offline) ───────────────────────────── */

  devActivate(devKey) {
    const key = (devKey || '').trim().toUpperCase();
    if (!key.startsWith('GUIDE-DEV0')) return { success: false, error: 'Not a valid developer key' };
    if (!this.isValidKeyFormat(key)) return { success: false, error: 'Invalid key format.' };
    this._save({
      key, machineId: this.getMachineFingerprint(),
      activatedAt: Date.now(), lastValidated: Date.now(),
      email: 'developer@graysoft.dev', plan: 'developer', expiresAt: null,
    });
    this.isActivated = true;
    return { success: true, message: 'Developer license activated locally.' };
  }

  /* ── Internal helpers ─────────────────────────────────────────── */

  _sanitize(d) {
    return {
      key: d.key ? d.key.substring(0, 10) + '...' : null,
      activatedAt: d.activatedAt || null, lastValidated: d.lastValidated || null,
      email: d.email || null, plan: d.plan || 'free',
      expiresAt: d.expiresAt || null, authMethod: d.authMethod || 'key',
    };
  }

  _save(data) {
    this.licenseData = data;
    this._writeSigned(this.licenseFile, data);
  }

  _httpsPost(hostPath, body) {
    return new Promise((resolve, reject) => {
      const json = JSON.stringify(body);
      const req = https.request({
        hostname: this.serverHost, port: 443, path: hostPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve({ success: false, error: 'Invalid server response' }); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(json);
      req.end();
    });
  }

  _validateOnline(key, machineId) {
    return this._httpsPost(this.serverPath, {
      key, machineId, platform: os.platform(),
      appVersion: require('../package.json').version,
    });
  }

  _authenticateOnline(email, password, machineId) {
    return this._httpsPost('/api/auth/login', {
      email, password, machineId, platform: os.platform(),
      appVersion: require('../package.json').version,
    });
  }

  _activateTokenOnline(token, machineId) {
    return this._httpsPost('/api/auth/activate-token', {
      token, machineId, platform: os.platform(),
      appVersion: require('../package.json').version,
    });
  }
}

module.exports = LicenseManager;
