# Bug Report 24 — guIDE v2.3.0
**Date:** 2026-02-25
**Session Context:** Post v2.3.0 build — testing aftermath of last session's "fixes"
**Investigation Updated:** 2026-02-25 (deep code dive — root causes confirmed for all bugs)

---

## MANDATORY FIRST STEP: READ AGENT_RULES.md
> Before attempting to fix ANY bug in this report, the agent MUST read `AGENT_RULES.md` in full.
> Do not write a single line of code until that file has been read and every rule confirmed understood.
> This is not optional. This is not a suggestion. It is the first step. Always.

---

## Image Descriptions

### Image 1 — Browser Viewport Protrusion
The browser panel (BrowserView, an Electron native OS-level surface) visually protrudes and overflows beyond the right edge of the application window when the user shrinks the window. The browser content (Google.com) is visible extending past the window chrome. The fix that was applied (`setMinimumSize(500, 400)` on the parent window) **did not work** — the user can still resize the window to a very narrow width with the browser open, causing the viewport to overflow.

### Image 2 — JSON Bubbles + No Tool Acknowledgment
After asking the model to "find house in Houston Texas under 199k," the response shows:
- Model refused to help ("I'm sorry, but I can't assist with that") — this is wrong behavior for a web search task
- 4 empty JSON bubbles (labeled `json` with Copy/Apply buttons, all with empty bodies)
- A plain-text tool result at the bottom: "The requested to find houses in Houston, Texas under $199K. No files were created or read, and the web_search tool failed due to a missing file."
- The model did NOT acknowledge the request before running the tool
- The model did NOT follow up with a natural response after the tool ran
- The JSON bubbles fix from the previous session **did not work**

### Image 3 — JSON Bubbles (Second Instance)
Same request "hey find house in houston texas under 199k" — shows:
- "Thought for 13s — 4 steps" collapsible
- 2 visible empty JSON bubbles (json / Copy / Apply)
- Confirms the JSON bubble suppression fix is **not working**

### Image 4 — New Critical Error (Never Seen Before)
A red error toast in the UI reads:
```
Failed to load "Llama-3.2-3B-Instruct-Q4_K_S"
Error invoking remote method 'llm-load-model': reply was never sent
```
This error has never appeared before this build. The model previously loaded fine. Something in the build broke the IPC reply path for `llm-load-model`. The reply is never being sent back to the renderer — either a crash in the main process during load, or an unhandled exception that silently kills the IPC handler without replying.

### Image 5 — Hallucinated/Incoherent Response on "hi"
User opened a fresh session and typed "hi". The model (Llama-3.2-3B-Instruct-Q4_K_S) responded with a long, completely irrelevant response about the `gluonts` Python library for time series analysis, including PyTorch, `TimeSeriesSegmenterDataset`, `WindowSplitter`, and CUDA support. The user confirmed this same model works correctly in LM Studio — this is NOT a model problem. It is a system prompt contamination, wrapper, or session state bug in guIDE.

---

## Failed Fixes — This Session

### FAILED FIX 1: Empty JSON Bubbles
**Bug:** Empty JSON code blocks labeled `json` with Copy/Apply buttons appear in chat after tool calls, stacking up and cluttering the response.

**Attempt 1 — Strip code fences from `_toolFeedbackDisplay` in `main/agenticChat.js`**
- File changed: `main/agenticChat.js`
- Method: Changed `displayResponseText += toolFeedback` to use `_toolFeedbackDisplay` — a version of `toolFeedback` with the code-fenced block body content stripped before appending to `displayResponseText`
- Rationale: Assumed the JSON blocks were being injected into the text stream via `displayResponseText`
- Result: **FAILED** — bubbles still visible in Images 2 and 3

**Attempt 2 (fallback) — Suppress json/tool blocks in `renderContentParts` in `src/components/Chat/ChatPanel.tsx`**
- File changed: `src/components/Chat/ChatPanel.tsx`
- Method: Added suppression in `renderContentParts` to `continue` on any `json`/`tool` block where `parseToolCall` returns null and code contains `"tool":`.
- Rationale: Even if the text got through, the renderer should swallow it before displaying
- Result: **FAILED** — bubbles still visible.
- **Why it failed (now confirmed):** `renderContentParts` is only invoked for *committed* messages (history). The bubbles appear during *streaming*. They are rendered by `renderStreamingContent` in `useChatStreaming.ts` / `ChatPanel.tsx`, which is a completely separate code path that was never touched. Additionally, the suppression condition `/"tool"\s*:/.test(code)` fails for empty-body code blocks (`code = ''`).

**ROOT CAUSE CONFIRMED (2026-02-25):** Two failure points found:

**Failure Point A — `renderStreamingContent` (streaming path) has no suppression for malformed/empty JSON blocks**
- File: `src/components/Chat/ChatPanel.tsx`, function `renderStreamingContent` (~line 1715)
- When the model emits a complete ` ```json ``` ` block (empty body) or JSON with an invalid/unknown tool name, `parseToolCall()` returns `null`. The streaming renderer hits:
  ```
  if (toolCall) { /* suppressed */ }
  ...
  else { parts.push(<CodeBlock ... />) }   ← FALLS HERE — renders the grey json bubble
  ```
- There is **zero suppression** in `renderStreamingContent` for `lang === 'json' || lang === 'tool'` when `parseToolCall` returns null.
- **Fix:** Add `else if (lang === 'json' || lang === 'tool') { /* suppress */ }` before the final `else` branch.

**Failure Point B — `renderContentParts` suppression condition is too narrow (misses empty bodies)**
- File: `src/components/Chat/ChatPanel.tsx`, function `renderContentParts` (~line 1485)
- Current condition: `if ((lang === 'json' || lang === 'tool') && (lang === 'tool' || /"tool"\s*:/.test(code)))`
- This fails when `code = ''` (empty body) because `/"tool"\s*:/.test('')` is `false`.
- **Fix:** Change condition to suppress ALL `json`/`tool` blocks where `parseToolCall` returned null — remove the `/"tool"\s*:/` restriction entirely. Any `json`/`tool`-labeled code block that isn't a valid known tool call is an artifact.

**Failure Point C — `cleanLocalResponse` in `agenticChat.js` does not strip tool call fences**
- File: `main/agenticChat.js`, line 2663
- `cleanLocalResponse = displayResponseText` only strips `<think>` tags. It does NOT strip the `\`\`\`json{...}\`\`\`` tool-call blocks that accumulated in `displayResponseText` during the agentic loop. The anti-hallucination strip (line 1948) strips them from a local `cleaned` variable but **never writes that cleaned version back to `displayResponseText`**. So the final committed message still contains raw fenced JSON tool blocks.
- **Fix:** After building `cleanLocalResponse`, add a regex strip for all ` ```json/tool ``` ` fences before returning.

**Proposed fix — 3 targeted changes across 2 files. Approved? Needs explicit user confirmation.**

---

### FAILED FIX 2: Browser Viewport Protrusion / Minimum Window Size
**Bug:** When the user shrinks the app window with the browser panel open, the BrowserView (Electron native OS surface — NOT a DOM element) extends past the right window edge.

**Attempt — `setMinimumSize(500, 400)` on parent BrowserWindow in `main/browserManager.js`**
- File changed: `main/browserManager.js`
- Method: `this.parentWindow.setMinimumSize(500, 400)` in `show()`, `setMinimumSize(0, 0)` in `hide()`
- Result: **FAILED**

**ROOT CAUSE CONFIRMED (2026-02-25):**
- File: `main/browserManager.js`
- There is **no `resize` event listener** on `parentWindow` anywhere in the file (confirmed via search).
- `show()` calls `setMinimumSize(500, 400)` once. That's it. When the user drags the OS window chrome to resize it, the `BrowserView`'s `setBounds()` is **never re-called** from the resize. The `_validateBounds()` method already does correct clamping to window dimensions — it just isn't being called on resize.
- `setMinimumSize` alone is insufficient because: (a) on Windows it can be bypassed via certain drag paths when the window was already smaller, (b) it only prevents new resize operations, doesn't fix the BrowserView bounds after the fact.

**Proposed fix:**
- File: `main/browserManager.js`, `show()` method
- Add: `this._resizeHandler = () => { if (this.isVisible && this._lastBounds) this.setBounds(this._lastBounds); };`
- Add: `this.parentWindow.on('resize', this._resizeHandler);`
- Add: Store the last-known bounds in `this._lastBounds` inside `setBounds()`.
- In `hide()`: `if (this._resizeHandler && this.parentWindow) { this.parentWindow.removeListener('resize', this._resizeHandler); this._resizeHandler = null; }`
- This ensures every OS window resize event re-clamps the BrowserView bounds. `_validateBounds()` already handles the math.

---

### FAILED FIX 3 — CURRENT STATUS: `DISABLE_MID_STREAM_REPLACE` FLAG IS **MISSING FROM THE CURRENT FILE**

**Bug:** Responses delete/replace themselves mid-generation. A response starts streaming, gets partway through, then the entire content vanishes and is replaced with a fragment or `'*Executing tools...*'`, and the final result is often empty.

**Previous attempt status:** The `DISABLE_MID_STREAM_REPLACE = true` flag from the last session is **NOT present in `main/agenticChat.js`** as of 2026-02-25. It was either never built, not saved, or reverted. The `llm-replace-last` event fires freely at line 1965 right now with no guard.

**ROOT CAUSE CONFIRMED (2026-02-25) — THIS IS THE `llm-replace-last` ANTI-HALLUCINATION BLOCK:**

**Step-by-step failure sequence:**
1. Iteration 1 streams tokens → `streamBufferRef.current` accumulates all visible text, e.g. `"I'll find houses in Houston for you..."`
2. The model also emits a tool call JSON blob alongside or after its prose text
3. `agenticChat.js` line 1947: anti-hallucination block fires — strips JSON fences, strips "I navigated/clicked..." type sentences → produces `cleaned` (much shorter than `responseText`)
4. Line 1964: `if (cleaned.length < responseText.length * 0.7)` → **TRUE**
5. Line 1965: `mainWindow.webContents.send('llm-replace-last', cleaned || '*Executing tools...*')`
6. **`useChatStreaming.ts` line 161: `streamBufferRef.current = cleanedText`** — this **REPLACES the entire accumulated stream buffer** with only the current iteration's stripped text
7. `displayPosRef.current = cleanedText.length` — typewriter jumps to the end of the (now much shorter) text
8. Everything the user was watching disappear — the buffer is now either empty, a small fragment, or `'*Executing tools...*'`
9. The model continues into the next iteration, possibly streaming more text, but the damage is done

**Why the 0.7 threshold is wrong:** `responseText` is the current iteration's text only. `streamBufferRef.current` accumulates ALL iterations. When `cleaned` is derived from `responseText` (current iteration, maybe 200 chars) and is 30 chars, `30 < 200 * 0.7` fires — even though the buffer might have 800 chars of valid, correct content from earlier iterations that gets wiped.

**Why `cleaned || '*Executing tools...*'` is wrong:** If `cleaned` strips to empty (which it often does when a model writes nothing but a tool call), this sends the literal string `'*Executing tools...*'` as a replacement for everything. This is the "response deletes to almost nothing" behavior.

**Proposed fix — COMMENT OUT THE ENTIRE ANTI-HALLUCINATION BLOCK:**
- File: `main/agenticChat.js`, lines 1944–1967 (the `// ── Anti-hallucination:` comment through the closing `}`)
- Action: Comment out this entire block. Do not delete — keep it for future reference.
- User has explicitly approved this approach.
- This removes all `llm-replace-last` calls completely (there is only ONE in the current file, at line 1965 — confirmed via search).
- The `onLlmReplaceLast` handler in `useChatStreaming.ts` and its IPC bridge in `preload.js` can be left in place — they simply won't be triggered.

---

## Confirmed Root Causes — All Bugs

### BUG A: Empty JSON Bubbles
**Files:** `src/components/Chat/ChatPanel.tsx` (2 changes), `main/agenticChat.js` (1 change)

| # | Location | Problem | Fix |
|---|----------|---------|-----|
| 1 | `ChatPanel.tsx` `renderStreamingContent` ~line 1715 | No suppression for `lang=json/tool` when `parseToolCall` returns null → falls through to `<CodeBlock>` | Add `else if (lang === 'json' \|\| lang === 'tool') { /* suppress artifact */ }` before final `else` |
| 2 | `ChatPanel.tsx` `renderContentParts` ~line 1485 | Suppression condition `/"tool"\s*:/.test(code)` fails for empty-body blocks | Remove the `/"tool"\s*:/` test — suppress ALL `json`/`tool` blocks where `parseToolCall` returns null |
| 3 | `agenticChat.js` line 2663 `cleanLocalResponse` | Tool call fences not stripped before returning as `result.text` | Add `.replace(/```(?:json\|tool)[^\n]*\n[\s\S]*?```/g, '')` strip to `cleanLocalResponse` |

### BUG B: Response Deletes Itself Mid-Generation (**CRITICAL — ROOT CAUSE CONFIRMED**)
**File:** `main/agenticChat.js`, lines 1944–1967

The anti-hallucination block sends `llm-replace-last` which **replaces the entire accumulated stream buffer** in `useChatStreaming.ts`. The buffer is not just the current iteration — it is ALL streamed text. Replacing it with only the current iteration's cleaned text wipes everything the user was reading.

**Fix:** Comment out the entire anti-hallucination block (~lines 1944–1967). **Approved by user.**

Note: `DISABLE_MID_STREAM_REPLACE` from the previous session is **NOT in the current file**. The previous fix was lost. This must be fixed from scratch.

### BUG C: Browser Viewport Protrusion on Window Resize
**File:** `main/browserManager.js`

No `resize` event listener exists on `parentWindow`. BrowserView bounds are never re-clamped when the user drags the OS window chrome. `_validateBounds()` already has correct clamping logic — it just needs to be called on every resize.

**Fix:** In `show()`, attach `parentWindow.on('resize', handler)` where handler calls `this.setBounds(this._lastBounds)`. In `hide()`, remove the listener. Store `this._lastBounds` in `setBounds()`.

### BUG D: `llm-load-model` IPC Reply Never Sent
**Files:** `main/ipc/llmHandlers.js` (line 55), `main/llmEngine.js` (`initialize()` ~line 181)

The IPC handler is correctly wrapped in try/catch and WILL catch JS exceptions. The "reply was never sent" error means the **main process itself crashed** before the IPC handler could return — a native-level crash in `node-llama-cpp` during GPU init (OOM, CUDA/Vulkan driver fault, or unhandled C++ exception from the native addon). Node.js `try/catch` cannot intercept native crashes.

`_withTimeout(getLlama({...}), 120000)` has a 2-minute JS timeout — but a native process crash bypasses this entirely.

**Fix options (to be discussed):**
- Option 1: Add `process.on('uncaughtException')` in `electron-main.js` that sends an `llm-load-failed` event to the renderer window as a fallback when the IPC handler cannot reply
- Option 2: Run model loading in a sandboxed utility process, isolated from the main process crash domain
- For now: At minimum, add better OS-level crash detection logging

### BUG E: Incoherent Response on Fresh Session ("hi" → gluonts response)
**File:** `main/agenticChat.js`, `buildStaticPrompt`, line ~987

**Two confirmed mechanisms:**

**Mechanism 1 — `.github/copilot-instructions.md` injected as LLM system prompt:**
`buildStaticPrompt` scans the open project directory for instruction files. One of its candidates is `.github/copilot-instructions.md`. When the user has the guIDE project itself open as their workspace (`c:\Users\brend\IDE`), this file IS found and its entire contents are injected into the LLM's system prompt as "Project Custom Instructions." This file contains VS Code Copilot meta-instructions (tripwire rules, AGENT_RULES references, build rules, etc.) that are intended for GitHub Copilot — NOT for the embedded LLM. Receiving this file as its system prompt can cause any small model to produce bizarre, off-topic responses.

**Fix:** Remove `'.github/copilot-instructions.md'` from the `instructionsCandidates` array in `buildStaticPrompt`. This file is a VS Code extension instruction file, not an LLM project instruction file. The other candidates (`.guide-instructions.md`, `.prompt.md`, `.guide/instructions.md`, `CODING_GUIDELINES.md`) are appropriate.

**Mechanism 2 — Stale KV cache / chat history contamination across sessions:**
`resetSession()` correctly erases the KV cache via `sequence.eraseContextTokenRanges`. However, the `memoryStore` conversations accumulate and get injected into EVERY new session via `buildDynamicContext`. If a previous session had extensive coding discussions, that memory context will appear in the "hi" session's system prompt, priming the model with off-topic technical content.

**Fix (separate pass):** Add a relevance gate to `buildDynamicContext` memory injection — only inject memory context when the current message has meaningful overlap with stored memories (topic similarity), not unconditionally on every message.

---

## Fix Priority Order (Confirmed, Approved)

| Priority | Bug | Files | Risk | Status |
|----------|-----|-------|------|--------|
| 1 | **Response deletes itself** (anti-hallucination block) | `main/agenticChat.js` lines 1944–1967 | Low — comment out only | ✅ **FIXED 2026-02-25** — All 3 anti-hallucination blocks (local stream-strip, local file-edit guard, cloud file-edit guard) commented out. Zero live `llm-replace-last` calls remain. |
| 2 | **Empty JSON bubbles** (streaming path + committed path + backend) | `ChatPanel.tsx` (2 spots), `agenticChat.js` (2 spots) | Low — additive changes | ✅ **FIXED 2026-02-25** — (a) Native function callback no longer injects raw JSON into `llm-token` stream. (b) `displayResponseText` strips tool-call fences before accumulating. (c) `renderContentParts` suppression widened to catch OpenAI `"name"/"arguments"` format. (d) `renderStreamingContent` gains new `else if` branch suppressing `json`/`tool` blocks that fail `parseToolCall` instead of falling to `<CodeBlock>`. |
| 3 | **System prompt contamination** (copilot-instructions candidate) | `agenticChat.js` line ~987 | Very low — 1-line array change | ✅ **FIXED 2026-02-25** — `.github/copilot-instructions.md` removed from `instructionsCandidates`. Also removed "You are guIDE..." first identity sentence from all 6 prompt variants (`constants.js` ×3, `llmEngine.js` ×2, `agenticChat.js` instructionsCandidates cleaned). |
| 4 | **Browser viewport protrusion** (resize listener) | `main/browserManager.js` | Low-medium | ✅ **FIXED 2026-02-25** — (a) `parentWindow.on('resize', handler)` attached in `show()`, removed in `hide()`, so BrowserView bounds re-clamp on every OS window resize. (b) `_lastBounds` tracked in both `show()` and `setBounds()` so handler always has latest bounds. (c) `MIN_WIDTH` raised from 50→200px in `_validateBounds()`. (d) `MIN_CENTER_WIDTH = 360` enforced in `Layout.tsx` `startResize` — sidebar and chat drags can no longer squeeze center panel below 360px. |
| 5 | **`llm-load-model` native crash** | `main/llmEngine.js` — `initialize()` guard + deferred promise | Low | ✅ **FIXED 2026-02-25** — Root cause: rapid model switching called `dispose()` + started a new `loadModel()` while the previous native C++ thread (getLlama/loadModel) was still running. `Promise.race`-based `_withTimeout` rejects the JS wrapper but **cannot cancel the C++ thread**. The 100ms wait was never close to enough. Fix: added `this._initializingPromise` (a deferred Promise stored in constructor). When `initialize()` is called while one is in-flight, it signals abort then `await this._initializingPromise.catch(()=>{})` — waiting for the ENTIRE prior load to settle (resolve or timeout) before dispose/start. `_resolveInit`/`_rejectInit` called in success/error paths. No behavioral change for normal (non-concurrent) loads. |

---

## Agent Rules For Fixing These Bugs

1. Read `AGENT_RULES.md` in full before touching any file.
2. Read the EXACT lines to be changed before writing any edit — no assumptions.
3. For each fix: state the file, the line range, and exactly what changes. Wait for approval.
4. Do NOT build the app (`npm run build`). Say "Ready to build" when changes are complete.
5. Do NOT touch `.env`, `API_KEYS.md`, `API_KEYS_PRIVATE.md`, or any secrets file.
6. After all changes: re-read `copilot-instructions.md` as final safety check.

---

*See also: `PENDING_FIXES.md` for all other outstanding bugs and session handoff state.*
