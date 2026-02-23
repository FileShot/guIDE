# Full End-to-End Pipeline Audit — Message → Response

**Scope:** 8 files, ~10,000 lines — tracing message → response for both local and cloud paths  
**Files:** agenticChat.js, llmEngine.js, agenticChatHelpers.js, mcpToolParser.js, mcpToolServer.js, modelProfiles.js, modelDetection.js, constants.js  
**Focus:** native function calling vs legacy text parsing, context budget calculations, progressive tool disclosure state machine, evaluateResponse/classifyResponseFailure cycles, grammar enabled/disabled transitions

---

## Executive Summary

The pipeline is well-architected with layered defenses (transactional rollback, progressive disclosure, context compaction, fabrication detection). However, the audit found **3 bugs**, **18 risks**, and **2 dead-code items** across the 8 files.

The most critical finding is a **rollback counter exhaustion bug** that silently disables the transactional rollback system for the remainder of a session after the first retry budget is spent.

---

## 1. agenticChat.js (2,781 lines)

### BUG-1: Rollback counter never resets after budget exhaustion (Lines 1728–1785)

```
Classification: BUG — Silent logic failure  
Severity: HIGH  
Affects: Local agentic loop
```

The `rollbackRetries` counter resets to 0 **only** when `evaluateResponse()` returns `COMMIT` (line 1785). When the budget is exhausted (`rollbackRetries >= maxRollbackRetries`) and a ROLLBACK verdict is returned:

1. The ROLLBACK branch doesn't execute (condition fails)
2. The COMMIT reset doesn't execute (verdict is ROLLBACK, not COMMIT)
3. The bad response falls through and gets appended to `fullResponseText`
4. `rollbackRetries` remains at `maxRollbackRetries` permanently

**Consequence:** After the first exhaustion event, ALL subsequent ROLLBACK verdicts for every remaining iteration are silently accepted. The transactional safety system is permanently disabled for the session.

**Fix:** Reset `rollbackRetries = 0` at the start of each iteration (after `iteration++`), or add an `else` branch after the ROLLBACK if-block:
```js
} else if (responseVerdict.verdict === 'ROLLBACK') {
  // Budget exhausted — accept response but reset for next iteration
  console.log(`[AI Chat] ROLLBACK budget exhausted — accepting response`);
  rollbackRetries = 0;
  consecutiveEmptyGrammarRetries = 0;
}
```

---

### BUG-2: Temperature permanently lowered across iterations (Line 1748)

```
Classification: BUG — State mutation leak  
Severity: MEDIUM  
Affects: Local agentic loop
```

On the first rollback retry:
```js
if (context?.params) context.params.temperature = Math.max((context.params.temperature || 0.7) - 0.2, 0.1);
```

This mutates `context.params.temperature` in-place. Since `context` is the IPC event payload shared across the entire handler, the lowered temperature persists for **all subsequent iterations**, not just the retry. After several rollback events, temperature could be driven to 0.1 and stay there.

**Fix:** Store the original temperature and restore it after rollback retries:
```js
const originalTemp = context?.params?.temperature;
// ... after COMMIT ...
if (originalTemp !== undefined && context?.params) context.params.temperature = originalTemp;
```

---

### RISK-1: Duplicate task type detection — cloud vs local diverge (Lines ~350 vs ~880)

```
Classification: RISK — Behavioral inconsistency  
Severity: MEDIUM  
```

Cloud `cloudTaskType` (line 350) and local `detectTaskType()` (line 880) have **different patterns**:

| Aspect | Cloud | Local |
|--------|-------|-------|
| Greeting includes `help` | Yes | No |
| Short message threshold | `< 20` chars | `< 15` chars |
| Casual question pattern | Broad (`can\|do\|does\|is\|are\|will\|would\|should\|could` + `you\|weather\|time\|...`) | Narrow (`what\|who\|how` + `is\|are\|do\|does` + `your\|you` + `name\|favorite\|...`) |
| Action word escalation | None (falls to `general`) | Extensive (`actionWords` regex with 30+ terms) |
| `code` task detection | Via `general` fallback only | Dedicated `codeWords` pattern |

The same message can be classified differently on cloud vs local, resulting in different tool sets being provided.

**Fix:** Extract a single `detectTaskType(message)` function and use it in both paths.

---

### RISK-2: evaluateResponse vs classifyResponseFailure — inconsistent refusal thresholds (Lines 1727 + helpers:760)

```
Classification: RISK — Conflicting evaluation  
Severity: MEDIUM  
```

- `evaluateResponse()` rolls back refusals up to `iteration <= 5`
- `classifyResponseFailure()` nudges refusals up to `iteration < 10`

At iterations 6–9: a refusal is **COMMITTED** (accepted into response text), then `classifyResponseFailure` detects it as a failure and tries to nudge. The committed refusal text remains in `fullResponseText` and chatHistory, potentially reinforcing the refusal pattern via attention.

**Recommendation:** Align thresholds — either both use 5 or both use 10.

---

### RISK-3: `nonContextRetries` re-initialization is redundant (Line 1681)

```
Classification: RISK — Code smell (not a bug)  
Severity: LOW  
```

`nonContextRetries` is declared at line 1378 with `let nonContextRetries = 0;`. Line 1681 `if (!nonContextRetries) nonContextRetries = 0;` is redundant — it guards against a problem that doesn't exist. Misleading for future maintainers.

---

### RISK-4: Context budget overshooting (Lines ~960–1050)

```
Classification: RISK — Over-allocation  
Severity: LOW  
```

`buildStaticPrompt()` allocates against `maxPromptTokens`. `buildDynamicContext()` allocates against `Math.floor(maxPromptTokens * 0.4)`. These are added together in the user message, so the total prompt can be up to `1.4 × maxPromptTokens` before tool feedback is added.

Context overflow is handled gracefully (rotation/compaction), so this doesn't crash. But it means early iterations routinely overshoot the budget, triggering unnecessary compaction.

**Recommendation:** Share a single token budget between static and dynamic builders.

---

### RISK-5: Cloud wall-clock deadline defined but never enforced (Line ~387)

```
Classification: RISK — Dead guard  
Severity: LOW  
```

`WALL_CLOCK_DEADLINE = Date.now() + 30 * 60 * 1000` is defined but **never checked** anywhere in the cloud loop body. The 500-iteration limit is the only guard.

**Fix:** Add deadline check at the top of the cloud loop:
```js
if (Date.now() > WALL_CLOCK_DEADLINE) { console.log('Cloud deadline hit'); break; }
```

---

### RISK-6: `fullResponseText` uncapped until late in the loop (Line ~2410)

```
Classification: RISK — Transient memory spike  
Severity: LOW  
```

The 2MB cap on `fullResponseText` is applied at line ~2410, but tool feedback (browser snapshots, file contents) is appended earlier. Between append and cap-check, `fullResponseText` can transiently exceed 2MB.

---

### OK — Well-implemented patterns

- **Transactional checkpoint/restore** (lines 1510–1530) — clean save/restore of chatHistory + lastEvaluation
- **Progressive tool disclosure** via `getProgressiveTools()` — reduces decision space without losing capability
- **Chat-type hard gate** (line ~1968) — blocks hallucinated tool calls for casual messages
- **Stuck/cycle detection** (lines 2480–2530) — catches repeated tool calls and tool call sequences
- **Fabrication detection and auto-correction** (lines 2430–2500) — validates written file content against gathered data
- **Auto-snapshot injection** after browser actions — model always has fresh element refs
- **Unified tool pipeline** for both native and text-parsed paths — no divergent execution code

---

## 2. llmEngine.js (1,688 lines)

### RISK-7: generateWithFunctions doesn't clean up chatHistory on abort (Line ~1672)

```
Classification: RISK — Stale state  
Severity: MEDIUM  
```

In `generateWithFunctions()`, the user message is pushed to `chatHistory` at line 1556 before generation. On `AbortError`, the function returns without popping the user message. This leaves a dangling user message in chatHistory with no corresponding model response.

The agenticChat.js checkpoint system mitigates this for ROLLBACK cases, but for user-initiated cancellations (abort without rollback), the orphaned message persists.

**Fix:** Pop the user message in the catch block:
```js
if (error.name === 'AbortError') {
  if (this.chatHistory[this.chatHistory.length - 1]?.type === 'user') {
    this.chatHistory.pop();
  }
  return { text: fullResponse, response: fullResponse, functionCalls: collectedFunctionCalls, stopReason: 'abort' };
}
```

---

### RISK-8: `_getOptimalContextSize` minimum floor of 8192 (Line ~178)

```
Classification: RISK — OOM on low-RAM systems  
Severity: LOW  
```

`Math.max(recommended, 8192)` forces a minimum 8192-token context even when RAM calculations suggest less. On systems with <4GB free RAM and a large model loaded, this could push KV cache memory past available RAM.

**Mitigated by:** node-llama-cpp's `failedCreationRemedy` (6 retries with 16% auto-shrink).

---

### RISK-9: 120s safety timeout may be tight for grammar generation

```
Classification: RISK — Premature abort  
Severity: LOW  
```

Grammar-constrained generation (especially with large function schemas and small models on CPU) can be significantly slower than free-text generation. 120s may be tight on slow hardware. The timeout fires `cancelGeneration('timeout')` which returns partial results, so it degrades gracefully.

---

### OK — Well-implemented patterns

- **KV cache reuse with cooldown** — avoids infinite retry loops when cache causes failures
- **Context shift strategy** `eraseFirstResponseAndKeepFirstSystem` — preserves system prompt during overflow
- **Think-token budget** from ModelProfile — prevents runaway thinking on reasoning models
- **_compactHistory()** — bounds JS-side chatHistory array independently of context window
- **Empty response retry with KV cache disabled** — targeted recovery

---

## 3. agenticChatHelpers.js (952 lines)

### DEAD-1: `getModelTier()` export — unused (Line 554)

```
Classification: DEAD — Exported but never imported  
Severity: LOW  
```

`getModelTier(paramSize)` at line 554 returns `{tier, maxToolsPerPrompt, grammarAlwaysOn, retryBudget, pruneAggression}` with **hardcoded thresholds**. `agenticChat.js` imports many helpers but NOT this function — it uses `llmEngine.getModelTier()` instead, which derives values from ModelProfile.

This creates a maintenance hazard: the hardcoded thresholds can silently diverge from the ModelProfile-driven values without anyone noticing.

**Fix:** Remove the export and the function, or make it call through to `getModelProfile()`.

---

### RISK-10: evaluateResponse + classifyResponseFailure both detect hallucination but at different stages

```
Classification: RISK — Redundant detection  
Severity: LOW  
```

`evaluateResponse()` checks `detectActionHallucination()` at iteration ≤3 → ROLLBACK. `classifyResponseFailure()` checks the same function with no iteration limit → nudge. For iterations 1–3, a hallucination is caught by evaluateResponse (ROLLBACK). At iteration 4+, evaluateResponse commits it, then classifyResponseFailure catches it. The committed hallucination text remains in context.

---

### RISK-11: progressiveContextCompaction phase boundaries cascade (Lines 870–940)

```
Classification: RISK — Wasteful double-compaction  
Severity: LOW  
```

At 80% context usage, phases 1, 2, AND 3 all execute in sequence. Phase 3 re-compresses items Phase 1 already compacted. The `_pruned` guard prevents data corruption, but Phase 1's work is immediately overridden.

**Recommendation:** Use `if/else if` instead of cascading `if` blocks.

---

### OK — Well-implemented patterns

- **evaluateResponse()** — clean deterministic verdict system: COMMIT/ROLLBACK/SKIP
- **classifyResponseFailure()** — 7-type failure taxonomy with specific recovery strategies
- **getProgressiveTools()** — effective transition-based state machine
- **isNearDuplicate()** — Jaccard similarity with configurable threshold
- **EXPANDED_REFUSAL_PATTERNS** — 20+ patterns covering explicit refusals, passive refusals, deflections

---

## 4. mcpToolParser.js (1,171 lines)

### RISK-12: Brace-matching quote detection is naive (Lines ~285, ~365)

```
Classification: RISK — Parse failure edge case  
Severity: LOW  
```

```js
if (c === '"' && (i === 0 || blockContent[i - 1] !== '\\')) inStr = !inStr;
```

Fails on multi-level escaped backslashes (`\\\\"` — four backslashes + quote). In practice, LLM-generated tool call JSON rarely has this, so the risk is minimal.

---

### RISK-13: KNOWN_TOOLS list duplicated from VALID_TOOLS (Lines ~400–407)

```
Classification: RISK — Maintenance burden  
Severity: LOW  
```

Method 3a's `KNOWN_TOOLS` array is hardcoded separately from the `VALID_TOOLS` set used by `normalizeToolCall()`. New tools added to one but not the other won't be recognized by the corresponding path.

**Fix:** `const KNOWN_TOOLS = [...VALID_TOOLS, ...Object.keys(TOOL_NAME_ALIASES)];`

---

### RISK-14: Write deferral false positives for legitimate co-batched writes

```
Classification: RISK — Unnecessary delay  
Severity: LOW  
```

When a batch contains both data-gathering AND write tools, ALL writes are deferred — even if the write uses pre-existing data, not the data being gathered. Tiny models are exempted, which is appropriate.

---

### OK — Well-implemented patterns

- **Input cap at 200KB** — O(n²) protection
- **5 progressive parse methods** — fenced blocks → raw JSON → function syntax → plain JSON → XML tags → OpenAI wrapper
- **50+ tool name aliases** — handles common model misspellings
- **web_search → run_command remap** — catches shell commands misrouted as web searches
- **repairToolCalls()** — recovers empty write_file content from code blocks

---

## 5. mcpToolServer.js (2,448 lines)

### BUG-3: Custom tool sandbox is escapable (Lines 2400–2420)

```
Classification: BUG — Security vulnerability  
Severity: MEDIUM (mitigated by local-only context)  
```

`_useCustomTool()` uses `new Function('sandbox', 'with(sandbox) { ... }')`. The `with(sandbox)` pattern only shadows names in the sandbox — it does NOT prevent:

- `this.constructor.constructor('return process')()` → Node.js `process` access
- String concatenation to bypass blocklist: `const p = 'pro' + 'cess'`
- `arguments.callee.constructor` chain to Function constructor

**Mitigated by:** Local desktop app (user already has system access). Risk is prompt injection causing the model to create a malicious tool.

**Fix:** Use Node.js `vm` module with `vm.createContext()` for real sandboxing.

---

### RISK-15: `_editFile` replaces ALL occurrences (Line ~1555)

```
Classification: RISK — Unintended multi-replace  
Severity: MEDIUM  
```

After matching text (across 4 flexibility tiers):
```js
content = content.replaceAll(oldText, newText);
```

If `oldText` appears multiple times, ALL are replaced. The count is returned, but the model typically expects single replacement.

**Fix:** Use `content.replace(oldText, newText)` as default.

---

### RISK-16: `_deleteFile` creates no backup (Line ~1540)

```
Classification: RISK — Data loss  
Severity: LOW  
```

`_writeFile` and `_editFile` create backups; `_deleteFile` does not. `undo_edit` cannot restore deleted files.

---

### RISK-17: SSRF protection is hostname-only (Lines ~1870–1880)

```
Classification: RISK — DNS rebinding  
Severity: LOW  
```

Checks hostname string before DNS resolution. A hostname resolving to `127.0.0.1` bypasses the check. Low severity for a local desktop app.

---

### RISK-18: `_grepSearch` shell fallback with interpolation (Line ~1810)

```
Classification: RISK — Command injection  
Severity: LOW  
```

Sanitizer strips common injection chars, but Windows `findstr` has different escaping rules. Primary path (RAG engine) avoids shell entirely.

---

### RISK-19: `getToolPromptForTask('code')` excludes `web_search` (Line ~2162)

```
Classification: RISK — Tool omission  
Severity: LOW  
```

`codeTools` set doesn't include `web_search` or `coreTool`. Code-type prompts don't mention web tools. "Write code to call this API" → model doesn't know about `web_search`/`fetch_webpage`.

**Fix:**
```js
} else if (taskType === 'code') {
  selectedNames = new Set([...coreTool, ...codeTools]);
}
```

---

### OK — Well-implemented patterns

- **Path sanitization** — blocks traversal and hallucinated absolute paths
- **Dangerous command blocklist** — fork bombs, rm -rf /, dd, pipe-to-shell
- **Result truncation** — 50KB cap prevents context blowup
- **Undo/backup with LRU eviction** — bounded memory
- **Permission gate** for destructive operations

---

## 6. modelProfiles.js (838 lines)

### RISK-20: Unknown model families get untuned defaults

```
Classification: RISK — Suboptimal performance  
Severity: LOW  
```

Unrecognized filenames → `BASE_DEFAULTS` with no family overrides. Reasonable middle-ground values, but potentially wrong for specific architectures. Mitigated by tier system and user overrides.

### OK — Clean implementation
- 15 family profiles × 5 size tiers
- deepMerge for 3-level inheritance
- Quirks system for behavioral flags

---

## 7. modelDetection.js (68 lines)

### OK — Clean utility
- Pattern matching for 15+ families
- Returns 0 for unrecognized → `getSizeTier(0)` = 'tiny' → most conservative default

---

## 8. constants.js (124 lines)

### DEAD-2: Tool names hardcoded in preamble text

```
Classification: DEAD — Stale reference risk  
Severity: LOW  
```

Preamble mentions specific tool names. If tools are renamed, preamble becomes stale. Maintenance coupling only.

---

## Cross-Cutting: Grammar Enable/Disable Transitions

The grammar lifecycle has the same counter-reset gap as BUG-1:

1. `consecutiveEmptyGrammarRetries` increments on empty grammar responses
2. At ≥2, grammar is disabled (`nativeFunctions = null`)
3. Counter resets **only on COMMIT** (line 1787)

If text-mode fallback also produces ROLLBACK → counter stays ≥2 → grammar stays permanently disabled for the session.

**Fix:** Same as BUG-1 — reset counters at the start of each iteration.

---

## Summary Table

| ID | File | Class | Sev | Description |
|----|------|-------|-----|-------------|
| BUG-1 | agenticChat.js | BUG | HIGH | Rollback counter never resets after exhaustion |
| BUG-2 | agenticChat.js | BUG | MED | Temperature permanently lowered by rollback |
| BUG-3 | mcpToolServer.js | BUG | MED | Custom tool sandbox escapable |
| RISK-1 | agenticChat.js | RISK | MED | Duplicate task type detection diverges |
| RISK-2 | agenticChat.js | RISK | MED | Refusal threshold mismatch (≤5 vs <10) |
| RISK-7 | llmEngine.js | RISK | MED | chatHistory orphan on abort |
| RISK-15 | mcpToolServer.js | RISK | MED | editFile replaceAll instead of replace |
| RISK-3 | agenticChat.js | RISK | LOW | Redundant nonContextRetries guard |
| RISK-4 | agenticChat.js | RISK | LOW | Context budget overshooting |
| RISK-5 | agenticChat.js | RISK | LOW | Cloud deadline never enforced |
| RISK-6 | agenticChat.js | RISK | LOW | fullResponseText transient overshoot |
| RISK-8 | llmEngine.js | RISK | LOW | Context minimum 8192 on low-RAM |
| RISK-9 | llmEngine.js | RISK | LOW | 120s timeout tight for grammar gen |
| RISK-10 | agenticChatHelpers.js | RISK | LOW | Redundant hallucination detection |
| RISK-11 | agenticChatHelpers.js | RISK | LOW | Cascading compaction wastes work |
| RISK-12 | mcpToolParser.js | RISK | LOW | Naive brace-matching quote detection |
| RISK-13 | mcpToolParser.js | RISK | LOW | KNOWN_TOOLS duplicated from VALID_TOOLS |
| RISK-14 | mcpToolParser.js | RISK | LOW | Write deferral false positives |
| RISK-16 | mcpToolServer.js | RISK | LOW | deleteFile creates no backup |
| RISK-17 | mcpToolServer.js | RISK | LOW | SSRF hostname-only check |
| RISK-18 | mcpToolServer.js | RISK | LOW | Shell injection in grep fallback |
| RISK-19 | mcpToolServer.js | RISK | LOW | Code taskType excludes web_search |
| RISK-20 | modelProfiles.js | RISK | LOW | Unknown families get untuned defaults |
| DEAD-1 | agenticChatHelpers.js | DEAD | LOW | getModelTier() exported, never imported |
| DEAD-2 | constants.js | DEAD | LOW | Hardcoded tool names in preamble |

---

## Recommended Priority Fixes

1. **BUG-1 + Grammar gap:** Reset `rollbackRetries` and `consecutiveEmptyGrammarRetries` at the **start** of each iteration. Single 2-line fix restores the transactional safety system.

2. **BUG-2:** Save `context.params.temperature` before rollback retry and restore on COMMIT.

3. **RISK-1:** Extract `detectTaskType()` into a shared function used by both cloud and local paths.

4. **RISK-19:** Add `coreTool` to the `code` taskType in `getToolPromptForTask()`.

5. **RISK-5:** Add `if (Date.now() > WALL_CLOCK_DEADLINE) break;` to cloud loop.

6. **RISK-16:** Add backup before delete in `_deleteFile()`.
