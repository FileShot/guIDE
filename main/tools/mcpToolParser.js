/**
 * MCP Tool Parser — parseToolCalls, processResponse, fallback detection.
 * Extracted from mcpToolServer.js (ARCH-03).
 * These methods are mixed into MCPToolServer.prototype so `this` works.
 */

/**
 * Common tool name aliases/mistakes from small models
 */
const TOOL_NAME_ALIASES = {
  // ── Browser tools ──
  'navigate': 'browser_navigate', 'goto': 'browser_navigate', 'open_url': 'browser_navigate', 'go_to': 'browser_navigate',
  'click': 'browser_click', 'press': 'browser_click',
  'type': 'browser_type', 'input': 'browser_type', 'fill': 'browser_type', 'enter_text': 'browser_type',
  'screenshot': 'browser_screenshot', 'take_screenshot': 'browser_screenshot', 'capture': 'browser_screenshot',
  'snapshot': 'browser_snapshot', 'page_snapshot': 'browser_snapshot', 'get_snapshot': 'browser_snapshot', 'accessibility': 'browser_snapshot',
  'scroll': 'browser_scroll', 'scroll_page': 'browser_scroll',
  'get_content': 'browser_get_content', 'read_page': 'browser_get_content', 'get_text': 'browser_get_content',
  'list_elements': 'browser_list_elements', 'get_elements': 'browser_list_elements', 'find_elements': 'browser_list_elements',
  'evaluate': 'browser_evaluate', 'eval': 'browser_evaluate', 'run_js': 'browser_evaluate',
  'back': 'browser_back', 'go_back': 'browser_back',
  'select': 'browser_select', 'choose': 'browser_select',
  'hover': 'browser_hover', 'mouse_over': 'browser_hover',
  'press_key': 'browser_press_key', 'press_enter': 'browser_press_key', 'submit': 'browser_press_key',
  'get_url': 'browser_get_url', 'current_url': 'browser_get_url',
  'get_links': 'browser_get_links',
  'wait_for_element': 'browser_wait_for_element', 'wait': 'browser_wait_for_element',
  // ── Web search ──
  'search': 'web_search', 'google': 'web_search', 'search_web': 'web_search', 'websearch': 'web_search',
  'web_browse': 'web_search', 'internet_search': 'web_search', 'lookup': 'web_search',
  // ── File tools: ALL common reversals, typos, and alternative names ──
  'read': 'read_file', 'open_file': 'read_file', 'view_file': 'read_file',
  'file_read': 'read_file', 'readfile': 'read_file', 'read_from_file': 'read_file', 'get_file': 'read_file',
  'file_get': 'read_file', 'load_file': 'read_file', 'file_load': 'read_file', 'cat_file': 'read_file',
  'write': 'write_file', 'save_file': 'write_file', 'create': 'write_file',
  'file_write': 'write_file', 'writefile': 'write_file', 'create_file': 'write_file', 'file_create': 'write_file',
  'save': 'write_file', 'save_to_file': 'write_file', 'file_save': 'write_file', 'make_file': 'write_file',
  'edit': 'edit_file', 'modify': 'edit_file', 'replace': 'edit_file',
  'file_edit': 'edit_file', 'editfile': 'edit_file', 'modify_file': 'edit_file', 'file_modify': 'edit_file',
  'update_file': 'edit_file', 'file_update': 'edit_file', 'patch_file': 'edit_file',
  'delete': 'delete_file', 'remove': 'delete_file',
  'file_delete': 'delete_file', 'deletefile': 'delete_file', 'remove_file': 'delete_file', 'file_remove': 'delete_file',
  'rename': 'rename_file', 'file_rename': 'rename_file', 'move_file': 'rename_file',
  // ── Directory tools ──
  'list_dir': 'list_directory', 'ls': 'list_directory', 'dir': 'list_directory',
  'listdir': 'list_directory', 'list_files': 'list_directory', 'list_folder': 'list_directory',
  'mkdir': 'create_directory', 'make_directory': 'create_directory', 'make_dir': 'create_directory',
  // ── Command execution ──
  'run': 'run_command', 'exec': 'run_command', 'execute': 'run_command', 'shell': 'run_command', 'terminal': 'run_command',
  'execute_command': 'run_command', 'command': 'run_command', 'cmd': 'run_command', 'shell_exec': 'run_command',
  // ── Codebase search ──
  'code_search': 'search_codebase', 'search_code': 'search_codebase', 'find_code': 'search_codebase',
  'grep': 'grep_search', 'ripgrep': 'grep_search',
};

/**
 * VALID_TOOLS whitelist — rejects garbage tool names from small models
 * that hallucinate names like "walmart", "amazon", "calculator" etc.
 */
const VALID_TOOLS = new Set([
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
 * Sanitize malformed JSON from LLM output.
 * Context-aware: tracks whether we're inside a JSON string value to correctly
 * handle escape sequences and raw control characters.
 * Ported from Pocket Edition's battle-tested implementation.
 */
function sanitizeJson(raw) {
  // Step 1: Fix invalid escape sequences (backslash followed by non-JSON-escape char)
  // Valid JSON escapes: " \ / b f n r t u (for \uXXXX)
  const fixEscapes = (str) => {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\\' && i + 1 < str.length) {
        const next = str[i + 1];
        if ('"\\/bfnrtu'.includes(next)) {
          result += str[i] + next; // Valid escape — keep both chars
          i++; // Skip next char (already consumed)
        } else {
          result += '\\\\'; // Invalid escape like \* \[ — double the backslash
        }
      } else {
        result += str[i];
      }
    }
    return result;
  };

  const escaped = fixEscapes(raw);

  // Step 2: Replace raw control chars ONLY inside JSON string values (context-aware)
  let out = '';
  let inStr = false;
  for (let i = 0; i < escaped.length; i++) {
    const ch = escaped[i];
    const code = escaped.charCodeAt(i);
    if (ch === '"' && (i === 0 || escaped[i - 1] !== '\\')) {
      inStr = !inStr;
      out += ch;
    } else if (inStr && code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Fix unquoted/single-quoted keys that small models produce.
 * {tool: "x"} or {'tool': 'x'} → {"tool": "x"}
 * Ported from Pocket Edition.
 */
function fixQuoting(raw) {
  // Replace single-quoted strings with double-quoted
  let s = raw.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // Quote unquoted keys: { tool: → { "tool":
  s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
  return s;
}

/**
 * Fix backtick-delimited strings in JSON output.
 * Some models output JSON with template-literal syntax: {"content": `code here`}
 * Converts backtick strings to properly escaped double-quoted strings.
 * General infrastructure fix — benefits any model using backtick syntax.
 */
function fixBackticks(raw) {
  return raw.replace(/`([^`]*)`/g, (_, inner) => {
    const escaped = inner
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return '"' + escaped + '"';
  });
}

/**
 * Parse tool calls from LLM response text.
 * Supports multiple formats: ```tool, ```json, or raw JSON blocks.
 * Also accepts "name" as alias for "tool" key.
 */
function parseToolCalls(text) {
  const toolCalls = [];

  console.log('[MCP] Parsing response for tool calls, length:', text?.length);

  // Cap input length to prevent O(n²) worst-case in brace matching (200KB)
  const rawText = (text && text.length > 200000) ? text.substring(0, 200000) : (text || '');

  const cleanedText = rawText
    .replace(/\n?Copy\n?Apply\n?/gi, '\n')
    .replace(/\n?Copy\n?/gi, '\n')
    .replace(/\n?Apply\n?/gi, '\n');

  const normalizeToolCall = (parsed) => {
    let toolName = parsed.tool || parsed.name || parsed.function || parsed.action;
    if (!toolName) return null;
    const lower = toolName.toLowerCase().trim();
    if (TOOL_NAME_ALIASES[lower]) {
      console.log(`[MCP] Corrected tool name: "${toolName}" → "${TOOL_NAME_ALIASES[lower]}"`);
      toolName = TOOL_NAME_ALIASES[lower];
    }
    // Validate: only accept known tool names (reject garbage like "walmart", "amazon")
    if (!VALID_TOOLS.has(toolName.toLowerCase().trim()) && !TOOL_NAME_ALIASES[toolName.toLowerCase().trim()]) {
      // Recovery: CLI binary used as tool name + command/args param → run_command
      // Example: {"tool": "node", "params": {"command": "-v"}} → run_command({command: "node -v"})
      // General infrastructure fix: models of all sizes sometimes format commands this way.
      const lowerName = toolName.toLowerCase().trim();
      const rawParams = parsed.params || parsed.arguments || parsed.parameters || parsed.input || {};
      const cmdArg = typeof rawParams === 'object' ? (rawParams.command || rawParams.args || rawParams.arguments || rawParams.flags || '') : '';
      if (lowerName.length > 0 && lowerName.length < 20 && /^[a-z][a-z0-9._+-]*$/.test(lowerName) && typeof cmdArg === 'string' && cmdArg.trim()) {
        console.log(`[MCP] Recovered CLI binary as run_command: "${lowerName} ${cmdArg.trim()}"`);
        return { tool: 'run_command', params: { command: `${lowerName} ${cmdArg.trim()}` } };
      }
      console.warn(`[MCP] Rejected unknown tool name: "${toolName}"`);
      return null;
    }
    let params = parsed.params || parsed.arguments || parsed.parameters || parsed.input || {};

    // Top-level params recovery: small models often put params at root level
    // e.g. {"tool":"write_file","filePath":"...","content":"..."} instead of nesting in params
    if (typeof params !== 'object' || Object.keys(params).length === 0) {
      if (typeof parsed.filePath === 'string' || typeof parsed.content === 'string' ||
          typeof parsed.file_path === 'string' || typeof parsed.filename === 'string') {
        params = {
          filePath: parsed.filePath || parsed.file_path || parsed.path || parsed.filename || parsed.file_name || parsed.file,
          content: parsed.content || parsed.text || parsed.code || parsed.body,
        };
      } else if (typeof parsed.url === 'string') {
        params = { url: parsed.url };
      } else if (typeof parsed.href === 'string') {
        params = { url: parsed.href };
      } else if (typeof parsed.command === 'string') {
        params = { command: parsed.command };
      } else if (typeof parsed.query === 'string') {
        params = { query: parsed.query };
      } else if (typeof parsed.ref === 'number' || typeof parsed.ref === 'string') {
        params = { ref: parsed.ref };
        if (typeof parsed.text === 'string') params.text = parsed.text;
      }
    }

    // Param name normalization within params object (snake_case → camelCase, aliases)
    if (params && typeof params === 'object') {
      // file_path → filePath
      if (params.filePath == null && typeof params.file_path === 'string') {
        params.filePath = params.file_path; delete params.file_path;
      }
      if (params.filePath == null && typeof params.filename === 'string') {
        params.filePath = params.filename; delete params.filename;
      }
      if (params.filePath == null && typeof params.file_name === 'string') {
        params.filePath = params.file_name; delete params.file_name;
      }
      if (params.filePath == null && typeof params.file === 'string') {
        params.filePath = params.file; delete params.file;
      }
      // For file tools: path → filePath (but NOT for browser tools where path means something else)
      if (params.filePath == null && typeof params.path === 'string' &&
          (toolName === 'write_file' || toolName === 'read_file' || toolName === 'edit_file' ||
           toolName === 'delete_file' || toolName === 'rename_file' || toolName === 'get_file_info')) {
        params.filePath = params.path; delete params.path;
      }
      // browser_navigate: ref/href/link/src → url
      if (toolName === 'browser_navigate') {
        if (params.url == null && typeof params.ref === 'string' && params.ref.includes('.')) {
          params.url = params.ref; delete params.ref;
        }
        if (params.url == null && typeof params.href === 'string') {
          params.url = params.href; delete params.href;
        }
        if (params.url == null && typeof params.link === 'string') {
          params.url = params.link; delete params.link;
        }
        if (params.url == null && typeof params.src === 'string') {
          params.url = params.src; delete params.src;
        }
      }
    }

    return { tool: toolName, params };
  };

  // Method 0: <tool_call>...</tool_call> XML tag format
  // Some models emit this format in text-mode fallback (e.g. Qwen3 native chat wrapper).
  // Must run first — before fenced-block search — because the XML tags are unambiguous boundaries
  // and avoid the brace-counter string-state issues that Method 2 has with HTML content.
  const xmlToolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let xmlMatch;
  while ((xmlMatch = xmlToolCallRegex.exec(cleanedText)) !== null) {
    const innerContent = xmlMatch[1].trim();
    try {
      let parsed;
      try { parsed = JSON.parse(sanitizeJson(innerContent)); } catch {
        try { parsed = JSON.parse(sanitizeJson(fixQuoting(innerContent))); } catch {
          parsed = JSON.parse(sanitizeJson(fixBackticks(fixQuoting(innerContent))));
        }
      }
      const normalized = normalizeToolCall(parsed);
      if (normalized) {
        console.log('[MCP] Found tool call in <tool_call> XML:', normalized.tool);
        toolCalls.push(normalized);
      }
    } catch (e) {
      console.log('[MCP] Failed to parse <tool_call> XML content:', e.message);
    }
  }

  // Match ```tool, ```json, or ```tool_call blocks
  const regex = /```(?:tool_call|tool|json)[^\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(cleanedText)) !== null) {
    try {
      const blockContent = match[1].trim();

      // Use brace-counting to extract each complete JSON object (handles multiple in one block)
      let pos = 0;
      while (pos < blockContent.length) {
        const start = blockContent.indexOf('{', pos);
        if (start === -1) break;
        let depth = 0;
        let inStr = false;
        let end = -1;
        for (let i = start; i < blockContent.length; i++) {
          const c = blockContent[i];
          if (c === '"' && (i === 0 || blockContent[i - 1] !== '\\')) inStr = !inStr;
          if (!inStr) {
            if (c === '{') depth++;
            if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
        }
        if (end === -1) break;
        try {
          const rawStr = blockContent.substring(start, end + 1);
          const jsonStr = sanitizeJson(rawStr);
          let parsed;
          try { parsed = JSON.parse(jsonStr); } catch {
            try {
              // Retry with fixQuoting for single-quoted/unquoted keys
              parsed = JSON.parse(sanitizeJson(fixQuoting(rawStr)));
            } catch {
              // Retry with backtick-delimited strings: {"content": `code`} → {"content": "code"}
              parsed = JSON.parse(sanitizeJson(fixBackticks(fixQuoting(rawStr))));
            }
          }
          const normalized = normalizeToolCall(parsed);
          if (normalized) {
            console.log('[MCP] Found tool call in code block:', normalized.tool);
            toolCalls.push(normalized);
          }
        } catch (e) {
          const rawBlock = blockContent.substring(start, end + 1);
          if (rawBlock.includes('tool') || rawBlock.includes('name')) {
            console.log('[MCP] Failed to parse code block JSON:', e.message);
          }
        }
        pos = end + 1;
      }

      // Fallback: if no JSON objects found in block, try non-JSON tool_call format
      if (toolCalls.length === 0) {
        const lines = blockContent.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 1) {
          const possibleToolName = lines[0].replace(/[^a-zA-Z0-9_]/g, '');
          const possibleParams = lines.length >= 2 ? lines.slice(1).join('\n') : '{}';
          try {
            const params = JSON.parse(possibleParams);
            const normalized = normalizeToolCall({ tool: possibleToolName, params });
            if (normalized) {
              console.log('[MCP] Found tool_call format:', normalized.tool);
              toolCalls.push(normalized);
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      console.log('[MCP] Failed to process code block:', e.message);
    }
  }

  // Also try to find raw JSON objects with "tool" or "name" key outside code blocks
  // Handles quoted, single-quoted, and unquoted key formats
  // Skip this expensive O(n) pass if we already found tool calls in fenced blocks
  if (toolCalls.length === 0) {
    const existingToolSigs = new Set(toolCalls.map(tc => `${tc.tool}:${JSON.stringify(tc.params)}`));
    // Match both quoted and unquoted/single-quoted key formats
    const jsonRegex = /\{\s*["']?(?:tool|name)["']?\s*:\s*["'][^"']+["']/g;
    while ((match = jsonRegex.exec(cleanedText)) !== null) {
      const startIdx = match.index;
      // String-aware brace-counting to extract complete JSON
      let depth = 0;
      let inStr = false;
      let endIdx = startIdx;
      for (let i = startIdx; i < cleanedText.length; i++) {
        const c = cleanedText[i];
        if (c === '"' && (i === 0 || cleanedText[i - 1] !== '\\')) inStr = !inStr;
        if (!inStr) {
          if (c === '{') depth++;
          if (c === '}') depth--;
        }
        if (depth === 0 && !inStr) {
          endIdx = i + 1;
          break;
        }
      }
      try {
        const jsonStr = cleanedText.substring(startIdx, endIdx);
        const sanitized = sanitizeJson(jsonStr);
        let parsed;
        try { parsed = JSON.parse(sanitized); } catch {
          try {
            parsed = JSON.parse(sanitizeJson(fixQuoting(jsonStr)));
          } catch {
            // Retry with backtick-delimited strings
            parsed = JSON.parse(sanitizeJson(fixBackticks(fixQuoting(jsonStr))));
          }
        }
        const normalized = normalizeToolCall(parsed);
        if (normalized) {
          const sig = `${normalized.tool}:${JSON.stringify(normalized.params)}`;
          if (!existingToolSigs.has(sig)) {
            console.log('[MCP] Found raw tool call:', normalized.tool);
            toolCalls.push(normalized);
            existingToolSigs.add(sig);
          }
        }
      } catch (e) {
        // Not valid JSON, skip
      }
    }
  }

  // Method 3: Recovery from alternative formats (function-call syntax, plain JSON)
  // Only run if Methods 1 and 2 found nothing — common with small/local models
  if (toolCalls.length === 0) {
    // 3a: Function-call syntax: tool_name({"param": "value"})
    const KNOWN_TOOLS = Object.keys(TOOL_NAME_ALIASES).concat([
      'write_file', 'read_file', 'edit_file', 'delete_file', 'rename_file', 'create_directory',
      'list_directory', 'find_files', 'search_codebase', 'grep_search', 'get_project_structure',
      'run_command', 'web_search', 'fetch_webpage', 'browser_navigate', 'browser_snapshot',
      'browser_click', 'browser_type', 'browser_screenshot', 'browser_evaluate', 'browser_scroll',
      'browser_back', 'browser_select', 'browser_hover', 'browser_press_key', 'browser_get_url',
      'browser_get_content', 'browser_get_links', 'browser_wait_for_element', 'browser_fill_form',
      'browser_handle_dialog', 'browser_tabs', 'browser_close', 'browser_drag',
      'browser_console_messages', 'browser_file_upload', 'browser_resize',
      'save_memory', 'get_memory', 'list_memories', 'install_packages',
      'get_file_info', 'analyze_error', 'git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch',
      'replace_in_files', 'undo_edit', 'delegate_task',
    ]);
    const funcCallRegex = new RegExp(`\\b(${KNOWN_TOOLS.join('|')})\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, 'g');
    let funcMatch;
    while ((funcMatch = funcCallRegex.exec(cleanedText)) !== null) {
      try {
        let parsed;
        try { parsed = JSON.parse(funcMatch[2]); } catch {
          try { parsed = JSON.parse(sanitizeJson(funcMatch[2])); } catch {
            parsed = JSON.parse(sanitizeJson(fixQuoting(funcMatch[2])));
          }
        }
        const toolName = TOOL_NAME_ALIASES[funcMatch[1].toLowerCase()] || funcMatch[1];
        console.log('[MCP] Method 3a: Found function-call syntax:', toolName);
        toolCalls.push({ tool: toolName, params: parsed });
      } catch (_) {}
    }

    // 3b: Plain JSON with filePath+content but no "tool" key → infer write_file
    if (toolCalls.length === 0) {
      const plainJsonRegex = /\{\s*"filePath"\s*:\s*"[^"]+"\s*,\s*"content"\s*:/g;
      let plainMatch;
      while ((plainMatch = plainJsonRegex.exec(cleanedText)) !== null) {
        const start = plainMatch.index;
        let braces = 0, end = start;
        for (let i = start; i < cleanedText.length; i++) {
          if (cleanedText[i] === '{') braces++;
          if (cleanedText[i] === '}') braces--;
          if (braces === 0) { end = i + 1; break; }
        }
        try {
          const jsonStr = cleanedText.substring(start, end);
          let parsed;
          try { parsed = JSON.parse(jsonStr); } catch (_) { parsed = JSON.parse(sanitizeJson(jsonStr)); }
          if (parsed.filePath && parsed.content) {
            console.log('[MCP] Method 3b: Inferred write_file from plain JSON');
            toolCalls.push({ tool: 'write_file', params: parsed });
          }
        } catch (_) {}
      }
    }
  }

  // ── Fix: web_search → run_command remap ──
  // Small models sometimes call web_search("npm -v") when they mean run_command("npm -v").
  // Detect when a web_search query looks like a shell command and remap it.
  const SHELL_CMD_RE = /^\s*(npm|node|npx|git|python|python3|pip|pip3|cargo|make|cmake|docker|yarn|pnpm|deno|bun|which|where|env|echo|cat|ls|dir|pwd|cd|mv|cp|rm|mkdir|rmdir|chmod|chown|curl|wget|ssh|scp|tar|zip|unzip|grep|find|awk|sed|tsc|eslint|prettier|jest|vitest|mocha)\b/i;
  const URL_RE = /^https?:\/\/[^\s]+$/i;
  for (const call of toolCalls) {
    if (call.tool === 'web_search') {
      const q = (call.params?.query || call.params?.q || call.params?.search || '').trim();
      if (SHELL_CMD_RE.test(q) && q.length < 60) {
        console.log(`[MCP] Remap: web_search("${q}") → run_command (looks like a shell command)`);
        call.tool = 'run_command';
        call.params = { command: q };
      } else if (URL_RE.test(q)) {
        // web_search with a full URL → browser_navigate
        console.log(`[MCP] Remap: web_search("${q}") → browser_navigate (is a URL)`);
        call.tool = 'browser_navigate';
        call.params = { url: q };
      }
    }
  }

  // ── Fix: search_codebase → web_search remap ──
  // Small models sometimes call search_codebase for external/internet topics.
  // Detect when the query references external tech/features (not local code patterns).
  const EXTERNAL_QUERY_RE = /\b(latest|newest|release|what is|how to|tutorial|guide|documentation|docs|getting started|features of|version \d|upgrade|migration|announce|blog|official)\b/i;
  for (const call of toolCalls) {
    if (call.tool === 'search_codebase' || call.tool === 'search_in_files') {
      const q = (call.params?.query || call.params?.q || call.params?.search || call.params?.pattern || '').trim();
      if (EXTERNAL_QUERY_RE.test(q) && q.length > 5) {
        console.log(`[MCP] Remap: ${call.tool}("${q}") → web_search (looks like an external query)`);
        call.tool = 'web_search';
        call.params = { query: q };
      }
    }
  }

  console.log('[MCP] Total tool calls found (pre-repair):', toolCalls.length);
  return toolCalls;
}

/**
 * Repair malformed tool calls before execution.
 * Fixes common issues:
 * 1. write_file with empty/missing content — recovers from code blocks in response text
 * 2. write_file with empty/missing filePath — infers from response text or defaults
 * 3. Drops completely unrecoverable calls instead of letting them fail and pollute context
 *
 * This runs AFTER parseToolCalls but BEFORE execution, catching problems that
 * would otherwise cause tool errors that confuse the model for the rest of the session.
 *
 * @param {Array} toolCalls - Parsed tool calls from parseToolCalls
 * @param {string} responseText - Full model response text (for content recovery)
 * @returns {{ repaired: Array, issues: string[] }}
 */
function repairToolCalls(toolCalls, responseText) {
  const repaired = [];
  const issues = [];

  for (const call of toolCalls) {
    if (!call || typeof call.tool !== 'string') continue;
    const tool = call.tool.trim();
    const params = call.params && typeof call.params === 'object' ? { ...call.params } : {};

    if (tool === 'write_file') {
      const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
      const content = typeof params.content === 'string' ? params.content : '';

      if (!content || content.length < 5) {
        // Content is empty/trivial — try to recover from code blocks in response
        const recovered = _recoverWriteFileContent(responseText, filePath);
        if (recovered) {
          console.log(`[MCP Repair] Recovered write_file content (${recovered.params.content.length} chars) for "${recovered.params.filePath}"`);
          repaired.push(recovered);
          continue;
        }
        // Unrecoverable — drop it instead of executing an empty write_file
        issues.push(`Dropped write_file: empty content for "${filePath || '(no path)'}" and no recoverable code found in response.`);
        continue;
      }

      if (!filePath) {
        // Content exists but no path — try to infer
        const inferredPath = _inferFilePath(responseText, content);
        if (inferredPath) {
          params.filePath = inferredPath;
          console.log(`[MCP Repair] Inferred filePath: "${inferredPath}" for write_file`);
        }
        // If still no path, let it through — executeTool will give a clear error
      }

      repaired.push({ tool, params });
      continue;
    }

    if (tool === 'edit_file') {
      const oldText = typeof params.oldText === 'string' ? params.oldText : '';
      const newText = typeof params.newText === 'string' ? params.newText : '';
      if (!oldText && !newText && !params.lineRange) {
        issues.push(`Dropped edit_file: empty oldText/newText and no lineRange.`);
        continue;
      }
    }

    if (tool === 'browser_navigate') {
      const url = typeof params.url === 'string' ? params.url.trim() : '';
      if (!url) {
        issues.push(`Dropped browser_navigate: empty URL.`);
        continue;
      }
      // Fix common URL issues
      if (url && !url.startsWith('http') && !url.startsWith('file:') && url.includes('.')) {
        params.url = 'https://' + url;
        console.log(`[MCP Repair] Added https:// to URL: "${params.url}"`);
      }
      repaired.push({ tool, params });
      continue;
    }

    // All other tools pass through
    repaired.push({ tool, params });
  }

  // If ALL formal tool calls were dropped/empty, attempt full write_file recovery
  // from code blocks in the response text
  if (repaired.length === 0 && toolCalls.length > 0) {
    const recovered = _recoverWriteFileContent(responseText);
    if (recovered) {
      console.log(`[MCP Repair] All formal calls failed — recovered write_file from response text (${recovered.params.content.length} chars)`);
      repaired.push(recovered);
    }
  }

  if (issues.length > 0) {
    console.log(`[MCP Repair] ${issues.length} issue(s): ${issues.join(' | ')}`);
  }

  return { repaired, issues };
}

/**
 * Recover write_file content from code blocks or raw HTML/code in response text.
 * Handles: fenced code blocks (```html, ```js, etc.), raw HTML dumps, raw code dumps.
 *
 * @param {string} text - Full model response text
 * @param {string} [preferredFilePath] - Preferred file path if known
 * @returns {{ tool: string, params: { filePath: string, content: string } } | null}
 */
function _recoverWriteFileContent(text, preferredFilePath) {
  if (!text || typeof text !== 'string') return null;

  // Search for the largest substantive code block
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  let bestContent = null;
  let bestLang = '';
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const content = (match[2] || '').trim();
    if (!content || content.length < 30) continue;

    // Skip JSON tool call blocks
    if (lang === 'json' && /^\s*\{\s*["']?(?:tool|name)["']?\s*:/.test(content)) continue;

    if (!bestContent || content.length > bestContent.length) {
      bestContent = content;
      bestLang = lang;
    }
  }

  // Also try raw HTML without fences
  if (!bestContent) {
    const htmlStart = text.search(/<!doctype\s+html|<html[\s>]/i);
    if (htmlStart !== -1) {
      const htmlEnd = text.search(/<\/html\s*>/i);
      if (htmlEnd !== -1 && htmlEnd > htmlStart) {
        bestContent = text.substring(htmlStart, htmlEnd + 7).trim();
        bestLang = 'html';
      }
    }
  }

  if (!bestContent || bestContent.length < 30) return null;

  const filePath = preferredFilePath?.trim() || _inferFilePath(text, bestContent, bestLang);

  return {
    tool: 'write_file',
    params: { filePath, content: bestContent }
  };
}

/**
 * Infer a file path from response text context and content type.
 * @param {string} text - Response text to search for path hints
 * @param {string} content - The file content (for type detection)
 * @param {string} [lang] - Language hint from code block
 * @returns {string} Inferred file path
 */
function _inferFilePath(text, content, lang) {
  // Look for explicit file path mentions in the text
  const pathPatterns = [
    /(?:create|write|save|make|generate).*?(?:file|document).*?(?:named?|called?|at)?\s*[`"']([^`"'\n]+\.\w+)[`"']/i,
    /(?:filename|file\s*name|filepath|file\s*path|path)[:\s]*[`"']?([^\s`"'\n]+\.\w+)[`"']?/i,
  ];
  for (const pattern of pathPatterns) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1];
  }

  // Infer from content type
  const langToFile = {
    html: 'index.html', htm: 'index.html',
    css: 'styles.css', javascript: 'script.js', js: 'script.js',
    typescript: 'index.ts', ts: 'index.ts', tsx: 'index.tsx', jsx: 'App.jsx',
    python: 'main.py', py: 'main.py', json: 'data.json',
    markdown: 'output.md', md: 'output.md',
  };

  if (lang && langToFile[lang]) return langToFile[lang];

  // Detect from content
  if (/<!doctype\s+html|<html[\s>]/i.test(content)) return 'index.html';
  if (/^import\s|^from\s.*import|^def\s|^class\s.*:/m.test(content)) return 'main.py';
  if (/^(?:const|let|var|function|import|export)\s/m.test(content)) return 'script.js';
  if (/^[.#@][a-zA-Z][\w-]*\s*\{/m.test(content)) return 'styles.css';

  return 'output.txt';
}

/**
 * Process an LLM response: extract tool calls, execute them, return results.
 * Also handles fallback detection for models that don't use formal tool syntax.
 */
async function processResponse(responseText, options = {}) {
  console.log('[MCP] processResponse called, text preview:', responseText?.substring(0, 200));

  const toolPaceMs = options.toolPaceMs || 0;
  const maxToolsPerResponse = Number.isFinite(options.maxToolsPerResponse) ? options.maxToolsPerResponse : 0;

  let toolCalls = this.parseToolCalls(responseText);

  // Normalize common tool-name aliases
  for (const call of toolCalls) {
    if (!call || typeof call.tool !== 'string') continue;
    if (call.tool === 'list_files') call.tool = 'list_directory';
  }

  // ── Path cleanup: strip template/placeholder prefixes ──
  // Small models often hallucinate paths like "$project_dir/package.json",
  // "/project/project-name/src", "/home/user/project/...", etc.
  // Strip these to relative paths so file operations work.
  // NOTE: Windows absolute paths (C:\Users\...) are intentionally NOT stripped here.
  // _listDirectory and other tools call path.isAbsolute() and handle them correctly.
  // Stripping Windows paths breaks valid user paths like C:\Users\brend\my-python-app.
  const TEMPLATE_PATH_RE = /^(?:\$\w+\/|\/project\/[^/]*\/|\/home\/[^/]*\/[^/]*\/|\/workspace\/|~\/[^/]*\/)/;
  for (const call of toolCalls) {
    if (!call?.params) continue;
    for (const key of ['filePath', 'path', 'file_path', 'dirPath', 'directory']) {
      const v = call.params[key];
      if (typeof v === 'string' && TEMPLATE_PATH_RE.test(v)) {
        const cleaned = v.replace(TEMPLATE_PATH_RE, '');
        if (cleaned && cleaned !== v) {
          console.log(`[MCP] Path cleanup: "${v}" → "${cleaned}"`);
          call.params[key] = cleaned;
        }
      }
    }
  }

  // ── Param inference: fix obviously wrong file/dir paths ──
  // When a model passes "." or "" as filePath for read/write/edit/list but the
  // user message clearly references a specific file or directory, infer the
  // correct path.  Helps ALL models — "." for read_file always errors (it's a
  // directory), so fixing it short-circuits an error-retry cycle.
  if (options.userMessage) {
    for (const call of toolCalls) {
      if (!call || typeof call.tool !== 'string') continue;
      const fp = call.params?.filePath ?? call.params?.path ?? call.params?.file_path ?? '';
      const isFileOp = ['read_file', 'write_file', 'edit_file'].includes(call.tool);
      const isListOp = call.tool === 'list_directory';
      const pathIsBad = fp === '.' || fp === './' || fp === '' || fp === '..';

      if (pathIsBad && (isFileOp || isListOp)) {
        const msg = options.userMessage;
        if (isFileOp) {
          // Extract likely filenames from user message
          const fileMatch = msg.match(/\b([\w.-]+\.(?:json|js|ts|tsx|jsx|md|html|css|yml|yaml|toml|py|sh|bat|txt|xml|env|cfg|conf|ini|log|csv))\b/i);
          if (fileMatch) {
            const inferred = fileMatch[1];
            console.log(`[MCP] Param inference: "${call.tool}" filePath "${fp}" → "${inferred}" (from user message)`);
            call.params = { ...call.params, filePath: inferred };
            if (call.params.path) delete call.params.path;
            if (call.params.file_path) delete call.params.file_path;
          }
        } else if (isListOp) {
          // Extract likely directory names
          const dirMatch = msg.match(/\b(src|main|scripts|tests|components|services|utils|config|public|build|dist|output|lib|assets)\b/i);
          if (dirMatch) {
            const inferred = dirMatch[1].toLowerCase();
            const dp = call.params?.dirPath ?? call.params?.path ?? call.params?.directory ?? '.';
            if (dp === '.' || dp === '' || dp === './') {
              console.log(`[MCP] Param inference: "list_directory" path "${dp}" → "${inferred}" (from user message)`);
              call.params = { ...call.params };
              // Set the appropriate path key
              if (call.params.dirPath != null) call.params.dirPath = inferred;
              else if (call.params.directory != null) call.params.directory = inferred;
              else if (call.params.path != null) call.params.path = inferred;
              else call.params.dirPath = inferred;
            }
          }
        }
      }
    }
  }

  // Optional enforcement: rewrite browser_navigate URL if caller demands it
  if (options && typeof options.enforceNavigateUrl === 'string' && options.enforceNavigateUrl.trim()) {
    const expectedUrl = options.enforceNavigateUrl.trim();
    const firstNav = toolCalls.find(tc => tc && tc.tool === 'browser_navigate');
    if (firstNav) {
      const gotUrl = firstNav.params?.url;
      if (typeof gotUrl === 'string' && gotUrl.trim() && gotUrl.trim() !== expectedUrl) {
        console.log(`[MCP] Enforcing browser_navigate url: "${gotUrl.trim()}" -> "${expectedUrl}"`);
        firstNav.params = { ...(firstNav.params || {}), url: expectedUrl };
      }
      // Only execute navigation in this turn
      toolCalls = [firstNav];
    }
  }

  // ── Tool Call Repair ──
  // Fix malformed calls BEFORE execution — recover empty write_file params,
  // drop unrecoverable calls, fix URLs, etc. This prevents tool errors from
  // polluting context and confusing the model for the rest of the session.
  if (toolCalls.length > 0) {
    const { repaired, issues } = repairToolCalls(toolCalls, responseText);
    if (issues.length > 0) {
      console.log(`[MCP] Repair dropped/fixed ${issues.length} call(s)`);
    }
    toolCalls = repaired;
  }

  // De-duplicate tool calls within a single response
  {
    const seen = new Set();
    const deduped = [];
    for (const call of toolCalls) {
      const tool = call?.tool;
      if (!tool || typeof tool !== 'string') continue;
      let sig;
      try {
        sig = `${tool}:${JSON.stringify(call.params || {})}`;
      } catch {
        sig = `${tool}:<unstringifiable>`;
      }
      if (seen.has(sig)) continue;
      seen.add(sig);
      deduped.push(call);
    }
    toolCalls = deduped;
  }

  // Optional enforcement: cap tool burst per model response.
  // Prevents runaway execution when a fast model emits dozens of tool calls.
  let capped = false;
  let skippedCount = 0;
  if (maxToolsPerResponse > 0 && toolCalls.length > maxToolsPerResponse) {
    skippedCount = toolCalls.length - maxToolsPerResponse;
    toolCalls = toolCalls.slice(0, maxToolsPerResponse);
    capped = true;
    console.log(`[MCP] Capped tool calls: executing ${maxToolsPerResponse}, skipping ${skippedCount}`);
  }

  // If no formal tool calls, try fallback detection for file creation AND prose commands
  if (toolCalls.length === 0) {
    console.log('[MCP] No formal tool calls found, trying fallback detection...');

    // Prose command fallback: detect "run `command`" / "by running `command`" patterns
    const proseCommands = _detectProseCommands(responseText);
    if (proseCommands.length > 0) {
      console.log('[MCP] Found prose command fallback:', proseCommands.length);
      toolCalls.push(...proseCommands);
    }

    const fallbackCalls = this._detectFallbackFileOperations(responseText, options.userMessage);
    if (fallbackCalls.length > 0) {
      console.log('[MCP] Found fallback tool calls:', fallbackCalls.length);
      let effectiveFallbackCalls = fallbackCalls;
      let fbCapped = false;
      let fbSkipped = 0;
      if (maxToolsPerResponse > 0 && fallbackCalls.length > maxToolsPerResponse) {
        fbSkipped = fallbackCalls.length - maxToolsPerResponse;
        effectiveFallbackCalls = fallbackCalls.slice(0, maxToolsPerResponse);
        fbCapped = true;
        console.log(`[MCP] Capped fallback tool calls: executing ${maxToolsPerResponse}, skipping ${fbSkipped}`);
      }
      const results = [];
      for (const call of effectiveFallbackCalls) {
        if (toolPaceMs > 0 && results.length > 0) {
          await new Promise(r => setTimeout(r, toolPaceMs));
        }
        const result = await this.executeTool(call.tool, call.params || {});
        results.push({ tool: call.tool, params: call.params, result });
      }
      return { hasToolCalls: true, results, capped: fbCapped, skippedToolCalls: fbSkipped };
    }
    console.log('[MCP] No fallback tool calls either');
    return { hasToolCalls: false, results: [] };
  }

  // ── Browser Tool Capping ──
  // Browser actions that change page state (navigate, click, type, select, press_key)
  // invalidate all ref=N element references. Executing multiple state-changing browser
  // actions in one turn causes cascading failures because refs go stale after the first one.
  // Cap: execute up to MAX_BROWSER_STATE_CHANGES state-changing browser actions per turn.
  // Non-state-changing browser tools (snapshot, screenshot, get_url, get_content) are unlimited.
  const BROWSER_STATE_CHANGERS = new Set([
    'browser_navigate', 'browser_click', 'browser_type', 'browser_select',
    'browser_select_option', 'browser_press_key', 'browser_back',
    'browser_fill_form', 'browser_drag', 'browser_file_upload',
  ]);
  const MAX_BROWSER_STATE_CHANGES = 2; // Allow navigate + one interaction, then stop
  let browserStateChanges = 0;
  let browserCapped = false;
  let browserSkipped = 0;

  // ── Write Deferral ──
  // When write_file/edit_file appears in the same batch as data-gathering tools
  // (browser_*, web_search, fetch_webpage), the write content was pre-generated
  // BEFORE gather results came back — it's always fabricated. Defer the write
  // so the model re-issues it next turn with real data from tool results.
  const DATA_GATHER_TOOLS = new Set([
    'browser_navigate', 'browser_click', 'browser_type', 'browser_snapshot',
    'browser_evaluate', 'browser_get_content', 'browser_scroll', 'browser_back',
    'browser_select_option', 'browser_press_key', 'browser_get_links',
    'browser_screenshot', 'browser_hover', 'browser_tabs',
    'web_search', 'fetch_webpage',
  ]);
  const DATA_WRITE_TOOLS = new Set(['write_file', 'edit_file']);
  const batchHasGather = toolCalls.some(c => c?.tool && DATA_GATHER_TOOLS.has(c.tool));
  const batchHasWrite = toolCalls.some(c => c?.tool && DATA_WRITE_TOOLS.has(c.tool));
  const shouldDeferWrites = batchHasGather && batchHasWrite && !options?.skipWriteDeferral;
  if (shouldDeferWrites) {
    console.log('[MCP] Write deferral: batch contains both data-gathering and file-writing tools — deferring writes to next turn');
  } else if (batchHasGather && batchHasWrite && options?.skipWriteDeferral) {
    console.log('[MCP] Write deferral SKIPPED (tiny model) — fabrication auto-correction will handle content');
  }

  console.log('[MCP] Executing', toolCalls.length, 'tool calls...', toolPaceMs ? `(${toolPaceMs}ms pace)` : '');
  const results = [];
  for (const call of toolCalls) {
    // Check browser cap before executing
    if (call && typeof call.tool === 'string' && BROWSER_STATE_CHANGERS.has(call.tool)) {
      if (browserStateChanges >= MAX_BROWSER_STATE_CHANGES) {
        browserSkipped++;
        browserCapped = true;
        console.log(`[MCP] Browser cap: skipping ${call.tool} (${browserStateChanges} state changes already, refs are stale)`);
        continue;
      }
    }

    // Defer writes when co-batched with data-gathering — content is pre-fabricated
    if (shouldDeferWrites && call?.tool && DATA_WRITE_TOOLS.has(call.tool)) {
      console.log(`[MCP] Write deferred: skipping ${call.tool} (re-issue next turn with real data)`);
      results.push({
        tool: call.tool, params: call.params,
        result: { success: false, error: `DEFERRED: ${call.tool} was batched with data-gathering tools. The file content was generated before seeing tool results and would be fabricated. Re-issue this ${call.tool} call in your NEXT response, using the ACTUAL data from the tool results above.` }
      });
      continue;
    }

    // Adaptive inter-tool pacing — prevents firehose execution and helps with rate limits
    if (toolPaceMs > 0 && results.length > 0) {
      await new Promise(r => setTimeout(r, toolPaceMs));
    }
    if (call && typeof call.tool === 'string') {
      if (call.tool.startsWith('browser_')) call.params = this._normalizeBrowserParams(call.tool, call.params || {});
      else call.params = this._normalizeFsParams(call.tool, call.params || {});
    }
    const result = await this.executeTool(call.tool, call.params || {});
    console.log('[MCP] Executed tool:', call.tool, 'result:', result.success ? 'success' : 'failed');
    results.push({ tool: call.tool, params: call.params, result });

    // Track state-changing browser actions
    if (call && typeof call.tool === 'string' && BROWSER_STATE_CHANGERS.has(call.tool)) {
      browserStateChanges++;
    }
  }

  if (browserCapped) {
    console.log(`[MCP] Browser cap enforced: executed ${browserStateChanges} state-changing actions, skipped ${browserSkipped}`);
  }

  return { hasToolCalls: true, results, capped: capped || browserCapped, skippedToolCalls: skippedCount + browserSkipped };
}

/**
 * Fallback detection for file operations when model doesn't use formal tool syntax.
 * Looks for patterns like "```html\n<!DOCTYPE...```" with context suggesting file creation.
 */
function _detectFallbackFileOperations(responseText, userMessage) {
  const results = [];

  // ── Phase 1: Bash/shell/cmd code blocks → run_command recovery ──
  // When model dumps a ```bash or ```sh block with a command instead of calling run_command.
  // General infrastructure fix — benefits all models that narrate commands instead of calling tools.
  const bashBlockRegex = /```(?:bash|shell|sh|cmd|powershell|ps1|terminal)\s*\n([\s\S]*?)```/gi;
  let bashMatch;
  while ((bashMatch = bashBlockRegex.exec(responseText)) !== null) {
    const rawCmd = bashMatch[1].trim();
    // Filter out comment-only lines, keep actual commands
    const cmdLines = rawCmd.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    // Only recover short, simple commands (< 500 chars, ≤ 5 lines) — skip full scripts
    if (cmdLines.length > 0 && rawCmd.length < 500 && cmdLines.length <= 5) {
      const fullCommand = cmdLines.join(' && ');
      console.log('[MCP] Fallback: bash/shell block → run_command:', fullCommand.substring(0, 100));
      results.push({ tool: 'run_command', params: { command: fullCommand } });
    }
  }
  if (results.length > 0) return results;

  // ── Phase 2: Code blocks → write_file (file creation fallback) ──
  // Require file/folder nouns near action verbs — prevents false positives when models
  // use "write" or "create" in prose explanations (e.g. "write cleaner code",
  // "create more readable functions") without any file-creation intent.
  const hasFileIntent = (
    /creat(e|ing)\s+(?:\w+\s+){0,3}(?:file|folder|directory|document|project)/i.test(responseText) ||
    /writ(e|ing)\s+(a|the|this)?\s*(file|code\s+file|script|html|css)/i.test(responseText) ||
    /save\s+(this|the|it|them)\s*(as|to|in)/i.test(responseText) ||
    /generat(e|ing)\s+(?:\w+\s+){0,3}(?:file|folder|script)/i.test(responseText) ||
    /mak(e|ing)\s+(a|the|this)?\s*(file|folder|directory|document)/i.test(responseText)
  );
  // Also detect implied file intent: code blocks with recognized language tags
  // If model dumped code blocks without tool calls, it likely intended to create files.
  const hasCodeBlocksWithLang = /```(?:html?|css|javascript|js|typescript|ts|tsx|jsx|python|py|json|yaml|yml|xml|markdown|md|toml|ini|cfg|conf|sql|graphql|svelte|vue|ruby|rb|go|rust|rs|java|c|cpp|cs|php|swift|kotlin)\s*\n/i.test(responseText);

  // Only check hasFileIntent — hasCodeBlocksWithLang was removed because it triggered
  // on ANY code block with a language tag (```js, ```python), causing phantom write_file/
  // create_directory calls when the model was explaining concepts or showing code examples.
  // Explicit file-creation intent language is the only reliable signal.
  if (!hasFileIntent) return results;

  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  let match;

  const filePathPatterns = [
    /(?:(?:create|write|save|make|generate).*?(?:file|document).*?(?:named?|called?|at)?)\s*[`"']([^`"'\n]+\.\w+)[`"']/gi,
    /(?:filename|file name|filepath|file path|path)[:\s]*[`"']?([^\s`"'\n]+\.\w+)[`"']?/gi,
    /([a-zA-Z_][\w/\\-]*\.(?:html?|css|js|tsx?|jsx?|py|json|md|txt|yaml|yml|xml|sh|bat))/gi,
  ];

  const langToExt = {
    html: '.html', htm: '.html', css: '.css', javascript: '.js', js: '.js',
    typescript: '.ts', ts: '.ts', tsx: '.tsx', jsx: '.jsx',
    python: '.py', py: '.py', json: '.json', markdown: '.md', md: '.md',
    xml: '.xml', yaml: '.yaml', yml: '.yml', bash: '.sh', shell: '.sh',
    batch: '.bat', bat: '.bat', txt: '.txt', text: '.txt',
  };

  while ((match = codeBlockRegex.exec(responseText)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const content = match[2].trim();

    if (!content || content.length < 10) continue;

    // Skip code blocks that look like tool call JSON (already handled by parseToolCalls)
    if (lang === 'json' && /^\s*\{\s*["']?(?:tool|name)["']?\s*:/.test(content)) continue;

    if (lang === 'python' || lang === 'py') {
      if (/import os|open\s*\(|os\.makedirs|fs\.write/.test(content)) continue;
    }

    let filePath = null;

    // Search text BEFORE the code block for filenames
    const textBefore = responseText.substring(Math.max(0, match.index - 300), match.index);
    for (const pattern of filePathPatterns) {
      pattern.lastIndex = 0;
      const pathMatch = pattern.exec(textBefore);
      if (pathMatch) {
        filePath = pathMatch[1];
        break;
      }
    }

    // Search text AFTER the code block for filenames (some models label after)
    if (!filePath) {
      const afterStart = match.index + match[0].length;
      const textAfter = responseText.substring(afterStart, Math.min(responseText.length, afterStart + 300));
      for (const pattern of filePathPatterns) {
        pattern.lastIndex = 0;
        const pathMatch = pattern.exec(textAfter);
        if (pathMatch) {
          // Only use if extension matches code block language
          const ext = pathMatch[1].split('.').pop().toLowerCase();
          if (!lang || !langToExt[lang] || langToExt[lang] === '.' + ext) {
            filePath = pathMatch[1];
            break;
          }
        }
      }
    }

    // Search user message for filenames matching this code block's language
    if (!filePath && userMessage && lang && langToExt[lang]) {
      for (const pattern of filePathPatterns) {
        pattern.lastIndex = 0;
        const pathMatch = pattern.exec(userMessage);
        if (pathMatch) {
          const ext = pathMatch[1].split('.').pop().toLowerCase();
          if (langToExt[lang] === '.' + ext) {
            console.log(`[MCP] Fallback: filename "${pathMatch[1]}" inferred from user message`);
            filePath = pathMatch[1];
            break;
          }
        }
      }
    }

    if (!filePath && lang && langToExt[lang]) {
      const folderMatch = textBefore.match(/(?:in|inside|within|to|folder|directory)[:\s]+[`"']?([a-zA-Z_][\w/\\-]*)[`"']?/i);
      const folder = folderMatch ? folderMatch[1].replace(/\\/g, '/') : '';

      if (lang === 'html' || lang === 'htm') {
        filePath = folder ? `${folder}/index.html` : 'index.html';
      } else {
        filePath = folder ? `${folder}/main${langToExt[lang]}` : `main${langToExt[lang]}`;
      }
    }

    if (filePath && content) {
      const dirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : null;
      if (dirPath) {
        results.push({ tool: 'create_directory', params: { path: dirPath } });
      }
      results.push({ tool: 'write_file', params: { filePath, content } });
    }
  }

  return results;
}

/**
 * Detect shell commands suggested in prose (e.g., "run `npm -v`", "by running `node --version`")
 * Only used when no formal tool calls were found — prevents the model from
 * punting to the user when it should have called run_command itself.
 */
function _detectProseCommands(text) {
  const results = [];
  const SHELL_CMD_RE = /^\s*(npm|node|npx|git|python|python3|pip|pip3|cargo|make|cmake|docker|yarn|pnpm|deno|bun|which|where|env|echo|cat|ls|dir|pwd|cd|mv|cp|rm|mkdir|rmdir|chmod|curl|wget|tsc|eslint|prettier|jest|vitest)\b/i;
  // Match: run `cmd`, running `cmd`, execute `cmd`, type `cmd`, use `cmd`, use the terminal with `cmd`
  const prosePattern = /(?:run|running|execute|executing|type|typing|enter|try|use|using)(?:\s+\w+){0,4}\s+[`'"]([^`'"]+)[`'"]/gi;
  let match;
  const seen = new Set();
  while ((match = prosePattern.exec(text)) !== null) {
    const cmd = match[1].trim();
    if (cmd.length >= 3 && cmd.length < 100 && SHELL_CMD_RE.test(cmd) && !seen.has(cmd)) {
      seen.add(cmd);
      console.log(`[MCP] Prose fallback: "${cmd}" → run_command`);
      results.push({ tool: 'run_command', params: { command: cmd } });
    }
  }
  // Also catch any backtick-quoted shell commands regardless of surrounding text
  const backtickPattern = /`([^`]+)`/g;
  while ((match = backtickPattern.exec(text)) !== null) {
    const cmd = match[1].trim();
    if (cmd.length >= 3 && cmd.length < 100 && SHELL_CMD_RE.test(cmd) && !seen.has(cmd)) {
      seen.add(cmd);
      console.log(`[MCP] Prose fallback (backtick): "${cmd}" → run_command`);
      results.push({ tool: 'run_command', params: { command: cmd } });
    }
  }
  return results;
}

module.exports = {
  TOOL_NAME_ALIASES,
  VALID_TOOLS,
  sanitizeJson,
  fixQuoting,
  fixBackticks,
  parseToolCalls,
  repairToolCalls,
  _recoverWriteFileContent,
  _inferFilePath,
  processResponse,
  _detectFallbackFileOperations,
  _detectProseCommands,
};
