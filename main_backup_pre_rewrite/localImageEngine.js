/**
 * guIDE — Local Image Engine
 *
 * Spawns the bundled stable-diffusion.cpp binary to generate images from
 * GGUF-quantized Stable Diffusion / SDXL / FLUX models. Binary is auto-
 * unpacked from ASAR via electron-builder's asarUnpack config.
 *
 * Path: main/bin/<platform>/sd[.exe]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const log = require('./logger');

/* ── Binary path resolution ──────────────────────────────────────── */

function _getBinaryPath() {
  const plat = process.platform;
  const arch = process.arch;
  let subdir, name;

  if (plat === 'win32')       { subdir = 'win-x64';  name = 'sd.exe'; }
  else if (plat === 'darwin') { subdir = arch === 'arm64' ? 'mac-arm64' : 'mac-x64'; name = 'sd'; }
  else                        { subdir = 'linux-x64'; name = 'sd'; }

  // ASAR-aware: swap app.asar → app.asar.unpacked to reach real FS
  const base = __dirname.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  return path.join(base, 'bin', subdir, name);
}

/* ── LocalImageEngine ────────────────────────────────────────────── */

class LocalImageEngine extends EventEmitter {
  constructor() {
    super();
    this._activeProcess = null;
  }

  checkAvailability() {
    const binaryPath = _getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return { available: false, binaryPath, error: `sd binary not found at: ${binaryPath}` };
    }
    return { available: true, binaryPath };
  }

  async generate(params) {
    const {
      prompt, modelPath,
      negativePrompt = '', steps = 20, cfgScale = 7.0,
      width = 512, height = 512, seed = -1,
      backend = 'cpu', samplingMethod = 'euler_a',
      onProgress,
    } = params;

    if (!prompt?.trim()) return { success: false, error: 'No prompt provided.' };
    if (!modelPath)      return { success: false, error: 'No model path provided.' };
    if (!fs.existsSync(modelPath)) return { success: false, error: `Model not found: ${modelPath}` };

    const avail = this.checkAvailability();
    if (!avail.available) return { success: false, error: avail.error };

    const tmpOut = path.join(os.tmpdir(), `guide-img-${Date.now()}.png`);

    const args = [
      '--mode', 'img_gen',
      '--model', modelPath,
      '--prompt', prompt,
      '--output', tmpOut,
      '--steps', String(steps),
      '--cfg-scale', String(cfgScale),
      '--width', String(width),
      '--height', String(height),
      '--seed', String(seed),
      '--sampling-method', samplingMethod,
    ];
    if (negativePrompt) args.push('--negative-prompt', negativePrompt);
    if (backend === 'cuda')   args.push('--use-cuda');
    if (backend === 'vulkan') args.push('--use-vulkan');

    log.info('LocalImage', `Spawning: ${avail.binaryPath}`);

    return new Promise((resolve) => {
      let stderr = '', timedOut = false;

      const child = spawn(avail.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this._activeProcess = child;

      child.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        const m = text.match(/step\s+(\d+)\/(\d+)/i);
        if (m) {
          const cur = +m[1], total = +m[2];
          try { onProgress?.(cur, total); } catch {}
          this.emit('progress', { current: cur, total });
        }
      });

      child.stdout.on('data', chunk => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
        resolve({ success: false, error: 'Image generation timed out after 10 minutes.' });
      }, 10 * 60 * 1000);

      child.on('close', code => {
        this._activeProcess = null;
        clearTimeout(timer);
        if (timedOut) return;

        if (code !== 0) {
          try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
          const tail = stderr.split('\n').filter(l => l.trim()).slice(-3).join(' | ');
          return resolve({ success: false, error: `Generation failed (exit ${code}). ${tail}` });
        }

        if (!fs.existsSync(tmpOut)) {
          return resolve({ success: false, error: 'Binary succeeded but no output image created.' });
        }

        try {
          const b64 = fs.readFileSync(tmpOut).toString('base64');
          try { fs.unlinkSync(tmpOut); } catch {}
          resolve({ success: true, imageBase64: b64, mimeType: 'image/png', prompt: prompt.trim() });
        } catch (e) {
          try { fs.unlinkSync(tmpOut); } catch {}
          resolve({ success: false, error: `Failed to read output: ${e.message}` });
        }
      });

      child.on('error', err => {
        this._activeProcess = null;
        clearTimeout(timer);
        if (timedOut) return;
        resolve({ success: false, error: `Failed to start sd binary: ${err.message}` });
      });
    });
  }

  cancel() {
    if (this._activeProcess) {
      try { this._activeProcess.kill('SIGTERM'); } catch {}
      this._activeProcess = null;
    }
  }
}

module.exports = { LocalImageEngine };
