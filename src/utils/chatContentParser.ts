/**
 * Chat content parsing utilities — pure functions extracted from ChatPanel.
 * Handles tool call detection, artifact stripping, and content segmentation.
 */

export type ContentSegment = {
  type: 'text' | 'tool';
  content: string;
  toolCall?: { tool: string; params: Record<string, unknown> };
};

export type ToolResult = { isOk: boolean; text: string };

/**
 * Valid tool names — mirrors the backend VALID_TOOLS set in mcpToolParser.js.
 * Tool calls with names NOT in this set are hallucinations from small models
 * and should be rendered as plain text, not as interactive tool cards.
 */
const VALID_TOOL_NAMES = new Set([
  'write_file', 'read_file', 'edit_file', 'delete_file', 'rename_file', 'create_directory',
  'list_directory', 'find_files', 'search_codebase', 'grep_search', 'get_project_structure',
  'run_command', 'web_search', 'fetch_webpage',
  'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_screenshot', 'browser_evaluate', 'browser_scroll', 'browser_back',
  'browser_select', 'browser_hover', 'browser_press_key', 'browser_get_url',
  'browser_get_content', 'browser_get_links', 'browser_wait_for_element',
  'browser_fill_form', 'browser_handle_dialog', 'browser_tabs', 'browser_close',
  'browser_drag', 'browser_console_messages', 'browser_file_upload', 'browser_resize',
  'browser_select_option', 'browser_wait',
  'save_memory', 'get_memory', 'list_memories', 'install_packages',
  'get_file_info', 'analyze_error', 'git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch',
  'replace_in_files', 'undo_edit', 'delegate_task',
  'write_todos', 'update_todo', 'write_scratchpad', 'read_scratchpad',
  'create_tool', 'use_tool',
]);

/**
 * Common aliases that small models emit — map to canonical names before validation.
 */
const TOOL_ALIASES: Record<string, string> = {
  'navigate': 'browser_navigate', 'goto': 'browser_navigate', 'open_url': 'browser_navigate',
  'click': 'browser_click', 'type': 'browser_type', 'fill': 'browser_type',
  'screenshot': 'browser_screenshot', 'snapshot': 'browser_snapshot',
  'scroll': 'browser_scroll', 'search': 'web_search', 'google': 'web_search',
  'read': 'read_file', 'write': 'write_file', 'save': 'write_file', 'create': 'write_file',
  'edit': 'edit_file', 'delete': 'delete_file', 'run': 'run_command', 'exec': 'run_command',
  'command': 'run_command', 'ls': 'list_directory',
};

/** Check if a tool name is valid (known tool or known alias). */
function isValidToolName(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  return VALID_TOOL_NAMES.has(lower) || lower in TOOL_ALIASES;
}

/**
 * Strip tool execution result sections, orphan headers, and internal reasoning from text.
 */
export function stripToolArtifacts(text: string): string {
  let cleaned = text;
  // Remove <think>/<thinking> blocks that weren't caught earlier
  cleaned = cleaned.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/<\/?think(?:ing)?>/gi, '');
  // (model output filters removed — model text is shown verbatim)
  // Strip orphaned JSON fragments — e.g. `params": {"filePath":...}}` left when a tool
  // call's opening brace was consumed by the parser but the params field leaked as text.
  cleaned = cleaned.replace(/^\s*"?params"?\s*"?\s*:\s*\{[\s\S]*?\}\}?\s*$/gm, '');
  // Strip lines that are raw JSON key-value fragments starting with a quoted key
  cleaned = cleaned.replace(/^\s*"[a-zA-Z_]+":\s*(\{|\[)[^]*?\}\}?\s*$/gm, '');
  // Remove ## Tool Execution Results sections and everything in them
  cleaned = cleaned.replace(/\n*## Tool Execution Results[\s\S]*?(?=\n## [^T]|\n\*(?:Detected|Reached|Continuing)|$)/g, '');
  // Remove standalone ### toolname [OK|FAIL] headers and the content following them
  cleaned = cleaned.replace(/\n*### \S+ \[(?:OK|FAIL)\]\n?[\s\S]*?(?=\n## |\n### [^\s]+ \[(?:OK|FAIL)\]|\n\n(?=[A-Z])|$)/g, '');
  // Remove orphan ### Tool Execution Results
  cleaned = cleaned.replace(/\n*###? Tool Execution Results\n?/g, '');
  // Collapse excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

/**
 * Split plain text into segments: raw inline JSON tool calls and surrounding text.
 */
export function splitInlineToolCalls(text: string): ContentSegment[] {
  const results: ContentSegment[] = [];
  const jsonRegex = /\{\s*"(?:tool|name)"\s*:\s*"[^"]+"/g;
  let lastIndex = 0;
  let match;

  while ((match = jsonRegex.exec(text)) !== null) {
    const startIdx = match.index;
    let braceCount = 0;
    let endIdx = startIdx;
    for (let j = startIdx; j < text.length; j++) {
      if (text[j] === '{') braceCount++;
      if (text[j] === '}') braceCount--;
      if (braceCount === 0) { endIdx = j + 1; break; }
    }

    if (braceCount !== 0) {
      // Unbalanced braces — likely streaming/incomplete JSON
      const partialText = text.substring(startIdx);
      const dialogStart = partialText.search(/\n[A-Z][a-z]+.*[.?!]|\n\*\*?[A-Za-z]+|\nWhat |\nHow |\nWould |\nIs there |\nDo you |\nI can |\nLet me /);
      const toolNameMatch = match[0].match(/"(?:tool|name)"\s*:\s*"([^"]*)"/);
      const toolName = toolNameMatch ? toolNameMatch[1] : 'unknown';

      // Reject hallucinated tool names — render as plain text instead of tool card
      if (!isValidToolName(toolName)) {
        jsonRegex.lastIndex = startIdx + 1;
        continue;
      }

      if (startIdx > lastIndex) {
        const before = stripToolArtifacts(text.substring(lastIndex, startIdx)).replace(/\[\s*$/, '').trim();
        if (before) results.push({ type: 'text', content: before });
      }

      if (dialogStart > 0) {
        const jsonPart = partialText.substring(0, dialogStart);
        const dialogPart = partialText.substring(dialogStart).trim();
        results.push({ type: 'tool', content: jsonPart, toolCall: { tool: toolName, params: {} } });
        if (dialogPart) {
          const cleanedDialog = stripToolArtifacts(dialogPart);
          if (cleanedDialog.trim()) results.push({ type: 'text', content: cleanedDialog });
        }
      } else {
        results.push({ type: 'tool', content: partialText, toolCall: { tool: toolName, params: {} } });
      }
      lastIndex = text.length;
      break;
    }

    const jsonStr = text.substring(startIdx, endIdx);
    try {
      const parsed = JSON.parse(jsonStr);
      const toolName = parsed.tool || parsed.name;
      if (toolName && typeof toolName === 'string' && isValidToolName(toolName)) {
        if (startIdx > lastIndex) {
          const before = stripToolArtifacts(text.substring(lastIndex, startIdx)).replace(/\[\s*$/, '').trim();
          if (before) results.push({ type: 'text', content: before });
        }
        results.push({ type: 'tool', content: jsonStr, toolCall: { tool: toolName, params: parsed.params || parsed.arguments || {} } });
        lastIndex = endIdx;
        // Skip trailing array bracket ] and comma , after the JSON object
        const afterJson = text.substring(endIdx);
        const trailingMatch = afterJson.match(/^[\s,\]]+/);
        if (trailingMatch) lastIndex = endIdx + trailingMatch[0].length;
        jsonRegex.lastIndex = lastIndex;
      }
    } catch { /* not valid JSON, skip */ }
  }

  // Remaining text
  if (lastIndex < text.length) {
    const remaining = stripToolArtifacts(text.substring(lastIndex));
    const cleaned = remaining.replace(/^\s*[\],]\s*/, '').replace(/\[\s*$/, '').trim();
    if (cleaned) results.push({ type: 'text', content: cleaned });
  }

  return results.length > 0 ? results : [{ type: 'text', content: stripToolArtifacts(text) }];
}

/**
 * Strip any trailing partial tool-call JSON that is still being streamed character-by-character.
 * Handles the window between when the model starts emitting `{"tool":` and when the full key
 * is typed — before the splitInlineToolCalls regex can match, the partial JSON would render
 * as raw plain text. This suppresses it until it can be identified and routed to a tool card.
 */
export function stripTrailingPartialToolCall(text: string): string {
  let depth = 0;
  let lastTopLevelStart = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') {
      if (depth === 0) lastTopLevelStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) lastTopLevelStart = -1; // closed cleanly
    }
  }
  // depth > 0 means there is an unclosed top-level JSON object at the end
  if (depth > 0 && lastTopLevelStart !== -1) {
    const tail = text.substring(lastTopLevelStart);
    // Only suppress if it looks like a tool call: contains a partial "tool"/"name" key,
    // is just an opening brace with a string key starting, or is a bare `{` with only
    // whitespace/newlines (emitted 1-2 tokens before the first key arrives).
    if (/"(?:tool|name)/.test(tail) || /^\{\s*$/.test(tail) || /^\{\s*"/.test(tail)) {
      return text.substring(0, lastTopLevelStart).trimEnd();
    }
  }
  return text;
}

/**
 * Parse a JSON string into a tool call object.
 */
export function parseToolCall(code: string): { tool: string; params: Record<string, unknown> } | null {
  try {
    let parsed = JSON.parse(code.trim());
    // Some models wrap tool calls in an array: [{"tool":"...","params":{}}]
    if (Array.isArray(parsed) && parsed.length > 0) parsed = parsed[0];
    const toolName = parsed.tool || parsed.name;
    if (toolName && typeof toolName === 'string' && isValidToolName(toolName)) {
      return { tool: toolName, params: parsed.params || parsed.arguments || {} };
    }
  } catch { /* not valid JSON */ }
  return null;
}

/**
 * Extract per-tool results from content for merging with tool calls.
 */
export function extractToolResults(content: string): Map<string, ToolResult[]> {
  const results = new Map<string, ToolResult[]>();

  // Method 1: Match ## Tool Execution Results sections
  const sections = content.split(/\n*## Tool Execution Results\n*/);
  for (let s = 1; s < sections.length; s++) {
    const section = sections[s];
    const toolBlocks = section.split(/\n(?=### \S+ \[(?:OK|FAIL)\])/);
    for (const block of toolBlocks) {
      const headerMatch = block.match(/^### (\S+) \[(OK|FAIL)\]\n?([\s\S]*)/);
      if (!headerMatch) continue;
      const [, toolName, status, details] = headerMatch;
      if (!results.has(toolName)) results.set(toolName, []);
      results.get(toolName)!.push({ isOk: status === 'OK', text: details.trim() });
    }
  }

  // Method 2: Standalone ### toolname [OK|FAIL] headers
  if (results.size === 0) {
    const standaloneRegex = /### (\S+) \[(OK|FAIL)\]\n([\s\S]*?)(?=\n### \S+ \[(?:OK|FAIL)\]|$)/g;
    let m;
    while ((m = standaloneRegex.exec(content)) !== null) {
      const [, toolName, status, details] = m;
      if (!results.has(toolName)) results.set(toolName, []);
      results.get(toolName)!.push({ isOk: status === 'OK', text: details.trim() });
    }
  }

  return results;
}
