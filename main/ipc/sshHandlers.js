/**
 * guIDE — AI-Powered Offline IDE
 * SSH Remote Development Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ssh2 is optional — degrade gracefully
let Client;
try {
  Client = require('ssh2').Client;
} catch {
  Client = null;
}

// ─── State ───
const connections = new Map(); // id → { conn, sftp, profile }
const CONFIG_DIR = path.join(os.homedir(), '.guide-ide');
const PROFILES_FILE = path.join(CONFIG_DIR, 'ssh-profiles.json');

function _ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function _loadProfiles() {
  _ensureConfigDir();
  if (!fs.existsSync(PROFILES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8')); }
  catch { return []; }
}

function _saveProfiles(profiles) {
  _ensureConfigDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

function _genId() {
  return 'ssh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function register(ctx) {
  // ── Check if SSH is available ──
  ipcMain.handle('ssh-available', async () => {
    return { available: !!Client };
  });

  // ── Save / Load Connection Profiles ──
  ipcMain.handle('ssh-get-profiles', async () => {
    try {
      return { success: true, profiles: _loadProfiles() };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('ssh-save-profile', async (_, profile) => {
    try {
      const profiles = _loadProfiles();
      const existing = profiles.findIndex(p => p.id === profile.id);
      if (existing >= 0) profiles[existing] = { ...profiles[existing], ...profile };
      else profiles.push({ ...profile, id: profile.id || _genId() });
      _saveProfiles(profiles);
      return { success: true, profiles };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('ssh-delete-profile', async (_, profileId) => {
    try {
      let profiles = _loadProfiles();
      profiles = profiles.filter(p => p.id !== profileId);
      _saveProfiles(profiles);
      return { success: true, profiles };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Connect ──
  ipcMain.handle('ssh-connect', async (_, params) => {
    if (!Client) return { success: false, error: 'ssh2 package not installed. Run: npm install ssh2' };
    const { host, port = 22, username, password, privateKey, privateKeyPath, passphrase } = params;

    return new Promise((resolve) => {
      const conn = new Client();
      const connId = _genId();
      let resolved = false;

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            resolved = true;
            return resolve({ success: false, error: `SFTP init failed: ${err.message}` });
          }
          connections.set(connId, { conn, sftp, profile: params });
          resolved = true;
          resolve({ success: true, connectionId: connId, host, username });
        });
      });

      conn.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err.message });
        }
      });

      conn.on('end', () => {
        connections.delete(connId);
      });

      // Build connection config
      const config = { host, port: parseInt(port) || 22, username };
      if (password) config.password = password;
      if (privateKey) {
        config.privateKey = privateKey;
      } else if (privateKeyPath) {
        try {
          const keyPath = privateKeyPath.replace(/^~/, os.homedir());
          config.privateKey = fs.readFileSync(keyPath, 'utf-8');
        } catch (e) {
          return resolve({ success: false, error: `Cannot read key file: ${e.message}` });
        }
      }
      if (passphrase) config.passphrase = passphrase;

      // Timeout
      config.readyTimeout = 15000;

      try { conn.connect(config); }
      catch (e) { resolve({ success: false, error: e.message }); }
    });
  });

  // ── Disconnect ──
  ipcMain.handle('ssh-disconnect', async (_, connectionId) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Connection not found' };
    try {
      entry.conn.end();
      connections.delete(connectionId);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── List directory (SFTP) ──
  ipcMain.handle('ssh-list-dir', async (_, connectionId, remotePath) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      entry.sftp.readdir(remotePath, (err, list) => {
        if (err) return resolve({ success: false, error: err.message });
        const items = list.map(item => ({
          name: item.filename,
          type: item.attrs.isDirectory() ? 'directory' : 'file',
          size: item.attrs.size,
          modified: new Date(item.attrs.mtime * 1000).toISOString(),
          permissions: item.attrs.mode ? ('0' + (item.attrs.mode & 0o777).toString(8)) : null,
        })).sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        resolve({ success: true, path: remotePath, items });
      });
    });
  });

  // ── Read file (SFTP) ──
  ipcMain.handle('ssh-read-file', async (_, connectionId, remotePath) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      const chunks = [];
      const stream = entry.sftp.createReadStream(remotePath, { encoding: 'utf-8' });
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve({
        success: true,
        content: chunks.join(''),
        path: remotePath,
        name: path.basename(remotePath),
      }));
      stream.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  });

  // ── Write file (SFTP) ──
  ipcMain.handle('ssh-write-file', async (_, connectionId, remotePath, content) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      const stream = entry.sftp.createWriteStream(remotePath);
      stream.on('close', () => resolve({ success: true, path: remotePath }));
      stream.on('error', (err) => resolve({ success: false, error: err.message }));
      stream.write(content, 'utf-8');
      stream.end();
    });
  });

  // ── Delete file/dir (SFTP) ──
  ipcMain.handle('ssh-delete', async (_, connectionId, remotePath, isDir) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      const cb = (err) => err ? resolve({ success: false, error: err.message }) : resolve({ success: true });
      if (isDir) entry.sftp.rmdir(remotePath, cb);
      else entry.sftp.unlink(remotePath, cb);
    });
  });

  // ── Rename / move (SFTP) ──
  ipcMain.handle('ssh-rename', async (_, connectionId, oldPath, newPath) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      entry.sftp.rename(oldPath, newPath, (err) => {
        err ? resolve({ success: false, error: err.message }) : resolve({ success: true });
      });
    });
  });

  // ── Mkdir (SFTP) ──
  ipcMain.handle('ssh-mkdir', async (_, connectionId, remotePath) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      entry.sftp.mkdir(remotePath, (err) => {
        err ? resolve({ success: false, error: err.message }) : resolve({ success: true });
      });
    });
  });

  // ── Execute command (SSH exec) ──
  ipcMain.handle('ssh-exec', async (_, connectionId, command) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      entry.conn.exec(command, (err, stream) => {
        if (err) return resolve({ success: false, error: err.message });
        let stdout = '', stderr = '';
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          resolve({ success: true, stdout, stderr, exitCode: code });
        });
      });
    });
  });

  // ── File stat (SFTP) ──
  ipcMain.handle('ssh-stat', async (_, connectionId, remotePath) => {
    const entry = connections.get(connectionId);
    if (!entry) return { success: false, error: 'Not connected' };

    return new Promise((resolve) => {
      entry.sftp.stat(remotePath, (err, stats) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({
          success: true,
          isDir: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          modified: new Date(stats.mtime * 1000).toISOString(),
          permissions: '0' + (stats.mode & 0o777).toString(8),
        });
      });
    });
  });

  // ── List active connections ──
  ipcMain.handle('ssh-list-connections', async () => {
    const active = [];
    for (const [id, entry] of connections) {
      active.push({
        id,
        host: entry.profile.host,
        username: entry.profile.username,
        port: entry.profile.port || 22,
      });
    }
    return { success: true, connections: active };
  });
}

module.exports = { register };
