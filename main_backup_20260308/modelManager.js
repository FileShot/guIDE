/**
 * guIDE Model Manager - Scans for GGUF models and manages model switching
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { EventEmitter } = require('events');
const { detectModelType } = require('./modelDetection');

class ModelManager extends EventEmitter {
  constructor(appPath) {
    super();
    this.appPath = appPath;
    this.modelsDir = path.join(appPath, 'models');
    this.configPath = path.join(appPath, 'model-config.json');
    this.availableModels = [];
    this.customModelPaths = [];  // User-added model file paths
    this.activeModelPath = null;
    this.watcher = null;
  }

  async initialize() {
    // Load saved custom model paths
    await this._loadConfig();

    // Ensure models directory exists
    try {
      await fs.mkdir(this.modelsDir, { recursive: true });
    } catch (e) { /* ignore */ }

    // Scan for models in both the models/ dir and the root dir
    await this.scanModels();

    // Watch models directory for new model files
    this.watchModelsDir();

    return this.availableModels;
  }

  async scanModels() {
    this.availableModels = [];

    // Scan models/ directory
    await this._scanDir(this.modelsDir);

    // Also scan app root for GGUF files (for backward compat)
    await this._scanDir(this.appPath, false);

    // Add user-specified custom model paths
    for (const modelPath of this.customModelPaths) {
      await this._addSingleModel(modelPath);
    }

    // Sort by name
    this.availableModels.sort((a, b) => a.name.localeCompare(b.name));

    this.emit('models-updated', this.availableModels);
    return this.availableModels;
  }

  async _addSingleModel(filePath) {
    try {
      if (!filePath.endsWith('.gguf')) return null;
      if (!fsSync.existsSync(filePath)) return null;
      if (this.availableModels.find(m => m.path === filePath)) return null;

      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      const modelInfo = {
        name: fileName.replace('.gguf', ''),
        fileName: fileName,
        path: filePath,
        size: stats.size,
        sizeFormatted: this._formatSize(stats.size),
        modified: stats.mtime,
        directory: path.dirname(filePath),
        isCustom: true,  // Flag to indicate user-added model
        details: this._parseModelName(fileName),
        modelType: detectModelType(filePath),
      };

      this.availableModels.push(modelInfo);
      return modelInfo;
    } catch (e) {
      console.error('Failed to add model:', filePath, e.message);
      return null;
    }
  }

  async addModels(filePaths) {
    const added = [];
    for (const filePath of filePaths) {
      if (!this.customModelPaths.includes(filePath)) {
        this.customModelPaths.push(filePath);
        const model = await this._addSingleModel(filePath);
        if (model) added.push(model);
      }
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

  async _loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(data);
      this.customModelPaths = config.customModelPaths || [];
    } catch (e) {
      this.customModelPaths = [];
    }
  }

  async _saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify({
        customModelPaths: this.customModelPaths,
      }, null, 2));
    } catch (e) {
      console.error('Failed to save model config:', e.message);
    }
  }

  async _scanDir(dirPath, recursive = false) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile() && entry.name.endsWith('.gguf')) {
          const stats = await fs.stat(fullPath);
          const modelInfo = {
            name: entry.name.replace('.gguf', ''),
            fileName: entry.name,
            path: fullPath,
            size: stats.size,
            sizeFormatted: this._formatSize(stats.size),
            modified: stats.mtime,
            directory: dirPath,
          };

          // Try to detect model details from filename
          modelInfo.details = this._parseModelName(entry.name);
          modelInfo.modelType = detectModelType(fullPath);

          // Don't add duplicates
          if (!this.availableModels.find(m => m.path === fullPath)) {
            this.availableModels.push(modelInfo);
          }
        }
        if (recursive && entry.isDirectory() && !entry.name.startsWith('.')) {
          await this._scanDir(fullPath, true);
        }
      }
    } catch (e) {
      // Directory may not exist yet
    }
  }

  _parseModelName(filename) {
    const name = filename.toLowerCase();
    const details = {
      quantization: 'unknown',
      parameters: 'unknown',
      family: 'unknown',
    };

    // Detect quantization
    const quantMatch = name.match(/(q[0-9]_[a-z0-9_]+|f16|f32|q[0-9]+)/i);
    if (quantMatch) details.quantization = quantMatch[1].toUpperCase();

    // Detect parameters
    const paramMatch = name.match(/(\d+\.?\d*)[bm]/i);
    if (paramMatch) details.parameters = paramMatch[0].toUpperCase();

    // Detect model family
    const families = ['llama', 'mistral', 'qwen', 'codellama', 'deepseek', 'phi', 'gemma', 'starcoder', 'yi', 'falcon', 'vicuna', 'wizardcoder'];
    for (const family of families) {
      if (name.includes(family)) {
        details.family = family.charAt(0).toUpperCase() + family.slice(1);
        break;
      }
    }

    return details;
  }

  watchModelsDir() {
    try {
      if (this.watcher) {
        this.watcher.close();
      }
      // Only watch if directory exists
      if (fsSync.existsSync(this.modelsDir)) {
        this.watcher = fsSync.watch(this.modelsDir, { persistent: false }, (eventType, filename) => {
          if (filename && filename.endsWith('.gguf')) {
            // Debounce rescan
            clearTimeout(this._scanTimeout);
            this._scanTimeout = setTimeout(() => this.scanModels(), 1000);
          }
        });
      }
    } catch (e) {
      console.error('Failed to watch models directory:', e);
    }
  }

  getDefaultModel() {
    if (this.availableModels.length === 0) return null;

    // Prefer specific models in priority order
    const preferredPatterns = [
      /qwen3.*4b.*function.*call/i,       // Best for tool-calling on limited VRAM
      /qwen2\.5.*7b.*instruct.*1m.*thinking/i,
      /qwen3.*coder.*30b.*a3b/i,          // MoE — only 3B active, excellent quality
      /qwen3.*30b.*a3b.*thinking/i,       // MoE thinking variant
      /deepseek.*r1/i,
      /qwen3.*vl/i,
      /qwen.*3.*vl/i,
      /deepseek/i,
      /qwen3.*coder/i,
      /qwen3/i,
      /qwen.*3/i,
    ];

    for (const pattern of preferredPatterns) {
      const match = this.availableModels.find(m => pattern.test(m.name));
      if (match) return match;
    }

    // Fallback: prefer models in the models/ directory first
    const modelsInDir = this.availableModels.filter(m => m.directory === this.modelsDir);
    const candidates = modelsInDir.length > 0 ? modelsInDir : this.availableModels;

    // Prefer the largest model that fits in system RAM (likely most capable)
    const totalRAM = require('os').totalmem();
    const maxModelSize = totalRAM * 0.5; // Model should be < 50% of system RAM
    const fittingModels = candidates.filter(m => m.size < maxModelSize);
    const pool = fittingModels.length > 0 ? fittingModels : candidates;

    // Sort by size descending — larger models are generally more capable
    pool.sort((a, b) => b.size - a.size);
    return pool[0];
  }

  getModel(modelPath) {
    return this.availableModels.find(m => m.path === modelPath);
  }

  _formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  dispose() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    clearTimeout(this._scanTimeout);
  }
}

module.exports = { ModelManager };
