'use strict';

/**
 * RollingSummary — Continuous session state tracker for context management.
 * 
 * Unlike ConversationSummarizer (which generates summaries only at rotation),
 * RollingSummary updates EVERY iteration and produces budget-proportional
 * summaries for injection into every prompt after the first few iterations.
 * 
 * Template-based (zero LLM inference cost) — critical for 4GB GPU users.
 * 
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */

const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

class RollingSummary {
  constructor() {
    this.reset();
  }

  reset() {
    this._goal = '';
    this._completedWork = [];      // [{tool, file, outcome, iteration}]
    this._fileState = {};           // {filePath: {lines, chars, writes, lastAction}}
    this._userCorrections = [];    // string[]
    this._keyDecisions = [];       // string[]
    this._currentPlan = '';
    this._rotationCount = 0;
    this._lastSummary = '';
    this._lastSummaryTokens = 0;
    this._iterationCount = 0;
  }

  /**
   * Set the original user goal.
   */
  setGoal(message) {
    if (message) this._goal = message.substring(0, 2000);
  }

  /**
   * Record a completed tool call.
   */
  recordToolCall(toolName, params, result, iteration) {
    this._iterationCount = iteration || this._iterationCount;
    const success = result?.success !== false && !result?.error;
    const filePath = params?.filePath || params?.path || '';

    this._completedWork.push({
      tool: toolName,
      file: filePath ? filePath.split(/[/\\]/).pop() : '',
      outcome: success ? 'ok' : (result?.error || 'failed').substring(0, 80),
      iteration: iteration || this._iterationCount,
    });

    // Cap at 100, keep recent
    if (this._completedWork.length > 100) {
      this._completedWork = this._completedWork.slice(-80);
    }

    // Track file state for write operations
    if (filePath && /^(write_file|append_to_file|edit_file)$/.test(toolName)) {
      const content = params?.content || '';
      const lines = content ? content.split('\n').length : 0;
      const chars = content.length;

      if (!this._fileState[filePath]) {
        this._fileState[filePath] = { lines: 0, chars: 0, writes: 0, lastAction: '' };
      }

      const fs = this._fileState[filePath];
      if (toolName === 'write_file') {
        fs.lines = lines;
        fs.chars = chars;
      } else {
        fs.lines += lines;
        fs.chars += chars;
      }
      fs.writes++;
      fs.lastAction = `${toolName} at iteration ${iteration || this._iterationCount}`;
    }
  }

  /**
   * Record a user correction or important instruction.
   */
  recordUserCorrection(message) {
    if (!message) return;
    const correctionPatterns = /\b(no,?\s*i\s*meant|actually|instead|don'?t|always|never|must|should not|shouldn'?t)\b/i;
    if (correctionPatterns.test(message)) {
      this._userCorrections.push(message.substring(0, 500));
      if (this._userCorrections.length > 10) this._userCorrections = this._userCorrections.slice(-10);
    }
  }

  /**
   * Extract plan steps from model response text.
   */
  recordPlanFromResponse(responseText) {
    if (!responseText || responseText.length < 50) return;
    const planRegex = /(?:^|\n)\s*(?:\d+[\.\)]\s*|[-*]\s+)(.{5,200})/g;
    const matches = [];
    let m;
    while ((m = planRegex.exec(responseText)) !== null) {
      matches.push(m[1].trim());
    }
    if (matches.length >= 2) {
      this._currentPlan = matches.slice(0, 8).join('\n');
    }
  }

  // ─── Summary Generation ───

  /**
   * Generate a context-proportional summary for prompt injection.
   * @param {number} tokenBudget - Max tokens to spend on the summary
   * @returns {string} Summary text (empty string if nothing to summarize)
   */
  generateSummary(tokenBudget) {
    if (this._completedWork.length === 0 && !this._goal) return '';
    if (!tokenBudget || tokenBudget < 30) return '';

    // Build sections in priority order (goal and corrections are highest priority)
    const sections = [];
    let budget = tokenBudget;

    // 1. Goal (always first, always included if it fits)
    if (this._goal) {
      const goalText = `GOAL: ${this._goal.substring(0, Math.min(300, budget * CHARS_PER_TOKEN))}`;
      const cost = estimateTokens(goalText);
      if (cost <= budget) { sections.push(goalText); budget -= cost; }
    }

    // 2. User corrections (critical — never sacrifice these)
    if (this._userCorrections.length > 0 && budget > 30) {
      const maxCorr = budget > 200 ? 5 : 3;
      const corrText = `USER INSTRUCTIONS: ${this._userCorrections.slice(-maxCorr).map(c => c.substring(0, 150)).join(' | ')}`;
      const cost = estimateTokens(corrText);
      if (cost <= budget) { sections.push(corrText); budget -= cost; }
    }

    // 3. File progress (critical for continuation coherence)
    const fileKeys = Object.keys(this._fileState);
    if (fileKeys.length > 0 && budget > 30) {
      const fileEntries = fileKeys.map(fp => {
        const name = fp.split(/[/\\]/).pop();
        const state = this._fileState[fp];
        return `${name}(${state.lines}L/${state.writes}w)`;
      });
      const fileText = `FILES: ${fileEntries.join(', ')}`;
      const cost = estimateTokens(fileText);
      if (cost <= budget) { sections.push(fileText); budget -= cost; }
    }

    // 4. Work summary (compressed by file)
    if (this._completedWork.length > 0 && budget > 50) {
      const byFile = {};
      const noFile = [];
      for (const w of this._completedWork) {
        if (w.file) {
          if (!byFile[w.file]) byFile[w.file] = [];
          byFile[w.file].push(w);
        } else {
          noFile.push(w);
        }
      }

      const workLines = [];
      for (const [file, entries] of Object.entries(byFile)) {
        const tools = [...new Set(entries.map(e => e.tool))].join(',');
        workLines.push(`${file}: ${tools}(${entries.length}x)`);
      }
      if (noFile.length > 0) {
        const toolCounts = {};
        for (const w of noFile) toolCounts[w.tool] = (toolCounts[w.tool] || 0) + 1;
        for (const [tool, count] of Object.entries(toolCounts)) {
          workLines.push(`${tool}: ${count}x`);
        }
      }

      const workText = `DONE(${this._completedWork.length} calls): ${workLines.slice(-10).join('; ')}`;
      const cost = estimateTokens(workText);
      if (cost <= budget) { sections.push(workText); budget -= cost; }
    }

    // 5. Current plan (if budget allows)
    if (this._currentPlan && budget > 40) {
      const planText = `PLAN:\n${this._currentPlan.substring(0, budget * CHARS_PER_TOKEN)}`;
      const cost = estimateTokens(planText);
      if (cost <= budget) { sections.push(planText); budget -= cost; }
    }

    if (sections.length === 0) return '';

    const summary = `## Session Context\n${sections.join('\n')}`;
    this._lastSummary = summary;
    this._lastSummaryTokens = estimateTokens(summary);
    return summary;
  }

  /**
   * Generate a comprehensive rotation summary.
   * Used when hard rotation fires — more detail than normal injection.
   */
  generateRotationSummary(activeTodos) {
    this._rotationCount++;
    const sections = [];

    if (this._goal) {
      sections.push(`## TASK GOAL\n${this._goal}`);
    }

    if (this._userCorrections.length > 0) {
      sections.push(`## USER INSTRUCTIONS\n${this._userCorrections.map(c => `- ${c}`).join('\n')}`);
    }

    if (this._currentPlan) {
      sections.push(`## CURRENT APPROACH\n${this._currentPlan}`);
    }

    const fileKeys = Object.keys(this._fileState);
    if (fileKeys.length > 0) {
      const fileLines = fileKeys.map(fp => {
        const state = this._fileState[fp];
        return `- ${fp}: ${state.lines} lines (${state.chars} chars) in ${state.writes} write(s)`;
      });
      sections.push(`## FILE PROGRESS\n${fileLines.join('\n')}\nUse append_to_file to continue adding content.`);
    }

    if (this._completedWork.length > 0) {
      const recent = this._completedWork.slice(-20);
      const workLines = recent.map(w => {
        const file = w.file ? ` (${w.file})` : '';
        return `- ${w.tool}${file}: ${w.outcome}`;
      });
      sections.push(`## COMPLETED WORK (${this._completedWork.length} total, last ${recent.length})\n${workLines.join('\n')}`);
    }

    if (this._rotationCount > 1) {
      sections.push(`## CONTEXT ROTATIONS\nThis is rotation #${this._rotationCount}. Continue from where you left off.`);
    }

    if (activeTodos && activeTodos.length > 0) {
      const todoLines = activeTodos
        .filter(t => t.status !== 'done')
        .map(t => `- [${t.status === 'in-progress' ? 'IN PROGRESS' : 'PENDING'}] ${t.text}`)
        .join('\n');
      if (todoLines) sections.push(`## ACTIVE TASKS\n${todoLines}`);
    }

    sections.push(`## INSTRUCTION\nContinue the task. Do not repeat completed work. Do not refuse.`);

    return sections.join('\n\n');
  }

  /**
   * Check if we should inject a summary into the next prompt.
   * Returns true after iteration 3 or when meaningful work has been done.
   */
  shouldInjectSummary(iteration, contextPct) {
    // Always inject after 3+ iterations with tool calls
    if (iteration >= 3 && this._completedWork.length >= 2) return true;
    // Inject when context is getting full (even early) to preserve coherence
    if (contextPct > 0.30 && this._completedWork.length >= 1) return true;
    return false;
  }

  /**
   * Get token budget for the summary based on context usage.
   * As context fills, we give MORE budget to the summary (it becomes more important).
   */
  getSummaryBudget(totalCtxTokens, contextPct) {
    if (contextPct < 0.30) return 0;
    if (contextPct < 0.50) return Math.floor(totalCtxTokens * 0.02); // ~2% = ~650 tokens for 32K
    if (contextPct < 0.70) return Math.floor(totalCtxTokens * 0.04); // ~4% = ~1300 tokens for 32K
    return Math.floor(totalCtxTokens * 0.06); // ~6% = ~1950 tokens for 32K
  }

  /**
   * Mark a rotation occurred. Preserves state across the rotation.
   */
  markRotation() {
    // Rolling summary intentionally survives rotation — that's the point.
    // The ConversationSummarizer handles warm-tier results.
    this._rotationCount++;
  }

  // ─── Serialization ───

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
    return rs;
  }
}

module.exports = { RollingSummary, estimateTokens, CHARS_PER_TOKEN };
