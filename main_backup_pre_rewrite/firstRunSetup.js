'use strict';
/**
 * First-Run CUDA Setup — background CUDA backend download
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Detects NVIDIA GPUs, downloads @node-llama-cpp CUDA packages from npm,
 * extracts with system tar.exe. Falls back to userData if install dir is read-only.
 */

const https          = require('https');
const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { execFile, exec } = require('child_process');
const { app }        = require('electron');

/* ── version ────────────────────────────────────────────────────── */

function resolveNodeLlamaCppVersion() {
  if (app.isPackaged) {
    try {
      const p = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-llama-cpp', 'package.json');
      const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
      if (v) return v;
    } catch {}
  }
  try {
    const p = require.resolve('node-llama-cpp/package.json');
    const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
    if (v) return v;
  } catch {}
  return '3.17.1';
}

const VER = resolveNodeLlamaCppVersion();
const PACKAGES = [
  { name: '@node-llama-cpp/win-x64-cuda',     sizeMB: 134,
    url: `https://registry.npmjs.org/@node-llama-cpp/win-x64-cuda/-/win-x64-cuda-${VER}.tgz` },
  { name: '@node-llama-cpp/win-x64-cuda-ext',  sizeMB: 430,
    url: `https://registry.npmjs.org/@node-llama-cpp/win-x64-cuda-ext/-/win-x64-cuda-ext-${VER}.tgz` },
];

/* ── helpers ────────────────────────────────────────────────────── */

function getUnpackedNodeModules() {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
}

function isCudaPresent(nodeModulesDir, pkgName) {
  const dirs = [];
  if (nodeModulesDir) dirs.push(nodeModulesDir);
  try { const ud = path.join(app.getPath('userData'), 'cuda-modules', 'node_modules'); if (ud !== nodeModulesDir) dirs.push(ud); } catch {}
  for (const dir of dirs) {
    try {
      const pkgDir = path.join(dir, ...pkgName.split('/'));
      const bins   = path.join(pkgDir, 'bins');
      if (!fs.existsSync(bins)) continue;
      try { if (JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version !== VER) continue; } catch { continue; }
      const files = fs.readdirSync(bins, { recursive: true });
      if (files.filter(f => /\.(dll|node|so)$/i.test(f.toString())).length > 2) return true;
    } catch { continue; }
  }
  return false;
}

function getStatePath() { return path.join(app.getPath('userData'), 'cuda-setup-state.json'); }

function isSetupComplete() {
  try {
    const s = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
    if (s.complete !== true || s.version !== VER) return false;
    const nm = getUnpackedNodeModules();
    if (!PACKAGES.every(p => isCudaPresent(nm, p.name))) return false;
    if (s.userDataModulesPath) {
      if (!PACKAGES.every(p => fs.existsSync(path.join(s.userDataModulesPath, ...p.name.split('/'), 'bins')))) return false;
    }
    return true;
  } catch { return false; }
}

function markComplete(udDir) {
  try {
    const anyUD = udDir && PACKAGES.some(p => { try { return fs.existsSync(path.join(udDir, ...p.name.split('/'), 'bins')); } catch { return false; } });
    fs.writeFileSync(getStatePath(), JSON.stringify({
      complete: true, version: VER, completedAt: new Date().toISOString(),
      userDataModulesPath: anyUD ? udDir : null,
    }), 'utf8');
  } catch {}
}

/* ── GPU detection ──────────────────────────────────────────────── */

function detectNvidiaGPU() {
  return new Promise(resolve => {
    execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout?.trim()) return resolve({ found: true, name: stdout.trim().split('\n')[0].trim() });
      const dll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvcuda.dll');
      if (fs.existsSync(dll)) return resolve({ found: true, name: 'NVIDIA GPU (nvcuda.dll)' });
      exec('reg query "HKLM\\SOFTWARE\\NVIDIA Corporation\\Global" /v "DisplayDriverVersion" 2>nul', { timeout: 3000 }, (e2, o2) => {
        resolve((!e2 && o2?.includes('DisplayDriverVersion')) ? { found: true, name: 'NVIDIA GPU (registry)' } : { found: false, name: null });
      });
    });
  });
}

/* ── download + extract ─────────────────────────────────────────── */

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const attempt = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const parsed = new URL(u);
      https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'guIDE-Setup/1.0' } }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode)) { res.resume(); return attempt(res.headers.location, redirects + 1); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const total = +(res.headers['content-length'] || 0);
        let got = 0;
        const ws = fs.createWriteStream(dest);
        res.on('data', c => { got += c.length; if (onProgress && total) onProgress(Math.round(got / total * 100), got, total); });
        res.pipe(ws);
        ws.on('finish', () => ws.close(() => resolve()));
        ws.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    attempt(url);
  });
}

function extract(tgz, destDir) {
  return new Promise((resolve, reject) => {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) { return reject(e); }
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFile(tar, ['-xzf', tgz, '--strip-components=1', '-C', destDir], { timeout: 120000 }, (e, _, se) => {
      e ? reject(new Error(`tar failed: ${se || e.message}`)) : resolve();
    });
  });
}

/* ── consolidate split packages ─────────────────────────────────── */

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    entry.isDirectory() ? copyDirRecursive(s, d) : fs.copyFileSync(s, d);
  }
}

function consolidateToUserData(nmDir, udDir) {
  const anyUD = PACKAGES.some(p => { try { return fs.existsSync(path.join(udDir, ...p.name.split('/'), 'bins')); } catch { return false; } });
  if (!anyUD) return false;
  for (const pkg of PACKAGES) {
    const udBins = path.join(udDir, ...pkg.name.split('/'), 'bins');
    if (fs.existsSync(udBins)) continue;
    const instDir = path.join(nmDir, ...pkg.name.split('/'));
    if (fs.existsSync(path.join(instDir, 'bins'))) {
      try { copyDirRecursive(instDir, path.join(udDir, ...pkg.name.split('/'))); } catch {}
    }
  }
  return true;
}

/* ── notify renderer ────────────────────────────────────────────── */

function notify(win, msg, state = 'cuda-setup') {
  try { if (win && !win.isDestroyed()) win.webContents.send('llm-status', { state, message: msg }); } catch {}
}

/* ── main entry ─────────────────────────────────────────────────── */

async function runFirstRunSetup(mainWindow) {
  if (!app.isPackaged) { console.log('[FirstRun] Dev mode — skip CUDA'); return; }
  if (process.platform !== 'win32' || process.arch !== 'x64') { console.log('[FirstRun] Not win-x64 — skip CUDA'); return; }

  const nmDir = getUnpackedNodeModules();
  if (!nmDir) return;
  const udDir = path.join(app.getPath('userData'), 'cuda-modules', 'node_modules');

  if (isSetupComplete()) { console.log('[FirstRun] Already complete'); return; }

  // Check if all present (possibly from prior install)
  if (PACKAGES.every(p => isCudaPresent(nmDir, p.name))) {
    const anyUD = consolidateToUserData(nmDir, udDir);
    markComplete(anyUD ? udDir : null);
    return;
  }

  // Detect GPU
  let gpu;
  try { gpu = await detectNvidiaGPU(); } catch { gpu = { found: false }; }
  if (!gpu.found) { markComplete(null); return; }

  console.log(`[FirstRun] GPU: ${gpu.name} — downloading CUDA backends`);
  notify(mainWindow, `GPU found (${gpu.name}). Downloading GPU acceleration in the background…`);

  const tmpDir = path.join(os.tmpdir(), 'guide-cuda-setup');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

  const totalMB = PACKAGES.reduce((a, p) => a + p.sizeMB, 0);
  let doneMB = 0;

  for (const pkg of PACKAGES) {
    const tgz      = path.join(tmpDir, path.basename(pkg.url));
    const primary  = path.join(nmDir, ...pkg.name.split('/'));
    const fallback = path.join(udDir, ...pkg.name.split('/'));

    if (isCudaPresent(nmDir, pkg.name)) { doneMB += pkg.sizeMB; continue; }

    notify(mainWindow, `Downloading ${pkg.name.split('/')[1]} (${pkg.sizeMB} MB)… ${Math.round(doneMB / totalMB * 100)}% overall`);
    try {
      await download(pkg.url, tgz, pct => {
        const overall = Math.round((doneMB + pct / 100 * pkg.sizeMB) / totalMB * 100);
        if (overall % 5 === 0) notify(mainWindow, `Downloading GPU backends: ${overall}%`);
      });
    } catch (e) {
      notify(mainWindow, `Download failed: ${e.message}. Cloud AI is fully functional.`, 'warning');
      try { fs.unlinkSync(tgz); } catch {}
      return;
    }

    notify(mainWindow, `Installing ${pkg.name.split('/')[1]}…`);
    let landed = null;
    try { await extract(tgz, primary); landed = 'primary'; } catch (e) {
      const perm = e.code === 'EPERM' || e.code === 'EACCES' || /EPERM|EACCES|operation not permitted/i.test(e.message);
      if (perm) {
        try { await extract(tgz, fallback); landed = 'userData'; } catch (e2) {
          notify(mainWindow, `Install failed: ${e2.message}`, 'warning');
          try { fs.unlinkSync(tgz); } catch {}
          return;
        }
      } else {
        notify(mainWindow, `Install failed: ${e.message}`, 'warning');
        try { fs.unlinkSync(tgz); } catch {}
        return;
      }
    }
    try { fs.unlinkSync(tgz); } catch {}
    doneMB += pkg.sizeMB;
  }

  try { fs.rmdirSync(tmpDir, { recursive: true }); } catch {}
  consolidateToUserData(nmDir, udDir);
  markComplete(udDir);
  console.log('[FirstRun] CUDA setup complete');
  notify(mainWindow, `GPU acceleration ready (${gpu.name}). Restart guIDE to enable local GPU models.`, 'cuda-ready');
}

module.exports = { runFirstRunSetup };
