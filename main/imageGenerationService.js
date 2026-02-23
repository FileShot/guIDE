/**
 * Image & Video Generation Service — generates images and videos via free cloud APIs.
 *
 * Image providers (priority order):
 * 1. Pollinations AI  — completely free, no API key needed, GET-based
 * 2. Google Gemini     — free tier with API key, high quality
 *
 * Video providers (via Pollinations gen.pollinations.ai — requires free API key):
 * - seedance (FREE) — BytePlus, text-to-video, 2-10s, best quality
 * - wan (FREE) — Alibaba, image-to-video + audio, 2-15s, up to 1080p
 * - grok-video (FREE) — xAI, text-to-video, alpha quality
 *
 * Image providers return { success, imageBase64, mimeType, prompt, provider, model }
 * Video providers return { success, videoBase64, mimeType, prompt, provider, model, duration }
 */
const https = require('https');
const http = require('http');

class ImageGenerationService {
  constructor() {
    this._providers = {
      pollinations: {
        label: 'Pollinations AI',
        model: 'flux',
        requiresKey: false,
      },
      google: {
        label: 'Google Gemini',
        model: 'gemini-2.0-flash-exp',
        requiresKey: true,
      },
    };

    // Video models (all on Pollinations gen.pollinations.ai, all FREE pollen-cost)
    this._videoModels = {
      seedance:    { label: 'Seedance Lite',  desc: 'BytePlus video (2–10s)', free: true },
      wan:         { label: 'Wan 2.6',        desc: 'Alibaba video+audio (2–15s, 1080p)', free: true },
      'grok-video':{ label: 'Grok Video',     desc: 'xAI video (alpha)', free: true },
    };

    // Pool of Google API keys (added via addKeyToPool)
    this._googleKeys = [];
    this._googleKeyIndex = 0;
    this._googleKeyCooldowns = {}; // { keyHash: cooldownUntilTimestamp }

    // Pool of Pollinations API keys (needed for video gen on gen.pollinations.ai)
    this._pollinationsKeys = [];
    this._pollinationsKeyIndex = 0;
    this._pollinationsKeyCooldowns = {}; // { keyHash: cooldownUntilTimestamp }

    // Local image gen: A1111/Forge (:7860) or ComfyUI (:8188)
    // Detected lazily on first generate() call, cached 60s
    this._localGenType = null; // 'a1111' | 'comfyui' | false
    this._localGenLastCheck = 0;
  }

  // ─── Key Management ──────────────────────────────────────────────
  addGoogleKey(key) {
    if (key && !this._googleKeys.includes(key)) {
      this._googleKeys.push(key);
    }
  }

  _getNextGoogleKey() {
    if (this._googleKeys.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this._googleKeys.length; i++) {
      const idx = (this._googleKeyIndex + i) % this._googleKeys.length;
      const key = this._googleKeys[idx];
      const hash = key.slice(-8);
      if (!this._googleKeyCooldowns[hash] || this._googleKeyCooldowns[hash] <= now) {
        this._googleKeyIndex = (idx + 1) % this._googleKeys.length;
        return key;
      }
    }
    // All keys on cooldown — use the next one anyway
    const key = this._googleKeys[this._googleKeyIndex];
    this._googleKeyIndex = (this._googleKeyIndex + 1) % this._googleKeys.length;
    return key;
  }

  _cooldownGoogleKey(key, durationMs = 60000) {
    const hash = key.slice(-8);
    this._googleKeyCooldowns[hash] = Date.now() + durationMs;
  }

  // ─── Pollinations API Key Management (for video gen) ─────────────
  addPollinationsKey(key) {
    if (key && !this._pollinationsKeys.includes(key)) {
      this._pollinationsKeys.push(key);
      console.log(`[ImageGen] Added Pollinations API key (pool: ${this._pollinationsKeys.length})`);
    }
  }

  _getNextPollinationsKey() {
    if (this._pollinationsKeys.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this._pollinationsKeys.length; i++) {
      const idx = (this._pollinationsKeyIndex + i) % this._pollinationsKeys.length;
      const key = this._pollinationsKeys[idx];
      const hash = key.slice(-8);
      if (!this._pollinationsKeyCooldowns[hash] || this._pollinationsKeyCooldowns[hash] <= now) {
        this._pollinationsKeyIndex = (idx + 1) % this._pollinationsKeys.length;
        return key;
      }
    }
    // All keys on cooldown — use the next one anyway
    const key = this._pollinationsKeys[this._pollinationsKeyIndex];
    this._pollinationsKeyIndex = (this._pollinationsKeyIndex + 1) % this._pollinationsKeys.length;
    return key;
  }

  _cooldownPollinationsKey(key, durationMs = 60000) {
    const hash = key.slice(-8);
    this._pollinationsKeyCooldowns[hash] = Date.now() + durationMs;
  }

  // ─── Main Generate Method ────────────────────────────────────────
  /**
   * Generate an image from a text prompt.
   * @param {string} prompt - Description of the image to generate
   * @param {object} options - { width, height, provider, style, negativePrompt }
   * @returns {{ success, imageBase64, mimeType, prompt, provider, model, error? }}
   */
  async generate(prompt, options = {}) {
    const width = options.width || 1024;
    const height = options.height || 1024;
    const preferredProvider = options.provider || null;

    // Detect local generators (A1111/Forge on :7860, ComfyUI on :8188).
    // Only runs once every 60s; zero overhead when nothing local is running.
    if (!preferredProvider || preferredProvider === 'local') {
      await this._refreshLocalGenType();
    }

    // Build provider order — local first (fast, private), then cloud fallbacks
    const providerOrder = [];
    if (preferredProvider && preferredProvider !== 'local') {
      providerOrder.push(preferredProvider);
    } else {
      if (this._localGenType === 'a1111') providerOrder.push('a1111');
      if (this._localGenType === 'comfyui') providerOrder.push('comfyui');
      providerOrder.push('pollinations');
      if (this._googleKeys.length > 0) providerOrder.push('google');
    }

    // Deduplicate
    const tried = new Set();
    for (const provider of providerOrder) {
      if (tried.has(provider)) continue;
      tried.add(provider);

      try {
        console.log(`[ImageGen] Trying ${provider} for: "${prompt.substring(0, 60)}..."`);
        let result;
        switch (provider) {
          case 'a1111':
            result = await this._generateA1111(prompt, width, height, options);
            break;
          case 'comfyui':
            result = await this._generateComfyUI(prompt, width, height, options);
            break;
          case 'pollinations':
            result = await this._generatePollinations(prompt, width, height, options);
            break;
          case 'google':
            result = await this._generateGemini(prompt, width, height, options);
            break;
          default:
            continue;
        }
        if (result && result.success) {
          console.log(`[ImageGen] Success via ${provider} (${(result.imageBase64.length / 1024).toFixed(0)}KB base64)`);
          return result;
        }
      } catch (err) {
        console.error(`[ImageGen] ${provider} failed:`, err.message);
        // Continue to next provider
      }
    }

    return {
      success: false,
      error: 'All image generation providers failed. Try again or check your network connection.',
      prompt,
    };
  }

  // ─── Local Image Gen Detection ───────────────────────────────────
  /**
   * Check once every 60s whether a local image gen server is running.
   * Checks A1111/Forge on :7860 first, then ComfyUI on :8188.
   * Zero installer impact — users who don't run these see a 2ms timeout and fall through.
   */
  async _refreshLocalGenType() {
    const now = Date.now();
    if (now - this._localGenLastCheck < 60000 && this._localGenType !== undefined) return;
    this._localGenLastCheck = now;

    const check = (port, path) => new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}${path}`, { timeout: 1500 }, (res) => {
        res.resume(); // drain
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    if (await check(7860, '/sdapi/v1/samplers')) {
      this._localGenType = 'a1111';
      console.log('[ImageGen] A1111/Forge detected on :7860');
    } else if (await check(8188, '/system_stats')) {
      this._localGenType = 'comfyui';
      console.log('[ImageGen] ComfyUI detected on :8188');
    } else {
      this._localGenType = false;
    }
  }

  /**
   * Generate via AUTOMATIC1111 / Stable Diffusion WebUI / Forge.
   * API: POST http://localhost:7860/sdapi/v1/txt2img
   * Zero install — user already has it running if we reach this path.
   */
  async _generateA1111(prompt, width, height, options) {
    const negPrompt = options.negativePrompt || 'ugly, blurry, watermark, text, low quality';
    const steps = options.steps || 20;
    const cfgScale = options.cfgScale || 7;
    const sampler = options.sampler || 'DPM++ 2M Karras';

    // Clamp to ×64 grid (A1111 requirement)
    const w = Math.round(Math.min(width,  1536) / 64) * 64 || 512;
    const h = Math.round(Math.min(height, 1536) / 64) * 64 || 512;

    const body = JSON.stringify({
      prompt,
      negative_prompt: negPrompt,
      width: w,
      height: h,
      steps,
      cfg_scale: cfgScale,
      sampler_name: sampler,
      batch_size: 1,
      n_iter: 1,
    });

    return new Promise((resolve, reject) => {
      const postOpts = {
        hostname: 'localhost',
        port: 7860,
        path: '/sdapi/v1/txt2img',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 180000,
      };
      let data = '';
      const req = http.request(postOpts, (res) => {
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const b64 = (parsed.images || [])[0];
            if (!b64) return reject(new Error('A1111 returned no images'));
            resolve({ success: true, imageBase64: b64, mimeType: 'image/png', prompt, provider: 'a1111', model: 'stable-diffusion' });
          } catch (e) { reject(new Error(`A1111 parse error: ${e.message}`)); }
        });
      });
      req.on('error', (e) => reject(new Error(`A1111 request failed: ${e.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('A1111 timed out after 180s')); });
      req.write(body);
      req.end();
    });
  }

  /**
   * Generate via ComfyUI.
   * Uses a minimal txt2img workflow — auto-selects first available checkpoint.
   * API: POST http://localhost:8188/prompt → poll GET /history/{id}
   */
  async _generateComfyUI(prompt, width, height, options) {
    // Step 1: get available checkpoints
    const getCheckpoint = () => new Promise((resolve, reject) => {
      http.get('http://localhost:8188/object_info/CheckpointLoaderSimple', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            const names = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
            resolve(names[0] || 'v1-5-pruned-emaonly.safetensors');
          } catch { resolve('v1-5-pruned-emaonly.safetensors'); }
        });
      }).on('error', reject).on('timeout', (req) => { req.destroy(); reject(new Error('timeout')); });
    });

    const ckpt = await getCheckpoint();
    const seed = Math.floor(Math.random() * 2 ** 32);
    const w = Math.round(Math.min(width,  1536) / 64) * 64 || 512;
    const h = Math.round(Math.min(height, 1536) / 64) * 64 || 512;

    const workflow = {
      '3': { inputs: { seed, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] }, class_type: 'KSampler' },
      '4': { inputs: { ckpt_name: ckpt }, class_type: 'CheckpointLoaderSimple' },
      '5': { inputs: { width: w, height: h, batch_size: 1 }, class_type: 'EmptyLatentImage' },
      '6': { inputs: { text: prompt, clip: ['4', 1] }, class_type: 'CLIPTextEncode' },
      '7': { inputs: { text: options.negativePrompt || 'ugly, blurry, low quality', clip: ['4', 1] }, class_type: 'CLIPTextEncode' },
      '8': { inputs: { samples: ['3', 0], vae: ['4', 2] }, class_type: 'VAEDecode' },
      '9': { inputs: { filename_prefix: 'guide_gen', images: ['8', 0] }, class_type: 'SaveImage' },
    };

    // Step 2: queue the prompt
    const queueBody = JSON.stringify({ prompt: workflow, client_id: 'guide' });
    const promptId = await new Promise((resolve, reject) => {
      const postOpts = {
        hostname: 'localhost', port: 8188, path: '/prompt', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(queueBody) },
        timeout: 10000,
      };
      let data = '';
      const req = http.request(postOpts, (res) => {
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data).prompt_id); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(queueBody);
      req.end();
    });

    // Step 3: poll /history until done (max 180s)
    const filename = await new Promise((resolve, reject) => {
      const deadline = Date.now() + 180000;
      const poll = () => {
        if (Date.now() > deadline) return reject(new Error('ComfyUI generation timed out'));
        http.get(`http://localhost:8188/history/${promptId}`, { timeout: 5000 }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const history = JSON.parse(data);
              const entry = history[promptId];
              if (!entry) return setTimeout(poll, 2000);
              const outputs = entry.outputs || {};
              for (const node of Object.values(outputs)) {
                const imgs = node.images || [];
                if (imgs.length > 0) return resolve(imgs[0].filename);
              }
              setTimeout(poll, 2000);
            } catch { setTimeout(poll, 2000); }
          });
        }).on('error', () => setTimeout(poll, 3000));
      };
      poll();
    });

    // Step 4: fetch the image
    return new Promise((resolve, reject) => {
      const chunks = [];
      http.get(`http://localhost:8188/view?filename=${encodeURIComponent(filename)}`, { timeout: 30000 }, (res) => {
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const b64 = Buffer.concat(chunks).toString('base64');
          resolve({ success: true, imageBase64: b64, mimeType: 'image/png', prompt, provider: 'comfyui', model: ckpt });
        });
      }).on('error', reject);
    });
  }

  // ─── Pollinations AI ─────────────────────────────────────────────
  /**
   * Pollinations AI — completely free, no API key.
   * GET https://image.pollinations.ai/prompt/{encodedPrompt}?width=W&height=H&model=flux&nologo=true
   * Returns raw image bytes (JPEG).
   */
  async _generatePollinations(prompt, width, height, options) {
    const encodedPrompt = encodeURIComponent(prompt);
    const model = options.pollinationsModel || 'flux';
    const seed = options.seed || Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${seed}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pollinations timeout (90s)')), 90000);

      const handleResponse = (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          const protocol = redirectUrl.startsWith('https') ? https : http;
          protocol.get(redirectUrl, handleResponse).on('error', (e) => {
            clearTimeout(timeout);
            reject(e);
          });
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          reject(new Error(`Pollinations HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          const buffer = Buffer.concat(chunks);
          if (buffer.length < 1000) {
            reject(new Error('Pollinations returned too-small response (likely error)'));
            return;
          }
          const base64 = buffer.toString('base64');
          const mimeType = res.headers['content-type'] || 'image/jpeg';
          resolve({
            success: true,
            imageBase64: base64,
            mimeType: mimeType.split(';')[0].trim(),
            prompt,
            provider: 'pollinations',
            model,
            width,
            height,
          });
        });
        res.on('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        });
      };

      https.get(url, handleResponse).on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  // ─── Google Gemini ────────────────────────────────────────────────
  /**
   * Google Gemini image generation — free tier with API key.
   * Uses gemini-2.0-flash-exp with responseModalities = ['IMAGE', 'TEXT']
   */
  async _generateGemini(prompt, width, height, options) {
    const apiKey = this._getNextGoogleKey();
    if (!apiKey) {
      throw new Error('No Google API keys available');
    }

    const body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: `Generate an image: ${prompt}` },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        responseMimeType: 'text/plain',
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Gemini image gen timeout (60s)')), 60000);

      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const data = JSON.parse(raw);
            if (res.statusCode === 429) {
              this._cooldownGoogleKey(apiKey, 60000);
              reject(new Error('Google rate limited (429)'));
              return;
            }
            if (res.statusCode !== 200) {
              reject(new Error(`Google API error ${res.statusCode}: ${raw.substring(0, 300)}`));
              return;
            }

            // Extract image from response
            const parts = data.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(p => p.inlineData);
            if (imagePart && imagePart.inlineData) {
              resolve({
                success: true,
                imageBase64: imagePart.inlineData.data,
                mimeType: imagePart.inlineData.mimeType || 'image/png',
                prompt,
                provider: 'google',
                model: 'gemini-2.0-flash-exp',
                width,
                height,
              });
            } else {
              // Gemini might have returned text only
              const textPart = parts.find(p => p.text);
              reject(new Error(`Gemini returned text only: ${(textPart?.text || 'empty').substring(0, 200)}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Gemini response: ${e.message}`));
          }
        });
        res.on('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        });
      });

      req.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });

      req.write(body);
      req.end();
    });
  }

  // ─── Video Generation ─────────────────────────────────────────────
  /**
   * Generate a video from a text prompt.
   * Uses Pollinations gen.pollinations.ai — requires free API key.
   * Free video models: seedance (best), wan (with audio), grok-video (alpha).
   * @param {string} prompt - Description of the video to generate
   * @param {object} options - { model, width, height }
   * @returns {{ success, videoBase64, mimeType, prompt, provider, model, duration, error? }}
   */
  async generateVideo(prompt, options = {}) {
    if (this._pollinationsKeys.length === 0) {
      return {
        success: false,
        error: 'Video generation requires a Pollinations API key. Get a free one at https://enter.pollinations.ai — then add it in Settings → Pollinations API Key.',
        prompt,
      };
    }

    const modelsToTry = [];
    const preferred = options.model || null;
    if (preferred && this._videoModels[preferred]) {
      modelsToTry.push(preferred);
    }
    // Default model order: seedance (best quality/free), veo (Google)
    for (const m of ['seedance', 'veo']) {
      if (!modelsToTry.includes(m)) modelsToTry.push(m);
    }

    for (const model of modelsToTry) {
      try {
        console.log(`[VideoGen] Trying model=${model} for: "${prompt.substring(0, 60)}..."`);
        const result = await this._generatePollinationsVideo(prompt, model, options);
        if (result && result.success) {
          console.log(`[VideoGen] Success via ${model} (${(result.videoBase64.length / 1024).toFixed(0)}KB base64)`);
          return result;
        }
      } catch (err) {
        console.error(`[VideoGen] ${model} failed:`, err.message);
        // Continue to next model
      }
    }

    return {
      success: false,
      error: 'All video generation models failed. The service may be busy — try again in a moment.',
      prompt,
    };
  }

  /**
   * Pollinations gen.pollinations.ai video generation.
   * Uses the same /image/{prompt} endpoint but with video model names.
   * Returns video/mp4 binary.
   */
  async _generatePollinationsVideo(prompt, model, options = {}) {
    const apiKey = this._getNextPollinationsKey();
    if (!apiKey) throw new Error('No Pollinations API keys available');

    const encodedPrompt = encodeURIComponent(prompt);
    const seed = options.seed || Math.floor(Math.random() * 1000000);
    // Parse duration from prompt (e.g. "10 second video") or use sensible defaults
    let duration = model === 'veo' ? 6 : 5; // default: 5s seedance, 6s veo
    const durMatch = prompt.match(/(\d+)\s*(?:second|sec|s)\b/i);
    if (durMatch) {
      const requested = parseInt(durMatch[1], 10);
      if (model === 'seedance') duration = Math.max(2, Math.min(10, requested));
      else if (model === 'veo') duration = [4, 6, 8].reduce((prev, curr) => Math.abs(curr - requested) < Math.abs(prev - requested) ? curr : prev);
      else duration = Math.max(2, Math.min(10, requested));
    }
    // Video URL — same path as image but with video model
    const urlPath = `/image/${encodedPrompt}?model=${model}&nologo=true&seed=${seed}&duration=${duration}`;

    return new Promise((resolve, reject) => {
      // Videos take longer — 3 minute timeout
      const timeout = setTimeout(() => reject(new Error(`Pollinations video timeout (180s) for model=${model}`)), 180000);

      const req = https.get({
        hostname: 'gen.pollinations.ai',
        path: urlPath,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'video/mp4, */*',
        },
        timeout: 180000,
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          const protocol = redirectUrl.startsWith('https') ? https : http;
          protocol.get(redirectUrl, { timeout: 180000 }, (redirRes) => {
            collectResponse(redirRes);
          }).on('error', (e) => {
            clearTimeout(timeout);
            reject(e);
          });
          return;
        }
        collectResponse(res);
      });

      const collectResponse = (res) => {
        if (res.statusCode === 401) {
          clearTimeout(timeout);
          reject(new Error('Pollinations API key invalid or expired. Get a key at https://enter.pollinations.ai'));
          return;
        }
        if (res.statusCode === 402) {
          clearTimeout(timeout);
          this._cooldownPollinationsKey(apiKey, 60000);
          reject(new Error('Pollinations pollen balance exhausted'));
          return;
        }
        if (res.statusCode === 429) {
          clearTimeout(timeout);
          this._cooldownPollinationsKey(apiKey, 30000);
          reject(new Error('Pollinations rate limited'));
          return;
        }
        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          // Collect error body
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8').substring(0, 500);
            reject(new Error(`Pollinations video HTTP ${res.statusCode}: ${body}`));
          });
          return;
        }

        const contentType = (res.headers['content-type'] || '').toLowerCase();
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          const buffer = Buffer.concat(chunks);
          if (buffer.length < 5000) {
            // Too small to be a real video — likely an error message
            const text = buffer.toString('utf8');
            reject(new Error(`Pollinations returned too-small video response (${buffer.length}B): ${text.substring(0, 200)}`));
            return;
          }

          const mimeType = contentType.includes('video') ? contentType.split(';')[0].trim() : 'video/mp4';
          const base64 = buffer.toString('base64');
          resolve({
            success: true,
            videoBase64: base64,
            mimeType,
            prompt,
            provider: 'pollinations',
            model,
            duration: `${duration || 5}s`,
          });
        });
        res.on('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        });
      };

      req.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      req.on('timeout', () => {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error(`Pollinations video connection timeout for model=${model}`));
      });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Detect if a user message is requesting image generation.
   * Returns { isImageRequest: boolean, extractedPrompt: string }
   */
  static detectImageRequest(message) {
    const lower = (message || '').toLowerCase();

    // Strong indicators — explicit image generation requests
    const strongPatterns = [
      /\b(generate|create|make|draw|paint|design|produce|render|sketch)\b.{0,40}\b(image|picture|photo|illustration|artwork|art|graphic|icon|logo|banner|poster|wallpaper|avatar|portrait|landscape|screenshot|mockup|diagram)\b/,
      /\b(image|picture|photo|illustration|artwork|art|graphic|icon|logo|banner|poster|wallpaper|avatar|portrait|landscape)\b.{0,40}\b(of|showing|depicting|with|featuring)\b/,
      /\bgenerate\s+(me\s+)?(an?\s+)?image\b/,
      /\bcreate\s+(me\s+)?(an?\s+)?image\b/,
      /\bmake\s+(me\s+)?(an?\s+)?image\b/,
      /\bdraw\s+(me\s+)?(an?\s+)?(image|picture|sketch|art)\b/,
      /\b(show|give)\s+me\s+(an?\s+)?(image|picture|photo)\b/,
      /\bimage\s+gen(eration)?\b/,
      /\btext[\s-]?to[\s-]?image\b/,
      /\bgener(ate|ating)\s+.{0,30}\b(pic(ture)?|img|visual)\b/,
      /\bgen\s+(me\s+)?(an?\s+)?(image|picture|photo|pic)\b/,
    ];

    // Weak indicators — might be requests but need more context
    const weakPatterns = [
      /\bdraw\s+(me\s+)?a\b/,
      /\bpaint\s+(me\s+)?a\b/,
      /\bvisualize\b/,
      /\billustrate\b/,
    ];

    // Negative patterns — these override and indicate NOT image gen
    const negativePatterns = [
      /\bdraw.*conclusion\b/,
      /\bpaint.*picture\s+of\s+the\s+situation\b/,
      /\bdraw\s+the\s+line\b/,
      /\bdesign\s+pattern\b/,
      /\bdesign\s+(a\s+)?(function|class|api|interface|system|architecture|database|schema)\b/,
      /\banalyze\s+(this\s+)?image\b/,
      /\bdescribe\s+(this\s+)?image\b/,
      /\bwhat.*in\s+this\s+image\b/,
      /\bwrite_file\b/,
      /\b(html|css|javascript|js|tsx?)\s+file\b/,
      /\b(html|css|javascript|js|tsx?)\/\w+/,
      /\bdo\s+not\s+use\b.*\bimages?\b/,
      /\b(don'?t|do\s+not)\s+(want|need)\b.{0,30}\bimages?\b/,
      /\bnot\s+an?\s+images?\b/,
      /\b(broken|missing|placeholder)\s+images?\b/,
      /\bimage\s+placeholder/,
      /\b(fix|edit|modify|update|change)\b.{0,40}\b(html|css|js|file|code|dashboard|page|site|website)\b/,
      /\b(edit|fix|modify|update)\s+(the\s+)?(weather|dashboard|page|component|card|section)\b/,
      /\bno\s+(cdns?|frameworks?|external|build\s+tools?)\b/,
      /\blanding[\s-]page\b.*\b(html|file|write)\b/,
    ];

    // Check negatives first
    for (const neg of negativePatterns) {
      if (neg.test(lower)) return { isImageRequest: false, extractedPrompt: '' };
    }

    // Check strong patterns
    for (const pat of strongPatterns) {
      if (pat.test(lower)) {
        const extracted = ImageGenerationService._extractPromptFromMessage(message);
        return { isImageRequest: true, extractedPrompt: extracted };
      }
    }

    // Check weak patterns — only if message is short (likely a direct request, not coding)
    if (lower.length < 200) {
      for (const pat of weakPatterns) {
        if (pat.test(lower)) {
          const extracted = ImageGenerationService._extractPromptFromMessage(message);
          return { isImageRequest: true, extractedPrompt: extracted };
        }
      }
    }

    return { isImageRequest: false, extractedPrompt: '' };
  }

  /**
   * Extract the image description from a natural language request.
   */
  static _extractPromptFromMessage(message) {
    // Remove common prefixes
    let prompt = message
      .replace(/^(please\s+)?/i, '')
      .replace(/^(can\s+you\s+)?/i, '')
      .replace(/^(could\s+you\s+)?/i, '')
      .replace(/^(would\s+you\s+)?/i, '')
      .replace(/^(generate|create|make|draw|paint|design|produce|render|sketch)\s+(me\s+)?(an?\s+)?/i, '')
      .replace(/^(image|picture|photo|illustration|artwork|graphic)\s+(of\s+)?/i, '')
      .replace(/^(show|give)\s+me\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '')
      .trim();

    // If prompt is very short after stripping, use the original message
    if (prompt.length < 5) prompt = message;

    return prompt;
  }

  /**
   * Detect if a user message is requesting video generation.
   * Returns { isVideoRequest: boolean, extractedPrompt: string } if detected.
   */
  static detectVideoRequest(message) {
    const lower = (message || '').toLowerCase();
    const patterns = [
      /\b(gen|generate|create|make|produce|render)\b.*\b(video|animation|clip|movie|film)\b/,
      /\btext[\s-]?to[\s-]?video\b/,
      /\bvideo\s+gen(eration)?\b/,
      /\banimate\b.*\b(image|scene|character)\b/,
      /\b(gen|make|create|generate)\s+(me\s+)?(a\s+)?(short\s+)?((\d+\s*-?\s*(second|sec|s|minute|min)\s+)?)?(video|clip|animation)\b/,
      /\bvideo\s+(of|showing|depicting|with)\b/,
    ];
    const isVideo = patterns.some(p => p.test(lower));
    if (!isVideo) return null;
    // Extract prompt similarly to image
    const extracted = ImageGenerationService._extractVideoPromptFromMessage(message);
    return { isVideoRequest: true, extractedPrompt: extracted };
  }

  /**
   * Extract the video description from a natural language request.
   */
  static _extractVideoPromptFromMessage(message) {
    let prompt = message
      .replace(/^(please\s+)?/i, '')
      .replace(/^(can\s+you\s+)?/i, '')
      .replace(/^(could\s+you\s+)?/i, '')
      .replace(/^(would\s+you\s+)?/i, '')
      .replace(/^(generate|create|make|produce|render)\s+(me\s+)?(a\s+)?(short\s+)?/i, '')
      .replace(/^(video|animation|clip|movie|film)\s+(of\s+)?/i, '')
      .replace(/^(show|give)\s+me\s+(a\s+)?(video|animation|clip)\s+(of\s+)?/i, '')
      .trim();
    if (prompt.length < 5) prompt = message;
    return prompt;
  }

  getStatus() {
    return {
      providers: Object.entries(this._providers).map(([id, p]) => ({
        id,
        label: p.label,
        model: p.model,
        available: id === 'pollinations' || this._googleKeys.length > 0,
      })),
      googleKeysCount: this._googleKeys.length,
      videoAvailable: this._pollinationsKeys.length > 0,
      pollinationsKeysCount: this._pollinationsKeys.length,
      videoModels: Object.entries(this._videoModels).map(([id, m]) => ({
        id,
        label: m.label,
        description: m.desc,
        free: m.free,
      })),
    };
  }
}

module.exports = { ImageGenerationService };
