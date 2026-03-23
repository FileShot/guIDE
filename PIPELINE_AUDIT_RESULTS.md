# Pipeline Audit Results — 14 Files
**Date:** 2026-06-24
**Files audited:** agenticLoop.js, continuationHandler.js, streamHandler.js, responseParser.js, contextManager.js, promptAssembler.js, conversationSummarizer.js, rollingSummary.js, constants.js, mcpToolServer.js, modelProfiles.js, agenticChat.js, agenticChatHelpers.js, llmEngine.js

## Specific Keyword Searches

| Search term | Found? | Location |
|---|---|---|
| `detectTaskType()` | **No** | Not present in any file |
| `Bitcoin` | **No** | Not present |
| `Summit Auto Group` | **No** | Not present |
| `S7` / `midFence` | Yes | agenticLoop.js + continuationHandler.js — legitimate cross-continuation fence anchoring, not test residue |
| `console.log` | Yes | **100+ instances** across all 14 files, none gated by log level |

---

## CRITICAL FINDINGS

### Finding 1: DUPLICATE LOGIC — 4 functions exist in TWO places

agenticChatHelpers.js duplicates functions from the pipeline modules. These are independent copies — fixing a bug in one does NOT fix the other.

| Function | Location A (pipeline) | Location B (cloud path) |
|---|---|---|
| `_compressText()` | contextManager.js | agenticChatHelpers.js |
| `pruneVerboseHistory()` | contextManager.js | agenticChatHelpers.js |
| `progressiveContextCompaction()` | contextManager.js | agenticChatHelpers.js |
| `formatSuccessfulToolResult()` / `formatToolResults()` | promptAssembler.js | agenticChatHelpers.js |

The pipeline (local path) uses contextManager's versions; the cloud chat path uses agenticChatHelpers' versions.

### Finding 2: `detectStuckCycle()` duplicated

agenticChat.js lines ~520–560 has its own stuck/cycle detection. agenticLoop.js has a separate implementation. Two independent copies.

### Finding 3: Hardcoded cloud model names

agenticChat.js `selectCloudProvider()` (~line 490–520) has inline strings:
- `gemini-2.5-flash`
- `gpt-4o`
- `claude-sonnet-4-20250514`
- `llama-3.3-70b-versatile`
- `zai-glm-4.7`

These should be in a config/constant, not inline.

### Finding 4: `[LLM-BATCH]` diagnostic logging LEFT IN PRODUCTION

agenticChatHelpers.js `createIpcTokenBatcher()` does:
```js
console.log('[LLM-BATCH] ...', batch)
```
This logs **every single token batch** to the console. High-frequency noise in production.

---

## MINOR FINDINGS

### Finding 5: Band-aid fix annotations in agenticLoop.js
- `// FIX T07` — write_file anchoring through rotation
- `// FIX T18` — stream reset on continuation
- `// FIX T19` — another stream fix
Named after specific defect IDs rather than architectural descriptions.

### Finding 6: Band-aid annotations in streamHandler.js
- `// D03 fix`, `// D07 fix` for false-positive ```json detection

### Finding 7: `Fix 64B` annotation in llmEngine.js
`replaceLastUser` logic (~line 660) named after a specific bug number.

### Finding 8: Cloud daily quota magic number
agenticChat.js has `usage.count >= 20` as a hardcoded daily usage cap.

### Finding 9: Auto-first-todo model-behavior workaround
mcpToolServer.js `_writeTodos()` auto-marks the first todo as `in-progress` with comment: "Small models (4B/7B) routinely skip the first update_todo call." Model-class-specific compensation.

### Finding 10: Overwrite protection in `_writeFile()`
mcpToolServer.js blocks ANY write_file call that would reduce file size. Could interfere with legitimate file rewrites that shorten a file.

### Finding 11: `[LLM DIAG]` high-frequency logging
llmEngine.js ~line 680 logs pre-generation state on every single generation call. Not gated.

### Finding 12: 100+ unconditional `console.log` statements
Across all 14 files — none use a log-level gate. Every log fires in production regardless of debug settings.

---

## CLEAN FILES (no issues found)

- **constants.js** — clean
- **modelProfiles.js** — clean (tier-based defaults excluded per instructions)
- **conversationSummarizer.js** — clean
- **rollingSummary.js** — clean (CHARS_PER_TOKEN=3.5 is a reasonable heuristic)
- **responseParser.js** — clean
- **continuationHandler.js** — clean

---

## PRIORITY RANKING

1. **Duplicate logic** (findings 1-2) — highest risk; bug fixed in one copy won't be fixed in the other
2. **`[LLM-BATCH]` diagnostic log** (finding 4) — noise in production logs
3. **Hardcoded cloud models** (finding 3) — maintenance burden, not a runtime issue
4. **Console.log gating** (finding 12) — performance and log noise across all files
5. Everything else — informational / cosmetic
