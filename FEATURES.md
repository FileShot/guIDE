# guIDE — Complete Feature Reference

> Last updated: February 11, 2026 | Version 2.0.0

This document is the authoritative list of every feature implemented in guIDE. Consult this before adding anything that might already exist.

---

## Table of Contents

1. [Core Editor](#core-editor)
2. [AI Assistant](#ai-assistant)
3. [Cloud LLM Providers](#cloud-llm-providers)
4. [MCP Tools (53)](#mcp-tools-53)
5. [Debug Framework](#debug-framework)
6. [Code Runner (50+ Languages)](#code-runner-50-languages)
7. [File Preview System](#file-preview-system)
8. [Terminal](#terminal)
9. [File Explorer](#file-explorer)
10. [Search](#search)
11. [Git / Source Control](#git--source-control)
12. [Browser Integration](#browser-integration)
13. [RAG System](#rag-system)
14. [Speech](#speech)
15. [System Monitoring](#system-monitoring)
16. [Image & Media Input](#image--media-input)
17. [Themes & Appearance](#themes--appearance)
18. [Website (graysoft.dev)](#website-graysoftdev)
19. [Licensing & Distribution](#licensing--distribution)
20. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Core Editor

| Feature | Description | Shortcut | File(s) |
|---|---|---|---|
| Monaco Editor | VS Code's editor engine — syntax highlighting, IntelliSense, multi-cursor, minimap, bracket matching, code folding | — | `MonacoEditor.tsx` |
| Split Editor | Side-by-side file editing | `Ctrl+\` | `Editor.tsx` |
| Tab Bar | Multiple open files with drag-to-reorder, middle-click close, dirty indicators | — | `Editor.tsx` |
| Inline Chat | AI-powered inline code editing overlay at cursor position | `Ctrl+I` | `InlineChat.tsx`, `Editor.tsx` |
| Next Edit Suggestions | Ghost text completions that predict your next edit — Tab to accept | `Tab` | `MonacoEditor.tsx` |
| Colored Ghost Text | Blue-purple tinted ghost text for AI suggestions (vs dim gray for regular) | — | `MonacoEditor.tsx` |
| Bracket Content Selection | Select all content between matching brackets/parens/braces | `Ctrl+Shift+[` | `MonacoEditor.tsx` |
| Paste with Auto-Imports | Automatically inserts missing React/common imports when pasting code | `Ctrl+V` | `MonacoEditor.tsx` |
| Git Blame Decorations | Inline author, date, and commit message for each line | — | `MonacoEditor.tsx` |
| Custom Instructions | `.prompt.md` files in project root are injected into AI system prompt | — | `electron-main.js` |
| AI Code Diff Bar | Accept/Reject buttons for AI-suggested code changes | — | `Editor.tsx` |
| Find & Replace | In-file search with regex, case-sensitive, whole-word options | `Ctrl+F` / `Ctrl+H` | `SearchReplace.tsx` |
| Command Palette | Fuzzy-searchable list of all commands | `Ctrl+Shift+P` | `Layout.tsx` |
| Quick Open | Fuzzy file search across project | `Ctrl+P` | `Layout.tsx` |
| Minimap | Code overview minimap in editor gutter | — | `MonacoEditor.tsx` |
| 8 Editor Themes | Dark Default, Monokai, Dracula, Nord, Solarized Dark, GitHub Dark, Light, Catppuccin Mocha | — | `Layout.tsx` |
| Custom Titlebar | Frameless window with integrated File/Edit/View/Help menus | — | `Layout.tsx` |
| Welcome Screen | Shows keyboard shortcuts when no file is open | — | `Editor.tsx` |

---

## AI Assistant

| Feature | Description | File(s) |
|---|---|---|
| Local LLM Inference | Load any GGUF model via node-llama-cpp — Qwen, Llama, Mistral, DeepSeek, etc. | `llmEngine.js` |
| CUDA & Vulkan GPU | Auto-detects GPU and offloads model layers, progressive fallback (CUDA → Vulkan → CPU) | `llmEngine.js` |
| Adaptive Context Window | Maximizes context based on system RAM (up to 32K tokens) | `llmEngine.js` |
| Flash Attention | Memory-efficient attention for larger context windows | `llmEngine.js` |
| Streaming Responses | Real-time token-by-token output | `electron-main.js` |
| Smart Context Budgeting | Priority assembly: memory → tools → errors → RAG → code → web search | `electron-main.js` |
| Agentic Mode | Autonomous multi-step coding with up to 100 tool-use iterations | `electron-main.js` |
| Plan Mode | Toggle between direct execution and plan-first reasoning | `ChatPanel.tsx` |
| Multi-Agent / Background Agents | `/agent` command spawns autonomous background tasks with status monitoring | `electron-main.js`, `ChatPanel.tsx` |
| Thinking Models | Collapsible reasoning display for chain-of-thought models | `ChatPanel.tsx` |
| Context Window Indicator | Compact SVG ring showing token usage near chat input | `ChatPanel.tsx` |
| Garbage Output Detection | Sanity check on LLM output — auto-retries if output is nonsensical | `electron-main.js` |
| Stuck Detection & Nudge | Detects when agent is looping and nudges it toward progress | `electron-main.js` |
| Drag Files into Chat | Drop code files from explorer into chat to add them as context | `ChatPanel.tsx` |
| Mermaid Diagrams in Chat | Live SVG rendering of ```mermaid code blocks in AI responses | `ChatPanel.tsx` |
| Image/Vision Input | Drag, paste, or attach images for vision-capable models | `ChatPanel.tsx` |
| MCP Server Management UI | Panel to add, remove, enable/disable, and configure external MCP servers | `MCPServerPanel.tsx` |
| Developer Console | Toggleable panel showing all LLM/GPU/Model/AI backend logs in real-time, color-coded, max 500 entries | `ChatPanel.tsx`, `electron-main.js` |
| Quick Add Model Download | In-app model download from HuggingFace with live progress bar, cancel support, and installed indicators | `ChatPanel.tsx`, `electron-main.js` |
| Model Switch Abort Protection | Automatically cancels active generation before switching models to prevent "Object is disposed" errors | `ChatPanel.tsx`, `electron-main.js` |

---

## Cloud LLM Providers

| Provider | Models | Pre-configured? |
|---|---|---|
| Google Gemini | 2.5 Flash, 2.5 Pro, 2.0 Flash | Yes (free tier) |
| Groq | Llama 3, Mixtral | Yes |
| OpenRouter | 100+ models (dynamic fetch) | Yes |
| Cerebras | Llama 3.1 | Yes |
| SambaNova | DeepSeek, Llama, QwQ | Yes |
| APIFreeLLM | Community models | Yes |
| OpenAI | GPT-4o, GPT-4 Turbo | Bring your own key |
| Anthropic | Claude Sonnet 4, Claude 3.5 | Bring your own key |
| xAI | Grok 3, Grok 3 Mini | Bring your own key |

**Automatic Fallback Chain:** If one provider hits rate limits, guIDE tries the next.

---

## MCP Tools (53)

### File Operations (17)
`read_file`, `write_file`, `edit_file`, `delete_file`, `rename_file`, `copy_file`, `append_to_file`, `create_directory`, `list_directory`, `find_files`, `get_file_info`, `search_codebase`, `get_project_structure`, `grep_search`, `search_in_file`, `diff_files`, `replace_in_files`

### Browser Automation (15)
`browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_get_content`, `browser_evaluate`, `browser_list_elements`, `browser_wait_for_element`, `browser_scroll`, `browser_wait`, `browser_back`, `browser_select`, `browser_hover`, `browser_get_url`, `browser_get_links`

### Terminal & System (4)
`run_command`, `install_packages`, `check_port`, `http_request`

### Git (7)
`git_status`, `git_commit`, `git_diff`, `git_log`, `git_branch`, `git_stash`, `git_reset`

### Web, Memory & Utilities (9)
`web_search`, `fetch_webpage`, `save_memory`, `get_memory`, `list_memories`, `analyze_error`, `undo_edit`, `list_undoable`, `open_file_in_editor`

---

## Debug Framework

| Feature | Description | File(s) |
|---|---|---|
| Node.js Debugging | Chrome DevTools Protocol (CDP) — breakpoints, stepping, variable inspection | `debugService.js` |
| Python Debugging | debugpy Debug Adapter Protocol (DAP) support | `debugService.js` |
| Debug Panel | Full UI — breakpoints list, variables pane, call stack, stepping controls | `DebugPanel.tsx` |
| Keyboard Shortcut | `Ctrl+Shift+D` toggles debug panel | `Layout.tsx` |
| 13 Debug IPC Handlers | Start, stop, pause, step-over, step-into, step-out, add/remove breakpoints, get variables, get call stack, evaluate expression, continue, get state | `electron-main.js`, `preload.js` |

---

## Code Runner (50+ Languages)

Press **F5** or click the **Play button** to run the active file. guIDE opens a new terminal and executes the appropriate command.

### Compiled Languages
| Extension | Command |
|---|---|
| `.c` | `gcc → run` |
| `.cpp`, `.cc` | `g++ → run` |
| `.rs` | `rustc → run` |
| `.java` | `javac → java` |
| `.kt` | `kotlinc → java -jar` |
| `.cs` | `dotnet-script` |
| `.go` | `go run` |
| `.swift` | `swift` |
| `.dart` | `dart run` |
| `.nim` | `nim compile --run` |
| `.zig` | `zig run` |
| `.cr` | `crystal run` |
| `.d` | `dmd -run` |
| `.f90`, `.f95` | `gfortran → run` |
| `.pas` | `fpc → run` |
| `.adb` | `gnatmake → run` |
| `.asm` | `nasm → ld → run` |

### Interpreted Languages
| Extension | Command |
|---|---|
| `.py` | `python` |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.ts`, `.tsx`, `.jsx` | `npx tsx` |
| `.rb` | `ruby` |
| `.php` | `php` |
| `.pl` | `perl` |
| `.lua` | `lua` |
| `.r`, `.R` | `Rscript` |
| `.jl` | `julia` |
| `.scala` | `scala` |
| `.ex`, `.exs` | `elixir` |
| `.hs`, `.lhs` | `runhaskell` |
| `.clj`, `.cljs` | `clj` |
| `.fsx`, `.fs` | `dotnet fsi` |
| `.ml` | `ocaml` |
| `.lisp`, `.cl` | `sbcl --script` |
| `.scm` | `guile` |
| `.rkt` | `racket` |
| `.groovy` | `groovy` |
| `.coffee` | `coffee` |
| `.tcl` | `tclsh` |
| `.erl` | `escript` |
| `.pro` | `swipl` |
| `.v` | `v run` |

### Shell & Scripts
| Extension | Command |
|---|---|
| `.sh` | `bash` |
| `.bat`, `.cmd` | Direct execution |
| `.ps1` | `powershell -ExecutionPolicy Bypass` |
| `.sql` | `sqlite3` |

### Build & DevOps
| File | Command |
|---|---|
| `Makefile` | `make` |
| `Dockerfile` | `docker build .` |
| `.tf` | `terraform plan` |
| `.scss`, `.sass` | `sass → .css` |
| `.less` | `lessc → .css` |

---

## File Preview System

All preview types are toggled via the **Eye icon** on the tab or the **Play button** in the toolbar.

| File Type | Preview | Features |
|---|---|---|
| `.html`, `.htm`, `.xhtml` | HTML Preview | Live iframe, refresh, open in external browser, `<base>` tag for relative assets |
| `.md`, `.markdown`, `.mdx` | Markdown Preview | Headers, code blocks, tables, images, links — VS Code-style dark theme |
| `.svg` | SVG Preview | Zoom controls (25%-400%), background toggle (dark/white/gray/checkerboard), script sanitization |
| `.json`, `.jsonc`, `.json5`, `.geojson` | JSON Preview | Collapsible tree, syntax-highlighted values (strings/numbers/booleans/null), expand all button, error display for invalid JSON |
| `.csv`, `.tsv` | CSV/TSV Table | Sortable columns (click header), row numbers, row/column count display, proper quote/delimiter parsing |
| `.yaml`, `.yml` | YAML Preview | Syntax-highlighted keys, values, comments, booleans, numbers |
| `.toml` | TOML Preview | Syntax-highlighted sections, keys, values, comments |
| `.xml`, `.xsl`, `.xslt`, `.rss`, `.atom`, `.plist` | XML Preview | Syntax-highlighted tags, attributes, values, comments |
| `.png`, `.jpg`, `.gif`, `.webp`, `.ico`, `.bmp`, `.tiff` | Image Preview | Auto-loads via `file://`, max-width constrained |

---

## Terminal

| Feature | Description | File(s) |
|---|---|---|
| PTY Terminal | Full pseudo-terminal via node-pty + xterm.js | `TerminalPanel.tsx`, `terminalManager.js` |
| Multiple Tabs | Create, rename, close terminal tabs | `TerminalPanel.tsx` |
| Terminal IntelliSense | AI-powered command suggestions while typing | `TerminalPanel.tsx` |
| Custom Working Directory | Terminals open in the current project folder | `terminalManager.js` |
| Toggle | `` Ctrl+` `` | `Layout.tsx` |

---

## File Explorer

| Feature | Description |
|---|---|
| Tree View | Collapsible folder tree with indentation |
| Grid View | Grid layout with file icon previews |
| Multi-Select | Ctrl+Click and Shift+Click for multiple files |
| Drag & Drop (Internal) | Move files/folders within the explorer |
| Drag & Drop (External) | Drop files from Windows Explorer into the project |
| Copy/Paste | Ctrl+C/X/V for files and folders |
| Context Menus | Right-click for rename, delete, new file/folder, copy path |
| 364 File Icons | SVG icons for every file type via file-icon-vectors |
| Toggle | `Ctrl+Shift+E` |

---

## Search

| Feature | Description | File(s) |
|---|---|---|
| Cross-File Search | Regex, case-sensitive, whole-word search across project | `GlobalSearch.tsx` |
| Semantic Search | AI-powered semantic search toggle using RAG engine | `GlobalSearch.tsx` |
| In-File Search | Find and replace within current editor | `SearchReplace.tsx` |
| Toggle | `Ctrl+Shift+F` | `Layout.tsx` |

---

## Git / Source Control

| Feature | Description | File(s) |
|---|---|---|
| Source Control Panel | View changed files, stage/unstage, commit | `SourceControl.tsx` |
| Branch Management | Checkout, create, view ahead/behind indicators | `SourceControl.tsx` |
| Inline Diffs | View file diffs for staged and unstaged changes | `SourceControl.tsx` |
| Git Blame | Inline decorations: author, date, message per line | `MonacoEditor.tsx` |
| 7 Git MCP Tools | `git_status`, `git_commit`, `git_diff`, `git_log`, `git_branch`, `git_stash`, `git_reset` | `mcpToolServer.js` |
| Toggle | `Ctrl+Shift+G` | `Layout.tsx` |

---

## Browser Integration

| Feature | Description |
|---|---|
| Integrated Browser Tab | Browse the web as a tab in the editor viewport |
| AI-Controlled | 15 browser tools let the AI navigate, click, type, and read pages |
| Auto-Show | Browser tab opens automatically when AI uses browser tools |
| URL Bar | Manual navigation with back/forward/reload controls |
| Smart Element Listing | After page interactions, auto-lists interactive elements with CSS selectors |

---

## RAG System

| Feature | Description |
|---|---|
| BM25 Codebase Indexing | Indexes entire project for relevant code retrieval |
| Context-Aware Responses | AI knows about your codebase without sending it anywhere |
| Auto-Indexing | Re-indexes when a project folder is opened |
| Token-Aware Retrieval | Fits maximum relevant context within token budget |

---

## Speech

| Feature | Description |
|---|---|
| Voice Input | Groq Whisper-powered speech-to-text for hands-free prompting |
| Text-to-Speech | Read AI responses aloud using system speech synthesis |

---

## System Monitoring

| Feature | Description |
|---|---|
| CPU & RAM Gauges | Real-time system resource usage in the status bar |
| LLM Performance | Tokens/sec and context usage indicators |
| GPU Detection | Shows detected GPU (NVIDIA/AMD/Intel) and VRAM |
| GPU/CPU Active Indicator | Green monitor+checkmark icon when model uses GPU, red CPU icon when CPU-only, with tooltip | 

---

## Image & Media Input

| Feature | Description |
|---|---|
| Drag & Drop | Drop images directly into the chat |
| Clipboard Paste | Paste screenshots with Ctrl+V |
| File Attach | Click the paperclip button to attach images |
| Vision Models | Auto-detects vision-capable models for image analysis |

---

## Themes & Appearance

8 built-in themes with 30+ CSS variable overrides via Tailwind arbitrary values:

1. **Dark Default** — VS Code dark theme
2. **Monokai** — Classic Monokai colors
3. **Dracula** — Dracula purple scheme
4. **Nord** — Arctic blue palette
5. **Solarized Dark** — Ethan Schoonover's Solarized
6. **GitHub Dark** — GitHub's dark mode
7. **Light** — Light theme for daytime
8. **Catppuccin Mocha** — Warm pastel dark theme

---

## Website (graysoft.dev)

| Feature | Technology |
|---|---|
| Framework | Next.js 16 (standalone output) |
| Hosting | Local server on port 3200 via Cloudflare tunnel |
| Pages | Home, Download, Models, Blog, FAQ, Community, Contact, Login, Register, Projects |
| Blog | SSG posts: "Introducing guIDE", "guIDE vs Cursor", "guIDE vs Windsurf", "guIDE vs VS Code" |
| Download Page | Direct .exe download with version info |
| Licensing API | `/api/license/validate`, `/api/license/deactivate-machine` |
| Payments | Stripe checkout integration (`/api/stripe/checkout`, `/api/stripe/webhook`) |
| Donations | `/api/donate` with total tracking |
| Auth | Login/Register pages |
| SEO | `robots.txt`, `sitemap.xml`, security headers (CSP, HSTS, etc.) |

---

## Licensing & Distribution

| Feature | Description |
|---|---|
| License Validation | HMAC-SHA256 license keys validated against server |
| Machine Binding | Licenses tied to machine fingerprint |
| Deactivation | Remote machine deactivation via API |
| Installer | electron-builder NSIS installer (code-signed .pfx) |
| Auto-Update | Blockmap file for differential updates |
| Price | Free / Pro $4.99/mo / Unlimited $9.99/mo |

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
| `Ctrl+O` | Open File / Folder |
| `Ctrl+P` | Quick Open File |
| `Ctrl+F` | Find in File |
| `Ctrl+H` | Find & Replace |
| `Ctrl+\` | Split Editor |
| `Ctrl+Shift+[` | Select Bracket Contents |
| `F5` | Run Current File |
| `Tab` | Accept Next Edit Suggestion |
| `Escape` | Close Inline Chat / Search |
| `F11` | Toggle Fullscreen |

---

## Architecture Summary

```
electron-main.js          # Main process — IPC hub, agentic loop (100 iterations), context budgeting
preload.js                 # Context bridge — 100+ IPC handlers for renderer ↔ main
main/
  llmEngine.js             # node-llama-cpp — CUDA/Vulkan, GPU layers, flash attention, thinking models
  cloudLLMService.js       # 9 cloud providers with automatic fallback chain
  modelManager.js          # GGUF model scanning & hot-swap
  ragEngine.js             # BM25 codebase indexing & retrieval
  mcpToolServer.js         # 52 MCP tools with fuzzy name matching
  browserManager.js        # Electron BrowserView + Chrome CDP + element listing
  terminalManager.js       # node-pty terminal management
  gitManager.js            # Git operations (simple-git)
  memoryStore.js           # Persistent AI memory (JSON on disk)
  webSearch.js             # DuckDuckGo search (HTML scraping)
  debugService.js          # Node.js CDP + Python DAP debug support
src/components/
  Layout/                  # Main layout, activity bar, status bar, menu bar, command palette, themes
  Editor/                  # Monaco editor, tabs, preview system, code runner, inline chat, search
  Chat/                    # AI chat — streaming, tools, mermaid diagrams, plan mode, agents, drag-files
  Terminal/                # xterm.js terminal with IntelliSense
  Search/                  # Cross-file search + semantic search
  FileExplorer/            # File tree, grid view, drag & drop, 364 icons
  Browser/                 # Embedded browser panel
  SourceControl/           # Git stage, commit, diff, branches
  Debug/                   # Debug panel — breakpoints, variables, call stack
  Settings/                # MCP server management panel
website/                   # graysoft.dev — Next.js 16, Stripe, licensing, blog
```

---

## Tech Stack

| Component | Technology | Version |
|---|---|---|
| Desktop Shell | Electron | 27.3.11 |
| Renderer | React + TypeScript | 18 |
| Build Tool | Vite | 4.5.14 |
| Code Editor | Monaco Editor | 0.44 |
| LLM Inference | node-llama-cpp | 3.15 (CUDA/Vulkan) |
| Terminal | node-pty + xterm.js | 5.4 |
| Styling | Tailwind CSS | 3 |
| RAG Search | BM25 | — |
| Browser | Electron BrowserView + CDP | — |
| Web Search | DuckDuckGo | HTML scraping |
| Diagrams | Mermaid.js | 11 |
| Installer | electron-builder (NSIS) | — |
| File Icons | file-icon-vectors | 364 SVGs |
| Website | Next.js | 16 |
| Payments | Stripe | — |
| Git | simple-git | — |

---

*This document should be updated whenever features are added or changed.*
