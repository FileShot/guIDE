# Pipeline Comparison: guIDE (IDE) vs Pocket Guide

**Date:** February 15, 2026  
**Comparison Scope:** Agentic AI chat pipelines, LLM engines, tool systems, and context management

---

## Executive Summary

Both applications share a common architectural foundation (agentic loop, tool system, conversation summarization) but differ significantly in:
1. **Deployment model**: Desktop Electron app (IDE) vs Web-based Express server (Pocket Guide)
2. **LLM backend**: Local models via `node-llama-cpp` (IDE) vs Cloud API services (Pocket Guide)
3. **Context management**: Similar summarization strategies, but Pocket Guide has more aggressive pruning
4. **Tool execution**: Nearly identical tool sets, but Pocket Guide has additional anti-hallucination guards
5. **Task classification**: IDE has sophisticated task type detection; Pocket Guide uses simpler routing

---

## 1. Architecture Overview

### guIDE (IDE)
- **Type**: Electron desktop application
- **Entry Point**: `electron-main.js` → IPC handlers → `agenticChat.js`
- **LLM Engine**: `llmEngine.js` (local models via `node-llama-cpp`)
- **Cloud Fallback**: `cloudLLMService.js` (optional, for cloud models)
- **Tool System**: `mcpToolServer.js` (MCP protocol-based)
- **Context Management**: `conversationSummarizer.js`

### Pocket Guide
- **Type**: Express.js web server (port 3300)
- **Entry Point**: `server.js` → WebSocket/HTTP → `agent.js`
- **LLM Engine**: `llm.js` (CloudLLMService - Cerebras primary, fallbacks)
- **Tool System**: `tools.js` (ported from guIDE's mcpToolServer)
- **Context Management**: `conversationSummarizer.js` (adapted from guIDE)

---

## 2. LLM Engine Comparison

### guIDE: `llmEngine.js`
- **Primary**: Local models via `node-llama-cpp`
- **Model Loading**: 
  - Uses `getNodeLlamaCppPath()` to resolve ESM entry (`dist/index.js`) as `file://` URL on Windows
  - `modelPath` passed as raw filesystem path (not `file://`) to `loadModel()`
- **Context Management**:
  - Adaptive context sizing based on system RAM
  - KV cache reuse via `lastEvaluation` (preserves tokenized system prompts)
  - System prompt optimization: avoids double-prompting when `systemContext` provided
- **Features**:
  - GPU layer offloading (auto-detects VRAM)
  - Flash attention support
  - Streaming generation with token batching
  - Abort/cancel support

### Pocket Guide: `llm.js` (CloudLLMService)
- **Primary**: Cerebras API (up to 30 keys, round-robin)
- **Fallback Chain**: Groq → SambaNova → OpenRouter → Gemini → Pollinations (free)
- **Key Management**:
  - Unified multi-provider key pool (all providers in one rotation)
  - Smart rotation for rate-limited models (GLM 4.7: 100 RPD/key) - picks key with most remaining quota
  - Per-key daily usage tracking (survives restarts via JSON file)
  - TPM (tokens per minute) tracking per provider
  - Auto-cooldown on 429/rate limit errors
- **Model Routing**:
  - Auto-routes to optimal model per iteration (GLM for planning, Llama for execution)
  - Model-specific context limits (Qwen 3 32B = 32K, GLM 4.7 = 131K)
- **Features**:
  - Native function calling support (Groq, SambaNova, OpenRouter, Gemini)
  - Refusal detection (short responses with refusal keywords → try next key)
  - Request queue with throttling (400ms between requests)

**Key Difference**: IDE prioritizes local inference (privacy, offline), Pocket Guide prioritizes cloud speed/scale.

---

## 3. Agentic Loop Comparison

### guIDE: `agenticChat.js`
- **Max Iterations**: Configurable (default 100, can be overridden per request)
- **Task Type Detection**: Sophisticated regex-based classifier
  - Categories: `'chat'`, `'browser'`, `'code'`, `'general'`
  - **Critical Fix**: Previously too aggressive - classified actionable requests as 'chat'
  - **Current Logic**: Explicitly checks absence of `browserWords` and `codeWords` before 'chat'
  - All task types now allow full iterations (removed `taskType === 'chat' ? 1 : MAX_ITERATIONS`)
- **Tool Injection**:
  - Task-specific tool filtering via `mcpToolServer.getToolPromptForTask(taskType)`
  - `'chat'` = no tools, `'browser'` = browser tools only, `'code'` = file/terminal tools, `'general'` = all tools
- **Cloud vs Local Paths**:
  - Separate execution paths for cloud (`cloudLLM.generateStream`) and local (`llmEngine.generateStream`)
  - **Critical Bug Fixed**: `iterationToolResults` was undefined in local path (used `toolResults.results` instead)
- **System Prompt Construction**:
  - `DEFAULT_SYSTEM_PREAMBLE` + tool definitions + memory/RAG/file context
  - **Critical Fix**: Removed double-prompting (was prepending `_getActiveSystemPrompt()` to `systemContext`)

### Pocket Guide: `agent.js`
- **Max Iterations**: `MAX_ITERATIONS = 999999` (effectively unlimited)
- **Task Type Detection**: Simpler - no explicit task type classification
  - Always injects full tool set (no filtering)
  - Relies on model to choose appropriate tools
- **System Prompt**: 
  - `SYSTEM_PROMPT` (compressed, ~55% fewer tokens than prior 21K-char version)
  - Includes tool definitions, workflow rules, data integrity rules
  - User rules (persistent behavioral memory) appended if present
- **Anti-Hallucination Guards**:
  - Execution state tracking (`_executionState`) - ground truth of what actually happened
  - Model claim verification (`_verifyModelClaims`) - checks if model claims visits/actions without tool calls
  - Fabrication detection for `write_file` - warns if large file written without prior browser data extraction
  - Vague comment detection - flags summaries like "people are discussing" without actual quotes
- **Domain Retry Limiter**: 
  - Tracks attempts per domain (`_domainAttempts`)
  - After `MAX_DOMAIN_ATTEMPTS` (4), forces stop and suggests alternative approach
  - Blocks CAPTCHA/bot-detected domains permanently
- **Progressive Context Pruning**:
  - At 55% context capacity, compresses old tool results (keeps 250-400 chars)
  - Compresses old assistant messages (keeps 300 chars)
  - More aggressive than IDE's approach

**Key Difference**: Pocket Guide has more aggressive anti-hallucination guards and unlimited iterations, IDE has task-specific tool filtering.

---

## 4. Tool System Comparison

### guIDE: `mcpToolServer.js`
- **Tool Categories**:
  - Browser tools (Playwright-based)
  - File operations (read/write/edit/delete)
  - Terminal/command execution
  - Web search (DuckDuckGo)
  - Git operations
  - RAG/memory tools
  - Custom tool creation
- **Tool Prompt Building**:
  - `_buildToolPrompt()` - includes categorization, parameter descriptions, common patterns
  - **Recent Addition**: Few-shot example (`web_search`) for small models
  - Task-specific filtering via `getToolPromptForTask(taskType)`
- **Parameter Normalization**:
  - Extensive schema drift handling (`_normalizeBrowserParams`, `_normalizeFsParams`)
  - Handles `selector` → `ref`, `path` → `filePath`, etc.
- **Security**:
  - Path sanitization (`_sanitizeFilePath`) - blocks traversal, hallucinated absolute paths
  - Shell arg sanitization (`_sanitizeShellArg`)
  - Permission gates for destructive operations

### Pocket Guide: `tools.js`
- **Tool Set**: Nearly identical to guIDE (ported from `mcpToolServer.js`)
- **Tool Parsing**: 
  - Same `parseToolCalls()` logic (fenced blocks, inline JSON, brace-counting)
  - JSON sanitization for control characters
  - Tool name aliases (same `ALIASES` map)
- **Additional Features**:
  - Scratchpad files (`.pocket-scratch/`) for context overflow
  - Auto-captured page data (`_lastPageData`, `_pageDataHistory`) for verification
  - Blocked domains tracking (`_blockedDomains`) - skips browser tools on CAPTCHA sites
- **Browser Tool Capping**:
  - Caps browser tools at 2 per iteration (forces sequential: navigate→snapshot→type)
  - Prevents stale-ref cascading failures

**Key Difference**: Pocket Guide has more aggressive browser tool capping and page data verification.

---

## 5. Context Summarization Comparison

### guIDE: `conversationSummarizer.js`
- **Structure**:
  - `originalGoal` - user's original message (verbatim, capped 2000 chars)
  - `completedSteps` - tool calls with compressed params/outcomes
  - `currentState` - page, file, directory, lastAction
  - `keyFindings` - important discoveries
  - `importantContext` - user corrections, constraints
  - `taskPlan` - planned steps (if model outlined them)
  - `pendingSteps` - steps still to do
- **Summary Generation**:
  - Structured sections: TASK GOAL, USER INSTRUCTIONS, COMPLETED WORK, CURRENT STATE, KEY FINDINGS, REMAINING STEPS
  - Compression: groups repeated tool calls (e.g., "browser_click (×5)")
  - Bounded: keeps last 40 detailed entries, compresses older ones
- **Rotation Trigger**: Based on `historyLength` vs `effectiveMaxChars` (model-specific)

### Pocket Guide: `conversationSummarizer.js`
- **Structure**: Nearly identical to guIDE (adapted from it)
- **Differences**:
  - Slightly simpler (no `taskPlan`/`pendingSteps` tracking)
  - Same compression strategy (groups repeated tools)
  - Same bounded approach (40 entries max)
- **Integration**:
  - Used in agentic loop for context rotation
  - Progressive pruning at 55% capacity (before hard rotation)

**Key Difference**: Essentially the same - Pocket Guide is a direct port with minor simplifications.

---

## 6. System Prompt Comparison

### guIDE
- **Base**: `DEFAULT_SYSTEM_PREAMBLE` (identity, capabilities, workflow)
- **Dynamic Additions**:
  - Tool definitions (task-filtered)
  - Memory/RAG context
  - File context (open files, project structure)
  - User instructions/corrections
- **Construction**: Built in `agenticChat.js`, passed as `systemContext` to `llmEngine.generateStream()`
- **Critical Fix**: Removed double-prompting (was prepending `_getActiveSystemPrompt()` to `systemContext`)

### Pocket Guide
- **Base**: `SYSTEM_PROMPT` (compressed, ~55% fewer tokens than prior version)
- **Content**:
  - Workflow rules (plan, execute, verify, fix, never stop early)
  - Data integrity rules (REAL DATA ONLY, ZERO FABRICATION, SCRATCHPAD = TRUTH)
  - Tool format examples
  - File rules, browser rules, research efficiency tips
  - Output rules, error recovery
- **Dynamic Additions**:
  - User rules (persistent behavioral memory from file)
  - Tool definitions (always full set, no filtering)
- **Construction**: `_buildSystemPromptWithRules()` in `agent.js`

**Key Difference**: Pocket Guide has a more compressed, rule-heavy prompt; IDE has a more modular, context-aware prompt.

---

## 7. Error Handling & Recovery

### guIDE
- **Tool Failures**: Error messages passed back to model, model decides retry strategy
- **Stuck Detection**: 
  - Tool loop detection (same tool+params repeated)
  - Cycle detection (2-4 tool sequence repeating)
- **Context Overflow**: Conversation summarization triggers at model-specific limits
- **Abort Support**: `agenticCancelled` flag, `llmEngine.cancelGeneration()`

### Pocket Guide
- **Tool Failures**: 
  - Error enrichment (`_enrichErrorFeedback`) - provides actionable guidance
  - Circuit breaker (`_shouldSkipTool`) - skips tools that failed 5+ times consecutively
  - Auto-retry for transient browser failures (target closed, frame detached)
- **Stuck Detection**:
  - More lenient thresholds (browser-active sessions: 10 iterations min, 0.97 overlap threshold)
  - Tool loop detection (same as IDE)
  - Cycle detection (same as IDE)
- **Hallucination Detection**:
  - Execution state verification (`_verifyModelClaims`)
  - Fabrication warnings for large `write_file` without data extraction
  - Vague comment detection
- **Domain Retry Limiter**: Forces stop after 4 attempts per domain

**Key Difference**: Pocket Guide has more aggressive error recovery and anti-hallucination guards.

---

## 8. Performance Optimizations

### guIDE
- **KV Cache Reuse**: `lastEvaluation` preserves tokenized system prompts across iterations
- **System Prompt Caching**: Only updates when text actually changes
- **Token Batching**: `createIpcTokenBatcher()` batches tokens for IPC efficiency
- **Context Rotation**: Model-specific limits (e.g., Qwen 3 32B = 32K tokens)

### Pocket Guide
- **Progressive Context Pruning**: Compresses old messages at 55% capacity (before hard rotation)
- **Browser Tool Capping**: Limits to 2 per iteration (prevents stale-ref cascades)
- **Update Todo Capping**: Max 6 `update_todo` calls per iteration
- **Model Routing**: Uses cheaper models (Llama) for routine execution, expensive (GLM) for planning
- **Key Rotation**: Smart rotation for rate-limited models (picks key with most remaining quota)

**Key Difference**: IDE optimizes for KV cache reuse, Pocket Guide optimizes for context efficiency and cost.

---

## 9. Key Architectural Differences

| Aspect | guIDE (IDE) | Pocket Guide |
|--------|-------------|--------------|
| **Deployment** | Electron desktop app | Express web server |
| **LLM Backend** | Local (`node-llama-cpp`) primary, cloud optional | Cloud (Cerebras) primary, fallbacks |
| **Task Classification** | Sophisticated (chat/browser/code/general) | None (always full tool set) |
| **Tool Filtering** | Task-specific (reduces context) | Always full set |
| **Max Iterations** | Configurable (default 100) | Unlimited (999999) |
| **Anti-Hallucination** | Basic (tool loop detection) | Advanced (execution state, fabrication detection) |
| **Context Pruning** | On rotation only | Progressive (55% capacity) |
| **Model Routing** | N/A (single model per session) | Auto-routes (GLM for planning, Llama for execution) |
| **Key Management** | N/A | Unified multi-provider pool with smart rotation |
| **Browser Tool Capping** | None | 2 per iteration (sequential enforcement) |

---

## 10. Critical Issues & Fixes (Recent)

### guIDE
1. **ESM Import Path**: Fixed `getNodeLlamaCppPath()` to return `dist/index.js` as `file://` URL
2. **Model Path**: Fixed `modelPath` to be raw filesystem path (not `file://`) for `loadModel()`
3. **Undefined Variable**: Fixed `iterationToolResults` → `toolResults.results` in local model path
4. **Task Classifier**: Fixed overly aggressive 'chat' classification (now checks absence of browser/code words)
5. **Double System Prompt**: Removed redundant `_getActiveSystemPrompt()` prepending
6. **Few-shot Example**: Added concrete tool call example to tool prompt

### Pocket Guide
- No recent critical fixes documented (appears more stable, likely due to cloud backend reliability)

---

## 11. Recommendations

### For guIDE (IDE)
1. **Consider adopting Pocket Guide's anti-hallucination guards**:
   - Execution state tracking
   - Model claim verification
   - Fabrication detection for `write_file`
2. **Consider progressive context pruning** (at 55% capacity) to reduce rotation frequency
3. **Consider browser tool capping** (2 per iteration) to prevent stale-ref cascades
4. **Consider error enrichment** (`_enrichErrorFeedback`) for better small-model guidance

### For Pocket Guide
1. **Consider task type classification** to reduce context usage (like IDE's approach)
2. **Consider KV cache reuse** if/when local models are added
3. **Consider system prompt modularity** (like IDE's context-aware construction)

---

## 12. Conclusion

Both pipelines are well-architected and share a common foundation. The IDE prioritizes **local inference** and **task-specific optimization**, while Pocket Guide prioritizes **cloud scale** and **anti-hallucination robustness**. Each has strengths the other could adopt:

- **IDE's strengths**: Task classification, KV cache reuse, modular system prompts
- **Pocket Guide's strengths**: Anti-hallucination guards, progressive pruning, smart model routing

The recent fixes to IDE (task classifier, double prompt, undefined variable) address critical issues that were likely impacting small model performance. Pocket Guide's more aggressive guards suggest it's been battle-tested against hallucination issues that IDE may encounter as it scales.

---

**Document Status**: Complete  
**Next Steps**: Consider cross-pollinating optimizations between both pipelines
