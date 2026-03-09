'use strict';
/**
 * Image & Video Generation Service
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Image providers: Pollinations (free), Google Gemini, A1111/Forge, ComfyUI
 * Video providers: Pollinations gen.pollinations.ai (seedance, wan, grok-video)
 */

const https = require('https');
const http  = require('http');

class ImageGenerationService {
  constructor() {
    this._providers = {
      pollinations: { label: 'Pollinations AI', model: 'flux', requiresKey: false },
      google:       { label: 'Google Gemini',   model: 'gemini-2.0-flash-exp', requiresKey: true },
    };
    this._videoModels = {
      seedance:      { label: 'Seedance Lite', desc: 'BytePlus (2-10s)', free: true },
      wan:           { label: 'Wan 2.6',       desc: 'Alibaba (2-15s, 1080p)', free: true },
      'grok-video':  { label: 'Grok Video',    desc: 'xAI (alpha)', free: true },
    };
    this._googleKeys = []; this._googleKeyIndex = 0; this._googleKeyCooldowns = {};
    this._pollinationsKeys = []; this._pollinationsKeyIndex = 0; this._pollinationsKeyCooldowns = {};
    this._localGenType = null; this._localGenLastCheck = 0;
  }

  /* ── Key pools ────────────────────────────────────────────────── */

  addGoogleKey(k) { if (k && !this._googleKeys.includes(k)) this._googleKeys.push(k); }
  addPollinationsKey(k) { if (k && !this._pollinationsKeys.includes(k)) this._pollinationsKeys.push(k); }

  _nextKey(keys, idx, cooldowns) {
    if (!keys.length) return [null, idx];
    const now = Date.now();
    for (let i = 0; i < keys.length; i++) {
      const j = (idx + i) % keys.length;
      const h = keys[j].slice(-8);
      if (!cooldowns[h] || cooldowns[h] <= now) return [keys[j], (j + 1) % keys.length];
    }
    return [keys[idx], (idx + 1) % keys.length];
  }

  _getNextGoogleKey() {
    const [k, i] = this._nextKey(this._googleKeys, this._googleKeyIndex, this._googleKeyCooldowns);
    this._googleKeyIndex = i; return k;
  }
  _cooldownGoogleKey(k, ms = 60000) { this._googleKeyCooldowns[k.slice(-8)] = Date.now() + ms; }

  _getNextPollinationsKey() {
    const [k, i] = this._nextKey(this._pollinationsKeys, this._pollinationsKeyIndex, this._pollinationsKeyCooldowns);
    this._pollinationsKeyIndex = i; return k;
  }
  _cooldownPollinationsKey(k, ms = 60000) { this._pollinationsKeyCooldowns[k.slice(-8)] = Date.now() + ms; }

  /* ── Main generate ────────────────────────────────────────────── */

  async generate(prompt, options = {}) {
    const width = options.width || 1024, height = options.height || 1024;
    const pref = options.provider || null;

    if (!pref || pref === 'local') await this._refreshLocalGen();

    const order = [];
    if (pref && pref !== 'local') { order.push(pref); }
    else {
      if (this._localGenType === 'a1111') order.push('a1111');
      if (this._localGenType === 'comfyui') order.push('comfyui');
      order.push('pollinations');
      if (this._googleKeys.length) order.push('google');
    }

    const tried = new Set();
    for (const p of order) {
      if (tried.has(p)) continue; tried.add(p);
      try {
        let r;
        switch (p) {
          case 'a1111':       r = await this._genA1111(prompt, width, height, options); break;
          case 'comfyui':     r = await this._genComfyUI(prompt, width, height, options); break;
          case 'pollinations': r = await this._genPollinations(prompt, width, height, options); break;
          case 'google':      r = await this._genGemini(prompt, width, height, options); break;
          default: continue;
        }
        if (r?.success) return r;
      } catch (e) { console.error(`[ImageGen] ${p} failed:`, e.message); }
    }
    return { success: false, error: 'All image providers failed.', prompt };
  }

  /* ── Local gen detection ──────────────────────────────────────── */

  async _refreshLocalGen() {
    if (Date.now() - this._localGenLastCheck < 60000 && this._localGenType !== undefined) return;
    this._localGenLastCheck = Date.now();
    const probe = (port, p) => new Promise(r => {
      const req = http.get(`http://localhost:${port}${p}`, { timeout: 1500 }, res => { res.resume(); r(res.statusCode === 200); });
      req.on('error', () => r(false)); req.on('timeout', () => { req.destroy(); r(false); });
    });
    if (await probe(7860, '/sdapi/v1/samplers')) this._localGenType = 'a1111';
    else if (await probe(8188, '/system_stats')) this._localGenType = 'comfyui';
    else this._localGenType = false;
  }

  /* ── A1111 / Forge ────────────────────────────────────────────── */

  async _genA1111(prompt, width, height, opts) {
    const w = Math.round(Math.min(width, 1536) / 64) * 64 || 512;
    const h = Math.round(Math.min(height, 1536) / 64) * 64 || 512;
    const body = JSON.stringify({
      prompt, negative_prompt: opts.negativePrompt || 'ugly, blurry, watermark, text, low quality',
      width: w, height: h, steps: opts.steps || 20, cfg_scale: opts.cfgScale || 7,
      sampler_name: opts.sampler || 'DPM++ 2M Karras', batch_size: 1, n_iter: 1,
    });
    return new Promise((resolve, reject) => {
      let d = '';
      const req = http.request({ hostname: 'localhost', port: 7860, path: '/sdapi/v1/txt2img', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 180000,
      }, res => {
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const b64 = JSON.parse(d).images?.[0];
            if (!b64) return reject(new Error('A1111 no images'));
            resolve({ success: true, imageBase64: b64, mimeType: 'image/png', prompt, provider: 'a1111', model: 'stable-diffusion' });
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('A1111 timeout')); });
      req.write(body); req.end();
    });
  }

  /* ── ComfyUI ──────────────────────────────────────────────────── */

  async _genComfyUI(prompt, width, height, opts) {
    const ckpt = await new Promise((resolve, reject) => {
      http.get('http://localhost:8188/object_info/CheckpointLoaderSimple', { timeout: 5000 }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0] || 'v1-5-pruned-emaonly.safetensors'); } catch { resolve('v1-5-pruned-emaonly.safetensors'); } });
      }).on('error', reject);
    });
    const w = Math.round(Math.min(width, 1536) / 64) * 64 || 512;
    const h = Math.round(Math.min(height, 1536) / 64) * 64 || 512;
    const seed = Math.floor(Math.random() * 2 ** 32);
    const workflow = {
      '3': { inputs: { seed, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4',0], positive: ['6',0], negative: ['7',0], latent_image: ['5',0] }, class_type: 'KSampler' },
      '4': { inputs: { ckpt_name: ckpt }, class_type: 'CheckpointLoaderSimple' },
      '5': { inputs: { width: w, height: h, batch_size: 1 }, class_type: 'EmptyLatentImage' },
      '6': { inputs: { text: prompt, clip: ['4',1] }, class_type: 'CLIPTextEncode' },
      '7': { inputs: { text: opts.negativePrompt || 'ugly, blurry, low quality', clip: ['4',1] }, class_type: 'CLIPTextEncode' },
      '8': { inputs: { samples: ['3',0], vae: ['4',2] }, class_type: 'VAEDecode' },
      '9': { inputs: { filename_prefix: 'guide_gen', images: ['8',0] }, class_type: 'SaveImage' },
    };
    const qBody = JSON.stringify({ prompt: workflow, client_id: 'guide' });
    const promptId = await new Promise((resolve, reject) => {
      let d = '';
      const req = http.request({ hostname: 'localhost', port: 8188, path: '/prompt', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(qBody) }, timeout: 10000,
      }, res => { res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).prompt_id); } catch (e) { reject(e); } }); });
      req.on('error', reject); req.write(qBody); req.end();
    });
    const filename = await new Promise((resolve, reject) => {
      const deadline = Date.now() + 180000;
      const poll = () => {
        if (Date.now() > deadline) return reject(new Error('ComfyUI timeout'));
        http.get(`http://localhost:8188/history/${promptId}`, { timeout: 5000 }, res => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => {
            try {
              const e = JSON.parse(d)[promptId];
              if (!e) return setTimeout(poll, 2000);
              for (const n of Object.values(e.outputs || {})) { if (n.images?.[0]) return resolve(n.images[0].filename); }
              setTimeout(poll, 2000);
            } catch { setTimeout(poll, 2000); }
          });
        }).on('error', () => setTimeout(poll, 3000));
      };
      poll();
    });
    return new Promise((resolve, reject) => {
      const chunks = [];
      http.get(`http://localhost:8188/view?filename=${encodeURIComponent(filename)}`, { timeout: 30000 }, res => {
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ success: true, imageBase64: Buffer.concat(chunks).toString('base64'), mimeType: 'image/png', prompt, provider: 'comfyui', model: ckpt }));
      }).on('error', reject);
    });
  }

  /* ── Pollinations ─────────────────────────────────────────────── */

  async _genPollinations(prompt, width, height, opts) {
    const ep = encodeURIComponent(prompt);
    const model = opts.pollinationsModel || 'flux';
    const seed = opts.seed || Math.floor(Math.random() * 1e6);
    const url = `https://image.pollinations.ai/prompt/${ep}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${seed}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pollinations timeout')), 90000);
      const handle = res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const proto = res.headers.location.startsWith('https') ? https : http;
          return proto.get(res.headers.location, handle).on('error', e => { clearTimeout(timer); reject(e); });
        }
        if (res.statusCode !== 200) { clearTimeout(timer); return reject(new Error(`Pollinations HTTP ${res.statusCode}`)); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const buf = Buffer.concat(chunks);
          if (buf.length < 1000) return reject(new Error('Response too small'));
          resolve({ success: true, imageBase64: buf.toString('base64'), mimeType: (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim(), prompt, provider: 'pollinations', model, width, height });
        });
        res.on('error', e => { clearTimeout(timer); reject(e); });
      };
      https.get(url, handle).on('error', e => { clearTimeout(timer); reject(e); });
    });
  }

  /* ── Google Gemini ────────────────────────────────────────────── */

  async _genGemini(prompt, width, height, opts) {
    const key = this._getNextGoogleKey();
    if (!key) throw new Error('No Google keys');
    const body = JSON.stringify({
      contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], responseMimeType: 'text/plain' },
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gemini timeout')), 60000);
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            if (res.statusCode === 429) { this._cooldownGoogleKey(key); return reject(new Error('Rate limited')); }
            if (res.statusCode !== 200) return reject(new Error(`Gemini ${res.statusCode}`));
            const parts = JSON.parse(raw).candidates?.[0]?.content?.parts || [];
            const img = parts.find(p => p.inlineData);
            if (img) resolve({ success: true, imageBase64: img.inlineData.data, mimeType: img.inlineData.mimeType || 'image/png', prompt, provider: 'google', model: 'gemini-2.0-flash-exp', width, height });
            else reject(new Error('Gemini returned text only'));
          } catch (e) { reject(e); }
        });
      });
      req.on('error', e => { clearTimeout(timer); reject(e); });
      req.write(body); req.end();
    });
  }

  /* ── Video generation ─────────────────────────────────────────── */

  async generateVideo(prompt, options = {}) {
    if (!this._pollinationsKeys.length) {
      return { success: false, error: 'Video requires a Pollinations API key. Get one free at https://enter.pollinations.ai', prompt };
    }
    const order = [];
    if (options.model && this._videoModels[options.model]) order.push(options.model);
    for (const m of ['seedance', 'veo']) { if (!order.includes(m)) order.push(m); }

    for (const model of order) {
      try {
        const r = await this._genVideo(prompt, model, options);
        if (r?.success) return r;
      } catch (e) { console.error(`[VideoGen] ${model} failed:`, e.message); }
    }
    return { success: false, error: 'All video models failed.', prompt };
  }

  async _genVideo(prompt, model, opts = {}) {
    const key = this._getNextPollinationsKey();
    if (!key) throw new Error('No Pollinations keys');
    const ep = encodeURIComponent(prompt);
    const seed = opts.seed || Math.floor(Math.random() * 1e6);
    let dur = model === 'veo' ? 6 : 5;
    const dm = prompt.match(/(\d+)\s*(?:second|sec|s)\b/i);
    if (dm) {
      const req = +dm[1];
      if (model === 'seedance') dur = Math.max(2, Math.min(10, req));
      else if (model === 'veo') dur = [4,6,8].reduce((p, c) => Math.abs(c - req) < Math.abs(p - req) ? c : p);
      else dur = Math.max(2, Math.min(10, req));
    }
    const urlPath = `/image/${ep}?model=${model}&nologo=true&seed=${seed}&duration=${dur}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Video timeout ${model}`)), 180000);
      const collect = res => {
        if (res.statusCode === 401) { clearTimeout(timer); return reject(new Error('Invalid Pollinations key')); }
        if (res.statusCode === 402) { clearTimeout(timer); this._cooldownPollinationsKey(key); return reject(new Error('Pollen exhausted')); }
        if (res.statusCode === 429) { clearTimeout(timer); this._cooldownPollinationsKey(key, 30000); return reject(new Error('Rate limited')); }
        if (res.statusCode !== 200) {
          const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => { clearTimeout(timer); reject(new Error(`HTTP ${res.statusCode}`)); });
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const buf = Buffer.concat(chunks);
          if (buf.length < 5000) return reject(new Error('Response too small'));
          const ct = (res.headers['content-type'] || '').toLowerCase();
          resolve({ success: true, videoBase64: buf.toString('base64'), mimeType: ct.includes('video') ? ct.split(';')[0].trim() : 'video/mp4', prompt, provider: 'pollinations', model, duration: `${dur}s` });
        });
        res.on('error', e => { clearTimeout(timer); reject(e); });
      };
      const req = https.get({ hostname: 'gen.pollinations.ai', path: urlPath,
        headers: { Authorization: `Bearer ${key}`, Accept: 'video/mp4, */*' }, timeout: 180000,
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const proto = res.headers.location.startsWith('https') ? https : http;
          return proto.get(res.headers.location, { timeout: 180000 }, collect).on('error', e => { clearTimeout(timer); reject(e); });
        }
        collect(res);
      });
      req.on('error', e => { clearTimeout(timer); reject(e); });
      req.on('timeout', () => { clearTimeout(timer); req.destroy(); reject(new Error('Connection timeout')); });
    });
  }

  /* ── Static detectors ─────────────────────────────────────────── */

  static detectImageRequest(message) {
    const lo = (message || '').toLowerCase();
    const neg = [
      /\bdraw.*conclusion\b/, /\bpaint.*picture\s+of\s+the\s+situation\b/, /\bdraw\s+the\s+line\b/,
      /\bdesign\s+pattern\b/, /\bdesign\s+(a\s+)?(function|class|api|interface|system|architecture|database|schema)\b/,
      /\banalyze\s+(this\s+)?image\b/, /\bdescribe\s+(this\s+)?image\b/, /\bwhat.*in\s+this\s+image\b/,
      /\bwrite_file\b/, /\b(html|css|javascript|js|tsx?)\s+file\b/,
      /\bdo\s+not\s+use\b.*\bimages?\b/, /\b(don'?t|do\s+not)\s+(want|need)\b.{0,30}\bimages?\b/,
      /\bnot\s+an?\s+images?\b/, /\b(broken|missing|placeholder)\s+images?\b/,
      /\b(fix|edit|modify|update|change)\b.{0,40}\b(html|css|js|file|code|dashboard|page|site|website)\b/,
      /\bno\s+(cdns?|frameworks?|external|build\s+tools?)\b/, /\blanding[\s-]page\b.*\b(html|file|write)\b/,
    ];
    for (const n of neg) if (n.test(lo)) return { isImageRequest: false, extractedPrompt: '' };

    const strong = [
      /\b(generate|create|make|draw|paint|design|produce|render|sketch)\b.{0,40}\b(image|picture|photo|illustration|artwork|art|graphic|icon|logo|banner|poster|wallpaper|avatar|portrait|landscape)\b/,
      /\b(image|picture|photo|illustration|artwork|art|graphic|icon|logo|banner|poster|wallpaper|avatar|portrait|landscape)\b.{0,40}\b(of|showing|depicting|with|featuring)\b/,
      /\bgenerate\s+(me\s+)?(an?\s+)?image\b/, /\bcreate\s+(me\s+)?(an?\s+)?image\b/, /\bmake\s+(me\s+)?(an?\s+)?image\b/,
      /\bdraw\s+(me\s+)?(an?\s+)?(image|picture|sketch|art)\b/, /\b(show|give)\s+me\s+(an?\s+)?(image|picture|photo)\b/,
      /\bimage\s+gen(eration)?\b/, /\btext[\s-]?to[\s-]?image\b/,
      /\bgener(ate|ating)\s+.{0,30}\b(pic(ture)?|img|visual)\b/, /\bgen\s+(me\s+)?(an?\s+)?(image|picture|photo|pic)\b/,
    ];
    for (const s of strong) if (s.test(lo)) return { isImageRequest: true, extractedPrompt: ImageGenerationService._extractPrompt(message) };

    if (lo.length < 200) {
      const weak = [/\bdraw\s+(me\s+)?a\b/, /\bpaint\s+(me\s+)?a\b/, /\bvisualize\b/, /\billustrate\b/];
      for (const w of weak) if (w.test(lo)) return { isImageRequest: true, extractedPrompt: ImageGenerationService._extractPrompt(message) };
    }
    return { isImageRequest: false, extractedPrompt: '' };
  }

  static _extractPrompt(msg) {
    let p = msg.replace(/^(please\s+)?/i, '').replace(/^(can\s+you\s+)?/i, '').replace(/^(could\s+you\s+)?/i, '')
      .replace(/^(would\s+you\s+)?/i, '').replace(/^(generate|create|make|draw|paint|design|produce|render|sketch)\s+(me\s+)?(an?\s+)?/i, '')
      .replace(/^(image|picture|photo|illustration|artwork|graphic)\s+(of\s+)?/i, '')
      .replace(/^(show|give)\s+me\s+(an?\s+)?(image|picture|photo)\s+(of\s+)?/i, '').trim();
    return p.length < 5 ? msg : p;
  }

  static detectVideoRequest(message) {
    const lo = (message || '').toLowerCase();
    const pats = [
      /\b(gen|generate|create|make|produce|render)\b.*\b(video|animation|clip|movie|film)\b/,
      /\btext[\s-]?to[\s-]?video\b/, /\bvideo\s+gen(eration)?\b/, /\banimate\b.*\b(image|scene|character)\b/,
      /\b(gen|make|create|generate)\s+(me\s+)?(a\s+)?(short\s+)?((\d+\s*-?\s*(second|sec|s|minute|min)\s+)?)?(video|clip|animation)\b/,
      /\bvideo\s+(of|showing|depicting|with)\b/,
    ];
    if (!pats.some(p => p.test(lo))) return null;
    let p = message.replace(/^(please\s+)?/i, '').replace(/^(can\s+you\s+)?/i, '').replace(/^(could\s+you\s+)?/i, '')
      .replace(/^(would\s+you\s+)?/i, '').replace(/^(generate|create|make|produce|render)\s+(me\s+)?(a\s+)?(short\s+)?/i, '')
      .replace(/^(video|animation|clip|movie|film)\s+(of\s+)?/i, '')
      .replace(/^(show|give)\s+me\s+(a\s+)?(video|animation|clip)\s+(of\s+)?/i, '').trim();
    return { isVideoRequest: true, extractedPrompt: p.length < 5 ? message : p };
  }

  getStatus() {
    return {
      providers: Object.entries(this._providers).map(([id, p]) => ({
        id, label: p.label, model: p.model, available: id === 'pollinations' || this._googleKeys.length > 0,
      })),
      googleKeysCount: this._googleKeys.length,
      videoAvailable: this._pollinationsKeys.length > 0,
      pollinationsKeysCount: this._pollinationsKeys.length,
      videoModels: Object.entries(this._videoModels).map(([id, m]) => ({ id, label: m.label, description: m.desc, free: m.free })),
    };
  }
}

module.exports = { ImageGenerationService };
