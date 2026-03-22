/**
 * guIDE — Memory Store
 *
 * Persistent cross-session memory: conversations, project facts, code patterns,
 * and error history. Debounced save (5 s) to <projectRoot>/.ide-memory/memory.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger');

class MemoryStore {
  constructor() {
    this._basePath = null;
    this._filePath = null;
    this._saveTimer = null;
    this.conversations = [];
    this.projectFacts = new Map();
    this.codePatterns = new Map();
    this.errorHistory = [];
  }

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  initialize(projectPath) {
    if (!projectPath) return;
    this._basePath = path.join(projectPath, '.ide-memory');
    this._filePath = path.join(this._basePath, 'memory.json');
    try {
      fs.mkdirSync(this._basePath, { recursive: true });
      if (fs.existsSync(this._filePath)) {
        const raw = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
        this.conversations = raw.conversations || [];
        this.projectFacts = new Map(Object.entries(raw.projectFacts || {}));
        this.codePatterns = new Map(Object.entries(raw.codePatterns || {}));
        this.errorHistory = raw.errorHistory || [];
        log.info('Memory', `Loaded ${this.conversations.length} conversations, ${this.projectFacts.size} facts`);
      }
    } catch (e) {
      log.warn('Memory', 'Failed to load memory store:', e.message);
    }
  }

  /* ── Learning ──────────────────────────────────────────────────── */

  addConversation(entry) {
    this.conversations.push({
      timestamp: Date.now(),
      ...entry,
    });
    // Keep last 200 conversations
    if (this.conversations.length > 200) {
      this.conversations = this.conversations.slice(-200);
    }
    this._scheduleSave();
  }

  learnFact(key, value) {
    this.projectFacts.set(key, { value, learnedAt: Date.now() });
    this._scheduleSave();
  }

  learnPattern(key, pattern) {
    this.codePatterns.set(key, { pattern, learnedAt: Date.now() });
    this._scheduleSave();
  }

  recordError(error) {
    this.errorHistory.push({
      timestamp: Date.now(),
      message: typeof error === 'string' ? error : error.message,
      stack: error?.stack,
    });
    // Keep last 100 errors
    if (this.errorHistory.length > 100) {
      this.errorHistory = this.errorHistory.slice(-100);
    }
    this._scheduleSave();
  }

  /* ── Querying ──────────────────────────────────────────────────── */

  findSimilarErrors(errorMsg) {
    if (!errorMsg) return [];
    const lower = errorMsg.toLowerCase();
    return this.errorHistory.filter(e =>
      e.message && e.message.toLowerCase().includes(lower)
    ).slice(-5);
  }

  getContextPrompt() {
    const parts = [];
    if (this.projectFacts.size) {
      parts.push('Known project facts:');
      for (const [k, v] of this.projectFacts) {
        parts.push(`  - ${k}: ${v.value}`);
      }
    }
    if (this.codePatterns.size) {
      parts.push('Known code patterns:');
      for (const [k, v] of this.codePatterns) {
        parts.push(`  - ${k}: ${v.pattern}`);
      }
    }
    return parts.length ? parts.join('\n') : '';
  }

  getStats() {
    return {
      conversations: this.conversations.length,
      facts: this.projectFacts.size,
      patterns: this.codePatterns.size,
      errors: this.errorHistory.length,
    };
  }

  clear() {
    this.conversations = [];
    this.projectFacts.clear();
    this.codePatterns.clear();
    this.errorHistory = [];
    this._scheduleSave();
  }

  clearConversations() {
    this.conversations = [];
    this._scheduleSave();
  }

  dispose() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._save(); // final flush
  }

  /* ── Persistence ───────────────────────────────────────────────── */

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, 5000);
  }

  _save() {
    if (!this._filePath) return;
    const data = {
      conversations: this.conversations,
      projectFacts: Object.fromEntries(this.projectFacts),
      codePatterns: Object.fromEntries(this.codePatterns),
      errorHistory: this.errorHistory,
    };
    try {
      fs.mkdirSync(this._basePath, { recursive: true });
      const tmp = this._filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, this._filePath);
    } catch (e) {
      log.warn('Memory', 'Failed to save memory store:', e.message);
    }
  }
}

module.exports = { MemoryStore };
