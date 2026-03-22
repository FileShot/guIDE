# 322_DEFECTS.md — guIDE Definitive Bug Report
> **Created:** 2026-03-22 from Test 1 (automated agent) + User Testing (manual)
> **Status: DEFINITIVE.** Every item in this file represents a real defect observed directly,
> either by the testing agent or by the user. Do NOT gaslight. Do NOT say "the code looks fine."
> These are real problems in the codebase and changes are absolutely required.
> Source of each defect is labeled: [AGENT] = found by agent testing, [USER] = reported by user.

---

## CRITICAL CONTEXT FOR ALL AGENTS READING THIS FILE

This software is **guIDE** — a local-first AI IDE that is on par with Visual Studio Code + GitHub Copilot. It runs large language models locally (no cloud dependency). Every change made to this codebase must be:
- **Production-grade** — not a test workaround, not a band-aid
- **General** — works for all users, all models, all hardware (4GB GPU to 128GB workstation)
- **Model-agnostic** — no hardcoding for specific model sizes or families
- **Complete** — fully implemented end-to-end, both `main/` AND `pipeline-clone/main/`

Do NOT implement band-aid fixes. Every fix must address the root architectural cause.

---

## SEVERITY LEGEND
- **P0** — Blocks core functionality entirely
- **P1** — Breaks a major user-facing feature
- **P2** — Degrades UX significantly
- **P3** — Minor issue or cosmetic

---

## DEFECT LIST

### D01 — Code Blocks Disappear After Response Finalizes [USER] [P0]
**Observed:** After a response completes generating, code blocks that were visible during streaming disappear from the finalized message bubble. The user can see code blocks during generation but they are gone once the response settles.

**Root cause to investigate:** In `ChatPanel.tsx`, the transition from streaming state (`renderStreamingContent`) to committed state (`renderMessage`) involves clearing `completedStreamingTools` in the `finally` block. When `renderMessage` handles `msg.toolsUsed`, it falls back to `InlineToolCall` widgets that do NOT include `CodeBlock` wrappers for file content. The `completedStreamingTools` state (which had the code content) is cleared before it can be committed into `msg.toolsUsed` in the message record.

**Files to investigate:** 
- `src/components/Chat/ChatPanel.tsx` — line ~1059, `finally` block clears `completedStreamingTools` before they're committed
- `src/components/Chat/ChatPanel.tsx` — `renderMessage()` function at line ~1895 — `msg.toolsUsed` render path
- `src/utils/chatContentParser.ts` — `extractToolResults`

**What must NOT be done:** Do not just keep the state around longer without finding the actual commit gap.

---

### D02 — Tool Call Chips Render Out of Chronological Order (Stacking at Top) [USER] [P1]
**Observed:** Tool call chips (write_todos, read_file, list_directory, etc.) all appear stacked at the TOP of the response bubble above the response text, rather than interleaved chronologically where they occurred in the response flow.

**Root cause to investigate:** The streaming bubble renders in two separate sections: `renderStreamingContent(streamingText)` at the top, followed by the tool chip block (`completedStreamingTools` / `executingTools` / `generatingToolCalls`) appended AFTER it. These are two separate JSX blocks — text first, then all tool chips in a batch at the bottom (or top, depending on flex direction). They are not interleaved.

**Files to investigate:**
- `src/components/Chat/ChatPanel.tsx` — lines ~2863-3120: the streaming bubble JSX, specifically the order of `renderStreamingContent(streamingText)` vs the tool chip rendering block
- The architecture renders streaming text and tool chips in separate pass — there is no position tracking to know WHERE in the text each tool call occurred

**What correct behavior looks like:** Tool chip appears inline where the model made the tool call — e.g., if the model wrote some text, then called write_file, then wrote more text, the sequence must be: text → write_file chip → more text.

---

### D03 — Tokens Generated But Not Live-Streamed to Frontend [USER] [P0]
**Observed:** The backend is generating tokens (visible in logs via `Post-gen: responseChars=XXXX`) but the frontend chat panel does not show the text being typed out live. The user sees nothing until the generation completes, then the full response appears at once. 

This was specifically confirmed: "I can see that the back end is generating tokens, but the front end is not reflecting that they're not live streaming."

**Root cause to investigate:**
- `src/components/Chat/ChatPanel.tsx` — WebSocket event handler for `llm-token` events: is it receiving tokens and updating `streamingText` state?
- `server.js` — is the WebSocket broadcasting token events? 
- `main/pipeline/streamHandler.js` — is `_emitToken` calling the token broadcast?
- The previously implemented "Fix B" (throttling `_emitToolProgress`) may have inadvertently also throttled or broken `_emitToken`
- Check: is `streamBufferRef.current` being updated and is the React state setter being called on every batch?

**Files to investigate:**
- `main/pipeline/streamHandler.js` — `_emitToken` and any throttling logic
- `server.js` — WebSocket `llm-token` broadcasting
- `src/components/Chat/ChatPanel.tsx` — `llm-token` event handler, `streamingText` state updates

---

### D04 — Model Only Performs One Web Search Per Response (Multi-Step Searches Ignored) [USER] [P1]
**Observed:** User asked three questions in one prompt that each require a web search (Bitcoin price, news headlines, Portland Maine car for $5000). The model understood all three requests (confirmed when asked directly), but only executed one web search and responded to one item.

**Root cause analysis (PIPELINE, NOT MODEL CAPABILITY):**
The agentic loop (`agenticLoop.js`) processes tool calls per iteration. A small model (4B) generates one tool call → eogToken → next iteration. The model never generates multiple `web_search` calls in a single generation because the system prompt does NOT explicitly instruct it to batch multiple tool calls before stopping. The model produces one tool call, the loop executes it, then the model produces the response for that one result without looping back for the other searches.

**System prompt gap:** `DEFAULT_COMPACT_PREAMBLE` does not say "if the user asks for multiple things requiring web searches, call web_search multiple times — once per item before responding." It says "use web_search" but does not address multi-query batching.

**Files to fix:**
- `main/constants.js` — `DEFAULT_COMPACT_PREAMBLE` and `DEFAULT_SYSTEM_PREAMBLE`: add instruction that multiple queries should result in multiple tool calls before the final response

---

### D05 — Model Forgets Context After ~3 Messages Despite Low Context Usage [USER] [P1]
**Observed:** User reported the model forgot their name after 10 interactions even though the context window had barely increased (not even 5% usage increase). The model is forgetting short-term conversational context (user name, prior statements) within 3 messages of short conversations.

**Root cause to investigate:**
- Context compaction is firing aggressively (Phase 3 "aggressive compaction" fires at ~65% — very early). When compaction runs, what data does it preserve? Does it preserve conversational facts like user names?
- `main/pipeline/contextManager.js` — what does aggressive compaction (phase 3) do to conversational entries vs tool call entries? Are simple conversation messages being truncated/dropped?
- The rolling summary — when generated, does it include user-stated facts ("my name is X")?
- Possible cause: Phase 3 compaction compresses entries aggressively, and short conversational facts (name) are in "old" entries that get compressed to almost nothing

**Files to investigate:**
- `main/pipeline/contextManager.js` — phase 1, phase 3 compaction logic
- `main/conversationSummarizer.js` — what does the summarizer preserve?
- Check: what does a conversation with "my name is X" look like after phase 3 compaction?

---

### D06 — Model Responds With Emoji Only (Rocket Emoji Response) [USER] [P0]
**Observed:** User gave a detailed prompt to create a website HTML file. Model responded with only a rocket emoji (🚀). Gave the same prompt again — model responded with only a question mark (?). Third attempt got an actual response.

**Root cause to investigate:**
- This is either: (a) the model generating a token that maps to the emoji character followed by eogToken (extremely short generation), (b) a WebSocket/stream corruption where only one token arrived at the frontend, (c) a context state issue where the model's internal state was corrupted
- The `streamHandler.js` Fix B (throttling) could be causing early finalization if `_emitToolProgress` throttle logic accidentally triggered `finalize()` on the stream
- Check if `eogToken` fired immediately after the first token in these cases
- Check logs for what `Post-gen: responseChars=` showed for those iterations

**Files to investigate:**
- `main/pipeline/streamHandler.js` — did Fix B introduce a premature finalization path?
- `main/pipeline/agenticLoop.js` — what happens when `responseChars=1` or `responseChars=2`?
- `server.js` / `main/llmEngine.js` — is there a minimum response guard?

---

### D07 — Code Generation Stops at Line 7 Mid-Generation [USER] [P0]
**Observed:** Model started generating an HTML file for a website but stopped at line 7 and cut itself off. Backend was still generating tokens but frontend did not receive them.

**Directly tied to D03** (tokens not live streaming). The model may have been continuing to generate but the stream handler stopped forwarding tokens to the frontend. The frontend showed "stopped at line 7" while the backend log showed continued generation.

**Investigation must answer:**
- Did the backend log show `Post-gen: stopReason=maxTokens` or `natural`?
- What was in the stream buffer at the point of visual cutoff?
- Was `seamless continuation` triggered? Did it fire?
- At line 7, what was the context usage percentage?

---

### D08 — Code Blocks Expanded by Default During Streaming (Should Be Collapsed) [USER] [P2]
**Observed:** During streaming, code block content is expanded and visible by default. User has asked for code blocks to be collapsed by default at least 5 times.

**Current behavior (confirmed from code):** In `ChatWidgets.tsx` line 465:
```js
const [expanded, setExpanded] = useState(!!isStreaming);
```
When `isStreaming=true`, the code block initializes as expanded. When `isStreaming=false` (committed), it initializes as collapsed.

**Required behavior:** Code blocks should ALWAYS start collapsed — even during streaming. The user explicitly wants collapsed by default. The expand/collapse button must be available at all times.

**Fix:** Change line 465 from `useState(!!isStreaming)` to `useState(false)`.

**Impact:** This change affects all CodeBlock instances regardless of context. It is general, not test-specific. User can still click "Expand" to see content.

---

### D09 — "Error: Request Cancelled" Replaces Entire Response on Stop [USER] [P1]
**Observed:** When the user clicks the "Stop generating" button, the entire response bubble (including all code blocks, tool chips, and text produced up to that point) is replaced with "Error: Request cancelled". All visual history of what the model generated is lost.

**Root cause (confirmed from code):**
In `ChatPanel.tsx` around line 1013:
```js
content: result?.success
  ? (...)
  : `Error: ${result?.error || 'Unknown error'}`,
```
When the request is cancelled, `result.success=false` and `result.error='Request cancelled'`, so the entire content is replaced with the error string. The `streamBufferRef.current` (which has the partial response) is cleared in the `finally` block before the message is committed.

**Required behavior:** On cancellation, commit whatever was generated up to the cancellation point. Do not discard partial content. Show a subtle indicator that it was stopped (e.g., "[stopped]" suffix) but preserve all generated content.

---

### D10 — write_todos Called Multiple Times Per Session, Creating Duplicate Items [AGENT] [P1]
**Observed (Test 1):** `write_todos` was called 6+ times across 4 context rotations. Each call created duplicate todo items. The todo widget grew from 2 items to 8 items with 4 copies of each. The `anti-repeat directive` in the rotation prompt had zero visible effect.

**Root cause:**
1. The model treats `write_todos` as "synchronize state" — calling it after every rotation to re-establish context
2. The `_writeTodos()` implementation in `mcpToolServer.js` appends/creates new items rather than replacing the entire list
3. The rotation prompt `todoStateDirective` lists completed IDs and says "don't repeat" but the 4B model consistently ignores this instruction

**Required behavior:** `write_todos` should be an idempotent replace operation — calling it twice with same items = same result, calling with new items = full replacement. OR: the rotation prompt must be architecturally stronger than a text instruction.

---

### D11 — write_file Called Without `content` Param (Multiple Iterations) [AGENT] [P1]
**Observed (Test 1):** The model called `write_file({})` with empty params (iterations 4-5), then `write_file({filePath: "package.json"})` with only path and no content (iterations 7-8). Four failed write_file attempts before first successful write.

**Root cause:** After context rotation, the model loses track of the file content it was about to write. It generates the tool call JSON but the `content` field is either empty or missing. The dedup guard fires after the 3rd identical call but 2 redundant failed attempts still execute.

**Required fix:** The `write_file` tool implementation should return a clear error message that says the `content` parameter is required AND what was provided. Currently it may fail silently or with a generic error.

---

### D12 — read_file Called With Empty Params After Context Rotation [AGENT] [P1]
**Observed (Test 1):** After context rotation #3, the model called `read_file({})` with no `filePath` three times in a row (iterations 25-27). Dedup fired on the 3rd call, but 2 failed calls executed.

**Root cause:** Same as D11 — post-rotation context loss. The model knows it needs to read a file but has lost the filename.

---

### D13 — Dedup Guard Fires Only After 3rd Identical Call (Should Fire After 2nd) [AGENT] [P2]
**Observed (Test 1):** The dedup guard (`MAX_SAME_CALL=2`) allows 2 identical calls through before blocking. The spec comment says "max 2 same calls" but this means 2 successful executions + 1 blocked = 3 total attempts.

**Required behavior:** MAX_SAME_CALL=1 would mean: 1 successful execution, block all subsequent identical calls. This is the correct behavior — if a tool call is identical to a previous one, it should not re-execute.

---

### D14 — Context Rotation Fires Every ~6 Iterations Causing Infinite Spiral [AGENT] [P0]
**Observed (Test 1):** Context rotation fired 4 times in 28 iterations (approximately every 6-7 iterations). After each rotation, the model re-starts its "orientation phase" (write_todos → read_file × 2-3 times) instead of continuing the task. The task (write 2 files) was completed at iteration 17-18 but the session continued to iteration 31 before being manually stopped. The model never called `finish_task`.

**Root cause:**
- Phase 3 "aggressive compaction" fires at 65-88% on EVERY iteration — this is abnormal frequency
- After rotation, the model is given a minimal context (2 entries, ~12K chars) and cannot determine task completion status
- No mechanism exists to tell the model "the task is done — you created package.json and server.js"
- `finish_task` tool exists but the model never calls it

---

### D15 — Model Does Not Know Files Already Exist After Rotation (Re-Reads and Re-Writes) [AGENT] [P1]
**Observed (Test 1):** After writing package.json and server.js at iterations 17-18, the model immediately called read_file(server.js) at iteration 20, then read_file(package.json) at iteration 21, then read_file(server.js) AGAIN at iteration 22. The model does not trust its own successful write operations.

---

### D16 — "Model X Loaded Successfully" Message — User Confused By Its Presence [USER] [P3]
**Observed:** Fix J added a "Model X loaded successfully" message when switching models. The user found this confusing and unclear — "I'm very confused what a defect that is."

**Assessment:** The message itself is not wrong, but it may be appearing in a confusing context or phrasing. Consider: does it appear at the right time? Is it styled correctly as a system message? This should be reviewed. The user did not ask for this message — it was added to replace the removed `setMessages([])`. It may be unnecessary.

---

### D17 — Context Usage Jumps Rapidly Despite Short Messages [USER] [P1]
**Observed:** User reported context going up even after short messages. With a 14K context window (Qwen3.5-4B-Q4_K_M), even brief conversations caused visible context % increases.

**Root cause to investigate:**
- Phase 3 aggressive compaction fires at 65% — but the ORIGINAL context without compaction may fill rapidly if the system prompt, tool descriptions, and conversation together already consume a large portion
- `main/pipeline/contextManager.js` — what does the context look like before compaction? How many tokens does the base system prompt + tools take?
- The 14K context window with a large system prompt may leave only ~5-6K for actual conversation

---

### D18 — Todo List Survives Rotation But Accumulates Duplicates [AGENT] [P1]
**Detailed in D10.** The todo widget UI shows duplicated items stacking. "Plan 4/8" with 8 items when there should be 2. The anti-repeat directive is architecturally insufficient for a 4B model.

---

### D19 — Stale "Creating X..." Spinner After Write Succeeds [AGENT] [P2]
**Observed (Test 1):** After a successful `write_file` call (showing `[OK]`), a "Creating package.json..." spinner with animated dots continued to appear. The spinner does not clear when the file write is confirmed complete.

**Root cause:** The "Creating X..." spinner is rendered when `fullContent` is empty (the file has no content in the streaming state yet). But after completion, `completedStreamingTools` has the entry with content and status=done. The stale spinner is a leftover from an intermediate state that did not get cleaned up.

---

### D20 — Tool Chip Display for Non-Write Tools Shows Raw JSON Params [AGENT] [P2]
**Observed (Test 1):** Non-write tool chips show raw JSON in the expandable body. For tools like `read_file` and `list_directory`, the result text is truncated to 600 chars and shown as raw JSON. This is adequate for debugging but not production-quality UX.

---

### D21 — Dedup Guard Works for Identical Args But Circumvented by Slight Variation [AGENT] [P2]
**Observed (Test 1):** The dedup guard fires when args are identical (same JSON string). But the model bypassed it by first calling `write_file({})`, then `write_file({filePath: "x"})`, then `write_file({filePath: "x", content: "..."})` — each slightly different, so the dedup never fired.

---

### D22 — Post-Rotation Model Enters Reconnaissance Loop (Re-Reads Everything) [AGENT] [P1]
**Observed (Test 1):** After every context rotation, the model pattern was consistently: `write_todos` → `read_file(server.js)` → `read_file(package.json)` → `read_file(server.js)` [3rd time, dedup fires]. The model is repeating the initial discovery phase after every rotation instead of knowing where it left off.

**Root cause:** The rotation prompt gives the model the rolling summary and task context, but does NOT include the actual file contents or a clear "you already wrote these files, skip reading them." The model cannot tell from the summary alone what files exist and what they contain.

---

### D23 — Seamless Continuation Not Observed in Test 1 [AGENT] [P1]
**Observed:** In 31 iterations, `Post-gen: stopReason=maxTokens` never appeared in logs. All stops were `natural` (eogToken). The seamless continuation system was never triggered. This means the test never got to validate whether continuation works correctly.

**This is not confirmation continuation is broken** — the 4B model's responses were short enough to never hit maxTokens=16384. More demanding prompts are needed to trigger continuation.

---

### D24 — Agent Loop Does Not Recognize Task Completion (No finish_task Call) [AGENT] [P0]
**Observed (Test 1):** The model wrote package.json and server.js successfully at iterations 17-18. These were the only two files needed for the task. The model never called `finish_task`. Instead it continued looping through 13 more iterations before being manually stopped.

**Root cause:** Either (a) `finish_task` tool is not in the model's available tools, (b) the system prompt does not strongly enough instruct the model to call finish_task when done, or (c) the model does not determine "done" because it lacks verification of its own outputs.

---

### D25 — Multiple Web Searches Required Per User Message Not Performed [USER/AGENT] [P1]
**Duplicate of D04.** The model calls one web_search per response regardless of how many searches the user's prompt requires. A prompt asking for Bitcoin price AND weather AND car listings should trigger 3 web_search calls across 3 iterations. Only 1 was observed.

---

### D26 — Context Window Exhausted Despite Minimal Usage (User Reports) [USER] [P1]
**Observed:** User reports the model seems to "run out of memory" very quickly even when the context window is showing low percentage. Combined with the agent observation that phase 3 aggressive compaction fires every iteration, this creates a situation where the model perceives depleted context even though the raw counter shows plenty of space.

**Hypothesis:** Phase 3 aggressive compaction is removing important conversational context (user name, prior statements) while the context counter recovers after compaction. The counter goes DOWN after compaction runs, making it APPEAR there is space, but the conversation history has been stripped.

---

---

## SUMMARY TABLE

| ID | Severity | Status | Source | Title |
|----|----------|--------|--------|-------|
| D01 | P0 | OPEN | USER | Code blocks disappear after response finalizes |
| D02 | P1 | OPEN | USER | Tool chips render out of chronological order |
| D03 | P0 | OPEN | USER | Tokens generated but not live-streamed |
| D04 | P1 | OPEN | USER | Single web search per response (multi-search ignored) |
| D05 | P1 | OPEN | USER | Model forgets context after ~3 messages |
| D06 | P0 | OPEN | USER | Model responds with emoji only |
| D07 | P0 | OPEN | USER | Code generation stops at line 7, mid-generation cutoff |
| D08 | P2 | OPEN | USER | Code blocks expanded by default (should be collapsed) |
| D09 | P1 | OPEN | USER | Cancellation replaces entire response with error |
| D10 | P1 | OPEN | AGENT | write_todos creates duplicates across rotations |
| D11 | P1 | OPEN | AGENT | write_file called without content param |
| D12 | P1 | OPEN | AGENT | read_file called with empty params post-rotation |
| D13 | P2 | OPEN | AGENT | Dedup guard fires after 3rd call, not 2nd |
| D14 | P0 | OPEN | AGENT | Context rotation spiral — infinite loop on simple task |
| D15 | P1 | OPEN | AGENT | Model re-reads and re-writes files it already created |
| D16 | P3 | OPEN | USER | "Model loaded" message — confusing to user |
| D17 | P1 | OPEN | USER | Context usage increases rapidly on short messages |
| D18 | P1 | OPEN | AGENT | Todo widget accumulates duplicate items |
| D19 | P2 | OPEN | AGENT | Stale "Creating X..." spinner after write succeeds |
| D20 | P2 | OPEN | AGENT | Non-write tool chips show raw JSON result |
| D21 | P2 | OPEN | AGENT | Dedup circumvented by slight arg variation |
| D22 | P1 | OPEN | AGENT | Post-rotation model re-reads all files |
| D23 | P1 | OPEN | AGENT | Seamless continuation not observed in testing |
| D24 | P0 | OPEN | AGENT | Model doesn't call finish_task when done |
| D25 | P1 | OPEN | USER | Multi-step web searches — only first executed |
| D26 | P1 | OPEN | USER | Context exhausted despite low percentage shown |

---

## INVESTIGATION NOTES

### Regarding D03 + D07 (Streaming Cutoff)
The most likely single cause for both: `streamHandler.js` Fix B (throttling `_emitToolProgress`) may have introduced a code path that either throttles `_emitToken` alongside tool progress events, OR a timing issue where the stream finalizes before all tokens are flushed to the WebSocket. The backend log shows generation completing (`Post-gen: responseChars=N`) but the frontend receives fewer characters. Need to trace the token → WebSocket → React state path completely.

### Regarding D01 (Code Blocks Disappear)
The issue is in the transition from streaming → committed state. During streaming, `completedStreamingTools` holds file content alongside status=done CodeBlocks. When finalized, `setCompletedStreamingTools([])` is called in `finally`. The `assistantMsg` is added with `toolsUsed: result.toolResults` — but `result.toolResults` comes from the backend's MCPToolServer tool execution results, which may not include the full file content. The `renderMessage()` fallback for `msg.toolsUsed` renders `InlineToolCall` widgets without CodeBlock wrappers. The file content is effectively lost.

### Regarding D05 + D26 (Memory Loss)
Phase 3 compaction in `contextManager.js` runs "aggressive" compression on tool results. But it may also be compressing or dropping short conversational entries (the "user said their name is X" ones). Need to check what "Phase 1: Compressed N old tool results" actually does to non-tool entries. 

### Regarding D08 (Code Blocks Default Collapsed)
Confirmed from [`ChatWidgets.tsx:465`]: `useState(!!isStreaming)` means streaming=true → expanded=true. The fix is one line: change to `useState(false)`. This is the simplest fix in the entire list and should be done immediately.
