/**
 * conversationSummarizer.js — Structured conversation summarization for context rotation.
 * 
 * Maintains a running "task ledger" that survives context rotations without losing
 * critical information about what's been done and what remains.
 * 
 * Instead of trying to compress raw conversation text (lossy, fragile), this tracks
 * structured data: goals, completed steps, current state, and pending work.
 * Works for both local and cloud models.
 */

class ConversationSummarizer {
  constructor() {
    this.reset();
  }

  reset() {
    this.originalGoal = '';          // User's original message, preserved verbatim
    this.taskPlan = [];              // Planned steps (if model outlined them)
    this.completedSteps = [];        // [{step, tool, outcome, timestamp}]
    this.currentState = {};          // {page, file, directory, lastAction, ...}
    this.pendingSteps = [];          // Steps still to do
    this.keyFindings = [];           // Important discoveries (errors, data, page content)
    this.rotationCount = 0;         // How many times context has been rotated
    this.totalToolCalls = 0;        // Running count across all rotations
    this.importantContext = [];      // User corrections, preferences, constraints
    this.lastAssistantSummary = ''; // Last natural-language summary from the model
    this._iterationsSinceUpdate = 0;
  }

  /**
   * Set the original user goal. Called once at the start of a chat.
   */
  setGoal(message) {
    this.originalGoal = message.substring(0, 2000); // Cap to prevent bloat
  }

  /**
   * Record a completed tool call and its outcome.
   * This is the primary way the ledger stays up to date.
   */
  recordToolCall(toolName, params, result) {
    this.totalToolCalls++;
    
    const step = {
      tool: toolName,
      params: this._compressParams(toolName, params),
      success: result?.success !== false,
      outcome: this._extractOutcome(toolName, params, result),
      timestamp: Date.now(),
    };
    
    this.completedSteps.push(step);
    
    // Update current state based on the tool action
    this._updateState(toolName, params, result);
    
    // Extract key findings from tool results
    this._extractFindings(toolName, result);
    
    // Keep completed steps bounded — compress old ones
    if (this.completedSteps.length > 40) {
      this._compressHistory();
    }
  }

  /**
   * Record when model outputs a plan or checklist.
   * Parses numbered lists, bullet points, or step descriptions.
   */
  recordPlan(responseText) {
    // Look for numbered steps or bullet points that look like a plan
    const planPatterns = [
      /(?:^|\n)\s*(?:\d+[.)]\s*|[-*]\s*(?:Step\s*\d+:?\s*)?)((?:First|Next|Then|After|Finally|Navigate|Open|Click|Type|Create|Edit|Read|Search|Write|Build|Check|Verify|Submit|Download|Upload|Run|Install|Configure|Set up)[^\n]{10,})/gim,
      /(?:^|\n)\s*(?:Step\s*\d+:?\s*)(.*)/gim,
    ];
    
    for (const pattern of planPatterns) {
      const matches = [...responseText.matchAll(pattern)];
      if (matches.length >= 2) {
        this.taskPlan = matches.map((m, i) => ({
          index: i,
          description: m[1].trim().substring(0, 200),
          completed: false,
        }));
        break;
      }
    }
  }

  /**
   * Record important user corrections or constraints.
   * These MUST survive summarization — they're the model's "memory."
   */
  recordUserContext(message) {
    // Detect corrections: "no, I meant...", "not that, I want...", "actually..."
    const correctionPatterns = /\b(no[,.]?\s+(?:I\s+(?:meant|want)|that's\s+not)|actually[,.]?\s+|instead[,.]?\s+|don't\s+(?:do\s+that|forget)|make\s+sure\s+(?:to|you)|remember\s+(?:to|that)|important[:]?\s+|never\s+|always\s+|stop\s+)/i;
    
    if (correctionPatterns.test(message)) {
      this.importantContext.push({
        type: 'correction',
        content: message.substring(0, 500),
        timestamp: Date.now(),
      });
    }
    
    // Also track follow-up instructions in multi-turn conversations
    if (this.totalToolCalls > 0 && message.length > 20) {
      // This is a follow-up message during an active task
      this.importantContext.push({
        type: 'follow-up',
        content: message.substring(0, 500),
        timestamp: Date.now(),
      });
    }
    
    // Keep bounded
    if (this.importantContext.length > 10) {
      this.importantContext = this.importantContext.slice(-10);
    }
  }

  /**
   * Mark a context rotation event. 
   */
  markRotation() {
    this.rotationCount++;
    this._iterationsSinceUpdate = 0;
  }

  /**
   * Generate the structured summary for injection into a fresh context.
   * This is what the model sees after a context rotation.
   * 
   * @param {Object} options
   * @param {number} options.maxTokens - Approximate token budget for the summary
   * @param {boolean} options.includeAllSteps - Include full step history vs compressed
   * @returns {string} The summary text to inject
   */
  generateSummary(options = {}) {
    const maxChars = (options.maxTokens || 2000) * 4; // ~4 chars per token
    let parts = [];
    
    // 1. Original goal — ALWAYS included, verbatim
    if (this.originalGoal) {
      parts.push(`## TASK GOAL (from user)\n${this.originalGoal}`);
    }
    
    // 2. User corrections and constraints — ALWAYS included
    if (this.importantContext.length > 0) {
      const corrections = this.importantContext
        .map(c => `- [${c.type}] ${c.content}`)
        .join('\n');
      parts.push(`## USER INSTRUCTIONS & CORRECTIONS\n${corrections}`);
    }
    
    // 3. Task progress — what's been done
    if (this.completedSteps.length > 0) {
      const progressSection = this._formatProgress();
      parts.push(`## COMPLETED WORK (${this.totalToolCalls} total tool calls, ${this.rotationCount} context rotations)\n${progressSection}`);
    }
    
    // 4. Current state — where we are right now
    const stateSection = this._formatCurrentState();
    if (stateSection) {
      parts.push(`## CURRENT STATE\n${stateSection}`);
    }
    
    // 5. Key findings — important data discovered during execution
    if (this.keyFindings.length > 0) {
      const findings = this.keyFindings.slice(-8)
        .map(f => `- ${f}`)
        .join('\n');
      parts.push(`## KEY FINDINGS\n${findings}`);
    }
    
    // 6. Pending work (from plan)
    const pending = this.taskPlan.filter(s => !s.completed);
    if (pending.length > 0) {
      const pendingText = pending
        .map((s, i) => `${i + 1}. ${s.description}`)
        .join('\n');
      parts.push(`## REMAINING STEPS\n${pendingText}`);
    }
    
    // 7. Continuation instruction
    parts.push(`## INSTRUCTION\nContext was summarized after ${this.totalToolCalls} tool calls (rotation #${this.rotationCount}). Continue the task from where you left off. Do NOT repeat completed work. Make your next tool call to continue progress.`);
    
    // Assemble and trim to budget
    let summary = parts.join('\n\n');
    if (summary.length > maxChars) {
      // Trim completed steps first (they're the most compressible)
      this._compressHistory();
      parts[2] = `## COMPLETED WORK (${this.totalToolCalls} total tool calls)\n${this._formatProgress()}`;
      summary = parts.join('\n\n');
    }
    if (summary.length > maxChars) {
      summary = summary.substring(0, maxChars) + '\n...(summary truncated)';
    }
    
    return summary;
  }

  /**
   * Quick summary for the proactive rotation case (less detail needed).
   */
  generateQuickSummary() {
    return this.generateSummary({ maxTokens: 1200 });
  }

  // ── Internal helpers ──

  /**
   * Compress tool params — strip verbose content, keep just identifiers
   */
  _compressParams(tool, params) {
    if (!params) return '';
    
    // For file operations, just keep the path
    if (tool.includes('file') || tool === 'write_file' || tool === 'read_file' || tool === 'edit_file') {
      return params.filePath || params.path || JSON.stringify(params).substring(0, 80);
    }
    // For browser ops, keep ref or URL
    if (tool.startsWith('browser_')) {
      if (params.url) return params.url;
      if (params.ref) return `ref=${params.ref}`;
      if (params.text) return `"${params.text.substring(0, 50)}"`;
      return JSON.stringify(params).substring(0, 80);
    }
    // For search
    if (tool === 'web_search' || tool === 'search_code' || tool === 'search_files') {
      return params.query || params.pattern || JSON.stringify(params).substring(0, 80);
    }
    // For terminal
    if (tool === 'run_command' || tool === 'run_terminal') {
      return (params.command || '').substring(0, 100);
    }
    // Generic
    return JSON.stringify(params).substring(0, 100);
  }

  /**
   * Extract a short outcome description from a tool result.
   */
  _extractOutcome(tool, params, result) {
    if (!result) return 'no result';
    if (result.error) return `error: ${result.error.substring(0, 100)}`;
    
    // Browser navigation
    if (tool === 'browser_navigate') {
      return result.title ? `Page: ${result.title.substring(0, 80)}` : 'navigated';
    }
    // Browser snapshot
    if (tool === 'browser_snapshot') {
      const elemCount = (result.snapshot || '').match(/\[ref=/g)?.length || 0;
      return `${elemCount} elements captured`;
    }
    // File write
    if (tool === 'write_file') {
      return `wrote ${(result.bytesWritten || params?.content?.length || 0)} bytes`;
    }
    // File read
    if (tool === 'read_file') {
      return `${(result.content || '').length} chars`;
    }
    // Click/type
    if (tool === 'browser_click') return 'clicked';
    if (tool === 'browser_type') return `typed "${(params?.text || '').substring(0, 30)}"`;
    
    // Generic success
    if (result.success) return 'success';
    return (typeof result === 'string') ? result.substring(0, 80) : 'ok';
  }

  /**
   * Update current state tracking based on a tool action.
   */
  _updateState(tool, params, result) {
    if (tool === 'browser_navigate' && params?.url) {
      this.currentState.page = params.url;
      this.currentState.pageTitle = result?.title || '';
    }
    if (tool === 'browser_snapshot' && result?.snapshot) {
      // Just note that we have a snapshot, don't store the whole thing
      this.currentState.hasSnapshot = true;
      this.currentState.snapshotElements = (result.snapshot.match(/\[ref=/g) || []).length;
    }
    if ((tool === 'write_file' || tool === 'edit_file' || tool === 'read_file') && (params?.filePath || params?.path)) {
      this.currentState.lastFile = params.filePath || params.path;
    }
    if (tool === 'run_command' || tool === 'run_terminal') {
      this.currentState.lastCommand = (params?.command || '').substring(0, 100);
    }
    if (tool === 'list_directory') {
      this.currentState.directory = params?.path || params?.dirPath || '';
    }
    this.currentState.lastAction = tool;
    this.currentState.lastActionTime = Date.now();
  }

  /**
   * Extract noteworthy findings from tool results.
   */
  _extractFindings(tool, result) {
    if (!result) return;
    
    // Page titles are good landmarks
    if (tool === 'browser_navigate' && result.title) {
      this.keyFindings.push(`Page loaded: ${result.title}`);
    }
    
    // Errors are always important
    if (result.error) {
      this.keyFindings.push(`Error from ${tool}: ${result.error.substring(0, 150)}`);
    }
    
    // Keep bounded
    if (this.keyFindings.length > 15) {
      this.keyFindings = this.keyFindings.slice(-10);
    }
  }

  /**
   * Format completed steps as a condensed list.
   * Groups consecutive similar actions (e.g., 5 browser_clicks become one line).
   */
  _formatProgress() {
    if (this.completedSteps.length === 0) return 'No steps completed yet.';
    
    const lines = [];
    let currentGroup = null;
    let groupCount = 0;
    
    for (const step of this.completedSteps) {
      const key = step.tool;
      
      if (currentGroup === key && groupCount < 5) {
        groupCount++;
        continue;
      }
      
      // Flush previous group
      if (currentGroup !== null) {
        if (groupCount > 1) {
          lines[lines.length - 1] += ` (×${groupCount})`;
        }
      }
      
      const icon = step.success ? '✓' : '✗';
      lines.push(`${icon} ${step.tool}: ${step.params} → ${step.outcome}`);
      currentGroup = key;
      groupCount = 1;
    }
    
    // Flush last group
    if (groupCount > 1 && lines.length > 0) {
      lines[lines.length - 1] += ` (×${groupCount})`;
    }
    
    // If too many lines, show first few + last few
    if (lines.length > 20) {
      const first = lines.slice(0, 8);
      const last = lines.slice(-8);
      return [...first, `... (${lines.length - 16} more steps) ...`, ...last].join('\n');
    }
    
    return lines.join('\n');
  }

  /**
   * Format current state as readable text.
   */
  _formatCurrentState() {
    const parts = [];
    if (this.currentState.page) {
      parts.push(`Browser: ${this.currentState.page}${this.currentState.pageTitle ? ` (${this.currentState.pageTitle})` : ''}`);
    }
    if (this.currentState.lastFile) {
      parts.push(`Last file: ${this.currentState.lastFile}`);
    }
    if (this.currentState.directory) {
      parts.push(`Directory: ${this.currentState.directory}`);
    }
    if (this.currentState.lastCommand) {
      parts.push(`Last command: ${this.currentState.lastCommand}`);
    }
    return parts.join('\n') || null;
  }

  /**
   * Compress old history — merge adjacent same-tool calls, 
   * keep only the most recent 20 detailed entries.
   */
  _compressHistory() {
    if (this.completedSteps.length <= 20) return;
    
    // Keep the last 20 detailed; compress earlier ones into groups
    const old = this.completedSteps.slice(0, -20);
    const recent = this.completedSteps.slice(-20);
    
    // Group old steps by tool
    const groups = {};
    for (const step of old) {
      const key = step.tool;
      if (!groups[key]) groups[key] = { count: 0, successes: 0, lastOutcome: '' };
      groups[key].count++;
      if (step.success) groups[key].successes++;
      groups[key].lastOutcome = step.outcome;
    }
    
    // Convert groups to compressed steps
    const compressed = Object.entries(groups).map(([tool, info]) => ({
      tool,
      params: `(${info.count} calls, ${info.successes} succeeded)`,
      success: info.successes > 0,
      outcome: info.lastOutcome,
      timestamp: 0,
      compressed: true,
    }));
    
    this.completedSteps = [...compressed, ...recent];
  }

  /**
   * Mark a plan step as completed based on the tool call that was just made.
   */
  markPlanStepCompleted(toolName, params) {
    if (this.taskPlan.length === 0) return;
    
    // Find the first uncompleted step that matches the tool action
    for (const step of this.taskPlan) {
      if (step.completed) continue;
      const desc = step.description.toLowerCase();
      const toolLower = toolName.toLowerCase();
      
      // Fuzzy match: if the step description mentions the tool or action type
      if (desc.includes(toolLower) || 
          (toolLower.includes('navigate') && (desc.includes('navigate') || desc.includes('go to') || desc.includes('open'))) ||
          (toolLower.includes('click') && (desc.includes('click') || desc.includes('select') || desc.includes('press'))) ||
          (toolLower.includes('type') && (desc.includes('type') || desc.includes('enter') || desc.includes('fill') || desc.includes('input'))) ||
          (toolLower.includes('write_file') && (desc.includes('create') || desc.includes('write') || desc.includes('save'))) ||
          (toolLower.includes('read_file') && (desc.includes('read') || desc.includes('check') || desc.includes('review'))) ||
          (toolLower.includes('create_directory') && (desc.includes('create') || desc.includes('directory') || desc.includes('folder') || desc.includes('mkdir')))) {
        step.completed = true;
        break;
      }
    }
  }

  /**
   * Get a JSON-serializable snapshot of the ledger state (for debugging or persistence).
   */
  toJSON() {
    return {
      originalGoal: this.originalGoal,
      taskPlan: this.taskPlan,
      completedSteps: this.completedSteps.length,
      currentState: this.currentState,
      pendingSteps: this.pendingSteps,
      keyFindings: this.keyFindings,
      rotationCount: this.rotationCount,
      totalToolCalls: this.totalToolCalls,
      importantContext: this.importantContext,
    };
  }
}

module.exports = { ConversationSummarizer };
