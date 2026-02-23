# PENDING FIXES — guIDE (Feb 21–22, 2026)

> **AGENT: Read this file at the start of every new context window before touching any code.**
> **Also re-read `.github/copilot-instructions.md` and `AGENT_RULES.md` before proceeding.**
> **DO NOT build. DO NOT guess. Read the relevant file before editing it.**

---

## STATUS SUMMARY (updated 2026-02-22 — diagnostic logging added; wrapper reapplication in resetSession fixed)

| Fix | Description | Status |
|-----|-------------|--------|
| FIX 1 | Llama 3.2-3B word salad | ⚠️ UNKNOWN ROOT CAUSE — All prior hypotheses failed. Diagnostic logging now added. BUILD AND TEST. Read `[LLM:DIAG]` lines in log to see exact wrapper state + sampling params + full chat history being sent to model. |
| REGRESSION | All probes failing on 4GB GPU | ✅ FIXED — probe moved pre-context |
| SESSION RESET BUG | Wrapper not reapplied after resetSession() | ✅ FIXED — `resetSession` now calls `_applyNamedWrapper(_selectedWrapperName)` after creating new LlamaChat |
| FIX 2 | `\b` JSON escape in Windows paths breaks pathValidator | ✅ ALREADY IN SOURCE — `targetPath.replace(/[\x00-\x1F]/g, '')` strips all control chars |
| FIX 3 | Mid-stream tool JSON leaks as visible text | ❌ NOT APPLIED |
| FIX 4 | OpenAI function-call format `[{"name":...}]` not parsed | ✅ ALREADY IN SOURCE — Method 3e exists in `main/tools/mcpToolParser.js` lines 555-577 |
| FIX 5 | Seeded history primes model for wrong behavior | ✅ IN SOURCE (PF-3) — strips `json\n{"tool":` blocks; not yet in installed build |
| FIX 6 | Qwen3-0.6B hallucinates file listing | ❌ NOT APPLIED |
| FIX 7 | agenticPhases: duplicate entries + persists after generation | ✅ DONE — dedup replaces in-place; useEffect clears 1500ms after isGenerating→false |
| FIX 8 | Qwen3-4B-Function-Calling-Pro: "hi" outputs raw function JSON | ✅ DONE — chat-type gate detects pure function-call JSON and routes to processResponse |
| PF-2 | Qwen2.5-1.5B getting ThoughtTokenBudget:256 | ✅ IN SOURCE — modelProfiles+llmEngine fixed; not yet in installed build |
| PF-5 | BUG-029: small context drops tools entirely | ✅ IN SOURCE — compact fallback added; not yet in installed build |

**Source-ready (needs build):** All of the above, plus PF-1/PF-4 (executingTools spinner), VS Code phase UI

**DO NOT delete wrapper-cache.json** — cache stores wrapper NAMES (still correct); date preamble fix applies at build-time via `_buildWrapperInstance`.

---

## FIXES ALREADY IN SOURCE (do not re-apply — build needed to test)

- `main/modelProfiles.js`: tiny → maxToolsPerTurn=8, effectiveContextSize=32768; small → maxToolsPerTurn=12
- `main/agenticChatHelpers.js`: iteration 1 general tool array reordered; `wrong_tool_format` + `fabricated_info` detectors added
- `main/constants.js`: compact preamble rule added: "Never tell the user to run a command themselves"
- `main/llmEngine.js`: `msg.includes('disposed')` added to isContextError; `isThinkingVariant` extended with `qwen3`; thinkMode default `'budget'` → `'none'`; trusted-wrapper early return for `Llama3_2LightweightChatWrapper`
- `main/modelProfiles.js` + `main/modelDetection.js`: SmolLM family entirely removed
- `main/modelProfiles.js`: Qwen base/tiny/small → `thinkTokens: { mode: 'none' }` + `_thinkBudgetWhenActive`
- `main/agenticChat.js`: PF-3 history seeding strips tool JSON; PF-5 BUG-029 compact downgrade; `agentic-phase` IPC events
- `preload.js`: `onAgenticPhase` channel
- `src/types/electron.ts`: `onAgenticPhase` interface
- `src/components/Chat/ChatPanel.tsx`: `agenticPhases` state, listener, render, clearing

---

## FIX 1 — Word salad on Llama-3.2-3B (and potentially all models)

> **STATUS: ⚠️ ROOT CAUSE UNKNOWN — DO NOT GUESS AGAIN.**
> Diagnostic logging is now in place. Build → test with Llama-3.2-3B-Instruct-Q4_K_S → read log → find `[LLM:DIAG]` lines → read the exact system prompt, user message, wrapper state, and sampling params.

### FAILED ATTEMPTS — DO NOT RETRY THESE

1. **Jinja override suppression** — added `Llama3_2LightweightChatWrapper` to trusted-wrapper early-return list. Wrapper correctly applied, confirmed in log. Word salad continued.

2. **Date preamble disabled** — `{ todayDate: null, cuttingKnowledgeDate: null }`. Confirmed working (wrapper log shows `todayDate=null`). Word salad continued.

3. **Probe moved pre-context** — fixed the VRAM regression for 4GB GPUs. Did NOT fix word salad.

4. **topK 20→40 in defaultParams** — this change does NOTHING. `modelProfiles.js` `llama/small` overrides topK to 20 via `mergedParams = { ...defaultParams, ...modelOverrides }`. The fix was pointless. The comment about it has been corrected.

5. **frequencyPenalty/presencePenalty to 0** — also did nothing. `llama/small` profile already has both at 0.0 via the `BASE_DEFAULTS` → `llama.base` merge. The generate call uses `freqPenalty ?? 0.1` which correctly returns 0.0 since 0.0 is not null/undefined.

### What the diagnostic will show

After building, send "hi" to Llama-3.2-3B-Instruct-Q4_K_S. Find these lines in the log:
```
[LLM:DIAG] ══ PRE-GENERATION SNAPSHOT ══
  wrapper     : Llama3_2LightweightChatWrapper
  todayDate   : null
  cuttingDate : null
  sampling    : temp=0.4 topP=0.85 topK=20 repeat=1.12 freq=0 pres=0
  history (2 turns):
  [0] SYSTEM (N chars): <FULL SYSTEM PROMPT HERE>
  [1] USER: hi
```

**Read the SYSTEM prompt content.** Compare it against what LM Studio sends. That is the next diagnostic step. Do not write another line of fix code until this has been done.

### Also fixed in this batch (real bugs, not hypotheses)

- `resetSession()` was creating a new `LlamaChat` without reapplying the probe-confirmed wrapper. After any context overflow → reset, the wrapper would revert to node-llama-cpp auto-detected default (with live todayDate). Fixed: `_applyNamedWrapper(_selectedWrapperName)` now called in resetSession after LlamaChat creation.
- Probe now passes production sampling params to `generateResponse` so it tests the same regime as real inference.

**File:** `main/llmEngine.js`

**Root cause (confirmed from logs):**
```
[LLM] _applyChatWrapperOverride: arch="llama" wrapper="Llama3_2LightweightChatWrapper" hasJinja=true
[LLM] BUG-044: "Llama3_2LightweightChatWrapper" selected for arch "llama" — overriding with JinjaTemplateChatWrapper
```
The Jinja-first logic we added overrides `Llama3_2LightweightChatWrapper` even when node-llama-cpp correctly auto-detected it. The Llama 3.2 Jinja template, when executed raw, produces malformed output for that model → word salad.

**Correct fix (GENERALIZED — not model-specific):**
The early-return block at the top of `_applyChatWrapperOverride()` currently reads:
```js
if (currentWrapper === 'JinjaTemplateChatWrapper' || currentWrapper === 'QwenChatWrapper') return;
```
This needs to include ALL wrappers that node-llama-cpp correctly auto-detects for known families.
Add `Llama3_2LightweightChatWrapper` to this trusted list — and when it IS that wrapper, reconstruct
it with `todayDate: null, cuttingKnowledgeDate: null` (to prevent double-system-block corruption)
then return. Do NOT fall through to the Jinja-first block.

---

## FIX 2 — Path traversal block due to `\b` JSON escape in Windows paths

**File:** `main/pathValidator.js`

**Root cause (confirmed from logs):**
```
[MCPToolServer] Path traversal blocked: "C:\Usersrend\my-static-appddc" → escapes project
```
Model outputs `C:\Users\brend\...` in JSON. The `\b` is parsed as a backspace char (ASCII 8),
so the path becomes `C:\Usersrend\...`. The path validator reads this garbled path,
detects it doesn't match the project root, and rejects it as traversal.

**Fix:** In `pathValidator.js`, add a `repairJsonEscapedPath(p)` function that runs
BEFORE any security check. It must convert JSON escape sequences that appear inside
what looks like a Windows file path back to their literal characters:
- `\b` → keep as literal `b` (backspace has no meaning in a file path)
- `\t` → keep as literal `t` (tab not valid in Windows paths)  
- `\f` → keep as literal `f`
- `\n`, `\r` → remove (newlines cannot be in a path)

Only apply this repair if the string looks like a Windows absolute path
(starts with a drive letter `X:\` or `X:/`).

Apply this repair at the entry point of `validatePath()` (or whatever the main
exported function is — **read the file first to find the correct function name**).

---

## FIX 3 — Mid-stream tool call JSON visible as glitchy text in UI

**File:** `src/utils/chatContentParser.ts`

**Root cause:**
During streaming, the raw ` ```json\n{"tool":"list_directory"...} ``` ` block is sent
character-by-character to the UI as `streamingText`. The UI renders it as plain text
while the block is building, so the user sees the raw JSON appear → flicker → disappear
when the tool card replaces it. This is not acceptable for production.

**Fix:** Add a function `stripToolCallBlocksFromStream(text: string): string` that:
1. Removes complete ` ```json\n{"tool":...}\n``` ` blocks entirely (they'll show as tool cards)
2. Removes INCOMPLETE/in-progress ` ```json ` blocks that haven't closed yet
   (use a regex that detects an opening ` ```json ` without a closing ` ``` `)
3. Also strips `<tool_call>...</tool_call>` patterns (used by some models)

This function should be called in `ChatPanel.tsx` on `streamingText` before it's rendered —
do NOT modify the underlying buffer, only what's displayed.

**Read `src/utils/chatContentParser.ts` and `src/components/Chat/ChatPanel.tsx` fully
before implementing** — the streaming display pipeline needs to be understood before touching it.

---

## FIX 4 — OpenAI function-call format not recognized

**File:** `main/mcpToolServer.js` (the `processResponse` / parser section)

**Root cause (confirmed from logs + screenshot 11):**
Qwen3-4B-Function-Calling-Pro (and potentially other models) outputs:
```json
[{"name": "greet", "arguments": {"person": "Bob"}}, {"name": "say_hello", "arguments": {}}]
```
This is OpenAI's native function-call format. Our parser only understands:
```json
{"tool": "tool_name", "params": {"key": "value"}}
```
So the output is rendered as raw text and no tool is executed.

**Fix:** In the response parser (wherever `processResponse` or tool detection runs —
**read the file to find the exact function**), add a pre-processing translation step:

Before the existing parsing logic, check if the response contains a JSON array where
items have `"name"` and `"arguments"` keys (OpenAI format). If detected, translate each
item to our format: `{"tool": item.name, "params": item.arguments}` and substitute
into the response text so the existing parser handles it normally.

Detection regex: `/\[\s*\{\s*"name"\s*:/` — only fires on clear OpenAI format,
no false positives on normal JSON.

This supports BOTH formats for any model without changing any existing logic.

---

## FIX 5 — Seeded chat history from previous model causes wrong behavior on load

**File:** `main/agenticChat.js`

**Root cause (confirmed from logs + screenshot 11):**
```
[AI Chat] Seeded local chatHistory from renderer (4 of 4 turns, max=11 for 4352-token context)
```
When the user switches from Qwen3-0.6B to Qwen3-4B-Function-Calling-Pro, the renderer
sends the previous model's conversation history. The 4B model receives turns that contain
function definitions it generated in the 0.6B model's format. On the very first "hi" it
fires function calls because the seeded history primes it for tool use.

**Fix:** In `agenticChat.js`, where `chatHistory` is seeded from the renderer, add a
model-change guard. If the model currently loading is different from the model that
generated the incoming history turns, do NOT seed — start fresh.

**Read the seeding code in agenticChat.js first** — search for `Seeded local chatHistory from renderer`
to find the exact location. The model name that generated the history is available on the
message objects or in a separate field — verify before implementing.

---

## FIX 6 — Qwen3-0.6B hallucinates file listing instead of calling tool

**File:** `main/agenticChatHelpers.js` — `classifyResponseFailure()` function

**Root cause:**
`grammar=never` for tiny models (0.6B). Grammar is disabled because it caused crashes
at that size. Without forced grammar, the model invents plausible text ("The files are
at C:\Users\...") instead of calling `list_directory`. The agentic loop doesn't detect
this as a failure and returns the hallucinated text.

**Fix:** In `classifyResponseFailure()`, add a failure pattern check:
- If `hasToolCalls === false` AND `taskType !== 'chat'` AND the response contains
  file-path-like strings (`C:\`, `./`, `/`) without any tool call → classify as
  `{ type: 'hallucinated_file_info', severity: 'nudge' }` and return a recovery prompt:
  `"Use the list_directory tool to actually list the files — do not describe them from memory."`

This is a general hallucination detector for file-info responses, not just 0.6B.

---

## HARDWARE NOTE (not a code bug)

GPT-OSS-20B with `effectiveContextSize=32768` only got 4 GPU layers on 4GB VRAM.
It OOM'd mid-generation. Consider: when `gpuLayers < 10` for an xlarge model,
emit a warning to the UI: "This model requires more VRAM than available. Responses
may be slow or fail." This is a nice-to-have, not blocking.

---

## FIX 7 — agenticPhases: duplicate entries + persists after generation ends

**Files:** `src/components/Chat/ChatPanel.tsx`

**Root cause (confirmed from screenshots 2 and 3 + code review):**
1. When `summarizing-history` (or another phase) fires `start` AFTER a previous `done` for the same phase (e.g., context compacted twice in one response), the dedup only blocks duplicate `running` states — a `start` after a `done` adds a NEW entry. Result: 4 stacked "✓ Summarizing conversation history" entries.
2. The phases appear OUTSIDE the current streaming message bubble in screenshot 3 — they render at the bottom of the page below the model chip, suggesting they persisted after `isGenerating` went false.

**Fix:**
- In the `start` handler (line ~321): instead of only checking `p.status === 'running'`, replace any EXISTING entry for that `phase` (regardless of status) with a fresh `running` entry. This way re-firing the same phase resets it in-place rather than stacking.
- In the `done` handler: same key — update in place.
- For persistence: add a `useEffect` watching `isGenerating` — when it becomes `false`, call `setAgenticPhases([])` with a 500ms delay (allows final render of done states before clearing).

**Exact location:** `src/components/Chat/ChatPanel.tsx` lines 315–335 (the `onAgenticPhase` listener callback).

---

## FIX 8 — Qwen3-4B-Function-Calling-Pro outputs raw OpenAI function JSON for simple chat

**Files:** `main/tools/mcpToolParser.js`, `main/agenticChat.js`

**Root cause (confirmed from screenshot 6 + 2026-02-22T01:44:55 log):**
1. `main/tools/mcpToolParser.js` does NOT have Method 3e (OpenAI array format: `[{"name":"tool","arguments":{...}}]`). It exists only in `_pipeline_backup_2026-02-21/tools/mcpToolParser.js`. It was never migrated to the live file.
2. The agentic loop's `Chat-type hard gate` skips `processResponse()` entirely when `taskType === 'chat'` — so even if Method 3e were added, it wouldn't fire for a "hi" message.
3. The model fabricates non-existent tools ("greeting", "say_hello") because it always tries to emit function JSON regardless of input.

**Fix (two parts):**
- **Part A** — Add Method 3e to `main/tools/mcpToolParser.js`: before the fallback section, detect `[{"name":..., "arguments":...}]` top-level array format and translate to `{"tool": item.name, "params": item.arguments}` for existing parser to handle. Read the LIVE file to find exact insertion point.
- **Part B** — In `main/agenticChat.js`, after the chat-type hard gate, check if the response is ONLY OpenAI function JSON (regex: `/^\s*\[\s*\{\s*"name"\s*:/`). If so, and the tool name is not a real tool in the tool list → treat as fabricated output, do NOT display it. Return empty/retry OR return a nudge. This handles the fabrication case regardless of task type.

**Read before editing:** `main/tools/mcpToolParser.js` entirely (to find insertion point for Method 3e), `main/agenticChat.js` around the chat-type hard gate.

---

## FILES TO READ BEFORE EDITING

| Fix | File to read fully before touching |
|-----|-----------------------------------|
| 1 | `main/llmEngine.js` lines 500–615 (`_applyChatWrapperOverride`) |
| 2 | `main/pathValidator.js` entirely |
| 3 | `src/utils/chatContentParser.ts` entirely + `src/components/Chat/ChatPanel.tsx` lines 100–300 |
| 4 | `main/tools/mcpToolParser.js` entirely (Method 3e is in backup, needs port to live file) |
| 5 | `main/agenticChat.js` — search for `Seeded local chatHistory from renderer` |
| 6 | `main/agenticChatHelpers.js` — `classifyResponseFailure()` function (~line 760) |
| 7 | `src/components/Chat/ChatPanel.tsx` lines 310–360 (agenticPhase listener) |
| 8 | `main/tools/mcpToolParser.js` entirely + `main/agenticChat.js` chat-type hard gate |

---

## RULES REMINDER (from copilot-instructions.md + AGENT_RULES.md)

- **NEVER build** — say "Ready to build" when done
- **Plan before code** — present each fix, wait for approval, then implement exactly that
- **Read before editing** — never assume file contents, always read first
- **Production software** — ships to ALL users on ALL hardware, every fix must be general
- **Never say done without proof** — verify each change landed correctly after applying
