# guIDE v2.0.0 — Full Feature Testing Checklist

> Generated: 2026-02-20 | Use this after installing `guIDE-Setup-2.0.0.exe`
>
> **Log Monitoring:** After launching the app, tail the log file in a PowerShell window:
> ```powershell
> Get-Content "$env:APPDATA\guide-ide\logs\guide-main.log" -Wait -Tail 80
> ```
> The log default is now **DEBUG** level — every internal call is captured.

---

## Before You Start

- [ ] Install `dist-electron\guIDE-Setup-2.0.0.exe` (388.9 MB)
- [ ] Open PowerShell and start the log monitor:
  ```powershell
  Get-Content "$env:APPDATA\guide-ide\logs\guide-main.log" -Wait -Tail 80
  ```
- [ ] Open a second PowerShell window for running test scripts (Python/JS etc.)
- [ ] Have a test project folder ready (anything with .js, .py, .html files)

---

## 1. App Launch & UI

- [ ] App launches without crash or splash error
- [ ] Custom titlebar shows "guIDE" text in Audiowide brand font
- [ ] Status bar visible at bottom (CPU %, RAM %)
- [ ] Activity bar visible on left (icons for Explorer, Search, Git, Debug, Extensions, Browser)
- [ ] Welcome screen appears in editor area (keyboard shortcuts listed)
- [ ] F11 — toggles fullscreen
- [ ] CPU & RAM gauges update in real-time in status bar

---

## 2. File Explorer (`Ctrl+Shift+E`)

- [ ] Panel opens/closes with `Ctrl+Shift+E`
- [ ] Open a folder — `Ctrl+O` → pick a project dir → file tree populates
- [ ] Folder tree is collapsible/expandable
- [ ] Click a file → opens in editor tab
- [ ] Right-click file → context menu: Rename, Delete, New File, New Folder, Copy Path
- [ ] Create a new file via right-click → appears in tree
- [ ] Create a new folder via right-click → appears in tree
- [ ] Rename a file → name changes in tree and tab
- [ ] Delete a file → removed from tree
- [ ] Drag a file to a new folder → moves successfully
- [ ] Drop a file from Windows Explorer into the tree → file appears
- [ ] Grid view toggle (if present) — switches to icon grid layout
- [ ] Multi-select: `Ctrl+Click` multiple files
- [ ] `Ctrl+C` / `Ctrl+V` to copy/paste a file

---

## 3. Core Editor

- [ ] Open a file — correct syntax highlighting for language
- [ ] Edit content — "●" dirty indicator on tab
- [ ] `Ctrl+S` — saves file, dirty indicator disappears
- [ ] `Ctrl+Shift+S` — saves all open files
- [ ] `Ctrl+N` — creates a new untitled file
- [ ] `Ctrl+P` — Quick Open: fuzzy-search by filename, press Enter to open
- [ ] `Ctrl+\` — Split Editor: two panes side-by-side
- [ ] Middle-click a tab — closes it
- [ ] Drag tab to reorder — order changes in tab bar
- [ ] Minimap visible on the right side of editor
- [ ] Code folding: click gutter arrow to collapse a function/block
- [ ] Bracket matching: click `{` → matching `}` is highlighted
- [ ] `Ctrl+Shift+[` — selects all content between matching brackets
- [ ] `Ctrl+F` — opens in-file Find bar
  - [ ] Search term highlights in editor
  - [ ] Regex mode toggle works
  - [ ] Case-sensitive toggle works
  - [ ] Whole-word toggle works
- [ ] `Ctrl+H` — opens Find & Replace bar
  - [ ] Replace single match
  - [ ] Replace all matches
- [ ] `Ctrl+Shift+P` — Command Palette opens; type a command name and execute it

---

## 4. Themes (`Ctrl+Shift+P` → "Switch Theme")

Test each of the 8 themes:
- [ ] Dark Default
- [ ] Monokai
- [ ] Dracula
- [ ] Nord
- [ ] Solarized Dark
- [ ] GitHub Dark
- [ ] Light
- [ ] Catppuccin Mocha

Verify: editor, sidebar, and status bar all change color.

---

## 5. AI Chat (`Ctrl+J`)

### Basic Chat
- [ ] Panel opens/closes with `Ctrl+J`
- [ ] Type a message and press Enter → response streams in
- [ ] Streaming renders token-by-token, no layout jumps
- [ ] Context window indicator (SVG ring) shows token usage near input
- [ ] Clear chat button works

### Cloud Providers
Test at least 2 cloud models:
- [ ] **Gemini 2.5 Flash** — send a message, get a response
- [ ] **Groq Llama** — send a message, get a response
- [ ] **Cerebras** — send a message, get a response
- [ ] **OpenRouter** — send a message (verify model list loads from API)

### Model Switching
- [ ] Open model picker dropdown
- [ ] Switch from one cloud model to another while idle
- [ ] If a local GGUF model is installed: load it, send a message, wait for GPU/CPU inference

### AI Capabilities
- [ ] **Mermaid diagrams** — ask: `"Draw me a mermaid flowchart of how a login system works"` → collapsible diagram renders in chat
- [ ] **Code blocks** — ask for a Python function → syntax-highlighted code block appears
- [ ] **Plan Mode** toggle — enable Plan Mode, ask AI to do something, verify it produces a plan first
- [ ] **Thinking models** — if a thinking model is selected (e.g. DeepSeek), verify `<think>` block is collapsible

---

## 6. Inline Chat (`Ctrl+I`)

- [ ] Open a code file and position cursor inside a function
- [ ] Press `Ctrl+I` → inline chat overlay appears at cursor
- [ ] Type an edit request (e.g. "add error handling to this function")
- [ ] AI response appears as a diff in the editor
- [ ] **Accept** button applies the change
- [ ] **Reject** button reverts to original
- [ ] `Escape` closes the inline chat

---

## 7. Next Edit Suggestions (Ghost Text)

- [ ] Open a TypeScript or JavaScript file
- [ ] Type something or pause after an edit
- [ ] Ghost text appears in dim/colored text suggesting the next edit
- [ ] Press `Tab` to accept the suggestion
- [ ] Ghost text disappears and suggestion is applied

---

## 8. MCP Tools (AI Tool Use)

Ask the AI each of the following and verify the tool executes correctly (watch the log for tool call entries):

### File Tools
- [ ] `"List all files in the current project"` → calls `list_directory`, returns file list
- [ ] `"Read the contents of [filename]"` → calls `read_file`, shows content
- [ ] `"Create a new file called test-mcp.txt with the text 'hello world'"` → calls `write_file`, file appears
- [ ] `"Edit test-mcp.txt and add another line"` → calls `edit_file`
- [ ] `"Delete test-mcp.txt"` → calls `delete_file`, file gone
- [ ] `"Search for all TODO comments in my project"` → calls `grep_search`
- [ ] `"Show me the project structure"` → calls `get_project_structure`

### Terminal Tool
- [ ] `"Run the command: echo hello from mcp"` → calls `run_command`, output shown

### Git Tools
- [ ] `"What are my uncommitted changes?"` → calls `git_status`
- [ ] `"Show me the git log"` → calls `git_log`
- [ ] `"What's changed in file X?"` → calls `git_diff`

### Web & Memory Tools
- [ ] `"Search the web for: latest JavaScript frameworks 2026"` → calls `web_search`
- [ ] `"Remember that my project name is guIDE test"` → calls `save_memory`
- [ ] `"What do you remember about my project?"` → calls `get_memory`

### Browser Tools
- [ ] `"Navigate to https://example.com"` → calls `browser_navigate`, browser tab opens
- [ ] `"Click the More Information link on this page"` → calls `browser_click`
- [ ] `"Get the content of this page"` → calls `browser_get_content`

---

## 9. Agentic Mode

- [ ] Ask a multi-step coding task: `"Create a new Python file, write a Flask hello-world app in it, then show me how to run it"` — verify AI chains multiple tool calls (write_file, list_directory, etc.) autonomously
- [ ] Verify iteration counter doesn't exceed 100 (watch status in chat)
- [ ] Ask to abort mid-run → generation stops
- [ ] **T2 guardrail test:** Say `"DO NOT create any files. Just show me the code for a React counter component"` → verify NO `write_file` tool call is made (AI shows code only)

---

## 10. Background Agents

- [ ] Type `/agent` in the chat input
- [ ] Provide a task for the background agent
- [ ] Verify agent status indicator appears in chat
- [ ] Agent completes the task and reports back

---

## 11. Code Runner (F5)

Test at least 3 different file types:
- [ ] **Python (.py)** — create a script with `print("Hello Python")`, press F5 → terminal opens, output shown
- [ ] **JavaScript (.js)** — create `console.log("Hello JS")`, press F5 → terminal opens, output shown
- [ ] **TypeScript (.ts)** — create `console.log("Hello TS")`, press F5 → runs via `npx tsx`
- [ ] **Bash (.sh)** — create `echo "Hello Shell"`, press F5 → runs via bash
- [ ] **HTML (.html)** — press F5 → HTML preview opens (not code runner)

---

## 12. File Preview System

Toggle preview with the **Eye icon** on the tab or the **Play button**:
- [ ] **.html** → HTML preview renders in iframe, links work
- [ ] **.md** → Markdown preview with styled headers, code blocks, tables
- [ ] **.svg** → SVG preview with zoom controls (25%-400%), background toggle
- [ ] **.json** → Collapsible tree view, keys/values colored
- [ ] **.csv** → Sortable table with row/column count
- [ ] **.yaml** → Syntax-highlighted YAML view
- [ ] **.png / .jpg** → Image displays inline

---

## 13. Terminal (`` Ctrl+` ``)

- [ ] Terminal opens with `` Ctrl+` ``
- [ ] Shell starts in the current project folder
- [ ] Can run commands: `pwd`, `ls`, `python --version`
- [ ] **Multiple tabs** — click `+` to open a second terminal tab
- [ ] Rename a terminal tab — double-click the tab name
- [ ] Close a terminal tab — click the `×`
- [ ] Terminal IntelliSense — start typing a command and verify AI suggestions appear

---

## 14. Search (`Ctrl+Shift+F`)

- [ ] Panel opens with `Ctrl+Shift+F`
- [ ] Type a search term → results appear across all project files
- [ ] Click a result → jumps to that line in the editor
- [ ] Regex mode toggle works (e.g. search `\btodo\b`)
- [ ] Case-sensitive toggle works
- [ ] Whole-word toggle works
- [ ] Semantic Search toggle — switch to semantic mode, run a query

---

## 15. Git / Source Control (`Ctrl+Shift+G`)

- [ ] In a Git repo, open Source Control panel
- [ ] Changed files list is accurate
- [ ] Click a changed file → diff view opens with `+`/`-` highlights
- [ ] Stage a file (click `+` icon)
- [ ] Write a commit message and commit
- [ ] Branch indicator in status bar shows current branch
- [ ] Create a new branch from the branch dropdown
- [ ] Checkout an existing branch
- [ ] **Git Blame** — open a file, verify inline blame decorations (author, date) appear per line

---

## 16. Debug Panel (`Ctrl+Shift+D`)

### Node.js
- [ ] Open a JavaScript file with a simple loop
- [ ] Set a breakpoint (click the gutter)
- [ ] Press F5 to start debug → execution pauses at breakpoint
- [ ] Variables panel shows local variables with correct values
- [ ] Call stack panel shows the current call chain
- [ ] Step over (`F10`), step into (`F11`), step out (`Shift+F11`)
- [ ] Continue (`F5`) resumes execution
- [ ] Remove breakpoint

### Python
- [ ] Open a Python script
- [ ] Set a breakpoint
- [ ] Start debugging → pauses at breakpoint (uses debugpy)
- [ ] Variables panel shows Python values

---

## 17. Browser Integration

- [ ] Open Browser panel via activity bar (or via AI using `browser_navigate`)
- [ ] URL bar visible — type `https://google.com` and press Enter
- [ ] Page loads inside the panel
- [ ] Back/Forward/Reload buttons work
- [ ] Ask AI: `"Go to google.com and tell me what's on the page"` → AI navigates and reads content
- [ ] Ask AI: `"Search 'electron js' on the current page"` → AI takes browser actions

---

## 18. RAG System

- [ ] Open a project with several code files
- [ ] RAG auto-indexing message appears in log (`RAG`, `Indexed`)
- [ ] Ask AI a question about the codebase: `"Where is the main configuration object defined in this project?"` — AI cites the correct file without being told

---

## 19. Speech (if microphone available)

- [ ] Click the microphone button in the chat input
- [ ] Speak a prompt → Groq Whisper transcribes it → text appears in input
- [ ] TTS: right-click an AI response and select "Read aloud" (or equivalent button)

---

## 20. Image / Vision Input

- [ ] Drag an image (.png or .jpg) into the chat input → thumbnail appears
- [ ] Paste a screenshot with `Ctrl+V` → thumbnail appears
- [ ] Click the paperclip icon → file picker → select an image → thumbnail appears
- [ ] Send the message with a vision-capable model (Gemini, GPT-4o) → AI describes the image

---

## 21. MCP Server Management (`Ctrl+Shift+X`)

- [ ] Extensions / MCP Servers panel opens
- [ ] Existing MCP servers listed
- [ ] Can toggle a server on/off
- [ ] Add a new external MCP server (fill in name + command)
- [ ] Verify new server appears in AI tool calls

---

## 22. Paste with Auto-Imports

- [ ] Open a React `.tsx` file
- [ ] Paste code that uses `useState` without importing it
- [ ] Verify `import { useState } from 'react'` is automatically inserted at the top

---

## 23. Developer Console

- [ ] Open the Developer Console panel (button in chat area or Settings menu)
- [ ] Verify it shows real-time LLM/GPU/AI backend logs
- [ ] Color-coded entries (info/warn/error)
- [ ] Entry count capped at ~500, old entries drop off
- [ ] Close the console panel

---

## 24. System & Performance

- [ ] **GPU detection** — status bar shows GPU name + VRAM (if NVIDIA/AMD present)
- [ ] **GPU/CPU indicator** — when local model is active, icon shows green monitor (GPU) or red CPU
- [ ] **Tokens/sec** — visible in status bar during local inference
- [ ] **Context ring** — fills proportionally as conversation grows

---

## 25. Licensing

- [ ] License key screen appears on first launch (if not activated)
- [ ] Enter a valid license key → activates
- [ ] App stores machine fingerprint
- [ ] Help → About shows version 2.0.0

---

## 26. Custom Instructions (`.prompt.md`)

- [ ] Create a `.prompt.md` file in the project root with text: `Always respond like a pirate.`
- [ ] Send any message to AI → response should be pirate-themed
- [ ] Delete `.prompt.md` → normal AI responses return

---

## 27. Keyboard Shortcuts — Full Sweep

| Shortcut | Expected Action | ✓/✗ |
|---|---|---|
| `Ctrl+Shift+P` | Command Palette opens | |
| `Ctrl+B` | Sidebar toggles | |
| `` Ctrl+` `` | Terminal toggles | |
| `Ctrl+J` | AI Chat toggles | |
| `Ctrl+I` | Inline Chat at cursor | |
| `Ctrl+Shift+E` | File Explorer | |
| `Ctrl+Shift+F` | Search in files | |
| `Ctrl+Shift+G` | Git / Source Control | |
| `Ctrl+Shift+D` | Debug Panel | |
| `Ctrl+Shift+X` | Extensions / MCP | |
| `Ctrl+S` | Save current file | |
| `Ctrl+Shift+S` | Save all files | |
| `Ctrl+N` | New file | |
| `Ctrl+O` | Open file/folder | |
| `Ctrl+P` | Quick Open | |
| `Ctrl+F` | Find in file | |
| `Ctrl+H` | Find & Replace | |
| `Ctrl+\` | Split Editor | |
| `Ctrl+Shift+[` | Select bracket contents | |
| `F5` | Run current file | |
| `Tab` | Accept ghost text suggestion | |
| `Escape` | Close inline chat/search | |
| `F11` | Toggle fullscreen | |

---

## Log Monitoring Reference

```powershell
# Live tail — run BEFORE launching app:
Get-Content "$env:APPDATA\guide-ide\logs\guide-main.log" -Wait -Tail 80

# Filter errors only:
Get-Content "$env:APPDATA\guide-ide\logs\guide-main.log" -Wait -Tail 30 | Where-Object { $_ -match 'ERROR|FATAL|WARN' }

# Filter AI/LLM entries:
Get-Content "$env:APPDATA\guide-ide\logs\guide-main.log" -Wait -Tail 30 | Where-Object { $_ -match 'LLM|Chat|Tool|Agent|RAG' }

# View most recent session only:
Get-Content "$env:APPDATA\guide-ide\logs\guide-main.log" | Select-Object -Last 200
```

---

## Issue Log

Use this section to record anything that fails during testing:

| # | Feature | Observed | Expected | Severity |
|---|---|---|---|---|
| | | | | |

---

*Total test items: ~120 checks across 27 categories*
