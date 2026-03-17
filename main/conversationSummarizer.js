'use strict';

/**
 * ConversationSummarizer — structured task ledger for context recovery.
 * Maintains a ledger of goals, tool calls, plan steps, user corrections,
 * and state rather than compressing raw text. Produces markdown summaries
 * for injection when context rotation occurs.
 */
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
    this._warmTierResults = []; // Recent tool results carried across rotation
    this._previousSummaries = []; // Compacted summaries from prior rotations
    this.fileProgress = {};       // {filePath: {writtenLines, writtenChars, lastWriteIteration}}
    this.incrementalTask = null;  // {type, target, current} — tracks progress on large tasks
  }

  // ─── Goal ───
  setGoal(message) {
    if (!message) return;
    this.originalGoal = message.slice(0, 2000);

    // Detect incremental task patterns in the goal
    this._detectIncrementalTask(message);
  }

  // ─── Incremental Task Detection ───
  _detectIncrementalTask(message) {
    if (!message) return;
    const lower = message.toLowerCase();

    // Pattern: "N lines" or "N-line"
    const lineMatch = lower.match(/(\d{3,})\s*[-]?\s*lines?/);
    if (lineMatch) {
      this.incrementalTask = { type: 'lines', target: parseInt(lineMatch[1], 10), current: 0 };
      return;
    }

    // Pattern: "N functions"
    const funcMatch = lower.match(/(\d{2,})\s*(?:utility\s*)?functions?/);
    if (funcMatch) {
      this.incrementalTask = { type: 'functions', target: parseInt(funcMatch[1], 10), current: 0 };
      return;
    }

    // Pattern: "N items/elements/components"
    const itemMatch = lower.match(/(\d{2,})\s*(?:items?|elements?|components?|methods?|classes?)/);
    if (itemMatch) {
      this.incrementalTask = { type: 'items', target: parseInt(itemMatch[1], 10), current: 0 };
      return;
    }
  }

  setIncrementalTask(type, target, current = 0) {
    this.incrementalTask = { type, target, current };
  }

  updateIncrementalProgress(amount) {
    if (this.incrementalTask) {
      this.incrementalTask.current += amount;
    }
  }

  // ─── Tool Call Recording ───
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

    // Update current state from tool results
    this._updateState(toolName, params, result);

    // Extract findings
    this._extractFindings(toolName, result);

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
    if (toolName === 'browser_snapshot' && result?.content) {
      const titleMatch = String(result.content).match(/title:\s*(.+)/i);
      if (titleMatch) this.currentState.pageTitle = titleMatch[1].slice(0, 100);
      this.currentState.hasSnapshot = true;
    }
    if (toolName === 'write_file' || toolName === 'read_file') {
      this.currentState.lastFile = params?.path || params?.filePath;
    }
    if (toolName === 'list_directory') {
      const dirPath = params?.path || params?.directory || '.';
      this.currentState.directory = dirPath;
      // Preserve result so after rotation the model knows what was found — prevents re-listing
      const content = typeof result === 'string' ? result : (result?.content || '');
      this.currentState.lastDirectoryListing = { path: dirPath, content: content.slice(0, 400) };
    }
    if (toolName === 'run_terminal_cmd') {
      this.currentState.lastCommand = params?.command?.slice(0, 100);
    }
    if (params?.path || params?.directory) {
      this.currentState.directory = (params.path || params.directory).replace(/[^/\\]*$/, '');
    }
    this.currentState.lastAction = toolName;
    this.currentState.lastActionTime = Date.now();

    // Track file write progress for incremental tasks
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
          // write_file replaces — reset count
          this.fileProgress[filePath] = { writtenLines: lines, writtenChars: chars, writes: 1 };
        } else {
          // append_to_file adds
          this.fileProgress[filePath].writtenLines += lines;
          this.fileProgress[filePath].writtenChars += chars;
          this.fileProgress[filePath].writes++;
        }

        // Update incremental task progress if tracking lines
        if (this.incrementalTask && this.incrementalTask.type === 'lines') {
          // Sum all written lines across all files
          this.incrementalTask.current = Object.values(this.fileProgress).reduce((sum, fp) => sum + fp.writtenLines, 0);
        }

        // Estimate function count from content for function-based tasks
        if (this.incrementalTask && this.incrementalTask.type === 'functions') {
          const funcMatches = content.match(/function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g);
          if (funcMatches) {
            this.incrementalTask.current += funcMatches.length;
          }
        }
      }
    }
  }

  _extractFindings(toolName, result) {
    if (!result) return;
    const text = typeof result === 'string' ? result : (result.content || '');
    if (!text) return;

    // Extract page titles
    const titleMatch = String(text).match(/title:\s*(.{5,80})/i);
    if (titleMatch) this.keyFindings.push(`Page: ${titleMatch[1]}`);

    // Extract errors
    const errorMatch = String(text).match(/(?:error|failed|exception|403|404|500):\s*(.{5,80})/i);
    if (errorMatch) this.keyFindings.push(`Error: ${errorMatch[1]}`);

    // Cap findings
    if (this.keyFindings.length > 15) {
      this.keyFindings = this.keyFindings.slice(-10);
    }
  }

  _compressHistory() {
    const recentCount = 20;
    const recent = this.completedSteps.slice(-recentCount);
    const old = this.completedSteps.slice(0, -recentCount);

    // Group old steps by tool name
    const grouped = {};
    for (const step of old) {
      if (!grouped[step.tool]) grouped[step.tool] = { count: 0, successes: 0 };
      grouped[step.tool].count++;
      if (step.success) grouped[step.tool].successes++;
    }

    // Replace old entries with compressed summaries
    const compressed = Object.entries(grouped).map(([tool, stats]) => ({
      tool,
      params: {},
      success: true,
      outcome: `${stats.count} calls (${stats.successes} OK)`,
      timestamp: 0,
      compressed: true,
    }));

    this.completedSteps = [...compressed, ...recent];
  }

  // ─── Plan Detection ───
  recordPlan(responseText) {
    if (!responseText) return;

    // Find numbered or bullet-point plan items
    const planRegex = /(?:^|\n)\s*(?:\d+[\.\)]\s*|[-*]\s+)(.{5,200})/g;
    const matches = [];
    let m;
    while ((m = planRegex.exec(responseText)) !== null) {
      matches.push(m[1].trim());
    }

    if (matches.length >= 2) {
      this.taskPlan = matches.map((desc, i) => ({
        index: i + 1,
        description: desc,
        completed: false,
      }));
    }
  }

  markPlanStepCompleted(toolName, params) {
    if (!this.taskPlan.length) return;

    // Fuzzy match tool call to plan step
    const lowerTool = (toolName || '').toLowerCase();
    const paramStr = JSON.stringify(params || {}).toLowerCase();

    for (const step of this.taskPlan) {
      if (step.completed) continue;
      const desc = step.description.toLowerCase();

      // Match by tool name presence or param content overlap
      if (desc.includes(lowerTool) || desc.split(/\s+/).some(w => w.length > 4 && paramStr.includes(w))) {
        step.completed = true;
        break;
      }
    }
  }

  // ─── User Context ───
  recordUserContext(message) {
    if (!message) return;

    // Detect corrections and constraints
    const correctionPatterns = /\b(no,?\s*i\s*meant|actually|instead|don'?t|always|never|must|should not|shouldn'?t)\b/i;
    if (correctionPatterns.test(message)) {
      this.importantContext.push({
        type: 'correction',
        content: message.slice(0, 500),
        timestamp: Date.now(),
      });
    }

    // Cap at 10
    if (this.importantContext.length > 10) {
      this.importantContext = this.importantContext.slice(-10);
    }
  }

  // ─── Rotation ───
  markRotation() {
    this.rotationCount++;

    // Capture warm tier — last 5 significant tool results before rotation
    const recentResults = this.completedSteps.slice(-5).map(s => {
      const out = s.outcome ? `: ${s.outcome}` : '';
      return `${s.success ? '+' : '-'} ${s.tool}${out}`;
    });
    this._warmTierResults = recentResults;

    // Compact current summary into previousSummaries for layered recall
    if (this.completedSteps.length > 0) {
      const compact = `Rotation ${this.rotationCount - 1}: ${this.completedSteps.length} tool calls. ` +
        (this.keyFindings.length > 0 ? `Findings: ${this.keyFindings.slice(-3).join('; ')}` : 'No key findings.');
      this._previousSummaries.push(compact);
      // Keep max 5 rotation summaries
      if (this._previousSummaries.length > 5) this._previousSummaries.shift();
    }
  }

  // ─── Summary Generation ───
  generateSummary(options = {}) {
    const maxTokens = options.maxTokens || 2000;
    const activeTodos = options.activeTodos || [];
    const maxChars = maxTokens * 4; // ~4 chars per token estimate
    const sections = [];

    // 1. Task goal
    if (this.originalGoal) {
      sections.push(`## TASK GOAL\n${this.originalGoal}`);
    }

    // 2. User corrections
    if (this.importantContext.length > 0) {
      const corrections = this.importantContext.map(c => `- ${c.content}`).join('\n');
      sections.push(`## USER INSTRUCTIONS & CORRECTIONS\n${corrections}`);
    }

    // 3. Completed work
    if (this.completedSteps.length > 0) {
      sections.push(`## COMPLETED WORK\n${this._formatProgress()}`);
    }

    // 4. Current state
    const stateLines = [];
    if (this.currentState.page) stateLines.push(`Browser: ${this.currentState.page}`);
    if (this.currentState.pageTitle) stateLines.push(`Page title: ${this.currentState.pageTitle}`);
    if (this.currentState.lastFile) stateLines.push(`Last file: ${this.currentState.lastFile}`);
    if (this.currentState.directory) stateLines.push(`Directory: ${this.currentState.directory}`);
    if (this.currentState.lastDirectoryListing) {
      stateLines.push(`Directory listing (${this.currentState.lastDirectoryListing.path}) — already retrieved, do NOT list again:\n${this.currentState.lastDirectoryListing.content}`);
    }
    if (this.currentState.lastCommand) stateLines.push(`Last command: ${this.currentState.lastCommand}`);
    if (stateLines.length > 0) {
      sections.push(`## CURRENT STATE\n${stateLines.join('\n')}`);
    }

    // 5. Key findings
    if (this.keyFindings.length > 0) {
      const findings = this.keyFindings.slice(-8).map(f => `- ${f}`).join('\n');
      sections.push(`## KEY FINDINGS\n${findings}`);
    }

    // 5b. Previous rotation summaries (layered memory)
    if (this._previousSummaries.length > 0) {
      sections.push(`## PRIOR CONTEXT ROTATIONS\n${this._previousSummaries.join('\n')}`);
    }

    // 5c. Warm tier — recent tool results from just before rotation
    if (this._warmTierResults.length > 0) {
      sections.push(`## RECENT RESULTS (pre-rotation)\n${this._warmTierResults.join('\n')}`);
    }

    // 5d. File progress for incremental tasks
    const fileProgressKeys = Object.keys(this.fileProgress);
    if (fileProgressKeys.length > 0) {
      const progressLines = fileProgressKeys.map(fp => {
        const p = this.fileProgress[fp];
        return `- ${fp}: ${p.writtenLines} lines (${p.writtenChars} chars) written in ${p.writes} operation(s)`;
      });
      sections.push(`## FILE PROGRESS\n${progressLines.join('\n')}\n**Use append_to_file to continue adding content to existing files.**`);
    }

    // 5e. Incremental task tracking
    if (this.incrementalTask) {
      const pct = this.incrementalTask.target > 0 ? Math.round((this.incrementalTask.current / this.incrementalTask.target) * 100) : 0;
      sections.push(`## INCREMENTAL TASK PROGRESS\n- Type: ${this.incrementalTask.type}\n- Target: ${this.incrementalTask.target}\n- Current: ${this.incrementalTask.current} (${pct}%)\n**Continue making progress. Do not refuse or give up.**`);
    }

    // 6. Remaining plan steps
    const remaining = this.taskPlan.filter(s => !s.completed);
    if (remaining.length > 0) {
      const steps = remaining.map(s => `${s.index}. ${s.description}`).join('\n');
      sections.push(`## REMAINING STEPS\n${steps}`);
    }

    // 6b. Active TODOs (injected from mcpToolServer)
    if (activeTodos.length > 0) {
      const todoLines = activeTodos
        .filter(t => t.status !== 'done')
        .map(t => `- [${t.status === 'in-progress' ? 'IN PROGRESS' : 'PENDING'}] ${t.text}`)
        .join('\n');
      if (todoLines) sections.push(`## ACTIVE TASKS\n${todoLines}`);
    }

    // 7. Instruction — strengthened to prevent refusal
    let instruction = '## INSTRUCTION\nContinue the task from where you left off. Do not repeat completed work.';
    if (this.incrementalTask || fileProgressKeys.length > 0) {
      instruction += '\n\n**CRITICAL: DO NOT REFUSE. DO NOT SAY "I cannot continue."**\n';
      instruction += 'Make incremental progress using tools:\n';
      instruction += '- Use `append_to_file` to add more content to existing files\n';
      instruction += '- Use `write_todos` to track multi-step progress\n';
      instruction += '- Call a tool NOW to continue the task\n';
    }
    sections.push(instruction);

    // Assemble and cap
    let summary = sections.join('\n\n');
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars);
    }
    return summary;
  }

  generateQuickSummary(activeTodos) {
    return this.generateSummary({ maxTokens: 1200, activeTodos: activeTodos || [] });
  }

  _formatProgress() {
    const lines = [];
    let i = 0;
    while (i < this.completedSteps.length) {
      const step = this.completedSteps[i];

      // Group consecutive calls to the same tool
      let count = 1;
      while (
        i + count < this.completedSteps.length &&
        this.completedSteps[i + count].tool === step.tool &&
        count < 5
      ) {
        count++;
      }

      const status = step.success ? '✓' : '✗';
      if (count > 1) {
        // Preserve the last outcome so the model knows what was found, not just that calls happened
        const lastStep = this.completedSteps[i + count - 1];
        const outcome = lastStep.outcome ? `: ${lastStep.outcome}` : '';
        lines.push(`${status} ${step.tool} (×${count})${outcome}`);
      } else {
        const outcome = step.outcome ? `: ${step.outcome}` : '';
        lines.push(`${status} ${step.tool}${outcome}`);
      }
      i += count;
    }

    // Truncate middle if too many lines
    if (lines.length > 20) {
      const first = lines.slice(0, 8);
      const last = lines.slice(-8);
      return [...first, `... (${lines.length - 16} more steps) ...`, ...last].join('\n');
    }
    return lines.join('\n');
  }

  // ─── Serialization ───
  toJSON() {
    return {
      originalGoal: this.originalGoal,
      taskPlan: this.taskPlan,
      completedSteps: this.completedSteps,
      currentState: this.currentState,
      keyFindings: this.keyFindings,
      importantContext: this.importantContext,
      rotationCount: this.rotationCount,
      totalToolCalls: this.totalToolCalls,
    };
  }
}

module.exports = { ConversationSummarizer };
