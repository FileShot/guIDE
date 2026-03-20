/**
 * ConversationSummarizer — Structured task ledger for context recovery.
 *
 * Maintains a ledger of goals, tool calls, plan steps, user corrections,
 * and state. Produces markdown summaries for injection when context
 * rotation occurs. Zero LLM cost — template-based.
 *
 * Ported from main_backup_pre_rewrite/conversationSummarizer.js
 */
'use strict';

class ConversationSummarizer {
  constructor() {
    this.reset();
  }

  reset() {
    this.originalGoal = '';
    this.taskPlan = [];           // [{index, description, completed}]
    this.completedSteps = [];     // [{tool, params, success, outcome, timestamp}]
    this.currentState = {};       // {page, pageTitle, lastFile, lastCommand, directory, ...}
    this.keyFindings = [];        // string[]
    this.importantContext = [];   // [{type, content, timestamp}]
    this.rotationCount = 0;
    this.totalToolCalls = 0;
    this._warmTierResults = [];
    this._previousSummaries = [];
    this.fileProgress = {};       // {filePath: {writtenLines, writtenChars, writes}}
    this.incrementalTask = null;  // {type, target, current}
  }

  setGoal(message) {
    if (!message) return;
    this.originalGoal = message.slice(0, 2000);
    this._detectIncrementalTask(message);
  }

  _detectIncrementalTask(message) {
    if (!message) return;
    const lower = message.toLowerCase();

    const lineMatch = lower.match(/(\d{3,})\s*[-]?\s*lines?/);
    if (lineMatch) {
      this.incrementalTask = { type: 'lines', target: parseInt(lineMatch[1], 10), current: 0 };
      return;
    }

    const funcMatch = lower.match(/(\d{2,})\s*(?:utility\s*)?functions?/);
    if (funcMatch) {
      this.incrementalTask = { type: 'functions', target: parseInt(funcMatch[1], 10), current: 0 };
      return;
    }

    const itemMatch = lower.match(/(\d{2,})\s*(?:items?|elements?|components?|methods?|classes?)/);
    if (itemMatch) {
      this.incrementalTask = { type: 'items', target: parseInt(itemMatch[1], 10), current: 0 };
      return;
    }
  }

  recordToolCall(toolName, params, result) {
    this.totalToolCalls++;
    const success = !result?.error;
    const outcome = this._extractOutcome(toolName, params, result);

    this.completedSteps.push({
      tool: toolName,
      params: this._compressParams(params),
      success,
      outcome,
      timestamp: Date.now(),
    });

    this._updateState(toolName, params, result);

    // Auto-compress when history gets long
    if (this.completedSteps.length > 40) {
      this._compressHistory();
    }
  }

  _extractOutcome(toolName, params, result) {
    if (!result) return 'no result';
    if (result.error) return `ERROR: ${String(result.error).slice(0, 100)}`;
    if (typeof result === 'string') return result.slice(0, 150);
    if (result.content) return String(result.content).slice(0, 150);
    return 'OK';
  }

  _compressParams(params) {
    if (!params) return {};
    const compressed = {};
    for (const [key, val] of Object.entries(params)) {
      if (typeof val === 'string' && val.length > 100) {
        compressed[key] = val.slice(0, 80) + '...';
      } else {
        compressed[key] = val;
      }
    }
    return compressed;
  }

  _updateState(toolName, params, result) {
    if (toolName === 'browser_navigate' && params?.url) {
      this.currentState.page = params.url;
    }
    if (toolName === 'write_file' || toolName === 'read_file') {
      this.currentState.lastFile = params?.path || params?.filePath;
    }
    if (toolName === 'list_directory') {
      this.currentState.directory = params?.path || params?.directory || '.';
    }
    if (toolName === 'run_command') {
      this.currentState.lastCommand = params?.command?.slice(0, 100);
    }
    this.currentState.lastAction = toolName;
    this.currentState.lastActionTime = Date.now();

    // Track file write progress
    if ((toolName === 'write_file' || toolName === 'append_to_file') && result?.success !== false) {
      const filePath = params?.filePath || params?.path;
      const content = params?.content || '';
      const lines = content.split('\n').length;
      const chars = content.length;
      if (filePath) {
        if (!this.fileProgress[filePath]) {
          this.fileProgress[filePath] = { writtenLines: 0, writtenChars: 0, writes: 0 };
        }
        if (toolName === 'write_file') {
          this.fileProgress[filePath] = { writtenLines: lines, writtenChars: chars, writes: 1 };
        } else {
          this.fileProgress[filePath].writtenLines += lines;
          this.fileProgress[filePath].writtenChars += chars;
          this.fileProgress[filePath].writes++;
        }

        // Update incremental task progress
        if (this.incrementalTask && this.incrementalTask.type === 'lines') {
          this.incrementalTask.current = Object.values(this.fileProgress)
            .reduce((sum, fp) => sum + fp.writtenLines, 0);
        }
      }
    }
  }

  _compressHistory() {
    // Keep first 5 and last 15, compress middle
    const first = this.completedSteps.slice(0, 5);
    const last = this.completedSteps.slice(-15);
    const middle = this.completedSteps.slice(5, -15);

    const compressed = middle.map(s => ({
      tool: s.tool,
      success: s.success,
      outcome: s.outcome.slice(0, 50),
      timestamp: s.timestamp,
    }));

    this.completedSteps = [...first, ...compressed, ...last];
  }

  markRotation() {
    this.rotationCount++;
    // Save current state for warm tier
    if (this.completedSteps.length > 0) {
      this._warmTierResults.push(...this.completedSteps.slice(-5));
      if (this._warmTierResults.length > 20) {
        this._warmTierResults = this._warmTierResults.slice(-20);
      }
    }
  }

  /**
   * Generate a quick summary for context rotation injection.
   */
  generateQuickSummary(activeTodos) {
    const parts = [];
    parts.push('## Session State After Context Rotation');
    if (this.originalGoal) parts.push(`**Goal:** ${this.originalGoal.slice(0, 300)}`);
    if (this.rotationCount > 0) parts.push(`**Rotations:** ${this.rotationCount}`);

    // Current state
    if (this.currentState.lastFile) parts.push(`**Last file:** ${this.currentState.lastFile}`);
    if (this.currentState.page) parts.push(`**Browser page:** ${this.currentState.page}`);

    // File progress
    const fpKeys = Object.keys(this.fileProgress);
    if (fpKeys.length > 0) {
      parts.push('**File progress:**');
      for (const fp of fpKeys) {
        const f = this.fileProgress[fp];
        parts.push(`- ${fp}: ${f.writtenLines} lines, ${f.writtenChars} chars`);
      }
    }

    // Incremental task
    if (this.incrementalTask) {
      parts.push(`**Progress:** ${this.incrementalTask.current}/${this.incrementalTask.target} ${this.incrementalTask.type}`);
    }

    // Active todos
    if (activeTodos && activeTodos.length > 0) {
      parts.push('**Plan:**');
      for (const todo of activeTodos) {
        const mark = todo.completed ? '[x]' : '[ ]';
        parts.push(`${mark} ${todo.text || todo.description || todo.title || ''}`);
      }
    }

    // Recent tool calls
    const recent = this.completedSteps.slice(-6);
    if (recent.length > 0) {
      parts.push(`**Recent actions (${this.totalToolCalls} total):**`);
      for (const s of recent) {
        parts.push(`- ${s.tool}: ${s.success ? 'ok' : 'FAIL'} — ${s.outcome.slice(0, 100)}`);
      }
    }

    return parts.join('\n');
  }
}

module.exports = { ConversationSummarizer };
