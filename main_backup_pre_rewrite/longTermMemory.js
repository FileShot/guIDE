/**
 * guIDE — Long-Term Memory (Phase 4)
 *
 * Unified cross-session memory that bridges:
 *   - MCP tool memories (.guide-memory/{key}.json)
 *   - MemoryStore project facts (.ide-memory/memory.json)
 *
 * Provides:
 *   - Relevance-based retrieval for prompt injection
 *   - Automatic fact extraction from rolling summary at conversation end
 *   - Keyword-scored retrieval within a token budget
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CHARS_PER_TOKEN = 4;

class LongTermMemory {
  constructor() {
    this._projectPath = null;
    this._guideMemDir = null;   // .guide-memory/ (MCP tool files)
    this._ideMemDir = null;     // .ide-memory/   (memoryStore)
    this._index = [];           // Array of { key, value, source, updatedAt, tokens }
    this._initialized = false;
  }

  /* ── Lifecycle ─────────────────────────────────────────────────── */

  /**
   * Initialize and build the unified index from both memory stores.
   * @param {string} projectPath — the workspace/project root
   */
  initialize(projectPath) {
    if (!projectPath) return;
    this._projectPath = projectPath;
    this._guideMemDir = path.join(projectPath, '.guide-memory');
    this._ideMemDir = path.join(projectPath, '.ide-memory');
    this._rebuildIndex();
    this._initialized = true;
  }

  /* ── Index Management ──────────────────────────────────────────── */

  _rebuildIndex() {
    this._index = [];
    this._scanGuideMemory();
    this._scanIdeMemory();
  }

  /** Scan .guide-memory/ — individual JSON/TXT files written by MCP save_memory tool */
  _scanGuideMemory() {
    if (!this._guideMemDir) return;
    try {
      if (!fs.existsSync(this._guideMemDir)) return;
      const files = fs.readdirSync(this._guideMemDir);
      const jsonFiles = new Set(files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));

      for (const f of files) {
        if (!f.endsWith('.json') && !f.endsWith('.txt')) continue;
        const baseName = f.replace(/\.(json|txt)$/, '');
        // Skip .txt if .json exists (json is canonical)
        if (f.endsWith('.txt') && jsonFiles.has(baseName)) continue;

        try {
          const raw = fs.readFileSync(path.join(this._guideMemDir, f), 'utf8');
          let key, value, updatedAt;

          if (f.endsWith('.json')) {
            const parsed = JSON.parse(raw);
            key = parsed.metadata?.key || baseName.replace(/_/g, ' ');
            value = parsed.content || '';
            updatedAt = parsed.metadata?.updatedAt || null;
          } else {
            key = baseName.replace(/_/g, ' ');
            value = raw;
            updatedAt = fs.statSync(path.join(this._guideMemDir, f)).mtime.toISOString();
          }

          if (value) {
            this._index.push({
              key,
              value: value.substring(0, 4000), // Cap individual entries
              source: 'guide-memory',
              updatedAt,
              tokens: Math.ceil(value.length / CHARS_PER_TOKEN),
            });
          }
        } catch (_) { /* skip corrupt files */ }
      }
    } catch (_) { /* directory doesn't exist yet */ }
  }

  /** Scan .ide-memory/memory.json — projectFacts and codePatterns from MemoryStore */
  _scanIdeMemory() {
    if (!this._ideMemDir) return;
    const memFile = path.join(this._ideMemDir, 'memory.json');
    try {
      if (!fs.existsSync(memFile)) return;
      const raw = JSON.parse(fs.readFileSync(memFile, 'utf8'));

      // Import project facts
      if (raw.projectFacts) {
        for (const [k, v] of Object.entries(raw.projectFacts)) {
          const val = typeof v === 'object' ? v.value : String(v);
          if (val) {
            this._index.push({
              key: `fact:${k}`,
              value: val,
              source: 'ide-memory',
              updatedAt: v?.learnedAt ? new Date(v.learnedAt).toISOString() : null,
              tokens: Math.ceil(val.length / CHARS_PER_TOKEN),
            });
          }
        }
      }

      // Import code patterns
      if (raw.codePatterns) {
        for (const [k, v] of Object.entries(raw.codePatterns)) {
          const val = typeof v === 'object' ? v.pattern : String(v);
          if (val) {
            this._index.push({
              key: `pattern:${k}`,
              value: val,
              source: 'ide-memory',
              updatedAt: v?.learnedAt ? new Date(v.learnedAt).toISOString() : null,
              tokens: Math.ceil(val.length / CHARS_PER_TOKEN),
            });
          }
        }
      }
    } catch (_) { /* file doesn't exist or corrupt */ }
  }

  /* ── Retrieval ─────────────────────────────────────────────────── */

  /**
   * Get memories relevant to a query, within a token budget.
   * @param {string} query — the user's message or topic
   * @param {number} tokenBudget — max tokens for the returned block
   * @returns {string} — formatted memory block for prompt injection
   */
  getRelevantMemories(query, tokenBudget = 500) {
    if (!this._initialized || this._index.length === 0) return '';

    const keywords = this._extractKeywords(query);
    if (keywords.length === 0) return '';

    // Score each memory by keyword relevance
    const scored = this._index.map(entry => {
      const entryText = `${entry.key} ${entry.value}`.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (entryText.includes(kw)) score += 1;
        // Boost exact key matches
        if (entry.key.toLowerCase().includes(kw)) score += 2;
      }
      // Recency bonus: memories from last 7 days get +1
      if (entry.updatedAt) {
        const age = Date.now() - new Date(entry.updatedAt).getTime();
        if (age < 7 * 24 * 60 * 60 * 1000) score += 1;
      }
      return { ...entry, score };
    }).filter(e => e.score > 0);

    if (scored.length === 0) return '';

    // Sort by score desc, then recency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.updatedAt && b.updatedAt) return new Date(b.updatedAt) - new Date(a.updatedAt);
      return 0;
    });

    // Assemble within budget
    const parts = ['[Long-term memory — relevant to this conversation]'];
    let used = Math.ceil(parts[0].length / CHARS_PER_TOKEN);

    for (const entry of scored) {
      const line = `- ${entry.key}: ${entry.value}`;
      const cost = Math.ceil(line.length / CHARS_PER_TOKEN);
      if (used + cost > tokenBudget) {
        // Try truncated version
        const remaining = (tokenBudget - used) * CHARS_PER_TOKEN;
        if (remaining > 40) {
          parts.push(`- ${entry.key}: ${entry.value.substring(0, remaining - entry.key.length - 4)}...`);
        }
        break;
      }
      parts.push(line);
      used += cost;
    }

    return parts.length > 1 ? parts.join('\n') : '';
  }

  /**
   * Extract searchable keywords from a query string.
   * Filters out very common stop words and short words.
   */
  _extractKeywords(text) {
    const STOP_WORDS = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
      'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
      'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
      'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
      'or', 'if', 'while', 'about', 'up', 'it', 'its', 'that', 'this',
      'what', 'which', 'who', 'whom', 'these', 'those', 'i', 'me', 'my',
      'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they',
      'them', 'their', 'please', 'help', 'want', 'need', 'like', 'make',
    ]);

    // Split on non-alphanumeric, keep words >=3 chars, lowercase
    const words = text.toLowerCase()
      .split(/[^a-z0-9_.-]+/i)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    // Also extract file-like tokens (e.g., "index.js", "package.json")
    const filePatterns = text.match(/[\w.-]+\.\w{1,6}/g) || [];
    const combined = [...new Set([...words, ...filePatterns.map(f => f.toLowerCase())])];

    return combined.slice(0, 20); // Cap at 20 keywords
  }

  /* ── Extraction (end of conversation) ──────────────────────────── */

  /**
   * Extract key facts from a rolling summary and persist them.
   * Called at conversation end — no LLM needed, uses structured data.
   * @param {object} rollingSummary — the RollingSummary instance
   * @param {string} userMessage — the original user message (for context tagging)
   */
  extractAndSave(rollingSummary, userMessage) {
    if (!this._initialized || !rollingSummary) return;

    const timestamp = new Date().toISOString();
    const tag = (userMessage || '').substring(0, 60).replace(/[^a-z0-9 ]/gi, '').trim();
    const sessionKey = `session_${Date.now()}`;
    const facts = [];

    // Extract completed work items
    const work = rollingSummary._completedWork || [];
    if (work.length > 0) {
      const workSummary = work.slice(-10).map(w => {
        if (typeof w === 'string') return w;
        return `${w.tool || 'unknown'}(${w.shortParams || ''})`;
      }).join('; ');
      facts.push({ key: `${sessionKey}_work`, value: `Tools used: ${workSummary}`, tag });
    }

    // Extract file state (files touched)
    const files = rollingSummary._fileState || {};
    const fileKeys = Object.keys(files);
    if (fileKeys.length > 0) {
      facts.push({ key: `${sessionKey}_files`, value: `Files: ${fileKeys.slice(0, 20).join(', ')}`, tag });
    }

    // Extract key decisions
    const decisions = rollingSummary._keyDecisions || [];
    if (decisions.length > 0) {
      facts.push({ key: `${sessionKey}_decisions`, value: decisions.slice(-5).join('; '), tag });
    }

    // Extract user corrections (these are especially valuable long-term)
    const corrections = rollingSummary._userCorrections || [];
    if (corrections.length > 0) {
      facts.push({ key: `${sessionKey}_corrections`, value: corrections.slice(-5).join('; '), tag });
    }

    // Extract current plan if any
    const plan = rollingSummary._currentPlan;
    if (plan) {
      facts.push({ key: `${sessionKey}_plan`, value: plan.substring(0, 500), tag });
    }

    if (facts.length === 0) return;

    // Write to .guide-memory/ (unified location, compatible with MCP tools)
    try {
      if (!this._guideMemDir) return;
      fs.mkdirSync(this._guideMemDir, { recursive: true });

      // Write a single session summary file
      const payload = {
        metadata: {
          key: sessionKey,
          tag,
          savedAt: timestamp,
          updatedAt: timestamp,
          source: 'auto-extract',
          factCount: facts.length,
        },
        content: facts.map(f => `[${f.key}] ${f.value}`).join('\n'),
        facts,
      };

      const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.writeFileSync(
        path.join(this._guideMemDir, `${safeKey}.json`),
        JSON.stringify(payload, null, 2)
      );

      // Update in-memory index
      this._index.push({
        key: sessionKey,
        value: payload.content.substring(0, 4000),
        source: 'auto-extract',
        updatedAt: timestamp,
        tokens: Math.ceil(payload.content.length / CHARS_PER_TOKEN),
      });

      // Prune old auto-extracted memories (keep last 50 sessions)
      this._pruneAutoExtracted(50);
    } catch (e) {
      console.warn('[LongTermMemory] Failed to save extracted facts:', e.message);
    }
  }

  /**
   * Called when the MCP save_memory tool writes a new memory.
   * Updates the in-memory index without a full rescan.
   */
  notifySaved(key, value) {
    // Remove any existing entry with same key
    this._index = this._index.filter(e => e.key !== key);
    this._index.push({
      key,
      value: (value || '').substring(0, 4000),
      source: 'guide-memory',
      updatedAt: new Date().toISOString(),
      tokens: Math.ceil((value || '').length / CHARS_PER_TOKEN),
    });
  }

  /* ── Maintenance ───────────────────────────────────────────────── */

  /** Remove old auto-extracted session files beyond the keep limit */
  _pruneAutoExtracted(keepCount) {
    if (!this._guideMemDir) return;
    try {
      const autoEntries = this._index
        .filter(e => e.source === 'auto-extract')
        .sort((a, b) => {
          if (a.updatedAt && b.updatedAt) return new Date(b.updatedAt) - new Date(a.updatedAt);
          return 0;
        });

      if (autoEntries.length <= keepCount) return;

      const toRemove = autoEntries.slice(keepCount);
      for (const entry of toRemove) {
        const safeKey = entry.key.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filePath = path.join(this._guideMemDir, `${safeKey}.json`);
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
        // Remove from index
        this._index = this._index.filter(e => e !== entry);
      }
    } catch (_) {}
  }

  /** Full stats for diagnostics */
  getStats() {
    const bySource = {};
    for (const entry of this._index) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    }
    return {
      totalEntries: this._index.length,
      totalTokens: this._index.reduce((sum, e) => sum + e.tokens, 0),
      bySource,
    };
  }
}

module.exports = { LongTermMemory };
