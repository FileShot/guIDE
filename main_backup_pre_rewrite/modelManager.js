/**
 * guIDE — Model Manager
 *
 * Scans for GGUF models in models/ directory + user-added paths.
 * Watches for new files, provides priority-based default model selection,
 * and emits 'models-updated' when the model list changes.
 */
'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { EventEmitter } = require('events');
const { detectModelType } = require('./modelDetection');
const log = require('./logger');

class ModelManager extends EventEmitter {
  constructor(appPath) {
    super();
    this.appPath = appPath;
    this.modelsDir = path.join(appPath, 'models');
    this.configPath = path.join(appPath, 'model-config.json');
    this.availableModels = [];
    this.customModelPaths = [];
    this.activeModelPath = null;
    this._watcher = null;
    this._scanTimeout = null;
  }

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  async initialize() {
    await this._loadConfig();
    try { await fs.mkdir(this.modelsDir, { recursive: true }); } catch {}
    await this.scanModels();
    this._watchModelsDir();
    return this.availableModels;
  }

  dispose() {
    if (this._watcher) { this._watcher.close(); this._watcher = null; }
    clearTimeout(this._scanTimeout);
  }

  /* ── Scanning ──────────────────────────────────────────────────── */

  async scanModels() {
    this.availableModels = [];
    await this._scanDir(this.modelsDir);
    await this._scanDir(this.appPath, false); // root for backward compat

    for (const p of this.customModelPaths) {
      await this._addSingleModel(p);
    }

    this.availableModels.sort((a, b) => a.name.localeCompare(b.name));
    this.emit('models-updated', this.availableModels);
    return this.availableModels;
  }

  async _scanDir(dirPath, recursive = false) {
    let entries;
    try { entries = await fs.readdir(dirPath, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.gguf')) {
        if (this.availableModels.find(m => m.path === fullPath)) continue;
        try {
          const stats = await fs.stat(fullPath);
          this.availableModels.push({
            name: entry.name.replace('.gguf', ''),
            fileName: entry.name,
            path: fullPath,
            size: stats.size,
            sizeFormatted: _formatSize(stats.size),
            modified: stats.mtime,
            directory: dirPath,
            details: _parseModelName(entry.name),
            modelType: detectModelType(fullPath),
          });
        } catch {}
      }
      if (recursive && entry.isDirectory() && !entry.name.startsWith('.')) {
        await this._scanDir(fullPath, true);
      }
    }
  }

  async _addSingleModel(filePath) {
    if (!filePath.endsWith('.gguf')) return null;
    if (!fsSync.existsSync(filePath)) return null;
    if (this.availableModels.find(m => m.path === filePath)) return null;
    try {
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      const info = {
        name: fileName.replace('.gguf', ''),
        fileName,
        path: filePath,
        size: stats.size,
        sizeFormatted: _formatSize(stats.size),
        modified: stats.mtime,
        directory: path.dirname(filePath),
        isCustom: true,
        details: _parseModelName(fileName),
        modelType: detectModelType(filePath),
      };
      this.availableModels.push(info);
      return info;
    } catch (e) {
      log.warn('Models', 'Failed to add model:', filePath, e.message);
      return null;
    }
  }

  /* ── Add / Remove user models ──────────────────────────────────── */

  async addModels(filePaths) {
    const added = [];
    for (const fp of filePaths) {
      if (this.customModelPaths.includes(fp)) continue;
      this.customModelPaths.push(fp);
      const m = await this._addSingleModel(fp);
      if (m) added.push(m);
    }
    await this._saveConfig();
    this.availableModels.sort((a, b) => a.name.localeCompare(b.name));
    this.emit('models-updated', this.availableModels);
    return added;
  }

  async removeModel(filePath) {
    this.customModelPaths = this.customModelPaths.filter(p => p !== filePath);
    this.availableModels = this.availableModels.filter(m => m.path !== filePath);
    await this._saveConfig();
    this.emit('models-updated', this.availableModels);
  }

  /* ── Default model selection ───────────────────────────────────── */

  getDefaultModel() {
    if (!this.availableModels.length) return null;

    const preferredPatterns = [
      /qwen3.*4b.*function.*call/i,
      /qwen2\.5.*7b.*instruct.*1m.*thinking/i,
      /qwen3.*coder.*30b.*a3b/i,
      /qwen3.*30b.*a3b.*thinking/i,
      /deepseek.*r1/i,
      /qwen3.*vl/i,
      /qwen.*3.*vl/i,
      /deepseek/i,
      /qwen3.*coder/i,
      /qwen3/i,
      /qwen.*3/i,
    ];

    for (const pat of preferredPatterns) {
      const m = this.availableModels.find(m => pat.test(m.name));
      if (m) return m;
    }

    // Fallback: prefer models/ dir, then largest that fits in < 50% RAM
    const inDir = this.availableModels.filter(m => m.directory === this.modelsDir);
    const candidates = inDir.length ? inDir : this.availableModels;
    const maxSize = require('os').totalmem() * 0.5;
    const fitting = candidates.filter(m => m.size < maxSize);
    const pool = fitting.length ? fitting : candidates;
    pool.sort((a, b) => b.size - a.size);
    return pool[0];
  }

  getModel(modelPath) {
    return this.availableModels.find(m => m.path === modelPath);
  }

  /* ── Persistence ───────────────────────────────────────────────── */

  async _loadConfig() {
    try {
      const data = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
      this.customModelPaths = data.customModelPaths || [];
    } catch {
      this.customModelPaths = [];
    }
  }

  async _saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify({ customModelPaths: this.customModelPaths }, null, 2));
    } catch (e) {
      log.warn('Models', 'Failed to save config:', e.message);
    }
  }

  /* ── Watch ─────────────────────────────────────────────────────── */

  _watchModelsDir() {
    if (this._watcher) this._watcher.close();
    if (!fsSync.existsSync(this.modelsDir)) return;
    try {
      this._watcher = fsSync.watch(this.modelsDir, { persistent: false }, (_evt, file) => {
        if (file?.endsWith('.gguf')) {
          clearTimeout(this._scanTimeout);
          this._scanTimeout = setTimeout(() => this.scanModels(), 1000);
        }
      });
    } catch (e) {
      log.warn('Models', 'Failed to watch models directory:', e.message);
    }
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function _formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

function _parseModelName(filename) {
  const name = filename.toLowerCase();
  const details = { quantization: 'unknown', parameters: 'unknown', family: 'unknown' };

  const qMatch = name.match(/(q[0-9]_[a-z0-9_]+|f16|f32|q[0-9]+)/i);
  if (qMatch) details.quantization = qMatch[1].toUpperCase();

  const pMatch = name.match(/(\d+\.?\d*)[bm]/i);
  if (pMatch) details.parameters = pMatch[0].toUpperCase();

  const families = ['llama', 'mistral', 'qwen', 'codellama', 'deepseek', 'phi', 'gemma', 'starcoder', 'yi', 'falcon', 'vicuna', 'wizardcoder'];
  for (const f of families) {
    if (name.includes(f)) { details.family = f.charAt(0).toUpperCase() + f.slice(1); break; }
  }

  return details;
}

module.exports = { ModelManager };
