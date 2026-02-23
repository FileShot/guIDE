# guIDE — Active Bug Tracker & TODO List

_Last updated: February 21, 2026_

---

## ✅ Fixed (This Session — Build Pending)

### 1. Website (graysoft.dev) not launching from master batch file
- **Problem:** `START_DIGGABYTE_FILESHOT_ZIPDEX.bat` starts 5 websites (Diggabyte, FileShot, Zipdex, IBYTE, iStack) but was missing Graysoft/guIDE website entry → error 1033 / site never starts
- **Fix:** Added `GRAYSOFT_BAT=C:\Users\brend\IDE\website\start-graysoft.bat` to the master batch file
- **File:** `D:\FileShot.io\START_DIGGABYTE_FILESHOT_ZIPDEX.bat`

### 2. Stop button doesn't actually stop generation (just pauses)
- **Problem:** Clicking stop only aborted the current `session.prompt()` call, but the agentic loop continued on the next iteration. Also, the session retained partial context, so the next user message continued the old response.
- **Fix:** Added global `agenticCancelled` flag checked at the top of every agentic loop iteration. `llm-cancel` now sets this flag AND resets the LLM session.
- **Files:** `electron-main.js`

### 3. Clear/trash button doesn't stop generation
- **Problem:** `clearChat()` cleared the UI but didn't call `llmCancel()`, so the backend kept generating.
- **Fix:** `clearChat()` now calls `llmCancel()` and `setIsGenerating(false)` before clearing messages.
- **File:** `ChatPanel.tsx`

### 4. Toolbar menu items not working (File > Open Folder, etc.)
- **Problem:** Portal-based dropdown menus closed before `onClick` fired. The outside-click listener (`mousedown`) detected clicks on portaled dropdown items as "outside" because the portal renders in `document.body`, not inside `menuBarRef`.
- **Fix:** Added `data-menubar-dropdown` attribute to portal divs and excluded them from the outside-click handler.
- **File:** `MenuBar.tsx`

### 5. Chat input textarea not scrollable
- **Problem:** `overflow: hidden` on the textarea prevented scrolling when content exceeded max height (120px).
- **Fix:** Changed to dynamic `overflowY` — `hidden` while content fits, `auto` once it exceeds the new 200px max height.
- **File:** `ChatPanel.tsx`

### 6. Auto model loading on startup removed
- **Problem:** Model auto-loads on startup, blocking users from switching models for 1-5 minutes.
- **Fix:** Startup now just reports the default model as available without loading it. User picks and loads when ready.
- **File:** `electron-main.js`

### 7. Model loading gets stuck / can't be cancelled
- **Problem:** If a model load hangs, `isLoading` stays true and blocks all further load attempts with "Model already loading" error.
- **Fix:** Loading now cancels any in-progress load (via `loadAbortController`) and restarts. Abort check added inside the GPU mode loop.
- **File:** `llmEngine.js`

### 8. Inline tool calls showing as raw JSON text
- **Problem:** Array-format tool calls `[{"name": "web_search", ...}]` not caught by regex. Streaming/incomplete JSON objects leaked as plain text.
- **Fix:** `splitInlineToolCalls()` now handles incomplete JSON (renders as in-progress tool block), strips array brackets `[]` and trailing commas.
- **Files:** `ChatPanel.tsx`

### 9. Tool calls now render immediately when they START
- **Problem:** Tool execution indicators were tiny spinners at the bottom. Tools only appeared as full blocks after completion.
- **Fix:** `executingTools` state changed from `string[]` to `{tool, params}[]`. Now renders as full `CollapsibleToolBlock` with spinner and parameters, open by default.
- **File:** `ChatPanel.tsx`

### 10. GPU offloading improvements
- **Problem:** 2-3% GPU utilization, 90% CPU.
- **Fixes applied:**
  - Removed `maxThreads: 0` from `getLlama()` (may have been restricting threading)
  - Removed 0 from GPU layer attempts in auto mode (was allowing "GPU mode" with 0 layers = effectively CPU)
  - Added minimum 1-layer fallback before giving up on GPU
  - Changed logLevel to `info` for CUDA diagnostics
  - Added VRAM=0 detection to warn when GPU silently fell back to CPU
  - Fixed `gpuBackend` reporting (now shows "CPU" when gpuLayers=0)
- **File:** `llmEngine.js`
- ⚠️ **Note:** If GPU utilization is still low after these fixes, the root cause may be that the CUDA backend wasn't compiled/detected by node-llama-cpp. Check console logs for `[LLM] GPU backend initialized` messages.

---

---

## ✅ Recently Applied Fixes (Confirmed In Source — Built)

- **Wrapper trust list** (`llmEngine.js`): `Llama3_2LightweightChatWrapper` now trusted before Jinja, logs confirm `wrapper: Llama3_2LightweightChatWrapper`. ✅
- **pathValidator `\b` repair** (`pathValidator.js`): control character stripped. ✅
- **Streaming regex improvement** (`chatContentParser`): handles edge cases. ✅
- **History seeding blocked on first message after model switch** (`agenticChat.js` + `llmEngine.js`): `_justLoadedNewModel` flag working. ✅

---

## 🔴 PENDING FIXES — Current Session (DO NOT LOSE THESE)

### PF-1 · Model Describes Tools Instead of Calling Them
**File:** `main/agenticChatHelpers.js`
**Problem:** Some models, especially smaller ones, respond with prose like "I'll call list_directory now" or output a bash/markdown code block describing what tool they want to use — instead of outputting the JSON tool call. The model "intends" to use a tool but never actually executes it.
**What was done (wrong):** Added a `hallucinated_file_info` block that forced `list_directory`, `find_files`, `get_project_structure`. This is model-specific AND task-specific — violates Rule 7a. Must be changed.
**Correct fix:** Detect ANY assistant message that textually describes a tool call (pattern: mentions a tool name + describes what it wants to do with parameters, but emits NO actual JSON block) → send a general nudge telling the model to use the tool call format, not describe it. This must work for ALL tools, ALL messages, ALL models. Do NOT hardcode any tool names or task types.
**Detection hint:** If the parsed text contains no `{"tool":` JSON but DOES reference any known tool name as plain text (e.g., "list_directory", "write_file", "web_search"), that is a description, not an execution.

---

### PF-2 · Non-Thinking Models Getting Thought Token Budget Applied
**File:** `main/modelProfiles.js` and/or `main/llmEngine.js`
**Problem:** The `qwen/small` profile tier includes `thinkTokens: { mode: 'budget', budget: 256 }`. This tier matches ANY small Qwen model — including Qwen2.5-1.5B-Instruct which is NOT a thinking model. Passing `thoughtTokenBudget` to a non-thinking model causes garbage output (confirmed in logs: `ThoughtTokenBudget: 256` → `iry][, directly from the nupe,,`).
**What NOT to do:** Do NOT add Qwen2.5-specific filename detection. Do NOT hardcode any model name.
**Correct fix:** The profile or the engine must check whether the model ACTUALLY supports thinking before applying a thought token budget. The correct general approach: `thinkTokens` should only be applied when the model's loaded context/chat session reports it supports thinking (node-llama-cpp may expose this). Alternatively, the profile lookup for `thinkTokens` should be conditioned on a `supportsThinking` flag that is set by the wrapper/detection logic at load time, not hardcoded per profile tier. The fix must work correctly whether the model is a 0.5B or 200B, Qwen or Llama or Mistral variant.
**Investigate:** Does node-llama-cpp's `LlamaChatSession` or the model's loaded context expose a flag or property indicating thinking/reasoning token support? If yes, use that. If no, determine what the safe general heuristic is.

---

### PF-3 · History Seeding Too Aggressive After Model Switch
**File:** `main/agenticChat.js`
**Problem:** When a user switches models mid-project (e.g., plans with Model A, then executes with Model B), the history seeded into the new model includes assistant messages full of tool-call JSON blocks. These are model-specific syntax and confuse the new model — it may try to re-execute old tool calls or get confused by the JSON. However, wiping history entirely is also wrong — the user's project context (their goals, requirements, what was decided) lives in the chat history and must transfer.
**Correct fix:** When seeding history into a new model session, strip tool-call JSON blocks from assistant messages (regex: ` ```json\n{"tool":... ``` ` patterns) but KEEP the natural language parts of those messages. Keep ALL user messages. The result is a history that preserves project context without injecting model-specific tool syntax.

---

### PF-4 · "Executing Tools..." Indicator Has No Visual Polish
**File:** `src/` (exact file TBD — search for "Executing tools" string)
**Problem:** The "Executing tools..." state during agentic execution appears as plain italicized text. It does not match the visual quality of the tool blocks. Also, when this state is shown, the user cannot see which tool is actively running.
**Correct fix:** Replace the plain text with a styled component: animated spinner icon + the tool name currently executing + visual styling consistent with the tool blocks. The user should be able to see "Executing: web_search" or similar at a glance, not just "Executing tools...".

---

### PF-5 · Llama 3.2-3B Still Produces Word Salad (Root Cause Unknown)
**Status:** INVESTIGATION NEEDED — do not attempt a fix until root cause is confirmed.
**What is confirmed:** Wrapper fix IS applied (logs: `wrapper: Llama3_2LightweightChatWrapper`). Context is only 6144 tokens on the test machine's 4GB GPU.
**What is NOT confirmed:** Why word salad still occurs with the correct wrapper. Investigative options: (a) system prompt is consuming most of the 6144-token context, leaving too little room for coherent output; (b) the wrapper is applied but chat history formatting still has an issue; (c) something in the agentic loop specifically causes degradation (test with a direct non-agentic prompt first).
**Note on context size:** The 6144 token limit is a hardware constraint on the test machine (4GB GPU). On better hardware this model will get more context. The fix must not hardcode context sizes — it must work across all hardware. However, the word salad should NOT happen even with 6144 tokens on a direct "hi" prompt.

---

## ⬜ Other Known Issues (Lower Priority)

### B. Cloud model writes tool call syntax INTO files
- **Symptom:** When creating 15+ files, each file contains tool command JSON instead of actual content
- **Root cause:** Cloud model emits tool calls as raw text; fallback file detection misinterprets them
- **Fix needed:** Add nudge logic to cloud agentic loop, strip tool call blocks from displayed response, improve fallback detection
- **Priority:** High

### C. Cloud model stops iterating mid-task
- **Symptom:** Model creates some files then stops halfway
- **Root cause:** Cloud agentic loop has no nudge/retry logic
- **Fix needed:** Match local loop nudge behavior in cloud loop
- **Priority:** High

### D. File changes need +N/-N line indicators
- **Symptom:** "N files changed" bar shows filename only, no line counts
- **Requested:** `+92 -36` style indicators, collapsible when many files, plus icon for new files
- **Priority:** Medium

### E. Cross-platform builds (Mac + Linux)
- **Priority:** Low (deferred)

### F. App crashes during build overwrite
- **Fix:** Kill existing process before building (handled in build script)
- **Priority:** Low

---

## Build Notes

```
Build command: npx vite build && npx electron-builder --win
Output: dist-electron\guIDE-Setup-2.0.0.exe (~359 MB)
```
