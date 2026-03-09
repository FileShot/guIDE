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
  }

  // ─── Goal ───
  setGoal(message) {
    if (!message) return;
    this.originalGoal = message.slice(0, 2000);
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
    if (toolName === 'run_terminal_cmd') {
      this.currentState.lastCommand = params?.command?.slice(0, 100);
    }
    if (params?.path || params?.directory) {
      this.currentState.directory = (params.path || params.directory).replace(/[^/\\]*$/, '');
    }
    this.currentState.lastAction = toolName;
    this.currentState.lastActionTime = Date.now();
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
  }

  // ─── Summary Generation ───
  generateSummary(options = {}) {
    const maxTokens = options.maxTokens || 2000;
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
    if (this.currentState.lastCommand) stateLines.push(`Last command: ${this.currentState.lastCommand}`);
    if (stateLines.length > 0) {
      sections.push(`## CURRENT STATE\n${stateLines.join('\n')}`);
    }

    // 5. Key findings
    if (this.keyFindings.length > 0) {
      const findings = this.keyFindings.slice(-8).map(f => `- ${f}`).join('\n');
      sections.push(`## KEY FINDINGS\n${findings}`);
    }

    // 6. Remaining plan steps
    const remaining = this.taskPlan.filter(s => !s.completed);
    if (remaining.length > 0) {
      const steps = remaining.map(s => `${s.index}. ${s.description}`).join('\n');
      sections.push(`## REMAINING STEPS\n${steps}`);
    }

    // 7. Instruction
    sections.push('## INSTRUCTION\nContinue the task from where you left off. Do not repeat completed work.');

    // Assemble and cap
    let summary = sections.join('\n\n');
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars);
    }
    return summary;
  }

  generateQuickSummary() {
    return this.generateSummary({ maxTokens: 1200 });
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
        lines.push(`${status} ${step.tool} (×${count})`);
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
