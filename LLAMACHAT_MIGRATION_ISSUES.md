# LlamaChat Migration — Issues & Resolution Tracker

## Summary
Migration from `LlamaChatSession.prompt(flatString)` to `LlamaChat.generateResponse(ChatHistoryItem[])` for proper system/user/model role separation.

**Status: ALL ISSUES RESOLVED (22 total across 4 audit passes, verified in 5th pass)**

---

## Original Issues (Post-Implementation Audit)

### 1. TokenPredictor Silently Dropped — CRITICAL
- **Severity:** CRITICAL (20-40% speed regression)
- **What happened:** `InputLookupTokenPredictor` was passed per-call to `session.prompt()`. When migrating to `LlamaChat.generateResponse()`, which doesn't accept `tokenPredictor` as a per-call option, it was simply removed.
- **Root cause:** `tokenPredictor` belongs on the `LlamaContextSequence`, not the generation call.
- **Status:** ✅ FIXED — tokenPredictor now passed to `context.getSequence({ tokenPredictor })` in initialize(), resetSession(), and all electron-main.js recovery paths.

### 2. contextShiftMetadata Not Passed Back — HIGH
- **Severity:** HIGH (suboptimal context truncation across turns)
- **What happened:** `lastEvaluation.contextShiftMetadata` was stored but never passed back to subsequent `generateResponse()` calls.
- **Root cause:** Oversight — only `lastEvaluationContextWindow.history` was passed, not the context shift metadata.
- **Status:** ✅ FIXED — `contextShift.lastEvaluationMetadata` now passed from `this.lastEvaluation.contextShiftMetadata`.

### 3. Tool Results in "user" Role / Stale System Context — MEDIUM
- **Severity:** MEDIUM (role confusion for small models + stale tool defs/memory/RAG)
- **What happened:** Tool execution results were sent as plain strings or user turns. System context (tool definitions, memory, RAG, file context) was only set on the first iteration.
- **Root cause:** Nudge/continuation/summary prompts were plain strings instead of structured `{systemContext, userMessage}`.
- **Status:** ✅ FIXED — Every prompt in the agentic loop now uses structured format with `buildBasePrompt()` for fresh system context on every iteration: browser nudges, hallucination nudges, truncation nudges, normal tool-feedback continuations, final summary, and find-bug handler.

### 4. One-Shot generate() Desyncs KV Cache — MEDIUM
- **Severity:** MEDIUM (one-time ~500ms re-encode penalty after utility calls)
- **What happened:** `generate()` used a temporary history on the same LlamaChat/sequence. After it ran, `lastEvaluation` was nulled, forcing full re-encode on next `generateStream()`.
- **Root cause:** Single sequence shared between one-shot utility calls and the agentic loop.
- **Status:** ✅ FIXED — `generate()` now creates a temporary secondary sequence via `context.getSequence()`, uses a temporary `LlamaChat` on that sequence, then disposes both in a `finally` block. Falls back to main chat if the context doesn't support additional sequences, with `lastEvaluation = null` only in the fallback case.

### 5. chatHistory Grows Unbounded Between Rotations — MEDIUM
- **Severity:** MEDIUM (memory + token waste in long automation sessions)
- **What happened:** Each agentic iteration adds user+model entries. Over 50+ iterations, chatHistory can have 100+ entries before the 80% rotation triggers.
- **Root cause:** No explicit trimming of chatHistory between rotations.
- **Status:** ✅ FIXED — New `_compactHistory()` method trims old entries when chatHistory exceeds 200 entries (~100 exchanges), preserving the system message and the most recent 80%. Called before every `generateResponse()` in `generateStream()`. Invalidates `lastEvaluation` when compaction occurs so node-llama-cpp re-encodes with the trimmed history.

### 6. System Context Stale on Non-Structured Iterations — LOW
- **Severity:** LOW (pre-existing behavior, not a regression)
- **What happened:** After the first iteration, nudge/tool-feedback prompts were plain strings — the system message in chatHistory wasn't refreshed.
- **Status:** ✅ FIXED (merged with #3) — All prompts now use structured format, which calls `buildBasePrompt()` fresh on every iteration to refresh tool defs, memory, RAG, and file context in the system message.

---

## Additional Issues Found (Second Audit Pass)

### 7. repetitionCount Never Resets — LOW
- **Severity:** LOW (false abortion of long generations)
- **What happened:** The repetition counter in `generateStream()` only incremented, never decayed. After enough tokens, even normal text would accumulate a count > 5 and abort.
- **Status:** ✅ FIXED — Counter now decays by 1 when the current window shows no repetition: `repetitionCount = Math.max(0, repetitionCount - 1)`.

### 8. Old LlamaChat Not Disposed in resetSession() — MEDIUM
- **Severity:** MEDIUM (memory leak on context rotation)
- **What happened:** `resetSession()` could try to reuse `this.chat.sequence` without first disposing the old `LlamaChat` instance, leaving it alive and holding references.
- **Status:** ✅ FIXED — `resetSession()` now always calls `this.chat.dispose()` before anything else.

### 9. tagBuffer Not Flushed at End of Generation — LOW
- **Severity:** LOW (last few characters of a response silently swallowed)
- **What happened:** The `tagBuffer` used for partial `<think>` tag detection held trailing characters that were never emitted if the response ended mid-buffer.
- **Status:** ✅ FIXED — After `generateResponse()` returns, any remaining non-thinking tagBuffer content is flushed to `fullResponse` and emitted via `onToken`.

### 10. User Message Lost on Abort Without Partial Response — LOW
- **Severity:** LOW (conversation context silently trimmed)
- **What happened:** On abort with no `fullResponse`, the user message was popped from chatHistory (error handler) and never re-added, so the model wouldn't know what the user asked.
- **Status:** ✅ FIXED — Both abort paths (with and without partial response) now always re-add the user message and add a placeholder model response `['[Generation cancelled]']`.

### 11. contextShift Strategy Not Explicitly Set — LOW
- **Severity:** LOW (fragile default dependency)
- **What happened:** The `contextShift` options only included `strategy` when `lastEvaluation` existed (via the metadata pass-back). On the first call, no strategy was set, relying on node-llama-cpp's undocumented default.
- **Status:** ✅ FIXED — `contextShift.strategy: 'eraseFirstResponseAndKeepFirstSystem'` is now explicitly set on EVERY call, both with and without prior `lastEvaluation`.

### 12. Spurious Sequences Created for Context Usage Estimation — MEDIUM
- **Severity:** MEDIUM (resource waste, potential sequence limit exhaustion)
- **What happened:** `llmEngine.context.getSequence()` was called in two places (post-generation context usage + proactive rotation check) just to read `nTokens`. Each call creates a NEW `LlamaContextSequence` that's never disposed.
- **Status:** ✅ FIXED — Both locations now use `llmEngine.sequence.nTokens` (the existing sequence reference) instead of creating new ones.

### 13. _getStopSequences() Dead Code — TRIVIAL
- **Severity:** TRIVIAL (code hygiene)
- **What happened:** `_getStopSequences()` was defined but never called anywhere.
- **Status:** ✅ FIXED — Removed.

### 14. _sanitizeResponse() Corruption During Editing — CRITICAL (Self-Inflicted)
- **Severity:** CRITICAL (method was broken)
- **What happened:** During the `_getStopSequences()` removal edit, the beginning of `_sanitizeResponse()` was accidentally eaten, leaving the file with a garbled method body.
- **Status:** ✅ FIXED — Full method restored: JSDoc, function signature, regex cleanup, dedup loop, whitespace normalization.

---

## Third Audit Pass Issues

### 15. NOT Using cleanHistory From lastEvaluation — MODERATE
- **Severity:** MODERATE (KV cache reuse optimization defeated)
- **What happened:** After `generateResponse()`, we manually pushed `{ type: 'model', response: [text] }` to chatHistory instead of using `result.lastEvaluation.cleanHistory` — the canonical post-generation history from node-llama-cpp.
- **Root cause:** Didn't follow node-llama-cpp's official external-chat-state pattern: `chatHistory = res.lastEvaluation.cleanHistory`.
- **Impact:** Our manually managed chatHistory could diverge from the actual KV cache state, causing `lastEvaluationContextWindow` to fail overlap checks and re-encode the entire history from scratch on every call.
- **Status:** ✅ FIXED — Now uses `result.lastEvaluation.cleanHistory` as the canonical chatHistory after successful generation. Falls back to manual push for edge cases (older API versions).

### 16. Abort Path Stores Unsanitized Response in chatHistory — MODERATE
- **Severity:** MODERATE (reinforces the original "assistant\nassistant" bug)
- **What happened:** When generation was aborted with a partial response, the raw `fullResponse` was stored in chatHistory without sanitization. The streaming `garbageTokenRegex` catches special tokens like `<|im_start|>`, but NOT bare turn indicators (`assistant`, `user` on their own line). Those are only caught by `_sanitizeResponse()`, which was only applied to the *returned* text, not the *stored* text.
- **Root cause:** `_sanitizeResponse()` was called for the return value but not for the chatHistory entry.
- **Status:** ✅ FIXED — Abort path now calls `this._sanitizeResponse(fullResponse)` before pushing to chatHistory.

### 17. tempSequence Not Disposed in generate() — MINOR
- **Severity:** MINOR (sequence slot leak, mitigated by fallback)
- **What happened:** In `generate()`, a temporary sequence was created via `context.getSequence()`, its tokens erased in the `finally` block, but the sequence handle itself was never disposed. Over many `generate()` calls, sequence slots could be exhausted.
- **Root cause:** Oversight — only token erasure was implemented, not handle disposal.
- **Mitigation:** When slots run out, `getSequence()` throws and the code falls back to the main chat. But this is sloppy.
- **Status:** ✅ FIXED — Added `tempSequence.dispose?.()` in the `finally` block after token erasure.

### 18. Corrupted app.on('before-quit') Block — SIGNIFICANT (Pre-existing)
- **Severity:** SIGNIFICANT (runtime crash on app shutdown)
- **What happened:** The `app.on('before-quit', async () => { playwrightBrowser.dispose(); ... })` block was corrupted, with `app` merged into `playwrightBrowser` to form `applaywrightBrowser.dispose();` and the callback split onto the next line as `p.on('before-quit', ...)`.
- **Root cause:** Likely a prior editing accident (NOT introduced by this migration).
- **Impact:** `applaywrightBrowser` and `p` are undefined — runtime `ReferenceError` on app quit, meaning cleanup (memory disposal, model disposal) never runs.
- **Status:** ✅ FIXED — Restored to correct `app.on('before-quit', async () => { playwrightBrowser.dispose(); ... })` structure.

---

## Fourth Audit Pass Issues

### 19. _sanitizeResponse() Regex Fails to Match ChatML Tokens — CRITICAL
- **Severity:** CRITICAL (directly causes the original "assistant\nassistant" stuttering bug)
- **What happened:** The combined regex in `_sanitizeResponse()` FAILED to match `<|im_start|>`, `<|im_start|>assistant`, and `<|im_start|>system` — the exact ChatML tokens causing the original bug. The streaming `garbageTokenRegex` caught them correctly, but `_sanitizeResponse()` (used on abort paths, final cleanup, AND stored in chatHistory) did NOT.
- **Root cause:** `<|im_start|>` was nested INSIDE a `<|...|>` wrapper group: `<\|(?:...|im_start\|>(?:...)|...)\|>`. The `|>` in `im_start|>` was consumed as the group's closing `\|>`, leaving the optional `(?:system|user|assistant)?` and the outer `\|>` unable to match.
- **Evidence:** Proven via `node -e` test — old regex returned MISSED for all `im_start` variants. New regex matched all 19 token types.
- **Fix:** Made `<\|im_start\|>(?:system|user|assistant)?` a top-level alternative in the regex, not nested inside `<\|(...)\|>`.
- **Status:** ✅ FIXED — Regex verified against 19 test tokens (all MATCHED) via terminal.

### 20. System Message Replaced Unconditionally Every Iteration — MODERATE
- **Severity:** MODERATE (unnecessary KV cache re-encoding overhead)
- **What happened:** In `generateStream()`, the system message at `chatHistory[0]` was replaced with a new object on EVERY iteration, even when the text was identical. After adopting `cleanHistory` (fix #15), this destroyed the object from node-llama-cpp's output and forced re-tokenization.
- **Root cause:** Missing equality check — always created a new `{ type: 'system', text: fullSystemText }` object.
- **Impact:** In multi-iteration agentic loops where `systemContext` doesn't change between iterations (common case), every iteration would force node-llama-cpp to re-tokenize and potentially re-encode the entire system prefix.
- **Fix:** Added string equality check: only replace the system message object when `this.chatHistory[0].text !== fullSystemText`.
- **Status:** ✅ FIXED

### 21. Double Semicolon in _getSystemPrompt() — TRIVIAL
- **Severity:** TRIVIAL (code hygiene)
- **What happened:** `_getSystemPrompt()` ended with `;;` — a double semicolon creating an empty statement.
- **Status:** ✅ FIXED

### 22. Dead isFirstIteration Variable in electron-main.js — TRIVIAL
- **Severity:** TRIVIAL (code hygiene)
- **What happened:** `let isFirstIteration = true;` was declared in the agentic loop setup but never read anywhere.
- **Status:** ✅ FIXED — Removed.

---

## Files Modified
- `main/llmEngine.js` — All engine-level fixes
- `electron-main.js` — Structured prompts, sequence reference fixes, find-bug handler
- `LLAMACHAT_MIGRATION_ISSUES.md` — This document

## Verification Checklist
- [x] Every `currentPrompt =` assignment uses structured `{systemContext, userMessage}` format
- [x] No calls to `context.getSequence()` outside of initialize/resetSession/recovery/generate-utility
- [x] `_compactHistory()` called before every `generateResponse()`
- [x] `tagBuffer` flushed after generation completes
- [x] `repetitionCount` decays on non-repetitive windows
- [x] `resetSession()` disposes old chat before creating new one
- [x] `contextShift.strategy` explicitly set on every call
- [x] Abort handler preserves user message in both paths
- [x] `generate()` uses separate sequence with proper cleanup
- [x] `_getStopSequences()` dead code removed
- [x] `_sanitizeResponse()` fully restored and verified
- [x] `cleanHistory` from `lastEvaluation` used as canonical chatHistory
- [x] Abort path sanitizes partial response before storing in chatHistory
- [x] `tempSequence.dispose()` called in generate() finally block
- [x] `app.on('before-quit')` corruption repaired
- [x] `_sanitizeResponse()` regex matches ALL ChatML tokens (19/19 verified via node -e)
- [x] System message equality check prevents unnecessary KV re-encoding
- [x] Double semicolon in `_getSystemPrompt()` removed
- [x] Dead `isFirstIteration` variable removed from electron-main.js
- [x] 5th verification pass: all flows traced end-to-end (normal, abort, overflow, one-shot, reset, dispose) — zero new issues
