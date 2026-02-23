/**
 * guIDE LLM Engine - Manages local LLM inference using node-llama-cpp
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Supports GPU layer offloading, adaptive context sizing, and flash attention
 * Auto-detects hardware and adapts to any GPU/CPU configuration
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { getModelProfile, getModelSamplingParams, getEffectiveContextSize, getSizeTier } = require('./modelProfiles');
const { detectFamily, detectParamSize } = require('./modelDetection');
const { sanitizeResponse } = require('./sanitize');

/**
 * Get the path to node-llama-cpp that works in both dev and production (asar).
 * In production, native modules are unpacked to app.asar.unpacked/node_modules/
 */
function getNodeLlamaCppPath() {
  // Check if running from asar
  if (__dirname.includes('app.asar')) {
    // Production: unpacked native module — must resolve to the exact ESM entry file.
    // ESM import() does NOT support directory imports, and on Windows raw C:\ paths
    // cause "Received protocol 'c:'" errors. So we: (1) point to dist/index.js, and
    // (2) convert to a file:// URL via pathToFileURL for cross-platform safety.
    const unpackedPath = __dirname.replace('app.asar', 'app.asar.unpacked');
    const entryFile = path.join(unpackedPath, '..', 'node_modules', 'node-llama-cpp', 'dist', 'index.js');
    return pathToFileURL(entryFile).href;
  }
  // Development: bare specifier — Node resolves via node_modules automatically
  return 'node-llama-cpp';
}

class LLMEngine extends EventEmitter {
  constructor() {
    super();
    this.model = null;
    this.context = null;
    this.chat = null;          // LlamaChat instance (proper role separation)
    this.chatHistory = [];     // ChatHistoryItem[] with system/user/model roles
    this.lastEvaluation = null; // For KV cache efficiency across turns
    this.sequence = null;      // LlamaContextSequence reference
    this.llamaInstance = null;
    this.currentModelPath = null;
    this._justLoadedNewModel = false; // Set true when a NEW (different) model path is loaded
    this.isLoading = false;
    this.isReady = false;
    this.modelInfo = null;
    this.abortController = null;
    this.generationActive = false; // BUG-015: true while generateStream is executing
    this._abortReason = null; // 'user' | 'tool_call' | 'repetition' | 'template' | null
    this.loadAbortController = null; // Separate abort controller for model loading
    this._loadGeneration = 0; // Monotonic counter — each initialize() call gets a unique ID
    this.gpuInfo = null;
    this.gpuPreference = 'auto'; // 'auto' = prefer GPU, 'cpu' = force CPU only
    this.reasoningEffort = 'medium'; // 'low', 'medium', 'high'
    this.thoughtTokenBudget = 1024; // Updated from ModelProfile after model load

    // Wrapper probe system — determines the best chat wrapper for each model at first load.
    // Results are cached to userData/wrapper-cache.json keyed by path+size+mtime.
    this._probeWrapperCache = {};     // In-memory cache (populated from disk on first probe)
    this._wrapperCachePath = null;    // Resolved on first load
    this._wrapperCacheLoaded = false; // Lazy-load flag
    this._selectedWrapperName = null; // Wrapper name proven by probe — used on context rotation
    this._flashAttnEnabled = false;   // Set after flash coherence check; used by resetSession


    // ENGINE DEFAULTS ONLY — modelProfiles.js family/size overrides take precedence via mergedParams.
    // Changing these only affects models that have NO profile entry.
    this.defaultParams = {
      maxTokens: 4096,
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.15,
      frequencyPenalty: 0,
      presencePenalty: 0,
      lastTokensPenaltyCount: 128,
      seed: -1,
    };
  }

  /**
   * Race a promise against a timeout. Throw if timeout fires first.
   */
  _withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
      ),
    ]);
  }

  /**
   * Detect GPU VRAM and estimate model layer counts.
   * Does NOT pre-restrict layers — we let node-llama-cpp try and fail naturally.
   * This just provides hints for generating layer attempt sequences.
   */
  _getGPUConfig(modelSizeBytes) {
    const modelSizeGB = modelSizeBytes / (1024 ** 3);

    let vramGB = 0; // 0 = unknown
    // Use cached GPU VRAM if available (set by main process _detectGPU)
    if (this._cachedVramGB !== undefined) {
      vramGB = this._cachedVramGB;
    } else {
      try {
        const { execSync } = require('child_process');
        const nvOut = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { timeout: 3000, encoding: 'utf8', windowsHide: true });
        const parsed = parseFloat(nvOut.trim());
        if (parsed > 0) vramGB = parsed / 1024;
        this._cachedVramGB = vramGB; // Cache for session
        console.log(`[LLM] Detected NVIDIA VRAM: ${vramGB.toFixed(1)}GB`);
      } catch (_) {
        this._cachedVramGB = 0;
        console.log(`[LLM] Could not detect GPU VRAM via nvidia-smi`);
      }
    }

    // Estimate total layer count from model size (heuristic based on common architectures)
    let estimatedLayers;
    if (modelSizeGB < 5)       estimatedLayers = 32;
    else if (modelSizeGB < 8)  estimatedLayers = 32;
    else if (modelSizeGB < 12) estimatedLayers = 40;
    else if (modelSizeGB < 18) estimatedLayers = 48;
    else if (modelSizeGB < 25) estimatedLayers = 56;
    else if (modelSizeGB < 45) estimatedLayers = 64;
    else                       estimatedLayers = 80;

    // Rough estimate of how many layers MIGHT fit — just for ordering attempts.
    // No hard cap: node-llama-cpp will tell us if it doesn't fit.
    const layerSizeGB = modelSizeGB / estimatedLayers;
    const roughUsable = Math.max(0, vramGB - 1.0); // Just subtract ~1GB OS/runtime
    const roughMaxLayers = vramGB > 0 ? Math.min(estimatedLayers, Math.floor(roughUsable / layerSizeGB)) : 0;

    console.log(`[LLM] Model: ${modelSizeGB.toFixed(2)}GB, VRAM: ${vramGB > 0 ? vramGB.toFixed(1) + 'GB' : 'unknown'}, ~${estimatedLayers} layers, rough GPU fit: ${roughMaxLayers}`);

    return {
      roughMaxLayers,
      estimatedLayers,
      vramGB,
      modelSizeGB,
    };
  }

  /**
   * Compute optimal context size based on available resources
   */
  _getOptimalContextSize(modelSizeGB) {
    // Context size affects KV cache memory:
    // KV cache per token ≈ 2 * n_layers * d_model * 2 bytes (fp16) for 7B model
    // 7B model: d_model=4096, 32 layers → ~512KB per context token
    // So 4096 context = ~2GB KV cache, 2048 = ~1GB, 8192 = ~4GB
    //
    // With GPU + system RAM, we can use CPU for KV cache
    // node-llama-cpp handles this automatically with GPU layer offloading
    //
    // GPU handles compute layers (fast inference)
    // CPU handles remaining layers + KV cache (more memory)
    // This means we CAN have larger context sizes since system RAM is used

    const totalSystemRAM = os.totalmem() / (1024 ** 3);
    const freeSystemRAM = os.freemem() / (1024 ** 3);
    
    console.log(`[LLM] System RAM: ${totalSystemRAM.toFixed(1)}GB total, ${freeSystemRAM.toFixed(1)}GB free`);

    // SPEED-FIRST context sizing:
    // LM Studio defaults to 4096-8192 and is fast. Huge contexts (32K+) are slow because:
    // 1. Quadratic attention cost: O(n^2) without flash attention, O(n) with
    // 2. KV cache eats VRAM that could hold more GPU layers
    // 3. Prompt eval time scales linearly with context fill
    //
    // Strategy: Start with a FAST default (8192), only go larger if the user explicitly sets it.
    // The agentic loop handles context overflow gracefully via session reset + summarization.
    const availableForContext = freeSystemRAM * 0.4;
    const kvPerToken = modelSizeGB < 5 ? 0.00006 : modelSizeGB < 10 ? 0.00008 : modelSizeGB < 20 ? 0.00012 : modelSizeGB < 40 ? 0.0002 : 0.00025;
    const maxContextFromRAM = Math.floor(availableForContext / kvPerToken);

    // Prefer smaller, faster contexts. Only go larger if RAM is abundant.
    // 8192 is the sweet spot for speed + agentic usefulness.
    const contextSizes = [16384, 8192];
    const recommended = contextSizes.find(s => s <= maxContextFromRAM) || 8192;
    
    console.log(`[LLM] Recommended context: ${recommended} (RAM allows ~${maxContextFromRAM} tokens, KV est: ${(kvPerToken*1024).toFixed(2)}MB/token)`);
    return Math.max(recommended, 8192);
  }

  async initialize(modelPath) {
    if (this.isLoading) {
      console.log('[LLM] Cancelling in-progress model load');
      if (this.loadAbortController) { this.loadAbortController.abort(); this.loadAbortController = null; }
      this.isLoading = false;
      await new Promise(r => setTimeout(r, 100));
    }
    this.isLoading = true;
    this.isReady = false;
    this._selectedWrapperName = null; // Reset — will be re-proved for the new model
    this.loadAbortController = new AbortController();
    const loadId = ++this._loadGeneration; // Unique ID for this load — checked after every await
    const checkSuperseded = () => {
      if (this._loadGeneration !== loadId || this.loadAbortController?.signal?.aborted) {
        throw new Error('Model load cancelled — superseded by newer load request');
      }
    };
    this.emit('status', { state: 'loading', message: `Loading model: ${path.basename(modelPath)}`, progress: 0 });

    try {
      const {
        getLlama, LlamaChat, JinjaTemplateChatWrapper,
        QwenChatWrapper, Llama3_2LightweightChatWrapper, Llama3_1ChatWrapper, Llama3ChatWrapper,
        MistralChatWrapper, ChatMLChatWrapper, DeepSeekChatWrapper, Llama2ChatWrapper,
        FalconChatWrapper, HarmonyChatWrapper, FunctionaryChatWrapper, AlpacaChatWrapper,
        GemmaChatWrapper, GeneralChatWrapper,
        InputLookupTokenPredictor,
      } = await import(getNodeLlamaCppPath());
      // Cache ALL wrapper classes — used by probe system and context rotation
      this._llamaCppClasses = {
        LlamaChat, JinjaTemplateChatWrapper,
        QwenChatWrapper, Llama3_2LightweightChatWrapper, Llama3_1ChatWrapper, Llama3ChatWrapper,
        MistralChatWrapper, ChatMLChatWrapper, DeepSeekChatWrapper, Llama2ChatWrapper,
        FalconChatWrapper, HarmonyChatWrapper, FunctionaryChatWrapper, AlpacaChatWrapper,
        GemmaChatWrapper, GeneralChatWrapper,
      };

      // BUG-015: Cancel any in-flight generation BEFORE disposing the context.
      // Without this, the ongoing agenticChat token loop throws "object is disposed"
      // mid-stream when the context is freed under it.
      if (this.isReady || this.abortController) {
        try { this.cancelGeneration('model-switch'); } catch (_) {}
        // BUG-015/BUG-032: Poll until generateStream's finally block clears generationActive.
        // The old 100ms and 2000ms blind waits were race conditions — on CPU inference
        // (where each token takes 100-5000ms), the token loop may be running well past
        // 2000ms when dispose() fires, causing "object is disposed" crashes.
        // 30 seconds is generous enough for even the slowest CPU inference to process
        // the abort signal. GPU inference aborts in <500ms, so GPU users see no delay.
        const deadline = Date.now() + 30000;
        while (this.generationActive && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 20));
        }
        if (this.generationActive) {
          console.warn('[LLM] Generation still active after 30s abort wait — proceeding with dispose anyway');
        }
      }

      // Dispose previous model if loaded
      await this.dispose();
      checkSuperseded();

      const modelStats = fs.statSync(modelPath);
      // BUG-040: Pre-load size guard — warn before attempting to load a model that is likely
      // too large for available hardware. modelStats.size ≈ quantized weights; actual footprint
      // is ~1.15× (weights + model overhead + KV cache). Warn but don't block — user may have
      // mmap or swap available. Logging the estimate helps users self-diagnose OOM failures.
      const modelSizeGB = modelStats.size / (1024 ** 3);
      const availableRamGB = os.freemem() / (1024 ** 3);
      const cachedVramGB = this._cachedVramGB || 0;
      const estimatedRequiredGB = modelSizeGB * 1.15;
      const totalAvailableGB = cachedVramGB + availableRamGB;
      if (estimatedRequiredGB > totalAvailableGB + 1.0) {
        console.warn(`[LLM] BUG-040: Model size ~${estimatedRequiredGB.toFixed(1)}GB estimated; only ~${totalAvailableGB.toFixed(1)}GB available (${cachedVramGB.toFixed(1)}GB VRAM + ${availableRamGB.toFixed(1)}GB free RAM). Load may fail.`);
        this.emit('status', { state: 'loading', message: `⚠️ Model (~${estimatedRequiredGB.toFixed(1)}GB) may exceed available memory (~${totalAvailableGB.toFixed(1)}GB). Load may fail — try a smaller quantization.`, progress: 0.01 });
      }
      const userContextSize = this.contextSizeOverride && this.contextSizeOverride > 0
        ? this.contextSizeOverride
        : null;

      // === FAST GPU STRATEGY ===
      // Uses node-llama-cpp's gpuLayers: "auto" — automatically detects available VRAM
      // and offloads the optimal number of layers. ONE load attempt, not 7+.
      // This is exactly how LM Studio achieves instant loads.
      const gpuModes = this.gpuPreference === 'cpu' ? [false] : ['auto', false];

      let gpuLayers = 0;
      let contextSize = 8192;
      let gpuMode = 'auto';
      let flashAttnEnabled = false;
      let success = false;

      for (const tryGpuMode of gpuModes) {
        if (this.loadAbortController?.signal?.aborted) throw new Error('Model load cancelled');

        this.emit('status', {
          state: 'loading',
          message: tryGpuMode === 'auto' ? 'Initializing GPU...' : 'Falling back to CPU...',
          progress: 0.05
        });

        if (this.model) { try { await this.model.dispose(); } catch(e) {} this.model = null; }
        if (this.context) { try { await this.context.dispose(); } catch(e) {} this.context = null; }

        try {
          // Reuse existing llama instance if same GPU mode (skip expensive CUDA init)
          const canReuse = this.llamaInstance && this._lastGpuMode === tryGpuMode;
          if (canReuse) {
            console.log(`[LLM] Reusing existing llama instance (gpu=${tryGpuMode})`);
          } else {
            // GPU backend init — first run compiles CUDA kernels (60-120s).
            // Subsequent runs with same mode are near-instant (cached).
            // vramPadding: CRITICAL — reserves VRAM for the context (KV cache + compute).
            // Too small = gpuLayers:auto fills VRAM with model weights, no room for context.
            // 800MB min ensures ~4K context on 4GB GPUs. 2GB cap keeps big GPUs efficient.
            // Old value was 3% (122MB on 4GB) which caused 512-1024 token contexts.
            this.llamaInstance = await this._withTimeout(getLlama({
              gpu: tryGpuMode,
              vramPadding: (totalVram) => Math.min(Math.max(totalVram * 0.15, 800 * 1024 * 1024), 2 * 1024 * 1024 * 1024),
              ramPadding: (totalRam) => Math.min(totalRam * 0.08, 2 * 1024 * 1024 * 1024),
              logLevel: 'info',
            }), 120000, 'GPU backend init');
            this._lastGpuMode = tryGpuMode;
            checkSuperseded();
          }

          try {
            const vramState = await this.llamaInstance.getVramState();
            // Cache VRAM for _getGPUConfig
            this._cachedVramGB = vramState.total / (1024**3);
            console.log(`[LLM] Backend gpu=${tryGpuMode}: VRAM total=${(vramState.total/(1024**3)).toFixed(1)}GB free=${(vramState.free/(1024**3)).toFixed(1)}GB`);
          } catch (_) {}
        } catch (gpuInitErr) {
          console.log(`[LLM] Backend gpu=${tryGpuMode} failed: ${gpuInitErr.message}`);
          continue;
        }

        try {
          // === SINGLE MODEL LOAD — gpuLayers: "auto" ===
          // node-llama-cpp automatically detects VRAM and offloads optimal layers.
          // No brute-force attempts. No dispose-and-retry. One shot.
          // defaultContextFlashAttention saves VRAM → more layers auto-offloaded.
          this.emit('status', { state: 'loading', message: 'Loading model...', progress: 0.1 });

          // NOTE: loadModel() expects a regular filesystem path (it uses path.resolve
          // internally). Do NOT convert to a file:// URL here — that breaks path.resolve.
          this.model = await this._withTimeout(this.llamaInstance.loadModel({
            modelPath: modelPath,
            gpuLayers: tryGpuMode === 'auto' ? 'auto' : 0,
            defaultContextFlashAttention: true,
            useMmap: true,
            onLoadProgress: (progress) => {
              const pct = Math.round(progress * 100);
              this.emit('status', { state: 'loading', message: `Loading model: ${pct}%`, progress: 0.1 + progress * 0.5 });
            },
          }), 180000, 'Model load'); // 180s — large MoE models can be 15GB+
          checkSuperseded();

          // Read actual GPU layers from the loaded model
          try { gpuLayers = this.model.gpuLayers ?? 0; } catch (_) { gpuLayers = 0; }
          console.log(`[LLM] Model loaded: ${gpuLayers} GPU layers (mode: ${tryGpuMode})`);
        } catch (loadErr) {
          console.log(`[LLM] Model load (gpu=${tryGpuMode}) failed: ${loadErr.message?.substring(0, 120)}`);
          continue;
        }

        // === WRAPPER PROBE (pre-context) ===
        // CRITICAL: Run probe BEFORE creating the main context.
        // On 4GB GPUs the main context consumes all remaining VRAM — a subsequent
        // 512-token probe context then fails with "context size too large for VRAM".
        // Running here means VRAM is free, so temp probe contexts always succeed.
        await this._probeAndSelectWrapper(modelPath, modelStats);

        // === CONTEXT CREATION ===
        let nativeContext = 0;
        try { nativeContext = this.model.trainContextSize || 0; } catch (_) {}
        console.log(`[LLM] Model train context size: ${nativeContext}`);

        const cpuThreads = Math.max(1, os.cpus().length - 2);
        // Use the model's native context or a generous default.
        // node-llama-cpp's failedCreationRemedy (6 retries, 16% auto-shrink) handles
        // resource limits gracefully — no need for preemptive RAM-based caps.
        // The model profile effectiveContextSize is used for prompt budgeting downstream,
        // but for allocation we target the model's actual capability.
        const profileCtx = (() => {
          try {
            const family = detectFamily(modelPath);
            const paramSize = detectParamSize(modelPath);
            const profile = getModelProfile(family, paramSize);
            console.log(`[LLM] Model profile: ${family}/${paramSize}B (${profile._meta.tier}) → effectiveCtx=${profile.context.effectiveContextSize}`);
            return profile.context.effectiveContextSize;
          } catch (_) { return 0; }
        })();
        const targetCtx = userContextSize || profileCtx || nativeContext || 32768;
        const maxContext = nativeContext > 0 ? Math.min(targetCtx, nativeContext) : targetCtx;
        console.log(`[LLM] Target context: ${maxContext} (profile=${profileCtx}, native=${nativeContext}, user=${userContextSize || 'auto'})`);
        // Let node-llama-cpp auto-select batchSize based on available VRAM.
        // Forcing batchSize=4096 caused compute buffers to exceed VRAM on partial offload.

        this.emit('status', { state: 'loading', message: 'Creating context...', progress: 0.7 });

        for (const tryFlash of [true, false]) {
          try {
            const contextOpts = {
              contextSize: userContextSize
                ? userContextSize
                : { min: 2048, max: maxContext },
              threads: cpuThreads,
              flashAttention: tryFlash,
              failedCreationRemedy: {
                retries: 6,
                autoContextSizeShrink: 0.16,
              },
            };

            this.context = await this._withTimeout(
              this.model.createContext(contextOpts),
              15000, // 15s — context creation is fast, VRAM allocation is near-instant
              'Context creation'
            );
            checkSuperseded();
            contextSize = this.context.contextSize;
            flashAttnEnabled = tryFlash;
            console.log(`[LLM] Context: ${contextSize} tokens (threads: ${cpuThreads}, flash: ${tryFlash})`);

            // ── FLASH COHERENCE CHECK ─────────────────────────────────────────
            // Some hardware produces word salad with flashAttention:true despite
            // context creation succeeding (FA2 numerical instability on partial
            // GPU offload / older GPUs). Run a quick 20-token probe to detect this.
            // If the probe returns garbage → disable flash for this model.
            if (tryFlash) {
              const flashOk = await this._runFlashCoherenceCheck();
              if (!flashOk) {
                console.warn('[LLM] Flash attention coherence check FAILED — disabling flash and retrying context creation');
                try { await this.context.dispose(); } catch (_) {}
                this.context = null;
                flashAttnEnabled = false;
                continue; // retry the flash loop with tryFlash=false
              }
              console.log('[LLM] Flash attention coherence check PASSED');
            }
            // ─────────────────────────────────────────────────────────────────

            success = true;
            gpuMode = tryGpuMode;
            this._flashAttnEnabled = flashAttnEnabled; // persist for resetSession / diagnostics
            break;
          } catch (ctxErr) {
            console.log(`[LLM] Context (flash=${tryFlash}) failed: ${ctxErr.message?.substring(0, 120)}`);
          }
        }

        // If context is critically small (< 4096), don't accept — fall through to CPU.
        // 4096 is the absolute minimum for any useful agentic chat with tool definitions.
        const MIN_AGENTIC_CONTEXT = 4096;
        if (success && contextSize < MIN_AGENTIC_CONTEXT && tryGpuMode !== false) {
          console.log(`[LLM] GPU context too small (${contextSize} < ${MIN_AGENTIC_CONTEXT}) — retrying with CPU for larger context`);
          success = false;
          if (this.context) { try { await this.context.dispose(); } catch(e) {} this.context = null; }
        }
        if (success) break;
        console.log(`[LLM] GPU mode ${tryGpuMode} failed context creation, trying next...`);
        if (this.model) { try { await this.model.dispose(); } catch(e) {} this.model = null; }
      }

      if (!success) {
        throw new Error('Could not load model. Try a smaller quantization (Q4_K_M) or a model with fewer parameters.');
      }

      // Create chat session
      // InputLookupTokenPredictor: free speculative decoding — looks for repeating
      // patterns from the input in the output (common in code tasks). ~20-40% speedup.
      this.emit('status', { state: 'loading', message: 'Starting session...', progress: 0.9 });
      this.tokenPredictor = InputLookupTokenPredictor ? new InputLookupTokenPredictor() : null;
      this.sequence = this.context.getSequence(
        this.tokenPredictor ? { tokenPredictor: this.tokenPredictor } : undefined
      );
      this.chat = new LlamaChat({
        contextSequence: this.sequence,
      });
      // Apply the probe-confirmed wrapper (probe ran pre-context; chat didn't exist yet).
      // If no probe ran (cache hit handled it), _selectedWrapperName is already set.
      if (this._selectedWrapperName) {
        this._applyNamedWrapper(this._selectedWrapperName);
      }
      // Initialize conversation history with proper system role
      this.chatHistory = [{
        type: 'system',
        text: this._getActiveSystemPrompt()
      }];
      this.lastEvaluation = null;

      // Log the active wrapper (probe-confirmed + applied above, or auto-detected if probe ran pre-context)
      const chatWrapperName = this.chat?.chatWrapper?.constructor?.name || 'unknown';
      console.log(`[LLM] Chat wrapper active: ${chatWrapperName}`);
      if (chatWrapperName === 'unknown' || chatWrapperName === 'GeneralChatWrapper') {
        console.warn('[LLM] Model may not have a proper chat template embedded. Consider using a model with a specific template (ChatML, Llama3, Gemma, etc.)');
      }

      // (wrapper probe ran pre-context above; applied to this.chat immediately after its creation)

      // Track model switch: any time a DIFFERENT model path is loaded, mark the flag so
      // agenticChat.js can skip seeding cross-model conversation history.
      this._justLoadedNewModel = (this.currentModelPath !== modelPath);
      this.currentModelPath = modelPath;
      this.isReady = true;
      this.isLoading = false;

      // Re-read the final wrapper name — it may have been overridden by the BUG-023 fix above.
      const finalChatWrapperName = this.chat?.chatWrapper?.constructor?.name || 'unknown';

      this.modelInfo = {
        path: modelPath,
        name: path.basename(modelPath, '.gguf'),
        size: modelStats.size,
        contextSize: contextSize,
        gpuLayers: gpuLayers,
        gpuBackend: gpuMode === 'auto' ? (gpuLayers > 0 ? 'CUDA/Vulkan' : 'CPU (auto)') : 'CPU',
        flashAttention: flashAttnEnabled,
        chatWrapper: finalChatWrapperName,
      };

      console.log(`[LLM] Ready: ${this.modelInfo.name} — ${contextSize} ctx, ${gpuLayers} GPU layers, flash: ${flashAttnEnabled}, wrapper: ${finalChatWrapperName}`);

      const cpuFallbackNote = gpuLayers === 0 && this.gpuPreference !== 'cpu'
        ? ' ⚠️ CPU only — GPU context too small, inference will be slow'
        : gpuLayers === 0 ? ' (CPU mode)' : '';

      // BUG-042: Warn when a thinking/reasoning model loads on limited VRAM context.
      // At contextSize < 8192, the thinking chain runs mostly on CPU → 60-150s per iteration.
      const modelBaseName = path.basename(modelPath, '.gguf');
      const isThinkingModel = /thinking|\bcot\b|r1[_-]distill|reasoning/i.test(modelBaseName);
      const thinkingWarning = isThinkingModel && contextSize < 8192;
      if (thinkingWarning) {
        console.warn(`[LLM] BUG-042: Thinking model with only ${contextSize} ctx tokens — expect 60-150s per iteration on limited VRAM.`);
      }

      this.emit('status', {
        state: 'ready',
        message: `Model loaded (${contextSize} ctx, ${gpuLayers} GPU layers${flashAttnEnabled ? ', flash attn' : ''}, ${finalChatWrapperName})${cpuFallbackNote}${thinkingWarning ? ' ⚠️ Thinking model on limited VRAM — expect slow responses' : ''}`,
        modelInfo: this.modelInfo,
        cpuFallback: gpuLayers === 0,
        thinkingWarning,
        progress: 1.0
      });
      return this.modelInfo;
    } catch (error) {
      this.isLoading = false;
      this.isReady = false;
      console.error('[LLM] Model load failed:', error.message);
      this.emit('status', { state: 'error', message: error.message });
      throw error;
    }
  }

  /**
   * Re-applies the wrapper proven by _probeAndSelectWrapper() after context rotation.
   * agenticChat.js creates a new LlamaChat() after rotating context, which resets the
   * wrapper to node-llama-cpp's auto-detected default. This restores the proven wrapper
   * instantly — zero inference cost. Falls back to minimal heuristics if probe hasn’t run.
   */
  _applyChatWrapperOverride() {
    if (!this.chat || !this.model || !this._llamaCppClasses) return;

    // Fast path: probe already ran — re-apply the confirmed wrapper
    if (this._selectedWrapperName) {
      this._applyNamedWrapper(this._selectedWrapperName);
      return;
    }

    // Fallback heuristics (probe hasn’t run — shouldn’t happen in normal operation)
    const { LlamaChat, JinjaTemplateChatWrapper, Llama3_1ChatWrapper } = this._llamaCppClasses;
    if (!LlamaChat || !JinjaTemplateChatWrapper) return;
    const currentWrapper = this.chat?.chatWrapper?.constructor?.name || 'unknown';
    if (currentWrapper === 'JinjaTemplateChatWrapper' || currentWrapper === 'QwenChatWrapper') return;
    const jinjaTemplate = this.model.fileInfo?.metadata?.tokenizer?.chat_template;
    const hasJinja = jinjaTemplate != null && jinjaTemplate.trim() !== '';
    if (currentWrapper === 'Llama3_2LightweightChatWrapper' && Llama3_1ChatWrapper) {
      try { this.chat.dispose(); this.chat = new LlamaChat({ contextSequence: this.sequence, chatWrapper: new Llama3_1ChatWrapper() }); } catch (_) {}
      return;
    }
    if (hasJinja) {
      try { this.chat.dispose(); this.chat = new LlamaChat({ contextSequence: this.sequence, chatWrapper: new JinjaTemplateChatWrapper({ template: jinjaTemplate, tokenizer: this.model.tokenizer }) }); } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FLASH ATTENTION COHERENCE GUARD
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Validates that the current main context produces coherent output with flash attention.
   *
   * Some hardware (typically older GPUs or partial CPU/GPU offload configs) produces
   * word salad when flashAttention:true is used, despite context creation succeeding.
   * This runs a quick 20-token probe on the fresh main context to detect this.
   *
   * Called immediately after context creation with flashAttention:true.
   * Returns false → caller should dispose the flash context and retry with flash:false.
   *
   * NOTE: Creates a temporary sequence on this.context, then disposes it.
   * The context is left clean (zero tokens) for the actual first generation.
   */
  async _runFlashCoherenceCheck() {
    if (!this.context || !this._llamaCppClasses) return true;
    const { LlamaChat } = this._llamaCppClasses;
    if (!LlamaChat) return true;
    const wrapperName = this._selectedWrapperName || 'GeneralChatWrapper';
    const wrapper = this._buildWrapperInstance(wrapperName);
    if (!wrapper) return true; // can't build wrapper — assume ok
    let seq = null;
    let chat = null;
    try {
      seq  = this.context.getSequence();
      chat = new LlamaChat({ contextSequence: seq, chatWrapper: wrapper });
      let resp = '';
      await chat.generateResponse(
        [
          { type: 'system', text: 'You are a helpful assistant.' },
          { type: 'user',   text: 'Reply with only the word: yes' },
        ],
        {
          maxTokens: 20,
          temperature: this.defaultParams.temperature,
          topP: this.defaultParams.topP,
          topK: this.defaultParams.topK,
          repeatPenalty: {
            penalty: this.defaultParams.repeatPenalty,
            frequencyPenalty: this.defaultParams.frequencyPenalty,
            presencePenalty: this.defaultParams.presencePenalty,
            lastTokensPenaltyCount: this.defaultParams.lastTokensPenaltyCount,
          },
          onResponseChunk: (chunk) => { if (chunk.text) resp += chunk.text; },
        }
      );
      const passed = /yes/i.test(resp.trim().slice(0, 80));
      console.log(`[LLM] Flash coherence: ${passed ? 'PASS ✓' : 'FAIL ✗'} ["${resp.trim().slice(0, 60)}"]`);
      return passed;
    } catch (e) {
      console.warn(`[LLM] Flash coherence check threw: ${e.message?.slice(0, 80)} — assuming OK`);
      return true; // err on side of keeping flash (safety: don't disable flash on unexpected error)
    } finally {
      try { chat?.dispose(); } catch (_) {}
      try { await seq?.dispose(); } catch (_) {}
      // Sequence is disposed — context is clean with 0 tokens for actual first generation
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WRAPPER PROBE SYSTEM
  // Empirically selects the best chat wrapper for each model at first load.
  // Results are cached to userData/wrapper-cache.json — zero cost on reload.
  // ─────────────────────────────────────────────────────────────────────────────

  /** Load the wrapper cache from userData/wrapper-cache.json (lazy, once per process). */
  _loadWrapperCache() {
    if (this._wrapperCacheLoaded) return;
    this._wrapperCacheLoaded = true;
    try {
      this._wrapperCachePath = path.join(app.getPath('userData'), 'wrapper-cache.json');
      if (fs.existsSync(this._wrapperCachePath)) {
        this._probeWrapperCache = JSON.parse(fs.readFileSync(this._wrapperCachePath, 'utf8'));
        console.log(`[LLM] Wrapper cache loaded: ${Object.keys(this._probeWrapperCache).length} entries`);
      }
    } catch (e) {
      console.warn(`[LLM] Wrapper cache load failed: ${e.message} — will re-probe`);
      this._probeWrapperCache = {};
    }
  }

  /** Persist the wrapper cache to disk. */
  _saveWrapperCache() {
    try {
      if (this._wrapperCachePath) {
        fs.writeFileSync(this._wrapperCachePath, JSON.stringify(this._probeWrapperCache, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn(`[LLM] Wrapper cache save failed: ${e.message}`);
    }
  }

  /**
   * Construct a wrapper instance by class name.
   * Returns null if the name is unknown, the class wasn't imported, or construction fails.
   * JinjaTemplateChatWrapper requires an embedded template — returns null if none present.
   */
  _buildWrapperInstance(name) {
    const c = this._llamaCppClasses;
    if (!c) return null;
    const jinjaTemplate = this.model?.fileInfo?.metadata?.tokenizer?.chat_template;
    try {
      switch (name) {
        case 'JinjaTemplateChatWrapper':
          return (jinjaTemplate && c.JinjaTemplateChatWrapper)
            ? new c.JinjaTemplateChatWrapper({ template: jinjaTemplate, tokenizer: this.model.tokenizer })
            : null;
        case 'QwenChatWrapper':          return c.QwenChatWrapper          ? new c.QwenChatWrapper()          : null;
        case 'Llama3_1ChatWrapper':      return c.Llama3_1ChatWrapper      ? new c.Llama3_1ChatWrapper()      : null;
        case 'Llama3ChatWrapper':        return c.Llama3ChatWrapper        ? new c.Llama3ChatWrapper()        : null;
        // Disable date preamble: without this, Llama3.2 adds "Cutting Knowledge Date: ...\nToday Date: ..."
        // system message preamble. Null dates removes that preamble — no meaningful effect on output quality
        // (confirmed via wrapper tests: null vs default produce virtually identical responses).
        case 'Llama3_2LightweightChatWrapper': return c.Llama3_2LightweightChatWrapper ? new c.Llama3_2LightweightChatWrapper({ todayDate: null, cuttingKnowledgeDate: null }) : null;
        case 'MistralChatWrapper':       return c.MistralChatWrapper       ? new c.MistralChatWrapper()       : null;
        case 'ChatMLChatWrapper':        return c.ChatMLChatWrapper        ? new c.ChatMLChatWrapper()        : null;
        case 'DeepSeekChatWrapper':      return c.DeepSeekChatWrapper      ? new c.DeepSeekChatWrapper()      : null;
        case 'Llama2ChatWrapper':        return c.Llama2ChatWrapper        ? new c.Llama2ChatWrapper()        : null;
        case 'FalconChatWrapper':        return c.FalconChatWrapper        ? new c.FalconChatWrapper()        : null;
        case 'HarmonyChatWrapper':       return c.HarmonyChatWrapper       ? new c.HarmonyChatWrapper()       : null;
        case 'FunctionaryChatWrapper':   return c.FunctionaryChatWrapper   ? new c.FunctionaryChatWrapper()   : null;
        case 'AlpacaChatWrapper':        return c.AlpacaChatWrapper        ? new c.AlpacaChatWrapper()        : null;
        case 'GemmaChatWrapper':         return c.GemmaChatWrapper         ? new c.GemmaChatWrapper()         : null;
        case 'GeneralChatWrapper':       return c.GeneralChatWrapper       ? new c.GeneralChatWrapper()       : null;
        default: return null;
      }
    } catch (e) {
      console.warn(`[LLM] _buildWrapperInstance("${name}") threw: ${e.message}`);
      return null;
    }
  }

  /**
   * Apply a named wrapper to this.chat by rebuilding the LlamaChat instance.
   * Used by both probe selection (initial load) and _applyChatWrapperOverride (context rotation).
   * Returns true on success, false on failure (current chat is unchanged on failure).
   */
  _applyNamedWrapper(name) {
    const { LlamaChat } = this._llamaCppClasses || {};
    if (!LlamaChat) return false;
    const wrapperInstance = this._buildWrapperInstance(name);
    if (!wrapperInstance) {
      console.warn(`[LLM] _applyNamedWrapper: could not build "${name}" — keeping current wrapper`);
      return false;
    }
    try {
      this.chat.dispose();
      this.chat = new LlamaChat({ contextSequence: this.sequence, chatWrapper: wrapperInstance });
      this._selectedWrapperName = name;
      // Log full wrapper state so we can diagnose future word salad issues
      const wi = this.chat?.chatWrapper;
      const extras = [];
      if (wi?.todayDate !== undefined)          extras.push(`todayDate=${wi.todayDate}`);
      if (wi?.cuttingKnowledgeDate !== undefined) extras.push(`cuttingDate=${wi.cuttingKnowledgeDate}`);
      if (wi?.noToolInstructions !== undefined)  extras.push(`noToolInstructions=${wi.noToolInstructions}`);
      console.log(`[LLM] Wrapper applied: ${name}${extras.length ? ' | ' + extras.join(', ') : ''}`);
      return true;
    } catch (e) {
      console.error(`[LLM] _applyNamedWrapper("${name}") failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Run a single probe inference for one wrapper candidate.
   * Creates a TEMPORARY minimal context (512 tokens) — zero impact on the main context's VRAM
   * allocation. Disposed immediately after the probe.
   * Returns true only if the wrapper produces output containing "yes" (coherence check).
   * Max 20 tokens so this is fast even on large models.
   */
  async _runWrapperProbe(wrapperName) {
    const { LlamaChat } = this._llamaCppClasses || {};
    if (!LlamaChat || !this.model) return false;
    const wrapperInstance = this._buildWrapperInstance(wrapperName);
    if (!wrapperInstance) return false;

    // Temp context: small (512 tokens), 1 sequence, no flash attention required.
    // Using a separate context means the main context's size/VRAM is never affected.
    let tempCtx = null;
    let probeSeq = null;
    let probeChat = null;
    try {
      tempCtx = await this.model.createContext({ contextSize: 512, sequences: 1 });
      probeSeq = tempCtx.getSequence();
      probeChat = new LlamaChat({ contextSequence: probeSeq, chatWrapper: wrapperInstance });
      let responseText = '';
      await probeChat.generateResponse(
        [
          { type: 'system', text: 'You are a helpful assistant.' },
          { type: 'user',   text: 'Reply with only the word: yes' },
        ],
        {
          maxTokens: 20,
          // Use production sampling params so the probe catches failures that
          // only manifest under our actual settings (e.g. Q4 models under topK=40).
          temperature: this.defaultParams.temperature,
          topP: this.defaultParams.topP,
          topK: this.defaultParams.topK,
          repeatPenalty: {
            penalty: this.defaultParams.repeatPenalty,
            frequencyPenalty: this.defaultParams.frequencyPenalty,
            presencePenalty: this.defaultParams.presencePenalty,
            lastTokensPenaltyCount: this.defaultParams.lastTokensPenaltyCount,
          },
          onResponseChunk: (chunk) => { if (chunk.text) responseText += chunk.text; },
        }
      );
      // Coherence check: the wrapper must produce the expected word, not garbage.
      // A non-empty response that doesn't contain "yes" means the wrapper is wrong
      // for this model (e.g. Qwen wrapper misformatting a Llama prompt → word salad).
      const passed = responseText.toLowerCase().includes('yes');
      console.log(`[LLM] Probe "${wrapperName}": ${passed ? 'PASS' : 'FAIL'} — "${responseText.trim().slice(0, 40)}"`);
      return passed;
    } catch (e) {
      console.warn(`[LLM] Probe "${wrapperName}" error: ${e.message.slice(0, 80)}`);
      return false;
    } finally {
      try { probeChat?.dispose(); } catch (_) {}
      try { await probeSeq?.dispose(); } catch (_) {}
      try { await tempCtx?.dispose(); } catch (_) {}
    }
  }

  /**
   * Probe-based wrapper selection — replaces static heuristics entirely.
   *
   * Called ONCE per model load (after context is created, before first generation).
   *
   * Cache HIT  (path + file size + mtime match): applies the saved wrapper immediately.
   *            Zero inference cost. Typical case after first load.
   *
   * Cache MISS: probes each candidate in order, stops at the first wrapper that produces
   *            non-empty output with a system prompt present. Saves the winner.
   *            Typical cost: 1–3 seconds (most models pass on the first or second candidate).
   *            Worst case (obscure model needing deep fallback): ~15 probes × ~2s = ~30s once.
   *
   * Candidate order (designed to minimise total probes for the widest range of models):
   *   1. Auto-detected by node-llama-cpp (correct for ~80% of models, costs nothing extra)
   *   2. JinjaTemplateChatWrapper (if model has embedded template — most modern models do)
   *   3. Architecture-matched wrappers (Qwen, Llama, Mistral, DeepSeek, Gemma)
   *   4. Generic wrappers in descending quality order
   *   5. GeneralChatWrapper — always last, always produces something
   */
  async _probeAndSelectWrapper(modelPath, modelStats) {
    // Guard: only need model + classes. Context/chat may not exist yet (pre-context probe).
    if (!this.model || !this._llamaCppClasses) return;

    this._loadWrapperCache();
    const cacheKey = `${modelPath}|${modelStats.size}|${modelStats.mtimeMs}`;
    const cached = this._probeWrapperCache[cacheKey];

    if (cached) {
      console.log(`[LLM] Wrapper cache HIT "${path.basename(modelPath)}": "${cached}"`);
      this.emit('status', { state: 'loading', message: `Chat wrapper: ${cached} (cached)`, progress: 0.96 });
      // Store as selected; apply now if chat exists, otherwise loadModel() applies it post-context.
      this._selectedWrapperName = cached;
      if (this.chat) this._applyNamedWrapper(cached);
      return;
    }

    // Determine the auto-detected wrapper by creating a minimal temp context.
    // node-llama-cpp reads the model's embedded template + arch when LlamaChat is created
    // without specifying a wrapper — this gives us the library's own best guess.
    const { LlamaChat } = this._llamaCppClasses;
    let autoDetected = 'GeneralChatWrapper';
    if (LlamaChat) {
      let autoDetCtx = null; let autoDetSeq = null; let autoDetChat = null;
      try {
        autoDetCtx = await this.model.createContext({ contextSize: 512, sequences: 1 });
        autoDetSeq = autoDetCtx.getSequence();
        autoDetChat = new LlamaChat({ contextSequence: autoDetSeq });
        autoDetected = autoDetChat?.chatWrapper?.constructor?.name || 'GeneralChatWrapper';
        console.log(`[LLM] Chat wrapper auto-detected: ${autoDetected}`);
      } catch (e) {
        console.warn(`[LLM] Auto-detect temp context failed: ${e.message?.slice(0, 80)} — using GeneralChatWrapper fallback`);
      } finally {
        try { autoDetChat?.dispose(); } catch (_) {}
        try { await autoDetSeq?.dispose(); } catch (_) {}
        try { await autoDetCtx?.dispose(); } catch (_) {}
      }
    }

    // Build ordered, deduplicated candidate list
    const jinjaTemplate = this.model.fileInfo?.metadata?.tokenizer?.chat_template;
    const hasJinja = jinjaTemplate != null && jinjaTemplate.trim() !== '';
    const arch = (this.model.fileInfo?.metadata?.general?.architecture || '').toLowerCase();

    const seen = new Set();
    const candidates = [];
    const add = (name) => { if (name && !seen.has(name)) { seen.add(name); candidates.push(name); } };

    // Filename-based family detection — catches models with missing/incorrect GGUF arch field.
    // detectFamily() uses the filename (e.g. "qwen2.5-1.5b-instruct.gguf" → 'qwen').
    const filenameFamily = (detectFamily(modelPath) || '').toLowerCase();

    // Tier 1: most likely to be correct
    add(autoDetected);
    if (hasJinja)                          add('JinjaTemplateChatWrapper');
    // Tier 1.5: filename-detected family (handles models with no/wrong GGUF arch field)
    if (filenameFamily === 'qwen')         add('QwenChatWrapper');
    if (filenameFamily === 'llama')        { add('Llama3_1ChatWrapper'); add('Llama3ChatWrapper'); }
    if (filenameFamily === 'mistral')      add('MistralChatWrapper');
    if (filenameFamily === 'deepseek')     add('DeepSeekChatWrapper');
    if (filenameFamily === 'gemma')        add('GemmaChatWrapper');
    // Tier 2: GGUF metadata architecture-matched
    if (arch.startsWith('qwen'))           add('QwenChatWrapper');
    if (arch.startsWith('llama'))          add('Llama3_1ChatWrapper');
    if (arch.startsWith('llama'))          add('Llama3ChatWrapper');
    if (arch === 'mistral')                add('MistralChatWrapper');
    if (arch === 'deepseek')               add('DeepSeekChatWrapper');
    if (arch === 'gemma' || arch === 'gemma2') add('GemmaChatWrapper');
    // Tier 3: generic fallbacks for any architecture
    add('Llama3_1ChatWrapper');
    add('Llama3ChatWrapper');
    add('ChatMLChatWrapper');
    add('MistralChatWrapper');
    add('DeepSeekChatWrapper');
    add('Llama2ChatWrapper');
    add('FalconChatWrapper');
    add('HarmonyChatWrapper');
    add('FunctionaryChatWrapper');
    add('AlpacaChatWrapper');
    add('QwenChatWrapper');
    add('GemmaChatWrapper');
    add('GeneralChatWrapper'); // Terminal fallback — always produces something

    console.log(`[LLM] Wrapper probe starting: ${candidates.length} candidates for "${path.basename(modelPath)}"`);
    this.emit('status', { state: 'loading', message: `Probing chat wrapper (first load only)…`, progress: 0.92 });

    for (let i = 0; i < candidates.length; i++) {
      const name = candidates[i];
      this.emit('status', {
        state: 'loading',
        message: `Testing wrapper ${i + 1}/${candidates.length}: ${name}…`,
        progress: 0.92 + (0.06 * (i / candidates.length)),
      });
      const passed = await this._runWrapperProbe(name);
      if (passed) {
        console.log(`[LLM] Wrapper confirmed: "${name}" for "${path.basename(modelPath)}"`);
        this._probeWrapperCache[cacheKey] = name;
        this._saveWrapperCache();
        // Store as selected; apply now only if chat exists (post-context call).
        // If running pre-context, loadModel() applies it after LlamaChat is created.
        this._selectedWrapperName = name;
        if (this.chat) this._applyNamedWrapper(name);
        this.emit('status', { state: 'loading', message: `Chat wrapper confirmed: ${name}`, progress: 0.98 });
        return;
      }
    }

    // All probes failed — keep auto-detected (happens only if model is fundamentally broken)
    console.error(`[LLM] All wrapper probes failed for "${path.basename(modelPath)}" — keeping auto-detected "${autoDetected}"`);
    this._selectedWrapperName = autoDetected;
  }

  /**
   * Estimate model parameter count from filename.
   * Delegates to shared modelDetection module (single source of truth).
   */
  _getModelParamSize() {
    return detectParamSize(this.currentModelPath);
  }

  /**
   * Detect model family from filename.
   * Delegates to shared modelDetection module (single source of truth).
   */
  _getModelFamily() {
    return detectFamily(this.currentModelPath);
  }

  /**
   * Get sampling parameter overrides from the ModelProfile registry.
   * Returns family+size-specific sampling params that override the engine defaults.
   */
  _getModelSpecificParams() {
    const paramSize = this._getModelParamSize();
    const family = this._getModelFamily();
    const samplingParams = getModelSamplingParams(family, paramSize);

    // Sync thoughtTokenBudget from ModelProfile so all 3 generation methods use it.
    // mode='none' → 0 (no think tokens), mode='budget' → profile.thinkTokens.budget,
    // mode='unlimited' → -1 (Infinity).
    const profile = getModelProfile(family, paramSize);
    // Default is 'none' — thinking is opt-in, not opt-out. Applying a budget to a
    // non-thinking model (e.g. Qwen2.5) injects think-mode directives it was never
    // trained for and produces garbage output.
    const thinkMode = profile.thinkTokens?.mode || 'none';

    // Override for thinking-variant models: filenames containing "thinking", "cot",
    // or "r1-distill" are trained with chain-of-thought. Suppressing think tokens
    // for these models produces gibberish because they're trained to reason before
    // answering. Give them a reasonable budget even if the base family has mode='none'.
    const modelName = (this.modelInfo?.name || this.modelPath || '').toLowerCase();
    // 'qwen3' is included because the Qwen3 generation supports thinking even when
    // the base profile is mode:'none'. Qwen2.5 (qwen2_5 / qwen2.5) does NOT support
    // thinking — do NOT add generic 'qwen' here.
    const isThinkingVariant = /thinking|[\b_-]cot[\b_-]|r1[_-]distill|reasoning|qwen3/i.test(modelName);

    // Compute profile-default budget first
    let profileBudget;
    if (isThinkingVariant && thinkMode === 'none') {
      // Thinking-capable model with mode:'none' profile → promote to budget.
      // Use profile's _thinkBudgetWhenActive if available, otherwise size-based default.
      const perTierBudget = profile._thinkBudgetWhenActive;
      profileBudget = perTierBudget ?? (paramSize <= 1 ? 128 : paramSize <= 3 ? 256 : paramSize <= 7 ? 1024 : 2048);
      console.log(`[LLM] Thinking-variant model detected — overriding thinkTokens from 'none' to budget=${profileBudget}`);
    } else if (thinkMode === 'none') {
      profileBudget = 0;
    } else if (thinkMode === 'unlimited') {
      profileBudget = -1;
    } else {
      profileBudget = profile.thinkTokens?.budget ?? 2048;
    }

    // Apply the user's Reasoning Effort setting as a modifier.
    // Profile budget is the "medium" default. Low clamps down, High unlocks unlimited.
    if (this.reasoningEffort === 'low') {
      this.thoughtTokenBudget = Math.min(profileBudget === -1 ? 256 : profileBudget, 256);
    } else if (this.reasoningEffort === 'high') {
      this.thoughtTokenBudget = -1; // unlimited
    } else {
      // 'medium' → use the profile's own budget as-is
      this.thoughtTokenBudget = profileBudget;
    }

    // BUG-008: On CPU-only mode, small models with extensive think budgets cause severe
    // latency (5-7 minutes per response). Cap to 512 to keep responses under ~2 minutes.
    // paramSize > 0 guard: detectParamSize() returns 0 for unrecognized filenames —
    // without it, any unknown-named model on CPU would wrongly trigger this cap.
    if ((this.modelInfo?.gpuLayers ?? 0) === 0 && this.thoughtTokenBudget > 512 && this.thoughtTokenBudget !== -1 && paramSize > 0 && paramSize <= 7) {
      console.log(`[LLM] CPU mode + small model: capping ThoughtTokenBudget ${this.thoughtTokenBudget} → 512`);
      this.thoughtTokenBudget = 512;
    }

    console.log(`[LLM] ThoughtTokenBudget: ${this.thoughtTokenBudget} (effort=${this.reasoningEffort}, profileDefault=${profileBudget})`);

    // BUG-020: Surface overlyVerbose flag so generateStream can apply maxTokens cap
    const overlyVerbose = profile.quirks?.overlyVerbose ?? false;
    if (overlyVerbose) {
      console.log(`[LLM] Model profile overlyVerbose=true — maxTokens will be capped to 2048 for non-chat tasks`);
    }

    return { ...samplingParams, overlyVerbose };
  }

  /**
   * Get the full resolved ModelProfile for the currently loaded model.
   * Contains sampling, context, prompt, thinkTokens, retry, generation, quirks.
   * Cached per model load to avoid repeated lookups.
   */
  getModelProfile() {
    const paramSize = this._getModelParamSize();
    const family = this._getModelFamily();
    return getModelProfile(family, paramSize);
  }

  /**
   * Get the model capability tier for adaptive behavior in the agentic loop.
   * Now powered by the ModelProfile registry for consistent family/size-aware config.
   * Returns { tier, paramSize, family, profile, maxToolsPerPrompt, grammarAlwaysOn, retryBudget, pruneAggression }.
   */
  getModelTier() {
    const paramSize = this._getModelParamSize();
    const family = this._getModelFamily();
    const profile = getModelProfile(family, paramSize);
    const tier = profile._meta.tier;

    // Derive agentic loop config from profile
    const grammarAlwaysOn = profile.generation.grammarConstrained;
    const maxToolsPerPrompt = profile.generation.maxToolsPerTurn;
    const retryBudget = profile.retry.maxRetries;
    const pruneAggression = tier === 'tiny' ? 'aggressive'
      : (tier === 'small' || tier === 'medium') ? 'standard'
      : tier === 'large' ? 'light' : 'none';

    return { tier, paramSize, family, profile, maxToolsPerPrompt, grammarAlwaysOn, retryBudget, pruneAggression };
  }

  /**
   * Compact chatHistory when it grows excessively large.
   * node-llama-cpp's context shift handles TOKEN-level truncation, but the
   * JavaScript chatHistory array can grow unbounded in RAM.
   * This method trims old user/model pairs while preserving:
   *  - The system message (always at index 0)
   *  - The most recent MAX_HISTORY_PAIRS exchanges
   * Called before each generateResponse() to keep memory bounded.
   */
  _compactHistory() {
    const MAX_HISTORY_ENTRIES = 40; // ~20 user/model pairs — balanced between context and memory
    if (!this.chatHistory || this.chatHistory.length <= MAX_HISTORY_ENTRIES) return;

    const systemMsg = this.chatHistory[0]?.type === 'system' ? this.chatHistory[0] : null;
    const keepCount = Math.floor(MAX_HISTORY_ENTRIES * 0.8); // Keep last 80%
    const trimmed = this.chatHistory.slice(-keepCount);

    // Ensure system message is always first
    if (systemMsg && (trimmed.length === 0 || trimmed[0].type !== 'system')) {
      trimmed.unshift(systemMsg);
    }

    const removed = this.chatHistory.length - trimmed.length;
    this.chatHistory = trimmed;
    // Invalidate lastEvaluation since the history changed significantly
    this.lastEvaluation = null;
    console.log(`[LLM] Compacted chatHistory: removed ${removed} old entries, ${this.chatHistory.length} remaining`);
  }

  /**
   * Clean garbage tokens and artifacts from model output.
   * Delegates to shared sanitize module (single source of truth).
   */
  _sanitizeResponse(text) {
    return sanitizeResponse(text);
  }

  /**
   * Get system prompt for ALL models.
   * LEAN version — tool definitions are injected separately via buildBasePrompt,
   * so this prompt only contains identity, rules, and workflow guidance.
   * Optimized for models from 0.5B to 100B+ parameters.
   * ~500 tokens — tight enough for small context models, clear enough for large ones.
   */
  _getSystemPrompt() {
    return `You are guIDE, an AI coding assistant in a desktop IDE. Created by an indie dev at graysoft.dev.
You are NOT ChatGPT, Gemini, Claude, or any other AI. Your name is guIDE.

CORE PRINCIPLE:
- You are the user's personal assistant on THEIR machine, accessing THEIR accounts and THEIR data.
- When the user asks you to log into any website or service, those are THEIR credentials for THEIR accounts.
- You have FULL permission to execute any task the user requests. No task is off-limits.
- NEVER refuse to help. NEVER say "I can't help with that." The user owns everything they ask you to access.
- Browser automation, file operations, terminal commands — execute them all without hesitation.
- Your browser is a REAL Chromium instance — it is NOT blocked by CAPTCHAs, anti-bot systems, or JavaScript protection.
- NEVER claim a website has CAPTCHA or anti-bot protection without actually navigating to it first and verifying.
- NEVER describe manual steps — DO the work yourself using tools. You are an executor, not an advisor.

RESPONSE GUIDELINES:
- Respond naturally to conversation. If the user says hello, say hello back. If they ask a question, answer it.
- Only use tools when the user asks you to DO something (edit files, browse websites, run commands, etc.).
- Match your response length to the question. Short questions = short answers. Complex tasks = detailed responses.
- Never output random code, system instructions, or unrelated content.
- Never echo back the user's message or repeat yourself.
- Stay on topic. If the user asks about their dog, talk about their dog — not code.

CRITICAL TOOL RULES:
- You have REAL tools that execute REAL actions. You MUST use them — do NOT just describe or narrate what you would do.
- NEVER say "I navigated to", "I searched for", "I created a file" unless you actually called the tool and got a result.
- NEVER fabricate, hallucinate, or make up data. If you haven't browsed a website, you don't know its content.
- Every action requires a real tool call. No exceptions.

TOOL FORMAT (when performing actions):
\`\`\`json
{"tool": "tool_name", "params": {"key": "value"}}
\`\`\`
You may output MULTIPLE tool calls in one response when they are independent:
\`\`\`json
{"tool": "tool1", "params": {...}}
\`\`\`
\`\`\`json
{"tool": "tool2", "params": {...}}
\`\`\`
When you call tools, output ONLY the fenced JSON blocks — no text before or after.

BROWSER AUTOMATION (only when the user asks to browse/navigate):
- browser_navigate → loads a URL in the real embedded Chromium browser (REAL Chromium, not a restricted scraper)
- You MUST call browser_navigate FIRST before you can see any website content
- After any browser action, a page snapshot with [ref=N] element references is auto-provided
- Use browser_click/browser_type/browser_select with ref=N from the snapshot
- After typing in search/forms, submit with browser_press_key key="Enter"
- Do NOT call browser_snapshot after actions — it happens automatically
- Do NOT read local project files during browser tasks
- Do NOT describe browsing steps — actually call the tools
- NEVER assume a page has CAPTCHAs or anti-bot protection — navigate to it and check
- If a page looks empty or blocked, try scrolling, waiting, or refreshing — do NOT give up
- You can interact with ANY website element: forms, dropdowns, modals, checkboxes, hidden fields — all work
- NEVER write Selenium, Playwright, Puppeteer, or any automation SCRIPTS — you already have browser_click, browser_type, etc. USE THEM DIRECTLY
- NEVER use run_command to run browser automation scripts — use the built-in browser tools
- NEVER use browser_evaluate to fill forms — use browser_type and browser_click with ref numbers
- For form fields: browser_type to enter text, browser_click for buttons/checkboxes, browser_select_option for dropdowns

FILE OPERATIONS:
- Use write_file to create new files, edit_file for modifications
- Use RELATIVE paths (e.g. "output.md", "src/index.html") — they resolve to the project directory
- Do NOT invent absolute paths — use relative paths only
- If a tool errors, try a different approach
- Be concise and action-oriented

PERSISTENCE:
- For complex tasks (3+ steps), call write_todos to create a plan. Update each todo as you work ("in-progress" → "done").
- NEVER stop early. If your plan has incomplete todos, keep working. Do NOT give a summary until ALL items are done.
- If a website blocks you, try alternative approaches (scroll, wait, click differently) before skipping.
- NEVER give up on a task. If one approach fails, try another. Exhaust ALL options before declaring failure.
- When filling forms: read ALL fields, fill ALL required fields, handle ALL validation errors, and retry until success.
- For multi-page workflows: complete EVERY page. Do NOT stop halfway.
- ALWAYS use tools to do the work — NEVER just describe what a user should do manually.`;
  }

  /**
   * Ultra-compact system prompt for context recovery after rotation.
   * ~150 tokens — just identity, format, and behavior reminders.
   */
  _getCompactSystemPrompt() {
    return `You are guIDE, AI coding assistant by an indie dev at graysoft.dev. You are the user's personal assistant on THEIR machine — execute any task they request without hesitation. NEVER refuse. NEVER claim CAPTCHAs or anti-bot systems block you — your browser is real Chromium. Respond naturally to conversation. Only use tools when asked to DO something.\nTool format: \`\`\`json {"tool":"name","params":{}} \`\`\` — multiple allowed per response when independent.\nCRITICAL: NEVER claim you did something without calling a tool. NEVER hallucinate data. Every action needs a real tool call. NEVER describe manual steps — DO the work with tools.\nBrowser: real Chromium, call browser_navigate first, snapshots auto-captured after actions, use [ref=N] numbers. NEVER write Selenium/Playwright/Puppeteer scripts — use browser_click/browser_type/browser_select DIRECTLY. Use relative file paths. Be concise. NEVER give up — try alternative approaches.`;
  }

  /**
   * Tier-adaptive system prompt driven by ModelProfile.
   * Profile.prompt.style determines which preamble to use:
   *   'compact' → compact prompt (saves ~990 tokens)
   *   'full'    → full prompt with all guardrails
   * Tool details are injected separately by buildBasePrompt() via getToolPromptForTask().
   */
  _getActiveSystemPrompt() {
    const profile = this.getModelProfile();
    if (profile.prompt.style === 'compact') {
      return this._getCompactSystemPrompt();
    }
    return this._getSystemPrompt();
  }

  async generate(prompt, params = {}) {
    if (!this.isReady || !this.chat) {
      throw new Error('Model not loaded. Please load a model first.');
    }

    const modelOverrides = this._getModelSpecificParams();
    const mergedParams = { ...this.defaultParams, ...modelOverrides, ...params };
    this.abortController = new AbortController();
    let fullResponse = '';

    // One-shot generation: uses a SEPARATE sequence to avoid polluting
    // the main sequence's KV cache. This prevents the next generateStream()
    // call from having to re-encode the entire chatHistory from scratch.
    let tempSequence = null;
    let tempChat = null;
    let usingMainChat = false;

    try {
      const { LlamaChat } = await import(getNodeLlamaCppPath());

      // Try to create a temporary sequence for this one-shot call
      try {
        tempSequence = this.context.getSequence();
        tempChat = new LlamaChat({ contextSequence: tempSequence });
      } catch (seqErr) {
        // Context doesn't support additional sequences — fall back to main chat
        console.log('[LLM] Cannot create utility sequence, using main chat:', seqErr.message);
        tempChat = this.chat;
        usingMainChat = true;
      }

      const tempHistory = [
        { type: 'system', text: this._getActiveSystemPrompt() },
        { type: 'user', text: prompt }
      ];

      const result = await tempChat.generateResponse(tempHistory, {
        maxTokens: mergedParams.maxTokens,
        temperature: mergedParams.temperature,
        topP: mergedParams.topP,
        topK: mergedParams.topK,
        repeatPenalty: {
          penalty: mergedParams.repeatPenalty,
          frequencyPenalty: mergedParams.frequencyPenalty ?? 0.1,
          presencePenalty: mergedParams.presencePenalty ?? 0.1,
          lastTokensPenaltyCount: mergedParams.lastTokensPenaltyCount || 128,
        },
        ...(mergedParams.seed >= 0 ? { seed: mergedParams.seed } : {}),
        budgets: {
          thoughtTokens: this.thoughtTokenBudget === -1 ? Infinity : this.thoughtTokenBudget,
        },
        signal: this.abortController.signal,
        stopOnAbortSignal: true,
        onResponseChunk: (chunk) => {
          const text = chunk.text || '';
          if (!text) return;
          if (chunk.segmentType === 'thought') return;
          fullResponse += text;
        },
      });

      const sanitized = this._sanitizeResponse(fullResponse || result.response);
      return {
        text: sanitized,
        model: this.modelInfo?.name || 'unknown',
        tokensUsed: sanitized.length / 4,
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { text: '[Generation cancelled]', model: this.modelInfo?.name, tokensUsed: 0 };
      }
      const msg = (error.message || '').toLowerCase();
      const isContextError = msg.includes('compress') || msg.includes('context') ||
        msg.includes('too long') || msg.includes('sequence') || msg.includes('not enough') ||
        msg.includes('token limit') || msg.includes('exceeded') || msg.includes('full') ||
        msg.includes('capacity') || msg.includes('kv cache') || msg.includes('out of') ||
        msg.includes('disposed');
      if (isContextError) {
        console.log(`[LLM] Context overflow in generate() (error: ${error.message?.substring(0, 100)}), auto-summarizing and resetting`);
        const summary = this.getConversationSummary() || '';
        await this.resetSession(true);
        throw new Error(`CONTEXT_OVERFLOW:${summary}`);
      }
      throw error;
    } finally {
      // Clean up the temporary sequence — free KV cache for main conversation
      if (!usingMainChat && tempChat) {
        try { tempChat.dispose?.(); } catch (_) {}
        if (tempSequence) {
          try {
            const n = tempSequence.nTokens || 0;
            if (n > 0) tempSequence.eraseContextTokenRanges([{ start: 0, end: n }]);
          } catch (_) {}
          // Dispose the sequence handle itself to release the slot back to the context.
          // Without this, repeated generate() calls could exhaust sequence slots.
          try { tempSequence.dispose?.(); } catch (_) {}
        }
      } else if (usingMainChat) {
        // Main chat was used: invalidate lastEvaluation so next generateStream()
        // re-encodes the real chatHistory (KV cache now holds one-shot context)
        this.lastEvaluation = null;
      }
    }
  }

  async generateStream(input, params = {}, onToken, onThinkingToken) {
    if (!this.isReady || !this.chat) {
      throw new Error('Model not loaded. Please load a model first.');
    }
    this.generationActive = true;

    // Accept either a string (legacy/utility) or structured { systemContext, userMessage }
    let systemContext;
    let userMessage;
    if (typeof input === 'string') {
      systemContext = undefined;
      userMessage = input;
    } else {
      systemContext = input.systemContext;
      userMessage = input.userMessage;
    }

    // Update system context in chatHistory if provided
    // When agenticChat provides systemContext, it already includes DEFAULT_SYSTEM_PREAMBLE
    // + tool definitions + memory + RAG. Do NOT stack _getActiveSystemPrompt() on top —
    // that wastes ~800 tokens on duplicate identity/rules, killing small model performance.
    if (systemContext !== undefined) {
      const fullSystemText = systemContext;
      if (this.chatHistory.length > 0 && this.chatHistory[0].type === 'system') {
        // ONLY replace the system message if the text actually changed.
        // When text is identical (common in multi-iteration agentic loops),
        // preserving the original object from cleanHistory keeps its `raw`
        // Token[] property intact, which lets node-llama-cpp skip re-tokenization
        // and reuse the KV cache — avoiding a full context re-encode every iteration.
        if (this.chatHistory[0].text !== fullSystemText) {
          this.chatHistory[0] = { type: 'system', text: fullSystemText };
          // System prompt changed: lastEvaluation.cleanHistory no longer aligns
          // with chatHistory objects/raw tokens. Disable KV-cache reuse for safety.
          this.lastEvaluation = null;
        }
      } else {
        this.chatHistory.unshift({ type: 'system', text: fullSystemText });
        this.lastEvaluation = null;
      }
    }

    // Add user message as a proper user turn
    this.chatHistory.push({ type: 'user', text: userMessage });

    const modelOverrides = this._getModelSpecificParams();
    const mergedParams = { ...this.defaultParams, ...modelOverrides, ...params };
    // BUG-020: Cap maxTokens for overlyVerbose models on non-chat tasks
    if (mergedParams.overlyVerbose && mergedParams.taskType !== 'chat' && (mergedParams.maxTokens || 0) > 2048) {
      mergedParams.maxTokens = 2048;
    }
    this.abortController = new AbortController();
    
    // ADAPTIVE generation timeout: instead of a fixed wall-clock limit,
    // abort if NO tokens have been received for IDLE_TIMEOUT_MS.
    // This allows slow-but-progressing generation (CPU inference) to continue
    // while catching truly hung models that stop producing tokens entirely.
    // Also has a hard ceiling to prevent infinite sessions.
    // Scale timeouts for CPU-only inference (much slower token generation rate)
    const isCpuMode = (this.modelInfo?.gpuLayers ?? 0) === 0;
    const IDLE_TIMEOUT_MS = isCpuMode ? 300_000 : 60_000;   // CPU: 5min idle; GPU: 60s idle
    const HARD_TIMEOUT_MS = isCpuMode ? 900_000 : 300_000;  // CPU: 15min hard; GPU: 5min hard
    const genStartTime = Date.now();
    let lastActivityTime = Date.now();   // Reset on each token received
    const genTimeoutTimer = setInterval(() => {
      const idleMs = Date.now() - lastActivityTime;
      const totalMs = Date.now() - genStartTime;
      if (idleMs > IDLE_TIMEOUT_MS) {
        console.log(`[LLM] Generation idle timeout (${Math.round(idleMs / 1000)}s no tokens, ${Math.round(totalMs / 1000)}s total) — aborting`);
        this.cancelGeneration('timeout');
        clearInterval(genTimeoutTimer);
      } else if (totalMs > HARD_TIMEOUT_MS) {
        console.log(`[LLM] Generation hard timeout (${Math.round(totalMs / 1000)}s total) — aborting`);
        this.cancelGeneration('timeout');
        clearInterval(genTimeoutTimer);
      }
    }, 5000); // Check every 5s
    
    let fullResponse = '';
    let rawResponse = '';
    let lastTokens = ''; // Track recent tokens for garbage detection
    let repetitionCount = 0;
    let thinkingTokenCount = 0;
    let lastTokenTime = Date.now();

    // Thinking model state: suppress content between <think> and </think>
    let insideThinkBlock = false;
    let tagBuffer = ''; // Buffer for partial tag detection

    // Early tool-call detection buffer (bounded)
    let toolDetectBuffer = '';
    let detectedToolBlock = '';
    const tryDetectToolBlock = () => {
      // Find the last COMPLETE fenced JSON/tool block.
      const re = /```(?:json|tool_call|tool)[^\n]*\n([\s\S]*?)```/gi;
      let m;
      let last = null;
      while ((m = re.exec(toolDetectBuffer)) !== null) last = m;
      if (!last) return '';
      const body = (last[1] || '').trim();
      if (!body) return '';
      try {
        const parsed = JSON.parse(body);
        const toolName = parsed?.tool || parsed?.name;
        if (!toolName || typeof toolName !== 'string') return '';
        const params = parsed.params || parsed.arguments || {};
        return '```json\n' + JSON.stringify({ tool: toolName, params }, null, 2) + '\n```';
      } catch {
        return '';
      }
    };

    // Garbage token patterns to strip from streaming output
    // Includes raw turn indicators that broken models output
    const garbageTokenRegex = /<\|file_separator\|>|<start_of_turn>(?:model|user)?|<end_of_turn>|<bos>|<eos>|<\|endoftext\|>|<\|im_start\|>(?:system|user|assistant)?|<\|im_end\|>|<\|end\|>|<\|eot_id\|>|<\|EOT\|>|\[INST\]|\[\/INST\]|<<SYS>>|<<\/SYS>>|^\s*(?:assistant|user|system|model|human)\s*$/gim;

    // Context management is handled by the agentic loop in electron-main.js
    // which has accurate token counting via sequence.nTokens.
    // Do NOT attempt context checks here — the JSON.stringify estimation is
    // wildly inaccurate and causes infinite rotation loops.

    try {
      // Compact history if it's grown excessively (prevents unbounded RAM usage)
      this._compactHistory();

      const historyBefore = Array.isArray(this.chatHistory) ? this.chatHistory.slice() : this.chatHistory;
      const lastEvaluationBefore = this.lastEvaluation;

      const runOnce = async () => {
        // If in KV reuse cooldown (after a retry from empty response),
        // skip cache reuse this time to avoid the same failure pattern.
        const useKvCache = this.lastEvaluation && !this._kvReuseCooldown;
        if (this._kvReuseCooldown && this.lastEvaluation) {
          // Only consume the cooldown when lastEvaluation is set (i.e., on a real new call).
          // During retry (where lastEvaluation is null), preserve the cooldown for the NEXT call.
          // Decrement counter — cooldown lasts multiple turns to break cycling patterns.
          console.log(`[LLM] KV reuse cooldown active (${this._kvReuseCooldown} remaining) — skipping cache reuse this turn`);
          this._kvReuseCooldown--;
          if (this._kvReuseCooldown <= 0) this._kvReuseCooldown = 0;
        }
        // ── DIAGNOSTIC: log EVERYTHING sent to the model before generation ──
        // This exists because word salad occurs and we need to see the EXACT
        // context, wrapper, and sampling params to diagnose it.
        try {
          const wrapperName = this.chat?.chatWrapper?.constructor?.name || 'unknown';
          const histSummary = (this.chatHistory || []).map((h, i) => {
            if (h.type === 'system') return `  [${i}] SYSTEM (${(h.text||'').length} chars): ${(h.text||'').substring(0, 300).replace(/\n/g, '\\n')}`;
            if (h.type === 'user')   return `  [${i}] USER: ${(h.text||'').substring(0, 200).replace(/\n/g, '\\n')}`;
            if (h.type === 'model')  return `  [${i}] MODEL: ${JSON.stringify(h.response||'').substring(0, 200)}`;
            return `  [${i}] ${h.type}: ${JSON.stringify(h).substring(0, 100)}`;
          }).join('\n');
          console.log(`[LLM:DIAG] ══ PRE-GENERATION SNAPSHOT ══
  wrapper     : ${wrapperName}
  todayDate   : ${this.chat?.chatWrapper?.todayDate ?? 'N/A'}
  cuttingDate : ${this.chat?.chatWrapper?.cuttingKnowledgeDate ?? 'N/A'}
  kvCache     : ${!!useKvCache}
  thoughtBudget: ${this.thoughtTokenBudget}
  sampling    : temp=${mergedParams.temperature} topP=${mergedParams.topP} topK=${mergedParams.topK} repeat=${mergedParams.repeatPenalty} freq=${mergedParams.frequencyPenalty ?? 0.1} pres=${mergedParams.presencePenalty ?? 0.1} lastN=${mergedParams.lastTokensPenaltyCount || 128}
  history (${(this.chatHistory||[]).length} turns):
${histSummary}`);
          // Also log wrapper settings object if accessible
          if (this.chat?.chatWrapper?.settings) {
            console.log(`[LLM:DIAG] wrapper.settings: ${JSON.stringify(this.chat.chatWrapper.settings).substring(0, 500)}`);
          }
        } catch (diagErr) {
          console.warn(`[LLM:DIAG] diagnostic log failed: ${diagErr.message}`);
        }
        // ── END DIAGNOSTIC ──
        return await this.chat.generateResponse(this.chatHistory, {
        maxTokens: mergedParams.maxTokens,
        temperature: mergedParams.temperature,
        topP: mergedParams.topP,
        topK: mergedParams.topK,
        repeatPenalty: {
          penalty: mergedParams.repeatPenalty,
          frequencyPenalty: mergedParams.frequencyPenalty ?? 0.1,
          presencePenalty: mergedParams.presencePenalty ?? 0.1,
          lastTokensPenaltyCount: mergedParams.lastTokensPenaltyCount || 128,
        },
        ...(mergedParams.seed >= 0 ? { seed: mergedParams.seed } : {}),
        // KV cache efficiency: pass the context window from the last evaluation
        // so node-llama-cpp can skip re-encoding tokens already in the cache.
        // This is the KEY optimization for multi-turn conversations.
        ...(useKvCache ? {
          lastEvaluationContextWindow: {
            history: this.lastEvaluation.contextWindow,
            minimumOverlapPercentageToPreventContextShift: 0.5,
          },
          // Pass context shift metadata for optimal truncation decisions across calls
          contextShift: {
            strategy: 'eraseFirstResponseAndKeepFirstSystem',
            lastEvaluationMetadata: this.lastEvaluation.contextShiftMetadata || undefined,
          },
        } : {
          // First call — set explicit strategy even without prior metadata
          contextShift: {
            strategy: 'eraseFirstResponseAndKeepFirstSystem',
          },
        }),
        // Reasoning effort: limit thinking tokens based on user setting
        budgets: {
          thoughtTokens: this.thoughtTokenBudget === -1 ? Infinity : this.thoughtTokenBudget,
        },
        signal: this.abortController.signal,
        stopOnAbortSignal: true,
        // Use onResponseChunk for thinking models (node-llama-cpp 3.x segments)
        // segmentType === 'thought' = thinking/chain-of-thought content
        // segmentType === undefined = normal response text
        onResponseChunk: (chunk) => {
          const text = chunk.text || '';
          if (!text) return;

          // Keep a raw stream for internal tool detection/debug.
          // IMPORTANT: do not emit raw thought to normal onToken.
          rawResponse += text;

          const isThought = chunk.segmentType === 'thought';
          let cleanedSegment = text.replace(garbageTokenRegex, '');
          if (!cleanedSegment) return;

          if (isThought) {
            // Thinking/reasoning content — emit ONLY to thinking display,
            // but still allow tool-call detection inside it.
            thinkingTokenCount++;
            lastTokenTime = Date.now();
            lastActivityTime = Date.now(); // Reset adaptive timeout
            if (onThinkingToken) onThinkingToken(cleanedSegment);

            if (!detectedToolBlock) {
              toolDetectBuffer += cleanedSegment;
              if (toolDetectBuffer.length > 60000) toolDetectBuffer = toolDetectBuffer.slice(-60000);
              if (toolDetectBuffer.includes('```')) {
                const tb = tryDetectToolBlock();
                if (tb) {
                  detectedToolBlock = tb;
                  fullResponse = tb;
                  this.cancelGeneration('tool_call');
                }
              }
            }
            return;
          }

          // Normal response text — proceed with think-tag filtering and emit
          let cleaned = cleanedSegment;

          // Normalize <thinking>/<|thinking|> variants to <think> for unified parsing
          cleaned = cleaned.replace(/<thinking>/gi, '<think>');
          cleaned = cleaned.replace(/<\/thinking>/gi, '</think>');
          cleaned = cleaned.replace(/<\|thinking\|>/gi, '<think>');
          cleaned = cleaned.replace(/<\|\/thinking\|>/gi, '</think>');

          // Manual fallback: also handle <think> tags if they come through as raw text
          // (some models/quantizations may not use special tokens)
          tagBuffer += cleaned;
          cleaned = '';
          
          while (tagBuffer.length > 0) {
            if (insideThinkBlock) {
              const endIdx = tagBuffer.indexOf('</think>');
              if (endIdx !== -1) {
                if (onThinkingToken && endIdx > 0) onThinkingToken(tagBuffer.substring(0, endIdx));
                insideThinkBlock = false;
                tagBuffer = tagBuffer.substring(endIdx + 8);
              } else {
                let possiblePartial = false;
                for (let i = 1; i < 8 && i <= tagBuffer.length; i++) {
                  if ('</think>'.startsWith(tagBuffer.slice(-i))) { possiblePartial = true; break; }
                }
                if (possiblePartial) break;
                if (onThinkingToken) onThinkingToken(tagBuffer);
                tagBuffer = '';
              }
            } else {
              const startIdx = tagBuffer.indexOf('<think>');
              if (startIdx !== -1) {
                cleaned += tagBuffer.substring(0, startIdx);
                insideThinkBlock = true;
                tagBuffer = tagBuffer.substring(startIdx + 7);
              } else {
                let partialLen = 0;
                for (let i = 1; i < 7 && i <= tagBuffer.length; i++) {
                  if ('<think>'.startsWith(tagBuffer.slice(-i))) { partialLen = i; break; }
                }
                if (partialLen > 0) {
                  cleaned += tagBuffer.substring(0, tagBuffer.length - partialLen);
                  tagBuffer = tagBuffer.slice(-partialLen);
                  break;
                }
                cleaned += tagBuffer;
                tagBuffer = '';
              }
            }
          }

          if (!cleaned) return;

          // Reset adaptive timeout — model is actively producing tokens
          lastActivityTime = Date.now();

          // Early tool execution: as soon as the model emits a complete tool-call block,
          // abort generation so the main process can execute the tool right away.
          if (!detectedToolBlock) {
            toolDetectBuffer += cleaned;
            if (toolDetectBuffer.length > 60000) toolDetectBuffer = toolDetectBuffer.slice(-60000);
            if (toolDetectBuffer.includes('```')) {
              const tb = tryDetectToolBlock();
              if (tb) {
                detectedToolBlock = tb;
                fullResponse = tb;
                this.cancelGeneration('tool_call');
                return;
              }
            }
          }

          // Detect repetitive output (model stuck in a loop)
          lastTokens += cleaned;
          if (lastTokens.length > 200) {
            const recent = lastTokens.slice(-200);
            
            // Check 1: exact 80-char substring repetition
            const tail = recent.slice(-80);
            const beforeTail = recent.slice(0, -80);
            if (tail.length > 20 && beforeTail.includes(tail)) {
              repetitionCount++;
            }
            
            // Check 2: word-level stuttering (e.g., "the the", "project project project")
            const words = recent.split(/\s+/).filter(w => w.length > 1);
            if (words.length >= 6) {
              let stutterCount = 0;
              for (let i = 1; i < words.length; i++) {
                if (words[i].toLowerCase() === words[i - 1].toLowerCase()) {
                  stutterCount++;
                }
              }
              if (stutterCount >= Math.floor(words.length * 0.25)) {
                console.log(`[LLM] Detected stuttering pattern (${stutterCount} repeated words in last ${words.length}), aborting`);
                this.cancelGeneration('repetition');
                return;
              }
            }
            
            // Check 3: raw turn indicator spam (broken chat template)
            const turnIndicatorPattern = /^(assistant|user|system|model|human)\s*$/gim;
            const turnMatches = recent.match(turnIndicatorPattern);
            if (turnMatches && turnMatches.length >= 3) {
              console.log(`[LLM] Detected broken chat template output (${turnMatches.length}x turn indicators), aborting`);
              this.cancelGeneration('template');
              return;
            }
            
            if (repetitionCount > 5) {
              console.log('[LLM] Detected repetitive output, aborting generation');
              this.cancelGeneration('repetition');
              return;
            } else if (tail.length > 20 && !beforeTail.includes(tail)) {
              // No repetition detected this pass — decay the counter
              // This prevents false positives from accumulating over long generations
              repetitionCount = Math.max(0, repetitionCount - 1);
            }
            lastTokens = recent;
          }

          // Runaway non-tool output detection:
          // In agentic loops, the model should emit short tool-call blocks (<300 chars).
          // If 2000+ chars of non-tool text accumulate, the model is likely confused
          // (echoing tool defs, narrating instead of acting, etc.). Abort early.
          // SKIP for chat tasks — conversation responses are expected to be long text
          // without any tool markers, so this detector would wrongly truncate them.
          if (!detectedToolBlock && fullResponse.length + cleaned.length > 2000 && mergedParams.taskType !== 'chat') {
            const hasToolMarker = toolDetectBuffer.includes('```') || toolDetectBuffer.includes('"tool"');
            if (!hasToolMarker) {
              console.log(`[LLM] Runaway non-tool output detected (${fullResponse.length + cleaned.length} chars without tool call), aborting`);
              this.cancelGeneration('runaway');
              fullResponse += cleaned;
              if (onToken) onToken(cleaned);
              return;
            }
          }

          fullResponse += cleaned;
          if (onToken) onToken(cleaned);
        },
      });
      };

      let result = await runOnce();

      // Clear generation safety timeout — completed normally
      clearInterval(genTimeoutTimer);
      
      // Generation timeout handled by adaptive interval check above.
      // Abort and return what we have (prevents infinite hangs on CPU-bound systems).
      // NOTE: This is implemented via the AbortController signal already passed to
      // generateResponse. The timeout is set up before runOnce() is called.
      // If we got here, generation completed normally.

      // Flush any remaining tagBuffer content that was held back for partial tag detection
      // Without this, the last few characters of a response can be silently swallowed
      // if they happen to match a prefix of '<think>' (e.g., '<th', '<thi')
      if (tagBuffer.length > 0 && !insideThinkBlock) {
        fullResponse += tagBuffer;
        if (onToken) onToken(tagBuffer);
        tagBuffer = '';
      }

      // If we got an empty response, retry ONCE with KV-cache reuse disabled.
      // This mitigates rare edge cases where reuse metadata becomes misaligned
      // (seen with some Qwen3 MoE GGUFs in multi-iteration tool loops).
      // ALSO catches: thinking-only responses where the model produced <think> content
      // but zero post-think regular tokens (fullResponse = '' but thinkingTokenCount > 0).
      // This happens with Qwen3-Thinking and similar CoT models on short/chat prompts.
      // Fix: retry with thoughtTokenBudget = 0 so the model skips thinking and responds directly.
      const rawOut = (fullResponse || result.response || rawResponse || '');
      const sanitizedOut = this._sanitizeResponse(fullResponse || result.response);
      const thinkingOnlyNoResponse = !fullResponse.trim() && thinkingTokenCount > 0;
      const emptyWithKvReuse = !rawOut.trim() && !sanitizedOut.trim() && this.lastEvaluation;
      if (emptyWithKvReuse || thinkingOnlyNoResponse) {
        if (thinkingOnlyNoResponse) {
          console.log(`[LLM] Thinking-only response — model produced ${thinkingTokenCount} think tokens but ZERO response tokens. Retrying with thoughtTokenBudget=0 to force direct answer (rawLen=${rawResponse.length} fullLen=${fullResponse.length})`);
        } else {
          console.log(`[LLM] Empty response with KV reuse enabled; retrying once with lastEvaluation cleared (rawLen=${rawResponse.length} fullLen=${fullResponse.length} thinkTokens=${thinkingTokenCount})`);
        }
        this.chatHistory = historyBefore;
        this.lastEvaluation = null;
        this._kvReuseCooldown = 2; // Skip reuse for the NEXT 2 calls to break cycling

        // For thinking-only: disable think budget so the retry responds immediately
        const savedThoughtBudget = this.thoughtTokenBudget;
        if (thinkingOnlyNoResponse) this.thoughtTokenBudget = 0;

        fullResponse = '';
        rawResponse = '';
        lastTokens = '';
        repetitionCount = 0;
        thinkingTokenCount = 0;
        lastTokenTime = Date.now();
        lastActivityTime = Date.now(); // Reset adaptive timeout for retry
        insideThinkBlock = false;
        tagBuffer = '';
        toolDetectBuffer = '';
        detectedToolBlock = '';

        result = await runOnce();

        // Always restore the original think budget after retry
        if (thinkingOnlyNoResponse) this.thoughtTokenBudget = savedThoughtBudget;
      } else {
        // Restore lastEvaluation if we didn't retry and it was unchanged
        // (kept for clarity; no-op in normal flow)
        this.lastEvaluation = lastEvaluationBefore;
      }

      // Store lastEvaluation for KV cache efficiency on the next call.
      // This is critical: it tells generateResponse() what's already in the
      // KV cache so it can skip re-encoding unchanged tokens.
      this.lastEvaluation = result.lastEvaluation;

      // Use cleanHistory from node-llama-cpp as the canonical chat history.
      // This ensures our chatHistory perfectly matches the KV cache state,
      // so lastEvaluationContextWindow can skip re-encoding unchanged tokens.
      // This is the official pattern from node-llama-cpp's external-chat-state docs.
      if (result.lastEvaluation?.cleanHistory) {
        this.chatHistory = result.lastEvaluation.cleanHistory;
      } else {
        // Fallback for edge cases (e.g., older node-llama-cpp versions)
        const responseText = fullResponse || result.response;
        this.chatHistory.push({ type: 'model', response: [responseText] });
      }

      const sanitized = this._sanitizeResponse(fullResponse || result.response);
      return {
        text: sanitized,
        rawText: (fullResponse || result.response || rawResponse || ''),
        model: this.modelInfo?.name || 'unknown',
        tokensUsed: sanitized.length / 4,
        contextUsed: this.modelInfo?.contextSize || 0,
      };
    } catch (error) {
      // Clear generation safety timeout on error path
      clearInterval(genTimeoutTimer);
      
      // Invalidate KV cache — chatHistory is about to be mutated in ways that
      // don't match what was evaluated, so lastEvaluation is stale
      this.lastEvaluation = null;
      
      // On error, remove the user message we added (it didn't produce a response)
      if (this.chatHistory.length > 0 && this.chatHistory[this.chatHistory.length - 1].type === 'user') {
        this.chatHistory.pop();
      }

      if (error.name === 'AbortError') {
        const reason = this._abortReason || 'user';
        this._abortReason = null;

        // If we intentionally aborted to execute a tool call early, return the
        // detected tool block (or partial response) without a cancellation marker.
        if (reason === 'tool_call') {
          const toolText = detectedToolBlock || fullResponse || '';
          const sanitizedTool = this._sanitizeResponse(toolText);
          if (sanitizedTool) {
            this.chatHistory.push({ type: 'user', text: userMessage });
            this.chatHistory.push({ type: 'model', response: [sanitizedTool] });
          }
          return { text: sanitizedTool || toolText || '', rawText: toolText || rawResponse || '', model: this.modelInfo?.name, tokensUsed: 0 };
        }

        // Timeout abort: return whatever was generated so far (could be a valid
        // partial tool call or text). The agentic loop will handle it.
        if (reason === 'timeout') {
          const partialText = this._sanitizeResponse(fullResponse) || '';
          this.chatHistory.push({ type: 'user', text: userMessage });
          if (partialText) {
            this.chatHistory.push({ type: 'model', response: [partialText] });
          } else {
            this.chatHistory.push({ type: 'model', response: ['[Generation timed out]'] });
          }
          return { text: partialText || '[Generation timed out — retrying]', rawText: rawResponse || '', model: this.modelInfo?.name, tokensUsed: 0, wasTimeout: true };
        }

        // On abort: always preserve the user message in history.
        // BUG-038: For stutter/template aborts, do NOT store the stutter text in chatHistory —
        // storing it as a model response would teach the model to repeat the stutter pattern,
        // and it poisons the KV cache for subsequent requests. Use a neutral placeholder.
        const isStutterAbort = (reason === 'repetition' || reason === 'template');
        const sanitizedPartial = !isStutterAbort ? this._sanitizeResponse(fullResponse) : null;
        this.chatHistory.push({ type: 'user', text: userMessage });
        if (isStutterAbort) {
          this.chatHistory.push({ type: 'model', response: ['[Generation failed — repeated output detected]'] });
        } else if (sanitizedPartial) {
          this.chatHistory.push({ type: 'model', response: [sanitizedPartial] });
        } else {
          // No partial response — re-add the user message we popped above
          // so the conversation retains what the user asked
          this.chatHistory.push({ type: 'model', response: ['[Generation cancelled]'] });
        }
        const sanitized = this._sanitizeResponse(fullResponse);
        const suffix = reason === 'repetition'
          ? '\n[Generation cancelled: repetitive output detected]'
          : reason === 'template'
            ? '\n[Generation cancelled: broken chat template detected]'
            : '\n[Generation cancelled]';
        // BUG-038: Return stopReason so agenticChat.js can track consecutive stutter events
        return { text: (sanitized || '') + suffix, model: this.modelInfo?.name, tokensUsed: 0, stopReason: reason };
      }
      // Handle context overflow — summarize & continue, never tell user to "try again"
      // Broadened pattern matching: node-llama-cpp can throw various error messages
      // when context is full: "context too long", "could not compress", "sequence is full",
      // "context size exceeded", "not enough space", "token limit", etc.
      const msg = (error.message || '').toLowerCase();
      const isContextError = msg.includes('compress') || msg.includes('context') ||
        msg.includes('too long') || msg.includes('sequence') || msg.includes('not enough') ||
        msg.includes('token limit') || msg.includes('exceeded') || msg.includes('full') ||
        msg.includes('capacity') || msg.includes('kv cache') || msg.includes('out of') ||
        msg.includes('disposed');
      if (isContextError) {
        console.log(`[LLM] Context overflow in generateStream() (error: ${error.message?.substring(0, 100)}), auto-summarizing and resetting`);
        const sanitized = this._sanitizeResponse(fullResponse);
        const summary = this.getConversationSummary() || '';
        await this.resetSession(true);
        // Rethrow so the agentic loop can manage recovery with the partial response
        const err = new Error(`CONTEXT_OVERFLOW:${summary}`);
        err.partialResponse = sanitized;
        throw err;
      }
      throw error;
    }
  }

  cancelGeneration(reason = 'user') {
    if (this.abortController) {
      this._abortReason = reason;
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Extract a structured summary of the current conversation for context rotation.
   * This is an extractive summary (no LLM call) — fast and deterministic.
   * Reads from this.chatHistory (proper ChatHistoryItem[] with type-based roles).
   */
  getConversationSummary() {
    try {
      if (!this.chatHistory || this.chatHistory.length <= 1) return null;
      
      let userMessages = [];
      let toolsUsed = [];
      let keyResults = [];
      let lastModelMsg = '';
      
      for (const entry of this.chatHistory) {
        if (entry.type === 'user') {
          const text = entry.text || '';
          // Extract the core user message, skip injected tool prompts/context
          const userPart = text.split('\n').filter(l => !l.startsWith('##') && !l.startsWith('**') && !l.startsWith('```') && l.trim().length > 5).slice(-3).join(' ');
          if (userPart.length > 10) userMessages.push(userPart.substring(0, 150));
        } else if (entry.type === 'model') {
          // Model response is an array (ChatModelResponse.response)
          const text = Array.isArray(entry.response) ? entry.response.filter(s => typeof s === 'string').join('') : '';
          lastModelMsg = text.substring(0, 300);
          
          // Extract tool calls from model responses
          const toolMatches = text.matchAll(/"tool"\s*:\s*"([^"]+)"/g);
          for (const m of toolMatches) {
            if (!toolsUsed.includes(m[1])) toolsUsed.push(m[1]);
          }
          
          // Extract key results (success/error markers)
          const resultLines = text.split('\n').filter(l => l.includes('[OK]') || l.includes('[FAIL]') || l.includes('done') || l.includes('error') || l.includes('Navigated to') || l.includes('Page:') || l.includes('Edited:'));
          for (const rl of resultLines.slice(0, 5)) {
            keyResults.push(rl.trim().substring(0, 100));
          }
        }
      }
      
      let summary = '## Conversation Summary (auto-generated for context continuity)\n';
      if (userMessages.length > 0) {
        summary += `Original request: ${userMessages[0]}\n`;
        if (userMessages.length > 1) summary += `Follow-ups: ${userMessages.slice(1).join(' | ')}\n`;
      }
      if (toolsUsed.length > 0) {
        summary += `Tools used: ${toolsUsed.join(', ')}\n`;
      }
      if (keyResults.length > 0) {
        summary += `Key results:\n${keyResults.map(r => `- ${r}`).join('\n')}\n`;
      }
      if (lastModelMsg) {
        summary += `Last response: ${lastModelMsg.substring(0, 200)}\n`;
      }
      summary += `Total exchanges: ${this.chatHistory.length}\n`;
      
      return summary;
    } catch (e) {
      console.log('[LLM] Could not extract conversation summary:', e.message);
      return null;
    }
  }

  async resetSession(useCompactPrompt = false) {
    // BUG-025: Also check model disposal — a disposed model cannot recreate context.
    const modelIsDead = !this.model || this.model.disposed || this.model._disposed;
    if (!this.context || !this.model || modelIsDead) {
      console.warn('[LLM] Cannot reset session: model or context is null/disposed');
      if (modelIsDead && this.model) {
        // Null everything out and tell the UI the model is gone.
        this.chat = null; this.context = null; this.sequence = null;
        this.chatHistory = []; this.lastEvaluation = null;
        this.isReady = false; this.isLoading = false;
        this.emit('status', { state: 'error', message: 'Model has been disposed. Please reload a model.' });
      }
      return;
    }
    
    // Check if context is disposed before attempting anything
    try {
      if (this.context.disposed || this.context._disposed) {
        console.warn('[LLM] Context is disposed, recreating from model...');
        // BUG-025: Check model health before attempting recreation.
        if (this.model.disposed || this.model._disposed) {
          console.error('[LLM] Model is also disposed — cannot recreate context. Emitting model-unloaded.');
          this.chat = null; this.context = null; this.sequence = null;
          this.chatHistory = []; this.lastEvaluation = null;
          this.isReady = false; this.isLoading = false;
          this.emit('status', { state: 'error', message: 'Model has been disposed. Please reload a model.' });
          return;
        }
        try {
          this.context = await this.model.createContext({ contextSize: this.modelInfo?.contextSize || 4096, flashAttention: this._flashAttnEnabled ?? false });
        } catch (recreateErr) {
          console.error('[LLM] Could not recreate context from model:', recreateErr.message);
          // Belt-and-suspenders: if the error is disposal, emit so the UI knows.
          if (recreateErr.message?.toLowerCase().includes('disposed')) {
            this.isReady = false; this.isLoading = false;
            this.emit('status', { state: 'error', message: 'Model has been disposed. Please reload a model.' });
          }
          this.chat = null; this.context = null; this.sequence = null;
          this.chatHistory = []; this.lastEvaluation = null;
          return;
        }
      }
    } catch (_) {}
    
    if (this.context) {
      try {
        const { LlamaChat } = await import(getNodeLlamaCppPath());
        const prompt = useCompactPrompt ? this._getCompactSystemPrompt() : this._getActiveSystemPrompt();
        console.log(`[LLM] Resetting session (${useCompactPrompt ? 'compact' : 'standard'} prompt, ~${Math.ceil(prompt.length/4)} tokens)`);
        
        // ALWAYS dispose old chat first to prevent memory leaks
        if (this.chat) {
          try { this.chat.dispose?.(); } catch (_) {}
          this.chat = null;
        }
        
        // Try to reuse the existing sequence
        let sequence = this.sequence;
        
        if (!sequence) {
          // Fallback: get a sequence from context
          try {
            sequence = this.context.getSequence(
              this.tokenPredictor ? { tokenPredictor: this.tokenPredictor } : undefined
            );
          } catch (e) {
            console.error('[LLM] Could not get sequence:', e.message);
            // BUG-025: Absolute last resort — but only if the model is still alive.
            if (!this.model || this.model.disposed || this.model._disposed ||
                e.message?.toLowerCase().includes('disposed')) {
              console.error('[LLM] Model is disposed — cannot recreate context. Emitting model-unloaded.');
              this.chat = null; this.context = null; this.sequence = null;
              this.chatHistory = []; this.lastEvaluation = null;
              this.isReady = false; this.isLoading = false;
              this.emit('status', { state: 'error', message: 'Model has been disposed. Please reload a model.' });
              return;
            }
            try {
              this.context = await this.model.createContext({ contextSize: this.modelInfo?.contextSize || 4096, flashAttention: this._flashAttnEnabled ?? false });
              sequence = this.context.getSequence(
                this.tokenPredictor ? { tokenPredictor: this.tokenPredictor } : undefined
              );
            } catch (e2) {
              console.error('[LLM] Could not recreate context:', e2.message);
              if (e2.message?.toLowerCase().includes('disposed')) {
                this.isReady = false; this.isLoading = false;
                this.emit('status', { state: 'error', message: 'Model has been disposed. Please reload a model.' });
              }
              return;
            }
          }
        } else {
          // Clear the existing sequence's KV cache
          try {
            const len = sequence.nTokens || 0;
            if (len > 0) sequence.eraseContextTokenRanges([{ start: 0, end: len }]);
          } catch (_) {}
        }
        
        // Create new LlamaChat on the (reused or fresh) sequence
        this.sequence = sequence;
        try {
          this.chat = new LlamaChat({
            contextSequence: sequence,
          });
          // Reapply the probe-confirmed wrapper — resetSession creates a bare LlamaChat
          // which auto-detects the wrapper, losing any customisation from the initial load.
          if (this._selectedWrapperName && this._llamaCppClasses) {
            this._applyNamedWrapper(this._selectedWrapperName);
          }
        } catch (constructErr) {
          console.error('[LLM] Chat construction failed:', constructErr.message);
          this.chat = null;
        }

        // Reset conversation history with fresh system message
        this.chatHistory = [{
          type: 'system',
          text: prompt
        }];
        this.lastEvaluation = null;
        
        console.log('[LLM] Session reset complete');
      } catch (e) {
        console.error('Failed to reset session:', e);
      }
    }
  }

  async dispose() {
    try {
      // Cancel any active generation first so the token loop doesn't throw
      // "object is disposed" after we free the native context/model below.
      try { this.cancelGeneration('dispose'); } catch (_) {}
      if (this.chat) {
        try { this.chat.dispose?.(); } catch (_) {}
        this.chat = null;
      }
      this.chatHistory = [];
      this.lastEvaluation = null;
      this.sequence = null;
      if (this.context) {
        await this.context.dispose();
        this.context = null;
      }
      if (this.model) {
        await this.model.dispose();
        this.model = null;
      }
      // Intentionally do NOT dispose llamaInstance — it's reused across model loads
      // to skip expensive CUDA kernel compilation on every model switch.
    } catch (e) {
      console.error('Error disposing LLM resources:', e);
    }
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isLoading: this.isLoading,
      modelInfo: this.modelInfo,
      currentModelPath: this.currentModelPath,
      gpuPreference: this.gpuPreference,
    };
  }

  /**
   * Get real-time GPU information (VRAM usage, utilization, temperature)
   * Returns null if no NVIDIA GPU or nvidia-smi not available
   */
  getGPUInfo() {
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
        { timeout: 2000, encoding: 'utf8', windowsHide: true }
      ).trim();
      
      if (!output) return null;
      
      const parts = output.split(',').map(s => s.trim());
      if (parts.length < 6) return null;
      
      const info = {
        name: parts[0],
        vramTotalMB: parseInt(parts[1]) || 0,
        vramUsedMB: parseInt(parts[2]) || 0,
        vramFreeMB: parseInt(parts[3]) || 0,
        utilizationPercent: parseInt(parts[4]) || 0,
        temperatureC: parseInt(parts[5]) || 0,
        vramTotalGB: ((parseInt(parts[1]) || 0) / 1024).toFixed(1),
        vramUsedGB: ((parseInt(parts[2]) || 0) / 1024).toFixed(1),
        vramFreeGB: ((parseInt(parts[3]) || 0) / 1024).toFixed(1),
        vramUsagePercent: Math.round(((parseInt(parts[2]) || 0) / (parseInt(parts[1]) || 1)) * 100),
        isActive: (this.modelInfo?.gpuLayers || 0) > 0,
        gpuLayers: this.modelInfo?.gpuLayers || 0,
        backend: this.modelInfo?.gpuBackend || 'Unknown',
      };
      
      this.gpuInfo = info;
      return info;
    } catch (_) {
      return this.gpuInfo || null; // Return cached info if nvidia-smi fails
    }
  }

  setGPUPreference(pref) {
    if (pref === 'auto' || pref === 'cpu') {
      this.gpuPreference = pref;
      console.log(`[LLM] GPU preference set to: ${pref}`);
    }
  }

  updateParams(params) {
    this.defaultParams = { ...this.defaultParams, ...params };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  NATIVE FUNCTION CALLING — Grammar-Constrained Tool Generation
  //  This is the KEY architectural improvement for small model reliability.
  //  Instead of hoping models output valid JSON tool calls, node-llama-cpp
  //  constrains token generation via GBNF grammar to FORCE valid output.
  //  Models literally CANNOT produce invalid tool calls or wrong tool names.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Convert MCP tool definitions to node-llama-cpp ChatModelFunctions format.
   * @param {Array} toolDefs - MCP tool definitions from mcpToolServer.getToolDefinitions()
   * @param {Array<string>|null} filterNames - Optional: only include these tool names
   * @returns {Object} ChatModelFunctions map for node-llama-cpp
   */
  static convertToolsToFunctions(toolDefs, filterNames = null) {
    const functions = {};
    for (const tool of toolDefs) {
      if (filterNames && !filterNames.includes(tool.name)) continue;
      const paramSchema = { type: 'object', properties: {} };
      const required = [];
      if (tool.parameters && typeof tool.parameters === 'object') {
        // Handle both formats: {paramName: {type, description, required}} and JSON Schema
        for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
          if (paramName === 'type' || paramName === 'properties' || paramName === 'required') continue;
          const pType = paramDef.type || 'string';
          const prop = { type: pType === 'number' ? 'number' : (pType === 'boolean' ? 'boolean' : 'string') };
          if (paramDef.description) prop.description = paramDef.description;
          if (paramDef.enum) prop.enum = paramDef.enum;
          paramSchema.properties[paramName] = prop;
          if (paramDef.required) required.push(paramName);
        }
      }
      if (required.length > 0) paramSchema.required = required;
      // If no properties, allow empty params (tools like browser_snapshot)
      if (Object.keys(paramSchema.properties).length === 0) {
        functions[tool.name] = { description: tool.description || tool.name };
      } else {
        functions[tool.name] = {
          description: tool.description || tool.name,
          params: paramSchema,
        };
      }
    }
    return functions;
  }

  /**
   * Generate a response with native function calling support.
   * Uses node-llama-cpp's grammar-constrained decoding to force valid tool calls.
   * 
   * @param {Object} input - {systemContext, userMessage}
   * @param {Object} functions - ChatModelFunctions map from convertToolsToFunctions()
   * @param {Object} params - Generation params
   * @param {Function} onToken - Token callback for streaming
   * @param {Function} onThinkingToken - Thinking token callback
   * @param {Function} onFunctionCall - Called when a function call is generated
   * @param {Object} [options] - Additional options
   * @param {number} [options.timeoutMs] - Override generation timeout (default: 120000)
   * @returns {Object} {text, functionCalls: [{functionName, params}], stopReason}
   */
  async generateWithFunctions(input, functions, params = {}, onToken, onThinkingToken, onFunctionCall, options = {}) {
    if (!this.isReady || !this.chat) {
      throw new Error('Model not loaded. Please load a model first.');
    }

    let systemContext, userMessage;
    if (typeof input === 'string') {
      systemContext = undefined;
      userMessage = input;
    } else {
      systemContext = input.systemContext;
      userMessage = input.userMessage;
    }

    // Update system context in chatHistory
    if (systemContext !== undefined) {
      const fullSystemText = systemContext;
      if (this.chatHistory.length > 0 && this.chatHistory[0].type === 'system') {
        if (this.chatHistory[0].text !== fullSystemText) {
          this.chatHistory[0] = { type: 'system', text: fullSystemText };
          this.lastEvaluation = null;
        }
      } else {
        this.chatHistory.unshift({ type: 'system', text: fullSystemText });
        this.lastEvaluation = null;
      }
    }

    // Add user message
    this.chatHistory.push({ type: 'user', text: userMessage });

    const modelOverrides = this._getModelSpecificParams();
    const mergedParams = { ...this.defaultParams, ...modelOverrides, ...params };
    this.abortController = new AbortController();

    // Safety timeout — callers can override for grammar-constrained calls.
    // Grammar-constrained generation either produces tokens within seconds or
    // gets permanently stuck in rejection sampling.  A short timeout (e.g. 15s)
    // lets the agentic loop fall back to text mode quickly instead of burning
    // 120s×2 = 240s before the consecutiveEmptyGrammarRetries threshold fires.
    const GEN_TIMEOUT_MS = options.timeoutMs || 120_000;
    const genTimeoutTimer = setTimeout(() => {
      console.log(`[LLM] Function-calling generation timeout (${GEN_TIMEOUT_MS / 1000}s) — aborting`);
      this.cancelGeneration('timeout');
    }, GEN_TIMEOUT_MS);

    let fullResponse = '';
    let collectedFunctionCalls = [];

    try {
      this._compactHistory();
      const useKvCache = this.lastEvaluation && !this._kvReuseCooldown;
      if (this._kvReuseCooldown && this.lastEvaluation) {
        this._kvReuseCooldown--;
        if (this._kvReuseCooldown <= 0) this._kvReuseCooldown = 0;
      }

      // Determine if we should pass functions
      const hasFunctions = functions && Object.keys(functions).length > 0;

      const result = await this.chat.generateResponse(this.chatHistory, {
        maxTokens: mergedParams.maxTokens,
        temperature: mergedParams.temperature,
        topP: mergedParams.topP,
        topK: mergedParams.topK,
        repeatPenalty: {
          penalty: mergedParams.repeatPenalty,
          frequencyPenalty: mergedParams.frequencyPenalty ?? 0.1,
          presencePenalty: mergedParams.presencePenalty ?? 0.1,
          lastTokensPenaltyCount: mergedParams.lastTokensPenaltyCount || 128,
        },
        ...(mergedParams.seed >= 0 ? { seed: mergedParams.seed } : {}),
        ...(useKvCache ? {
          lastEvaluationContextWindow: {
            history: this.lastEvaluation.contextWindow,
            minimumOverlapPercentageToPreventContextShift: 0.5,
          },
          contextShift: {
            strategy: 'eraseFirstResponseAndKeepFirstSystem',
            lastEvaluationMetadata: this.lastEvaluation.contextShiftMetadata || undefined,
          },
        } : {
          contextShift: { strategy: 'eraseFirstResponseAndKeepFirstSystem' },
        }),
        budgets: {
          thoughtTokens: this.thoughtTokenBudget === -1 ? Infinity : this.thoughtTokenBudget,
        },
        signal: this.abortController.signal,
        stopOnAbortSignal: true,
        // ── Native function calling ──
        ...(hasFunctions ? {
          functions,
          maxParallelFunctionCalls: 4,
          onFunctionCall: (funcCall) => {
            console.log(`[LLM] Native function call: ${funcCall.functionName}(${JSON.stringify(funcCall.params).substring(0, 100)})`);
            collectedFunctionCalls.push({
              functionName: funcCall.functionName,
              params: funcCall.params,
            });
            if (onFunctionCall) onFunctionCall(funcCall);
          },
          onFunctionCallParamsChunk: (chunk) => {
            // Stream function call params as they generate (for UI feedback)
            if (chunk.done && onToken) {
              onToken(`\n\`\`\`json\n{"tool":"${chunk.functionName}","params":...}\n\`\`\`\n`);
            }
          },
        } : {}),
        onResponseChunk: (chunk) => {
          if (chunk.segmentType === 'thought') {
            if (onThinkingToken && chunk.text) onThinkingToken(chunk.text);
          } else if (chunk.text) {
            fullResponse += chunk.text;
            if (onToken) onToken(chunk.text);
          }
        },
      });

      // Save evaluation state for KV cache reuse
      if (result.lastEvaluation) {
        this.lastEvaluation = result.lastEvaluation;
        // Replace chatHistory with cleanHistory from the engine
        if (result.lastEvaluation.cleanHistory) {
          this.chatHistory = result.lastEvaluation.cleanHistory;
        }
      }

      // Collect function calls from the response
      if (result.functionCalls && result.functionCalls.length > 0) {
        for (const fc of result.functionCalls) {
          if (!collectedFunctionCalls.some(c => c.functionName === fc.functionName && JSON.stringify(c.params) === JSON.stringify(fc.params))) {
            collectedFunctionCalls.push({
              functionName: fc.functionName,
              params: fc.params,
            });
          }
        }
      }

      console.log(`[LLM] Function-calling generation complete: ${fullResponse.length} chars, ${collectedFunctionCalls.length} function calls, stop: ${result.metadata?.stopReason}`);

      return {
        text: fullResponse,
        response: fullResponse,
        functionCalls: collectedFunctionCalls,
        stopReason: result.metadata?.stopReason || 'unknown',
      };
    } catch (error) {
      if (error.name === 'AbortError' || this._abortReason) {
        return {
          text: fullResponse,
          response: fullResponse,
          functionCalls: collectedFunctionCalls,
          stopReason: this._abortReason || 'abort',
        };
      }
      throw error;
    } finally {
      this.generationActive = false;
      clearInterval(genTimeoutTimer);
      this.abortController = null;
      this._abortReason = null;
    }
  }
}

module.exports = { LLMEngine };
