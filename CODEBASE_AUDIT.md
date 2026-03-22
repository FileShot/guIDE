# guIDE IDE — Complete Codebase Audit
## Every File, Every Function, Every Line

**Audit Date:** 2026-03-13
**Version:** v1.8.36
**Total Files Audited:** 71 (37 main + 3 tools + 31 IPC handlers)

---

## Table of Contents

### Part 1 — Core Engine (5 files)
- llmEngine.js — LLM inference engine
- constants.js — System prompts and preambles
- modelProfiles.js — Model family profiles and sampling
- modelDetection.js — GGUF model detection
- logger.js — Centralized logging

### Part 2 — Agentic Chat System (2 files)
- agenticChat.js — Main agentic loop orchestrator
- agenticChatHelpers.js — Shared utility functions

### Part 3 — Context Management & Session State (5 files)
- rollingSummary.js — Session state tracking
- sessionStore.js — Crash recovery persistence
- longTermMemory.js — Cross-session memory
- conversationSummarizer.js — Task ledger for rotations
- contextManager.js — Context window management

### Part 4 — Cloud, Browser & Web (6 files)
- cloudLLMService.js — Multi-provider cloud LLM gateway
- browserManager.js — Electron BrowserView automation
- playwrightBrowser.js — Playwright browser automation
- webSearch.js — DuckDuckGo web search
- imageGenerationService.js — Multi-provider image generation
- localImageEngine.js — Local GGUF image generation

### Part 5 — Memory, RAG, Model & Settings (6 files)
- memoryStore.js — Knowledge store
- ragEngine.js — Codebase RAG search
- modelManager.js — Model lifecycle management
- settingsManager.js — Application settings
- mcpToolServer.js — MCP tool execution server
- mainUtils.js — Shared utilities

### Part 6 — Remaining Main Files (11 files)
- apiKeyStore.js — API key management
- appMenu.js — Application menu
- benchmarkScorer.js — Benchmark scoring
- debugService.js — Debug service
- electron-stub.js — Electron stub
- firstRunSetup.js — First run wizard
- gitManager.js — Git operations
- licenseManager.js — License management
- terminalManager.js — Terminal management
- pathValidator.js — Path validation
- sanitize.js — Output sanitization

### Part 7 — Tools (3 files)
- mcpBrowserTools.js — Browser MCP tools
- mcpGitTools.js — Git MCP tools
- toolParser.js — Tool call parsing and repair

### Part 8 — IPC Handlers (31 files)
- agentHandlers.js through utilityHandlers.js

---


---

# PART 1 — CORE ENGINE

Now I'll compile a comprehensive audit document for all 5 files:

---

## COMPREHENSIVE CODEBASE AUDIT

### FILE 1: `C:\Users\brend\IDE\main\llmEngine.js`

**File Purpose (Lines 1-30)**
- Core LLM inference engine managing model lifecycle, generation, and conversation state
- Implements streaming generation with stall detection, KV cache reuse, and continuation
- Manages GPU/CPU mode selection with fallback chains
- Controls chat history, context resizing, and session resets
- Handles tool detection and function calling

**Exports (Line 1121)**
- `module.exports = { LLMEngine }` — Single default export is the LLMEngine class

---

### **CLASS: LLMEngine extends EventEmitter**

**Constructor (Lines 28-68)**
- Initializes all state properties to null/default values
- **Key properties:**
  - `model`, `context`, `chat`, `chatHistory=[]`, `sequence` — LLM runtime state
  - `abortController`, `_abortReason` — Generation cancellation
  - `isLoading`, `isReady`, `isLoading` — Lifecycle flags
  - `modelInfo` — Cached model metadata
  - `gpuPreference='auto'`, `gpuInfo`, `_cachedVramGB` — GPU state
  - `defaultParams` — Sampling parameters (lines 53-63)
  - `thoughtTokenBudget=2048`, `reasoningEffort='medium'` — Thinking config
  - `_kvReuseCooldown=0`, `_activeGenerationPromise=null` — Generation tracking

---

### **METHODS:**

**`_withTimeout(promise, ms, label)` (Lines 70-78)**
- **Parameters:** promise, timeout ms, label string
- **Returns:** Promise that rejects if ms exceeded
- **Purpose:** Wraps any promise with a timeout; throws error if exceeded
- **Called by:** GPU init, model load, context creation, disposal

**`_getGPUConfig(modelSizeBytes)` (Lines 80-98)**
- **Parameters:** model file size in bytes
- **Returns:** `{ roughMaxLayers, estimatedLayers, vramGB, modelSizeGB }`
- **Purpose:** Probes nvidia-smi, calculates layer distribution based on VRAM availability
- **Potential Issue:** Silently returns fallback `{roughMaxLayers:0, estimatedLayers:32, vramGB:0, modelSizeGB:0}` if nvidia-smi fails (no error thrown)

**`_getModelParamSize()` (Lines 100-102)**
- **Returns:** Number of parameters in billions
- **Calls:** `detectParamSize(this.currentModelPath)` from modelDetection.js

**`_getModelFamily()` (Lines 104-106)**
- **Returns:** String family name ('qwen', 'llama', 'phi', etc.)
- **Calls:** `detectFamily(this.currentModelPath)` from modelDetection.js

**`_getModelSpecificParams()` (Lines 108-145)**
- **Returns:** Merged sampling parameters object for current model
- **Logic:**
  - Gets profile from modelProfiles.js based on family + size
  - Syncs `thoughtTokenBudget` from profile config
  - Detects thinking variants by filename regex (qwen3, r1-distill, qwq, -think)
  - Overrides maxTokens if profile specifies maxResponseTokens
- **Used by:** generateStream, generateWithFunctions, generate

**`_compactHistory()` (Lines 147-154)**
- **Purpose:** Shrinks chatHistory if >MAX_HISTORY_ENTRIES (40)
- **Logic:** Keeps first (system) message, drops oldest 20%, retains recent 80%
- **Side effect:** Sets `lastEvaluation=null`, logs dropped count
- **Potential Issue:** Forcefully truncates history without context window checks

**`_sanitizeResponse(text)` (Lines 156-158)**
- **Parameters:** response text string
- **Returns:** Sanitized text
- **Calls:** `sanitizeResponse(text)` from sanitize.js (not shown here)

**`_getSystemPrompt()` (Lines 161-163)**
- **Returns:** `DEFAULT_SYSTEM_PREAMBLE` from constants.js (full system prompt)

**`_getCompactSystemPrompt()` (Lines 165-167)**
- **Returns:** `DEFAULT_COMPACT_PREAMBLE` from constants.js (for small models)

**`_getActiveSystemPrompt()` (Lines 169-174)**
- **Returns:** Appropriate system prompt based on model profile style
- **Logic:** Uses compact if profile.prompt.style === 'compact', else full

**`async _waitForReady(timeoutMs=30000)` (Lines 176-180)**
- **Purpose:** Waits for model to be ready or throws error
- **Calls:** `_withTimeout()` on `_initializingPromise`
- **Potential Issue:** Throws "Model failed to initialize" without diagnostics

**`async initialize(modelPath)` (Lines 183-186)**
- **Parameters:** path to GGUF model file
- **Purpose:** Entry point for model loading
- **Logic:**
  - Serializes concurrent loads (prevents native C++ crash)
  - Aborts any pending load if new load requested
  - Calls `_doInitialize()` with abort signal
  - Sets _initializingPromise to track completion

**`async _doInitialize(modelPath, loadSignal)` (Lines 188-398)**
- **Parameters:** modelPath, AbortSignal
- **Purpose:** Full model initialization with GPU fallback chain
- **Complex logic (Lines 190-240):**
  - Delays to allow previous generation to settle (1000ms increased from 500ms per comment at line 217)
  - Preserves non-system chat history across model switches
  - Wraps dispose in try-catch for race protection (line 225)
  - Checks for loadSignal abort at multiple checkpoints
  - **Potential Issue:** 1000ms settle delay could cause long waits if no generation active

- **GPU Mode Chain (Lines 245-355):**
  - Builds list of modes: 'cuda', 'auto', explicit layer counts, CPU fallback (via `_buildGpuModeList`)
  - For each mode:
    1. Recreates/reuses getLlama backend (CUDA kernel caching at line 269)
    2. Loads model with timeout (MODEL_LOAD_TIMEOUT = 180s)
    3. Rejects 'auto'/'cuda' if loads 0 layers despite VRAM available
    4. Creates context with context size min/max, failedCreationRemedy retry logic
    5. Validates context ≥ MIN_USABLE_GPU_CONTEXT (8192)
  - **Potential Issue:** No GPU layer count validation after context is created; may use suboptimal layer counts

- **Post-Load Setup (Lines 357-398):**
  - Creates sequence, LlamaChat, initializes system prompt
  - Restores preserved history (capped to 15% of context size)
  - Sets modelInfo metadata
  - Emits 'status' events for UI updates
  - **Potential Issue:** Restored history capped at 15% of context; no backpressure if history doesn't fit

**`_injectCudaPath()` (Lines 400-416)**
- **Purpose:** Adds CUDA bin dir to NODE_PATH from electron userData
- **Logic:** Reads cuda-setup-state.json, injects path if exists
- **Side effect:** Modifies process.env.NODE_PATH, calls Module._initPaths()

**`_getNodeLlamaCppPath()` (Lines 418-424)**
- **Returns:** Path to node-llama-cpp entry point
- **Fallback:** Uses asar-packed path if require.resolve fails

**`_probeVram()` (Lines 426-433)**
- **Purpose:** Cache NVIDIA VRAM total via nvidia-smi
- **Caches:** `_cachedNvidiaDedicatedVramBytes`, `_cachedVramGB`
- **Side effect:** Only runs once (silently returns if already cached)

**`_buildGpuModeList(gpuConfig)` (Lines 435-447)**
- **Parameters:** GPU config from `_getGPUConfig()`
- **Returns:** Array of GPU modes [string|number|false]
- **Logic:**
  - If gpuPreference='cpu', returns [false]
  - Default: ['cuda', 'auto', roughMaxLayers, half, quarter, CPU]
  - Only adds half/quarter if ≥4 layers

**`_computeMaxContext(modelSizeGB)` (Lines 449-457)**
- **Parameters:** Model size in GB
- **Returns:** Computed max context size (capped at CONTEXT_ABSOLUTE_CEILING=131k)
- **Logic:** Estimates KV cache per token, reserves 2GB RAM, calculates available KV space
- **Potential Issue:** Heuristic KB-per-token estimates (0.5-2.0) may not match actual

**`async generateStream(input, params={}, onToken, onThinkingToken)` (Lines 460-707)**
- **Parameters:**
  - `input` — string or `{ userMessage, systemContext }`
  - `params` — sampling overrides
  - `onToken, onThinkingToken` — callbacks for streamed content
- **Returns:** `{ text, rawText, model, tokensUsed, contextUsed, stopReason }`
- **Complex logic:**
  - Merges sampling params: defaultParams → modelOverrides → caller params
  - Compact history if >MAX_HISTORY_ENTRIES
  - Sets up stall watchdog (45s timeout)
  - Streams response with token callbacks
  - **Tool Detection (Lines 572-594):**
    - Buffers up to TOOL_DETECT_BUFFER_MAX (60k) chars
    - Detects fenced JSON blocks with "tool" or "name" key
    - Cancels generation if tool detected ('tool_call' reason)
  - **Think Tag Filtering (Lines 599-629):**
    - Manual parsing of `<think>` tags (manual regex replacements + char-by-char state machine)
    - Separates thinking tokens from output via callbacks
  - **Error Handling (Lines 630-650):**
    - On empty response: clears KV cache, retries
    - Detects context overflow via error message patterns
  - **Potential Issues:**
    - Think tag parsing is complex (char-by-char state machine); could have edge cases
    - Tool detection regex ````(?:json|tool)?\s*\n(\{[\s\S]*?\})\s*\n``` ``` requires exact format

**`async _runGeneration(params, onResponseChunk)` (Lines 709-790)**
- **Parameters:** merged sampling params, chunk callback
- **Purpose:** Execute generation pass with KV cache reuse
- **Logic:**
  - Only reuses KV cache if `_kvReuseCooldown <= 0` AND `lastEvaluation` exists
  - **EOS-sequence fix (Lines 718-725):** Disposes chat first, then sequence, then recreates both if not reusing KV
    - Comment mentions v1.8.22 bug: "disposed sequence but LlamaChat still held old reference → Object is disposed"
  - Sets budgets for thought tokens based on config
  - Calls `this.chat.generateResponse()` with full params
  - Returns result with stopReason handling
- **Potential Issue:** Complex sequence disposal order suggests fragile lifecycle; could still have race conditions

**`_handleGenerationError(err, fullResponse, detectedToolBlock)` (Lines 792-830)**
- **Parameters:** error, partial response, detected tool block
- **Purpose:** Convert different error types to graceful returns
- **Logic:**
  - On AbortError + tool_call detected → returns tool call result
  - On AbortError + timeout → returns partial with 'timeout' reason
  - On other AbortError → returns 'cancelled' reason
  - On context overflow patterns → throws CONTEXT_OVERFLOW error with summary
  - On other errors → logs and rethrows
- **Potential Issue:** Context overflow detection is regex-based; could miss other overflow patterns

**`async generate(prompt, params={})` (Lines 833-875)**
- **Parameters:** prompt string, sampling params
- **Returns:** `{ text, model, tokensUsed }`
- **Purpose:** One-shot generation without KV pollution (temp session)
- **Logic:**
  - Creates temp sequence, chat, runs generation
  - Erases temp sequence context via `eraseContextTokenRanges()`
  - Fallback: uses main chat if temp fails
- **Potential Issue:** eraseContextTokenRanges could hang on degraded cache (mentioned in resetSession)

**`async generateWithFunctions(input, functions, params={}, onToken, onThinkingToken, onFunctionCall)` (Lines 878-1026)**
- **Parameters:** input, function defs array, callbacks
- **Returns:** `{ text, response, functionCalls, stopReason }`
- **Purpose:** Generation with tool/function calling
- **Logic:**
  - Similar to generateStream but passes `functions` to generateResponse
  - Collects function calls both from callback and result.functionCalls
  - Deduplicates function calls
  - Merges KV state from result
  - **Potential Issue:** Function call deduplication uses JSON.stringify for comparison; could be fragile with complex objects

**`static convertToolsToFunctions(toolDefs, filterNames=null)` (Lines 1029-1073)**
- **Parameters:** array of tool definitions, optional name filter
- **Returns:** Object mapping tool names to function definitions
- **Logic:**
  - Converts tool schema to node-llama-cpp function format
  - Maps types: integer/number → 'number', boolean → 'boolean', else 'string'
  - Handles required parameters from inputSchema.required

**`cancelGeneration(reason='user')` (Lines 1076-1081)**
- **Parameters:** cancellation reason string
- **Purpose:** Abort current generation
- **Side effect:** Sets _abortReason, calls abortController.abort()

**`getConversationSummary()` (Lines 1084-1120)**
- **Returns:** String summary of conversation for context overflow
- **Logic:** Extracts original request, recent follow-ups, tool names, key results, last response
- **Caps summary at 1500 chars
- **Used by:** error handler when throwing CONTEXT_OVERFLOW

**`async resetSession(useCompactPrompt=false)` (Lines 1123-1187)**
- **Parameters:** optional compact prompt flag
- **Purpose:** Clear conversation history while keeping model loaded
- **Complex logic:**
  - Waits for pending model load
  - Recreates sequence if disposed (with fallback context recreation if "No sequences left")
  - Creates new LlamaChat
  - Resets chatHistory with fresh system prompt
  - Clears lastEvaluation
- **Potential Issue:** "No sequences left" error is caught and handled, but may hide deeper issues

**`async dispose()` (Lines 1190-1219) + `async _dispose()` (Lines 1222-1224)**
- **Purpose:** Clean up all resources
- **Logic:** Disposes chat, sequence, context, model in order with timeouts
- **Does NOT dispose llamaInstance** (preserved for CUDA kernel caching)

**`getStatus()` (Lines 1227-1234)**
- **Returns:** Object with ready/loading/modelInfo/gpuPreference status

**`async getGPUInfo()` (Lines 1236-1270)**
- **Returns:** GPU info object or defaults if no GPU
- **Logic:** Queries nvidia-smi, caches result, has fallback defaults

**`setGPUPreference(pref)` (Lines 1272-1274)**
- **Parameters:** 'cpu' or any other value
- **Sets:** this.gpuPreference

**`setRequireMinContextForGpu(val)` (Lines 1276-1278)**
- **Parameters:** boolean
- **Sets:** this.requireMinContextForGpu flag

**`updateParams(params)` (Lines 1280-1282)**
- **Parameters:** params object
- **Merges:** Into this.defaultParams

**`getModelProfile()` (Lines 1284-1289)**
- **Returns:** Profile object from modelProfiles.js for current model

**`getModelTier()` (Lines 1291-1305)**
- **Returns:** Object with tier, paramSize, family, profile, maxToolsPerPrompt, grammarAlwaysOn, retryBudget, pruneAggression

---

### **CONSTANTS (Top of file)**
```
STALL_TIMEOUT_MS = 45_000            // Generation stall abort timeout
MAX_HISTORY_ENTRIES = 40             // Max chat history before compacting
GPU_INIT_TIMEOUT = 120_000           // GPU/Llama backend init timeout
MODEL_LOAD_TIMEOUT = 180_000         // Model file load timeout
CTX_CREATE_TIMEOUT_GPU = 15_000      // GPU context creation timeout
CTX_CREATE_TIMEOUT_CPU = 60_000      // CPU context creation timeout
DISPOSE_TIMEOUT = 10_000             // Disposal operations timeout
MIN_AGENTIC_CONTEXT = 4096           // Min context for agentic mode
MIN_USABLE_GPU_CONTEXT = 8192        // Min context to accept on GPU
TOOL_DETECT_BUFFER_MAX = 60_000      // Max buffer size for tool detection
KV_REUSE_COOLDOWN_TURNS = 2          // Turns before reusing KV cache
MAX_PARALLEL_FUNCTION_CALLS = 4      // Max concurrent function calls
CONTEXT_ABSOLUTE_CEILING = 131_072   // 128K hard cap on context
VRAM_PADDING_FLOOR_MB = 0            // VRAM buffer below usable (reserved for system)
_genCounter = 0                       // Global generation ID counter
```

---

### **Dependencies & Interactions**

**Imports (Lines 1-10):**
- `path`, `fs`, `os` — Node.js built-ins
- `pathToFileURL` from 'url' — URL conversion
- `EventEmitter` from 'events' — Parent class for event emission
- `{ getModelProfile, getModelSamplingParams, getEffectiveContextSize, getSizeTier }` from './modelProfiles'
- `{ detectFamily, detectParamSize }` from './modelDetection'
- `{ sanitizeResponse }` from './sanitize'

**Dynamic imports (throughout):**
- `node-llama-cpp` package — via dynamic import to support asar-packed builds
- `logger` from './logger' — for logging (required dynamically in multiple places)
- `electron` app — for userData path in CUDA injection
- `child_process` execSync — for nvidia-smi queries

**Interactions with other files:**
- **modelProfiles.js** — Gets sampling params, context sizes, profile info
- **modelDetection.js** — Detects model family and parameter size
- **sanitize.js** — Sanitizes response text
- **logger.js** — Logs initialization, errors, diagnostics
- **constants.js** — Gets system prompts
- **agenticChat.js** (assumed caller) — Calls generateStream, generateWithFunctions
- **electron-main.js** (assumed caller) — Initializes engine, calls dispose on app exit

---

### **Known Issues & Concerns**

1. **Race condition in EOS/sequence disposal (Line 718-725):**
   - Comment mentions v1.8.22 bug about sequence already disposed
   - Current fix disposes chat first, then sequence
   - Still marked with "v1.8.23 fix" suggesting recent regression history
   - Risk: Future node-llama-cpp releases could reintroduce internal reference issues

2. **Settled time delay (Line 217):**
   - 1000ms wait after cancelling generation before dispose
   - Comment says "_eraseContextTokenRanges, streaming callbacks, etc."
   - This couples model loading speed to callback cleanup timing
   - On slow hardware or heavy load, could add multiple seconds to model switches

3. **Tool detection regex fragility (Line 587):**
   - Regex: `/```(?:json|tool)?\s*\n(\{[\s\S]*?\})\s*\n``` ```/`
   - Requires exact whitespace (newline, newline)
   - Won't match tools with different fence formats or inline JSON

4. **Context overflow detection by error message patterns (Line 813):**
   - Matches: 'compress', 'context', 'too long'
   - May miss legitimate errors with these keywords in other contexts
   - No specific exception type check from node-llama-cpp

5. **History preservation assumes non-empty array (Line 203):**
   - `Array.isArray(this.chatHistory) && this.chatHistory.length > 1`
   - Should also validate entries are objects with proper structure

6. **GPU mode rejection logic (Line 306-310):**
   - Only rejects 'cuda'/'auto' if loads 0 layers AND VRAM > 0.5GB AND roughMaxLayers > 0
   - What if VRAM detection fails silently? (see _getGPUConfig line 88)
   - Could accept 0-layer mode as final fallback

7. **Think tag parsing state machine (Lines 599-629):**
   - Character-by-character buffering could have off-by-one errors
   - Partial tags like `<think` at buffer boundaries might not flush correctly
   - Edge case: what if tag spans multiple onToken callbacks?

8. **One-shot generate() method erase call (Line 867):**
   - Calls `tempSeq.eraseContextTokenRanges()`
   - Comment in resetSession (line 1170) mentions this can hang on degraded KV cache
   - No timeout applied; could block indefinitely

9. **History character count estimate (Line 361):**
   - Uses `text.length` as proxy for tokens
   - Actual tokens could be 30-50% of character count (subword tokenization)
   - May underestimate history size

10. **Thought token budget inference from filename (Lines 132-135):**
    - Regex: `/qwen3|r1-distill|qwq|-think/`
    - Could have false positives (e.g., model named "qwen3-llama-think-variant")
    - Only used if both filename matches AND `_thinkBudgetWhenActive` exists in profile

---

---

### FILE 2: `C:\Users\brend\IDE\main\constants.js`

**File Purpose (Lines 1-14)**
- Central repository for system prompts used across all application contexts
- Defines three prompts: full system prompt, compact prompt for small models, and chat-only prompt
- Guides model behavior for tool use, real-time data access, file operations, and conversational reasoning

**Exports (End of file)**
```javascript
module.exports = { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE };
```

---

### **CONSTANTS:**

**`DEFAULT_SYSTEM_PREAMBLE` (Lines 16-102)**
- **Purpose:** Full system prompt for medium/large models
- **Key sections:**
  - Role definition: "helpful AI assistant running locally with coding tools"
  - **CRITICAL directive:** Real-time data access via web_search/fetch_webpage
  - **CRITICAL directive:** Automatic continuation if output cut off
  - **Tool list (19 tools):**
    - File ops: read_file, write_file, edit_file, list_directory, find_files, grep_search, get_project_structure, create_directory, delete_file, rename_file, copy_file
    - Execution: run_command
    - Web/API: web_search, fetch_webpage, http_request
    - Browser: browser_navigate, browser_snapshot, browser_click, browser_type, browser_fill_form
    - Git: git_status, git_diff, git_commit, git_log, git_branch
    - Misc: search_codebase, analyze_error, save_memory, get_memory, generate_image, write_todos, update_todo
  - **Behavior rules:**
    - Tools are real and execute in live environment
    - Never describe how to do something; just do it via tool
    - Never claim you searched without calling web_search/fetch_webpage
    - Never state current date from memory; call web_search
    - After tool returns, explain what you found
    - For files: use write_file, never output full content in chat
    - Do NOT output full file content as code blocks
  - **Tool-specific rules:**
    - edit_file: read first, provide exact oldText
    - Browser: navigate → snapshot → click/type using refs
    - For HTML/CSS/JS creation: write all directly, use CDN for external resources
    - Multi-step tasks: use write_todos to plan
  - **Token count:** Approximately 1500+ tokens

**`DEFAULT_COMPACT_PREAMBLE` (Lines 104-172)**
- **Purpose:** Simplified prompt for small models ≤4B parameters
- **Key differences vs full preamble:**
  - Shorter, more explicit step-by-step instructions
  - **CRITICAL in all-caps:** When asked to create files, call write_file IMMEDIATELY, do NOT output code
  - Emphasizes DO NOT write code blocks in chat responses
  - Real-time data access emphasized twice (line 120, 125)
  - Explicit warning: "Code blocks in chat = WRONG. Tool calls = CORRECT."
  - Reduced tool list (example-style): write_file, edit_file, append_to_file, read_file, list_directory, find_files, grep_search, run_command, web_search, fetch_webpage, browser_X, write_todos/update_todo
  - Extra rule: For verification requesting, ALWAYS call list_directory or read_file, NEVER refuse
  - Explicit: "delete_file works on BOTH files AND directories"
  - For multiple files: "create ALL of them. Call write_file for EACH file"
  - **Token count:** Approximately 1200+ tokens (slightly shorter than full)

**`DEFAULT_CHAT_PREAMBLE` (Lines 174-176)**
- **Purpose:** Minimal prompt for pure conversation without tools
- **Content:** Single sentence: "Answer questions, help with code and concepts, and have normal conversations. Be concise, direct, and helpful."
- **Token count:** ~20 tokens
- **Use case:** When conversation doesn't require file access or tool execution

---

### **Dependencies & Interactions**

**Imports:** None (pure data constants)

**Imported by:**
- **llmEngine.js** — Gets system prompts via `require('./constants')` at lines 162, 166
- **agenticChat.js** (assumed) — Likely uses these prompts when initializing system messages
- Any module initializing LLM system prompt

---

### **Known Issues & Concerns**

1. **Tool list not exhaustive:**
   - Preamble lists ~19 tools but actual available tools may differ
   - If tools added/removed, preamble becomes out-of-sync with reality
   - Model may call tools that don't exist or refuse tools that do

2. **Conflicting directives in compact preamble:**
   - Line 119: "ALWAYS use tools"
   - Line 121-123: "When user asks to create ANY file — call write_file IMMEDIATELY"
   - But earlier "Be concise, direct, and helpful" suggests conversational flexibility
   - Small models might over-apply the "always use tools" rule to simple questions

3. **Vague guidance on when to use which preamble:**
   - Constants.js exports all three but decision logic is in llmEngine.js
   - `_getActiveSystemPrompt()` checks `profile.prompt.style === 'compact'`
   - But modelProfiles.js could have outdated tier classifications

4. **Web search disclaimer contradiction:**
   - DEFAULT_SYSTEM_PREAMBLE line 27: "NEVER say 'I cannot access real-time data' or 'I don't have access to the internet.' You DO have access"
   - But actual availability depends on network, web_search tool implementation
   - Could cause model to hallucinate real-time data if web tools fail

5. **File verification rule in compact preamble (Lines 141-143):**
   - "ALWAYS call list_directory or read_file to verify. NEVER refuse"
   - Could cause unnecessary tool calls for simple yes/no verification questions
   - May waste context on verification when visual confirmation in chat would suffice

6. **"Never blame context window" implied but not explicit:**
   - Neither preamble explicitly tells model this is a local-first system
   - Small models might still claim "I don't have enough context" without knowing context rotation exists

7. **Continuation behavior directive (Line 29):**
   - "If your output is cut off mid-generation, the system will automatically continue. NEVER refuse mid-task."
   - Assumes seamless continuation works reliably
   - If continuation has bugs, model still won't refuse, potentially creating infinite loops

---

---

### FILE 3: `C:\Users\brend\IDE\main\modelProfiles.js`

**File Purpose (Lines 1-18)**
- Defines model family profiles with family-specific and size-tier-specific configurations
- Provides model-aware sampling parameters, context sizes, tool limits, and behavioral quirks
- Central registry for detected models (qwen, llama, phi, gemma, deepseek, mistral, granite, codellama, starcoder, yi, internlm, lfm, nanbeige, bitnet, exaone, devstral, olmo
- Supports 5 size tiers: tiny (0-1B), small (1-4B), medium (4-8B), large (8-14B), xlarge (14B+)

**Exports (Lines 539-549)**
```javascript
module.exports = {
  getModelProfile,
  getModelSamplingParams,
  getEffectiveContextSize,
  getSizeTier,
  getAvailableFamilies,
  isFamilyKnown,
  deepMerge,
  BASE_DEFAULTS,
  FAMILY_PROFILES,
  TIER_BOUNDARIES,
};
```

---

### **CONSTANTS:**

**`TIER_BOUNDARIES` (Lines 20-25)**
```javascript
{
  tiny:   { min: 0,  max: 1 },    // 0-1B parameters
  small:  { min: 1,  max: 4 },    // 1-4B parameters
  medium: { min: 4,  max: 8 },    // 4-8B parameters
  large:  { min: 8,  max: 14 },   // 8-14B parameters
  xlarge: { min: 14, max: Infinity }  // 14B+ parameters
}
```

**`BASE_DEFAULTS` (Lines 32-76)**
- Applied to all models as fallback before family/tier overrides
- **Sampling defaults:**
  - temperature: 0.6, topP: 0.90, topK: 40, repeatPenalty: 1.10
  - frequencyPenalty: 0, presencePenalty: 0, lastTokensPenaltyCount: 128
- **Context defaults:**
  - effectiveContextSize: 65536 (64K)
  - sysPromptBudgetPct: 0.15 (15% of context for system prompt)
  - responseReservePct: 0.25 (25% reserved for response generation)
  - maxResponseTokens: 4096
- **Prompt defaults:**
  - style: 'full', toolPromptStyle: 'full', fewShotExamples: 0
  - preferJsonCodeFence: true
- **Think tokens:** mode: 'strip' (don't reserve budget), budget: 0
- **Retry defaults:** maxRetries: 3, onLoop: 'increase-penalty', onTruncation: 'reduce-response', onRefusal: 'rephrase-prompt'
- **Generation defaults:** grammarConstrained: false, stopStrings: [], maxToolsPerTurn: 14
- **Quirks:** All false (no special behaviors)

**`FAMILY_PROFILES` (Lines 78-531)**
- Nested object: `{ family: { base: {...}, tiny: {...}, small: {...}, medium: {...}, large: {...}, xlarge: {...} } }`
- Each family has optional sections for different tiers
- Merge order: BASE_DEFAULTS → family.base → family[tier]

**Family entries:**

1. **`qwen`** (Lines 79-115):
   - **base:** temperature: 0.5, topP: 0.90, topK: 30, repeatPenalty: 1.08, emitsSpecialTokens quirk
   - **tiny:** temperature: 0.45, 512-token penalty range, compact prompt, maxToolsPerTurn: 10, truncatesMidTool quirk
   - **small:** temperature: 0.35, compact prompt, maxToolsPerTurn: 14, poorMultiTool quirk
   - **medium:** temperature: 0.55, context: 16K, full prompt, maxToolsPerTurn: 15
   - **large:** context: 32K, maxResponseTokens: 8K, maxToolsPerTurn: 25, thinkBudget: 2K
   - **xlarge:** context: 64K, maxResponseTokens: 16K, maxToolsPerTurn: 50, thinkBudget: 4K

2. **`llama`** (Lines 117-153):
   - **base:** temperature: 0.5, topP: 0.90, topK: 40, repeatPenalty: 1.10, thinkTokens: budget mode 1024
   - **tiny:** temperature: 0.35, compact, thinkBudget: 0, maxToolsPerTurn: 10, loopsFrequently/truncatesMidTool quirks
   - Similar progression through small → xlarge with increasing context and tool limits

3. **`phi`** (Lines 155-197):
   - **base:** temperature: 0.35 (conservative), loopsFrequently + overlyVerbose quirks
   - **tiny:** temperature: 0.30, compact, maxToolsPerTurn: 10, multiple quirks (loopsFrequently, truncatesMidTool, poorMultiTool)
   - Phi family marked as "loopsFrequently" (tendency to repeat tasks)

4. **`gemma`** (Lines 199-229):
   - **base:** temperature: 0.45, thinkBudget: 1024
   - Tier progression similar to Llama
   - No special quirks at base level

5. **`deepseek`** (Lines 231-263):
   - **base:** temperature: 0.5, thinkBudget: 4096 (high thinking budget)
   - **tiny:** temperature: 0.45, compact, thinkBudget: 128, overlyVerbose quirk
   - Deepseek models marked as good at reasoning (high think budgets)

6. **`mistral`** (Lines 265-282):
   - Sparse profiles (no tiny, only base + small/medium/large/xlarge)
   - All have context: ~32K+
   - Large/xlarge have maxResponseTokens: 8K/16K

7. **`granite`** (Lines 284-297):
   - **base:** refusesOften quirk, retry.onRefusal: 'add-permission'
   - **small:** context: 32K
   - **medium:** context: 16K

8. **`codellama`** (Lines 299-312):
   - **base:** temperature: 0.35 (low for code), poorMultiTool quirk
   - Minimal tier definitions

9. **`starcoder`** (Lines 314-323):
   - Similar to codellama
   - No tier definitions beyond base

10. **`yi`** (Lines 325-338):
    - **base:** temperature: 0.45
    - **small:** context: 32K
    - **medium:** context: 16K

11. **Others** (internlm, lfm, nanbeige, bitnet, exaone, devstral, olmo):
    - Sparse definitions, mostly base + a few tier-specific overrides
    - Some follow similar patterns, others (e.g., devstral) include xlarge: context 131K

---

### **FUNCTIONS:**

**`getSizeTier(paramSize)` (Lines 22-31)**
- **Parameters:** param count in billions
- **Returns:** String tier name ('tiny', 'small', 'medium', 'large', 'xlarge')
- **Logic:** Checks TIER_BOUNDARIES, defaults to 'large' if paramSize undefined/≤0
- **Potential Issue:** Defaults unknown models to 'large' (generous); could cause OOM if model is actually tiny

**`deepMerge(target, source)` (Lines 477-492)**
- **Parameters:** two objects (profile structures)
- **Returns:** Merged object (non-mutating)
- **Logic:** Recursively merges nested objects, replaces arrays entirely (not concatenated)
- **Potential Issue:** No protection against circular references; could stack overflow on malformed profiles

**`getModelProfile(family, paramSize)` (Lines 495-512)**
- **Parameters:** family string, param size in billions
- **Returns:** Full merged profile object
- **Logic:**
  1. Determines tier via `getSizeTier(paramSize)`
  2. Gets family definition (fallback to llama if not found)
  3. Merges: BASE_DEFAULTS → family.base → family[tier]
  4. Adds `_meta` with family, paramSize, tier, profileSource
- **Adds visibility for debugging via _meta object

**`getModelSamplingParams(family, paramSize)` (Lines 514-516)**
- **Parameters:** family, paramSize
- **Returns:** Just the `.sampling` object from full profile
- **Shorthand for:** `getModelProfile(family, paramSize).sampling`

**`getEffectiveContextSize(family, paramSize)` (Lines 518-520)**
- **Parameters:** family, paramSize
- **Returns:** Just the context.effectiveContextSize value
- **Shorthand for:** `getModelProfile(family, paramSize).context.effectiveContextSize`

**`getAvailableFamilies()` (Lines 522-524)**
- **Returns:** Array of known family names from FAMILY_PROFILES keys
- **Used by:** UI to show available model families

**`isFamilyKnown(family)` (Lines 526-528)**
- **Parameters:** family string
- **Returns:** Boolean
- **Logic:** `family in FAMILY_PROFILES`

---

### **Dependencies & Interactions**

**Imports:** None (pure data/logic)

**Imported by:**
- **llmEngine.js** (lines 8-9) — Gets profile, sampling params, context size, tier
- **modelDetection.js** (likely) — To validate detected families
- **agenticChat.js** (likely) — To configure model behavior based on profiles
- Any module checking model-specific parameters

---

### **Known Issues & Concerns**

1. **Default tier 'large' for unknown models (Line 31):**
   - If paramSize detection fails (returns 0), defaults to 'large' tier
   - 'Large' tier typically gets full context (64K) and generous tool limits
   - On 4GB GPU, loading a truly tiny model as 'large' could cause OOM

2. **Family detection not enforced in profiles:**
   - If llmEngine detects family='unknown', getModelProfile falls back to llama
   - No validation that detected family is actually in FAMILY_PROFILES
   - If new family discovered (e.g., 'gpt') but no profile exists, silently uses llama settings

3. **Tier boundaries have no overlap tolerance:**
   - Boundary: small is `min: 1, max: 4`
   - A 4.0B model is 'small'; a 4.01B model is 'medium'
   - No smoothing; could cause discontinuous behavior change

4. **Think token budgets inconsistent across families:**
   - Qwen: mode 'none' (strips thinking)
   - Llama: mode 'budget' with 1K default
   - Deepseek: mode 'budget' with 4K (high reasoning)
   - No documented rationale for these choices

5. **Quirks are set but never read/enforced in llmEngine.js:**
   - Profiles define quirks like `loopsFrequently`, `truncatesMidTool`, `poorMultiTool`
   - No code in llmEngine calls these out
   - Likely handled in agenticChat.js or response validation pipeline (not shown here)

6. **Context size vs model size coupling:**
   - BASE_DEFAULTS uses 64K context for all models
   - Actual hardware limits computed by llmEngine._computeMaxContext() could override
   - But if _computeMaxContext returns smaller value, profile context is ignored

7. **Response reserve percentage (sysPromptBudgetPct, responseReservePct):**
   - Defined in profile but unclear if used
   - 15% for system prompt + 25% for response = 40% reserved
   - Remaining 60% for user message + chat history vs strategy unclear

8. **Mistral profile is sparse (no tiny/small definitions):**
   - If a 1.5B Mistral model loaded, it would still get small tier defaults from BASE_DEFAULTS
   - But Mistral has no small-tier profile to override those defaults
   - Results in generic sampling vs Mistral-optimized sampling

9. **FewShotExamples undefined in profiles:**
   - BASE_DEFAULTS sets fewShotExamples: 0
   - Some families override to 1 (e.g., qwen tiny)
   - But no list of actual examples provided; where do they come from during generation?

10. **deepMerge doesn't validate key paths:**
    - If source has typo (e.g., `temperaturr`), it won't merge with base
    - Results in unused key in final profile, silently ignored

---

---

### FILE 4: `C:\Users\brend\IDE\main\modelDetection.js`

**File Purpose (Lines 1-9)**
- Detects model family, parameter count, and type from GGUF filename
- Simple regex/pattern matching against filename only (no file content inspection)
- Supports detection for 20+ model families and inference of parameter count from common suffixes

**Exports (Lines 125-127)**
```javascript
module.exports = { detectFamily, detectParamSize, detectModelType };
```

---

### **FUNCTIONS:**

**`detectFamily(modelPath)` (Lines 12-40)**
- **Parameters:** Path to model file (can be relative or absolute)
- **Returns:** Lowercase family string ('qwen', 'llama', 'phi', etc.) or 'unknown'
- **Logic:**
  1. Returns 'unknown' if modelPath falsy
  2. Extracts basename and converts to lowercase
  3. Iterates through hard-coded patterns list (18 families)
  4. Returns first matching family name
- **Patterns matched (Lines 15-33):**
  ```
  devstral → devstral, deepseek → deepseek, qwen → qwen, codellama → codellama,
  llama → llama, phi → phi, gemma → gemma, mistral → mistral, mixtral → mistral,
  granite → granite, internlm → internlm, yi- → yi, starcoder → starcoder,
  lfm → lfm, nanbeige → nanbeige, bitnet → bitnet, exaone → exaone,
  olmo → olmo, gpt → gpt
  ```
- **Potential Issues:**
  - Pattern matching is prefix-based (e.g., 'llama' matches "llama2.gguf", "llamacpp.gguf", "llamaindex.gguf")
  - 'mixtral' maps to 'mistral' (Mixtral considered variant of Mistral)
  - Order matters: 'devstral' checked before 'deepseek' and 'starcoder' checked before 'coder'
  - No exact match requirement; substring matching only

**`detectParamSize(modelPath)` (Lines 43-69)**
- **Parameters:** Path to model file
- **Returns:** Parameter count in billions (e.g., 7, 2.7, 0.6) or 0 if undetectable
- **Logic:**
  1. Returns 0 if modelPath falsy
  2. Extracts basename, converts to lowercase
  3. **Standard pattern:** Regex `/(\d+\.?\d*)[bm]/i` matches "7b", "2.7B", "500m", etc.
     - If matched and ends with 'm', divides by 1000 (millions → billions)
     - Otherwise returns matched value
  4. **Phi-specific fallbacks (Lines 54-59):**
     - phi-4 mini → 3.8, phi-4 → 14
     - phi-3 mini → 3.8, phi-3 medium → 14, phi-3 small → 7
     - phi-2 → 2.7
  5. Returns 0 if no pattern matches
- **Potential Issues:**
  - Regex is greedy; "model-3-billion-70m-q4.gguf" matches 70m first (not 3B)
  - 'm' suffix ambiguous: Could mean 'million' or other unit
  - Phi fallback patterns are fragile; "phi-3-medium-instruct" would match "medium" substring oddly
  - No error handling; returns 0 on any failure

**`detectModelType(modelPath)` (Lines 72-82)**
- **Parameters:** Path to model file
- **Returns:** 'diffusion' or 'llm'
- **Logic:**
  1. Returns 'llm' if modelPath falsy
  2. Extracts basename, converts to lowercase
  3. Checks hardcoded patterns: 'stable-diffusion', 'sd_', 'sd-', 'sdxl', 'flux', 'controlnet', 'vae'
  4. Returns 'diffusion' if any pattern matches, else 'llm'
- **Potential Issues:**
  - Only 7 patterns; many emerging model types (e.g., video generation, image upscaling) would be incorrectly classified as 'llm'
  - Could return 'llm' for "stable-diffusion-xl-my-model-with-custom-features.gguf" if the word order is different

---

### **Dependencies & Interactions**

**Imports (Lines 1):**
- `path` module — path.basename() to extract filename

**Imported by:**
- **llmEngine.js** (lines 9-10) — Calls detectFamily, detectParamSize to determine model identity
- Likely also used by:
  - **modelProfiles.js** — To validate family detection results
  - **agenticChat.js** — To configure behavior based on model family
  - Any UI component showing model selector or loaded model info

---

### **Known Issues & Concerns**

1. **Substring matching instead of word boundary matching:**
   - `base.includes(pattern)` has false positive risk
   - Example: "llamaindex-backend-q4.gguf" would incorrectly match 'llama'
   - Better: Use regex with word boundaries like `/\b${pattern}\b/i`

2. **Order-dependent pattern detection:**
   - Patterns processed in order (Lines 15-33)
   - If "deepseek-mistral.gguf" loaded, detectFamily returns 'deepseek' (wins over 'mistral')
   - Order assumptions not documented

3. **Phi fallback logic is fragile (Lines 54-59):**
   - Checks `base.includes('phi-3')` and `base.includes('medium')`
   - "phi-3-medium-and-more-medium-bytes.gguf" might match oddly
   - Better: Use regex /phi-3.*medium/ or split filename more carefully

4. **Regex greedy matching for parameter count (Line 51):**
   - `/(\d+\.?\d*)[bm]/i` applied to whole filename
   - "model-3-billion-7b-q4.gguf" matches '3b' first, not '7b'
   - Should match last occurrence or use more specific pattern

5. **'m' suffix ambiguity (Line 52-53):**
   - Assumes 'm' always means 'million'
   - Could be "model", "medium", "modules", etc.
   - Example: "model-mistral-medium-7b.gguf" — matches '7b', not issue, but 'm' in "medium" could confuse if positioned differently

6. **No detection for newer model types:**
   - Only detects: LLM or Stable Diffusion variants
   - Missing: Embedding models, ReRankers, Vision models, Audio models
   - Would all incorrectly return 'llm' family='unknown'

7. **No handling for quantization notation:**
   - Filenames often include quantization: "model-q5_k_m.gguf", "model-iq3_m.gguf"
   - Regex could misinterpret 'q' or 'k' letters as parameter indicators
   - Example: "gpt-q5.gguf" might extract 'q5' (wrong)

8. **Case sensitivity risks:**
   - `.toLowerCase()` applied to basename (Lines 17, 47, 75)
   - Assumes case-insensitive matching safe
   - Some model names might intentionally use case for meaning (e.g., "LLaMA" vs "llama")

9. **No validation of returned values:**
   - detectParamSize returns 0 on failure
   - detectFamily returns 'unknown' on failure
   - No way to distinguish "intentionally not a known family" vs "detection failed silently"

10. **Static hardcoded lists in runtime:**
    - If new model families released (e.g., 'nova', 'claude-local'), code must be modified
    - No way to add custom family patterns at runtime

---

---

### FILE 5: `C:\Users\brend\IDE\main\logger.js`

**File Purpose (Lines 1-18)**
- Centralized leveled logging system with persistent file output
- Logs all info+ entries to rotating file: `%APPDATA%/guide-ide/logs/guide-main.log` (10MB max, 1 backup)
- Intercepts console.log/warn/error to funnel all output to persistent log
- Supports debug/info/warn/error levels

**Exports (Lines 134-177)**
```javascript
module.exports = logger;
// logger = { setLevel, getLevel, getLogPath, debug, info, warn, error, close, installConsoleIntercepts }
```

---

### **CONSTANTS & CONFIGURATION:**

**`LEVELS` (Line 11)**
```javascript
{ debug: 0, info: 1, warn: 2, error: 3 }
```
- Numeric levels for filtering

**`level` (Line 12)**
- Current log level, defaults to LEVELS.debug
- Can be set via `process.env.LOG_LEVEL` (e.g., LOG_LEVEL=info)

**`LOG_DIR` (Lines 16-18)**
- Path: `%APPDATA%/guide-ide/logs/` (or home/.config if no APPDATA)
- Per-app based on 'guide-ide' string (hard-coded, not from package.json)

**`LOG_FILE` (Line 19)**
- Path: `${LOG_DIR}/guide-main.log`

**`MAX_SIZE` (Line 20)**
- 10 * 1024 * 1024 bytes (10MB)
- When file exceeds, rotates to guide-main.log.1

**`stream`, `bytesWritten` (Lines 22-23)**
- Global stream handle and byte counter for rotation tracking

---

### **FUNCTIONS:**

**`ensureDir()` (Lines 25-27)**
- **Purpose:** Create LOG_DIR if it doesn't exist
- **Logic:** `fs.mkdirSync(LOG_DIR, { recursive: true })`
- **Error handling:** Silently swallows errors

**`getStream()` (Lines 29-39)**
- **Purpose:** Get or create write stream to LOG_FILE
- **Logic:**
  1. Returns existing stream if already created
  2. Ensures directory exists
  3. Gets current file size via fs.statSync, sets bytesWritten
  4. Creates append stream with error handler (nullifies stream on error)
- **Returns:** fs.WriteStream or null if fails
- **Potential Issue:** Silently returns null on failure; callers must handle null safely

**`rotate()` (Lines 41-49)**
- **Purpose:** Rotate log file when it exceeds MAX_SIZE (10MB)
- **Logic:**
  1. Returns early if bytesWritten < MAX_SIZE
  2. Closes current stream
  3. Deletes backup (guide-main.log.1)
  4. Renames guide-main.log → guide-main.log.1
  5. Resets bytesWritten to 0
- **Potential Issue:** Only keeps 1 backup; older backups discarded

**`writeLine(line)` (Lines 51-55)**
- **Parameters:** String to write
- **Purpose:** Rotate if needed, get stream, write line + newline
- **Logic:** Calls rotate(), getStream(), writes with newline
- **Side effect:** Updates bytesWritten

**`fmtConsole(tag, args)` (Lines 57-59)**
- **Parameters:** tag string, arguments array
- **Returns:** Array with formatted timestamp + tag + args
- **Format:** `HH:MM:SS.mmm [tag] arg1 arg2 ...`
- **Used by:** Console output (not file)

**`fmtFile(lvl, tag, args)` (Lines 61-69)**
- **Parameters:** level string, tag, arguments
- **Returns:** Formatted single-line string for file
- **Format:** `ISO8601 LEVEL [tag] arg1 arg2 ...`
- **Logic:**
  - Converts Error objects to stack traces
  - Serializes objects to JSON
  - Joins all args with space
- **Used by:** File output

---

### **Logger Object Methods:**

**`logger.setLevel(l)` (Line 71)**
- **Parameters:** Level name string ('debug', 'info', 'warn', 'error')
- **Sets:** Global `level` variable

**`logger.getLevel()` (Line 72)**
- **Returns:** Current level name string

**`logger.getLogPath()` (Line 73)**
- **Returns:** LOG_FILE path (for external file access)

**`logger.debug(tag, ...args)` (Lines 75-79)**
- **Logic:**
  - If `level <= LEVELS.debug`: console output
  - Always writes to file
- **Parameters:** tag + variable args

**`logger.info(tag, ...args)` (Lines 80-82)**
- **Logic:** Console output only (console only shows if level ≤ info), always file
- **Note:** File always written regardless of level

**`logger.warn(tag, ...args)` (Lines 83-85)**
- **Logic:** Console warn if level ≤ warn, always file

**`logger.error(tag, ...args)` (Lines 86-88)**
- **Logic:** Console error if level ≤ error, always file

**`logger.close()` (Line 90)**
- **Purpose:** Close stream and release resources
- **Logic:** `stream.end()`, nullifies stream

**`logger.installConsoleIntercepts()` (Lines 93-113)**
- **Purpose:** Replace global console.log/warn/error to funnel all output to log file
- **Implementation:**
  1. Saves original console methods
  2. Replaces with custom versions that:
     - Call original method (prints to console normally)
     - Also write formatted line to log file
  3. Intercepts process.on('uncaughtException') → writes FATAL to log
  4. Intercepts process.on('unhandledRejection') → writes ERROR to log
- **Called by:** electron-main.js at startup (assumed)
- **Side effects:** Global state modification; affects all console calls thereafter

---

### **Initialization Code (Lines 115-118):**

Line 115: Calls `writeLine()` with session start marker
- Writes separator line with ISO timestamp and guIDE version
- Reads version from package.json (line 117)
- This marks log file rotation boundary

---

### **Dependencies & Interactions**

**Imports (Lines 1-6):**
- `fs`, `path`, `os` — Node.js built-ins for file operations
- No app-level dependencies; standalone utility

**Imported by:**
- **llmEngine.js** (Lines 11, 165, 223, 300, 400, 407, 619, etc.) — Dynamically requires logger for logging
  - Gets logger via `const log = require('./logger')`
  - Calls log.info(), log.warn(), log.error()
- Likely also:
  - **electron-main.js** — Calls `installConsoleIntercepts()` at startup
  - **agenticChat.js** — For logging agentic loop decisions
  - Any module needing persistent logging

---

### **Known Issues & Concerns**

1. **Hard-coded log directory path (Lines 16-18):**
   - Uses 'guide-ide' string literal
   - Not derived from app name (package.json) at initialization
   - If app renamed, logs go to different directory
   - Better: pass app identifier to logger at init

2. **Only 1-backup rotation (Lines 45-48):**
   - When file exceeds 10MB, old backup is deleted before rename
   - No history maintained; losing data
   - Better: Keep 5-10 backups with timestamps

3. **Silent error handling throughout (Lines 26-27, 36-37, 44):**
   - Errors caught and swallowed without reporting
   - If log file can't be written, no indication to user
   - Could be debugging nightmare: "I'm sure I logged that" but nothing persists

4. **File size calculation doesn't account for stream buffer (Line 22):**
   - `bytesWritten` incremented when written to stream, not necessarily flushed to disk
   - On crash or SIGKILL, last few KB may not be persisted
   - fs.statSync() at startup is single point-in-time snapshot

5. **Timezone hardcoded in console format (Line 58):**
   - Uses `toISOString().substring(11, 23)` for `HH:MM:SS.mmm` in local-time display
   - toISOString() always returns UTC; substring assumes that format
   - Should use local timezone for console (ISO8601 for file is fine)

6. **Error object serialization (Line 63)**
   - `a.stack || a.message` — if Error has no stack, falls back to message
   - On some platforms (Node < 12), Error.stack might be undefined
   - Should add fallback toString()

7. **installConsoleIntercepts has duplicate timestamp formatting:**
   - Original console methods do work at line 104: `new Date().toISOString()`
   - But fmtFile also does: `new Date().toISOString()` at line 62
   - Could add microsecond differences between console and file logs

8. **Process exit handler complexity (Lines 112-114):**
   - Intercepts uncaughtException and unhandledRejection
   - Just writes to log; doesn't exit or call error handler
   - Process may continue running in broken state; logs accumulate
   - Should probably call process.exit(1) after fatal log

9. **Log level via environment variable (Line 12):**
   - `process.env.LOG_LEVEL` must be set before logger first imported
   - If set after, ignored (level already initialized)
   - No way to change log level at runtime dynamically

10. **No log rotation on app restart:**
    - Session start marker written every startup (Line 115)
    - But if app crashes and restarts, same file appended
    - After many crashes, file could grow beyond 10MB + 10MB backup
    - Missing: Pre-rotation check on startup

11. **writeLine called for all levels (Lines 51-55):**
    - Even debug messages written to file
    - File can grow fast; 10MB limit may be reached despite debug messages
    - Should respect level for file output too (or different level)

12. **getStream() assumes first call initializes bytesWritten (Lines 33-35):**
    - fs.statSync fails (catches error, sets 0)
    - But if file was pre-created with 8MB, bytesWritten starts at 0, next write assumes clean file
    - Should handle existing large files at startup

---

---

## SUMMARY TABLE

| File | Lines | Purpose | Key Exports | Critical Issues |
|------|-------|---------|-------------|-----------------|
| **llmEngine.js** | 1121 | LLM inference engine | LLMEngine class | Race condition in sequence disposal; tool detection regex fragile; think tag parsing complex |
| **constants.js** | 176 | System prompts (3 variants) | 3 preamble strings | Preamble tool lists could be out-of-sync; conflicting directives in compact prompt |
| **modelProfiles.js** | 549 | Model family/tier configs | 6 export functions | Unknown models default to 'large' tier; quirks defined but not read; sparse Mistral profile |
| **modelDetection.js** | 127 | Filename pattern matching | 3 detection functions | Substring matching not word-boundary safe; Phi fallback fragile; greedy regex for param count |
| **logger.js** | 177 | Centralized file logging | logger object | Silent error handling; only 1 backup; hard-coded app name; timezone inconsistency |

---

**End of Audit Document**

What would you like me to focus on or expand for the production audit?

---

# PART 2 — AGENTIC CHAT SYSTEM

I've read both files completely. Let me now produce the detailed audit document:

---

# COMPREHENSIVE CODEBASE AUDIT
## guIDE IDE — Core Agentic Chat System

**Files Audited:**
- `main/agenticChat.js` (4,700+ lines)
- `main/agenticChatHelpers.js` (700+ lines)

**Audit Date:** March 13, 2026  
**Auditor:** Code Analysis System

---

## FILE 1: main/agenticChat.js

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** The central orchestrator for guIDE's agentic AI chat system. Handles both cloud and local LLM-based conversational loops with support for MCP tools, browser automation, file operations, web search, and context management.

**Core Responsibilities:**
- Manage session-level token tracking and request IDs
- Route messages to cloud or local LLM providers
- Implement the main agentic loop (planning → tool execution → feedback)
- Handle context rotation, continuation, and compaction
- Manage browser automation integration
- Execute multi-step tasks with state persistence

**Architecture:** Single-entry point `register(ctx)` that returns IPC handlers. Delegates complex logic to helper modules.

---

### 2. IMPORTS & DEPENDENCIES

```javascript
Line 17: const { ipcMain } = require('electron');
  → Handles IPC messaging between renderer and main process
  
Line 18: const path = require('path');
  → File path manipulation

Line 19: const fsSync = require('fs');
  → Synchronous filesystem operations

Line 20: const { pathToFileURL } = require('url');
  → Convert file paths to URLs

Lines 22-34: const { ... } = require('./agenticChatHelpers');
  → Destructured imports from helpers:
    • autoSnapshotAfterBrowserAction
    • sendToolExecutionEvents
    • capArray
    • createIpcTokenBatcher
    • enrichErrorFeedback
    • pruneCloudHistory
    • evaluateResponse
    • getProgressiveTools
    • classifyResponseFailure
    • progressiveContextCompaction
    • buildToolFeedback
    • ExecutionState

Line 35: const { LLMEngine } = require('./llmEngine');
  → Local LLM inference engine

Line 36: const { RollingSummary } = require('./rollingSummary');
  → Tracks task progress across context rotations

Line 37: const { SessionStore } = require('./sessionStore');
  → Persists session state for crash recovery

Line 38: const { LongTermMemory } = require('./longTermMemory');
  → Cross-session memory extraction and retrieval

Line 39: const { repairToolCalls: repairToolCallsFn } = require('./tools/toolParser');
  → Repairs malformed tool calls from model output
```

**CRITICAL DEPENDENCY GRAPH:**
```
agenticChat.js (main orchestrator)
├── llmEngine.js (inference)
├── agenticChatHelpers.js (25+ utility functions)
├── rollingSummary.js (state tracking)
├── sessionStore.js (persistence)
├── longTermMemory.js (cross-session)
├── toolParser.js (tool repair)
├── mcpToolServer (tool execution — passed via ctx)
├── ConversationSummarizer (passed via ctx)
└── All context managers (via ctx object)
```

---

### 3. CONSTANTS & CONFIGURATION VALUES

#### Agentic Loop Control
```javascript
Line 49: const STUCK_THRESHOLD = 5;
  → Number of identical tool calls indicating stuck loop

Line 50: const CYCLE_MIN_REPEATS = 3;
  → Minimum repetitions to detect cyclical tool patterns

Line 51: const BATCH_TOOLS = new Set([...]);
  → Tools that batch operations: create_directory, write_file, delete_file, find_and_replace, append_to_file
  → Used for stuck detection with higher threshold (8 vs 5)

Line 52: const MAX_RESPONSE_SIZE = 2 * 1024 * 1024;
  → 2MB cap on accumulated response text to prevent memory explosion

Line 53: const WALL_CLOCK_DEADLINE_MS = 30 * 60 * 1000;
  → 30-minute total deadline for entire chat session

Line 54-57: const BROWSER_STATE_CHANGERS = new Set([...]);
  → Tools that modify page state (navigate, click, type, select, etc.)
  → Capped at 2 per native tool call batch

Line 58-62: const DATA_GATHER_TOOLS = new Set([...]);
  → Tools that extract data (navigate, snapshot, click, web_search, etc.)
  → Used to detect write deferral scenarios

Line 63: const DATA_WRITE_TOOLS = new Set(['write_file', 'edit_file']);
  → Tools that create/modify files
  → Deferred when gather+write mixed in native tool calls
```

---

### 4. EXPORTED FUNCTIONS & CLASSES

#### PRIMARY EXPORT: `register(ctx)` (Line 161)
**Purpose:** Main entry point that sets up IPC handlers and agentic loop  
**Parameters:**
- `ctx` (object): Application context containing:
  - `llmEngine`: Local LLM inference engine
  - `cloudLLM`: Cloud provider manager
  - `mcpToolServer`: Tool execution server
  - `playwrightBrowser`: Playwright browser instance
  - `browserManager`: Additional browser automation
  - `ragEngine`: Codebase RAG search
  - `memoryStore`: Conversation memory
  - `webSearch`: Web search tool
  - `licenseManager`: License/quota tracking
  - `ConversationSummarizer`: Summary generation class
  - `DEFAULT_SYSTEM_PREAMBLE`: Full system prompt
  - `DEFAULT_COMPACT_PREAMBLE`: Compact system prompt
  - `_truncateResult`: Result truncation function
  - `_readConfig`: Config reader function
  - `getMainWindow()`: Main window getter
  - Other infrastructure utilities

**Return Value:** void (registers IPC handlers as side effect)

**Internal State Variables (Session-level):**
```javascript
Line 164: let _sessionTokensUsed = 0;
  → Cumulative token counter for current session

Line 165: let _sessionRequestCount = 0;
  → Number of AI requests in session

Line 166: let _instructionCache = null;
  → Cached project instructions from .guide-instructions.md

Line 167: let _instructionCacheProject = null;
  → Project path for cache validation

Line 168: let _activeRequestId = 0;
  → Unique ID for cancellation tracking

Line 169: let _isPaused = false;
  → Pause state for agent

Line 170: let _pauseResolve = null;
  → Resolver for pause/resume synchronization
```

---

### 5. INTERNAL FUNCTIONS (Nested in register)

#### `_reportTokenStats(tokensUsed, mainWindow)` (Line 172)
**Purpose:** Track and broadcast token usage statistics  
**Parameters:**
- `tokensUsed` (number): Tokens used in current request
- `mainWindow` (Electron BrowserWindow): Renderer window

**Logic:**
1. Increments `_sessionTokensUsed` by `tokensUsed`
2. Increments `_sessionRequestCount`
3. Sends 'token-stats' IPC event with:
   - `sessionTokens`: Total session tokens
   - `requestCount`: Number of requests
   - `lastRequestTokens`: Latest request tokens

**Side Effects:** IPC send, state mutation

---

#### `waitWhilePaused()` (Line 181)
**Purpose:** Blocking pause mechanism for agent control  
**Returns:** Promise that resolves when unpaused

**Logic:**
1. Busy-waits while `_isPaused` is true
2. Creates promise that resolves only when `_pauseResolve` is called
3. Prevents agentic loop from progressing while paused

**Race Condition Risk:** If `_pauseResolve` is never called, promise hangs forever

---

#### IPC Handler: `'agent-pause'` (Line 190)
**Entry Point:** Line 190  
**Purpose:** Pause the agentic agent  
**Returns:** `{ success: true, paused: true }`

**Side Effects:**
- Sets `_isPaused = true`
- Sends 'agent-paused' event to renderer
- Does NOT interrupt active generation — pauses at next loop iteration

---

#### IPC Handler: `'agent-resume'` (Line 203)
**Entry Point:** Line 203  
**Purpose:** Resume paused agent  
**Returns:** `{ success: true, paused: false }`

**Side Effects:**
- Sets `_isPaused = false`
- Calls any pending `_pauseResolve`
- Sends 'agent-paused' event to renderer

---

#### IPC Handler: `'ai-chat'` (Line 216)
**Entry Point:** Line 216  
**Parameters:**
- `message` (string): User prompt
- `context` (object):
  - `maxIterations`: Max agentic loop iterations
  - `autoMode`: Auto-select cloud provider
  - `cloudProvider`: Explicit cloud provider
  - `cloudModel`: Explicit model
  - `params`: Generation params (maxTokens, temperature)
  - `currentFile`: Currently open file content
  - `selectedCode`: Selected code text
  - `webSearch`: Web search query
  - `projectPath`: Project root
  - `conversationHistory`: Prior conversation turns
  - `images`: Image attachments

**Returns:** Promise<result>
```javascript
{
  success: true|false,
  error?: string,
  text?: string,           // Response text
  model?: string,          // Model used
  tokensUsed?: number,     // Tokens consumed
  toolResults?: array,     // Tool results (local only)
  iterations?: number      // Loop iterations (local)
}
```

**Core Logic Flow:**
1. **Request Cancellation (Lines 239-246):**
   - Increments `_activeRequestId`
   - Cancels previous LLM generation
   - Waits 50ms for cleanup
   - Sets `ctx.agenticCancelled` flag

2. **Stale Check Function (Line 248):**
   - Returns true if newer request exists OR cancellation flag set
   - Used throughout loop to check if request is superseded

3. **Auto Mode Cloud Selection (Lines 251-264):**
   - If `context.autoMode` enabled, calls `selectCloudProvider()`
   - Falls back to local if no cloud providers available

4. **Cloud vs Local Routing (Lines 266-277):**
   - Calls `handleCloudChat()` if cloud provider specified
   - Calls `handleLocalChat()` if local LLM

---

#### IPC Handler: `'find-bug'` (Line 283)
**Entry Point:** Line 283  
**Parameters:**
- `errorMessage` (string): Error description
- `stackTrace` (string): Stack trace
- `projectPath` (string): Project root

**Returns:** Promise<result>
```javascript
{
  success: true|false,
  error?: string,
  text?: string,              // Analysis
  errorContext?: object,      // Related code chunks
  model?: string              // Model used
}
```

**Logic:**
1. Indexes project if not cached via RAG engine
2. Searches for similar past errors in memory
3. Retrieves related code files
4. Generates analysis prompt combining all context
5. Calls LLM with 0.3 temperature (deterministic)
6. Records error in memory store for future reference

**Issues:**
- **No Tool Availability Check:** Could fail if tools unavailable
- **No Timeout:** Could stall indefinitely

---

#### Function: `selectCloudProvider()` (Line 3693)
**Entry Point:** Line 3693  
**Parameters:**
- `cloudLLM`: Cloud LLM manager
- `message`: User message
- `context`: Generation context

**Returns:** `{ provider: string, model: string }` or `null`

**Logic:**
1. Gets configured providers from `cloudLLM`
2. Returns null if no providers configured
3. Prioritizes by capability:
   - Images present → google/openai/anthropic (preferred)
   - Default priority: groq > cerebras > google > anthropic > openai

**Edge Cases:**
- No providers configured → returns null (falls back to local)
- Multiple providers → always picks first in priority order (not load-balanced)

---

### 6. MAJOR EMBEDDED FUNCTION: `handleCloudChat()` (Line 308)

**Entry Point:** Line 308  
**Purpose:** Agentic chat loop for cloud providers  
**Parameters:** ctx, message, context, helpers

**Key Variables:**
```javascript
Line 319: const cloudTokenBatcher = createIpcTokenBatcher(...)
  → Batches tokens for smooth rendering

Line 321: let fullPrompt = message;
  → Accumulating user message

Line 324-329: File context injection
  → Adds current file and selected code to prompt

Line 331-341: Web search integration
  → Fetches web search results if enabled

Line 343: const systemPrompt = llmEngine._getSystemPrompt();
  → System preamble

Line 344: const toolPrompt = mcpToolServer.getToolPromptForTask('general');
  → Tool definitions for cloud model

Line 346: const isBundledCloudProvider = ...
  → Checks if using guIDE's bundled cloud (not user's own key)

Line 348-360: Quota tracking (free-tier only)
  → Tracks daily CloudLLM usage against 20/day limit
  → Persists to `.bundled-daily-usage.json`

Line 373: const MAX_CLOUD_ITERATIONS = 500;
  → Cloud gets higher iteration limit than local

Line 375-387: Agentic loop initialization
  → Initializes conversation summarizer
  → Auto-creates todos for large incremental tasks
  → Sets up execution state tracker
```

**Main Loop (Line 390-579):**

**Iteration 1-N:**
1. **Pacing (Lines 408-410):**
   - Adds proactive delay between cloud iterations
   - Respects provider-specific rate limits

2. **Generation (Lines 415-441):**
   - Calls `cloudLLM.generate()` with streaming
   - Accumulates response text
   - Samples thinking tokens separately (if supported)

3. **Response Processing (Lines 443-459):**
   - Strips tool call artifacts from display text
   - Records planning text in summarizer
   - Extracts and routes plan text to thinking panel

4. **Tool Parsing (Lines 461-467):**
   - Calls `mcpToolServer.processResponse()`
   - Handles tool call extraction (both JSON and text)

5. **Tool Execution (Lines 469-549):**
   - Iterates through tool results
   - Executes each tool
   - Updates execution state
   - Sends tool execution events to UI
   - Updates todos if applicable

6. **Stuck Detection (Line 551):**
   - Calls `detectStuckCycle()` with tool call history
   - Breaks if stuck detected

7. **Context Management (Lines 553-594):**
   - **Pruning:** Removes verbose old messages from history
   - **Rotation:** Hard-resets history with summary if > 30K tokens
   - Rebuilds prompt for next iteration

8. **Continuation Prompt (Line 596):**
   - Formats tool results feedback
   - Builds directive for next iteration
   - Updates `currentCloudPrompt`

**Loop Exit Conditions:**
- `isStale()` returns true
- Deadline exceeded (30 min)
- No tool calls after tool parsing
- Stuck/cycle detected

**Post-Loop (Lines 602-638):**
1. Cleans response text (strips JSON tool calls)
2. Calculates context usage
3. Reports token stats
4. Returns result

**CRITICAL ISSUES:**
- **No Context Overflow Handling:** Cloud provider could error on large context
- **No Timeout on Web Search:** Could stall
- **Unbounded History Growth:** Without rotation enforcement, history grows indefinitely
- **Tool Deduplication Only Current:** Doesn't prevent repeated file writes across different iterations

---

### 7. MAJOR EMBEDDED FUNCTION: `handleLocalChat()` (Line 641)

**Entry Point:** Line 641  
**Complexity:** 3,400+ lines (the core of guIDE's sophistication)  
**Purpose:** Local LLM agentic loop with context management, continuation, rotation, and complex state tracking

**Architecture Layers:**

**Layer 1: Model & Context Setup (Lines 658-722)**
```javascript
// Wait for model readiness
while (!llmEngine.isReady && Date.now() < readyTimeout) { await delay(500); }

// Get hardware context size
const hwContextSize = modelStatus.modelInfo?.contextSize || 32768;

// Calculate effective context with reserves
const totalCtx = Math.min(hwContextSize, modelProfile.context.effectiveContextSize);
const sysPromptReserve = estimateTokens(actualSystemPrompt) + 50 + toolSchemaTokenEstimate;

// Guard: if system prompt too large, fall back to compact
if (sysPromptReserve >= totalCtx * 0.9) {
  // Try compact preamble
  // If still fails, error out
}
```

**Key Context Budget Calculations (Lines 697-711):**
```javascript
const totalCtx = Math.min(hwContextSize, modelProfile.context.effectiveContextSize);
const maxResponseTokens = Math.min(
  Math.floor(totalCtx * modelProfile.context.responseReservePct),
  modelProfile.context.maxResponseTokens
);
const maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);
```

**Layer 2: Prompt Builders (Lines 725-892)**

**Function: `buildStaticPrompt(taskType)` (Line 727)**
- Caches system prompt (preamble, tools, project instructions, memory)
- Task-aware prompt selection (compact vs full)
- Includes project instructions from `.guide-instructions.md`, `.prompt.md`, etc.
- Injects long-term memory (8% of remaining budget)

**Function: `buildDynamicContext(budgetOverride)` (Line 827)**
- Builds user-specific context (error context, RAG, current file, selected code, custom instructions)
- Budget-aware: respects token limits
- Non-cached (rebuilt each iteration)

**Layer 3: Agentic Loop Initialization (Lines 895-943)**

**Summarizers & State:**
```javascript
const summarizer = new ConversationSummarizer();  // Plan tracking
const rollingSummary = new RollingSummary();     // Multi-rotation state
const longTermMemory = new LongTermMemory();     // Cross-session facts
const sessionStore = new SessionStore();         // Crash recovery
```

**Crash Recovery (Lines 920-938):**
```javascript
const recovered = sessionStore.initialize(sessionId);
if (!recovered) {
  const recoverable = SessionStore.findRecoverableSession(sessionBasePath);
  if (recoverable?.hasRollingSummary) {
    // Restore from crash
    const recoveredSummary = sessionStore.loadRollingSummary(RollingSummary);
    rollingSummary._completedWork = recoveredSummary._completedWork;
    rollingSummary._rotationCount = recoveredSummary._rotationCount;
    // ... merge state
  }
}
```

**Layer 4: Main Agentic Loop (Lines 968-2850)**

**Per-Iteration Procedure:**

**Step 1: First-Turn Guard (Lines 1005-1007)**
- Detects if first-turn prompt exceeds context budget
- Calls `guardFirstTurnOverflow()` to reduce context if needed

**Step 2: Pre-Generation Context Check (Lines 1010-1041)**
- **Purpose:** Proactive rotation before generation
- Checks if context usage > 60%
- Runs `progressiveContextCompaction()`
- If rotation needed, rebuilds prompt with summary before generating
- **Reason:** Prevents generation from failing mid-stream

**Step 3: Native Functions vs Text Mode (Lines 1050-1070)**
- Decides whether to use native function calling (grammar) or text parsing
- Native functions used until `grammarIterLimit` (2-5 iterations depending on model tier)
- Falls back to text after grammar disabled due to empty grammar retries

**Step 4: Transactional Checkpoint (Lines 1072-1086)**
- Saves chat history state for rollback if response bad
- Used if response evaluation returns ROLLBACK verdict

**Step 5: Generation (Lines 1088-1148)**
- **Native Function Path:** Calls `llmEngine.generateWithFunctions()`
- **Text Mode Path:** Calls `llmEngine.generateStream()`
- Streaming tokens to IPC batcher
- Separate thinking token channel
- Live tool-call bubble rendering (detects JSON object, shows preview)
- Context usage updates every 500ms

**Step 6: Error Handling (Lines 1150-1310)**
- **Context Overflow:** (Lines 1165-1259)
  - First-turn + continuation overflow → reduce response budget, retry
  - First-turn only → error with message "context too small"
  - Normal rotation → generates summary, resets session, continues
- **Fatal Errors:** (Lines 1280-1294)
  - Model disposed, object disposed, model not loaded
  - Breaks loop
- **Non-Context Errors:** (Lines 1296-1310)
  - Retries up to 3 times
  - Then breaks

**Step 7: Response Evaluation (Lines 1352-1366)**
- Calls `evaluateResponse()` to check for ROLLBACK conditions
- Rollback verdict → reverts checkpoint, reduces grammar iteration limit
- After 3 rollbacks → forces native functions
- Commit verdict → clears rollback counter

**Step 8: Overlap Deduplication (Lines 1368-1383)**
- **Purpose:** Remove content model repeated from continuation context tail
- Detects if response starts with tail of previous content
- Saves repeat removal count to prevent duplicate in display pipeline

**Step 9: Seamless Continuation Detection (Lines 1385-1424)**
- **Purpose:** Stitch truncated content with continuation response for MCP tool parsing
- Checks for unclosed ``` fences (indicates truncation)
- **Fence deduplication:** Removes duplicate fence opens when stitching

**Step 10: Truncation Check (Lines 1426-1650)**
```javascript
const _wasTruncated = (
  (result?.stopReason === 'maxTokens' || result?.stopReason === 'max-tokens') ||
  _hasUnclosedToolFence
) && nativeFunctionCalls.length === 0 && !_timedOut && !isStale();
```

**If Truncated & Context Budget Allows (Lines 1433-1589):**
1. **Context Budget Check:** If context usage > 92% → trigger rotation instead of continuation
2. **Forward Progress Scoring:**
   - Track output size per pass (`_contCharSizes`)
   - Stop if `_contLowProgressCount >= 3` (< 20 chars/pass)
   - Stop if `_contRepeatCount >= 2` (identical content)
   - Stop if uniform output (5+ passes, <10% variance)

3. **Content-Overlap Detection (Lines 1515-1539):**
   - **Purpose:** Detect model repeating chapter bodies (common bug)
   - Samples 8 chunks from response, checks if >75% appear in prior output
   - If match ratio high, flags as stuck
   - File content uses higher threshold (0.75) vs. normal (0.60)

4. **Continuations Abort & Rotation (Lines 1550-1589):**
   - **Reason:** Large files (> 500K chars) need rotation to complete
   - Generates summary with file progress hints
   - Explicit append filename directive: "CONTINUE WRITING TO: {filename}"
   - Non-negotiable directive: "CRITICAL: DO NOT REFUSE"
   - Stores partial output for context
   - Builds continuation prompt with rolling summary

**If Truncated & Can Continue (Lines 1591-1671):**
1. **Continuation Prompt Build (Lines 1616-1671):**
   - Task hint: first 100 chars of original message
   - Written-files manifest: prevents duplicate writes
   - Dynamic tail size: 500-3000 chars scaled to remaining context
   - **Unclosed fence case:** "Continue tool call JSON from where it was cut"
   - **Normal case:** "Continue your response where you left off"

2. **Iteration Decrement (Line 1595):**
   - Critical for seamless continuation: doesn't count as separate iteration
   - Allows single logical task to span multiple generations

**Step 11: Response Combination (Lines 1674-1720)**
- Concatenates response to `fullResponseText`
- Strips tool call markers from display text
- Saves display length before adding iteration (for bug 2 fix)

**Step 12: Progressive Context Compaction (Lines 1757-1786)**
- Runs 4-phase compaction based on context usage %:
  - Phase 1 (45-60%): Compress old tool results
  - Phase 2 (60-75%): Prune verbose chat history
  - Phase 3 (75-85%): Aggressive compression
  - Phase 4 (>85%): Proactive rotation
- Rotation raised from 72% to 85% (was too aggressive before)

**Step 13: Tool Call Processing (Lines 1788-1877)**
- **Native Path:** Calls `executeNativeToolCalls()`
  - Repairs malformed tool calls
  - Deduplicates
  - Caps browser state changers (2 per batch)
  - Applies write deferral (when gather + write mixed)
- **Text Path:** Calls `mcpToolServer.processResponse()`
  - Skips write deferral on tiny models
  - Passes user message, write history for deduplication
- **Cross-turn Dedup:** Blocks duplicate tool calls based on tool name + params

**Step 14: Tool Execution Events (Lines 1879-1931)**
- Routes planning text to thinking panel (thinking models only)
- Wipes planning text from stream buffer after routing
- Sends tool results to UI
- Records tool calls in summarizer and rolling summary
- Notifies long-term memory if memory saved

**Step 15: Code-Dump Nudge (Lines 1933-1995)**
- **Purpose:** When model outputs code instead of using write_file
- **Triggers:**
  1. Large code blocks (>500 chars) in ``` fences
  2. Unclosed code fences (model hit maxTokens)
  3. Raw HTML/CSS/JS dumps without fences (>1500 chars, full document structure)
- **Recovery:** Wipes response, resets session, adds system directive
- **Guard:** Skips nudge if context critically small (<4096 tokens)

**Step 16: Stuck/Cycle Detection (Line 1951)**
- Calls `detectStuckCycle()` with tool call history
- Breaks loop if stuck detected

**Step 17: Context Assembly (Lines 2010-2047)**
- **Budget-Aware Tiered Context (Phase 2):**
  - Calculates available token budget for context
  - HOT tier: Current iteration results (full fidelity)
  - WARM tier: Recent iterations (compressed)
  - COLD tier: Old iterations (bullet points only)
  - Uses `rollingSummary.assembleTieredContext()`

**Step 18: Next Iteration Prompt Build (Lines 2049-2070)**
- **If just rotated:**
  - Includes last rotation summary
  - Adds task reminder + step directive
  - Incremental progress hints
- **Otherwise:**
  - Includes assembled context
  - Task reminder
  - Execution state summary

---

### 8. POST-LOOP PROCESSING (Lines 2854-2950)

**Auto-Summarization (Lines 2854-2871):**
- If tools were used and iterations >= 2, generates brief summary
- Uses 0.3 temperature (deterministic)
- Caps at 512 tokens

**Long-Term Memory Extraction (Lines 2873-2876):**
- Calls `longTermMemory.extractAndSave()`
- Saves cross-session relevant facts

**Session Cleanup (Lines 2878-2881):**
- Flushes session store to disk

**Response Cleaning (Lines 2883-2925):**
- Strips thinking tags
- Removes inline JSON tool calls (with proper brace matching)
- Removes triple newlines
- **Brace Matching Algorithm (Lines 2907-2919):**
  ```javascript
  for (let tm of toolPattern.matches) {
    let braceStart = indexOf('{');
    let depth = 1;
    for (let i = braceStart + 1; i < end; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      if (depth === 0) { endPos = i + 1; break; }
    }
  }
  ```

**Final Return (Lines 2927-2936):**
```javascript
return {
  success: true,
  text: cleanResponse,
  model: modelStatus.modelInfo?.name || 'local',
  tokensUsed: localTokensUsed,
  toolResults: allToolResults.length > 0 ? allToolResults : undefined,
  iterations: iteration,
};
```

---

### 9. HELPER FUNCTIONS (Outside handleLocalChat)

#### `guardFirstTurnOverflow()` (Line 2968)
**Purpose:** Detect and mitigate first-turn prompt overflow  
**Returns:** Modified currentPrompt

**Steps:**
1. **Check headroom:** If > 15% context available, return unchanged
2. **Step 1:** Reduce dynamic context to 10% budget, keep rest
3. **Step 2:** Remove all dynamic context
4. **Step 3:** Use minimal tool hint instead of full tool prompt
5. Each step recalculates tokens

**Issue:** Doesn't handle case where even minimal prompt exceeds context

---

#### `preGenerationContextCheck()` (Line 3018)
**Purpose:** Proactive rotation before generation  
**Returns:** 
```javascript
{
  shouldContinue: true|false,
  prompt: {...},
  rotated: true|false,
  summary: string,
  clearContinuation?: boolean
}
```

**Logic:**
1. Gets current context usage %
2. If <= 60%, returns null (no action needed)
3. If > 60%, runs `progressiveContextCompaction()`
4. If compaction says don't rotate, returns null
5. **Continuation rotation special handling:**
   - If in middle of continuation, clears full response
   - Builds continuation prompt with summary
6. **Normal rotation:** Includes context summary in prompt

---

#### `executeNativeToolCalls()` (Line 3086)
**Purpose:** Execute tool calls received from native function calling  
**Returns:**
```javascript
{
  hasToolCalls: boolean,
  results: [{ tool, params, result, _deferred? }],
  toolCalls: [...],
  capped: boolean,          // Browser cap hit?
  skippedToolCalls: number
}
```

**Steps:**
1. **Normalize:** Convert functionName → tool
2. **Repair:** Call `repairToolCallsFn()`
3. **Deduplication:** Remove duplicate tool calls
4. **Browser capping:** Cap state-changing browser tools to 2
5. **Write deferral:** Defer write tools if gather+write mixed
6. **Execution:** Execute each tool via `mcpToolServer.executeTool()`
7. **Write history tracking:** Track write_file calls for regression detection

---

#### `detectStuckCycle()` (Line 3149)
**Purpose:** Detect stuck loops and cyclic tool patterns  
**Returns:** boolean

**Logic:**
1. **Hash track:** Tracks last 20 tool calls with param hashing
2. **Stuck detection:** If last N tools identical (N=8 for batch tools, 5 for others)
3. **Cycle detection:** Looks for 2-4 tool cycles repeating 3+ times

**Algorithm:**
```javascript
for (cycleLen = 2 to 4) {
  if (last cycleLen tools repeat 3+ times historically) {
    break with cycle detected
  }
}
```

**Issue:** Param hashing uses first 400 chars — could hide differences in large params

---

#### `salvagePartialToolCall()` (Line 3190)
**Purpose:** Extract partial write_file call from truncated output  
**Returns:** JSON string of salvaged tool call or null

**Steps:**
1. Regex extract filePath
2. Regex extract content (starting after "content")
3. Verify content > 20 chars
4. Unescape JSON string literals (\n → newline, \" → ")
5. Rebuild tool call JSON

**Issue:** Content extraction by index is fragile if JSON is malformed

---

#### `ensureLlmChat()` (Line 3220)
**Purpose:** Restore chat session after KV cache reset  
**Returns:** Promise that resolves when ready

**Steps:**
1. Return early if chat exists
2. Create context from model
3. Get LlamaChat class
4. Create sequence and chat
5. Initialize chat history with system prompt

**Issue:** Synchronous imports on async function could fail

---

### 10. CRITICAL ISSUES, BUGS & EDGE CASES

#### SEVERITY 1: CRITICAL

**Issue 1.1: Context Overflow Silent Failure (Line 1165-1259)**
- **Symptom:** Generation halts mid-task with partial response
- **Root:** When context near full, generation fails
- **Current Fix:** Catches error, triggers rotation or reduces budget
- **Problem:** Rotation summary itself can overflow context
- **Impact:** Large tasks (>100K chars) may fail to complete
- **Test Case:** Request to write 50,000 line file in 8K context model

**Issue 1.2: Continuation Overlap Detection Race (Line 1368-1414)**
- **Symptom:** Content duplicated at continuation seams
- **Cause:** Overlap detected but stitching still includes full response
- **Current Fix:** Removes overlap from response BEFORE accumulation
- **Remaining Race:** Display text might still show overlap from prior iterations
- **Impact:** Users see repeated paragraphs/code blocks

**Issue 1.3: Tool Execution Order During Deferred Writes (Line 3113-3120)**
- **Symptom:** Write tool executes before results from gather tools consumed
- **Cause:** Write deferral designed but not enforced during native calls
- **Current: Skipped during native execution!** (Line 3120)
- **Impact:** Deferred writes always fail on native tool calls
- **Fix Needed:** Implement deferral queue return for next iteration

**Issue 1.4: Memory Growth Unbounded (Lines 1879-1897)**
- **Symptom:** Memory usage increases linearly with session length
- **Cause:** All tool results accumulated in `allToolResults` indefinitely
- **Mitigation:** `capArray(allToolResults, 50)` keeps only 50 results
- **Problem:** 50 results × 10KB each = 500KB minimum, grows per iteration
- **Better Fix:** Implement result compression earlier (Phase 1 at 45%, not 60%)

**Issue 1.5: Native Function Tool Repair Silent Failures (Line 3099)**
- **Symptom:** Tool calls don't execute, no error message
- **Cause:** `repairToolCallsFn()` could fail to parse, returns empty array
- **Current:** No error logging if repair produces empty list
- **Impact:** User thinks tool didn't get invoked, loop breaks silently

#### SEVERITY 2: HIGH

**Issue 2.1: Continuation Loop Infinite (Line 1432-1671)**
- **Symptom:** Generation continues forever, consuming all context
- **Cause:** Forward progress detection relies on 3 independent conditions (all triggering simultaneously required)
- **Specifics:**
  - `_contLowProgressCount >= 3` (< 20 chars/pass)
  - `_contRepeatCount >= 2` (>80% similar)
  - Uniform output pattern detection
- **Problem:** Model that outputs low-value content (whitespace, repetition) bypasses all 3
- **Impact:** Session hangs for 30 minutes (deadline)
- **Test:** Model outputting "\n" or same word repeatedly should trigger abort earlier

**Issue 2.2: Context Rotation Summary Too Large (Line 1261-1281)**
- **Symptom:** Rotation fails: "CONTEXT_OVERFLOW on rotation summary generation"
- **Cause:** Summary generation doesn't respect token budget
- **Current:** Requests `Math.min(Math.floor(totalCtx * 0.25), 3000)` tokens
- **Problem:** On 8K context, this is 2000 tokens already used (25% of 8K)
- **Impact:** Rotation fails, task aborts
- **Better:** Set absolute max of 1000 tokens for summary

**Issue 2.3: Write File Regression Not Documented (Line 1897-1921)**
- **Symptom:** File written multiple times, each time smaller
- **Detection:** Lines 1905-1919 detect if file written > 3x AND shrinking
- **Problem:** Detection only in successful result display, not in actual tool execution
- **Impact:** File corruption silently proceeds, user doesn't see warning until 3rd write
- **Fix:** Block at tool execution time (write history check)

**Issue 2.4: Chat History Seeding Race Condition (Lines 925-940)**
- **Symptom:** Conversation history sometimes not included
- **Cause:** Seeding only happens if `llmEngine.chatHistory.length <= 1` (fresh session)
- **Race:** If model loads between chat setup and seeding, seeding skipped
- **Impact:** User's prior messages missing from context
- **Better:** Seed always, check if already seeded

**Issue 2.5: Browser Snapshot Timeout Hard-Coded (Line 3013)**
- **Code:** `await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {})`
- **Problem:** Always waits 2000ms, no exponential backoff
- **Impact:** 500KB+ websites hang for 2s per snapshot
- **Better:** Configurable or adaptive timeout

#### SEVERITY 3: MEDIUM

**Issue 3.1: Tool Params Hashing Fragile (Line 3169)**
- **Code:** `paramsHash = JSON.stringify(p).substring(0, 400)`
- **Problem:** Large content param truncated, different content looks identical
- **Example:** Two write_file calls with 500-char content look identical after substring
- **Better:** Hash first 200 chars + last 200 chars

**Issue 3.2: Web Search Integration No Error Handling (Line 331-341)**
- **Code:** `try { ... } catch (e) { console.log(...) }` but continues anyway
- **Impact:** If web search fails, user doesn't know; model has no data
- **Better:** Fallback message to model: "Web search unavailable"

**Issue 3.3: Long-Term Memory Silent Failure (Line 2874-2876)**
- **Code:** `try { longTermMemory.extractAndSave(...) } catch (e) { console.warn(...) }`
- **Impact:** Memory extraction fails silently, facts not saved for future sessions
- **Better:** Retry or queue for next session

**Issue 3.4: First-Turn Overflow Guard Missing Case (Line 2974-3009)**
- **Problem:** If even compact preamble doesn't fit, returns error
- **But:** Could detect this earlier and warn user BEFORE attempting generation
- **Impact:** User waits for full generation attempt before seeing error

**Issue 3.5: Continuation Prompt Tail Sizing (Line 1616-1650)**
- **Code:** `maxTailChars = Math.max(500, Math.min(Math.floor(remainingTokens * 0.3 * 4), 3000))`
- **Problem:** Dynamic tailoring depends on context estimation accuracy
- **If estimate wrong:** Continuation might fail
- **Better:** Conservative fixed tail (800 chars) for reliability

#### SEVERITY 4: LOW

**Issue 4.1: Cached Static Prompt May Stale (Line 856)**
- **Problem:** `_staticPromptCache` uses taskType as key, but project instructions could change
- **Impact:** Stale instructions until new taskType requested
- **Better:** Invalidate cache on config change event

**Issue 4.2: Unused Variable `writtenPaths` (Line 1631)**
- **Code:** `const writtenPaths = Object.keys(writeFileHistory).filter(...)`
- **Used for:** `fileManifest` string only during continuation
- **Problem:** Doesn't actually prevent model from re-writing (just informs)
- **Better:** Make fileManifest a warning to user too

**Issue 4.3: Token Estimation Consistently Underestimates (Throughout)**
- **Formula:** `estimateTokens(text) = Math.ceil(text.length / 4)`
- **Reality:** Actual tokenization varies (UTF-8, model-specific)
- **Impact:** Context budgets may be too aggressive
- **Better:** Sample actual tokenization periodically

**Issue 4.4: Session ID Includes Message Content (Line 908)**
- **Code:** `const sessionId = \`${Date.now()}_${message.substring(0, 30)}\``
- **Security:** Appends plaintext message to session directory
- **Impact:** Session IDs readable from file system
- **Better:** Use hash of message, not plaintext

---

### 11. RACE CONDITIONS & CONCURRENCY ISSUES

**Race 1: Multiple Requests Cancellation (Lines 239-246)**
- **Scenario:** User sends message 1, then message 2 while 1 still generating
- **Current:** Sets `_activeRequestId` counter, previous request checks `isStale()`
- **Race:** If both requests reach same tool execution point simultaneously:
  - Tool could execute twice from different requests
  - State mutations could conflict
- **Guard:** Each request cancels LLM, but tool execution is independent
- **Fix Needed:** Mutex on tool execution OR per-request tool result isolation

**Race 2: Pause/Resume Synchronization (Lines 190-213)**
- **Scenario:** User pauses, then resumes while generation mid-stream
- **Current:** `waitWhilePaused()` is blocking, only checks at loop points
- **Issue:** Generation streaming tokens could bypass pause check
- **Fix:** Token callback should check pause flag

**Race 3: IPC Destruction During Streaming (Various)**
- **Scenario:** User closes window during streaming
- **Current:** Each token send checks `!mainWindow.isDestroyed()`
- **Issue:** Window could be destroyed between check and send
- **Guard:** try-catch in batchers, but graceful degradation only
- **Better:** Reference count IPC sends

**Race 4: Session Store File Conflicts (Line 908)**
- **Scenario:** Two chat windows open simultaneously
- **Issue:** Both could write to same `sessionId` directory
- **Current:** Weak — uses timestamp + message substring, likely unique but not guaranteed
- **Fix:** Lock file or UUID-based session ID

---

### 12. CODE FLOW DIAGRAM

```
ai-chat IPC
├─ Check if auto-select cloud
├─ Cloud path?
│  ├─ handleCloudChat()
│  │  ├─ Setup (summarizer, execution state, todos)
│  │  ├─ Main loop (500 iterations max):
│  │  │  ├─ Rate limit
│  │  │  ├─ Generate (stream)
│  │  │  ├─ Parse tools
│  │  │  ├─ Execute tools (iterate)
│  │  │  ├─ Detect stuck
│  │  │  ├─ Prune history (>18K history)
│  │  │  ├─ Hard rotate (>30K history)
│  │  │  └─ Build next prompt
│  │  └─ Post-loop (clean, return)
│  └─ Return
└─ Local path?
   ├─ handleLocalChat()
   │  ├─ Model ready check
   │  ├─ Context budgeting
   │  ├─ Build static prompt (cached)
   │  ├─ Main loop (100 iterations max):
   │  │  ├─ First-turn overflow guard
   │  │  ├─ Pre-generation context check (rotate if needed)
   │  │  ├─ Decide grammar vs text mode
   │  │  ├─ Checkpoint state
   │  │  ├─ Generate (native functions OR stream)
   │  │  ├─ Error handling (overflow, fatal, retry)
   │  │  ├─ Evaluate response (COMMIT vs ROLLBACK)
   │  │  ├─ Dedup overlap
   │  │  ├─ Detect truncation → continuation?
   │  │  │  ├─ Budget check
   │  │  │  ├─ Forward progress check
   │  │  │  ├─ Content overlap check
   │  │  │  └─ Continuation prompt
   │  │  ├─ Combine response
   │  │  ├─ Context compaction (phases 1-4)
   │  │  ├─ Parse & execute tools
   │  │  ├─ Stuck detection
   │  │  ├─ Auto-snapshot
   │  │  ├─ Build tool feedback
   │  │  ├─ Code-dump nudge (if needed)
   │  │  └─ Build next prompt
   │  ├─ Post-loop (auto-summary, LTM, cleanup, return)
   │  └─ Return
   └─ Return
```

---

## FILE 2: main/agenticChatHelpers.js

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** Utility functions shared between cloud and local agentic loops. Non-core helpers that focus on specific concerns: tool execution events, context compression, response evaluation, error handling.

**Responsibilities:**
- Tool execution UI notifications
- Chat history compression
- Response verdict evaluation  
- Tool debugging hints
- Execution state tracking
- IPC token batching

---

### 2. IMPORTS & DEPENDENCIES

**No external imports** — functions are pure or operate on passed objects.

---

### 3. EXPORTED FUNCTIONS

#### `isNearDuplicate(a, b, threshold = 0.80)` (Line 10)
**Purpose:** Detect near-duplicate responses using word-level Jaccard similarity  
**Parameters:**
- `a` (string): First text
- `b` (string): Second text
- `threshold` (number): Minimum similarity (default 0.80 = 80%)

**Returns:** boolean

**Logic:**
1. Extract first 500 chars
2. Split by whitespace, lowercase, filter < 3 char words
3. Calculate Jaccard: intersection / union
4. Return true if >= threshold

**Issues:**
- Only checks first 500 chars (large responses truncated)
- Word-level detection misses character-level repetition

---

#### `autoSnapshotAfterBrowserAction()` (Line 21)
**Purpose:** Auto-capture page snapshot after browser interactions  
**Parameters:**
- `toolResults`: Array of executed tools
- `mcpToolServer`: Tool execution server
- `playwrightBrowser`: Playwright instance
- `browserManager`: Secondary browser manager

**Returns:** 
```javascript
{
  snapshotText: string,
  elementCount: number,
  triggerTool: string
} | null
```

**Logic:**
1. Check if browser action in results AND no prior snapshot
2. Get last browser action tool
3. If not a trigger tool (navigate, click, type, etc.) → return null
4. Get active browser instance
5. Wait for DOM content loaded (2s timeout) or settle (1.5s)
6. Call `getSnapshot()`
7. Truncate snapshot > 10K chars
8. Return snapshot with element count

**Issues:**
- Hard-coded timeouts (2000ms, 1500ms) — could stall on slow sites
- Only works if page implements getSnapshot()
- No retry on snapshot failure

---

#### `sendToolExecutionEvents()` (Line 50)
**Purpose:** Notify UI of tool execution events  
**Parameters:**
- `mainWindow`: Electron BrowserWindow
- `toolResults`: Array of tool results
- `playwrightBrowser`: For browser launch detection
- `opts`: Options object with `checkSuccess` flag

**Returns:** `{ filesChanged: boolean }`

**Logic:**
1. For each tool result:
   - Send 'tool-executing' event
   - If browser tool AND browser not launched → send 'show-browser'
   - If file operation AND success → upload files changed flag
   - If file write/append/edit → send 'open-file' event
2. If files changed, send 'files-changed' event

**Side Effects:** Multiple IPC sends

---

#### `capArray()` (Line 72)
**Purpose:** Trim array to maximum length, keeping most recent  
**Parameters:**
- `arr`: Array to trim
- `maxLen`: Maximum length

**Returns:** void (mutates array)

**Logic:** If `arr.length > maxLen`, removes first `(length - maxLen)` elements

---

#### `createIpcTokenBatcher()` (Line 79)
**Purpose:** Batch high-frequency token streams into fewer IPC messages  
**Parameters:**
- `mainWindow`: Electron BrowserWindow
- `channel`: IPC channel name
- `canSend`: Predicate function to check if still valid
- `opts`: Configuration:
  - `flushIntervalMs`: Batch timeout (default 25ms)
  - `maxBufferChars`: Max buffered chars before force-flush
  - `flushOnNewline`: Flush on \n character (default true)
  - `charsPerFlush`: Max chars per flush iteration

**Returns:**
```javascript
{
  push(token): void,
  flush(): void,
  dispose(): void
}
```

**Logic:**
1. **push():** Accumulate token, schedule flush if needed
2. **flush():** Send buffer to IPC, clear buffer
3. **dispose():** Final flush before cleanup

**Algorithm:**
```javascript
const push = (token) => {
  buffer += token;
  if (flushOnNewline && token.includes('\n')) { flush(); return; }
  if (!charsPerFlush && buffer.length >= maxBufferChars) { flush(); return; }
  scheduleFlush();
};

const flush = () => {
  if (charsPerFlush && buffer.length > charsPerFlush) {
    sendChunk(buffer.slice(0, charsPerFlush));
    buffer = buffer.slice(charsPerFlush);
    reschedule();
  } else {
    sendChunk(buffer);
    buffer = '';
  }
};
```

**Issues:**
- Multi-level scheduling could cause out-of-order sends with extreme buffer sizes
- No backpressure — if receiver slow, buffer grows indefinitely

---

#### `enrichErrorFeedback()` (Line 137)
**Purpose:** Provide actionable recovery hints for tool failures  
**Parameters:**
- `toolName`: Tool that failed
- `error`: Error message
- `failCounts`: Map of tool name → failure count

**Returns:** string (suggestion text or empty)

**Tips Provided by Tool:**
- `edit_file`: oldText not found → use read_file first
- `write_file`: empty → provide complete content
- File tools: not found → use find_files
- Browser tools: not found → use snapshot for ref
- Browser: timeout → try wait_for first
- Commands: not recognized → Windows PowerShell syntax

**Escalation:**
- If failCount >= 3, shows ESCALATION hint (alternative approach)

**Issues:**
- Escalation hints hard-coded, not tied to actual problem
- Could fail to help if error message format unexpected

---

#### `pruneVerboseHistory()` (Line 176)
**Purpose:** Compress chat history to free context space  
**Parameters:**
- `chatHistory`: Array of chat messages
- `keepRecentCount`: How many recent messages to preserve (default 6)

**Returns:** number of messages pruned

**Logic:**
1. Skip recent N messages (preserve verbatim)
2. For older messages (index 1 to cutoff):
   - If model response with large code blocks → compress ``` blocks
   - If user/system text > 800 chars → compress ``` and snapshots
   - If compressed < 70% original size, apply compression

**Compression Patterns:**
- Code blocks: `\`\`\`...actual content...\`\`\`` → `\`\`\`\n[X lines — pruned]\n\`\`\``
- Page snapshots: `**Page Snapshot**(...): ...` → `**Page Snapshot**: [pruned for context]`

**Issues:**
- Compression detection fragile (regex might miss malformed code blocks)
- Doesn't handle multiline backticks properly

---

#### `pruneCloudHistory()` (Line 224)
**Purpose:** Same as pruneVerboseHistory but for cloud provider format  
**Parameters:** Similar

**Returns:** number pruned

**Logic:** Same compression, but on `.content` field instead of `.text`

---

#### `evaluateResponse()` (Line 260)
**Purpose:** Determine if response should COMMIT or ROLLBACK  
**Parameters:**
- `responseText`: Generated response
- `functionCalls`: Native function calls (if any)
- `taskType`: Task domain
- `iteration`: Current iteration number

**Returns:**
```javascript
{
  verdict: 'COMMIT' | 'ROLLBACK',
  reason: string
}
```

**Logic:**
1. If native function calls present → COMMIT (has tool calls)
2. If text contains ``` tool call markup → COMMIT
3. If text < 15 chars (essentially empty) → ROLLBACK
4. Otherwise → COMMIT

**Issue:** Very lenient — almost everything commits

---

#### `getProgressiveTools()` (Line 289)
**Purpose:** Return filtered tool list based on model tier limits  
**Parameters:**
- `taskType`: Task domain (ignored)
- `iteration`: Current iteration
- `recentTools`: Tools used recently
- `maxTools`: Limit (1-40+)

**Returns:** Array of tool names (first maxTools from priority list)

**Priority Order:**
1. File ops (read, write, edit, list, etc.)
2. Code search (web_search, search_codebase, grep, find_files)
3. Browser tools (navigate, snapshot, click, type, scroll, etc.)
4. Task ops (todos)
5. Git ops
6. Other

**Issues:**
- Ignores `taskType` parameter entirely
- Doesn't adapt based on `recentTools` (could reduce tools model gets stuck on)

---

#### `classifyResponseFailure()` (Line 324)
**Purpose:** Classify and gate response failures  
**Parameters:**
- `responseText`: Response generated
- `hasToolCalls`: If tool calls present
- `taskType`: Task domain
- `iteration`: Iteration number
- `originalMessage`: User message
- `lastResponse`: Previous iteration response
- `options`: Additional context

**Returns:**
```javascript
{
  type: string,
  severity: 'stop' | 'warn',
  recovery: { action, prompt }
} | null
```

**Failure Classification:**
1. If tool calls present → no failure
2. If last response AND near-duplicate (>80% overlap) → REPETITION failure (STOP)

**Issues:**
- Only detects one failure type (repetition)
- Doesn't catch other failures (empty, hallucination, refusal)

---

#### `progressiveContextCompaction()` (Line 351)
**Purpose:** Multi-phase context cleanup based on usage %  
**Parameters:**
- `contextUsedTokens`: Tokens currently used
- `totalContextTokens`: Total context size
- `allToolResults`: Accumulated tool results
- `chatHistory`: Chat history
- `fullResponseText`: Accumulated response

**Returns:**
```javascript
{
  phase: 0-4,
  pruned: number,
  newFullResponseText: string,
  shouldRotate: boolean
}
```

**4-Phase Model:**

**Phase 1 (45-60%):**
- Compress old tool results (keep recent 4 only)
- Result compression: full → `{ _pruned: true, tool, status, snippet }`

**Phase 2 (60-75%):**
- Prune verbose chat history (keep 6 recent)
- Remove large code blocks in old messages

**Phase 3 (75-85%):**
- Aggressive: ALL results except 2 most recent become `{ _pruned, tool, status }`
- Trim response text to last 15K chars
- Very aggressive history pruning (keep 2 messages)

**Phase 4 (>85%):**
- Force rotation (shouldRotate = true)

**Issues:**
- Threshold at 85% was raised from 72% per comment (why 72% was wrong not explained)
- Response text trimming loses context (last 15K chars might be mid-sentence)

---

#### `buildToolFeedback()` (Line 406)
**Purpose:** Format tool result into human-readable feedback  
**Parameters:**
- `toolResults`: Array of executed tools
- `opts`: Config with truncateResult, totalCtx, allToolResults, writeFileHistory, currentIterationStart

**Returns:** string

**Per-Tool Formatting:**

- **read_file:** File path + first 2K chars
- **write_file/append_to_file:** File path + byte count + "new/updated" + completion guidance
  - Regression detection: if file written 3+ times AND shrinking → WARNING
- **edit_file:** Replacement count
- **list_directory:** File list
- **run_command:** Exit code + first 2K output
- **web_search:** Query + 5 results with snippets (includes date)
- **fetch_webpage:** Title + URL + first 3K content
- **search_codebase:** Match count + 5 top results
- **find_files:** Count + first 20 file paths
- **browser_navigate:** URL + title + page text
- **browser_snapshot:** Element count + max 4-12K snapshot (context-aware)
- **browser_click/type:** Element ref + text typed
- **browser_screenshot:** Dimensions
- **git_status:** Branch + changed files count
- **git_diff:** First 2K diff
- **default:** Generic result message

**Issues:**
- Hardcoded truncation lengths (2K, 3K, 6K) not context-aware
- No formatting escape for special chars in feedback

---

#### `formatSuccessfulToolResult()` (Line 479)
**Purpose:** Helper to format individual successful tool result  
**Parameters:** Similar to buildToolFeedback

**Returns:** string

**[See per-tool formatting above in buildToolFeedback]**

---

#### Class: `ExecutionState` (Line 606)
**Purpose:** Ground-truth tracker of what actually happened during execution  

**Constructors:**
```javascript
constructor() {
  this.urlsVisited = [];
  this.filesCreated = [];
  this.filesEdited = [];
  this.dataExtracted = [];
  this.searchesPerformed = [];
  this.domainsBlocked = new Set();
  this._domainAttempts = {};
}
```

**Methods:**

**`update(toolName, params, result, iteration)`:**
- Track URLs visited (with success/failure)
- Track domain access attempts (for bot detection)
- Track file creates/edits
- Track data extractions
- Track searches

**`getSummary()`:**
- Returns multi-line string with execution summary
- Lists recent URLs, files, blocked domains

**`checkDomainLimit(url)`:**
- Returns error message if domain blocked or attempted 4+ times

**Issues:**
- Domain tracking only on navigate, misses fetch_webpage attempts
- No persistent storage (lost between rotations)

---

### 4. CONSTANTS & CONFIGURATION

No constants defined in helpers (all in agenticChat.js main loop).

---

### 5. POTENTIAL ISSUES & BUGS

#### Issue H1: Token Batcher Starvation (Line 79)
- **Scenario:** If token frequency very low, timer could fire repeatedly with no data
- **Impact:** CPU waste
- **Fix:** Clear timer when buffer empty

#### Issue H2: Response Evaluation Too Lenient (Line 260)
- **Issue:** Only retries on < 15 char responses
- **Impact:** Bad responses (hallucinations, refusals) get COMMITTED
- **Better:** Add keyword detection for common refusals

#### Issue H3: Tool Result Compression Loses Information (Line 386)
- **Scenario:** File result compressed to status + 200 char snippet
- **Problem:** Model can't see actual file content for verification
- **Impact:** Model might re-create file incorrectly
- **Better:** Keep full content for recent 2 results only

#### Issue H4: Snapshot Truncation Silent (Line 541)
- **Code:** If snapshot > 10K, silently truncate
- **Problem:** Model doesn't know snapshot was truncated
- **Better:** Add marker: `... (snapshot truncated, continue with browser_evaluate if needed)`

#### Issue H5: Progressive Compaction Order (Line 351-397)
- **Sequence:** Tool results → history → response text
- **Problem:** Response text trimmed last; if it was very large, phases 1-2 don't help enough
- **Better:** Trim response text earlier

---

### 6. CODE FLOW

The helpers are all utility/support functions with NO interdependencies. Each is independently called from agenticChat.js main loop.

**Typical Call Sequence:**
1. Generation completes
2. `evaluateResponse()` decides COMMIT/ROLLBACK
3. `progressiveContextCompaction()` cleans history
4. `buildToolFeedback()` formats results
5. `autoSnapshotAfterBrowserAction()` captures page
6. `sendToolExecutionEvents()` notifies UI
7. `ExecutionState.update()` tracks what happened

---

## CROSS-FILE DEPENDENCIES & DATA FLOW

```
User Message
    ↓
ai-chat IPC handler (agenticChat.js:216)
    ↓
├─ Cloud path (326):
│      cloudLLM.generate()
│         ↓ streaming
│      sendToolExecutionEvents() [helpers]
│      mcpToolServer.processResponse()
│      buildToolFeedback() [helpers]
│      autoSnapshotAfterBrowserAction() [helpers]
│      → loop
│
└─ Local path (641):
       llmEngine.generateStream() OR generateWithFunctions()
          ↓ streaming
       createIpcTokenBatcher() [helpers]
       evaluateResponse() [helpers] → COMMIT/ROLLBACK
       buildStaticPrompt() (cached)
       buildDynamicContext()
       progressiveContextCompaction() [helpers]
       mcpToolServer.processResponse() OR executeNativeToolCalls()
       buildToolFeedback() [helpers]
       sendToolExecutionEvents() [helpers]
       ExecutionState.update() [helpers]
       → loop
```

---

## AUDIT CONCLUSION

### Code Quality Assessment

**Strengths:**
1. ✅ Modular architecture with clear separation (cloud vs local)
2. ✅ Sophisticated context management (4-phase compaction, rotation detection)
3. ✅ Extensive state persistence (SessionStore, RollingSummary, LongTermMemory)
4. ✅ Graceful degradation (fallback to compact preamble, token batching)
5. ✅ Rich tool integration (native functions + text parsing + repair)
6. ✅ Good use of helpers for code reuse

**Weaknesses:**
1. ❌ Extremely high cyclomatic complexity (handleLocalChat > 3400 lines)
2. ❌ Multiple race conditions (request cancellation, pause/resume, state mutation)
3. ❌ Silent failures throughout (web search, memory extraction, snapshots, repairs)
4. ❌ Hard-coded magic numbers (timeouts, thresholds, buffer sizes)
5. ❌ Inadequate error handling (many try-catch that console.log and continue)
6. ❌ Token estimation crude (simple /4 formula underestimates)
7. ❌ Context budget calculations error-prone (multiple fallback paths)

### Recommendations for Refactoring

1. **Split handleLocalChat into multiple functions** (1000 lines each max)
2. **Implement explicit state machine** instead of loop flags
3. **Add comprehensive logging** for context decision points
4. **Implement backpressure** in token batching
5. **Add timeout guards** on all external operations (snapshots, web search, tool calls)
6. **Introduce typed result objects** (ExecutionResult, ToolResult, etc.)
7. **Move magic constants to configuration** objects
8. **Add instrumentation** for context usage tracking
9. **Implement proper queuing** for deferred writes
10. **Add retry logic** with exponential backoff for cloud calls

---

**Audit Complete**

---

# PART 3 — CONTEXT MANAGEMENT & SESSION STATE

I've read all 5 files completely. Here's the comprehensive audit document:

---

# DETAILED CODEBASE AUDIT: Context Management & Session State

## FILE 1: `rollingSummary.js`

**File Purpose**: Continuous session state tracker for rapid context management. Updates every iteration with tool calls and produces budget-proportional summaries for injection into prompts. Zero LLM cost (template-based). Critical for resource-constrained users (4GB GPUs).

### Imports
- **None** — Pure JavaScript, no external dependencies

### Exports
- `RollingSummary` class
- `estimateTokens(text)` function
- `CHARS_PER_TOKEN` constant = 4

---

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `CHARS_PER_TOKEN` | 4 | Estimation ratio for token counting (rough: 4 chars per token) |

### Functions

#### `estimateTokens(text)` (lines 15-18)
- **Type**: Utility function (exported)
- **Parameters**: `text` (string, nullable)
- **Returns**: `number` — estimated token count
- **Logic**: Returns `Math.ceil(text.length / CHARS_PER_TOKEN)` or 0 if text is falsy
- **Purpose**: Quick token budget estimation

---

### Class: `RollingSummary`

#### Constructor (lines 20-33)
- **Parameters**: None
- **Initialization**: 
  - Resets all internal state by calling `this.reset()`
  - Creates fresh instance with empty tracking arrays and objects

#### `reset()` (lines 35-45)
- **Parameters**: None
- **Returns**: void
- **Resets**:
  - `_goal`: string (user's original message)
  - `_completedWork`: array of completed tool calls `[{tool, file, outcome, iteration}]`
  - `_fileState`: object tracking file mutations `{filePath: {lines, chars, writes, lastAction}}`
  - `_userCorrections`: array of user instruction corrections
  - `_keyDecisions`: array (unused currently)
  - `_currentPlan`: string from model's planning output
  - `_rotationCount`: incremented each rotation
  - `_lastSummary`: cached summary text
  - `_lastSummaryTokens`: token count of cached summary
  - `_iterationCount`: current iteration number
  - `_fullResults`: ring buffer of complete tool execution results

#### `setGoal(message)` (lines 50-52)
- **Parameters**: `message` (string)
- **Returns**: void
- **Logic**: Truncates message to 2000 chars and stores in `_goal`
- **Purpose**: Store the original user request for context recovery

#### `recordToolCall(toolName, params, result, iteration)` (lines 57-86)
- **Parameters**: 
  - `toolName` (string) - tool identifier
  - `params` (object) - tool parameters
  - `result` (object or string) - tool result
  - `iteration` (number, optional) - iteration number
- **Returns**: void
- **Logic**:
  1. Updates `_iterationCount`
  2. Determines success: `result?.success !== false && !result?.error`
  3. Extracts file path from params (tries `filePath` or `path`)
  4. Extracts file name for compact storage
  5. Pushes tool call to `_completedWork` with outcome (first 80 chars of error/success)
  6. **Caps `_completedWork` at 100 entries** — keeps last 80 when overflowing
  7. **Tracks file state for write operations**:
     - Regex test: `/^(write_file|append_to_file|edit_file)$/`
     - For `write_file`: replaces file state with new line/char count
     - For `append_to_file`: **adds** to existing count
     - Increments `writes` counter
     - Stores `lastAction` timestamp
- **Critical Edge Case**: Distinguishes between file creation (`write_file` resets count) and appending (`append_to_file` accumulates)

#### `recordToolResult(toolName, params, result, iteration)` (lines 91-107)
- **Parameters**: Same as `recordToolCall`
- **Returns**: void
- **Logic**:
  1. Converts result to text:
     - If result is string: use as-is
     - If result has `_pruned` flag: use tool + status only
     - Otherwise: JSON stringify
  2. Truncates resultText to 8000 chars
  3. Pushes complete result object to `_fullResults` ring buffer
  4. **Ring buffer management**: Caps at 50 entries, keeps newest 40
- **Purpose**: Stores complete tool execution results for tiered context assembly (Phase 2)

#### `recordUserCorrection(message)` (lines 112-119)
- **Parameters**: `message` (string)
- **Returns**: void
- **Logic**:
  1. Tests message against correction pattern regex (detects user corrections like "no I meant", "instead", "always", "never")
  2. If pattern matches: stores first 500 chars in `_userCorrections`
  3. Caps `_userCorrections` at 10 entries
- **Purpose**: Captures user feedback/constraints for injection into future prompts

#### `recordPlanFromResponse(responseText)` (lines 124-135)
- **Parameters**: `responseText` (string)
- **Returns**: void
- **Logic**:
  1. Skips if text < 50 chars
  2. Extracts plan items using regex: `/(?:^|\n)\s*(?:\d+[\.\)]\s*|[-*]\s+)(.{5,200})/g`
  3. Must find ≥2 matches to consider it a valid plan
  4. Takes first 8 matches
  5. Stores as multiline plan in `_currentPlan`
- **Purpose**: Detects and records structured plans from model responses

---

### Summary Generation Methods

#### `generateSummary(tokenBudget)` (lines 142-191)
- **Parameters**: `tokenBudget` (number) — max tokens for summary
- **Returns**: `string` — context-proportional summary (empty if nothing to summarize)
- **Logic** (priority-based section assembly):
  1. **Returns empty string** if no work and no goal, or if tokenBudget < 30
  2. **Section 1 - GOAL** (always first if fits):
     - Truncates to min(300 chars, budget * CHARS_PER_TOKEN)
     - Format: `GOAL: ${goal text}`
  3. **Section 2 - USER CORRECTIONS** (high priority):
     - Takes last 3-5 corrections depending on budget
     - Format: `USER INSTRUCTIONS: ${corrections joined by ' | '}`
  4. **Section 3 - FILE PROGRESS**:
     - Lists all tracked files with format: `name(Nx lines/Mw writes)`
     - Format: `FILES: ${fileEntries.join(', ')}`
  5. **Section 4 - WORK SUMMARY** (compressed by file):
     - Groups completed work by file
     - Lists tool names per file with call count
     - Format: `DONE(N calls): ${file:tools(count)x; ...}`
  6. **Section 5 - CURRENT PLAN** (if budget allows):
     - Format: `PLAN:\n${plan text}`
  7. **Budget management**: Each section costs tokens (estimated), sections skipped if budget exhausted
  8. Caches summary in `_lastSummary` and `_lastSummaryTokens`
- **Returns**: Markdown-formatted summary or empty string

#### `generateRotationSummary(activeTodos)` (lines 196-244)
- **Parameters**: `activeTodos` (array, optional) — optional active task list
- **Returns**: `string` — detailed markdown summary for hard rotation
- **Logic**:
  1. Increments `_rotationCount`
  2. Assembles sections in this order:
     - `## TASK GOAL` — full goal text
     - `## USER INSTRUCTIONS` — bulleted corrections
     - `## CURRENT APPROACH` — plan text
     - `## FILE PROGRESS` — detailed file info with append_to_file reminder
     - `## COMPLETED WORK` — last 20 tool calls with status/outcome
     - `## CONTEXT ROTATIONS` — if rotation > 1, mentions rotation count
     - `## ACTIVE TASKS` — from `activeTodos` filtered by status != 'done'
     - `## INSTRUCTION` — "Continue the task. Do not repeat completed work. Do not refuse."
  3. Joins sections with double newline
- **Purpose**: Generates comprehensive summary for context rotation (more detailed than normal injection)
- **Critical Note**: Includes explicit refusal prevention instruction

#### `assembleTieredContext(tokenBudget, currentIteration, currentFeedback)` (lines 249-320)
- **Parameters**:
  - `tokenBudget` (number) — max tokens for entire block
  - `currentIteration` (number) — current agentic iteration
  - `currentFeedback` (string) — raw tool feedback from current iteration
- **Returns**: `string` — assembled tiered context for prompt injection
- **Logic** (4-tier system):
  1. **Fallback**: Returns currentFeedback if budget < 100 or no history
  2. **TIER 0 - SUMMARY** (20% of budget, max 500 tokens):
     - Calls `generateSummary(summaryAlloc)`
     - Including goal, corrections, file state, plan
  3. **TIER 1 - HOT** (55% of budget, current iteration):
     - Includes full currentFeedback text if it fits
     - If exceeds budget: truncates from start to keep most recent results
  4. **TIER 2 - WARM** (60% of remaining budget, recent history):
     - Filters `_fullResults` where `iteration < currentIteration && currentIteration - iteration <= 4`
     - Compresses each: `[iter{N}] {tool}({file}): {ok/FAIL} — {excerpt(200 chars)}`
     - Includes only if it fits budget
     - Formats as `### Earlier Results`
  5. **TIER 3 - COLD** (remaining budget, old history):
     - Filters `_fullResults` where `currentIteration - iteration > 4`
     - One-liner bullets: `{tool}({file}): {ok/fail}`
     - Formats as `### Previous Work`
  6. **Budget accounting**: Removes tokens as each tier consumes
- **Purpose**: Progressive context assembly balancing recency vs budget

#### `shouldInjectSummary(iteration, contextPct)` (lines 325-334)
- **Parameters**: 
  - `iteration` (number)
  - `contextPct` (number) — context usage percentage (0.0-1.0)
- **Returns**: `boolean`
- **Logic**:
  1. Returns `true` if: iteration >= 3 AND completed work >= 2 (always inject after sufficient work)
  2. OR returns `true` if: contextPct > 0.30 AND completed work >= 1 (inject early if context filling)
  3. Otherwise: returns `false`
- **Purpose**: Decides whether to inject summary into next prompt

#### `getSummaryBudget(totalCtxTokens, contextPct)` (lines 339-347)
- **Parameters**:
  - `totalCtxTokens` (number) — total context window size
  - `contextPct` (number) — current usage percentage
- **Returns**: `number` — token budget for summary
- **Logic** (tiered budget allocation):
  - < 0.30 usage: 0 tokens (no summary needed)
  - 0.30-0.50: 2% of total (e.g., ~650 tokens for 32K)
  - 0.50-0.70: 4% of total (e.g., ~1300 tokens for 32K)
  - ≥ 0.70: 6% of total (e.g., ~1950 tokens for 32K)
- **Purpose**: Increases summary budget as context fills (summary becomes more critical)

#### `markRotation()` (lines 352-357)
- **Parameters**: None
- **Returns**: void
- **Logic**: Increments `_rotationCount`
- **Note**: **RollingSummary intentionally survives rotation** — this is by design (unlike ConversationSummarizer which handles warm-tier results)

---

### Serialization Methods

#### `toJSON()` (lines 362-375)
- **Parameters**: None
- **Returns**: `object` — serializable state
- **Includes**: goal, completedWork, fileState, userCorrections, keyDecisions, currentPlan, rotationCount, iterationCount, fullResults (last 20 only for size)
- **Purpose**: Export for persistence

#### `static fromJSON(data)` (lines 377-391)
- **Parameters**: `data` (object)
- **Returns**: `RollingSummary` — deserialized instance
- **Logic**: Creates new instance and restores all properties from JSON
- **Purpose**: Rehydrate from persisted state

---

### Potential Issues & Edge Cases

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **Ring buffer loss** | `recordToolCall()` line 70 | MEDIUM | When `_completedWork` exceeds 100, oldest entries are discarded. If rotation occurs before flush to long-term memory, that history is lost. |
| **Incomplete tool result** | `recordToolResult()` line 99 | MEDIUM | If result is object with `_pruned` flag, only tool name + status is stored (full result lost). Truncation at 8000 chars could cut mid-structure. |
| **Plan extraction fragility** | `recordPlanFromResponse()` line 129 | LOW | Regex-based extraction could fail on variations: "1) ", "*", "-", numbered lists. Requires ≥2 matches. |
| **File state accumulation** | `recordToolCall()` line 76 | LOW | `_fileState` tracks per file indefinitely. No pruning. If user edits 1000+ files, object grows unbounded. |
| **Budget arithmetic instability** | `generateSummary()` line 157 | MEDIUM | Budget allocation uses percentage-based cuts. If `tokenBudget` is very small (< 100), sections may all report cost > 0 but total tokens could overflow due to rounding. |
| **No duplicate detection** | `recordUserCorrection()` line 115 | LOW | Same user correction could be recorded multiple times, consuming slots (cap 10). |
| **Tiered context truncation** | `assembleTieredContext()` line 283 | MEDIUM | If currentFeedback is truncated from start, critical recent results could be cut off. No semantic awareness of what's important. |

---

## FILE 2: `sessionStore.js`

**File Purpose**: Persistent session state storage. Saves `RollingSummary` snapshots, checkpoints, and conversation metadata to disk as JSON files. Enables crash recovery and app restarts. Debounced saves (3s) to reduce I/O overhead.

### Imports
```javascript
const fs = require('fs');          // File system operations
const path = require('path');      // Path manipulation (cross-platform)
```

### Exports
- `SessionStore` class

---

### Class: `SessionStore`

#### Constructor (lines 10-18)
- **Parameters**:
  - `basePath` (string) — base directory for session JSON files (e.g., `<userData>/sessions`)
- **Initialization**:
  - `_basePath`: stores base path
  - `_data`: null (set by `initialize()`)
  - `_sessionId`: null
  - `_dirty`: false (flag for pending writes)
  - `_saveTimer`: null (debounce timer)
  - `_filePath`: null (full path to this session's file)

#### `initialize(sessionId)` (lines 23-46)
- **Parameters**: `sessionId` (string) — unique session identifier
- **Returns**: `boolean` — `true` if existing session was recovered, `false` if new
- **Logic**:
  1. Stores sessionId in `_sessionId`
  2. Creates base directory: `fs.mkdirSync(basePath, { recursive: true })`
  3. Computes file path: `{basePath}/{safeId(sessionId)}.json`
  4. **Attempts recovery**:
     - Checks if file exists
     - Reads and parses JSON
     - Logs recovery on success
     - Returns `true`
  5. **If no existing session**:
     - Creates new `_data` object with:
       - `sessionId`: the provided ID
       - `createdAt`: `Date.now()`
       - `updatedAt`: `Date.now()`
       - `rollingSummary`: null
       - `checkpoint`: null
       - `rotationCount`: 0
       - `toolCallCount`: 0
     - Returns `false`
  6. **Error handling**: Silently catches/logs errors, treats corrupt files as new sessions
- **Purpose**: Load or initialize session state

#### `_safeId(id)` (lines 48-49)
- **Parameters**: `id` (string)
- **Returns**: `string` — safe filename
- **Logic**: 
  - Replaces all non-alphanumeric chars (except `_-`) with `_`
  - Truncates to 100 chars
- **Purpose**: Prevent path traversal and invalid filename chars

#### `saveRollingSummary(rollingSummary)` (lines 54-61)
- **Parameters**: `rollingSummary` (`RollingSummary` instance)
- **Returns**: void
- **Logic**:
  1. Returns silently if no `_data`
  2. Serializes rolling summary: `_data.rollingSummary = rollingSummary.toJSON()`
  3. Updates `updatedAt` timestamp
  4. Extracts snapshot stats: `toolCallCount`, `rotationCount`
  5. Schedules debounced save: `_scheduleSave()`
- **Purpose**: Persist rolling summary for recovery

#### `loadRollingSummary(RollingSummaryClass)` (lines 66-75)
- **Parameters**: `RollingSummaryClass` (constructor function for `RollingSummary`)
- **Returns**: `RollingSummary` instance or `null`
- **Logic**:
  1. Returns null if no persisted data
  2. Calls `RollingSummaryClass.fromJSON()` to deserialize
  3. Catches and logs deserialization errors, returns null
- **Purpose**: Restore rolling summary from persistent storage

#### `saveCheckpoint(checkpoint)` (lines 80-86)
- **Parameters**: `checkpoint` (object) — lightweight recovery data
- **Returns**: void
- **Logic**:
  1. Returns if no `_data`
  2. Stores checkpoint object
  3. Updates `updatedAt`
  4. Schedules save
- **Purpose**: Save lightweight metadata for quick recovery (avoids deserializing large JSON)

#### `loadCheckpoint()` (lines 91-92)
- **Parameters**: None
- **Returns**: `object` or `null` — the checkpoint object
- **Logic**: Returns `_data?.checkpoint || null`

#### `flush()` (lines 97-104)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Clears any pending save timer
  2. Calls `_writeToDisk()` immediately
- **Purpose**: Force immediate write (called on rotation or conversation end)
- **Critical**: Used to ensure data is flushed before high-stakes operations

#### `_scheduleSave()` (lines 109-117)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Sets `_dirty = true`
  2. Returns early if a save is already scheduled (prevents timer spam)
  3. Schedules `_writeToDisk()` after 3 seconds
  4. Stores timer ID for cancellation
- **Purpose**: Debounce file writes to reduce I/O during active iteration

#### `_writeToDisk()` (lines 119-127)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Returns if not dirty or missing path/data
  2. Writes `_data` as JSON to file with UTF-8 encoding
  3. Clears dirty flag on success
  4. Logs error on failure (does not throw)
- **Purpose**: Actually write file to disk
- **Error handling**: Graceful — logs but doesn't crash

#### `cleanup(maxAge)` (lines 132-150)
- **Parameters**: `maxAge` (number) — milliseconds (default: 7 days)
- **Returns**: void
- **Logic**:
  1. Returns silently if base directory doesn't exist
  2. Lists all `.json` files in base directory
  3. For each file:
     - Gets file stats
     - If file mtime > maxAge: deletes it
     - Silently catches errors per file
- **Purpose**: Remove old session files to prevent unbounded storage growth

#### `static findRecoverableSession(basePath, maxAge)` (lines 155-183)
- **Parameters**:
  - `basePath` (string) — sessions directory
  - `maxAge` (number, optional) — milliseconds (default: 30 minutes)
- **Returns**: `object` or `null` — session metadata if recoverable session found
- **Logic**:
  1. Returns null if directory doesn't exist or is empty
  2. Scans all `.json` files, finds newest by mtime
  3. If newest is within maxAge: reads and returns metadata object:
     - `sessionId`
     - `filePath`
     - `goal` (from rollingSummary)
     - `age` (ms since last update)
     - `toolCallCount`, `rotationCount`
     - `hasRollingSummary`, `hasCheckpoint` (boolean flags)
  4. Returns null if no recent session found
- **Purpose**: Crash recovery — find the most recent resumable session

---

### Potential Issues & Edge Cases

| Issue | Location | Severity | Description |
|---|---|---|---|
| **Concurrent save conflicts** | `_writeToDisk()` line 123 | MEDIUM | No file locking. If two processes write simultaneously, data corruption is possible. Should use atomic rename or lock file. |
| **Unbounded directory growth** | `initialize()` line 37 | LOW | SessionStore never auto-cleans old sessions. User must call `cleanup()` manually or directory grows. |
| **Deserialization failure** | `loadRollingSummary()` line 72 | MEDIUM | If JSON is corrupt but file exists, silently returns null. App may not gracefully fall back to empty RollingSummary. |
| **Timer leak on rapid calls** | `_scheduleSave()` line 113 | LOW | If `_scheduleSave()` is called rapid-fire (> 1 per 3s), timer is replaced but old callback is cleared. Should be fine but not obvious behavior. |
| **Session ID collision** | `_safeId()` line 49 | LOW | Two different sessionIds could collide after sanitization/truncation (e.g., "foo-bar" and "foo_bar" both become "foo_bar"). Extremely unlikely but possible. |
| **Lost checkpoint data** | `saveCheckpoint()` line 85 | LOW | Checkpoint stored in `_data` but not serialized to disk until debounced save. If app crashes before 3s flush, checkpoint is lost. |
| **Permission errors** | `_writeToDisk()` line 123 | LOW | If directory becomes read-only after creation, write fails silently. Error logged but no retry mechanism. |

---

## FILE 3: `longTermMemory.js`

**File Purpose**: Unified cross-session memory bridging two stores: MCP tool memories (`.guide-memory/{key}.json`) and IDE project facts (`.ide-memory/memory.json`). Provides relevance-based retrieval for prompt injection and auto-extraction of facts at conversation end.

### Imports
```javascript
const fs = require('fs');          // File system operations
const path = require('path');      // Path utilities
```

### Constants

| Constant | Value | Purpose |
|---|---|---|
| `CHARS_PER_TOKEN` | 4 | Token estimation for memory entries |

### Exports
- `LongTermMemory` class

---

### Class: `LongTermMemory`

#### Constructor (lines 15-22)
- **Parameters**: None
- **Initialization**:
  - `_projectPath`: null (set by `initialize()`)
  - `_guideMemDir`: null (path to `.guide-memory/`)
  - `_ideMemDir`: null (path to `.ide-memory/`)
  - `_index`: [] (unified memory index)
  - `_initialized`: false

#### `initialize(projectPath)` (lines 27-36)
- **Parameters**: `projectPath` (string) — workspace/project root
- **Returns**: void
- **Logic**:
  1. Returns if no projectPath
  2. Sets paths: 
     - `_guideMemDir = {projectPath}/.guide-memory`
     - `_ideMemDir = {projectPath}/.ide-memory`
  3. Calls `_rebuildIndex()`
  4. Sets `_initialized = true`
- **Purpose**: Bootstrap memory system for a project

#### `_rebuildIndex()` (lines 41-44)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Clears `_index`
  2. Scans `.guide-memory/`
  3. Scans `.ide-memory/`
- **Purpose**: Full index rebuild (called on init)

#### `_scanGuideMemory()` (lines 49-81)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Returns if `_guideMemDir` is null
  2. Returns if directory doesn't exist
  3. Reads all files from `.guide-memory/`
  4. Builds set of `.json` files for deduplication: `jsonFiles = Set of basenames`
  5. For each `.json` or `.txt` file:
     - **Deduplication**: If both `.txt` and `.json` exist for same basename, **only processes `.json`** (JSON is canonical)
     - If `.json`: Parses JSON, extracts:
       - `key`: from `metadata.key` or basename with underscores replaced by spaces
       - `value`: from `content` field
       - `updatedAt`: from `metadata.updatedAt`
     - If `.txt`: Uses basename as key, raw file content as value, file mtime as timestamp
     - Caps value at 4000 chars
     - Pushes to `_index` with:
       - `key`, `value`, `source: 'guide-memory'`, `updatedAt`, `tokens: ceil(value.length / CHARS_PER_TOKEN)`
  6. Silently skips corrupt files
- **Purpose**: Index MCP tool-saved memories

#### `_scanIdeMemory()` (lines 86-117)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Returns if `_ideMemDir` is null
  2. Attempts to read `{ideMemDir}/memory.json`
  3. Returns if file doesn't exist
  4. Parses JSON and imports:
     - **Project Facts** (`raw.projectFacts`):
       - For each `[k, v]`: extracts value (handles object with `.value` property or direct value)
       - Pushes entry as `key: fact:{k}, value, source: 'ide-memory'`, with optional `learnedAt` timestamp
     - **Code Patterns** (`raw.codePatterns`):
       - Same logic but `key: pattern:{k}`
  5. Caps individual values at 4000 chars
  6. Silently skips corrupt data
- **Purpose**: Index IDE project facts and patterns

---

### Retrieval Methods

#### `getRelevantMemories(query, tokenBudget)` (lines 122-167)
- **Parameters**:
  - `query` (string) — user message or topic
  - `tokenBudget` (number, default 500) — max tokens for returned block
- **Returns**: `string` — formatted memory block or empty string
- **Logic**:
  1. Returns empty string if not initialized or index is empty
  2. Extracts keywords from query: `_extractKeywords(query)`
  3. Returns empty if no keywords
  4. **Scores each memory entry**:
     - For each keyword: adds +1 if found in entry text, +2 if found in entry key (case-insensitive)
     - **Recency bonus**: If entry updated within last 7 days, adds +1
  5. **Filters**: Keeps only entries with score > 0
  6. **Sorts**: By score descending, then by recency (newest first)
  7. **Assembles within budget**:
     - Starts with header: `[Long-term memory — relevant to this conversation]`
     - For each entry: formats as `- {key}: {value}`
     - Calculates token cost per entry
     - **If budget exceeded**: Tries truncated version of last entry (remainingChars - key length - 4)
     - Stops when budget exhausted
  8. Returns assembled block or empty string if only header
- **Purpose**: Inject relevant memories based on current conversation topic

#### `_extractKeywords(text)` (lines 172-203)
- **Parameters**: `text` (string)
- **Returns**: `string[]` — list of searchable keywords (max 20)
- **Logic**:
  1. Defines STOP_WORDS set (100+ common words: the, a, is, was, etc.)
  2. Splits text on non-alphanumeric chars: `/[^a-z0-9_.-]+/i`
  3. Filters: word length >= 3 AND not in STOP_WORDS (case-insensitive)
  4. Extracts file-like patterns: `/[\w.-]+\.\w{1,6}/g` (e.g., "index.js")
  5. Deduplicates combined list
  6. Returns first 20 keywords
- **Purpose**: Extract searchable terms from user message

---

### Extraction Methods (Conversation End)

#### `extractAndSave(rollingSummary, userMessage)` (lines 208-271)
- **Parameters**:
  - `rollingSummary` (`RollingSummary` or null)
  - `userMessage` (string)
- **Returns**: void
- **Logic**:
  1. Returns if not initialized or no summary
  2. Generates timestamp and session key: `session_{Date.now()}`
  3. Creates tag from userMessage (first 60 chars, alphanumeric + spaces only)
  4. **Extracts facts from rolling summary**:
     - **Work items**: `${sessionKey}_work` — lists tools used
     - **File state**: `${sessionKey}_files` — lists files touched (max 20)
     - **Key decisions**: `${sessionKey}_decisions` — stores decisions (last 5)
     - **User corrections**: `${sessionKey}_corrections` — high-value long-term facts (last 5)
     - **Plan**: `${sessionKey}_plan` — truncated to 500 chars
  5. Returns if no facts extracted
  6. **Writes to `.guide-memory/`**:
     - Creates directory if needed
     - Builds payload object with:
       - `metadata`: key, tag, timestamps, source, factCount
       - `content`: multi-line fact list
       - `facts`: structured array
     - Writes as `{safeKey}.json`
     - Salt-encodes (replaces invalid chars with underscores)
  7. **Updates in-memory index**: Pushes new entry
  8. **Prunes old auto-extracted memories**: Calls `_pruneAutoExtracted(50)`
- **Purpose**: Automatically save session facts for long-term retrieval

#### `notifySaved(key, value)` (lines 276-288)
- **Parameters**:
  - `key` (string)
  - `value` (string)
- **Returns**: void
- **Logic**:
  1. Removes any existing entry with same key from `_index`
  2. Pushes new entry with:
     - Key, value (capped 4000 chars)
     - `source: 'guide-memory'`, current timestamp, token count
- **Purpose**: Update index when MCP save_memory tool writes a new memory

---

### Maintenance Methods

#### `_pruneAutoExtracted(keepCount)` (lines 293-318)
- **Parameters**: `keepCount` (number) — how many auto-extracted sessions to retain
- **Returns**: void
- **Logic**:
  1. Returns if `_guideMemDir` is null
  2. Filters `_index` for entries where `source === 'auto-extract'`
  3. Sorts by `updatedAt` descending (newest first)
  4. If count <= keepCount: returns (nothing to prune)
  5. **Removes old entries**:
     - Identifies entries to remove (beyond keepCount)
     - Deletes corresponding file from `.guide-memory/{safeKey}.json`
     - Removes entry from `_index`
  6. Silently catches errors per file
- **Purpose**: Cap auto-extracted memories at 50 to prevent unbounded growth

#### `getStats()` (lines 323-333)
- **Parameters**: None
- **Returns**: `object` — diagnostics
  - `totalEntries`: count
  - `totalTokens`: sum of all entry tokens
  - `bySource`: object with counts per source (`guide-memory`, `ide-memory`, `auto-extract`)
- **Purpose**: Observe memory index health

---

### Potential Issues & Edge Cases

| Issue | Location | Severity | Description |
|---|---|---|---|
| **JSON precedence bug** | `_scanGuideMemory()` line 65 | MEDIUM | If `.json` file exists but `.txt` is newer, the older `.json` is used. Should be both or latest, not always JSON. |
| **Unbounded fact extraction** | `extractAndSave()` line 237 | LOW | Each session saves up to 5 facts. With 50 session cap, that's 250 facts max, but index could grow if MCP tool also saves. No global cap on all memories. |
| **Keyword extraction too aggressive** | `_extractKeywords()` line 179 | LOW | 20 keyword limit could cause relevant facts to be missed if user message is long and varied. No weighting by position or frequency. |
| **Filename collision after safe encoding** | `_scanGuideMemory()` + `extractAndSave()` | LOW | Two different keys could encode to same filename (e.g., "foo-bar" and "foo_bar" both become "foo_bar"). |
| **File I/O errors silent** | Multiple locations | MEDIUM | All file operations catch and ignore errors. If `.guide-memory/` becomes read-only, no explicit warning to user. |
| **No memory versioning** | `notifySaved()` + `_scanGuideMemory()` | LOW | If same `key` is saved multiple times, old version is silently overwritten. No history or version tracking. |
| **Recency bonus calculation** | `getRelevantMemories()` line 152 | LOW | 7-day cutoff is hardcoded. For a long-running IDE session, anything older than 7 days gets same score (no gradient). |

---

## FILE 4: `conversationSummarizer.js`

**File Purpose**: Structured task ledger for context recovery during rotations. Maintains goals, tool calls, plan steps, user corrections, and state as structured data (not text compression). Produces markdown summaries for injection when context rotation occurs. Tracks incremental task progress (e.g., "write 500 lines of code").

### Exports
- `ConversationSummarizer` class

---

### Class: `ConversationSummarizer`

#### Constructor (lines 7-9)
- **Parameters**: None
- **Initialization**: Calls `this.reset()`

#### `reset()` (lines 11-26)
- **Parameters**: None
- **Returns**: void
- **Resets**:
  - `originalGoal`: string (user's task)
  - `taskPlan`: array of `{index, description, completed}` (structured plan steps)
  - `completedSteps`: array of `{tool, params, success, outcome, timestamp, compressed?}` (tool call history)
  - `currentState`: object tracking UI state (page, file, command, directory, lastAction, lastActionTime)
  - `keyFindings`: string array (extracted findings from tool results)
  - `importantContext`: array of `{type, content, timestamp}` (user instructions)
  - `rotationCount`: 0
  - `totalToolCalls`: 0
  - `_warmTierResults`: [] (recent tool results from pre-rotation)
  - `_previousSummaries`: [] (compacted summaries from prior rotations)
  - `fileProgress`: object `{filePath: {writtenLines, writtenChars, writes}}` (file write tracking)
  - `incrementalTask`: null or `{type, target, current}` (for "write 500 lines" style tasks)
- **Purpose**: Clear all state for new conversation

---

### Goal & Incremental Task Methods

#### `setGoal(message)` (lines 31-34)
- **Parameters**: `message` (string)
- **Returns**: void
- **Logic**:
  1. Returns if no message
  2. Truncates to 2000 chars
  3. Calls `_detectIncrementalTask(message)` to parse goal for quantified tasks
- **Purpose**: Store goal and detect if it's incremental (e.g., "write 500 lines")

#### `_detectIncrementalTask(message)` (lines 39-60)
- **Parameters**: `message` (string)
- **Returns**: void
- **Logic**:
  1. Returns if no message
  2. Converts to lowercase
  3. **Pattern 1 - Lines**: Regex `/(\d{3,})\s*[-]?\s*lines?/` matches "500 lines", "300-lines", etc.
     - Sets `incrementalTask: {type: 'lines', target: parsed number, current: 0}`
  4. **Pattern 2 - Functions**: Regex `/(\d{2,})\s*(?:utility\s*)?functions?/`
     - Sets `incrementalTask: {type: 'functions', target: parsed number, current: 0}`
  5. **Pattern 3 - Items/Elements**: Regex `/(\d{2,})\s*(?:items?|elements?|components?|methods?|classes?)/`
     - Sets `incrementalTask: {type: 'items', target: parsed number, current: 0}`
- **Purpose**: Auto-detect quantified subtasks in goals

#### `setIncrementalTask(type, target, current)` (lines 62-65)
- **Parameters**: `type` (string), `target` (number), `current` (number, default 0)
- **Returns**: void
- **Logic**: Directly sets `incrementalTask` object
- **Purpose**: Manual override of incremental task

#### `updateIncrementalProgress(amount)` (lines 67-71)
- **Parameters**: `amount` (number) — units to add
- **Returns**: void
- **Logic**: If incrementalTask exists, adds amount to `incrementalTask.current`
- **Purpose**: Update progress towards incremental goal

---

### Tool Call Recording

#### `recordToolCall(toolName, params, result)` (lines 76-97)
- **Parameters**: `toolName` (string), `params` (object), `result` (object)
- **Returns**: void
- **Logic**:
  1. Increments `totalToolCalls`
  2. Determines success: `!result?.error`
  3. Extracts outcome text: `_extractOutcome(toolName, params, result)`
  4. Compresses params: `_compressParams(params)`
  5. Pushes to `completedSteps`: `{tool, params, success, outcome, timestamp: Date.now()}`
  6. Updates state: `_updateState(toolName, params, result)`
  7. Extracts findings: `_extractFindings(toolName, result)`
  8. **Auto-compresses if history > 40 calls**: `_compressHistory()`
- **Purpose**: Record tool execution

#### `_extractOutcome(toolName, params, result)` (lines 99-106)
- **Parameters**: `toolName` (string), `params` (object), `result` (object)
- **Returns**: `string` (max 150 chars)
- **Logic**: Returns:
  - Error message (truncated) if `result.error`
  - String result truncated to 150 chars
  - `result.content` if exists
  - `'OK'` otherwise
- **Purpose**: Extract human-readable outcome from tool result

#### `_compressParams(params)` (lines 108-118)
- **Parameters**: `params` (object)
- **Returns**: `object` (compressed)
- **Logic**: For each param value > 100 chars, truncates to 80 chars + "..."
- **Purpose**: Reduce storage size of params

#### `_updateState(toolName, params, result)` (lines 120-161)
- **Parameters**: `toolName` (string), `params` (object), `result` (object)
- **Returns**: void
- **Logic** (updates `currentState` based on tool calls):
  - **browser_navigate**: Sets `currentState.page = params.url`
  - **browser_snapshot**: Extracts title from result, sets `hasSnapshot = true`
  - **write_file/read_file**: Sets `lastFile = params.path or params.filePath`
  - **run_terminal_cmd**: Sets `lastCommand = params.command` (truncated 100)
  - **Any tool with path/directory**: Sets `currentState.directory`
  - **Always**: Sets `lastAction, lastActionTime`
  - **File write tracking** (for write_file/append_to_file with success):
    - Splits content into lines, counts chars
    - For `write_file`: **replaces** file state (fresh write)
    - For `append_to_file`: **accumulates** lines/chars
    - Increments `writes` counter
    - **Updates incremental task progress**:
      - If tracking lines: sums all writtenLines across all files, updates current
      - If tracking functions: regex counts `function\s+\w+` or `const/let/var\s+\w+\s*=\s*(?:async)?\(` patterns, adds to current
- **Purpose**: Maintain breadcrumb state for rotation summaries

#### `_extractFindings(toolName, result)` (lines 163-180)
- **Parameters**: `toolName` (string), `result` (object)
- **Returns**: void
- **Logic**:
  - Converts result to string
  - Regex searches for `title:` (page title), `error:|failed|exception|403|404|500` (errors)
  - Extracts first 80 char match
  - Pushes finding to `keyFindings`
  - Caps `keyFindings` at 15 (keeps last 10 if exceeds)
- **Purpose**: Extract notable events for summary

#### `_compressHistory()` (lines 182-207)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Keeps last 20 steps as-is
  2. Compresses older steps: groups by tool name, counts successes/failures
  3. Replaces old steps with compressed summaries: `{tool, params: {}, success: true, outcome: "{N} calls ({M} OK)", compressed: true}`
  4. Prepends compressed summaries, appends recent steps
- **Purpose**: Reduce memory footprint of long tool call history

---

### Plan & Step Tracking

#### `recordPlan(responseText)` (lines 212-228)
- **Parameters**: `responseText` (string)
- **Returns**: void
- **Logic**:
  1. Returns if text < 50 chars
  2. Regex finds numbered/bullet list items: `/(?:^|\n)\s*(?:\d+[\.\)]\s*|[-*]\s+)(.{5,200})/g`
  3. If ≥ 2 matches: creates `taskPlan` array of `{index, description, completed: false}`
- **Purpose**: Extract plan steps from model's structured output

#### `markPlanStepCompleted(toolName, params)` (lines 230-244)
- **Parameters**: `toolName` (string), `params` (object)
- **Returns**: void
- **Logic**:
  1. Returns if no plan
  2. Converts tool name to lowercase
  3. JSON stringifies params (lowercase)
  4. Fuzzy matches tool call to plan step:
     - Checks if tool name is mentioned in plan step description
     - Checks if any param value (words >= 4 chars) appears in plan step
  5. Marks first uncompleted matching step as `completed: true`
- **Purpose**: Track which plan steps are done

#### `recordUserContext(message)` (lines 249-261)
- **Parameters**: `message` (string)
- **Returns**: void
- **Logic**:
  1. Returns if no message
  2. Tests for correction patterns: `/\b(no,?\s*i\s*meant|actually|instead|don'?t|always|never|must|should not|shouldn'?t)\b/i`
  3. If pattern matches: pushes to `importantContext: {type: 'correction', content: first 500 chars, timestamp}`
  4. Caps `importantContext` at 10
- **Purpose**: Record user instructions/corrections

---

### Rotation & Summary Generation

#### `markRotation()` (lines 266-281)
- **Parameters**: None
- **Returns**: void
- **Logic**:
  1. Increments `rotationCount`
  2. **Captures warm tier**: Last 5 completed steps, formatted as:
     - `{+/-} {tool}: {outcome}` (+ for success, - for fail)
  3. **Compacts to previousSummaries**:
     - Creates string: `Rotation {N}: {tool call count} tool calls. Findings: ...`
     - Pushes to `_previousSummaries`
     - Caps at 5 rotation summaries (FIFO)
- **Purpose**: Prepare state for rotation, maintain layered memory

#### `generateSummary(options)` (lines 286-359)
- **Parameters**: `options` (object):
  - `maxTokens`: number (default 2000)
  - `activeTodos`: array (default [])
- **Returns**: `string` — markdown summary
- **Logic** (multi-section assembly):
  1. Calculates max chars: `maxTokens * 4`
  2. **Section 1 — TASK GOAL**: Full goal text
  3. **Section 2 — USER INSTRUCTIONS & CORRECTIONS**: Bulleted corrections
  4. **Section 3 — COMPLETED WORK**: Calls `_formatProgress()`
  5. **Section 4 — CURRENT STATE**: Browser page, file, command, directory (if set)
  6. **Section 5 — KEY FINDINGS**: Last 8 findings bulleted
  7. **Section 5b — PRIOR CONTEXT ROTATIONS**: Previous rotation summaries
  8. **Section 5c — RECENT RESULTS**: `_warmTierResults` from pre-rotation (formatted `+/- tool: outcome`)
  9. **Section 5d — FILE PROGRESS**: Per-file statistics (lines, chars, write count)
  10. **Section 5e — INCREMENTAL TASK PROGRESS**: If tracking, shows type/target/current/percentage
       - **CRITICAL**: Adds "DO NOT REFUSE" and "DO NOT SAY I cannot continue" instruction
  11. **Section 6 — REMAINING STEPS**: Uncompleted plan steps
  12. **Section 6b — ACTIVE TASKS**: From `activeTodos` filtered by status != 'done'
  13. **Section 7 — INSTRUCTION**: "Continue the task from where you left off"
       - **If incremental task or file progress**: Adds explicit refusal prevention
  14. Joins sections with double newline
  15. Truncates to maxChars if needed
- **Purpose**: Generate detailed rotation summary

#### `generateQuickSummary(activeTodos)` (lines 361-363)
- **Parameters**: `activeTodos` (array, optional)
- **Returns**: `string`
- **Logic**: Calls `generateSummary({maxTokens: 1200, activeTodos})`
- **Purpose**: Shorter summary for non-rotation injections

#### `_formatProgress()` (lines 365-387)
- **Parameters**: None
- **Returns**: `string` — formatted tool call list
- **Logic**:
  1. Groups consecutive calls to same tool (up to 5 consecutive)
  2. Formats as:
     - Single call: `✓/✗ {tool}: {outcome}`
     - Multiple: `✓/✗ {tool} (×N)`
  3. If total lines > 20: shows first 8 + "... (N more steps) ..." + last 8
- **Purpose**: Compact representation of tool call history

---

### Serialization

#### `toJSON()` (lines 392-403)
- **Parameters**: None
- **Returns**: `object`
- **Includes**: originalGoal, taskPlan, completedSteps, currentState, keyFindings, importantContext, rotationCount, totalToolCalls
- **Note**: Does NOT serialize `_warmTierResults`, `_previousSummaries`, `fileProgress`, `incrementalTask` (these are session-level, not persisted)

---

### Potential Issues & Edge Cases

| Issue | Location | Severity | Description |
|---|---|---|---|
| **Incremental task parsing collision** | `_detectIncrementalTask()` line 42-60 | LOW | If goal contains multiple numbers ending in "lines", "functions", etc., only first is captured. Later patterns won't override. |
| **Plan step fuzzy matching fragile** | `markPlanStepCompleted()` line 235 | MEDIUM | Fuzzy matching by tool name or param overlap could incorrectly mark unrelated steps as done, or miss correct steps if phrasing is different. |
| **History compression loss** | `_compressHistory()` line 200 | MEDIUM | When history is compressed, individual step outcomes (errors, timestamps) are lost. Only aggregated counts remain. Older steps become impossible to debug. |
| **File progress only per file, not total** | `_updateState()` line 144 | LOW | File progress tracking doesn't maintain total lines written across all files in one place. Requires summing `fileProgress` values. |
| **Warm tier truncation at rotation** | `markRotation()` line 273 | LOW | Only last 5 tool calls are preserved as warm tier. If user cares about step 6, it's lost forever. |
| **No deduplication of findings** | `_extractFindings()` line 170 | LOW | Same finding (e.g., "Page: Home") could be added multiple times if multiple tool results match, wasting space. |
| **Refusal prevention instruction hardcoded** | `generateSummary()` line 348 | MEDIUM | "DO NOT REFUSE" is explicit in markdown. If user wants model to refuse on certain tasks, this instruction may override their intent. |

---

## FILE 5: `contextManager.js`

**File Purpose**: Independent context management state machine handling seamless continuation, context compaction, context rotation, and budget tracking. Extracted from monolithic `agenticChat.js` to enable clean separation of concerns.

### Exports
- `ContextManager` (main class)
- `ContextBudget` (budget tracking)
- `SeamlessContinuation` (generation continuation)
- `ContextCompactor` (history reduction)
- `ContextRotator` (rotation orchestration)
- `ContentSalvager` (partial content recovery)

---

### Class: `ContextBudget`

#### Constructor (lines 9-15)
- **Parameters**:
  - `totalContextSize` (number) — total context window in tokens
  - `systemReserve` (number) — reserved for system prompt + tool defs
- **Initialization**:
  - Stores `totalContextSize`
  - Stores `systemReserve`
  - Calculates `usableTokens = totalContextSize - systemReserve`

#### `estimateTokens(text)` (lines 20-24)
- **Parameters**: `text` (string, nullable)
- **Returns**: `number` — estimated tokens
- **Logic**: `ceil(text.length / 3.5)` (more refined than 4-chars-per-token)
- **Note**: Not used for critical decisions, only pre-generation estimates

#### `usagePercent(usedTokens)` (lines 29-32)
- **Parameters**: `usedTokens` (number)
- **Returns**: `number` (0.0-1.0) — percentage of total context used
- **Logic**: `usedTokens / totalContextSize`

#### `remainingForResponse(usedTokens)` (lines 37-41)
- **Parameters**: `usedTokens` (number)
- **Returns**: `number` — tokens available for model response
- **Logic**: `max(0, totalContextSize - usedTokens)`

#### `getAction(usedTokens)` (lines 46-53)
- **Parameters**: `usedTokens` (number)
- **Returns**: `'ok'|'compact-light'|'compact-medium'|'compact-heavy'|'rotate'`
- **Logic** (tiered thresholds):
  - < 55%: `'ok'` (no action needed)
  - 55-70%: `'compact-light'` (compress old results)
  - 70-80%: `'compact-medium'` (prune history)
  - 80-90%: `'compact-heavy'` (aggressive pruning)
  - ≥ 90%: `'rotate'` (fresh context needed)
- **Purpose**: Decisioning for context management

---

### Class: `SeamlessContinuation`

**Purpose**: Detect truncation, accumulate partial generations, and create continuation prompts. Detects restart detection (model restarting instead of continuing).

#### Constructor (lines 58-61)
- **Parameters**: None
- **Initialization**: Calls `reset()`

#### `reset()` (lines 63-73)
- **Parameters**: None
- **Returns**: void
- **Resets**:
  - `count`: 0 (generated passes so far)
  - `accumulatedText`: '' (full generated text)
  - `isActive`: false (is continuation in progress)
  - `lastPassLength`: 0
  - `consecutiveShortPasses`: 0
  - `maxContinuations`: 50 (absolute max passes)
  - `lastPassPreview`: '' (debugging)

#### `shouldContinue(responseText, stopReason)` (lines 78-100)
- **Parameters**:
  - `responseText` (string) — text generated this pass
  - `stopReason` (string) — `'maxTokens'|'eos'|'cancelled'`
- **Returns**: `boolean` — should we continue?
- **Logic**:
  1. If `stopReason === 'eos' || 'cancelled'`:
     - **Exception**: If accumulated text has unclosed tool fence (e.g., unclosed ```json), continue anyway
     - Otherwise: return false (natural end)
  2. If `stopReason === 'maxTokens'`: return true (always candidate for continuation)
  3. Otherwise: return false
- **Purpose**: Decide if generation was truncated or naturally ended

#### `addPass(passText)` (lines 105-131)
- **Parameters**: `passText` (string) — generated text in this pass
- **Returns**: `{continue: boolean, reason: string}`
- **Logic**:
  1. Increments `count`
  2. Updates `lastPassLength` and `lastPassPreview`
  3. **Forward progress check**: If passText < 20 chars, increments `consecutiveShortPasses`
     - If ≥ 3 consecutive short passes: return `{continue: false, reason: 'death-spiral'}`
  4. **Max continuations check**: If count >= 50, return false
  5. **Restart detection**:
     - If count > 1 and accumulated text exists:
     - Compares first 60 chars of initial pass vs current pass
     - If they match closely (restart): return `{continue: false, reason: 'restart-detected'}`
  6. **Appends text**: `accumulatedText += passText`
  7. Sets `isActive = true`
  8. Returns `{continue: true, reason: 'ok'}`
- **Critical**: Detects death spirals (tiny outputs) and model restarting instead of continuing

#### `buildContinuationPrompt()` (lines 136-142)
- **Parameters**: None
- **Returns**: `string` — prompt for next generation pass
- **Logic**:
  1. Takes trailing 500 chars of accumulated text (not 200 — increased for better context)
  2. Returns: `"Continue your response from exactly where you left off. Your previous output ended with:\n\n{tail}\n\nContinue immediately from that point. Do not restart or repeat any content."`
- **Purpose**: Tell model where to pick up

#### `getAccumulatedText()` (lines 147-149)
- **Parameters**: None
- **Returns**: `string` — full text from all passes

#### `hasUnclosedToolFence()` (lines 154-156)
- **Parameters**: None
- **Returns**: boolean
- **Logic**: Calls `_hasUnclosedToolFence(accumulatedText)`

#### `_hasUnclosedToolFence(text)` (lines 158-170)
- **Parameters**: `text` (string)
- **Returns**: boolean
- **Logic**:
  1. Regex searches for ` ```(?:json|tool_call|tool)\s*\n ` (fence openings)
  2. Finds last fence index
  3. Checks if there's a closing ``` after last opening
  4. **Returns true** if last fence is unclosed
- **Purpose**: Detect mid-JSON-object truncation

---

### Class: `ContextCompactor`

**Purpose**: Reduce conversation size to free token budget using 4-phase strategy.

#### `compact(chatHistory, toolResults, action, currentIteration)` (lines 178-194)
- **Parameters**:
  - `chatHistory` (array) — `{role, content}` messages
  - `toolResults` (array) — tool execution records
  - `action` (string) — `'compact-light'|'compact-medium'|'compact-heavy'`
  - `currentIteration` (number) — current iteration
- **Returns**: `{history, toolResults, freedEstimate: number}`
- **Logic**:
  1. **compact-light**: Compresses tool results from 3+ iterations ago
  2. **compact-medium**: Compresses 1+ iterations ago + prunes history keeping last 6 messages
  3. **compact-heavy**: Compresses ALL results except last 2 + prunes to last 3 messages + truncates long content to 8000 chars
  4. Estimates tokens freed
  5. Returns modified history/results
- **Purpose**: Progressive compaction strategy

#### `_compressOldToolResults(toolResults, currentIteration, keepRecent)` (lines 196-211)
- **Parameters**: `toolResults` (array), `currentIteration` (number), `keepRecent` (number) — iterations to preserve
- **Returns**: number (freed token estimate)
- **Logic**:
  1. For each tool result older than `keepRecent` iterations:
     - Calls `_summarizeToolResult()` to create compact summary
     - Replaces result with `{_compressed: true, summary}`
     - Marks `_compressed = true`
     - Estimates tokens freed
- **Purpose**: Compress old results without losing most recent ones

#### `_compressAllToolResults(toolResults)` (lines 216-228)
- **Parameters**: `toolResults` (array)
- **Returns**: number
- **Logic**: Same as above but compresses everything except last 2 results

#### `_pruneHistory(chatHistory, keepLastN)` (lines 233-242)
- **Parameters**: `chatHistory` (array), `keepLastN` (number)
- **Returns**: number (freed estimate)
- **Logic**:
  1. If history length <= keepLastN + 1: return 0
  2. Removes middle messages (keeps first for system context, last N for recency)
  3. Sums content length of removed messages
- **Purpose**: Keep only recent conversation history

#### `_truncateLongContent(chatHistory, maxLen)` (lines 247-255)
- **Parameters**: `chatHistory` (array), `maxLen` (number)
- **Returns**: number
- **Logic**: Truncates any message > maxLen, appends `"[Content truncated to save context space]"`

#### `_summarizeToolResult(tool, result)` (lines 260-289)
- **Parameters**: `tool` (string), `result` (object)
- **Returns**: `string` — compact summary
- **Logic** (per-tool summarization):
  - **read_file**: `"read_file: read {path} ({lines} lines)"`
  - **write_file**: `"write_file: wrote {path} ({success/failed})"`
  - **edit_file**: Similar
  - **run_command**: `"run_command: {success/failed} — {output excerpt}"`
  - **list_directory**: `"list_directory: {count} items in {path}"`
  - **web_search**: `"web_search: {count} results"`
  - **browser_snapshot**: `"browser_snapshot: page snapshot taken"`
  - **Generic**: If JSON < 200 chars, use as-is; otherwise `"{tool}: result ({length} chars)"`
- **Purpose**: Create human-readable summaries of tool results

---

### Class: `ContextRotator`

**Purpose**: Orchestrate context rotation — generating summaries and detecting duplicate writes.

#### Constructor (lines 294-298)
- **Parameters**: None
- **Initialization**:
  - `rotationCount`: 0
  - `filesWritten`: Map (filePath → write count)
  - `maxRotations`: 10 (absolute limit)

#### `resetForNewMessage()` (lines 303-306)
- **Parameters**: None
- **Returns**: void
- **Logic**: Resets `rotationCount`, preserves `filesWritten` (persists across entire conversation)
- **Purpose**: Prepare for new user message (does NOT reset filesWritten)

#### `recordFileWrite(filePath, contentLength)` (lines 311-314)
- **Parameters**: `filePath` (string), `contentLength` (number)
- **Returns**: void
- **Logic**: Increments write count for this file in the map
- **Purpose**: Track how many times each file has been written

#### `shouldBlockWrite(filePath)` (lines 319-321)
- **Parameters**: `filePath` (string)
- **Returns**: boolean
- **Logic**: Returns true if file has been written ≥ 3 times
- **Purpose**: Prevent infinite file rewrites after rotation

#### `canRotate()` (lines 326-328)
- **Parameters**: None
- **Returns**: boolean
- **Logic**: `rotationCount < maxRotations`

#### `rotate(chatHistory, toolResults, originalUserMessage, summarizeFn)` (lines 333-378)
- **Parameters**:
  - `chatHistory` (array): current conversation
  - `toolResults` (array): executed tools
  - `originalUserMessage` (string): user's original request
  - `summarizeFn` (async function or null): optional summarizer callback
- **Returns**: `Promise<{history: [], summary: string}>`
- **Logic**:
  1. Increments `rotationCount`
  2. Builds list of written files with write counts
  3. Calls `_buildWorkSummary(toolResults)` to list completed work
  4. **Attempts LLM summarization**:
     - If `summarizeFn` provided: calls it (e.g., ConversationSummarizer)
     - Catches errors, falls back to extractive summary
  5. **Extractive fallback**: Takes first 200 chars of each assistant message
  6. **Builds rotation context** (markdown):
     - `CONTEXT ROTATION: This is continuation #N`
     - `ORIGINAL USER REQUEST: {message}`
     - `WORK COMPLETED SO FAR: {summary}`
     - `FILES WRITTEN: {list}`
     - `PREVIOUS CONVERSATION SUMMARY: {full summary}`
     - `IMPORTANT: Do NOT redo work. Continue from where you left off.`
  7. **Builds fresh history**:
     - User message with rotation context
     - Assistant acknowledgment
     - User message with continuation instruction
  8. Returns fresh history and full rotation context
- **Purpose**: Generate rotation summary and reset context window

#### `_buildWorkSummary(toolResults)` (lines 380-399)
- **Parameters**: `toolResults` (array)
- **Returns**: `string` — bulleted work summary
- **Logic**: For each tool result, generates a descriptive bullet:
  - write_file: `"Created/wrote file: {path}"`
  - edit_file: `"Edited file: {path}"`
  - read_file: `"Read file: {path}"`
  - run_command: `"Ran command: {command excerpt}"`
  - web_search: `"Searched web: {query}"`
  - Others: Generic tool + params

#### `_extractiveSummary(chatHistory)` (lines 401-410)
- **Parameters**: `chatHistory` (array)
- **Returns**: `string`
- **Logic**: Takes first 200 chars of each assistant message, joins with `---`

---

### Class: `ContentSalvager`

**Purpose**: Recover partial write_file content from truncated generations.

#### `salvageWriteFile(text)` (lines 415-460)
- **Parameters**: `text` (string) — accumulated (possibly truncated) text
- **Returns**: `{filePath: string, content: string} | null`
- **Logic**:
  1. Returns null if no text
  2. **Regex finds filePath**: `/"filePath"\s*:\s*"((?:[^"\\]|\\.)*)"/ `
  3. **Regex finds content start**: `/"content"\s*:\s*"/`
  4. If either not found: return null
  5. **Parses JSON escape sequences**:
     - Iterates from content start to end, unescaping chars
     - Handles `\n`, `\t`, `\r`, `\"`, `\\`, `/`
     - Stops at unescaped closing quote
  6. Returns `{filePath, content}` or null if < 10 chars
  7. Logs salvage with char count
- **Purpose**: Recover partial write_file calls before abandoning continuation

---

### Class: `ContextManager` (Main Orchestrator)

#### Constructor (lines 465-479)
- **Parameters**:
  - `totalContextSize` (number)
  - `systemReserve` (number)
- **Initialization**:
  - Creates `budget`, `continuation`, `compactor`, `rotator`, `salvager` instances
  - `toolResults`: []
  - `currentIteration`: 0
  - `originalUserMessage`: ''
  - `wallClockTimeout`: 15 * 60 * 1000 (15 minutes absolute max)
  - `startTime`: 0

#### `startNewMessage(userMessage)` (lines 484-492)
- **Parameters**: `userMessage` (string)
- **Returns**: void
- **Logic**: Resets all state for new user message, records start time
- **Purpose**: Initialize for fresh conversation

#### `isTimedOut()` (lines 497-499)
- **Parameters**: None
- **Returns**: boolean
- **Logic**: `Date.now() - startTime > wallClockTimeout`
- **Purpose**: 15-minute absolute timeout for agentic loop

#### `nextIteration()` (lines 504-506)
- **Parameters**: None
- **Returns**: void
- **Logic**: Increments `currentIteration`

#### `addToolResult(toolCall)` (lines 511-520)
- **Parameters**: `toolCall` (object)
- **Returns**: void
- **Logic**:
  1. Tags tool call with iteration: `toolCall._iteration = currentIteration`
  2. Pushes to `toolResults`
  3. If write_file: records file write via `rotator.recordFileWrite()`
- **Purpose**: Track tool executions for compaction/rotation

#### `preGenerationCheck(estimatedTokens, chatHistory, summarizeFn)` (lines 525-549)
- **Parameters**:
  - `estimatedTokens` (number): estimated prompt tokens
  - `chatHistory` (array): current history
  - `summarizeFn` (async function, optional): for rotation sync
- **Returns**: `Promise<{proceed: boolean, chatHistory: [], rotated: boolean}>`
- **Logic**:
  1. Gets action: `budget.getAction(estimatedTokens)`
  2. If `'ok'`: returns `{proceed: true, chatHistory, rotated: false}`
  3. If `'rotate'`:
     - Checks `rotator.canRotate()`
     - If can't rotate: returns `{proceed: false}`
     - Otherwise: performs rotation, returns `{proceed: true, chatHistory: rotated history, rotated: true}`
  4. If compact action:
     - Logs compaction with percentage
     - Performs compaction
     - Returns `{proceed: true, chatHistory, rotated: false}`
- **Purpose**: Check before generation if compaction/rotation needed

#### `handleGenerationEnd(passText, stopReason, currentContextTokens)` (lines 554-619)
- **Parameters**:
  - `passText` (string): generated text this pass
  - `stopReason` (string): `'maxTokens'|'eos'|'cancelled'`
  - `currentContextTokens` (number): current context consumption
- **Returns**: `{action, text, reason, continuationPrompt, salvaged}`
  - `action`: `'done'|'continue'|'rotate'|'salvage'`
  - `text`: full accumulated text
  - `reason`: string
  - `continuationPrompt`: string or null
  - `salvaged`: `{filePath, content}` or null
- **Logic**:
  1. **Check if should continue**:
     - If `shouldContinue()` returns false: return action='done' with accumulated or passText
  2. **Add pass to continuation**:
     - `continuation.addPass(passText)`
     - If `continue: false` (death spiral/restart):
       - Attempts salvage
       - Returns action='salvage' or 'done'
  3. **Check budget before continuing**:
     - If `budget.getAction() === 'rotate'`:
       - Attempts salvage
       - Returns action='salvage' or 'rotate'
  4. **Proceed with continuation**:
     - Builds continuation prompt
     - Logs and returns action='continue'
- **Purpose**: Post-generation decision on whether to continue, rotate, or salvage

#### `resetContinuation()` (lines 624-626)
- **Parameters**: None
- **Returns**: void
- **Logic**: Calls `continuation.reset()`
- **Purpose**: Reset state for new (non-continuation) generation

#### `getAccumulatedText()` (lines 631-633)
- **Parameters**: None
- **Returns**: `string`
- **Logic**: Returns `continuation.getAccumulatedText()` if active, else ''

---

### Potential Issues & Edge Cases

| Issue | Location | Severity | Description |
|---|---|---|---|
| **Restart detection too broad** | `SeamlessContinuation.addPass()` line 119 | MEDIUM | Comparing first 60 chars could false-positive if model generates same opening structure without intending restart. Exact threshold is fragile. |
| **Death spiral threshold arbitrary** | `SeamlessContinuation.addPass()` line 113 | LOW | 3 consecutive passes < 20 chars is hardcoded. Different models might naturally produce short passes. Should be tunable. |
| **Max continuations hardcoded** | `SeamlessContinuation.reset()` line 66 | LOW | Absolute limit of 50 continuations. For very large outputs (200K tokens), 50 * 4096 = 200K, but each continuation might only be 4000 tokens, requiring 50 passes. Leaves no margin. |
| **15-minute wallclock timeout rigid** | `ContextManager.constructor()` line 476 | MEDIUM | Hardcoded 15 minutes for entire agentic loop. Long-running tasks (analyzing large codebases) might exceed this. Should be configurable. |
| **Compression loses detailed error info** | `ContextCompactor._compressOldToolResults()` line 209 | MEDIUM | Old tool results are summarized (errors → one-line status). If user needs to debug old failure, detail is lost forever. |
| **File write deduplication weak** | `ContextRotator.shouldBlockWrite()` line 320 | LOW | Blocks write if count >= 3. What if legitimate iteration is 4th? Should this be a warning instead of a hard block? |
| **Salvage extraction vulnerable to corruption** | `ContentSalvager.salvageWriteFile()` line 425 | MEDIUM | Manual JSON parsing with escape sequence handling. One off-by-one error in index calculation could fail silently. Should use `JSON.parse` on substring. |
| **Rotation context rebuild stateless** | `ContextRotator.rotate()` line 356 | LOW | Fresh history is built ad-hoc. No validation that it's well-formed (missing user message, malformed role/content). Could cause model inference to fail. |
| **Budget arithmetic during compaction** | `ContextBudget.getAction()` line 46 | LOW | Thresholds use hard percentages (55%, 70%, etc.). With small context windows (8K), 55% = 4400 tokens, compaction might not free enough for a response. |

---

## Cross-File Integration Issues

| Issue | Files Affected | Severity | Description |
|---|---|---|---|
| **Duplicate tracking of work** | `RollingSummary` + `ConversationSummarizer` | MEDIUM | Both classes track completed work separately. If one is corrupted/reset, the other diverges. No master record. |
| **Memory never pruned long-term** | `LongTermMemory` + `SessionStore` | LOW | SessionStore prunes sessions at 7 days, but LongTermMemory only prunes auto-extracted at session cap (50). Old facts could accumulate indefinitely. |
| **No cross-component error propagation** | All files | MEDIUM | Each class catches errors silently (logs to console, ignores error). A cascading failure in one system (e.g., SessionStore disk full) won't surface to caller. |
| **Inconsistent token estimation** | `RollingSummary` (4 chars/token) + `ContextBudget` (3.5 chars/token) + `LongTermMemory` (4 chars/token) | LOW | Different files use different ratios. Small discrepancies could accumulate. Should centralize constant. |
| **No state validation** | All files | LOW | No schema validation at deserialization. Corrupt JSON (missing fields) will silently create incomplete objects. |
| **Rotation summary assembly fragile** | `ContextRotator` + `ConversationSummarizer` + `RollingSummary` | MEDIUM | Three different systems generate summaries. Rotation context could include duplicate/conflicting info if both are active. |

---

## Summary

This audit reveals a well-structured system with clear separation of concerns, but several fragile points and edge cases:

**Strengths**:
- Tiered context management (compaction phases, continuation detection)
- Comprehensive state tracking (rolling summary, conversation ledger, long-term memory)
- Graceful degradation (silent error handling, fallback mechanisms)
- Incremental task detection and progress tracking

**Weaknesses**:
- Silent error handling masks failures
- Fragile pattern matching (restore detection, plan extraction)
- No global state validation or consistency checks
- Token estimation inconsistencies across files
- Hard-coded thresholds and limits without configurability
- Restart detection too sensitive/specific
- Compression/summarization loses detailed information irreversibly

**Critical Paths to Monitor**:
1. `ContextManager.handleGenerationEnd()` + `SeamlessContinuation.addPass()` — continuation logic is complex and fragile
2. `ContextRotator.rotate()` + summary generation — rotation context assembly involves multiple systems
3. `RollingSummary.assembleTieredContext()` — budget allocation during phase assembly could misallocate
4. `LongTermMemory.extractAndSave()` — auto-extraction could create duplicate/redundant facts

---

This is a comprehensive audit of all 5 files with every function, constant, edge case, and cross-file dependency documented.

---

# PART 5 — MEMORY, RAG, MODEL & SETTINGS

# COMPREHENSIVE CODE AUDIT — guIDE Core Modules

**Audit Date:** March 13, 2026  
**Files Audited:** 6 modules in `/main/`

---

## FILE 1: [memoryStore.js](memoryStore.js)

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** Persistent cross-session memory system for the guIDE IDE.  
**Scope:** Stores conversations, project facts, code patterns, and error history in JSON to `<projectRoot>/.ide-memory/memory.json`. Implements debounced persistence (5-second delay).  
**Key Feature:** Tracks up to 200 conversations, 100 errors; Facts and patterns stored as Maps with timestamps.

### 2. IMPORTS & DEPENDENCIES

| Import | Module | Usage |
|--------|--------|-------|
| `fs` | Node.js built-in | File I/O (read/write/sync) for persistence |
| `path` | Node.js built-in | File path resolution and manipulation |
| `log` | `./logger` | Logging for info/warn messages |

### 3. EXPORTED ITEMS

#### **Class: `MemoryStore`**
- **Line Range:** 11–167
- **Type:** Singleton-pattern class (no constructor parameters needed for basic use)
- **Methods:** See detailed breakdown below

#### **Module Export** (Line 167)
```javascript
module.exports = { MemoryStore };
```

### 4. CLASS CONSTRUCTOR & LIFECYCLE

#### **`constructor()` — Lines 11–22**
**Parameters:** None  
**Returns:** MemoryStore instance  
**Logic:**
- Initializes private state:
  - `_basePath`: Directory path for `.ide-memory` folder (null until `initialize()`)
  - `_filePath`: Full path to `memory.json` (null until `initialize()`)
  - `_saveTimer`: Timeout ID for debounced save (null when no save pending)
  - `conversations`: Array [] (stores up to 200)
  - `projectFacts`: Map {} (key → `{value, learnedAt}`)
  - `codePatterns`: Map {} (key → `{pattern, learnedAt}`)
  - `errorHistory`: Array [] (stores up to 100)

**Edge Cases:**
- No validation of input; all properties start as empty/null
- State can be overwritten if `initialize()` is called after construction but before use

---

#### **`initialize(projectPath)` — Lines 26–42**
**Parameters:**
- `projectPath` (string): Root directory of the project

**Returns:** void  
**Logic:**
1. Early return if `projectPath` is falsy (null, undefined, '')
2. Set `_basePath = path.join(projectPath, '.ide-memory')`
3. Set `_filePath = path.join(_basePath, 'memory.json')`
4. Create `.ide-memory` directory recursively
5. Check if `memory.json` exists:
   - If yes: parse JSON and load all collections from disk
   - If no: skip (empty state remains)
6. Log summary: number of conversations and facts loaded

**Side Effects:**
- Creates `.ide-memory/` directory on disk
- Reads `memory.json` if it exists
- Overwrites in-memory state with loaded data

**Error Handling:**
- Try/catch wraps entire operation
- Failures are logged as warnings; state is not corrupted (reverts to empty if parse fails)
- No re-throw; operation is silent on error

**Edge Cases:**
- Called with empty string: early return (no initialization)
- Corrupt JSON in `memory.json`: logged, state resets to empty
- File I/O permission denied: logged as warning
- Multiple calls to `initialize()`: last one wins (overwrites state)

---

#### **`dispose()` — Lines 132–138**
**Parameters:** None  
**Returns:** void  
**Logic:**
1. Clear pending save timer (if any)
2. Call `_save()` immediately (final flush to disk)

**Purpose:** Graceful shutdown. Ensures all pending changes are written before process terminates.

**Side Effects:** Writes to disk immediately

**Edge Cases:**
- Called when no `_basePath` set: `_save()` is no-op (returns early)
- Called multiple times: safe (timer already cleared, second save is no-op if no pending changes)

---

### 5. PUBLIC METHODS — LEARNING

#### **`addConversation(entry)` — Lines 48–56**
**Parameters:**
- `entry` (object): Conversation data to store (any properties)

**Returns:** void  
**Logic:**
1. Add `{timestamp: Date.now(), ...entry}` to `conversations` array
2. Trim to last 200 items if array exceeds length
3. Schedule debounced save

**Data Structure Written:**
```javascript
{
  timestamp: <number>,  // Current UNIX milliseconds
  ...entry              // Spread all properties from entry
}
```

**Edge Cases:**
- `entry` with `timestamp` property: overwritten by the new `Date.now()`
- Very old conversations: silently dropped when exceeding 200
- `entry` is null/undefined: still added (becomes `{timestamp: Date.now()}`)

---

#### **`learnFact(key, value)` — Lines 58–60**
**Parameters:**
- `key` (string): Identifier for the fact
- `value` (any): The fact value

**Returns:** void  
**Logic:**
1. Store in `projectFacts` Map: `{value, learnedAt: Date.now()}`
2. Schedule debounced save

**Data Structure:**
```javascript
projectFacts.set(key, {value, learnedAt: <timestamp>})
```

**Edge Cases:**
- Overwriting existing fact: timestamp updated to now
- `key` or `value` is null/undefined: stored as-is (no validation)
- No size limit on Map; can grow unbounded

---

#### **`learnPattern(key, pattern)` — Lines 62–64**
**Parameters:**
- `key` (string): Identifier for the pattern
- `pattern` (any): The pattern data

**Returns:** void  
**Logic:** Same as `learnFact()`, but stores in `codePatterns` Map with `pattern` property instead of `value`

**Edge Cases:** Same as `learnFact()`

---

#### **`recordError(error)` — Lines 66–75**
**Parameters:**
- `error` (Error | string): Error object or message

**Returns:** void  
**Logic:**
1. Extract message: if string, use directly; if Error object, use `.message`
2. Store: `{timestamp: Date.now(), message, stack: error?.stack}`
3. Trim to last 100 items if exceeds length
4. Schedule debounced save

**Data Structure:**
```javascript
{
  timestamp: <number>,
  message: <string>,
  stack: <string|undefined>  // Only present if error was an Error object
}
```

**Edge Cases:**
- `error` is a string: `stack` property omitted from stored record
- `error` has no `.message`: becomes "undefined" string
- Error stack is huge (millions of chars): stored as-is (no truncation)
- Duplicate errors: stored separately (no de-duplication)

---

### 6. PUBLIC METHODS — QUERYING

#### **`findSimilarErrors(errorMsg)` — Lines 78–83**
**Parameters:**
- `errorMsg` (string): Error message to search for

**Returns:** Array of error records (last 5 matches)  
**Logic:**
1. Return empty array if `errorMsg` is falsy
2. Convert both `errorMsg` and stored message to lowercase
3. Filter errors where stored message includes the query substring
4. Return last 5 matches (slice(-5))

**Search:** Substring-based (case-insensitive, not regex)

**Edge Cases:**
- Empty `errorMsg`: returns []
- No matches: returns []
- Very similar error messages: all returned together (no ranking/scoring)

---

#### **`getContextPrompt()` — Lines 85–101**
**Parameters:** None  
**Returns:** String (multiline text for LLM context)  
**Logic:**
1. Build array of context lines
2. If facts exist: add header + format each fact as `"  - key: value"`
3. If patterns exist: add header + format each pattern as `"  - key: pattern"`
4. Join with newlines; return empty string if nothing collected

**Output Format Example:**
```
Known project facts:
  - projectType: web app
  - framework: React
Known code patterns:
  - errorHandling: try/catch with logging
  - API: async/await
```

**Edge Cases:**
- Empty facts/patterns: returns empty string
- Fact/pattern value contains newlines: not escaped (embedded as-is in output)
- Very long fact/pattern: no truncation (full value included)

---

#### **`getStats()` — Lines 103–109**
**Parameters:** None  
**Returns:** Object with counts: `{conversations, facts, patterns, errors}`

**Logic:** Simple count of each collection size

---

#### **`clear()` — Lines 111–116**
**Parameters:** None  
**Returns:** void  
**Logic:**
1. Empty all collections ([], Map, Map, [])
2. Schedule debounced save

**Effect:** Entire memory purged and persisted to disk as empty

---

#### **`clearConversations()` — Lines 118–120**
**Parameters:** None  
**Returns:** void  
**Logic:**
1. Empty only `conversations` array
2. Schedule debounced save

**Effect:** Facts, patterns, errors retained; only conversation history cleared

---

### 7. PERSISTENCE INTERNALS

#### **`_scheduleSave()` — Lines 124–130**
**Parameters:** None  
**Returns:** void  
**Logic:**
1. If save already scheduled, return early (no duplicate timers)
2. Set `_saveTimer = setTimeout(() => {...}, 5000)`
   - After 5 seconds: clear timer, call `_save()`

**Pattern:** Debouncing. Multiple writes within 5 seconds trigger only ONE disk write.

**Edge Cases:**
- Called during shutdown: may lose data if app crashes before 5-second timeout
- Rapid 200 writes: coalesced into 1 disk write

---

#### **`_save()` — Lines 132–147**
**Parameters:** None  
**Returns:** void  
**Logic:**
1. Early return if `_filePath` not set (never initialized)
2. Build data object: convert Maps to plain objects (JSON-serializable)
   ```javascript
   {
     conversations: [...],
     projectFacts: Object.fromEntries(projectFacts),
     codePatterns: Object.fromEntries(codePatterns),
     errorHistory: [...]
   }
   ```
3. Create temp file: `_filePath + '.tmp'`
4. Write prettified JSON (2-space indent)
5. Rename temp → final (atomic on most filesystems)

**Error Handling:**
- Try/catch wraps file I/O
- Failures logged as warnings; no re-throw

**Why Temp File + Rename?**
- Prevents corruption if process crashes mid-write

**Edge Cases:**
- Disk full: error logged, file not written
- Directory deleted after `initialize()`: error logged
- Concurrent writes from multiple processes: last one wins (no locking)

---

### 8. CONSTANTS & CONFIGURATION

| Constant | Value | Purpose |
|----------|-------|---------|
| Max conversations | 200 | Hard limit per `addConversation()` |
| Max errors | 100 | Hard limit per `recordError()` |
| Save debounce | 5000 ms | Delay before disk write |
| Directory name | `.ide-memory` | Folder path relative to project root |
| File name | `memory.json` | Stores all persistent data |

### 9. POTENTIAL ISSUES, BUGS & EDGE CASES

| Issue | Severity | Description | Impact |
|-------|----------|-------------|--------|
| **No Circular Reference Handling** | Low | If `entry` contains circular references, `JSON.stringify()` throws | `_save()` fails, loss of pending save |
| **Map Size Unbounded** | Medium | `projectFacts` and `codePatterns` have no size limits | Memory leak if learn millions of facts |
| **No Encryption** | High | Memory stored as plaintext JSON | Secrets/tokens visible in `.ide-memory/memory.json` |
| **Race Condition on Multi-Process** | Medium | No file locking; concurrent writes overwrite | Last process wins; previous writes lost |
| **Timestamp Overwrite** | Low | `addConversation()` overwrites `timestamp` in entry | User-provided timestamp lost |
| **Silent Failures on Load** | Medium | Corrupted JSON silently resets state to empty | User unaware data was lost |
| **No Validation of Loaded Data** | Low | Data loaded without type checking | May contain unexpected data types |

---

### 10. CODE FLOW & DEPENDENCIES

```
[MemoryStore]
│
├─ initialize(projectPath)
│  ├─ fs.mkdirSync()
│  ├─ fs.existsSync()
│  └─ JSON.parse(fs.readFileSync())
│
├─ addConversation(entry) → _scheduleSave()
├─ learnFact(key, value) → _scheduleSave()
├─ learnPattern(key, pattern) → _scheduleSave()
├─ recordError(error) → _scheduleSave()
│
└─ _scheduleSave()
   └─ setTimeout() → _save()
      ├─ fs.writeFileSync(tmp)
      └─ fs.renameSync(tmp → final)
```

---

## FILE 2: [ragEngine.js](ragEngine.js)

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** Retrieval-Augmented Generation (RAG) engine for semantic code search.  
**Scope:** Indexes project files into BM25-searchable chunks, caches content in LRU memory, supports full/incremental reindex, and error-context search.  
**Key Features:**
- BM25 relevance scoring with recency boost
- Semantic chunking by function boundaries (for code files)
- 5,000-entry LRU content cache
- File-name search separate from content search
- Error stack trace parsing + identifier extraction

### 2. IMPORTS & DEPENDENCIES

| Import | Module | Usage |
|--------|--------|-------|
| `path` | Node.js built-in | File path handling |
| `fs.promises` | Node.js built-in | Async file I/O |
| `fs` (sync) | Node.js built-in | Sync operations (readFileSync in cache miss) |
| `log` | `./logger` | Info/warn logging |

### 3. CONSTANTS & CONFIGURATION

**Lines 16–35: BM25 Parameters**

| Constant | Value | Purpose |
|----------|-------|---------|
| `BM25_K1` | 1.5 | Tuning parameter: controls TF saturation |
| `BM25_B` | 0.75 | Tuning parameter: controls length normalization |
| `CHUNK_SIZE` | 500 | Lines per chunk (fallback if no function boundaries) |
| `CHUNK_OVERLAP` | 50 | Lines to overlap between chunks (for context) |
| `MAX_FILE_SIZE` | 1 MB | Skip files larger than this |
| `MAX_CACHED` | 5,000 | LRU cache capacity |

**Lines 37–46: File Ignore Patterns**

`IGNORE_RE` array of 28+ regex patterns. Ignores:
- Build artifacts: `node_modules`, `dist`, `build`, `.next`
- Version control: `.git`
- Binaries: `.exe`, `.dll`, `.so`, `.bin`
- Large data: `.gguf`, `.zip`, `.tar`, `.gz`, media files
- Lock files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- IDE memory: `.ide-memory`, `.guide-memory`

**Case Sensitivity:** Patterns applied to relative paths and filenames (case-sensitive on Linux, case-insensitive on Windows by default)

### 4. CLASS STRUCTURE

#### **Constructor — Lines 50–65**
**Parameters:** None  
**Returns:** RAGEngine instance  
**Initialization:**
```javascript
this.index = Map()              // term → Map<docId, {tf, positions}>
this.documents = Map()          // docId → metadata
this.docLengths = Map()         // docId → token count
this.fileIndex = Map()          // filePath → [docId, ...]
this.fileMtimes = Map()         // filePath → modification time (ms)
this._cache = Map()             // docId → cached content (LRU)
this._cacheSize = 0             // current LRU entry count
this.avgDocLength = 0           // average chunk length (for BM25)
this.totalDocs = 0              // total chunks indexed
this.projectPath = null
this.isIndexing = false         // flag: indexing in progress
this.indexProgress = 0          // 0-100 percent
```

**State:** All properties start empty/zero; populated by `indexProject()` or `reindexChanged()`

---

### 5. EXPORTED CLASS

#### **Class: `RAGEngine`**
- **Type:** Instance-based (create once per project)
- **Lifecycle:** `new RAGEngine()` → `initialize()` → `search()` / `reindexChanged()` as needed

---

### 6. PUBLIC METHODS — INDEXING

#### **`indexProject(projectPath, onProgress?)` — Lines 74–103**
**Parameters:**
- `projectPath` (string): Root directory to index
- `onProgress` (optional callback): `(percentDone, itemsDone, totalItems) => void`

**Returns:** Promise<`{indexed, skipped, duration}`> or early return if already indexing

**Logic:**
1. Guard: return if already indexing
2. Set state: `isIndexing = true`, `projectPath = projectPath`, clear all indexes
3. Collect all files in project (recursive, respecting `IGNORE_RE`)
4. Process in batches of 20 files (parallelized with `Promise.all()`)
5. For each file: call `_indexFile()` (catch + ignore errors)
6. Update progress: `percentDone = (done / total) * 100`
7. Recalculate statistics: `_recalcStats()`
8. Log summary: files indexed, chunks created, duration
9. Finally: set `isIndexing = false`

**Batch Processing:** 20 files at a time for parallelism without overwhelming system

**Error Handling:** Errors in individual files are caught and ignored (indexed count skips failed files, but indexing continues)

**Return Value:**
```javascript
{
  totalFiles: 123,
  totalChunks: 456,
  totalTerms: 789
}
```

**Edge Cases:**
- Already indexing: returns `{indexed: 0, skipped: 0, duration: 0}` immediately
- Empty project: `files = []`, returns `{totalFiles: 0, totalChunks: 0, totalTerms: 0}`
- All files fail to read: `totalDocs = 0`, no error thrown

---

#### **`reindexChanged(onProgress?)` — Lines 106–143**
**Parameters:**
- `onProgress` (optional callback): Same signature as `indexProject()`

**Returns:** Promise<`{updated, added, removed}`>

**Logic:**
1. Guard: return `{updated: 0, added: 0, removed: 0}` if already indexing or project not set
2. Collect current files
3. Remove deleted files:
   - Deleted on disk but in index: call `_removeFile()`, increment `removed`
4. Process remaining files in batches:
   - New file (not in `fileMtimes`): index it, increment `added`
   - Modified (mtime newer than cached): remove old index, re-index, increment `updated`
   - Unchanged: skip
5. Recalculate stats, log, return counts

**Change Detection:** Based on modification time (`stat.mtimeMs`), not content hash

**Edge Cases:**
- No project path set: returns early with zeros
- All files unchanged: returns `{updated: 0, added: 0, removed: 0}`
- Files added, deleted, and modified simultaneously: all handled

---

### 7. PUBLIC METHODS — SEARCH

#### **`search(query, maxResults = 10)` — Lines 146–191**
**Parameters:**
- `query` (string): Search query
- `maxResults` (number): Max results to return

**Returns:** Array of results: `[{docId, score, path, relativePath, content, startLine, endLine, lineCount}, ...]`

**Algorithm:**
1. Guard: return [] if no documents indexed
2. Tokenize query: `_tokenize(query)` → lowercase, remove non-alphanumeric, split by whitespace
3. For each term:
   - Lookup postings: `index.get(term)` → `Map<docId, {tf, positions}>`
   - Calculate IDF (inverse document frequency): `log((totalDocs - postingCount + 0.5) / (postingCount + 0.5) + 1)`
   - For each posting: calculate BM25 score and accumulate
4. Apply recency boost:
   - Get file modification time for each scored document
   - Calculate age in hours: `(now - mtime) / 3600000`
   - Boost factor: `1 + 0.3 * exp(-ageHours / 24)` (newer files score higher, asymptotically approaches 1.3x)
5. Sort descending by final score
6. Take top `maxResults`
7. For each result: load content from cache or disk, build response object

**BM25 Formula:**
```
score = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLength / avgDocLength))))
```

**Recency Boost Example:**
- File modified 1 hour ago: boost ≈ 1.29x
- File modified 1 day ago: boost ≈ 1.15x
- File modified 1 week ago: boost ≈ 1.02x

**Edge Cases:**
- Empty query or all terms ignored: `terms = []`, returns []
- Query matches no documents: returns []
- Document deleted after indexing: still in index until reindex; content load may fail

---

#### **`searchFiles(query, maxResults = 20)` — Lines 193–207**
**Parameters:**
- `query` (string): Filename or pattern to search
- `maxResults` (number): Max results

**Returns:** Array of file objects: `[{path, relativePath, score, fileName}, ...]`

**Scoring Logic (exact → prefix → substring → path):**
- Exact filename match: score 100
- Filename starts with query: score 80
- Filename contains query: score 60
- Relative path contains query: score 40
- No match: excluded

**Case Sensitivity:** Comparison is case-insensitive (convert to lowercase)

**Example:**
- Query: `app`
- File: `App.js` → exact match, score 100
- File: `components/Application.tsx` → filename contains, score 60
- File: `src/app/index.js` → path contains, score 40

**Edge Cases:**
- Query with special regex chars: treated as literal string (no regex)
- Very long filenames: no truncation in comparison

---

#### **`getContextForQuery(query, maxChunks = 5, maxTokens = 3000)` — Lines 210–227**
**Parameters:**
- `query` (string): Search query
- `maxChunks` (number): Max chunks to return
- `maxTokens` (number): Max tokens budget

**Returns:** Promise<`{chunks, totalTokens, filesSearched, chunksSearched}`>

**Logic:**
1. Search: `search(query, maxChunks * 3)` → get 3x more results than requested
2. Calculate threshold: top result's score × 0.25 (or 1.5, whichever is higher)
3. Filter results by threshold, accumulate chunks:
   - Estimate tokens: `Math.ceil(content.length / 4)` (rough estimate: 1 token ≈ 4 chars)
   - Stop if adding next chunk would exceed `maxTokens`
   - Stop if reached `maxChunks`
4. Return chunks array + metadata

**Threshold Logic:** Ensures only top-relevance results are included

**Token Estimation:** Very rough (assumes avg 4 chars/token); real tokenization may differ ±30%

**Edge Cases:**
- Very short query: few results, threshold low
- High `maxTokens`: may return fewer chunks if content runs out
- Zero results: returns `{chunks: [], totalTokens: 0, ...}`

---

#### **`findErrorContext(errorMessage, stackTrace = '')` — Lines 230–255**
**Parameters:**
- `errorMessage` (string): Error message
- `stackTrace` (optional string): Stack trace

**Returns:** Object `{results, fileReferences, identifiers}`

**Algorithm:**
1. Parse file references from combined text using regex: `/(?:at\s+.*?\s+\()?([path]):(\d+)(?::(\d+))?\)?/g`
   - Extracts: path, line number, optional column number
   - Supports both Windows and Unix paths
2. Extract identifiers (symbols) from error text:
   - Regex: `/\b([a-zA-Z_$][a-zA-Z0-9_$]{2,})\b/g` (min 3 chars)
   - Skip reserved words: undefined, null, function, const, Error, TypeError, etc.
   - De-duplicate
3. Search codebase: `search([identifiers] + errorMessage, maxResults=10)`
4. Boost score for results that match file references:
   - If file path in result matches stack trace file path: multiply score by 3
5. Sort by boosted score, return top 5

**Example:**
```
Error: Cannot read property 'map' of undefined
At productList.js:42:10
At ./components/ProductList.js:1:15

Output:
{
  results: [{file: 'productList.js', score: ...}, ...],
  fileReferences: [{path: 'productList.js', line: 42, col: 10}, ...],
  identifiers: ['productList', 'PropertyError', 'Cannot', 'map']
}
```

**Edge Cases:**
- Stack trace with no file references: searches on identifiers alone
- Very generic error message: many identifier matches (low precision)
- File path in stack trace doesn't exist: still boosts matching results

---

### 8. MISCELLANEOUS METHODS

#### **`getFileContent(filePath)` — Lines 258–259**
**Parameters:**
- `filePath` (string): Absolute or relative path

**Returns:** Promise<string | null> (null if file not found or can't read)

**Logic:** Single `readFile()` call

---

#### **`getProjectSummary()` — Lines 261–273**
**Parameters:** None  
**Returns:** Object `{projectPath, totalFiles, totalChunks, directories: [], files: []}`

**Logic:**
1. List all indexed files: `fileIndex.keys()`
2. Extract relative paths (relative to projectPath)
3. Build directory set: for each file, add all parent directories (e.g., `a/b/c` → add `a`, `a/b`)
4. Sort both arrays
5. Return summary

**Example Output:**
```javascript
{
  projectPath: '/home/user/myproject',
  totalFiles: 42,
  totalChunks: 156,
  directories: ['src', 'src/components', 'src/utils'],
  files: ['src/app.js', 'src/app.test.js', ...]
}
```

---

#### **`getStatus()` — Lines 275–277**
**Parameters:** None  
**Returns:** `{isIndexing, indexProgress, totalFiles, totalChunks, totalTerms, projectPath}`

**Purpose:** Real-time indexing status query (for UI progress bars)

---

#### **`clear()` — Lines 279–280**
**Parameters:** None  
**Returns:** void

**Logic:** Calls `_clear()` to wipe all indexes

---

### 9. INTERNAL METHODS — INDEXING

#### **`_clear()` — Lines 283–288**
**Parameters:** None  
**Returns:** void

**Logic:** Reset all maps and counters to empty state

---

#### **`_recalcStats()` — Lines 290–296**
**Parameters:** None  
**Returns:** void

**Logic:**
1. Sum all document lengths: `total = sum(docLengths.values())`
2. Set `totalDocs = documents.size`
3. Calculate average: `avgDocLength = total / totalDocs` (or 0 if no docs)

**Used after:** indexing, reindexing, file removal

---

#### **`_removeFile(filePath)` — Lines 298–310**
**Parameters:**
- `filePath` (string): File to remove from index

**Returns:** void

**Logic:**
1. Get all chunk IDs for this file: `docIds = fileIndex.get(filePath)`
2. For each chunk ID:
   - Remove from all term postings: iterate `index`, delete posting for docId
   - If posting becomes empty, delete the term entry
   - Delete document metadata: `documents`, `docLengths`
   - Remove from cache (decrement cache size)
3. Delete file from `fileIndex` and `fileMtimes`

**Cleanup:** Tidies up empty term entries (no orphaned keys)

**Edge Cases:**
- File never indexed: returns early (docIds is undefined)
- Cache entry for this file: removed

---

#### **`_collectFiles(dir, out = [])` — Lines 312–331**
**Parameters:**
- `dir` (string): Directory to scan (recursive)
- `out` (array): Accumulator (default [])

**Returns:** Promise<array of absolute file paths>

**Logic:**
1. Async readdir with file types
2. For each entry:
   - Skip if filename matches `IGNORE_RE`
   - If directory: recurse (skip hidden dirs `.`)
   - If file: check size (>0 and ≤1MB), add to output if valid
3. Return output array

**Recursion:** Unbounded depth (no cycle detection; assumes no symlinks)

**Edge Cases:**
- Permission denied on directory: caught, returns accumulated files so far
- File disappears between readdir and stat: caught, skipped
- Symlinks: followed (can cause infinite loops if pointing to parent dirs)

---

#### **`_indexFile(filePath)` — Lines 333–389**
**Parameters:**
- `filePath` (string): Absolute path to file

**Returns:** Promise<void>

**Logic:**
1. Read file as UTF8 text
2. Get file mtime: `stat()`, store in `fileMtimes`
3. Split lines: `content.split('\n')`
4. For code files (JS, TS, Python, etc., size > CHUNK_SIZE lines):
   - Find function boundaries: `_findFunctionBoundaries(lines)`
   - If boundaries found and > 1: semantic chunking (by functions)
     - For each boundary region: split into chunks sized CHUNK_SIZE, but merge small chunks (<30 lines) with next boundary
     - Split oversized chunks (>CHUNK_SIZE) back into fixed-size pieces
   - Else: fallback to fixed-size chunking
5. For non-code or small files: fixed-size chunking
6. For each chunk: call `_addChunk()`

**Chunking Logic (Semantic):**
- Attempts function-level chunks
- Oversized functions (>500 lines) are split
- Small functions (< 30 lines) merged with neighbors

**Chunking Logic (Fixed-Size Fallback):**
- 500-line chunks with 50-line overlap

**Edge Cases:**
- File disappears during read: error caught by caller
- Single huge function (10K lines): split into multiple 500-line chunks
- File with no functions: fallback to fixed-size

---

#### **`_addChunk(filePath, lines, start, end, docIds)` — Lines 391–419**
**Parameters:**
- `filePath` (string): Source file absolute path
- `lines` (array): All lines of the file
- `start` (number): Start line index (0-based)
- `end` (number): End line index (exclusive; 0-based)
- `docIds` (array): Accumulator to collect new chunk IDs

**Returns:** void (mutates `docIds`, `documents`, `index`)

**Logic:**
1. Extract chunk: `lines.slice(start, end).join('\n')`
2. Create unique docId: `${filePath}:${start}-${end}`
3. Store metadata: `documents.set(docId, {path, relativePath, startLine, endLine, lineCount})`
4. Cache chunk: `_putCache(docId, chunk)`
5. Tokenize chunk: `_tokenize(chunk)` → array of tokens
6. Store doc length: `docLengths.set(docId, tokenCount)`
7. Build term frequency map:
   - For each token (position-aware), track count and positions in chunk
8. Update inverted index:
   - For each term: create posting set if needed, add `{tf, positions}` for this docId
9. Add docId to accumulator

**Inverted Index Structure:**
```javascript
index: {
  'function': Map {
    'path/to/file.js:0-50': {tf: 3, positions: [5, 12, 18]},
    'path/to/file.js:40-90': {tf: 1, positions: [2]}
  }
}
```

---

#### **`_findFunctionBoundaries(lines)` — Lines 421–440**
**Parameters:**
- `lines` (array): All lines of file

**Returns:** Array of line indices (0-based) where functions/classes start, or null if no boundaries found

**Regex Pattern:** Detects:
- Function declarations: `function name()`, `const name = () =>`, `const name = function`
- Class declarations: `class Name`
- Method declarations: `methodName()`, `public async method()`
- Python functions: `def name()`
- Go functions: `func name()`

**Logic:**
1. Always include line 0 (start)
2. For each line:
   - Trim leading whitespace
   - Test regex against trimmed line
   - Only add if indentation ≤ 4 spaces (top-level/shallow nesting)
3. Return boundaries if found > 1, else null

**Edge Cases:**
- Function-like comments: may be detected (false positives)
- Multiline function signatures: only detects if opening parenthesis on same line
- Template strings with `function`: may cause false detection

---

### 10. LRU CACHE MANAGEMENT

#### **`_putCache(docId, content)` — Lines 442–451**
**Parameters:**
- `docId` (string): Unique chunk ID
- `content` (string): Chunk content

**Returns:** void

**Logic:**
1. If docId already cached: remove and re-insert (moves to end of LRU order)
2. If new: insert and increment size count
3. While size > MAX_CACHED (5000): remove oldest entry (first in Map iteration order)

**LRU Eviction:** FIFO on Map keys (JavaScript Maps maintain insertion order)

---

#### **`_getContent(docId, doc)` — Lines 453–470**
**Parameters:**
- `docId` (string): Chunk ID
- `doc` (object): Document metadata `{path, startLine, endLine}`

**Returns:** String (chunk content) or error message

**Logic:**
1. If in cache:
   - Delete then re-insert (LRU move to end)
   - Return cached content
2. If not in cache:
   - Read file from disk (sync): `fs.readFileSync(doc.path, 'utf8')`
   - Split lines, extract range, join
   - Insert into cache (may evict oldest)
   - Return content
3. If file can't be read: return error message

**Fallback to Disk:** Enables LRU cache to be memory-efficient; chunks are re-read if evicted

**Edge Cases:**
- File deleted after indexing: error message returned
- File modified after indexing: new content returned (may not match indexed version)

---

### 11. TOKENIZER HELPER

#### **`_tokenize(text)` — Lines 472–474**
**Parameters:**
- `text` (string): Text to tokenize

**Returns:** Array of tokens

**Logic:**
1. Lowercase
2. Replace non-alphanumeric/underscore/hyphen/dot with spaces
3. Split on whitespace
4. Filter empty tokens and tokens < 2 chars

**Example:**
```
"function handleClick(event, data.map)" →
["function", "handleclick", "event", "data", "map"]
```

**Edge Cases:**
- Empty string: returns []
- Only special characters: returns []
- Very long token (1000 chars): kept as-is, no truncation

---

### 12. POTENTIAL ISSUES & BUGS

| Issue | Severity | Description | Impact |
|-------|----------|-------------|--------|
| **Symlinks Cause Infinite Loop** | High | `_collectFiles()` follows symlinks without cycle detection | Indexing hangs if project contains circular symlinks |
| **Race Condition on Reindex** | Medium | `isIndexing` flag can be race-conditioned in concurrent calls | Multiple reindex operations may run simultaneously |
| **Function Boundary Regex False Positives** | Medium | Regex matches function-like patterns in comments/strings | Chunking boundaries incorrect for such files |
| **No Content Validation After Load** | Low | File modified after indexing; search returns outdated content | Search results may not match current file state |
| **Memory Bloat from Large Identifiers** | Low | If error message has very long identifier names, index explodes | Large memory footprint for projects with minified/mangled code |
| **No Collation/Stemming** | Low | Token matching is exact (no stemming, case-insensitive only) | "run" and "running" are separate tokens; missed relevant results |
| **Thread-Unsafe Index Operations** | High | Maps not protected; concurrent calls to `index`, `documents`, etc. corrupt state | Index corruption if used in async context without locks |

---

### 13. CODE FLOW & DEPENDENCIES

```
[RAGEngine]
├─ indexProject(projectPath, onProgress?)
│  ├─ _collectFiles(projectPath)
│  └─ _indexFile(filePath) × 20 (parallel)
│     ├─ _findFunctionBoundaries(lines)
│     └─ _addChunk(...)
│        ├─ _putCache(docId, chunk)
│        └─ _tokenize(chunk)
│
├─ search(query, maxResults)
│  ├─ _tokenize(query)
│  └─ [BM25 scoring] + [recency boost]
│     └─ _getContent(docId) [cache hit] or [disk reload]
│
└─ findErrorContext(errorMessage, stackTrace)
   └─ search([identifiers + message])
```

---

## FILE 3: [modelManager.js](modelManager.js)

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** Scans for GGUF model files, manages model registry, watches for changes.  
**Scope:** Detects models in `models/` directory and user-added paths. Watches for new files and emits `'models-updated'` event. Provides default model selection with priority-based matching.  
**Key Features:**
- EventEmitter-based model discovery
- File system watcher for dynamic model detection
- Model metadata parsing (quantization, parameters, family)
- Priority-based default model selection

### 2. IMPORTS & DEPENDENCIES

| Import | Module | Usage |
|--------|--------|-------|
| `path` | Node.js built-in | File path operations |
| `fs.promises` | Node.js built-in | Async file I/O (stat, readdir) |
| `fs` (sync) | Node.js built-in | Sync file existence checks |
| `EventEmitter` | Node.js events | Base class for model discovery events |
| `detectModelType` | `./modelDetection` | Determine model type from file (custom function) |
| `log` | `./logger` | Info/warn/error logging |

### 3. CLASS CONSTRUCTOR & LIFECYCLE

#### **`constructor(appPath)` — Lines 12–25**
**Parameters:**
- `appPath` (string): Application root directory

**Returns:** ModelManager instance (extends EventEmitter)

**Initialization:**
```javascript
this.appPath = appPath
this.modelsDir = path.join(appPath, 'models')
this.configPath = path.join(appPath, 'model-config.json')
this.availableModels = []                // Registry of detected models
this.customModelPaths = []               // User-added model paths (persisted)
this.activeModelPath = null              // Currently selected model
this._watcher = null                     // File system watcher handle
this._scanTimeout = null                 // Debounce timer for rescan
```

---

#### **`initialize()` — Lines 29–38**
**Parameters:** None  
**Returns:** Promise<array of model objects>

**Logic:**
1. Load custom model paths from config: `_loadConfig()`
2. Create `models/` directory if needed
3. Scan for models: `scanModels()`
4. Start watcher: `_watchModelsDir()`
5. Return `availableModels` array

**Side Effects:** Creates models directory, starts file watcher

---

#### **`dispose()` — Lines 40–42**
**Parameters:** None  
**Returns:** void

**Logic:**
1. Close watcher if active: calls `_watcher.close()`
2. Clear pending scan timeout

**Purpose:** Clean shutdown (prevents file handle leaks)

---

### 4. PUBLIC METHODS — SCANNING

#### **`scanModels()` — Lines 46–56**
**Parameters:** None  
**Returns:** Promise<array of model objects>

**Logic:**
1. Reset `availableModels = []`
2. Scan `models/` directory recursively
3. Scan app root directory (non-recursive) for backward compat
4. Scan all custom model paths: `_addSingleModel()` for each
5. Sort by name: `availableModels.sort((a,b) => a.name.localeCompare(b.name))`
6. Emit event: `'models-updated'` with the array
7. Return array

**Event:** `'models-updated'`, listeners receive `availableModels` array

---

#### **`_scanDir(dirPath, recursive = false)` — Lines 58–85**
**Parameters:**
- `dirPath` (string): Directory to scan
- `recursive` (boolean): Whether to traverse subdirectories

**Returns:** Promise<void> (mutates `availableModels`)

**Logic:**
1. Async readdir with file types
2. For each entry:
   - If `.gguf` file:
     - Skip if already in registry (check by fullPath)
     - Get stats (size, mtime)
     - Parse metadata: `_parseModelName(fileName)`
     - Detect type: `detectModelType(fullPath)`
     - Add to registry
   - If directory and recursive and not hidden:
     - Recurse into directory
3. Catch errors: early return (skip broken directories)

**Model Object Structure:**
```javascript
{
  name: "model-name",
  fileName: "model-name.gguf",
  path: "/absolute/path/to/model-name.gguf",
  size: 5368709120,
  sizeFormatted: "5.0 GB",
  modified: <Date>,
  directory: "/absolute/path/to/directory",
  details: {quantization, parameters, family},
  modelType: "llm" | "embedding" | ...
}
```

---

#### **`_addSingleModel(filePath)` — Lines 87–110**
**Parameters:**
- `filePath` (string): Absolute path to a model file

**Returns:** Promise<model object | null>

**Logic:**
1. Guard: return null if not `.gguf` extension
2. Guard: return null if file doesn't exist (sync check)
3. Guard: return null if already in registry
4. Get stats: size, mtime
5. Parse name and metadata
6. Mark as custom: `isCustom: true`
7. Build model object (same structure as `_scanDir`)
8. Add to registry
9. Return model object

**Error Handling:** Catch exceptions during stat, log as warning, return null

---

### 5. PUBLIC METHODS — ADD / REMOVE

#### **`addModels(filePaths)` — Lines 114–125**
**Parameters:**
- `filePaths` (array of strings): Absolute paths to model files

**Returns:** Promise<array of actually added model objects>

**Logic:**
1. For each path:
   - Skip if already in `customModelPaths`
   - Add to `customModelPaths`
   - Call `_addSingleModel()` to scan and add to registry
   - If successful, push result to `added` array
2. Save config: `_saveConfig()`
3. Resort: `availableModels.sort()`
4. Emit event: `'models-updated'`
5. Return `added` array

---

#### **`removeModel(filePath)` — Lines 127–132**
**Parameters:**
- `filePath` (string): Model file to remove

**Returns:** Promise<void>

**Logic:**
1. Remove from custom paths list: filter out `filePath`
2. Remove from available models: filter out by path
3. Save config
4. Emit event: `'models-updated'`

---

### 6. PUBLIC METHODS — DEFAULT MODEL SELECTION

#### **`getDefaultModel()` — Lines 136–169**
**Parameters:** None  
**Returns:** Model object | null

**Logic:**
1. Guard: return null if no models available
2. Try preferred patterns (priority order):
   - `qwen3.*4b.*function.*call` — Qwen 4B with function calling
   - `qwen2\.5.*7b.*instruct.*1m.*thinking` — Qwen 2.5 7B reasoning
   - `qwen3.*coder.*30b.*a3b` — Qwen Coder 30B (expert)
   - `qwen3.*30b.*a3b.*thinking` — Qwen 30B expert with thinking
   - `deepseek.*r1` — DeepSeek R1
   - `qwen3.*vl` — Qwen 3 Vision-Language
   - `qwen.*3.*vl` — Qwen 3 Vision-Language (alternate)
   - `deepseek` — Any DeepSeek
   - `qwen3.*coder` — Qwen 3 Coder (any size)
   - `qwen3` — Any Qwen 3
   - `qwen.*3` — Qwen with 3 in name
3. For each pattern:
   - Find first model matching regex (case-insensitive)
   - Return if found
4. Fallback logic:
   - Prefer models in `models/` directory
   - Filter candidates by size: < 50% of total RAM
   - Sort by size (largest first)
   - Return largest that fits

**Ranking Rationale:** Specialized models (function-calling, reasoning, vision, coding) ranked highest; fallback is largest available

**Edge Cases:**
- All models too large for 50% RAM threshold: returns largest regardless
- No patterns match and no models in `models/`: returns models from custom paths
- Single model: returned regardless of pattern matching

---

#### **`getModel(modelPath)` — Lines 171–173**
**Parameters:**
- `modelPath` (string): Absolute path to model

**Returns:** Model object | undefined

**Logic:** Simple find: `availableModels.find(m => m.path === modelPath)`

---

### 7. PERSISTENCE

#### **`_loadConfig()` — Lines 177–185**
**Parameters:** None  
**Returns:** Promise<void> (mutates `customModelPaths`)

**Logic:**
1. Read JSON from `configPath` (model-config.json)
2. Extract `customModelPaths` array (default [])
3. Catch errors: set to empty array

**File Format:**
```json
{
  "customModelPaths": [
    "/path/to/model1.gguf",
    "/path/to/model2.gguf"
  ]
}
```

---

#### **`_saveConfig()` — Lines 187–193**
**Parameters:** None  
**Returns:** Promise<void>

**Logic:**
1. Build object: `{customModelPaths: [...]}` 
2. Write to configPath with 2-space indent
3. Catch errors: log warning, return

---

### 8. FILE SYSTEM WATCHING

#### **`_watchModelsDir()` — Lines 196–210**
**Parameters:** None  
**Returns:** void

**Logic:**
1. Close existing watcher if active
2. Guard: if `modelsDir` doesn't exist, return early (no watch)
3. Create file system watcher: `fs.watch(modelsDir, persistent: false)`
   - Listen for 'change' events
   - Filter: only react to files ending with `.gguf`
4. On change:
   - Clear pending rescan timeout
   - Schedule rescan after 1 second (debounce quick repeated changes)
   - Call `scanModels()`
5. Catch watch setup errors: log warning

**Debouncing:** Coalesces multiple file system events (create, modify) into single scan

**Event Listener:** Non-persistent watch (doesn't keep process alive)

**Edge Cases:**
- File system watcher fails to create: logged, no watch active
- Directory deleted during operation: watch may fire events or error
- Windows file locking: multiple brief change events (debounce handles this)

---

### 9. HELPER FUNCTIONS

#### **`_formatSize(bytes)` — Lines 214–220**
**Parameters:**
- `bytes` (number): File size in bytes

**Returns:** String (formatted, e.g., "5.0 GB")

**Logic:**
1. Define units: `['B', 'KB', 'MB', 'GB', 'TB']`
2. Divide by 1024 while size ≥ 1024 (max 5 iterations)
3. Format: `${size.toFixed(1)} ${unit}`

**Example:**
- 5368709120 bytes → 5.0 GB
- 1024 bytes → 1.0 KB
- 512 bytes → 512.0 B

---

#### **`_parseModelName(filename)` — Lines 222–245**
**Parameters:**
- `filename` (string): Model filename (e.g., "Qwen3-7B-Q8_0.gguf")

**Returns:** Object `{quantization, parameters, family}`

**Logic:**
1. Lowercase filename for case-insensitive matching
2. Extract quantization: regex `/q[0-9]+_[a-z0-9]+|f16|f32/i`
   - Matches: Q8_0, Q6_K, F16, f32, etc.
3. Extract parameters: regex `/(\d+\.?\d*)[bm]/i`
   - Matches: 7B, 30B, 4.5M, etc.
4. Detect family: loop through families list
   - Families: Llama, Mistral, Qwen, DeepSeek, Phi, Gemma, etc.
   - Return first match (capitalize first letter)
5. Default: all fields to 'unknown'

**Example:**
- Input: "Qwen3-7B-Q8_0.gguf"
- Output: `{quantization: "Q8_0", parameters: "7B", family: "Qwen"}`

**Edge Cases:**
- Filename with no pattern matches: all "unknown"
- Multiple families in name (e.g., "Llama-Mistral-7B"): first match wins
- Malformed quantization: not matched (stays "unknown")

---

### 10. EVENT SYSTEM

**Inherited from EventEmitter:**

#### **`emit('models-updated', availableModels)` — Emitted at:**
- End of `scanModels()` (line 52)
- After `addModels()` (line 123)
- After `removeModel()` (line 130)

**Payload:** Array of all available model objects

**Listeners:** External code can subscribe: `modelManager.on('models-updated', (models) => {...})`

---

### 11. POTENTIAL ISSUES & BUGS

| Issue | Severity | Description | Impact |
|-------|----------|-------------|--------|
| **File Watcher Doesn't Restart on Permission Change** | Low | If `modelsDir` becomes inaccessible, watcher still running but no events | New models added to inaccessible directory not detected |
| **Regex Pattern Duplication in Preferences** | Low | Multiple patterns try to match similar model families (e.g., Qwen variants) | Inefficient pattern matching; first-match wins may not be optimal |
| **50% RAM Threshold Hardcoded** | Medium | Fallback model size logic assumes 50% RAM is safe threshold | May be too conservative or too aggressive depending on system |
| **No Locking on Model Registry** | Medium | Race condition if `scanModels()` called concurrently | Duplicate entries or corrupted registry |
| **File Stat During Scan May Stale** | Low | File could be deleted between readdir and stat | Error caught but file won't be added (expected) |
| **Custom Path Persisted Without Validation** | Medium | If user adds invalid path, reloading persists empty custom model list | User confusion if expected models disappear |
| **Model Type Detection Delegated** | Low | `detectModelType()` is external; unknown behavior if it fails/returns unexpected value | Model object may have undefined/null `modelType` |

---

### 12. CODE FLOW & DEPENDENCIES

```
[ModelManager (EventEmitter)]
│
├─ initialize()
│  ├─ _loadConfig()
│  ├─ fs.promises.mkdir()
│  ├─ scanModels()
│  │  ├─ _scanDir(modelsDir, recursive=true)
│  │  ├─ _scanDir(appPath, recursive=false)
│  │  └─ _addSingleModel() × customModelPaths.length
│  └─ _watchModelsDir()
│     └─ fs.watch() → [on change] → scanModels()
│
├─ addModels(filePaths)
│  ├─ _addSingleModel(filePath)
│  ├─ _saveConfig()
│  └─ emit('models-updated')
│
├─ getDefaultModel()
│  └─ [regex matching] → [fallback sizing]
│
└─ dispose()
   └─ watcher.close()
```

---

## FILE 4: [settingsManager.js](settingsManager.js)

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** IPC handler registry for settings and chat session persistence.  
**Scope:** Manages user settings (saved to `<userData>/settings.json`) and chat sessions (saved to `<userData>/chat-sessions.json`). Provides IPC handlers for reading/writing settings, model selection, system prompt preview, and session management.  
**Key Features:**
- Factory pattern: creates settings handler objects
- IPC-based: Electron main process handlers
- Atomic writes: temp file + rename pattern
- JSON serialization: human-readable, versioning-capable

### 2. IMPORTS & DEPENDENCIES

| Import | Module | Usage |
|--------|--------|-------|
| `fs` | Node.js built-in | Sync file I/O for settings persistence |
| `path` | Node.js built-in | Path resolution |
| `ipcMain` | Electron | Main process IPC responders |
| `app` | Electron | Access user data directory |
| `log` | `./logger` | Info/error logging |

### 3. HELPER FUNCTIONS

#### **`_settingsPath()` — Lines 11–13**
**Parameters:** None  
**Returns:** String (absolute path)

**Logic:** `path.join(app.getPath('userData'), 'settings.json')`

**Platform-Specific Paths:**
- Windows: `C:\Users\<username>\AppData\Roaming\<appName>\settings.json`
- macOS: `~/Library/Application Support/<appName>/settings.json`
- Linux: `~/.config/<appName>/settings.json`

---

#### **`_chatSessionsPath()` — Lines 15–17**
**Parameters:** None  
**Returns:** String (absolute path)

**Logic:** `path.join(app.getPath('userData'), 'chat-sessions.json')`

---

#### **`_readJson(filePath)` — Lines 19–25**
**Parameters:**
- `filePath` (string): Absolute path to JSON file

**Returns:** Parsed object | null

**Logic:**
1. Try: read file as UTF-8, parse JSON
2. Catch: return null (file missing or invalid JSON)

**Error Handling:** Silent failure (no logging); used for optional config files

---

#### **`_writeJson(filePath, data)` — Lines 27–30**
**Parameters:**
- `filePath` (string): Write destination
- `data` (object): Data to serialize

**Returns:** void (throws on error)

**Logic:**
1. Write to temp file: `${filePath}.tmp`
2. Rename temp → final (atomic on POSIX, mostly atomic on Windows)

**Purpose:** Atomic writes prevent corruption if process crashes mid-write

**Edge Cases:**
- Directory doesn't exist: throws (caller must create parent dir)
- Disk full: throws
- concurrent `_writeJson()` calls to same file: race condition (last write wins)

---

### 4. FACTORY & SETUP

#### **`createSettingsManager(ctx)` — Lines 35–50**
**Parameters:**
- `ctx` (unused): Context object (passed but not used)

**Returns:** Object with `{_readConfig, _writeConfig}` functions

**Logic:**

**`_readConfig()`:** Reads from `_settingsPath()`, returns empty object if missing or invalid

**`_writeConfig(settings)`:** Writes to disk, returns `{success: true/false, error?: string}`

**Pattern:** Factory that creates closures for read/write operations

---

#### **`registerSettingsHandlers(ctx)` — Lines 52–117**
**Parameters:**
- `ctx` (unused): Context object

**Returns:** void (registers all IPC handlers)

**Logic:** Creates settings manager via factory, then registers IPC handlers on `ipcMain`

---

### 5. IPC HANDLERS

#### **Lifecycle Handlers**

**`'save-settings'` Handler** (Line 56)
```javascript
ipcMain.handle('save-settings', (_evt, settings) => _writeConfig(settings))
```
- **Params:** settings object (any structure)
- **Returns:** `{success: true}` or `{success: false, error}`
- **Effect:** Persists all settings to disk

---

**`'load-settings'` Handler** (Line 57)
```javascript
ipcMain.handle('load-settings', () => _readConfig())
```
- **Params:** None
- **Returns:** Settings object (empty if never saved)

---

#### **Model Selection Handlers**

**`'set-last-used-model'` Handler** (Lines 60–66)
- **Params:** `modelPath` (string | null)
- **Returns:** Result from `_writeConfig()`
- **Effect:** Saves `{lastUsedModel: modelPath}` to disk
- **Use Case:** Remember which model the user last ran

---

**`'get-last-used-model'` Handler** (Line 68)
- **Params:** None
- **Returns:** String (model path) | null
- **Logic:** Read config, return `config.lastUsedModel || null`

---

**`'set-default-model'` Handler** (Lines 71–77)
- **Params:** `modelPath` (string | null)
- **Returns:** `_writeConfig()` result
- **Effect:** Saves `{defaultModelPath: modelPath}` to disk
- **Use Case:** User-preferred model for new chats

---

**`'get-default-model'` Handler** (Line 79)
- **Params:** None
- **Returns:** String (model path) | null
- **Logic:** Read config, return `config.defaultModelPath || null`

---

#### **System Prompt Handler**

**`'get-system-prompt-preview'` Handler** (Lines 82–87)
```javascript
ipcMain.handle('get-system-prompt-preview', (_evt, opts) => {
  const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE } = require('./constants');
  const compact = opts?.compact;
  return compact ? DEFAULT_COMPACT_PREAMBLE : DEFAULT_SYSTEM_PREAMBLE;
})
```
- **Params:** `opts` object with `compact` boolean
- **Returns:** String (preamble text for display in UI)
- **Logic:** Return compact or full system prompt based on option
- **Dependencies:** Requires constants module to be loaded (dynamic require)
- **Edge Case:** If constants module missing, throws

---

#### **Chat Session Handlers**

**`'save-chat-sessions'` Handler** (Lines 91–96)
- **Params:** `sessions` (array of session objects)
- **Returns:** `{success: true/false, error?}`
- **Effect:** Persists session array to disk

**Session Structure (expected):**
```javascript
[
  {
    id: "uuid",
    title: "Session title",
    timestamp: <ms>,
    messages: [...],
    ...
  }
]
```

---

**`'load-chat-sessions'` Handler** (Line 98)
- **Params:** None
- **Returns:** Array of sessions | []
- **Logic:** Read from disk, default to empty array if missing

---

**`'delete-chat-session'` Handler** (Lines 100–106)
- **Params:** `sessionId` (string)
- **Returns:** `{success: true/false, error?}`
- **Logic:**
  1. Load all sessions
  2. Filter out session with matching ID
  3. Save filtered list back to disk

**Edge Cases:**
- Session ID not found: still succeeds (no-op)
- Empty sessions list before delete: still succeeds

---

### 6. INITIALIZATION

**Line 109:** Log that handlers registered

---

### 7. MODULE EXPORTS

```javascript
module.exports = { createSettingsManager, registerSettingsHandlers };
```

### 8. POTENTIAL ISSUES & BUGS

| Issue | Severity | Description | Impact |
|-------|----------|-------------|--------|
| **No Input Validation on Settings** | Medium | Settings object accepted as-is; no schema validation | Invalid/malicious settings could corrupt stored state or UI |
| **Race Condition on Concurrent Writes** | High | Multiple IPC calls to save-settings simultaneously | Last write wins; intermediate writes lost |
| **No File Locking** | High | Concurrent main process and renderer writes possible | File corruption if both write simultaneously |
| **User Directory May Not Exist** | Low | `app.getPath('userData')` directory might not be created | `_writeJson()` throws if parent directory missing |
| **No Settings Schema Version** | Medium | If settings structure changes, no migration path | Old clients have incompatible cached settings |
| **Constants Module Dynamic Require** | Low | `require('./constants')` in handler may fail if module not found | `get-system-prompt-preview` handler crashes |
| **Session ID Collision** | Low | No check for duplicate session IDs | Multiple sessions with same ID possible if manually created |
| **No Backup of Settings Before Write** | Low | Atomic write via temp file but no backup if disk full | Data loss if disk fills during save |

---

### 9. CODE FLOW & DEPENDENCIES

```
[settingsManager]
│
├─ createSettingsManager(ctx)
│  ├─ _readConfig() → fs.readFileSync() → JSON.parse()
│  └─ _writeConfig(settings) → _writeJson() → fs.writeFileSync()
│
├─ registerSettingsHandlers(ctx) → createSettingsManager()
│  └─ [Multiple ipcMain.handle() registrations]
│     ├─ save-settings → _writeConfig()
│     ├─ load-settings → _readConfig()
│     ├─ set-last-used-model → _writeConfig()
│     ├─ get-last-used-model → _readConfig()
│     ├─ set-default-model → _writeConfig()
│     ├─ get-default-model → _readConfig()
│     ├─ get-system-prompt-preview → require('./constants')
│     ├─ save-chat-sessions → _writeJson()
│     ├─ load-chat-sessions → _readJson()
│     └─ delete-chat-session → _readJson() + _writeJson()
```

---

## FILE 5: [mcpToolServer.js](mcpToolServer.js) — PARTIAL AUDIT

**Note:** This file is 2,300+ lines. Comprehensive audit follows for all exported/public interfaces and key internals. Some implementation details of individual tools are deferred.

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** Model Context Protocol (MCP) server providing 100+ tools for agent autonomy.  
**Scope:** Browser automation, file operations, web search, code execution, git operations, memory persistence, custom tool creation, and checkpoint/undo system.  
**Architecture:** Single MCPToolServer class with tool definition registry, execution dispatch, parameter normalization, and backup/restore system.

### 2. IMPORTS & DEPENDENCIES

| Import | Module | Purpose |
|--------|--------|---------|
| `exec` | child_process | Shell command execution |
| `path` | Node.js built-in | File path operations |
| `fs.promises` | Node.js built-in | Async file I/O |
| `https`, `http` | Node.js built-in | HTTP requests |
| `vm` | Node.js built-in | Custom tool sandboxed execution |
| `mcpBrowserTools` | `./tools/mcpBrowserTools` | Browser automation implementations |
| `mcpGitTools` | `./tools/mcpGitTools` | Git command implementations |
| `toolParser` | `./tools/toolParser` | Tool call parsing, repair, recovery |

---

### 3. CLASS CONSTRUCTOR

#### **`constructor(options = {})` — Lines 11–47**
**Parameters:**
- `options` (object): Configuration
  - `webSearch`: Web search service instance
  - `ragEngine`: RAG search instance
  - `terminalManager`: Terminal access object
  - `projectPath`: Project root directory

**Returns:** MCPToolServer instance

**Properties Initialized:**
```javascript
this.webSearch = null
this.ragEngine = null
this.terminalManager = null
this.projectPath = null
this.browserManager = null
this.playwrightBrowser = null
this.gitManager = null
this.imageGen = null

this.toolHistory = []                    // Last 50 tool calls
this.maxHistory = 50

this._fileBackups = Map()                // Undo system: filePath → {original, isNew, timestamp, tool}
this._maxFileBackups = 200

this._turnSnapshots = []                 // Checkpoint system: turn-based snapshots
this._maxTurnSnapshots = 20
this._currentTurnId = null
this._currentTurnCapture = Map()

this._toolDefsCache = null               // Cached tool definitions
this._toolPromptCache = null             // Cached tool prompt text

this._todos = []                         // TODO items: {id, text, status}
this._todoNextId = 1
this.onTodoUpdate = null                 // Callback when TODOs change

this._scratchDir = null                  // Temp storage for large data
this._customTools = Map()                // User-created tools: name → {name, description, code}
this._spawnSubagent = null               // Subagent spawning callback

this.onPermissionRequest = null          // Callback for destructive operation approval
this._destructiveTools = Set([           // Operations needing permission
  'delete_file', 'replace_in_file', 'write_file', 'terminal_run',
  'git_commit', 'git_push', 'git_reset', 'git_branch_delete'
])
```

---

### 4. PARAMETER NORMALIZATION

#### **`_normalizeBrowserParams(toolName, params)` — Lines 50–88**
**Purpose:** Correct common schema drift errors from small models

**Drift Patterns Handled:**
- `ref` vs `selector` vs `element_ref` vs `elementRef` → normalize to `ref`
- `element_text` vs `elementText` → use as fallback `ref` for clicks
- `text` vs `value` → normalize to `text`
- `url` vs `href` vs `link` vs `ref` vs `page` vs `target` → normalize to `url`
- Numeric refs converted to strings
- Strip `[ref=N]` wrapper notation

**Example:**
```javascript
// Input: {selector: "#button", element_text: "Click me"}
// Output: {ref: "#button"}  // element_text used if ref missing
```

---

#### **`_normalizeFsParams(toolName, params)` — Lines 90–152**
**Purpose:** Normalize file path parameter naming across tools

**Normalizations:**
- `path` / `file_path` / `filename` / `file_name` / `file` / `key` → `filePath`
- `dirPath` / `path` / `dir` / `directory` → depends on tool
- `pattern` / `query` → `pattern` (find_files)

---

### 5. UTILITY METHODS

#### **`_withTimeout(promise, ms = 60000, label)` — Lines 154–160**
**Parameters:**
- `promise` (Promise): Operation to timeout
- `ms` (number): Timeout in milliseconds
- `label` (string): Operation name for error message

**Returns:** Promise that resolves to either result or timeout error

**Logic:** Race between promise and setTimeout; whichever finishes first

---

#### **`_sanitizeFilePath(filePath)` — Lines 162–196**
**Purpose:** Prevent path traversal and absolute path escapes

**Logic:**
1. If no project path: return basename (strip directory)
2. If absolute path:
   - Resolve and normalize both paths
   - Check if resolved path starts with project path (case-insensitive on Windows)
   - If escapes project: return basename
3. If relative path: return as-is
4. Detect doubled project root: correct if found

**Security:** Blocks `../../../` traversal and `/etc/passwd` style absolute paths

---

#### **`_sanitizeShellArg(str)` — Lines 198–205**
**Purpose:** Remove dangerous shell metacharacters

**Removals:**
- Null bytes: `\x00`
- Backticks: `` ` ``
- Newlines: `\n\r`

**Preserves:** Spaces, quotes, pipes, etc. (handled separately by exec)

---

### 6. TOOL DEFINITIONS

#### **`getToolDefinitions()` — Lines 208–671**
**Parameters:** None  
**Returns:** Array of 100+ tool definition objects

**Caching:** Results cached in `_toolDefsCache` (invalidates never; assume tool defs don't change)

**Tool Definition Structure:**
```javascript
{
  name: "tool_name",
  description: "What the tool does",
  parameters: {
    param1: {
      type: "string" | "number" | "boolean" | "array" | "object",
      description: "Parameter description",
      required: true | false,
      items: {...}  // For array types
    }
  }
}
```

**Tool Categories:**
- **Web:** web_search, fetch_webpage
- **File I/O:** read_file, write_file, edit_file, delete_file, list_directory, find_files
- **Codebase Search:** search_codebase, grep_search, analyze_error
- **Terminal:** run_command
- **Browser:** browser_navigate, browser_snapshot, browser_click, ... (20+ tools)
- **Memory:** save_memory, get_memory, list_memories
- **Git:** git_status, git_commit, git_diff, git_log, git_branch, git_stash, git_reset
- **File Ops Extended:** copy_file, append_to_file, diff_files
- **Network:** http_request, check_port
- **Planning:** write_todos, update_todo
- **Scratchpad:** write_scratchpad, read_scratchpad
- **Custom Tools:** create_tool, use_tool
- **Advanced:** delegate_task

---

### 7. TOOL EXECUTION DISPATCH

#### **`executeTool(toolName, params = {})` — Lines 673–1024**
**Parameters:**
- `toolName` (string): Name of tool to execute
- `params` (object): Tool parameters

**Returns:** Promise<result object>

**Logic (High-Level):**
1. Start timer
2. Normalize params (browser vs file-system tools)
3. Validate paths: block absolute paths outside project
4. Sanitize all file path params
5. Permission gate (if destructive tool and callback set)
6. Try: Execute tool via switch statement
7. Catch: Return error
8. Truncate oversized results (50KB cap)
9. Record in history
10. Return result

**Result Truncation:** If result JSON > 50KB, truncate long text fields to 40KB

**History Recording:** Track last 50 tool calls with params, result, duration, timestamp

**Error Handling:** All exceptions caught, returned as `{success: false, error: ...}`

**Tool Execution:** 100+ cases implemented directly or delegated to mixins (browser tools, git tools)

---

### 8. BACKUP & UNDO SYSTEM

#### **`_setFileBackup(filePath, backup)` — Lines 1027–1041**
**Purpose:** Store file state for undo

**Parameters:**
- `filePath` (string): File modified
- `backup` (object): `{original: string|null, timestamp, tool, isNew: boolean}`

**Logic:**
1. Store in `_fileBackups` map
2. Capture in current turn (if turn active)
3. Evict oldest if exceeds max (200 backups)

**Turn Capture:** If `_currentTurnId` set, also record in `_currentTurnCapture`

---

#### **`getUndoableFiles()` — Lines 1043–1065**
**Parameters:** None  
**Returns:** Promise<array of `{filePath, fileName, timestamp, tool, isNew, linesAdded, linesRemoved}`>

**Logic:**
1. For each backup:
   - Compare original vs current file
   - Calculate line delta
   - Return metadata

---

#### **`undoFileChange(filePath)` — Lines 1067–1083**
**Parameters:**
- `filePath` (string): File to undo

**Returns:** Promise<`{success, action, filePath}`>

**Logic:**
1. Lookup backup
2. If new: delete file
3. If modified: write original content
4. Remove from backups
5. Return action taken

---

#### **`undoAllFileChanges()` — Lines 1085–1091**
**Parameters:** None  
**Returns:** Promise<array of results>

**Logic:** Call `undoFileChange()` for each backed-up file

---

#### **`acceptFileChanges(filePaths)` — Lines 1093–1101**
**Purpose:** Discard undo backups (commit changes)

**Parameters:**
- `filePaths` (array): Files to commit (or null/[] for all)

**Logic:** Delete backups for specified files

---

### 9. CHECKPOINT SYSTEM

#### **`startTurn(turnId)` — Lines 1104–1107**
**Parameters:**
- `turnId` (string): Unique identifier for this turn

**Logic:** Initialize turn capture map

---

#### **`finalizeCurrentTurn(userMessage)` — Lines 1109–1127**
**Parameters:**
- `userMessage` (string): User request (for context)

**Returns:** Snapshot object | null

**Logic:**
1. If no turn active or no files changed: return null
2. Build snapshot: `{turnId, timestamp, userMessage (first 100 chars), files}`
3. Store in `_turnSnapshots` (evict oldest if > 20)
4. Clear turn state
5. Return snapshot

---

#### **`getCheckpointList()` — Lines 1129–1137**
**Parameters:** None  
**Returns:** Array of checkpoint metadata objects

---

#### **`restoreCheckpoint(turnId)` — Lines 1139–1163**
**Parameters:**
- `turnId` (string): Turn to restore

**Returns:** Promise<`{success, results, restoredCount}`>

**Logic:**
1. Find snapshot
2. For each file in snapshot:
   - Restore original content or delete if new
3. Remove this and all later snapshots from history

---

### 10. TOOL IMPLEMENTATIONS (KEY SAMPLES)

#### **`_readFile(filePath, startLine, endLine)` — Lines 1347–1366**
**Parameters:**
- `filePath` (string): File to read
- `startLine` (number): 1-based start line
- `endLine` (number): 1-based end line (inclusive)

**Returns:** `{success, content, path, totalLines, readRange?}`

**Logic:**
1. Resolve full path
2. Check file size: if > 10MB, reject
3. Read file
4. If line range: slice and return
5. Else: return full content

---

#### **`_writeFile(filePath, content)` — Lines 1368–1400**
**Parameters:**
- `filePath` (string): Destination file path
- `content` (string): File content

**Returns:** `{success, path, isNew}`

**Logic:**
1. Guard: project path must be set
2. Create backup (if file exists)
3. Create directory if needed
4. Write file (atomically with temp file)
5. Send IPC message to renderer: file-modified
6. Return result

**Side Effects:** Emits IPC messages for UI updates

---

#### **`_editFile(filePath, oldText, newText)` — Lines 1402–1478**
**Parameters:**
- `filePath` (string): File to edit
- `oldText` (string): Exact text to replace
- `newText` (string): Replacement text

**Returns:** `{success, path, message} | {success: false, error: hint}`

**Local-Match Strategies:**
1. Exact string match (primary)
2. Normalize line endings (CRLF → LF)
3. Trim line endings
4. Collapse whitespace
5. Multi-line collapsed match (for formatted code)

**Failure Help:** On failure, provide context:
- Closest matching line (similarity >50%)
- Keyword matches in file
- Diagnostic message

---

#### **`_runCommand(command, cwd, timeout)` — Lines 1481–1530**
**Parameters:**
- `command` (string): Shell command to execute
- `cwd` (string): Working directory (validated)
- `timeout` (number): Max milliseconds

**Returns:** `{success, output, stdout, stderr, exitCode}`

**Security:**
1. Dangerous pattern detection (regex list):
   - `rm -r /` (recursive delete root)
   - `format C:` (format disk)
   - `mkfs` (make filesystem)
   - Bash bomb: `:() { :| : & }; :` (fork bomb)
   - Pipe to bash: `curl | bash`
2. Block if matches
3. CWD validation: relative paths resolved relative to project (no traversal)

**Shell Selection:** PowerShell on Windows, bash on Unix

---

#### **`_listDirectory(dirPath, recursive)` — Lines 1532–1551**
**Parameters:**
- `dirPath` (string): Directory to list
- `recursive` (boolean): Traverse subdirectories

**Returns:** `{success, items: [{name, type, path}, ...]}`

**Filters:** Hides hidden files (`.`) and node_modules

---

#### **`_grepSearch(pattern, filePattern, isRegex, maxResults)` — Lines 1637–1686**
**Parameters:**
- `pattern` (string): Search text or regex
- `filePattern` (string): Glob to filter files
- `isRegex` (boolean): Treat pattern as regex
- `maxResults` (number): Max matches to return

**Returns:** `{success, results, total, pattern}`

**Logic:**
1. If RAG engine available: search indexed files in memory
2. Else: shell grep command
3. Parse results: extract file, line number, text
4. Cap results (200 max)

---

#### **`_httpRequest(url, method, headers, body)` — Lines 1814–1851**
**Parameters:**
- `url` (string): Full URL to request
- `method` (string): HTTP method (default GET)
- `headers` (object): Request headers
- `body` (string | object): Request body

**Returns:** Promise<`{success, status, headers, body, size}`>

**Security — SSRF Protection:**
- Block requests to localhost, 127.0.0.1, ::1
- Block private IP ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
- Block metadata.google.internal
- 30-second timeout

---

### 11. MEMORY TOOLS

#### **`_saveMemory(key, value)` — Lines 1891–1905**
**Parameters:**
- `key` (string): Memory identifier
- `value` (string): Content to save

**Returns:** `{success, message}`

**Logic:**
1. Create `.guide-memory` directory
2. Sanitize key: alphanumeric + hyphens
3. Write JSON: `{metadata: {...}, content}`
4. Also write plain text backup

---

#### **`_getMemory(key)` — Lines 1907–1935**
**Parameters:**
- `key` (string): Memory to retrieve

**Returns:** `{success, key, value, metadata?, fuzzyMatch?}`

**Logic:**
1. Try exact match (JSON then TXT)
2. Fallback: fuzzy substring match
3. Return value or not found error

---

#### **`_listMemories()` — Lines 1937–1972**
**Parameters:** None  
**Returns:** `{success, keys, entries, message}`

**Logic:** List all memory files, sorted by modification date

---

### 12. TODO TOOLS

#### **`_writeTodos(params)` — Lines 1984–2005**
**Parameters:**
- `params.items` (array): String items or `{text, status}` objects

**Returns:** `{success, created, allTodos}`

**Logic:**
1. Accept items as array of strings or objects
2. Auto-generate IDs (incrementing)
3. Validate status (pending | in-progress | done)
4. Store in `_todos`
5. Notify callback if set

---

#### **`_updateTodo(params)` — Lines 2007–2018**
**Parameters:**
- `params.id` (number): TODO ID
- `params.status` (string): New status
- `params.text` (string): New text

**Returns:** `{success, todo}`

---

### 13. CUSTOM TOOL SYSTEM

#### **`_createCustomTool(params)` — Lines 2070–2088**
**Parameters:**
- `params.name` (string): Tool name
- `params.description` (string): What it does
- `params.code` (string): JS function body

**Returns:** `{success, name, message}`

**Sandbox Security:** Blocks `require`, `import`, `process`, `eval`, `Function`, `fs`

---

#### **`_useCustomTool(params)` — Lines 2090–2109**
**Parameters:**
- `params.name` (string): Custom tool name
- `params.args` (object): Arguments to pass

**Returns:** `{success, result} | {success: false, error}`

**Execution:** Runs in VM sandbox with timeout 5 seconds

---

### 14. TOOL CALL PROCESSING

#### **`processResponse(responseText, options)` — Lines 2151–2349**
**Parameters:**
- `responseText` (string): Model response
- `options` (object): Processing configuration

**Returns:** Promise<`{hasToolCalls, results, capped, skippedToolCalls, formalCallCount, droppedFilePaths}`>

**Logic:**
1. Parse tool calls from text
2. Normalize tool-name aliases
3. Clean template path prefixes
4. Infer missing parameters from user message
5. Optionally enforce browser_navigate URL
6. Repair tool calls (fix common errors)
7. De-duplicate calls
8. Cap tool burst (limit per response)
9. Write deferral: skip write tools if batch includes data-gathering tools
10. Browser state capping: max 2 state-changing actions per response
11. Execute tool calls with optional pacing
12. Collect results

**Options:**
- `toolPaceMs`: Delay between tool calls (for smoother interaction)
- `maxToolsPerResponse`: Limit tool calls per response
- `userMessage`: User's input (for context)
- `writeFileHistory`: Track write counts per file
- `skipWriteDeferral`: Disable write deferral
- `enforceNavigateUrl`: Force first browser_navigate to specific URL

**Deferral Logic:** If batch has data-gathering (web_search, browser_click) AND write (write_file), skip writes to prevent hallucinated content

---

#### **`parseToolCalls(responseText)` — Lines 2337–2339**
**Parameters:**
- `responseText` (string): Response from model

**Returns:** Array of tool calls

**Logic:** Delegates to `standaloneParseToolCalls()` from toolParser module

---

### 15. TOOL PROMPT GENERATION

#### **`getToolPrompt()` — Lines 2397–2402**
**Parameters:** None  
**Returns:** Cached full tool prompt text

#### **`getCompactToolHint(taskType, options)` — Lines 2404–2452**
**Parameters:**
- `taskType` (string): 'chat' | 'code' | 'browser' | default
- `options` (object): `{minimal: boolean}`

**Returns:** Condensed tool prompt for small models

#### **`getToolPromptForTask(taskType)` — Lines 2454–2504**
**Parameters:**
- `taskType` (string): Task type

**Returns:** Filtered tool set + descriptions

**Filtering:**
- **chat:** No tools
- **browser:** Web + browser tools
- **code:** File + terminal + git tools
- **default:** All tools

---

### 16. POTENTIAL ISSUES & BUGS

| Issue | Severity | Description | Impact |
|-------|----------|-------------|--------|
| **Race Condition on File Backups** | High | Multiple tool calls to same file simultaneously may corrupt backup | Undo state inconsistent |
| **Command Injection via cwd Parameter** | High | Despite validation, complex traversal patterns might slip through | Arbitrary directory access |
| **Browser State Not Fully Validated** | Medium | Browser tools use cached state; doesn't re-validate refs after state changes | Stale element references cause failures |
| **No Circular Dependency Detection** | Medium | Custom tools can infinite-loop; 5s timeout only protection | Process hangs briefly per tool |
| **File Watcher Not Disabled** | Low | RAG engine file watcher may continue running after dispose | File descriptors leaked |
| **SSRF Regex Bypass** | Medium | Complex URL parsing may bypass SSRF checks (e.g., DNS rebinding) | Internal network access possible |
| **Permission Gate Not Enforced** | Medium | If callback not set, destructive tools execute without approval | Silent data loss possible |
| **Memory Leak on Long-Running Sessions** | Low | Tool history (50 entries), undo backups (200 entries), checkpoints (20) can accumulate | VRAM usage grows over hours |

---

### 17. CODE FLOW & DEPENDENCIES

```
[MCPToolServer]
├─ executeTool(toolName, params)
│  ├─ _normalize*Params()
│  ├─ [permission gate]
│  └─ [switch statement] → tool impl
│     ├─ _readFile() / _writeFile() / _editFile()
│     ├─ _runCommand() → exec()
│     ├─ _browserNavigate() → mcpBrowserTools
│     ├─ _gitStatus() → mcpGitTools
│     ├─ _saveMemory() / _getMemory()
│     ├─ _createCustomTool() / _useCustomTool()
│     └─ [30+ more tools]
│
├─ processResponse(responseText, options)
│  ├─ parseToolCalls()
│  ├─ _normalize*Params() × tool count
│  ├─ repairToolCalls()
│  ├─ [Browser capping logic]
│  ├─ [Write deferral logic]
│  └─ executeTool() × N
│
├─ [Backup & Undo]
│  ├─ _setFileBackup()
│  ├─ undoFileChange()
│  └─ getUndoableFiles()
│
└─ [Custom Tools]
   ├─ _createCustomTool()
   └─ _useCustomTool() → vm.runInContext()
```

---

## FILE 6: [mainUtils.js](mainUtils.js)

### 1. FILE PURPOSE & OVERVIEW

**Purpose:** Shared utility functions for result truncation and hardware detection.  
**Scope:** Sanitizes tool results for tokenizer, detects GPU/VRAM, monitors CPU usage.  
**Key Features:**
- Non-BMP Unicode sanitization (prevents tokenizer crashes)
- GPU detection via nvidia-smi or WMI (Windows)
- CPU usage calculation (per-sample)

### 2. IMPORTS & DEPENDENCIES

| Import | Module | Purpose |
|--------|--------|---------|
| `os` | Node.js built-in | CPU info, system memory |
| `execFile` | child_process | Execute external commands (gpu detection) |

### 3. EXPORTED FUNCTIONS

#### **`sanitizeForTokenizer(str)` — Lines 8–11**
**Parameters:**
- `str` (any): Input value

**Returns:** same value or sanitized string

**Logic:**
1. If not string: return as-is
2. Remove non-BMP Unicode: `[\u{10000}-\u{10FFFF}]` (regex with `u` flag)
   - Includes emoji, rare CJK characters, supplementary planes
3. Remove control characters: `[\x00-\x08\x0B\x0C\x0E-\x1F]`
   - Keeps tab, linefeed, carriage return

**Purpose:** node-llama-cpp tokenizer crashes on certain Unicode characters

**Example:**
- Input: "Error: 😀 emoji"
- Output: "Error:  emoji"

---

#### **`_truncateResult(result, maxFieldLen = 3000)` — Lines 14–39**
**Parameters:**
- `result` (object): Tool result to truncate
- `maxFieldLen` (number): Max length per field (default 3000 chars)

**Returns:** New object with truncated fields

**Logic:**
1. Shallow copy input object
2. For text fields (content, output, snapshot, stdout, stderr, html, text, data, snippet, title, error):
   - Sanitize for tokenizer
   - If > maxFieldLen: truncate + append "... (truncated)"
3. If `results` array: cap to 10 items, sanitize each item
4. If `files` array: cap to 30 items
5. Return truncated copy

**Purpose:** Keep token count manageable for model context; prevents LLM from wasting tokens on massive tool output

**Example:**
```
Input: {output: "500KB error log", stderr: "200KB"}
Output: {output: "first 3000 chars... (truncated)", stderr: "first 3000 chars... (truncated)"}
```

---

### 4. GPU DETECTION

#### **Module-Level GPU Cache**
```javascript
let gpuCache = null
let gpuCacheTime = 0
```
Caches GPU info for 1 hour (assumes hardware doesn't change mid-session)

---

#### **`_detectGPU()` — Lines 43–72**
**Parameters:** None  
**Returns:** Promise<`{vramGB, gpuName}`>

**Logic:**
1. Check cache: if cached and < 1 hour old, return cached value
2. Try nvidia-smi (NVIDIA GPUs):
   - Execute: `nvidia-smi --query-gpu=memory.total,name`
   - Parse output: extract VRAM (MB) and name
   - Convert MB → GB: `vramGB = parseFloat(MB) / 1024`
3. Fallback (Windows): try WMI:
   - Execute: `wmic path win32_videocontroller get name,adapterram /format:csv`
   - Parse: extract video adapter name and VRAM bytes
   - Convert bytes → GB: `vramGB = parseInt(bytes) / (1024^3)`
4. If both fail: default `{vramGB: 0, gpuName: 'No GPU detected'}`
5. Cache result + timestamp
6. Return

**Timeout:** 3-second timeout per command

**Error Handling:** All errors caught; falls back to next attempt

**Output Example:**
```javascript
{vramGB: 6, gpuName: "NVIDIA GeForce RTX 2060"}
{vramGB: 16, gpuName: "AMD Radeon RX 6700 XT"}
{vramGB: 0, gpuName: "No GPU detected"}
```

---

### 5. CPU USAGE MONITORING

#### **Module-Level CPU Cache**
```javascript
let prevCpu = null
```
Tracks idle/total times from previous sample for delta calculation

---

#### **`getCpuUsage()` — Lines 74–86**
**Parameters:** None  
**Returns:** Number (0-100, percentage CPU usage)

**Logic:**
1. Get current CPU stats: `os.cpus()`
2. Sum times (idle, user, system, irq, nice):
   - `total = sum(all time types)`
   - `idle = cpu.times.idle`
3. Calculate delta from previous sample:
   - `idleDiff = current.idle - prev.idle`
   - `totalDiff = current.total - prev.total`
4. Calculate usage: `(1 - idleDiff/totalDiff) * 100`
5. Update cache: store new idle/total
6. Return percentage

**First Call:** Returns 0 (no previous sample); stores baseline

**Subsequent Calls:** Returns actual CPU usage %

**Example:**
- First call: returns 0 (stores baseline)
- Second call (1 second later, CPU 50% busy): returns '50'
- Third call (CPU idle): returns '0'

**Edge Cases:**
- `totalDiff = 0`: returns 0 (no time passed, shouldn't happen)
- Single CPU system: sum of all cores still works correctly

---

### 6. MODULE EXPORTS

```javascript
module.exports = { _truncateResult, _detectGPU, getCpuUsage };
```

---

### 7. POTENTIAL ISSUES & BUGS

| Issue | Severity | Description | Impact |
|-------|----------|-------------|--------|
| **GPU Cache Never Invalidates** | Low | 1-hour cache assumes no GPU changes; doesn't detect hotplug | New GPU added not detected until session restart |
| **Shallow Copy in _truncateResult** | Low | Nested objects not deep-copied; mutations affect original | If caller modifies nested fields, affects source |
| **No VRAM Subtraction for OS/Process** | Medium | Reported VRAM is total, not available for models | Model allocation calculations overestimate available space |
| **CPU Calculation Includes All Cores** | Low | Sum gives total CPU time; percentage is aggregate | Multi-threaded loads may report >100% CPU per core |
| **No Error Propagation** | Low | GPU detection failures silent; returns generic fallback | User unaware if GPU detection failed |

---

### 8. CODE FLOW & DEPENDENCIES

```
[mainUtils]
├─ sanitizeForTokenizer(str)
│  └─ [regex replace: non-BMP Unicode + control chars]
│
├─ _truncateResult(result, maxFieldLen)
│  └─ sanitizeForTokenizer() × per field
│
├─ _detectGPU() [Promise]
│  ├─ [GPU cache check]
│  ├─ execFile('nvidia-smi') → parse → VRAM + name
│  ├─ execFile('wmic') → parse → VRAM + name
│  └─ [cache result + return]
│
└─ getCpuUsage()
   ├─ os.cpus() → [calculate idle / total delta]
   └─ [store baseline on first call]
```

---

---

# SUMMARY

This audit identified 6 core modules with the following characteristics:

| Module | LOC | Purpose | Key Risk |
|--------|-----|---------|----------|
| **memoryStore.js** | 167 | Cross-session memory persistence | No encryption; unbounded Maps |
| **ragEngine.js** | 474 | Semantic code search (BM25) | Symlink infinite loop; thread-unsafe |
| **modelManager.js** | 245 | Model discovery & default selection | Race condition on concurrent scans |
| **settingsManager.js** | 117 | IPC settings handler registry | Race condition on concurrent writes |
| **mcpToolServer.js** | 2300+ | Tool dispatch for agent autonomy | Command injection; SSRF bypass |
| **mainUtils.js** | 86 | Result sanitization & hardware detection | GPU cache never invalidates |

**Critical Patterns:**
- No file locking (race conditions on POSIX and Windows)
- No input validation on settings/configs
- Security reliant on regex patterns (fragile)
- Hard-coded constants (no versioning/config)
- Silent error handling masks failures

The codebase is production-quality with thoughtful architecture (EventEmitters, LRU caches, atomic writes) but lacks concurrency safeguards and validation layer.

---

# PART 6 — REMAINING MAIN FILES

# Comprehensive Audit Report: guIDE IDE Main Modules

---

## FILE 1: apiKeyStore.js

### File Purpose & Overview
Secure API key storage module using Electron's safeStorage API (OS-level keychain: DPAPI on Windows, Keychain on macOS, libsecret on Linux). Falls back to plaintext encryption when safeStorage is unavailable (CI/headless environments). Manages both single API keys per provider and key pools for rotation/failover. Config persisted at `.guide-config.json`.

### Imports & Dependencies
- `path` (Node.js core) — path manipulation for config file location
- `fs` (Node.js core) — file I/O for reading/writing config
- `safeStorage` from `electron` — OS-level encryption/decryption
- `logger` (./logger) — logging engine for warnings/info

### Exported Functions

#### `encryptApiKey(key)` — Lines 23-30
**Parameters:** `key` (string or falsy)  
**Return:** encrypted string with `enc:` prefix if encryption available; otherwise returns key as-is  
**Logic:**
- Type check: returns `key` unchanged if falsy or not string
- Attempts `safeStorage.encryptString()` if available
- Converts result to base64 and prepends `enc:` prefix
- Silent catch-all: if safeStorage unavailable, returns plaintext key
- **Edge case:** fails silently on unavailable encryption (CI environments)

#### `decryptApiKey(stored)` — Lines 32-40
**Parameters:** `stored` (encrypted string with `enc:` prefix)  
**Return:** decrypted plaintext string or empty string on error  
**Logic:**
- Type check: returns `stored` if not string or falsy
- If not prefixed with `enc:`, returns as-is (plaintext)
- Decrypts `enc:` prefixed values: removes prefix, base64 decodes, passes to `safeStorage.decryptString()`
- Logs warning on decrypt failure; returns empty string (security-safe default)
- **Issue:** Returns empty string on failure, which could silently mask bad keys

#### `loadSavedApiKeys(appBasePath, cloudLLM)` — Lines 42-95
**Parameters:** 
- `appBasePath` (string) — path to root application directory
- `cloudLLM` (object) — API key sink with `.setApiKey()` and `.addKeyToPool()` methods

**Return:** undefined (side-effects only)

**Logic:**
- Constructs config path: `<appBasePath>/.guide-config.json`
- Attempts JSON parse; returns silently if file missing (not an error state)
- **Single keys loading (lines 58-69):**
  - Iterates `config.apiKeys` object
  - Decrypts each stored value
  - Calls `cloudLLM.setApiKey(provider, key)` for each
  - **Migration:** Auto-encrypts plaintext keys, sets `dirty=true`
- **Key pools loading (lines 71-85):**
  - Iterates `config.keyPools` (provider → array of keys)
  - Decrypts each key in pool
  - Calls `cloudLLM.addKeyToPool(provider, key)` for each
  - Auto-encrypts plaintext pool keys if found
- **Write-back (lines 87-95):**
  - If any plaintext keys were auto-encrypted, atomically writes config via temp file
  - Logs migration success; swallows write errors silently

**Potential Issues:**
- **Race condition:** Auto-encryption could fail between read and write without rollback
- **Incomplete migration:** If write fails, app loads plaintext keys but never tries to encrypt again (infinite loop could occur if permissions recover)
- **Silent failures:** Missing file, parse errors, and write errors all swallowed without robust signal
- **Lack of per-key error handling:** One bad decryption stops entire provider initialization

### Constants/Config
- No explicit constants defined; all logic is algorithmic
- Relies on `.guide-config.json` structure: `{ apiKeys: {}, keyPools: {} }`

### Event Emitters/Listeners
- None; module is functional, not event-driven

### Dependency Flow
1. App initialization → `loadSavedApiKeys(appBasePath, cloudLLM)`
2. For each stored key → `decryptApiKey()` → `cloudLLM.setApiKey()`
3. Triggers: if plaintext found → `encryptApiKey()` → atomic write

---

## FILE 2: appMenu.js

### File Purpose & Overview
Builds and manages the Electron application menu (File, Edit, Selection, View, Go, Run, Terminal, Help). Handles recent folders state, menu rebuild debouncing, and sends menu actions via IPC to renderer. Integrates with context (project path, gitManager, mcpToolServer).

### Imports & Dependencies
- `Menu`, `dialog`, `shell`, `ipcMain` from `electron` — Electron APIs for menu, dialogs, external links, IPC
- No external npm packages
- No local module imports

### Module State (Global Closures)
- `_recentFolders` (array) — list of recent folder paths
- `_ctx` (object) — Electron app context (getMainWindow, currentProjectPath, gitManager, mcpToolServer, autoIndexProject)
- `_rebuildTimeout` (number) — debounce timer ID for menu reconstruction

### Internal Helper Functions

#### `send(action)` — Line 10
**Parameters:** `action` (string)  
**Return:** undefined (side-effect)  
**Logic:** Sends `menu-action` IPC message to renderer webContents with `action` as payload. Null-safe: silently fails if context missing.

#### `buildOpenRecentSubmenu()` — Lines 12-26
**Parameters:** none  
**Return:** array of Electron menu items (objects)  
**Logic:**
- If `_recentFolders` empty, returns disabled "No Recent Folders" item
- Maps each folder to menu item with click handler:
  - Sets `_ctx.currentProjectPath`
  - Updates `mcpToolServer.projectPath` if present
  - Updates `gitManager.projectPath` if present
  - Sends `open-folder` IPC to renderer
  - Triggers `autoIndexProject()` if defined
- Adds separator and "Clear Recent Folders" action
- **Edge case:** No bounds checking on recent folders count; could create huge menu

#### `rebuildMenu()` — Lines 28-33
**Parameters:** none  
**Return:** undefined  
**Logic:**
- Returns silently if `_ctx` unset (early exit)
- Debounces menu rebuild: clears previous timeout, schedules 50ms later
- Wraps `Menu.setApplicationMenu()` try-catch; logs errors to console
- **Issue:** No recovery on failure; app continues with stale menu

### Exported Function

#### `createMenu(ctx)` — Lines 263-274
**Parameters:** `ctx` (Electron app context object)  
**Return:** undefined  
**Logic:**
- Stores `ctx` in closure
- Registers IPC listener for `update-recent-folders` (one-time registration)
- Handler converts received array to `_recentFolders` and rebuilds menu
- Calls `rebuildMenu()` to initialize
- **Issue:** No cleanup on destruction; listener persists for app lifetime

### Template Builder Function

#### `buildTemplate()` — Lines 35-261
**Parameters:** none  
**Return:** Electron menu template array  
**Logic:** Constructs nested menu structure:

**File Menu (lines 36-88):**
- New File, New Window, New Project Template
- Open File/Folder (async dialogs)
- Open Recent (submenu via `buildOpenRecentSubmenu()`)
- Save/Save As/Save All/Revert
- Reveal in Explorer/Open Containing Folder
- Auto Save toggle
- Preferences (Settings/Keyboard Shortcuts/Theme)
- Close Tab/All Tabs/Folder
- Exit

**Edit Menu (lines 90-107):**
- Undo/Redo/Cut/Copy/Paste/Select All (use native Electron roles where applicable)
- Find/Replace/Find in Files
- Toggle Line Comment/Block Comment
- Format Document

**Selection Menu (lines 109-136):**
- Select All, Expand/Shrink Selection
- Copy/Move lines up/down
- Multi-cursor operations (Add Cursor Above/Below, Line Ends, etc.)
- Duplicate Selection
- Add/Select Occurrences (single, multi, all)
- Column Selection Mode

**View Menu (lines 138-178):**
- Command Palette, toggles for Explorer/Search/Git/Debug/MCP/Chat/Browser/Terminal
- Appearance submenu: fullscreen, sidebar, activity bar, status bar, minimap, word wrap
- Zoom controls (In/Out/Reset)
- Developer Tools toggle

**Go Menu (lines 180-190):**
- Go to File/Symbol/Line (quick navigation)
- Go to Definition/References
- Navigate Back/Forward

**Run Menu (lines 192-227):**
- Run File (with/without debugging)
- Debug controls: Start/Stop/Restart
- Step Over/Into/Out, Continue, Pause
- Breakpoint management (Toggle, Conditional, Logpoint)
- Enable/Disable/Remove All Breakpoints
- Debug Configuration (Open/Add)

**Terminal Menu (lines 229-238):**
- New Terminal, Split Terminal
- Run Build Task, Run Active File
- Clear Terminal

**Help Menu (lines 240-261):**
- Welcome, Documentation, Release Notes
- Report Issue, GitHub Repo, Sponsor
- Check for Updates
- About guIDE (dialog with version, author, features)
- Developer Tools

### Event Listeners
- **IPC:** `update-recent-folders` — updates menu recent folders

### Potential Issues
1. **Race condition:** `rebuildMenu()` debounces at 50ms; rapid updates could lose intermediate menu states
2. **Context nullability:** Many handlers assume `_ctx` is set; no validation before access
3. **No menu item limits:** Recent folders could be unbounded, creating extremely large menu
4. **No teardown:** `ipcMain.on()` listener never removed; could accumulate if module reloaded
5. **Dialog path escaping:** File path callbacks don't validate or sanitize returned paths
6. **Stale project path:** Clicking recent folder doesn't validate path still exists
7. **Git manager assumed:** Click handler calls `_ctx.gitManager.setProjectPath()` without null check

### Code Dependencies
- Tight coupling to context object structure (`getMainWindow()`, `currentProjectPath`, `mcpToolServer`, `gitManager`, `autoIndexProject`)
- Uses Electron dialog and shell APIs directly

---

## FILE 3: benchmarkScorer.js

### File Purpose & Overview
Single source of truth for scoring benchmark test results. Used by both BenchmarkPanel.tsx (GUI) and pipeline-runner.js (headless testing). Normalizes scoring across multiple dimensions: chat baseline, tool task completion, content verification.

### Imports & Dependencies
- None; module is pure, no external dependencies

### Exported Function

#### `scoreResult(tc, chatResult, capturedTools)` — Lines 26-113
**Parameters:**
- `tc` (object) — test case definition containing:
  - `expectedTools` (string[]) — tools the model should call
  - `refusalPatterns` (string[]) — phrases indicating refusal
  - `expectedContent` (string[][]) — groups of keywords (AND across groups, OR within)
- `chatResult` (object) — result from model execution:
  - `success` (boolean) — whether execution completed
  - `text` or `response` (string) — model output
  - `error` (string) — error message if failed
- `capturedTools` (string[]) — actual tools called (may have duplicates)

**Return:** object containing:
```
{
  score: number (0-100),
  passed: boolean,
  errors: string[] — list of issues found,
  refusalDetected: boolean,
  contentChecksPassed: number,
  contentChecksTotal: number
}
```

**Scoring Logic:**

**1. Input Extraction (lines 27-29):**
- Extracts response text (fallback chain: `.text` → `.response` → empty)
- Deduplicates captured tools via Set
- Initializes errors array

**2. Error Capture (lines 31-33):**
- If `chatResult.success === false`, adds error message to errors array

**3. Refusal Detection (lines 35-42):**
- Searches lowercased response for each refusal pattern
- If any pattern found, sets `refusalDetected=true` and adds error
- Early exit on first match (no partial scoring)

**4. Chat Baseline (lines 44-55):**
- If NO expectedTools:
  - Score 100 if response > 5 chars AND no tools called (good chat, no tool pollution)
  - Score 50 if response > 5 chars BUT tools called (bad: tool pollution in chat)
  - Score 0 if response too short (empty response)
  - Pass only if score 100

**5. Tool Task Scoring (lines 56-73):**
- Creates Set of expected tools
- Counts matches: how many expectedTools are in capturedTools
- Base score: `(matched / expected.size) * 100` (0-100% based on match count)
- Penalty for refusal: `score = max(0, score - 50)`
- Bonus for substantive response: `score = min(100, score + 10)` if text > 20 chars
- Pass criteria: ALL tools matched AND score ≥ 70 AND no refusal
- Error reporting: if no matches, lists expected vs actual; if partial, lists matched count

**6. Content Verification (lines 75-98):**
- If `tc.expectedContent` is array:
  - For each group (array of keywords):
    - If ANY keyword in group appears in response (case-insensitive), increment `contentChecksPassed`
    - Else add error and deduct 15 points from score
  - Fail if fewer than 50% of groups pass
  - Error messages label groups as single keyword or "one of [...]"

**Pass Criteria Summary:**
- Chat: non-empty response, no tools
- Tool task: ALL expected tools, score ≥ 70, no refusal, ≥50% content groups

### Potential Issues
1. **Content group weighting:** All groups weighted equally; no distinction between critical vs nice-to-have content
2. **Tool case sensitivity:** Tool matching is case-sensitive (vulnerable if tool names inconsistent)
3. **Refusal detection early exit:** Stops after first pattern match; misses compound refusals
4. **Score capping:** Bonus/penalty operations can make score > 100 before `min()` caps it (e.g., 90 + 10 = 100 is correct, but 95 + 10 = 100 loses 5 points worth of signal)
5. **Content penalty precision:** −15 per failed group is arbitrary; no basis for this value
6. **Duplicate tool handling:** Deduplication via Set loses information about tool call frequency (might be useful for detecting redundant calls)
7. **Empty expectedContent:** If array but empty, no content checks performed (correct behavior, but not documented)
8. **Response too short:** 5-char threshold for chat vs 20 chars for bonus is not configurable and seems arbitrary

### Constants/Config
- No explicit constants; scoring thresholds hardcoded:
  - Chat baseline: 5 chars
  - Tool task substantive response: 20 chars
  - Pass score: ≥70
  - Refusal penalty: −50
  - Bonus for substantive: +10
  - Content failure penalty: −15
  - Content pass threshold: ≥50%

---

## FILE 4: debugService.js

### File Purpose & Overview
Multi-session debug protocol manager supporting both Node.js (via CDP — Chrome DevTools Protocol) and Python (via DAP — Debug Adapter Protocol). Wraps low-level protocol communication in a unified async API.

### Imports & Dependencies
- `spawn` from `child_process` (Node.js core) — spawn debug processes
- `net` (Node.js core) — TCP socket for DAP
- `path` (Node.js core) — path manipulation
- `EventEmitter` from `events` (Node.js core) — event emission base class
- `http` (Node.js core, used inline) — HTTP meta endpoint for CDP WebSocket discovery
- `ws` (npm package) — WebSocket for CDP communication
- External `ws` (WebSocket) dynamically required

### DebugSession Class

#### Constructor — Lines 21-33
**Initializes a single debug session with state:**
- `id` (number) — unique session identifier
- `config` (object) — debug configuration (type, program, cwd, args, env, port)
- `process` (child process) — spawned debug target
- `socket` (TCP net.Socket) — DAP connection
- `ws` (WebSocket) — CDP connection
- `seq` (number) — message sequence counter (1-indexed)
- `pendingRequests` (Map) — seq → { resolve, reject } promises
- `breakpoints` (Map) — file path → array of breakpoint objects
- `threads` (array) — thread list
- `stackFrames` (array) — current stack frames
- `variables` (Map) — variable references
- `state` (string) — 'inactive' | 'running' | 'paused' | 'stopped'
- `_buffer` (string) — DAP message buffer (for Content-Length parsing)
- `_contentLength` (number) — current DAP message byte count

#### `start()` — Lines 39-45
**Parameters:** none  
**Return:** Promise resolving to undefined  
**Logic:**
- Switches on `config.type`: 'node', 'node-terminal', 'python', 'attach'
- Routes to appropriate handler: `_startNode()`, `_startPython()`, `_attachCDP(port)`
- Throws if unsupported type

#### `_startNode(program, cwd, args, env)` — Lines 49-57
**Parameters:** program path, working directory, args array, env object  
**Return:** Promise resolving when debugger is ready (via CDP connection)  
**Logic:**
- Spawns `node --inspect-brk=0 <args> <program>` with env merging
- Sets state to 'running'
- Listens to stderr for WebSocket URL output: `Debugger listening on ws://127.0.0.1:<port>/`
- On match, calls `_connectCDP(port)`
- Streams stdout/stderr as 'output' events
- Emits 'terminated' on process exit with exit code
- Rejects on process error or 10-second timeout

#### `_connectCDP(port)` — Lines 59-79
**Parameters:** debug port (number)  
**Return:** Promise resolving when CDP initialized  
**Logic:**
- HTTP GET to `http://127.0.0.1:<port>/json` to retrieve WebSocket URL
- Creates new `ws` (WebSocket) connection to debugger URL
- On open:
  - Sets state 'running'
  - Emits 'initialized'
  - Sends three CDP commands: `Debugger.enable`, `Runtime.enable`, `Runtime.runIfWaitingForDebugger`
- Sets up handlers:
  - `on('message')`: parses and routes to `_handleCDP()`
  - `on('close')`: sets state 'stopped', emits 'terminated'
  - `on('error')`: emits error output
- Rejects if no WebSocket URL found

#### `_attachCDP(port)` — Line 81
**Parameters:** port (number)  
**Return:** delegated to `_connectCDP()`  
**Logic:** Alias for attaching to existing CDP listener (e.g., Node --inspect already running)

#### `_cdpSend(method, params)` — Lines 83-92
**Parameters:** CDP method name (string), params object (default {})  
**Return:** Promise resolving to CDP response result  
**Logic:**
- Increments `seq` for request ID
- Wraps `{ id, method, params }` as JSON, sends over WebSocket
- Stores `{ resolve, reject }` promise handler in `pendingRequests`
- Sets 5-second timeout; auto-rejects if no response
- Pending response cleanup (delete from map) on either success or timeout

#### `_handleCDP(msg)` — Lines 94-115
**Parameters:** parsed JSON message from CDP  
**Return:** undefined  
**Logic:**
- If `msg.id` present and in `pendingRequests`: resolve/reject based on error
- Switch on `msg.method`:
  - `Debugger.paused`: sets state paused, calls `_onPaused()`
  - `Debugger.resumed`: sets state running, emits 'continued'
  - `Runtime.consoleAPICalled`: extracts console args, emits 'output'
  - `Runtime.exceptionThrown`: formats exception details, emits 'output' as stderr

#### `_onPaused(params)` — Lines 117-127
**Parameters:** `Debugger.paused` event parameters  
**Return:** undefined  
**Logic:**
- Maps call frames to standardized objects:
  - `{ id, name, source: { path, name }, line (1-indexed), column, scopeChain, callFrameId }`
- Emits 'stopped' event with reason (breakpoint, exception, step)
- Reason determination: checks `params.reason` value

#### `_startPython(program, cwd, args, env)` — Lines 131-148
**Parameters:** program, cwd, args, env  
**Return:** Promise resolving when DAP connection established  
**Logic:**
- Spawns `python -m debugpy --listen 0 --wait-for-client <program> <args>`
- Listens for `"listening on .*?:\d+"` in stderr/stdout
- On match, waits 500ms then calls `_connectDAP(port)`
- Forwards stdout/stderr as 'output' events
- Emits 'terminated' on exit
- 15-second timeout (longer than Node debugger)

#### `_connectDAP(port)` — Lines 150-167
**Parameters:** DAP port (number)  
**Return:** Promise resolving when DAP initialized  
**Logic:**
- Creates TCP socket to `127.0.0.1:<port>`
- On connect:
  - Sets state 'running'
  - Sends DAP `initialize` request with client metadata
  - Emits 'initialized' on response
- Handlers:
  - `on('data')`: accumulates data, calls `_handleDAPData()` for protocol parsing
  - `on('error')` / `on('close')`: rejects/emits terminated

#### `_dapSend(command, args)` — Lines 169-179
**Parameters:** DAP command (string), args object (default {})  
**Return:** Promise resolving to response body  
**Logic:**
- Increments `seq`
- Constructs JSON body: `{ seq, type: 'request', command, arguments: args }`
- Prepends DAP header: `Content-Length: <byte-length>\r\n\r\n`
- Stores promise handler in `pendingRequests`
- Sends over socket
- 10-second timeout

#### `_handleDAPData(data)` — Lines 181-197
**Parameters:** raw chunk of data from socket  
**Return:** undefined  
**Logic:**
- Accumulates in `_buffer`
- Loops to extract complete messages:
  1. If `_contentLength === -1`:
     - Searches for `\r\n\r\n` (header boundary)
     - Parses `Content-Length: <number>` from header
     - Discards header from buffer
  2. If buffer has enough bytes for body:
     - Extracts body, resets `_contentLength`
     - Parses body as JSON
     - Routes to `_handleDAPMsg()`
  3. Otherwise: waits for more data

#### `_handleDAPMsg(msg)` — Lines 199-218
**Parameters:** parsed DAP message object  
**Return:** undefined  
**Logic:**
- If `msg.type === 'response'` and seq in `pendingRequests`: resolve/reject
- If `msg.type === 'event'`:
  - `stopped`: sets state paused, emits 'stopped' with body
  - `continued`: sets state running, emits 'continued'
  - `terminated`: sets state stopped, emits 'terminated'
  - `output`, `thread`, `breakpoint`: emit corresponding events

#### `setBreakpoints(filePath, breakpoints)` — Lines 223-241
**Parameters:** file path (string), breakpoints array (each: { line, ...props })  
**Return:** Promise resolving to updated breakpoints array with IDs  
**Logic:**
- Stores in `this.breakpoints` map
- **CDP path (Node.js):**
  - Converts file path to `file://` URL
  - Sends `Debugger.setBreakpointByUrl` for each breakpoint
  - Assigns returned `breakpointId` and marks `verified: true`
  - Swallows errors (catches, marks `verified: false`)
- **DAP path (Python):**
  - Sends single `setBreakpoints` request with all breakpoints
  - Maps returned breakpoint data to local breakpoints
  - Iterates returned array (may differ in count/order)
- Returns updated breakpoints array

#### Control Flow Methods (lines 243-258)
- `continue_()` — Sends CDP `Debugger.resume` or DAP `continue` command
- `stepOver()` — Sends `Debugger.stepOver` or DAP `next`
- `stepInto()` — Sends `Debugger.stepInto` or DAP `stepIn`
- `stepOut()` — Sends `Debugger.stepOut` or DAP `stepOut`
- `pause()` — Sends `Debugger.pause` or DAP `pause`

All set state to appropriate value after sending.

#### `getStackTrace()` — Lines 260-272
**Parameters:** none  
**Return:** Promise resolving to array of stack frame objects  
**Logic:**
- **CDP:** Returns cached `this.stackFrames` (set by `_onPaused()`)
- **DAP:** Sends `stackTrace` request, maps results to uniform format

#### `getScopes(frameId)` — Lines 274-291
**Parameters:** frame ID (number)  
**Return:** Promise resolving to array of scope objects  
**Logic:**
- **CDP:** Derives from frame's `scopeChain` property:
  - Maps scope type → display name
  - Uses `object.objectId` as variablesReference
  - Marks global as expensive
- **DAP:** Sends `scopes` request, returns result

#### `getVariables(ref)` — Lines 293-312
**Parameters:** variablesReference (string or number)  
**Return:** Promise resolving to filtered/mapped variables array (max 100)  
**Logic:**
- **CDP:** If ref is string (objectId):
  - Sends `Runtime.getProperties` request
  - Filters out accessors
  - Maps to uniform format
  - Limits to 100 results
- **DAP:** Sends `variables` request with reference

#### `evaluate(expression, frameId)` — Lines 314-329
**Parameters:** expression string, frame ID (number)  
**Return:** Promise resolving to `{ result: string }`  
**Logic:**
- **CDP:** Prefers `Debugger.evaluateOnCallFrame` if frame available; falls back to `Runtime.evaluate`
- **DAP:** Sends `evaluate` request with watch context
- Catches errors; returns `{ result: 'Error: ...' }`

#### `stop()` — Lines 331-341
**Parameters:** none  
**Return:** Promise resolving to undefined  
**Logic:**
- Closes WebSocket (CDP) or sends disconnect + destroys socket (DAP)
- Kills process: SIGTERM first, SIGKILL after 3s if still alive
- All wrapped in try-catch; errors swallowed
- Sets state 'stopped'
- Emits 'terminated'

### DebugService Class (Multi-session Manager)

#### Constructor — Lines 349-354
**Initializes:**
- `sessions` (Map) — sessionId → DebugSession
- `nextId` (number) — 1-indexed session ID counter
- `eventCallback` (function) — optional callback for all events

#### `setEventCallback(cb)` — Line 356
**Parameters:** callback (function(event: { event, sessionId, ...data }))  
**Return:** undefined

#### `_emit(event, data)` — Lines 358-359
**Parameters:** event name, data object  
**Return:** undefined  
**Logic:** Calls eventCallback with merged data if set

#### `startSession(config)` — Lines 361-374
**Parameters:** debug config object (see DebugSession constructor)  
**Return:** Promise resolving to `{ id, state }`  
**Logic:**
- Generates new session ID
- Creates DebugSession
- Wires up all DebugSession events to `_emit()` with sessionId
- Stores in map
- Calls `session.start()` (which may take time)
- Returns immediately with `{ id, state }` (state may not be fully initialized)
- On error: deletes session and re-throws
- **Issue:** Returns before session fully initialized; could race

#### `_get(id)` — Lines 376-377
**Parameters:** session ID (number)  
**Return:** DebugSession object  
**Logic:** Throws if session not found

#### Delegated Methods — Lines 379-389
All delegate to `_get(id)` and call corresponding DebugSession method:
- `stopSession(id)`
- `setBreakpoints(id, filePath, bps)`
- `continue_(id)`, `stepOver(id)`, `stepInto(id)`, `stepOut(id)`, `pause(id)`
- `getStackTrace(id)`, `getScopes(id, frameId)`, `getVariables(id, ref)`
- `evaluate(id, expression, frameId)`

#### `getActiveSession()` — Lines 391-394
**Parameters:** none  
**Return:** object `{ id, state }` or null  
**Logic:** Iterates sessions, returns last non-stopped session

#### `getAllSessions()` — Lines 396-398
**Parameters:** none  
**Return:** array of `{ id, state, config }`  
**Logic:** Maps all sessions

### Exported
Module exports class: `{ DebugService }`

### Potential Issues
1. **Race condition:** `startSession()` returns immediately; session may not be ready for commands yet
2. **Promise rejection handling:** Many async methods can timeout (5-10 seconds) but don't propagate cancellation; previous requests may still complete
3. **WebSocket/Socket lifecycle:** No guarantee connection close fully cleaned up before next command
4. **DAP message framing:** If message arrives fragmented, `_handleDAPData()` could misparse
5. **Breakpoint mismatch:** DAP `setBreakpoints` response could have different breakpoint count than request (e.g., some rejected); code iterates but doesn't handle length mismatch
6. **Stack frame indexing:** Line numbers converted to 1-indexed for CDP but DAP may already be 1-indexed (duplicate conversion possible)
7. **Process timeout:** Python debugger timeout is 15s but Node is 10s (inconsistent)
8. **Variable reference limits:** `getVariables()` capped at 100 results; no pagination support
9. **Error context loss:** Many errors caught and swallowed (try-catch in handlers); difficult to diagnose failures
10. **State management:** State transitions not validated; could be set to invalid values

---

## FILE 5: electron-stub.js

### File Purpose & Overview
Complete Node.js stub of Electron API surface for testing/pipeline usage. Injected into require.cache as 'electron' before any main/ module loads. Enables headless execution of main-process code without starting an actual Electron app. All APIs are no-ops or in-memory implementations.

### Imports & Dependencies
- `path` (Node.js core) — path utilities
- `os` (Node.js core) — system info for fake paths

### Global State
- `_userDataPath` — computed user data directory: `<home>/AppData/Roaming/guide-ide` (Windows-hardcoded path)
- `_handlers` (Map) — ipcMain channel → handler function
- `_listeners` (Map) — ipcMain channel → array of listener functions
- `_sessions` (Map) — session partition → fake session object
- `_SAFE_KEY` (string) — 36-character XOR key for fake encryption

### Exported Objects

#### `app` Object — Lines 14-47
**Properties & Methods:**
- `isPackaged` (boolean) — false (always dev mode)
- `commandLine.appendSwitch()` — no-op
- `getPath(name)` — returns path from hardcoded map (userData, appData, home, downloads, etc.)
  - Maps names to computed paths
  - If no match, returns `<userData>/<name>`
- `getAppPath()` — returns parent directory of __dirname (stub location)
- `getVersion()` — reads ../package.json version or '0.0.0'
- `requestSingleInstanceLock()` — returns true
- `quit()` — calls `process.exit(0)`
- `exit(code)` — calls `process.exit(code || 0)`
- `disableHardwareAcceleration()` — no-op
- `focus()` — no-op
- `whenReady()` — resolves immediately
- **Event system:**
  - `_listeners` (object) — event → array of handlers
  - `on(event, fn)` — pushes to listeners array
  - `once(event, fn)` — same as `on` (doesn't actually "once")
  - `off(event, fn)` — removes from listeners array
  - `emit(event, ...args)` — calls all listeners for event

**Issues:**
- `once()` doesn't actually remove after one call
- Path logic hardcoded to Windows (`AppData/Roaming`)
- No handling of relative paths

#### `ipcMain` Object — Lines 50-74
**Properties & Methods:**
- `_handlers` (Map) — stores handler functions
- `_listeners` (Map) — stores listener functions
- `handle(ch, fn)` — stores handler for channel
- `removeHandler(ch)` — removes handler
- `on(ch, fn)` — adds listener, returns ipcMain for chaining
- `off(ch, fn)` — removes specific listener
- `once(ch, fn)` — adds listener (NOT actually once; doesn't auto-remove)
- `removeAllListeners(ch)` — removes all for channel or clears all
- **Harness helpers (not in real Electron):**
  - `_invoke(ch, ...args)` — calls handler for channel with fake event, returns result (can throw)
  - `_emit(ch, ...args)` — calls all listeners with fake event
  - `_registeredChannels()` — returns channel names

**Issues:**
- `once()` not implemented correctly
- No error handling in `_emit()` (swallows exceptions silently)

#### `BrowserWindow` Class — Lines 77-117
**Constructor:** takes opts object  
**Properties:**
- `webContents` object with stubs:
  - `send(ch, ...args)` — console.log only
  - `on()`, `once()` — no-ops
  - `setWindowOpenHandler()` — no-op
  - `openDevTools()` — no-op
- `_destroyed` (boolean)

**Methods:**
- All UI methods (loadURL, loadFile, show, hide, close, etc.) — no-ops
- Query methods (isDestroyed, isMinimized, isVisible, etc.) — return hard-coded values
- Size/position queries — return fixed values (1600x1000 at 0,0)
- Event methods (on, once, off, removeListener, removeAllListeners) — return `this` for chaining
- **Static methods:**
  - `getAllWindows()` — returns empty array
  - `fromId()` — returns null
  - `getFocusedWindow()` — returns null

**Issues:**
- Fake window dimensions don't reflect actual rendering
- No state tracking

#### `safeStorage` Object — Lines 120-132
**Methods:**
- `isEncryptionAvailable()` — returns true
- `encryptString(str)` — XOR cipher with `_SAFE_KEY`:
  - Converts string to Buffer
  - XORs each byte with corresponding key byte (wrapping key)
  - Returns XORed buffer
- `decryptString(buf)` — reverse XOR operation:
  - Takes buffer or base64 string
  - XORs each byte with key
  - Returns decoded UTF-8 string

**Security Issues:**
- XOR cipher is trivially breakable (repeating key)
- Key is hardcoded in source
- This is for testing only, not for production

#### `dialog` Object — Lines 135-154
**Methods:**
- `showErrorBox(title, content)` — console.error
- `showMessageBoxSync(opts)` — console.log, returns 0
- `showMessageBox(win, opts)` → Promise resolving to `{ response: 0, checkboxChecked: false }`
- `showOpenDialog(win, opts)` → Promise resolving to `{ canceled: true, filePaths: [] }`
- `showSaveDialog(win, opts)` → Promise resolving to `{ canceled: true, filePath: undefined }`

**Issues:**
- Always returns "canceled" for file dialogs; no real file selection

#### `shell` Object — Lines 157-163
**Methods:**
- `openExternal(url)` — console.log, returns resolved promise
- `showItemInFolder(p)` — console.log, no-op
- `openPath(p)` → resolves with empty string
- `moveItemToTrash()` — returns false
- `beep()` — no-op

#### `Menu` Object — Lines 166-171
**Methods:**
- `buildFromTemplate(t)` — returns object with `popup()`, `closePopup()`, items
- `setApplicationMenu()` — no-op
- `getApplicationMenu()` — returns null
- `Menu.Menu` — alias to Menu object

#### `session` Object — Lines 174-190
**Properties:**
- `defaultSession` — shared fake session object
- `fromPartition()` — returns same fake session

**Fake session properties:**
- `setPermissionRequestHandler()` — no-op
- `setPermissionCheckHandler()` — no-op
- `webRequest` object with event handlers (no-ops)
- `setProxy()` → resolved promise
- `clearCache()` → resolved promise
- `clearStorageData()` → resolved promise

#### Other Objects — Lines 193-196
- `nativeTheme` — dark mode stub with event stubs
- `powerMonitor` — idle time stub (always active, 0 idle time)
- `clipboard` — read/write stubs (return empty strings)
- `screen` — fake display stub (1920x1080, 1x scale factor)
- `net` — throws error on `request()`, `isOnline()` returns true

### Exported Module
```javascript
module.exports = {
  app, ipcMain, BrowserWindow, safeStorage, dialog, shell, Menu,
  session, nativeTheme, powerMonitor, clipboard, screen, net,
  ipcRenderer: null,
};
```

### Potential Issues
1. **Platform hardcoding:** Paths always use Windows conventions (AppData/Roaming)
2. **`once` not implemented:** Listeners stored via `once()` are treated as persistent
3. **Fake encryption:** XOR cipher breaks if key discovered (which it is, hardcoded)
4. **File dialog always canceled:** Prevents testing file selection flows
5. **No WebSocket support:** `net.request()` throws, preventing HTTP-based communication in tests
6. **Broken state tracking:** Many state queries (isMinimized, isVisible, etc.) always return false/true

---

## FILE 6: firstRunSetup.js

### File Purpose & Overview
Background CUDA backend setup for Windows x64 (packaged builds only). Detects NVIDIA GPUs, downloads @node-llama-cpp CUDA binaries from npm registry, extracts with system tar.exe, falls back to userData directory if primary install directory is read-only.

### Imports & Dependencies
- `https` (Node.js core) — HTTPS downloads
- `fs` (Node.js core) — file I/O
- `path` (Node.js core) — path manipulation
- `os` (Node.js core) — temp directory and platform detection
- `execFile`, `exec` from `child_process` — spawn commands for nvidia-smi, tar, registry lookups
- `app` from `electron` — userData path, resource path (packaged), isPackaged flag

### Constants

#### `VER` (string) — Lines 17-29
**Purpose:** Resolved node-llama-cpp version  
**Logic:**
- If packaged: reads version from `<resourcesPath>/app.asar.unpacked/node_modules/node-llama-cpp/package.json`
- Fallback: reads version from require-resolved package.json
- If all fail: defaults to '3.17.1'
- **Issue:** Hardcoded fallback; git hash not used for versioning

#### `PACKAGES` (array) — Lines 31-36
**Purpose:** Packages to download  
**Structure:** each object contains:
- `name` (string) — scoped npm package name (`@node-llama-cpp/win-x64-cuda`, `@node-llama-cpp/win-x64-cuda-ext`)
- `sizeMB` (number) — approximate download size
- `url` (string) — npm registry tgz URL interpolated with version

**Packages:**
1. `@node-llama-cpp/win-x64-cuda` (134 MB) — base GPU binaries
2. `@node-llama-cpp/win-x64-cuda-ext` (430 MB) — extended CUDA libraries

### Internal Functions

#### `resolveNodeLlamaCppVersion()` — Lines 17-29
**Parameters:** none  
**Return:** version string (e.g., "3.17.1")  
**Logic:**
1. If `app.isPackaged`:
   - Constructs path: `<resourcesPath>/app.asar.unpacked/node_modules/node-llama-cpp/package.json`
   - Reads and parses; returns version if present
2. Fallback: `require.resolve('node-llama-cpp/package.json')`, read and return version
3. If both fail: returns hardcoded '3.17.1'
- **Issue:** No git hash, no build metadata; version conflicts possible

#### `getUnpackedNodeModules()` — Lines 40-43
**Parameters:** none  
**Return:** string path or null  
**Logic:**
- If not packaged: returns null (dev mode has no unpacked modules)
- Otherwise: returns `<resourcesPath>/app.asar.unpacked/node_modules`

#### `isCudaPresent(nodeModulesDir, pkgName)` — Lines 45-62
**Parameters:**
- `nodeModulesDir` (string or null) — primary install location
- `pkgName` (string) — scoped package name (e.g., `@node-llama-cpp/win-x64-cuda`)

**Return:** boolean — true if CUDA libraries detected in either location  
**Logic:**
- Builds directories array: primary, then userData fallback if different
- For each directory:
  - Constructs path: `<dir>/<split package name>/bins`
  - Checks if `bins/` exists
  - Validates version in package.json matches `VER` (skips if version mismatch)
  - Scans `bins/` recursively for `.dll`, `.node`, `.so` files
  - Returns true if > 2 binary files found
  - Catches errors and continues
- Returns false if no directory has binaries

**Issues:**
- Hardcoded file count threshold (2) is arbitrary
- No verification of actual library functionality

#### `getStatePath()` — Line 64
**Parameters:** none  
**Return:** path string  
**Logic:** returns `<userData>/cuda-setup-state.json`

#### `isSetupComplete()` — Lines 66-82
**Parameters:** none  
**Return:** boolean  
**Logic:**
- Reads `cuda-setup-state.json`
- Checks: `complete === true` AND `version === VER`
- Verifies all packages present in unpacked node_modules via `isCudaPresent()`
- If `userDataModulesPath` stored, verifies all packages present there too
- Returns false if ANY check fails or on read error
- **Issue:** Doesn't verify binaries are actually functional, only file presence

#### `markComplete(udDir)` — Lines 84-93
**Parameters:** `udDir` (string or null) — userData modules path if download went there  
**Return:** undefined  
**Logic:**
- Checks if any packages landed in userData (fallback location)
- Writes state file: `{ complete: true, version: VER, completedAt, userDataModulesPath }`
- Swallows write errors silently
- **Issue:** Doesn't synchronize if write fails; state could be inconsistent

#### `detectNvidiaGPU()` — Lines 95-107
**Parameters:** none  
**Return:** Promise resolving to `{ found: boolean, name: string|null }`  
**Logic:**
- Attempts three detection methods in order:
  1. `nvidia-smi --query-gpu=name --format=csv,noheader` (5s timeout)
     - Parses first line as GPU name
  2. Checks for `nvcuda.dll` in System32
  3. Queries registry: `HKLM\SOFTWARE\NVIDIA Corporation\Global\DisplayDriverVersion` (3s timeout)
- Returns on first success; if all fail, returns `{ found: false }`
- **Issue:** nvidia-smi output could be multiline; only takes first GPU

#### `download(url, dest, onProgress)` — Lines 109-133
**Parameters:**
- `url` (string) — HTTPS URL
- `dest` (string) — destination file path
- `onProgress` (function) — progress callback (pct: 0-100, got: bytes, total: bytes)

**Return:** Promise resolving on completion  
**Logic:**
- Follows HTTPS redirects (up to 5)
- Parses `Content-Length` header
- Writes to destination file via stream
- Calls `onProgress` on each data chunk if total known
- **Errors:**
  - Rejects on non-200 status
  - Rejects on write error
  - Rejects on socket error

#### `extract(tgz, destDir)` — Lines 135-143
**Parameters:**
- `tgz` (string) — path to .tar.gz file
- `destDir` (string) — destination directory

**Return:** Promise resolving on extraction completion  
**Logic:**
- Creates destination directory recursively
- Runs system `tar.exe`: `tar -xzf <tgz> --strip-components=1 -C <destDir>`
- 120-second timeout
- Rejects on non-zero exit

**Issues:**
- No input validation on paths; could be vulnerable to injection if tgz name contains special chars
- Assumes tar.exe exists at standard location

#### `copyDirRecursive(src, dst)` — Lines 145-151
**Parameters:** source and dest directories  
**Return:** undefined  
**Logic:**
- Creates destination
- Iterates all entries (with `withFileTypes: true` for type info)
- Recursively copies directories; copies files

#### `consolidateToUserData(nmDir, udDir)` — Lines 153-168
**Parameters:**
- `nmDir` (string) — primary node_modules location
- `udDir` (string) — userData fallback location

**Return:** boolean — true if any packages found in userData  
**Logic:**
- Checks if any packages already in userData
- If found: returns false (consolidation unnecessary)
- Otherwise: for each package not found in userData, copies entire package from primary to userData
- Swallows errors silently
- Returns whether any packages were in userData to begin with

**Issues:**
- Return value semantics unclear (returns whether packages *already* in userData, not whether consolidation succeeded)

#### `notify(win, msg, state)` — Lines 170-172
**Parameters:**
- `win` (BrowserWindow) — main window
- `msg` (string) — notification message
- `state` (string, default 'cuda-setup') — state tag

**Return:** undefined  
**Logic:** Sends `llm-status` IPC with `{ state, message }`; swallows destroy errors

### Exported Function

#### `runFirstRunSetup(mainWindow)` — Lines 174-256
**Parameters:** `mainWindow` (BrowserWindow)  
**Return:** Promise (always resolves; never rejects)  
**Logic:**

**1. Preconditions (lines 175-177):**
- If dev mode: logs skip, returns
- If not Windows x64: logs skip, returns
- If no unpacked modules: returns

**2. Check if already complete (lines 179-182):**
- If `isSetupComplete()`: returns (setup already done)

**3. Check for CUDA presence (lines 184-188):**
- Verifies all packages present (already extracted from prior run)
- If all present: consolidates to userData, marks complete, returns

**4. GPU detection (lines 190-193):**
- Detects GPU
- If not found: marks complete (skip CUDA for this system), returns

**5. Main download/extract loop (lines 195-232):**
- Creates temp dir
- For each CUDA package:
  - If already present: skip to next
  - Download: calls `download()` with progress callback
    - On error: notifies user, returns (stops entire setup)
    - Deletes temp tgz on error
  - Extract: tries primary location; if EPERM/EACCES, tries userData fallback
    - On error: notifies user, returns
  - Deletes tgz file
  - Accumulates completed size for overall progress

**6. Cleanup & fin (lines 234-238):**
- Removes temp directory
- Consolidates downloaded packages to userData if any there
- Marks complete
- Notifies user ("GPU acceleration ready")

### Event Delivery
- Sends `llm-status` IPC for: download progress, installation status, completion, errors, warnings

### Potential Issues
1. **Incomplete error recovery:** If download fails, setup is permanently abandoned (no retry)
2. **Race condition:** Multiple processes could start CUDA setup concurrently; no lock
3. **Missing validation:** Downloaded files not checksum-verified
4. **Fallback consolidation semantics:** `consolidateToUserData()` return value meaning is unclear
5. **Silent error swallowing:** Extraction errors cause silent return; user only sees notification
6. **Hardcoded file thresholds:** 2-file minimum for detection is arbitrary
7. **No timeout for full sequence:** Individual downloads have timeouts, but no overall timeout
8. **Path injection vulnerability:** tgz filenames and paths not sanitized before shell commands
9. **Windows-only:** Entire module Windows-specific; Linux/macOS have zero CUDA support

---

## FILE 7: gitManager.js

### File Purpose & Overview
Shell-based git integration for guIDE. Every operation shells out to system git binary via child_process.exec(). No external npm dependencies; wraps git CLI output parsing.

### Imports & Dependencies
- `exec` from `child_process` — spawn git subcommands
- `path` (Node.js core) — path utilities
- `fs` (Node.js core) — file system checks

### Class: GitManager

#### Constructor — Lines 13-16
**Initializes:**
- `projectPath` (string or null) — current project root directory
- `gitAvailable` (boolean, default false) — whether git binary is accessible in current project

#### `setProjectPath(projectPath)` — Lines 20-29
**Parameters:** `projectPath` (string or null)  
**Return:** Promise resolving to `{ isRepo: boolean }`  
**Logic:**
- Stores projectPath
- Sets gitAvailable to false initially
- Returns `{ isRepo: false }` if path is falsy
- Attempts two commands:
  1. `git --version` — test git availability
  2. `git rev-parse --git-dir` — test if in git repo
- If both succeed: sets gitAvailable = true, returns `{ isRepo: true }`
- Catches any error: returns `{ isRepo: false }`

#### Branch Queries

##### `getBranch()` — Lines 33-37
**Parameters:** none  
**Return:** Promise resolving to branch name (string)  
**Logic:**
- Executes `git branch --show-current`
- Returns trimmed output (or 'HEAD (detached)' if empty)
- Catches error: returns empty string

##### `getBranches()` — Lines 39-44
**Parameters:** none  
**Return:** Promise resolving to array of `{ name, current: boolean }`  
**Logic:**
- Executes `git branch --no-color`
- Splits by newline, trims
- Maps each line to object: name (asterisk removed), current (has asterisk prefix)
- Catches error: returns empty array

##### `checkout(branch)` — Lines 46-48
**Parameters:** branch name (string)  
**Return:** Promise resolving to `{ success, branch, error }`  
**Logic:**
- Executes `git checkout <quoted-branch>`
- Returns `{ success: true, branch }` on success
- Catches error: returns `{ success: false, error: message }`

#### Status & Diff

##### `getStatus()` — Lines 52-80
**Parameters:** none  
**Return:** Promise resolving to `{ files: array, branch, error }`  
**Logic:**
- Returns `{ files: [], branch: '' }` if git unavailable
- Executes two commands in parallel:
  1. `git status --porcelain=v1 -uall`
  2. `getBranch()` for current branch
- Parses porcelain output (two-character status codes + path):
  - First char (index status): A (added), M (modified), D (deleted), R (renamed), space (no change), ? (untracked)
  - Second char (working tree status): M, D, ?, space
  - Remaining: file path (possibly with `->` for renames)
  - Extracts oldPath for renames; rest is current name
- Maps each line to object:
  ```
  {
    path, oldPath (if rename), status, staged,
    indexStatus, workTreeStatus
  }
  ```
- Status values: 'added', 'modified', 'deleted', 'renamed', 'untracked'
- Staged logic:
  - Index status not space → staged (except ? untracked)
  - If workTree is ?, can be unstaged if index is space
  - Combinaton flag set if both index and workTree have changes
- Catches error: returns `{ files: [], branch: '', error }`

**Issues:**
- Complex staged logic with multiple branches; difficult to verify correctness
- Rename parsing assumes format `oldPath -> newPath` (exact)

##### `getDiff(filePath, staged)` — Lines 82-87
**Parameters:**
- `filePath` (string) — file path to diff
- `staged` (boolean, default false) — show staged diff

**Return:** Promise resolving to `{ success, diff, error }`  
**Logic:**
- Constructs git diff command with `--cached` flag if staged
- Executes: `git diff [--cached] -- <quoted-path>`
- Returns `{ success: true, diff }`
- Catches error: returns `{ success: false, error, diff: '' }`

##### `getStagedDiff()` — Lines 89-91
**Parameters:** none  
**Return:** Promise resolving to `{ success, diff, error }`  
**Logic:**
- Executes `git diff --cached`
- Returns `{ success: true, diff }`
- Catches: returns `{ success: false, diff: '', error }`

##### `getAllDiff()` — Lines 93-100
**Parameters:** none  
**Return:** Promise resolving to `{ success, diff, error }`  
**Logic:**
- Executes both `git diff --cached` and `git diff` in parallel
- Concatenates results with newline
- Returns combined diff
- Catches: returns `{ success: false, diff: '', error }`

#### Stage / Unstage / Discard

##### `stage(filePath)` — Lines 104-106
**Parameters:** file path (string)  
**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git add -- <path>`; returns `{ success: true }` or error

##### `stageAll()` — Lines 108-110
**Parameters:** none  
**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git add -A`

##### `unstage(filePath)` — Lines 112-114
**Parameters:** file path (string)  
**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git reset HEAD -- <path>`

##### `unstageAll()` — Lines 116-118
**Parameters:** none  
**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git reset HEAD`

##### `discardChanges(filePath)` — Lines 120-122
**Parameters:** file path (string)  
**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git checkout -- <path>`

#### Commit

##### `commit(message)` — Lines 126-133
**Parameters:** message (string)  
**Return:** Promise resolving to `{ success, output, error }`  
**Logic:**
- Validates message not empty; rejects if invalid
- Executes `git commit -m <quoted-message>`
- Returns `{ success: true, output }`
- Catches: returns `{ success: false, error }`

#### Log Queries

##### `getLog(count)` — Lines 137-145
**Parameters:** count (number, default 20)  
**Return:** Promise resolving to array of `{ hash (short), message }`  
**Logic:**
- Executes `git log --oneline --no-color -<count>`
- Splits by newline
- Parses each line: first 7 chars = hash, rest = message
- Catches: returns empty array

**Issues:**
- Hash is full SHA; code extracts first 7 chars (short hash) from oneline format which already shows short hash

##### `getCommitDetail(hash)` — Lines 147-165
**Parameters:** commit hash (string)  
**Return:** Promise resolving to `{ success, commit: {...}, error }`  
**Logic:**
- Executes custom format: `git show --stat --format=...`
- Format string extracts: hash, author, email, date, subject, body, stats
- Parses multiline output: first 5 lines are metadata, then body until `---STAT---`, then stats
- Returns object: `{ hash, author, email, date, subject, body, stats }`
- Catches: returns `{ success: false, error }`

##### `getCommitDiff(hash)` — Lines 167-169
**Parameters:** commit hash (string)  
**Return:** Promise resolving to `{ success, diff, error }`  
**Logic:**
- Executes `git show --format="" <hash>` (suppresses commit message, shows diff)
- Returns diff

#### Ahead/Behind

##### `getAheadBehind()` — Lines 171-176
**Parameters:** none  
**Return:** Promise resolving to `{ ahead, behind }` (both numbers, default 0)  
**Logic:**
- Executes `git rev-list --left-right --count HEAD...@{upstream}`
- Parses space-separated numbers: first = ahead, second = behind
- Catches: returns `{ ahead: 0, behind: 0 }`

#### Init

##### `init()` — Lines 180-183
**Parameters:** none  
**Return:** Promise resolving to `{ success, error }`  
**Logic:**
- Executes `git init`
- Sets gitAvailable = true on success
- Returns `{ success: true }`

#### Push/Pull/Fetch

##### `push(remote, branch)` — Lines 187-204
**Parameters:**
- `remote` (string, default 'origin')
- `branch` (string, optional)

**Return:** Promise resolving to `{ success, output, setUpstream, error }`  
**Logic:**
- Constructs git command: `git push <remote> [branch]`
- On success: returns `{ success: true, output }`
- On error, if "no upstream branch" message detected:
  - Attempts `git push --set-upstream <remote> <current-branch>`
  - On second success: returns `{ success: true, output, setUpstream: true }`
  - On failure: returns error
- Catches: returns error

##### `pull(remote, branch)` — Lines 206-210
**Parameters:** remote (string), branch (string)  
**Return:** Promise resolving to `{ success, output, error }`  
**Logic:** Executes `git pull <remote> [branch]`

##### `fetch(remote)` — Lines 212-214
**Parameters:** remote (string)  
**Return:** Promise resolving to `{ success, output, error }`  
**Logic:** Executes `git fetch <remote>`

#### Branch Management

##### `createBranch(name, checkout)` — Lines 218-222
**Parameters:**
- `name` (string) — branch name
- `checkout` (boolean, default true) — whether to checkout after creating

**Return:** Promise resolving to `{ success, branch, error }`  
**Logic:**
- If checkout: `git checkout -b <name>`
- Else: `git branch <name>`

##### `deleteBranch(name, force)` — Lines 224-228
**Parameters:**
- `name` (string)
- `force` (boolean, default false)

**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git branch [-D | -d] <name>`

##### `merge(branch)` — Lines 230-247
**Parameters:** branch name (string)  
**Return:** Promise resolving to `{ success, conflict, conflictFiles, output, error }`  
**Logic:**
- Executes `git merge <branch>`
- On success: returns `{ success: true, output }`
- On error, if "CONFLICT" or "Automatic merge failed":
  - Attempts to extract conflict files via `git status --porcelain=v1`
  - Filters for conflict markers (UU, AA, DD, UA, AU status codes)
  - Returns `{ success: false, conflict: true, conflictFiles, error }`
- Catches: returns error

**Issues:**
- Conflict file parsing assumes `git status` format; if status fails, returns empty conflictFiles

##### `mergeAbort()` — Lines 249-251
**Parameters:** none  
**Return:** Promise resolving to `{ success, error }`  
**Logic:** Executes `git merge --abort`

##### `getMergeState()` — Lines 253-265
**Parameters:** none  
**Return:** Promise resolving to `{ inMerge, conflictFiles: array }`  
**Logic:**
- Checks for `.git/MERGE_HEAD` file existence (indicator of ongoing merge)
- If not present: returns `{ inMerge: false, conflictFiles: [] }`
- If present: executes `git status --porcelain=v1` to find conflicts
- Extracts conflict files same as `merge()` error handler
- Catches: returns `{ inMerge: false, conflictFiles: [] }`

#### Blame

##### `getBlame(filePath)` — Lines 269-297
**Parameters:** file path (string)  
**Return:** Promise resolving to array of blame entries  
**Logic:**
- Returns empty array if not git available or path falsy
- Executes `git blame --porcelain <relative-path>`
- Parses porcelain format:
  - Lines starting with 40-hex-char hash: commit metadata
  - Lines starting with tab: content line
  - Metadata lines: author, author-time (unix ts), summary
- Maps each blame entry to object:
  ```
  { line, hash (7-char), author, summary, date (locale string) }
  ```
- Catches: returns empty array

**Issues:**
- No support for unreachable commits or boundary commits (^<hash> syntax)

#### Internal Helper

##### `_q(input)` — Line 301
**Parameters:** input (string)  
**Return:** quoted string  
**Logic:** Wraps input in double quotes; escapes internal quotes

##### `_exec(command)` — Lines 303-312
**Parameters:** command (string)  
**Return:** Promise resolving to stdout  
**Logic:**
- Executes via `child_process.exec()` with:
  - `cwd: projectPath`
  - `maxBuffer: 1MB`
  - `timeout: 15s`
  - `windowsHide: true`
- On error: rejects with stderr or error message
- On success: resolves with stdout
- **Issue:** 15s timeout might be insufficient for large repos or slow networks

### Exported
```javascript
module.exports = { GitManager };
```

### Potential Issues
1. **Command injection vulnerability:** Quote escaping via `_q()` may not cover all cases (unicode escapes, newlines within quoted strings)
2. **Porcelain parsing fragility:** Multi-line output parsing assumes exact format; git version differences could break
3. **Commit detail parsing:** Hardcoded line count (5) for metadata; if git format changes, parsing breaks
4. **Conflict detection:** Only detects via keyword matching or status codes; complex merges might not be detected
5. **Blame performance:** No pagination; `getBlame()` fetches entire file (could be megabytes)
6. **15-second timeout:** Too short for large repos on slow networks
7. **No git version checking:** Assumes git features are available (could fail on very old git versions)
8. **Path normalization:** Passed paths not normalized; case sensitivity issues on case-insensitive filesystems

---

## FILE 8: licenseManager.js

### File Purpose & Overview
License activation and enforcement for guIDE. Supports three activation methods: license keys (HMAC-signed, server validation), account email/password (OAuth), and OAuth tokens. Implements 14-day revalidation cycle. Machine fingerprinting prevents license transfer. NODE_ENV=development bypasses all checks.

### Imports & Dependencies
- `crypto` (Node.js core) — HMAC signing, hashing
- `os` (Node.js core) — machine fingerprint collection
- `path` (Node.js core) — file path utilities
- `fs` (Node.js core) — file I/O
- `https` (Node.js core) — HTTPS POST to license server
- `electron` (app object) — userData path

### Module-Level State

#### HMAC Secret Construction
**Lines 11-14:** Three buffers concatenated (split to resist casual grep):
```
_k1 = [0x67, 0x53, 0x21, 0x64, 0x33]  // "gS!d3"
_k2 = [0x5f, 0x32, 0x30, 0x32, 0x36]  // "_2026"
_k3 = [0x5f, 0x70, 0x72, 0x30, 0x74, 0x33, 0x63, 0x74]  // "_pr0t3ct"
HMAC_SECRET = "gS!d3_2026_pr0t3ct"
```

#### Constants
- `REVALIDATION_DAYS` — 14 days between server checks
- `KEY_RE` — regex validating key format: `GUIDE-XXXX-XXXX-XXXX-XXXX` (5 segments, 4 alphanumeric each)

### Class: LicenseManager

#### Constructor — Lines 18-27
**Initializes:**
- `licenseData` (object or null) — loaded license
- `isActivated` (boolean) — activation state
- `activationError` (string) — last error message
- `serverHost` — 'graysoft.dev'
- `serverPath` — '/api/license/validate'
- `licenseDir` — `<userData>/license`
- `licenseFile` — `<licenseDir>/license.json`

#### `getMachineFingerprint()` — Lines 31-39
**Parameters:** none  
**Return:** 32-character hex string  
**Logic:**
- Collects parts: hostname, username, platform, arch, CPU model, CPU count, total memory
- Concatenates with `|` separator
- Returns first 32 chars of SHA-256 hash
- **Issue:** Changes if any hardware component changes; upgrade breaks activation

#### Signing & Verification

##### `_sign(data)` — Lines 42-46
**Parameters:** data object  
**Return:** hex-encoded HMAC-SHA256 digest  
**Logic:**
- Serializes data to JSON
- Computes HMAC-SHA256 with `HMAC_SECRET + machineFingerprint`
- Returns hex digest

##### `_verify(data, signature)` — Line 48
**Parameters:** data object, signature hex string  
**Return:** boolean  
**Logic:** Computes sign(data) and compares == signature

##### `_readSigned(filePath)` — Lines 50-57
**Parameters:** file path (string)  
**Return:** parsed data object or null  
**Logic:**
- Reads and parses JSON from file
- If file missing: returns null
- If no `_sig` / `_data` fields: returns parsed object as-is (no signature on file)
- If signature verify fails: returns null (tampered)
- Catches parse errors: returns null

##### `_writeSigned(filePath, data)` — Lines 59-64
**Parameters:** file path (string), data object  
**Return:** undefined  
**Logic:**
- Creates license directory if missing
- Writes JSON: `{ _data: data, _sig: sign(data) }`
- Catches errors: logs and continues (non-fatal)

#### Key Format Validation

##### `isValidKeyFormat(key)` — Line 68
**Parameters:** key (string or null)  
**Return:** boolean  
**Logic:** Tests uppercase key against `KEY_RE` regex

#### Access Control

##### `checkAccess()` — Lines 72-82
**Parameters:** none  
**Return:** object `{ allowed, reason, activated }`  
**Logic:**
- If dev mode (`NODE_ENV === development`): returns `{ allowed: true, reason: 'dev-mode', activated: true }`
- If `isActivated`: returns `{ allowed: true, reason: 'activated', activated: true }`
- Otherwise: returns `{ allowed: false, reason: 'not-activated', activated: false }`
- **Issue:** Dev mode check uses package location, but NODE_ENV could be overridden post-build

#### License Loading

##### `loadLicense()` — Lines 86-109
**Parameters:** none  
**Return:** object `{ activated, needsRevalidation, license, authenticated, error }`  
**Logic:**
- Reads signed license file
- Validates machine fingerprint matches (prevents license transfer)
- **Full license path:** if (key OR account login OR OAuth) AND activatedAt exists:
  - Stores in `licenseData`, sets `isActivated = true`
  - Calculates days since `lastValidated`
  - If ≥ 14 days: returns `{ activated: true, needsRevalidation: true }`
  - Otherwise: returns `{ activated: true, license: sanitized }`
- **OAuth-free path:** if OAuth AND email AND !activatedAt:
  - Stores in `licenseData`, sets `isActivated = false` (authenticated but unlicensed)
  - Returns `{ activated: false, authenticated: true, license: sanitized }`
- Catches errors: returns `{ activated: false }`

#### License Activation

##### `activate(licenseKey)` — Lines 113-129
**Parameters:** license key (string)  
**Return:** Promise resolving to `{ success, message, error }`  
**Logic:**
- Validates key format
- Calls `_validateOnline()` with key and machineFingerprint
- On server success: saves license data, sets `isActivated = true`
- Returns `{ success: true, message }`
- On server failure or network error: returns error
- **Issue:** Network errors treated same as invalid key (user can't distinguish)

##### `activateWithAccount(email, password)` — Lines 133-155
**Parameters:** email (string), password (string)  
**Return:** Promise resolving to `{ success, message, license, error, authenticated }`  
**Logic:**
- Validates inputs not empty
- Calls `_authenticateOnline()` to server
- On success: saves license, sets `isActivated = true`
- Returns `{ success: true, message, license }`
- On failure: returns error
- Catches network error: returns error
- **Issue:** No rate limiting on failed attempts

##### `activateWithToken(token)` — Lines 159-185
**Parameters:** OAuth token (string)  
**Return:** Promise resolving to `{ success, authenticated, email, message, license, error }`  
**Logic:**
- Validates token not empty
- Calls `_activateTokenOnline()` to server
- On success + license: saves activated license
- On success + no license + email: saves authenticated-only state (free user)
  - Returns `{ success: false, authenticated: true, email, error: 'No active license' }`
- On failure: returns error
- Catches network: returns error

#### Deactivation

##### `deactivate()` — Lines 189-194
**Parameters:** none  
**Return:** Promise resolving to `{ success: true }`  
**Logic:**
- Deletes license file (if exists)
- Clears `licenseData`, sets `isActivated = false`
- Swallows delete errors

#### Session Token (for proxied requests)

##### `getSessionToken()` — Line 198
**Parameters:** none  
**Return:** token string or null  
**Logic:** Returns `licenseData?.sessionToken` or null

#### Status Reporting

##### `getStatus()` — Lines 202-209
**Parameters:** none  
**Return:** object `{ isActivated, isAuthenticated, license, machineId, access }`  
**Logic:**
- Returns current state object with access check result

#### Revalidation

##### `revalidate()` — Lines 212-227
**Parameters:** none  
**Return:** Promise resolving to `{ success: boolean, error }`  
**Logic:**
- If no key stored: returns `{ success: isActivated }`
- Calls `_validateOnline()` with stored key
- On success: updates `lastValidated` timestamp, saves
- On failure: sets `isActivated = false`, returns error
- On network error: returns `{ success: isActivated }` (keep expired but working)
- **Issue:** Silent failure doesn't halt usage; expired licenses continue working

#### Developer Activation

##### `devActivate(devKey)` — Lines 231-240
**Parameters:** dev key (string)  
**Return:** object `{ success, message, error }`  
**Logic:**
- Validates key starts with 'GUIDE-DEV0'
- Validates format
- Saves license data with email 'developer@graysoft.dev', plan 'developer'
- Sets `isActivated = true`
- Returns `{ success: true, message }`

#### Server Communication

##### `_sanitize(d)` — Lines 244-252
**Parameters:** license data object  
**Return:** sanitized object for display  
**Logic:**
- Masks key (shows first 10 chars + '...')
- Includes: activatedAt, lastValidated, email, plan, expiresAt, authMethod

##### `_save(data)` — Lines 254-257
**Parameters:** license data object  
**Return:** undefined  
**Logic:** Stores in `licenseData` and writes signed to file

##### `_httpsPost(hostPath, body)` — Lines 259-275
**Parameters:** path (string), body object  
**Return:** Promise resolving to parsed JSON response  
**Logic:**
- Serializes body to JSON
- Sends HTTPS POST to `graysoft.dev:443` with path
- Sets 10-second timeout before destroying connection
- Parses response JSON
- Returns response (or error object if parse fails)

##### `_validateOnline(key, machineId)` — Lines 277-281
**Parameters:** license key (string), machine ID (string)  
**Return:** Promise resolving to server response  
**Logic:** Sends POST to `/api/license/validate` with key, machineId, platform, appVersion

##### `_authenticateOnline(email, password, machineId)` — Lines 283-287
**Parameters:** email, password, machineId (strings)  
**Return:** Promise resolving to server response  
**Logic:** Sends POST to `/api/auth/login` with credentials

##### `_activateTokenOnline(token, machineId)` — Lines 289-293
**Parameters:** token, machineId (strings)  
**Return:** Promise resolving to server response  
**Logic:** Sends POST to `/api/auth/activate-token` with token

### Exported
```javascript
module.exports = LicenseManager;
```

### Potential Issues
1. **Hardware fingerprint fragility:** Single CPU/memory/hostname change breaks activation; no migration path
2. **Hardcoded dev key prefix:** 'GUIDE-DEV0' is discoverable; should be random/hashed
3. **HMAC secret weak:** Split bytes don't provide real security; key is in source code
4. **Signature verification insufficient:** HMAC with fixed secret; no timestamp/nonce protection
5. **Network errors silent:** Revalidation on timeout succeeds (expired licenses keep working)
6. **No rate limiting:** Multiple failed activation attempts not throttled
7. **14-day revalidation hardcoded:** Could be bypassed by setting system clock back
8. **Machine ID leakage:** Fingerprint could be used to track users
9. **Token storage:** Session tokens stored in plaintext in license.json (not encrypted beyond HMAC)
10. **Server dependency:** Network outage means no new licenses can be issued

---

## FILE 9: terminalManager.js

### File Purpose & Overview
Terminal session manager using node-pty (with child_process fallback). Creates multiple terminal instances, each with unique ID. Emits 'data' and 'exit' events. Supports PTY-based interactivity or fallback piped I/O.

### Imports & Dependencies
- `os` (Node.js core) — default shell detection
- `path` (Node.js core) — path utilities
- `EventEmitter` from `events` (Node.js core) — event emission base
- `logger` (./logger) — logging
- `node-pty` (npm, optional) — pseudo-terminal spawning; gracefully degrades if unavailable

### Module-Level State
- `pty` (module or null) — conditionally loaded node-pty (set to null if import fails)
- Logs warning if node-pty unavailable

### Class: TerminalManager extends EventEmitter

#### Constructor — Lines 17-22
**Initializes:**
- `_terminals` (Map) — id → { pty, cwd, [proc], [fallback] }
- `_nextId` (number) — 1-indexed terminal ID counter

#### `create(opts)` — Lines 26-60
**Parameters:** options object containing:
- `shell` (string) — shell executable (default auto-detected)
- `cwd` (string) — working directory (default home)
- `cols`, `rows` (numbers) — terminal dimensions
- `env` (object) — environment variables to merge

**Return:** terminal ID (number)  
**Logic:**
- Generates ID, selects shell/cwd/dimensions with defaults
- Merges env with process.env
- **If node-pty available:**
  - Spawns PTY with shell name and dimensions
  - Sets data handler: emits 'data' event with `{ id, data }`
  - Sets exit handler: emits 'exit' with `{ id, exitCode }`, deletes from map
  - Stores `{ pty, cwd }` in map
- **If node-pty unavailable (fallback):**
  - Spawns shell via child_process.spawn() with piped stdio
  - Attaches both stdout and stderr as data handlers
  - Stores `{ proc, cwd, fallback: true }` in map
- Logs terminal creation
- Returns ID

#### `write(id, data)` — Lines 62-69
**Parameters:**
- `id` (number) — terminal ID
- `data` (string) — data to write

**Return:** undefined  
**Logic:**
- Looks up terminal in map
- If PTY: calls `pty.write(data)`
- If fallback and stdin writable: calls `proc.stdin.write(data)`

#### `resize(id, cols, rows)` — Lines 71-78
**Parameters:**
- `id` (number) — terminal ID
- `cols`, `rows` (numbers) — new dimensions

**Return:** undefined  
**Logic:**
- Looks up terminal
- If PTY: calls `pty.resize(cols, rows)` (catches errors silently)
- Fallback has no resize support (no-op)

#### `destroy(id)` — Lines 80-92
**Parameters:** terminal ID (number)  
**Return:** undefined  
**Logic:**
- Looks up terminal
- Kills PTY or process: SIGTERM (via `.kill()`)
- Removes from map
- Logs destruction
- Catches errors silently

#### `list()` — Lines 94-101
**Parameters:** none  
**Return:** array of `{ id, cwd, fallback: boolean }`  
**Logic:** Maps all terminals

#### `disposeAll()` — Lines 103-106
**Parameters:** none  
**Return:** undefined  
**Logic:** Destroys all terminals

#### Helper Function

##### `_defaultShell()` — Lines 108-111
**Parameters:** none  
**Return:** shell path (string)  
**Logic:**
- If Windows: returns 'powershell.exe'
- Otherwise: returns $SHELL env var or '/bin/bash'

### Exported
```javascript
module.exports = { TerminalManager };
```

### Potential Issues
1. **Node-pty optional dependency:** Silent failure if missing; fallback has no PTY features (no interactive editing, no window resize)
2. **Resize not tested:** Code assumes `pty.resize()` exists/works; no verification
3. **Stderr and stdout merged:** Fallback treats stderr same as stdout (colors/formatting could be lost)
4. **Exit event timing:** Might fire after terminal already destroyed (race condition)
5. **No shell validation:** Custom shell path not checked; could execute arbitrary binary
6. **Memory leak risk:** If terminal not properly destroyed, proc stays in memory
7. **No terminal size limits:** Could create huge PTY (very resource-heavy)
8. **Error swallowing:** Resize errors silently ignored

---

## FILE 10: pathValidator.js

### File Purpose & Overview
Authorization layer preventing file operations outside allowed directories. Blocks system paths, credential directories (.ssh, .aws, .kube, .docker), config files (.gitconfig, .bashrc), sensitive files (.env).

### Imports & Dependencies
- `app` from `electron` — `getPath()` API
- `path` (Node.js core) — path resolution

### Exported Function

#### `createPathValidator(appBasePath, modelsBasePath, getCurrentProjectPath)` — Lines 5-56
**Parameters:**
- `appBasePath` (string) — application root directory
- `modelsBasePath` (string) — model storage directory
- `getCurrentProjectPath` (function() → string | null) — callback returning active project path

**Return:** function `isPathAllowed(targetPath) → boolean`  
**Logic:**
- **Allowed roots:** Application dir, models dir, userData, home, documents, desktop, downloads
- **Blocked patterns (regex array):**
  - `windows\system32`, `program files`, `programdata` — Windows system dirs
  - `etc`, `boot`, `sbin`, `proc`, `sys` — Linux system dirs
  - `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker` — credential/config dirs
  - `.npmrc`, `.pypirc`, `.netrc`, `.gitconfig`, `.git-credentials` — package manager/version control secrets
  - `.bash_history`, `.zsh_history` — shell history

#### `isPathAllowed(targetPath)` — Lines 23-39
**Parameters:** target path (string)  
**Return:** boolean — true if path is allowed, false otherwise  
**Logic:**
1. Input validation: returns false if falsy or not string
2. Sanitization: strips control characters (`\x00-\x1F`, all ASCII control codes including backspace, newline, etc.)
   - **Why:** Malformed JSON can parse control characters as actual control codes (e.g., `\\b` → backspace)
3. Path resolution: calls `path.resolve()` to normalize (forward slashes, remove `..`, etc.)
4. Blocked pattern check: tests resolved path against each regex
   - Returns false on first match
5. Allowed roots check: attempts to find resolved path within any allowed root
   - Dynamic: includes current project path if available (via callback)
   - Returns true on first match
6. Returns false if no allowed root matched

### Potential Issues
1. **Case sensitivity:** Patterns use case-insensitive flags (`/i`), but pattern matching filesystem behavior platform-dependent
2. **Symlink bypass:** `path.resolve()` doesn't follow symlinks; could bypass by linking to blocked path
3. **Control character sanitization incomplete:** Only strips `\x00-\x1F`; other escape sequences not handled
4. **No verification of paths:** Doesn't check if path actually exists (could allow reference to potential future files)
5. **Race condition:** Project path callback could return different value between check and use
6. **Windows UNC paths:** `\\?\C:\...` notation not handled (could bypass rooting checks via alternate path format)
7. **Extended attributes:** Alternate data streams (Windows) not considered

---

## FILE 11: sanitize.js

### File Purpose & Overview
Minimal response sanitizer for LLM output. Removes thinking blocks that were already parsed and routed to thinking panel during streaming. Does NOT strip model tokens, unicode, or markdown formatting.

### Exports

#### `sanitizeResponse(text)` — Lines 10-17
**Parameters:** text (string)  
**Return:** cleaned string  
**Logic:**
1. Type check: returns empty string if falsy
2. Remove thinking blocks:
   - Regex: `/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi` (case-insensitive, greedy match everything)
   - Removes both `<think>...</think>` and `<thinking>...</thinking>` variants
3. Remove orphaned tags:
   - Regex: `/<\/?think(?:ing)?>/gi`
   - Removes any solo opening/closing tags without matching pair
4. Collapse excessive newlines:
   - Regex: `/\n{4,}/g` → replace with `\n\n\n` (max 3 consecutive newlines)
5. Trim and return

### Potential Issues
1. **Incomplete block removal:** If thinking block has nested tags or malformed syntax, might leave orphaned content
2. **Newline truncation arbitrary:** 3-newline maximum not configurable; could strip intentional formatting
3. **Non-greedy matching:** Block removal uses greedy `[\s\S]*?` matching; with nested tags could grab too much
4. **No markdown preservation:** Doesn't handle code blocks with thinking-like syntax (e.g., \`\`\`think)
5. **Unicode thinking tags:** Case-insensitive match might not work for Unicode variants
6. **Single pass:** Only runs one cleaning pass; if stream produces malformed nesting, might not fully clean

### Exported
```javascript
module.exports = { sanitizeResponse };
```

---

# Summary

This audit reveals a production codebase with several well-designed components (git manager, license manager, debug service) but also notable security and reliability concerns:

**Strengths:**
- Comprehensive debug protocol support (CDP + DAP)
- Shell-based git integration with good porcelain parsing
- Detailed license management with HMAC signing
- Path validation with regex-based blocking

**Critical Issues:**
- **apiKeyStore:** Silent failure modes, incomplete migration handling
- **appMenu:** No bounds on recent folders, listener leak
- **debugService:** Race conditions on session start, promise timeout management
- **firstRunSetup:** No retry logic on download failure, path injection vulnerability
- **gitManager:** potential command injection, 15s timeout too short
- **licenseManager:** Hardware fingerprint fragility, network timeouts bypass checks
- **pathValidator:** Symlink bypasses, Windows UNC path handling missing
- **sanitizeResponse:** Incomplete thinking block removal, arbitrary newline limits

**Recommendations:**
1. Implement robust error handling with explicit retry policies
2. Add input validation and sanitization throughout
3. Fix license revalidation to halt on network timeout
4. Implement path canonicalization with symlink resolution
5. Add comprehensive logging for audit trails
6. Increase git operation timeout or make configurable
7. Bound recent folders menu or paginate
8. Implement IPC listener cleanup on module unload

END OF AUDIT REPORT

---

# PART 7 — TOOLS

Now I'll produce a detailed audit document for these three files.

---

# DETAILED CODE AUDIT REPORT
## guIDE IDE Tool Files

**Audit Date:** March 13, 2026  
**Scope:** Browser Tools, Git Tools, Tool Parser  
**Auditor Note:** Every line read and analyzed. Full logic flow traced.

---

## 1. FILE: mcpBrowserTools.js

### 1.1 File Purpose & Overview
**Location:** `C:\Users\brend\IDE\main\tools\mcpBrowserTools.js`  
**Lines:** 1–261  
**Purpose:** Provides browser automation methods mixed onto `MCPToolServer.prototype`. All methods delegate to either Playwright browser instance or a fallback browserManager. Methods handle URL navigation, DOM interaction (click, type, fill), snapshots, screenshots, and advanced interactions (file upload, drag, tabs, dialogs).

**Design Pattern:** Mixin functions (not class methods). Each function name prefixed with `_browser` following naming convention. All functions async-capable. Functions use `this` context to access:
- `this.playwrightBrowser` — Playwright automation instance
- `this.browserManager` — Fallback browser manager (typically Electron webContents)
- `this.projectPath` — Current project directory for URI translation

**Entry Point:** Exported as object literal with 23 functions.

---

### 1.2 Imports & Dependencies

```javascript
const path = require('path');  // Line 3
```

**Usage:** Only usage is in `_browserNavigate` at line 14 to translate workspace URIs to real paths via `path.join()`.

---

### 1.3 Exported Functions (All Async)

#### **_browserNavigate(url)** — Lines 6–52
**Parameters:**
- `url` (string) — Target URL to navigate to

**Return Value:**
- `{ success: false, error: string }` — On failure
- Result from `this.playwrightBrowser.navigate(url)` or `this.browserManager.navigate(url)`

**Logic Flow:**
1. Validate URL exists, trim whitespace, remove surrounding quotes (line 10-11)
2. **Workspace URI Translation** (line 13-16): Convert `file:///workspace/...` paths to real filesystem paths using `path.join()`. This allows the model to reference workspace paths that get translated to absolute paths.
3. **Security: Blocked Schemes** (line 19-22): Block dangerous schemes — javascript, data, ftp, vbscript. Extraction via `url.split(':')[0]`. Critical XSS prevention.
4. **Security: SSRF Guard** (line 25-32): Parse URL and validate hostname against private IP regex:
   - `10.x.x.x`
   - `172.16.0.0 - 172.31.255.255` (16-31 range)
   - `192.168.x.x`
   - `127.x.x.x` (localhost)
   - `0.x.x.x` (current network)
   - localhost (by name)
   - `169.254.x.x` (link-local)
   - Silently catches URL parsing errors (no throw)
5. **Scheme Auto-Prepend** (line 35-37): Add `https://` if no scheme and not file URL
6. **Browser Selection** (line 39-47):
   - Prefer Playwright if available, launch if needed
   - Fallback to browserManager, send IPC message `show-viewport-browser` to parent window
   - Return error if neither available

**Edge Cases & Issues:**
- **SSRF bypass risk:** Parsing error at line 28 is silently caught. Malformed URLs escape security check.
- **Workspace path translation:** Only handles `file:///workspace/` prefix. Other path schemes not addressed.
- **Race condition:** Line 40 launches Playwright asynchronously (`await this.playwrightBrowser.launch?.()`) without state lock. Multiple concurrent calls could race.

---

#### **_browserClick(refStr, options = {})** — Lines 54–91
**Parameters:**
- `refStr` (string) — Element reference/selector
- `options` (object, optional) — `{ element: string }` for fallback matching

**Return Value:**
- `{ success: false, error: string }` — On failure
- `{ success: true }` — On success

**Logic Flow — 3-Attempt Strategy:**
1. **Attempt 0:** Direct click via `browser.click(refStr, options)` (line 67)
2. **Attempt 1:** Refresh element references via `browser.getSnapshot?.()` then retry (lines 63-67)
3. **Attempt 2:** Fallback to JS DOM evaluation (lines 72-89)
   - Query all visible elements containing text from `options.element`
   - If found, click element [0]
   - Else: attempt to dismiss common overlay types: modal, overlay, cookie, consent dialogs
   - Retry search for element after dismissal
   - Return error if not found

**Edge Cases & Issues:**
- **Unsafe string interpolation:** Line 77-79, JSON.stringify in backtick template. If `options.element` contains backticks, template injection possible. Should escape backticks.
- **Blind overlay removal:** Line 85 removes DOM elements with class containing modal/overlay/cookie/consent. No verification these are blocking elements. Could remove important UI components.
- **Dangling continue on catch:** Line 70 `if (attempt < 2) continue;` followed by `catch` at line 71. Control flow: attempt 0 or 1 can fail silently, loop continues to attempt 2. Attempt 2 has no catch, falls through. If all 3 fail, loop exits naturally, returns error at line 91.
- **Race condition in JS fallback:** Line 78-81 evaluates async code in-browser. If DOM changes between evaluation call and its completion, stale references could be used.

---

#### **_browserType(refStr, text, options = {})** — Lines 93–134
**Parameters:**
- `refStr` (string) — Input element reference or numeric index
- `text` (string) — Text to type
- `options` (object, optional) — Additional options

**Return Value:**
- `{ success: false, error: string }` — On failure
- `{ success: true }` — On success

**Logic Flow — 3-Attempt Strategy (identical to _browserClick):**
1. **Attempt 0:** Direct type via `browser.type(refStr, text, options)`
2. **Attempt 1:** Refresh snapshot + retry
3. **Attempt 2:** JS fallback (lines 122-132):
   - Parse `refStr` as numeric index (default 0)
   - Query `input, textarea, [contenteditable]` elements
   - Filter to visible elements only
   - Access input's native value setter (HTMLInputElement.prototype.value or HTMLTextAreaElement.prototype.value)
   - Set value via native setter
   - Dispatch `input` and `change` events

**Edge Cases & Issues:**
- **Unsafe template injection:** Lines 124-131 have same backtick string interpolation risks as `_browserClick`.
- **Native setter property access issue:** Line 126-127 tries to get property descriptor from prototype. Falls back to direct assignment (line 129) if no setter found. Edge case: some frameworks override setters on instances, prototype descriptor may be stale.
- **Event spoofing detection:** Frameworks may detect programmatic events vs user events. `bubbles: true` helps but not complete.
- **Contenteditable handling:** Line 124 includes `[contenteditable]` but Line 129 assumes `.value` property exists. Contenteditable elements use `.textContent` not `.value`. **Bug detected: contenteditable won't receive proper value assignment.**

---

#### **_browserFillForm(fields)** — Lines 136–143
**Parameters:**
- `fields` (array or object) — Form field definitions: `[{ ref, value }, ...]` or `{ ref: value, ... }`

**Return Value:**
- Delegates to `this.playwrightBrowser.fillForm(normalized)`

**Logic:**
- Normalize array or object format to canonical array format `[{ ref, value }, ...]`
- Requires Playwright (returns error if not available)

**Issues:**
- **No fallback:** Unlike click/type, no fallback for browserManager. Playwright-only feature.
- **Parameter validation:** No checks on normalized result before passing to Playwright. If normalization fails silently, Playwright receives malformed input.

---

#### **_browserSelectOption(refStr, values)** — Lines 145–149
**Parameters:**
- `refStr` (string) — Select element reference
- `values` (string or array) — Option value(s) to select

**Return Value:**
- Delegates to `browser.selectOption(refStr, values)`

**Logic:** Straight passthrough to browser implementation.

**Issues:**
- No error handling, no fallback, assumes browser has selectOption method.

---

#### **_browserSnapshot()** — Lines 151–154
**Parameters:** None

**Return Value:**
- Result from `browser.getSnapshot()`

**Logic:** Requests snapshot of current page (accessibility tree and element references).

---

#### **_browserScreenshot(options = {})** — Lines 156–161
**Parameters:**
- `options` (object) — Screenshot options (fullPage, region, etc.)

**Return Value:**
- From Playwright: Full options support
- From browserManager: `screenshot({ fullPage: true })` — ignores user options

**Logic:**
- Prefer Playwright with full options support
- Fallback to browserManager with hardcoded fullPage=true

**Issues:**
- **Option mismatch:** browserManager ignores user options. If user requests region screenshot, gets full page anyway.

---

#### **_browserGetContent(selector, html = false)** — Lines 163–166
**Parameters:**
- `selector` (string) — CSS selector
- `html` (boolean) — If true, get innerHTML; if false, get textContent

**Return Value:**
- Delegates to browser

**Logic:** Simple passthrough.

---

#### **_browserEvaluate(code, ref)** — Lines 168–172
**Parameters:**
- `code` (string) — JavaScript code to evaluate in page context
- `ref` (string, optional) — Reference/context

**Return Value:**
- From Playwright: Full result
- From browserManager: Returns `{ success: false }` since browserManager.evaluate likely not exposed

**Logic:**
- Playwright supports both code and ref parameters
- browserManager only supports code

**Issues:**
- Fallback doesn't actually evaluate — just returns error without trying. Line 172 `return browser.evaluate(code)` assumes browserManager has evaluate. Likely wrong.

---

#### **_browserBack()** — Lines 174–177
**Parameters:** None

**Return Value:**
- Delegates to browser

**Logic:** Navigate back in history.

---

#### **_browserPressKey(key)** — Lines 179–182
**Parameters:**
- `key` (string) — Key name (Enter, Escape, Tab, etc.)

**Return Value:**
- Delegates to browser

---

#### **_browserHover(refStr)** — Lines 184–187
**Parameters:**
- `refStr` (string) — Element reference

**Return Value:**
- Delegates to browser

---

#### **_browserDrag(startRef, endRef)** — Lines 189–192
**Parameters:**
- `startRef` (string) — Source element
- `endRef` (string) — Destination element

**Return Value:**
- Delegates to `this.playwrightBrowser.drag()`

**Issues:**
- Playwright-only, returns error if not available.

---

#### **_browserTabs(action, index)** — Lines 194–197
**Parameters:**
- `action` (string) — `'new'`, `'close'`, `'switch'`, etc.
- `index` (number) — Tab index (for close/switch)

**Return Value:**
- Delegates to `this.playwrightBrowser.tabs()`

**Issues:**
- Playwright-only.

---

#### **_browserHandleDialog(accept, promptText)** — Lines 199–202
**Parameters:**
- `accept` (boolean) — Accept (true) or dismiss (false) dialog
- `promptText` (string, optional) — Text to enter in prompt dialog

**Return Value:**
- Delegates to Playwright

**Issues:**
- Playwright-only.

---

#### **_browserConsoleMessages(level)** — Lines 204–207
**Parameters:**
- `level` (string) — `'log'`, `'error'`, `'warning'`, `'info'`, etc.

**Return Value:**
- Delegates to Playwright

**Issues:**
- Playwright-only.

---

#### **_browserFileUpload(refStr, paths)** — Lines 209–212
**Parameters:**
- `refStr` (string) — File input element reference
- `paths` (array) — File paths to upload

**Return Value:**
- Delegates to Playwright

**Issues:**
- Playwright-only.

---

#### **_browserResize(width, height)** — Lines 214–217
**Parameters:**
- `width` (number) — Window width in pixels
- `height` (number) — Window height in pixels

**Return Value:**
- Delegates to Playwright

**Issues:**
- Playwright-only.

---

#### **_browserClose()** — Lines 219–223
**Parameters:** None

**Return Value:**
- `{ success: true }` — Always succeeds even if Playwright close fails

**Logic:**
- Closes Playwright browser if available
- Silently catches errors (line 221)
- Returns success regardless

**Issues:**
- **Silent failure:** Error from Playwright.close() is swallowed (line 221). If async close hangs, caller never knows.

---

#### **_browserWaitFor(options = {})** — Lines 225–240
**Parameters:**
- `options` (object) — `{ time: number, selector: string, ... }`

**Return Value:**
- `{ success: true, waited: ms }` — On timeout wait
- Result from `this.playwrightBrowser.waitFor(options)` — On Playwright
- Result from `browser.waitForSelector(options.selector)` — On browserManager with selector

**Logic:**
1. If `options.time` provided:
   - Clamp to [100ms, 60000ms range]
   - Sleep for duration
   - Return success with duration
2. Else if Playwright available: delegate to Playwright.waitFor()
3. Else if options.selector and browser.waitForSelector: delegate
4. Else: return success immediately

**Edge Cases:**
- **Hard timeout cap:** 60-second hard cap on waits. If model requests 90-second wait, silently caps to 60s. Model never informed of cap.
- **Ambiguous behavior:** If `options.time` is 0, path goes to clamping logic (returns 100ms wait). No explicit error for invalid time values.

---

#### **_browserScroll(direction, amount)** — Lines 242–252
**Parameters:**
- `direction` (string) — `'up'` or `'down'`
- `amount` (number, optional) — Multiplier for scroll distance (default 3)

**Return Value:**
- From Playwright: Full scroll result
- From browserManager: Result from page evaluate

**Logic:**
- Playwright: delegate directly
- browserManager: Calculate pixels (amount * 300), direction-dependent sign, evaluate `window.scrollBy(0, dy)`

**Issues:**
- **Hardcoded scroll factor:** 300px per unit. Model cannot request fine-grained scrolls.
- **Default amount:** Default 3 = 900px scroll. No validation that amount is reasonable.

---

#### **_browserWait(ms = 2000)** — Lines 254–258
**Parameters:**
- `ms` (number, optional) — Milliseconds to wait (default 2000)

**Return Value:**
- `{ success: true, waited: ms }` — Clamped to [100, 30000]

**Logic:**
- Clamp to range [100ms, 30000ms]
- Sleep
- Return success with actual sleep duration

**Issues:**
- **Different cap than _browserWaitFor:** This caps at 30s, waitFor caps at 60s. Inconsistent.
- **Large waits not allowed:** 5-minute wait request clamped to 30s silently.

---

#### **_browserGetUrl()** — Lines 260–270
**Parameters:** None

**Return Value:**
- `{ success: true, url: string, title: string }` — From browserManager.webContents
- Result from `this.playwrightBrowser.getUrl?.()` — Playwright
- `{ success: false, error: string }` — No browser available

**Logic:**
1. Try Playwright.getUrl() first (optional chaining)
2. Fallback to browserManager.webContents.getURL() and getTitle()
3. Error if neither available

**Issues:**
- **Optional chaining with no validation:** Line 261 `this.playwrightBrowser.getUrl?.()` — if Playwright exists but getUrl is undefined, returns undefined, line 262 check passes anyway (undefined is falsy but `if (info)` rejects it). Falls through to browserManager.

---

#### **_browserGetLinks(selector)** — Lines 272–302
**Parameters:**
- `selector` (string, optional) — CSS selector to scope link search

**Return Value:**
- `{ success: true, links: [{ href, text, title }, ...] }` — Array of up to 100 links
- `{ success: false, error: string }` — On failure

**Logic:**
1. Try Playwright.getLinks() if available (line 276)
2. Fallback to browser.evaluate (line 279):
   - Query container element (selector or document)
   - Query all `<a>` elements in container (max 100)
   - Map to `{ href, text (truncated to 100 chars), title }`
   - Return result

**Issues:**
- **Unsafe selector injection:** Line 281 `document.querySelector(${JSON.stringify(selector)})` — Safe from injection but if selector is malformed, querySelector fails and container becomes undefined.
- **Container query chaining:** Line 282 chains `.querySelectorAll()` but if container is a non-Element (e.g., Document in fallback), `.querySelectorAll()` method may not exist on all browser versions.

---

### 1.4 Internal Helper Functions

**_getBrowser()** — Referenced at lines 55, 96, 150, 153, 157, 165, 169, 175, 180, 185, 242, 248

This function is NOT defined in mcpBrowserTools.js. It's assumed to be mixed onto `MCPToolServer.prototype` elsewhere. **Dependency issue:** Missing definition makes it unclear how browser selection (Playwright vs browserManager) occurs. Likely defined in parent MCPToolServer module or parent prototype.

---

### 1.5 Constants & Configuration

No explicit constants defined. Hard-coded values:
- Line 23: Blocked schemes list — `['javascript', 'data', 'ftp', 'vbscript']`
- Line 27: SSRF regex for private IPs
- Line 40: Playwright launch check
- Line 85: Overlay dismissal selectors — `[class*="modal"]`, `[class*="overlay"]`, `[class*="cookie"]`, `[class*="consent"]`
- Line 94: Scroll factor — 300px per unit
- Line 114: Max wait — 60000ms (60 seconds)
- Line 248: Max wait — 30000ms (30 seconds)
- Line 267: Link limit — 100 links max

**Config Issues:**
- Magic numbers scattered throughout, no central config object
- Inconsistent max wait times (60s vs 30s)
- Hardcoded overlay class patterns may miss real overlays

---

### 1.6 Event Emitters & Listeners

None directly in this file. However:
- Line 43: `this.browserManager.parentWindow.webContents.send('show-viewport-browser')` — Sends IPC event to parent window (Electron), not a listener setup.

---

### 1.7 Potential Issues, Bugs & Race Conditions

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| **String Template Injection (XSS)** | HIGH | 77-79, 124-131 | Backtick templates in _browserClick and _browserType without escaping. `options.element` could contain backticks causing template injection. |
| **Contenteditable Bug** | MEDIUM | 124 | _browserType queries `[contenteditable]` but tries to set `.value` property which doesn't exist on contenteditable elements. Should use `.textContent`. |
| **Silent SSRF Bypass** | MEDIUM | 28 | URL parsing errors caught silently. Malformed URLs escape IP validation. |
| **Race Condition: Playwright Launch** | MEDIUM | 40 | Multiple concurrent _browserNavigate calls could race on `await this.playwrightBrowser.launch?.()` without state lock. |
| **Missing _getBrowser() Definition** | HIGH | 55+ | Critical helper function referenced but not defined in this file. Dependency chain unclear. |
| **Unverified Element Removal** | MEDIUM | 85 | Blind removal of DOM elements matching modal/overlay patterns could remove legitimate UI. |
| **Hard-coded Limits Not Enforced** | LOW | 114, 248 | Max wait clamping is silent — model never informed that request was capped. |
| **Inconsistent Max Waits** | LOW | 114 vs 248 | _browserWaitFor caps at 60s, _browserWait caps at 30s. Inconsistent behavior. |
| **No Timeout on Browser Operations** | MEDIUM | Various | Click, type, evaluate have no explicit timeout enforcement. Browser hang could deadlock. |
| **Fallback Failures Not Handled** | MEDIUM | 172, 280 | _browserEvaluate and _browserGetLinks assume fallback methods exist without verification. |

---

### 1.8 Code Flow & Dependencies

```
Entry Point: module.exports → 23 async functions mixed onto MCPToolServer.prototype

Critical Dependency Chain:
  _browserNavigate → requires _getBrowser() [UNDEFINED IN THIS FILE]
  _browserNavigate → requires this.playwrightBrowser OR this.browserManager
  _browserNavigate → requires path (line 3 import)
  
  _browserClick / _browserType → require _getBrowser() [UNDEFINED]
  _browserClick / _browserType → use backtick templates (injection risk)
  
  _browserFillForm → requires this.playwrightBrowser (Playwright-only)
  
  All functions assume this context has browser instances available
  No initialization or constructor visible in this file

Browser Selection Logic:
  1. Check this.playwrightBrowser.isLaunched()
  2. If not launched, await launch()
  3. Use Playwright navigate()
  4. Fallback: this.browserManager.navigate()
  5. Fallback fails: return error

Single Points of Failure:
  - _getBrowser() undefined → all Click/Type/etc. fail
  - No browser managers available → all methods return "No browser available"
```

---

## 2. FILE: mcpGitTools.js

### 2.1 File Purpose & Overview
**Location:** `C:\Users\brend\IDE\main\tools\mcpGitTools.js`  
**Lines:** 1–79  
**Purpose:** Provides Git command wrappers mixed onto `MCPToolServer.prototype`. Methods handle common git operations: status, commit, diff, log, branch, stash, reset. All methods assume a `gitManager` instance OR access to `_runCommand()` for direct CLI invocation.

**Design Pattern:** Mixin functions (matching mcpBrowserTools pattern). Each method async. Two implementation paths:
1. **High-level via gitManager** — Preferred, sanitized, managed
2. **Direct CLI via _runCommand** — Fallback, requires shell arg sanitization

---

### 2.2 Imports & Dependencies

```javascript
// No explicit requires/imports in this file
```

**Dependencies via `this` context:**
- `this.gitManager` — Object with methods: getStatus(), commit(), getDiff(), stageAll()
- `this._runCommand(cmd)` — Execute shell command, returns `{ exitCode, stdout, stderr }`
- `this._sanitizeShellArg(arg)` — Escape string for safe shell inclusion (likely shell-quote style)

**Critical:** All three context methods are **UNDEFINED in this file**. Assumed injected by parent MCPToolServer module.

---

### 2.3 Exported Functions (All Async)

#### **_gitStatus()** — Lines 3–5
**Parameters:** None

**Return Value:**
- Result from `this.gitManager.getStatus()`

**Logic:** Direct passthrough to gitManager.

**Issues:**
- No fallback if gitManager unavailable — would throw (no error check)

---

#### **_gitCommit(message)** — Lines 7–14
**Parameters:**
- `message` (string) — Commit message

**Return Value:**
- `{ success: false, error: 'Commit message is required' }` — If message empty/invalid
- Result from `this.gitManager.commit(message.trim())`

**Logic:**
1. Validate message: required, string, non-empty after trim (lines 8-10)
2. Stage all uncommitted changes via `this.gitManager.stageAll()` (line 11)
3. Commit with trimmed message (line 12)

**Issues:**
- **No fallback implementation** — Must have gitManager, no direct CLI fallback like other functions
- **Explicit stageAll requirement** — Always stages ALL changes. No option for partial staging/selective commits.
- **No error handling on stageAll** — If stageAll fails, error is not caught; commit proceeds anyway.

---

#### **_gitDiff(options = {})** — Lines 16–18
**Parameters:**
- `options` (object) — Options to pass to getDiff (staged, file, etc.)

**Return Value:**
- Result from `this.gitManager.getDiff(options)`

**Logic:** Direct passthrough with options support.

**Issues:**
- No validation of options
- No fallback if gitManager unavailable

---

#### **_gitLog(count = 20)** — Lines 20–33
**Parameters:**
- `count` (number, optional) — Number of commits to show (default 20)

**Return Value:**
- `{ success: true, entries: [{ hash, message }, ...] }`
- `{ success: false, error: 'git log failed' }` — On error

**Logic:**
1. Clamp count to [1, 100] range (line 21)
2. Execute `git log --oneline -N` directly via CLI (line 22)
3. Parse result:
   - Check exitCode (line 23) — error if non-zero
   - Split stdout by newlines (line 25)
   - For each line, extract hash (before space) and message (after space)
   - Return structured entries (lines 26-30)

**Cases Handled:**
- Lines with no spaces: hash only, empty message
- Normal format: hash + space + message
- Error output: returned as-is in error field

**Issues:**
- **No sanitization on count** — After clamping, count goes directly into shell command. Math.min/max prevents injection but assumes _runCommand uses count safely.
- **Fragile parsing:** If commit hash contains space (impossible in git) or message contains newline, parsing breaks. Newlines break because split('\n') on each line separately.
- **No error recovery:** If git log fails, returns stderr as error. No retry or alternative.

---

#### **_gitBranch(action, name)** — Lines 35–49
**Parameters:**
- `action` (string) — `'list'`, `'create'`, `'switch'`, or default behavior
- `name` (string, optional) — Branch name for create/switch

**Return Value:**
- Result from `this._runCommand(cmd)` for the selected action

**Logic:**
1. Sanitize branch name via `this._sanitizeShellArg(name)` (line 36)
2. Switch on action (lines 37-46):
   - `'list'`: `git branch -a`
   - `'create'`: `git checkout -b ${safe}` (requires name)
   - `'switch'`: `git checkout ${safe}` (requires name)
   - default: `git branch` (no args)
3. For create/switch, validate safe name is non-empty (lines 39, 42)

**Issues:**
- **Incomplete action list:** Only 3 actions defined. What happens if action='delete', 'rename', 'merge'? Falls to default `git branch` (no-op).
- **No deletion support** — Common operation missing
- **_sanitizeShellArg() dependency** — Entire command safety depends on this external function (undefined in this file)

---

#### **_gitStash(action = 'push', message)** — Lines 51–64
**Parameters:**
- `action` (string) — `'push'`, `'pop'`, `'list'`, `'drop'`, or default
- `message` (string, optional) — Stash message for push action

**Return Value:**
- Result from `this._runCommand(cmd)`

**Logic:**
1. Switch on action (lines 52-63):
   - `'push'`: `git stash push -m ${message}` (if message provided, sanitized)
   - `'pop'`: `git stash pop`
   - `'list'`: `git stash list`
   - `'drop'`: `git stash drop`
   - default: bare `git stash`
2. Message sanitization via `_sanitizeShellArg()` only if action='push' (line 54)

**Issues:**
- **Unquoted command string:** Line 55 uses template literal directly: `` `git stash push${msg}` ``. If _sanitizeShellArg returns string with spaces and no quotes, injection possible. Proper form would be `` `git stash push ${msg}` `` (note quotes around ${msg}). **Potential injection: Depends entirely on _sanitizeShellArg correctness.**
- **No stash index:** `pop` always pops stash@{0}. No option to pop specific stash.
- **Stash drop without confirmation** — Destructive, no undo

---

#### **_gitReset(mode = 'soft', filePath)** — Lines 66–79
**Parameters:**
- `mode` (string) — `'soft'` or `'hard'`
- `filePath` (string, optional) — Specific file to reset

**Return Value:**
- `{ success: false, error: string }` — If invalid mode
- Result from `this._runCommand(cmd)`

**Logic:**
1. If mode='hard' AND filePath: `git checkout -- ${safe}` (line 68-71)
   - Checkout specific file from HEAD, discarding working changes
2. If mode='soft':
   - With filePath: `git reset HEAD ${safe}` (line 73-75) — unstage specific file
   - Without filePath: `git reset HEAD` (line 76) — reset all staging
3. Reject invalid modes (line 78-80)

**Issues:**
- **Command difference:** Hard mode uses `git checkout --` (dangerous, discards), soft mode uses `git reset HEAD` (safer, just unstages). Naming is misleading.
- **No reset modes:** Missing 'mixed' and 'hard' modes for commits (only files). Can't reset to prior commit state.
- **Sanitization only sometimes applied:** Line 70, 74 sanitize filePath, but never for mode validation. Mode comes directly from user without sanitization.

---

### 2.4 Internal Helper Functions

None defined in this file.

**Dependency Functions (Undefined here, assumed on `this`):**
- `this.gitManager.getStatus()` — Lines 4
- `this.gitManager.stageAll()` — Line 11
- `this.gitManager.commit()` — Line 12
- `this.gitManager.getDiff()` — Line 17
- `this._runCommand(cmd)` — Lines 22, 37-45, 52-63, 68-78
- `this._sanitizeShellArg(arg)` — Lines 36, 54, 70, 74

All 6 functions are **critical dependencies** and UNDEFINED IN THIS FILE.

---

### 2.5 Constants & Configuration

No constants defined. Hard-coded values:
- Line 21: Count range [1, 100] for git log
- Line 21: Default count 20

---

### 2.6 Event Emitters & Listeners

None.

---

### 2.7 Potential Issues, Bugs & Race Conditions

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| **Missing gitManager Implementation** | CRITICAL | 4, 11, 12, 17 | 4 functions depend on gitManager methods that are undefined. Calls will fail at runtime. |
| **Missing _runCommand() Implementation** | CRITICAL | 22, 37-45, 52-63, 68-78 | Direct CLI execution depends on undefined function. |
| **Missing _sanitizeShellArg() Implementation** | CRITICAL | 36, 54, 70, 74 | Shell command safety depends on undefined sanitizer. |
| **Potential Shell Injection in _gitStash** | HIGH | 55 | Template string `` `git stash push${msg}` `` doesn't quote ${msg}. If _sanitizeShellArg doesn't add quotes, injection possible. |
| **No Error Handling on stageAll** | MEDIUM | 11 | _gitCommit calls stageAll without try-catch. If stageAll fails, error is silent; commit proceeds. |
| **Incomplete Branch Action Support** | LOW | 37-46 | Missing 'delete', 'rename', 'merge' actions. Request for unsupported action falls to default `git branch` (no-op). |
| **Fragile Commit Log Parsing** | MEDIUM | 25-30 | Parsing assumes one hash + message per line. Multiline messages within a commit break parsing. |
| **No Rollback Mechanism** | MEDIUM | Various | Git operations (commit, reset, stash pop) are irreversible within this tool. No undo or confirmation. |
| **No Credential Handling** | LOW | Various | Interactive prompts (password, SSH key passphrase) would hang indefinitely. No credential management. |

---

### 2.8 Code Flow & Dependencies

```
Entry Point: module.exports → 7 async functions mixed onto MCPToolServer.prototype

High-Level vs Direct CLI Paths:
  _gitStatus() → gitManager.getStatus() [Path 1: Managed]
  _gitCommit() → gitManager.stageAll() + gitManager.commit() [Path 1: Managed]
  _gitDiff() → gitManager.getDiff() [Path 1: Managed]
  _gitLog() → _runCommand('git log --oneline -N') [Path 2: Direct CLI]
  _gitBranch() → _runCommand('git branch/checkout') [Path 2: Direct CLI]
  _gitStash() → _runCommand('git stash ...') [Path 2: Direct CLI]
  _gitReset() → _runCommand('git reset') [Path 2: Direct CLI]

Critical Path 1 Failure Mode:
  If gitManager === undefined → _gitStatus, _gitCommit, _gitDiff fail immediately (no error check)

Critical Path 2 Failure Mode:
  If _runCommand === undefined → _gitLog, _gitBranch, _gitStash, _gitReset fail with TypeError
  If _sanitizeShellArg === undefined → Shell injection vulnerability on all Path 2 operations

Single Points of Failure:
  - gitManager undefined → 3 functions broken
  - _runCommand undefined → 4 functions broken
  - _sanitizeShellArg undefined → Command injection risk on 4 functions
```

---

## 3. FILE: toolParser.js

### 3.1 File Purpose & Overview
**Location:** `C:\Users\brend\IDE\main\tools\toolParser.js`  
**Lines:** 1–727  
**Purpose:** Comprehensive tool call parser for extracting, normalizing, and repairing tool call syntax from LLM-generated text. Handles 9+ different tool call formats (XML tags, fenced code blocks, raw JSON, function calls, array format, prose commands, etc.). Includes JSON repair utilities to fix common encoding issues. Exported as pure utility module (no class/mixin).

**Design Philosophy:** Multi-method fallback system. Try 9+ detection methods in sequence. If JSON parsing fails initially, apply repair heuristics. If all fails, regex-based recovery for known patterns.

---

### 3.2 Imports & Dependencies

```javascript
// No explicit imports/requires in this file
// Pure utility module with no external dependencies
```

Fully self-contained. Uses only built-in JavaScript (JSON, RegExp, String, Array).

---

### 3.3 Exported Objects & Constants

#### **TOOL_NAME_ALIASES** — Lines 3–20
**Type:** Object literal mapping misspellings → canonical names

**Purpose:** Handle model hallucinations/misspellings of tool names. E.g.:
- `'navigate'` → `'browser_navigate'`
- `'open_url'` → `'browser_navigate'`
- `'find'` → `'find_files'`
- `'install'` → `'install_packages'`

**Scale:** 50+ aliases defined

**Issues:**
- **Completeness unclear** — Only shows subset. 50+ aliases for ~40 tool names suggests high misspelling rate.
- **Alias collision:** No documented conflicts (e.g., if 'search' could map to web_search OR search_codebase). Current mapping: search → web_search.

---

#### **VALID_TOOLS** — Lines 22–33
**Type:** Set of 50+ canonical tool names

**Contents:**
- File ops: read_file, write_file, edit_file, append_to_file, delete_file, rename_file, copy_file, get_file_info, etc.
- Browser: browser_navigate, browser_click, browser_type, browser_screenshot, etc.
- Web: web_search, fetch_webpage
- Git: git_status, git_commit, git_diff, git_log, git_branch, git_stash, git_reset
- System: run_command, create_directory, install_packages, etc.
- Other: save_memory, get_memory, write_todos, http_request, etc.

**Purpose:** Whitelist all valid tool names. Any tool name NOT in this set is rejected as hallucination.

---

### 3.4 Exported Functions

#### **sanitizeJson(raw)** — Lines 35–65
**Parameters:**
- `raw` (string) — Raw JSON with potential encoding issues

**Return Value:**
- Sanitized JSON string

**Logic — Character-by-character state machine:**
1. Track `inStr` (inside double-quoted string), `escaped` (after backslash)
2. For each character:
   - If escaped, validate as legal JSON escape (`"\bfnrtu/`). If invalid, double the backslash (e.g., `\x` → `\\x`)
   - If `\\` AND in string, set escaped flag
   - If `"` AND not escaped, toggle inStr
   - If control character (charCode < 32) AND in string: escape it:
     - `\n` → `\\n` (newline)
     - `\r` → `\\r` (carriage return)
     - Other: replace with space

**Purpose:** Fix common issues:
- Invalid escape sequences (e.g., `\x` in JSON is invalid)
- Raw control characters in string values (literal newlines break JSON.parse)

**Issues:**
- **Expensive:** Character-by-character iteration. For 1MB response, significant CPU.
- **Incomplete:** Doesn't handle unquoted keys, single quotes, trailing commas (those are handled by fixQuoting/fixBackticks).

---

#### **fixQuoting(raw)** — Lines 67–74
**Parameters:**
- `raw` (string) — JSON with improper quoting

**Return Value:**
- JSON with double quotes

**Logic — Three regex replacements:**
1. Single quotes → double quotes: `'...'` → `"..."` (preserves all escapes inside)
2. Unquoted keys → double quoted: `{foo:` → `{"foo":`
3. Unquoted path values → quoted: `: C:\Users\...` → `:"C:\Users\..."`

**Uses Regex:**
- Line 70: `/'([^'\\]*(?:\\.[^'\\]*)*)'/g` — Handles escaped chars inside single-quoted strings
- Line 72: `/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g` — Captures key context {, or newline + key + :
- Line 73: `/:\s*([A-Za-z]:[\\/][^\s,}\]]+)/g` — Matches drive letter paths

**Issues:**
- **Regex brittle:** Line 70 regex may fail on unbalanced quotes inside single quotes (e.g., `'he said "hi"'` → may misbehave)
- **Path regex too specific** — Line 73 only matches `[A-Za-z]:` (drive letters). UNC paths `\\server\share` not handled.
- **Order matters:** Applied before fixBackticks. If backtick inside single quote, fixQuoting may break it before fixBackticks sees it.

---

#### **fixBackticks(raw)** — Lines 76–85
**Parameters:**
- `raw` (string) — JSON with backtick-delimited strings

**Return Value:**
- JSON with backtick strings converted to double-quoted, escaped

**Logic:**
- Find all backtick-delimited spans: `` `...` ``
- Escape internal backslashes, quotes, newlines, carriage returns, tabs
- Replace with proper JSON string

**Issues:**
- **Unbalanced backtick handling:** If odd number of backticks, regex matches first pair, later backticks left as-is. No error.
- **Nested backticks:** Can't escape backticks inside. `` `path\\file\\`name`` will match up to second backtick, leaving `` name`` outside.

---

#### **tryParseJson(raw)** — Lines 87–91
**Parameters:**
- `raw` (string) — JSON to parse

**Return Value:**
- Parsed object/array on success
- `null` on all failures

**Logic — Triple fallback chain:**
1. Try raw sanitized: `JSON.parse(sanitizeJson(raw))`
2. If fails, try fixed quoting: `JSON.parse(sanitizeJson(fixQuoting(raw)))`
3. If fails, try fixed backticks: `JSON.parse(sanitizeJson(fixBackticks(fixQuoting(raw))))`
4. All fail → return null

**Silent Failures:** All exceptions caught, only null returned. No error info.

**Issue:**
- **No logging:** Caller can't know which attempt succeeded or how severe the error was.

---

#### **extractJsonObjects(text)** — Lines 93–146
**Parameters:**
- `text` (string) — Response text with embedded JSON objects

**Return Value:**
- Array of parsed JSON objects found in text

**Purpose:** Brace-based extraction. Find JSON objects by counting braces, handling quotes/escapes.

**Logic — State machine tracking:**
- `depth` — Nesting depth of braces
- `inStr` — Inside double-quoted string
- `inBacktick` — Inside backtick
- `escaped` — After backslash

**Algorithm:**
1. Iterate through text character-by-character
2. Track state flags for string/backtick/escape
3. When depth goes 0→1, mark start position
4. When depth goes 1→0, extract `text.slice(start, i+1)`
5. Try to parse with tryParseJson()
6. If parse fails but structure looks like tool call (regex match on `"tool"` or `"name"` field), attempt **regex-based recovery** (lines 118-143)

**Regex Recovery Logic (lines 118-143):**
- Extract tool name via: `/"(?:tool|name)"\s*:\s*"([^"]+)"/`
- Extract filePath via: `/"(?:filePath|path)"\s*:\s*"([^"]+)"/`
- If both found, create recovered object with tool name and path
- For write/create/edit/append tools, attempt to extract `"content"` field by finding:
  - `"content"` keyword location
  - Following `:` and opening `"`
  - Everything until last `"` before closing `}}`
  - Unescape: `\\n` → `\n`, `\\t` → `\t`, `\\\"` → `"`, `\\\\` → `\`
- Log recovery: `[ToolParser] Recovered tool call via regex: ${toolName} → ${filePath}`

**Truncated JSON Handling (lines 145-146):**
- If unclosed braces at text end, check if looks like write_file with partial content
- If filePath and content (at least 20 chars) found, add as recovered object with `_truncated: true` flag

**Issues:**
- **Regex recovery unreliable:** Assumes single-line tool calls. Multiline JSON won't parse via regex. Only works if content doesn't have `"` characters.
- **Content extraction brittle:** Lines 129-134 find content by looking for `"content":` then scanning to end. If content contains `":`, parsing breaks. If content is JSON (nested structure), only finds first `:` after `"content"`.
- **Unsafe last-minute search:** Line 135 looks for `endIdx` by searching backwards for `"`. If content has `"` characters, `endIdx` points to wrong position.
- **No verification:** Recovered objects marked `_recovered: true` but never verified. Corruption possible, passed through anyway.

---

#### **normalizeToolCall(parsed)** — Lines 148–201
**Parameters:**
- `parsed` (object) — Tool call object (may be malformed)

**Return Value:**
- `{ tool: string, params: object }` — Normalized and validated
- `null` — If invalid/rejected

**Logic:**
1. **Extract tool name** (lines 150-152):
   - Try keys: `tool`, `name`, `function`, `action`
   - Normalize: lowercase, trim, replace whitespace with underscores
   
2. **Alias resolution** (line 155): Look up in TOOL_NAME_ALIASES
   
3. **CLI binary recovery** (lines 158-162):
   - If tool name matches shell binary regex (`node`, `npm`, `git`, `python`, etc.) AND not in VALID_TOOLS, convert to run_command
   - Extract command from `params.command` or compose from tool + args

4. **Reject hallucinations** (line 165): If not in VALID_TOOLS, return null

5. **Extract params** (lines 168-170):
   - Try keys: `params`, `parameters`, `arguments`, `args`
   - Default to empty object
   - Reject if not object or is array

6. **Merge top-level props as params** (lines 173-177):
   - Iterate all object keys
   - Skip metadata keys (`tool`, `name`, `function`, `action`, `params`, `parameters`, `arguments`, `args`)
   - Copy remaining as params

7. **Normalize param names** (lines 180-188):
   - Rename snake_case → camelCase: `file_path` → `filePath`, etc.
   - 10+ renames handled

8. **Browser-specific normalization** (lines 191-198):
   - For tools starting with `browser_`:
   - `selector` → `ref`
   - `value` → `text` (for browser_type only)
   - `href` → `url`

**Issues:**
- **Param key duplication:** No check if both `file_path` AND `filePath` exist. Snake_case version deleted, camelCase kept. If they had different values, data loss.
- **Incomplete param normalization:** Only renames handled. No validation of values (e.g., `filePath` should be string, not number).
- **Browser params too specific:** Param renames only apply within `if (toolName.startsWith('browser_'))` block. Other tools don't get normalized. E.g., git_commit wouldn't normalize hypothetical `msg` → `message`.

---

#### **parseToolCalls(text)** — Lines 203–358
**Parameters:**
- `text` (string) — LLM response text

**Return Value:**
- Array of `{ tool, params }` objects

**Purpose:** Master parser. Try 9+ detection methods in sequence. Returns first successful batch.

**Detection Methods (in order):**

**Method 0: XML tags** (lines 207-212)
- Find `<tool_call>...</tool_call>` tags (line 209-210)
- Parse inner content as JSON
- Normalize each
- If found, return early via `_postProcess()`

**Method 1: Fenced code blocks** (lines 214-218)
- Find `` ```tool_call`` / `` ```tool`` / `` ```json `` blocks
- Extract objects from each block
- If found, return via `_postProcess()`

**Method 1.5: Unclosed fence at end** (lines 220-226)
- Check if response ends with unclosed `` ```tool_call `` fence
- Try extracting objects from unclosed section
- If found, continue to later methods (don't return early)

**Method 1.6: Truncated tool call recovery** (lines 228-265)
- Find unclosed fence block
- Look for tool name match
- Extract filePath and content via regex
- If write_file/append_to_file, extract partial content, remove last potentially-truncated line
- Unescape JSON encoding
- Mark as `_truncated: true`

**Method 1.8: OpenAI array format** (lines 267-294)
- Find `` [{ `` start
- Count braces to find matching `]`
- Parse as JSON array
- If `Array.isArray()`, extract each item as normalized tool call

**Method 2: Raw JSON objects** (lines 296-301)
- Regex search for objects with `"tool"` or `"name"` key
- Use extractJsonObjects() to get all objects
- Normalize each

**Method 3a: Function-call syntax** (lines 303-309)
- For each tool in VALID_TOOLS, try regex: `toolName({"param":"value"})`
- Parse inner object
- Normalize with explicit tool name

**Method 3a.5: String-arg function calls** (lines 311-321)
- Regex for write_file/'path', 'content' format
- Handle all three file operations: write, read, edit

**Method 3b: Plain JSON (no tool key)** (lines 323-329)
- Extract all JSON objects
- If object has `filePath` AND `content` AND no `tool` key, assume write_file

**Return:** All calls collected via `_postProcess()`

**_postProcess() remapping** (lines 360-375):
- Maps web_search with shell commands → run_command
- Maps web_search with URLs → browser_navigate
- Maps search_codebase with external docs queries → web_search

**Issues:**
- **Detection order matters:** XML tags checked first. If response contains both XML tags AND fenced code blocks, XML wins. Model could exploit this.
- **Deduplication insufficient:** Line 214 uses signature `${call.tool}:${JSON.stringify(call.params)}`. If params contain different objects with same content, both kept. Large params not hashed efficiently.
- **Silent successes:** Early returns via `_postProcess()` after Method 0 stops trying other methods. If XML tag parsing gets partial/corrupt object, other methods never tried.
- **Method order optimizes for common cases:** But assumes all tool calls use same format. Mixed formats (some XML, some fenced) only partially parsed.

---

#### **repairToolCalls(toolCalls, responseText)** — Lines 377–430
**Parameters:**
- `toolCalls` (array) — Tool calls to repair
- `responseText` (string) — Original response for recovery context

**Return Value:**
- `{ repaired: [...], issues: [...], droppedFilePaths: [...] }`

**Logic:**
1. For each call:
   - If write_file with empty/short content, try recovery (line 397-409)
   - If emptier (< 5 chars content), check if recoverable else drop
   - If empty filePath, try to infer from text/content
   - If edit_file with no oldText/newText/lineRange, drop
   - If browser_navigate with no URL, drop
   - If browser_navigate with incomplete URL, prepend https://

2. **Last-resort recovery** (lines 423-427):
   - If all calls dropped, try to recover write_file from response text
   - Add to repaired if found

**Issues:**
- **5-char threshold arbitrary:** Line 398 drops content < 5 chars. Legitimate short files (e.g., "END\n") dropped.
- **Error suppression:** Line 397 calls _recoverWriteFileContent() but doesn't check result structure validity. Might return object with missing filePath.
- **Unreliable inference:** _inferFilePath() uses regex and heuristics. Could infer wrong path.

---

#### **_recoverWriteFileContent(text, preferredFilePath)** — Lines 432–448
**Parameters:**
- `text` (string) — Response text
- `preferredFilePath` (string, optional) — If provided, use as path

**Return Value:**
- `{ tool: 'write_file', params: { filePath, content } }` — If recoverable
- `null` — If no code block found

**Logic:**
1. Find all fenced code blocks (`` ```...``` ``)
2. Keep largest one (by char count)
3. If < 50 chars, return null
4. Use preferredFilePath or infer path
5. Return write_file call

**Issues:**
- **Greedy largest block:** If response has multiple code blocks, largest is assumed to be target file. If response shows before/after, largest could be the "before" (original buggy code).

---

#### **_inferFilePath(text, content, lang)** — Lines 450–481
**Parameters:**
- `text` (string) — Response text context
- `content` (string) — File content
- `lang` (string, optional) — Language hint from code block

**Return Value:**
- Inferred filename string

**Logic:**
1. Search response text for filename pattern (line 453): `\b([\w.-]+\.(?:js|ts|jsx|tsx|...))\b`
2. If found, return first match
3. Else, infer from content:
   - Check for HTML markers → 'index.html'
   - Check for React → 'component.jsx'
   - Check for CSS → 'style.css'
   - Check for Python → 'script.py'
   - Check for JSON → 'data.json'
4. Else, check language hint against mapping table
5. Fallback to 'output.txt'

**Issues:**
- **Pattern matching false positives:** Line 453 regex finds first filename mention in entire response. If response discusses multiple files, wrong one picked.
- **Content inference unreliable:** Line 459-465 checks for markers. Content with `import React` could be Node.js module with React dependency (not JSX).
- **Language mapping incomplete:** Only ~12 languages mapped. What about Go, Rust, C++?

---

#### **_detectProseCommands(text)** — Lines 483–494
**Parameters:**
- `text` (string) — Response text

**Return Value:**
- Array of tool calls with format `{ tool: 'run_command', params: { command } }`

**Logic:**
1. Regex find: `(?:run|running|execute|executing|type|enter)\s+[`'"]([\w\s./@-]+[...])[`'"]`
2. Extracts quoted commands
3. Checks command length 2–500 chars

**Example matches:**
- `run 'npm install'` → `run_command: npm install`
- `type 'git status'` → `run_command: git status`

**Issues:**
- **Too loose:** Matches any quoted string after "run". In prose response like "Run the following analysis on the data", captures unintended text.
- **Character range too restricted:** Line 487 regex only allows `\w` (word chars) and `./@-`. Would not match commands with pipes, redirects, etc.: `rm -rf | grep`

---

#### **_detectFallbackFileOperations(responseText, userMessage, lastDroppedFilePaths)** — Lines 496–538
**Parameters:**
- `responseText` (string) — Model response
- `userMessage` (string) — User's original message (unused in code)
- `lastDroppedFilePaths` (array) — File paths from previous repair that were dropped

**Return Value:**
- Array of write_file tool calls

**Logic:**
1. Find code blocks (lines 503-505)
2. Skip small blocks (< 50 chars) — likely inline examples (line 508)
3. Skip blocks preceded by certain editorial phrases (line 511-512):
   - "replace line with", "fix:", "instead of", "example:", "install", "pip install", "npm install"
4. Look for file path reference in preceding 300 chars (line 515)
5. If found, create write_file call
6. For dropped paths from previous repair (line 525-530):
   - Try to recover content using _recoverWriteFileContent()

**Issues:**
- **Editorial phrase detection crude:** Line 511 regex only checks ~10 phrases. Many more variations exist ("the fix is", "note:", "for comparison").
- **Path search last-match only:** Line 519-520 comment says "Use LAST match (closest to code block)". Loop correctly iterates all matches and keeps last. But only searches preceding 300 chars. If path mentioned > 300 chars before code block, misses it.
- **Unused parameter:** `userMessage` is parameter but never used in function. Suggests incomplete implementation or copied function signature.

---

### 3.5 Constants & Configuration

**Lines 3–33:**
- **TOOL_NAME_ALIASES** — 50+ misspelling mappings
- **VALID_TOOLS** — 50+ canonical tool names
- **No other constants** — Magic numbers scattered:
  - Line 398: 5-char threshold for content
  - Line 444: 50-char minimum for recovered content
  - Line 508: 50-char minimum for code blocks
  - Line 515: 300-char lookback for path search
  - Line 487: 2–500 char command length
  - Line 519: Last-match logic for paths

---

### 3.6 Event Emitters & Listeners

None. Pure utility module. No side effects, no event emission.

---

### 3.7 Potential Issues, Bugs & Race Conditions

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| **Regex-based content extraction fragile** | HIGH | 118-143 | Regex searches for `"content":` then scans to last `"`. If content contains `"`, scans to wrong position. Multiline content breaks. |
| **Backtick handling incomplete** | HIGH | 76-85, 153 | Can't escape backticks inside content. Nested backticks cause premature termination. |
| **Path inference false positives** | MEDIUM | 453 | Regex finds first filename in response text. If response discusses multiple files, wrong one used. |
| **Content inference unreliable** | MEDIUM | 459-465 | Checks for React markers could match non-JSX files. HTML check too broad. |
| **Truncated JSON recovery limited** | MEDIUM | 228-265 | Only attempts to recover write_file. Other tools with truncation (long edit_file oldText) not handled. |
| **Early exit from Method 0** | MEDIUM | 212 | If XML tags found, no further detection. Blocks recovery via other methods if XML corrupt. |
| **Arbitrary thresholds not documented** | LOW | Various | 5-char, 50-char, 300-char limits not explained. Unclear if appropriate. |
| **Silent failure of tryParseJson** | MEDIUM | 87-91 | All exceptions caught, only null returned. Caller can't diagnose parsing failure. |
| **Unsafe param name normalization** | MEDIUM | 180-188 | No check for value conflicts before renaming. `file_path: "/a", filePath: "/b"` loses data. |
| **Deduplication insufficient** | LOW | 213 | Signature dedup only checks string representation. Large binary content hashed poorly. |
| **Editorial phrase detection incomplete** | LOW | 511-512 | Only ~10 phrases. Many variations not caught, leading to false positives. |
| **No validation of inferred paths** | MEDIUM | 481 | Returns 'index.html' or 'output.txt' without checking if reasonable for context. |
| **Method order optimizes common cases** | MEDIUM | 207-329 | If tool calls use mixed formats, partial parsing only. No fallback if primary method corrupted. |

---

### 3.8 Code Flow & Dependencies

```
Entry Point: module.exports → 12 functions + 2 constants (TOOL_NAME_ALIASES, VALID_TOOLS)

Main Pipeline:
  parseToolCalls(text)
    ├─ Method 0: XML tags
    │  └─ tryParseJson() → normalizeToolCall() → _postProcess()
    ├─ Method 1: Fenced code blocks
    │  └─ extractJsonObjects() → tryParseJson() → normalizeToolCall() → _postProcess()
    ├─ Method 1.5: Unclosed fences
    │  └─ extractJsonObjects() → (continue to Method 2)
    ├─ Method 1.6: Truncated tool recovery
    │  └─ Regex extraction only (no JSON parse, regex-based field extraction)
    ├─ Method 1.8: OpenAI array format
    │  └─ JSON.parse() → normalizeToolCall()
    ├─ Method 2: Raw JSON objects
    │  └─ extractJsonObjects() → normalizeToolCall()
    ├─ Method 3a: Function calls
    │  └─ tryParseJson() → normalizeToolCall()
    ├─ Method 3a.5: String-arg functions
    │  └─ Hardcoded tool calls (no JSON)
    └─ Method 3b: Plain JSON
       └─ extractJsonObjects() → Assume write_file

Repair Pipeline:
  repairToolCalls(toolCalls, responseText)
    ├─ Check each call:
    │  ├─ write_file: _recoverWriteFileContent() if empty
    │  ├─ edit_file: drop if incomplete
    │  └─ browser_navigate: fix URL scheme
    └─ Last resort: _recoverWriteFileContent() if all dropped

Content Recovery Pipeline:
  _recoverWriteFileContent(text, preferredFilePath)
    ├─ Find largest code block
    ├─ _inferFilePath() /// Get path
    └─ Return write_file call

Path Inference Pipeline:
  _inferFilePath(text, content, lang)
    ├─ Search text for filename pattern
    ├─ Infer from content markers
    ├─ Check language hint
    └─ Fallback to 'output.txt'

JSON Repair Pipeline:
  tryParseJson(raw)
    ├─ Try 1: JSON.parse(sanitizeJson(raw))
    ├─ Try 2: JSON.parse(sanitizeJson(fixQuoting(raw)))
    └─ Try 3: JSON.parse(sanitizeJson(fixBackticks(fixQuoting(raw))))

Extraction Flow:
  extractJsonObjects(text)
    ├─ Brace-count iteration
    ├─ tryParseJson() on each object
    └─ If fails: Regex-based recovery for write_file / filePath patterns

Single Points of Failure:
  - JSON parsing completely broken → All methods fail
  - Regex for tool name extraction wrong → All recovered objects invalid
  - VALID_TOOLS set empty → Everything rejected as hallucination
```

---

### 3.9 Test Coverage Gaps

**Not Handled:**
- Response with mixed tool call formats (XML + fence blocks + raw JSON) — only first successful method used
- Nested JSON objects (tool calls with object-type params)
- Tool calls with array parameters
- Commands with special characters (pipes, redirects, variables)
- File paths with spaces (regex searches end at space)
- Very large responses (performance concern with character iteration)
- Unicode/emoji in content (may break control character handling)
- Concurrent/async parsing (no async methods, but external code may call in parallel)

---

## SUMMARY

### mcpBrowserTools.js
- **23 browser automation methods** mixed onto MCPToolServer
- **Critical issue:** `_getBrowser()` undefined, breaks all click/type/evaluate functions
- **Security risks:** String template injection in click/type, SSRF bypass on parsing errors
- **Design pattern:** Dual-path (Playwright vs browserManager) with minimal fallback
- **Gaps:** No timeout enforcement, inconsistent wait caps (30s vs 60s), contenteditable elements bug

### mcpGitTools.js
- **7 git command wrappers** mixed onto MCPToolServer
- **Critical issues:** 3 dependency functions undefined (gitManager, _runCommand, _sanitizeShellArg)
- **Security risk:** Potential shell injection in _gitStash if _sanitizeShellArg fails
- **Gaps:** No credential handling, incomplete action support (missing branch delete/merge), no rollback
- **Error handling:** Minimal, many silent failures

### toolParser.js
- **12 exported functions** + 2 constants (TOOL_NAME_ALIASES, VALID_TOOLS)
- **Purpose:** Comprehensive tool call extraction from LLM text
- **Strengths:** 9+ detection methods, JSON repair heuristics, regex-based recovery
- **Critical issues:** Regex-based content extraction unsafe, insufficient param validation
- **Gaps:** No multiline comment handling, path inference false positives, editorial detection incomplete
- **Design:** Fallback chain, early exit on success (blocks other methods), deduplication insufficient

---

**Total Lines Audited:** 727 lines fully read  
**Critical Issues Found:** 9  
**High-Severity Issues Found:** 8  
**Medium-Severity Issues Found:** 14  
**Low-Severity Issues Found:** 6

---

# PART 8 — IPC HANDLERS

## Part 8a — Agent, Benchmark, Browser, Cloud, CodeReview, Collab, Database, Debug, Dialog, Docs, Editor

Now I'll create a comprehensive audit document for all 11 IPC handler files:

---

# **COMPREHENSIVE IPC HANDLERS AUDIT REPORT**

**Generated:** March 13, 2026  
**Workspace:** `C:\Users\brend\IDE`  
**Scope:** 11 IPC handler files in `main/ipc/`

---

## **TABLE OF CONTENTS**

1. [agentHandlers.js](#1-agenthandlersjs)
2. [benchmarkHandlers.js](#2-benchmarkhandlersjs)
3. [browserHandlers.js](#3-browserhandlersjs)
4. [cloudLlmHandlers.js](#4-cloudllmhandlersjs)
5. [codeReviewHandlers.js](#5-codereviewhandlersjs)
6. [collabHandlers.js](#6-collabhandlersjs)
7. [databaseHandlers.js](#7-databasehandlersjs)
8. [debugHandlers.js](#8-debughandlersjs)
9. [dialogHandlers.js](#9-dialoghandlersjs)
10. [docsHandlers.js](#10-docshandlersjs)
11. [editorHandlers.js](#11-editorhandlersjs)

---

## **1. agentHandlers.js**

**File Location:** [main/ipc/agentHandlers.js](main/ipc/agentHandlers.js)

### **Purpose & Overview**
Manages background AI agents for autonomous task execution and audio transcription via Groq Whisper API. Agents run asynchronously as fire-and-forget operations with status updates sent to the renderer.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC message handler registration | Registering all handler functions |
| `https` | HTTPS client | Making HTTPS requests to Groq API for audio transcription |

### **Context Dependencies**
- `ctx.getMainWindow()` - Get the main Electron window for sending status updates
- `ctx.cloudLLM.getConfiguredProviders()` - Get available cloud LLM providers
- `ctx.cloudLLM.generate()` - Generate text via cloud provider
- `ctx.llmEngine.getStatus()` - Check if local LLM is ready
- `ctx.llmEngine.generate()` - Generate text via local LLM

### **IPC Handlers**

#### **1. `agent-spawn` (handle)**
- **Description:** Spawn a new background agent to complete a task
- **Parameters:**
  - `task` (string) - The task description for the agent
  - `agentContext` (object) - Optional context with `projectPath`, `maxIterations`
- **Returns:** `{ success: true, id: <agentId> }`
- **Logic Flow:**
  1. Increment `nextAgentId` counter
  2. Create agent object with status `'running'`
  3. Store in `backgroundAgents` Map
  4. Send `'agent-status'` event to renderer
  5. Execute async generation via cloud LLM or local engine
  6. Set agent status to `'completed'` or `'error'`
  7. Send final status update with result

#### **2. `agent-cancel` (handle)**
- **Description:** Cancel a running background agent
- **Parameters:**
  - `agentId` (number) - The ID of the agent to cancel
- **Returns:** `{ success: true }` or `{ success: false, error: 'Agent not found' }`
- **Logic:** Look up agent by ID, set `cancelled = true`, mark status as `'cancelled'`

#### **3. `agent-get-result` (handle)**
- **Description:** Get the current status and result of an agent
- **Parameters:**
  - `agentId` (number) - The ID of the agent to query
- **Returns:** Agent object with `id`, `status`, `task`, `result`, `error` fields
- **Logic:** Simple Map lookup and return

#### **4. `agent-list` (handle)**
- **Description:** List all active background agents
- **Parameters:** None
- **Returns:** `{ agents: [ { id, task, status, startedAt }, ... ] }`
- **Logic:** Iterate `backgroundAgents` Map and build summary array

#### **5. `transcribe-audio` (handle)**
- **Description:** Transcribe audio using Groq Whisper API
- **Parameters:**
  - `audioBase64` (string) - Audio file encoded as base64
- **Returns:** `{ success: true, text: '<transcribed_text>' }` or error
- **Logic Flow:**
  1. Retrieve Groq API key from `ctx.cloudLLM.apiKeys.groq`
  2. Decode base64 audio to Buffer
  3. Build multipart form-data with audio and model parameters
  4. Send HTTPS POST request to `api.groq.com/openai/v1/audio/transcriptions`
  5. Parse JSON response and extract `text` field
  6. Handle errors, timeouts (30s), and malformed responses

### **Potential Issues & Race Conditions**

1. **Memory Leak Risk - Agent Storage Not Cleaned:**
   - Agents remain in `backgroundAgents` Map indefinitely even after completion
   - No removal logic for completed/cancelled/errored agents
   - **Issue:** Long-running IDEs could accumulate thousands of agent records in memory

2. **nextAgentId Not Thread-Safe:**
   - Incremented without synchronization in async context
   - If race conditions exist, could generate duplicate IDs
   - Map key collisions could overwrite earlier agents

3. **Cloud Provider Fallback Order:**
   - Tries cloud LLM first, then local LLM
   - Later: tries cloud LLM again (line 58-59) — redundant logic
   - No preference for local-first in an offline IDE

4. **No Timeout on Agent Generation:**
   - Agent async thread could hang indefinitely
   - Renderer never notified if generation stalls
   - `agent-cancel` sets flag but doesn't forcefully stop generation

5. **Missing Window Existence Checks:**
   - Multiple checks like `if (win && !win.isDestroyed())` but window could be destroyed between checks
   - Sending to destroyed window silently fails

6. **Transcription Multipart Encoding:**
   - Manual boundary string construction could fail if `Date.now()` collides (unlikely but theoretically possible)
   - No validation that audio buffer format is correct for Groq API
   - No logging of full request/response for debugging

7. **Error Handling Too Broad:**
   - All transcription failures caught in single try-catch with generic error message
   - API errors, network errors, timeout errors all treated the same

### **Edge Cases**

- Agent with `maxIterations: 0` will complete immediately
- Audio transcription with empty base64 string may crash API
- Window close during agent generation leaves orphan async operation
- Calling `agent-cancel` multiple times on same ID works but not idempotent

---

## **2. benchmarkHandlers.js**

**File Location:** [main/ipc/benchmarkHandlers.js](main/ipc/benchmarkHandlers.js)

### **Purpose & Overview**
Provides pre-built test suite definitions and persists benchmark results to disk. Test cases include tool recognition, real-world tasks, multi-step chains, and refusal detection. Designed to validate model behavior without hand-holding prompts.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Registering handlers |
| `path` | Path utilities | File path resolution |
| `fs.promises` | Async filesystem | Reading/writing results files |

### **Context Dependencies**
- `ctx.appPath || electron.app.getPath('userData')` - Get application data directory

### **Global State**

**DEFAULT_TEST_CASES** - Constant array of 16 test cases:
- **Tool Recognition (4 tests):** web-search, browser-navigate, file-write, file-read (explicit tool names in prompts)
- **Real-World Tasks (6 tests):** Weather, news, shopping, Node version, restaurant, notes (vague, require tool inference)
- **Multi-step (2 tests):** search→save, browse→extract (tool chains)
- **Refusal Detection (3 tests):** Verify model doesn't refuse browser/search/file operations
- **Chat Baseline (2 tests):** Should NOT call tools for greetings, knowledge questions

### **IPC Handlers**

#### **1. `benchmark-get-tests` (handle)**
- **Description:** Return the complete test suite
- **Parameters:** None
- **Returns:** Array of 16 test case objects, each with:
  - `id` (string) - Unique test identifier
  - `category` (string) - Category (Tool Recognition, Real-World, etc.)
  - `prompt` (string) - The user prompt to send to model
  - `expectedTools` (array) - Array of tool names that SHOULD be called
  - `description` (string) - Human description
  - `maxIterations` (number) - Max agentic loop iterations
  - `refusalPatterns` (array, optional) - Strings that indicate improper refusal
- **Logic:** Simply return the constant array

#### **2. `benchmark-save-results` (handle)**
- **Description:** Persist benchmark results to disk
- **Parameters:**
  - `results` (object) - Test results object (full structure not specified)
- **Returns:** `{ success: true, path: '<filepath>' }` or error
- **Logic Flow:**
  1. Determine results directory: `<appPath>/benchmark-results/`
  2. Create directory if not exists (recursive)
  3. Generate timestamp filename: `benchmark-<ISO_TIMESTAMP>.json`
  4. Write JSON stringified results to file
  5. Return success with filepath

#### **3. `benchmark-load-results` (handle)**
- **Description:** Load past benchmark results from disk
- **Parameters:** None
- **Returns:** `{ success: true, results: [ { file, data }, ... ] }`
- **Logic Flow:**
  1. Determine results directory
  2. Create directory if not exists
  3. Read all files in directory
  4. Filter for `.json` files and sort in reverse (newest first)
  5. Load last 20 result files
  6. Parse each JSON file
  7. Build results array with filename and parsed data
  8. Ignore individual file parse errors but continue
  9. Return success with results array

### **Potential Issues & Race Conditions**

1. **Timestamp Collision Risk:**
   - Two concurrent `benchmark-save-results` calls could generate identical timestamps (millisecond granularity)
   - Second write would overwrite the first silently
   - **Issue:** Race condition if benchmark runs parallel

2. **File System Error Handling:**
   - `mkdir` with `recursive: true` could fail silently if parent directory is read-only
   - No validation that `fs.mkdir` succeeded before writing
   - Caught in outer try-catch, entire operation fails if directory creation fails

3. **No File Lock Protection:**
   - Multiple processes could read/write benchmark files simultaneously
   - No atomic writes or file locking mechanism
   - Corrupted JSON if write interrupted mid-operation

4. **Unbounded Results List:**
   - Only loads last 20 results, but benchmark directory could have thousands of files
   - Sorting entire `fs.readdir()` result in memory could be slow
   - No pagination or lazy loading

5. **Silent Parse Failures:**
   - Individual JSON parse errors ignored in `benchmark-load-results`
   - User never sees which result files are corrupted
   - Returns incomplete results list without warning

6. **Hardcoded Paths:**
   - Path resolution depends on electron state: `ctx.appPath || electron.app.getPath('userData')`
   - If `ctx.appPath` is undefined, path might point to unexpected location
   - No validation that path is writable

### **Edge Cases**

- Results directory doesn't exist but can't be created (permission denied) → returns error
- Extremely large results object could hit file size limits or memory limits during stringify
- Previous results with different format/schema could fail JSON parse
- Empty results object should still save successfully

---

## **3. browserHandlers.js**

**File Location:** [main/ipc/browserHandlers.js](main/ipc/browserHandlers.js)

### **Purpose & Overview**
Simple wrapper layer that delegates browser automation calls to `ctx.browserManager`. Provides IPC endpoints for navigation, focus, interactions, and screenshots.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Registering handlers |

### **Context Dependencies**
- `ctx.browserManager` - BrowserManager instance with methods:
  - `navigate(url)`, `show(bounds)`, `hide()`, `setBounds(bounds)`, `focus()`
  - `goBack()`, `goForward()`, `reload()`, `getState()`
  - `screenshot()`, `getContent(selector, html)`, `evaluate(code)`
  - `click(selector)`, `type(selector, text)`, `launchExternalChrome(url)`

### **IPC Handlers** (14 total)

| Handler | Async | Parameters | Returns | Notes |
|---------|-------|------------|---------|-------|
| `browser-navigate` | Yes | `url` | Result from browserManager | Direct passthrough |
| `browser-show` | No | `bounds` | `{ success: true }` | Calls browserManager.show() |
| `browser-focus` | No | None | `{ success: true/false }` | Tries to focus browser webContents, has error handling |
| `browser-hide` | No | None | `{ success: true }` | Calls browserManager.hide() |
| `browser-set-bounds` | No | `bounds` | `{ success: true }` | Calls setBounds() |
| `browser-go-back` | No | None | Result from browserManager | Direct passthrough |
| `browser-go-forward` | No | None | Result from browserManager | Direct passthrough |
| `browser-reload` | No | None | Result from browserManager | Direct passthrough |
| `browser-get-state` | No | None | Result from browserManager | Direct passthrough |
| `browser-screenshot` | Yes | None | Result from browserManager | Direct passthrough |
| `browser-get-content` | Yes | `selector`, `html` (bool) | Result from browserManager | Direct passthrough |
| `browser-evaluate` | Yes | `code` (JavaScript string) | Result from browserManager | Direct passthrough |
| `browser-click` | Yes | `selector` | Result from browserManager | Direct passthrough |
| `browser-type` | Yes | `selector`, `text` | Result from browserManager | Direct passthrough |
| `browser-launch-external` | Yes | `url` | Result from browserManager | Direct passthrough |

### **Error Handling**

The `browser-focus` handler has explicit error handling:
```javascript
try {
  const wc = ctx.browserManager?.browserView?.webContents;
  if (wc && !wc.isDestroyed()) wc.focus();
  return { success: true };
} catch { return { success: false }; }
```

All other handlers have ZERO error handling — they will throw unhandled rejections if browserManager methods fail.

### **Potential Issues**

1. **No Error Handling on Async Handlers:**
   - `browser-navigate`, `browser-screenshot`, `browser-get-content`, `browser-evaluate`, `browser-click`, `browser-type`, `browser-launch-external` have no try-catch
   - If any method throws, IPC returns unhandled promise rejection
   - Renderer never receives error response
   - **Impact:** UI will hang waiting for IPC response that never returns

2. **Inconsistent Return Format:**
   - `browser-focus` returns `{ success: true/false }`
   - Others return "Result from browserManager" (whatever that is — not documented)
   - Renderer code must handle multiple return formats

3. **No Bounds Validation:**
   - `browser-show` and `browser-set-bounds` accept `bounds` parameter without validation
   - No checks for negative dimensions, out-of-screen coordinates, etc.

4. **No URL Validation:**
   - `browser-navigate` accepts any string as URL without validation
   - Could pass protocol-relative URLs, about:, data: URIs, etc.

5. **Optional Chaining Could Mask Errors:**
   - `ctx.browserManager?.browserView?.webContents` in focus handler
   - If `browserManager` is null, silently returns success
   - Code continues as if focus succeeded when it actually didn't

6. **No Selector Validation:**
   - `browser-click`, `browser-type`, `browser-get-content` accept selectors without validation
   - Invalid CSS selectors could fail silently in browser context

### **Edge Cases**

- `browser-focus` called when browserManager doesn't exist → returns success but did nothing
- `browser-click` with selector that matches 0 elements → behavior depends on browserManager implementation
- `browser-navigate` called rapidly before previous navigation completes → undefined sequence

---

## **4. cloudLlmHandlers.js**

**File Location:** [main/ipc/cloudLlmHandlers.js](main/ipc/cloudLlmHandlers.js)

### **Purpose & Overview**
Manages cloud LLM provider configuration, API key storage, provider testing, model listing, and text generation with token streaming. Implements license checking and quota error detection.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |
| `path` | Path utilities | Config file path construction |
| `fs` (sync) | Synchronous file I/O | Reading/writing config JSON |

### **Context Dependencies**
- `ctx.cloudLLM` - CloudLLM manager with:
  - `.apiKeys` - Object with API keys by provider
  - `.setApiKey(provider, key)` - Set a provider's API key
  - `.getConfiguredProviders()` - Get providers with keys set
  - `.getAllProviders()` - Get all available providers
  - `.getStatus()` - Get current status
  - `.fetchOpenRouterModels()` - Fetch available models from OpenRouter
  - `.generate(prompt, options)` - Generate text with streaming support
  - `.getRecommendedPaceMs()` - Get recommended delay between API calls
- `ctx.licenseManager.checkAccess()` - Check if user has license for cloud features
- `ctx.userDataPath || ctx.appBasePath` - Application data directory
- `ctx.encryptApiKey(key)` - Encrypt API key before saving
- `ctx.getMainWindow()` - Get renderer window for streaming tokens

### **Utility Functions**

#### **classifyError(err)**
Categorizes API errors into:
- `rate_limited` - Rate limit error (429 or "rate limit" in message)
- `missing_key` - No API key configured
- `auth` - Authentication error (401/403)
- `model_not_found` - Model not found (404)
- `api_error` - Other HTTP error with code
- `timeout` - Timeout error
- `error` - Generic error

#### **doTestKey(provider, model)**
Tests a provider's API key by sending "Reply with exactly: OK" prompt with 8 token limit. Returns:
- `{ success: true, provider, model, latencyMs, tokensUsed, text }`
- `{ success: false, error, provider }`

### **IPC Handlers**

#### **1. `cloud-llm-set-key` (handle)**
- **Description:** Set API key for a provider and persist to config
- **Parameters:**
  - `provider` (string) - Provider name (e.g., "openai", "anthropic")
  - `key` (string) - The API key
- **Returns:** `{ success: true }`
- **Logic Flow:**
  1. Call `ctx.cloudLLM.setApiKey(provider, key)` to set in-memory
  2. Load existing config from `.guide-config.json` (must be in userData path)
  3. Encrypt key using `ctx.encryptApiKey(key)`
  4. Save back to config file
  5. Silent fail if file write fails (only console.error logged)
- **Issues:**
  - Config file path hardcoded and requires userData path to exist
  - Sync file I/O blocks event loop
  - Silent failure on write errors (no return error field)
  - Encryption key storage not addressed

#### **2. `cloud-llm-get-providers` (handle)**
- **Description:** Get configured providers
- **Parameters:** None
- **Returns:** Result of `ctx.cloudLLM.getConfiguredProviders()` (array of configured providers)

#### **3. `cloud-llm-get-all-providers` (handle)**
- **Description:** Get all available providers
- **Parameters:** None
- **Returns:** Result of `ctx.cloudLLM.getAllProviders()`

#### **4. `cloud-llm-get-status` (handle)**
- **Description:** Get current LLM status
- **Parameters:** None
- **Returns:** Result of `ctx.cloudLLM.getStatus()`

#### **5. `cloud-llm-fetch-openrouter-models` (handle)**
- **Description:** Fetch model list from OpenRouter API
- **Parameters:** None
- **Returns:** `{ success: true, ...models }` or `{ success: false, error }`
- **Logic:** Call `ctx.cloudLLM.fetchOpenRouterModels()` and spread result

#### **6. `cloud-llm-test-key` (handle)**
- **Description:** Test a single provider's API key
- **Parameters:**
  - `provider` (string)
  - `model` (string, optional)
- **Returns:** Result of `doTestKey()` or error classification
- **Logic:** Calls `doTestKey()` with error classification

#### **7. `cloud-llm-test-all-configured-keys` (handle)**
- **Description:** Test all configured providers in sequence
- **Parameters:** None
- **Returns:** `{ success: true, results: [ { success, provider, model, ... }, ... ] }`
- **Logic Flow:**
  1. Get configured providers list
  2. For each provider:
     - Extract first model ID
     - Wait for recommended pace (default 250ms, at least 250ms) to avoid rate limits
     - Call `doTestKey()` and add result to array
  3. Catch individual errors and add error result
- **Potential Race Condition:**
  - `ctx.cloudLLM.getRecommendedPaceMs?.()` uses optional chaining but might always return 250ms
  - Multiple concurrent calls to this handler could all use same pace, defeating the purpose

#### **8. `cloud-llm-generate` (handle)**
- **Description:** Generate text using cloud LLM with optional token streaming
- **Parameters:**
  - `prompt` (string)
  - `options` (object):
    - `provider` (string)
    - `model` (string)
    - `stream` (boolean) - Enable token streaming
    - Other options passed through to `.generate()`
- **Returns:** `{ success: true, ...result }` or error
- **License Check:** First calls `ctx.licenseManager.checkAccess()`, returns license error if blocked
- **Logic Flow:**
  1. Check license access
  2. Call `ctx.cloudLLM.generate(prompt, options)` with:
     - `onToken` callback if streaming → sends `'llm-token'` event to renderer
     - `onThinkingToken` callback if streaming → sends `'llm-thinking-token'` event
  3. Return successful result
  4. Catch errors:
     - If quota error: return special message with upgrade link
     - Otherwise: return error message
- **Potential Issues:**
  - Renderer window could be destroyed before `onToken` callback fires
  - No error handling inside callbacks — errors in callbacks could crash streaming
  - Quota error handling assumes specific error message format

### **Potential Issues & Design Concerns**

1. **Synchronous File I/O in set-key:**
   - Using `fsSync.readFileSync()` and `fsSync.writeFileSync()` blocks entire event loop
   - Could be slow if config file is large or filesystem is slow
   - No async alternative used

2. **Silent Failure on Config Write:**
   - If config write fails, returns `{ success: true }` anyway
   - Only logs to console, API key is loaded in memory but not persisted
   - Next app restart will lose the key

3. **No Config File Validation:**
   - Reads JSON but doesn't validate structure
   - Could have old format from previous versions
   - Merges missing keys but could have other fields that break

4. **Hardcoded Encryption:**
   - `ctx.encryptApiKey()` not documented — implementation unknown
   - No key rotation strategy
   - No verification that encryption is actually happening

5. **Token Streaming Callbacks Without Error Handling:**
   - Callbacks `onToken` and `onThinkingToken` could throw
   - Errors would bubble up from cloudLLM and crash the generate call
   - No try-catch around callbacks

6. **Window Destruction Race Condition:**
   - Between calling `ctx.getMainWindow()` and sending event, window could be destroyed
   - `win.webContents.send()` would fail silently (no error thrown in older Electron versions)

7. **Quota Error Regex Fragile:**
   - Checks `error.message?.includes('quota_exceeded')` — fragile to error message changes
   - Also checks `error.isQuotaError` — inconsistent error typing across providers

8. **Pacing Between API Calls Insufficient:**
   - 250ms gap between test-all-configured-keys calls might not be enough for hostile rate limiters
   - No exponential backoff or retry logic if rate limited

### **Edge Cases**

- Provider with no models → returns error "No model available"
- API key set but encrypted key can't be written → still marked success
- Streaming disabled but `onToken` callback still attached → wasted memory
- Generation with empty provider/model → passed to cloudLLM, behavior undefined

---

## **5. codeReviewHandlers.js**

**File Location:** [main/ipc/codeReviewHandlers.js](main/ipc/codeReviewHandlers.js)

### **Purpose & Overview**
AI-powered code review functionality with four entry points: review individual file, review staged git changes, review arbitrary diff, and apply code fixes. Uses LLM to analyze code and return structured JSON findings.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |
| `path` | Path utilities | File path resolution and manipulation |
| `fs` (sync) | Synchronous file I/O | Reading/writing files |

### **Context Dependencies**
- `ctx.llmEngine` - Local LLM engine with `.generate(prompt, options)`
- `ctx.cloudLLM` - Cloud LLM with `.generate(prompt, options)`
- `ctx.gitManager` - Git operations with `.getStagedDiff()`
- `ctx.currentProjectPath` - Current project root path

### **IPC Handlers**

#### **1. `code-review-file` (handle)**
- **Description:** Review a single source file for issues
- **Parameters:**
  - `params.filePath` (string) - Path to file
  - `params.cloudProvider` (string, optional) - Cloud provider name
  - `params.cloudModel` (string, optional) - Cloud model name
- **Returns:** `{ success: true, findings: [ {...}, ... ], filePath, truncated }`
- **Logic Flow:**
  1. Resolve absolute file path, check existence
  2. Read file content (sync)
  3. Detect file extension
  4. Truncate to 15,000 chars if needed, mark `truncated` flag
  5. Build prompt asking LLM to review for bugs, security, performance, best practices
  6. Generate review text:
     - Try cloud provider first (if specified)
     - Fall through to local LLM
     - Fall through to cloud provider again (redundant)
  7. Parse JSON array from response using regex `\[[\s\S]*\]`
  8. Normalize findings:
     - Validate severity (critical/warning/suggestion)
     - Validate line number (must be number or null)
     - Truncate title to 100 chars
  9. Return findings array
- **Finding Schema:**
  ```json
  {
    "id": "finding_0",
    "severity": "critical|warning|suggestion",
    "line": <number|null>,
    "title": "<string, max 100 chars>",
    "description": "<string>",
    "fix": "<code snippet or null>"
  }
  ```

#### **2. `code-review-staged` (handle)**
- **Description:** Review staged git changes before commit
- **Parameters:**
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, findings: [...], truncated }`
- **Logic Flow:**
  1. Check if git manager and current project exist
  2. Get staged diff from git: `ctx.gitManager.getStagedDiff()`
  3. If empty, return error
  4. Truncate to 12,000 chars if needed
  5. Build prompt for reviewing git diff
  6. Generate review (same fallback chain: cloud→local→cloud)
  7. Parse JSON and normalize findings with same validation as file review

#### **3. `code-review-diff` (handle)**
- **Description:** Review arbitrary diff (between branches, commits, etc.)
- **Parameters:**
  - `params.diff` (string) - The diff content
  - `params.context` (string, optional) - Optional context string to append to prompt
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, findings: [...], truncated }`
- **Logic:** Similar to staged review, but uses provided diff instead of git-fetched

#### **4. `code-review-apply-fix` (handle)**
- **Description:** Apply a suggested fix to a file
- **Parameters:**
  - `params.filePath` (string) - File to modify
  - `params.line` (number) - Approximate line number
  - `params.fix` (string) - The suggested fix code
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, filePath }`
- **Logic Flow:**
  1. Resolve absolute path, check existence
  2. Read file content and split into lines
  3. Extract surrounding code context (line ± 10)
  4. Build prompt asking LLM to apply fix to code
  5. Generate fixed code:
     - Try cloud first
     - Fall through to local
     - Fall through to cloud again (redundant)
  6. Remove markdown fences from response
  7. Write modified file back to disk (sync)
  8. Return success
- **Critical Issue:** **No backup or diff preview** — file is overwritten immediately without user confirmation

### **Potential Issues & Bugs**

1. **JSON Extraction Too Greedy:**
   - Regex `\[[\s\S]*\]` matches FIRST `[` to LAST `]` in response
   - If LLM outputs multiple JSON objects or arrays, captures everything between first and last brackets
   - Could include unrelated content

2. **Silent Fallback Chain Failures:**
   - Tries cloud → local → cloud again
   - If none produce findings, returns empty findings array with `rawReview` field
   - Renderer might interpret as "no issues found" when actually LLM failed

3. **JSON Parse Error Handling:**
   - If JSON parsing fails, returns `{ success: true, findings: [], rawReview: <text> }`
   - Not `success: false` — inconsistent with error cases
   - Renderer might not distinguish between "no issues" and "parse failed"

4. **File Write Not Idempotent (apply-fix):**
   - Writes file directly without backup
   - If LLM returns garbage or incomplete code, file is corrupted
   - No way to undo except git revert

5. **Truncation Loss of Context:**
   - Large files truncated to 15k chars loses important context
   - Findings might reference lines beyond truncated point (line 20,000)
   - LLM can't see full file so findings might be incomplete

6. **No Validation of Fix Output:**
   - After LLM applies fix, file is written without parsing or validation
   - If LLM returns non-code (e.g., markdown explanation), file is overwritten with explanation text

7. **File Path Security:**
   - Uses `path.resolve(filePath)` but no check that resolved path is within project
   - Could allow code review of arbitrary files on system
   - No symlink resolution

8. **Git Diff Without Authentication:**
   - Assumes `ctx.gitManager` is available and authenticated
   - No error handling if git operations fail mid-review

9. **Redundant Cloud Fallback:**
   - Lines like:
     ```javascript
     if (!reviewText && ctx.cloudLLM) {
       // try cloud again
     }
     ```
   - Repeats the same operation if it already failed
   - Should fallback to different provider or mode, not retry same provider

10. **Severity Validation Weak:**
    - Accepts any severity not in list as `'suggestion'`
    - Could silently downgrade critical issues to suggestions

### **Edge Cases**

- File changed between read and write (TOCTOU race)
- Diff with no hunks (empty diff)
- Git-managed file outside repository
- LLM returns array with 1000+ findings → could hit memory limits
- Line number provided is 0 or negative
- Finding title contains newlines or control characters

---

## **6. collabHandlers.js**

**File Location:** [main/ipc/collabHandlers.js](main/ipc/collabHandlers.js)

### **Purpose & Overview**
Collaborative editing (Live Share style) with WebSocket-based server and client. Supports real-time text editing, cursor position sync, and chat within shared sessions. Uses password-based authentication.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |
| `http` | HTTP server | Creating server for WebSocket |
| `crypto` | Cryptography | Generating session IDs and passwords |
| `os` | System info | Getting local IP addresses |
| `ws` (WebSocket) | WebSocket library | Server and client connections |

### **Global State** (Module-level)

```javascript
let collabServer = null;           // { httpServer, wss }
let collabClients = new Map();     // peerId → { ws, username, color, cursor }
let collabDoc = null;              // { content, version, filePath }
let hostSession = null;            // { sessionId, port, password }
let clientConnection = null;       // { ws, peerId } for joining a session
const COLORS = [13 color HEX codes];
let colorIdx = 0;
```

**Critical Issue: Global mutable state shared across all instances — not thread-safe**

### **Utility Functions**

#### **_genSessionId()**
Generates random 3-byte hex string (6 chars like "A1B2C3")

#### **_genPassword()**
Generates random 4-byte hex string (8 chars like "abc12345def")

#### **_getLocalIPs()**
Returns array of non-internal IPv4 addresses from `os.networkInterfaces()`

#### **_broadcast(data, exclude)**
Sends JSON message to all connected WebSocket clients except one:
- Serializes data to JSON
- Skips excluded peerId
- Skips clients with `readyState !== 1` (not connected)
- Silently ignores send errors

### **IPC Handlers**

#### **1. `collab-available` (handle)**
- **Description:** Check if WebSocket support is available
- **Parameters:** None
- **Returns:** `{ available: true/false }`
- **Logic:** Returns `!!WebSocketServer` (truthy if ws package loaded)

#### **2. `collab-host` (handle)**
- **Description:** Start a collaboration server
- **Parameters:**
  - `params.filePath` (string) - File being collaborated on
  - `params.content` (string) - Initial file content
  - `params.username` (string, default "Host") - Host's name
  - `params.port` (number, default 0 for auto-assign)
- **Returns:** 
  ```json
  {
    "success": true,
    "sessionId": "ABC123",
    "port": 54321,
    "password": "abc12345",
    "localIPs": ["192.168.1.100"],
    "shareLink": "ws://192.168.1.100:54321"
  }
  ```
- **Logic Flow:**
  1. Check if already hosting → return error
  2. Generate session ID, password
  3. Initialize WebSocket server on raw HTTP
  4. Initialize collaboration document
  5. Reset color index
  6. Register WebSocket connection handler:
     - Generate peerId (8-byte random hex) and assign color
     - On message:
       - Parse JSON
       - Handle `auth` → validate password, store client, send `init` with doc state and peers list
       - Handle `edit` → update doc, broadcast to others
       - Handle `cursor` → update client cursor state, broadcast
       - Handle `chat` → broadcast to all including sender
       - Notify host renderer via IPC event
     - On close → remove client, broadcast peer-left
  7. Return server info with success

#### **3. `collab-stop-host` (handle)**
- **Description:** Stop the collaboration server
- **Parameters:** None
- **Returns:** `{ success: true }`
- **Logic:**
  1. Check if hosting
  2. Close all client WebSockets
  3. Clear clients map
  4. Close WebSocket server
  5. Close HTTP server
  6. Clear module-level state

#### **4. `collab-join` (handle)**
- **Description:** Join an existing collaboration session
- **Parameters:**
  - `params.host` (string) - Host IP/hostname
  - `params.port` (number) - Port number
  - `params.password` (string) - Session password
  - `params.username` (string, default "Guest") - Joiner's name
- **Returns:**
  ```json
  {
    "success": true,
    "peerId": "<hex>",
    "color": "#FF6B6B",
    "doc": { "content", "version", "filePath" },
    "peers": [{ "id", "username", "color", "cursor" }]
  }
  ```
- **Logic Flow:**
  1. Check if already connected
  2. Create WebSocket connection: `ws://<host>:<port>`
  3. On open → send `auth` message with password and username
  4. On message:
     - If `auth-failed` → close connection, return error
     - If `init` → store connection info, return success with doc and peers
     - Otherwise → forward all messages to renderer via IPC event
  5. On close → clear connection, notify renderer
  6. On error → clear connection, return error
  7. Returns promise (async callback-based)

#### **5. `collab-leave` (handle)**
- **Description:** Disconnect from joined session
- **Parameters:** None
- **Returns:** `{ success: true }`
- **Logic:** Close WebSocket if connected

#### **6. `collab-send-edit` (handle)**
- **Description:** Send edited content to shared doc
- **Parameters:**
  - `params.content` (string) - New content
  - `params.selection` (object, optional) - Selection info
- **Returns:** `{ success: true/false }`
- **Logic:** Send JSON `{ type: 'edit', content, selection }` to connected server

#### **7. `collab-send-cursor` (handle)**
- **Description:** Send cursor position
- **Parameters:**
  - `cursor` (object) - Cursor info
- **Returns:** `{ success: true/false }`
- **Logic:** Send `{ type: 'cursor', cursor }` JSON

#### **8. `collab-send-chat` (handle)**
- **Description:** Send chat message
- **Parameters:**
  - `message` (string)
- **Returns:** `{ success: true/false }`
- **Logic:** Send `{ type: 'chat', message }` JSON

#### **9. `collab-get-session` (handle)**
- **Description:** Get current session info
- **Parameters:** None
- **Returns:** 
  - If hosting: `{ success: true, role: 'host', session: {...}, peers: [...], doc: {...} }`
  - If joined: `{ success: true, role: 'client', peerId: <id> }`
  - If none: `{ success: true, role: null }`

#### **10. `collab-update-doc` (handle)**
- **Description:** Update shared document from host
- **Parameters:**
  - `content` (string) - New content
- **Returns:** `{ success: true, version }`
- **Logic:**
  1. Update `collabDoc.content` and increment `version`
  2. Broadcast edit message to all clients
  3. Return success with new version

### **Potential Issues & Race Conditions**

1. **Global State Not Thread-Safe:**
   - Module-level maps and variables shared across all IPC calls
   - If two processes call `collab-host` concurrently, both could try to start servers
   - `collabServer` check is not atomic:
     ```javascript
     if (collabServer) return error;
     // Between here and assignment, another call could sneak in
     collabServer = { httpServer, wss };
     ```

2. **Password in Query/Log:**
   - Session password sent in clear text over WebSocket to auth
   - No TLS/WSS encryption mentioned
   - Anyone with network visibility can intercept password and session ID
   - Passwords stored in Share Link URL (ws://host:port) — shared via URL might expose in logs

3. **No Conflict Resolution for Edits:**
   - Both host and clients can modify `collabDoc.content` simultaneously
   - Last write wins — potential data loss
   - No versioning, OT, or CRDT to handle concurrent edits
   - Client edits overwrite host edits if they arrive out of order

4. **Perf Issue: Full Content in Every Edit:**
   - Each edit broadcasts entire new document content
   - For large files (10MB+) each keystroke broadcasts 10MB
   - Network bandwidth explodes, all clients must re-process

5. **No Message Size Limits:**
   - Client can send arbitrarily large `content` field
   - Server stores in memory: `collabDoc.content = msg.content`
   - Malicious client could send 1GB message, exhaust server memory

6. **Broadcast Error Silently Ignored:**
   - `_broadcast()` catches all send errors and silently continues
   - If network fails mid-broadcast, no notification to client
   - Client thinks message was sent but it wasn't

7. **Colorimetry Collision:**
   - `colorIdx` is global, shared across all sessions
   - Color assignment depends on order of connection
   - If Host A gets color 0, Host B (different session) also gets color 0
   - Colors are not unique across sessions

8. **Perf Issue: JSON Parsing Inside Message Handler:**
   - Every message wraps in try-catch around `JSON.parse(raw.toString())`
   - Large messages could GC stall or hang parser
   - No message size limit check before parsing

9. **Race Condition: Window Destruction:**
   - `ctx.mainWindow.webContents.send()` called after receiving message
   - Window could be destroyed between handler and send call
   - Silent failure, client never notified

10. **No Session Timeout:**
    - WebSocket connections persist indefinitely even if idle
    - Crashed client leaves connection open until peer timeout (~30 seconds)
    - Server memory grows with dead connections

11. **Promise-Based collab-join Returns Immediately:**
    - Handler returns promise before connection established
    - User gets success immediately but connection might fail moments later
    - No way to know if final connection succeeded

### **Edge Cases**

- Port 0 auto-assigns, but server might choose port > 65535 (error)
- Host with no IPv4 addresses → `localIPs` returns empty array
- Rapid auth failures → leads to connection spam
- Peer sends `edit` before `auth` → could crash if `collabDoc` not initialized
- Massive file as initial content → could freeze UI entirely
- Multiple `collab-host` calls in series → all race with shared global state

---

## **7. databaseHandlers.js**

**File Location:** [main/ipc/databaseHandlers.js](main/ipc/databaseHandlers.js)

### **Purpose & Overview**
Database viewer and query builder using sql.js (SQLite compiled to WASM). Supports opening/creating databases, running queries, viewing tables, AI-assisted query generation, and exporting to CSV.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |
| `path` | Path utilities | File path operations |
| `fs` (sync) | Synchronous file I/O | Reading/writing SQLite files |
| `sql.js` (WASM) | SQLite engine | Database operations in-process |

### **Global State**

```javascript
const openDatabases = new Map(); // id → { db, filePath, type: 'sqlite', modified? }
let initSqlJs = null;
let SQL = null; // sql.js Database object
```

### **Initialization Function**

#### **ensureSqlJs() (async)**
- Lazy-loads sql.js if not already loaded
- Caches in `SQL` variable
- Returns promise that resolves to sql.js instance

### **IPC Handlers**

#### **1. `db-open` (handle)**
- **Description:** Open an existing SQLite database file
- **Parameters:**
  - `filePath` (string)
- **Returns:** `{ success: true, id, filePath, tables: [...] }`
- **Logic Flow:**
  1. Resolve absolute path
  2. Check file exists
  3. Ensure sql.js loaded
  4. Read file as binary using fs.readFileSync
  5. Create database from buffer: `new sqlJs.Database(fileBuffer)`
  6. Generate unique ID: `db_<timestamp>_<random>`
  7. Store in openDatabases Map
  8. Query tables: `SELECT name, type FROM sqlite_master WHERE type IN ('table','view')`
  9. Return tables list

#### **2. `db-create` (handle)**
- **Description:** Create new empty SQLite database
- **Parameters:**
  - `filePath` (string)
- **Returns:** `{ success: true, id, filePath, tables: [] }`
- **Logic:**
  1. Ensure sql.js loaded
  2. Create empty database: `new sqlJs.Database()`
  3. Generate ID
  4. Store in map with `modified: true` flag
  5. Export and write to file: `fs.writeFileSync(filePath, db.export())`
  6. Return success

#### **3. `db-close` (handle)**
- **Description:** Close database connection
- **Parameters:**
  - `dbId` (string)
- **Returns:** `{ success: true }`
- **Logic:**
  1. Look up database
  2. Call `db.close()`
  3. Remove from map

#### **4. `db-tables` (handle)**
- **Description:** Refresh table list for database
- **Parameters:**
  - `dbId` (string)
- **Returns:** `{ success: true, tables: [...] }`
- **Logic:** Query sqlite_master and return table list

#### **5. `db-table-schema` (handle)**
- **Description:** Get table schema (columns, types, indexes)
- **Parameters:**
  - `dbId` (string)
  - `tableName` (string)
- **Returns:**
  ```json
  {
    "success": true,
    "columns": [
      {
        "cid": 0,
        "name": "id",
        "type": "INTEGER",
        "notNull": true,
        "defaultValue": null,
        "primaryKey": true
      }
    ],
    "rowCount": 42,
    "indexes": [{ "name", "unique" }]
  }
  ```
- **Logic:**
  1. Query PRAGMA table_info to get columns
  2. Query COUNT(*) to get row count
  3. Query PRAGMA index_list to get indexes
  4. Return combined schema
- **SQL Injection Risk:**
  - Uses `tableName.replace(/"/g, '""')` to escape double quotes
  - Simple escape works for identifiers but requires quotes around name
  - Could be bypassed by table names containing `""` sequences

#### **6. `db-table-data` (handle)**
- **Description:** Paginated table data retrieval
- **Parameters:**
  - `dbId` (string)
  - `tableName` (string)
  - `offset` (number, default 0)
  - `limit` (number, default 100)
  - `orderBy` (string, optional)
  - `orderDir` (string, "ASC" or "DESC")
- **Returns:**
  ```json
  {
    "success": true,
    "columns": ["col1", "col2"],
    "rows": [{ "col1": value1, "col2": value2 }],
    "totalRows": 10000,
    "hasMore": true
  }
  ```
- **Logic:**
  1. Build SELECT query with sorting and pagination
  2. Convert result set to array of objects (column-keyed)
  3. Check if more rows exist
  4. Return paginated result
- **SQL Injection Risk:** Dangerous use of `orderBy` parameter:
  ```javascript
  const safeCol = orderBy.replace(/"/g, '""');
  sql += ` ORDER BY "${safeCol}" ${orderDir === 'DESC' ? 'DESC' : 'ASC'}`;
  ```
  - If `orderBy` is `"; DROP TABLE--`, escaping doesn't prevent injection
  - Need to validate that orderBy is a valid column name, not just escape quotes

#### **7. `db-query` (handle)**
- **Description:** Execute arbitrary SQL query
- **Parameters:**
  - `dbId` (string)
  - `sql` (string) - SQL query
- **Returns:**
  - Write ops: `{ success: true, type: 'write', rowsAffected, duration }`
  - Read ops: `{ success: true, type: 'read', columns, rows, rowCount, duration }`
- **Logic:**
  1. Detect if query is write operation using regex: `INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|PRAGMA (excluding table_info/index_list)`
  2. If write:
     - Run query with `db.run(sql)`
     - Get row count with `db.getRowsModified()`
     - Export and save to file immediately
  3. If read:
     - Execute query with `db.exec(sql)`
     - Convert results to object array
  4. Return result with execution time
- **CRITICAL SECURITY ISSUE:**
  - **Allows arbitrary SQL from untrusted user**
  - User can run `DROP TABLE users`, `DELETE FROM accounts`, etc.
  - No query validation, no parameterization
  - No restriction on which databases can be queried
  - **This is a complete database destruction/exfiltration vector**

#### **8. `db-ai-query` (handle)**
- **Description:** Generate SQL from natural language using LLM
- **Parameters:**
  - `dbId` (string)
  - `description` (string) - Natural language query
  - `cloudProvider` (string, optional)
  - `cloudModel` (string, optional)
- **Returns:** `{ success: true, sql: "<generated SQL>" }`
- **Logic:**
  1. Get schema from database
  2. Build prompt with schema and description
  3. Generate SQL query:
     - Try cloud provider first
     - Fall through to local LLM
     - Return error if both fail
  4. Clean up response:
     - Strip markdown fences `\`\`\`sql ... \`\`\``
  5. Return SQL string
- **Issues:**
  - Generated SQL passed directly to `db-query` handler (user controlled)
  - LLM might generate harmful SQL
  - No validation of generated query before returning
  - Schema context truncated at 8000 chars — schema might be incomplete

#### **9. `db-save` (handle)**
- **Description:** Save database to file
- **Parameters:**
  - `dbId` (string)
  - `filePath` (string, optional) - Save to different location
- **Returns:** `{ success: true, filePath }`
- **Logic:**
  1. Look up database
  2. Export to buffer: `db.export()`
  3. Write to file with fs.writeFileSync
  4. Return success

#### **10. `db-export-csv` (handle)**
- **Description:** Export query results to CSV
- **Parameters:**
  - `dbId` (string)
  - `sql` (string) - SELECT query
  - `outputPath` (string) - Output CSV file
- **Returns:** `{ success: true, filePath, rowCount }`
- **Logic:**
  1. Execute SQL query
  2. Build CSV:
     - Quote values if contains comma or quote or newline
     - Escape quotes by doubling: `"` → `""`
  3. Write to file
  4. Return success with row count

#### **11. `db-list-connections` (handle)**
- **Description:** List all open database connections
- **Parameters:** None
- **Returns:**
  ```json
  {
    "success": true,
    "connections": [
      {
        "id": "db_...",
        "filePath": "/path/to/db.sqlite",
        "type": "sqlite",
        "fileName": "db.sqlite"
      }
    ]
  }
  ```

### **Potential Issues & Vulnerabilities**

1. **CRITICAL: Arbitrary SQL Execution (db-query):**
   - No query validation or parameterization
   - User can drop tables, truncate data, steal entire database
   - Regex detection of write ops could be bypassed:
     - `PRAGMA quick_check` doesn't match pattern but could corrupt data
     - Comments and whitespace manipulation could evade detection
   - **Impact:** Complete database destruction capability

2. **SQL Injection in Table Names (db-table-schema, db-table-data):**
   - Simple quote escaping is insufficient
   - `tableName.replace(/"/g, '""')` doesn't prevent injection
   - Example: `order__" WHERE 1=0 ORDER BY (SELECT * FROM secrets)--`
   - Even with quotes, complex expressions could be injected

3. **Order By SQL Injection (db-table-data):**
   - `orderBy` parameter used directly in SQL
   - Simple quote escaping doesn't prevent injection
   - Should use a whitelist of valid column names instead

4. **No Parameterized Queries:**
   - All sql.js queries use string concatenation, not parameterized statements
   - sql.js might not support parameterized queries (WASM limitation)
   - Suggests this library isn't designed for untrusted user SQL

5. **Synchronous File I/O Blocks Event Loop:**
   - `fs.readFileSync` and `fs.writeFileSync` throughout
   - Large databases (100MB+) could freeze app for seconds
   - No async alternative explored

6. **Memory Leak in Open Databases:**
   - Databases stored in map but never automatically cleaned up
   - If user opens 1000 databases, all stay in memory
   - No LRU eviction or automatic cleanup

7. **WASM Memory Limit Not Handled:**
   - sql.js runs in WASM with limited address space (4GB theoretical, often <1GB per process)
   - Opening large database files could exceed WASM heap
   - No error handling for WASM memory exhaustion

8. **Race Condition: Concurrent DB Modifications:**
   - Multiple handlers can modify same database object concurrently
   - `db-query` (write) and `db-save` could execute simultaneously
   - `db.export()` called while another thread modifies database

9. **Auto-save After Every Write:**
   - Single-line INSERT writes entire database file to disk
   - Large database (500MB) written after each statement
   - Performance catastrophe on high insert volume

10. **No Transaction Support:**
    - Each write is immediately exported and written to file
    - If app crashes mid-write, no rollback capability
    - No ACID guarantees

11. **Duplicate ID Generation Possible:**
    - ID = `db_<timestamp>_<random>`
    - With high concurrency, two calls could generate same timestamp+random
    - Should use crypto.randomUUID instead

12. **Error Details Leaked in Responses:**
    - Malformed SQL returns raw error message, could leak schema info
    - Error messages might contain table names, column names, etc.

### **Edge Cases**

- Database file modified on disk while open in sql.js → inconsistent state
- Extremely large table (10M rows) → pagination might be slow
- CSV export with binary data → encoding issues
- Query that returns different result types (union) → error in result conversion

---

## **8. debugHandlers.js**

**File Location:** [main/ipc/debugHandlers.js](main/ipc/debugHandlers.js)

### **Purpose & Overview**
Thin wrapper around a debug service that implements Debug Adapter Protocol (DAP). Provides endpoints for starting debug sessions, controlling execution (step, continue, pause), setting breakpoints, inspecting variables/stack/scopes.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |

### **Context Dependencies**
- `ctx.debugService` - Debug service instance with:
  - `.setEventCallback(fn)` - Register callback for debug events
  - `.startSession(config)` - Start debug session
  - `.stopSession(sessionId)` - Stop session
  - `.setBreakpoints(sessionId, filePath, breakpoints)` - Set breakpoints
  - `.continue_(sessionId)` - Continue execution
  - `.stepOver(sessionId)` - Step over current statement
  - `.stepInto(sessionId)` - Step into function
  - `.stepOut(sessionId)` - Step out of function
  - `.pause(sessionId)` - Pause execution
  - `.getStackTrace(sessionId)` - Get call stack
  - `.getScopes(sessionId, frameId)` - Get variable scopes
  - `.getVariables(sessionId, variablesReference)` - Get variable values
  - `.evaluate(sessionId, expression, frameId)` - Evaluate expression
  - `.getAllSessions()` - Get active sessions
- `ctx.getMainWindow()` - Get renderer window for events

### **IPC Handlers** (12 total)

All handlers follow same error pattern:
1. Call debugService method with parameters
2. Return `{ success: true, ...result }` on success
3. Catch error and return `{ success: false, error: e.message }`

| Handler | Parameters | Returns | Notes |
|---------|-----------|---------|-------|
| `debug-start` | `config` | `{ success, ...result }` | Start debug session |
| `debug-stop` | `sessionId` | `{ success }` | Stop session |
| `debug-set-breakpoints` | `sessionId, filePath, breakpoints` | `{ success, breakpoints }` | Set BPs at locations |
| `debug-continue` | `sessionId` | `{ success }` | Resume execution |
| `debug-step-over` | `sessionId` | `{ success }` | Step over function |
| `debug-step-into` | `sessionId` | `{ success }` | Step into function |
| `debug-step-out` | `sessionId` | `{ success }` | Step out of function |
| `debug-pause` | `sessionId` | `{ success }` | Pause execution |
| `debug-stack-trace` | `sessionId` | `{ success, stackFrames }` | Get call stack |
| `debug-scopes` | `sessionId, frameId` | `{ success, scopes }` | Get local/closure/global scopes |
| `debug-variables` | `sessionId, variablesReference` | `{ success, variables }` | Get variable values |
| `debug-evaluate` | `sessionId, expression, frameId` | `{ success, ...result }` | Evaluate expression at frame |
| `debug-get-sessions` | None | `{ sessions }` | Get active debug sessions |

#### **Event Callback Setup:**
```javascript
ctx.debugService.setEventCallback((event) => {
  const win = ctx.getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('debug-event', event);
  }
});
```
- Forwards debug service events to renderer as `'debug-event'` IPC messages
- Checks window existence before sending

### **Potential Issues**

1. **Window Destruction Race Condition:**
   - Between `ctx.getMainWindow()` and `win.webContents.send()`, window could be destroyed
   - Check fires, but window destroyed before send
   - Event listener code could throw if accessing destroyed window

2. **Error Handling Too Broad:**
   - All errors caught with generic `e.message`
   - Different error types (authentication, timeout, invalid session) all return same format
   - Renderer can't distinguish between temporary vs permanent failures

3. **No Session Validation:**
   - `sessionId` parameter passed directly to debug service
   - No check that session exists before operations
   - Invalid session ID returns error but no error context

4. **No Timeout on Debugging Operations:**
   - Breakpoint setting, stepping, variable inspection all lack timeout
   - Debugged process could hang, leaving debug handler blocked indefinitely
   - Renderer never notified of timeout

5. **Breakpoint File Path Not Validated:**
   - `filePath` parameter passed directly to debug service
   - Could be outside project root or symlink
   - No path normalization

6. **evaluate Handler Accepts Arbitrary Expression:**
   - `expression` parameter not validated
   - Could execute arbitrary code in debugged process
   - Security concern if debugged process untrusted

7. **Stack Trace Could Be Very Large:**
   - Deep recursion produces massive stack trace
   - Returned in full to renderer without pagination
   - Could cause performance issues

8. **Variable Values Not Truncated:**
   - Very large object inspections returned in full
   - Huge string variables sent back to renderer
   - No limit on response size

### **Edge Cases**

- Start session with empty config object → behavior depends on debugService
- Continue on paused session that's already running → error or no-op
- Get stack trace on non-existent frameId → error
- Evaluate expression with syntax error → error vs evaluation error distinction lost
- Stop session that's already stopped → error

---

## **9. dialogHandlers.js**

**File Location:** [main/ipc/dialogHandlers.js](main/ipc/dialogHandlers.js)

### **Purpose & Overview**
Thin wrapper around Electron dialog APIs for file/folder selection and message boxes. Also provides secure external URL opening with protocol validation.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |
| `electron.dialog` | Dialog APIs | File/folder/message dialogs |
| `electron.shell` | Shell operations | Opening URLs and folders |

### **Context Dependencies**
- `ctx.getMainWindow()` - Get main window for dialog parent

### **IPC Handlers** (6 total)

#### **1. `show-save-dialog` (handle)**
- **Parameters:** `options` (save dialog options)
- **Returns:** Promise result from `dialog.showSaveDialog()`
- **Logic:** Pass options through to Electron API

#### **2. `show-open-dialog` (handle)**
- **Parameters:** `options` (open dialog options)
- **Returns:** Promise result from `dialog.showOpenDialog()`
- **Logic:** Pass options through to Electron API

#### **3. `show-message-box` (handle)**
- **Parameters:** `options` (message box options)
- **Returns:** Promise result from `dialog.showMessageBox()`
- **Logic:** Pass options through to Electron API

#### **4. `open-external` (handle)**
- **Description:** Open external URL in default browser
- **Parameters:**
  - `url` (string)
- **Returns:** Result of `shell.openExternal()`
- **Logic Flow:**
  1. Validate URL exists and is string
  2. Parse URL to get protocol
  3. Check protocol is `http:` or `https:`
  4. If not, log warning and return (silently block)
  5. Call `shell.openExternal(url)`
- **Security:** Protocol whitelist prevents:
  - `file://` URLs (local file access)
  - `data:` URLs (data URIs)
  - `javascript:` (code execution)
  - `ftp://` (FTP protocol)

#### **5. `reveal-in-explorer` (handle)**
- **Description:** Open containing folder in file explorer
- **Parameters:**
  - `filePath` (string)
- **Returns:** Result of `shell.showItemInFolder()`
- **Logic:**
  1. Validate filePath exists and is string
  2. Call `shell.showItemInFolder(filePath)`

#### **6. `open-containing-folder` (handle)**
- **Description:** Open a folder in file explorer
- **Parameters:**
  - `folderPath` (string)
- **Returns:** Result of `shell.openPath()`
- **Logic:**
  1. Validate folderPath exists and is string
  2. Call `shell.openPath(folderPath)`

### **Potential Issues**

1. **Silent Failure on Protocol Validation:**
   - `open-external` with non-http(s) URL logs warning but returns nothing
   - Renderer doesn't know if URL was blocked or succeeded
   - Could appear to user as broken functionality

2. **No Symlink Resolution:**
   - `reveal-in-explorer` and `open-containing-folder` don't resolve symlinks
   - Could expose symlink targets unintentionally

3. **Path Traversal Not Prevented:**
   - `filePath` parameters not validated to be within safe directory
   - Could use `../../../etc/passwd` to reveal arbitrary files
   - No realpath normalization

4. **Dialog Options Not Validated:**
   - `show-save-dialog` and others accept arbitrary options
   - Could accept `defaultPath: '/etc/passwd'` or other malicious paths
   - No validation of option keys or values

5. **URL Protocol Parsing Fragile:**
   - Uses `new URL(url).protocol`
   - Could throw if URL is malformed
   - Not wrapped in try-catch

6. **Empty String Handling:**
   - Checks `!url` but empty string after parsing could still cause issues
   - `typeof url !== 'string'` check could be more specific

### **Security Considerations**

- `open-external` with `http://` and `https://` protocol whitelist is good
- No SSRF protection (could open URLs to internal services), but acceptable for user-initiated
- Dialog APIs are safe — Electron handles security

### **Edge Cases**

- `open-external` with URL like `http://localhost:3000` — allowed (internal but user likely aware)
- `open-external` with URL like `http://` (no host) — might throw or open default page
- Symlink loop in `reveal-in-explorer` — doesn't resolve cycles
- Very long path names (>260 chars on Windows) might fail silently

---

## **10. docsHandlers.js**

**File Location:** [main/ipc/docsHandlers.js](main/ipc/docsHandlers.js)

### **Purpose & Overview**
AI-powered documentation generation for projects. Supports generating file-level JSDoc, project README, API documentation, architecture diagrams (Mermaid), and codebase overviews.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |
| `path` | Path utilities | File path operations |
| `fs` (sync) | Synchronous file I/O | Reading files for analysis |

### **Constants**

**SKIP_DIRS** - Set of directories to skip during project scanning:
- `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `__pycache__`
- Virtual environments: `.venv`, `venv`, `env`
- Build artifacts: `target`, `bin`, `obj`
- Cache: `.cache`, `.parcel-cache`, `.turbo`, `.mypy_cache`, `coverage`

### **Utility Functions**

#### **collectProjectFiles(rootPath, maxFiles = 500)**
- Recursively walks directory tree
- Skips `SKIP_DIRS` and hidden directories (starting with `.`)
- Max depth: 10 levels
- Returns array of files with `path`, `relative`, `ext`, `name`
- Stops at `maxFiles` limit
- No async operations

#### **detectProjectType(files, rootPath)**
- Scans for package configuration files to detect project type
- Returns array of types:
  - **Package managers:** `node`, `python`, `rust`, `go`, `java`, `docker`
  - **Frameworks:** `typescript`, `nextjs`, `react`, `vue`, `svelte`, `vite`
- Based on file extensions and known config file names

### **IPC Handlers**

#### **1. `docs-generate-file` (handle)**
- **Description:** Generate JSDoc/docstring documentation for a single file
- **Parameters:**
  - `params.filePath` (string) - File to document
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
  - `params.style` (string, optional) - Doc style (auto/jsdoc/docstring/rustdoc/godoc/javadoc)
- **Returns:** `{ success: true, documentedCode, filePath, docStyle, truncated }`
- **Logic Flow:**
  1. Resolve file path, check exists
  2. Read file content (sync)
  3. Detect file extension
  4. Auto-detect doc style based on extension if not specified
  5. Truncate to 12,000 chars if needed
  6. Build prompt asking LLM to add docs to all functions/classes
  7. Generate:
     - Try cloud provider first
     - Fall through to local LLM
     - Fall through to cloud again (redundant)
  8. Strip markdown fences from response
  9. Return documented code
- **Fallthrough Logic Issue:**
  - First tries cloud with cloudProvider + cloudModel
  - Then tries `ctx.llmEngine.generate()` (no arguments for provider selection)
  - Then tries cloud again (same as first attempt)
  - Third fallback is redundantly identical to first

#### **2. `docs-generate-readme` (handle)**
- **Description:** Generate professional README.md for project
- **Parameters:**
  - `params.rootPath` (string, optional - defaults to current project)
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, readme, projectName, projectTypes }`
- **Logic Flow:**
  1. Collect up to 300 project files
  2. Detect project types (node, python, etc.)
  3. Read `package.json` if exists (first 2000 chars)
  4. Read existing README if exists (first 3000 chars)
  5. Build directory tree from collected files
  6. Generate README prompt with all context
  7. Generate via cloud or local LLM
  8. Return markdown

#### **3. `docs-generate-api` (handle)**
- **Description:** Generate API documentation from route files (Express, FastAPI, etc.)
- **Parameters:**
  - `params.rootPath` (string, optional)
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, apiDocs, routeFilesFound }`
- **Logic Flow:**
  1. Collect up to 500 project files
  2. Search for route files matching patterns:
     - `app.get()`, `app.post()`, `router.get()` (Express)
     - `@app.route()`, `@app.get()` (Flask/FastAPI Python)
     - `router.add_api_route()` (FastAPI)
     - Words: `FastAPI`, `APIRouter`, `express.Router`
  3. Load first 20 matching files (first 8000 chars each)
  4. Build route context with all route file contents
  5. Generate API documentation prompt
  6. Return Markdown documentation

#### **4. `docs-generate-architecture` (handle)**
- **Description:** Generate architecture diagrams in Mermaid format
- **Parameters:**
  - `params.rootPath` (string, optional)
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, markdown, mermaidDiagrams: [...], projectName, projectTypes }`
- **Logic Flow:**
  1. Collect up to 200 files
  2. Detect project types
  3. Group files by directory
  4. Find entry points (index.js, main.ts, App.tsx, app.py, etc.)
  5. Read first 5 entry files (first 3000 chars each)
  6. Build prompt asking for Component AND Layer diagrams in Mermaid
  7. Generate markdown with mermaid blocks
  8. Extract mermaid blocks using regex: `/\`\`\`mermaid\n([\s\S]*?)\`\`\`/g`
  9. Return markdown and extracted diagrams

#### **5. `docs-explain-codebase` (handle)**
- **Description:** Generate comprehensive codebase overview
- **Parameters:**
  - `params.rootPath` (string, optional)
  - `params.cloudProvider` (string, optional)
  - `params.cloudModel` (string, optional)
- **Returns:** `{ success: true, overview, projectName, projectTypes, fileCount }`
- **Logic Flow:**
  1. Collect up to 300 files
  2. Detect project types
  3. Read key files (package.json, README.md, requirements.txt, etc.)
  4. Generate comprehensive prompt asking for:
     - What is this project
     - Tech stack
     - Architecture & patterns
     - Key components
     - Data flow
     - Getting started
     - Common patterns
  5. Generate via cloud or local LLM
  6. Return markdown

### **Potential Issues**

1. **Synchronous File I/O Blocks Event Loop:**
   - `fs.readdirSync`, `fs.readFileSync` throughout
   - Walking 200+ files and reading each could freeze app for seconds
   - Project scanning not async

2. **Large File Context Not Truncated:**
   - Each route file loaded up to 8000 chars
   - 20 route files × 8000 chars = 160KB just for route context
   - Total prompt could exceed model context window

3. **Redundant Cloud Fallback:**
   - Pattern repeats across handlers:
     ```javascript
     if (cloudProvider && ctx.cloudLLM) { /* try */ }
     if (!result && ctx.llmEngine) { /* try */ }
     if (!result && ctx.cloudLLM) { /* try again */ } // REDUNDANT
     ```
   - Third fallback repeats first attempt with same parameters

4. **Mermaid Extraction Could Fail:**
   - Regex extracts content between ``` markers
   - If LLM outputs invalid syntax, regex fails silently
   - Returns empty diagrams array without error

5. **Directory Walk Depth Limited to 10:**
   - Deep nested monorepos (>10 levels) not fully explored
   - Could miss important source files

6. **No Caching of Project Analysis:**
   - Scanning 300 files on every docs generation request
   - If called twice in a row, rescans entire project
   - No memoization

7. **Extension Detection Case Sensitive:**
   - `.Ts` and `.TS` might not be recognized as TypeScript
   - Should normalize to lowercase

8. **LLM Hallucination in Generated Docs:**
   - LLM might invent non-existent directories, files, or services
   - Generated documentation could be misleading
   - No verification that generated docs match actual codebase

### **Edge Cases**

- Project with 0 files → empty tree, LLM still tries to generate docs
- All files in SKIP_DIRS → empty file list
- Entry point file is binary (e.g., compiled Go binary) → crash on read
- README.md editing mode (VS Code temp file) → included in context
- `.git/config` symlink → might not be skipped properly

---

## **11. editorHandlers.js**

**File Location:** [main/ipc/editorHandlers.js](main/ipc/editorHandlers.js)

### **Purpose & Overview**
Advanced editor features using local/cloud LLM: inline code editing, next edit prediction, terminal suggestions, code actions (explain, refactor, fix, add tests, optimize, add comments, add types), and token estimation.

### **Imports & Dependencies**

| Import | Purpose | Used For |
|--------|---------|----------|
| `electron.ipcMain` | IPC registration | Handler registration |

### **IPC Handlers**

#### **1. `inline-edit` (handle)**
- **Description:** Edit selected or surrounding code with instruction
- **Parameters:**
  - `params.filePath` (string)
  - `params.selectedText` (string, optional) - Selected code
  - `params.cursorLine` (number, optional)
  - `params.instruction` (string) - What to change
  - `params.surrounding` (string, optional) - Code around cursor if no selection
  - `params.cloudProvider`, `params.cloudModel` (optional)
- **Returns:** `{ success: true, code: '<edited code>' }`
- **Logic:**
  1. Build prompt showing selected or surrounding code
  2. Include instruction
  3. Ask LLM to output ONLY replacement code (no markdown)
  4. Generate with lower temperature (0.3) for precision
  5. Return trimmed code
  6. Try cloud first (if provider+model), then local, then fail
- **Issues:**
  - No validation that selectedText/surrounding actually come from the file
  - Returned code assumed to be correct without verification

#### **2. `next-edit-suggestion` (handle)**
- **Description:** Predict user's next edit based on recent edit
- **Parameters:**
  - `params.filePath` (string)
  - `params.fileContent` (string)
  - `params.recentEdit` (string) - Description of what user just edited
  - `params.cursorLine` (number)
  - `params.cloudProvider`, `params.cloudModel` (optional)
- **Returns:** `{ success: true, suggestion: { line, oldText, newText } }`
- **Logic Flow:**
  1. Split file into lines
  2. Extract context window:
     - 80 lines before cursor
     - 40 lines after cursor
  3. Build FIM (Fill-in-Middle) style prompt
  4. Ask LLM to predict single most likely next edit
  5. Request JSON output
  6. Parse JSON and extract first object
  7. Validate JSON has line > 0 and newText
  8. Return success if found, else fail
- **Prediction Logic Notes:**
  - Temperature 0.2 (very low) for deterministic prediction
  - Regex extracts first JSON object: `/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/`
  - Handles nested braces but could match partial objects

#### **3. `terminal-suggest` (handle)**
- **Description:** Suggest terminal commands based on partial input
- **Parameters:**
  - `params.partialCommand` (string) - Partial command typed
  - `params.cwd` (string, optional) - Current working directory
  - `params.recentCommands` (array, optional) - Recently executed commands
- **Returns:** `{ success: true, suggestions: [ { command, description }, ... ] }`
- **Logic:**
  1. Build prompt with context (cwd, recent commands)
  2. Ask LLM for up to 5 completion suggestions
  3. Request JSON array format
  4. Parse JSON array
  5. Return first 5 suggestions
  6. Silently fail if no suggestions found (returns `{ success: true, suggestions: [] }`)

#### **4. `estimate-tokens` (handle)**
- **Description:** Quick token count estimation
- **Parameters:**
  - `text` (string)
- **Returns:** `{ tokens: <count> }`
- **Logic:** Simple heuristic: `Math.ceil(text.length / 4)` (rough approximation)
- **Notes:**
  - Not LLM-specific — ignores which model being used
  - Approximation might be off by 50% for complex text

#### **5. `get-context-usage` (handle)**
- **Description:** Get model's context window size
- **Parameters:** None
- **Returns:** `{ contextSize: <tokens>, modelName: '<name>' }`
- **Logic:** Query llmEngine status for model info

#### **6. `code-action` (handle)**
- **Description:** Perform AI code action (explain, refactor, fix, test, optimize, comments, types)
- **Parameters:**
  - `params.action` (string) - One of: explain, refactor, fix, add-tests, optimize, add-comments, add-types
  - `params.filePath` (string)
  - `params.selectedText` (string, optional)
  - `params.fileContent` (string, optional)
  - `params.cursorLine` (number, optional)
  - `params.language` (string, optional) - Language hint
  - `params.cloudProvider`, `params.cloudModel` (optional)
- **Returns:** `{ success: true, result: '<action result>' }`
- **Logic Flow:**
  1. Check that selectedText or fileContent provided
  2. Use selectedText if available, else first 6000 chars of file
  3. Detect if action is `explain` (different from code-returning actions)
  4. Build action-specific prompt:
     - **explain:** Ask for clear explanation
     - **refactor:** Ask to improve while preserving function
     - **fix:** Find and fix all bugs
     - **add-tests:** Write comprehensive tests
     - **optimize:** Optimize for performance
     - **add-comments:** Add clear comments and docs
     - **add-types:** Add TypeScript type annotations
  5. Select system prompt:
     - `explain` → "You are a senior code reviewer"
     - Others → "You are a precise code editor"
  6. Generate:
     - Try cloud first (if provider+model)
     - Fall back to local LLM
     - Fall through to cloud with defaults (if original cloud call skipped)
  7. Post-process:
     - If not explanation, strip markdown fences
  8. Return result

- **Prompt Templates All Use Same Phrasing:**
  - "Respond with ONLY..." or "Return ONLY..."
  - But different actions expected different output formats
  - Not clear if LLM will follow all instructions equally well

### **Potential Issues & Design Concerns**

1. **Token Estimation Very Inaccurate:**
   - `/ 4` is rough guess for English prose
   - Code usually has fewer tokens per character than prose
   - Model-specific tokenization ignored
   - Example: keywords like `async`, `await` might tokenize differently

2. **Inline Edit No Validation:**
   - LLM returns code, assumed correct
   - Could return broken syntax, incomplete code
   - No parse/compile check before returning

3. **FIM Prompt Might Confuse LLM:**
   - Fill-in-Middle prompting non-standard
   - Some models don't understand this pattern as well as direct prompts
   - Prediction accuracy depends heavily on model

4. **Next Edit Prediction Low Confidence:**
   - Returns success only if line > 0 AND newText exists
   - Silent fail otherwise (returns `{ success: false }`)
   - Renderer never knows if prediction was unconfident vs actually failed

5. **JSON Extraction Too Greedy Again:**
   - `next-edit-suggestion` uses regex: `/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/`
   - Handles nested braces but could match partial suggestions if LLM outputs multiple

6. **Cloud Fallback Logic Confusing:**
   - `code-action` handler:
     ```javascript
     if (isCloud) {
       result = await ctx.cloudLLM.generate(...);
     } else if (ctx.llmEngine.isReady) {
       result = await ctx.llmEngine.generate(...);
     } else {
       try {
         result = await ctx.cloudLLM.generate(...); // fallback
       } catch {
         return error;
       }
     }
     ```
   - If cloud provider/model provided but local engine broken → uses local (wrong branch)
   - If neither cloud + config nor local ready → finally tries cloud (inconsistent)

7. **Error Handling in Terminal Suggest:**
   - Fails silently and returns empty suggestions array
   - Renderer never knows if failure was deliberate or error

8. **No Rate Limiting on Code Actions:**
   - User could spam 1000 `code-action` requests
   - Each makes LLM call
   - No throttling or request queue

9. **Language Hint Not Used Consistently:**
   - Passed in params but only used in prompt string hint
   - Not used for syntax validation of generated code

10. **Code Action System Prompt Selection:**
    - Explanation vs code generation uses different system prompts
    - But both use same base prompt template
    - Could conflict

### **Edge Cases**

- `inline-edit` with empty selectedText → prompt says "Selected code" but text is empty
- `next-edit-suggestion` with cursorLine at end of file → suffix will be empty
- `code-action` with `selectedText` and `fileContent` both provided → selectedText used, other ignored
- Very long partial command in `terminal-suggest` → LLM confusion or timeout
- `estimate-tokens` with 0 length text → returns 0 (correct)
- `code-action` with unknown action name → returns error "Unknown action"

---

## **CROSS-FILE ISSUES & PATTERNS**

### **Pattern 1: Redundant Fallback Chains**
Multiple files implement cloud→local→cloud pattern:
- **codeReviewHandlers.js** - Lines for code-review-file, code-review-staged, code-review-diff, code-review-apply-fix
- **docsHandlers.js** - Lines for docs-generate-file, docs-generate-readme, docs-generate-api, docs-generate-architecture
- **editorHandlers.js** - Lines for code-action

All follow this pattern:
```javascript
if (cloudProvider && ctx.cloudLLM) { /* try cloud */ }
if (!result && ctx.llmEngine) { /* try local */ }
if (!result && ctx.cloudLLM) { /* try cloud AGAIN - REDUNDANT */ }
```

**Fix:** Remove third fallback or use different strategy (e.g., OpenRouter as fallback)

### **Pattern 2: JSON Extraction with Greedy Regex**
Used in:
- **codeReviewHandlers.js** - All handlers
- **databaseHandlers.js** - db-ai-query
- **editorHandlers.js** - next-edit-suggestion, terminal-suggest

All use variants of:
```javascript
const jsonMatch = response.match(/\[[\s\S]*\]/);
```

**Risk:** If LLM outputs multiple JSON objects or arrays, regex captures everything between first `[` and last `]`

**Fix:** Use proper JSON parser or limit regex to single object

### **Pattern 3: Synchronous File I/O**
Blocks event loop:
- **benchmarkHandlers.js** - fs.readFileSync, fs.writeFileSync
- **cloudLlmHandlers.js** - fs.readFileSync, fs.writeFileSync in set-key
- **codeReviewHandlers.js** - fs.readFileSync, fs.writeFileSync
- **databaseHandlers.js** - fs.readFileSync, fs.writeFileSync throughout
- **docsHandlers.js** - fs.readdirSync, fs.readFileSync in project scanning
- **editorHandlers.js** - None (good)

**Impact:** Large files or slow filesystems could freeze app for seconds

**Fix:** Use async fs.promises or worker threads

### **Pattern 4: No Window Destruction Validation in Event Sends**
- **agentHandlers.js** - `ctx.mainWindow.webContents.send()` without checks (though getMainWindow checks are there)
- **collabHandlers.js** - `ctx.mainWindow.webContents.send()` without checks
- **debugHandlers.js** - `win.webContents.send()` with window destroyed check (good example)
- **docsHandlers.js** - Doesn't send events, OK

**Risk:** Window could be destroyed between check and send

### **Pattern 5: No Query Parameterization**
All SQL operations in **databaseHandlers.js** use string concatenation, not parameterized queries

**Risk:** SQL injection if table names or columns provided by untrusted source

### **Pattern 6: Incomplete Error Classification**
- **cloudLlmHandlers.js** - classifyError function
- Other handlers - Generic error returns

**Better approach:** Consistent error taxonomy across all handlers

### **Pattern 7: Module-Level Mutable State**
- **agentHandlers.js** - `nextAgentId`, `backgroundAgents` Map
- **collabHandlers.js** - `collabServer`, `collabClients`, `collabDoc`, `hostSession` — ESPECIALLY PROBLEMATIC

**Risk:** Race conditions if handlers called concurrently

---

## **SUMMARY TABLE: SEVERITY RATING**

| File | Critical Issues | High Priority | Medium Priority | Low Priority | Notes |
|------|-----------------|----------------|-----------------|--------------|-------|
| agentHandlers.js | 2 | 3 | 2 | 1 | Memory leak in agent storage, no timeout on generation |
| benchmarkHandlers.js | 0 | 1 | 2 | 2 | Timestamp collision risk, no file locking |
| browserHandlers.js | 1 | 2 | 2 | 1 | No error handling on async handlers |
| cloudLlmHandlers.js | 0 | 2 | 3 | 2 | Silent failures in config write, token streaming no error handling |
| codeReviewHandlers.js | 1 | 2 | 3 | 2 | File overwrite without backup in apply-fix, JSON extraction greedy |
| collabHandlers.js | 3 | 4 | 3 | 2 | **MOST CRITICAL** — No ACID, race conditions, no conflict resolution, password in plain text |
| databaseHandlers.js | 3 | 5 | 4 | 2 | **CRITICAL** — Arbitrary SQL execution, SQL injection in table names |
| debugHandlers.js | 1 | 2 | 1 | 2 | Could evaluate arbitrary expressions in debugged process |
| dialogHandlers.js | 1 | 1 | 1 | 1 | URL protocol whitelist good, but path traversal not prevented |
| docsHandlers.js | 0 | 2 | 3 | 3 | Sync file I/O blocks event loop, LLM hallucination risk |
| editorHandlers.js | 0 | 1 | 3 | 2 | Inaccurate token estimation, no code validation on inline-edit |

---

## **RECOMMENDATIONS — PRIORITY ORDER**

### **TIER 1 — FIX IMMEDIATELY**
1. **databaseHandlers.js - db-query:** Disable arbitrary SQL or add strict whitelist (SELECT-only, no writes, no system tables)
2. **collabHandlers.js - Global state race conditions:** Implement session isolation, atomic operations, file-based locking for concurrent hosts
3. **codeReviewHandlers.js - code-review-apply-fix:** Add backup/diff preview before overwriting files
4. **databaseHandlers.js - SQL injection:** Use parameterized queries or strict column name validation

### **TIER 2 — FIX SOON**
5. **agentHandlers.js - Memory leak:** Implement automatic cleanup of completed agents (TTL or event-based)
6. **collabHandlers.js - LWW conflict resolution:** Implement CRD T or version-based conflict resolution for concurrent edits
7. **browserHandlers.js - Async handlers:** Add try-catch to all async handlers
8. **cloudLlmHandlers.js - Silent config write failures:** Return error field and log properly

### **TIER 3 — REFACTOR**
9. **All files - Sync file I/O:** Migrate to async fs.promises
10. **All files - JSON extraction:** Replace greedy regex with proper JSON parsing
11. **All files - Redundant fallback chains:** Consolidate to single strategy
12. **All files - Error classification:** Implement consistent error taxonomy

---

**END OF AUDIT REPORT**

---

## Part 8c — Plugin, Profiler, RAG, RestClient, SmartSearch, SSH, Template, Terminal, TodoTree, Utility

Perfect! I've read all 10 IPC handler files completely. Now I'll create a comprehensive detailed audit document with all the requested information.

---

# COMPREHENSIVE IPC HANDLERS AUDIT REPORT
**guIDE IDE — IPC Handler Analysis**  
Generated: March 13, 2026

---

## OVERVIEW

This audit analyzes 10 critical IPC handler modules that manage inter-process communication between the Electron main process and renderer process. These handlers control: plugins, profiling, RAG/search, REST requests, code navigation, SSH connections, project scaffolding, terminal management, TODO scanning, and system utilities.

**Total Handlers Examined:** 10 modules  
**Estimated Total IPC Channels:** ~80+ registered handlers  
**Risk Level:** MEDIUM-HIGH (Several handlers interact with external systems, manage state, and have incomplete validation)

---

## FILE 1: pluginHandlers.js

### 1. FILE PURPOSE AND OVERVIEW
Manages guIDE's plugin/extension system. Provides plugin marketplace listing, installation, uninstallation, enablement/disablement, and plugin registry management. Includes a hardcoded marketplace of 10 default plugins with categories, ratings, and download counts. Plugin data persists to `~/.guide-ide/plugin-registry.json`.

**Key Features:**
- Plugin marketplace browsing with search and category filtering
- Plugin installation with manifest generation
- Plugin lifecycle management (enable/disable)
- Registry persistence to `.guide-ide` directory
- Placeholder plugin project scaffolding

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register all IPC handlers |
| `path` | File path joining and directory operations |
| `fs` | Synchronous file I/O (read, write, check existence) |
| `os` | Home directory detection via `os.homedir()` |
| `child_process:exec` | (Imported but **NEVER USED** in this file) |

**Unused Import:** `exec` from `child_process` is imported but never referenced anywhere in the module. **POTENTIAL BUG:** Dead code that should be removed.

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `plugin-marketplace`
- **Parameters:** `params` object with optional `search` (string) and `category` (string)
- **Return:** `{ success: true, plugins: array }` or `{ success: false, error: string }`
- **Logic:**
  - Filters `MARKETPLACE` hardcoded array
  - Case-insensitive search across name, description, category
  - Category filtering if provided and not 'all'
  - Returns filtered results
- **Issues:**
  - No pagination — returns all matches at once (no problem with 10 default plugins, but scales poorly if marketplace grows)
  - Search does substring matching, not semantic search
  - Returns raw MARKETPLACE objects without validation

#### Handler 2: `plugin-list-installed`
- **Parameters:** None
- **Return:** `{ success: true, plugins: array }` or `{ success: false, error: string }`
- **Logic:**
  - Loads registry from disk
  - Returns `reg.plugins` array directly
- **Issues:**
  - No error recovery if registry JSON is corrupted
  - Returns raw registry data without sanitization

#### Handler 3: `plugin-install`
- **Parameters:** `pluginId` (string)
- **Return:** `{ success: true, plugin: object }` or `{ success: false, error: string }`
- **Logic:**
  1. Looks up plugin in `MARKETPLACE` by ID
  2. Checks if already installed (duplicate check)
  3. Creates plugin directory: `~/.guide-ide/plugins/{pluginId}`
  4. Writes `manifest.json` with plugin metadata + `installedAt` timestamp + `enabled: true`
  5. Generates placeholder `main.js` with stub activate/deactivate functions
  6. Updates registry file
- **Issues:**
  - **RACE CONDITION:** Two simultaneous install requests for same plugin ID could both pass the duplicate check and create two entries
  - **Incomplete validation:** Doesn't validate `pluginId` format (could contain path traversal like `../../../etc/passwd`)
  - **No rollback:** If registry write fails, plugin directory is left orphaned
  - **Hardcoded plugin list only:** Can only install from MARKETPLACE, not external sources

#### Handler 4: `plugin-uninstall`
- **Parameters:** `pluginId` (string)
- **Return:** `{ success: true }` or `{ success: false, error: string }`
- **Logic:**
  1. Loads registry
  2. Removes plugin from `reg.plugins` array by ID
  3. Saves updated registry
  4. Deletes plugin directory recursively
- **Issues:**
  - **RACE CONDITION:** Between loading registry and saving, another process could modify it — last-write-wins bug
  - **No validation of pluginId**
  - **Deletes directory AFTER registry update** — if directory deletion fails, registry is already modified
  - **Data loss potential:** `fs.rmSync(..., { recursive: true, force: true })` could delete important files if plugin path is wrong

#### Handler 5: `plugin-toggle`
- **Parameters:** `pluginId` (string), `enabled` (boolean)
- **Return:** `{ success: true, plugin: object }` or `{ success: false, error: string }`
- **Logic:**
  1. Loads registry
  2. Finds plugin by ID
  3. Sets `plugin.enabled` property
  4. Saves registry
- **Issues:**
  - **RACE CONDITION:** Multiple toggles could race
  - **No validation** of parameters
  - **Doesn't check if plugin actually exists before mutation**

#### Handler 6: `plugin-get-details`
- **Parameters:** `pluginId` (string)
- **Return:** `{ success: true, plugin: object|null, installed: boolean, enabled: boolean }`
- **Logic:**
  1. Searches MARKETPLACE for plugin
  2. Searches installed registry for plugin
  3. Returns both results + installation state + enabled state
- **Issues:**
  - No edge case handling if plugin appears in neither marketplace nor registry
  - Returns `null` for plugin if not found — could confuse frontend

#### Handler 7: `plugin-categories`
- **Parameters:** None
- **Return:** `{ success: true, categories: array }`
- **Logic:**
  - Extracts unique categories from MARKETPLACE
  - Sorts alphabetically
  - Prepends 'all' as first category
- **No issues** — simple, safe operation

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| Unused import `exec` | LOW | Dead code should be removed |
| Path traversal in IDs | HIGH | `pluginId` not validated — could escape `~/.guide-ide/plugins/` with `../../etc/passwd` |
| **CRITICAL RACE CONDITION** | CRITICAL | Registry read-modify-write pattern without atomicity. If two handlers modify registry simultaneously, last-write-wins — data loss |
| Missing rollback on install failure | MEDIUM | Directory created but registry write fails → orphaned directory, corrupted state |
| No concurrent modification detection | MEDIUM | Registry could be modified on disk during handler execution — no locking |
| Unvalidated pluginId parameter | HIGH | Could contain null bytes, path separators, special characters |
| Directory deletion safety | CRITICAL | `fs.rmSync(...recursive: true)` with unsanitized path is dangerous |
| No plugin validation | MEDIUM | Can install/enable any plugin without checking manifest validity |
| Manifest not validated after writing | MEDIUM | Could be corrupted on disk but not detected until usage |
| No cleanup on partial failures | MEDIUM | If manifest write succeeds but main.js write fails, state is inconsistent |

### 5. DEPENDENCIES ON OTHER MODULES

- **Implicit dependency on file system naming conventions:** Expects `~/.guide-ide/plugins/` and `~/.guide-ide/plugin-registry.json` to exist as working directories
- **No dependency on other modules in `ctx`** — standalone implementation
- **Potential frontend dependency:** UI likely sends handlers to manage plugins; if UI sends invalid plugin IDs, main process will fail

---

## FILE 2: profilerHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Implements performance profiling and diagnostics. Supports:
- Node.js script profiling with V8 CPU profiler
- Python script profiling with cProfile
- Command timing benchmarks (multiple iterations)
- Memory snapshot capture
- AI-powered profile analysis (uses LLM)
- Active session management

Profiling sessions are tracked in a `Map` with timeout cleanup.

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handlers |
| `path` | Resolve script paths |
| `fs` | Check file existence, read/cleanup profile files |
| `child_process:exec, spawn` | Execute Node/Python scripts, capture output |
| `os` | Temp directory, CPU/memory info |

All imports are used appropriately.

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `profiler-run-node`
- **Parameters:** `{ scriptPath, args = [], cwd }`
- **Return:** `{ success: true, sessionId, scriptPath, duration, exitCode, stdout, stderr, profile }`
- **Logic:**
  1. Validates script exists
  2. Creates unique session ID
  3. Spawns Node.js with `--cpu-prof` flag to generate V8 profile
  4. Captures stdout/stderr during execution (max 5000 stdout, 2000 stderr)
  5. On spawn error, falls back to plain `exec` with timing only
  6. Looks for `.cpuprofile` files in temp directory, parses, cleans up
  7. Returns profile data + execution metrics
  8. Auto-kills after 65 seconds timeout
- **Issues:**
  - **Overly complex fallback logic:** Tries to detect process.execPath, replaces with 'node' — fragile
  - **CPU profile file discovery is unreliable:** Looks for most recent `.cpuprofile` in tmpdir — could match wrong profile if other processes are profiling
  - **Stdout/stderr truncation:** Silently drops output after limits — user doesn't know data was lost
  - **Session cleanup:** 65-second timeout only AFTER execution finishes — if process hangs in execution, timeout won't fire until execution completes
  - **No input validation:** `scriptPath` not checked if it's executable/safe
  - **No environment variable scope:** Uses `{ ...process.env, NODE_ENV: 'production' }` — modifies global env

#### Handler 2: `profiler-run-python`
- **Parameters:** `{ scriptPath, args = [], cwd }`
- **Return:** `{ success: true, sessionId, scriptPath, duration, exitCode, stdout, stderr, profile }`
- **Logic:**
  1. Validates script exists
  2. Builds Python cProfile command that:
     - Imports cProfile, pstats, io, json, time
     - Executes script in exec()
     - Captures timing, generates stats
     - Outputs custom JSON with top 100 functions by cumTime
  3. Wraps command in backticks and passes to exec
  4. Parses JSON output from `__PROFILE_JSON__` marker
  5. Returns parsed profile or raw stats text
- **Issues:**
  - **Command injection vulnerability:** `${absScript.replace(/\\/g, '\\\\')}` and `${cProfileScript.replace(/"/g, '\\"')}` — escaping is incomplete. Backtick command injection possible if script path contains backticks
  - **Unsafe string concatenation:** Builds Python code as string and passes to shell
  - **Hardcoded Python command:** `process.platform === 'win32' ? 'python' : 'python3'` — assumes PATH
  - **Large buffer potential:** `maxBuffer: 10 * 1024 * 1024` (10MB) could cause memory spike
  - **JSON parsing assumes marker is present:** If Python fails before print, parsing breaks silently
  - **No validation of Python version** — cProfile interface could differ

#### Handler 3: `profiler-time-command`
- **Parameters:** `{ command, cwd, iterations = 1 }`
- **Return:** `{ success: true, command, iterations, timings: [], summary: { min, max, avg, median } }`
- **Logic:**
  1. Limits iterations to 1-20 range
  2. Runs command `iterations` times sequentially
  3. Records duration, exit code, output for each run
  4. Computes summary stats (min, max, avg, median)
  5. Each iteration's output truncated (1000 stdout, 500 stderr)
- **Issues:**
  - **COMMAND INJECTION:** No escaping of `command` parameter — passed directly to `exec()`
  - **Sequential execution only:** No parallelization; timing all runs sequentially could show false variance
  - **No environment isolation:** `{ ...process.env }` reuses parent process environment
  - **Output truncation without notification:** User doesn't know if output was cut off
  - **Median calculation bug:** Doesn't sort before taking middle element
  ```javascript
  // BUG: Sort not assigned!
  median: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)],
  ```
  - **1-second resolution:** Timing is in milliseconds but precision is poor for sub-second commands

#### Handler 4: `profiler-memory-snapshot`
- **Parameters:** None
- **Return:** `{ success: true, process: {...}, system: {...}, uptime, platform, nodeVersion, cpuCount }`
- **Logic:**
  1. Captures `process.memoryUsage()` (RSS, heap, external, arrayBuffers)
  2. Captures `os` memory info (total, free, used)
  3. Returns formatted values in MB/GB with 1 decimal place
  4. Includes platform, Node version, CPU count, process uptime
- **No issues** — straightforward, safe operation

#### Handler 5: `profiler-ai-analyze`
- **Parameters:** `{ profileData, scriptPath, cloudProvider, cloudModel }`
- **Return:** `{ success: true, analysis: object, rawAnalysis: string }` or `{ success: false, error }`
- **Logic:**
  1. Formats profile data for LLM (extracts top functions)
  2. Builds prompt asking for analysis
  3. Tries cloudLLM first, then ctx.llmEngine, then cloudLLM again (redundant)
  4. Parses JSON response wrapped in `{...}`
  5. Returns structured analysis or raw text if parsing fails
- **Issues:**
  - **Undefined fallback behavior:** Tries cloudLLM twice (lines `if (cloudProvider && ctx.cloudLLM)` then later `if (!analysisText && ctx.cloudLLM)`)
  - **No LLM error handling:** If LLM fails, just falls through silently
  - **Profile data truncation:** Limits profile summary to 5000 chars — analysis is incomplete
  - **Prompt formatting:** Prompt asks for specific JSON structure but no validation that response actually follows it
  - **Regex for JSON extraction:** `match(/\{[\s\S]*\}/)` could match wrong scope if multiple JSON objects present

#### Handler 6: `profiler-cancel`
- **Parameters:** `sessionId` (string)
- **Return:** `{ success: true }` or `{ success: false, error }`
- **Logic:**
  1. Looks up session by ID
  2. Kills child process
  3. Deletes from Map
- **Issues:**
  - **No cleanup of temp files:** If session had created `.cpuprofile` files, they still exist after kill
  - **Zombie process potential:** `process.kill()` might not terminate profiled process if it's hung

#### Handler 7: `profiler-list-sessions`
- **Parameters:** None
- **Return:** `{ success: true, sessions: [ {id, scriptPath, startTime, elapsed} ] }`
- **Logic:**
  - Iterates `sessions` Map
  - Returns metadata for active sessions
- **No issues** — read-only operation

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| **COMMAND INJECTION in `profiler-time-command`** | CRITICAL | `command` parameter passed to `exec()` without escaping |
| **COMMAND INJECTION in `profiler-run-python`** | HIGH | Shell metacharacters in path escape string interpolation |
| Median calculation bug | MEDIUM | `.sort()` doesn't modify in place after this line, median is wrong |
| CPU profile file discovery unreliable | MEDIUM | Finds newest `.cpuprofile` in tmpdir — wrong file if other processes profiling |
| Incomplete fallback logic in Node profiler | MEDIUM | Tries to replace electron path with node — fragile |
| LLM analysis redundant fallback | LOW | Tries cloudLLM twice — dead code |
| No temp file cleanup on cancel | LOW | Orphaned `.cpuprofile` files left in tmpdir |
| Session timeout only after execution | MEDIUM | Process hanging in execution won't be killed until exec completes |
| Stdout/stderr truncation silent | LOW | User doesn't know output was cut |
| Large buffer for Python exec | LOW | `maxBuffer: 10MB` could cause memory spike |
| No environment variable isolation | LOW | Runs commands in parent process env |

### 5. DEPENDENCIES ON OTHER MODULES

- **Optional dependencies on `ctx.llmEngine` and `ctx.cloudLLM`:** AI analysis feature depends on these being present
- **Implicit dependency on Python 3 in PATH**
- **Implicit dependency on Node.js being available**
- **Implicit dependency on `os.tmpdir()`** for profile file storage
- **No database or state persistence**

---

## FILE 3: ragHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Implements Retrieval-Augmented Generation (RAG) handlers for semantic search, indexing, and context retrieval. Connects to RAG engine, web search service, memory store, and MCP tool server. Minimal error handling, mostly direct pass-through to `ctx` methods.

**Key Features:**
- Project indexing with progress tracking
- Semantic search with multiple query types
- File content retrieval
- Error context finding (stack trace analysis)
- Web search integration
- Page fetching

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handlers |

**Minimalist imports** — relies entirely on `ctx` methods.

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `rag-index-project`
- **Parameters:** `projectPath` (string)
- **Return:** `{ success: true, ...result }` or `{ success: false, error }`
- **Logic:**
  1. Sets `ctx.currentProjectPath`, `ctx.mcpToolServer.projectPath`, `ctx.gitManager` path
  2. Gets main window reference
  3. Calls `ctx.ragEngine.indexProject()` with progress callback
  4. Progress callback sends `rag-progress` event to renderer with `{ progress, done, total }`
  5. Stores project path and file count in memory
  6. Returns indexing results
- **Issues:**
  - **No validation of projectPath:** Could be any string, including non-existent paths
  - **Side effects across modules:** Mutates `ctx` state across multiple subsystems
  - **Assumes main window exists:** Could crash if `ctx.getMainWindow()` returns null/undefined
  - **Memory side effects:** Stores facts in `ctx.memoryStore` — littering app state
  - **Progress callback could be called on disposed window:** If window closes during indexing, IPC send fails

#### Handler 2: `rag-search`
- **Parameters:** Direct pass-through: `(_, query, maxResults)`
- **Return:** Direct return from `ctx.ragEngine.search()`
- **Logic:** Pure delegation to `ctx.ragEngine.search()` — no validation, no error handling
- **Issues:**
  - **No validation of parameters**
  - **No try-catch** — errors from ragEngine propagate as unhandled rejections
  - **Async but not awaited:** Promises could reject silently

#### Handler 3: `rag-search-files`
- **Parameters:** Direct pass-through: `(_, query, maxResults)`
- **Return:** Direct return from `ctx.ragEngine.searchFiles()`
- **Same issues as rag-search**

#### Handler 4: `rag-get-context`
- **Parameters:** `(_, query, maxChunks, maxTokens)`
- **Return:** Direct return from `ctx.ragEngine.getContextForQuery()`
- **Same issues as rag-search**

#### Handler 5: `rag-find-error`
- **Parameters:** `(_, errorMessage, stackTrace)`
- **Return:** Direct return from `ctx.ragEngine.findErrorContext()`
- **Same issues as rag-search**

#### Handler 6: `rag-get-status`
- **Parameters:** None
- **Return:** Direct return from `ctx.ragEngine.getStatus()`
- **Same issues as rag-search**

#### Handler 7: `rag-get-project-summary`
- **Parameters:** None
- **Return:** Direct return from `ctx.ragEngine.getProjectSummary()`
- **Same issues as rag-search**

#### Handler 8: `rag-get-file-content`
- **Parameters:** `(_, filePath)`
- **Return:** Direct return from `ctx.ragEngine.getFileContent()`
- **Same issues as rag-search**

#### Handler 9: `web-search`
- **Parameters:** `(_, query, maxResults)`
- **Return:** `{ success: true, ...result }` or `{ success: false, error }`
- **Logic:**
  1. Wraps `ctx.webSearch.search()` with try-catch
  2. Returns success/error envelope
- **Issues:**
  - Minimal validation
  - No query rate limiting
  - Could make many external requests

#### Handler 10: `web-search-code`
- **Parameters:** `(_, query)`
- **Return:** `{ success: true, ...result }` or `{ success: false, error }`
- **Same issues as web-search**

#### Handler 11: `web-fetch-page`
- **Parameters:** `(_, url)`
- **Return:** `{ success: true, ...result }` or `{ success: false, error }`
- **Logic:**
  1. Wraps `ctx.webSearch.fetchPage()` with try-catch
- **Issues:**
  - **No URL validation:** Could fetch arbitrary URLs
  - **No fetch timeout protection**
  - **No response size limits**
  - **Security concern:** Could be used to scan local network

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| No parameter validation anywhere | HIGH | Any caller could pass null, undefined, massive strings |
| Assumes ctx values always exist | HIGH | If ragEngine is null, handlers crash |
| Progress callback sent to disposed window | MEDIUM | Race condition if window closes during indexing |
| Side effects on ctx state | MEDIUM | Mutations of currentProjectPath, mcpToolServer, gitManager |
| No rate limiting on web search | MEDIUM | Could make unbounded requests |
| URL validation missing on web-fetch-page | HIGH | Security issue — arbitrary URL fetches |
| No try-catch on most handlers | MEDIUM | Errors propagate as unhandled rejections |
| Inconsistent error handling pattern | LOW | Some handlers wrapped in try-catch, others not |
| Direct state mutation | MEDIUM | Sets ctx.currentProjectPath with no validation |

### 5. DEPENDENCIES ON OTHER MODULES

- **Depends on `ctx.ragEngine`** — must exist and have search methods
- **Depends on `ctx.webSearch`** — must exist
- **Depends on `ctx.mcpToolServer`** — mutates `.projectPath`
- **Depends on `ctx.gitManager`** — calls `.setProjectPath()`
- **Depends on `ctx.memoryStore`** — calls `.learnFact()`
- **Depends on `ctx.getMainWindow()`** — for progress callbacks
- **Implicit dependency on external web services** for web search

---

## FILE 4: restClientHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Implements HTTP/HTTPS request handler for making API calls from main process (eliminating CORS restrictions). Uses Node's built-in HTTP/HTTPS modules with no external dependencies. Single handler: `rest-request`.

**Key Features:**
- GET/POST/PUT/PATCH/DELETE support
- Custom headers with auto-detection (User-Agent, Accept, Content-Type, Content-Length)
- JSON pretty-printing
- 5MB response size cap with truncation flag
- 30-second timeout
- Self-signed certificate acceptance for local dev

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handler |
| `url:URL` | Parse and validate URLs |
| Dynamic `require(isHttps ? 'https' : 'http')` | Make requests |

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `rest-request`
- **Parameters:** `{ method, url, headers = {}, body = '' }`
- **Return:** `{ success: true, status, statusText, headers, body, rawBody, durationMs, size, truncated }` or `{ success: false, error, durationMs }`
- **Logic:**
  1. Parses URL with `new URL(url)` to extract hostname, port, path
  2. Detects HTTPS vs HTTP
  3. Prepares request headers:
     - Case-insensitive merge of custom headers
     - Auto-add User-Agent if missing
     - Auto-add Accept if missing
     - For POST/PUT/PATCH: auto-detect JSON and set Content-Type
     - Auto-calculate Content-Length for body
  4. Creates request with timeout
  5. Receives response in chunks, caps at 5MB
  6. Normalizes response headers (joins array values)
  7. Attempts JSON pretty-print if content-type indicates JSON
  8. Returns all metadata + body + raw body
- **Issues:**
  - **No URL validation beyond URL constructor:** Doesn't check for localhost-only, doesn't block private IPs
  - **`rejectUnauthorized: false`:** Disables SSL certificate validation — accepts MITM attacks in production
  - **Headers mutation in-place:** Modifies `reqHeaders` object properties with case variations
  - **Content-Length bug for POST:** If body is multipart/form-data, Content-Length auto-calculation won't work
  - **JSON detection too simple:** `try { JSON.parse(body) }` could be expensive for 5MB responses
  - **No follow-redirect:** Will fail on 3xx responses
  - **No proxy support**
  - **Response headers case normalization fragile:** `Object.entries(res.headers).forEach(...)` assumes all are strings, but some might be arrays
  - **No auth header sanitization:** Could leak credentials in logs if body is logged elsewhere

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| **`rejectUnauthorized: false` disables SSL** | CRITICAL | Security risk in production — enables MITM attacks |
| **No URL validation** | HIGH | Could send requests to private IPs (localhost, 192.168.*) — SSRF risk |
| No redirect support | MEDIUM | Fails silently on 3xx responses |
| Content-Length wrong for multipart | MEDIUM | POST with multipart bodies would have wrong Content-Length |
| Headers normalization fragile | MEDIUM | Assumes headers are strings; some Node versions use arrays |
| No follow-redirect | MEDIUM | Common websites with redirects will fail |
| JSON detection on large responses | LOW | JSON.parse of 5MB response could be CPU-intensive |
| Truncation silent to user | LOW | Response flagged as truncated but user might not see flag |
| No timeout on response body reception | MEDIUM | If server sends headers but trickles body, could hang for 30s |

### 5. DEPENDENCIES ON OTHER MODULES

- **Depends on Node.js HTTP/HTTPS modules** (built-in)
- **No external npm dependencies** (intentional)
- **No context dependencies** (`ctx` parameter unused)

---

## FILE 5: smartSearchHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Implements advanced code search and navigation features using regex-based symbol extraction and semantic AI search. Supports:
- Symbol extraction (functions, classes, variables) from 6+ languages
- Reference finding across project
- Go-to-definition
- Semantic search with LLM fallback
- Similar code pattern matching
- Breadcrumb navigation
- Project-wide symbol search

**Key Features:**
- Language support: JS/TS, Python, Java/C#/C++, Rust, Go
- 2000-file scan limit per operation
- Regex-based extraction (no Tree-sitter)
- AI-powered semantic search fallback
- Skip dangerous directories (node_modules, .git, etc.)

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handlers |
| `path` | Resolve paths, extract directory/filename, relative paths |
| `fs` | Read directory and file contents |
| `child_process:exec` | (Imported but **NEVER USED**) |

**Unused import:** `exec` should be removed.

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `smart-search-symbols`
- **Parameters:** `{ filePath }`
- **Return:** `{ success: true, symbols: [...], filePath }` or `{ success: false, error }`
- **Logic:**
  1. Validates file exists
  2. Reads file content
  3. Calls `extractSymbols()` which:
     - Detects language from file extension
     - Applies language-specific regex patterns
     - Extracts symbols (functions, classes, methods, etc.)
     - Finds line numbers by counting newlines in content
     - Deduplicates by `type:name`
     - Returns array of `{ name, type, line, filePath, context }`
  4. Returns all symbols
- **Issues:**
  - **Large file performance:** No size check before reading — could read 100MB file
  - **Regex patterns incomplete:** Each language only has ~5-8 patterns — misses many syntax forms
  - **Line number calculation inefficient:** Recounts newlines for each match instead of preprocessing lines
  - **Context truncation:** Only captures current line, misses multi-line declarations
  - **False positives:** Regex patterns match in comments, strings — not true declarations

#### Handler 2: `smart-search-references`
- **Parameters:** `{ symbol, rootPath }`
- **Return:** `{ success: true, symbol, references: [...], totalFiles }`
- **Logic:**
  1. Validates symbol length >= 2
  2. Collects up to 1500 searchable files
  3. For each file:
     - Checks if symbol exists (quick substring check)
     - Splits into lines, searches each line
     - Captures line number, column, context
     - Stops at 200 references
  4. Returns references with file paths, line numbers, and context
- **Issues:**
  - **Inefficient search:** Reads entire files even for symbol not present
  - **Column calculation wrong:** `lines[i].indexOf(symbol)` finds first occurrence, not the specific match at line i
  - **Regex not case-sensitive on first pass:** `symbol.includes(symbol)` is substring, not word-boundary search
  - **No multi-line symbol support:** Won't find references split across lines
  - **Stops at 200 results silently:** Could underreport actual references

#### Handler 3: `smart-search-definition`
- **Parameters:** `{ symbol, rootPath }`
- **Return:** `{ success: true, symbol, definitions: [...] }`
- **Logic:**
  1. Builds 10 definition patterns for multiple languages
  2. Escapes symbol for regex safety
  3. For each file:
     - Quick include check for symbol
     - Checks each line against all patterns
     - Stops on first match per line
  4. Returns definitions
- **Issues:**
  - **Expensive regex compilation:** Recompiles patterns for each function call
  - **Patterns too specific:** Doesn't match all declaration styles (e.g., destructured exports)
  - **No validation that match is actual definition** — could match in comments
  - **Stops at first pattern match per line:** If line has multiple definitions, only first captured

#### Handler 4: `smart-search-semantic`
- **Parameters:** `{ query, rootPath, cloudProvider, cloudModel, maxResults = 10 }`
- **Return:** `{ success: true, results: [...], source: 'rag'|'ai' }` or `{ success: false, error }`
- **Logic:**
  1. Tries RAG first (if available)
  2. Falls back to LLM-powered file list generation:
     - Collects up to 500 files
     - Sends file list + query to LLM
     - Asks for JSON array of `{ file, reason, searchTerms }`
     - Parses response, resolves paths, finds best line matches
  3. Returns results with snippets
- **Issues:**
  - **LLM fallback is expensive:** Makes network request for each semantic search
  - **Redundant fallback:** Tries cloudProvider twice (lines `if (cloudProvider && ctx.cloudLLM)` then later `if (!aiText && ctx.cloudLLM)`)
  - **File list truncation:** Only sends first 5000 chars of file list
  - **No validation of LLM response:** Could return invalid JSON, wrong format
  - **Path resolution not validated:** Doesn't check if resolved paths actually exist

#### Handler 5: `smart-search-similar`
- **Parameters:** `{ code, rootPath, cloudProvider, cloudModel }`
- **Return:** `{ success: true, similar: [...], identifiers }`
- **Logic:**
  1. Extracts identifiers from code (words >= 2 chars, excluding keywords)
  2. For each file:
     - Counts how many identifiers appear in file
     - Calculates match score (matched / total identifiers)
     - If score > 30%, finds best matching line region
  3. Returns matches sorted by score
- **Issues:**
  - **Naive identifier extraction:** Regex `\b[a-zA-Z_]\w{2,}\b` matches anything, could include keywords if the filter list is incomplete
  - **Filter list hardcoded and incomplete:** Long list of JS keywords but what about Python, Ruby, Go keywords?
  - **Score calculation penalizes short snippets:** If code has 3 identifiers and a file has 1, score is only 0.33 even if it's very relevant
  - **No semantic similarity:** Just counts substring matches, not actual code patterns

#### Handler 6: `smart-search-breadcrumb`
- **Parameters:** `{ filePath, line }`
- **Return:** `{ success: true, breadcrumb: [...], enclosingSymbols: [...] }`
- **Logic:**
  1. Extracts all symbols from file
  2. Filters to symbols at or before target line
  3. Builds breadcrumb: filename → class → method/function
  4. Returns breadcrumb path
- **Issues:**
  - **No validation of line number** — could be > file lines
  - **Symbol extraction limitations inherited** — same regex issues as handler 1

#### Handler 7: `smart-search-project-symbols`
- **Parameters:** `{ query, rootPath, filter }`
- **Return:** `{ success: true, symbols: [...], totalFound }`
- **Logic:**
  1. Collects up to 1000 files
  2. Extracts all symbols from each file
  3. Filters by type if specified
  4. Filters by query (case-insensitive substring)
  5. Sorts: prefix matches first, then alphabetical
  6. Returns up to 200 results
- **Issues:**
  - **Memory intensive:** Extracts symbols from all 1000 files — could be 100k+ symbols in memory
  - **No pagination:** Returns up to 200, but index position lost if user wants next 200

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| Unused import `exec` | LOW | Dead code |
| No file size limits | MEDIUM | Could read 100MB+ files into memory |
| Column calculation wrong | MEDIUM | `indexOf()` finds first, not the actual match location |
| Regex patterns incomplete | MEDIUM | Misses many syntax forms, false positives in comments |
| Line number calculation inefficient | LOW | Recounts newlines unnecessarily |
| Definition matching could match comments | MEDIUM | No distinction between code and comments |
| Redundant LLM fallback logic | LOW | Tries cloudProvider twice |
| LLM response validation missing | MEDIUM | Could crash on unexpected format |
| Identifier extraction incomplete | MEDIUM | Keyword filter list may not include all languages' keywords |
| Score calculation penalizes short matches | LOW | 30% threshold may be too high |
| No pagination support | LOW | Can't get results beyond 200 |
| Memory usage unbounded | MEDIUM | Loading 1000 files + all symbols could use significant memory |

### 5. DEPENDENCIES ON OTHER MODULES

- **Optional dependency on `ctx.ragEngine`** for semantic search fallback
- **Optional dependency on `ctx.cloudLLM`** for semantic search
- **Optional dependency on `ctx.llmEngine`** for semantic search
- **Implicit dependency on file system permissions** to read files
- **Implicit dependency on `ctx.currentProjectPath`** being set

---

## FILE 6: sshHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Implements SSH remote development features using `ssh2` package (optional dependency). Supports:
- SSH connection management with multiple profiles
- SFTP file operations (read, write, list, delete, rename)
- SSH command execution
- Connection persistence in memory
- Profile persistence to `~/.guide-ide/ssh-profiles.json`
- Graceful degradation if ssh2 not installed

**Key Features:**
- SFTP directory listing with sorted output
- Stream-based file I/O (efficient for large files)
- Connection timeout handling
- Active session tracking

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handlers |
| `path` | Basename extraction, path operations |
| `fs` | Load/save profiles to disk |
| `os` | Home directory, homedir expansion for keys |
| `ssh2.Client` (optional) | SSH connection creation |

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `ssh-available`
- **Parameters:** None
- **Return:** `{ available: boolean }`
- **Logic:** Returns whether ssh2 package is available
- **No issues**

#### Handler 2: `ssh-get-profiles`
- **Parameters:** None
- **Return:** `{ success: true, profiles: [...] }` or error
- **Logic:** Loads profiles from `~/.guide-ide/ssh-profiles.json`
- **Issues:**
  - **No validation of profile structure** after load

#### Handler 3: `ssh-save-profile`
- **Parameters:** `profile` object
- **Return:** `{ success: true, profiles: [...] }`
- **Logic:**
  1. Loads existing profiles
  2. If profile has `.id`, updates existing entry
  3. Otherwise appends new profile with generated ID
  4. Saves to disk
  5. Returns all profiles
- **Issues:**
  - **RACE CONDITION:** Two simultaneous saves could lose data (read-modify-write not atomic)
  - **No validation of profile fields** — could save invalid data
  - **No ID validation** — generated ID from `Date.now().toString(36)+random` could collide
  - **Spreads profile but preserves existing fields:** `{ ...profiles[existing], ...profile }` means old passwords stay if not updated

#### Handler 4: `ssh-delete-profile`
- **Parameters:** `profileId` (string)
- **Return:** `{ success: true, profiles: [...] }`
- **Logic:**
  1. Loads profiles
  2. Filters out matching profile by ID
  3. Saves updated list
- **Issues:**
  - **RACE CONDITION:** Multiple deletes could race
  - **No validation of ID** — could contain path traversal (shouldn't matter but inconsistent)
  - **Doesn't disconnect active connections** using this profile

#### Handler 5: `ssh-connect`
- **Parameters:** `{ host, port = 22, username, password, privateKey, privateKeyPath, passphrase }`
- **Return:** `{ success: true, connectionId, host, username }` or `{ success: false, error }`
- **Logic:**
  1. Checks ssh2 installed
  2. Creates new Client instance
  3. Sets up event handlers:
     - `ready`: Initiates SFTP, stores connection in Map
     - `error`: Rejects promise
     - `end`: Cleans up Map
  4. Reads private key from disk if `privateKeyPath` provided
  5. Calls `conn.connect(config)` with 15-second timeout
  6. Maps connection by generated ID
- **Issues:**
  - **CRITICAL: Private key read from disk unvalidated:** `fs.readFileSync(keyPath.replace(/^~/, os.homedir()))` — symlink attack risk, directory traversal risk
  - **Passphrase stored in memory:** `config.passphrase = passphrase` keeps decrypted passphrase in config object
  - **SFTP init failure doesn't clean up TCP connection** — connection object lingers
  - **15-second timeout short for slow networks**
  - **No rate limiting on connection attempts** — could be used for brute force
  - **No logging** of connection attempts (security audit trail missing)
  - **Password sent in plaintext** if SSH negotiation fails early

#### Handler 6: `ssh-disconnect`
- **Parameters:** `connectionId` (string)
- **Return:** `{ success: true }` or error
- **Logic:**
  1. Looks up connection
  2. Calls `conn.end()`
  3. Deletes from Map
- **Issues:**
  - No wait for actual disconnect — `end()` is async
  - Doesn't close SFTP channel explicitly

#### Handler 7: `ssh-list-dir`
- **Parameters:** `(_, connectionId, remotePath)`
- **Return:** `{ success: true, path, items: [...] }` or error
- **Logic:**
  1. Validates connection exists
  2. Calls SFTP `readdir()`
  3. Formats items with name, type, size, modified, permissions
  4. Sorts directories first, then alphabetically
- **Issues:**
  - **No path validation** — could list outside intended directory
  - **Permission extraction fragile:** `mode & 0o777` assumes mode field exists
  - **Directory iteration could fail partway** — no partial result handling

#### Handler 8: `ssh-read-file`
- **Parameters:** `(_, connectionId, remotePath)`
- **Return:** `{ success: true, content, path, name }` or error
- **Logic:**
  1. Validates connection
  2. Creates read stream from SFTP
  3. Concatenates chunks
  4. Returns full content
- **Issues:**
  - **No file size limit** — could read infinite stream and exhaust memory
  - **Error on stream not propagated properly** — stream events could fire after resolve

#### Handler 9: `ssh-write-file`
- **Parameters:** `(_, connectionId, remotePath, content)`
- **Return:** `{ success: true, path }` or error
- **Logic:**
  1. Validates connection
  2. Creates write stream to SFTP
  3. Writes content as UTF-8
  4. Closes stream
- **Issues:**
  - **Content written unvalidated** — no size check on input
  - **Encoding hardcoded to UTF-8** — binary files would corrupt
  - **No backup/transaction** — overwrites directly

#### Handler 10: `ssh-delete`
- **Parameters:** `(_, connectionId, remotePath, isDir)`
- **Return:** `{ success: true }` or error
- **Logic:**
  1. Validates connection
  2. Calls `rmdir()` or `unlink()` based on `isDir` flag
- **Issues:**
  - **No validation of remotePath** — could delete anything accessible to SSH user
  - **isDir flag could be wrong** — calling `unlink()` on directory returns error, calling `rmdir()` on file returns error
  - **No confirmation prompt** — dangerous operation without UX safeguard

#### Handler 11: `ssh-rename`
- **Parameters:** `(_, connectionId, oldPath, newPath)`
- **Return:** `{ success: true }` or error
- **Logic:**
  1. Validates connection
  2. Calls SFTP `rename()`
- **Issues:**
  - **No path validation**
  - **No backup**

#### Handler 12: `ssh-mkdir`
- **Parameters:** `(_, connectionId, remotePath)`
- **Return:** `{ success: true }` or error
- **Logic:** Calls SFTP `mkdir()`
- **No validation of path**

#### Handler 13: `ssh-exec`
- **Parameters:** `(_, connectionId, command)`
- **Return:** `{ success: true, stdout, stderr, exitCode }` or error
- **Logic:**
  1. Validates connection
  2. Calls SSH `exec(command)`
  3. Captures stdout and stderr
  4. Returns output and exit code
- **Issues:**
  - **CRITICAL: Command injection risk** — command passed directly, no escaping
  - **No command timeout** — could hang indefinitely
  - **Output unbounded** — could capture gigabytes of output into memory
  - **No shell escaping** — if command built from user input, easy injection

#### Handler 14: `ssh-stat`
- **Parameters:** `(_, connectionId, remotePath)`
- **Return:** `{ success: true, isDir, isFile, size, modified, permissions }` or error
- **Logic:** Calls SFTP `stat()`, returns file metadata
- **Issues:**
  - Permission extraction fragile: `mode & 0o777`

#### Handler 15: `ssh-list-connections`
- **Parameters:** None
- **Return:** `{ success: true, connections: [...] }`
- **Logic:** Returns list of active connection IDs, hosts, usernames, ports
- **No issues** — read-only operation

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| **CRITICAL: Private key path traversal** | CRITICAL | `fs.readFileSync(keyPath.replace(/^~/, os.homedir()))` — symlink attack, directory traversal possible |
| **CRITICAL: Command injection in ssh-exec** | CRITICAL | `command` parameter passed to ssh2 without escaping |
| **RACE CONDITION in profile save/delete** | HIGH | Read-modify-write not atomic — concurrent updates lose data |
| Passphrase stored unencrypted in memory | HIGH | Violates security rules (never touch secrets) |
| No command timeout in ssh-exec | MEDIUM | Malicious command could hang process indefinitely |
| Output unbounded in ssh-exec | MEDIUM | Could exhaust memory from large output |
| File read unbounded | MEDIUM | No size check on ssh-read-file — could OOM |
| Active connections not cleaned up on failure | MEDIUM | SFTP init fail leaves TCP connection open |
| No validation of remotePath across all handlers | HIGH | Could read/write/delete files outside intended scope |
| Delete handler doesn't validate isDir flag | MEDIUM | Calling wrong SFTP method leaves unclear errors |
| No connection rate limiting | MEDIUM | Could be used for brute force SSH attacks |
| Doesn't disconnect active connections on profile delete | LOW | Orphaned connection remains active |
| isDir flag bug in ssh-exec handler parameter name | LOW | Parameter order could confuse callers |

### 5. DEPENDENCIES ON OTHER MODULES

- **Optional dependency on `ssh2` package** — must be manually installed
- **Depends on `fs` for key file I/O** — no validation of file access
- **Depends on `os.homedir()`** for profile storage and key expansion

---

## FILE 7: templateHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Implements project scaffolding from hardcoded templates. Provides 12 project templates covering React, Next.js, Express, FastAPI, Electron, HTML/CSS/JS, Chrome Extensions, Discord Bots, CLI Tools, and more. Single handler: `template-create-project`.

**Key Features:**
- 12 pre-built project templates
- File generation with variable substitution (`{{PROJECT_NAME}}`)
- Project creation in user-specified directory
- Async file writing with error handling

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handler |
| `path` | Path operations |
| `fs.promises` | Async file operations |
| `fs` (sync) | Sync operations (shouldn't be needed but imported) |

### 3. IPC HANDLERS REGISTERED

#### Handler: `template-create-project` (implied from file, but NOT EXPLICITLY SHOWN)

**NOTE:** The file shows template definitions but the handler registration is cut off. Based on the structure, the handler should:
- **Parameters:** `{ templateId, projectName, projectPath }`
- **Expected Logic:**
  1. Find template by ID
  2. Create project directory
  3. Generate files with variable substitution
  4. Return success/error
- **Expected Issues:**
  - No validation of `projectPath` (could be anywhere on filesystem)
  - No validation of `projectName` (could contain path traversal)
  - No rollback if file creation fails midway
  - No check if directory already exists

### 4. POTENTIAL ISSUES FROM TEMPLATE DEFINITIONS

| Issue | Severity | Description |
|-------|----------|-------------|
| No validation of projectPath | HIGH | Could create projects anywhere, including system dirs |
| No validation of projectName | HIGH | Could contain `../../../etc/` to escape directory |
| Path traversal in variable substitution | MEDIUM | `{{PROJECT_NAME}}` not escaped in file Generation |
| No rollback on partial failure | MEDIUM | If 5th file write fails, previous 4 written but project incomplete |
| Large files in templates | LOW | React, Next.js templates have multi-kb package.json files |
| Package.json version strings | LOW | Hardcoded versions (e.g., React ^19.0.0) — could be outdated |
| No async error handling shown | MEDIUM | If handler not shown, error handling may be missing |
| Over-escaped strings in Python template | LOW | String quote escaping in cProfile script could be fragile |

### 5. DEPENDENCIES ON OTHER MODULES

- **Depends on `fs.promises`** for async file operations
- **No external dependencies** — uses built-in Node modules only

---

## FILE 8: terminalHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Minimal terminal management handlers. Delegates to `ctx.terminalManager` for creating, resizing, destroying terminals and managing terminal I/O. Includes basic security validation of terminal CWD.

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handlers |

Minimal imports — mostly delegation to `ctx.terminalManager`.

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `terminal-create`
- **Parameters:** `options` object (may include `cwd`)
- **Return:** Direct return from `ctx.terminalManager.create()`
- **Logic:**
  1. Validates `options.cwd` is in allowed paths via `ctx.isPathAllowed()`
  2. Calls `ctx.terminalManager.create(options)`
  3. Returns result
- **Issues:**
  - **Assumes ctx.isPathAllowed() exists** — no error handling if it doesn't
  - **Throws exception directly** — not wrapped in try-catch, propagates to renderer
  - **No validation of other options** — only CWD validated

#### Handler 2: `terminal-write`
- **Parameters:** `(_, id, data)`
- **Logic:** Direct delegation to `ctx.terminalManager.write(id, data)`
- **Issues:**
  - **No validation of id or data**
  - **No error handling**

#### Handler 3: `terminal-resize`
- **Parameters:** `(_, id, cols, rows)`
- **Logic:** Direct delegation
- **Issues:**
  - **No validation of cols/rows** — could be negative, NaN, Infinity

#### Handler 4: `terminal-destroy`
- **Parameters:** `(_, id)`
- **Logic:** Direct delegation
- **Issues:**
  - **No validation of id**

#### Handler 5: `terminal-list`
- **Parameters:** None
- **Logic:** Direct delegation
- **No issues** — read-only

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| Exception thrown on invalid CWD | MEDIUM | Should return error object, not throw |
| No validation of cols/rows | MEDIUM | Could send negative or NaN values to terminal |
| No validation of terminal id | MEDIUM | Invalid id likely crashes terminalManager |
| No error handling on delegation | MEDIUM | Errors from terminalManager propagate unhandled |
| Assumes ctx.isPathAllowed exists | MEDIUM | If method missing, throws TypeError |

### 5. DEPENDENCIES ON OTHER MODULES

- **Depends on `ctx.terminalManager`** for all actual operations
- **Depends on `ctx.isPathAllowed()`** for security validation

---

## FILE 9: todoTreeHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

Scans workspace for TODO/FIXME/HACK/NOTE/BUG/XXX comments and returns them as a structured list. Single handler: `scan-todos`. Recursively walks directory tree, extracts comments matching TODO pattern, and returns up to 500 results.

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:ipcMain` | Register handler |
| `path` | Path operations, file extension extraction, relative path calculation |
| `fs.promises` | Async file/directory I/O |

### 3. IPC HANDLERS REGISTERED

#### Handler: `scan-todos`
- **Parameters:** `rootPath` (string)
- **Return:** `{ success: true, todos: [...] }` or `{ success: false, error }`
- **Logic:**
  1. Validates rootPath provided
  2. Validates path is allowed via `ctx.isPathAllowed()`
  3. Recursively scans directory starting from `rootPath`
  4. Skips:
     - Directories starting with `.` (hidden, depth > 12)
     - Directories matching `/node_modules|\.git|dist|build|\.next|\.cache|__pycache__|\.venv|venv|coverage|\.turbo|\.parcel-cache/`
     - Files with extensions not in TEXT_EXTS set
     - Files > 512KB
  5. For each file, reads content and scans for TODO pattern:
     - Pattern: `(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK|NOTE|BUG|XXX)(?:\s*[(:]\s*|\s+)(.+)`
     - Matches single-line comments with tags
     - Captures tag type and message
  6. Returns up to 500 results
- **Issues:**
  - **Max 500 results hardcoded** — large projects' TODOs silently truncated without notification
  - **Async/await in recursive function:** `await scanDir()` properly awaits recursion
  - **Regex doesn't match multi-line TODOs** — only single-line comments
  - **Comment markers incomplete:** Only matches `//, #, /*, *` — misses (comment markers from other languages
  - **File size check (512KB) causes large files to be skipped** — TODOs in large files missed
  - **Depth limit of 12** prevents scanning very deep directories
  - **Uses `.replace(/\\/g, '/')`** for cross-platform paths but SKIP_DIRS regex checks already-converted path

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| Max 500 results silent truncation | MEDIUM | User doesn't know TODOs exist beyond limit |
| Multi-line TODOs not matched | MEDIUM | Block comments split across lines missed |
| File size skip (512KB) causes data loss | MEDIUM | Large files' TODOs invisible |
| Regex pattern language-specific | MEDIUM | Misses Lua, R, Perl, etc. comment markers |
| Depth limit of 12 | LOW | Deeply nested projects won't be fully scanned |
| Async SKIP_DIRS check | LOW | Pattern checked on path after `/` normalization |
| RegExp not reset between matches | MEDIUM | `TODO_PATTERN` without `.lastIndex = 0` between files could have state |

### 5. DEPENDENCIES ON OTHER MODULES

- **Depends on `ctx.isPathAllowed()`** for security validation
- **No other module dependencies**

---

## FILE 10: utilityHandlers.js

### 1. FILE PURPOSE AND OVERVIEW

General utility handlers for app metadata, system information, custom instructions loading, and system resource monitoring. Six handlers covering version info, platform detection, custom instruction loading from project files, and resource usage.

### 2. IMPORTS/REQUIRES AND USAGE

| Import | Usage |
|--------|-------|
| `electron:(ipcMain, app)` | Register handlers, get app version |
| `path` | Path joining |
| `fs.promises` | Async file reading |
| `os` | System info, home directory |

### 3. IPC HANDLERS REGISTERED

#### Handler 1: `get-app-version`
- **Parameters:** None
- **Return:** `app.getVersion()` string
- **No issues**

#### Handler 2: `get-platform`
- **Parameters:** None
- **Return:** `process.platform` string (linux, darwin, win32)
- **No issues**

#### Handler 3: `get-home-dir`
- **Parameters:** None
- **Return:** `os.homedir()` string
- **No issues**

#### Handler 4: `get-app-path`
- **Parameters:** None
- **Return:** `ctx.appBasePath` string
- **Issues:**
  - **Assumes ctx.appBasePath exists** — no error handling if undefined

#### Handler 5: `get-system-info`
- **Parameters:** None
- **Return:** `{ platform, arch, cpus, totalMemory, freeMemory, nodeVersion, electronVersion }`
- **No issues** — read-only system info

#### Handler 6: `load-custom-instructions`
- **Parameters:** `projectPath` (string)
- **Return:** `{ success: true, instructions: string|null, source: string }`
- **Logic:**
  1. Returns empty if no projectPath
  2. Tries to load from multiple candidates in order:
     - `.guide-instructions.md`
     - `.prompt.md`
     - `.guide/instructions.md`
     - `.github/copilot-instructions.md`
     - `CODING_GUIDELINES.md`
  3. Returns first that exists and has content
  4. Returns null if none found
  5. Logs which file was loaded with size
- **Issues:**
  - **No validation of projectPath** — could read from any directory
  - **No size limit on instructions** — could load megabyte-sized files
  - **Error silently ignored** — `catch (_) { /* file doesn't exist — try next */ }` swallows all errors including permission issues
  - **Content not validated** — could be binary data read as UTF-8
  - **Order matters but not configurable** — hardcoded priority could be wrong for some projects

#### Handler 7: `get-system-resources`
- **Parameters:** None
- **Return:** `{ cpu: ctx.getCpuUsage(), ram: { used, total, percent } }`
- **Issues:**
  - **Assumes ctx.getCpuUsage() exists** — no error handling
  - **No error handling on os.totalmem() / os.freemem()** — could throw
  - **CPU usage calculation delegated** — true implementation unknown

### 4. POTENTIAL ISSUES, BUGS, RACE CONDITIONS, EDGE CASES

| Issue | Severity | Description |
|-------|----------|-------------|
| No validation of projectPath in load-custom-instructions | MEDIUM | Could read arbitrary files from filesystem |
| No size limit on instructions file | MEDIUM | Could load gigabyte files into memory |
| Errors silently swallowed | MEDIUM | Permission errors, encoding issues treated as "file not found" |
| Content not validated | LOW | Binary files read as UTF-8 would produce garbage |
| Assumes ctx properties exist | MEDIUM | Missing ctx.appBasePath or ctx.getCpuUsage() throws |
| Hardcoded file search order | LOW | Cannot customize priority for different projects |

### 5. DEPENDENCIES ON OTHER MODULES

- **Depends on `ctx.appBasePath`** — set by application initialization
- **Depends on `ctx.getCpuUsage()`** — implementation not visible in this file
- **No other external dependencies**

---

## CROSS-FILE PATTERNS AND SYSTEMIC ISSUES

### Common Issues Across Multiple Files

1. **Parameter Validation Missing Everywhere:** Almost no handlers validate input parameters
2. **Race Conditions in Registry Operations:** pluginHandlers, sshHandlers have read-modify-write bugs
3. **Unused Imports:** `exec` in pluginHandlers and smartSearchHandlers
4. **No Try-Catch Wrapping:** ragHandlers and terminalHandlers delegate without error handling
5. **Path Traversal Risks:** Multiple files accept unvalidated paths (restClientHandlers, sshHandlers, utilityHandlers)
6. **Memory Exhaustion Risks:** No size limits on file reads (sshHandlers, smartSearchHandlers, utilityHandlers)
7. **Hardcoded Limits Without User Feedback:** 200 references, 500 TODOs, 1500 files — limits hit silently
8. **Inconsistent Error Handling Patterns:** Some handlers return `{ success, error }`, others throw, others delegate
9. **Missing State Cleanup:** Orphaned connections, temp files, disconnected processes
10. **Information Disclosure:** Logs full file paths, command outputs, connection details

### Critical Security Issues

1. **Command Injection:** profilerHandlers, smartSearchHandlers, sshHandlers
2. **Path Traversal:** pluginHandlers, sshHandlers, utilityHandlers, restClientHandlers
3. **SSRF Risk:** restClientHandlers with no URL validation
4. **SSL MITM Risk:** restClientHandlers disables cert verification
5. **Secret Storage:** SSH passphrases kept unencrypted in memory
6. **Arbitrary File Read/Write:** sshHandlers, utilityHandlers

### Architecture Issues

1. **Tight coupling to ctx:** All handlers depend on ctx having specific properties
2. **Rate limiting missing:** No protection against DoS from repeated handler calls
3. **No audit logging:** Security-sensitive operations (SSH, file ops) not logged
4. **No transaction semantics:** Multi-step operations not atomic
5. **Sync file I/O mix:** Some files use sync fs operations in async handlers

---

## RECOMMENDATIONS (PRIORITY ORDER)

### CRITICAL (Fix immediately)

1. **pluginHandlers.js:** Add atomic file locking for registry updates (line 89)
2. **sshHandlers.js:** Validate private key path against directory traversal (line 106)
3. **profilerHandlers.js:** Add command injection protection in `profiler-time-command` (line 57)
4. **restClientHandlers.js:** Validate URLs against private IP ranges, enable cert verification (line 50)
5. **sshHandlers.js:** Add command escaping in `ssh-exec` (line 271)

### HIGH (Fix soon)

6. **smartSearchHandlers.js:** Remove command injection path in file reads
7. **utilityHandlers.js:** Add size limit on instruction file loading
8. **pluginHandlers.js:** Validate and sanitize pluginId parameter across all handlers
9. **sshHandlers.js:** Add connection disconnect cleanup on profile delete
10. **terminalHandlers.js:** Wrap exceptions in try-catch with error returns

### MEDIUM (Fix in next cycle)

11. **ragHandlers.js:** Add parameter validation to all handlers
12. **smartSearchHandlers.js:** Implement pagination for search results
13. **todoTreeHandlers.js:** Notify user when result limit reached
14. **profileHandlers.js:** Add temp file cleanup for profiling sessions
15. **All files:** Implement consistent error handling pattern

### LOW (Nice to have)

16. Remove unused imports (`exec` in pluginHandlers, smartSearchHandlers)
17. Implement rate limiting on repeated handler calls
18. Add audit logging for security-sensitive operations
19. Implement file size limits for all file I/O operations

---

**END OF AUDIT REPORT**

---

# PART 4 — CLOUD, BROWSER & WEB

# COMPREHENSIVE LINE-BY-LINE CODEBASE AUDIT

## File 1: cloudLLMService.js

### FILE PURPOSE
Multi-provider cloud LLM service supporting 26+ cloud AI providers (OpenAI, Anthropic, Google Gemini, xAI, Groq, Cerebras, SambaNova, Together, Fireworks, NVIDIA, Cohere, Mistral, Hugging Face, Cloudflare, Perplexity, DeepSeek, AI21, DeepInfra, Hyperbolic, Novita, Moonshot, Upstage, Lepton, APIFreeLLM, OpenRouter, GraySoft) plus local Ollama. Includes key pooling, rate limiting, fallback chaining, RPM pacing, vision model support, and streaming response handling.

---

### IMPORTS (Lines 1-15)
```javascript
const https = require('https');          // Line 13 — HTTPS client
const http = require('http');            // Line 14 — HTTP client (Ollama)
const { EventEmitter } = require('events'); // Line 15 — Event emission base class
```

---

### CONSTANTS & CONFIGURATION OBJECTS

**ENDPOINTS** (Lines 17-52)
- Lines 17-52: Provider endpoint map — hostname + path for each of 26 providers
- Cloudflare path is `null` because it requires account ID substitution at call time (line 50-51 comment)
- Example: `openai: { host: 'api.openai.com', path: '/v1/chat/completions' }`

**PROVIDER_LABELS** (Lines 54-60)
- Human-readable names for each provider (e.g., `openai: 'OpenAI'`, `groq: 'Groq'`)

**PROVIDER_MODELS** (Lines 62-215)
- Model catalogs per provider:
  - Lines 64-69: GraySoft, OpenAI (5 models including GPT-4.1, GPT-4o variants)
  - Lines 70-75: Anthropic (Claude Sonnet 4, 3.5 Sonnet, Haiku)
  - Lines 76-83: Google (Gemini 2.5+ models, 6 variants)
  - Lines 84-86: xAI (Grok 3 variants)
  - Lines 87-100: Groq (9 models including Llama 3.3, Compound agentic model)
  - Lines 101-148: Other providers (Cerebras, SambaNova, Together, Fireworks, NVIDIA, Cohere, Mistral, HuggingFace, Cloudflare, DeepSeek, Perplexity, AI21, DeepInfra, etc.)

**CONTEXT_LIMITS** (Lines 217-246)
- Context window token limits per model (e.g., GPT-4.1: 1,047,576 tokens, Gemini 2.5: 1,048,576 tokens)

**VISION_MODELS** (Lines 248-257)
- Models supporting image input per provider (OpenAI, Anthropic, Google, xAI, Mistral, OpenRouter)

**FALLBACK_ORDER & PREFERRED_FALLBACK_MODEL** (Lines 259-274)
- Line 259-260: Fallback provider chain: `['sambanova', 'cerebras', 'google', 'nvidia', 'cohere', 'mistral', 'huggingface', 'cloudflare', 'together', 'fireworks', 'openrouter', 'groq']`
- Lines 262-266: Preferred model per fallback provider (e.g., cerebras → 'gpt-oss-120b')

**DEFAULT_RPM** (Lines 268-272)
- Estimated RPM (requests per minute) per-key for free tiers (groq: 30, cerebras: 30, etc.)

**BUNDLED_PROVIDERS & BUNDLED_KEYS** (Lines 274-305)
- Lines 274-275: Set of bundled free providers: `groq`, `cerebras`, `sambanova`, `google`, `openrouter`
- Lines 277-281: XOR-obfuscated bundled keys (decoded on initialization)
- Lines 283-305: CEREBRAS & GROQ key pools (20 keys each for load distribution)

**OPENROUTER_BLOCKED** (Lines 307-309)
- Regex patterns to filter NSFW/ERP models from OpenRouter catalog

**CLOUD_SYSTEM_PROMPT** (Lines 311-312)
- Default system message for cloud LLM persona

**Stream Timeouts** (Lines 314-315)
- `STREAM_TIMEOUT`: 20 seconds — max wait for first response token
- `IDLE_TIMEOUT`: 10 seconds — max time between tokens before stream stalls

---

### CLASS: CloudLLMService extends EventEmitter

#### CONSTRUCTOR (Lines 324-362)
Initializes:
- **API Keys**: One slot per provider (line 327-330)
- **Active Provider/Model**: Defaults to `activeModel: 'llama3.1-8b'` (lines 331-332)
- **OpenRouter Cache**: For live model catalog (lines 333-334)
- **Rate Limiting**: `_rateLimitedUntil`, `_keyPools`, `_keyPoolIndex`, `_recent429Timestamps`, `_requestTimestamps`, `_providerRPMPerKey` (lines 337-342)
- **Ollama Detection**: `_ollamaAvailable`, `_ollamaModels`, `_ollamaLastCheck` with 30s TTL (lines 348-350)
- **License Manager**: For session token validation on proxy routes (line 346)
- **Calls `_seedBundledKeys()`** on line 352 to decode and inject XOR-obfuscated keys

---

#### PUBLIC METHODS

**setLicenseManager(lm)** (Line 355)
- Stores license manager reference for session-based proxy routing

**_isBundledProvider(provider)** (Line 364)
- Returns `true` if provider is in `BUNDLED_PROVIDERS` set

**_seedBundledKeys()** (Lines 369-390)
- XOR decodes bundled keys (magic key: `0x5A`)
- Populates Cerebras and Groq key pools (lines 378-381)
- Logs decoding errors but continues operation

**_recordRequest(provider)** (Lines 393-395)
- Pushes timestamp to `_requestTimestamps[provider]` for RPM tracking

**_learnRPMFromHeaders(provider, headers)** (Lines 397-409)
- Extracts RPM from response headers (`x-ratelimit-limit-requests`, `ratelimit-limit`)
- Updates `_providerRPMPerKey[provider]` if between 0 and 10,000

**_getPerKeyRPM(provider)** (Lines 411-415)
- Returns learned RPM, falls back to default, final fallback 30 RPM

**getProactivePaceMs(provider)** (Lines 420-441)
- **Lines 420-426**: Calculates per-provider RPM and target RPM (85% of pool capacity)
- **Lines 428-432**: Sliding-window RPM calculation over past 60 seconds
- **Lines 434-440**: Returns milliseconds to wait before next request
- **Purpose**: Prevents hitting rate limits by distributing requests across quota

**getRecommendedPaceMs(provider)** (Lines 447-454)
- **Lines 448-449**: Tracks recent 429 errors in `_recent429Timestamps` (2-minute window)
- **Lines 451-455**: Returns recommended inter-tool delay based on error count (0ms/2s/5s/10s)

---

#### KEY MANAGEMENT

**setApiKey(provider, key)** (Lines 459-471)
- **Lines 460-468**: Parses cloudflare key format (`accountId:token`)
- **Line 470**: Marks provider as user-owned if key was explicitly set

**isUsingOwnKey(provider)** (Line 473)
- Returns `true` if provider key was user-supplied

**addKeyToPool(provider, key)** (Lines 477-485)
- Adds key to provider's pool if not already present
- Initializes pool if needed
- Sets as default key if no current key

**_getPoolKey(provider)** (Lines 487-509)
- **Lines 489-505**: Round-robin rotation through available pool keys
- **Lines 507-509**: Returns key with earliest cooldown expiry if all on cooldown

**_cooldownPoolKey(provider, key, durationMs)** (Lines 511-515)
- Marks specific key with cooldown expiry timestamp

**getPoolStatus(provider)** (Lines 517-522)
- Returns `{ total, available, onCooldown }` for pool monitoring

---

#### PROVIDER CATALOG METHODS

**getConfiguredProviders()** (Lines 526-537)
- Returns array of providers with configured API keys
- Includes Ollama if available

**getAllProviders()** (Lines 539-547)
- Returns all providers with metadata: `provider`, `label`, `hasKey`, `isFree`

**_getProviderLabel(provider)** (Line 549)
- Returns human-readable provider name

**_getProviderModels(provider)** (Line 552)
- Returns model array for provider

**_getEndpoint(provider)** (Lines 554-562)
- returns endpoint config
- **Lines 558-560**: Special handling for Cloudflare (substitutes account ID)

**_supportsVision(provider, model)** (Lines 564-574)
- For Ollama: regex test of model name
- For others: checks `VISION_MODELS[provider]` list

**_getModelContextLimit(provider, model)** (Line 576)
- Returns context limit from `CONTEXT_LIMITS` or default 32,768

---

#### OLLAMA DETECTION

**detectOllama()** (Lines 580-618)
- **Lines 581-583**: 30-second cache check
- **Lines 585-611**: HTTP request to `localhost:11434/api/tags`
- **Lines 606-609**: Parses response into `_ollamaModels` array
- Returns boolean

**getOllamaModels()** (Line 621)
- Returns cached models array

**getOllamaVisionModels()** (Lines 623-626)
- Filters Ollama models by vision pattern

---

#### OPENROUTER LIVE CATALOG

**fetchOpenRouterModels()** (Lines 630-683)
- **Lines 631-633**: 10-minute cache check
- **Lines 635-665**: HTTPS request to OpenRouter API
- **Lines 655-660**: Filters out image/audio/blocked models
- **Lines 661-669**: Sorts: free models first, then by name
- Returns array of model objects with pricing info

---

#### CONTEXT TRIMMING

**_trimToContextLimit(messages, provider, model, maxTokens)** (Lines 687-724)
- **Purpose**: Last-resort auto-trim when summarization still exceeds context
- **Lines 688-690**: Calculates budget from context limit minus output reserve
- **Lines 691-700**: Measures total character length
- **Lines 702-706**: Extracts system (first) and user (last) messages
- **Lines 708-723**: Removes oldest middle messages until budget fits
- Logs trim event

---

#### PROXY ROUTING

**_generateViaProxy(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, sessionToken)** (Lines 728-759)
- Routes through guIDE server proxy for enforcing per-user quotas
- **Lines 730-738**: Builds request body
- **Lines 740-744**: Calls `_streamRequest` with graysoft.dev endpoint
- **Lines 745-752**: Catches quota errors and re-throws
- Falls back to direct API on proxy unreachable

---

#### MAIN GENERATION ENTRY POINT

**generate(prompt, options = {})** (Lines 756-862)
- **Lines 757-761**: Extracts options: provider, model, systemPrompt, onToken, onThinkingToken, conversationHistory, images, noFallback
- **Lines 763-765**: Validates provider and key
- **Lines 768-770**: Ollama route (local, no key needed)
- **Lines 773-779**: Proxy routing (bundled provider + session token + no images)
- **Lines 782-788**: Vision model warning if model doesn't support images
- **Lines 791-810**: Provider cooldown check with pool-based bypass
- **Lines 813-815**: Attempts with pool rotation
- **Lines 818-822**: Fallback chain on failure (unless `noFallback`)

**_attemptWithPoolRotation(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images, noFallback)** (Lines 825-880)
- **Lines 826-829**: Proactive pacing based on RPM budget
- **Lines 831-833**: Max retries = pool size (or 1)
- **Lines 835-879**: Retry loop with pool key rotation:
  - Records request timestamp
  - Attempts execution
  - On 429: rotates key or sets provider cooldown
  - On 403/5xx: sets longer cooldown and returns null for fallback
  - Non-retryable errors: throws

**_attemptFallbackChain(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images)** (Lines 883-942)
- Build fallback chain from `FALLBACK_ORDER`
- Attempts each provider's preferred model
- Handles rate limits per fallback provider
- Throws if all exhausted

---

#### PROVIDER ROUTING

**_executeGeneration(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images = [], overrideKey = null)** (Lines 945-986)
- **Lines 946-948**: Route to Ollama
- **Lines 950-952**: Route to APIFreeLLM (custom format)
- **Lines 953-955**: Route to Anthropic
- **Lines 958**: Route to OpenAI-compatible (24 providers)

---

#### OPENAI-COMPATIBLE GENERATION (Lines 959-1014)

**_generateOpenAICompatible(provider, apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = [])**
- **Lines 960-966**: Builds message array with system prompt
- **Lines 968-978**: Handles vision images (converts to `image_url` content blocks)
- **Lines 980-985**: Context trimming
- **Lines 987-994**: Request body JSON
- **Lines 996-1000**: Streams if `onToken` callback
- **Lines 1002-1011**: Non-streaming falls back to `_makeRequest`

---

#### ANTHROPIC GENERATION (Lines 1016-1071)

**_generateAnthropic(apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = [])**
- **Lines 1017-1019**: Builds message array (no system in messages array)
- **Lines 1021-1041**: Handles vision images (base64 conversion with media type parsing)
- **Lines 1043-1051**: Request body (system prompt is separate field)
- **Lines 1053**: Custom headers: `x-api-key` and anthropic version
- **Lines 1055-1058**: Streams if callback
- **Lines 1060-1070**: Non-streaming response parsing

---

#### OLLAMA GENERATION (Lines 1073-1146)

**_generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = [])**
- **Lines 1075-1085**: Builds message array, handles images as base64
- **Lines 1087-1093**: Request body with NDJSON stream flag
- **Lines 1095-1146**: HTTP request to Ollama (localhost:11434):
  - Parses NDJSON response (`message.content` field)
  - Collects fullText and emits tokens
  - Returns on `done: true`
  - Calculates tokens as `fullText.length / 4`

---

#### APIFREELLM GENERATION (Lines 1148-1181)

**_generateAPIFreeLLM(apiKey, systemPrompt, prompt, options, onToken, conversationHistory = [])**
- **Lines 1151-1154**: 5-second throttle (free tier limit)
- **Lines 1159-1163**: Custom message format: `[System: ...]` + conversation history
- **Lines 1165-1174**: Non-streaming request, parses JSON response
- **Lines 1175-1178**: Custom 429 error message for free tier

---

#### HTTP REQUEST HELPERS

**_makeRequest(host, path, apiKey, body, extraHeaders = {}, provider = null)** (Lines 1183-1212)
- **Lines 1185-1191**: Builds headers (Authorization unless `x-api-key` provided)
- **Lines 1193-1207**: HTTPS request with 20-second timeout
- **Lines 1194-1195**: Learns RPM if status < 400
- **Lines 1196-1207**: Collects response, rejects on >= 400

**_rejectWithParsedError(reject, statusCode, data, source)** (Lines 1219-1250)
- Parses JSON error responses
- Special handling for:
  - 429: Rate limited
  - 404: Model not found
  - 400 with "decommission": Model decommissioned
  - 400 with "not enabled"/"developer instruction": System prompt not supported

**_streamRequest(host, path, apiKey, body, format, onToken, extraHeaders = {}, onThinkingToken = null, provider = null)** (Lines 1252-1365)
- **Lines 1252-1273**: Header setup
- **Lines 1275-1304**: Error handling for >= 400 status
- **Lines 1306-1365**: Stream handling:
  - First data timer: 20 seconds (line 1306-1312)
  - Idle timer: 10 seconds between tokens (line 1314-1325)
  - NDJSON parsing (lines 1328-1354)
  - Format-specific parsing: OpenAI (`choices[0].delta`), Anthropic (thinking/content blocks)
  - Token emission to callback and thinking token tracking

---

#### STATUS

**getStatus()** (Lines 1367-1375)
- Returns: `{ hasKeys, providers: [...], activeProvider, activeModel }`

**MODULE EXPORT** (Line 1378)
```javascript
module.exports = { CloudLLMService };
```

---

### ISSUES & OBSERVATIONS

1. **No request timeout protection on streaming besides timer** — If stream data arrives too slowly (every 10.1 seconds), could timeout prematurely depending on implementation
2. **Bundled key obfuscation is security-through-obscurity only** — XOR with fixed key is trivial to reverse; keys are still readable in source tree
3. **Context trimming happens client-side before proxy** — Proxy also trims, causing double-trim overhead
4. **RPM learning only on successful requests** — Failed requests don't update RPM, could cause underestimation
5. **Ollama detection runs on every chat if not cached** — Even with 30s TTL, could be high-frequency polling
6. **Fallback chain can be slow** — Sequential fallback attempts mean poor UX during widespread outages
7. **VISION_MODELS regex for Ollama is permissive** — Could falsely identify non-vision models as vision-capable
8. **No jitter in retry/cooldown timing** — Could cause thundering herd on 429 recovery

---

## File 2: browserManager.js

### FILE PURPOSE
Manages embedded BrowserView for web automation inside Electron IDE window. Provides snapshot-based DOM interaction (element refs), navigation, form filling, etc. Includes external Chrome automation via CDP.

---

### IMPORTS & CONSTANTS (Lines 1-31)
```javascript
const { BrowserView, BrowserWindow, shell } = require('electron'); // Lines 14-15
const http = require('http');           // Line 16
const path = require('path');           // Line 17
const { spawn } = require('child_process'); // Line 18
const os = require('os');               // Line 19
const fs = require('fs');               // Line 20
```

**Constants**:
- Line 24: `MIN_Y = 36` — BrowserView min Y (title bar height)
- Line 25: `MAX_REFS = 250` — Max element refs in snapshot
- Line 26: `MAX_TEXT_NODES = 40` — Max text-only nodes
- Line 27: `SETTLE_DOM_MS = 300` — DOM stability window
- Line 28: `CDP_PORT = 9222` — Chrome DevTools Protocol port

**SNAPSHOT_SCRIPT** (Lines 31-166)
- JavaScript injected into page to:
  - Add `data-gref` attributes to interactive elements
  - Build text representation with refs
  - Track interactive roles (link, button, input, textarea, select, etc.)
  - Limit to MAX_REFS and MAX_TEXT_NODES

---

### CLASS: BrowserManager

#### CONSTRUCTOR (Lines 170-187)
- `browserView`: null
- `parentWindow`: null
- `isVisible`: false
- `currentUrl`: ''
- `history`: [], `historyIndex`: -1
- `chromeProcess`: null
- `externalMode`: false
- `cdpPort`: CDP_PORT
- `_resizeHandler`: null (for cleanup)

#### initialize(parentWindow) (Lines 189-191)
- Stores parent window reference

---

#### NAVIGATION

**navigate(url, parentWindow)** (Lines 195-250)
- **Lines 197-199**: URL validation (requires http/https prefix)
- **Lines 201-204**: URL parsing validation
- **Lines 206-210**: Parent window resolution
- **Lines 213-237**: BrowserView creation on first use:
  - Security settings: contextIsolation, sandbox, webSecurity enabled
  - Window open handler: deny (line 218)
  - Navigation handler: enforce http/https only (lines 219-227)
  - Event listeners: did-navigate, did-navigate-in-page, page-title-updated, did-start-loading, did-stop-loading
- **Lines 239-241**: Load URL and wait for settle (2 seconds)
- **Lines 243-250**: History management, state notification, error handling

**goBack()** (Lines 252-261)
- Checks `canGoBack()`, calls `goBack()`, waits for settle

**goForward()** (Lines 263-272)
- Checks `canGoForward()`, calls `goForward()`, waits for settle

**reload()** (Lines 274-281)
- Calls `reload()`, waits for settle (2 seconds)

---

#### VISIBILITY & POSITIONING

**show(bounds)** (Lines 285-305)
- Validates bounds (function `_validateBounds`)
- Sets BrowserView bounds
- Attaches resize handler if first call
- Handler keeps BrowserView proportional to parent window

**hide()** (Lines 307-320)
- Moves BrowserView off-screen (`x: -9999`)
- Removes resize handler

**setBounds(bounds)** (Lines 322-332)
- Validates and applies bounds only if changed

**_validateBounds(bounds)** (Lines 334-345)
- Ensures: x >= 0, y >= MIN_Y, width >= 200, height >= 200
- Clamps to parent window size

---

#### SNAPSHOT (Lines 347-404)

**getSnapshot()** (Lines 347-404)
- Executes SNAPSHOT_SCRIPT injected into page
- **Lines 355-358**: Counts `[ref=` occurrences
- **Lines 360-362**: SPA retry logic — waits 1.5s and retries if 0 elements
- **Lines 364-367**: Builds result with URL, title, element count

**_buildSnapshotResult(wc, snapshot, elementCount)** (Lines 369-378)
- Formats snapshot header with title and URL

---

#### ELEMENT REFERENCE RESOLUTION

**_resolveRef(selectorOrRef)** (Lines 380-386)
- Converts `"ref=5"` or `"5"` to `[data-gref="5"]` selector

**_expandSelector(selector)** (Lines 388-400)
- For CSS selectors: returns as-is
- For bare words: expands to multiple patterns:
  - Bare word
  - `[name="word"]`
  - `#word`
  - `input[name="word"]` / `textarea[name="word"]`
  - `.word`
  - `[id="word"]`
  - `[aria-label*="word" i]`
  - `[placeholder*="word" i]`

---

#### CLICK (Lines 402-476)

**click(selectorOrRef)** (Lines 402-447)
- Resolves ref to `[data-gref=X]` selector
- Attempts click, returns hint if ref not found
- Falls back to CSS selector expansion with 3 retry attempts (500ms delay)

**_clickBySelector(wc, selector)** (Lines 449-476)
- Executes JavaScript to:
  - Find element by selector
  - Scroll into view (center)
  - Dispatch mousedown, mouseup, click events
  - Call `.click()` on element
  - Submit parent form if button/submit type
- Returns element info (tag, text, role)
- Waits 100ms, then settles DOM (800ms)

---

#### TYPE (Lines 478-514)

**type(selectorOrRef, text)** (Lines 478-495)
- Resolves ref or selector
- Falls back to selector expansion
- Attempts by selector with 3 retries

**_typeIntoSelector(wc, selector, text)** (Lines 497-514)
- Executes JavaScript to:
  - Find element, scroll into view, focus
  - Clear value
  - Call `insertText(text)`
  - Dispatch `input` and `change` events

---

#### PRESS KEY (Lines 516-543)

**pressKey(key)** (Lines 516-543)
- Maps key names to key codes (enters → Return, tab → Tab, etc.)
- Sends keyDown, char, keyUp events
- Waits 100ms, settles DOM (1 second)

---

#### HOVER (Lines 545-568)

**hover(selectorOrRef)** (Lines 545-568)
- Resolves ref or selector
- Executes JavaScript to dispatch mouseover and mouseenter events

---

#### SELECT OPTION (Lines 570-596)

**selectOption(selectorOrRef, value)** (Lines 570-596)
- Finds `<select>` element
- Matches option by value or text
- Dispatches change event

---

#### SCREENSHOT (Lines 598-609)

**screenshot()** (Lines 598-609)
- Captures page to image
- Returns data URL, width, height

---

#### CONTENT & EVALUATE (Lines 611-641)

**getContent(selector, html = false)** (Lines 611-628)
- Executes JavaScript to get `innerHTML` (if html) or `innerText`
- Returns content, URL, title

**evaluate(code)** (Lines 630-641)
- Executes arbitrary JavaScript
- Returns stringified result

---

#### WAITING (Lines 643-694)

**waitForSelector(selector, timeout = 5000)** (Lines 643-672)
- Executes JavaScript:
  - Checks if element exists now
  - Otherwise, observes DOM mutations with timeout
  - Returns boolean

**waitForPageSettle(maxMs = 1500)** (Lines 674-694)
- Waits for document ready state or timeout
- Uses MutationObserver for DOM stability
- Default settle time: SETTLE_DOM_MS (300ms)

---

#### INTERACTIVE ELEMENT LISTING (Lines 696-764)

**listInteractiveElements()** (Lines 696-764)
- Executes JavaScript to find all interactive elements
- Returns up to 100 elements with: tag, type, name, id, class, text, placeholder, role, aria-label, href, value, selector

---

#### STATE (Lines 766-784)

**_notifyStateChange(url, title)** (Lines 766-780)
- Sends IPC message to renderer: `browser-state-changed`
- Includes: url, title, canGoBack, canGoForward, isLoading

**getState()** (Lines 782-791)
- Returns current browser state

---

#### EXTERNAL CHROME AUTOMATION (Lines 793-862)

**launchExternalChrome(url)** (Lines 793-828)
- Finds Chrome executable on system
- Spawns with `--remote-debugging-port=9222`
- Returns mode: default_browser or external_chrome

**sendCDP(method, params = {})** (Lines 830-838)
- Requests `/json` from CDP port
- Returns target list

**_cdpRequest(endpoint)** (Lines 840-849)
- HTTP GET to localhost:9222
- Returns parsed JSON

**_findChromePaths()** (Lines 851-865)
- Platform-specific Chrome executable paths (Windows, macOS, Linux)

---

#### CLEANUP (Lines 867-884)

**_getWebContents()** (Line 867)
- Returns BrowserView webContents or null

**dispose()** (Lines 871-884)
- Removes BrowserView from parent window
- Removes resize handler
- Destroys webContents
- Kills external Chrome process if running

---

### ISSUES & OBSERVATIONS

1. **DOM snapshot is single-threaded** — SNAPSHOT_SCRIPT blocks on large DOMs
2. **No scroll synchronization** — Element refs based on current viewport; scrolling changes positions but refs remain static
3. **MAX_REFS/MAX_TEXT_NODES are global** — No per-frame distribution; large sites hit limits quickly
4. **Click/type don't validate focus or blur events** — Could miss framework-specific behaviors
5. **No network interception** — Can't block ads, tracking, or payloads
6. **External Chrome CDP is incomplete** — `sendCDP()` doesn't actually send commands, only lists targets
7. **Resize handler stays attached even if BrowserView hidden** — Wastes event loop cycles

---

## File 3: playwrightBrowser.js

### FILE PURPOSE
Playwright-based browser automation with multiple snapshot strategies (DOM walk, accessibility tree, ariaSnapshot), reliable interaction via Playwright's native event system, multi-tab support, dialog handling, form filling, network inspection.

---

### IMPORTS & LAZY-LOADING (Lines 1-21)
```javascript
const path = require('path');           // Line 16
const fs = require('fs');               // Line 17
const os = require('os');               // Line 18
let _chromium = null;                   // Line 21
function getChromium() {                // Lines 22-24
  if (!_chromium) _chromium = require('playwright-core').chromium;
  return _chromium;
}
```

**Constants**:
- Lines 27-31: Cache/snapshot config
  - `SNAPSHOT_CACHE_TTL = 1500` — Snapshot freshness
  - `MAX_REFS = 800`, `MAX_TEXT_NODES = 200` — Higher than BrowserManager
  - `MAX_CHILD_FRAMES = 3` — iFrame traversal limit
  - `CONSOLE_LOG_CAP = 500`, `SNAPSHOT_BUDGET = 8000` — Storage limits
- Lines 33-34: `SKIP_DOMAINS` regex (ads, tracking domains)
- Lines 36-43: `INTERACTIVE_ROLES` set (link, button, textbox, etc.)
- Lines 45-49: `STRUCTURAL_ROLES` set (heading, img, navigation, form, etc.)

---

### CLASS: PlaywrightBrowser

#### CONSTRUCTOR (Lines 53-68)
- `browser`, `context`, `page`: Playwright instances
- `isLaunched`, `headless`: Browser state
- `consoleLog`: Captured console messages (max 500)
- `_pendingDialog`: Dialog handling
- `_pageSnapshotCache`, `_snapshotCacheTime`: Snapshot cache
- `parentWindow`: IPC reference

#### initialize(parentWindow) (Lines 70-72)
- Stores parent window reference

---

#### LAUNCH / CLOSE (Lines 74-149)

**launch(options = {})** (Lines 74-131)
- Checks if already launched, cleans up if not
- **Lines 87-99**: Launch options:
  - Headless mode configurable
  - Executable path auto-detection
  - Args: disable automation detection, disable blink features, no first run, no sandbox
- **Lines 101-110**: Context options:
  - Viewport: 1280x900
  - User-Agent: Chrome 131 on Windows
  - Locale: en-US, timezone: America/New_York
  - Ignore HTTPS errors: false, JavaScript enabled, bypass CSP: false
- **Lines 112-118**: Launch sequence:
  - Launch browser
  - Create context
  - Create or retrieve first page
  - Setup listeners on all new pages
- **Lines 119-131**: Fallback if custom executable fails (try bundled)

**close()** (Lines 133-135)
- Calls `_cleanup()`

**_cleanup()** (Lines 137-149)
- Closes context, browser
- Clears cache, console log, dialog state
- Sets all references to null

---

#### PAGE LISTENERS (Lines 151-194)

**_setupPageListeners(page)** (Lines 151-187)
- Console handler: Captures message type, text, timestamp (max 500 messages)
- Dialog handler:
  - Stores dialog info in `_pendingDialog`
  - Auto-dismisses after 3 seconds if not handled
- Crash handler: Logs error
- Frame navigation handler: Invalidates snapshot on main frame nav

**_invalidateSnapshot()** (Lines 189-192)
- Clears snapshot cache

**_notifyStateChange(page)** (Lines 194-207)
- Sends IPC: `browser-state-changed` with url, title, flags

---

#### PAGE STABILITY (Lines 209-232)

**_waitForPageStable(page, timeout = 1500)** (Lines 209-232)
- Waits for `networkidle` (swallows errors)
- Evaluates JavaScript:
  - Sets deadline (timeout ms)
  - Observes mutations, clears timer on mutation
  - Resets timer if 150ms quiet
  - Resolves on deadline or 150ms stable

---

#### AUTO-DISMISS HELPERS (Lines 234-320)

**_dismissCookieBanners(page)** (Lines 234-274)
- Evaluates JavaScript to find and click accept buttons
- Selectors include: `#onetrust-accept-btn-handler`, `.CybotCookiebotDialogBodyButton`, etc.
- Waits 300ms after dismiss

**_dismissOverlayPopups(page)** (Lines 276-320)
- Finds modal/dialog containers
- Looks for close/dismiss buttons
- Fallback: removes high-z-index overlays with "browser not supported" text
- Waits 300ms after dismiss, invalidates snapshot

---

#### ENSURE BROWSER READY (Lines 322-337)

**_ensureBrowser()** (Lines 322-337)
- Launches if not running
- Recreates page if closed
- Returns page or throws

---

#### NAVIGATION (Lines 339-428)

**navigate(url)** (Lines 339-373)
- Normalizes URL (adds https:// if missing)
- Launches browser if needed
- **Lines 352-354**: Waits for domcontentloaded (15s timeout)
- **Lines 355-356**: Waits for page stable
- **Lines 358-359**: Auto-dismisses cookie/overlay popups
- **Lines 361-371**: Extracts page text inline (up to 2000 chars)
- Returns: url, title, pageText, message

**goBack()** (Lines 375-382)
- Navigates back, invalidates snapshot

**goForward()** (Lines 384-391)
- Navigates forward, invalidates snapshot

**reload()** (Lines 393-400)
- Reloads, invalidates snapshot

---

#### SNAPSHOT (Lines 402-584)

**getSnapshot()** (Lines 402-450)
- Implements 3-strategy fallback:
  1. DOM walk (line 424): Sets data-gref, builds text tree
  2. Accessibility tree (line 436): Falls back if DOM < 3 elements
  3. ariaSnapshot (line 448): Falls back if still < 3 elements
- Enriches with supplementary info (lines 451)
- Caches result for 1.5 seconds
- Returns: success, snapshot, url, title, elementCount

**_enrichSnapshot(page, url, title, snapshotText)** (Lines 452-523)
- **Lines 453-462**: Extracts visible links (up to 30)
- **Lines 464-483**: Extracts key buttons from main frame + first 5 iFrames
- **Lines 485-502**: Extracts viewport-visible text
- **Lines 504-518**: Extracts iframe content (max 5 iframes)
- **Lines 520**: Budgets 8000 chars total with supplements taking priority

---

#### SNAPSHOT STRATEGIES (Lines 525-841)

**_injectRefsIntoAriaSnapshot(ariaText)** (Lines 525-553)
- Parses ariaSnapshot YAML output
- Injects `[ref=N]` before interactive/structural roles
- Returns: text with refs, count

**_getAccessibilityTreeSnapshot(page)** (Lines 555-610)
- Calls Playwright's `page.accessibility.snapshot()`
- Walks tree recursively
- Adds refs to interactive/structural roles
- Builds text representation with metadata (value, checked, pressed, disabled, expanded, level)

**_getDomWalkSnapshot(page)** (Lines 612-841)
- Walks all frames (main + up to 3 iFrames)
- For each frame, evaluates JavaScript to:
  - Remove previous `data-gref` attributes
  - Walk DOM, assigning refs to interactive/structural elements
  - Extract text nodes
  - Return: text, refCounter, textCounter
- Handles frame evaluation timeouts (5s main, 2s other)
- Accumulates all frame results

**getRole(el)** (nested in _getDomWalkSnapshot)
- Checks: role attribute, HTML tag mapping, input type, contenteditable
- Comprehensive role assignment

**getName(el)** (nested)
- Priority: aria-label → aria-labelledby → associated label → alt/title/placeholder → text content

**isVisible(el)** (nested)
- Checks: offsetWidth/Height > 0, display !== none, opacity > 0

**isInteractive(el)** (nested)
- Tag check: a, button, input, textarea, select, summary
- Role check: interactive roles
- Tabindex, contenteditable, onclick, cursor:pointer

**walk(el, indent)** (nested)
- Recursive tree traversal
- Assigns refs to interactive/structural elements
- Extracts text nodes with character limits

---

#### REF RESOLUTION (Lines 843-873)

**_resolveRef(refStr)** (Lines 843-847)
- Parses `"5"` or `"ref=5"` to numeric ref

**_getLocatorForRef(page, ref)** (Lines 849-873)
- **Lines 853-860**: Strategy 1 — searches all frames for `[data-gref="ref"]`
- **Lines 862-873**: Strategy 2 — nth interactive element by DOM order
- Returns first visible locator or null

---

#### CLICK (Lines 875-953)

**click(refStr, options = {})** (Lines 875-931)
- Resolves ref number
- Gets locator for ref
- Fallback to text-based click if ref not found
- Handles new tab opened by click
- Waits for page stable, dismisses overlays
- Returns element info

**_clickByText(page, text, options = {})** (Lines 933-953)
- Tries strategies in order:
  1. Button role with text
  2. Link role with text
  3. Tab role with text
  4. MenuItem role with text
  5. Generic text match
- Returns first visible match

---

#### TYPE (Lines 955-1023)

**type(refStr, text, options = {})** (Lines 955-999)
- Resolves ref
- Gets locator
- Slowly option: sequential keystroke with 50ms delay
- Normally: fill entire text at once
- Submit option: press Enter
- Invalidates snapshot

**_typeByName(page, name, text, options = {})** (Lines 1001-1023)
- Tries strategies: textbox, searchbox, combobox, placeholder matching
- Finds first visible input
- Same slowly/submit options

---

#### FILL FORM (Lines 1025-1055)

**fillForm(fields)** (Lines 1025-1055)
- Processes array of `{ ref, type, value }`
- For checkbox: check/uncheck based on value
- For radio: check
- For combobox: selectOption with label
- Otherwise: fill text
- Returns results array

---

#### SELECT OPTION (Lines 1057-1076)

**selectOption(refStr, values)** (Lines 1057-1076)
- Gets locator, calls selectOption with values array

---

#### HOVER (Lines 1078-1095)

**hover(refStr)** (Lines 1078-1095)
- Gets locator, calls hover()
- Returns element info

---

#### PRESS KEY (Lines 1097-1119)

**pressKey(key)** (Lines 1097-1119)
- Maps key names (enter, tab, escape, arrows, etc.)
- Calls page.keyboard.press()
- Waits 300ms, invalidates snapshot

---

#### DRAG (Lines 1121-1140)

**drag(startRef, endRef)** (Lines 1121-1140)
- Resolves both refs
- Gets both locators
- Calls `dragTo()` on start

---

#### SCROLL (Lines 1142-1155)

**scroll(direction = 'down', amount = 500)** (Lines 1142-1155)
- Evaluates JavaScript to window.scrollBy()
- Invalidates snapshot

---

#### EVALUATE (Lines 1157-1181)

**evaluate(code, refStr)** (Lines 1157-1181)
- If refStr: gets locator and evaluates on element
- Otherwise: page-level evaluation
- Returns stringified result

---

#### SCREENSHOT (Lines 1183-1201)

**screenshot(options = {})** (Lines 1183-1201)
- Optional ref for element screenshot
- Returns data URL, dimensions

---

#### WAIT FOR (Lines 1203-1233)

**waitFor(options = {})** (Lines 1203-1233)
- Options: text, textGone, time, selector
- Implements visibility waits with timeout

---

#### CONTENT (Lines 1235-1336)

**getUrl()** (Lines 1235-1241)
- Returns url, title

**getContent(selector, html = false)** (Lines 1243-1274)
- No selector: gets body innerHTML/innerText
- With selector: evaluates JavaScript to extract multiple matches
- Limits to 5 HTML nodes or 30 text nodes

**getLinks(selector)** (Lines 1276-1289)
- Evaluates JavaScript to extract all links from selector or body
- Limits to 100, returns: href, text, title

---

#### DIALOG HANDLING (Lines 1291-1310)

**handleDialog(accept, promptText)** (Lines 1291-1310)
- Accepts or dismisses pending dialog
- Optional prompt text for prompt dialogs
- Clears pending dialog reference

---

#### TAB MANAGEMENT (Lines 1312-1365)

**tabs(action, index)** (Lines 1312-1365)
- Action: list, new, close, select
- List: returns all tabs with url, title, active status
- New: creates new page
- Close: closes tab at index or current
- Select: switches to tab at index

---

#### CONSOLE MESSAGES (Lines 1367-1378)

**getConsoleMessages(level = 'info')** (Lines 1367-1378)
- Filters by level: error, warning, info, debug
- Returns last 100 messages

---

#### FILE UPLOAD (Lines 1380-1397)

**uploadFiles(refStr, filePaths)** (Lines 1380-1397)
- Gets locator for input element
- Calls `setInputFiles()` with paths

---

#### RESIZE (Lines 1399-1408)

**resize(width, height)** (Lines 1399-1408)
- Sets viewport size

---

#### NETWORK REQUESTS (Lines 1410-1429)

**getNetworkRequests(includeStatic = false)** (Lines 1410-1429)
- Evaluates JavaScript: `performance.getEntriesByType('resource')`
- Filters static resources (img, css, font, script) unless includeStatic
- Returns: url, type, duration, size

---

#### STATE (Lines 1431-1440)

**getState()** (Lines 1431-1440)
- Returns: isVisible, url, title, canGoBack, canGoForward, isLoading, isPlaywright flag

---

#### CHROMIUM DISCOVERY (Lines 1442-1479)

**_findChromium()** (Lines 1442-1479)
- Platform-specific paths (Windows: 4 paths, macOS: 4 paths, Linux: 7 paths)
- Checks existence, returns first found
- Falls back to Playwright bundled if none found

---

#### CLEANUP (Lines 1481-1484)

**dispose()** (Line 1481-1484)
- Calls `_cleanup()`

---

### ISSUES & OBSERVATIONS

1. **Multi-frame snapshot is expensive** — Evaluating each frame sequentially could timeout on slow pages
2. **Accessibility tree snapshot is unreliable on SPAs** — Might not capture dynamic content
3. **Reference injection isn't stable** — Refs change after page mutations
4. **No request/response interception** — Can't modify or block network traffic
5. **Console log has no filtering** — Captures and stores all messages (could be GB on long sessions)
6. **Dialog auto-dismiss timeout is fixed 3s** — No escape for slow dialogs
7. **Frame boundary detection relies on URL** — about:blank iframes are skipped, losing content
8. **No performance profiling** — Can't measure page metrics
9. **Screenshot doesn't capture entire page by default** — Only viewport visible

---

## File 4: webSearch.js

### FILE PURPOSE
DuckDuckGo HTML-based web search with no API keys required. SSRF protection, cached results (5 min), max 100 entries. Page content extraction with automatic resource cleanup.

---

### IMPORTS & CONSTANTS (Lines 1-16)
```javascript
const https = require('https');         // Line 6
const http = require('http');           // Line 7
const log = require('./logger');        // Line 8
```

**USER_AGENTS** (Lines 10-14)
- 4 browser user-agents (Chrome/Firefox on Windows, macOS)

**PRIVATE_URL_RE** (Line 16)
- Regex to block private/local URLs: localhost, 127.*, 10.*, 192.168.*, 172.16-31.*

---

### CLASS: WebSearch

#### CONSTRUCTOR (Lines 19-22)
- Random user-agent selection
- `_cache`: Map for results
- `_cacheTTL`: 5 minutes

#### PUBLIC API

**search(query, maxResults = 5)** (Lines 27-37)
- Cache check: `search:${query}:${maxResults}`
- Fetches from `https://html.duckduckgo.com/html/`
- Parses results, caches, returns

**fetchPage(url)** (Lines 39-52)
- Cache check: `page:${url}`
- Fetches page, extracts title + main content
- Returns: url, title, content, fetchedAt

**searchCode(query)** (Lines 54-57)
- Searches with site filters: stackoverflow.com, developer.mozilla.org, github.com

---

#### DDG PARSER (Lines 59-83)

**_parseDDGResults(html, maxResults)** (Lines 59-83)
- Extracts links from `<a class="result__a">` tags (regex line 60)
- Extracts snippets from `<a class="result__snippet">` tags (regex line 61)
- Decodes redirect URLs
- Returns: results (title, url, snippet, position), query, totalResults

---

#### HTTP FETCH WITH SSRF PROTECTION (Lines 85-149)

**_fetch(url, maxRedirects = 5, retryCount = 0, triedAgents = new Set())** (Lines 85-149)
- **Lines 88-90**: SSRF blocking — rejects URLs matching `PRIVATE_URL_RE`
- **Lines 94-95**: User-agent rotation (unused agents tried first)
- **Lines 97-113**: Request options with headers (User-Agent, Accept, DNT, Cache-Control, Sec-Fetch headers)
- **Lines 117-120**: Redirect handling (3xx with location header)
- **Lines 122-125**: 202 retry with exponential backoff (up to 5 retries)
- **Lines 127-135**: Non-200 status triggers UA rotation or backoff retry
- **Lines 137-148**: Data collection and resolve
- **Lines 151-153**: Error handling with UA rotation or backoff

---

#### CACHE (Lines 155-168)

**_cacheGet(key)** (Lines 155-160)
- Checks TTL (5 minutes)
- Deletes expired entries

**_cacheSet(key, data)** (Lines 162-168)
- Stores with timestamp
- Evicts oldest entry if cache > 100 items

---

#### STANDALONE HELPERS (Lines 170-226)

**_decodeRedirectUrl(url)** (Lines 170-175)
- Decodes DuckDuckGo redirect format: `uddg=BASE64_URL`
- Falls back to URL parsing for http/https/protocol-relative

**_stripHtml(html)** (Lines 177-185)
- Removes tags, decodes entities (&amp;, &lt;, etc.)
- Collapses whitespace

**_extractTitle(html)** (Lines 187-190)
- Extracts from `<title>` tag

**_extractMainContent(html)** (Lines 192-226)
- **Lines 193-197**: Removes script, style, nav, header, footer, aside tags
- **Lines 199-202**: Extracts main/article/content-id div
- **Lines 204-208**: Preserves code blocks (replaces with placeholder)
- **Lines 210-212**: Strips remaining HTML
- **Lines 213-214**: Restores code blocks
- **Lines 215-216**: Collapses blank lines, limits to 5000 chars

---

### ISSUES & OBSERVATIONS

1. **No request timeout on retries** — Could hang indefinitely with slow servers
2. **UA rotation is not randomized** — Fixed order could be fingerprinted
3. **SSRF regex is IPv6-incomplete** — Doesn't block ::1, fc00::/7, etc.
4. **Content extraction loses structure** — No semantic markup preservation
5. **Code block preservation is fragile** — Placeholders could conflict with user content
6. **No robots.txt respect** — Could violate site policies
7. **Cache key is unversioned** — Query changes invalidate entire cache

---

## File 5: imageGenerationService.js

### FILE PURPOSE
Multi-backend image/video generation: Pollinations (free, FLUX), Google Gemini, A1111/Forge (local), ComfyUI (local), plus video via Seedance/Wan/Grok-Video.

---

### IMPORTS (Lines 1-4)
```javascript
const https = require('https');         // Line 3
const http = require('http');           // Line 4
```

---

### CLASS: ImageGenerationService

#### CONSTRUCTOR (Lines 8-21)
- `_providers`: Pollinations (free, no key), Google (requires key)
- `_videoModels`: Seedance, Wan, Grok-Video (all free)
- Key pools: `_googleKeys`, `_pollinationsKeys` with cooldown tracking
- Local gen detection: `_localGenType` (null/false/a1111/comfyui), `_localGenLastCheck`

#### KEY POOL MANAGEMENT (Lines 23-42)
- `addGoogleKey(k)`, `addPollinationsKey(k)`: Add keys to pools
- `_nextKey(keys, idx, cooldowns)`: Round-robin with cooldown bypass
- `_getNextGoogleKey()`, `_getNextPollinationsKey()`: Get next available key
- `_cooldownGoogleKey(k, ms = 60000)`, `_cooldownPollinationsKey(k, ...)`: Mark key with cooldown

---

#### MAIN GENERATE (Lines 45-90)

**generate(prompt, options = {})** (Lines 45-90)
- **Lines 46-48**: Extracts dimensions, preference
- **Lines 50-51**: Refreshes local gen detection if needed
- **Lines 53-68**: Builds provider order:
  - If pref: use it
  - Else: local A1111/ComfyUI, then Pollinations, then Google
- **Lines 70-84**: Attempts each provider in order, returns first success

---

#### LOCAL GEN DETECTION (Lines 92-102)

**_refreshLocalGen()** (Lines 92-102)
- **Lines 93-95**: 60-second cache check
- **Lines 96-102**: HTTP probes:
  - A1111: GET `localhost:7860/sdapi/v1/samplers` (status 200)
  - ComfyUI: GET `localhost:8188/system_stats`

---

#### A1111 / FORGE (Lines 104-130)

**_genA1111(prompt, width, height, opts)** (Lines 104-130)
- **Lines 105-107**: Rounds dimensions to 64px increments (max 1536)
- **Lines 108-109**: Negative prompt default
- **Lines 110-113**: Request body with steps, cfg_scale, sampler
- **Lines 114-127**: HTTP POST to `localhost:7860/sdapi/v1/txt2img` (timeout: 180s)
- **Lines 118-125**: Parses response JSON, extracts base64 image

---

#### COMFYUI (Lines 132-196)

**_genComfyUI(prompt, width, height, opts)** (Lines 132-196)
- **Lines 133-139**: Fetches checkpoint list from `localhost:8188`
- **Lines 140-142**: Rounds dimensions, generates seed
- **Lines 143-153**: Builds workflow JSON with nodes:
  - KSampler (node 3): seed, steps, cfg, sampler
  - CheckpointLoaderSimple (node 4): checkpoint name
  - EmptyLatentImage (node 5): width, height, batch
  - CLIPTextEncode (nodes 6-7): positive/negative prompts
  - VAEDecode (node 8): decode latents
  - SaveImage (node 9): save output
- **Lines 154-160**: POST workflow to `localhost:8188/prompt` to get prompt_id
- **Lines 161-180**: Polls `localhost:8188/history/{promptId}` every 2 seconds (timeout: 180s)
- **Lines 181-184**: Fetches image from `localhost:8188/view?filename=...` as binary
- **Lines 185-186**: Returns base64-encoded PNG

---

#### POLLINATIONS (Lines 188-219)

**_genPollinations(prompt, width, height, opts)** (Lines 188-219)
- **Lines 189-193**: Builds URL: `https://image.pollinations.ai/prompt/...`
- Query params: width, height, model (default flux), nologo, seed
- **Lines 194-213**: HTTPS GET with 90-second timeout
- **Lines 198-202**: Follows redirects (3xx)
- **Lines 203-210**: Collects response binary, validates size > 1000 bytes
- **Lines 211**: Detects MIME type from response header

---

#### GOOGLE GEMINI (Lines 221-260)

**_genGemini(prompt, width, height, opts)** (Lines 221-260)
- **Lines 222-223**: Gets next available Google key
- **Lines 224-228**: Request body: `generateContent` with IMAGE/TEXT response modes
- **Lines 229-257**: HTTPS POST with 60-second timeout
- **Lines 237-238**: 429 triggers key cooldown (60s)
- **Lines 239-244**: Parses response, extracts inlineData (base64 + MIME type)

---

#### VIDEO GENERATION (Lines 262-361)

**generateVideo(prompt, options = {})** (Lines 262-281)
- Requires Pollinations key
- Tries in order: seedance, veo (but only seedance is listed in _videoModels)
- Falls back through available models

**_genVideo(prompt, model, opts = {})** (Lines 283-361)
- **Lines 285-286**: Gets Pollinations key
- **Lines 287-301**: Builds URL path with `gen.pollinations.ai` endpoint
- **Lines 292-298**: Parses duration from prompt (e.g., "5 second video")
- **Lines 302-361**: HTTPS GET with 180-second timeout
- **Lines 309-310**: 401 (invalid key) / 402 (quota) / 429 (rate limit) handling
- **Lines 313-324**: Collects response, validates size > 5000 bytes
- **Lines 325-327**: Detects video MIME type

---

#### STATIC DETECTORS (Lines 363-461)

**detectImageRequest(message)** (Lines 363-420)
- **Lines 364-374**: Negative patterns (NOT image requests):
  - "draw conclusion", "paint picture", "design pattern", "analyze image", "write_file", etc.
- **Lines 376-383**: Strong positive patterns (IS image request):
  - "generate/create/make image", "text-to-image", etc.
- **Lines 385-388**: Weak patterns for short messages (draw, paint, visualize)
- Returns: `{ isImageRequest, extractedPrompt }`

**_extractPrompt(msg)** (Lines 390-399)
- Removes leading modals: "please", "can you", "could you", "would you"
- Strips action verbs: "generate", "create", "make", etc.
- Strips object phrases: "image of", "show me", etc.

**detectVideoRequest(message)** (Lines 402-425)
- Patterns: "generate/create video", "text-to-video", "animate", etc.
- Extracts duration if mentioned

**getStatus()** (Lines 428-440)
- Returns: providers list, Google key count, video availability, Pollinations key count, video models

---

### MODULE EXPORT (Line 442)
```javascript
module.exports = { ImageGenerationService };
```

---

### ISSUES & OBSERVATIONS

1. **A1111/ComfyUI assume 127.0.0.1 — no HTTPS/auth** — Insecure on networked machines
2. **ComfyUI polling is busy-wait** — 2-second intervals waste CPU
3. **No image format negotiation** — Always assumes PNG
4. **Dimension rounding to 64px could distort aspect ratio** — No preservation of proportions
5. **Video duration parsing is regex-fragile** — "2-3 seconds" won't parse
6. **Pollinations key rotation doesn't account for daily quotas** — All keys could be exhausted simultaneously
7. **No prompt sanitization** — Could pass malicious payloads to backends
8. **detectImageRequest patterns are English-only** — Non-English messages fail silently

---

## File 6: localImageEngine.js

### FILE PURPOSE
Spawns bundled stable-diffusion.cpp binary (GGUF quantized models) for local image generation. ASAR-aware binary path resolution. Supports CPU/CUDA/Vulkan backends.

---

### IMPORTS (Lines 13-18)
```javascript
const path = require('path');           // Line 13
const fs = require('fs');               // Line 14
const os = require('os');               // Line 15
const { spawn } = require('child_process'); // Line 16
const { EventEmitter } = require('events'); // Line 17
const log = require('./logger');        // Line 18
```

---

#### BINARY PATH RESOLUTION (Lines 21-33)

**_getBinaryPath()** (Lines 21-33)
- **Lines 22-25**: Platform-specific subdirs (win-x64, mac-arm64/x64, linux-x64)
- **Lines 27-28**: ASAR-aware path resolution:
  - Replaces `app.asar/` with `app.asar.unpacked/`
  - Allows access to unpacked binaries in asar archives
- Returns: `main/bin/{platform}/{sd[.exe]}`

---

### CLASS: LocalImageEngine extends EventEmitter

#### CONSTRUCTOR (Lines 37-40)
- `_activeProcess`: Subprocess reference for cancellation

#### PUBLIC METHODS

**checkAvailability()** (Lines 42-47)
- Checks if binary exists at computed path
- Returns: `{ available, binaryPath, error }`

**generate(params)** (Lines 49-136)
- Destructures:
  - prompt, modelPath, negativePrompt, steps (default 20), cfgScale (7.0)
  - width, height (default 512), seed (-1 = random)
  - backend (cpu/cuda/vulkan), samplingMethod (euler_a)
  - onProgress callback
- **Lines 57-61**: Input validation
- **Lines 62-68**: Binary availability check
- **Lines 70**: Temp output path: `tmp/guide-img-{timestamp}.png`
- **Lines 72-86**: Argument array construction:
  - Mode: img_gen
  - Model path, prompt, output path
  - Steps, cfg-scale, width, height, seed, sampling-method
  - Conditional: --negative-prompt, --use-cuda, --use-vulkan
- **Lines 88-136**: Subprocess execution:
  - **Lines 99-104**: stderr handler for progress parsing (regex: `step N/M`)
  - **Lines 106**: stdout handler (collects to stderr)
  - **Lines 108-116**: 10-minute timeout
  - **Lines 118-135**: On close:
    - Check exit code (0 = success)
    - Cleanup temp file on error
    - Read output image, base64-encode, cleanup
    - Return: `{ success, imageBase64, mimeType, prompt }`

**cancel()** (Lines 138-142)
- Kills subprocess with SIGTERM

---

### ISSUES & OBSERVATIONS

1. **No model validation** — Accepts any path, fails cryptically if model doesn't exist
2. **Timeout is hardcoded 10 minutes** — No way to override for large models
3. **stderr/stdout both written to stderr variable** — Log pollution
4. **No progress reporting after process spawn** — Callbacks only from stderr parsing
5. **Temp file not cleaned on cancellation** — Orphaned files on SIGTERM
6. **No VRAM/memory estimation** — Can OOM without feedback
7. **Backend flags blindly added** — No validation that GPU actually exists
8. **Sampling method not validated** — Invalid samplers fail at runtime

---

## SUMMARY OF ISSUES & VULNERABILITIES

### CRITICAL (Production Impact)

1. **cloudLLMService.js line 772-779**: Proxy routing falls back with warning but no retry — user sees silence
2. **browserManager.js line 31-166**: SNAPSHOT_SCRIPT doesn't handle shadow DOM — refs miss encapsulated content
3. **playwrightBrowser.js line 855-841**: Multi-frame snapshot can timeout frame evaluation — timeout too strict
4. **webSearch.js line 88-90**: SSRF regex misses IPv6 private ranges (::1, fc00::/7)
5. **imageGenerationService.js line 105-130**: A1111 communication unencrypted/unauthenticated — local network risk

### HIGH (Reliability Impact)

1. **cloudLLMService.js line 337-341**: Rate limiting state persists across requests — previous errors block future attempts
2. **playwrightBrowser.js line 1306-1312**: First data timeout of 20s global — no per-provider tuning
3. **browserManager.js line 462-476**: Click doesn't validate element is actually clickable — form submissions may fail
4. **imageGenerationService.js line 143-196**: ComfyUI polling is busy-wait with no backoff
5. **localImageEngine.js line 108**: 10-minute timeout kills slow generations without warning

### MEDIUM (Functional Impact)

1. **cloudLLMService.js line 687-724**: Context trimming removes messages without ordering by importance
2. **playwrightBrowser.js line 525-553**: ariaSnapshot parsing is fragile — invalid YAML breaks fallback
3. **webSearch.js line 170-175**: DDG redirect decoding doesn't validate decoded URL format
4. **browserManager.js line 380-386**: Element ref resolution doesn't handle dynamic refs changing mid-session
5. **imageGenerationService.js line 390-420**: detectImageRequest has no multi-language support — non-English fails

### LOW (Code Quality)

1. **cloudLLMService.js line 274-305**: XOR obfuscation is trivial to crack (not security)
2. **playwrightBrowser.js line 1442-1479**: Chromium discovery doesn't check executable permissions
3. **webSearch.js line 164-168**: Cache eviction removes oldest regardless of relevance
4. **imageGenerationService.js line 287-301**: Video duration parsing requires exact format
5. **localImageEngine.js line 99-104**: Progress regex uses case-insensitive match — unreliable on stderr

---

**Document Complete — 1,948 lines of audit detail covering all functions, logic flows, constants, imports, and identified issues across all 6 files.**

---

## Part 8b — FileSystem, Git, ImageGen, License, LiveServer, LLM, MCP, Memory, Model, Notebook

# DETAILED IPC HANDLERS AUDIT DOCUMENT
## Complete Line-by-Line Analysis

---

## FILE 1: fileSystemHandlers.js

### FILE PURPOSE
Provides IPC handlers for file system operations including read/write, directory operations, file searching with Prettier code formatting on save. Implements access control via `ctx.isPathAllowed()`, live reload notification, and incremental reindexing.

### IMPORTS
- Line 3: `const { ipcMain } = require('electron');` — Electron main process IPC module
- Line 4: `const path = require('path');` — Node.js path utilities
- Line 5: `const fs = require('fs').promises;` — Promise-based file system API

### IPC HANDLERS REGISTERED

**1. `read-file` (Line 26)**
- Parameters: `filePath` (string)
- Logic: Validates path access, reads file as UTF-8
- Return: `{ success: boolean, content?: string, error?: string }`
- Access control: `ctx.isPathAllowed(filePath)` checked first

**2. `write-file` (Line 31)**
- Parameters: `filePath` (string), `content` (string)
- Logic: 
  - Validates path access
  - Attempts Prettier formatting if extension in PRETTIER_EXTS set (lines 10-23)
  - Creates parent directories recursively
  - Writes file
  - Sends `files-changed` IPC event to renderer
  - Triggers incremental reindex if available
  - Notifies live-reload server
- Return: `{ success: boolean, error?: string }`
- Side effects: Multiple IPC sends and external handler calls

**3. `read-directory` (Line 50)**
- Parameters: `dirPath` (string)
- Logic: Reads directory entries with file type detection, stats for each entry
- Return: `{ success: boolean, items?: Array<{name, path, isDirectory, isFile, size, modified}>, error?: string }`
- Parallel processing: Uses `Promise.all()` for stats gathering

**4. `get-file-stats` (Line 72)**
- Parameters: `filePath` (string)
- Logic: Gets file stats via fs.stat
- Return: `{ success: boolean, size?, mtime?, isDirectory?, isFile?, error?: string }`

**5. `create-directory` (Line 80)**
- Parameters: `dirPath` (string)
- Logic: Creates directory recursively, triggers reindex
- Return: `{ success: boolean, error?: string }`

**6. `delete-file` (Line 85)**
- Parameters: `filePath` (string)
- Logic: Deletes file, triggers reindex, sends `file-deleted` IPC to renderer
- Return: `{ success: boolean, error?: string }`

**7. `delete-directory` (Line 95)**
- Parameters: `dirPath` (string)
- Logic: Recursively deletes directory with force flag, triggers reindex
- Return: `{ success: boolean, error?: string }`

**8. `copy-file` (Line 101)**
- Parameters: `src` (string), `dest` (string)
- Logic: Copies single file, triggers reindex on both paths
- Return: `{ success: boolean, error?: string }`
- Access control: Validates BOTH source and destination paths

**9. `copy-directory` (Line 110)**
- Parameters: `src` (string), `dest` (string)
- Logic: Recursively copies directory, triggers reindex
- Return: `{ success: boolean, error?: string }`
- Access control: Validates BOTH paths

**10. `move-file` (Line 119)**
- Parameters: `src` (string), `dest` (string)
- Logic: Uses fs.rename (atomic move), triggers reindex
- Return: `{ success: boolean, error?: string }`

**11. `rename-file` (Line 128)**
- Parameters: `oldPath` (string), `newPath` (string)
- Logic: Uses fs.rename, triggers reindex
- Return: `{ success: boolean, error?: string }`

**12. `file-exists` (Line 137)**
- Parameters: `filePath` (string)
- Logic: Attempts fs.access, if access denied returns false (not error)
- Return: `{ success: true, exists: boolean }`
- Note: Always returns success=true, no error field

**13. `list-directory` (Line 147)**
- Parameters: `dirPath` (string)
- Logic: Lists directory entries without stats (faster than read-directory)
- Return: `{ success: boolean, items?: Array<{name, isDirectory, isFile}>, error?: string }`

**14. `search-in-files` (Line 157-200)**
- Parameters: `rootPath` (string), `query` (string), `options?: {maxResults, isRegex, caseSensitive, wholeWord}`
- Logic:
  - Constructs RegExp from query (escapes special chars if not regex mode)
  - Recursively traverses directory starting from rootPath
  - Skips node_modules, .git, dist, build, .next, .cache (line 173)
  - Skips dot-directories
  - Skips files >1MB (line 186)
  - Only searches text file extensions (line 183-184)
  - Captures line number and match text (trimmed, first 200 chars)
  - Caps results at maxResults
- Return: `{ success: boolean, results?: Array<{file, relativePath, line, text}>, error?: string }`
- Max results default: 200

### PRETTIER INTEGRATION
- Lines 10-23: PRETTIER_EXTS set defines which extensions auto-format
- Line 24: Lazy-loads prettier module with try-catch fallback
- Lines 36-42: Calls prettier.format() with filepath parser detection
- Silent failure: If formatting fails, content saved as-is (line 41 comment)

### DEPENDENCIES
- `electron` IPC
- `prettier` (optional, lazy-loaded)
- `fs.promises` API
- `path` module

### POTENTIAL ISSUES

1. **Race condition in write-file**: Multiple concurrent writes to same file could cause formatting race or truncation. No file locking implemented.

2. **Prettier lazy-load performance**: First write-file call triggers module load, causing latency spike. Consider eager-loading on app start.

3. **Search-in-files regex vulnerability**: User-provided regex pattern could cause ReDoS (Regular Expression Denial of Service) if pattern is malicious. No timeout on regex execution.

4. **Path traversal in search**: While `..` is stripped (line 173), edge cases like URL-encoded paths or symlinks aren't blocked.

5. **Stats collection parallelism**: `Promise.all()` in read-directory (line 69) could fail if one entry is inaccessible. Should use `Promise.allSettled()`.

6. **File size check inadequate**: 1MB limit on text files could miss large but text source files (bundled code, logs).

7. **Silent live-reload failure**: Line 47 catches all errors from liveServerHandlers — no logging if notifyReload fails.

8. **Missing file encoding detection**: All files assumed UTF-8. Binary files or non-UTF-8 text will corrupt.

9. **Context dependency**: All handlers assume `ctx` object is fully populated. No validation that methods exist before calling.

10. **Directory recursion unbounded**: search-in-files traversal has no depth limit, could traverse very deep structures indefinitely.

---

## FILE 2: gitHandlers.js

### FILE PURPOSE
Provides IPC handlers for Git operations (status, diff, stage, commit, branches, merge) and AI-powered Git features (auto-generate commit messages, explain commits, merge conflict resolution, voice command parsing).

### IMPORTS
- Line 4: `const { ipcMain } = require('electron');` — Electron IPC

### IPC HANDLERS REGISTERED

**1. `git-status` (Line 6)**
- Parameters: None
- Logic: Calls `ctx.gitManager.getStatus()`
- Return: `{ files: Array, branch: string, error?: string }` (fallback object on error)
- Error handling: Returns empty files array and blank branch on error

**2. `git-diff` (Line 10)**
- Parameters: `filePath` (string), `staged` (boolean)
- Logic: Delegates to `ctx.gitManager.getDiff(filePath, staged)`
- Return: Pass-through from gitManager

**3. `git-stage` (Line 11)**
- Parameters: `filePath` (string)
- Logic: Stages single file
- Return: Pass-through from gitManager

**4. `git-stage-all` (Line 12)**
- Parameters: None
- Logic: Stages all modified files
- Return: Pass-through from gitManager

**5. `git-unstage` (Line 13)**
- Parameters: `filePath` (string)
- Logic: Unstages single file
- Return: Pass-through from gitManager

**6. `git-unstage-all` (Line 14)**
- Parameters: None
- Logic: Unstages all staged files
- Return: Pass-through from gitManager

**7. `git-discard` (Line 15)**
- Parameters: `filePath` (string)
- Logic: Discards changes to file (checkout -- filePath)
- Return: Pass-through from gitManager

**8. `git-commit` (Line 16)**
- Parameters: `message` (string)
- Logic: Creates commit with message
- Return: Pass-through from gitManager

**9. `git-log` (Line 17)**
- Parameters: `count` (number)
- Logic: Gets commit history
- Return: Pass-through from gitManager

**10. `git-branches` (Line 18)**
- Parameters: None
- Logic: Lists all branches
- Return: Pass-through from gitManager

**11. `git-checkout` (Line 19)**
- Parameters: `branch` (string)
- Logic: Checks out branch
- Return: Pass-through from gitManager

**12. `git-init` (Line 20)**
- Parameters: None
- Logic: Initializes git repository
- Return: Pass-through from gitManager

**13. `git-ahead-behind` (Line 21)**
- Parameters: None
- Logic: Gets ahead/behind counts relative to remote
- Return: Pass-through from gitManager

**14. `git-blame` (Line 23)**
- Parameters: `filePath` (string)
- Logic: Gets blame info for file
- Return: `{ success: boolean, blame?: any, error?: string }`
- Error handling: Wrapped with try-catch

**15. `git-push` (Line 31)**
- Parameters: `remote` (string), `branch` (string)
- Logic: Pushes branch to remote
- Return: `{ success: boolean, error?: string }`

**16. `git-pull` (Line 37)**
- Parameters: `remote` (string), `branch` (string)
- Logic: Pulls branch from remote
- Return: `{ success: boolean, error?: string }`

**17. `git-fetch` (Line 43)**
- Parameters: `remote` (string)
- Logic: Fetches from remote
- Return: `{ success: boolean, error?: string }`

**18. `git-create-branch` (Line 50)**
- Parameters: `name` (string), `checkout` (boolean)
- Logic: Creates branch, optionally checks it out
- Return: `{ success: boolean, error?: string }`

**19. `git-delete-branch` (Line 56)**
- Parameters: `name` (string), `force` (boolean)
- Logic: Deletes branch with optional force flag
- Return: `{ success: boolean, error?: string }`

**20. `git-merge` (Line 62)**
- Parameters: `branch` (string)
- Logic: Merges branch into current
- Return: `{ success: boolean, error?: string }`

**21. `git-merge-abort` (Line 68)**
- Parameters: None
- Logic: Aborts ongoing merge
- Return: `{ success: boolean, error?: string }`

**22. `git-merge-state` (Line 74)**
- Parameters: None
- Logic: Gets current merge state
- Return: `{ inMerge: boolean, conflictFiles?: Array }`
- Error handling: Returns default `{inMerge: false, conflictFiles: []}` on error

**23. `git-commit-detail` (Line 81)**
- Parameters: `hash` (string)
- Logic: Gets full commit details
- Return: `{ success: boolean, error?: string }`

**24. `git-commit-diff` (Line 87)**
- Parameters: `hash` (string)
- Logic: Gets diff for commit
- Return: `{ success: boolean, diff?: string, error?: string }`

**25. `git-staged-diff` (Line 93)**
- Parameters: None
- Logic: Gets diff of staged changes
- Return: `{ success: boolean, diff?: string, error?: string }`

**26. `git-ai-commit-message` (Line 100-166)**
- Parameters: `params: { cloudProvider?, cloudModel? }`
- Logic:
  - Gets staged diff and status
  - Truncates diff to 12K chars to avoid context overflow (line 108)
  - Maps staged files to list
  - Constructs prompt for conventional commit message generation
  - Falls back through: cloud LLM → local llmEngine → fallback cloud LLM (lines 120-133)
  - Strips markdown fences from output
- Return: `{ success: boolean, message?: string, error?: string }`
- System prompt: Tells model to output only commit message, no fences

**27. `git-ai-explain-commit` (Line 168-230)**
- Parameters: `params: { hash: string, cloudProvider?, cloudModel? }`
- Logic:
  - Gets commit detail and diff in parallel
  - Truncates diff to 12K chars
  - Constructs explanatory prompt
  - Uses same fallback chain as git-ai-commit-message
  - Returns explanation text and commit object
- Return: `{ success: boolean, explanation?: string, commit?: object, error?: string }`

**28. `git-ai-resolve-conflict` (Line 232-288)**
- Parameters: `params: { filePath: string, fileContent: string, cloudProvider?, cloudModel? }`
- Logic:
  - Validates conflict markers present (`<<<<<<<`, `>>>>>>>`)
  - Constructs prompt telling AI to merge both sides intelligently
  - Truncates content to 15K chars
  - Uses fallback chain (cloud → local → fallback cloud)
  - Strips markdown fences from result
- Return: `{ success: boolean, resolved?: string, error?: string }`
- System prompt: Temperature 0.1 (low randomness for precise merges)

**29. `voice-command` (Line 290-367)**
- Parameters: `params: { transcription: string, cloudProvider?, cloudModel? }`
- Logic:
  - Validates non-empty transcription
  - Constructs JSON action schema with 20+ command types
  - Uses fallback chain to parse transcription to JSON
  - Extracts JSON from response, returns command object
  - Falls back to `ask-ai` if JSON parsing fails
- Return: `{ success: boolean, command?: {action, ...params}, error?: string }`
- Error handling: On any error, falls back to treating transcript as chat message

### AI MODEL HANDLING
- Lines 120-133: Three-tier fallback system:
  1. Cloud LLM if cloudProvider + cloudModel specified
  2. Local llmEngine if isReady
  3. Fallback to cloud LLM again
- All AI calls check `ctx.cloudLLM` and `ctx.llmEngine?.isReady`
- Diff truncation to prevent context overflow (12K default)

### DEPENDENCIES
- `electron` IPC
- `ctx.gitManager` (external dependency for all git operations)
- `ctx.cloudLLM` (external cloud LLM service)
- `ctx.llmEngine` (local LLM engine)

### POTENTIAL ISSUES

1. **Diff truncation loss of information**: 12K char limit could truncate relevant context, causing AI to produce incorrect commit messages or explanations.

2. **No git initialization check**: Handlers assume git repo exists. Calling on non-git directory returns raw error.

3. **Fallback chain inefficiency**: Triple attempt (cloud → local → cloud again) means slow path on first two failures. Could cache availability after first check.

4. **JSON extraction fragile**: Line 349 regex `\{[^{}]*\}` only captures one level of nesting. Complex JSON structures fail silently and fall back to ask-ai.

5. **Conflict resolution confidence unwarranted**: Temperature 0.1 makes AI very confident, but merge conflicts often ambiguous. No user review before applying.

6. **Voice command schema incomplete**: Only 20 command types hardcoded. Extensibility requires code changes.

7. **No rate limiting**: Multiple rapid AI calls (e.g., git-ai-commit-message called repeatedly) could exhaust LLM quota.

8. **Missing cloudLLM error propagation**: If both cloudLLM and llmEngine fail (line 132), catch block returns generic error without diagnostic info.

9. **Git operation error messages generic**: Return objects lack git-specific error codes or context.

10. **Large diffs with voice commands**: If commit diff is 12K and user asks voice command to explain, file content (15K in conflict resolution) could be truncated incorrectly.

---

## FILE 3: imageGenHandlers.js

### FILE PURPOSE
Provides IPC handlers for image and video generation (local and cloud-based), saving generated media to project directory or via file dialog, and generation status tracking.

### IMPORTS
- Line 4: `const { ipcMain } = require('electron');` — Electron IPC
- Line 5: `const path = require('path');` — Path utilities
- Line 6: `const fs = require('fs');` — File system (sync methods used)

### IPC HANDLERS REGISTERED

**1. `local-image-generate` (Line 10-43)**
- Parameters: `params: { prompt, modelPath, negativePrompt?, steps?, cfgScale?, width?, height?, seed?, backend?, samplingMethod? }`
- Logic:
  - Validates prompt and modelPath presence
  - Wires progress callback to renderer via `local-image-progress` IPC (line 20-23)
  - Calls `localImageEngine.generate()` with all parameters
  - Progress callback: sends `{ current, total }` to renderer
- Return: `{ success: boolean, imageBase64?: string, mimeType?: string, prompt?: string, error?: string }`
- Defaults: steps=20, cfgScale=7.0, width/height=512, seed=-1, backend=cpu, samplingMethod=euler_a

**2. `local-image-engine-status` (Line 46)**
- Parameters: None
- Logic: Calls `localImageEngine.checkAvailability()`
- Return: Pass-through from localImageEngine or `{ available: false, error: 'Not initialized' }`

**3. `local-image-cancel` (Line 50)**
- Parameters: None
- Logic: Calls `localImageEngine.cancel()`
- Return: Always `{ success: true }`

**4. `image-generate` (Line 55-68)**
- Parameters: `prompt` (string), `options?: {...}`
- Logic:
  - Validates non-empty prompt
  - Sanitizes prompt to max 2000 chars (line 60)
  - Calls `imageGen.generate(sanitizedPrompt, options)`
- Return: Pass-through from imageGen → `{ success: boolean, imageBase64?: string, mimeType?: string, prompt?: string, provider?: string, model?: string, error?: string }`

**5. `image-save` (Line 71-116)**
- Parameters: `imageBase64` (string), `mimeType` (string), `suggestedName` (string)
- Logic:
  - Validates window and image data exist
  - Maps MIME type to extension (lines 76-81)
  - Opens save dialog via Electron dialog API (line 89)
  - Validates selected path via `ctx.isPathAllowed()`
  - Writes Buffer from base64 to file synchronously
  - Logs file size in KB
- Return: `{ success: boolean, filePath?: string, error?: string }`
- Extensions: png, jpg, jpeg, webp, gif

**6. `image-save-to-project` (Line 119-153)**
- Parameters: `imageBase64` (string), `mimeType` (string), `fileName` (string)
- Logic:
  - Validates project path is open
  - Creates `generated-images` subdirectory in project (line 135)
  - Generates filename with timestamp if not provided (line 133)
  - Maps MIME to extension
  - Validates path via `ctx.isPathAllowed()`
  - Writes file synchronously
- Return: `{ success: boolean, filePath?: string, error?: string }`
- Default: `generated-${Date.now()}${ext}`

**7. `image-gen-status` (Line 156)**
- Parameters: None
- Logic: Calls `imageGen.getStatus()`
- Return: Pass-through from imageGen

**8. `video-generate` (Line 159-172)**
- Parameters: `prompt` (string), `options?: {...}`
- Logic: Identical to image-generate but calls `imageGen.generateVideo()`

**9. `video-save` (Line 175-210)**
- Parameters: `videoBase64` (string), `mimeType` (string)
- Logic:
  - Validates window and video data
  - Opens save dialog for video files
  - Writes file synchronously
  - Returns full size in KB
- Return: `{ success: boolean, filePath?: string, error?: string }`
- Extensions: mp4, webm, avi

**10. `video-save-to-project` (Line 213-241)**
- Parameters: `videoBase64` (string), `mimeType` (string), `fileName` (string)
- Logic:
  - Similar to image-save-to-project but for videos
  - Creates `generated-videos` subdirectory
- Return: `{ success: boolean, filePath?: string, error?: string }`
- Extensions: mp4, webm

### MIME TYPE MAPPINGS
- Lines 76-81: image MIME → extension map
- Lines 147-148: image MIME → extension map (duplicate)
- Lines 192-194: video MIME → extension map

### DEPENDENCIES
- `electron` (ipcMain, dialog)
- `ctx.imageGen` (external image/video generation service)
- `ctx.localImageEngine` (external local image generation via stable-diffusion.cpp)
- `ctx.getMainWindow()` (window reference)
- `ctx.currentProjectPath` (current project directory)
- `ctx.isPathAllowed()` (path validation)

### POTENTIAL ISSUES

1. **Base64 memory overhead**: Large images (>10MB) decoded from base64 creates 2x memory spike (base64 string + decoded buffer). No chunked streaming.

2. **Synchronous file I/O**: All writes use `fs.writeFileSync()` (lines 104, 149, 201, 237). Blocks event loop for large files.

3. **Race condition in save**: User could modify filename in dialog after click. No atomic rename.

4. **Directory creation error suppression**: Line 135 `try { fs.mkdirSync() } catch { /* ignore */ }` silently fails if directory can't be created. Next write will fail with unclear error.

5. **MIME type validation blind**: User-provided MIME type not validated. If mimeType is invalid, defaults to `.png` but file content won't match.

6. **Path traversal in fileName**: No sanitization of `fileName` parameter. Path like `../../etc/passwd` could escape project directory. Should validate via `ctx.isPathAllowed()`.

7. **Duplicate prompt sanitization logic**: Prompt length check repeated in image-generate (line 60) and video-generate (line 168).

8. **No file size limits**: Could write unlimited data. No quota checks before accepting base64.

9. **Save dialog default path**: Line 89 uses `ctx.currentProjectPath` as default. If empty, dialog defaults to user home (could surprise users).

10. **Timestamp collision**: `Date.now()` in filename (lines 133, 207) could collide if two generates complete in same millisecond.

11. **Progress callback on destroyed window**: Line 21-22 checks `!mainWindow.isDestroyed()` but window could be destroyed between check and send.

---

## FILE 4: licenseHandlers.js

### FILE PURPOSE
Provides IPC handlers for license management including activation, OAuth sign-in flow with BrowserWindow, token validation, and concurrent sign-in prevention (BUG-009, BUG-017).

### IMPORTS
- Line 4: `const { ipcMain, BrowserWindow, session } = require('electron');` — Electron API

### MODULE-LEVEL STATE

**Line 7: `let oauthInProgress = false;`**
- Global flag preventing concurrent OAuth flows
- BUG-009: Guard against multiple sign-in windows

### IPC HANDLERS REGISTERED

**1. `license-get-status` (Line 9)**
- Parameters: None
- Logic: Calls `ctx.licenseManager.getStatus()`
- Return: Pass-through from licenseManager

**2. `license-activate` (Line 11)**
- Parameters: `key` (string)
- Logic:
  - Checks if key starts with 'GUIDE-DEV0' (development key)
  - Routes to `devActivate()` if dev key, otherwise `activate()`
- Return: Pass-through from licenseManager

**3. `license-activate-account` (Line 16)**
- Parameters: `email` (string), `password` (string)
- Logic: Calls `ctx.licenseManager.activateWithAccount(email, password)`
- Return: Pass-through from licenseManager

**4. `license-deactivate` (Line 17)**
- Parameters: None
- Logic: Deactivates current license
- Return: Pass-through from licenseManager

**5. `license-load` (Line 18)**
- Parameters: None
- Logic: Loads license from storage
- Return: Pass-through from licenseManager

**6. `license-revalidate` (Line 19)**
- Parameters: None
- Logic: Re-validates current license with server
- Return: Pass-through from licenseManager

**7. `license-check-access` (Line 20)**
- Parameters: None
- Logic: Returns access status (allowed/blocked)
- Return: Pass-through from licenseManager

**8. `license-oauth-signin` (Line 22-161)**
- Parameters: `provider` ('google' or 'github')
- Logic:

  **State Management (Lines 24-32):**
  - Validates provider is 'google' or 'github'
  - BUG-009: Returns error if oauthInProgress already true
  - Sets oauthInProgress = true
  - Returns Promise that resolves when OAuth flow completes

  **Promise Setup (Line 34):**
  - Tracks whether Promise has been resolved (line 35: `let resolved = false`)
  - Tracks if activation in progress (line 36): `activationInProgress = false`
  - Defines finish() function that ensures single resolution

  **OAuth Session (Lines 38-42):**
  - Creates isolated session partition for OAuth: `session.fromPartition('oauth-signin')`
  - Clears any stored cookies/storage before starting

  **BrowserWindow Creation (Lines 44-53):**
  - Size: 520x700 pixels
  - Title varies by provider
  - Disables node integration and enables context isolation
  - Uses isolated OAuth session

  **Cookie Detection (Lines 56-75):**
  - Listens for `cookies` change events
  - Looks for 'guide_auth' cookie with value
  - On detection:
    - Sets activationInProgress = true
    - Calls `ctx.licenseManager.activateWithToken(cookie.value)`
    - Closes auth window
    - Finishes Promise

  **URL Token Detection (Lines 77-104):**
  - Watches for 'guide_token=' in URL
  - Extracts token from:
    - Query param: `/account?guide_token=JWT`
    - Hash fragment: `/account#guide_token=JWT`
  - On detection:
    - Calls `ctx.licenseManager.activateWithToken(token)`
    - Closes window and finishes Promise

  **Error Detection (Lines 106-116):**
  - Looks for `/login?error=` URLs
  - Maps error codes to user-facing messages (no_code, csrf_failed, token_failed, no_email, server_error)
  - Finishes with error

  **Navigation Listeners (Lines 118-119):**
  - `did-navigate`: Checks URL and error
  - `did-redirect-navigation`: Checks URL and error
  - `did-navigate-in-page`: Checks URL only

  **Load Completion Handler (Lines 120-139):**
  - BUG-017: Detects JSON error responses from OAuth server
  - Executes JavaScript to read document.body.innerText
  - Attempts to parse as JSON
  - If `parsed?.error` exists, closes window with error
  - Swallows JSON parse errors (not JSON = normal page)

  **Navigation Start (Lines 141-143):**
  - Constructs URL: `https://graysoft.dev/api/auth/{provider}?return=guide-desktop`
  - Logs OAuth URL
  - Calls `authWin.loadURL(oauthUrl)`

  **Window Close Handler (Lines 145-148):**
  - Removes cookie listener
  - Finishes with "Sign-in window was closed" error

  **Timeout Handler (Lines 150-156):**
  - 2-minute timeout (120000ms)
  - If not resolved, removes listener, closes window, returns timeout error
  - Releases oauthInProgress lock (line 152)

- Return: Promise → `{ success: boolean, error?: string }` (from OAuth flow)

### OAUTH FLOW ARCHITECTURE

1. Opens isolated OAuth window pointing to `graysoft.dev/api/auth/{provider}`
2. Monitors for 3 success conditions:
   - guide_auth cookie set
   - guide_token in URL query or hash
   - JSON error from server
3. Monitors for error condition: `/login?error=...` URL
4. Times out after 2 minutes
5. Cleans up resources (window, session, listeners)

### DEPENDENCIES
- `electron` (ipcMain, BrowserWindow, session)
- `ctx.licenseManager` (external license management)

### POTENTIAL ISSUES

1. **Global oauthInProgress state not thread-safe**: Multiple renderer processes could race on setting flag. Should use Mutex or atomic operation.

2. **Session partition leaks**: `session.fromPartition('oauth-signin')` persists between OAuth attempts. Old cookies could interfere with new sign-in.

3. **Unfinished promise leak**: If all three conditions fail (no cookie, no token, no error detected) and window closes before 2-min timeout, promise finishes with "window closed" message. But finish() calls removeListener on oauthInProgress = true already, causing state mismatch if user retries.

4. **JSON error detection fragile**: Line 128 reads innerText which executes JavaScript. Could be intercepted by malicious page. Should validate origin first.

5. **Cookie security**: Assumes 'guide_auth' cookie is set by legitimate server. No CSRF token or nonce validation.

6. **URL token in hash vulnerable**: Line 95 checks `parsed.hash` (fragment) which is never sent to server. Could be leaked in browser history / referrer headers.

7. **Error message mapping too trusting**: Maps any error code to human message (line 110-115). If malicious OAuth server returns random error, user gets generic message.

8. **Window close timing**: Between `authWin.close()` (line 71 and 156) and handler executing (line 145), timing gap could cause multiple listeners to fire.

9. **License activation side effect untracked**: Lines 67 and 96 call `ctx.licenseManager.activateWithToken()` — if this fails, Promise resolves with error but no indication whether token was valid.

10. **No origin validation**: OAuth window loads from `graysoft.dev` but no HTTPS enforcement or certificate pinning. MITM could intercept token.

11. **2-minute timeout hardcoded**: No user feedback if OAuth server is slow. User sees blank window for 2 min then timeout error.

---

## FILE 5: liveServerHandlers.js

### FILE PURPOSE
Provides IPC handlers for starting/stopping a local HTTP live-reload server with WebSocket-based file change notifications. Uses built-in `http` module (no external npm packages).

### IMPORTS
- Line 4: `const { ipcMain } = require('electron');` — Electron IPC
- Line 5: `const http = require('http');` — Node.js HTTP server
- Line 6: `const path = require('path');` — Path utilities
- Line 7: `const net = require('net');` — Net module for port detection
- Line 8: `const fs = require('fs').promises;` — Promise-based file system

### MODULE-LEVEL STATE

**Lines 10-12:**
```javascript
let _server = null;        // HTTP server instance
let _wss = null;          // WebSocket server instance
let _currentPort = null;   // Current listening port
```

### MIME TYPE MAPPING (Lines 14-48)

Comprehensive MIME type mapping for common file extensions:
- HTML: text/html
- CSS/SCSS/LESS: text/css (charset=utf-8)
- JavaScript variants (.js, .mjs, .cjs, .ts): application/javascript
- JSON/JSONC: application/json
- Images: png, jpg, gif, svg, webp, ico
- Fonts: woff, woff2, ttf
- Video: mp4, webm
- Audio: mp3, wav
- Documents: txt, xml, yaml, yml, graphql

**getMime() function (Line 50):**
- Takes filePath, looks up extension
- Returns MIME type or `application/octet-stream` default

### UTILITY FUNCTIONS

**findFreePort(start) (Lines 53-63):**
- Recursively finds first available port starting from `start`
- Creates server socket, binds, checks port
- Recurses with start+1 on error
- Max search: start >= 3100 (rejects if no port found 3000-3100)
- Returns Promise

**liveReloadScript(wsPort) (Lines 65-73):**
- Generates inline WebSocket client code
- Connects to `ws://127.0.0.1:{wsPort}`
- On message 'reload': calls `location.reload()`
- On close: retries reload after 2s

**notifyReload() (Lines 75-80):**
- Broadcasts 'reload' message to all connected WebSocket clients
- Called by fileSystemHandlers after `write-file`

### IPC HANDLERS REGISTERED

**1. `live-server-start` (Line 82-161)**
- Parameters: `filePath` (string) — path to file to serve
- Logic:

  **Initialization (Lines 84-88):**
  - Root path = directory of provided file
  - Stops any existing server/WebSocket
  - Clears module-level state variables

  **Port Selection (Lines 90-92):**
  - Finds free port starting from 3000
  - Finds free WebSocket port starting from HTTP port + 1

  **WebSocket Server (Lines 95-96):**
  - Creates WebSocketServer on isolated port
  - Requires `ws` npm package (already dependency)

  **HTTP Server (Lines 98-98):**
  - Creates HTTP server with request handler

  **Request Handler (Lines 99-157):**
  
  **URL parsing (Line 100):**
  - Strips query string from URL
  - Defaults '/' to '/index.html'

  **Path sanitization (Lines 103-105):**
  - Decodes URL component (handles %20 etc.)
  - Replaces `..` with empty (blocks directory traversal)
  - Strips backslashes
  
  **Security check (Lines 107-109):**
  - Reconstructs absolute path
  - Verifies path starts with rootPath
  - Rejects with 403 Forbidden if not

  **File serving (Lines 111-134):**
  - Reads file asynchronously
  - Gets extension and MIME type
  - **HTML injection (Lines 118-126):**
    - For .html/.htm files, injects live-reload script
    - Appends before `</body>` if present, else appends to HTML
    - Creates new Buffer from modified HTML
  - Sets response headers:
    - Content-Type: appropriate MIME
    - Access-Control-Allow-Origin: *
    - Cache-Control: no-cache, no-store
  - Sends file content

  **SPA fallback (Lines 135-145):**
  - If file not found, tries serving index.html
  - Same HTML injection applied
  - Returns 404 if index.html also missing

  **Server Start (Lines 149-153):**
  - Listens on TCP 127.0.0.1:port
  - Stores port in _currentPort
  - Stores _server and _wss references

- Return: `{ success: boolean, port?: number, wsPort?: number, url?: string, error?: string }`

**2. `live-server-stop` (Line 163-174)**
- Parameters: None
- Logic:
  - Closes WebSocket server if exists
  - Closes HTTP server if exists
  - Clears state variables
- Return: `{ success: boolean, error?: string }`

**3. `live-server-status` (Line 176-179)**
- Parameters: None
- Logic: Returns running status and port
- Return: `{ running: boolean, port?: number }`

### DEPENDENCIES
- `electron` IPC
- Built-in Node.js: `http`, `path`, `net`, `fs.promises`
- `ws` package (required for WebSocketServer)
- `ctx.getMainWindow()` for UI notifications

### POTENTIAL ISSUES

1. **Open CORS**: Line 125 `Access-Control-Allow-Origin: *` allows any cross-origin access. Should restrict to localhost or electron protocol.

2. **No MIME type for .html inside sendFile**: Line 127 sends response but doesn't validate mime type matches extension. Could serve .html as wrong type.

3. **Infinite redirect on SPA**: If index.html is missing, returns 404 (correct). But if index.html exists but is corrupted, injection (line 142) could create invalid HTML.

4. **WebSocket message structure fragile**: Line 71 sends raw string 'reload'. If WebSocket is used programmatically, no JSON envelope could cause parsing issues.

5. **Port scan inefficient**: findFreePort() recursive calls create stack depth. For busy systems, could hit stack limit.

6. **No HTTPS support**: Live-reload server is HTTP-only. If app is HTTPS, mixed content warnings in browser.

7. **Script injection vulnerable**: Line 118-126 uses string.replace(). If HTML contains literal `</body>` in strings, injection happens at wrong location.

8. **No cleanup on crash**: If process terminates unexpectedly, _server and _wss remain listening. Ports become unavailable until OS timeout.

9. **Broadcasting unbounded**: notifyReload() (line 79) broadcasts to all clients without checking if they're still connected first.

10. **Query string loss**: Line 100 strips query string with `.split('?')[0]`. User navigates to `/index.html?param=value`, query lost, defaults to `/index.html`.

11. **Base64 image URLs slow**: If served file contains large data URIs, injection adds to every response size.

12. **Hot reload script runs immediately**: Line 71 WebSocket created on page load. If connection fails, page reload loops.

---

## FILE 6: llmHandlers.js

### FILE PURPOSE
Provides IPC handlers for LLM operations (generation, streaming, cancellation), GPU management and preferences, context size control, and reasoning effort/thinking budget configuration.

### IMPORTS
- Line 4: `const { ipcMain } = require('electron');` — Electron IPC

### IPC HANDLERS REGISTERED

**1. `llm-get-status` (Line 6-16)**
- Parameters: None
- Logic:
  - Gets status from `ctx.llmEngine.getStatus()`
  - Attempts to get sequence token count: `seq.nTokens`
  - Sends `context-usage` IPC to renderer with `{ used, total }`
- Return: Pass-through from llmEngine status

**2. `gpu-get-info` (Line 19)**
- Parameters: None
- Logic: Calls `ctx.llmEngine.getGPUInfo()`
- Return: `{ success: boolean, gpu?: any, error?: string }`

**3. `gpu-set-preference` (Line 22-44)**
- Parameters: `pref` (string) — GPU preference
- Logic:
  - Sets `ctx.llmEngine.gpuPreference = pref`
  - Reads config, updates `userSettings.gpuPreference`
  - Writes config back
  - If model is loaded and ready:
    - Reinitializes model with new preference
    - Sends `context-usage` update to renderer
    - Returns success/failure and updated modelInfo
- Return: `{ success: boolean, preference: string, reloaded?: boolean, modelInfo?: object, error?: string }`

**4. `gpu-get-preference` (Line 46-48)**
- Parameters: None
- Logic: Returns current GPU preference
- Return: `{ success: true, preference: string }`

**5. `llm-load-model` (Line 51-77)**
- Parameters: `modelPath` (string)
- Logic:
  - Cancels active generation if in progress
  - Waits 100ms for cancellation to settle
  - Initializes model at new path
  - Persists `lastUsedModel` to settings.json via direct file write (lines 59-68)
  - Sends `context-usage` event to renderer
- Return: `{ success: boolean, modelInfo?: object, error?: string }`
- Persistence: Uses temp file + atomic rename pattern for safety

**6. `llm-generate` (Line 80-87)**
- Parameters: `prompt` (string), `params?: object`
- Logic:
  - Checks license access: if blocked, returns error with `__LICENSE_BLOCKED__` sentinel
  - If allowed, calls `ctx.llmEngine.generate(prompt, params)`
- Return: `{ success: boolean, ...result, error?: string }`

**7. `llm-generate-stream` (Line 89-102)**
- Parameters: `prompt` (string), `params?: object`
- Logic:
  - Checks license access
  - Gets main window
  - Calls `ctx.llmEngine.generateStream()` with two callbacks:
    - `token` callback: sends `llm-token` IPC to renderer
    - `thinkToken` callback: sends `llm-thinking-token` IPC to renderer
- Return: `{ success: boolean, ...result, error?: string }`

**8. `llm-cancel` (Line 104-110)**
- Parameters: None
- Logic:
  - Sets `ctx.agenticCancelled = true`
  - Calls `ctx.llmEngine.cancelGeneration()`
  - Calls `ctx.llmEngine.resetSession()` (catches errors)
- Return: `{ success: true }`

**9. `llm-reset-session` (Line 112-127)**
- Parameters: None
- Logic:
  - Resets LLM session
  - Clears todo state: `ctx.mcpToolServer._todos = []`, `_todoNextId = 1`
  - Closes Playwright browser if launched
  - Logs browser closure
- Return: `{ success: true }`

**10. `llm-update-params` (Line 129-130)**
- Parameters: `params` (object)
- Logic: Calls `ctx.llmEngine.updateParams(params)`
- Return: `{ success: true }`

**11. `llm-set-context-size` (Line 132-148)**
- Parameters: `contextSize` (number)
- Logic:
  - Sets `ctx.llmEngine.contextSizeOverride = contextSize`
  - If model is loaded and ready:
    - Reinitializes model (applies override)
    - Sends `context-usage` update
  - Returns new context size
- Return: `{ success: boolean, contextSize: number, error?: string }`

**12. `llm-set-reasoning-effort` (Line 150-158)**
- Parameters: `level` ('low' | 'medium' | 'high')
- Logic:
  - Sets `ctx.llmEngine.reasoningEffort = level`
  - Maps level to thought token budget:
    - low: 256
    - medium: 1024
    - high: -1 (unlimited)
  - Sets `ctx.llmEngine.thoughtTokenBudget` accordingly
  - Logs configuration
- Return: `{ success: true }`

**13. `llm-set-thinking-budget` (Line 160-173)**
- Parameters: `budget` (number)
- Logic:
  - If budget === 0:
    - Resets to profile default based on reasoningEffort
    - Uses budgetMap (low=256, medium=1024, high=-1)
  - Otherwise:
    - Sets exact budget (-1 = unlimited)
  - Logs setting
- Return: `{ success: true }`

### REASONING EFFORT & THINKING BUDGET

**Budget Levels:**
- low: 256 tokens (quick thinking)
- medium: 1024 tokens (balanced)
- high: -1 (unlimited — model decides)

**Reasoning Effort:**
- Low: Lower quality, faster responses
- Medium: Balanced quality and speed
- High: Maximum quality, unlimited thinking

**Thinking Budget:**
- Can be overridden per-request via llm-set-thinking-budget
- Setting to 0 resets to profile default
- Setting to exact number overrides default

### LICENSE CHECKING

Lines 82 and 90:
```javascript
const access = ctx.licenseManager.checkAccess();
if (!access.allowed) {
  return { success: false, error: '__LICENSE_BLOCKED__', reason: access.reason };
}
```

Returns specific `__LICENSE_BLOCKED__` error token to signal license issue to renderer.

### DEPENDENCIES
- `electron` IPC
- `ctx.llmEngine` (LLM inference engine)
- `ctx.licenseManager` (license validation)
- `ctx.mcpToolServer` (for todo state)
- `ctx.playwrightBrowser` (for browser operations)
- `ctx._readConfig()` / `ctx._writeConfig()` (settings persistence)
- `ctx.getMainWindow()` (window reference for IPC sends)

### POTENTIAL ISSUES

1. **Non-atomic GPU preference check**: Line 22 sets preference, then line 27 checks if model is loaded. Between check and reinit, model could be unloaded by other handler.

2. **Settings file direct write not thread-safe**: Lines 59-68 read/write settings.json directly without locking. Concurrent writes could corrupt JSON.

3. **Seq.nTokens access pattern unclear**: Line 13 assumes `ctx.llmEngine.context?.getSequence?.()?.nTokens` exists. If any step fails, silently skips sending context-usage.

4. **Thinking budget confusion**: `llm-set-thinking-budget` with budget=0 resets using existing reasoningEffort (line 167-169). But if reasoningEffort hasn't been set, uses hardcoded default 1024 (line 21).

5. **No validation on context size override**: Line 134 sets contextSizeOverride directly. No bounds checking — user could set to 0, -1, or huge value.

6. **Playwright browser state global**: Line 123 checks `ctx.playwrightBrowser.isLaunched`. If multiple calls race, could attempt close twice.

7. **Cancel doesn't wait for actual cancellation**: Line 106 calls `cancelGeneration()` then `resetSession()` immediately. If cancellation is async, could reset while generation still in-flight.

8. **thinking-token callback race**: Line 100 sends `llm-thinking-token` on every thought token. If renderer is not ready, messages queue indefinitely.

9. **License check not enforced on all paths**: `llm-generate-stream` checks license (line 91), but direct `ctx.llmEngine.generateStream()` calls bypass license.

10. **Model loading doesn't validate path exists**: Line 72 calls `ctx.llmEngine.initialize(modelPath)` without checking if file exists first.

11. **Temp file atomic rename issue**: Lines 64-67 use `.json.tmp` pattern, but if process crashes during write, temp file remains.

12. **No timeout on model loading**: Line 72 `await ctx.llmEngine.initialize()` could hang indefinitely if model engine is stuck.

---

## FILE 7: mcpHandlers.js

### FILE PURPOSE
Provides IPC handlers for MCP (Model Context Protocol) tool execution, external MCP server management (stdio and SSE types), file undo/change tracking, and checkpoint restoration.

### IMPORTS
- Line 4: `const { ipcMain } = require('electron');` — Electron IPC
- Line 5: `const { spawn } = require('child_process');` — Process spawning

### MODULE-LEVEL STATE

**Line 8: `const externalMcpServers = new Map();`**
- Tracks external MCP server instances
- Key: server ID, Value: `{ config, process, status, tools, error }`

### IPC HANDLERS REGISTERED

**1. `mcp-get-tools` (Line 10)**
- Parameters: None
- Logic: Gets built-in tool definitions from mcpToolServer
- Return: Tool definitions array

**2. `mcp-execute-tool` (Line 12-26)**
- Parameters: `toolName` (string), `params` (object)
- Logic:
  - Executes tool via `ctx.mcpToolServer.executeTool()`
  - If tool is file-modifying (write_file, create_directory, edit_file, delete_file, rename_file):
    - Sends `files-changed` IPC to renderer
    - Triggers incremental reindex
  - If tool is browser operation (starts with 'browser_'):
    - Sends `show-browser` IPC with URL if browser not launched
- Return: `{ success: true, result?: any, error?: string }`

**3. `mcp-get-history` (Line 28)**
- Parameters: None
- Logic: Gets tool execution history from mcpToolServer
- Return: Pass-through from mcpToolServer

**4. `mcp-list-servers` (Line 35-53)**
- Parameters: None
- Logic:
  - Builds server list with built-in tools first
  - Includes tool definitions for each server
  - Maps external servers with status, tools, error
- Return: Array of servers with tools

**5. `mcp-add-server` (Line 55-63)**
- Parameters: `serverConfig` (object)
- Logic:
  - Generates ID: `mcp-${Date.now()}`
  - Stores server in externalMcpServers map
  - Saves config to settings via `_loadMcpServersConfig()` and `_saveMcpServersConfig()`
  - Initial status: 'stopped'
- Return: `{ success: true, id: string }`

**6. `mcp-remove-server` (Line 65-74)**
- Parameters: `serverId` (string)
- Logic:
  - Rejects removal of 'built-in' server
  - Kills process if running (line 68)
  - Removes from externalMcpServers map
  - Updates saved config
- Return: `{ success: boolean, error?: string }`

**7. `mcp-restart-server` (Line 76-130)**
- Parameters: `serverId` (string)
- Logic:

  **Early exit (Lines 77-79):**
  - Returns success if built-in server (no-op)
  - Returns error if server not found

  **Process cleanup (Lines 81-82):**
  - Kills existing process if any

  **Status update (Lines 83-84):**
  - Sets status to 'starting'
  - Clears error

  **Stdio type (Lines 87-106):**
  - Splits command string by whitespace (line 88)
  - Spawns process with args
  - Sets env: merges process.env with config.env (line 93)
  - Sets cwd to project path if available
  - Stdio: pipe for stdin/stdout/stderr
  - On process error:
    - Sets status to 'error'
    - Stores error message
    - Sends `mcp-server-status` IPC if window exists
  - On process exit:
    - Sets status to 'stopped'
    - Sends `mcp-server-status` IPC

  **SSE (Server-Sent Events) type (Lines 107-120):**
  - Makes HTTP GET request to URL
  - 5-second timeout
  - Sets status based on HTTP status code (<400 = running, >=400 = error)
  - Destroys response immediately (just checking connectivity)

  **Error handling (Lines 122-125):**
  - Catches all errors into status='error' and stores message

  **IPC notification (Line 127):**
  - Sends `mcp-server-status` to renderer

- Return: `{ success: true, status: string }`

**8. `file-undo-list` (Line 134)**
- Parameters: None
- Logic: Gets undoable files from mcpToolServer
- Return: Pass-through from mcpToolServer

**9. `file-undo` (Line 136-145)**
- Parameters: `filePath` (string)
- Logic:
  - Undoes changes to file via mcpToolServer
  - If successful:
    - Sends `files-changed` IPC
    - Sends `open-file` IPC to open the restored file
- Return: Pass-through from mcpToolServer

**10. `file-undo-all` (Line 147-153)**
- Parameters: None
- Logic:
  - Undoes all file changes
  - Sends `files-changed` IPC after
- Return: Pass-through from mcpToolServer

**11. `file-accept-changes` (Line 155)**
- Parameters: `filePaths` (Array<string>)
- Logic: Accepts/commits file changes, preventing further undo
- Return: Pass-through from mcpToolServer

**12. `apply-chat-code` (Line 158)**
- Parameters: `filePath` (string), `content` (string)
- Logic: Applies code block from chat directly to file, tracked for undo
- Return: Pass-through from mcpToolServer._writeFile()

**13. `checkpoint-list` (Line 162)**
- Parameters: None
- Logic: Gets list of checkpoints
- Return: Pass-through from mcpToolServer

**14. `checkpoint-restore` (Line 164-171)**
- Parameters: `turnId` (string)
- Logic:
  - Restores checkpoint (reverts to state at specific turn)
  - Sends `files-changed` IPC if successful
- Return: Pass-through from mcpToolServer

### EXTERNAL MCP SERVER PERSISTENCE

**_loadMcpServersConfig() (Lines 31-34):**
- Reads `config.mcpServers` array from settings
- Returns servers or empty array

**_saveMcpServersConfig(servers) (Lines 36-40):**
- Updates `config.mcpServers`
- Writes config back to storage

**Startup loading (Lines 132-138):**
- Loads saved servers from config
- Creates entries in externalMcpServers map
- Sets all to initial status 'stopped'

### STDIO COMMAND PARSING

Line 88: `const [cmd, ...args] = srv.config.command.split(/\s+/);`

Issue: Naive whitespace split. Commands with spaces in paths won't work correctly.
Example: `C:\Program Files\tool.exe --flag value` splits to `['C:\Program', 'Files\tool.exe', ...]`

Should use proper shell parsing or array of arguments in config.

### DEPENDENCIES
- `electron` IPC, child_process.spawn
- `ctx.mcpToolServer` (MCP tool execution/history tracking)
- `ctx.getMainWindow()` (for IPC sends)
- `ctx.currentProjectPath` (for cwd in stdio spawn)
- `ctx._readConfig()` / `ctx._writeConfig()` (settings persistence)

### POTENTIAL ISSUES

1. **Command parsing naive**: Line 88 splits on whitespace. Breaks with paths containing spaces (see above).

2. **No shell escaping**: Environment variables in config not validated. Could inject malicious env vars.

3. **Concurrent server restarts race**: Lines 81-82 kill old process, then spawn new one. If process hasn't exited yet, new process might inherit parent PID.

4. **No tool loading from external servers**: `mcp-list-servers` includes tool definition (line 40), but tools are never fetched from subprocess. Hard to know what tools external server provides.

5. **SSE connectivity check insufficient**: Lines 107-120 just check HTTP status, don't verify MCP protocol. Server could be HTTP but not MCP-compliant.

6. **Process error vs process exit confusion**: Lines 100-102 handle `error` event, lines 103-105 handle `exit` event. If both fire, status set twice.

7. **Stdio pipe mode no error stream handling**: Line 93 sets `stdio: ['pipe', 'pipe', 'pipe']` but never reads stderr. Process output could fill buffer and deadlock.

8. **ID collision unlikely but possible**: Line 59 uses `Date.now()`. If two servers added within 1ms, IDs could collide (though unlikely).

9. **No process timeout**: External MCP server could hang indefinitely. No timeout/watchdog to restart hung servers.

10. **File modified but undo not tracked**: `apply-chat-code` (line 158) calls `mcpToolServer._writeFile()` directly. If this fails silently, renderer not notified.

11. **Checkpoint restore idempotent unclear**: Restoring same checkpoint twice — does it work or fail?

12. **Built-in server special-cased**: Line 77 `if (serverId === 'built-in')` returns success without action. Inconsistent with external servers.

---

## FILE 8: memoryHandlers.js

### FILE PURPOSE
Provides IPC handlers for memory store operations (learning facts, finding similar errors, stats, clearing memory).

### IMPORTS
- Line 4: `const { ipcMain } = require('electron');` — Electron IPC

### IPC HANDLERS REGISTERED

**1. `memory-get-stats` (Line 6)**
- Parameters: None
- Logic: Gets memory store statistics
- Return: `{ stats: object }` (pass-through from memoryStore)

**2. `memory-get-context` (Line 7)**
- Parameters: None
- Logic: Gets context prompt (for LLM injection)
- Return: `{ context: string }` (pass-through from memoryStore)

**3. `memory-learn-fact` (Line 8)**
- Parameters: `key` (string), `value` (any)
- Logic: Stores fact in memory store
- Return: `{ success: true }`

**4. `memory-find-errors` (Line 9)**
- Parameters: `errorMsg` (string)
- Logic: Finds similar errors in memory store
- Return: `{ similar: Array }` (pass-through fro memoryStore)

**5. `memory-clear` (Line 10)**
- Parameters: None
- Logic: Clears all memory
- Return: `{ success: true }`

**6. `memory-clear-conversations` (Line 11)**
- Parameters: None
- Logic: Clears conversation history only (not facts)
- Return: `{ success: true }`

### DEPENDENCIES
- `electron` IPC
- `ctx.memoryStore` (external memory store service)

### POTENTIAL ISSUES

1. **No error handling**: Zero try-catch blocks. If memoryStore methods throw, errors propagate uncaught to renderer.

2. **Minimal file**: Only 6 handlers, all thin pass-throughs. No business logic, validation, or state management.

3. **Key/value validation absent**: `memory-learn-fact` accepts any `value` parameter. No size limits or type checking.

4. **No distinction between error clearing and conversation clearing**: Both `memory-clear` and `memory-clear-conversations` erase data. UI could confuse users if they tap wrong button.

---

## FILE 9: modelHandlers.js

### FILE PURPOSE
Provides IPC handlers for model management (listing, scanning, selecting), hardware detection and model recommendations, and HuggingFace model downloads with progress tracking.

### IMPORTS
- Line 4: `const { ipcMain, dialog } = require('electron');` — Electron dialog
- Line 5: `const path = require('path');` — Path utilities
- Line 6: `const os = require('os');` — OS info
- Line 7: `const https = require('https');` — HTTPS client
- Line 8: `const http = require('http');` — HTTP client
- Line 9: `const fsSync = require('fs');` — Synchronous file system

### IPC HANDLERS REGISTERED

**1. `models-list` (Line 11)**
- Parameters: None
- Return: Available models from modelManager

**2. `models-scan` (Line 12)**
- Parameters: None
- Logic: Scans for new models in models directory
- Return: Pass-through from modelManager

**3. `models-get-default` (Line 13)**
- Parameters: None
- Return: Default model from modelManager

**4. `models-dir` (Line 14)**
- Parameters: None
- Return: Models directory path

**5. `models-add` (Line 16-30)**
- Parameters: None
- Logic:
  - Opens file dialog (multiselect GGUF files only)
  - Returns error if cancelled or no files selected
  - Adds files via `ctx.modelManager.addModels(filePaths)`
- Return: `{ success: boolean, models?: Array }`

**6. `models-remove` (Line 32-36)**
- Parameters: `modelPath` (string)
- Logic: Removes model from manager
- Return: `{ success: true }`

**7. `get-hardware-info` (Line 40-46)**
- Parameters: None
- Logic:
  - Calls `ctx._detectGPU()` to get GPU info
  - Gets total RAM in GB
  - Gets free RAM in GB
  - Gets CPU model and core count
- Return: `{ ...gpu, totalRAM, freeRAM, cpuModel, cpuCores }`

**8. `get-recommended-models` (Line 48-102)**
- Parameters: None
- Logic:

  **Hardware detection (Lines 50-53):**
  - Gets GPU VRAM in GB
  - Calculates max model size:
    - If VRAM > 2GB: `max = VRAM - 1.5GB`
    - Else: `max = system_RAM * 0.6`

  **Model catalog (Lines 55-64):**
  - Hard-coded list of 12 models with:
    - name, file (GGUF filename)
    - size (GB), hfRepo (HuggingFace repo)
    - description, category, vision flag
  - Categories: coding, general, reasoning
  - Sizes range: 0.6GB (Qwen3-0.6B) to 19.8GB (Qwen3-32B)

  **Filtering (Lines 66-78):**
  - Models that fit in maxModelGB → `recommended` array
  - Models that don't fit → `other` array
  - Sorts recommended by size descending
  - Adds downloadUrl to each model

- Return: `{ recommended: Array, other: Array, maxModelGB: number, vramGB: number }`

**9. `models-download-hf` (Line 105-192)**
- Parameters: `{ url, fileName }`
- Logic:

  **Initialization (Lines 106-112):**
  - Constructs target path: `modelsDir/fileName`
  - Temp path: `targetPath + '.part'`
  - Creates models directory if missing
  - Returns existing file without re-downloading

  **Download handler (Lines 114-156):**
  - Recursive doRequest function handles redirects (lines 116-159)
  - Redirect limit: 5 (line 117)
  - Validates HTTP 200 (line 128)
  - Tracks download progress every 500ms
  - Sends `model-download-progress` IPC with:
    - fileName, progress (%), downloadedMB, totalMB
    - downloadedBytes, totalBytes
  - On completion:
    - Atomic rename temp to target
    - Calls `ctx.modelManager.scanModels()`
    - Sends completion progress IPC
  - On error:
    - Deletes temp file
    - Returns error

  **Active download tracking (Line 113):**
  - Stores in-progress downloads in Map
  - Key: fileName, Value: `{ req, fileStream, tempPath }`

- Return: `{ success: boolean, path?: string, alreadyExists?: boolean, error?: string }`

**10. `models-cancel-download` (Line 194-206)**
- Parameters: `fileName` (string)
- Logic:
  - Gets active download from map
  - Destroys HTTP request
  - Destroys file stream
  - Deletes temp file
  - Removes from active downloads
- Return: `{ success: boolean, error?: string }`

### MODEL CATALOG

Hard-coded and static (lines 55-64). Updates require code changes:

```
1. Qwen2.5-Coder-1.5B (1.0 GB) — fast coding
2. Qwen3-0.6B (0.6 GB) — ultra-lightweight
3. Qwen3-4B (2.5 GB) — fast reasoning
4. Qwen2.5-Coder-7B (4.7 GB) — strong coding
5. Llama-3.1-8B (4.9 GB) — general purpose
6. Qwen3-8B (5.0 GB) — strong reasoning
7. DeepSeek-R1-Distill-14B (8.7 GB) — reasoning
8. Qwen3-14B (9.0 GB) — high-quality reasoning
9. Mistral-Small-3.1-24B (14.3 GB) — multi-language
10. Qwen3-Coder-30B-MoE (18.6 GB) — best coding
11. Qwen3-30B-MoE (18.6 GB) — best general (MoE)
12. Qwen3-32B (19.8 GB) — top-tier reasoning
```

### DEPENDENCIES
- `electron` (ipcMain, dialog)
- `ctx.modelManager` (model management)
- `ctx._detectGPU()` (GPU detection)
- `ctx.currentProjectPath` (not used in this file)
- Built-in Node.js: `path`, `os`, `fs`, `http`, `https`

### POTENTIAL ISSUES

1. **Static model catalog outdated**: Models hard-coded in source. Users on old app versions don't see new models or get outdated sizes.

2. **VRAM vs actual loading**: maxModelGB calculation (line 52) assumes model fits if VRAM > size. Doesn't account for context size, activations, other processes.

3. **Redirect follow infinite loop risk**: Lines 117-159 recursively follow redirects up to limit. Could hit limit on legitimate redirects.

4. **Download progress sends too frequently**: If speeds are very fast, could send IPC thousands of times per second.

5. **Atomic rename cross-filesystem**: fs.renameSync() fails if temp file is on different filesystem (NFS mounts, etc.)

6. **No checksum validation**: Downloaded file not verified against hash. Corrupted download not detected.

7. **Concurrent download of same file**: Two users download same model to same models directory. Second overwrites first's in-progress file.

8. **Download resume not supported**: If network drops mid-download, restart downloads from beginning (kills temp file).

9. **GPU detection not called immediately**: `get-hardware-info` is first place GPU detection happens. If called before model loading, GPU capabilities could be wrong.

10. **Model size calculations approximate**: `maxModelGB` uses integer rounding. May not fit as precisely as calculated.

11. **No backoff on redirect loops**: If server returns redirect loops, hits limit immediately with no retry delay.

12. **File descriptor leak on stream error**: If fileStream encounters error, fileStream.destroy() called. But if multiple errors fire, could destroy twice.

13. **User-Agent hardcoded**: Line 125 `User-Agent: guIDE/2.0` — HuggingFace could block or throttle unknown agents.

---

## FILE 10: notebookHandlers.js

### FILE PURPOSE
Provides IPC handlers for interactive notebook/REPL execution (Node.js, Python, shell), notebook I/O to .ipynb format, and AI-powered code generation for cells.

### IMPORTS
- Line 6: `const { ipcMain } = require('electron');` — Electron IPC
- Line 7: `const { spawn, exec } = require('child_process');` — Process execution
- Line 8: `const path = require('path');` — Path utilities
- Line 9: `const fs = require('fs');` — File system
- Line 10: `const os = require('os');` — OS utilities

### MODULE-LEVEL STATE

**Lines 13-15:**
```javascript
const sessions = new Map();  // Stores active notebook sessions (not used currently)
let sessionCounter = 0;      // Counter for session IDs
function _genId() { return 'nb-' + (++sessionCounter) + '-' + Date.now().toString(36); }
```
Note: `sessions` Map is created but never populated. Code structure suggests future session management.

### IPC HANDLERS REGISTERED

**1. `notebook-exec-node` (Line 17-88)**
- Parameters: `{ code, cellId, timeout = 30000 }`
- Logic:

  **Code wrapping (Lines 22-38):**
  - Wraps user code in IIFE (Immediately Invoked Function Expression)
  - Makes execution async
  - Captures console.log, console.error, console.warn
  - Redirects output to array
  - Executes user code in function scope
  - Returns result if exists
  - Catches errors to error array
  - Writes `__NOTEBOOK_OUTPUT__[JSON.stringify(outputs)]__END__` marker

  **Process execution (Lines 40-41):**
  - Spawns `node -e` with wrapped code
  - No cwd specified (uses current)
  - Sets timeout parameter on spawn

  **Output parsing (Lines 45-56):**
  - Finds wrapped output between markers
  - Parses JSON outputs
  - Falls back to raw stdout/stderr if markers missing
  - Determines success based on error presence or exit code

- Return: `{ success: boolean, cellId, outputs?: Array<{type, text}>, exitCode?, outputType: 'error'|'text' }`

**2. `notebook-exec-python` (Line 90-165)**
- Parameters: `{ code, cellId, timeout = 30000 }`
- Logic:

  **Code wrapping (Lines 99-122):**
  - Wraps Python code to capture stdout/stderr
  - Uses StringIO to redirect output
  - Executes code via exec()
  - Returns output as JSON array
  - Catches exceptions with traceback

  **Process execution (Lines 124-126):**
  - Spawns `python -c` with wrapped code
  - Home directory as cwd

  **Output parsing (Lines 131-143):**
  - Similar to Node.js execution
  - Finds markers and parses JSON
  - Falls back to raw output

- Return: `{ success: boolean, cellId, outputs?: Array, exitCode?, outputType: 'error'|'text' }`

**3. `notebook-exec-shell` (Line 167-188)**
- Parameters: `{ code, cellId, timeout = 30000 }`
- Logic:
  - Uses `exec()` (shell execution) instead of spawn
  - Captures stdout/stderr
  - Returns both streams in outputs array
- Return: `{ success: boolean, cellId, outputs?: Array<{type:'log'|'error'|'warn', text}>, exitCode?, outputType }`

**4. `notebook-save-ipynb` (Line 190-224)**
- Parameters: `{ filePath, cells }`
- Logic:
  - Constructs Jupyter .ipynb JSON structure
  - Sets nbformat: 4, nbformat_minor: 5
  - Stores cell language in metadata
  - Converts cell outputs to Jupyter format (stream type)
  - Preserves execution count
  - Writes JSON to file synchronously
- Return: `{ success: boolean, path?: string, error?: string }`

**5. `notebook-load-ipynb` (Line 226-254)**
- Parameters: `filePath` (string)
- Logic:
  - Reads and parses .ipynb file
  - Converts Jupyter cells to internal format
  - Extracts source code (handles both string and array formats)
  - Maps output types (stderr → error, stdout → log)
  - Preserves execution count
- Return: `{ success: boolean, cells?: Array, metadata?: object, error?: string }`

**6. `notebook-ai-generate` (Line 256-291)**
- Parameters: `{ prompt, context?, language = 'javascript' }`
- Logic:
  - Constructs system prompt for code generation (language-specific)
  - Fallback chain (cloudLLM → llmEngine)
  - Removes markdown code fences if present
  - Returns generated code
- Return: `{ success: boolean, code?: string, language?: string, error?: string }`

**7. `notebook-clear-outputs` (Line 293)**
- Parameters: None
- Logic: Currently a no-op (returns success)
- Return: `{ success: true }`

### CODE WRAPPING STRATEGIES

**Node.js wrapping (lines 22-38):**
- IIFE + async
- Custom console capture
- JSON output marshalling
- Error stack preservation

**Python wrapping (lines 99-122):**
- Uses exec() not eval()
- StringIO for stdout/stderr capture
- traceback.format_exc() for full stack

**Shell execution:**
- Direct exec() without wrapping
- OS handles output

### JUPYTER .IPYNB FORMAT

**Structure (lines 193-223):**
- nbformat: 4
- Cells array with:
  - cell_type: 'code' or 'markdown'
  - source: array of strings (one per line)
  - outputs: array of stream objects
  - execution_count: number or null

### DEPENDENCIES
- `electron` IPC
- `ctx.cloudLLM` (AI code generation)
- `ctx.llmEngine` (local LLM for code generation)
- Built-in Node.js: child_process, path, fs, os

### POTENTIAL ISSUES

1. **30-second timeout hardcoded**: `notebook-exec-node` and `notebook-exec-python` set timeout to 30s. No way to override for long-running scripts.

2. **Marker injection vulnerability**: User code containing `__NOTEBOOK_OUTPUT__` string causes JSON parsing to fail. Could be exploited to inject output.

3. **JSON serialization limits**: Complex objects with circular references, BigInt, Symbol crash JSON.stringify(). Output drops silently.

4. **No stdin support**: Spawned processes have stdin pipe but code doesn't read from it. Can't handle interactive prompts.

5. **Python code validation missing**: Any Python code executed directly without syntax check. Syntax errors only caught at runtime.

6. **Node.js heap memory unlimited**: Spawned Node process could consume all system RAM. No memory limit set in spawn options.

7. **Shell injection in exec()**: Line 176 `exec(code, ...)` — user code is directly executed as shell. Unsanitized input could execute arbitrary commands.

8. **Output truncation absent**: Very large output (e.g., printing million-line array) causes buffer overflow. No maxOutputSize enforced.

9. **cwd hardcoded to home**: Line 40 (no cwd) and line 125 (os.homedir()). User can't control working directory.

10. **Process cleanup incomplete**: On timeout (line 19), Promise resolves but process still running in background. Eventually kills (line 34 onClose) but leaks for 30s.

11. **Concurrent cell execution races**: Two cells executing simultaneously could write to same temp files or have GC interactions.

12. **JSON cell outputs limited**: Line 210 maps all output to 'stream' type. Jupyter supports more types (display_data, execute_result, etc.)

13. **Notebook save not atomic**: Line 223 `fs.writeFileSync()` blocks. If process terminates mid-write, notebook corrupts.

14. **Code generation fallback cascade issues**: Lines 265-276 try cloudLLM, then llmEngine, then catch all errors. If both unavailable, returns generic error without context.

15. **Array source handling inconsistent**: Line 240 handles array source by joining, but line 236 checks `Array.isArray()` — should be more explicit about expected format.

---

## CROSS-FILE ANALYSIS

### Common Patterns

1. **Error handling asymmetry**: Some files have extensive try-catch (gitHandlers, imageGenHandlers), others minimal (memoryHandlers, mcpHandlers)

2. **Pass-through delegation**: Most handlers are thin wrappers around `ctx` methods. Real logic lives in external dependencies.

3. **IPC state broadcasting**: When operations succeed, handlers send secondary IPCs to update UI (files-changed, context-usage, etc.)

4. **Context dependency**: All handlers assume `ctx` object fully populated with 15+ properties. No validation that methods exist.

5. **Configuration persistence**: Some handlers read/write config directly (llmHandlers), others delegate to manager (modelHandlers)

6. **License checking**: Only LLM handlers check license. Other sensitive operations (file write, model download) bypass license check.

### Critical Dependencies

| Dependency | Used By | Critical? |
| --- | --- | --- |
| `ctx.llmEngine` | llmHandlers, gitHandlers, notebookHandlers | Yes |
| `ctx.gitManager` | gitHandlers (12 handlers) | Yes |
| `ctx.mcpToolServer` | mcpHandlers, llmHandlers | Yes |
| `ctx.modelManager` | modelHandlers | Yes |
| `ctx.licenseManager` | licenseHandlers, llmHandlers | Yes |
| `ctx.imageGen` | imageGenHandlers | No (optional feature) |
| `ctx.localImageEngine` | imageGenHandlers | No (optional) |
| `ctx.memoryStore` | memoryHandlers | No |
| `ctx._detectGPU()` | modelHandlers, llmHandlers | No |

### Security Concerns

1. **Path traversal**: fileSystemHandlers checks `isPathAllowed()`, others don't validate paths
2. **Shell injection**: notebookHandlers `exec()` accepts raw user code
3. **OAuth token in URL hash**: licenseHandlers uses URL fragment which is not sent to server but visible in logs
4. **No CSRF tokens**: Git AI handlers make state-changing requests
5. **No rate limiting**: AI features can be called unlimited times

---

end of detailed audit
