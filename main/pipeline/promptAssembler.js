/**
 * PromptAssembler — Budget-aware system prompt and tool feedback assembly.
 *
 * Uses appendIfBudget pattern: only includes content if token budget allows.
 * This prevents context overflow by construction — the prompt is always
 * guaranteed to fit within the available context window.
 *
 * Also provides intelligent tool result formatting with tool-specific
 * pretty-printing (not raw JSON dumps).
 *
 * Ported from main_backup_pre_rewrite/agenticChat.js (buildStaticPrompt, buildDynamicContext)
 * and main_backup_pre_rewrite/agenticChatHelpers.js (buildToolFeedback).
 */
'use strict';

const { estimateTokens } = require('./rollingSummary');

/**
 * Build the complete system prompt within a token budget.
 *
 * @param {string} basePreamble — DEFAULT_SYSTEM_PREAMBLE or DEFAULT_COMPACT_PREAMBLE
 * @param {string} toolHint — Pre-built compact tool hint from mcpToolServer.getCompactToolHint()
 * @param {string} projectPath — current project path (optional)
 * @param {object} currentFile — { path, content } of open file (optional)
 * @param {string} selectedCode — selected text in the editor (optional)
 * @param {object} opts — { maxTokens, contextSize } for budget-aware assembly
 * @returns {string} Complete system prompt
 */
function buildSystemPrompt(basePreamble, toolHint, projectPath, currentFile, selectedCode, opts = {}) {
  const maxTokens = opts.maxTokens || Infinity;
  let tokenBudget = maxTokens;
  let prompt = '';

  const appendIfBudget = (text) => {
    const cost = estimateTokens(text);
    if (cost < tokenBudget) {
      prompt += text;
      tokenBudget -= cost;
      return true;
    }
    return false;
  };

  // Base preamble — always included
  if (basePreamble) {
    appendIfBudget(basePreamble + '\n\n');
  }

  // Tool hint — high priority
  if (toolHint) {
    appendIfBudget(toolHint + '\n');
  }

  // Project context — medium priority
  if (projectPath) {
    appendIfBudget(`\n## Project\nProject path: ${projectPath}\n`);
  }

  // Open file context — lower priority (uses more tokens)
  if (currentFile?.path && tokenBudget > 200) {
    const maxFileChars = Math.min(tokenBudget * 3, 3000);
    const preview = (currentFile.content || '').slice(0, maxFileChars);
    const truncated = (currentFile.content || '').length > maxFileChars ? '\n...(truncated)' : '';
    appendIfBudget(`\nCurrently open file: ${currentFile.path}\n\`\`\`\n${preview}${truncated}\n\`\`\`\n`);
  }

  // Selected code — only if budget remains
  if (selectedCode && tokenBudget > 100) {
    const maxSelChars = Math.min(tokenBudget * 3, 2000);
    appendIfBudget(`\nSelected code:\n\`\`\`\n${selectedCode.slice(0, maxSelChars)}\n\`\`\`\n`);
  }

  return prompt;
}

/**
 * Format tool execution results as structured, tool-specific feedback.
 * Much more informative than raw JSON dumps — gives the model actionable info.
 *
 * @param {Array} results — [{tool, params, result}, ...]
 * @param {object} opts — { totalCtx } for context-aware truncation
 * @returns {string} Formatted results text
 */
function formatToolResults(results, opts = {}) {
  if (!results || results.length === 0) return 'No tool results.';

  const totalCtx = opts.totalCtx || 32768;

  return results.map(r => {
    const status = r.result?.success !== false ? '[OK]' : '[FAIL]';

    if (r.result?.success === false) {
      return `**${r.tool}** ${status}:\n**Error:** ${r.result?.error || 'Unknown error'}`;
    }

    // Tool-specific formatting
    return `**${r.tool}** ${status}:\n${_formatToolResult(r, totalCtx)}`;
  }).join('\n\n---\n\n');
}

/**
 * Tool-specific result formatting — shows the model exactly what it needs.
 */
function _formatToolResult(r, totalCtx) {
  switch (r.tool) {
    case 'read_file': {
      const content = r.result?.content || '';
      const filePath = r.params?.filePath || r.result?.path || '';
      if (content.length > 4000) {
        const lines = content.split('\n');
        const head = lines.slice(0, 15).join('\n');
        const tail = lines.slice(-40).join('\n');
        return `**File:** ${filePath}\n\`\`\`\n${head}\n... (${lines.length} lines total, middle omitted) ...\n${tail}\n\`\`\``;
      }
      return `**File:** ${filePath}\n\`\`\`\n${content.substring(0, 3000)}\n\`\`\``;
    }

    case 'write_file':
    case 'append_to_file': {
      const byteCount = (r.params?.content || '').length;
      return `**File written:** \`${r.result?.path || r.params?.filePath}\` (${byteCount.toLocaleString()} chars, ${r.result?.isNew ? 'new' : 'updated'})`;
    }

    case 'edit_file':
      return `**Edited:** ${r.params?.filePath} (${r.result?.replacements || 0} replacement(s))`;

    case 'list_directory': {
      const items = r.result?.items || [];
      const listing = items.map(f => f.name + (f.type === 'directory' ? '/' : '')).join(', ');
      return `**Contents of ${r.params?.dirPath || r.params?.path}:**\n${listing}`;
    }

    case 'run_command':
      return `**Command:** ${r.params?.command}\n**Exit Code:** ${r.result?.exitCode || 0}\n**Output:**\n\`\`\`\n${(r.result?.output || '').substring(0, 2000)}\n\`\`\``;

    case 'web_search': {
      const searchDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      let text = `**Search Results for "${r.params?.query}":** *(${searchDate})*\n`;
      for (const sr of (r.result?.results || []).slice(0, 5)) {
        text += `- [${sr.title}](${sr.url}): ${(sr.snippet || '').substring(0, 120)}\n`;
      }
      return text;
    }

    case 'fetch_webpage':
      return `**Page:** ${r.result?.title || 'Unknown'} (${r.result?.url || r.params?.url})\n\`\`\`\n${(r.result?.content || '').substring(0, 3000)}\n\`\`\``;

    case 'search_codebase': {
      let text = `**Search Results (${(r.result?.results || []).length} matches):**\n`;
      for (const sr of (r.result?.results || []).slice(0, 5)) {
        text += `- ${sr.file}:${sr.startLine}: ${(sr.preview || sr.snippet || '').substring(0, 150)}\n`;
      }
      return text;
    }

    case 'find_files':
      return `**Found ${(r.result?.files || []).length} Files:**\n${(r.result?.files || []).slice(0, 20).join('\n')}`;

    case 'browser_navigate':
      return `**Navigated to:** ${r.result?.url || r.params?.url}\n**Title:** ${r.result?.title || 'Loading...'}`;

    case 'browser_snapshot': {
      const maxSnapChars = totalCtx <= 8192 ? 4000 : totalCtx <= 16384 ? 6000 : 12000;
      const snap = String(r.result?.snapshot || '');
      let text = `**Page Snapshot** (${r.result?.elementCount || 0} elements):\n`;
      text += snap.substring(0, maxSnapChars);
      if (snap.length > maxSnapChars) text += '\n...(snapshot truncated)';
      return text;
    }

    case 'browser_click':
    case 'browser_type': {
      const target = r.params?.ref || r.params?.selector || 'unknown';
      let text = `**${r.tool === 'browser_click' ? 'Clicked' : 'Typed into'} element:** ref=${target}`;
      if (r.tool === 'browser_type') text += `\n**Text:** "${r.params?.text}"`;
      return text;
    }

    default: {
      // Generic: stringify but cap
      const output = JSON.stringify(r.result, null, 2);
      if (output.length > 4000) {
        return output.slice(0, 4000) + '\n...(truncated)';
      }
      return output;
    }
  }
}

module.exports = { buildSystemPrompt, formatToolResults };
