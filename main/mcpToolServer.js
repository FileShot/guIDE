/**
 * guIDE MCP Tools Server — Model Context Protocol tools for browser automation,
 * web search, code execution, and system interaction.
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Provides tool definitions + execution for the LLM to use autonomously.
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');

// Extracted tool modules
const mcpBrowserTools = require('./tools/mcpBrowserTools');
const mcpGitTools = require('./tools/mcpGitTools');
const {
  parseToolCalls: standaloneParseToolCalls,
  repairToolCalls,
  _recoverWriteFileContent,
  TOOL_NAME_ALIASES,
  VALID_TOOLS,
} = require('./tools/toolParser');

class MCPToolServer {
  constructor(options = {}) {
    this.webSearch = options.webSearch || null;
    this.ragEngine = options.ragEngine || null;
    this.terminalManager = options.terminalManager || null;
    this.projectPath = options.projectPath || null;
    this.browserManager = null;
    this.playwrightBrowser = null;
    this.gitManager = null;
    this.imageGen = null;

    this.toolHistory = [];
    this.maxHistory = 50;

    // File change backups for undo (filePath → { original, timestamp, tool, isNew })
    this._fileBackups = new Map();
    this._maxFileBackups = 200;

    // Checkpoint turn tracking
    this._turnSnapshots = [];
    this._maxTurnSnapshots = 20;
    this._currentTurnId = null;
    this._currentTurnCapture = new Map();

    // Caches
    this._toolDefsCache = null;
    this._toolPromptCache = null;

    // TODO list
    this._todos = [];
    this._todoNextId = 1;
    this.onTodoUpdate = null;

    // Scratchpad
    this._scratchDir = options.projectPath ? path.join(options.projectPath, '.guide-scratch') : null;

    // Permission gates for destructive operations
    this.onPermissionRequest = null;
    this._destructiveTools = new Set([
      'delete_file', 'replace_in_file', 'write_file', 'terminal_run',
      'git_commit', 'git_push', 'git_reset', 'git_branch_delete',
    ]);
  }

  // ─── Parameter Normalization ─────────────────────────────────────────────

  _normalizeBrowserParams(toolName, params) {
    if (!params || typeof params !== 'object') return params;
    const normalized = { ...params };

    if (toolName === 'browser_click' || toolName === 'browser_type' || toolName === 'browser_hover') {
      // Common small-model schema drift: selector/element_ref/elementRef → ref
      if (normalized.ref == null && normalized.selector != null) {
        normalized.ref = normalized.selector;
        delete normalized.selector;
      }
      if (normalized.ref == null && normalized.element_ref != null) {
        normalized.ref = normalized.element_ref;
        delete normalized.element_ref;
      }
      if (normalized.ref == null && normalized.elementRef != null) {
        normalized.ref = normalized.elementRef;
        delete normalized.elementRef;
      }
      // For clicks: accept visible text as ref
      if (toolName === 'browser_click' && normalized.ref == null && typeof normalized.element_text === 'string') {
        normalized.ref = normalized.element_text;
        delete normalized.element_text;
      }
      if (toolName === 'browser_click' && normalized.ref == null && typeof normalized.elementText === 'string') {
        normalized.ref = normalized.elementText;
        delete normalized.elementText;
      }
      // Normalize numeric refs to strings
      if (typeof normalized.ref === 'number') normalized.ref = String(normalized.ref);
      // Strip [ref=N] wrapper
      if (typeof normalized.ref === 'string') {
        const m = normalized.ref.match(/\[ref\s*=\s*(\d+)\]/i) || normalized.ref.match(/^ref\s*=\s*(\d+)$/i);
        if (m) normalized.ref = m[1];
      }
    }

    if (toolName === 'browser_type') {
      if (normalized.text == null && normalized.value != null) {
        normalized.text = normalized.value;
        delete normalized.value;
      }
    }

    if (toolName === 'browser_navigate') {
      if (normalized.url == null && typeof normalized.href === 'string') normalized.url = normalized.href;
      if (normalized.url == null && typeof normalized.link === 'string') normalized.url = normalized.link;
      if (normalized.url == null && typeof normalized.ref === 'string' && normalized.ref.includes('.')) normalized.url = normalized.ref;
      if (normalized.url == null && typeof normalized.src === 'string') normalized.url = normalized.src;
      if (normalized.url == null && typeof normalized.page === 'string') normalized.url = normalized.page;
      if (normalized.url == null && typeof normalized.target === 'string') normalized.url = normalized.target;
    }

    return normalized;
  }

  _normalizeFsParams(toolName, params) {
    if (!params || typeof params !== 'object') return params;
    const normalized = { ...params };

    if (['write_file', 'read_file', 'delete_file', 'rename_file', 'edit_file', 'get_file_info', 'git_diff'].includes(toolName)) {
      if (normalized.filePath == null && typeof normalized.path === 'string') {
        normalized.filePath = normalized.path;
        delete normalized.path;
      }
      if (normalized.filePath == null && typeof normalized.file_path === 'string') {
        normalized.filePath = normalized.file_path;
        delete normalized.file_path;
      }
      if (normalized.filePath == null && typeof normalized.filename === 'string') {
        normalized.filePath = normalized.filename;
        delete normalized.filename;
      }
      if (normalized.filePath == null && typeof normalized.file_name === 'string') {
        normalized.filePath = normalized.file_name;
        delete normalized.file_name;
      }
      if (normalized.filePath == null && typeof normalized.file === 'string') {
        normalized.filePath = normalized.file;
        delete normalized.file;
      }
      if (normalized.filePath == null && typeof normalized.key === 'string') {
        normalized.filePath = normalized.key;
        delete normalized.key;
        delete normalized.value;
      }
    }

    if (toolName === 'list_directory') {
      if (normalized.dirPath == null) {
        if (typeof normalized.filePath === 'string') {
          normalized.dirPath = normalized.filePath;
          delete normalized.filePath;
        } else if (typeof normalized.path === 'string') {
          normalized.dirPath = normalized.path;
          delete normalized.path;
        } else if (typeof normalized.dir === 'string') {
          normalized.dirPath = normalized.dir;
          delete normalized.dir;
        } else if (typeof normalized.directory === 'string') {
          normalized.dirPath = normalized.directory;
          delete normalized.directory;
        } else if (typeof normalized.key === 'string') {
          normalized.dirPath = normalized.key;
          delete normalized.key;
          delete normalized.value;
        }
      }
    }

    if (toolName === 'create_directory') {
      if (normalized.path == null && typeof normalized.dirPath === 'string') {
        normalized.path = normalized.dirPath;
        delete normalized.dirPath;
      }
    }

    if (toolName === 'find_files') {
      if (normalized.pattern == null && typeof normalized.query === 'string') {
        normalized.pattern = normalized.query;
        delete normalized.query;
      }
    }

    return normalized;
  }

  // ─── Timeout Wrapper ─────────────────────────────────────────────────────

  _withTimeout(promise, ms = 60000, label = 'operation') {
    return Promise.race([
      promise,
      new Promise((resolve) =>
        setTimeout(() => resolve({ success: false, error: `${label} timed out after ${ms / 1000}s` }), ms)
      ),
    ]);
  }

  // ─── Path Sanitization ───────────────────────────────────────────────────

  _sanitizeFilePath(filePath) {
    if (!filePath) return filePath;

    if (!this.projectPath) {
      if (path.isAbsolute(filePath)) {
        console.log(`[MCPToolServer] Absolute path blocked (no project): "${filePath}"`);
        return path.basename(filePath);
      }
      return filePath;
    }

    const resolved = path.resolve(this.projectPath, filePath);
    const resolvedNorm = resolved.replace(/\\/g, '/').toLowerCase();
    const projNorm = this.projectPath.replace(/\\/g, '/').toLowerCase();

    if (!resolvedNorm.startsWith(projNorm)) {
      console.log(`[MCPToolServer] Path traversal blocked: "${filePath}" → "${resolved}" escapes project`);
      return path.basename(filePath);
    }

    const normalized = filePath.replace(/\\/g, '/');
    const projNormalized = this.projectPath.replace(/\\/g, '/');

    if (!path.isAbsolute(filePath)) return filePath;

    // Detect doubled project root
    const projBasename = path.basename(this.projectPath).toLowerCase();
    const afterProj = resolvedNorm.substring(projNorm.length);
    if (afterProj === '/' + projBasename || afterProj.startsWith('/' + projBasename + '/')) {
      const rest = afterProj.substring(('/' + projBasename).length);
      const corrected = this.projectPath + rest.replace(/\//g, path.sep);
      console.log(`[MCPToolServer] Doubled project root corrected: "${filePath}" → "${corrected}"`);
      return corrected;
    }

    if (normalized.toLowerCase().startsWith(projNormalized.toLowerCase())) return filePath;

    const basename = path.basename(filePath);
    if (basename) {
      console.log(`[MCPToolServer] Sanitized hallucinated path "${filePath}" → "${basename}"`);
      return basename;
    }
    return filePath;
  }

  _sanitizeShellArg(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/[\x00]/g, '')
      .replace(/[`]/g, '')
      .replace(/[\n\r]/g, ' ')
      .trim();
  }

  // ─── Tool Definitions ────────────────────────────────────────────────────

  getToolDefinitions() {
    if (this._toolDefsCache) return this._toolDefsCache;
    this._toolDefsCache = [
      {
        name: 'web_search',
        description: 'Search the web for current information using DuckDuckGo. Use for anything current, live, or time-sensitive: prices, weather, news, headlines, scores, events, stock data, documentation lookups. Format: {"tool":"web_search","params":{"query":"react useState docs"}}',
        parameters: {
          query: { type: 'string', description: 'Search query', required: true },
          maxResults: { type: 'number', description: 'Max results (default 5)', required: false },
        },
      },
      {
        name: 'fetch_webpage',
        description: 'Fetch and extract text content from a webpage URL. Use ONLY to READ information from a web page (articles, documentation, data). Do NOT use to download CSS, fonts, images, or other resources for files you are creating — reference them via CDN links instead. Format: {"tool":"fetch_webpage","params":{"url":"https://example.com/docs"}}',
        parameters: {
          url: { type: 'string', description: 'URL to fetch', required: true },
        },
      },
      {
        name: 'read_file',
        description: 'Read contents of a file from the project. Must be called BEFORE edit_file to get exact text for replacement. Supports partial reads by line range. Format: {"tool":"read_file","params":{"filePath":"src/app.js"}}',
        parameters: {
          filePath: { type: 'string', description: 'Relative or absolute file path', required: true },
          startLine: { type: 'number', description: 'Start line (1-based, optional)', required: false },
          endLine: { type: 'number', description: 'End line (inclusive, optional)', required: false },
        },
      },
      {
        name: 'write_file',
        description: 'Write or create a file — OVERWRITES the entire file with the content provided. Use for new files or when replacing the full content. If you need to add to a file without losing existing content, use append_to_file instead. Format: {"tool":"write_file","params":{"filePath":"src/app.js","content":"..."}}',
        parameters: {
          filePath: { type: 'string', description: 'File path', required: true },
          content: { type: 'string', description: 'File content', required: true },
        },
      },
      {
        name: 'search_codebase',
        description: 'Search the indexed codebase for relevant code using semantic search (RAG). Use when looking for functions, classes, patterns, or concepts in the project. Format: {"tool":"search_codebase","params":{"query":"authentication middleware"}}',
        parameters: {
          query: { type: 'string', description: 'Search query', required: true },
          maxResults: { type: 'number', description: 'Max results', required: false },
        },
      },
      {
        name: 'run_command',
        description: 'Execute a shell command and return the output. Default timeout 60s, max 5 minutes. Format: {"tool":"run_command","params":{"command":"npm install"}}',
        parameters: {
          command: { type: 'string', description: 'Command to execute', required: true },
          cwd: { type: 'string', description: 'Working directory', required: false },
          timeout: { type: 'number', description: 'Timeout in ms (default 60000)', required: false },
        },
      },
      {
        name: 'list_directory',
        description: 'List files and directories at a path. Call this before naming or assuming any files exist — you have no knowledge of what files are in the project until you do. Use "." to list the project root. Format: {"tool":"list_directory","params":{"dirPath":"src"}}',
        parameters: {
          dirPath: { type: 'string', description: 'Directory path — use "." for project root', required: true },
          recursive: { type: 'boolean', description: 'Recursive listing', required: false },
        },
      },
      {
        name: 'find_files',
        description: 'Find files matching a name or glob pattern in the project. Use to locate files when you know part of the filename. Format: {"tool":"find_files","params":{"pattern":"*.config.js"}}',
        parameters: {
          pattern: { type: 'string', description: 'File name or glob pattern', required: true },
        },
      },
      {
        name: 'analyze_error',
        description: 'Analyze an error message and stack trace against the codebase to find the source of the error and suggest fixes. Format: {"tool":"analyze_error","params":{"errorMessage":"Cannot read property x of undefined"}}',
        parameters: {
          errorMessage: { type: 'string', description: 'Error message', required: true },
          stackTrace: { type: 'string', description: 'Stack trace', required: false },
        },
      },
      // ── Browser Tools ──
      {
        name: 'browser_navigate',
        description: 'Navigate to a URL in an external Chrome browser controlled by Playwright. Auto-launches Chrome if needed. After navigation, call browser_snapshot to see the page.',
        parameters: {
          url: { type: 'string', description: 'Full URL to navigate to (must include https:// or http://)', required: true },
        },
      },
      {
        name: 'browser_snapshot',
        description: 'Get an accessibility snapshot of the current page with numbered element refs. Returns elements like: [ref=1] button "Sign In", [ref=2] textbox "Search...", and text content lines starting with --. ALWAYS call this before clicking or typing to discover elements and get refs. Refs are invalidated after page changes, so re-snapshot after clicks/navigation.',
        parameters: {},
      },
      {
        name: 'browser_click',
        description: 'Click an element by its ref number from browser_snapshot. Uses Playwright native click which handles scrolling, overlays, and real browser events automatically. Auto-retries with a fresh snapshot if the ref is stale.',
        parameters: {
          ref: { type: 'string', description: 'Element ref number from snapshot (e.g. "5"), OR visible text of the element (e.g. "Sign In")', required: true },
          button: { type: 'string', description: "Mouse button: 'left', 'right', or 'middle' (default 'left')", required: false },
          doubleClick: { type: 'boolean', description: 'Double click instead of single click', required: false },
          element: { type: 'string', description: 'Human-readable element description (used as fallback if ref fails)', required: false },
        },
      },
      {
        name: 'browser_type',
        description: 'Type text into an input field by ref number. Auto-clears the field first. For search boxes, type the text then use browser_press_key with key="Enter" to submit. Auto-retries with fresh snapshot if ref is stale.',
        parameters: {
          ref: { type: 'string', description: 'Element ref number from snapshot (e.g. "3")', required: true },
          text: { type: 'string', description: 'Text to type', required: true },
          slowly: { type: 'boolean', description: 'Type one character at a time (triggers key handlers). Default: fast fill.', required: false },
          submit: { type: 'boolean', description: 'Press Enter after typing', required: false },
        },
      },
      {
        name: 'browser_fill_form',
        description: 'Fill multiple form fields at once. More efficient than calling browser_type repeatedly. Supports textbox, checkbox, radio, combobox, and slider fields.',
        parameters: {
          fields: {
            type: 'array', description: 'Array of {ref, value, type} objects. type: "textbox"|"checkbox"|"radio"|"combobox"|"slider"', required: true,
            items: {
              type: 'object',
              properties: {
                ref: { type: 'string', description: 'Element ref from snapshot' },
                value: { type: 'string', description: 'Value to fill. For checkbox: "true"/"false". For combobox: option text.' },
                type: { type: 'string', description: 'Field type: textbox, checkbox, radio, combobox, slider' },
              },
            },
          },
        },
      },
      {
        name: 'browser_select_option',
        description: 'Select one or more options from a dropdown/select element by ref.',
        parameters: {
          ref: { type: 'string', description: 'Element ref from snapshot', required: true },
          values: { type: 'array', description: 'Array of option labels or values to select', required: true },
        },
      },
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current browser page or a specific element.',
        parameters: {
          fullPage: { type: 'boolean', description: 'Capture full scrollable page (default false)', required: false },
          ref: { type: 'string', description: 'Element ref to screenshot (optional, screenshots viewport by default)', required: false },
        },
      },
      {
        name: 'browser_get_content',
        description: 'Get the text content or HTML of the current browser page.',
        parameters: {
          selector: { type: 'string', description: 'CSS selector (optional, gets body by default)', required: false },
          html: { type: 'boolean', description: 'Return HTML instead of text', required: false },
        },
      },
      {
        name: 'browser_evaluate',
        description: 'Execute JavaScript code in the browser page context. The code is evaluated as a page function. Returns the result.',
        parameters: {
          code: { type: 'string', description: 'JavaScript code to evaluate (e.g. "document.title" or "() => document.querySelectorAll(\'a\').length")', required: true },
          ref: { type: 'string', description: 'Optional element ref — code receives the element as argument', required: false },
        },
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the browser page up or down.',
        parameters: {
          direction: { type: 'string', description: "Direction to scroll: 'up' or 'down'", required: true },
          amount: { type: 'number', description: 'Pixels to scroll (default 500)', required: false },
        },
      },
      {
        name: 'browser_wait',
        description: 'Wait for a specified duration in milliseconds.',
        parameters: {
          ms: { type: 'number', description: 'Milliseconds to wait (default 2000, max 30000)', required: false },
        },
      },
      {
        name: 'browser_wait_for',
        description: 'Wait for text to appear or disappear on the page, or for a CSS selector to become visible.',
        parameters: {
          text: { type: 'string', description: 'Text to wait for (appears)', required: false },
          textGone: { type: 'string', description: 'Text to wait to disappear', required: false },
          time: { type: 'number', description: 'Seconds to wait', required: false },
          selector: { type: 'string', description: 'CSS selector to wait for', required: false },
        },
      },
      {
        name: 'browser_back',
        description: 'Navigate back in browser history.',
        parameters: {},
      },
      {
        name: 'browser_press_key',
        description: 'Press a keyboard key. Essential for submitting search forms (Enter after typing), navigating menus, closing dialogs, etc.',
        parameters: {
          key: { type: 'string', description: 'Key name: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, Home, End, PageUp, PageDown, F1-F12', required: true },
        },
      },
      {
        name: 'browser_hover',
        description: 'Hover over an element on the browser page by ref.',
        parameters: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot', required: true },
        },
      },
      {
        name: 'browser_drag',
        description: 'Drag and drop from one element to another.',
        parameters: {
          startRef: { type: 'string', description: 'Source element ref', required: true },
          endRef: { type: 'string', description: 'Target element ref', required: true },
        },
      },
      {
        name: 'browser_tabs',
        description: 'Manage browser tabs: list all tabs, create new tab, close a tab, or switch to a tab.',
        parameters: {
          action: { type: 'string', description: "'list', 'new', 'close', or 'select'", required: true },
          index: { type: 'number', description: 'Tab index (for close/select)', required: false },
        },
      },
      {
        name: 'browser_handle_dialog',
        description: 'Handle a pending alert, confirm, or prompt dialog.',
        parameters: {
          accept: { type: 'boolean', description: 'Accept (true) or dismiss (false) the dialog', required: true },
          promptText: { type: 'string', description: 'Text for prompt dialogs', required: false },
        },
      },
      {
        name: 'browser_console_messages',
        description: 'Get console messages from the browser page.',
        parameters: {
          level: { type: 'string', description: "Minimum level: 'error', 'warning', 'info', 'debug' (default 'info')", required: false },
        },
      },
      {
        name: 'browser_file_upload',
        description: 'Upload files to a file input element.',
        parameters: {
          ref: { type: 'string', description: 'File input element ref', required: true },
          paths: { type: 'array', description: 'Array of absolute file paths to upload', required: true },
        },
      },
      {
        name: 'browser_resize',
        description: 'Resize the browser viewport.',
        parameters: {
          width: { type: 'number', description: 'Width in pixels', required: true },
          height: { type: 'number', description: 'Height in pixels', required: true },
        },
      },
      {
        name: 'browser_get_url',
        description: 'Get the current URL and title of the browser page.',
        parameters: {},
      },
      {
        name: 'browser_get_links',
        description: 'Get all links from the current browser page.',
        parameters: {
          selector: { type: 'string', description: 'Scope to a container CSS selector (optional)', required: false },
        },
      },
      {
        name: 'browser_close',
        description: 'Close the browser and clean up all resources.',
        parameters: {},
      },
      // ── File & Project Tools ──
      {
        name: 'get_project_structure',
        description: 'Get an overview of the project file structure — shows top-level files and directories with sizes. Call this first to understand the project layout. Format: {"tool":"get_project_structure","params":{}}',
        parameters: {},
      },
      {
        name: 'create_directory',
        description: 'Create a new directory (folder) in the project. Creates parent directories if needed. Format: {"tool":"create_directory","params":{"path":"src/components"}}',
        parameters: {
          path: { type: 'string', description: 'Directory path to create', required: true },
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file OR directory from the project. Directories are removed recursively. Use with caution — this cannot be undone. Format: {"tool":"delete_file","params":{"filePath":"temp/old-file.js"}}',
        parameters: {
          filePath: { type: 'string', description: 'Path of the file or directory to delete', required: true },
        },
      },
      {
        name: 'rename_file',
        description: 'Rename or move a file/directory to a new path. Format: {"tool":"rename_file","params":{"oldPath":"src/old.js","newPath":"src/new.js"}}',
        parameters: {
          oldPath: { type: 'string', description: 'Current file path', required: true },
          newPath: { type: 'string', description: 'New file path', required: true },
        },
      },
      {
        name: 'edit_file',
        description: 'Replace specific text in a file — finds oldText and replaces with newText. More efficient than rewriting the whole file. For targeted edits: read_file first to get exact text, then edit_file with the exact oldText string. Format: {"tool":"edit_file","params":{"filePath":"src/app.js","oldText":"...","newText":"..."}}',
        parameters: {
          filePath: { type: 'string', description: 'File to edit', required: true },
          oldText: { type: 'string', description: 'Exact text to find and replace (must match exactly)', required: true },
          newText: { type: 'string', description: 'Replacement text', required: true },
        },
      },
      {
        name: 'get_file_info',
        description: 'Get file metadata: size, modified date, type, and permissions. Format: {"tool":"get_file_info","params":{"filePath":"package.json"}}',
        parameters: {
          filePath: { type: 'string', description: 'Path to the file', required: true },
        },
      },
      // ── Memory Tools ──
      {
        name: 'save_memory',
        description: 'Save a piece of information for future reference across chat sessions. Use to remember project context, decisions, or facts. Format: {"tool":"save_memory","params":{"key":"db-schema","value":"Users table has id, name, email columns"}}',
        parameters: {
          key: { type: 'string', description: 'A key/label for this memory', required: true },
          value: { type: 'string', description: 'The information to remember', required: true },
        },
      },
      {
        name: 'get_memory',
        description: 'Recall previously saved information by key. Format: {"tool":"get_memory","params":{"key":"db-schema"}}',
        parameters: {
          key: { type: 'string', description: 'The key to look up', required: true },
        },
      },
      {
        name: 'list_memories',
        description: 'List all saved memory keys to see what information has been stored. Format: {"tool":"list_memories","params":{}}',
        parameters: {},
      },
      // ── Git Tools ──
      {
        name: 'git_status',
        description: 'Get current git status: changed files, staged files, current branch, and untracked files. Format: {"tool":"git_status","params":{}}',
        parameters: {},
      },
      {
        name: 'git_commit',
        description: 'Stage all changes and create a git commit with the given message. Format: {"tool":"git_commit","params":{"message":"fix: resolve login bug"}}',
        parameters: {
          message: { type: 'string', description: 'Commit message', required: true },
        },
      },
      {
        name: 'git_diff',
        description: 'Get the diff of a file or all uncommitted changes. Shows exactly what lines changed. Format: {"tool":"git_diff","params":{"filePath":"src/app.js"}}',
        parameters: {
          filePath: { type: 'string', description: 'File to diff (optional, omit for all changes)', required: false },
        },
      },
      {
        name: 'git_log',
        description: 'View recent git commit history with messages, dates, and authors. Format: {"tool":"git_log","params":{"maxCount":10}}',
        parameters: {
          maxCount: { type: 'number', description: 'Max commits to show (default 20)', required: false },
          filePath: { type: 'string', description: 'Filter log to a specific file (optional)', required: false },
        },
      },
      {
        name: 'git_branch',
        description: 'List, create, or switch git branches. Format: {"tool":"git_branch","params":{"action":"create","name":"feature/auth"}}',
        parameters: {
          action: { type: 'string', description: "'list', 'create', or 'switch'", required: true },
          name: { type: 'string', description: 'Branch name (required for create/switch)', required: false },
        },
      },
      {
        name: 'git_stash',
        description: 'Stash or restore uncommitted changes. Use to temporarily save work. Format: {"tool":"git_stash","params":{"action":"push","message":"wip: auth feature"}}',
        parameters: {
          action: { type: 'string', description: "'push', 'pop', 'list', or 'drop'", required: true },
          message: { type: 'string', description: 'Stash message (for push)', required: false },
        },
      },
      {
        name: 'git_reset',
        description: 'Unstage files or reset changes. Use hard reset with caution — it discards changes permanently. Format: {"tool":"git_reset","params":{"filePath":"src/app.js"}}',
        parameters: {
          filePath: { type: 'string', description: 'File to unstage (omit for all)', required: false },
          hard: { type: 'boolean', description: 'Hard reset — discard changes (default false)', required: false },
        },
      },
      // ── Search Tools ──
      {
        name: 'grep_search',
        description: 'Search for text or regex patterns across all project files. Returns matching lines with file paths and line numbers. Use for finding function definitions, variable usage, or any text in the codebase. Format: {"tool":"grep_search","params":{"pattern":"handleSubmit","filePattern":"*.tsx"}}',
        parameters: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for', required: true },
          filePattern: { type: 'string', description: 'Glob to filter files (e.g. "*.ts", "src/**/*.js")', required: false },
          isRegex: { type: 'boolean', description: 'Treat pattern as regex (default false)', required: false },
          maxResults: { type: 'number', description: 'Max results (default 50)', required: false },
        },
      },
      {
        name: 'search_in_file',
        description: 'Search for text within a specific file. Returns all matching lines with line numbers. Format: {"tool":"search_in_file","params":{"filePath":"src/app.js","pattern":"useState"}}',
        parameters: {
          filePath: { type: 'string', description: 'File to search in', required: true },
          pattern: { type: 'string', description: 'Text or regex to search for', required: true },
          isRegex: { type: 'boolean', description: 'Treat as regex', required: false },
        },
      },
      // ── More File Tools ──
      {
        name: 'copy_file',
        description: 'Copy a file or directory to a new location. Format: {"tool":"copy_file","params":{"source":"src/template.js","destination":"src/new-page.js"}}',
        parameters: {
          source: { type: 'string', description: 'Source path', required: true },
          destination: { type: 'string', description: 'Destination path', required: true },
        },
      },
      {
        name: 'append_to_file',
        description: 'Append content to the end of an existing file WITHOUT overwriting it. Use this when building a large file across multiple tool calls: write_file for the opening section, then append_to_file for every subsequent section. Creates the file if it does not exist. Format: {"tool":"append_to_file","params":{"filePath":"src/app.js","content":"..."}}',
        parameters: {
          filePath: { type: 'string', description: 'File path', required: true },
          content: { type: 'string', description: 'Content to append', required: true },
        },
      },
      {
        name: 'diff_files',
        description: 'Compare two files and show their differences line by line. Format: {"tool":"diff_files","params":{"fileA":"src/old.js","fileB":"src/new.js"}}',
        parameters: {
          fileA: { type: 'string', description: 'First file path', required: true },
          fileB: { type: 'string', description: 'Second file path', required: true },
        },
      },
      {
        name: 'http_request',
        description: 'Make an HTTP/HTTPS request (GET, POST, PUT, DELETE, PATCH). Use for testing APIs, webhooks, or fetching data. Format: {"tool":"http_request","params":{"url":"https://api.example.com/users","method":"GET"}}',
        parameters: {
          url: { type: 'string', description: 'Request URL', required: true },
          method: { type: 'string', description: "HTTP method (default 'GET')", required: false },
          headers: { type: 'object', description: 'Request headers', required: false },
          body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)', required: false },
        },
      },
      {
        name: 'check_port',
        description: 'Check if a network port is in use and what process is using it. Format: {"tool":"check_port","params":{"port":3000}}',
        parameters: {
          port: { type: 'number', description: 'Port number to check', required: true },
        },
      },
      {
        name: 'install_packages',
        description: 'Install packages using npm, pip, or other package managers. Auto-detects the manager from your project. Format: {"tool":"install_packages","params":{"packages":"express cors","manager":"npm"}}',
        parameters: {
          packages: { type: 'string', description: 'Space-separated package names', required: true },
          manager: { type: 'string', description: "'npm', 'pip', 'yarn' (default: auto-detect)", required: false },
        },
      },
      {
        name: 'undo_edit',
        description: 'Undo a file change made by a previous tool (write_file, edit_file). Restores the file to its state before the tool modified it. Format: {"tool":"undo_edit","params":{"filePath":"src/app.js"}}',
        parameters: {
          filePath: { type: 'string', description: 'Path of the file to undo (use list_undoable to see available files)', required: false },
          all: { type: 'boolean', description: 'Undo ALL file changes at once', required: false },
        },
      },
      {
        name: 'list_undoable',
        description: 'List all files that have undo backups available (files modified by tools that can be restored). Format: {"tool":"list_undoable","params":{}}',
        parameters: {},
      },
      {
        name: 'replace_in_files',
        description: 'Find and replace text across multiple files in the project. Useful for bulk renaming, updating imports, or refactoring. Format: {"tool":"replace_in_files","params":{"searchText":"oldName","replaceText":"newName","path":"src/**/*.js"}}',
        parameters: {
          searchText: { type: 'string', description: 'Text or regex pattern to find', required: true },
          replaceText: { type: 'string', description: 'Text to replace matches with', required: true },
          path: { type: 'string', description: 'Directory or file glob to search in (default: project root)', required: false },
          isRegex: { type: 'boolean', description: 'Treat searchText as a regex pattern', required: false },
        },
      },
      {
        name: 'open_file_in_editor',
        description: 'Open a file in the IDE editor as a new tab. Does not modify the file. Format: {"tool":"open_file_in_editor","params":{"filePath":"src/app.js"}}',
        parameters: {
          filePath: { type: 'string', description: 'Path of the file to open', required: true },
        },
      },
      {
        name: 'generate_image',
        description: 'Generate an image from a text prompt using AI image generation. Returns base64-encoded image data. Format: {"tool":"generate_image","params":{"prompt":"a sunset over mountains","savePath":"output/sunset.png"}}',
        parameters: {
          prompt: { type: 'string', description: 'Description of the image to generate', required: true },
          width: { type: 'number', description: 'Image width in pixels (default 1024)', required: false },
          height: { type: 'number', description: 'Image height in pixels (default 1024)', required: false },
          savePath: { type: 'string', description: 'Optional — save the generated image to this file path in the project', required: false },
        },
      },
      // ── Planning / TODO Tools ──
      {
        name: 'write_todos',
        description: 'Create a checklist to plan and track multi-step tasks. Use when a task involves multiple steps — building an app, refactoring code, implementing a feature. Format: {"tool":"write_todos","params":{"items":["Set up project","Create components","Add routing"]}}',
        parameters: {
          items: { type: 'array', description: 'Array of todo strings or {text,status} objects', required: true },
        },
      },
      {
        name: 'update_todo',
        description: 'Update a TODO item status: "pending", "in-progress", or "done". Format: {"tool":"update_todo","params":{"id":1,"status":"done"}}',
        parameters: {
          id: { type: 'number', description: 'Todo ID (from write_todos result)', required: true },
          status: { type: 'string', description: 'New status: pending, in-progress, or done', required: true },
          text: { type: 'string', description: 'New text (optional)', required: false },
        },
      },
      // ── Scratchpad Tools ──
      {
        name: 'write_scratchpad',
        description: 'Save intermediate data to a named scratchpad file. Use to avoid filling context with large data — store it here and read_scratchpad later. Format: {"tool":"write_scratchpad","params":{"name":"analysis","content":"..."}}',
        parameters: {
          name: { type: 'string', description: 'Scratchpad name (alphanumeric)', required: true },
          content: { type: 'string', description: 'Content to save', required: true },
        },
      },
      {
        name: 'read_scratchpad',
        description: 'Read previously saved scratchpad data by name. Format: {"tool":"read_scratchpad","params":{"name":"analysis"}}',
        parameters: {
          name: { type: 'string', description: 'Scratchpad name to read', required: true },
        },
      },

    ];
    return this._toolDefsCache;
  }

  // ─── Tool Execution Dispatch ──────────────────────────────────────────────

  async executeTool(toolName, params = {}) {
    const startTime = Date.now();
    let result;

    if (toolName && typeof toolName === 'string') {
      if (toolName.startsWith('browser_')) {
        params = this._normalizeBrowserParams(toolName, params);
      } else {
        params = this._normalizeFsParams(toolName, params);
      }
    }

    // Early-reject absolute paths that escape the project
    const FP_TOOLS = ['write_file', 'append_to_file', 'edit_file', 'delete_file', 'read_file', 'rename_file', 'get_file_info'];
    if (FP_TOOLS.includes(toolName) && params.filePath && path.isAbsolute(params.filePath) && this.projectPath) {
      const rn = path.resolve(params.filePath).replace(/\\/g, '/').toLowerCase();
      const pn = this.projectPath.replace(/\\/g, '/').toLowerCase();
      if (!rn.startsWith(pn)) {
        const sug = path.basename(params.filePath);
        console.log('[MCPToolServer] Absolute path outside project for ' + toolName + ': ' + params.filePath);
        return { success: false, error: 'Path outside project. Use relative path ' + JSON.stringify(sug) + ' instead of ' + JSON.stringify(params.filePath) + '.' };
      }
    }

    // Sanitize all file path params
    for (const key of ['filePath', 'dirPath', 'path', 'oldPath', 'newPath', 'source', 'destination', 'searchPath']) {
      if (params[key]) {
        params[key] = this._sanitizeFilePath(params[key]);
      }
    }

    // Permission gate for destructive operations
    if (this.onPermissionRequest && this._destructiveTools.has(toolName)) {
      const reason = `Tool "${toolName}" may modify or delete files/data.`;
      const allowed = await this.onPermissionRequest(toolName, params, reason);
      if (!allowed) {
        return { success: false, error: 'Operation denied by user', permissionDenied: true };
      }
    }

    try {
      switch (toolName) {
        case 'web_search':
          result = await this._webSearch(params.query, params.maxResults);
          break;
        case 'fetch_webpage':
          result = await this._fetchWebpage(params.url);
          break;
        case 'read_file':
          result = await this._readFile(params.filePath, params.startLine, params.endLine);
          break;
        case 'write_file':
          result = await this._writeFile(params.filePath, params.content);
          break;
        case 'search_codebase':
          result = await this._searchCodebase(params.query, params.maxResults);
          break;
        case 'run_command':
          result = await this._runCommand(params.command, params.cwd, params.timeout);
          break;
        case 'create_directory':
          result = await this._createDirectory(params.path);
          break;
        case 'list_directory':
          result = await this._listDirectory(params.dirPath, params.recursive);
          break;
        case 'find_files':
          result = await this._findFiles(params.pattern);
          break;
        case 'analyze_error':
          result = await this._analyzeError(params.errorMessage, params.stackTrace);
          break;
        // Browser tools (with timeout wrappers)
        case 'browser_navigate':
          result = await this._withTimeout(this._browserNavigate(params.url), 60000, 'browser_navigate');
          break;
        case 'browser_snapshot':
          result = await this._withTimeout(this._browserSnapshot(), 30000, 'browser_snapshot');
          break;
        case 'browser_click':
          result = await this._withTimeout(this._browserClick(params.ref, params), 30000, 'browser_click');
          break;
        case 'browser_type':
          result = await this._withTimeout(this._browserType(params.ref, params.text, params), 30000, 'browser_type');
          break;
        case 'browser_fill_form':
          result = await this._withTimeout(this._browserFillForm(params.fields), 30000, 'browser_fill_form');
          break;
        case 'browser_select_option':
          result = await this._withTimeout(this._browserSelectOption(params.ref, params.values), 30000, 'browser_select_option');
          break;
        case 'browser_screenshot':
          result = await this._withTimeout(this._browserScreenshot(params), 30000, 'browser_screenshot');
          break;
        case 'browser_get_content':
          result = await this._withTimeout(this._browserGetContent(params.selector, params.html), 30000, 'browser_get_content');
          break;
        case 'browser_evaluate':
          result = await this._withTimeout(this._browserEvaluate(params.code, params.ref), 30000, 'browser_evaluate');
          break;
        case 'browser_list_elements':
          result = await this._withTimeout(this._browserSnapshot(), 30000, 'browser_list_elements');
          break;
        case 'browser_wait_for_element':
          result = await this._withTimeout(this._browserWaitFor({ selector: params.selector, timeout: params.timeout }), 60000, 'browser_wait_for_element');
          break;
        case 'get_project_structure':
          result = await this._getProjectStructure();
          break;
        case 'browser_scroll':
          result = await this._withTimeout(this._browserScroll(params.direction, params.amount), 30000, 'browser_scroll');
          break;
        case 'browser_wait':
          result = await this._withTimeout(this._browserWait(params.ms), Math.min((params.ms || 5000) + 5000, 60000), 'browser_wait');
          break;
        case 'browser_wait_for':
          result = await this._withTimeout(this._browserWaitFor(params), 60000, 'browser_wait_for');
          break;
        case 'browser_back':
          result = await this._withTimeout(this._browserBack(), 30000, 'browser_back');
          break;
        case 'browser_press_key':
          result = await this._withTimeout(this._browserPressKey(params.key), 15000, 'browser_press_key');
          break;
        case 'browser_hover':
          result = await this._withTimeout(this._browserHover(params.ref), 15000, 'browser_hover');
          break;
        case 'browser_drag':
          result = await this._withTimeout(this._browserDrag(params.startRef, params.endRef), 30000, 'browser_drag');
          break;
        case 'browser_tabs':
          result = await this._withTimeout(this._browserTabs(params.action, params.index), 15000, 'browser_tabs');
          break;
        case 'browser_handle_dialog':
          result = await this._withTimeout(this._browserHandleDialog(params.accept, params.promptText), 15000, 'browser_handle_dialog');
          break;
        case 'browser_console_messages':
          result = await this._withTimeout(this._browserConsoleMessages(params.level), 15000, 'browser_console_messages');
          break;
        case 'browser_file_upload':
          result = await this._withTimeout(this._browserFileUpload(params.ref, params.paths), 30000, 'browser_file_upload');
          break;
        case 'browser_resize':
          result = await this._withTimeout(this._browserResize(params.width, params.height), 15000, 'browser_resize');
          break;
        case 'browser_get_url':
          result = await this._withTimeout(this._browserGetUrl(), 15000, 'browser_get_url');
          break;
        case 'browser_get_links':
          result = await this._withTimeout(this._browserGetLinks(params.selector), 30000, 'browser_get_links');
          break;
        case 'browser_close':
          result = await this._withTimeout(this._browserClose(), 15000, 'browser_close');
          break;
        case 'browser_select':
          result = await this._withTimeout(this._browserSelectOption(params.ref || params.selector, params.value ? [params.value] : []), 30000, 'browser_select');
          break;
        // Memory tools
        case 'save_memory':
          result = await this._saveMemory(params.key, params.value);
          break;
        case 'get_memory':
          result = await this._getMemory(params.key);
          break;
        case 'list_memories':
          result = await this._listMemories();
          break;
        // File ops
        case 'delete_file':
          result = await this._deleteFile(params.filePath);
          break;
        case 'rename_file':
          result = await this._renameFile(params.oldPath, params.newPath);
          break;
        case 'edit_file':
          result = await this._editFile(params.filePath, params.oldText, params.newText);
          break;
        case 'get_file_info':
          result = await this._getFileInfo(params.filePath);
          break;
        // Git tools
        case 'git_status':
          result = await this._gitStatus();
          break;
        case 'git_commit':
          result = await this._gitCommit(params.message);
          break;
        case 'git_diff':
          result = await this._gitDiff(params.filePath);
          break;
        case 'git_log':
          result = await this._gitLog(params.maxCount, params.filePath);
          break;
        case 'git_branch':
          result = await this._gitBranch(params.action, params.name);
          break;
        case 'git_stash':
          result = await this._gitStash(params.action, params.message);
          break;
        case 'git_reset':
          result = await this._gitReset(params.filePath, params.hard);
          break;
        // Search
        case 'grep_search':
          result = await this._grepSearch(params.pattern, params.filePattern, params.isRegex, params.maxResults);
          break;
        case 'search_in_file':
          result = await this._searchInFile(params.filePath, params.pattern, params.isRegex);
          break;
        // File ops continued
        case 'copy_file':
          result = await this._copyFile(params.source, params.destination);
          break;
        case 'append_to_file':
          result = await this._appendToFile(params.filePath, params.content);
          break;
        case 'diff_files':
          result = await this._diffFiles(params.fileA, params.fileB);
          break;
        // Network
        case 'http_request':
          result = await this._httpRequest(params.url, params.method, params.headers, params.body);
          break;
        case 'check_port':
          result = await this._checkPort(params.port);
          break;
        case 'install_packages':
          result = await this._installPackages(params.packages, params.manager);
          break;
        // Undo
        case 'undo_edit':
          if (params.all) {
            result = await this.undoAllFileChanges();
          } else if (params.filePath) {
            result = await this.undoFileChange(params.filePath.includes(path.sep) ? params.filePath : path.join(this.projectPath || '', params.filePath));
          } else {
            result = { success: false, error: 'Provide filePath or set all=true. Use list_undoable to see available files.' };
          }
          break;
        case 'list_undoable':
          result = { success: true, files: await this.getUndoableFiles() };
          break;
        case 'replace_in_files':
          result = await this._replaceInFiles(params.searchText, params.replaceText, params.path, params.isRegex);
          break;
        case 'open_file_in_editor':
          result = await this._openFileInEditor(params.filePath);
          break;
        case 'generate_image':
          result = await this._generateImage(params.prompt, params.width, params.height, params.savePath);
          break;
        // TODO tools
        case 'write_todos':
          result = this._writeTodos(params);
          break;
        case 'update_todo':
          result = this._updateTodo(params);
          break;
        // Scratchpad
        case 'write_scratchpad':
          result = this._writeScratchpad(params);
          break;
        case 'read_scratchpad':
          result = this._readScratchpad(params);
          break;
        default:
          result = { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      result = { success: false, error: error.message };
    }

    // Truncate oversized results (50KB cap)
    if (result && typeof result === 'object') {
      const resultStr = JSON.stringify(result);
      if (resultStr.length > 50000) {
        const truncKeys = ['output', 'content', 'body', 'data', 'stdout', 'message', 'text', 'html'];
        for (const key of truncKeys) {
          if (result[key] && typeof result[key] === 'string' && result[key].length > 40000) {
            result[key] = result[key].substring(0, 40000) + '\n... [truncated, total ' + result[key].length + ' chars]';
            break;
          }
        }
      }
    }

    // Record in history
    const entry = {
      tool: toolName,
      params,
      result: typeof result === 'object' ? result : { data: result },
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    };
    this.toolHistory.push(entry);
    if (this.toolHistory.length > this.maxHistory) {
      this.toolHistory.shift();
    }

    return result;
  }

  // ─── Backup & Undo System ────────────────────────────────────────────────

  _setFileBackup(filePath, backup) {
    this._fileBackups.set(filePath, backup);
    if (this._currentTurnId && !this._currentTurnCapture.has(filePath)) {
      this._currentTurnCapture.set(filePath, { original: backup.original, isNew: backup.isNew });
    }
    if (this._fileBackups.size > this._maxFileBackups) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [key, val] of this._fileBackups) {
        if (val.timestamp < oldestTime) { oldestTime = val.timestamp; oldestKey = key; }
      }
      if (oldestKey) this._fileBackups.delete(oldestKey);
    }
  }

  async getUndoableFiles() {
    const files = [];
    for (const [filePath, backup] of this._fileBackups) {
      const originalLines = backup.isNew ? 0 : (backup.original || '').split('\n').length;
      let currentLines = 0;
      try {
        const currentContent = await fs.readFile(filePath, 'utf8');
        currentLines = currentContent.split('\n').length;
      } catch {
        currentLines = 0;
      }
      files.push({
        filePath,
        fileName: path.basename(filePath),
        timestamp: backup.timestamp,
        tool: backup.tool,
        isNew: backup.isNew,
        linesAdded: Math.max(0, currentLines - originalLines),
        linesRemoved: Math.max(0, originalLines - currentLines),
      });
    }
    return files;
  }

  async undoFileChange(filePath) {
    const backup = this._fileBackups.get(filePath);
    if (!backup) return { success: false, error: 'No backup found for this file' };
    try {
      if (backup.isNew) {
        await fs.unlink(filePath);
      } else {
        await fs.writeFile(filePath, backup.original, 'utf8');
      }
      this._fileBackups.delete(filePath);
      return { success: true, action: backup.isNew ? 'deleted' : 'restored', filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async undoAllFileChanges() {
    const results = [];
    for (const [filePath] of this._fileBackups) {
      results.push(await this.undoFileChange(filePath));
    }
    return results;
  }

  acceptFileChanges(filePaths) {
    if (!filePaths || filePaths.length === 0) {
      this._fileBackups.clear();
      return { success: true, cleared: 'all' };
    }
    for (const fp of filePaths) {
      this._fileBackups.delete(fp);
    }
    return { success: true, cleared: filePaths.length };
  }

  // ─── Checkpoint System ───────────────────────────────────────────────────

  startTurn(turnId) {
    this._currentTurnId = turnId;
    this._currentTurnCapture = new Map();
  }

  finalizeCurrentTurn(userMessage) {
    if (!this._currentTurnId || this._currentTurnCapture.size === 0) {
      this._currentTurnId = null;
      return null;
    }
    const files = [];
    for (const [filePath, data] of this._currentTurnCapture) {
      files.push({ filePath, fileName: path.basename(filePath), isNew: data.isNew, original: data.original });
    }
    const snapshot = {
      turnId: this._currentTurnId,
      timestamp: Date.now(),
      userMessage: (userMessage || '').substring(0, 100),
      files,
    };
    this._turnSnapshots.push(snapshot);
    if (this._turnSnapshots.length > this._maxTurnSnapshots) this._turnSnapshots.shift();
    this._currentTurnId = null;
    return snapshot;
  }

  getCheckpointList() {
    return this._turnSnapshots.map(s => ({
      turnId: s.turnId,
      timestamp: s.timestamp,
      userMessage: s.userMessage,
      files: s.files.map(f => ({ filePath: f.filePath, fileName: f.fileName, isNew: f.isNew })),
    }));
  }

  async restoreCheckpoint(turnId) {
    const snapshot = this._turnSnapshots.find(s => s.turnId === turnId);
    if (!snapshot) return { success: false, error: 'Checkpoint not found' };
    const results = [];
    for (const file of snapshot.files) {
      try {
        if (file.isNew) {
          try { await fs.unlink(file.filePath); } catch (_) {}
          results.push({ filePath: file.filePath, action: 'deleted' });
        } else {
          await fs.writeFile(file.filePath, file.original, 'utf8');
          results.push({ filePath: file.filePath, action: 'restored' });
        }
      } catch (err) {
        results.push({ filePath: file.filePath, action: 'failed', error: err.message });
      }
    }
    const idx = this._turnSnapshots.findIndex(s => s.turnId === turnId);
    if (idx !== -1) this._turnSnapshots.splice(idx);
    return { success: true, results, restoredCount: results.filter(r => r.action !== 'failed').length };
  }

  // ─── Tool Implementations ────────────────────────────────────────────────

  async _webSearch(query, maxResults = 5) {
    if (!this.webSearch) return { success: false, error: 'Web search not available' };
    const raw = await this.webSearch.search(query, maxResults);
    if (raw && raw.error) return { success: false, error: raw.error };
    const results = Array.isArray(raw) ? raw : (raw?.results || []);
    if (results.length === 0) return { success: false, error: 'No results found' };
    return { success: true, results };
  }

  async _fetchWebpage(url) {
    if (!this.webSearch) return { success: false, error: 'Web fetch not available' };
    return this.webSearch.fetchPage(url);
  }

  async _readFile(filePath, startLine, endLine) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath || '', filePath);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.size > 10 * 1024 * 1024) {
        return { success: false, error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Max 10MB for read_file.` };
      }
      let content = await fs.readFile(fullPath, 'utf8');
      const totalLines = content.split('\n').length;

      if (startLine || endLine) {
        const lines = content.split('\n');
        const start = Math.max(0, (startLine || 1) - 1);
        const end = Math.min(lines.length, endLine || lines.length);
        content = lines.slice(start, end).join('\n');
        return { success: true, content, path: fullPath, totalLines, readRange: `${start + 1}-${end}` };
      }

      return { success: true, content, path: fullPath, totalLines };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _writeFile(filePath, content) {
    if (!this.projectPath) {
      return {
        success: false,
        error: 'No project folder is open. Please open a folder first (File > Open Folder or Ctrl+K Ctrl+O), then retry. The file was not written.',
      };
    }
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath, filePath);
    try {
      let isNew = true;
      let existingContent = null;
      try {
        existingContent = await fs.readFile(fullPath, 'utf8');
        this._setFileBackup(fullPath, { original: existingContent, timestamp: Date.now(), tool: 'write_file', isNew: false });
        isNew = false;
      } catch {
        this._setFileBackup(fullPath, { original: null, timestamp: Date.now(), tool: 'write_file', isNew: true });
      }

      // Overwrite protection — disk check: if file exists on disk with content,
      // block writes that would produce a shorter file (any length reduction = data loss).
      if (!isNew && existingContent && existingContent.length > 200) {
        const newLen = (content || '').length;
        if (newLen < existingContent.length) {
          const existingLines = existingContent.split('\n').length;
          const newLines = (content || '').split('\n').length;
          console.log(`[MCP] Overwrite blocked — "${filePath}" has ${existingLines} lines (${existingContent.length} chars) but write_file called with only ${newLines} lines (${newLen} chars)`);
          return {
            success: false,
            error: `BLOCKED: File "${filePath}" already has ${existingLines} lines (${existingContent.length} chars). Your write_file call contains only ${newLines} lines (${newLen} chars) which would reduce the file. Use append_to_file to add content, or edit_file to modify specific sections.`,
            existingLines,
            existingChars: existingContent.length,
          };
        }
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      // Defensive unescape: if content has no real newlines but has literal \n sequences,
      // the model double-escaped during JSON generation. Convert to real newlines.
      if (typeof content === 'string' && !content.includes('\n') && content.includes('\\n')) {
        content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
      }
      await fs.writeFile(fullPath, content, 'utf8');

      if (this.browserManager?.parentWindow) {
        this.browserManager.parentWindow.webContents.send('files-changed');
        this.browserManager.parentWindow.webContents.send('agent-file-modified', {
          filePath: fullPath,
          newContent: content,
          isNew,
          tool: 'write_file',
        });
      }

      return { success: true, path: fullPath, isNew };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _editFile(filePath, oldText, newText) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath || '', filePath);
    try {
      let content = await fs.readFile(fullPath, 'utf8');
      const originalContent = content;

      const normLF = s => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const trimLines = s => s.split('\n').map(l => l.trimEnd()).join('\n');
      const collapseWS = s => s.replace(/\s+/g, ' ').trim();
      let matched = false;

      if (content.includes(oldText)) {
        matched = true;
      } else if (normLF(content).includes(normLF(oldText))) {
        content = normLF(content);
        oldText = normLF(oldText);
        matched = true;
      } else if (trimLines(normLF(content)).includes(trimLines(normLF(oldText)))) {
        content = trimLines(normLF(content));
        oldText = trimLines(normLF(oldText));
        matched = true;
      } else {
        const contentNorm = normLF(content);
        const oldNorm = normLF(oldText);
        const contentCollapsed = collapseWS(contentNorm);
        const oldCollapsed = collapseWS(oldNorm);
        if (contentCollapsed.includes(oldCollapsed) && oldCollapsed.length >= 20) {
          const lines = contentNorm.split('\n');
          let accumulated = '';
          let startLine = -1, endLine = -1;
          for (let i = 0; i < lines.length; i++) {
            accumulated += (accumulated ? ' ' : '') + lines[i].trim();
            if (startLine < 0 && accumulated.includes(oldCollapsed)) {
              endLine = i;
              let charCount = 0;
              for (let j = i; j >= 0; j--) {
                charCount += lines[j].trim().length + (j < i ? 1 : 0);
                if (charCount >= oldCollapsed.length) {
                  startLine = j;
                  break;
                }
              }
              break;
            }
          }
          if (startLine >= 0 && endLine >= 0) {
            const before = lines.slice(0, startLine).join('\n');
            const after = lines.slice(endLine + 1).join('\n');
            content = before + (before ? '\n' : '') + newText + (after ? '\n' : '') + after;
            matched = true;
            console.log(`[MCPToolServer] edit_file: whitespace-collapsed match at lines ${startLine + 1}-${endLine + 1}`);
          }
        }
      }

      if (!matched) {
        const contentLines = normLF(content).split('\n');
        const oldLines = normLF(oldText).split('\n');
        const firstOldLine = oldLines[0].trim();
        let closestLine = -1, closestSim = 0;
        for (let i = 0; i < contentLines.length; i++) {
          const trimmed = contentLines[i].trim();
          if (trimmed === firstOldLine) { closestLine = i + 1; closestSim = 1; break; }
          if (firstOldLine.length > 5) {
            const shorter = Math.min(trimmed.length, firstOldLine.length);
            const longer = Math.max(trimmed.length, firstOldLine.length);
            if (shorter > 0 && longer > 0) {
              let m = 0;
              for (let j = 0; j < shorter; j++) { if (trimmed[j] === firstOldLine[j]) m++; }
              const sim = m / longer;
              if (sim > closestSim) { closestSim = sim; closestLine = i + 1; }
            }
          }
        }
        let hint = 'oldText not found in file.';
        if (closestLine > 0 && closestSim > 0.5) {
          const start = Math.max(0, closestLine - 4);
          const end = Math.min(contentLines.length, closestLine + oldLines.length + 3);
          const ctx = contentLines.slice(start, end).map((l, i) => `${start + i + 1}| ${l}`).join('\n');
          hint += ` Closest match at line ${closestLine}.\nRelevant section (lines ${start + 1}-${end}):\n${ctx}`;
        } else {
          const identifiers = oldText.match(/[a-zA-Z_$][a-zA-Z0-9_$]{3,}/g) || [];
          const uniqueIds = [...new Set(identifiers)].slice(0, 5);
          const foundLines = [];
          for (const id of uniqueIds) {
            for (let i = 0; i < contentLines.length; i++) {
              if (contentLines[i].includes(id) && !foundLines.some(f => f.line === i + 1)) {
                foundLines.push({ line: i + 1, text: contentLines[i].substring(0, 120), keyword: id });
              }
            }
          }
          if (foundLines.length > 0) {
            hint += '\nKeyword matches in file:';
            for (const f of foundLines.slice(0, 8)) {
              hint += `\n  Line ${f.line} (${f.keyword}): ${f.text}`;
            }
          } else {
            hint += '\nNone of the identifiers in your oldText exist in the file. The code may not have been written yet, or was already changed.';
          }
        }
        hint += '\nCopy oldText EXACTLY from the lines above — do not retype.';
        return { success: false, error: hint };
      }

      if (!this._fileBackups.has(fullPath)) {
        this._setFileBackup(fullPath, { original: originalContent, timestamp: Date.now(), tool: 'edit_file', isNew: false });
      }
      let totalOccurrences = 0;
      if (content.includes(oldText)) {
        totalOccurrences = (content.split(oldText).length - 1);
        content = content.replace(oldText, newText);
      }
      await fs.writeFile(fullPath, content, 'utf8');

      if (this.browserManager?.parentWindow) {
        this.browserManager.parentWindow.webContents.send('files-changed');
        this.browserManager.parentWindow.webContents.send('agent-file-modified', {
          filePath: fullPath,
          newContent: content,
          originalContent,
          isNew: false,
          tool: 'edit_file',
        });
      }

      const editMsg = totalOccurrences > 1
        ? `Edited ${path.basename(fullPath)}: replaced 1 of ${totalOccurrences} occurrences (use replace_in_files for bulk replace)`
        : `Edited ${path.basename(fullPath)}: 1 replacement made`;
      return { success: true, path: fullPath, message: editMsg, replacements: 1 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _deleteFile(filePath) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath || '', filePath);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        // Recursively delete directory
        await fs.rm(fullPath, { recursive: true, force: true });
        return { success: true, path: fullPath, message: `Directory deleted: ${fullPath}` };
      } else {
        await fs.unlink(fullPath);
        return { success: true, path: fullPath, message: `File deleted: ${fullPath}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _renameFile(oldPath, newPath) {
    const fullOld = path.isAbsolute(oldPath) ? oldPath : path.join(this.projectPath || '', oldPath);
    const fullNew = path.isAbsolute(newPath) ? newPath : path.join(this.projectPath || '', newPath);
    try {
      await fs.mkdir(path.dirname(fullNew), { recursive: true });
      await fs.rename(fullOld, fullNew);
      return { success: true, oldPath: fullOld, newPath: fullNew, message: `Renamed: ${path.basename(fullOld)} → ${path.basename(fullNew)}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _getFileInfo(filePath) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath || '', filePath);
    try {
      const stats = await fs.stat(fullPath);
      return {
        success: true,
        path: fullPath,
        name: path.basename(fullPath),
        extension: path.extname(fullPath),
        size: stats.size,
        sizeFormatted: stats.size < 1024 ? `${stats.size}B` : stats.size < 1048576 ? `${(stats.size / 1024).toFixed(1)}KB` : `${(stats.size / 1048576).toFixed(1)}MB`,
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString(),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _createDirectory(dirPath) {
    if (!this.projectPath) {
      return { success: false, error: 'No project folder is open. Please open a folder first.' };
    }
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(this.projectPath, dirPath);
    try {
      await fs.mkdir(fullPath, { recursive: true });
      if (this.browserManager?.parentWindow) {
        this.browserManager.parentWindow.webContents.send('files-changed');
      }
      return { success: true, path: fullPath, message: `Directory created: ${fullPath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _searchCodebase(query, maxResults = 10) {
    if (!this.ragEngine) return { success: false, error: 'RAG engine not available' };
    const results = this.ragEngine.search(query, maxResults);
    return {
      success: true,
      results: results.map(r => ({
        file: r.relativePath,
        startLine: r.startLine + 1,
        endLine: r.endLine,
        score: r.score.toFixed(3),
        preview: r.content.substring(0, 300),
      })),
    };
  }

  async _runCommand(command, cwd, timeout) {
    const dangerousPatterns = [
      /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*\s+(\/|~|\$HOME|C:\\|%USERPROFILE%)/i,
      /\bformat\s+[A-Z]:/i,
      /\bmkfs\b/i,
      /\bshutdown\b/i,
      /\breboot\b/i,
      /\bpoweroff\b/i,
      /:\(\)\s*\{\s*:\|:\s*&\s*\}/,
      /\bdd\s+.*of=\/dev\//i,
      /\bcurl\b.*\|\s*(ba)?sh/i,
      /\bwget\b.*\|\s*(ba)?sh/i,
      /\bdel\s+(\/[sS]\s+)*[A-Z]:\\/i,
    ];
    const cmdStr = (command || '').trim();
    for (const pat of dangerousPatterns) {
      if (pat.test(cmdStr)) {
        console.log(`[MCPToolServer] Blocked dangerous command: "${cmdStr.substring(0, 80)}"`);
        return { success: false, error: 'Command blocked: matches dangerous pattern. This command could cause irreversible damage.' };
      }
    }

    let workDir = this.projectPath || process.cwd();
    if (cwd) {
      // Validate cwd parameter
      const cwdStr = String(cwd).trim();
      
      // Block obvious invalid values (wildcards, single chars, empty after trim)
      if (!cwdStr || cwdStr === '*' || cwdStr === '?' || /^[*?]+$/.test(cwdStr)) {
        console.log(`[MCPToolServer] Blocked invalid cwd "${cwd}"`);
        return { success: false, error: `Invalid cwd parameter: "${cwd}". Use a valid directory path or omit cwd to use project root.` };
      }
      
      if (path.isAbsolute(cwdStr)) {
        const cwdNorm = cwdStr.replace(/\\/g, '/').toLowerCase();
        const projNorm = (this.projectPath || '').replace(/\\/g, '/').toLowerCase();
        if (projNorm && cwdNorm.startsWith(projNorm)) {
          workDir = cwdStr;
        } else {
          console.log(`[MCPToolServer] Ignoring hallucinated cwd "${cwd}", using project path`);
        }
      } else {
        // Relative path — resolve relative to project
        const resolved = path.resolve(this.projectPath || process.cwd(), cwdStr);
        const resolvedNorm = resolved.replace(/\\/g, '/').toLowerCase();
        const projNorm = (this.projectPath || '').replace(/\\/g, '/').toLowerCase();
        if (projNorm && resolvedNorm.startsWith(projNorm)) {
          // Check if directory exists
          try {
            const stats = fsSync.statSync(resolved);
            if (stats.isDirectory()) {
              workDir = resolved;
            } else {
              console.log(`[MCPToolServer] cwd "${cwd}" is not a directory, using project path`);
            }
          } catch (e) {
            console.log(`[MCPToolServer] cwd "${cwd}" does not exist, using project path`);
          }
        } else {
          console.log(`[MCPToolServer] Ignoring cwd "${cwd}" — resolves outside project`);
        }
      }
    }
    const timeoutMs = Math.min(Math.max(timeout || 60000, 5000), 300000);
    return new Promise((resolve) => {
      // Use PowerShell on Windows to support PowerShell cmdlets (Get-ChildItem, etc.)
      const isWindows = process.platform === 'win32';
      const finalCommand = isWindows
        ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '\"')}"`
        : command;
      exec(finalCommand, { cwd: workDir, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 5, shell: isWindows ? undefined : '/bin/bash' }, (error, stdout, stderr) => {
        const output = (stdout?.toString() || '') + (stderr?.toString() || '');
        resolve({
          success: !error,
          output: output.trim() || (error ? error.message : 'Command completed'),
          message: output.trim() || (error ? error.message : 'Command completed successfully'),
          stdout: stdout?.toString() || '',
          stderr: stderr?.toString() || '',
          exitCode: error?.code || 0,
        });
      });
    });
  }

  async _listDirectory(dirPath, recursive = false) {
    const resolvedDir = dirPath || this.projectPath || '.';
    const fullPath = path.isAbsolute(resolvedDir) ? resolvedDir : path.join(this.projectPath || '', resolvedDir);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: path.join(fullPath, e.name),
        }));

      if (recursive) {
        for (const item of [...items]) {
          if (item.type === 'directory') {
            const subResult = await this._listDirectory(item.path, true);
            if (subResult.success) {
              items.push(...subResult.items.map(sub => ({
                ...sub,
                name: path.join(item.name, sub.name),
              })));
            }
          }
        }
      }

      return { success: true, items };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _findFiles(pattern) {
    if (this.ragEngine) {
      const results = this.ragEngine.searchFiles(pattern, 20);
      return { success: true, files: results };
    }
    const safePattern = this._sanitizeShellArg(pattern);
    return this._runCommand(
      process.platform === 'win32'
        ? `dir /s /b "*${safePattern}*" 2>nul`
        : `find . -name "*${safePattern}*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null`,
      this.projectPath
    );
  }

  async _analyzeError(errorMessage, stackTrace) {
    if (!this.ragEngine) return { success: false, error: 'RAG engine not available' };
    return {
      success: true,
      analysis: this.ragEngine.findErrorContext(errorMessage, stackTrace || ''),
    };
  }

  // ─── Browser Automation Setters ──────────────────────────────────────────

  setBrowserManager(browserManager) { this.browserManager = browserManager; }
  setPlaywrightBrowser(playwrightBrowser) { this.playwrightBrowser = playwrightBrowser; }
  setGitManager(gitManager) { this.gitManager = gitManager; }
  setImageGen(imageGen) { this.imageGen = imageGen; }

  _getBrowser() {
    return this.playwrightBrowser || this.browserManager;
  }

  // Browser tools: _browserNavigate through _browserClose → tools/mcpBrowserTools.js
  // Git tools: _gitStatus through _gitReset → tools/mcpGitTools.js

  // ─── Image Generation ────────────────────────────────────────────────────

  async _generateImage(prompt, width, height, savePath) {
    if (!prompt) return { success: false, error: 'No prompt provided' };
    if (!this.imageGen) return { success: false, error: 'Image generation service not available' };
    try {
      const result = await this.imageGen.generate(prompt.substring(0, 2000), {
        width: width || 1024,
        height: height || 1024,
      });
      if (!result.success) {
        return { success: false, error: result.error || 'Image generation failed' };
      }
      if (savePath) {
        const fullPath = path.isAbsolute(savePath) ? savePath : path.join(this.projectPath || '', savePath);
        const fsSync = require('fs');
        const dir = path.dirname(fullPath);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        fsSync.writeFileSync(fullPath, Buffer.from(result.imageBase64, 'base64'));
        return {
          success: true,
          message: `Image generated and saved to ${fullPath}`,
          filePath: fullPath,
          provider: result.provider,
          model: result.model,
          mimeType: result.mimeType,
          sizeKB: Math.round(result.imageBase64.length * 0.75 / 1024),
        };
      }
      return {
        success: true,
        message: `Image generated via ${result.provider} (${result.model})`,
        imageBase64: result.imageBase64,
        mimeType: result.mimeType,
        provider: result.provider,
        model: result.model,
        sizeKB: Math.round(result.imageBase64.length * 0.75 / 1024),
      };
    } catch (err) {
      return { success: false, error: `Image generation failed: ${err.message}` };
    }
  }

  // ─── Search Tools ────────────────────────────────────────────────────────

  async _grepSearch(pattern, filePattern, isRegex = false, maxResults = 50) {
    const cwd = this.projectPath;
    if (!cwd) return { success: false, error: 'No project opened' };
    const cap = Math.min(Math.max(maxResults || 50, 1), 200);

    if (this.ragEngine && this.ragEngine._fileCache) {
      const results = [];
      const regex = isRegex ? new RegExp(pattern, 'gi') : null;
      for (const [relPath, fileData] of Object.entries(this.ragEngine._fileCache)) {
        if (filePattern) {
          const globRegex = new RegExp('^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
          if (!globRegex.test(relPath)) continue;
        }
        const content = typeof fileData === 'string' ? fileData : fileData?.content;
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const matches = regex ? regex.test(line) : line.includes(pattern);
          if (regex) regex.lastIndex = 0;
          if (matches) {
            results.push({ file: relPath, line: i + 1, text: line.trim().substring(0, 200) });
            if (results.length >= cap) break;
          }
        }
        if (results.length >= cap) break;
      }
      return { success: true, results, total: results.length, pattern };
    }

    const isWin = process.platform === 'win32';
    const safePattern = this._sanitizeShellArg(pattern);
    const safeFilePattern = filePattern ? this._sanitizeShellArg(filePattern) : '';
    let cmd;
    if (isWin) {
      const fileFilter = safeFilePattern ? `/include:"${safeFilePattern}"` : '';
      cmd = isRegex
        ? `findstr /S /N /R ${fileFilter} "${safePattern}" *`
        : `findstr /S /N /I ${fileFilter} "${safePattern}" *`;
    } else {
      const fileFilter = safeFilePattern ? `--include="${safeFilePattern}"` : '';
      cmd = isRegex
        ? `grep -rn ${fileFilter} -E "${safePattern}" . --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -${cap}`
        : `grep -rn ${fileFilter} -i "${safePattern}" . --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -${cap}`;
    }
    const result = await this._runCommand(cmd, cwd, 30000);
    const lines = (result.stdout || '').trim().split('\n').filter(Boolean).slice(0, cap);
    const matches = lines.map(l => {
      const colonIdx = l.indexOf(':');
      const secondColon = l.indexOf(':', colonIdx + 1);
      if (secondColon > colonIdx) {
        return { file: l.substring(0, colonIdx), line: parseInt(l.substring(colonIdx + 1, secondColon)) || 0, text: l.substring(secondColon + 1).trim().substring(0, 200) };
      }
      return { file: '', line: 0, text: l.substring(0, 200) };
    });
    return { success: true, results: matches, total: matches.length, pattern };
  }

  async _searchInFile(filePath, pattern, isRegex = false) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath || '', filePath);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      const regex = isRegex ? new RegExp(pattern, 'gi') : null;
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const found = regex ? regex.test(line) : line.includes(pattern);
        if (regex) regex.lastIndex = 0;
        if (found) {
          matches.push({ line: i + 1, text: line.trim().substring(0, 300) });
        }
      }
      return { success: true, file: fullPath, matches, total: matches.length, pattern };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── Copy / Append / Diff ────────────────────────────────────────────────

  async _copyFile(source, destination) {
    const fullSrc = path.isAbsolute(source) ? source : path.join(this.projectPath || '', source);
    const fullDst = path.isAbsolute(destination) ? destination : path.join(this.projectPath || '', destination);
    try {
      await fs.mkdir(path.dirname(fullDst), { recursive: true });
      const stats = await fs.stat(fullSrc);
      if (stats.isDirectory()) {
        await this._copyDirRecursive(fullSrc, fullDst);
      } else {
        await fs.copyFile(fullSrc, fullDst);
      }
      return { success: true, source: fullSrc, destination: fullDst, message: `Copied to ${fullDst}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _copyDirRecursive(src, dst) {
    await fs.mkdir(dst, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        await this._copyDirRecursive(srcPath, dstPath);
      } else {
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }

  /**
   * Extract genuinely new content from a write_file call by comparing against existing file.
   * Handles three cases:
   * 1. Leading overlap — model regenerates from start + adds new lines at end
   * 2. Trailing overlap — new content's beginning matches the end of existing file (continuation pattern)
   * 3. No overlap but new content is longer — model rewrote the file with additions
   * Returns { newContent, overlapLines } or null if nothing new to append.
   */
  _extractNewContentForAutoConvert(existingContent, newContent) {
    const el = existingContent.split('\n');
    const nl = newContent.split('\n');

    // Case 1: Leading overlap — lines match from the start (model regenerated full file)
    let leadingOverlap = 0;
    for (let i = 0; i < Math.min(el.length, nl.length); i++) {
      if (el[i].trimEnd() === nl[i].trimEnd()) leadingOverlap++;
      else break;
    }
    if (leadingOverlap > 3 && nl.length > leadingOverlap) {
      const suffix = nl.slice(leadingOverlap).join('\n');
      if (suffix.trim().length > 20) {
        return { newContent: suffix, overlapLines: leadingOverlap, method: 'leading' };
      }
    }

    // Case 2: Trailing overlap — end of existing file matches start of new content
    // The model may be continuing where it left off but wrapping it in write_file instead of append_to_file
    const tailCheck = Math.min(el.length, 30); // Check last 30 lines of existing
    for (let tailSize = tailCheck; tailSize >= 3; tailSize--) {
      const existingTail = el.slice(el.length - tailSize);
      // Check if new content starts with this tail
      let match = true;
      for (let j = 0; j < tailSize && j < nl.length; j++) {
        if (existingTail[j].trimEnd() !== nl[j].trimEnd()) { match = false; break; }
      }
      if (match && tailSize <= nl.length) {
        const suffix = nl.slice(tailSize).join('\n');
        if (suffix.trim().length > 20) {
          return { newContent: suffix, overlapLines: tailSize, method: 'trailing' };
        }
      }
    }

    // Case 3: No line-level overlap but content is substantially longer — likely a full rewrite
    // with new sections appended. Use character-level comparison of the last chunk of existing content.
    if (nl.length > el.length && leadingOverlap > el.length * 0.3) {
      // Partial leading overlap (>30%) — the model mostly regenerated but diverged at some point
      // Find the divergence point and take everything after it
      const suffix = nl.slice(leadingOverlap).join('\n');
      if (suffix.trim().length > 20) {
        return { newContent: suffix, overlapLines: leadingOverlap, method: 'partial-leading' };
      }
    }

    return null;
  }

  async _appendToFile(filePath, content) {
    if (!this.projectPath) {
      return { success: false, error: 'No project folder is open. Please open a folder first.' };
    }
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath, filePath);

    // Reject empty content — the model called append but didn't provide code.
    // Include the file's last lines so the model knows where to continue from.
    if (!content || !content.trim()) {
      let tailHint = '';
      let existingFullContent = '';
      try {
        existingFullContent = await fs.readFile(fullPath, 'utf8');
        const lines = existingFullContent.split('\n');
        const last15 = lines.slice(-15).join('\n');
        tailHint = ` The file currently has ${lines.length} lines. Here are the last 15 lines — continue from here:\n${last15}`;
      } catch {}
      return { success: false, error: `Content is empty. You must provide actual code content to append.${tailHint}`, fullContent: existingFullContent || undefined, path: fullPath };
    }

    try {
      let isNew = true;
      try {
        const existingContent = await fs.readFile(fullPath, 'utf8');
        this._setFileBackup(fullPath, { original: existingContent, timestamp: Date.now(), tool: 'append_to_file', isNew: false });
        isNew = false;
      } catch {
        this._setFileBackup(fullPath, { original: null, timestamp: Date.now(), tool: 'append_to_file', isNew: true });
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      // Defensive unescape: if content has no real newlines but has literal \n sequences,
      // the model double-escaped during JSON generation. Convert to real newlines.
      if (typeof content === 'string' && !content.includes('\n') && content.includes('\\n')) {
        content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
      }

      // Smart insert for HTML files: if file already ends with </html>, insert new content
      // BEFORE the closing tag instead of appending after it (BUG 6 — content after </html>).
      let didSmartInsert = false;
      const ext = (path.extname(fullPath) || '').toLowerCase();
      if (/\.html?$/.test(ext)) {
        try {
          const existingContent = await fs.readFile(fullPath, 'utf8');
          const htmlCloseMatch = existingContent.match(/([\s\S]*?)(<\/html\s*>\s*)$/i);
          if (htmlCloseMatch) {
            // File ends with </html> — insert new content before the closing tag
            const beforeClose = htmlCloseMatch[1];
            const closeTag = htmlCloseMatch[2];
            // Only do smart insert if the new content doesn't itself contain </html>
            if (!/<\/html\s*>/i.test(content)) {
              const merged = beforeClose + content + closeTag;
              await fs.writeFile(fullPath, merged, 'utf8');
              didSmartInsert = true;
              console.log(`[MCP] Smart HTML insert: placed ${content.length} chars before </html> in ${path.basename(fullPath)}`);
            }
          }
        } catch {}
      }

      if (!didSmartInsert) {
        await fs.appendFile(fullPath, content, 'utf8');
      }

      let fullContent = content;
      try { fullContent = await fs.readFile(fullPath, 'utf8'); } catch {}

      if (this.browserManager?.parentWindow) {
        this.browserManager.parentWindow.webContents.send('files-changed');
        this.browserManager.parentWindow.webContents.send('agent-file-modified', {
          filePath: fullPath,
          newContent: fullContent,
          isNew,
          tool: 'append_to_file',
        });
      }

      return { success: true, path: fullPath, isNew, message: `Appended ${content.length} chars to ${path.basename(fullPath)}`, fullContent };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _diffFiles(fileA, fileB) {
    const fullA = path.isAbsolute(fileA) ? fileA : path.join(this.projectPath || '', fileA);
    const fullB = path.isAbsolute(fileB) ? fileB : path.join(this.projectPath || '', fileB);
    try {
      const contentA = await fs.readFile(fullA, 'utf8');
      const contentB = await fs.readFile(fullB, 'utf8');
      const linesA = contentA.split('\n');
      const linesB = contentB.split('\n');
      const diffs = [];
      const maxLen = Math.max(linesA.length, linesB.length);
      for (let i = 0; i < maxLen; i++) {
        const a = linesA[i];
        const b = linesB[i];
        if (a === undefined) {
          diffs.push({ line: i + 1, type: 'added', text: b });
        } else if (b === undefined) {
          diffs.push({ line: i + 1, type: 'removed', text: a });
        } else if (a !== b) {
          diffs.push({ line: i + 1, type: 'changed', from: a, to: b });
        }
      }
      return { success: true, fileA: fullA, fileB: fullB, differences: diffs, totalDiffs: diffs.length, identical: diffs.length === 0 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── HTTP Request ────────────────────────────────────────────────────────

  async _httpRequest(url, method = 'GET', headers = {}, body) {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        // SSRF protection
        const hostname = parsedUrl.hostname.toLowerCase();
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'metadata.google.internal'];
        const blockedPrefixes = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
          '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
          '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '169.254.'];
        if (blockedHosts.includes(hostname) || blockedPrefixes.some(p => hostname.startsWith(p))) {
          resolve({ success: false, error: `SSRF protection: requests to internal/private addresses are blocked (${hostname})` });
          return;
        }

        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: (method || 'GET').toUpperCase(),
          headers: { ...headers },
        };
        if (body && !options.headers['Content-Type']) {
          options.headers['Content-Type'] = 'application/json';
        }
        const req = lib.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            let parsed = data;
            try { parsed = JSON.parse(data); } catch {}
            resolve({
              success: true,
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers,
              body: parsed,
              size: data.length,
            });
          });
        });
        req.on('error', (error) => resolve({ success: false, error: error.message }));
        req.setTimeout(30000, () => { req.destroy(); resolve({ success: false, error: 'Request timed out (30s)' }); });
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  // ─── System Tools ────────────────────────────────────────────────────────

  async _checkPort(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve({ success: true, port, inUse: true, message: `Port ${port} is in use` });
        } else {
          resolve({ success: false, error: err.message });
        }
      });
      server.once('listening', () => {
        server.close();
        resolve({ success: true, port, inUse: false, message: `Port ${port} is available` });
      });
      server.listen(port, '127.0.0.1');
    });
  }

  async _installPackages(packages, manager) {
    const cwd = this.projectPath;
    if (!cwd) return { success: false, error: 'No project opened' };
    let pm = manager;
    if (!pm) {
      try {
        await fs.access(path.join(cwd, 'package.json'));
        try { await fs.access(path.join(cwd, 'yarn.lock')); pm = 'yarn'; } catch { pm = 'npm'; }
      } catch {
        try { await fs.access(path.join(cwd, 'requirements.txt')); pm = 'pip'; } catch { pm = 'npm'; }
      }
    }
    let cmd;
    const safePackages = this._sanitizeShellArg(packages);
    switch (pm) {
      case 'npm': cmd = `npm install ${safePackages}`; break;
      case 'yarn': cmd = `yarn add ${safePackages}`; break;
      case 'pip': cmd = `pip install ${safePackages}`; break;
      default: cmd = `npm install ${safePackages}`; break;
    }
    return this._runCommand(cmd, cwd, 120000);
  }

  async _replaceInFiles(searchText, replaceText, searchPath, isRegex = false) {
    if (!searchText) return { success: false, error: 'searchText is required' };
    const basePath = this.projectPath || '';
    const targetPath = searchPath
      ? (path.isAbsolute(searchPath) ? searchPath : path.join(basePath, searchPath))
      : basePath;

    try {
      const stats = await fs.stat(targetPath);
      const files = [];

      if (stats.isDirectory()) {
        const walk = async (dir, depth = 0) => {
          if (depth > 10) return;
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.vscode'].includes(entry.name)) continue;
              await walk(fullPath, depth + 1);
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.gguf'].includes(ext)) continue;
              files.push(fullPath);
            }
          }
        };
        await walk(targetPath);
      } else {
        files.push(targetPath);
      }

      const regex = isRegex ? new RegExp(searchText, 'g') : null;
      const results = [];
      let totalReplacements = 0;

      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf8');
          const matches = isRegex
            ? (content.match(regex) || []).length
            : content.split(searchText).length - 1;

          if (matches > 0) {
            if (!this._fileBackups.has(file)) {
              this._setFileBackup(file, { original: content, timestamp: Date.now(), tool: 'replace_in_files', isNew: false });
            }
            const newContent = isRegex
              ? content.replace(regex, replaceText)
              : content.split(searchText).join(replaceText);
            await fs.writeFile(file, newContent, 'utf8');
            results.push({ file: path.relative(basePath, file), replacements: matches });
            totalReplacements += matches;
          }
        } catch {}
      }

      return {
        success: true,
        filesModified: results.length,
        totalReplacements,
        files: results,
        message: `Replaced ${totalReplacements} occurrences across ${results.length} files`,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _openFileInEditor(filePath) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.projectPath || '', filePath);
    try {
      await fs.access(fullPath);
      if (this.browserManager && this.browserManager.parentWindow) {
        this.browserManager.parentWindow.webContents.send('open-file', fullPath);
        return { success: true, filePath: fullPath, message: `Opened ${path.basename(fullPath)} in editor` };
      }
      return { success: false, error: 'No window available to open file in' };
    } catch {
      return { success: false, error: `File not found: ${fullPath}` };
    }
  }

  async _getProjectStructure() {
    if (this.ragEngine && this.ragEngine.projectPath) {
      return { success: true, structure: this.ragEngine.getProjectSummary() };
    }
    if (this.projectPath) {
      return this._listDirectory(this.projectPath, true);
    }
    return { success: false, error: 'No project opened' };
  }

  // ─── Memory Tools ────────────────────────────────────────────────────────

  async _saveMemory(key, value) {
    if (!key || !value) return { success: false, error: 'Both key and value are required' };
    try {
      const memDir = path.join(this.projectPath || require('os').homedir(), '.guide-memory');
      await fs.mkdir(memDir, { recursive: true });
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const metadata = { key, savedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const payload = JSON.stringify({ metadata, content: value });
      await fs.writeFile(path.join(memDir, `${safeKey}.json`), payload, 'utf8');
      // Also write plain text for backward compat
      await fs.writeFile(path.join(memDir, `${safeKey}.txt`), value, 'utf8');
      return { success: true, message: `Memory saved: "${key}"` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _getMemory(key) {
    if (!key) return { success: false, error: 'Key is required' };
    try {
      const memDir = path.join(this.projectPath || require('os').homedir(), '.guide-memory');
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Try exact match first (JSON then txt)
      for (const ext of ['.json', '.txt']) {
        const filePath = path.join(memDir, `${safeKey}${ext}`);
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          if (ext === '.json') {
            const parsed = JSON.parse(raw);
            return { success: true, key, value: parsed.content, metadata: parsed.metadata };
          }
          return { success: true, key, value: raw };
        } catch (_) {}
      }

      // Fuzzy match: find closest key by substring
      try {
        const files = await fs.readdir(memDir);
        const lowerKey = safeKey.toLowerCase();
        const match = files.find(f => f.toLowerCase().includes(lowerKey));
        if (match) {
          const raw = await fs.readFile(path.join(memDir, match), 'utf8');
          const matchKey = match.replace(/\.(json|txt)$/, '');
          if (match.endsWith('.json')) {
            const parsed = JSON.parse(raw);
            return { success: true, key: matchKey, value: parsed.content, metadata: parsed.metadata, fuzzyMatch: true };
          }
          return { success: true, key: matchKey, value: raw, fuzzyMatch: true };
        }
      } catch (_) {}

      return { success: false, error: `No memory found for key: "${key}"` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _listMemories() {
    try {
      const memDir = path.join(this.projectPath || require('os').homedir(), '.guide-memory');
      try { await fs.access(memDir); } catch { return { success: true, keys: [], message: 'No memories saved yet.' }; }
      const files = await fs.readdir(memDir);
      // Prefer .json files, fall back to .txt
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      const txtOnlyFiles = files.filter(f => f.endsWith('.txt') && !jsonFiles.includes(f.replace('.txt', '.json')));

      const entries = [];
      for (const f of jsonFiles) {
        try {
          const raw = await fs.readFile(path.join(memDir, f), 'utf8');
          const parsed = JSON.parse(raw);
          entries.push({ key: f.replace('.json', '').replace(/_/g, ' '), updatedAt: parsed.metadata?.updatedAt || null });
        } catch (_) {
          entries.push({ key: f.replace('.json', '').replace(/_/g, ' '), updatedAt: null });
        }
      }
      for (const f of txtOnlyFiles) {
        try {
          const st = await fs.stat(path.join(memDir, f));
          entries.push({ key: f.replace('.txt', '').replace(/_/g, ' '), updatedAt: st.mtime.toISOString() });
        } catch (_) {
          entries.push({ key: f.replace('.txt', '').replace(/_/g, ' '), updatedAt: null });
        }
      }

      // Sort by most recently updated
      entries.sort((a, b) => {
        if (!a.updatedAt && !b.updatedAt) return 0;
        if (!a.updatedAt) return 1;
        if (!b.updatedAt) return -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      return { success: true, keys: entries.map(e => e.key), entries, message: `${entries.length} memories found` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── TODO Tools ──────────────────────────────────────────────────────────

  _writeTodos(params) {
    const { items } = params;
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'items must be a non-empty array of strings or {text, status} objects' };
    }
    const created = [];
    for (const item of items) {
      let text, status;
      if (typeof item === 'string') {
        text = item.trim();
        status = 'pending';
      } else if (item && typeof item === 'object') {
        text = (item.text || item.content || '').toString().trim();
        status = ['pending', 'in-progress', 'done'].includes(item.status) ? item.status : 'pending';
      } else {
        continue;
      }
      if (!text) continue;
      const todo = { id: this._todoNextId++, text, status };
      this._todos.push(todo);
      created.push(todo);
    }
    // Auto-mark the first todo as in-progress. When write_todos is called the model is always
    // about to begin step 1. Small models (4B/7B) routinely skip the first update_todo call
    // entirely — this ensures the plan shows activity immediately rather than sitting at 0/N.
    // If the model also calls update_todo({status:'in-progress'}) for the first item, it's
    // idempotent. If the item was explicitly created with status 'done', don't downgrade it.
    if (created.length > 0 && created[0].status === 'pending') {
      created[0].status = 'in-progress';
      const stored = this._todos.find(t => t.id === created[0].id);
      if (stored) stored.status = 'in-progress';
    }
    if (this.onTodoUpdate) this.onTodoUpdate([...this._todos]);
    return { success: true, created, allTodos: [...this._todos] };
  }

  _updateTodo(params) {
    const { id, status, text } = params;
    const todo = this._todos.find(t => t.id === id);
    if (!todo) return { success: false, error: `TODO #${id} not found` };
    if (status && ['pending', 'in-progress', 'done'].includes(status)) {
      todo.status = status;
    }
    if (typeof text === 'string' && text.trim()) {
      todo.text = text.trim();
    }
    if (this.onTodoUpdate) this.onTodoUpdate([...this._todos]);
    return { success: true, todo };
  }

  // ─── Scratchpad Tools ────────────────────────────────────────────────────

  _writeScratchpad(params) {
    const { key, content } = params;
    if (!key || typeof key !== 'string') {
      return { success: false, error: 'key must be a non-empty string' };
    }
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const scratchDir = this._scratchDir || path.join(this.projectRoot || '.', '.guide-scratch');
    const fsSync = require('fs');
    if (!fsSync.existsSync(scratchDir)) {
      fsSync.mkdirSync(scratchDir, { recursive: true });
    }
    const filePath = path.join(scratchDir, `${safeKey}.json`);
    const data = { key: safeKey, content, updatedAt: new Date().toISOString() };
    fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: filePath, key: safeKey };
  }

  _readScratchpad(params) {
    const { key } = params;
    if (!key || typeof key !== 'string') {
      return { success: false, error: 'key must be a non-empty string' };
    }
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const scratchDir = this._scratchDir || path.join(this.projectRoot || '.', '.guide-scratch');
    const filePath = path.join(scratchDir, `${safeKey}.json`);
    const fsSync = require('fs');
    if (!fsSync.existsSync(filePath)) {
      return { success: false, error: `Scratchpad '${safeKey}' not found` };
    }
    const raw = fsSync.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return { success: true, ...data };
  }

  // ─── Response Processing (parseToolCalls + processResponse) ──────────────

  parseToolCalls(responseText) {
    return standaloneParseToolCalls(responseText);
  }

  async processResponse(responseText, options = {}) {
    console.log('[MCP] processResponse called, text preview:', responseText?.substring(0, 200));

    const toolPaceMs = options.toolPaceMs || 0;
    const maxToolsPerResponse = Number.isFinite(options.maxToolsPerResponse) ? options.maxToolsPerResponse : 0;

    let toolCalls = this.parseToolCalls(responseText);

    // Normalize common tool-name aliases
    for (const call of toolCalls) {
      if (!call || typeof call.tool !== 'string') continue;
      if (call.tool === 'list_files') call.tool = 'list_directory';
    }

    // Path cleanup: strip template/placeholder prefixes
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

    // Param inference: fix "." or "" filePath for file operations when user message references a real file
    // NOTE: list_directory is excluded — ".", "./", and "" all resolve correctly to the project root
    // in _listDirectory via path.join(projectPath, "."). Keyword extraction from user messages
    // was removed because it's a classifier pattern that mis-triggers on common words like "build".
    if (options.userMessage) {
      for (const call of toolCalls) {
        if (!call || typeof call.tool !== 'string') continue;
        const fp = call.params?.filePath ?? call.params?.path ?? call.params?.file_path ?? '';
        const isFileOp = ['read_file', 'write_file', 'edit_file'].includes(call.tool);
        const pathIsBad = fp === '.' || fp === './' || fp === '' || fp === '..';

        if (pathIsBad && isFileOp) {
          const msg = options.userMessage;
          const fileMatch = msg.match(/\b([\w.-]+\.(?:json|js|ts|tsx|jsx|md|html|css|yml|yaml|toml|py|sh|bat|txt|xml|env|cfg|conf|ini|log|csv))\b/i);
          if (fileMatch) {
            const inferred = fileMatch[1];
            console.log(`[MCP] Param inference: "${call.tool}" filePath "${fp}" → "${inferred}" (from user message)`);
            call.params = { ...call.params, filePath: inferred };
            if (call.params.path) delete call.params.path;
            if (call.params.file_path) delete call.params.file_path;
          }
        }
      }
    }

    // Optional enforcement: rewrite browser_navigate URL
    if (options && typeof options.enforceNavigateUrl === 'string' && options.enforceNavigateUrl.trim()) {
      const expectedUrl = options.enforceNavigateUrl.trim();
      const firstNav = toolCalls.find(tc => tc && tc.tool === 'browser_navigate');
      if (firstNav) {
        const gotUrl = firstNav.params?.url;
        if (typeof gotUrl === 'string' && gotUrl.trim() && gotUrl.trim() !== expectedUrl) {
          console.log(`[MCP] Enforcing browser_navigate url: "${gotUrl.trim()}" -> "${expectedUrl}"`);
          firstNav.params = { ...(firstNav.params || {}), url: expectedUrl };
        }
        toolCalls = [firstNav];
      }
    }

    // Tool Call Repair
    let _repairDropped = [];
    if (toolCalls.length > 0) {
      const { repaired, issues, droppedFilePaths: _rd } = repairToolCalls(toolCalls, responseText);
      _repairDropped = _rd || [];
      if (issues.length > 0) {
        console.log(`[MCP] Repair dropped/fixed ${issues.length} call(s)`);
      }
      toolCalls = repaired;
    }

    // De-duplicate tool calls
    {
      const seen = new Set();
      const deduped = [];
      for (const call of toolCalls) {
        const tool = call?.tool;
        if (!tool || typeof tool !== 'string') continue;
        let sig;
        try { sig = `${tool}:${JSON.stringify(call.params || {})}`; } catch { sig = `${tool}:<unstringifiable>`; }
        if (seen.has(sig)) continue;
        seen.add(sig);
        deduped.push(call);
      }
      toolCalls = deduped;
    }

    // Cap tool burst
    let capped = false;
    let skippedCount = 0;
    if (maxToolsPerResponse > 0 && toolCalls.length > maxToolsPerResponse) {
      skippedCount = toolCalls.length - maxToolsPerResponse;
      toolCalls = toolCalls.slice(0, maxToolsPerResponse);
      capped = true;
      console.log(`[MCP] Capped tool calls: executing ${maxToolsPerResponse}, skipping ${skippedCount}`);
    }

    // No formal tool calls found — return without attempting fallback detection.
    // The model should use proper tool call format (native functions or JSON fences).
    // Removed: prose command detection and fallback file operation classification.
    if (toolCalls.length === 0) {
      console.log('[MCP] No formal tool calls found');
      return { hasToolCalls: false, results: [], formalCallCount: 0, droppedFilePaths: _repairDropped };
    }

    // Browser Tool Capping
    const BROWSER_STATE_CHANGERS = new Set([
      'browser_navigate', 'browser_click', 'browser_type', 'browser_select',
      'browser_select_option', 'browser_press_key', 'browser_back',
      'browser_fill_form', 'browser_drag', 'browser_file_upload',
    ]);
    const MAX_BROWSER_STATE_CHANGES = 2;
    let browserStateChanges = 0;
    let browserCapped = false;
    let browserSkipped = 0;

    console.log('[MCP] Executing', toolCalls.length, 'tool calls...', toolPaceMs ? `(${toolPaceMs}ms pace)` : '');
    const results = [];
    for (const call of toolCalls) {
      if (call && typeof call.tool === 'string' && BROWSER_STATE_CHANGERS.has(call.tool)) {
        if (browserStateChanges >= MAX_BROWSER_STATE_CHANGES) {
          browserSkipped++;
          browserCapped = true;
          console.log(`[MCP] Browser cap: skipping ${call.tool} (${browserStateChanges} state changes already, refs are stale)`);
          continue;
        }
      }

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

      if (call && typeof call.tool === 'string' && BROWSER_STATE_CHANGERS.has(call.tool)) {
        browserStateChanges++;
      }
    }

    if (browserCapped) {
      console.log(`[MCP] Browser cap enforced: executed ${browserStateChanges} state-changing actions, skipped ${browserSkipped}`);
    }

    return { hasToolCalls: true, results, capped: capped || browserCapped, skippedToolCalls: skippedCount + browserSkipped, formalCallCount: toolCalls.length, droppedFilePaths: _repairDropped };
  }

  // ─── Tool Prompt Building ────────────────────────────────────────────────

  getToolPrompt() {
    if (this._toolPromptCache) return this._toolPromptCache;
    this._toolPromptCache = this._buildToolPrompt(this.getToolDefinitions());
    return this._toolPromptCache;
  }

  getCompactToolHint(taskType, options) {
    if (taskType === 'chat') return '';

    // Build a clean, compact tool schema from actual definitions
    const tools = this.getToolDefinitions();
    const toolMap = {};
    for (const tool of tools) toolMap[tool.name] = tool;

    let hint = '## Tools\n';
    hint += 'To call a tool, output a ```json block:\n```json\n{"tool":"<name>","params":{...}}\n```\n\n';

    if (this.projectPath) {
      hint += `Project: ${this.projectPath}\n\n`;
    }

    // Define categories to include based on task type
    const categories = {
      'File Operations': ['read_file', 'write_file', 'edit_file', 'append_to_file', 'delete_file', 'rename_file', 'copy_file', 'list_directory', 'find_files', 'create_directory', 'get_project_structure', 'grep_search'],
      'Terminal': ['run_command'],
      'Web': ['web_search', 'fetch_webpage', 'http_request'],
      'Browser': ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form', 'browser_evaluate', 'browser_scroll', 'browser_back', 'browser_press_key', 'browser_hover', 'browser_screenshot', 'browser_get_content', 'browser_tabs', 'browser_close'],
      'Git': ['git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch'],
      'Memory': ['save_memory', 'get_memory', 'list_memories'],
      'Planning': ['write_todos', 'update_todo'],
    };

    // For minimal mode, only show essential tools
    if (options && options.minimal) {
      const minimalTools = ['read_file', 'write_file', 'edit_file', 'append_to_file', 'list_directory', 'run_command', 'web_search'];
      for (const name of minimalTools) {
        const tool = toolMap[name];
        if (!tool) continue;
        const params = tool.parameters ? Object.entries(tool.parameters)
          .filter(([, info]) => info.required)
          .map(([n]) => n)
          .join(', ') : '';
        hint += `- **${name}**(${params}) — ${tool.description.split('.')[0]}.\n`;
      }
      return hint;
    }

    for (const [category, names] of Object.entries(categories)) {
      const catTools = names.filter(n => toolMap[n]);
      if (catTools.length === 0) continue;
      hint += `### ${category}\n`;
      for (const name of catTools) {
        const tool = toolMap[name];
        const params = tool.parameters ? Object.entries(tool.parameters)
          .map(([n, info]) => `${n}${info.required ? '' : '?'}`)
          .join(', ') : '';
        // Use first sentence of description only for compact view
        const desc = tool.description.split(/\.\s/)[0];
        hint += `- **${name}**(${params}) — ${desc}.\n`;
      }
      hint += '\n';
    }

    hint += '### Rules\n';
    hint += '- Use write_file to create new files, append_to_file to add to existing files\n';
    hint += '- For edits: read_file first, then edit_file with exact oldText\n';
    hint += '- For large files: write_file for first section, then append_to_file for remaining sections\n';
    hint += '- Browser workflow: browser_navigate → browser_snapshot → interact using [ref=N] IDs\n';

    return hint;
  }

  getToolPromptForTask(taskType) {
    if (taskType === 'chat') return '';

    const tools = this.getToolDefinitions();

    const coreTool = new Set(['web_search']);
    const browserTools = new Set([
      'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
      'browser_fill_form', 'browser_select_option', 'browser_get_content',
      'browser_scroll', 'browser_back', 'browser_hover', 'browser_get_url',
      'browser_evaluate', 'browser_screenshot', 'browser_press_key',
      'browser_wait_for', 'browser_tabs', 'browser_handle_dialog',
      'browser_drag', 'browser_console_messages', 'browser_close',
      'browser_file_upload', 'browser_resize', 'browser_get_links',
    ]);
    const codeTools = new Set([
      'read_file', 'write_file', 'edit_file', 'delete_file', 'rename_file',
      'create_directory', 'find_files', 'search_codebase', 'grep_search',
      'run_command', 'list_directory', 'get_project_structure', 'analyze_error',
      'install_packages', 'undo_edit', 'replace_in_files', 'get_file_info',
      'git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch',
    ]);

    let selectedNames;
    if (taskType === 'browser') {
      selectedNames = new Set([...coreTool, ...browserTools]);
    } else if (taskType === 'code') {
      selectedNames = new Set([...coreTool, ...codeTools, 'write_todos', 'update_todo']);
    } else {
      selectedNames = new Set([...coreTool, ...browserTools, ...codeTools,
        'fetch_webpage', 'save_memory', 'get_memory', 'list_memories',
        'write_todos', 'update_todo',
      ]);
    }

    const filtered = tools.filter(t => selectedNames.has(t.name));
    return this._buildToolPrompt(filtered);
  }

  _buildToolPrompt(tools) {
    let prompt = '## Tools\nCall tools with: ```json\n{"tool":"name","params":{...}}\n```\n';
    if (this.projectPath) {
      prompt += `Project directory: ${this.projectPath}\nUse relative file paths (e.g. "output.md") — they resolve to the project directory.\n`;
    }
    prompt += '\n';

    const categories = {
      'File Operations': ['read_file', 'write_file', 'edit_file', 'delete_file', 'rename_file', 'create_directory', 'list_directory', 'find_files', 'search_codebase', 'grep_search', 'get_project_structure', 'get_file_info', 'replace_in_files', 'undo_edit', 'install_packages'],
      'Terminal': ['run_command'],
      'Browser': ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form', 'browser_select_option', 'browser_screenshot', 'browser_evaluate', 'browser_scroll', 'browser_back', 'browser_hover', 'browser_press_key', 'browser_get_url', 'browser_get_content', 'browser_get_links', 'browser_wait_for', 'browser_tabs', 'browser_handle_dialog', 'browser_drag', 'browser_console_messages', 'browser_close', 'browser_file_upload', 'browser_resize', 'browser_list_elements'],
      'Web': ['web_search', 'fetch_webpage'],
      'Git': ['git_status', 'git_commit', 'git_diff', 'git_log', 'git_branch'],
      'Context & Memory': ['save_memory', 'get_memory', 'list_memories', 'analyze_error'],
    };

    const toolMap = {};
    for (const tool of tools) toolMap[tool.name] = tool;

    for (const [category, names] of Object.entries(categories)) {
      const catTools = names.filter(n => toolMap[n]);
      if (catTools.length === 0) continue;
      prompt += `### ${category}\n`;
      for (const name of catTools) {
        const tool = toolMap[name];
        const params = tool.parameters ? Object.entries(tool.parameters)
          .map(([n, i]) => `${n}:${i.type}${i.required ? '*' : ''}`)
          .join(', ') : '';
        prompt += `**${name}**(${params}) — ${tool.description}\n`;
        delete toolMap[name];
      }
      prompt += '\n';
    }

    const remaining = Object.values(toolMap);
    if (remaining.length > 0) {
      prompt += '### Other\n';
      for (const tool of remaining) {
        const params = tool.parameters ? Object.entries(tool.parameters)
          .map(([n, i]) => `${n}:${i.type}${i.required ? '*' : ''}`)
          .join(', ') : '';
        prompt += `**${tool.name}**(${params}) — ${tool.description}\n`;
      }
      prompt += '\n';
    }

    prompt += `### Common Patterns
- **Web research**: web_search → browser_navigate → browser_snapshot → browser_click/type using [ref=N]
- **Create & verify**: write_file → browser_navigate("file:///abs/path")
- **Edit existing file**: read_file → edit_file (oldText/newText)
- **Form filling**: browser_navigate → browser_snapshot → browser_type/click each field → submit

### Important Rules
- You HAVE tools — use them. NEVER say "I can't browse" or "I don't have internet"
- Your browser is REAL Chromium — no CAPTCHA restrictions
- NEVER provide manual instructions — USE the tools to do the work
- NEVER output full file content as code blocks in chat — use write_file, edit_file, or append_to_file
- If an error occurs, retry with a different approach — do NOT give up
`;
    return prompt;
  }

  getHistory() {
    return this.toolHistory;
  }
}

// Mix in extracted tool methods onto the prototype
Object.assign(MCPToolServer.prototype, mcpBrowserTools);
Object.assign(MCPToolServer.prototype, mcpGitTools);

module.exports = { MCPToolServer };

