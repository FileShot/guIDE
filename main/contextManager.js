/**
 * guIDE — Context Manager
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 *
 * Independent module for all context management: seamless continuation,
 * context compaction, context rotation, budget tracking.
 *
 * Extracted from the old monolithic agenticChat.js to be a clean state machine
 * with clear inputs, outputs, and contracts.
 */
'use strict';

/**
 * Tracks context budget and decides when to compact or rotate.
 */
class ContextBudget {
  /**
   * @param {number} totalContextSize - Total context window in tokens
   * @param {number} systemReserve - Tokens reserved for system prompt + tool definitions
   */
  constructor(totalContextSize, systemReserve) {
    this.totalContextSize = totalContextSize;
    this.systemReserve = systemReserve;
    this.usableTokens = totalContextSize - systemReserve;
  }

  /**
   * Estimate token count from text (rough: ~3.5 chars/token for code/mixed content).
   * Not used for critical decisions — only for pre-generation estimates.
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Calculate context usage percentage from actual token count.
   * @param {number} usedTokens - Tokens currently consumed (from sequence.nTokens or estimate)
   */
  usagePercent(usedTokens) {
    return this.totalContextSize > 0 ? usedTokens / this.totalContextSize : 0;
  }

  /**
   * How many tokens are available for the model's response.
   * @param {number} usedTokens - Tokens consumed by prompt (system + history + user)
   */
  remainingForResponse(usedTokens) {
    return Math.max(0, this.totalContextSize - usedTokens);
  }

  /**
   * Determine what action is needed based on context usage.
   * @param {number} usedTokens
   * @returns {'ok'|'compact-light'|'compact-medium'|'compact-heavy'|'rotate'}
   */
  getAction(usedTokens) {
    const pct = this.usagePercent(usedTokens);
    if (pct < 0.55) return 'ok';
    if (pct < 0.70) return 'compact-light';
    if (pct < 0.80) return 'compact-medium';
    if (pct < 0.90) return 'compact-heavy';
    return 'rotate';
  }
}

/**
 * Manages seamless continuation when the model hits maxTokens mid-response.
 *
 * The key insight: when a model hits its output limit, we need to continue
 * generation. But the continuation prompt must NOT include the full accumulated
 * text (that explodes context). Instead, it includes a small tail snippet so
 * the model knows where to pick up.
 *
 * Critically: we must detect when the model RESTARTS instead of continuing.
 * If the model emits the same opening (e.g., ```json\n{"tool":"write_file") twice,
 * the second emission is a restart, not a continuation. We must detect and abort.
 */
class SeamlessContinuation {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.accumulatedText = '';
    this.isActive = false;
    this.lastPassLength = 0;
    this.consecutiveShortPasses = 0;
    this.maxContinuations = 50;
    this.lastPassPreview = '';
  }

  /**
   * Check if the current generation output indicates truncation (not a natural stop).
   * @param {string} responseText - Text generated in this pass
   * @param {string} stopReason - 'maxTokens' | 'eos' | 'cancelled' | etc.
   * @returns {boolean} True if we should continue
   */
  shouldContinue(responseText, stopReason) {
    // Natural end — model emitted EOS token
    if (stopReason === 'eos' || stopReason === 'cancelled') {
      // Exception: if we're mid-tool-call (unclosed JSON fence), continue anyway
      if (this._hasUnclosedToolFence(this.accumulatedText + responseText)) {
        console.log('[ContextMgr] EOS mid-tool-fence — treating as truncation, continuing');
        return true;
      }
      return false;
    }

    // maxTokens hit — always a candidate for continuation
    if (stopReason === 'maxTokens') {
      return true;
    }

    return false;
  }

  /**
   * Add a pass of generated text and check for forward progress.
   * @param {string} passText - Text from this generation pass
   * @returns {{continue: boolean, reason: string}}
   */
  addPass(passText) {
    this.count++;
    this.lastPassLength = passText.length;
    this.lastPassPreview = passText.substring(0, 80);

    // Forward progress check: if 3+ consecutive passes produce < 20 chars, abort
    if (passText.length < 20) {
      this.consecutiveShortPasses++;
    } else {
      this.consecutiveShortPasses = 0;
    }

    if (this.consecutiveShortPasses >= 3) {
      return { continue: false, reason: 'death-spiral: 3+ consecutive short passes' };
    }

    // Max continuations check
    if (this.count >= this.maxContinuations) {
      return { continue: false, reason: `max continuations (${this.maxContinuations}) reached` };
    }

    // Restart detection: if this pass starts with the same opening as pass 1,
    // the model is restarting instead of continuing
    if (this.count > 1 && this.accumulatedText.length > 0) {
      const firstChunk = this.accumulatedText.substring(0, 100).trim();
      const thisChunk = passText.substring(0, 100).trim();
      // If first 60+ chars match, it's a restart
      const compareLen = Math.min(60, firstChunk.length, thisChunk.length);
      if (compareLen > 30 && firstChunk.substring(0, compareLen) === thisChunk.substring(0, compareLen)) {
        return { continue: false, reason: 'restart-detected: model restarted from beginning instead of continuing' };
      }
    }

    this.accumulatedText += passText;
    this.isActive = true;

    return { continue: true, reason: 'ok' };
  }

  /**
   * Build the continuation prompt — a small tail of the accumulated text
   * that tells the model where to pick up.
   *
   * KEY DIFFERENCE from old code: we include enough context (500 chars, not 200)
   * and we frame it explicitly so the model knows this is a continuation.
   */
  buildContinuationPrompt() {
    const tailLen = Math.min(500, this.accumulatedText.length);
    const tail = this.accumulatedText.slice(-tailLen);
    return `Continue your response from exactly where you left off. Your previous output ended with:\n\n${tail}\n\nContinue immediately from that point. Do not restart or repeat any content.`;
  }

  /**
   * Get the full accumulated text from all passes.
   */
  getAccumulatedText() {
    return this.accumulatedText;
  }

  /**
   * Check if the accumulated text has an unclosed tool call fence.
   */
  hasUnclosedToolFence() {
    return this._hasUnclosedToolFence(this.accumulatedText);
  }

  _hasUnclosedToolFence(text) {
    if (!text) return false;
    // Look for ```json or ```tool_call that isn't closed
    const fencePattern = /```(?:json|tool_call|tool)\s*\n/g;
    let lastFenceIdx = -1;
    let match;
    while ((match = fencePattern.exec(text)) !== null) {
      lastFenceIdx = match.index;
    }
    if (lastFenceIdx === -1) return false;
    // Check if there's a closing ``` after the last opening fence
    const afterFence = text.substring(lastFenceIdx + 3);
    const closingIdx = afterFence.indexOf('\n```');
    return closingIdx === -1;
  }
}

/**
 * Context Compaction — reduces conversation history to free token budget.
 *
 * 4-phase system:
 * - Phase 1 (light): Compress old tool results (keep summary only)
 * - Phase 2 (medium): Prune old conversation history (keep first + last N messages)
 * - Phase 3 (heavy): Compress ALL results, truncate long content
 * - Phase 4 (rotate): Signal that rotation is needed
 */
class ContextCompactor {
  /**
   * Apply compaction to chat history based on the action level.
   * @param {Array} chatHistory - Array of {role, content} messages
   * @param {Array} toolResults - Array of tool result objects from this session
   * @param {string} action - 'compact-light' | 'compact-medium' | 'compact-heavy'
   * @param {number} currentIteration - Current agentic iteration number
   * @returns {{history: Array, toolResults: Array, freedEstimate: number}}
   */
  compact(chatHistory, toolResults, action, currentIteration) {
    let freedEstimate = 0;

    if (action === 'compact-light') {
      freedEstimate += this._compressOldToolResults(toolResults, currentIteration, 3);
    }

    if (action === 'compact-medium') {
      freedEstimate += this._compressOldToolResults(toolResults, currentIteration, 1);
      freedEstimate += this._pruneHistory(chatHistory, 6);
    }

    if (action === 'compact-heavy') {
      freedEstimate += this._compressAllToolResults(toolResults);
      freedEstimate += this._pruneHistory(chatHistory, 3);
      freedEstimate += this._truncateLongContent(chatHistory, 8000);
    }

    return { history: chatHistory, toolResults, freedEstimate };
  }

  /**
   * Compress tool results older than N iterations.
   * Replaces verbose content with a one-line summary.
   */
  _compressOldToolResults(toolResults, currentIteration, keepRecent) {
    let freed = 0;
    for (let i = 0; i < toolResults.length; i++) {
      const r = toolResults[i];
      if (r._compressed) continue;
      const age = currentIteration - (r._iteration || 0);
      if (age < keepRecent) continue;

      const originalSize = JSON.stringify(r.result || '').length;
      const tool = r.tool || 'unknown';
      const summary = this._summarizeToolResult(tool, r.result);
      r.result = { _compressed: true, summary };
      r._compressed = true;
      freed += originalSize - summary.length;
    }
    return Math.max(0, freed);
  }

  /**
   * Compress ALL tool results except the last 2.
   */
  _compressAllToolResults(toolResults) {
    let freed = 0;
    const keepCount = Math.min(2, toolResults.length);
    for (let i = 0; i < toolResults.length - keepCount; i++) {
      const r = toolResults[i];
      if (r._compressed) continue;
      const originalSize = JSON.stringify(r.result || '').length;
      const summary = this._summarizeToolResult(r.tool || 'unknown', r.result);
      r.result = { _compressed: true, summary };
      r._compressed = true;
      freed += originalSize - summary.length;
    }
    return Math.max(0, freed);
  }

  /**
   * Prune conversation history, keeping first message + last N messages.
   */
  _pruneHistory(chatHistory, keepLastN) {
    if (chatHistory.length <= keepLastN + 1) return 0;
    const removed = chatHistory.splice(1, chatHistory.length - keepLastN - 1);
    let freed = 0;
    for (const msg of removed) {
      freed += (msg.content || '').length;
    }
    return freed;
  }

  /**
   * Truncate any message content longer than maxLen.
   */
  _truncateLongContent(chatHistory, maxLen) {
    let freed = 0;
    for (const msg of chatHistory) {
      if (typeof msg.content === 'string' && msg.content.length > maxLen) {
        freed += msg.content.length - maxLen;
        msg.content = msg.content.substring(0, maxLen) + '\n\n[Content truncated to save context space]';
      }
    }
    return freed;
  }

  /**
   * Create a human-readable summary of a tool result.
   */
  _summarizeToolResult(tool, result) {
    if (!result) return `${tool}: no result`;
    if (result._compressed) return result.summary || `${tool}: compressed`;

    if (tool === 'read_file') {
      const lines = (result.content || '').split('\n').length;
      return `read_file: read ${result.filePath || 'file'} (${lines} lines)`;
    }
    if (tool === 'write_file') {
      return `write_file: wrote ${result.filePath || 'file'} (${result.success ? 'success' : 'failed'})`;
    }
    if (tool === 'edit_file') {
      return `edit_file: edited ${result.filePath || 'file'} (${result.success ? 'success' : 'failed'})`;
    }
    if (tool === 'run_command') {
      const output = (result.stdout || result.output || '').substring(0, 100);
      return `run_command: ${result.exitCode === 0 ? 'success' : 'failed'} — ${output}`;
    }
    if (tool === 'list_directory') {
      const count = Array.isArray(result.files) ? result.files.length : '?';
      return `list_directory: ${count} items in ${result.path || 'directory'}`;
    }
    if (tool === 'web_search') {
      const count = Array.isArray(result.results) ? result.results.length : '?';
      return `web_search: ${count} results`;
    }
    if (tool === 'browser_snapshot') {
      return `browser_snapshot: page snapshot taken`;
    }

    // Generic summary
    const str = JSON.stringify(result);
    if (str.length <= 200) return `${tool}: ${str}`;
    return `${tool}: result (${str.length} chars)`;
  }
}

/**
 * Context Rotation — when compaction isn't enough, start a fresh context
 * with a summary of what happened.
 */
class ContextRotator {
  constructor() {
    this.rotationCount = 0;
    this.filesWritten = new Map(); // filePath → content hash, for write deduplication
    this.maxRotations = 10;
  }

  /**
   * Reset rotation state (call when a new user message arrives).
   */
  resetForNewMessage() {
    this.rotationCount = 0;
    // Don't clear filesWritten — we need to track across the whole conversation
  }

  /**
   * Record a file write for deduplication after rotation.
   */
  recordFileWrite(filePath, contentLength) {
    const existing = this.filesWritten.get(filePath) || 0;
    this.filesWritten.set(filePath, existing + 1);
  }

  /**
   * Check if a file write should be blocked (already written too many times).
   * @returns {boolean} True if the write should be blocked
   */
  shouldBlockWrite(filePath) {
    return (this.filesWritten.get(filePath) || 0) >= 3;
  }

  /**
   * Check if we can still rotate.
   */
  canRotate() {
    return this.rotationCount < this.maxRotations;
  }

  /**
   * Perform rotation: generate a summary and build a fresh history.
   * @param {Array} chatHistory - Current chat history
   * @param {Array} toolResults - Tool results from this session
   * @param {string} originalUserMessage - The user's original request
   * @param {Function} summarizeFn - async (messages) => summaryText
   * @returns {{history: Array, summary: string}}
   */
  async rotate(chatHistory, toolResults, originalUserMessage, summarizeFn) {
    this.rotationCount++;
    console.log(`[ContextMgr] Context rotation #${this.rotationCount} — generating summary`);

    // Build a summary of what's been done
    const filesWrittenList = Array.from(this.filesWritten.entries())
      .map(([path, count]) => `  - ${path} (${count}x)`)
      .join('\n');

    const workSummary = this._buildWorkSummary(toolResults);

    let summary = '';
    if (summarizeFn) {
      try {
        summary = await summarizeFn(chatHistory);
      } catch (e) {
        console.warn('[ContextMgr] Summary generation failed, using fallback:', e.message);
      }
    }

    if (!summary) {
      // Fallback: extractive summary from history
      summary = this._extractiveSummary(chatHistory);
    }

    // Build the rotation context that goes into the fresh history
    const rotationContext = [
      `CONTEXT ROTATION: This is continuation #${this.rotationCount} of the current task.`,
      '',
      `ORIGINAL USER REQUEST: ${originalUserMessage}`,
      '',
      `WORK COMPLETED SO FAR:`,
      workSummary,
      '',
      filesWrittenList ? `FILES WRITTEN:\n${filesWrittenList}` : '',
      '',
      `PREVIOUS CONVERSATION SUMMARY:`,
      summary,
      '',
      `IMPORTANT: Do NOT redo any work listed above. Continue from where you left off.`,
      `Do NOT re-create files that have already been written.`,
    ].filter(Boolean).join('\n');

    // Fresh history: just the rotation context as system context + the user message
    const freshHistory = [
      { role: 'user', content: rotationContext },
      { role: 'assistant', content: 'Understood. I will continue from where I left off without redoing completed work.' },
      { role: 'user', content: originalUserMessage + '\n\n(Continue from where you left off — see context rotation summary above.)' },
    ];

    return { history: freshHistory, summary: rotationContext };
  }

  _buildWorkSummary(toolResults) {
    if (!toolResults || toolResults.length === 0) return 'No tools executed yet.';

    const summaries = [];
    for (const r of toolResults) {
      const tool = r.tool || 'unknown';
      if (tool === 'write_file') {
        summaries.push(`- Created/wrote file: ${r.params?.filePath || 'unknown'}`);
      } else if (tool === 'edit_file') {
        summaries.push(`- Edited file: ${r.params?.filePath || 'unknown'}`);
      } else if (tool === 'read_file') {
        summaries.push(`- Read file: ${r.params?.filePath || 'unknown'}`);
      } else if (tool === 'run_command') {
        summaries.push(`- Ran command: ${(r.params?.command || 'unknown').substring(0, 80)}`);
      } else if (tool === 'web_search') {
        summaries.push(`- Searched web: ${r.params?.query || 'unknown'}`);
      } else {
        summaries.push(`- ${tool}: ${JSON.stringify(r.params || {}).substring(0, 80)}`);
      }
    }
    return summaries.join('\n');
  }

  _extractiveSummary(chatHistory) {
    const parts = [];
    for (const msg of chatHistory) {
      if (msg.role === 'assistant' && msg.content) {
        // Take first 200 chars of each assistant message
        const preview = msg.content.substring(0, 200).trim();
        if (preview) parts.push(preview);
      }
    }
    return parts.join('\n---\n').substring(0, 2000);
  }
}

/**
 * Content Salvage — attempt to recover usable content from truncated tool calls.
 *
 * When continuation is aborted (context budget exceeded), we try to salvage
 * any partial write_file content so the work isn't completely lost.
 */
class ContentSalvager {
  /**
   * Attempt to salvage a write_file tool call from truncated text.
   * @param {string} text - The accumulated (possibly truncated) text
   * @returns {{filePath: string, content: string}|null}
   */
  salvageWriteFile(text) {
    if (!text) return null;

    // Look for write_file in any format
    const filePathMatch = text.match(/"filePath"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const contentMatch = text.match(/"content"\s*:\s*"/);

    if (!filePathMatch || !contentMatch) return null;

    const filePath = filePathMatch[1];
    const contentStart = contentMatch.index + contentMatch[0].length;

    // Extract content from the start match to the end (or to the closing quote)
    let content = '';
    let i = contentStart;
    let escaped = false;
    while (i < text.length) {
      const ch = text[i];
      if (escaped) {
        // Handle escape sequences
        switch (ch) {
          case 'n': content += '\n'; break;
          case 't': content += '\t'; break;
          case 'r': content += '\r'; break;
          case '"': content += '"'; break;
          case '\\': content += '\\'; break;
          case '/': content += '/'; break;
          default: content += '\\' + ch; break;
        }
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        break; // End of content string
      } else {
        content += ch;
      }
      i++;
    }

    if (content.length < 10) return null; // Too short to be useful

    console.log(`[ContextMgr] Salvaged ${content.length} chars of write_file content for "${filePath}"`);
    return { filePath, content };
  }
}

/**
 * The main ContextManager — composes all the sub-systems.
 *
 * Used by the agentic loop to manage context across iterations.
 */
class ContextManager {
  /**
   * @param {number} totalContextSize - Total context window in tokens
   * @param {number} systemReserve - Tokens reserved for system prompt + tool definitions
   */
  constructor(totalContextSize, systemReserve) {
    this.budget = new ContextBudget(totalContextSize, systemReserve);
    this.continuation = new SeamlessContinuation();
    this.compactor = new ContextCompactor();
    this.rotator = new ContextRotator();
    this.salvager = new ContentSalvager();

    // Track tool results across the session for compaction
    this.toolResults = [];
    this.currentIteration = 0;
    this.originalUserMessage = '';
    // Wall-clock timeout for the entire agentic loop (15 minutes)
    this.wallClockTimeout = 15 * 60 * 1000;
    this.startTime = 0;
  }

  /**
   * Initialize for a new user message.
   */
  startNewMessage(userMessage) {
    this.originalUserMessage = userMessage;
    this.currentIteration = 0;
    this.toolResults = [];
    this.continuation.reset();
    this.rotator.resetForNewMessage();
    this.startTime = Date.now();
  }

  /**
   * Check if the wall-clock timeout has been exceeded.
   */
  isTimedOut() {
    return Date.now() - this.startTime > this.wallClockTimeout;
  }

  /**
   * Advance to the next iteration.
   */
  nextIteration() {
    this.currentIteration++;
  }

  /**
   * Record a tool result.
   */
  addToolResult(toolCall) {
    toolCall._iteration = this.currentIteration;
    this.toolResults.push(toolCall);

    // Track file writes for deduplication
    if (toolCall.tool === 'write_file' && toolCall.params?.filePath) {
      this.rotator.recordFileWrite(
        toolCall.params.filePath,
        (toolCall.params.content || '').length
      );
    }
  }

  /**
   * Pre-generation check: should we compact or rotate before generating?
   * @param {number} estimatedTokens - Estimated prompt tokens
   * @param {Array} chatHistory - Current chat history
   * @param {Function} summarizeFn - For rotation
   * @returns {{proceed: boolean, chatHistory: Array, rotated: boolean}}
   */
  async preGenerationCheck(estimatedTokens, chatHistory, summarizeFn) {
    const action = this.budget.getAction(estimatedTokens);

    if (action === 'ok') {
      return { proceed: true, chatHistory, rotated: false };
    }

    if (action === 'rotate') {
      if (!this.rotator.canRotate()) {
        console.warn('[ContextMgr] Max rotations reached — cannot rotate further');
        return { proceed: false, chatHistory, rotated: false };
      }
      const { history } = await this.rotator.rotate(
        chatHistory, this.toolResults, this.originalUserMessage, summarizeFn
      );
      return { proceed: true, chatHistory: history, rotated: true };
    }

    // Compact
    console.log(`[ContextMgr] Pre-gen compaction: ${action} (usage: ${Math.round(this.budget.usagePercent(estimatedTokens) * 100)}%)`);
    this.compactor.compact(chatHistory, this.toolResults, action, this.currentIteration);
    return { proceed: true, chatHistory, rotated: false };
  }

  /**
   * Handle end-of-generation: decide whether to seamlessly continue.
   * @param {string} passText - Text generated in this pass
   * @param {string} stopReason - Why generation stopped
   * @param {number} currentContextTokens - Current context usage in tokens
   * @returns {{action: 'done'|'continue'|'rotate'|'salvage', text: string, reason: string, continuationPrompt: string|null, salvaged: object|null}}
   */
  handleGenerationEnd(passText, stopReason, currentContextTokens) {
    // Check if we should continue
    if (!this.continuation.shouldContinue(passText, stopReason)) {
      // Natural end — accumulate final pass if we were in continuation mode
      if (this.continuation.isActive) {
        this.continuation.accumulatedText += passText;
        return {
          action: 'done',
          text: this.continuation.getAccumulatedText(),
          reason: 'natural-end-after-continuation',
          continuationPrompt: null,
          salvaged: null,
        };
      }
      return {
        action: 'done',
        text: passText,
        reason: 'natural-end',
        continuationPrompt: null,
        salvaged: null,
      };
    }

    // maxTokens hit — attempt continuation
    const progress = this.continuation.addPass(passText);

    if (!progress.continue) {
      // Continuation aborted (death spiral, restart detected, max reached)
      console.log(`[ContextMgr] Continuation aborted: ${progress.reason}`);
      const accumulated = this.continuation.getAccumulatedText();

      // Try to salvage partial content
      if (this.continuation.hasUnclosedToolFence()) {
        const salvaged = this.salvager.salvageWriteFile(accumulated);
        if (salvaged) {
          return {
            action: 'salvage',
            text: accumulated,
            reason: progress.reason,
            continuationPrompt: null,
            salvaged,
          };
        }
      }

      return {
        action: 'done',
        text: accumulated,
        reason: `continuation-aborted: ${progress.reason}`,
        continuationPrompt: null,
        salvaged: null,
      };
    }

    // Check context budget before continuing
    const budgetAction = this.budget.getAction(currentContextTokens);
    if (budgetAction === 'rotate') {
      console.log(`[ContextMgr] Context at ${Math.round(this.budget.usagePercent(currentContextTokens) * 100)}% — cannot continue, need rotation`);
      const accumulated = this.continuation.getAccumulatedText();

      // Try salvage before rotating
      if (this.continuation.hasUnclosedToolFence()) {
        const salvaged = this.salvager.salvageWriteFile(accumulated);
        if (salvaged) {
          return {
            action: 'salvage',
            text: accumulated,
            reason: 'context-budget-exceeded-with-salvage',
            continuationPrompt: null,
            salvaged,
          };
        }
      }

      return {
        action: 'rotate',
        text: accumulated,
        reason: 'context-budget-exceeded',
        continuationPrompt: null,
        salvaged: null,
      };
    }

    // Continue generation
    const continuationPrompt = this.continuation.buildContinuationPrompt();
    console.log(`[ContextMgr] Seamless continuation ${this.continuation.count}/${this.continuation.maxContinuations} — ${passText.length} chars this pass, ${this.continuation.accumulatedText.length} total`);

    return {
      action: 'continue',
      text: this.continuation.getAccumulatedText(),
      reason: 'continuing',
      continuationPrompt,
      salvaged: null,
    };
  }

  /**
   * Reset continuation state (call when starting a new generation, not a continuation).
   */
  resetContinuation() {
    this.continuation.reset();
  }

  /**
   * Get the full accumulated text (from continuations or single-pass).
   */
  getAccumulatedText() {
    return this.continuation.isActive ? this.continuation.getAccumulatedText() : '';
  }
}

module.exports = {
  ContextManager,
  ContextBudget,
  SeamlessContinuation,
  ContextCompactor,
  ContextRotator,
  ContentSalvager,
};
