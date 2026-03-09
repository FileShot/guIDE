/**
 * guIDE Memory Store - Persistent context & conversation memory for the AI
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Stores conversation summaries, project knowledge, and frequently-accessed code patterns.
 * Persisted to disk so context survives restarts.
 */
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

class MemoryStore {
  constructor(appPath) {
    this.memoryDir = path.join(appPath, '.ide-memory');
    this.conversations = [];        // Recent conversation turns
    this.projectFacts = new Map();   // Key facts learned about the project
    this.codePatterns = new Map();   // Code patterns and conventions observed
    this.errorHistory = [];          // Past errors and their resolutions
    this.maxConversations = 100;
    this.maxErrors = 50;
    this.loaded = false;
  }

  async initialize() {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      await this._load();
      this.loaded = true;
    } catch (e) {
      console.error('Failed to initialize memory store:', e);
    }
  }

  /**
   * Record a conversation turn
   */
  addConversation(role, content, metadata = {}) {
    const entry = {
      role,
      content: content.substring(0, 2000), // Truncate for memory efficiency
      timestamp: Date.now(),
      ...metadata,
    };
    this.conversations.push(entry);
    if (this.conversations.length > this.maxConversations) {
      // Summarize old conversations before dropping them
      this.conversations = this.conversations.slice(-this.maxConversations);
    }
    this._scheduleSave();
  }

  /**
   * Learn a fact about the project
   */
  learnFact(key, value) {
    this.projectFacts.set(key, {
      value,
      learnedAt: Date.now(),
      accessCount: 0,
    });
    this._scheduleSave();
  }

  /**
   * Record a code pattern/convention
   */
  learnPattern(patternName, description, examples = []) {
    this.codePatterns.set(patternName, {
      description,
      examples: examples.slice(0, 3),
      learnedAt: Date.now(),
    });
    this._scheduleSave();
  }

  /**
   * Record an error and its resolution
   */
  recordError(errorMessage, resolution, files = []) {
    this.errorHistory.push({
      error: errorMessage.substring(0, 500),
      resolution: resolution.substring(0, 1000),
      files,
      timestamp: Date.now(),
    });
    if (this.errorHistory.length > this.maxErrors) {
      this.errorHistory = this.errorHistory.slice(-this.maxErrors);
    }
    this._scheduleSave();
  }

  /**
   * Find similar past errors
   */
  findSimilarErrors(errorMessage) {
    const words = errorMessage.toLowerCase().split(/\s+/);
    return this.errorHistory
      .map(entry => {
        const entryWords = entry.error.toLowerCase().split(/\s+/);
        const overlap = words.filter(w => entryWords.includes(w)).length;
        return { ...entry, similarity: overlap / Math.max(words.length, 1) };
      })
      .filter(e => e.similarity > 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  /**
   * Build context prompt from memory for the LLM
   */
  getContextPrompt() {
    let prompt = '';

    // Add project facts
    if (this.projectFacts.size > 0) {
      prompt += '\n## Known Project Facts\n';
      for (const [key, fact] of this.projectFacts) {
        prompt += `- **${key}**: ${fact.value}\n`;
      }
    }

    // Add code patterns
    if (this.codePatterns.size > 0) {
      prompt += '\n## Observed Code Patterns\n';
      for (const [name, pattern] of this.codePatterns) {
        prompt += `- **${name}**: ${pattern.description}\n`;
      }
    }

    // NOTE: Past conversation turns are intentionally NOT injected here.
    // conversations[] persists across sessions on disk. Injecting previous-session
    // turns into a new session's system prompt caused the model to appear to
    // "remember" things from prior sessions. Current-session messages are already
    // in the messages[] array sent to the LLM — no injection needed.

    return prompt;
  }

  /**
   * Get memory stats
   */
  getStats() {
    return {
      conversations: this.conversations.length,
      projectFacts: this.projectFacts.size,
      codePatterns: this.codePatterns.size,
      errorHistory: this.errorHistory.length,
      memoryDir: this.memoryDir,
    };
  }

  /**
   * Clear only conversation history (for session reset)
   */
  clearConversations() {
    this.conversations = [];
    this._scheduleSave();
  }

  /**
   * Clear all memory
   */
  clear() {
    this.conversations = [];
    this.projectFacts.clear();
    this.codePatterns.clear();
    this.errorHistory = [];
    this._scheduleSave();
  }

  // ── Persistence ──

  _saveTimer = null;

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 5000);
  }

  async _save() {
    try {
      const data = {
        conversations: this.conversations,
        projectFacts: Array.from(this.projectFacts.entries()),
        codePatterns: Array.from(this.codePatterns.entries()),
        errorHistory: this.errorHistory,
        savedAt: Date.now(),
      };
      await fs.writeFile(
        path.join(this.memoryDir, 'memory.json'),
        JSON.stringify(data, null, 2),
        'utf8'
      );
    } catch (e) {
      console.error('Failed to save memory:', e);
    }
  }

  async _load() {
    try {
      const filePath = path.join(this.memoryDir, 'memory.json');
      if (!fsSync.existsSync(filePath)) return;
      
      const raw = await fs.readFile(filePath, 'utf8');
      if (!raw.trim()) return; // empty file — start with clean memory
      const data = JSON.parse(raw);

      this.conversations = data.conversations || [];
      this.projectFacts = new Map(data.projectFacts || []);
      this.codePatterns = new Map(data.codePatterns || []);
      this.errorHistory = data.errorHistory || [];
    } catch (e) {
      // Corrupted or partially-written file — start with clean state rather than
      // leaving the in-memory store in an inconsistent/partially-loaded condition.
      console.warn('[Memory] memory.json corrupted or unreadable — starting fresh:', e.message);
      this.conversations = [];
      this.projectFacts = new Map();
      this.codePatterns = new Map();
      this.errorHistory = [];
    }
  }

  async dispose() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    await this._save();
  }
}

module.exports = { MemoryStore };
