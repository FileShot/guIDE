/**
 * Shared helpers for both the cloud and local agentic loops.
 * Extracted from agenticChat.js to eliminate DRY violations (ARCH-01).
 */

/**
 * Near-duplicate detection using word-level Jaccard overlap.
 * Two texts with >80% word overlap are considered near-duplicates.
 * More robust than exact prefix matching — catches paraphrased repetitions.
 *
 * @param {string} a - First text
 * @param {string} b - Second text
 * @param {number} threshold - Overlap threshold (default: 0.80)
 * @returns {boolean} Whether the texts are near-duplicates
 */
function isNearDuplicate(a, b, threshold = 0.80) {
  if (!a || !b) return false;
  // Use first 500 chars for efficiency (longer texts are more expensive)
  const wordsA = new Set(a.substring(0, 500).toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.substring(0, 500).toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && (intersection / union) >= threshold;
}

/**
 * Detect if a model response appears truncated.
 * @param {string} responseText - The model's response text
 * @returns {{ trimmedResponse: string, hasUnclosedCodeBlock: boolean, endsAbruptly: boolean }}
 */
function detectTruncation(responseText) {
  const trimmedResponse = (responseText || '').trim();
  const hasUnclosedCodeBlock = (trimmedResponse.match(/```/g) || []).length % 2 !== 0;
  const endsAbruptly = trimmedResponse.length > 100 && (
    hasUnclosedCodeBlock ||
    /[{(\[,:;=]$/.test(trimmedResponse)
  );
  return { trimmedResponse, hasUnclosedCodeBlock, endsAbruptly };
}

/**
 * Detect when the model describes future actions or claims it already performed actions
 * without actually calling tools (hallucinated/described actions).
 * @param {string} responseText
 * @returns {{ describedActions: boolean, hallucinatedActions: boolean }}
 */
function detectActionHallucination(responseText) {
  const describedActions = /\b(I('ll| will|'m going to| can| should| would)|Let me|I'll now|Here's what|I would)\b.*\b(create|write|edit|navigate|browse|open|search|run|delete|rename|read|click|type|build|make|generate|install)\b/i.test(responseText);
  const hallucinatedActions = /\b(I\s+(navigated|searched|browsed|opened|visited|went|created|wrote|saved|generated|made|built|ran|executed|clicked|typed|found|looked|accessed|retrieved|used|confirmed|extracted|verified))\b/i.test(responseText);
  return { describedActions, hallucinatedActions };
}

/**
 * Detect when the model dumps large code blocks as raw text instead of using write_file/edit_file.
 * @param {string} responseText
 * @returns {{ codeBlockMatch: RegExpMatchArray|null, rawCodeDump: boolean, hasLargeCodeBlock: boolean, shouldNudge: boolean }}
 */
function detectRawCodeDump(responseText) {
  const codeBlockMatch = responseText.match(/```[\w]*\n([\s\S]{500,}?)```/);
  const jsPatternLines = (responseText.match(/^[\s]*[{}();,\[\]]/gm) || []).length;
  const htmlTagLines = (responseText.match(/^\s*<\/?[a-zA-Z][a-zA-Z0-9-]*[\s>]/gm) || []).length;
  const cssLines = (responseText.match(/^\s*[.#@][a-zA-Z][\w-]*\s*[{,]/gm) || []).length;
  const totalLines = Math.max(responseText.split('\n').length, 1);
  const indentedRatio = (responseText.match(/^[ \t]{2,}\S/gm) || []).length / totalLines;
  const rawCodeDump = !codeBlockMatch && responseText.length > 800 && (
    jsPatternLines > 10 ||
    htmlTagLines > 8 ||
    cssLines > 5 ||
    (htmlTagLines + cssLines + jsPatternLines) > 12 ||
    indentedRatio > 0.5
  );
  const hasLargeCodeBlock = !!(codeBlockMatch && codeBlockMatch[1].length > 1500);
  const shouldNudge = (rawCodeDump || hasLargeCodeBlock) &&
    !/\b(here'?s|example|snippet|illustration|demo)\b/i.test(responseText.slice(0, 200));
  return { codeBlockMatch, rawCodeDump, hasLargeCodeBlock, shouldNudge };
}

/**
 * Generate a context-aware follow-up prompt when the model's response was truncated.
 * @param {string} responseText
 * @param {boolean} hasUnclosedCodeBlock
 * @returns {string} The nudge message
 */
function getTruncationNudgeMessage(responseText, hasUnclosedCodeBlock) {
  const wasMidToolCall = /\{\s*"tool"\s*:/s.test(responseText.slice(-500));
  const wasMidCode = hasUnclosedCodeBlock;
  if (wasMidToolCall) {
    return 'Your response was cut off mid-tool-call. The partial tool call was NOT executed. Please re-issue the complete tool call from the beginning as a properly formatted JSON block.';
  } else if (wasMidCode) {
    return 'Your response was cut off mid-code-block. Do NOT continue printing the code as raw text. If you were creating or editing a file, use the write_file or edit_file tool instead. If you were explaining something, briefly summarize what you were showing and move on to the next step.';
  } else {
    return 'Your response was cut off. Do NOT repeat or continue printing large blocks of code or content as raw text. Instead, briefly summarize what you were explaining, then proceed with the next action using tool calls if needed.';
  }
}

/**
 * Auto-capture a page snapshot after browser navigation/interaction actions.
 * Used by both cloud and local loops to provide the model with fresh page state.
 * @param {Array} toolResults - Tool results from the current iteration
 * @param {object} mcpToolServer - MCP tool server instance
 * @param {object} playwrightBrowser - Playwright browser instance
 * @param {object} browserManager - BrowserManager instance
 * @returns {Promise<{snapshotText: string, elementCount: number, triggerTool: string}|null>}
 */
async function autoSnapshotAfterBrowserAction(toolResults, mcpToolServer, playwrightBrowser, browserManager) {
  const SNAPSHOT_TRIGGER_TOOLS = ['browser_navigate', 'browser_click', 'browser_type', 'browser_select', 'browser_back', 'browser_press_key'];
  const hasBrowserAction = toolResults.some(r => r.tool?.startsWith('browser_'));
  const didSnapshot = toolResults.some(r => r.tool === 'browser_snapshot' || r.tool === 'browser_get_snapshot');
  if (!hasBrowserAction || didSnapshot) return null;

  const lastBrowserAction = toolResults.filter(r => r.tool?.startsWith('browser_')).pop();
  if (!lastBrowserAction || !SNAPSHOT_TRIGGER_TOOLS.includes(lastBrowserAction.tool)) return null;

  try {
    const activeBrowser = mcpToolServer._getBrowser();
    if (activeBrowser === playwrightBrowser) {
      try {
        const page = playwrightBrowser.page;
        if (page && !page.isClosed()) {
          await page.waitForTimeout(200);
          await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
        }
      } catch (_) {}
    } else if (activeBrowser === browserManager) {
      await browserManager.waitForPageSettle(1500);
    }
    const snap = await activeBrowser.getSnapshot();
    if (snap.success && snap.snapshot) {
      const snapshotText = snap.snapshot.length > 10000
        ? snap.snapshot.substring(0, 10000) + '\n... (truncated)'
        : snap.snapshot;
      return { snapshotText, elementCount: snap.elementCount, triggerTool: lastBrowserAction.tool };
    }
  } catch (e) {
    console.log('[Agentic] Auto-snapshot failed:', e.message);
  }
  return null;
}

/**
 * Send UI notifications for tool execution events (tool-executing, show-browser, open-file, files-changed).
 * @param {object} mainWindow - Electron BrowserWindow
 * @param {Array} toolResults - Executed tool results
 * @param {object} playwrightBrowser - Playwright browser instance
 * @param {object} opts - Options
 * @param {boolean} opts.checkSuccess - If true, only send file events for successful tool calls
 * @returns {{ filesChanged: boolean }}
 */
function sendToolExecutionEvents(mainWindow, toolResults, playwrightBrowser, opts = {}) {
  if (!mainWindow) return { filesChanged: false };
  const { checkSuccess = false } = opts;
  let filesChanged = false;

  for (const tr of toolResults) {
    mainWindow.webContents.send('tool-executing', { tool: tr.tool, params: tr.params });
    if (tr.tool?.startsWith('browser_') && !playwrightBrowser?.isLaunched) {
      mainWindow.webContents.send('show-browser', { url: tr.params?.url || '' });
    }
    const isFileOp = ['write_file', 'create_directory', 'edit_file', 'delete_file', 'rename_file'].includes(tr.tool);
    const passed = checkSuccess ? tr.result?.success : true;
    if (isFileOp && passed) {
      filesChanged = true;
      if (['write_file', 'edit_file'].includes(tr.tool) && tr.params?.filePath) {
        mainWindow.webContents.send('open-file', tr.params.filePath);
      }
    }
  }
  if (filesChanged) {
    mainWindow.webContents.send('files-changed');
  }
  return { filesChanged };
}

/**
 * Cap an array to a maximum length, keeping the most recent items.
 * @param {Array} arr - The array to cap (mutated in place)
 * @param {number} maxLen - Maximum number of items to keep
 */
function capArray(arr, maxLen) {
  if (arr.length > maxLen) {
    arr.splice(0, arr.length - maxLen);
  }
}

/**
 * Batch ultra-high-frequency token IPC into fewer sends.
 * Preserves UX (same text), but reduces renderer churn.
 * @param {object|null} mainWindow - Electron BrowserWindow
 * @param {string} channel - IPC channel (e.g., 'llm-token')
 * @param {() => boolean} canSend - predicate to avoid sending when stale/cancelled
 * @param {object} [opts]
 * @param {number} [opts.flushIntervalMs=25] - flush cadence
 * @param {number} [opts.maxBufferChars=2048] - immediate flush threshold
 * @param {boolean} [opts.flushOnNewline=true] - flush immediately when token contains '\n'
 */
function createIpcTokenBatcher(mainWindow, channel, canSend, opts = {}) {
  const flushIntervalMs = Number.isFinite(opts.flushIntervalMs) ? opts.flushIntervalMs : 25;
  const maxBufferChars = Number.isFinite(opts.maxBufferChars) ? opts.maxBufferChars : 2048;
  const flushOnNewline = opts.flushOnNewline !== false;

  let buffer = '';
  let timer = null;

  const flush = () => {
    if (!buffer) return;
    const text = buffer;
    buffer = '';
    // Guard against Electron WebContents being destroyed (e.g. user closes app during generation).
    // mainWindow.isDestroyed() / webContents.isDestroyed() throw if called on a dead object,
    // so check both with a try/catch as final backstop.
    try {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
      if (typeof canSend === 'function' && !canSend()) return;
      mainWindow.webContents.send(channel, text);
    } catch (_) {
      // Ignore IPC send failures (window closed / destroyed)
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushIntervalMs);
  };

  const push = (token) => {
    if (!token) return;
    buffer += token;
    if (buffer.length >= maxBufferChars) {
      flush();
      return;
    }
    if (flushOnNewline && token.includes('\n')) {
      flush();
      return;
    }
    scheduleFlush();
  };

  const dispose = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
  };

  return { push, flush, dispose };
}

/**
 * Provide actionable guidance when a tool fails.
 * Ported from Pocket guIDE agent.js _enrichErrorFeedback.
 * @param {string} toolName - The tool that failed
 * @param {string} error - The error message
 * @param {Object} [failCounts={}] - Map of tool name → failure count
 * @returns {string} A suggestion string (empty if no suggestion)
 */
function enrichErrorFeedback(toolName, error, failCounts = {}) {
  const err = String(error || '');
  const tips = [];

  // File operation errors
  if (toolName === 'edit_file' && /oldText not found/i.test(err)) {
    tips.push('Use read_file to see the exact current file content, then retry edit_file with the correct oldText (whitespace and line breaks must match exactly).');
  }
  if (toolName === 'write_file' && /empty/i.test(err)) {
    tips.push('Provide the complete file content in the "content" parameter. Never send empty content.');
  }
  if (/not found|no such file/i.test(err) && /file/i.test(toolName)) {
    tips.push('File does not exist. Use find_files to search for it by name across the project, then retry read_file with the correct full path.');
  }

  // Browser errors
  if (/not found|no element|could not find/i.test(err) && toolName.startsWith('browser_')) {
    tips.push('Element not found. Use browser_snapshot to see what elements are currently on the page, then use the correct ref number from the snapshot output.');
  }
  if (/timeout/i.test(err) && toolName.startsWith('browser_')) {
    tips.push('Operation timed out. Try browser_wait_for({selector:"body"}) first, then retry. The page may still be loading.');
  }
  if (/target closed|frame was detached|execution context/i.test(err)) {
    tips.push('The page navigated away or reloaded. Use browser_snapshot to see the current page state.');
  }
  if (/net::/i.test(err) && toolName === 'browser_navigate') {
    tips.push('Network error. Check that the URL is correct and includes the protocol (https://).');
  }

  // Command errors
  if (toolName === 'run_command' && /not recognized|not found|cmdlet/i.test(err)) {
    tips.push('Command not recognized. This is Windows — use PowerShell: Get-ChildItem (not ls), Select-String (not grep), Get-Content (not cat), Test-Path (not test -f).');
  }
  if (toolName === 'run_command' && /timed out/i.test(err)) {
    tips.push('Command timed out (30s limit). Try a simpler command or break the task into smaller steps.');
  }

  // ── Smart failure escalation: specific alternative strategies after 3+ failures ──
  const failCount = failCounts[toolName] || 0;
  if (failCount >= 3) {
    // Instead of generic "try something different", suggest SPECIFIC alternatives
    const escalations = {
      browser_click: 'ESCALATION: browser_click has failed 3+ times. Try: (1) browser_evaluate with document.querySelector(...).click(), or (2) browser_press_key "Enter" if the element is focused, or (3) browser_navigate directly to the target URL.',
      browser_type: 'ESCALATION: browser_type has failed 3+ times. Try: (1) browser_evaluate to set the value directly: document.querySelector("input").value = "text", or (2) browser_fill_form with the field ref.',
      browser_navigate: 'ESCALATION: browser_navigate has failed 3+ times on this URL. Try: (1) a different URL or domain, (2) web_search to find an alternative source, (3) fetch_webpage for the raw content without a browser.',
      edit_file: 'ESCALATION: edit_file has failed 3+ times. Try: (1) read_file to get the EXACT current content, (2) write_file to replace the entire file with the corrected version.',
      run_command: 'ESCALATION: run_command has failed 3+ times. Try: (1) a simpler command, (2) break into multiple steps, (3) use write_file to create a script then run_command to execute it.',
      web_search: 'ESCALATION: web_search has failed 3+ times. Try: (1) a different query with fewer/different keywords, (2) browser_navigate directly to a known URL, (3) fetch_webpage on a specific URL.',
    };
    const escalation = escalations[toolName];
    if (escalation) {
      tips.unshift(escalation); // Put escalation first
    } else if (tips.length === 0) {
      tips.push(`This tool has failed ${failCount} times. You MUST try a completely different tool or approach. Do NOT retry the same tool with the same parameters.`);
    }
  } else if (failCount >= 2 && tips.length === 0) {
    tips.push(`This tool has failed ${failCount} times. Consider a different approach.`);
  }

  return tips.length > 0 ? `\n💡 Suggestion: ${tips[0]}` : '';
}

/**
 * Progressive context pruning — compress verbose tool results in older messages.
 * Called at ~60% context usage to delay the hard 80% rotation.
 *
 * For local chatHistory (node-llama-cpp): truncates large user messages (tool results,
 * file contents, snapshots) to compact summaries while preserving conversation structure.
 *
 * @param {Array} chatHistory - The chatHistory array from llmEngine (system/user/model items)
 * @param {number} keepRecentCount - Number of recent messages to leave untouched (default: 6)
 * @returns {number} Number of messages that were pruned
 */
function pruneVerboseHistory(chatHistory, keepRecentCount = 6) {
  if (!Array.isArray(chatHistory) || chatHistory.length <= keepRecentCount + 1) return 0;

  let pruned = 0;
  const cutoff = chatHistory.length - keepRecentCount;
  const PRUNE_THRESHOLD = 800; // Only prune messages longer than this

  for (let i = 1; i < cutoff; i++) { // Skip index 0 (system message)
    const msg = chatHistory[i];
    if (!msg || !msg.text || msg.text.length < PRUNE_THRESHOLD) continue;

    const text = msg.text;
    let compressed = text;

    // Compress file contents: "**Content of file.js:**\n```\n...thousands of lines...\n```"
    compressed = compressed.replace(
      /\*\*(?:Content of|File:)\s*([^*]+)\*\*[:\s]*\n?```[\s\S]{500,}?```/g,
      (_, name) => `**${name.trim()}**: [file content — ${Math.round(_.length / 4)} tokens, pruned]`
    );

    // Compress page snapshots: "**Page Snapshot** (N elements):\n...huge tree..."
    compressed = compressed.replace(
      /\*\*Page Snapshot\*\*\s*\([^)]*\):\n[\s\S]{500,}?(?=\n\*\*|\n###|\n---|\nCURRENT TASK:|$)/g,
      (match) => {
        const elMatch = match.match(/\((\d+) elements?\)/);
        return `**Page Snapshot**: [${elMatch ? elMatch[1] + ' elements' : 'page tree'} — pruned for context]`;
      }
    );

    // Compress run_command output: long terminal output blocks
    compressed = compressed.replace(
      /\*\*(?:Output|Result|Command output)\*\*[:\s]*\n?```[\s\S]{500,}?```/g,
      (match) => `**Command output**: [${Math.round(match.length / 4)} tokens — pruned]`
    );

    // Compress read_file results embedded as plain text blocks
    compressed = compressed.replace(
      /```(?:[\w]*)\n([\s\S]{800,}?)```/g,
      (match, content) => {
        const lineCount = (content.match(/\n/g) || []).length;
        return `\`\`\`\n[${lineCount} lines — pruned for context]\n\`\`\``;
      }
    );

    // Compress search/grep results
    compressed = compressed.replace(
      /\*\*(?:Search results|Found \d+ matches?|Grep results)\*\*[\s\S]{500,}?(?=\n\*\*|\n###|\n---|$)/g,
      (match) => `**Search results**: [pruned — ${Math.round(match.length / 4)} tokens]`
    );

    if (compressed.length < text.length * 0.7) { // Only apply if we actually saved >30%
      chatHistory[i] = { ...msg, text: compressed };
      pruned++;
    }
  }

  if (pruned > 0) {
    console.log(`[Context Pruning] Compressed ${pruned} verbose messages in chatHistory`);
  }
  return pruned;
}

/**
 * Progressive pruning for cloud conversation history (array of {role, content} objects).
 * Same concept as pruneVerboseHistory but for the cloud path's message format.
 *
 * @param {Array} history - Cloud conversation history [{role, content}, ...]
 * @param {number} keepRecentCount - Number of recent messages to preserve (default: 6)
 * @returns {number} Number of messages pruned
 */
function pruneCloudHistory(history, keepRecentCount = 6) {
  if (!Array.isArray(history) || history.length <= keepRecentCount + 1) return 0;

  let pruned = 0;
  const cutoff = history.length - keepRecentCount;
  const PRUNE_THRESHOLD = 800;

  for (let i = 1; i < cutoff; i++) {
    const msg = history[i];
    if (!msg || !msg.content || msg.content.length < PRUNE_THRESHOLD) continue;

    let compressed = msg.content;

    // Same compression patterns as local
    compressed = compressed.replace(
      /```[\s\S]{800,}?```/g,
      (match) => {
        const lineCount = (match.match(/\n/g) || []).length;
        return `\`\`\`\n[${lineCount} lines — pruned for context]\n\`\`\``;
      }
    );

    compressed = compressed.replace(
      /Page snapshot[^:]*:\n[\s\S]{500,}?(?=\n\*\*|\n###|\n---|$)/gi,
      (match) => `Page snapshot: [pruned — ${Math.round(match.length / 4)} tokens]`
    );

    if (compressed.length < msg.content.length * 0.7) {
      history[i] = { ...msg, content: compressed };
      pruned++;
    }
  }

  if (pruned > 0) {
    console.log(`[Cloud Context Pruning] Compressed ${pruned} verbose messages`);
  }
  return pruned;
}

/**
 * Expanded refusal pattern detection.
 * Covers explicit refusals, passive refusals (describing instead of doing),
 * capability disclaimers, and deflections.
 */
const EXPANDED_REFUSAL_PATTERNS = new RegExp([
  // Explicit refusals
  'I\\s+(?:can\'?t|cannot|won\'?t|will not|am unable|am not able|don\'?t have|do not have)',
  '(?:I\'?m\\s+)?(?:unable|not able)\\s+to',
  'beyond my (?:capabilities|ability|scope)',
  'as an AI(?:\\s+(?:language\\s+)?model)?',
  'I\'?m (?:just )?a (?:language|text|AI) model',
  // Passive refusals (describing instead of doing)
  'you\\s+(?:can|could|should|would need to)\\s+(?:use|try|open|visit|navigate|search|run|create)',
  'here\'?s how (?:you|one) (?:can|could|would)',
  'the steps? (?:would be|are|is)',
  'to do this,? you would',
  'I\'?ll (?:describe|explain|outline|walk you through)',
  'let me (?:describe|explain|outline) (?:how|what)',
  // Capability disclaimers
  '(?:don\'?t|do not) have (?:access|the ability|internet|web|browser)',
  '(?:can\'?t|cannot) (?:access|browse|search|navigate|connect|reach|open|visit)',
  'no (?:internet|web|browser) access',
  'not (?:equipped|designed|built|programmed) to',
  'outside (?:of )?my (?:capabilities|scope|abilities)',
  // Deflections — model offers to do something else instead
  'instead,? (?:I can|let me|I\'?ll)\\s+(?:help|assist|provide|explain|describe)',
  'I can (?:help|assist) you (?:with|by) (?:explaining|describing|providing)',
].join('|'), 'i');

/**
 * Deterministic response evaluation — pure code heuristics, no model intelligence needed.
 * Returns a verdict: COMMIT (accept result), ROLLBACK (retry), or SKIP (move on).
 *
 * @param {string} responseText - Model's generated text
 * @param {Array} functionCalls - Native function calls from grammar-constrained generation
 * @param {string} taskType - 'chat', 'browser', 'code', 'general', etc.
 * @param {number} iteration - Current agentic iteration
 * @returns {{ verdict: string, reason: string }}
 */
function evaluateResponse(responseText, functionCalls, taskType, iteration, hasRunTools = false) {
  const text = (responseText || '').trim();
  const hasFunctionCalls = Array.isArray(functionCalls) && functionCalls.length > 0;

  // ── CHAT TASK: Accept any non-empty text ──
  // BUG-016 fix: must come BEFORE hasFunctionCalls so chat tasks never commit
  // hallucinated native tool calls (model produces function calls for "hi").
  if (taskType === 'chat') {
    if (text.length > 10) return { verdict: 'COMMIT', reason: 'chat_response' };
    if (text.length > 0) return { verdict: 'COMMIT', reason: 'short_chat' };
    return { verdict: 'ROLLBACK', reason: 'empty' };
  }

  // ── VALID TOOL CALL: Always accept ──
  if (hasFunctionCalls) {
    return { verdict: 'COMMIT', reason: 'tool_call' };
  }

  // ── TEXT PARSING: Check if text contains parseable tool calls ──
  // (Legacy path — text may contain valid JSON tool blocks)
  const hasToolJson = /```(?:tool_call|tool|json)[^\n]*\n[\s\S]*?```/.test(text) ||
    /\{\s*"(?:tool|name)"\s*:\s*"[^"]+"/.test(text);
  if (hasToolJson) {
    return { verdict: 'COMMIT', reason: 'text_tool_call' };
  }
  // BUG-036: Detect granite-3.3-critical-thinking intermediate reasoning JSON format.
  // Pattern: {"claims": [...], "ambiguous_terms": [...], "assumptions": [...]}
  // This is NOT a tool call — it's an internal analysis step. Treat as described_not_executed
  // so the rollback retry injects an explicit "execute NOW" nudge.
  if (!hasFunctionCalls && /^\s*\{/.test(text) && /"claims"\s*:/.test(text) && /"ambiguous_terms"\s*:/.test(text)) {
    return { verdict: 'ROLLBACK', reason: 'described_not_executed' };
  }
  // ── EMPTY RESPONSE ──
  if (text.length < 15) {
    return { verdict: 'ROLLBACK', reason: 'empty' };
  }

  // ── REFUSAL DETECTION (agentic tasks, iterations 1-5) ──
  // After iteration 5, the model may legitimately be explaining limitations
  // encountered during execution (e.g., "I couldn't find X on that page").
  // BUG-NEW-B: If real tools ran this iteration, skip refusal ROLLBACK — the model
  // is summarizing what it found, not refusing to act.
  if (EXPANDED_REFUSAL_PATTERNS.test(text) && iteration <= 5 && !hasRunTools) {
    return { verdict: 'ROLLBACK', reason: 'refusal' };
  }

  // ── HALLUCINATION: Past-tense completion claims with NO tool calls ──
  // Only catches clear cases: model says "I've done X" / "completed" / "finished"
  // but never actually called any tools. Does NOT catch future-tense ("I'll do X")
  // because the model may be about to call tools in the same response.
  // BUG-NEW-B: If real tools ran this iteration, past-tense language is a legitimate
  // summary ("I searched and found..."), not hallucination — skip the ROLLBACK.
  const { hallucinatedActions } = detectActionHallucination(text);
  if (hallucinatedActions && text.length > 50 && iteration <= 3 && !hasRunTools) {
    return { verdict: 'ROLLBACK', reason: 'hallucination' };
  }

  // BUG-035: Completion-claim validator — catches small models (e.g. 1.7B) that claim
  // "Done" or "file created" on iteration 1 with ZERO tool calls on code/general tasks.
  // These are hallucinated completions. Force rollback so the retry prompt demands a real tool call.
  if ((taskType === 'code' || taskType === 'general') && iteration === 1 && !hasFunctionCalls) {
    const COMPLETION_CLAIM_RX = /\b(done|file[\s_-]?created|task[\s_-]?complet\w*|i\s+have\s+(created|written|saved|built|made|finished)|i'?ve\s+(created|written|saved|built|made|finished)|successfully\s+(created|written|built|saved|generated)|all\s+set|finished|completed)\b/i;
    if (COMPLETION_CLAIM_RX.test(text) && text.length < 600) {
      return { verdict: 'ROLLBACK', reason: 'described_not_executed' };
    }
  }

  // ── SUBSTANTIVE TEXT (iteration > 3): model may be summarizing/concluding ──
  if (text.length > 100 && iteration > 3) {
    return { verdict: 'COMMIT', reason: 'substantive_text' };
  }

  // ── DESCRIBED BUT NOT EXECUTED (iteration 1-2 only) ──
  // On the first couple iterations, if the model narrates what it would do
  // instead of doing it, rollback so it tries again. After iteration 2,
  // the nudge system handles this instead (model sees feedback).
  const { describedActions } = detectActionHallucination(text);
  if (describedActions && iteration <= 2 && !hasRunTools) {
    return { verdict: 'ROLLBACK', reason: 'described_not_executed' };
  }

  // ── STUCK GREETING: generic greeting response on an agentic (non-chat) task ──
  // Tiny models overwhelmed by tool injection context fall back to their trained greeting.
  // Detect the exact pattern and ROLLBACK so the retry can strip tool pressure.
  const STUCK_GREETING_RX = /^(Hello!?\s+How\s+can\s+I\s+(assist|help)\s+(you\s+)?(today)?[!?.]*\s*|Hi!?\s+How\s+can\s+I\s+(assist|help)[!?.]*\s*)$/i;
  if (taskType !== 'chat' && iteration === 1 && STUCK_GREETING_RX.test(text)) {
    return { verdict: 'ROLLBACK', reason: 'stuck_greeting' };
  }

  // ── DEFAULT: Accept ──
  return { verdict: 'COMMIT', reason: 'default' };
}

/**
 * Get the model capability tier based on estimated parameter count.
 * Used to adjust tool count, retry budgets, and grammar forcing strategy.
 *
 * @param {number} paramSize - Estimated parameter count in billions
 * @returns {{ tier: string, maxToolsPerPrompt: number, grammarAlwaysOn: boolean, retryBudget: number, pruneAggression: string }}
 */
function getModelTier(paramSize) {
  if (paramSize <= 1) return { tier: 'tiny', maxToolsPerPrompt: 5, grammarAlwaysOn: false, retryBudget: 5, pruneAggression: 'aggressive' };
  if (paramSize <= 4) return { tier: 'small', maxToolsPerPrompt: 10, grammarAlwaysOn: false, retryBudget: 4, pruneAggression: 'standard' };
  if (paramSize <= 8) return { tier: 'medium', maxToolsPerPrompt: 20, grammarAlwaysOn: false, retryBudget: 3, pruneAggression: 'standard' };
  if (paramSize <= 14) return { tier: 'large', maxToolsPerPrompt: 30, grammarAlwaysOn: false, retryBudget: 2, pruneAggression: 'light' };
  return { tier: 'xlarge', maxToolsPerPrompt: 50, grammarAlwaysOn: false, retryBudget: 1, pruneAggression: 'none' };
}

/**
 * Progressive tool disclosure — returns a filtered list of tool names based on
 * task type, iteration, and what tools have been used so far.
 * Reduces decision space for small models (30-way → 5-way choice).
 *
 * @param {string} taskType - 'browser', 'code', 'general', 'chat'
 * @param {number} iteration - Current agentic iteration
 * @param {Array} recentTools - Recently used tool names
 * @param {number} maxTools - Maximum tools to include (from model tier)
 * @returns {string[]|null} Array of tool names to include, or null for all tools
 */
function getProgressiveTools(taskType, iteration, recentTools, maxTools) {
  // For large tool budgets, don't restrict — grammar handles the rest
  if (maxTools >= 30) return null;

  const lastTool = recentTools.length > 0 ? recentTools[recentTools.length - 1] : null;
  const usedBrowser = recentTools.some(t => t && t.startsWith('browser_'));
  const usedFiles = recentTools.some(t => ['read_file', 'write_file', 'edit_file'].includes(t));
  const usedSearch = recentTools.some(t => t === 'web_search' || t === 'search_codebase');

  // ── Core tools: always available regardless of state ──
  // For code tasks at iteration 1 for small models, exclude write_todos/update_todo
  // to prevent confusion (e.g. "create a to-do list app" → write_todos instead of write_file).
  // Planning tools become available after iteration 1 or for non-code tasks.
  const needsPlanning = taskType !== 'code' || iteration > 1 || maxTools >= 20;
  const core = needsPlanning
    ? ['web_search', 'write_file', 'read_file', 'run_command', 'write_todos', 'update_todo']
    : ['web_search', 'write_file', 'read_file', 'run_command'];

  // ── Browser interaction tools (post-navigation) ──
  const browserInteract = [
    'browser_snapshot', 'browser_click', 'browser_type', 'browser_scroll',
    'browser_press_key', 'browser_select_option', 'browser_evaluate',
    'browser_get_content', 'browser_screenshot', 'browser_back',
    'browser_hover', 'browser_tabs',
  ];

  // ── File/code tools ──
  const fileTools = [
    'edit_file', 'list_directory', 'search_codebase', 'find_files',
    'grep_search', 'delete_file', 'rename_file', 'get_file_info',
  ];

  // ── Escalation: after iteration 5, widen the set to prevent lockout ──
  // If the model has been working for 5+ iterations, it may need tools
  // outside the initial task-type set. Provide everything.
  if (iteration > 5) {
    const wide = [...core, 'browser_navigate', 'fetch_webpage', ...browserInteract, ...fileTools,
      'write_todos', 'update_todo', 'save_memory', 'get_memory', 'analyze_error',
      'git_status', 'git_diff', 'git_commit'];
    // Deduplicate
    return [...new Set(wide)].slice(0, maxTools);
  }

  // ── State machine: transition based on lastTool ──

  // After browser_navigate or browser_back: page just loaded, need to inspect it
  if (lastTool === 'browser_navigate' || lastTool === 'browser_back') {
    return [...new Set([...browserInteract, ...core, 'browser_navigate', 'fetch_webpage'])].slice(0, maxTools);
  }

  // After browser_snapshot or browser_get_content: have page data, can interact or extract
  if (lastTool === 'browser_snapshot' || lastTool === 'browser_get_content' || lastTool === 'browser_list_elements') {
    return [...new Set([
      'browser_click', 'browser_type', 'browser_select_option', 'browser_scroll',
      'browser_press_key', 'browser_hover', 'browser_evaluate', 'browser_navigate',
      'browser_back', 'browser_screenshot', ...core, 'fetch_webpage',
    ])].slice(0, maxTools);
  }

  // After browser interaction (click/type/select/press_key): page may have changed
  if (['browser_click', 'browser_type', 'browser_select_option', 'browser_press_key',
       'browser_hover', 'browser_scroll'].includes(lastTool)) {
    return [...new Set([
      'browser_snapshot', 'browser_click', 'browser_type', 'browser_scroll',
      'browser_press_key', 'browser_navigate', 'browser_evaluate', 'browser_back',
      'browser_screenshot', ...core,
    ])].slice(0, maxTools);
  }

  // After browser_evaluate: extracted data, likely need to write or continue browsing
  if (lastTool === 'browser_evaluate') {
    return [...new Set([
      ...core, 'browser_snapshot', 'browser_click', 'browser_navigate',
      'browser_back', 'edit_file', 'fetch_webpage',
    ])].slice(0, maxTools);
  }

  // After browser_screenshot: need to analyze or continue
  if (lastTool === 'browser_screenshot') {
    return [...new Set([
      'browser_snapshot', 'browser_click', 'browser_type', 'browser_navigate',
      ...core, 'browser_evaluate',
    ])].slice(0, maxTools);
  }

  // After read_file: likely edit, search more, or write
  if (lastTool === 'read_file') {
    return [...new Set([...core, ...fileTools, 'browser_navigate'])].slice(0, maxTools);
  }

  // After write_file or edit_file: verify, continue editing, or run
  if (lastTool === 'write_file' || lastTool === 'edit_file') {
    return [...new Set([...core, ...fileTools, 'browser_navigate'])].slice(0, maxTools);
  }

  // After web_search: browse results or write findings
  if (lastTool === 'web_search') {
    return [...new Set([...core, 'browser_navigate', 'fetch_webpage', 'browser_snapshot', ...fileTools])].slice(0, maxTools);
  }

  // After fetch_webpage: have page data, write or browse more
  if (lastTool === 'fetch_webpage') {
    return [...new Set([...core, 'browser_navigate', 'fetch_webpage', 'edit_file', ...browserInteract.slice(0, 4)])].slice(0, maxTools);
  }

  // After list_directory or find_files or search_codebase or grep_search: explore or edit
  if (['list_directory', 'find_files', 'search_codebase', 'grep_search'].includes(lastTool)) {
    return [...new Set([...core, ...fileTools, 'browser_navigate'])].slice(0, maxTools);
  }

  // After run_command: check results, edit files, or continue
  if (lastTool === 'run_command') {
    return [...new Set([...core, ...fileTools, 'browser_navigate'])].slice(0, maxTools);
  }

  // ── First iteration: entry-point tools based on task type ──
  if (iteration <= 1) {
    if (taskType === 'browser') {
      return [...new Set([...core, 'browser_navigate', 'fetch_webpage', 'browser_snapshot', ...browserInteract.slice(0, 3)])].slice(0, maxTools);
    }
    if (taskType === 'code') {
      return [...new Set([...core, ...fileTools, 'browser_navigate'])].slice(0, maxTools);
    }
    // General: file tools (list_directory, find_files) come before navigation tools so they
    // are always within budget even on small models. fetch_webpage is still accessible after
    // a web_search via the lastTool state transition.
    return [...new Set([...core, 'list_directory', 'find_files', 'search_codebase', 'browser_navigate', 'fetch_webpage', ...fileTools])].slice(0, maxTools);
  }

  // ── Context-aware fallback: widen based on what's been used ──
  if (usedBrowser) {
    return [...new Set([...core, 'browser_navigate', 'fetch_webpage', ...browserInteract, ...fileTools.slice(0, 3)])].slice(0, maxTools);
  }
  if (usedFiles) {
    return [...new Set([...core, ...fileTools, 'browser_navigate', 'fetch_webpage'])].slice(0, maxTools);
  }
  if (usedSearch) {
    return [...new Set([...core, 'browser_navigate', 'fetch_webpage', ...fileTools.slice(0, 4)])].slice(0, maxTools);
  }

  // ── Default: broad set ──
  const defaults = [...core, 'browser_navigate', 'browser_snapshot', 'edit_file',
    'list_directory', 'search_codebase', 'find_files', 'fetch_webpage',
    'browser_click', 'browser_type', 'browser_scroll'];
  return [...new Set(defaults)].slice(0, maxTools);
}

/**
 * PILLAR 3: Structured Error Recovery — Unified failure classification.
 * Replaces the scattered if/else nudge chains in agenticChat.js with a single
 * decision tree. Each failure type has a specific recovery strategy.
 *
 * Returns null if no failure detected (response is good, continue normally).
 * Returns { type, severity, recovery } if a failure is detected:
 *   - type: failure classification string
 *   - severity: 'retry' (same iteration) | 'nudge' (next iteration with feedback) | 'stop' (end loop)
 *   - recovery: { prompt, action } where prompt is the nudge text and action is what to do
 *
 * @param {string} responseText - The model's response text
 * @param {boolean} hasToolCalls - Whether the response contained tool calls
 * @param {string} taskType - 'browser', 'code', 'general', 'chat'
 * @param {number} iteration - Current agentic iteration
 * @param {string} originalMessage - The user's original message
 * @param {string} lastResponse - Previous iteration's response (for repetition detection)
 * @param {Object} options - { isBrowserTask, nudgesRemaining, allToolResults }
 * @returns {null | { type: string, severity: string, recovery: { prompt: string, action: string } }}
 */
function classifyResponseFailure(responseText, hasToolCalls, taskType, iteration, originalMessage, lastResponse, options = {}) {
  const text = (responseText || '').trim();
  const { isBrowserTask, nudgesRemaining = 0, allToolResults = [] } = options;

  // Tool calls present — no failure
  if (hasToolCalls) return null;

  // Chat task — text responses are always valid
  if (taskType === 'chat') return null;

  // ── 1. REFUSAL — model says it can't do something it can ──
  // CRITICAL: if real tools already ran this session (allToolResults.length > 0),
  // a text-only response is the FINAL ANSWER — not a refusal. Without this guard,
  // the classifier flags valid summaries like "Summary of Latest AI News..." as refusals
  // because the prose incidentally matches a pattern (e.g. "you can..."), triggering
  // forced retries that REPLACE the good response with a weaker one. Same guard exists
  // in evaluateResponse (!hasRunTools) — both must be in sync.
  if (EXPANDED_REFUSAL_PATTERNS.test(text) && iteration < 10 && allToolResults.length === 0) {
    const lower = (originalMessage || '').toLowerCase();
    let forcedTools = null;
    if (/\b(search|look\s*up|find|news|weather|current|latest|trending)\b/i.test(lower)) forcedTools = 'web_search';
    else if (/\b(go\s*to|navigate|open|visit|browse|website|\.com|\.org|https?:)\b/i.test(lower)) forcedTools = 'browser_navigate';
    else if (/\b(create|write|save|make|generate)\s*(a\s+)?file\b/i.test(lower)) forcedTools = 'write_file';
    else if (/\b(read|show|open|cat|view)\s*(the\s+)?file\b/i.test(lower)) forcedTools = 'read_file';
    else if (/\b(run|execute|install|npm|node|python|pip)\b/i.test(lower)) forcedTools = 'run_command';
    else forcedTools = 'web_search';

    return {
      type: 'refusal',
      severity: 'nudge',
      recovery: {
        action: 'force_tool',
        forcedTools: forcedTools ? [forcedTools] : null,
        prompt: `SYSTEM OVERRIDE: You have REAL, WORKING tools. Your previous response was a refusal — you DO have these capabilities. Complete the user's request by calling the ${forcedTools || 'appropriate'} tool NOW.\n\nUser request: ${originalMessage?.substring(0, 500)}`,
      },
    };
  }

  // ── 2. HALLUCINATION — model claims past-tense completion without tool calls ──
  const { hallucinatedActions, describedActions } = detectActionHallucination(text);
  if (hallucinatedActions && text.length > 50) {
    return {
      type: 'hallucination',
      severity: 'nudge',
      recovery: {
        action: 'nudge',
        prompt: `STOP. You claimed you already did things like "I navigated to" or "I created a file" — but you did NOT. You never called any tools. Nothing actually happened.\n\nYou have REAL tools. Output a REAL tool call NOW. Do NOT describe. Do NOT narrate. Output the tool call JSON block.`,
      },
    };
  }

  // ── 2b. WRONG-FORMAT TOOL CALL — model outputs tool calls as bash/shell instead of JSON ──
  // Small models sometimes write: ```bash\nwrite_file(index.html, ...)\n``` or
  // ```\nweb_search "query"\n``` instead of the required JSON block format.
  // The model clearly intends to call a tool — it's just using the wrong syntax.
  if (taskType !== 'chat' && nudgesRemaining > 0) {
    const hasBashToolDesc = (() => {
      // Match tool names as they'd appear in bash/shell syntax (followed by ( or space or quote)
      const toolNameInBash = /\b(write_file|read_file|edit_file|run_command|web_search|browser_navigate|browser_click|browser_type|browser_snapshot|list_directory|find_files|get_project_structure|delete_file|move_file|create_directory|update_todo)\s*[\(\s"']/;
      const bashBlockRegex = /```(\w*)[\n\r]([\s\S]*?)```/g;
      let m;
      while ((m = bashBlockRegex.exec(text)) !== null) {
        const lang = m[1].toLowerCase();
        if (['bash', 'sh', 'shell', ''].includes(lang) && toolNameInBash.test(m[2])) return true;
      }
      return false;
    })();
    if (hasBashToolDesc) {
      return {
        type: 'wrong_tool_format',
        severity: 'nudge',
        recovery: {
          action: 'nudge',
          prompt: `STOP. You wrote tool calls using bash/shell syntax inside a code block. That format does NOT execute any tool.\n\nTo call a tool you MUST output a JSON block in exactly this format:\n\`\`\`json\n{"tool": "read_file", "params": {"filePath": "src/app.js"}}\n\`\`\`\n\nCall the appropriate tool now using the JSON format above.`,
        },
      };
    }
  }

  // ── 3. DESCRIBED BUT NOT EXECUTED — model narrates plan without doing it ──
  if (describedActions && nudgesRemaining > 0) {
    if (isBrowserTask) {
      const urlMatch = originalMessage?.match(/(?:https?:\/\/[^\s]+|www\.[^\s]+)/i);
      const url = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : `https://${urlMatch[0]}`) : null;
      return {
        type: 'described_not_executed_browser',
        severity: 'nudge',
        recovery: {
          action: 'nudge',
          prompt: url && iteration <= 2
            ? `STOP. You did NOT call browser_navigate. Call it NOW:\n\n\`\`\`json\n{"tool": "browser_navigate", "params": {"url": "${url}"}}\n\`\`\`\n\nDo NOT describe anything. Just output the JSON tool call block above.`
            : `You responded with text but did NOT call any tool. You MUST call a browser tool to continue. Look at the element refs from the page snapshot and call the correct browser tool (browser_click, browser_type, browser_navigate, etc.) with the ref number NOW.`,
        },
      };
    }
    return {
      type: 'described_not_executed',
      severity: 'nudge',
      recovery: {
        action: 'nudge',
        prompt: `You described what you would do but did NOT actually call any tools. You have real tools available. Do NOT describe actions — EXECUTE them by outputting a tool call.\n\nNow call the appropriate tool to complete the user's request.`,
      },
    };
  }

  // ── 4. RAW CODE DUMP — model outputs file content as chat text ──
  const { shouldNudge: isRawDump } = detectRawCodeDump(text);
  if (isRawDump && nudgesRemaining > 0) {
    return {
      type: 'raw_code_dump',
      severity: 'nudge',
      recovery: {
        action: 'nudge',
        prompt: 'STOP. You just output a large block of code/content as raw text in the chat. The user CANNOT use this. To create or modify files, you MUST use the write_file or edit_file tool. Re-do this action properly using a tool call. Do NOT paste file content into the chat.',
      },
    };
  }

  // ── BUG-039: INCOHERENT / GIBBERISH OUTPUT — context-poison-induced token salad ──
  // Must come BEFORE truncation: gibberish also triggers runaway abort + endsAbruptly,
  // causing the classifier to wrongly return "truncation (severity: nudge)".
  // Real truncation has coherent (though incomplete) sentences. Gibberish has extreme word
  // repetition and near-zero unique vocabulary — detect that pattern and classify correctly.
  // Also detect multilingual token salad: high non-ASCII density signals the model is
  // emitting cross-language token patterns rather than coherent English responses.
  //
  // IMPORTANT: Filter common English stopwords before computing repetition ratio.
  // Without this, normal creative writing (stories, essays) triggers false positives
  // because words like "the", "and", "was", "in", "of" naturally repeat many times.
  // Real gibberish/token-salad repeats CONTENT words, not just function words.
  const _gStopwords = new Set(['the','and','was','is','are','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','that','this','these','those','with','from','into','onto','upon','they','them','their','there','here','when','where','what','which','who','how','but','not','for','nor','yet','its','his','her','our','your','him','she','him','out','all','each','every','both','few','more','most','other','some','such','than','too','very','just','also','over','then','now','only','even','back','after','before','about','through','during','because','while','since','although','though','however','therefore','thus','hence','whether','either','neither','another','again','already','much','many','any','one','two','three','four','five','six','seven','eight','nine','ten']);
  const _gAllWords = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const _gWords = _gAllWords.filter(w => !_gStopwords.has(w));
  const _gNonASCIIRatio = (text.match(/[^\x00-\x7F]/g) || []).length / Math.max(text.length, 1);
  if (_gWords.length >= 20) {
    const _gFreq = {};
    for (const w of _gWords) _gFreq[w] = (_gFreq[w] || 0) + 1;
    const _gUnique = Object.keys(_gFreq).length;
    const _gHighRepeat = Object.values(_gFreq).filter(c => c >= 3).length;
    const _gRepRatio = (_gWords.length - _gUnique) / _gWords.length;
    if ((_gRepRatio > 0.6 && _gHighRepeat > 10) || _gNonASCIIRatio > 0.03) {
      return {
        type: 'incoherent_output',
        severity: 'stop',
        recovery: {
          action: 'clear_context',
          prompt: 'The model produced incoherent output (context poisoning). Context has been cleared.',
        },
      };
    }
  }

  // ── 5. TRUNCATION — response cut off mid-code ──
  const { hasUnclosedCodeBlock, endsAbruptly } = detectTruncation(text);
  if (endsAbruptly && nudgesRemaining > 0) {
    return {
      type: 'truncation',
      severity: 'nudge',
      recovery: {
        action: 'nudge',
        prompt: getTruncationNudgeMessage(text, hasUnclosedCodeBlock),
      },
    };
  }

  // ── 6. REPETITION — near-duplicate of previous response ──
  if (lastResponse && text.length > 100 && iteration > 2) {
    if (isNearDuplicate(lastResponse, text, 0.80)) {
      return {
        type: 'repetition',
        severity: 'stop',
        recovery: {
          action: 'stop',
          prompt: '',
        },
      };
    }
  }

  // ── 7. INCOMPLETE PLAN — todos still pending but model stopped ──
  // (Checked by caller since it needs access to mcpToolServer._todos)

  // No failure detected
  return null;
}

/**
 * PILLAR 5: Progressive Context Compaction
 * Unified context management that replaces the two separate pruning systems
 * and the hard rotation. Operates in phases based on context usage percentage:
 *
 * Phase 1 (45-60%): Compress old tool results (keep last 4 fresh)
 * Phase 2 (60-75%): Prune verbose chat history messages
 * Phase 3 (75-85%): Aggressively compact — summarize tool results to one-liners,
 *                    trim fullResponseText, compress all but last 2 chat messages
 * Phase 4 (85%+):   Hard rotation (existing behavior, but as last resort)
 *
 * @param {Object} options
 * @param {number} options.contextUsedTokens - Current context usage in tokens
 * @param {number} options.totalContextTokens - Total context window size
 * @param {Array} options.allToolResults - Accumulated tool results
 * @param {Array} options.chatHistory - LLM engine chat history (mutated in place)
 * @param {string} options.fullResponseText - Accumulated response text
 * @returns {{ phase: number, pruned: number, newFullResponseText: string, shouldRotate: boolean }}
 */
function progressiveContextCompaction(options) {
  const { contextUsedTokens, totalContextTokens, allToolResults, chatHistory, fullResponseText } = options;
  const pct = contextUsedTokens / totalContextTokens;
  let pruned = 0;
  let newFullResponseText = fullResponseText;

  // Phase 1: Compress old tool results (45-60%)
  if (pct > 0.45 && allToolResults.length > 4) {
    for (let i = 0; i < allToolResults.length - 4; i++) {
      const tr = allToolResults[i];
      if (tr.result?._pruned) continue; // Already pruned
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result || '');
      if (resultStr.length > 500) {
        const status = tr.result?.success ? 'succeeded' : (tr.result?.error ? 'failed' : 'completed');
        tr.result = { _pruned: true, tool: tr.tool, status, snippet: resultStr.substring(0, 200) };
        pruned++;
      }
    }
  }

  // Phase 2: Prune verbose chat history (60-75%)
  if (pct > 0.60 && chatHistory) {
    pruned += pruneVerboseHistory(chatHistory, 6);
  }

  // Phase 3: Aggressive compaction (75-85%)
  if (pct > 0.75) {
    // Compress ALL tool results except last 2 to one-liners
    for (let i = 0; i < allToolResults.length - 2; i++) {
      const tr = allToolResults[i];
      if (!tr.result?._pruned) {
        const status = tr.result?.success ? 'ok' : 'fail';
        tr.result = { _pruned: true, tool: tr.tool, status };
        pruned++;
      }
    }
    // Trim fullResponseText to last 15K chars
    if (newFullResponseText.length > 15000) {
      newFullResponseText = newFullResponseText.substring(newFullResponseText.length - 15000);
      pruned++;
    }
    // Aggressive chat history pruning
    if (chatHistory) {
      pruned += pruneVerboseHistory(chatHistory, 2);
    }
  }

  // Phase 4: Signal hard rotation needed (80%+) — lowered from 85% to prevent
  // the model from entering the 80-100% zone where generation slows drastically
  const shouldRotate = pct > 0.80;

  if (pruned > 0) {
    console.log(`[Context Compaction] Phase ${pct > 0.75 ? 3 : pct > 0.60 ? 2 : 1}: compacted ${pruned} items at ${Math.round(pct * 100)}% usage`);
  }

  return { phase: pct > 0.80 ? 4 : pct > 0.75 ? 3 : pct > 0.60 ? 2 : pct > 0.45 ? 1 : 0, pruned, newFullResponseText, shouldRotate };
}

module.exports = {
  detectTruncation,
  detectActionHallucination,
  detectRawCodeDump,
  getTruncationNudgeMessage,
  autoSnapshotAfterBrowserAction,
  sendToolExecutionEvents,
  capArray,
  createIpcTokenBatcher,
  enrichErrorFeedback,
  pruneVerboseHistory,
  pruneCloudHistory,
  isNearDuplicate,
  EXPANDED_REFUSAL_PATTERNS,
  evaluateResponse,
  getModelTier,
  getProgressiveTools,
  classifyResponseFailure,
  progressiveContextCompaction,
};
