/**
 * RollingSummary — Continuous session state tracker for context management.
 *
 * Zero LLM inference cost — all template-based. Tracks:
 *  - User's original goal
 *  - Completed work (tool calls + outcomes)
 *  - File state (what was written/read)
 *  - User corrections
 *  - Key decisions
 *  - Current plan
 *
 * Provides tiered context assembly: HOT (current), WARM (recent compressed),
 * COLD (old bullets) — budget-proportional based on available tokens.
 *
 * Ported from main_backup_pre_rewrite/rollingSummary.js
 */
'use strict';

const CHARS_PER_TOKEN = 3.5;

function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

class RollingSummary {
  constructor() {
    this._goal = '';
    this._completedWork = [];   // [{tool, file, outcome, iteration}]
    this._fileState = {};       // {filePath: {lines, chars, lastAction}}
    this._userCorrections = []; // string[]
    this._keyDecisions = [];    // string[]
    this._currentPlan = '';
    this._rotationCount = 0;
    this._iterationCount = 0;
    this._fullResults = [];     // [{tool, file, success, resultText, iteration}]
  }

  setGoal(message) {
    this._goal = (message || '').slice(0, 500);
  }

  recordToolCall(toolName, params, iteration) {
    this._iterationCount = Math.max(this._iterationCount, iteration);
    const file = params?.filePath || params?.path || params?.dirPath || null;
    this._completedWork.push({ tool: toolName, file, iteration });

    // Track file state
    if (file && (toolName === 'write_file' || toolName === 'append_to_file')) {
      const content = params?.content || '';
      const lines = content.split('\n').length;
      const chars = content.length;
      if (toolName === 'write_file') {
        this._fileState[file] = { lines, chars, lastAction: 'write' };
      } else {
        if (!this._fileState[file]) this._fileState[file] = { lines: 0, chars: 0, lastAction: 'append' };
        this._fileState[file].lines += lines;
        this._fileState[file].chars += chars;
        this._fileState[file].lastAction = 'append';
      }
    }
    if (file && toolName === 'read_file') {
      if (!this._fileState[file]) this._fileState[file] = { lines: 0, chars: 0, lastAction: 'read' };
      this._fileState[file].lastAction = 'read';
    }
  }

  recordToolResult(toolName, params, result, iteration) {
    const file = params?.filePath || params?.path || null;
    const success = result?.success !== false;
    const resultText = typeof result === 'string'
      ? result.slice(0, 300)
      : JSON.stringify(result || {}).slice(0, 300);

    this._fullResults.push({ tool: toolName, file, success, resultText, iteration });

    // Cap stored results to prevent unbounded growth
    if (this._fullResults.length > 30) {
      this._fullResults = this._fullResults.slice(-30);
    }
  }

  recordUserCorrection(correction) {
    this._userCorrections.push((correction || '').slice(0, 200));
    if (this._userCorrections.length > 5) this._userCorrections.shift();
  }

  recordKeyDecision(decision) {
    this._keyDecisions.push((decision || '').slice(0, 200));
    if (this._keyDecisions.length > 10) this._keyDecisions.shift();
  }

  setPlan(plan) {
    this._currentPlan = (plan || '').slice(0, 500);
  }

  /**
   * Generate a compact summary for injection into prompts.
   * Budget-proportional: larger budgets get more detail.
   */
  generateSummary(tokenBudget) {
    const sections = [];

    if (this._goal) sections.push(`**Goal:** ${this._goal}`);

    if (this._userCorrections.length > 0) {
      sections.push(`**User corrections:** ${this._userCorrections.join('; ')}`);
    }

    // File state
    const fileKeys = Object.keys(this._fileState);
    if (fileKeys.length > 0) {
      const fileLines = fileKeys.map(fp => {
        const s = this._fileState[fp];
        return `- ${fp}: ${s.lines} lines, ${s.chars} chars (${s.lastAction})`;
      });
      sections.push(`**Files:**\n${fileLines.join('\n')}`);
    }

    if (this._currentPlan) sections.push(`**Plan:** ${this._currentPlan}`);

    if (this._keyDecisions.length > 0) {
      sections.push(`**Key decisions:** ${this._keyDecisions.join('; ')}`);
    }

    // Completed work summary
    if (this._completedWork.length > 0 && tokenBudget > 100) {
      const recent = this._completedWork.slice(-10);
      const workLines = recent.map(w => `- ${w.tool}${w.file ? '(' + w.file + ')' : ''}`);
      sections.push(`**Completed (${this._completedWork.length} total):**\n${workLines.join('\n')}`);
    }

    let summary = sections.join('\n');
    const maxChars = tokenBudget * CHARS_PER_TOKEN;
    if (summary.length > maxChars) summary = summary.slice(0, maxChars);
    return summary;
  }

  /**
   * Generate a rotation summary suitable for injection after context reset.
   */
  generateRotationSummary(activeTodos) {
    const parts = [];
    parts.push(`## Context Rotation Summary (rotation #${this._rotationCount + 1})`);
    if (this._goal) parts.push(`**Original goal:** ${this._goal}`);

    if (this._userCorrections.length > 0) {
      parts.push(`**User corrections:** ${this._userCorrections.join('; ')}`);
    }

    // File state
    const fileKeys = Object.keys(this._fileState);
    if (fileKeys.length > 0) {
      parts.push('**File state:**');
      for (const fp of fileKeys) {
        const s = this._fileState[fp];
        parts.push(`- ${fp}: ${s.lines} lines (${s.lastAction})`);
      }
    }

    // Active todos
    if (activeTodos && activeTodos.length > 0) {
      parts.push('**Active plan:**');
      for (const todo of activeTodos) {
        const mark = todo.completed ? '[x]' : '[ ]';
        parts.push(`${mark} ${todo.text || todo.description || todo.title || ''}`);
      }
    }

    // Recent work
    const recent = this._completedWork.slice(-8);
    if (recent.length > 0) {
      parts.push(`**Recent work (${this._completedWork.length} total calls):**`);
      for (const w of recent) {
        parts.push(`- iter${w.iteration}: ${w.tool}${w.file ? '(' + w.file + ')' : ''}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Assemble tiered context within a token budget.
   *
   * TIER 0: Session summary (goal, corrections, file state, plan) — 20% budget
   * TIER 1 (HOT): Current iteration feedback — always full — 55% of remaining
   * TIER 2 (WARM): Recent 4 iterations — compressed — 60% of remaining
   * TIER 3 (COLD): Old iterations — bullets only — rest of budget
   */
  assembleTieredContext(tokenBudget, currentIteration, currentFeedback) {
    let budget = tokenBudget;
    const sections = [];

    // TIER 0: Session summary
    const summaryAlloc = Math.min(Math.floor(budget * 0.20), 500);
    if (summaryAlloc > 30) {
      const summaryText = this.generateSummary(summaryAlloc);
      if (summaryText) {
        sections.push(summaryText);
        budget -= estimateTokens(summaryText);
      }
    }

    // TIER 1 (HOT): Current iteration feedback — always full
    if (currentFeedback) {
      const feedbackTokens = estimateTokens(currentFeedback);
      const hotAlloc = Math.floor(budget * 0.55);
      if (feedbackTokens <= hotAlloc) {
        sections.push(currentFeedback);
        budget -= feedbackTokens;
      } else {
        // Truncate from the start (keep most recent results)
        const maxChars = hotAlloc * CHARS_PER_TOKEN;
        const truncated = currentFeedback.length > maxChars
          ? currentFeedback.substring(currentFeedback.length - maxChars)
          : currentFeedback;
        sections.push(truncated);
        budget -= hotAlloc;
      }
    }

    // TIER 2 (WARM): Recent history — compressed (last 4 iterations, excl. current)
    const warmResults = this._fullResults.filter(r =>
      r.iteration < currentIteration && currentIteration - r.iteration <= 4
    );
    if (warmResults.length > 0 && budget > 50) {
      const warmAlloc = Math.floor(budget * 0.60);
      const warmLines = [];
      let warmTokens = 0;
      for (let i = warmResults.length - 1; i >= 0; i--) {
        const r = warmResults[i];
        const excerpt = r.resultText.substring(0, 200).replace(/\n/g, ' ');
        const line = `- [iter${r.iteration}] ${r.tool}${r.file ? '(' + r.file + ')' : ''}: ${r.success ? 'ok' : 'FAIL'} — ${excerpt}`;
        const cost = estimateTokens(line);
        if (warmTokens + cost > warmAlloc) break;
        warmLines.push(line);
        warmTokens += cost;
      }
      if (warmLines.length > 0) {
        sections.push(`### Earlier Results\n${warmLines.join('\n')}`);
        budget -= warmTokens;
      }
    }

    // TIER 3 (COLD): Old history — bullets only
    const coldResults = this._fullResults.filter(r =>
      currentIteration - r.iteration > 4
    );
    if (coldResults.length > 0 && budget > 20) {
      const coldLines = [];
      let coldTokens = 0;
      for (let i = coldResults.length - 1; i >= 0; i--) {
        const r = coldResults[i];
        const bullet = `- ${r.tool}${r.file ? '(' + r.file + ')' : ''}: ${r.success ? 'ok' : 'fail'}`;
        const cost = estimateTokens(bullet);
        if (coldTokens + cost > budget) break;
        coldLines.push(bullet);
        coldTokens += cost;
      }
      if (coldLines.length > 0) {
        sections.push(`### Previous Work\n${coldLines.join('\n')}`);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Check if a summary should be injected for the next iteration.
   */
  shouldInjectSummary(iteration, contextPct) {
    if (iteration >= 3 && this._completedWork.length >= 2) return true;
    if (contextPct > 0.30 && this._completedWork.length >= 1) return true;
    return false;
  }

  /**
   * Get token budget for the summary based on context usage.
   */
  getSummaryBudget(totalCtxTokens, contextPct) {
    if (contextPct < 0.30) return 0;
    if (contextPct < 0.50) return Math.floor(totalCtxTokens * 0.02);
    if (contextPct < 0.70) return Math.floor(totalCtxTokens * 0.04);
    return Math.floor(totalCtxTokens * 0.06);
  }

  markRotation() {
    this._rotationCount++;
  }

  toJSON() {
    return {
      goal: this._goal,
      completedWork: this._completedWork,
      fileState: this._fileState,
      userCorrections: this._userCorrections,
      keyDecisions: this._keyDecisions,
      currentPlan: this._currentPlan,
      rotationCount: this._rotationCount,
      iterationCount: this._iterationCount,
      fullResults: this._fullResults.slice(-20),
    };
  }

  static fromJSON(data) {
    const rs = new RollingSummary();
    rs._goal = data.goal || '';
    rs._completedWork = data.completedWork || [];
    rs._fileState = data.fileState || {};
    rs._userCorrections = data.userCorrections || [];
    rs._keyDecisions = data.keyDecisions || [];
    rs._currentPlan = data.currentPlan || '';
    rs._rotationCount = data.rotationCount || 0;
    rs._iterationCount = data.iterationCount || 0;
    rs._fullResults = data.fullResults || [];
    return rs;
  }
}

module.exports = { RollingSummary, estimateTokens, CHARS_PER_TOKEN };
