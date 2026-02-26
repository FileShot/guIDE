/**
 * firstRunSetup.js — Deferred CUDA backend download for guIDE.
 *
 * Runs in the background after the main window loads.
 * Detects NVIDIA GPUs, checks if CUDA backends are already present,
 * and silently downloads + extracts them if they are not.
 *
 * Download source: npm registry tarballs (always online, no custom CDN dependency).
 * Extraction target: app.asar.unpacked/node_modules/@node-llama-cpp/...
 *
 * Node-llama-cpp locates its backends by package name from node_modules — so placing
 * the extracted packages there is sufficient for it to pick them up on next launch.
 *
 * Zero npm dependencies — uses only Node built-ins: https, fs, os, path, child_process.
 */

'use strict';

const https = require('https');
const fs = require('fs');
const fsAsync = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile, exec } = require('child_process');
const { app } = require('electron');

// ── Version must match what's in node_modules ─────────────────────────────────
const NODE_LLAMA_CPP_VERSION = '3.15.1';
const CUDA_PACKAGES = [
  {
    name: '@node-llama-cpp/win-x64-cuda',
    tarball: `win-x64-cuda-${NODE_LLAMA_CPP_VERSION}.tgz`,
    url: `https://registry.npmjs.org/@node-llama-cpp/win-x64-cuda/-/win-x64-cuda-${NODE_LLAMA_CPP_VERSION}.tgz`,
    sizeMB: 134,
  },
  {
    name: '@node-llama-cpp/win-x64-cuda-ext',
    tarball: `win-x64-cuda-ext-${NODE_LLAMA_CPP_VERSION}.tgz`,
    url: `https://registry.npmjs.org/@node-llama-cpp/win-x64-cuda-ext/-/win-x64-cuda-ext-${NODE_LLAMA_CPP_VERSION}.tgz`,
    sizeMB: 430,
  },
];

// ── Resolve the unpacked node_modules dir at runtime ─────────────────────────
function getUnpackedNodeModules() {
  if (!app.isPackaged) return null; // dev — packages already in node_modules
  // process.resourcesPath = e.g. C:\...\guIDE\resources
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
}

// ── Check if a given package's binaries are already present ──────────────────
function isCudaPackagePresent(nodeModulesDir, packageName) {
  try {
    const pkgDir = path.join(nodeModulesDir, ...packageName.split('/'));
    const binsDir = path.join(pkgDir, 'bins');
    if (!fs.existsSync(binsDir)) return false;
    // Count real files — if >2 DLLs or .node files exist it's a real install
    const files = fs.readdirSync(binsDir, { recursive: true });
    const binaryFiles = files.filter(f => /\.(dll|node|so)$/i.test(f.toString()));
    return binaryFiles.length > 2;
  } catch {
    return false;
  }
}

// ── State file — skip if we already ran successfully ─────────────────────────
function getStateFilePath() {
  return path.join(app.getPath('userData'), 'cuda-setup-state.json');
}

function isSetupComplete() {
  try {
    const state = JSON.parse(fs.readFileSync(getStateFilePath(), 'utf8'));
    return state.complete === true && state.version === NODE_LLAMA_CPP_VERSION;
  } catch {
    return false;
  }
}

function markSetupComplete() {
  try {
    fs.writeFileSync(getStateFilePath(), JSON.stringify({
      complete: true,
      version: NODE_LLAMA_CPP_VERSION,
      completedAt: new Date().toISOString(),
    }), 'utf8');
  } catch { /* non-fatal */ }
}

// ── NVIDIA GPU detection ──────────────────────────────────────────────────────
function detectNvidiaGPU() {
  return new Promise((resolve) => {
    // Primary: nvidia-smi (most reliable)
    execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout && stdout.trim().length > 0) {
        resolve({ found: true, name: stdout.trim().split('\n')[0].trim() });
        return;
      }
      // Fallback: check for nvcuda.dll in System32 (present on any CUDA-capable system)
      const cudaDll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvcuda.dll');
      if (fs.existsSync(cudaDll)) {
        resolve({ found: true, name: 'NVIDIA GPU (detected via nvcuda.dll)' });
        return;
      }
      // Fallback 2: check Windows registry for NVIDIA display driver
      exec('reg query "HKLM\\SOFTWARE\\NVIDIA Corporation\\Global" /v "DisplayDriverVersion" 2>nul', { timeout: 3000 }, (regErr, regOut) => {
        if (!regErr && regOut && regOut.includes('DisplayDriverVersion')) {
          resolve({ found: true, name: 'NVIDIA GPU (detected via registry)' });
        } else {
          resolve({ found: false, name: null });
        }
      });
    });
  });
}

// ── HTTP(S) download with redirect following and progress callback ────────────
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const attemptDownload = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

      const urlObj = new URL(currentUrl);
      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: { 'User-Agent': 'guIDE-Setup/1.0' },
      };

      https.get(reqOptions, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          res.resume();
          attemptDownload(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
          res.resume();
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const writeStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes > 0) {
            onProgress(Math.round((downloadedBytes / totalBytes) * 100), downloadedBytes, totalBytes);
          }
        });

        res.pipe(writeStream);
        writeStream.on('finish', () => writeStream.close(() => resolve()));
        writeStream.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };

    attemptDownload(url);
  });
}

// ── Extract npm tarball using Windows' built-in tar.exe ──────────────────────
// npm tarballs have a `package/` prefix - use --strip-components=1 to remove it.
function extractTarball(tgzPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // Windows tar.exe ships with Win10 1803+. The -z flag is handled implicitly by tar.
    const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const tarArgs = ['-xzf', tgzPath, '--strip-components=1', '-C', destDir];

    execFile(tarExe, tarArgs, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`tar extraction failed: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

// ── Notify the renderer via IPC ───────────────────────────────────────────────
function notifyStatus(mainWindow, message, state = 'cuda-setup') {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('llm-status', { state, message });
    }
  } catch { /* non-fatal */ }
}

// ── Main entry point ──────────────────────────────────────────────────────────
/**
 * @param {Electron.BrowserWindow} mainWindow
 * @param {{ userDataPath: string }} opts
 */
async function runFirstRunSetup(mainWindow, opts) {
  // Dev mode: packages are right there in node_modules, nothing to do
  if (!app.isPackaged) {
    console.log('[FirstRun] Dev mode — skipping CUDA setup (packages already in node_modules)');
    return;
  }

  // Only Windows x64 needs this
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    console.log(`[FirstRun] Platform ${process.platform}/${process.arch} — skipping CUDA setup`);
    return;
  }

  const nodeModulesDir = getUnpackedNodeModules();
  if (!nodeModulesDir) return;

  // Check if both packages are already present (e.g. prior installation where CUDA was bundled)
  const allPresent = CUDA_PACKAGES.every(pkg => isCudaPackagePresent(nodeModulesDir, pkg.name));
  if (allPresent) {
    console.log('[FirstRun] CUDA backends already present — skipping download');
    markSetupComplete();
    return;
  }

  // Check state file — already ran successfully
  if (isSetupComplete()) {
    console.log('[FirstRun] Setup already completed (state file) — skipping');
    return;
  }

  // Detect NVIDIA GPU
  console.log('[FirstRun] Checking for NVIDIA GPU...');
  let gpuInfo;
  try {
    gpuInfo = await detectNvidiaGPU();
  } catch (e) {
    console.log('[FirstRun] GPU detection error:', e.message);
    gpuInfo = { found: false };
  }

  if (!gpuInfo.found) {
    console.log('[FirstRun] No NVIDIA GPU detected — skipping CUDA download');
    markSetupComplete(); // Don't keep checking on every launch
    return;
  }

  console.log(`[FirstRun] NVIDIA GPU found: ${gpuInfo.name} — downloading CUDA backends...`);
  notifyStatus(mainWindow, `GPU found (${gpuInfo.name}). Downloading GPU acceleration in the background… You can use cloud AI while this completes.`);

  // Use system temp dir for downloads
  const tempDir = path.join(os.tmpdir(), 'guide-cuda-setup');
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch { /* ignore */ }

  const totalMB = CUDA_PACKAGES.reduce((acc, p) => acc + p.sizeMB, 0);
  let completedMB = 0;

  for (const pkg of CUDA_PACKAGES) {
    const tgzPath = path.join(tempDir, pkg.tarball);
    const destDir = path.join(nodeModulesDir, ...pkg.name.split('/'));

    // Skip if this specific package is already present
    if (isCudaPackagePresent(nodeModulesDir, pkg.name)) {
      console.log(`[FirstRun] ${pkg.name} already present — skipping`);
      completedMB += pkg.sizeMB;
      continue;
    }

    // Download
    console.log(`[FirstRun] Downloading ${pkg.name} (${pkg.sizeMB} MB)...`);
    notifyStatus(mainWindow, `Downloading GPU backend: ${pkg.name.split('/')[1]} (${pkg.sizeMB} MB)… ${Math.round((completedMB / totalMB) * 100)}% overall`);

    try {
      await downloadFile(pkg.url, tgzPath, (pct) => {
        const pkgProgress = (pct / 100) * pkg.sizeMB;
        const overall = Math.round(((completedMB + pkgProgress) / totalMB) * 100);
        if (overall % 5 === 0) { // Report every 5%
          notifyStatus(mainWindow, `Downloading GPU backends: ${overall}% (${completedMB + Math.round(pkgProgress)} / ${totalMB} MB)…`);
        }
      });
    } catch (downloadErr) {
      console.error(`[FirstRun] Download failed for ${pkg.name}:`, downloadErr.message);
      notifyStatus(mainWindow, `GPU backend download failed: ${downloadErr.message}. Local GPU models unavailable — cloud AI is fully functional.`, 'warning');
      // Clean up partial download
      try { fs.unlinkSync(tgzPath); } catch { /* ignore */ }
      return; // Don't try to extract partial download
    }

    // Extract
    console.log(`[FirstRun] Extracting ${pkg.tarball} → ${destDir}...`);
    notifyStatus(mainWindow, `Installing GPU backend: ${pkg.name.split('/')[1]}…`);

    try {
      await extractTarball(tgzPath, destDir);
      console.log(`[FirstRun] Extracted ${pkg.name} successfully`);
    } catch (extractErr) {
      console.error(`[FirstRun] Extraction failed for ${pkg.name}:`, extractErr.message);
      notifyStatus(mainWindow, `GPU backend install failed: ${extractErr.message}. Cloud AI is fully functional.`, 'warning');
      return;
    }

    // Clean up tarball to save disk space
    try { fs.unlinkSync(tgzPath); } catch { /* ignore */ }
    completedMB += pkg.sizeMB;
  }

  // Clean up temp dir
  try { fs.rmdirSync(tempDir, { recursive: true }); } catch { /* ignore */ }

  markSetupComplete();
  console.log('[FirstRun] CUDA setup complete. GPU acceleration will be active on next launch.');
  notifyStatus(mainWindow,
    `✓ GPU acceleration ready (${gpuInfo.name}). Restart guIDE to enable local GPU models.`,
    'cuda-ready'
  );
}

module.exports = { runFirstRunSetup };
