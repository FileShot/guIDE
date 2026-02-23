# guIDE — The AI-Native Desktop IDE

<p align="center">
  <img src="public/icons/compass.svg" alt="guIDE Logo" width="120" />
</p>

<p align="center">
  <strong>Your code. Your models. Your machine. No cloud required.</strong>
</p>

<p align="center">
  <em>A source-available, local-first IDE with built-in LLM inference, 52 autonomous MCP tools, browser automation, RAG-powered code intelligence, and 9 cloud AI providers — all in a single Electron desktop app.</em>
</p>

---

## Why guIDE Exists

VS Code is an incredible editor — but it was designed before the AI era. Every AI extension bolted onto VS Code requires a cloud subscription, sends your code to external servers, and gives you limited control over the models, prompts, and tooling.

**guIDE was built from the ground up as an AI-native IDE:**

| | VS Code + Extensions | guIDE |
|---|---|---|
| **AI integration** | Bolt-on extensions (Copilot, Cursor) | Built into the core architecture |
| **Local LLM** | Not supported natively | node-llama-cpp with CUDA/Vulkan GPU acceleration |
| **Your data** | Code sent to cloud APIs | Runs entirely on your machine — no telemetry, no cloud dependency |
| **Tool use** | Extensions call their own cloud APIs | 52 MCP tools the AI calls autonomously — files, terminal, browser, git, memory |
| **Browser automation** | Requires separate tools (Playwright, Puppeteer) | Built-in BrowserView with 15 browser tools the AI controls directly |
| **Cost** | $10-20/month for Copilot | Free forever with local models. Optional cloud with free-tier providers pre-configured |
| **Context** | Limited to open files | RAG indexes your entire codebase. Persistent memory across sessions |
| **Customization** | Extension marketplace | Direct source access — modify prompts, tools, UI, everything |

### Why Local-First Matters

- **Privacy:** Your code never leaves your machine. No training on your proprietary code.
- **Speed:** Local inference with GPU acceleration. No network latency.
- **Offline:** Works without internet. Perfect for classified environments, airplanes, or unreliable connections.
- **Cost:** No subscriptions. Download a model once, use it forever.
- **Control:** You choose the model, the context window, the GPU layers. Fine-tune the system prompt.

---

## Features at a Glance

### Core IDE
- **Monaco Editor** — The same editor engine as VS Code: syntax highlighting, IntelliSense, multi-cursor, minimap, bracket matching, code folding
- **Integrated Terminal** — Full PTY terminal (node-pty + xterm.js) with multiple tabs, AI-powered IntelliSense suggestions
- **File Explorer** — Tree and grid views, multi-select, drag & drop (internal + from Windows Explorer), copy/paste (Ctrl+C/X/V), context menus
- **Command Palette** — `Ctrl+Shift+P` for quick access to all commands
- **Split Editor** — `Ctrl+\` for side-by-side file editing
- **Inline Chat** — `Ctrl+I` for AI-powered inline code editing directly in the editor
- **Next Edit Suggestions** — Tab-to-accept ghost text completions (AI predicts your next edit)
- **Markdown, HTML & SVG Preview** — Live preview toggle for documentation, web pages, and vector graphics
- **JSON Preview** — Collapsible tree view with syntax highlighting for JSON files
- **CSV/TSV Table Preview** — Sortable table view for data files
- **YAML/TOML/XML Preview** — Syntax-highlighted formatted preview
- **Code Runner** — F5 to run in 50+ languages and file types (Python, JavaScript, TypeScript, C/C++, Rust, Go, Java, Ruby, PHP, Haskell, Clojure, Nim, Zig, Fortran, and many more)
- **Cross-File Search** — Search and replace across your entire project with optional AI-powered semantic search
- **8 Themes** — Dark Default, Monokai, Dracula, Nord, Solarized Dark, GitHub Dark, Light, Catppuccin Mocha
- **364 File Icons** — Vivid SVG icons for every file type via file-icon-vectors
- **Custom Titlebar** — Native-feeling frameless window with integrated menu
- **Bracket Content Selection** — `Ctrl+Shift+[` to select contents between matching brackets
- **Git Blame Decorations** — Inline author and date annotations for each line
- **Paste with Auto-Imports** — Automatically adds missing imports when pasting React/common code
- **Custom Instructions** — `.prompt.md` files for project-specific AI context injection
- **Drag Files into Chat** — Drop code files directly into the AI chat for context
- **Mermaid Diagrams in Chat** — Live SVG rendering of Mermaid.js diagrams in AI responses
- **Context Window Indicator** — Visual progress bar showing token usage in chat input

### AI Assistant
- **Local LLM Inference** — Load any GGUF model (Qwen, Llama, Mistral, DeepSeek, etc.) via node-llama-cpp
- **CUDA & Vulkan GPU Acceleration** — Auto-detects your GPU and offloads model layers
- **Adaptive Context Window** — Automatically maximizes context based on available system RAM (up to 32K tokens)
- **Flash Attention** — Memory-efficient attention for larger context windows
- **Streaming Responses** — Real-time token-by-token output with thinking model support
- **Smart Context Budgeting** — Priority-based prompt assembly (memory → tools → errors → RAG → code → web search)
- **Agentic Mode** — Multi-step autonomous coding with up to 100 iterations
- **Plan Mode** — Toggle between direct execution and plan-first reasoning in chat
- **Multi-Agent / Background Agents** — `/agent` command to spawn autonomous background tasks
- **Thinking Models** — Collapsible reasoning display for models with chain-of-thought (DeepSeek, Qwen R1)
- **MCP Server Management UI** — Visual panel to configure, enable/disable, and monitor MCP servers

### Debug Framework
- **Node.js Debugging** — Chrome DevTools Protocol (CDP) integration for breakpoints, stepping, variable inspection
- **Python Debugging** — debugpy DAP (Debug Adapter Protocol) support
- **Debug Panel** — Full UI with breakpoints list, variables, call stack, stepping controls (`Ctrl+Shift+D`)

### Cloud LLM Support (9 Providers)
All providers come **pre-configured with API keys** — start chatting immediately:

| Provider | Models | Notes |
|---|---|---|
| **Google Gemini** | 2.5 Flash, 2.5 Pro, 2.0 Flash | Default provider — generous free tier |
| **Groq** | Llama 3, Mixtral | Ultra-fast inference |
| **OpenRouter** | 100+ models | Dynamic model fetching |
| **Cerebras** | Llama 3.1 | Fastest cloud inference |
| **SambaNova** | DeepSeek, Llama, QwQ | Fast and free |
| **APIFreeLLM** | Community models | Free tier |
| **OpenAI** | GPT-4o, GPT-4 Turbo | Bring your own key |
| **Anthropic** | Claude Sonnet 4, Claude 3.5 | Bring your own key |
| **xAI** | Grok 3, Grok 3 Mini | Bring your own key |

**Automatic Fallback Chain:** If one provider hits rate limits, guIDE automatically tries the next.

### 52 MCP Tools (Autonomous Agent Actions)
When Agentic mode is enabled, the AI can use any of these tools autonomously:

<details>
<summary><strong>File Operations (17 tools)</strong></summary>

| Tool | Description |
|---|---|
| `read_file` | Read file contents (supports partial reads by line range) |
| `write_file` | Create or overwrite files |
| `edit_file` | Replace specific text in a file (surgical edits with undo support) |
| `delete_file` | Delete files |
| `rename_file` | Rename or move files/directories |
| `copy_file` | Copy files |
| `append_to_file` | Append content to the end of a file |
| `create_directory` | Create folders |
| `list_directory` | List folder contents |
| `find_files` | Find files by glob pattern |
| `get_file_info` | Get file size, dates, metadata |
| `search_codebase` | BM25 search through indexed code |
| `get_project_structure` | Full project tree overview |
| `grep_search` | Regex search across files |
| `search_in_file` | Search within a specific file |
| `diff_files` | Compare two files |
| `replace_in_files` | Find and replace across multiple files |
</details>

<details>
<summary><strong>Browser Automation (15 tools)</strong></summary>

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate to any URL |
| `browser_click` | Click elements using CSS selectors |
| `browser_type` | Type into input fields |
| `browser_screenshot` | Capture page screenshots |
| `browser_get_content` | Read page text/HTML content |
| `browser_evaluate` | Execute JavaScript on the page |
| `browser_list_elements` | List all interactive elements with CSS selectors |
| `browser_wait_for_element` | Wait for an element to appear |
| `browser_scroll` | Scroll up/down on the page |
| `browser_wait` | Wait for page to settle |
| `browser_back` | Navigate back in history |
| `browser_select` | Select dropdown options |
| `browser_hover` | Hover over elements |
| `browser_get_url` | Get the current page URL |
| `browser_get_links` | Get all links on the page |
</details>

<details>
<summary><strong>Terminal & System (4 tools)</strong></summary>

| Tool | Description |
|---|---|
| `run_command` | Execute shell commands (configurable timeout) |
| `install_packages` | Install npm/pip packages |
| `check_port` | Check if a port is in use |
| `http_request` | Make HTTP requests |
</details>

<details>
<summary><strong>Git (7 tools)</strong></summary>

| Tool | Description |
|---|---|
| `git_status` | Current branch and changed files |
| `git_commit` | Stage all and commit |
| `git_diff` | View file diffs |
| `git_log` | View commit history |
| `git_branch` | Create/switch/list branches |
| `git_stash` | Stash or apply changes |
| `git_reset` | Reset changes |
</details>

<details>
<summary><strong>Web, Memory & Utilities (9 tools)</strong></summary>

| Tool | Description |
|---|---|
| `web_search` | DuckDuckGo search (no API key needed) |
| `fetch_webpage` | Fetch and extract page content |
| `save_memory` | Persist notes across sessions |
| `get_memory` | Recall saved information |
| `list_memories` | List all saved memory keys |
| `analyze_error` | Trace errors through codebase |
| `undo_edit` | Undo a previous file edit |
| `list_undoable` | List files with undo history |
| `open_file_in_editor` | Open a file in the editor UI |
</details>

### RAG System (Retrieval-Augmented Generation)
- **BM25 Codebase Indexing** — Indexes your entire project for relevant code retrieval
- **Context-Aware Responses** — AI knows about your codebase without sending it anywhere
- **Auto-Indexing** — Re-indexes when you open a project folder

### Browser Tab
- **Integrated Browser** — Browse the web as a tab in the editor viewport
- **AI-Controlled** — The 15 browser tools let the AI navigate, click, type, and read pages
- **Auto-Show** — Browser tab opens automatically when AI uses browser tools
- **URL Bar** — Manual navigation with back/forward/reload controls
- **Smart Element Listing** — After every page interaction, guIDE auto-lists interactive elements so the AI knows what to click next

### Git Integration
- **Source Control Panel** — View changed files, stage/unstage, commit
- **Branch Management** — Checkout, create, view ahead/behind indicators
- **Inline Diffs** — View file diffs for staged and unstaged changes

### Speech
- **Voice Input** — Groq Whisper-powered speech-to-text for hands-free prompting
- **Text-to-Speech** — Read AI responses aloud using system speech synthesis

### System Monitoring
- **CPU & RAM Gauges** — Real-time system resource usage in the status bar
- **LLM Performance** — Tokens/sec and context usage indicators

### Image & Media Input
- **Drag & Drop** — Drop images directly into the chat
- **Clipboard Paste** — Paste screenshots with Ctrl+V
- **File Attach** — Click the paperclip button to attach images
- **Vision Models** — Auto-detects vision-capable models for image analysis

---

## Quick Start

### Prerequisites
- **Node.js 18+** and **npm 9+**
- **Visual C++ Build Tools** (for native modules on Windows)
- **NVIDIA GPU + CUDA drivers** (optional, for GPU acceleration)

### Install & Run

```bash
git clone https://github.com/FileShot/guIDE.git
cd guIDE
npm install
npm run dev
```

Or on Windows, double-click `START_NOW.bat`.

### GGUF Models

Place `.gguf` model files in either:
- The project root directory
- A `models/` subdirectory

The IDE auto-detects and loads the first available model. Switch models via the AI Chat panel dropdown.

**Recommended:** [Qwen 2.5 Coder 7B Q4_K_M](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF) (~4.7 GB)

### GPU Configuration

guIDE automatically detects your GPU and optimizes accordingly:

| GPU | Behavior |
|---|---|
| **NVIDIA (CUDA)** | Auto-detected, model layers offloaded to GPU |
| **AMD (Vulkan)** | Auto-detected via Vulkan backend |
| **CPU-only** | Falls back gracefully with optimized context sizing |

For a **4GB VRAM GPU** (e.g., RTX 3050 Ti):
- ~20-28 of 32 model layers offloaded to GPU
- KV cache stored in system RAM for larger context windows
- Flash attention enabled for memory efficiency

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+B` | Toggle Sidebar |
| `` Ctrl+` `` | Toggle Terminal |
| `Ctrl+J` | Toggle AI Chat |
| `Ctrl+I` | Inline Chat (AI edit at cursor) |
| `Ctrl+Shift+E` | File Explorer |
| `Ctrl+Shift+F` | Search in Files |
| `Ctrl+Shift+G` | Source Control (Git) |
| `Ctrl+Shift+D` | Debug Panel |
| `Ctrl+Shift+X` | Extensions / MCP Servers |
| `Ctrl+S` | Save File |
| `Ctrl+Shift+S` | Save All Files |
| `Ctrl+N` | New File |
| `Ctrl+O` | Open File |
| `Ctrl+P` | Quick Open File |
| `Ctrl+F` | Find in File |
| `Ctrl+H` | Find & Replace |
| `Ctrl+\` | Split Editor |
| `Ctrl+Shift+[` | Select Bracket Contents |
| `F5` | Run Current File |
| `Tab` | Accept Next Edit Suggestion |
| `F11` | Toggle Fullscreen |

---

## Architecture

```
electron-main.js              # Main process — IPC hub, AI chat handler, 100-iteration agentic loop
preload.js                     # Context bridge — secure API surface for renderer
scripts/
  launch.js                    # Dev launcher (Vite + Electron, concurrent)
main/
  llmEngine.js                 # node-llama-cpp — CUDA/Vulkan, GPU layer management, flash attention, thinking models
  modelManager.js              # GGUF model scanning & hot-swap
  ragEngine.js                 # BM25 codebase indexing & retrieval (no embedding model needed)
  terminalManager.js           # node-pty terminal management
  webSearch.js                 # DuckDuckGo web search (HTML scraping, no API key)
  mcpToolServer.js             # 52 MCP tools — autonomous LLM actions with fuzzy name matching
  browserManager.js            # Electron BrowserView + Chrome CDP + element listing
  memoryStore.js               # Persistent AI memory store (JSON on disk)
  cloudLLMService.js           # 9 cloud providers with automatic fallback chain
  gitManager.js                # Git operations (simple-git)
src/
  components/
    Layout/                    # Main layout, activity bar, status bar, menu bar, command palette, theme picker, welcome guide
    Editor/                    # Monaco editor, tabs, search/replace, split editor, markdown/HTML preview, code runner
    Chat/                      # AI chat panel — streaming, thinking display, tool terminal output, image input
    Terminal/                  # xterm.js integrated terminal with multiple tabs
    Search/                    # Cross-file search with regex support
    FileExplorer/              # File tree (list + grid), multi-select, drag & drop, copy/paste, 364 file icons
    Browser/                   # Embedded browser panel with URL bar and overlay management
    SourceControl/             # Git source control panel — stage, commit, diff, branches
  services/                    # Frontend service layer (editor, file system, LLM, electron bridge)
  types/                       # TypeScript type definitions
  config/                      # Editor & LLM configuration constants
```

---

## What I Built vs What I Reused

This is a solo project. Here's an honest breakdown:

### Built from scratch (original work)
- **The entire AI integration layer** — agentic loop, tool execution pipeline, context budgeting, stuck detection, auto-continue, nudge system
- **52 MCP tool implementations** — every tool handler, parameter validation, result formatting
- **Browser automation system** — BrowserView management, element listing, CSS selector extraction, auto-inject page state
- **RAG engine** — BM25 indexing, token-aware context retrieval
- **Cloud LLM service** — 9-provider abstraction with automatic fallback chain, streaming, vision support
- **Memory system** — persistent cross-session AI memory
- **All React components** — layout, chat panel, file explorer, source control, browser panel, theme system
- **System prompt engineering** — tool definitions, browser workflow, thinking model detection
- **Electron IPC architecture** — 100+ IPC handlers connecting renderer to main process
- **File explorer features** — grid/list view, multi-select, drag & drop, copy/paste, context menus
- **Theme system** — 8 themes with CSS variable overrides mapping 30+ Tailwind arbitrary colors

### Libraries and technologies used (not reinvented)
- **Electron** — desktop shell and native OS integration
- **React + TypeScript** — UI framework
- **Monaco Editor** — code editor component (same engine as VS Code)
- **node-llama-cpp** — GGUF model loading and inference
- **xterm.js + node-pty** — terminal emulator and PTY
- **Tailwind CSS** — utility-class styling
- **Vite** — build tool and dev server
- **simple-git** — git operations
- **DuckDuckGo** — web search (HTML scraping, no official API)
- **file-icon-vectors** — SVG file type icons
- **electron-builder** — Windows NSIS installer packaging

---

## Tech Stack

| Component | Technology |
|---|---|
| Desktop Shell | Electron 27 |
| Renderer | React 18 + TypeScript |
| Build Tool | Vite 4 |
| Code Editor | Monaco Editor 0.44 |
| LLM Inference | node-llama-cpp 3.15 (CUDA/Vulkan) |
| Terminal | node-pty + xterm.js 5.4 |
| Styling | Tailwind CSS 3 |
| RAG Search | BM25 (no embedding model needed) |
| Browser | Electron BrowserView + Chrome CDP |
| Web Search | DuckDuckGo (HTML scraping) |
| Installer | electron-builder (NSIS) |
| File Icons | file-icon-vectors (364 SVGs) |

---

## Building for Distribution

```bash
# Build the renderer (React app)
npx vite build

# Package as Windows installer (.exe)
npx electron-builder --win
```

The installer (`guIDE Setup 2.0.0.exe`) will be in `dist-electron/`.

---

## Author

**Brendan Gray** — Computer Science Student
- GitHub: [github.com/FileShot](https://github.com/FileShot)
- Project: [github.com/FileShot/guIDE](https://github.com/FileShot/guIDE)

Built as a solo project. This is my work — please respect the license.

## Support the Project

If guIDE is useful to you, consider supporting continued development:

- **GitHub Sponsors:** [github.com/sponsors/FileShot](https://github.com/sponsors/FileShot)
- **Bitcoin:** `32Sr7HbBSuNaTSn2AndAoDFK7cWmRtaxA2`

---

## License

**Source Available** — Copyright (c) 2025-2026 Brendan Gray. All Rights Reserved.

You may view, download, and use this software for personal, non-commercial purposes.
You may **not** rebrand, redistribute, sell, or claim this work as your own.

See [LICENSE](LICENSE) for full terms.

---

<p align="center"><strong>guIDE</strong> — <em>Your code, your models, your machine.</em></p>
