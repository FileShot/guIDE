# 323_DEFECTS.md — guIDE Web Test Session (v1.8.49) Defect Report
> **Created:** 2026-03-24
> **Test Session:** Web automation testing against v1.8.49 build
> **Model Tested:** Qwen3.5-4B-Q4_K_M
> **Context:** ctx=14080, gpu=20 layers, maxTokens=3520

---

## INVESTIGATION RULES — READ BEFORE PROPOSING ANY FIX

### What IS Allowed
1. System prompt / preamble text changes — `main/constants.js`
2. Tool descriptions changes — `main/mcpToolServer.js`
3. Sampling parameters changes — `main/modelProfiles.js`
4. Grammar constraints changes — `main/modelProfiles.js`
5. Few-shot examples changes — `main/modelProfiles.js`
6. Deep infrastructural fixes to `main/pipeline/agenticLoop.js`, `main/llmEngine.js`, `main/agenticChatHelpers.js`, `main/conversationSummarizer.js`

### What is BANNED
- Keyword/regex classifiers matching specific user phrasings
- Response filters that strip specific words from model output
- Any code that only works for the specific test inputs used
- Hardcoded behavior targeting one hardware configuration or model size
- Band-aid fixes (guard clauses, timeouts, workarounds masking root cause)
- Test-specific fixes that would not help ALL users with ALL prompts
- Cheerleading or positive framing of results
- Blaming model size or context window for failures
- Speculative builds without full investigation

### Investigation Requirements
- Read EVERY function in the call chain before proposing any fix
- Find a second independent indicator confirming root cause
- Complete PRE-CODE CHECKLIST from copilot-instructions.md before writing code
- Complete POST-CODE VERIFICATION after writing code
- Update BOTH `main/` AND `pipeline-clone/main/` for every change
- Log every change in `pipeline-clone/CHANGES_LOG.md`

### Goal
**Context size should NOT matter.** A model with 5,000 tokens should print 1,000,000 lines coherently. The pipeline's three systems (seamless continuation, context summarization, context compaction/rotation) exist to make this possible. Every fix must be production-ready, general, and complete.

---

## DEFECT LIST

### T01 — Test Methodology Failure: Name Recall Asked Immediately
**Observed:** Test 1 told the model a name ("Zygmundt Plovertail") then immediately asked the model to recall it in the same turn.
**Violation:** WEB_TEST_RULES.md 14A says memory recall must wait 5+ interactions minimum.
**Impact on validity:** Test 1 results are invalid as a memory test. The "recall" was not a test of persistence but immediate short-term parroting.
**Status:** Test methodology issue — not a pipeline bug. Future tests must wait 5+ turns before memory recall checks.

---

### T02 — Tool Results Non-Chronological Ordering
**Observed:** Test 2 asked for weather and news. The model called web_search twice. Tool result chips appeared in wrong order — both stacked at the bottom of the response instead of inline where they were called.
**Expected:** If model outputs text, calls web_search, outputs more text, calls web_search again — the visual order should be: text → web_search chip → text → web_search chip.
**Actual:** Both web_search chips appeared together after all the text.
**Cross-reference:** This is D02 from 322_DEFECTS.md (Tool chips render out of chronological order).
**Evidence:** Screenshots test2-response-1.png through test2-response-4.png show tool chips stacked.
**Root cause to trace:** ChatPanel.tsx streaming bubble JSX — how tools are positioned relative to text.

---

### T03 — write_todos NOT Called for Multi-Step Task
**Observed:** Test 3 gave a todo list task ("Create a todo list with all the steps needed"). The model output a numbered list as plain text instead of calling `write_todos` tool.
**Expected:** Model should call `write_todos` with the todo items to display them in the todo widget.
**Actual:** Model wrote the todo as markdown text only.
**Root cause to trace:** 
1. System prompt (`DEFAULT_COMPACT_PREAMBLE`) — does it instruct to use write_todos for planning tasks?
2. Tool descriptions in `mcpToolServer.js` — does `write_todos` description make it clear when to use it?
**Cross-reference:** This may relate to D04/D25 (model only does one action per turn) — model may have decided generating text was "the action" and stopped before calling the tool.

---

### T04 — write_file NOT Called for File Generation Task
**Observed:** Test 3 asked for HTML generation. The model generated the HTML inline in the chat response instead of calling `write_file` to save it.
**Expected:** When user asks for a file, model should call `write_file({filePath: "filename.html", content: "..."})`
**Actual:** Model dumped raw HTML into the chat bubble as fenced code block.
**Root cause to trace:**
1. System prompt — does it instruct to use write_file when generating files?
2. Tool description for write_file — does it say when to use vs when to just display code?
**First hypothesis:** The prompt didn't explicitly ask to "save" or "create a file" — it said "create a todo list" and later "create an HTML file for those". The model may interpret "create" as "generate and show" rather than "save to disk".

---

### T05 — Code Block Seam Corruption at Continuation Boundary
**Observed:** Test 3 response showed a code block that had markdown fence corruption. At the continuation boundary, ` ```html ` appeared INSIDE the code block content instead of as a fence delimiter.
**Expected:** Code blocks span continuation boundaries seamlessly — content continues without fence artifacts.
**Actual:** Fence characters embedded in output: `<` followed by ` ```html ` mid-line.
**Cross-reference:** D07 from 322_DEFECTS.md (code generation stops/breaks mid-way).
**Root cause to trace:**
1. streamHandler.js — how does `_holdingFenced` handle continuation resets?
2. agenticLoop.js — when `stream.continueToolHold()` is called, what happens to partial fenced blocks?
**Evidence:** Screenshot test3-todohtml-4.png shows the corruption.

---

### T06 — File Generation Incomplete (Stopped at 1957 chars)
**Observed:** Test 3 HTML generation stopped at 1957 characters with a bare `<` character — content was truncated mid-tag.
**Expected:** If maxTokens is hit, seamless continuation should trigger and complete the content.
**Actual:** Generation stopped, content was incomplete, no continuation triggered.
**Root cause to trace:**
1. Backend logs — did `stopReason=maxTokens` fire?
2. If yes, did continuation trigger? If no, why not?
3. If continuation triggered, why did it not produce more content?
**Cross-reference:** D07 (code stops mid-generation), D23 (seamless continuation not observed).

---

### T07 — Partial Tool Call Accumulation Failed
**Observed:** Test 4 large file generation started producing write_file JSON. After hitting maxTokens, the backend log showed "Detected partial tool call — starting accumulation". But after 2 iterations, "Accumulated buffer has no complete tool call — treating as display text" fired.
**Expected:** Continuation iterations should produce the remaining JSON to complete the tool call.
**Actual:** Model DUPLICATED content from the beginning instead of continuing. After 2 iterations of duplication, pipeline gave up.
**Log evidence:**
- Iteration 1: 12666 chars, stopReason=maxTokens, partial tool call detected
- Iteration 2: 9736 chars, stopReason=natural, "Accumulated buffer has no complete tool call"
**Root cause to trace:**
1. agenticLoop.js — what continuation message is sent when partial tool call is detected?
2. Does the continuation message include the content already generated?
3. Does the model receive context about WHERE it left off?
**Cross-reference:** Session 4 Group A fix claimed to handle this — clearly the fix is incomplete or broken.

---

### T08 — Content Duplication at Continuation Seam
**Observed:** Test 4 iteration 2 started with the exact same content as iteration 1 — the model regenerated from scratch instead of continuing from where it stopped.
**Expected:** Continuation should pick up exactly where the previous iteration stopped.
**Actual:** Model restarted from the beginning of the HTML file, producing duplicate content.
**Root cause to trace:**
1. agenticLoop.js — what context does the continuation message provide?
2. Is there a mechanism to tell the model "you already generated up to line X, continue from there"?
3. Is `pendingToolCallBuffer` being passed to the continuation prompt?
**First hypothesis:** The continuation message says "Continue with the task" but does NOT include the content already generated. Small models (4B) cannot infer continuation point without explicit context.

---

### T09 — Tool Call JSON Embedded in Code Block
**Observed:** During Test 4, the write_file JSON appeared INSIDE the HTML code block rather than after it. The model was generating `<html>...<body>...```json\n{"tool": "write_file"...`
**Expected:** Model should close the code block before emitting tool call JSON.
**Actual:** Tool call JSON appears as content within the code block.
**Root cause to trace:**
1. Is this a model behavior issue (needs system prompt guidance)?
2. Or is this a parsing issue (pipeline should detect tool JSON even inside fenced blocks)?
**Cross-reference:** This is related to T07 — the JSON being inside a code block may be why accumulation failed to parse it as a valid tool call.

---

### T10 — write_file Failure: All Generated Code Lost
**Observed:** Test 4 final state showed `write_file [FAIL]` in the chat. All 12666+ characters of generated code were lost. The user cannot retrieve any of the generated HTML.
**Expected:** Even if write_file fails, the generated content should be visible to the user.
**Actual:** Content completely lost. Only failure message shown.
**Root cause to trace:**
1. streamHandler.js `finalize(false)` — what happens to held content when tool call parsing fails?
2. ChatPanel.tsx — when `write_file [FAIL]` is displayed, what happened to the file content?
3. Is there a mechanism to preserve partial content on tool failure?
**Impact:** CRITICAL. User lost all generated work. This is data loss.

---

## CROSS-REFERENCE TO 322_DEFECTS.md

These defects from 322_DEFECTS.md appear to still be present based on this test:

| 322 ID | Still Present? | Evidence |
|--------|----------------|----------|
| D02 | YES | T02 — tool chips non-chronological |
| D07 | YES | T05, T06 — code generation stops/breaks mid-way |
| D23 | YES | T06, T07 — seamless continuation not triggering properly |

Session 4 and Session 5 claimed to fix these. The fixes are either incomplete or regressed.

---

## PRIORITY ORDER FOR INVESTIGATION

1. **T07 + T08** — Partial tool call accumulation and content duplication (CRITICAL — data loss path)
2. **T10** — Content lost on write_file failure (CRITICAL — data loss)
3. **T05 + T06** — Code block corruption and incomplete generation (P0 — breaks core functionality)
4. **T03 + T04** — write_todos and write_file not being called (P1 — tool use failure)
5. **T02** — Tool ordering non-chronological (P1 — UX degradation, already documented as D02)
6. **T09** — JSON embedded in code block (P1 — parsing failure)
7. **T01** — Test methodology (not a pipeline bug — test correction needed)

---

## INVESTIGATION STATUS

| Defect | Status | Root Cause Found | Fix Proposed |
|--------|--------|------------------|--------------|
| T01 | N/A (methodology) | N/A | N/A |
| T02 | INVESTIGATING | - | - |
| T03 | INVESTIGATING | - | - |
| T04 | INVESTIGATING | - | - |
| T05 | INVESTIGATING | - | - |
| T06 | INVESTIGATING | - | - |
| T07 | INVESTIGATING | - | - |
| T08 | INVESTIGATING | - | - |
| T09 | INVESTIGATING | - | - |
| T10 | INVESTIGATING | - | - |
| T11 | OPEN (Reproduced S7) | - | - |
| T12 | OPEN | - | - |
| T13 | OPEN | - | - |
| T14 | OPEN (Reproduced S7) | - | - |
| T15 | OPEN (Reproduced S7) | - | - |
| T16 | OPEN | - | - |
| T17 | OPEN | - | - |
| T18 | OPEN | - | - |
| T19 | OPEN | - | - |
| TM01 | METHODOLOGY | N/A | N/A |
| TM02 | METHODOLOGY | N/A | N/A |
| TM03 | METHODOLOGY | N/A | N/A |

---

## SESSION 6 WEB TEST DEFECTS (2026-03-22)

### T11 — write_todos Called with Empty Items
**Observed:** TURN 4 multi-step task. Backend log shows `Tool: write_todos({})` — empty items parameter.
**Expected:** write_todos should be called with populated todo items array.
**Actual:** Model called write_todos with no items, causing `write_todos [FAIL]` in UI.
**Log evidence:** `2026-03-22T20:30:00.134Z LOG [AgenticLoop]   Tool: write_todos({})`
**Root cause to trace:**
1. Tool description for write_todos — is `items` parameter clearly documented as required?
2. System prompt — does it give examples of proper write_todos usage?
3. Model behavior — is this a tool call parsing issue or model comprehension issue?
**Cross-reference:** T03 (write_todos not called) - model may be confused about write_todos usage.

---

### T12 — write_file Called with Empty Parameters
**Observed:** TURN 5 iteration 2. Backend log shows `Tool: write_file({})` — empty path and content.
**Expected:** write_file requires `filePath` and `content` parameters.
**Actual:** Model called write_file with empty object, causing silent failure.
**Log evidence:** `2026-03-22T20:30:11.732Z LOG [AgenticLoop]   Tool: write_file({})`
**Root cause to trace:**
1. Is this same iteration that failed write_todos? May be model confusion cascade.
2. Tool description for write_file — are parameters clearly documented?
3. Could be model generating tool call JSON incorrectly partway through response.

---

### T13 — Triple Duplicate Intro Text at Continuation Boundaries
**Observed:** Earlier in TURN 5. Intro text "I'll create a complete authentication system..." appeared three times.
**Expected:** Response text should appear once, with continuations extending content seamlessly.
**Actual:** Same intro text duplicated at iteration boundaries, creating visible repetition.
**Root cause to trace:**
1. agenticLoop.js — what context/instruction is sent at continuation?
2. Is the model receiving the already-generated text in continuation context?
3. Does continuation message tell model NOT to repeat intro?
**Cross-reference:** T08 (content duplication at continuation seam)
**Note:** After context rotation #1 at 80.4%, this behavior seemed to stop. The early iterations pre-rotation showed duplication, post-rotation iterations did not.

---

### T14 — Tool Call Results Not Chronological (Still Present)
**Observed:** Session 6 TURN 2-3. When model says "let me check the weather" then calls web_search, then starts printing response — the web_search tool chip stays pinned at the BOTTOM of the message instead of appearing inline where it was invoked.
**Expected:** Tool result chips render chronologically in the order they ran within the response text.
**Actual:** Tool chips forced to bottom of response bubble regardless of when they were called.
**Cross-reference:** T02 from prior session, D02 from 322_DEFECTS.md. This bug was previously documented and claimed addressed. It is NOT addressed.
**Root cause to trace:** ChatPanel.tsx streaming bubble JSX — how tool result chips are positioned relative to streamed text segments.
**Severity:** P1 — UX degradation, makes tool usage confusing to users.

---

### T15 — File Explorer Not Updating During Generation
**Observed:** Session 6 TURN 5. As write_file tool creates new files (auth.js, auth.routes.js, etc.), the left-panel File Explorer does not refresh to show new files/folders in real time.
**Expected:** File Explorer should show newly created files as soon as write_file completes.
**Actual:** Explorer tree stale — does not reflect new files until manual refresh or action.
**Root cause to trace:**
1. How does the write_file tool result propagate back to the frontend?
2. Does the frontend emit a file-system-changed event after write_file?
3. Is there a watcher/refresh mechanism for the Explorer when files are created by the agent?
**Severity:** P2 — User cannot see files being created without manual intervention.

---

## TEST METHODOLOGY FAILURES (Session 6)

These are agent (tester) failures in methodology, not pipeline bugs.

### TM01 — Memory Recall Test Invalid (Repeated Violation)
**What happened:** Told model name was "Bartholomew", then concluded success when model immediately acknowledged it. Did NOT wait 5+ turns before recall check as required by WEB_TEST_RULES.md Section 14A.
**Cross-reference:** T01 from prior session documented this exact same methodology failure. The agent committed the same violation twice.

### TM02 — Web Search Tests Split Into Separate Turns
**What happened:** User explicitly instructed to combine crypto + weather queries into ONE turn to test multiple tool calls from a single prompt. Agent split them into Turn 2 (crypto) and Turn 3 (weather) separately, testing nothing new since single web_search invocation was already demonstrated.
**Impact:** Wasted a turn. Did not test the multi-tool-call scenario the user specifically requested.

### TM03 — TURN 5 Prompt Incorrect: Multiple Files Instead of One Large File
**What happened:** User explicitly instructed to give ONE prompt that creates ONE large file with thousands of lines of code, to test seamless continuation MID-FILE. Agent gave a prompt asking for 5 separate files (auth middleware, routes, React context, Prisma schema, login/register components).
**Impact:** Multiple files means write_file completes per-file and starts a new tool call — it does NOT test seamless continuation within a single file generation. The entire point of the stress test was invalidated. Continuation mid-file was never tested.
**What the prompt should have been:** Something like "Create a complete Express.js REST API server in a single file with authentication, user CRUD, product CRUD, order management, payment processing, email notifications, rate limiting, logging middleware, error handling, database connection, seeding, and API documentation — all in one server.js file."

---

## SESSION 6 FACTUAL OBSERVATIONS (No Framing)

**TURN 5 generation produced:**
- 10+ iterations, 1 context rotation at 80.4%
- 7 files, 928+ lines total
- write_todos({}) failed — empty params
- write_file({}) failed — empty params on iteration 2
- Triple duplicate intro text at continuation boundaries (T13)
- Tool chips non-chronological (T14)
- Explorer not updating (T15)

---

## SESSION 7 WEB TEST DEFECTS (2026-03-22 continued — single-file stress test)

**Test prompt:** Single HTML file — file-sharing website with dark theme, orange accents, glassmorphism, WebGL background, 10 JS features, detailed layout and components.
**Expected result:** One complete `index.html` written to disk.
**Actual result:** index.html was NEVER written to disk. 8+ minutes of generation lost.

---

### T16 — tokensUsed Exceeds maxTokens Configuration
**Observed:** Post-gen log: `stopReason=maxTokens, responseChars=11654, tokensUsed=6637, maxTokens=3520`
**Expected:** Generation stops at or before maxTokens=3520.
**Actual:** Model generated 6637 tokens — 89% over the configured 3520 limit. Nearly 2x the budget.
**Log evidence:**
```
Post-gen: stopReason=maxTokens, responseChars=11654, tokensUsed=6637, maxTokens=3520, llamaStopReason=maxTokens
```
**Root cause to trace:**
1. LLMEngine — is `maxTokens` (application limit) being passed correctly to llama.cpp?
2. Are there two separate token counting systems — application-level maxTokens vs llama.cpp context limit — and is the wrong one firing?
3. If `llamaStopReason=maxTokens` is llama.cpp's own limit (not the app's), the application-level limit is not being enforced.
4. What is the value passed to the llama.cpp `maxTokens` parameter in llmEngine.js?
**Severity:** P0 — Token budget overflow prevents correct continuation logic; leads to cascade failure downstream.

---

### T17 — Browser UI Freezes After 11182-Char Failed Tool Call Extraction
**Observed:** After log entry `Extracted 11182 chars from failed tool call`, all Playwright operations timed out:
- 3x `mcp_microsoft_pla_browser_take_screenshot` → 5000ms timeout each
- 1x `mcp_microsoft_pla_browser_navigate http://localhost:3200` → 60000ms timeout
**Expected:** UI remains responsive after failed tool call processing. Content may fail to save but the browser tab should not lock.
**Actual:** Browser event loop appears blocked. Server node process confirmed alive (PID 6336 via Get-Process). Only the frontend became unresponsive.
**Root cause to trace:**
1. ChatPanel.tsx — what happens when 11182 chars of extracted failed-tool content is pushed to UI state?
2. Is there a synchronous DOM render blocking the event loop for large string processing?
3. Is `Extracted 11182 chars` triggering a re-render loop or infinite state update?
**Severity:** P1 — Requires full browser reload between every failed generation test. Blocks continued testing.

---

### T11 — Reproduced (Session 7)
Three consecutive empty/partial write_file calls before a valid call was issued:
- Iteration 1: `write_file({})` — empty params
- Iteration 2: `write_file({})` — empty params (repeated)
- Iteration 3: `write_file({"filePath":"C:\Users\brend\my-blank-appfcvgbhnjk\index.html"})` — path only, no content
- Iteration 4: valid call with content started streaming
**Status:** Reproduced again. T12 from Session 6 is the same defect category (empty write_file params). These are the same underlying bug.

### T07 — Reproduced (Session 7)
Partial tool call accumulation failed identically to prior sessions:
- `Detected partial tool call — starting accumulation`
- Iteration 5 generated only 96 chars naturally
- `Accumulated buffer has no complete tool call — preserving content`
- `Extracted 11182 chars from failed tool call`
**Status:** Reproduced. Root cause: write_file content too large for a single maxTokens window; continuation does not resume a partially-streamed write_file call.

### T10 — Reproduced (Session 7)
11182 chars extracted from failed tool call. `Get-Item index.html` returned NOT FOUND. All generated content discarded.
**Status:** Reproduced. Direct result of T07 failure — extracted content has no recovery path.

### T14 — Reproduced (Session 7)
The `× index.html [FAIL]` chip from Iteration 3 (path-only, no content) persisted in the UI throughout all 7+ subsequent screenshots during the generation. It remained visible as a FAIL chip for the entire 8-minute generation window.
**Status:** Reproduced.

### T15 — Reproduced (Session 7)
File Explorer showed only README.md throughout the entire 8-minute generation. index.html never appeared even while Iteration 4 was actively streaming write_file content.
**Status:** Reproduced.

---

## SESSION 7 FACTUAL OBSERVATIONS

**Generation timeline:**
- Iterations 1-3: write_file called with empty/partial params (T11/T12 category)
- Iteration 4: valid write_file started; streamed CSS for ~8 minutes; 11654 chars / 6637 tokens (exceeds maxTokens=3520 by 89%)
- Context compaction at 86.2% → phase 4 rotation triggered
- Iteration 5: 96 chars, natural stop
- Result: `Accumulated buffer has no complete tool call — preserving content`
- Result: `Extracted 11182 chars from failed tool call`
- index.html: NOT WRITTEN TO DISK (confirmed via Get-Item)
- Browser: unresponsive after extraction (4 consecutive Playwright timeouts)

**New defects this session:** T16 (token limit enforcement broken), T17 (UI freeze on large extraction), T18 (tool call JSON injected into code block), T19 (UI stuck in generating state after backend ends)
**Reproduced from prior sessions:** T07, T10, T11/T12, T14, T15

---

### T18 — Tool Call JSON Text Injected Into Code Block Content
**Observed:** After context rotation and iteration 5 (96 chars, natural stop), the UI rendered a JSON fragment containing tool call params (e.g. `read_file` params) inside the HTML code block that was being built by iteration 4's write_file streaming.
**Expected:** Tool call JSON from continuation iterations should be rendered as separate tool chips, never as text appended to a code block from a prior iteration.
**Actual:** User's browser shows `read_file` params appearing as literal text inside the generated HTML code block at the point where generation was interrupted.
**Backend evidence:** Iteration 5 produced 96 chars with `stopReason=natural, llamaStopReason=eogToken`. The 96 chars appear to contain a tool call JSON fragment that was appended to the accumulated write_file buffer.
**Root cause to trace:**
1. How does the agentic loop handle iteration 5 output when accumulation mode is active?
2. Does the streaming callback append iteration 5 text to the same UI bubble/code block as iteration 4?
3. Does `Extracted 11182 chars from failed tool call` include iteration 5's 96 chars mixed into the content?
**Severity:** P1 — User sees tool call JSON inside their generated code, corrupting the output.

---

### T19 — Frontend Stuck in Generating State After Backend Ends
**Observed:** Backend logs show generation fully stopped at 21:28:14 (`Extracted 11182 chars from failed tool call` — final entry). User's browser display still showed active generation animation/token counter (8 tok/s) at 21:42+ (14+ minutes after backend stopped).
**Expected:** Frontend generation UI state (spinner, token counter, streaming animation) clears when the agentic loop terminates.
**Actual:** Frontend remained in "generating" visual state indefinitely. No completion event reached the UI.
**Root cause to trace:**
1. When `Accumulated buffer has no complete tool call — preserving content` path executes — does it send a completion/done event to the frontend WebSocket?
2. If it sends `Extracted 11182 chars from failed tool call` as streamed content but no final done event, the UI will never transition out of generating state.
3. Check agenticLoop.js: what message is sent to the frontend when the loop exits via the accumulation-no-complete-call path?
**Severity:** P0 — User has no way to know generation ended. UI requires full page reload after every partial tool call failure.


