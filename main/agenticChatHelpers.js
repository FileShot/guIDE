/**
 * guIDE — Agentic Chat Helpers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 *
 * Shared helpers for both cloud and local agentic loops.
 * Rewritten from scratch with clean separation of concerns.
 */
'use strict';

/**
 * Check if a file's content looks syntactically complete.
 * Returns true if the file appears to be complete, false otherwise.
 * Used after write_file/append_to_file to decide if model should keep appending.
 */
function checkFileCompleteness(content, filePath) {
  if (!content || content.length < 20) return false;
  const trimmedEnd = content.trimEnd();
  const lastCodeLine = trimmedEnd.split('\n').pop().trim();
  const ext = (filePath?.match(/\.([^.]+)$/) || [])[1] || '';
  let looksComplete = false;
  if (/^html?$/i.test(ext)) {
    // Fix 42: Anchor to end of content — </html> must be near the end, not just anywhere in the string.
    // Without $, a </html> inside a JS string/template in the middle of the file triggers a false positive.
    looksComplete = /<\/html\s*>\s*$/i.test(trimmedEnd);
  } else if (/^css$/i.test(ext)) {
    looksComplete = false; // lone } is unreliable for CSS
  } else {
    looksComplete = /^(module\.exports\s*=|export\s+(default\s+)?|\}\s*;?\s*$|\}\)\s*;?\s*$)/.test(lastCodeLine);
  }
  // Secondary: open HTML tags without closing counterparts = incomplete
  if (looksComplete && /<(style|script)\b/i.test(content) && !/<\/(style|script)\s*>/i.test(content)) {
    looksComplete = false;
  }
  return looksComplete;
}

/**
 * Near-duplicate detection using word-level Jaccard overlap.
 * Two texts with >80% word overlap are considered near-duplicates.
 */
function isNearDuplicate(a, b, threshold = 0.80) {
  if (!a || !b) return false;
  const wordsA = new Set(a.substring(0, 500).toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.substring(0, 500).toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && (intersection / union) >= threshold;
}

/**
 * Auto-capture a page snapshot after browser navigation/interaction actions.
 */
async function autoSnapshotAfterBrowserAction(toolResults, mcpToolServer, playwrightBrowser, browserManager) {
  const TRIGGER_TOOLS = ['browser_navigate', 'browser_click', 'browser_type', 'browser_select', 'browser_back', 'browser_press_key'];
  const hasBrowserAction = toolResults.some(r => r.tool?.startsWith('browser_'));
  const didSnapshot = toolResults.some(r => r.tool === 'browser_snapshot' || r.tool === 'browser_get_snapshot');
  if (!hasBrowserAction || didSnapshot) return null;

  const lastBrowserAction = toolResults.filter(r => r.tool?.startsWith('browser_')).pop();
  if (!lastBrowserAction || !TRIGGER_TOOLS.includes(lastBrowserAction.tool)) return null;

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
 * Send UI notifications for tool execution events.
 */
function sendToolExecutionEvents(mainWindow, toolResults, playwrightBrowser, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return { filesChanged: false };
  const { checkSuccess = false } = opts;
  let filesChanged = false;

  for (const tr of toolResults) {
    mainWindow.webContents.send('tool-executing', { tool: tr.tool, params: tr.params, result: tr.result });
    if (tr.tool?.startsWith('browser_') && !playwrightBrowser?.isLaunched) {
      mainWindow.webContents.send('show-browser', { url: tr.params?.url || '' });
    }
    const isFileOp = ['write_file', 'append_to_file', 'create_directory', 'edit_file', 'delete_file', 'rename_file'].includes(tr.tool);
    const passed = checkSuccess ? tr.result?.success : true;
    if (isFileOp && passed) {
      filesChanged = true;
      if (['write_file', 'append_to_file', 'edit_file'].includes(tr.tool) && tr.params?.filePath) {
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
 */
function capArray(arr, maxLen) {
  if (arr.length > maxLen) {
    arr.splice(0, arr.length - maxLen);
  }
}

/**
 * Batch high-frequency token IPC into fewer sends for smooth rendering.
 */
function createIpcTokenBatcher(mainWindow, channel, canSend, opts = {}) {
  const flushIntervalMs = Number.isFinite(opts.flushIntervalMs) ? opts.flushIntervalMs : 25;
  const maxBufferChars = Number.isFinite(opts.maxBufferChars) ? opts.maxBufferChars : 2048;
  const flushOnNewline = opts.flushOnNewline !== false;
  const charsPerFlush = Number.isFinite(opts.charsPerFlush) && opts.charsPerFlush > 0 ? opts.charsPerFlush : null;

  let buffer = '';
  let timer = null;

  const sendRaw = (text) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
      if (typeof canSend === 'function' && !canSend()) return;
      // Token batch logging: log what the model generates so we can diagnose
      // generation stalls, false-close bugs, and unexpected content mid-stream.
      if (channel === 'llm-token') {
        const preview = text.length > 120 ? text.slice(0, 80) + '…' + text.slice(-20) : text;
        console.log('[LLM-BATCH]', JSON.stringify(preview));
      }
      mainWindow.webContents.send(channel, text);
    } catch (_) {}
  };

  const flush = () => {
    if (!buffer) return;
    if (charsPerFlush && buffer.length > charsPerFlush) {
      const chunk = buffer.slice(0, charsPerFlush);
      buffer = buffer.slice(charsPerFlush);
      sendRaw(chunk);
      if (!timer) timer = setTimeout(() => { timer = null; flush(); }, flushIntervalMs);
      return;
    }
    const text = buffer;
    buffer = '';
    sendRaw(text);
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, flushIntervalMs);
  };

  const push = (token) => {
    if (!token) return;
    buffer += token;
    if (flushOnNewline && token.includes('\n')) { flush(); return; }
    if (!charsPerFlush && buffer.length >= maxBufferChars) { flush(); return; }
    scheduleFlush();
  };

  const dispose = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (buffer) { sendRaw(buffer); buffer = ''; }
  };

  return { push, flush, dispose };
}

/**
 * Provide actionable guidance when a tool fails.
 */
function enrichErrorFeedback(toolName, error, failCounts = {}) {
  const err = String(error || '');
  const tips = [];

  if (toolName === 'edit_file' && /oldText not found/i.test(err)) {
    tips.push('Use read_file to see the exact current file content, then retry edit_file with the correct oldText.');
  }
  if (toolName === 'write_file' && /empty/i.test(err)) {
    tips.push('Provide the complete file content in the "content" parameter.');
  }
  if (/not found|no such file/i.test(err) && /file/i.test(toolName)) {
    tips.push('File does not exist. Use find_files to search for it, then retry with the correct path.');
  }
  if (/not found|no element/i.test(err) && toolName.startsWith('browser_')) {
    tips.push('Element not found. Use browser_snapshot to see current elements, then use the correct ref number.');
  }
  if (/timeout/i.test(err) && toolName.startsWith('browser_')) {
    tips.push('Operation timed out. Try browser_wait_for({selector:"body"}) first.');
  }
  if (toolName === 'run_command' && /not recognized|not found/i.test(err)) {
    tips.push('Command not recognized. This is Windows — use PowerShell syntax.');
  }

  const failCount = failCounts[toolName] || 0;
  if (failCount >= 3) {
    const escalations = {
      browser_click: 'Try browser_evaluate with document.querySelector(...).click() instead.',
      browser_type: 'Try browser_evaluate to set the value directly.',
      browser_navigate: 'Try web_search or fetch_webpage instead.',
      edit_file: 'Use read_file to get exact content, then write_file to replace the file.',
      run_command: 'Break into smaller steps or create a script file first.',
    };
    if (escalations[toolName]) tips.unshift(`ESCALATION: ${escalations[toolName]}`);
  }

  return tips.length > 0 ? `\nSuggestion: ${tips[0]}` : '';
}

/**
 * Prune verbose messages in chat history to free context space.
 */
function pruneVerboseHistory(chatHistory, keepRecentCount = 6) {
  if (!Array.isArray(chatHistory) || chatHistory.length <= keepRecentCount + 1) return 0;

  let pruned = 0;
  const cutoff = chatHistory.length - keepRecentCount;

  for (let i = 1; i < cutoff; i++) {
    const msg = chatHistory[i];
    if (!msg) continue;

    // Handle model responses: { type: 'model', response: [text] }
    if (msg.type === 'model' && Array.isArray(msg.response)) {
      let changed = false;
      for (let ri = 0; ri < msg.response.length; ri++) {
        const r = msg.response[ri];
        if (typeof r !== 'string' || r.length < 800) continue;
        let compressed = r;
        compressed = compressed.replace(
          /```[\s\S]{800,}?```/g,
          (match) => `\`\`\`\n[${(match.match(/\n/g) || []).length} lines — pruned]\n\`\`\``
        );
        if (compressed.length < r.length * 0.7) {
          msg.response[ri] = compressed;
          changed = true;
        }
      }
      if (changed) pruned++;
      continue;
    }

    // Handle user/system messages: { type: 'user'|'system', text: '...' }
    if (!msg.text || msg.text.length < 800) continue;

    let compressed = msg.text;
    compressed = compressed.replace(
      /```[\s\S]{800,}?```/g,
      (match) => `\`\`\`\n[${(match.match(/\n/g) || []).length} lines — pruned]\n\`\`\``
    );
    compressed = compressed.replace(
      /\*\*Page Snapshot\*\*\s*\([^)]*\):\n[\s\S]{500,}?(?=\n\*\*|\n###|\n---|$)/g,
      (match) => `**Page Snapshot**: [pruned for context]`
    );

    if (compressed.length < msg.text.length * 0.7) {
      chatHistory[i] = { ...msg, text: compressed };
      pruned++;
    }
  }
  return pruned;
}

/**
 * Prune verbose messages in cloud conversation history.
 */
function pruneCloudHistory(history, keepRecentCount = 6) {
  if (!Array.isArray(history) || history.length <= keepRecentCount + 1) return 0;

  let pruned = 0;
  const cutoff = history.length - keepRecentCount;

  for (let i = 1; i < cutoff; i++) {
    const msg = history[i];
    if (!msg || !msg.content || msg.content.length < 800) continue;

    let compressed = msg.content;
    compressed = compressed.replace(
      /```[\s\S]{800,}?```/g,
      (match) => `\`\`\`\n[${(match.match(/\n/g) || []).length} lines — pruned]\n\`\`\``
    );

    if (compressed.length < msg.content.length * 0.7) {
      history[i] = { ...msg, content: compressed };
      pruned++;
    }
  }
  return pruned;
}

/**
 * Response evaluation — determines whether to COMMIT or ROLLBACK.
 * Only retries on genuinely empty responses.
 */
function evaluateResponse(responseText, functionCalls, taskType, iteration) {
  const text = (responseText || '').trim();
  const hasFunctionCalls = Array.isArray(functionCalls) && functionCalls.length > 0;

  if (hasFunctionCalls) return { verdict: 'COMMIT', reason: 'tool_call' };

  const hasToolJson = /```(?:tool_call|tool|json)[^\n]*\n[\s\S]*?```/.test(text) ||
    /\{\s*"(?:tool|name)"\s*:\s*"[^"]+"/.test(text);
  if (hasToolJson) return { verdict: 'COMMIT', reason: 'text_tool_call' };

  if (text.length === 0) return { verdict: 'ROLLBACK', reason: 'empty' };

  return { verdict: 'COMMIT', reason: 'default' };
}

/**
 * Failure classification — only stops loop on genuine infinite repetition.
 */
function classifyResponseFailure(responseText, hasToolCalls, taskType, iteration, originalMessage, lastResponse, options = {}) {
  if (hasToolCalls) return null;

  const text = (responseText || '').trim();
  if (lastResponse && text.length > 100) {
    if (isNearDuplicate(lastResponse, text, 0.80)) {
      return { type: 'repetition', severity: 'stop', recovery: { action: 'stop', prompt: '' } };
    }
  }

  return null;
}

/**
 * Progressive context compaction — operates in 4 phases based on context usage.
 */
function progressiveContextCompaction(options) {
  const { contextUsedTokens, totalContextTokens, allToolResults, chatHistory, fullResponseText } = options;
  const pct = contextUsedTokens / totalContextTokens;
  let pruned = 0;
  let newFullResponseText = fullResponseText;

  // Dynamic thresholds: small contexts need EARLIER compaction because each tool result
  // and chat turn consumes a proportionally larger fraction of available space.
  // For ctx ≤ 16K, shift all thresholds down by 15 percentage points.
  // For ctx ≤ 8K, shift down by 25 percentage points.
  const offset = totalContextTokens <= 8192 ? 0.25
    : totalContextTokens <= 16384 ? 0.15
    : 0;
  const phase1Threshold = 0.35 - offset;
  const phase2Threshold = 0.50 - offset;
  const phase3Threshold = 0.65 - offset;
  const rotateThreshold = 0.80 - offset;

  // Phase 1: Compress old tool results
  if (pct > phase1Threshold && allToolResults.length > 4) {
    for (let i = 0; i < allToolResults.length - 4; i++) {
      const tr = allToolResults[i];
      if (tr.result?._pruned) continue;
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result || '');
      if (resultStr.length > 500) {
        const status = tr.result?.success ? 'succeeded' : 'completed';
        tr.result = { _pruned: true, tool: tr.tool, status, snippet: resultStr.substring(0, 200) };
        pruned++;
      }
    }
  }

  // Phase 2: Prune verbose chat history
  if (pct > phase2Threshold && chatHistory) {
    pruned += pruneVerboseHistory(chatHistory, 6);
  }

  // Phase 3: Aggressive compaction — protect last 4 results so model can see recent tool output
  if (pct > phase3Threshold) {
    const protectCount = Math.min(4, allToolResults.length);
    for (let i = 0; i < allToolResults.length - protectCount; i++) {
      const tr = allToolResults[i];
      if (!tr.result?._pruned) {
        const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result || '');
        const status = tr.result?.success !== false ? 'ok' : 'fail';
        tr.result = { _pruned: true, tool: tr.tool, status, snippet: resultStr.substring(0, 300) };
        pruned++;
      }
    }
    if (newFullResponseText.length > 15000) {
      const target = newFullResponseText.length - 15000;
      let cutPoint = newFullResponseText.indexOf('\n\n', target);
      if (cutPoint === -1 || cutPoint > target + 500) {
        cutPoint = newFullResponseText.indexOf('\n', target);
      }
      if (cutPoint === -1 || cutPoint > target + 500) {
        cutPoint = target;
      }
      newFullResponseText = newFullResponseText.substring(cutPoint);
      pruned++;
    }
    if (chatHistory) pruned += pruneVerboseHistory(chatHistory, 2);
  }

  const shouldRotate = pct > rotateThreshold;

  if (pruned > 0) {
    console.log(`[Context Compaction] Phase ${pct > phase3Threshold ? 3 : pct > phase2Threshold ? 2 : 1}: compacted ${pruned} items at ${Math.round(pct * 100)}% usage (ctx=${totalContextTokens}, rotateAt=${Math.round(rotateThreshold * 100)}%)`);
  }

  return {
    phase: pct > (phase3Threshold + 0.05) ? 4 : pct > phase3Threshold ? 3 : pct > phase2Threshold ? 2 : pct > phase1Threshold ? 1 : 0,
    pruned,
    newFullResponseText,
    shouldRotate,
  };
}

/**
 * Build structured tool feedback from executed tool results.
 * Formats each tool's result into readable text for the model's next iteration.
 */
function buildToolFeedback(toolResults, opts = {}) {
  const { truncateResult, totalCtx = 32768, allToolResults = [], writeFileHistory = {}, currentIterationStart = 0 } = opts;

  let feedback = '\n\n## Tool Execution Results\n';

  for (const tr of toolResults) {
    const status = tr.result?.success ? '[OK]' : '[FAIL]';
    feedback += `\n### ${tr.tool} ${status}\n`;

    if (tr.result?.success) {
      feedback += formatSuccessfulToolResult(tr, { totalCtx, allToolResults, writeFileHistory, currentIterationStart });
    } else {
      feedback += `**Error:** ${tr.result?.error || 'Unknown error'}\n`;
    }
  }

  if (!feedback.endsWith('\n\n')) feedback = feedback.trimEnd() + '\n\n';
  return feedback;
}

/**
 * Format a successful tool result into readable feedback.
 */
function formatSuccessfulToolResult(tr, opts = {}) {
  const { totalCtx = 32768, allToolResults = [], writeFileHistory = {}, currentIterationStart = 0 } = opts;
  let text = '';

  switch (tr.tool) {
    case 'read_file':
      text += `**File:** ${tr.params?.filePath}${tr.result.readRange ? ` (lines ${tr.result.readRange})` : ''}\n`;
      {
        // Fix 58B: Show head+tail for large files so the model can see both
        // the file structure AND where it left off (critical for append workflows)
        const content = tr.result.content || '';
        if (content.length > 4000) {
          const lines = content.split('\n');
          const head = lines.slice(0, 15).join('\n');
          const tail = lines.slice(-40).join('\n');
          text += `\`\`\`\n${head}\n... (${lines.length} lines total, middle omitted) ...\n${tail}\n\`\`\`\n`;
        } else {
          text += `\`\`\`\n${content.substring(0, 3000)}\n\`\`\`\n`;
        }
      }
      break;

    case 'write_file':
    case 'append_to_file': {
      const byteCount = (tr.params?.content || '').length;
      text += `**File written:** \`${tr.result.path}\` (${byteCount.toLocaleString()} chars, ${tr.result.isNew ? 'new' : 'updated'})\n`;

      if (tr.tool === 'write_file') {
        const prevWrites = allToolResults.slice(0, currentIterationStart).some(
          prev => prev.tool === 'write_file' && prev.params?.filePath === tr.params?.filePath
        );
        if (prevWrites) {
          text += `*File updated (already created earlier). This file is complete.*\n`;
        } else {
          text += `*File written. If more files needed, call write_file for the next one.*\n`;
        }

        // Regression detection
        if (tr.params?.filePath) {
          const key = tr.params.filePath;
          const len = (tr.params.content || '').length;
          if (!writeFileHistory[key]) writeFileHistory[key] = { count: 0, maxLen: 0 };
          writeFileHistory[key].count++;
          if (len > writeFileHistory[key].maxLen) writeFileHistory[key].maxLen = len;
          if (writeFileHistory[key].count >= 3 && len < writeFileHistory[key].maxLen * 0.5) {
            text += `**WARNING: "${key}" written ${writeFileHistory[key].count} times and shrinking. STOP writing this file.**\n`;
          }
        }
      } else {
        const appendFullContent = tr.result?.fullContent || '';
        const appendFilePath = tr.result?.path || tr.params?.filePath || '';
        if (appendFullContent && !checkFileCompleteness(appendFullContent, appendFilePath)) {
          const appendLines = appendFullContent.split('\n');
          const appendTail = appendLines.slice(-10).join('\n');
          text += `**WARNING: File "${appendFilePath}" is still NOT complete after this append (${appendLines.length} lines total).** The file is missing closing tags or content. You MUST call append_to_file again with actual code content. Do NOT send empty content. Here are the last 10 lines of the file:\n\`\`\`\n${appendTail}\n\`\`\`\nContinue from here.\n`;
        } else {
          text += `*Content appended successfully.*\n`;
        }
      }

      // Fix 59C: Post-write structural validation — immediate feedback loop
      // Provides IDE-level diagnostics (like LSP Problems panel) so the model
      // knows the structural state of the file RIGHT AFTER writing, not just at rotation.
      const writtenFilePath = tr.result?.path || tr.params?.filePath || '';
      const fullWrittenContent = (tr.tool === 'append_to_file' && tr.result?.fullContent)
        ? tr.result.fullContent : (tr.params?.content || '');
      if (writtenFilePath && fullWrittenContent.length > 100) {
        const digest = buildFileStructureDigest(writtenFilePath, fullWrittenContent);
        if (digest) {
          // Extract only the structural warnings — skip LAST 3 LINES and full header to stay compact
          const digestLines = digest.split('\n');
          const structuralNotes = digestLines.filter(l =>
            l.startsWith('HTML TAGS MISSING') ||
            l.startsWith('CSS SELECTORS ALREADY DEFINED') ||
            l.startsWith('STATUS:')
          );
          if (structuralNotes.length > 0) {
            text += `**Structure:** ${structuralNotes.join(' | ')}\n`;
          }
        }
      }
      break;
    }

    case 'edit_file':
      text += `**Edited:** ${tr.params?.filePath} (${tr.result.replacements} replacement(s))\n`;
      break;

    case 'list_directory':
      text += `**Contents of ${tr.params?.dirPath}:**\n${(tr.result.items || []).map(f => f.name + (f.type === 'directory' ? '/' : '')).join(', ')}\n`;
      break;

    case 'run_command':
      text += `**Command:** ${tr.params?.command}\n**Exit Code:** ${tr.result.exitCode || 0}\n`;
      text += `**Output:**\n\`\`\`\n${(tr.result.output || '').substring(0, 2000)}\n\`\`\`\n`;
      break;

    case 'web_search': {
      const searchDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      text += `**Search Results for "${tr.params?.query}":** *(${searchDate})*\n`;
      for (const r of (tr.result.results || []).slice(0, 5)) {
        text += `- [${r.title}](${r.url}): ${(r.snippet || '').substring(0, 120)}\n`;
      }
      break;
    }

    case 'fetch_webpage':
      text += `**Page:** ${tr.result.title || 'Unknown'} (${tr.result.url || tr.params?.url})\n`;
      text += `\`\`\`\n${(tr.result.content || '').substring(0, 3000)}\n\`\`\`\n`;
      break;

    case 'search_codebase':
      text += `**Search Results (${(tr.result.results || []).length} matches):**\n`;
      for (const r of (tr.result.results || []).slice(0, 5)) {
        text += `- ${r.file}:${r.startLine}: ${(r.preview || r.snippet || '').substring(0, 150)}\n`;
      }
      break;

    case 'find_files':
      text += `**Found ${(tr.result.files || []).length} Files:**\n${(tr.result.files || []).slice(0, 20).join('\n')}\n`;
      break;

    case 'browser_navigate':
      text += `**Navigated to:** ${tr.result.url || tr.params?.url}\n`;
      text += `**Title:** ${tr.result.title || 'Loading...'}\n`;
      if (tr.result.pageText && tr.result.pageText.length > 50) {
        text += `**Page Text:**\n${tr.result.pageText.substring(0, 2000)}\n`;
      }
      break;

    case 'browser_snapshot':
      text += `**Page Snapshot** (${tr.result.elementCount} elements):\n`;
      const maxSnapChars = totalCtx <= 8192 ? 4000 : totalCtx <= 16384 ? 6000 : 12000;
      const snap = String(tr.result.snapshot || '');
      text += snap.substring(0, maxSnapChars);
      if (snap.length > maxSnapChars) text += `\n...(snapshot truncated)`;
      text += '\n';
      break;

    case 'browser_click':
    case 'browser_type': {
      const target = tr.params?.ref || tr.params?.selector || 'unknown';
      text += `**${tr.tool === 'browser_click' ? 'Clicked' : 'Typed into'} element:** ref=${target}\n`;
      if (tr.tool === 'browser_type') text += `**Text:** "${tr.params?.text}"\n`;
      break;
    }

    case 'browser_screenshot':
      text += `**Screenshot captured** (${tr.result.width}x${tr.result.height})\n`;
      break;

    case 'git_status':
      text += `**Branch:** ${tr.result.branch}\n**Changes:** ${tr.result.totalChanges} file(s)\n`;
      for (const f of (tr.result.files || []).slice(0, 10)) {
        text += `- ${f.status} ${f.path}\n`;
      }
      break;

    case 'git_diff':
      text += `\`\`\`diff\n${(tr.result.diff || '').substring(0, 2000)}\n\`\`\`\n`;
      break;

    default:
      text += `**Result:** ${tr.result?.message || 'Done'}\n`;
  }

  return text;
}

/**
 * Execution state tracker — ground truth of what actually happened.
 */
class ExecutionState {
  constructor() {
    this.urlsVisited = [];
    this.filesCreated = [];
    this.filesEdited = [];
    this.dataExtracted = [];
    this.searchesPerformed = [];
    this.domainsBlocked = new Set();
    this._domainAttempts = {};
  }

  update(toolName, params, result, iteration) {
    if (toolName === 'browser_navigate' && params?.url) {
      const success = result?.success !== false;
      this.urlsVisited.push({ url: params.url, iteration, success });
      try {
        const domain = new URL(params.url).hostname;
        if (!this._domainAttempts[domain]) this._domainAttempts[domain] = { attempts: 0, failures: 0 };
        this._domainAttempts[domain].attempts++;
        if (!success) this._domainAttempts[domain].failures++;
        const resultText = JSON.stringify(result || '').toLowerCase();
        if (/captcha|bot.detect|challenge|cloudflare|blocked/i.test(resultText)) {
          this.domainsBlocked.add(domain);
        }
      } catch (_) {}
    }
    if (toolName === 'write_file' && result?.success && params?.filePath) {
      this.filesCreated.push({ path: params.filePath, iteration });
    }
    if (toolName === 'edit_file' && result?.success && params?.filePath) {
      this.filesEdited.push({ path: params.filePath, iteration });
    }
    if (['browser_snapshot', 'browser_evaluate', 'fetch_webpage'].includes(toolName) && result?.success) {
      this.dataExtracted.push({ source: toolName, iteration });
    }
    if (toolName === 'web_search' && params?.query) {
      this.searchesPerformed.push({ query: params.query, iteration });
    }
  }

  getSummary() {
    const parts = [];
    if (this.urlsVisited.length > 0) {
      const recent = this.urlsVisited.slice(-5);
      parts.push(`URLs visited: ${recent.map(v => `${v.success ? 'OK' : 'FAIL'} ${v.url}`).join(', ')}`);
    }
    if (this.filesCreated.length > 0) {
      parts.push(`Files created: ${this.filesCreated.map(f => f.path).join(', ')}`);
    }
    if (this.filesEdited.length > 0) {
      parts.push(`Files edited: ${this.filesEdited.map(f => f.path).join(', ')}`);
    }
    if (this.domainsBlocked.size > 0) {
      parts.push(`BLOCKED domains: ${[...this.domainsBlocked].join(', ')}`);
    }
    return parts.length > 0 ? `\n[EXECUTION STATE]\n${parts.join('\n')}\n` : '';
  }

  checkDomainLimit(url) {
    try {
      const domain = new URL(url).hostname;
      if (this.domainsBlocked.has(domain)) {
        return `STOP: ${domain} has bot detection. Use web_search or fetch_webpage instead.`;
      }
      const info = this._domainAttempts[domain];
      if (info && info.attempts >= 4) {
        return `STOP: ${domain} tried ${info.attempts} times. Switch to a different approach.`;
      }
    } catch (_) {}
    return null;
  }
}

/**
 * Build a compact structural digest of a file's content.
 * This digest survives context rotation and tells the model what's already
 * on disk — preventing duplicate CSS selectors, reopened tags, etc.
 *
 * @param {string} filePath - File path (used for extension detection)
 * @param {string} content  - Full file content
 * @returns {string} Compact multi-line digest for injection into prompts
 */
function buildFileStructureDigest(filePath, content) {
  if (!content || content.length < 10) return '';
  const ext = (filePath || '').split('.').pop().toLowerCase();
  const lines = content.split('\n');
  const totalLines = lines.length;
  const sections = [];

  // --- HTML / CSS structure ---
  if (ext === 'html' || ext === 'htm' || ext === 'css' || ext === 'svelte' || ext === 'vue') {
    // Detect HTML structural tags present
    const htmlTags = [];
    const htmlMissing = [];
    const structChecks = [
      ['<!DOCTYPE', '<!DOCTYPE>'],
      ['<html', '<html>'],
      ['<head', '<head>'],
      ['</head>', '</head>'],
      ['<style', '<style>'],
      ['</style>', '</style>'],
      ['<body', '<body>'],
      ['</body>', '</body>'],
      ['<header', '<header>'],
      ['</header>', '</header>'],
      ['<main', '<main>'],
      ['<footer', '<footer>'],
      ['</footer>', '</footer>'],
      ['</html>', '</html>'],
    ];
    for (const [search, label] of structChecks) {
      if (content.includes(search)) htmlTags.push(label);
      else htmlMissing.push(label);
    }
    if (htmlTags.length > 0) sections.push(`HTML TAGS PRESENT: ${htmlTags.join(', ')}`);
    if (htmlMissing.length > 0 && ext === 'html') sections.push(`HTML TAGS MISSING (still needed): ${htmlMissing.join(', ')}`);

    // Extract CSS selectors (anything before { that is a valid selector)
    const selectorSet = new Set();
    const selectorRegex = /^[ \t]*([^{}@/\n*][^{]*?)\s*\{/gm;
    let m;
    while ((m = selectorRegex.exec(content)) !== null) {
      let sel = m[1].trim();
      // Skip CSS property lines that leaked through (contain : before {)
      if (sel.includes(':') && !sel.includes('::') && !sel.includes(':hover') &&
          !sel.includes(':focus') && !sel.includes(':active') && !sel.includes(':first') &&
          !sel.includes(':last') && !sel.includes(':nth') && !sel.includes(':not') &&
          !sel.includes(':root')) continue;
      if (sel.length > 0 && sel.length < 80) selectorSet.add(sel);
    }
    if (selectorSet.size > 0) {
      const selList = [...selectorSet];
      // Cap to 60 selectors to stay compact
      const display = selList.length > 60 ? selList.slice(0, 60).join(', ') + ` ... (${selList.length} total)` : selList.join(', ');
      sections.push(`CSS SELECTORS ALREADY DEFINED (do NOT redefine): ${display}`);
    }

    // Detect if <style> is open but not closed
    const styleOpens = (content.match(/<style[\s>]/gi) || []).length;
    const styleCloses = (content.match(/<\/style>/gi) || []).length;
    if (styleOpens > styleCloses) {
      sections.push(`STATUS: <style> tag is OPEN (not closed). Close </style> before starting <body>.`);
    }
  }

  // --- JavaScript / TypeScript structure ---
  if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx' || ext === 'mjs' || ext === 'cjs') {
    const funcs = new Set();
    const funcRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[^=])\s*=>|class\s+(\w+))/g;
    let fm;
    while ((fm = funcRegex.exec(content)) !== null) {
      const name = fm[1] || fm[2] || fm[3];
      if (name) funcs.add(name);
    }
    if (funcs.size > 0) {
      const display = [...funcs].slice(0, 40).join(', ');
      sections.push(`DEFINED: ${display}`);
    }
    // Detect exports
    const expMatch = content.match(/module\.exports\s*=|export\s+(?:default|{)/g);
    if (expMatch) sections.push(`EXPORTS: ${expMatch.length} export statement(s)`);
  }

  // --- Python structure ---
  if (ext === 'py') {
    const pyDefs = new Set();
    const pyRegex = /^(?:class|def)\s+(\w+)/gm;
    let pm;
    while ((pm = pyRegex.exec(content)) !== null) pyDefs.add(pm[1]);
    if (pyDefs.size > 0) sections.push(`DEFINED: ${[...pyDefs].join(', ')}`);
  }

  // --- Universal: last 3 lines for continuation context ---
  const lastLines = lines.slice(-3).map(l => l.trimEnd()).join('\n');
  sections.push(`LAST 3 LINES:\n${lastLines}`);

  return `FILE: ${filePath} (${totalLines} lines, ${content.length} chars)\n${sections.join('\n')}`;
}

module.exports = {
  isNearDuplicate,
  checkFileCompleteness,
  autoSnapshotAfterBrowserAction,
  sendToolExecutionEvents,
  capArray,
  createIpcTokenBatcher,
  enrichErrorFeedback,
  pruneVerboseHistory,
  pruneCloudHistory,
  evaluateResponse,
  classifyResponseFailure,
  progressiveContextCompaction,
  buildToolFeedback,
  buildFileStructureDigest,
  ExecutionState,
};
