# Bug Report 27 — Five Critical Bugs (2026-02-27)

> This document traces all 5 bugs identified from user screenshots. Each entry includes exact file locations,
> full pipeline trace front-to-back, and the specific code causing the failure.
> Intended to survive context window resets — all information needed to fix each bug is here.

**Status legend:**  
- [ ] = Not yet fixed  
- [x] = Fixed and ready to build  

---

## BUG 1 — Tool Call Dropdown Disappears After Response Finalizes

**Status:** [x] IMPLEMENTED 2026-02-27  
**Severity:** HIGH — Users see tool calls execute during streaming, then the entire block vanishes. No audit trail.

### Fix Method
4 changes to `src/components/Chat/ChatPanel.tsx`:
1. **Line 11** — Added `MCPToolResult` to import from `@/types/electron`
2. **Line 47** — Added `toolsUsed?: MCPToolResult[]` to `ChatMessage` interface (after `checkpointId`)
3. **Line 835** — Stored `result.toolResults` on `assistantMsg`: `toolsUsed: result.toolResults && result.toolResults.length > 0 ? result.toolResults : undefined`
4. **Lines 1629–1653** — Expanded `renderMessage` from 1-liner to full function: reads `msg.toolsUsed`, renders `ToolCallGroup` with one `CollapsibleToolBlock` per tool (success/fail based on `tu.result?.success`), guarded by `hasToolGroup` check (key `tcg-all`) to prevent duplicates when `renderContentParts` already found inline tool blocks

### What Happens
During streaming, the "in-progress" assistant bubble shows `CollapsibleToolBlock` components for each
tool that ran (`completedStreamingTools`). When the response finishes, these disappear entirely from the
UI. The finalized assistant message bubble shows only the model's text — no tool call history.

### Full Pipeline Trace

```
User sends message
  → ChatPanel.tsx sendMessageDirect() (line ~660)
     → setCompletedStreamingTools([])             ← cleared at start of send
     → setExecutingTools([])
     
IPC: onToolExecuting fires (each tool starting)
  → ChatPanel.tsx lines 347-357
     → setExecutingTools([...executingToolsRef.current, { tool, params }])
     → executingToolsRef.current updated

IPC: onMcpToolResults fires (tools finished for this turn)
  → ChatPanel.tsx lines 359-371
     → const finished = executingToolsRef.current
     → setCompletedStreamingTools(prev => [...prev, ...finished])   ← tools visible in bubble
     → setExecutingTools([])

STREAMING: UI renders "in-progress" bubble (ChatPanel.tsx ~line 2370-2460)
  → Conditioned on: (completedStreamingTools.length > 0 || executingTools.length > 0)
  → Renders <ToolCallGroup> with <CollapsibleToolBlock> per completed tool  ← VISIBLE

Response finalizes (agenticChat.js returns result to IPC)
  → ChatPanel.tsx finally block (lines 857-866):
     → setIsGenerating(false)
     → setStreamingText('')
     → setCompletedStreamingTools([])    ← !! CLEARED — tool history GONE
     → executingToolsRef.current = []
     
  → assistantMsg constructed (lines 818-836):
     → content = streamBufferRef.current (model's text response — NO tool JSON)
     → NO toolsUsed field — interface doesn't have it (ChatMessage, line 35-47)
     
  → setMessages(prev => [...prev, assistantMsg])  ← finalized message added

  → "in-progress" bubble unmounts (isGenerating = false)
  → renderMessage(assistantMsg) called
     → chatContentParser parses content for {"tool":...} JSON blocks
     → streamBufferRef text is the model's SUMMARY, not raw tool JSON
     → NO tool call JSON found in content → nothing rendered
```

### Root Cause
`ChatMessage` has no `toolsUsed` field. `completedStreamingTools` is cleared on finalization.
The finalized message content is the model's text output, not the raw tool call JSON.
So there is nowhere for the tool call history to live after streaming ends.

### Exact Files and Lines

| File | Line(s) | Issue |
|------|---------|-------|
| `src/components/Chat/ChatPanel.tsx` | 35–47 | `ChatMessage` interface — no `toolsUsed` field |
| `src/components/Chat/ChatPanel.tsx` | 818–836 | `assistantMsg` built — `toolsUsed` never attached |
| `src/components/Chat/ChatPanel.tsx` | 861 | `setCompletedStreamingTools([])` — clears all history |
| `src/components/Chat/ChatPanel.tsx` | 2428–2455 | Streaming tool display — only rendered during `isGenerating` |
| `src/components/Chat/ChatWidgets.tsx` | 224 | `CollapsibleToolBlock` — `defaultOpen = false` |

### Required Fix (plan — DO NOT implement without approval)

1. Add `toolsUsed?: Array<{tool: string; params: any}>` to `ChatMessage` interface (line 47)
2. In `sendMessageDirect` `finally` block, BEFORE calling `setCompletedStreamingTools([])`:
   - Capture the current value: `const toolsSnapshot = completedStreamingTools`
   - Set `assistantMsg.toolsUsed = toolsSnapshot` before pushing to messages
3. In `renderMessage()`, after rendering `thinkingText`, render `assistantMsg.toolsUsed` if present:
   - Wrap in `<ToolCallGroup count={toolsUsed.length}>` with `<CollapsibleToolBlock>` per entry
4. Do NOT render a second copy if `msg.toolsUsed` is already rendered from parsed content

---

## BUG 2 — 0.6B Model Hallucinating File Lists

**Status:** [x] IMPLEMENTED 2026-02-27  
**Fix Method:** 12 edits across 4 files (`main/constants.js`, `pipeline-clone/main/constants.js`, `main/mcpToolServer.js`, `pipeline-clone/main/mcpToolServer.js`):
1. Added to Rules in both preambles (compact + full): `"You have no knowledge of what files exist in the project until you call list_directory. Never list, name, or assume project files from memory — always call list_directory first."`
2. Removed `"do not call list_directory repeatedly"` from the ENOENT rule in both preambles — this clause was actively discouraging the tool
3. Updated `getToolDefinitions()` list_directory description (both files): added `"Call this before naming or assuming any files exist — you have no knowledge of what files are in the project until you do."`
4. Updated `getCompactToolHint()` list_directory line (both files): added `"Call this FIRST — you do not know what files exist until you do."`  
**Severity:** HIGH — Model outputs fake files (e.g. `app.py`, `index.html`) that don't exist in the project.
Users cannot trust any file-related responses.

### What Happens
When asked "what files are in the project?" or similar, the 0.6B model responds with a list of file names
from its training data (typical Python/web project structure) WITHOUT calling `list_directory`.
The listed files do not exist in the file explorer.

### Full Pipeline Trace

```
User: "what files are in this project?"
  → agenticChat.js local path: detectTaskType() → 'agentic' or 'code'
  → Compact preamble loaded (constants.js DEFAULT_COMPACT_PREAMBLE)
     → Lists "list_directory: list files in a directory — use '.' to list project root"
     → Contains NO explicit rule: "Never list files without calling list_directory"
     → Contains rule "You have no knowledge of what any file contains until you call read_file"
        !! This is read_file only — model doesn't apply it to directory listing
  
  → Tool list sent to model (mcpToolServer.js line ~346)
     → list_directory description: 'List files and directories at a path. Use "." to list the project root.'
     → Weak description — no urgency cue, no "never guess" instruction

  → Model (Qwen3-0.6B tiny tier):
     → Does NOT call list_directory
     → Generates file list from training data (knows "typical projects have app.py, index.html etc.")
     → Outputs: "The project contains: app.py, index.html, requirements.txt" (HALLUCINATED)
  
  → agenticChat.js: no tool call detected → treat as final response
  → IPC: sends text back to ChatPanel.tsx
  → streamBufferRef.current accumulates hallucinated text
  → assistantMsg.content = hallucinated file list
  → UI renders the fake file names as if real
```

### Root Cause (TWO locations, both must be fixed)

**Problem A** — `DEFAULT_COMPACT_PREAMBLE` (`main/constants.js` line ~62):
The rule "You have no knowledge of what any file contains until you call `read_file`" applies only to
file CONTENTS. There is no equivalent rule for file NAMES. The model believes it knows which files exist.

**Problem B** — `list_directory` tool description (`main/mcpToolServer.js` line 347):
```
'List files and directories at a path. Use "." to list the project root.'
```
This description gives no urgency signal. A small model that isn't sure whether to call a tool will skip it.
Compare to `read_file` which the model DOES tend to call because its purpose is unambiguous.

### Exact Files and Lines

| File | Line(s) | Issue |
|------|---------|-------|
| `main/constants.js` | ~87 | Compact preamble — no rule about never listing files from memory |
| `main/mcpToolServer.js` | 346–352 | `list_directory` description too weak — no "never guess" signal |
| `pipeline-clone/main/constants.js` | same | Mirror needs same fix |
| `pipeline-clone/main/mcpToolServer.js` | same | Mirror needs same fix |

### Required Fix (plan — DO NOT implement without approval)

1. Add to compact preamble Rules section (constants.js, both real + clone):
   ```
   - You have NO knowledge of what files exist until you call list_directory. Never list or name project files from memory.
   ```
2. Update `list_directory` description in mcpToolServer.js (both real + clone):
   ```
   BEFORE: 'List files and directories at a path. Use "." to list the project root.'
   AFTER:  'List files in a directory. ALWAYS call this — never guess what files exist. Use "." for project root.'
   ```

---

## BUG 3 — 0.6B Model Repeating Itself

**Status:** [x] IMPLEMENTED 2026-02-27  
**Fix Method:** 2 changes across 4 files:
1. Added `lastTokensPenaltyCount: 512` to `sampling` block of all 7 tiny tier entries (`qwen`, `llama`, `phi`, `gemma`, `deepseek`, `lfm`, `exaone`) in both `main/modelProfiles.js` and `pipeline-clone/main/modelProfiles.js` — widens the repeat penalty lookback window from 128 to 512 tokens, making the engine less likely to pick recently-used tokens
2. Added `"Never copy or repeat sentences you have already written in this response."` to `DEFAULT_COMPACT_PREAMBLE` Behavior section in both `main/constants.js` and `pipeline-clone/main/constants.js`  
**Note:** The `lastTokensPenaltyCount` change is a sampling parameter passed to the inference engine — not a filter, regex, or post-processing script. These changes apply to ALL tiny tier models, not just 0.6B.  
**Severity:** MEDIUM — Model outputs the same explanation 2–3 times, filling the context with waste.
Bad UX. Makes model appear broken.

### What Happens
After producing a valid response, the 0.6B model continues generating. It re-explains its answer in
different words, loops through the same points, and sometimes copies verbatim sentences.
The response ends up 3–5x longer than necessary with no new information.

### Full Pipeline Trace

```
Model (Qwen3-0.6B) generates first complete answer (200–400 tokens)
  → Valid response ends with punctuation / newline
  → Model has NOT hit maxResponseTokens (4096) — large budget remaining
  → Model has NOT hit a stop sequence
  → EOS token NOT produced (0.6B models frequently fail to emit EOS reliably)
  → node-llama-cpp continues sampling:
     → repeatPenalty: 1.10 applied — penalizes EXACT token repeats
     → Does NOT penalize semantic repetition (same idea, different tokens)
  → Model generates second "pass" — same answer rephrased
  → Cycle continues until maxResponseTokens hit or EOS eventually fires

agenticChat.js receives streamed tokens:
  → streamTokens callback fires per-token to IPC
  → ChatPanel.tsx accumulates in streamBufferRef.current
  → No truncation, no repeat detection on the stream itself
  → Full repeated text saved into assistantMsg.content
```

### Root Cause (TWO locations)

**Problem A** — `maxResponseTokens: 4096` in tiny tier profile (`main/modelProfiles.js` line ~124):
4096 tokens is 3,000+ words. The 0.6B model should NEVER need more than ~600 tokens for a valid response.
This giant budget lets repetition run to completion.

**Problem B** — No conciseness instruction in compact preamble:
DEFAULT_COMPACT_PREAMBLE has no rule about response length or stopping. After answering, the model has
no signal that it should stop. A stronger instruction like "Give one clear answer. Do not repeat yourself.
Stop after the question is answered." would help.
(Note: `repeatPenalty: 1.10` only penalizes exact token repeats, not semantic loops.)

### Exact Files and Lines

| File | Line(s) | Issue |
|------|---------|-------|
| `main/modelProfiles.js` | ~124 | `tiny` tier: `maxResponseTokens: 4096` — too large for 0.6B |
| `main/constants.js` | ~100 | Compact preamble Behavior/Rules — no stop/conciseness instruction |
| `pipeline-clone/main/modelProfiles.js` | same | Mirror needs same fix |
| `pipeline-clone/main/constants.js` | same | Mirror needs same fix |

### Required Fix (plan — DO NOT implement without approval)

1. Reduce `maxResponseTokens` for `qwen` tiny tier (`main/modelProfiles.js` and clone):
   ```
   BEFORE: context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
   AFTER:  context: { effectiveContextSize: 32768, maxResponseTokens: 800 },
   ```
   Rationale: 800 tokens (~600 words) is sufficient for any valid 0.6B response. Cuts runaway repetition.

2. Add to compact preamble Behavior section (constants.js, both):
   ```
   - Give one direct answer. Do not repeat yourself. Stop writing after the question is answered.
   ```
   This is a general improvement for ALL small models, not a test-specific hack.

---

## BUG 4 — 0.6B Model Does Not Call web_search for BTC Price

**Status:** [x] IMPLEMENTED 2026-02-27  
**Fix Method:** 8 edits across 4 files (`main/constants.js`, `pipeline-clone/main/constants.js`, `main/mcpToolServer.js`, `pipeline-clone/main/mcpToolServer.js`):
1. Full preamble (`DEFAULT_SYSTEM_PREAMBLE`) web_search rule: replaced `"you cannot know from training"` framing with `"when the answer may have changed since your training — anything that varies over time"`
2. Compact preamble (`DEFAULT_COMPACT_PREAMBLE`) web_search rule: same framing change
3. `getToolDefinitions()` web_search description: replaced `"documentation, error solutions, API references"` (wrong primary use cases) with `"anything that varies over time. Also use for documentation and error solutions when the current version matters"`
4. `getCompactToolHint()` web_search line: replaced `"Search the internet"` with `"Search the internet when the answer varies over time or requires data more recent than your training"`
All changes applied to both `main/` and `pipeline-clone/main/`.  
**Severity:** HIGH — Users asking for live data (prices, current events, weather) get stale/hallucinated answers instead of real web results. Core functionality broken for live queries.

### What Happens
User asks "what is the current BTC price?" (or similar live-data query).
0.6B model answers from training data ("Bitcoin is around $X" — potentially months out of date) without
calling `web_search`. No search is triggered. No live data fetched.

### Full Pipeline Trace

```
User: "what is the current BTC price?"
  → agenticChat.js: detectTaskType() → likely 'chat' or 'agentic'
  → Compact preamble loaded: "Use web_search only for live/external data you cannot know from training"
     → This IS correct — BTC price qualifies as live/external data  
     → BUT: the tool description directly contradicts this (see below)
  
  → Tool list assembled, mcpToolServer.js line 297–300:
     name: 'web_search'
     description: 'Search the web for information using DuckDuckGo. Use for documentation, error solutions, API references.'
     !! "documentation, error solutions, API references" — prices/live data NOT listed
  
  → Model context contains BOTH:
     Preamble: "use web_search for live data you can't know from training"  ← use it
     Tool description: "documentation, error solutions, API references"      ← don't use it
  
  → 0.6B model weighs these signals:
     → Tool description is proximate (in the tool list, tied directly to the tool)
     → Preamble instruction is distal (in the System block, lines above)
     → Small models weight proximate context more heavily
     → Model does NOT call web_search for a price query
  
  → Model generates answer from training data: "$BTC is ~$40,000" (stale/wrong)
  → No IPC tool execution event fires
  → No real web search happens
  → Hallucinated price presented as fact to user
```

### Root Cause (ONE location, clear fix)

`main/mcpToolServer.js` line 298 — `web_search` description:
```
CURRENT: 'Search the web for information using DuckDuckGo. Use for documentation, error solutions, API references.'
```
The description never mentions: prices, current data, live data, real-time info, market data, news.
A model following this description literally will NOT call web_search for a price query.

The compact preamble has the correct intent but the tool description overrides it for small models.

### Exact Files and Lines

| File | Line(s) | Issue |
|------|---------|-------|
| `main/mcpToolServer.js` | 298 | `web_search` description missing live/price/real-time use cases |
| `pipeline-clone/main/mcpToolServer.js` | same | Mirror needs same fix |

### Required Fix (plan — DO NOT implement without approval)

Update `web_search` description in mcpToolServer.js (real + clone):
```
BEFORE: 'Search the web for information using DuckDuckGo. Use for documentation, error solutions, API references.'
AFTER:  'Search the web for LIVE or CURRENT information: prices, news, weather, real-time data, recent events, package versions, documentation, error solutions. Use when the answer requires up-to-date data from the internet.'
```
This is a general improvement — it's accurate, not test-specific, and applies to all users on all models.

---

## BUG 5 — 4B Model Has 3,328 Token Context (Context Too Small to Use)

**Status:** [x] IMPLEMENTED 2026-02-27  
**Severity:** CRITICAL — With the system prompt + tool list alone exceeding 3K tokens, the context overflows
on the FIRST turn. The model responds: "[The context size is too small to generate a response for this prompt.]"
The 4B model is completely unusable.

### Fix Method
3 changes across 2 files:
1. **`main/llmEngine.js` line ~312** — Changed `const usableForLayers = totalVram` → `const usableForLayers = effectiveBudget`. `effectiveBudget` was already correctly computed (if nvidia-smi VRAM < 70% of Vulkan total, use nvidia-smi value; else use totalVram). Now padding = totalVram − effectiveBudget causes library to budget from real physical VRAM, not GTT-inflated Vulkan total.
2. **`pipeline-clone/main/llmEngine.js`** — Added full nvidia-smi detection block (matching main/) before the `for (tryGpuMode)` loop. Pipeline-clone had no nvidia-smi detection at all — `nvidiaDedicatedVramBytes` was undefined.
3. **`pipeline-clone/main/llmEngine.js`** — Replaced flat `vramPadding: () => 800MB` with the effectiveBudget-aware callback matching main/.

**Non-GTT hardware is unaffected:** when `nvidiaDedicatedVramBytes = 0` or `≥ totalVram * 0.7`, `effectiveBudget = totalVram` → padding = 0 → 800MB floor — same as before.

### What Happens
User loads a 4B model (e.g. Qwen3-4B). Status bar shows "3K". Context meter shows
`Context: 0 / 3,328 tokens (0%)`. Model cannot respond. Error: "context size is too small."

### Full Pipeline Trace

```
Model loaded: Qwen3-4B-Q4 (2.33GB file)
  → llmEngine.js: loadModel() called
  → nvidia-smi queried: dedicated VRAM = 4.0GB (real physical VRAM)
     nvidiaDedicatedVramBytes = 4.0 * 1024^3 bytes

  → Vulkan backend reports: totalVram = 19.74GB (GTT-INFLATED)
     GTT = system RAM mapped into GPU address space
     Vulkan sees 19.74GB but only 4.0GB is fast dedicated VRAM
     Free reported: 15.41GB (before model loaded — misleading)

  → vramPadding function called (llmEngine.js lines 300–317):
     effectiveBudget = (4.0GB < 19.74GB * 0.7)  ← TRUE → effectiveBudget = 4.0GB (CORRECT)
     usableForLayers = totalVram = 19.74GB        ← BUG: should be effectiveBudget
     padding = totalVram - usableForLayers = 0
     return Math.max(0, 800MB) = 800MB            ← floor is 800MB

  → node-llama-cpp: model loaded with vramPadding = 800MB
     Library sees: total=19.74GB, padding=800MB → budget=18.94GB
     Library thinks: "plenty of room — try 32K context"

  → Context binary search (min:2048, max:32768, retries:8 with 0.5x shrink):
     Try 32768: alloc Vulkan0 buffer FAIL  ← only 0.3GB real VRAM left after 2.33GB model
     Retry → 16384: FAIL
     Retry → 8192: FAIL
     Retry → 4096: FAIL
     Retry → 2048: partial success → final ctx = 3,328
     "First-turn overflow persists after budget reduction — context too small for this prompt."

  → User sends first message
  → System prompt + tool list = ~3,400 tokens  > 3,328 context
  → Overflow on turn 1
  → Error: "The context size is too small to generate a response for this prompt."
```

### Root Cause (ONE line — verified from log + code)

`main/llmEngine.js` line 313:
```javascript
const usableForLayers = totalVram;  // ← BUG
```
`effectiveBudget` is ALREADY correctly computed 11 lines above (line 302–304) as:
```javascript
const effectiveBudget = (nvidiaDedicatedVramBytes > 0 && nvidiaDedicatedVramBytes < totalVram * 0.7)
  ? nvidiaDedicatedVramBytes   // ← 4.0GB real VRAM
  : totalVram;
```
But `usableForLayers` ignores `effectiveBudget` entirely. The 800MB floor was added to prevent zero-padding
on normal machines. It works for 0.6B (tiny model, fits in 4GB easily). But for 4B (2.33GB model),
only ~0.3GB real VRAM remains after load → Vulkan allocations fail → context collapses.

**Why `effectiveBudget` is correct for ALL hardware:**
- GTT-inflated machine (Vulkan > real × 1.4): `effectiveBudget = nvidiaDedicatedVramBytes` (real physical VRAM)
- Normal machine (Vulkan ≈ real): `effectiveBudget = totalVram` (same as current behavior — no regression)

### Exact Files and Lines

| File | Line(s) | Issue |
|------|---------|-------|
| `main/llmEngine.js` | 313 | `const usableForLayers = totalVram;` — must be `effectiveBudget` |
| `pipeline-clone/main/llmEngine.js` | same line | Same fix needed |

### Log Evidence
```
[LLM] nvidia-smi dedicated VRAM: 4.0GB
[LLM] Backend gpu=auto: VRAM total=19.74GB free=15.41GB
[LLM] vramPadding: Vulkan=19.7GB effective=4.0GB usable=19.7GB padding=0.0GB
alloc_tensor_range: failed to allocate Vulkan0 buffer   (×5)
[LLM] Context: 3328 tokens
[AI Chat] First-turn overflow persists after budget reduction — context too small for this prompt.
```

### Required Fix (plan — DO NOT implement without approval)

In both `main/llmEngine.js` and `pipeline-clone/main/llmEngine.js`, line 313:
```javascript
// BEFORE:
const usableForLayers = totalVram;

// AFTER:
const usableForLayers = effectiveBudget;
```
Expected result after build:
- 4B model: padding = 19.74GB - 4.0GB = 15.74GB → library budgets from 4.0GB → model uses 2.3GB → ~1.7GB for KV cache → ~14,000–18,000 token context
- 0.6B model: 0.4GB model on 4.0GB budget → ~3.6GB for KV cache → 30K+ context (unchanged from current)
- 16GB VRAM machine: effectiveBudget = totalVram (no GTT inflation detected) → vramPadding = 0 → same behavior as before

---

## Implementation Order (Recommended)

1. **Bug 5** — `llmEngine.js` line 313 (1 line, both files). Unblocks the 4B model entirely.
2. **Bug 4** — `mcpToolServer.js` web_search description (1 line, both files). Fixes live-data queries.
3. **Bug 2** — `constants.js` compact preamble + `mcpToolServer.js` list_directory description.
4. **Bug 3** — `modelProfiles.js` tiny maxResponseTokens + compact preamble conciseness rule.
5. **Bug 1** — `ChatMessage` interface + `sendMessageDirect` + `renderMessage` (largest change, UI only).

---

## Cross-References

- `main/llmEngine.js` — vramPadding function: lines 292–317
- `main/modelProfiles.js` — Qwen tiny tier: lines 119–131
- `main/constants.js` — DEFAULT_COMPACT_PREAMBLE: lines 62–103
- `main/mcpToolServer.js` — tool definitions: lines 296–360
- `main/agenticChat.js` — local path main loop: ~lines 1550–2000
- `src/components/Chat/ChatPanel.tsx` — ChatMessage interface: lines 35–47; finally block: ~860; streaming display: ~2428
- `src/components/Chat/ChatWidgets.tsx` — CollapsibleToolBlock: lines 224–256

All pipeline-clone files mirror the main/ files at the same line numbers (within ±20 lines).
