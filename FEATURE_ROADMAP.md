# guIDE Feature Roadmap — Full Implementation Plan

> All features below are planned for full implementation. Ranked by impact and grouped into tiers.

---

## Tier 1 — Game-Changing Features (Highest Impact)

### 1. Inline AI Code Completions (Ghost Text)
**Priority:** CRITICAL  
**Impact:** This is THE feature that makes Copilot/Cursor sticky  
**Description:** As the user types, show faded ghost-text suggestions inline in the editor (like GitHub Copilot). Tab to accept, Esc to dismiss.  
**Implementation:**
- Hook into CodeMirror's `updateListener` to detect typing pauses (~300ms debounce)
- Send the current line + surrounding context (±50 lines) to the LLM (local or cloud)
- Use a `Decoration.widget` or `StateField` to render ghost text after cursor
- Tab keymap to accept and insert the completion
- Support multi-line completions (show first line inline, expand on hover)
- Use the fastest available model (Cerebras/Groq cloud, or local small model)
- Cache recent completions to avoid redundant API calls

### 2. AI Code Actions in Editor (Cursor-Style)
**Priority:** CRITICAL  
**Impact:** In-editor AI actions without switching to chat panel  
**Description:** Select code → right-click or Cmd+K → "Explain", "Refactor", "Fix", "Add Tests", "Add Comments", "Optimize"  
**Implementation:**
- Add context menu items to CodeMirror editor
- Floating command palette (Cmd+K) that appears at cursor position
- Show AI response as an inline diff or floating panel
- Support "Apply" button to accept changes directly
- Stream response into a split diff view (original vs modified)

### 3. Visual Diff & Merge Tool
**Priority:** HIGH  
**Impact:** Critical for code review, AI-generated changes, and git workflows  
**Description:** Side-by-side diff viewer for any two versions of a file. AI can explain changes.  
**Implementation:**
- CodeMirror merge extension (`@codemirror/merge`)
- Show diffs when AI modifies files (before/after with accept/reject per hunk)
- Git integration: view diffs for uncommitted changes, staged changes, between branches
- "AI Explain Diff" button that summarizes what changed and why

### 4. Voice Coding & Dictation
**Priority:** HIGH  
**Impact:** Accessibility + hands-free coding is a major differentiator  
**Description:** Hold a hotkey to dictate code instructions or commands via speech-to-text  
**Implementation:**
- Web Speech API (built into Chromium/Electron) for basic speech recognition
- Whisper model (local via whisper.cpp or cloud via Groq) for high-accuracy transcription
- Push-to-talk button in chat panel
- Voice commands: "open file X", "go to line N", "run terminal command", "explain this function"
- Show transcription in real-time with confidence indicator

---

## Tier 2 — Power User Features

### 5. Database Viewer & Query Builder
**Priority:** MEDIUM-HIGH  
**Impact:** Makes guIDE a full-stack IDE, not just a code editor  
**Description:** Connect to SQLite/PostgreSQL/MySQL databases, browse tables, run queries with AI assistance  
**Implementation:**
- SQLite viewer (via `better-sqlite3` or `sql.js`)
- PostgreSQL/MySQL via `pg` and `mysql2` packages
- Table browser with column types, row counts, preview data
- SQL editor with syntax highlighting and AI-powered query generation
- "Ask AI" button: describe what you want in English → AI generates SQL
- Results displayed in a data grid with sorting, filtering, export

### 6. Project Templates & Scaffolding
**Priority:** MEDIUM-HIGH  
**Impact:** Huge for onboarding new users, lowest implementation effort  
**Description:** "New Project" wizard with templates for common stacks  
**Templates to include:**
- React + TypeScript + Vite
- Next.js (App Router)
- Express + Node.js API
- Python Flask/FastAPI
- Electron Desktop App
- Static HTML/CSS/JS
- Chrome Extension
- Discord Bot (Node.js)
- CLI Tool (Node.js)
**Implementation:**
- Template registry (JSON manifest with git URLs or embedded templates)
- `create-project` dialog: pick template → name → folder → scaffold
- AI customization: "Create a React app with Tailwind and Supabas SSH connections  
- Remote file system adapter (list, read, write, rename, delete via SFTP)
- Terminal connected to remote shell
- Saved connection profiles e auth"
- Post-scaffold: auto-open in guIDE, run `npm install`, show README

### 7. Remote SSH / Container Development
**Priority:** MEDIUM  
**Impact:** Enterprise users, remote server editing  
**Description:** SSH into remote servers and edit files as if local  
**Implementation:**
- `ssh2` package for(host, port, key, username)
- AI assistance works on remote files (context injection)
- Optional: Docker container attach (similar to VS Code Dev Containers)

### 8. Performance Profiler & Diagnostics
**Priority:** MEDIUM  
**Impact:** Developer productivity for optimization tasks  
**Description:** Profile Node.js/Python scripts, identify bottlenecks, AI explains optimization opportunities  
**Implementation:**
- Node.js: `--prof` flag → parse tick processor output → flame chart visualization
- Python: `cProfile` integration → parse stats → visualization
- Memory profiler: heap snapshots, leak detection
- AI analysis: "This function takes 45% of CPU time because of O(n²) nested loops"
- Timeline view with call stacks

---

## Tier 3 — Polish & Ecosystem Features

### 9. Plugin / Extension System
**Priority:** MEDIUM  
**Impact:** Community ecosystem, extensibility  
**Description:** Allow users to install community-built extensions  
**Implementation:**
- Extension API (register commands, add panels, modify editor behavior)
- Extension manifest format (JSON)
- Extension marketplace (simple registry, can start with GitHub-hosted)
- Sandboxed execution (extensions run in worker threads)
- Built-in extensions to start: themes, language packs, snippet libraries

### 10. AI-Powered Git Workflow
**Priority:** MEDIUM  
**Impact:** Streamlines version control for all skill levels  
**Description:** Enhanced git integration with AI commit messages, PR descriptions, branch management  
**Implementation:**
- AI auto-generates commit messages from diff analysis
- "Explain this commit" button in git history
- PR/MR description generator (connects to GitHub/GitLab API)
- Branch visualization (simple graph view)
- AI conflict resolution: suggests merge conflict solutions
- Interactive rebase assistant

### 11. Collaborative Editing (Live Share)
**Priority:** LOW-MEDIUM  
**Impact:** Pair programming, teaching, team use  
**Description:** Share your editor session with others for real-time collaborative editing  
**Implementation:**
- WebRTC or WebSocket-based CRDT synchronization
- Cursor presence (show other users' cursors and selections with colors)
- Follow mode (auto-scroll to what the host is looking at)
- Chat sidebar within shared session
- Permission levels: view-only, edit, full control

### 12. Notebook / REPL Mode
**Priority:** LOW-MEDIUM  
**Impact:** Data science, prototyping, learning  
**Description:** Interactive code cells (like Jupyter) with inline output  
**Implementation:**
- Cell-based editor mode (markdown + code cells)
- Execute Python/Node.js cells with inline output
- Rich output rendering (charts, tables, images)
- Export to `.ipynb` format
- AI can generate and explain cells

### 13. AI Code Review
**Priority:** LOW-MEDIUM  
**Impact:** Code quality improvement  
**Description:** Run AI code review on staged changes or entire files  
**Implementation:**
- "Review" button in file explorer and git panel
- AI analyzes code for: bugs, security issues, performance, style
- Inline annotations (like GitHub PR review comments)
- Severity levels: critical, warning, suggestion
- "Fix" button on each finding that applies the AI's suggestion

### 14. Smart Search & Navigation
**Priority:** LOW  
**Impact:** Productivity for large codebases  
**Description:** Semantic code search beyond just text matching  
**Implementation:**
- Go to definition, find references (via Tree-sitter)
- Semantic search: "find the function that handles user authentication"
- Symbol outline panel (functions, classes, exports)
- Breadcrumb navigation (file > class > method)
- AI-powered "find similar code" across the project

### 15. Integrated Documentation Generator
**Priority:** LOW  
**Impact:** Documentation quality  
**Description:** Auto-generate docs from code  
**Implementation:**
- Generate JSDoc/TSDoc/docstrings for all functions in a file
- Generate README.md from project structure
- API documentation from Express/FastAPI routes
- Architecture diagram generation (mermaid)
- "Explain this codebase" summary generator

---

## Implementation Order (Suggested)

| Phase | Features | Timeline |
|-------|----------|----------|
| **Phase 1** | #6 Templates, #1 Inline Completions | Next sprint |
| **Phase 2** | #2 Code Actions (Cmd+K), #3 Diff View | Following sprint |
| **Phase 3** | #10 AI Git, #4 Voice | Sprint 3 |
| **Phase 4** | #5 Database, #13 Code Review | Sprint 4 |
| **Phase 5** | #8 Profiler, #14 Search, #15 Docs | Sprint 5 |
| **Phase 6** | #7 SSH, #9 Plugins, #11 Collab, #12 Notebook | Future |

---

## Notes

- Features #1 and #2 (inline completions + code actions) are the highest priority because they're what make Cursor/Copilot sticky — users interact with them dozens of times per session
- Feature #6 (templates) has the highest bang-for-buck: minimal implementation effort, massive UX improvement for new users
- All cloud AI features should work with the pre-seeded free-tier keys (Groq, Cerebras, SambaNova) so they work out-of-box
- Local model features should degrade gracefully when no model is loaded
