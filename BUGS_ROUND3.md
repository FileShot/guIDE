# BUGS ROUND 3 — Live Monitoring Session
**Date:** 2026-02-21  
**Monitoring by:** GitHub Copilot (Claude Sonnet 4.6)  
**Test Model:** Qwen3-4B-Instruct-2507-Q4_K_M (4B, compact preamble, CPU-only)  
**Context profile:** `qwen/small` | ctx=5632 | sysReserve=280 | compact=true | tools=8 | grammar=limited | retry=3  
**GPU:** 4.0 GB VRAM (8B VL model needed >4096 ctx — fell back to full CPU, 0 GPU layers)  
**Log:** `%APPDATA%\guide-ide\logs\guide-main.log`  
**Sessions:** `%APPDATA%\guide-ide\.guide-config.json → .chatSessions[]`

---

## Pre-Test Known Issues (from screenshots)

### BUG-PRE-01 — Greeting Hallucination (Small Models)
- **Observed:** User sent "Hi". Model (Qwen3-Coder-30B-A3B-Instruct-Q4_K_S) responded hallucinating that it received "corrupted content / a mix of programming concepts."  
- **Root cause hypothesis:** Preamble too complex for small/distilled models — model pattern-matches to training data instead of holding the persona context.  
- **Status:** Under investigation  

### BUG-PRE-02 — Agentic Tool Call Parser Failure (`described_not_executed`)
- **Observed:** Model describes tool calls in plain text instead of structured format. Parser can't extract them. Loop retries 3× then falls back.  
- **Error string:** `[Response failed: described_not_executed — retrying (1/3)]`  
- **Root cause hypothesis:** Model outputs tool call JSON inside markdown code block OR uses slightly different format than parser regex expects.  
- **Status:** Under investigation  

---

## Live Testing Findings

---

## 🔴 BUG-R3-001 — Every Chat Session Starts With `[assistant]: No response generated.`

**Severity:** High — pollutes every session's history  
**First observed:** 18:22 startup  
**Evidence:** Confirmed across 5+ consecutive sessions: `session-1771696368367`, `session-1771696381504`, `session-1771696389663`, `session-1771696394116`, `session-1771696460196` — ALL start with `[assistant]: No response generated.` before any user input.  
**Pattern:** `[assistant: No response generated.] → [system: model loaded] → [user: hi] → [assistant: real response]`  
**Root cause:** Something fires a generation attempt at session creation time before a model is loaded or before the user sends any message. The empty result gets persisted as an assistant message.  
**Impact:** History corruption — every context the model sees starts with a ghost failure message.

---

## 🔴 BUG-R3-002 — Duplicate Simultaneous Agentic Requests (Race Condition)

**Severity:** Critical — can cause total conversation failure  
**First observed:** 18:26:01  
**Log evidence:**
```
18:26:01.120 LOG [AI Chat] Agentic iteration 1/50  Prompt: ~636 tokens   compact=false  task=chat
18:26:01.696 LOG [AI Chat] Agentic iteration 1/50  Prompt: ~1126 tokens  compact=true   task=general
```
Two `iteration 1/50` fired at the SAME timestamp — two parallel agentic invocations for the same user message.  
**Also seen:** Double rapid session resets at 18:23:28-31 and 18:25:21-22.  
**Root cause:** A user message triggers two parallel agentic chat invocations — likely a double-fire in the IPC handler or the renderer sending the message to main twice.  
**Impact:** First request gets superseded by second, second may be superseded by any follow-up. User can receive zero visible responses.

---

## 🔴 BUG-R3-003 — `Request superseded` — Responses Never Reach User

**Severity:** Critical  
**Log evidence:**
```
18:26:01.918 LOG [AI Chat] Request superseded after generation, exiting loop
18:26:05.868 LOG [AI Chat] Request superseded after generation, exiting loop
```
**Session evidence:** `session-1771698324826` — user sent 3 messages with ZERO assistant responses saved. Connected to BUG-R3-002 — the duplicate requests supersede each other. Model DID generate content but it was discarded before saving/displaying.  
**Impact:** User receives no reply at all for some interactions. User experienced complete stuck state.

---

## 🔴 BUG-R3-004 — Tool-Call JSON Stripped as "Hallucinated Content" → Tool Cycle

**Severity:** Critical — prevents ALL multi-turn agentic completion  
**Observed:** Every single tool invocation throughout test  
**Log pattern (repeating):**
```
[MCP] Executed tool: read_file result: success
[AI Chat] Stripped hallucinated content: 119 → 0 chars
[AI Chat] Agentic iteration N/50
```
**Root cause:** The hallucination stripper runs AFTER MCP extracts and executes the tool call. It then strips the tool-call JSON block (95-144 chars) to 0 — so the assistant's turn in chat history has an EMPTY message instead of the tool call. On the next iteration the model has no memory of calling that tool, so it calls it again.  
**Downstream:** Tool cycle detector fires — `Tool cycle detected: [read_file → read_file] repeated 3 times` → `Generating final summary...` — but model generates empty final summary. History condenses (22→3 or 12→3 turns) and the exact same loop restarts.  
**Impact:** ALL agentic tasks with tool calls fail to complete.

---

## 🔴 BUG-R3-005 — Error/Cancel Messages Persisted as `[assistant]` History Entries

**Severity:** High — history corruption + confusing UX  
**Evidence from `session-1771698363922`:**
```
[assistant]: Error: Request superseded while waiting for model.    (× 5 identical)
[assistant]: [Generation cancelled]
```
**Root cause:** When requests are superseded or cancelled, the error/cancel string is being saved to chat history as an assistant message instead of being handled silently at the UI layer.  
**Impact:** 5 identical error messages in assistant role corrupt all future context for that session.

---

## 🔴 BUG-R3-006 — Model Loading Timeout (2 Minutes) With No Intermediate Feedback

**Severity:** High  
**Evidence from session `session-1771698363922`:**
```
[assistant]: [Warning] Failed to load model "Qwen3-4B-Instruct-2507-Q4_K_M": 
Model loading timed out after 2 minutes. Try a smaller model or restart guIDE.
```
**Sequence:** User loaded Qwen3-4B. Model never completed loading within the 2-minute timeout. User sent 3 messages with no response or loading indicator feedback, then gave up. Model silently timed out.  
**Root cause (likely):** Memory pressure from previously-loaded 8B VL model being unloaded, possibly combined with BUG-R3-002 triggering duplicate load attempts.  
**Note:** The 4B model eventually DID load successfully in a later session. Timeout appears to be one-time under memory pressure.

---

## 🟡 BUG-R3-007 — Model Describes Tool Intent Without Calling Tool

**Severity:** Medium — silent task failure  
**First observed:** 18:30:55  
**Log evidence:**
```
[MCP] processResponse: Searching for today's date now.
[MCP] Total tool calls found (pre-repair): 0
[AI Chat] No more tool calls, ending agentic loop

[MCP] processResponse: Searching for the current weather in NYC now.
[MCP] Total tool calls found (pre-repair): 0
[AI Chat] No more tool calls, ending agentic loop
```
Model responds with verbal description of intended action — zero actual tool calls — loop ends and the description is returned as the final answer.  
**Likely cause:** Context compaction stripping tool-format instructions from system prompt.  
**Impact:** User receives "Searching for X" message instead of actual result.

---

## 🟡 BUG-R3-008 — Repeated Refusals at Large Context (>1500 tokens), `refusesOften` Miscalibrated

**Severity:** High — prevents completion of any multi-turn task  
**Pattern:**
- 1586-token prompt → `⚠️ ROLLBACK (refusal) — retry 1/3` (~38s)
- Retry 1: 1586 tokens → `⚠️ ROLLBACK (refusal) — retry 2/3` (~30s)
- Retry 2: prompt TRIMMED to 1070 tokens → SUCCEEDS (web_search called)
- web_search result added → prompt 1877 tokens → `⚠️ ROLLBACK (refusal) — retry 1/3` AGAIN
- Pattern repeats indefinitely

**Root cause:** 4B Qwen model refuses to respond when prompts exceed ~1500 tokens. Rollback-retry mechanism trims on retry 2/3 which succeeds, but each tool result re-expands context past the threshold and triggers refusal on the very next iteration.  
**Miscalibration:** Model's `quirks.refusesOften` is set to `false` — should be `true` for this model at this context size.  
**Impact:** No multi-turn agentic task can ever complete on this model in its current configuration.

---

## 🟢 OBS-001 — Session Reset Before Model Load (Startup Warning)

**Severity:** Low / expected  
**Log:** `18:22:01 WARN [LLM] Cannot reset session: model or context is null/disposed`  
**Cause:** Something triggers `llmResetSession` IPC call on startup before any model is loaded. Gracefully handled, no crash.

---

## 🟢 OBS-002 — GPU Context Fallback (Expected on 4GB VRAM)

**Severity:** Info only  
**Log:** 8B VL model needed 4096 context minimum, GPU had only 2304 → full CPU fallback, 16384 ctx, 0 GPU layers.  
**Not a bug** — correct behavior. UX implication: very slow CPU inference for 8B+ models.

---

## Summary Table

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| PRE-01 | 🟡 Med | Greeting hallucination (small models) | Under investigation |
| PRE-02 | 🟡 Med | `described_not_executed` agentic loop | Under investigation |
| R3-001 | 🔴 High | Ghost `No response generated.` at session start | Unresolved |
| R3-002 | 🔴 Critical | Duplicate agentic requests — race condition | Unresolved |
| R3-003 | 🔴 Critical | `Request superseded` — responses never shown | Unresolved |
| R3-004 | 🔴 Critical | Tool-call JSON stripped → tool repeat cycle | Unresolved |
| R3-005 | 🔴 High | Error/cancel strings saved as assistant messages | Unresolved |
| R3-006 | 🔴 High | Model load timeout — no intermediate feedback | Unresolved |
| R3-007 | 🟡 Medium | Model describes tool intent, doesn't call tool | Unresolved |
| R3-008 | 🟡 High | Refusals at >1500-token context, `refusesOften` miscal. | Unresolved |
| OBS-001 | 🟢 Low | Reset-before-load warning at startup | Expected behavior |
| OBS-002 | 🟢 Info | GPU context fallback on 4GB VRAM | Expected behavior |

---

## Fix Priority (Recommended Order)

1. **R3-004** — Fix hallucination stripper: do NOT strip tool-call JSON from assistant turns after MCP has already extracted and executed the tool (exempt turns with confirmed tool execution)
2. **R3-002** — Fix double-fire in IPC/renderer: deduplicate agentic invocations with a per-message lock or request ID check
3. **R3-005** — Suppress error/cancel strings from being saved to chat history; handle at UI display layer only
4. **R3-001** — Gate session-init generation behind a "model ready AND user sent first message" check
5. **R3-008** — Set `quirks.refusesOften: true` for Qwen 4B profile; add smarter prompt size check before first generation to pre-trim if >1200 tokens
6. **R3-006** — Investigate model loader for deadlock under memory pressure; add heartbeat/progress events during load (every 10-15s)
7. **R3-007** — Verify tool-format instructions survive context compaction; add a static tool-list section that compaction cannot remove
8. **R3-003** — Widen minimum response-save window before allowing supersede; ensure any completed generation is saved even if superseded

---

---

## 🟡 BUG-R3-009 — `Generation error: Object is disposed` When Session Reset Mid-Generation

**Severity:** Medium — task data loss  
**Log evidence:**
```
18:40:22 LOG [LLM] Resetting session (standard prompt, ~1218 tokens)
18:40:22 ERROR [AI Chat] Generation error on iteration 4: Object is disposed
18:40:22 LOG [AI Chat] Generating final summary...
```
New user message fired a session reset while iteration 4 was mid-generation. LLM context was disposed, throwing `Object is disposed`. The final summary generation also failed (refusal then supersede).  
**Root cause:** No guard preventing session reset while agentic generation is in-flight. When user sends a new message during a multi-iteration agentic task, the context gets torn down mid-inference.  
**Impact:** All in-progress agentic work lost silently. User can interrupt their own in-progress tasks accidentally.

---

## 🟡 OBS-004 — Zombie Async Tool Calls Continue After Session Supersede

**Severity:** Medium  
**Evidence:** `fetch_webpage` errors for `https://weather.com/en-US/weather/today/l/New+York,+NY` continued firing TIMEOUT + HTTP 404 errors across many log lines, even after the session that spawned them was superseded, reset, and a completely new model was loaded (from 4B → 30B). Errors persisted for 3+ minutes.  
**Root cause:** `fetch_webpage` async operations not cancelled when their parent agentic session is superseded. No cleanup of pending tool-call promises on session teardown.  
**Secondary issue:** The `weather.com` URL format itself is wrong — `New+York,+NY` in the path returns HTTP 404. The correct URL path uses a weather.com location token, not a city name string.

---

## 🟢 OBS-005 — "SONNET" User-to-Monitor Messages Interpreted by guIDE AI

**Severity:** Info  
**Observation:** User sent messages to me (the monitoring agent) directly through the chat window: `"SONNET, IT SAYS RETRYING 1/3..."`, `"SONNE TAKE NOTE"`, `"TAK NOTE SONNET"`, etc. The guIDE 30B model interpreted these as being addressed to it and responded in-context: `"The's frustration about 'the not saying hello and what' is valid..."`.  
**Not a bug** — this is expected behavior (model processes all turns in context). User communicated successfully to the monitoring agent. guIDE's model handled the misdirected address gracefully.

---

## 30B Model Task Completion — Confirmed Working

Despite the bugs above, the **Qwen3-Coder-30B-A3B-Instruct-Q4_K_S** successfully completed a multi-file read task:
- `list_directory` on `C:\Users\brend\my-static-appff` → success
- `read_file` × 4 (index.html, style.css, script.js, README.md) → all success
- Final summary generated correctly (dark-themed static website, vanilla HTML/CSS/JS, `README.md` instructions)
- Model did NOT loop, did NOT refuse, did NOT produce empty responses on this task

The 30B model shows the architecture IS capable — but is significantly hampered by the bugs above (especially BUG-R3-008 UI flash-disappear and BUG-R3-004 tool-record stripping).

---

## User Design Direction (Captured From Test Session)

User message (recorded in `session-1771698975710`):

> *"SONNET, IT SAYS RETRYING 1/3, then it will print a response, then the response will disappear, then it will say retrying 2/3, then it will start to respond, then the response will disappear then it will do it again. these models are failing. every way. we need to totally redo the system prompt. it is over engineered. we need to COPY / backup the current infrastructure and start from scratch with a simpler approach."*

**Requested actions:**
1. ✅ Note the rollback/retry flash-disappear bug (BUG-R3-008)
2. 📋 COPY / backup current infrastructure (pending — not yet done)
3. 📋 Start fresh with a simpler system prompt approach

---

*Monitoring continues — test NOT over.*
