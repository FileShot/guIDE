'use strict';

// ─── Tool Name Aliases ───
// Maps common model misspellings/hallucinations to canonical tool names
const TOOL_NAME_ALIASES = {
  // Browser
  navigate: 'browser_navigate', open_url: 'browser_navigate', goto: 'browser_navigate',
  go_to: 'browser_navigate', visit: 'browser_navigate', browse: 'browser_navigate',
  snapshot: 'browser_snapshot', get_snapshot: 'browser_snapshot', page_snapshot: 'browser_snapshot',
  accessibility_snapshot: 'browser_snapshot',
  click: 'browser_click', press: 'browser_click', tap: 'browser_click',
  type: 'browser_type', input: 'browser_type', fill: 'browser_type', enter_text: 'browser_type',
  screenshot: 'browser_screenshot', take_screenshot: 'browser_screenshot', capture: 'browser_screenshot',
  scroll: 'browser_scroll', scroll_page: 'browser_scroll',
  wait: 'browser_wait', sleep: 'browser_wait', delay: 'browser_wait',
  back: 'browser_back', go_back: 'browser_back',
  get_url: 'browser_get_url', current_url: 'browser_get_url',
  get_links: 'browser_get_links', list_links: 'browser_get_links',
  close_browser: 'browser_close',
  // Web
  search: 'web_search', google: 'web_search', duckduckgo: 'web_search',
  search_web: 'web_search', internet_search: 'web_search',
  fetch: 'fetch_webpage', fetch_url: 'fetch_webpage', get_page: 'fetch_webpage',
  // File
  read: 'read_file', cat: 'read_file', open: 'read_file', view: 'read_file',
  write: 'write_file', create: 'write_file', save: 'write_file', create_file: 'write_file',
  edit: 'edit_file', modify: 'edit_file', update: 'edit_file', patch: 'edit_file',
  append: 'append_to_file', add_to_file: 'append_to_file',
  delete: 'delete_file', remove: 'delete_file', rm: 'delete_file',
  rename: 'rename_file', move: 'rename_file', mv: 'rename_file',
  copy: 'copy_file', cp: 'copy_file',
  // Directory
  ls: 'list_directory', dir: 'list_directory', list_dir: 'list_directory',
  mkdir: 'create_directory', make_dir: 'create_directory',
  find: 'find_files', glob: 'find_files', locate: 'find_files',
  // Command
  run: 'run_command', exec: 'run_command', execute: 'run_command',
  shell: 'run_command', terminal: 'run_command', run_terminal_cmd: 'run_command',
  run_terminal: 'run_command', command: 'run_command',
  install: 'install_packages', npm_install: 'install_packages', pip_install: 'install_packages',
  // Search
  grep: 'grep_search', search_code: 'search_codebase', codebase_search: 'search_codebase',
  code_search: 'search_codebase', find_in_files: 'grep_search',
  // Git
  status: 'git_status', commit: 'git_commit', diff: 'git_diff',
  log: 'git_log', branch: 'git_branch', stash: 'git_stash',
  // Memory
  remember: 'save_memory', recall: 'get_memory',
  // Other
  undo: 'undo_edit', todos: 'write_todos', todo: 'update_todo',
  request: 'http_request', http: 'http_request', curl: 'http_request',
  delegate: 'delegate_task', subagent: 'delegate_task',
};

// ─── Valid Tool Names ───
const VALID_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'append_to_file', 'delete_file',
  'rename_file', 'copy_file', 'get_file_info', 'list_directory', 'find_files',
  'search_codebase', 'grep_search', 'search_in_file', 'replace_in_files',
  'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_fill_form', 'browser_select_option', 'browser_screenshot',
  'browser_get_content', 'browser_evaluate', 'browser_scroll', 'browser_wait',
  'browser_wait_for', 'browser_back', 'browser_press_key', 'browser_hover',
  'browser_drag', 'browser_tabs', 'browser_handle_dialog', 'browser_console_messages',
  'browser_file_upload', 'browser_resize', 'browser_get_url', 'browser_get_links',
  'browser_close',
  'web_search', 'fetch_webpage',
  'git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch', 'git_stash', 'git_reset',
  'save_memory', 'get_memory', 'list_memories',
  'run_command', 'get_project_structure', 'create_directory', 'analyze_error', 'install_packages',
  'undo_edit', 'list_undoable',
  'write_todos', 'update_todo',
  'write_scratchpad', 'read_scratchpad', 'create_tool', 'use_tool', 'delegate_task',
  'http_request', 'check_port', 'open_file_in_editor', 'generate_image', 'diff_files',
]);

// ─── JSON Repair Utilities ───

function sanitizeJson(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  // Fix common invalid escape sequences inside string values
  let result = '';
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      // Valid JSON escapes
      if ('"\\bfnrtu/'.includes(ch)) {
        result += ch;
      } else {
        // Invalid escape — double the backslash
        result += '\\' + ch;
      }
      escaped = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      escaped = true;
      result += ch;
      continue;
    }
    if (ch === '"' && !escaped) {
      inStr = !inStr;
    }
    // Strip raw control chars inside strings (except tab, newline)
    if (inStr && ch.charCodeAt(0) < 32 && ch !== '\t' && ch !== '\n') {
      result += ' ';
      continue;
    }
    result += ch;
  }
  return result;
}

function fixQuoting(raw) {
  if (!raw) return raw;
  // Single-quoted strings → double-quoted
  let fixed = raw.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // Unquoted keys → double-quoted
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
  return fixed;
}

function fixBackticks(raw) {
  if (!raw) return raw;
  // Replace backtick-delimited strings with properly escaped JSON double-quoted strings
  return raw.replace(/`([\s\S]*?)`/g, (match, inner) => {
    // Escape characters that are invalid in JSON strings
    const escaped = inner
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return '"' + escaped + '"';
  });
}

function tryParseJson(raw) {
  // Triple-try chain: raw → fixQuoting → fixBackticks
  try { return JSON.parse(sanitizeJson(raw)); } catch {}
  try { return JSON.parse(sanitizeJson(fixQuoting(raw))); } catch {}
  try { return JSON.parse(sanitizeJson(fixBackticks(fixQuoting(raw)))); } catch {}
  return null;
}

// ─── Brace-Counting JSON Extractor ───
function extractJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let inBacktick = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '`' && !inStr) { inBacktick = !inBacktick; continue; }
    if (ch === '"' && !inBacktick) { inStr = !inStr; continue; }
    if (inStr || inBacktick) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = text.slice(start, i + 1);
        const parsed = tryParseJson(slice);
        if (parsed) objects.push(parsed);
        start = -1;
      }
    }
  }

  // Handle truncated JSON (unclosed braces)
  if (depth > 0 && start >= 0) {
    const partial = text.slice(start);
    // Try to recover write_file with partial content
    const pathMatch = partial.match(/"(?:filePath|path)"\s*:\s*"([^"]+)"/);
    const contentMatch = partial.match(/"content"\s*:\s*"([\s\S]{100,})$/);
    if (pathMatch && contentMatch) {
      objects.push({
        tool: 'write_file',
        params: { filePath: pathMatch[1], content: contentMatch[1] },
        _truncated: true,
      });
    }
  }

  return objects;
}

// ─── Tool Call Normalization ───
function normalizeToolCall(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  // Extract tool name
  let toolName = parsed.tool || parsed.name || parsed.function || parsed.action;
  if (!toolName) return null;

  toolName = String(toolName).trim().toLowerCase().replace(/\s+/g, '_');

  // Alias resolution
  if (TOOL_NAME_ALIASES[toolName]) toolName = TOOL_NAME_ALIASES[toolName];

  // CLI-binary recovery: if toolName is a shell binary, convert to run_command
  const shellBinaries = /^(node|npm|npx|git|python|pip|cargo|go|ruby|java|gcc|make|cmake|dotnet|curl|wget)\b/;
  if (shellBinaries.test(toolName) && !VALID_TOOLS.has(toolName)) {
    const cmd = parsed.params?.command || `${toolName} ${parsed.params?.args || ''}`.trim();
    return { tool: 'run_command', params: { command: cmd } };
  }

  // Reject hallucinated tool names
  if (!VALID_TOOLS.has(toolName)) return null;

  // Extract params
  let params = parsed.params || parsed.parameters || parsed.arguments || parsed.args || {};
  if (typeof params !== 'object' || Array.isArray(params)) params = {};

  // If top-level props look like params (not tool metadata), merge them
  const metaKeys = new Set(['tool', 'name', 'function', 'action', 'params', 'parameters', 'arguments', 'args']);
  for (const [k, v] of Object.entries(parsed)) {
    if (!metaKeys.has(k) && !(k in params)) {
      params[k] = v;
    }
  }

  // Param name normalization
  if (params.file_path && !params.filePath) { params.filePath = params.file_path; delete params.file_path; }
  if (params.file && !params.filePath) { params.filePath = params.file; delete params.file; }
  if (params.filename && !params.filePath) { params.filePath = params.filename; delete params.filename; }
  if (params.old_text && !params.oldText) { params.oldText = params.old_text; delete params.old_text; }
  if (params.new_text && !params.newText) { params.newText = params.new_text; delete params.new_text; }
  if (params.dir_path && !params.dirPath) { params.dirPath = params.dir_path; delete params.dir_path; }
  if (params.directory && !params.dirPath) { params.dirPath = params.directory; delete params.directory; }

  // Browser-specific: selector → ref, value → text, href → url
  if (toolName.startsWith('browser_')) {
    if (params.selector && !params.ref) { params.ref = params.selector; delete params.selector; }
    if (params.value && !params.text && toolName === 'browser_type') { params.text = params.value; delete params.value; }
    if (params.href && !params.url) { params.url = params.href; delete params.href; }
  }

  return { tool: toolName, params };
}

// ─── Main Parser ───
function parseToolCalls(text) {
  if (!text || typeof text !== 'string') return [];

  const calls = [];
  const seen = new Set(); // dedup by signature

  const addCall = (call) => {
    if (!call) return;
    const sig = `${call.tool}:${JSON.stringify(call.params)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    calls.push(call);
  };

  // Method 0: XML tags — <tool_call>...</tool_call>
  const xmlRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m;
  while ((m = xmlRe.exec(text)) !== null) {
    const parsed = tryParseJson(m[1]);
    if (parsed) addCall(normalizeToolCall(parsed));
  }
  if (calls.length > 0) return _postProcess(calls, text);

  // Method 1: Fenced code blocks — ```tool_call / ```tool / ```json
  const fenceRe = /```(?:tool_call|tool|json)[^\n]*\n([\s\S]*?)```/g;
  while ((m = fenceRe.exec(text)) !== null) {
    const objects = extractJsonObjects(m[1]);
    for (const obj of objects) addCall(normalizeToolCall(obj));
  }

  // Method 1.5: Unclosed fence at end of response
  if (calls.length === 0) {
    const unclosedRe = /```(?:tool_call|tool|json)[^\n]*\n([\s\S]+)$/;
    const unclosed = text.match(unclosedRe);
    if (unclosed) {
      const objects = extractJsonObjects(unclosed[1]);
      for (const obj of objects) addCall(normalizeToolCall(obj));
    }
  }

  if (calls.length > 0) return _postProcess(calls, text);

  // Method 2: Raw JSON objects with "tool" or "name" key
  const rawJsonRe = /\{\s*["']?(?:tool|name)["']?\s*:\s*["'][^"']+["']/g;
  while ((m = rawJsonRe.exec(text)) !== null) {
    // Find the complete JSON object starting at this position
    const objects = extractJsonObjects(text.slice(m.index));
    for (const obj of objects) addCall(normalizeToolCall(obj));
  }
  if (calls.length > 0) return _postProcess(calls, text);

  // Method 3: Alternative formats
  // 3a: Function-call syntax — tool_name({"param":"value"})
  for (const toolName of VALID_TOOLS) {
    const funcRe = new RegExp(`\\b${toolName}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, 'g');
    while ((m = funcRe.exec(text)) !== null) {
      const parsed = tryParseJson(m[1]);
      if (parsed) addCall(normalizeToolCall({ tool: toolName, params: parsed }));
    }
  }

  // 3a.5: String-arg function calls — write_file('path', 'content')
  const stringArgRe = /\b(write_file|read_file|edit_file)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"`]([\s\S]*?)['"`]\s*\)/g;
  while ((m = stringArgRe.exec(text)) !== null) {
    const toolName = m[1];
    if (toolName === 'write_file') {
      addCall({ tool: 'write_file', params: { filePath: m[2], content: m[3] } });
    } else if (toolName === 'read_file') {
      addCall({ tool: 'read_file', params: { filePath: m[2] } });
    } else if (toolName === 'edit_file') {
      addCall({ tool: 'edit_file', params: { filePath: m[2], oldText: m[3] } });
    }
  }

  // 3b: Plain JSON with filePath+content but no "tool" key → write_file
  if (calls.length === 0) {
    const objects = extractJsonObjects(text);
    for (const obj of objects) {
      if (obj.filePath && obj.content && !obj.tool) {
        addCall({ tool: 'write_file', params: { filePath: obj.filePath, content: obj.content } });
      }
    }
  }

  return _postProcess(calls, text);
}

function _postProcess(calls, text) {
  // Post-parse remapping
  const shellCmdRe = /^(npm|node|npx|git|python|pip|cargo|go|ruby|make|cmake)\b/i;
  const urlRe = /^https?:\/\//i;
  const externalRe = /\b(documentation|tutorial|how to|install|getting started|API reference)\b/i;

  return calls.map(call => {
    // web_search with shell command → run_command
    if (call.tool === 'web_search' && call.params.query && shellCmdRe.test(call.params.query)) {
      return { tool: 'run_command', params: { command: call.params.query } };
    }
    // web_search with raw URL → browser_navigate
    if (call.tool === 'web_search' && call.params.query && urlRe.test(call.params.query)) {
      return { tool: 'browser_navigate', params: { url: call.params.query } };
    }
    // search_codebase with external/docs query → web_search
    if (call.tool === 'search_codebase' && call.params.query && externalRe.test(call.params.query)) {
      return { tool: 'web_search', params: { query: call.params.query } };
    }
    return call;
  });
}

// ─── Tool Call Repair ───
function repairToolCalls(toolCalls, responseText) {
  const repaired = [];
  const issues = [];
  const droppedFilePaths = [];

  for (const call of toolCalls) {
    const { tool, params } = call;

    if (tool === 'write_file') {
      // Empty content recovery
      if (!params.content || String(params.content).length < 5) {
        const recovered = _recoverWriteFileContent(responseText, params.filePath);
        if (recovered) {
          repaired.push(recovered);
          issues.push(`Recovered write_file content for ${params.filePath || 'unknown'}`);
          continue;
        }
        // Unrecoverable — drop and record path
        if (params.filePath) droppedFilePaths.push(params.filePath);
        issues.push(`Dropped write_file with empty content: ${params.filePath || 'unknown'}`);
        continue;
      }
      // Empty filePath
      if (!params.filePath) {
        params.filePath = _inferFilePath(responseText, params.content);
        issues.push(`Inferred filePath: ${params.filePath}`);
      }
    }

    if (tool === 'edit_file') {
      if (!params.oldText && !params.newText && !params.lineRange) {
        issues.push('Dropped edit_file with empty oldText/newText');
        continue;
      }
    }

    if (tool === 'browser_navigate') {
      if (!params.url) {
        issues.push('Dropped browser_navigate with empty URL');
        continue;
      }
      // Auto-prepend https:// if missing
      if (!/^https?:\/\//i.test(params.url) && !params.url.startsWith('file://')) {
        params.url = 'https://' + params.url;
      }
    }

    repaired.push(call);
  }

  // Last-resort recovery if all calls were dropped
  if (repaired.length === 0 && toolCalls.length > 0) {
    const recovered = _recoverWriteFileContent(responseText);
    if (recovered) {
      repaired.push(recovered);
      issues.push('Last-resort write_file recovery from response text');
    }
  }

  return { repaired, issues, droppedFilePaths };
}

// ─── Content Recovery ───
function _recoverWriteFileContent(text, preferredFilePath) {
  if (!text) return null;

  // Find the largest code block in the response
  const codeBlockRe = /```(?:\w+)?\n([\s\S]*?)```/g;
  let largest = '';
  let m;
  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m[1].length > largest.length) largest = m[1];
  }

  if (largest.length < 50) return null;

  const filePath = preferredFilePath || _inferFilePath(text, largest);
  return { tool: 'write_file', params: { filePath, content: largest } };
}

function _inferFilePath(text, content, lang) {
  // Try to find a file path mentioned in the response
  const pathRe = /\b([\w.-]+\.(?:js|ts|jsx|tsx|py|html|css|json|md|yaml|yml|xml|toml|sh|bat|sql|rb|go|rs|c|cpp|h|hpp|java|swift|kt))\b/i;
  const match = text.match(pathRe);
  if (match) return match[1];

  // Infer from content type
  if (content) {
    if (content.includes('<!DOCTYPE') || content.includes('<html')) return 'index.html';
    if (content.includes('import React') || content.includes('from "react"')) return 'component.jsx';
    if (content.includes('def ') || content.includes('import ')) return 'script.py';
    if (content.trimStart().startsWith('{')) return 'data.json';
  }

  // Infer from language hint
  const langToExt = {
    javascript: 'script.js', typescript: 'script.ts', python: 'script.py',
    html: 'index.html', css: 'style.css', json: 'data.json',
    markdown: 'document.md', yaml: 'config.yaml', shell: 'script.sh',
    bash: 'script.sh', ruby: 'script.rb', go: 'main.go', rust: 'main.rs',
  };
  if (lang && langToExt[lang.toLowerCase()]) return langToExt[lang.toLowerCase()];

  return 'output.txt';
}

// ─── Prose Command Detection ───
function _detectProseCommands(text) {
  if (!text) return [];

  const calls = [];
  // Detect: "run `npm install`", "execute 'git status'", etc.
  const proseRe = /(?:run|running|execute|executing|type|enter)\s+[`'"]([\w\s./@-]+(?:\s+[\w./@="-]+)*)[`'"]/gi;
  let m;
  while ((m = proseRe.exec(text)) !== null) {
    const cmd = m[1].trim();
    if (cmd.length > 2 && cmd.length < 500) {
      calls.push({ tool: 'run_command', params: { command: cmd } });
    }
  }
  return calls;
}

// ─── Fallback File Operation Detection ───
function _detectFallbackFileOperations(responseText, userMessage, lastDroppedFilePaths) {
  if (!responseText) return [];

  const calls = [];

  // Check for code blocks with file path context
  const codeBlockRe = /```(\w+)?\n([\s\S]*?)```/g;
  let m;
  while ((m = codeBlockRe.exec(responseText)) !== null) {
    const lang = m[1] || '';
    const content = m[2];
    if (content.length < 20) continue;

    // Look for a file path reference near or before this code block
    // Use the LAST match (closest to code block) — earlier matches may be from prior blocks
    const beforeBlock = responseText.slice(Math.max(0, m.index - 300), m.index);
    const pathReG = /\b([\w/\\.-]+\.(?:js|ts|jsx|tsx|py|html|css|json|md|yaml|yml))\b/gi;
    let pathMatch = null;
    let _pm;
    while ((_pm = pathReG.exec(beforeBlock)) !== null) pathMatch = _pm;

    if (pathMatch) {
      calls.push({ tool: 'write_file', params: { filePath: pathMatch[1], content } });
    }
  }

  // Check dropped paths from previous iteration
  if (lastDroppedFilePaths && lastDroppedFilePaths.length > 0) {
    for (const fp of lastDroppedFilePaths) {
      // Try to find content for this path
      const recovered = _recoverWriteFileContent(responseText, fp);
      if (recovered) calls.push(recovered);
    }
  }

  return calls;
}

module.exports = {
  TOOL_NAME_ALIASES,
  VALID_TOOLS,
  sanitizeJson,
  fixQuoting,
  fixBackticks,
  tryParseJson,
  extractJsonObjects,
  normalizeToolCall,
  parseToolCalls,
  repairToolCalls,
  _recoverWriteFileContent,
  _inferFilePath,
  _detectProseCommands,
  _detectFallbackFileOperations,
};
