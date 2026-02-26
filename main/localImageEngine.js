/**
 * guIDE Local Image Engine — wraps stable-diffusion.cpp binary
 *
 * Handles local image generation using GGUF-quantized Stable Diffusion /
 * SDXL / FLUX models via the stable-diffusion.cpp CLI binary bundled in
 * main/bin/<platform>/.
 *
 * Binary is automatically unpacked from ASAR via the "main/**" asarUnpack
 * entry in electron-builder config — no special path handling is required.
 *
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// ── Platform → binary path mapping ──────────────────────────────────────────
function getBinaryPath() {
  const platform = process.platform;
  const arch = process.arch;

  let subdir;
  let binaryName;

  if (platform === 'win32') {
    subdir = 'win-x64';
    binaryName = 'sd.exe';
  } else if (platform === 'darwin') {
    subdir = arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    binaryName = 'sd';
  } else {
    subdir = 'linux-x64';
    binaryName = 'sd';
  }

  // In production, main/ is inside app.asar but binaries are unpacked to
  // app.asar.unpacked/main/bin/. Replace the path segment to reach the real FS location.
  // This is the same pattern used by llmEngine.js and agenticChat.js.
  const baseDir = __dirname.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  return path.join(baseDir, 'bin', subdir, binaryName);
}

// ── LocalImageEngine ─────────────────────────────────────────────────────────
class LocalImageEngine extends EventEmitter {
  constructor() {
    super();
    this._activeProcess = null;
  }

  /**
   * Check whether the bundled binary exists and is executable.
   * @returns {{ available: boolean; binaryPath: string; error?: string }}
   */
  checkAvailability() {
    const binaryPath = getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return {
        available: false,
        binaryPath,
        error: `stable-diffusion.cpp binary not found at: ${binaryPath}`,
      };
    }
    return { available: true, binaryPath };
  }

  /**
   * Generate an image from a text prompt using a local GGUF diffusion model.
   *
   * @param {object} params
   * @param {string}  params.prompt        - Text prompt
   * @param {string}  params.modelPath     - Absolute path to the GGUF model file
   * @param {string}  [params.negativePrompt]  - Negative prompt (default: '')
   * @param {number}  [params.steps]       - Inference steps (default: 20)
   * @param {number}  [params.cfgScale]    - CFG scale (default: 7.0)
   * @param {number}  [params.width]       - Output width in pixels (default: 512)
   * @param {number}  [params.height]      - Output height in pixels (default: 512)
   * @param {number}  [params.seed]        - RNG seed, -1 for random (default: -1)
   * @param {string}  [params.backend]     - 'cpu' | 'cuda' | 'vulkan' (default: 'cpu')
   * @param {string}  [params.samplingMethod] - Sampling method (default: 'euler_a')
   * @param {function} [params.onProgress] - (current, total) progress callback
   *
   * @returns {Promise<{ success: boolean; imageBase64?: string; mimeType?: string; prompt?: string; error?: string }>}
   */
  async generate(params) {
    const {
      prompt,
      modelPath,
      negativePrompt = '',
      steps = 20,
      cfgScale = 7.0,
      width = 512,
      height = 512,
      seed = -1,
      backend = 'cpu',
      samplingMethod = 'euler_a',
      onProgress,
    } = params;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { success: false, error: 'No prompt provided.' };
    }
    if (!modelPath || typeof modelPath !== 'string') {
      return { success: false, error: 'No model path provided.' };
    }
    if (!fs.existsSync(modelPath)) {
      return { success: false, error: `Model file not found: ${modelPath}` };
    }

    // Verify binary
    const avail = this.checkAvailability();
    if (!avail.available) {
      return { success: false, error: avail.error };
    }

    // Write output to temp file
    const tempOutput = path.join(os.tmpdir(), `guide-img-${Date.now()}.png`);

    // Build args
    const args = [
      '--mode', 'img_gen',
      '--model', modelPath,
      '--prompt', prompt,
      '--output', tempOutput,
      '--steps', String(steps),
      '--cfg-scale', String(cfgScale),
      '--width', String(width),
      '--height', String(height),
      '--seed', String(seed),
      '--sampling-method', samplingMethod,
    ];

    if (negativePrompt) {
      args.push('--negative-prompt', negativePrompt);
    }

    // GPU backend flag
    if (backend === 'cuda') {
      args.push('--use-cuda');
    } else if (backend === 'vulkan') {
      args.push('--use-vulkan');
    }
    // CPU: no flag needed (default)

    console.log(`[LocalImageEngine] Spawning sd binary: ${avail.binaryPath}`);
    console.log(`[LocalImageEngine] Args: ${args.join(' ')}`);

    return new Promise((resolve) => {
      let stderr = '';
      let stdout = '';
      let timedOut = false;

      const child = spawn(avail.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this._activeProcess = child;

      // Parse progress from stderr (sd.cpp outputs "step X/N" lines)
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;

        // Parse: "  step X/Y, ..." or "step X/Y" or "[...] step X/Y"
        const stepMatch = text.match(/step\s+(\d+)\/(\d+)/i);
        if (stepMatch && onProgress) {
          const current = parseInt(stepMatch[1], 10);
          const total = parseInt(stepMatch[2], 10);
          try { onProgress(current, total); } catch {}
        }

        // Also emit as event for any listeners
        if (stepMatch) {
          this.emit('progress', {
            current: parseInt(stepMatch[1], 10),
            total: parseInt(stepMatch[2], 10),
          });
        }
      });

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      // Generous timeout — large models on CPU can take several minutes per image
      const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
        console.error('[LocalImageEngine] Timed out after 10 minutes');
        resolve({ success: false, error: 'Image generation timed out after 10 minutes. Try fewer steps, a smaller image size, or a faster backend.' });
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        this._activeProcess = null;
        clearTimeout(timeoutHandle);
        if (timedOut) return;

        if (code !== 0) {
          // Clean up temp file if it exists despite error
          try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch {}

          // Surface the most useful error message
          const errText = (stderr + '\n' + stdout).trim();
          const lastLine = errText.split('\n').filter(l => l.trim()).slice(-3).join(' | ');
          console.error(`[LocalImageEngine] Process exited with code ${code}: ${lastLine}`);
          return resolve({
            success: false,
            error: `Generation failed (exit code ${code}). ${lastLine ? `Details: ${lastLine}` : 'Check model compatibility with stable-diffusion.cpp.'}`,
          });
        }

        // Read the output image
        if (!fs.existsSync(tempOutput)) {
          return resolve({
            success: false,
            error: 'Binary ran successfully but no output image was created. The model may be incompatible.',
          });
        }

        try {
          const imageBuffer = fs.readFileSync(tempOutput);
          const imageBase64 = imageBuffer.toString('base64');

          // Clean up temp file
          try { fs.unlinkSync(tempOutput); } catch {}

          resolve({
            success: true,
            imageBase64,
            mimeType: 'image/png',
            prompt: prompt.trim(),
          });
        } catch (readErr) {
          try { if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch {}
          resolve({ success: false, error: `Failed to read output image: ${readErr.message}` });
        }
      });

      child.on('error', (err) => {
        this._activeProcess = null;
        clearTimeout(timeoutHandle);
        if (timedOut) return;
        console.error('[LocalImageEngine] Spawn error:', err.message);
        resolve({
          success: false,
          error: `Failed to start stable-diffusion binary: ${err.message}. Make sure the binary is present at: ${avail.binaryPath}`,
        });
      });
    });
  }

  /**
   * Cancel any active generation.
   */
  cancel() {
    if (this._activeProcess) {
      try { this._activeProcess.kill('SIGTERM'); } catch {}
      this._activeProcess = null;
    }
  }
}

module.exports = { LocalImageEngine };
