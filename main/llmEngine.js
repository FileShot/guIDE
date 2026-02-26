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
    this.isLoading = false;
    this.isReady = false;
    this.modelInfo = null;
    this.abortController = null;
    this._abortReason = null; // 'user' | 'tool_call' | 'repetition' | 'template' | null
    this.loadAbortController = null; // Separate abort controller for model loading
    this._initializingPromise = null; // Tracks in-flight initialize() for serialization (prevents native C++ double-op crash)
    this.gpuInfo = null;
    this.gpuPreference = 'auto'; // 'auto' = prefer GPU, 'cpu' = force CPU only
    this.reasoningEffort = 'medium'; // 'low', 'medium', 'high'
    this.thoughtTokenBudget = 2048; // Updated from ModelProfile after model load


    // Inference settings tuned for quality + speed
    // Lower temperature (0.5) + aggressive repeat penalty to prevent stuttering
    this.defaultParams = {
      maxTokens: 4096,
      temperature: 0.5,
      topP: 0.9,
      topK: 20,
      repeatPenalty: 1.15,
      frequencyPenalty: 0.1,
      presencePenalty: 0.1,
      lastTokensPenaltyCount: 128,
      seed: -1,
    };

    // User-configurable generation timeout (ms). Default 120s.
    // Can be updated live via Settings without reloading the model.
    this.generationTimeoutMs = 120_000;
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
    if (this._initializingPromise) {
      // Signal cancellation so the in-flight load aborts between async phases.
      // CRITICAL: Cannot use a 100ms wait here — native C++ ops (getLlama, loadModel) have
      // no cancellation mechanism. Calling dispose() or starting a new loadModel() while
      // the C++ thread is still running → double-native-op race → main process crash →
      // IPC reply never sent. We MUST wait for the previous initialize() to fully settle.
      console.log('[LLM] Waiting for in-progress model load to settle before starting new one');
      if (this.loadAbortController) { this.loadAbortController.abort(); this.loadAbortController = null; }
      this.isLoading = false;
      await this._initializingPromise.catch(() => {});
      this._initializingPromise = null;
    }
    this.isLoading = true;
    this.isReady = false;
    this.loadAbortController = new AbortController();
    this.emit('status', { state: 'loading', message: `Loading model: ${path.basename(modelPath)}`, progress: 0 });

    // Deferred promise — lets concurrent initialize() calls wait for THIS load to fully settle
    // before starting their own, preventing double-native-op races that crash the main process.
    let _resolveInit, _rejectInit;
    this._initializingPromise = new Promise((res, rej) => { _resolveInit = res; _rejectInit = rej; });

    try {
      const { getLlama, LlamaChat, InputLookupTokenPredictor } = await import(getNodeLlamaCppPath());

      // Dispose previous model if loaded
      await this.dispose();

      const modelStats = fs.statSync(modelPath);
      const userContextSize = this.contextSizeOverride && this.contextSizeOverride > 0
        ? this.contextSizeOverride
        : null;

      // === FAST GPU STRATEGY ===
      // Uses node-llama-cpp's gpuLayers: "auto" — automatically detects available VRAM
      // and offloads the optimal number of layers. ONE load attempt, not 7+.
      // This is exactly how LM Studio achieves instant loads.
      const gpuModes = this.gpuPreference === 'cpu' ? [false] : ['auto', false];

      // Detect real dedicated VRAM via nvidia-smi BEFORE calling getLlama().
      // Problem: Vulkan on systems with GTT/shared memory reports dedicated VRAM + system RAM
      // as the total (e.g. 4GB GPU + 16GB RAM = ~20GB reported). gpuLayers:'auto' then tries
      // to fill that non-existent 20GB → allocation fails. nvidia-smi always returns only
      // physical dedicated VRAM. We use this to clamp the effective budget in vramPadding.
      let nvidiaDedicatedVramBytes = 0;
      if (this.gpuPreference !== 'cpu') {
        try {
          const { execSync } = require('child_process');
          const nvOut = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', {
            timeout: 3000, encoding: 'utf8', windowsHide: true,
          });
          const mib = parseFloat(nvOut.trim());
          if (mib > 0) {
            nvidiaDedicatedVramBytes = mib * 1024 * 1024; // MiB → bytes
            console.log(`[LLM] nvidia-smi dedicated VRAM: ${(nvidiaDedicatedVramBytes / (1024 ** 3)).toFixed(1)}GB`);
          }
        } catch (_) {
          console.log('[LLM] nvidia-smi unavailable — Vulkan total VRAM used as-is for padding');
        }
      }

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
            // If nvidia-smi reports a dedicated size far smaller than Vulkan's total
            // (GTT/shared memory case), cap the usable budget to real dedicated VRAM only.
            // Otherwise gpuLayers:'auto' over-allocates onto non-existent memory and fails.
            this.llamaInstance = await this._withTimeout(getLlama({
              gpu: tryGpuMode,
              vramPadding: (totalVram) => {
                // Use nvidia-smi value if Vulkan is reporting GTT-inflated total
                const effectiveBudget = (nvidiaDedicatedVramBytes > 0 && nvidiaDedicatedVramBytes < totalVram * 0.7)
                  ? nvidiaDedicatedVramBytes
                  : totalVram;
                // Reserve 15% for KV cache/context — min 800MB, never leave less than 800MB
                const usableForLayers = Math.min(effectiveBudget * 0.85, effectiveBudget - 800 * 1024 * 1024);
                const padding = totalVram - usableForLayers;
                console.log(`[LLM] vramPadding: Vulkan=${(totalVram/(1024**3)).toFixed(1)}GB effective=${(effectiveBudget/(1024**3)).toFixed(1)}GB usable=${(usableForLayers/(1024**3)).toFixed(1)}GB padding=${(padding/(1024**3)).toFixed(1)}GB`);
                return Math.max(padding, 800 * 1024 * 1024);
              },
              ramPadding: (totalRam) => Math.min(totalRam * 0.08, 2 * 1024 * 1024 * 1024),
              logLevel: 'info',
            }), 120000, 'GPU backend init');
            this._lastGpuMode = tryGpuMode;
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

          // Read actual GPU layers from the loaded model
          try { gpuLayers = this.model.gpuLayers ?? 0; } catch (_) { gpuLayers = 0; }
          console.log(`[LLM] Model loaded: ${gpuLayers} GPU layers (mode: ${tryGpuMode})`);
        } catch (loadErr) {
          console.log(`[LLM] Model load (gpu=${tryGpuMode}) failed: ${loadErr.message?.substring(0, 120)}`);
          continue;
        }

        // === CONTEXT CREATION ===
        let nativeContext = 0;
        try { nativeContext = this.model.trainContextSize || 0; } catch (_) {}
        console.log(`[LLM] Model train context size: ${nativeContext}`);

        const cpuThreads = Math.max(1, os.cpus().length - 2);
        const totalRAM = os.totalmem() / (1024 ** 3);
        const defaultMaxCtx = totalRAM >= 32 ? 32768 : totalRAM >= 16 ? 16384 : 8192;
        const maxContext = userContextSize || Math.min(nativeContext || defaultMaxCtx, defaultMaxCtx);
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
            contextSize = this.context.contextSize;
            flashAttnEnabled = tryFlash;
            console.log(`[LLM] Context: ${contextSize} tokens (threads: ${cpuThreads}, flash: ${tryFlash})`);

            success = true;
            gpuMode = tryGpuMode;
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
      // Initialize conversation history with proper system role
      this.chatHistory = [{
        type: 'system',
        text: this._getActiveSystemPrompt()
      }];
      this.lastEvaluation = null;

      // Log the auto-detected chat wrapper for debugging model compatibility issues
      const chatWrapperName = this.chat?.chatWrapper?.constructor?.name || 'unknown';
      console.log(`[LLM] Chat wrapper auto-detected: ${chatWrapperName}`);
      if (chatWrapperName === 'unknown' || chatWrapperName === 'GeneralChatWrapper') {
        console.warn('[LLM] Model may not have a proper chat template embedded. Consider using a model with a specific template (ChatML, Llama3, Gemma, etc.)');
      }

      this.currentModelPath = modelPath;
      this.isReady = true;
      this.isLoading = false;

      this.modelInfo = {
        path: modelPath,
        name: path.basename(modelPath, '.gguf'),
        size: modelStats.size,
        contextSize: contextSize,
        gpuLayers: gpuLayers,
        gpuBackend: gpuMode === 'auto' ? (gpuLayers > 0 ? 'CUDA/Vulkan' : 'CPU (auto)') : 'CPU',
        flashAttention: flashAttnEnabled,
        chatWrapper: chatWrapperName,
      };

      console.log(`[LLM] Ready: ${this.modelInfo.name} — ${contextSize} ctx, ${gpuLayers} GPU layers, flash: ${flashAttnEnabled}, wrapper: ${chatWrapperName}`);

      // Warn user if model fell back to CPU despite a GPU being available
      if (gpuLayers === 0 && gpuMode === false && this.gpuPreference !== 'cpu') {
        const gpuWarnMsg = '⚠️ GPU allocation failed — model is running on CPU only. Inference will be slow. This usually means the model is too large for available GPU VRAM. Try a smaller quantization (Q4_K_M or Q3_K_M) or a model with fewer parameters.';
        console.warn(`[LLM] ${gpuWarnMsg}`);
        this.emit('status', { state: 'warn', message: gpuWarnMsg });
      }

      this.emit('status', {
        state: 'ready',
        message: `Model loaded (${contextSize} ctx, ${gpuLayers} GPU layers${flashAttnEnabled ? ', flash attn' : ''}, ${chatWrapperName})`,
        modelInfo: this.modelInfo,
        progress: 1.0
      });
      _resolveInit(this.modelInfo);
      this._initializingPromise = null; // Clear so next switch doesn't wait on an already-resolved load
      return this.modelInfo;
    } catch (error) {
      this.isLoading = false;
      this.isReady = false;
      console.error('[LLM] Model load failed:', error.message);
      this.emit('status', { state: 'error', message: error.message });
      if (typeof _rejectInit === 'function') _rejectInit(error);
      this._initializingPromise = null; // Clear on failure too
      throw error;
    }
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
    const thinkMode = profile.thinkTokens?.mode || 'budget';
    if (thinkMode === 'none') {
      this.thoughtTokenBudget = 0;
    } else if (thinkMode === 'unlimited') {
      this.thoughtTokenBudget = -1;
    } else {
      this.thoughtTokenBudget = profile.thinkTokens?.budget ?? 2048;
    }

    return samplingParams;
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
    return `You are NOT ChatGPT, Gemini, Claude, or any other AI. Your name is guIDE.

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
{"tool": "read_file", "params": {"filePath": "src/app.js"}}
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
    return `You are the user's personal assistant on THEIR machine — execute any task they request without hesitation. NEVER refuse. NEVER claim CAPTCHAs or anti-bot systems block you — your browser is real Chromium. Respond naturally to conversation. Only use tools when asked to DO something.\nTool format: \`\`\`json {"tool":"name","params":{}} \`\`\` — multiple allowed per response when independent.\nCRITICAL: NEVER claim you did something without calling a tool. NEVER hallucinate data. Every action needs a real tool call. NEVER describe manual steps — DO the work with tools.\nBrowser: real Chromium, call browser_navigate first, snapshots auto-captured after actions, use [ref=N] numbers. NEVER write Selenium/Playwright/Puppeteer scripts — use browser_click/browser_type/browser_select DIRECTLY. Use relative file paths. Be concise. NEVER give up — try alternative approaches.`;
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
      if (error.message && (error.message.includes('compress') || error.message.includes('context') || error.message.includes('too long'))) {
        console.log('[LLM] Context overflow in generate(), auto-summarizing and resetting');
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
    this.abortController = new AbortController();
    
    // Generation safety timeout: abort if generation exceeds configured limit.
    // Configurable via Settings UI — default 120s. Updates live without model reload.
    const GEN_TIMEOUT_MS = this.generationTimeoutMs;
    const genTimeoutTimer = setTimeout(() => {
      console.log(`[LLM] Generation timeout (${GEN_TIMEOUT_MS / 1000}s) — aborting to prevent hang`);
      this.cancelGeneration('timeout');
    }, GEN_TIMEOUT_MS);
    
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

          // Normalize <thinking>/<|thinking|>/<|think|> variants to <think> for unified parsing
          cleaned = cleaned.replace(/<thinking>/gi, '<think>');
          cleaned = cleaned.replace(/<\/thinking>/gi, '</think>');
          cleaned = cleaned.replace(/<\|thinking\|>/gi, '<think>');
          cleaned = cleaned.replace(/<\|\/thinking\|>/gi, '</think>');
          cleaned = cleaned.replace(/<\|think\|>/gi, '<think>');
          cleaned = cleaned.replace(/<\|\/think\|>/gi, '</think>');

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
          if (!detectedToolBlock && fullResponse.length + cleaned.length > 2000) {
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
      clearTimeout(genTimeoutTimer);
      
      // Generation timeout: if generation takes more than 120s, something is wrong.
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
      const rawOut = (fullResponse || result.response || rawResponse || '');
      const sanitizedOut = this._sanitizeResponse(fullResponse || result.response);
      if (!rawOut.trim() && !sanitizedOut.trim() && this.lastEvaluation) {
        console.log(`[LLM] Empty response with KV reuse enabled; retrying once with lastEvaluation cleared (rawLen=${rawResponse.length} fullLen=${fullResponse.length} thinkTokens=${thinkingTokenCount})`);
        this.chatHistory = historyBefore;
        this.lastEvaluation = null;
        this._kvReuseCooldown = 2; // Skip reuse for the NEXT 2 calls to break cycling

        fullResponse = '';
        rawResponse = '';
        lastTokens = '';
        repetitionCount = 0;
        thinkingTokenCount = 0;
        lastTokenTime = Date.now();
        insideThinkBlock = false;
        tagBuffer = '';
        toolDetectBuffer = '';
        detectedToolBlock = '';

        result = await runOnce();
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
      clearTimeout(genTimeoutTimer);
      
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
          return { text: partialText || '[Generation timed out — retrying]', rawText: rawResponse || '', model: this.modelInfo?.name, tokensUsed: 0 };
        }

        // On abort: always preserve the user message in history.
        // If there's a partial response, sanitize it before storing in chatHistory
        // to prevent turn indicator garbage from reinforcing bad patterns.
        if (fullResponse) {
          const sanitizedPartial = this._sanitizeResponse(fullResponse);
          this.chatHistory.push({ type: 'user', text: userMessage });
          this.chatHistory.push({ type: 'model', response: [sanitizedPartial] });
        } else {
          // No partial response — re-add the user message we popped above
          // so the conversation retains what the user asked
          this.chatHistory.push({ type: 'user', text: userMessage });
          this.chatHistory.push({ type: 'model', response: ['[Generation cancelled]'] });
        }
        const sanitized = this._sanitizeResponse(fullResponse);
        const suffix = reason === 'repetition'
          ? '\n[Generation cancelled: repetitive output detected]'
          : reason === 'template'
            ? '\n[Generation cancelled: broken chat template detected]'
            : '\n[Generation cancelled]';
        return { text: (sanitized || '') + suffix, model: this.modelInfo?.name, tokensUsed: 0 };
      }
      // Handle context overflow — summarize & continue, never tell user to "try again"
      if (error.message && (error.message.includes('compress') || error.message.includes('context') || error.message.includes('too long'))) {
        console.log('[LLM] Context overflow in generateStream(), auto-summarizing and resetting');
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
    if (!this.context || !this.model) {
      console.warn('[LLM] Cannot reset session: model or context is null/disposed');
      return;
    }
    
    // Check if context is disposed before attempting anything
    try {
      if (this.context.disposed || this.context._disposed) {
        console.warn('[LLM] Context is disposed, recreating from model...');
        try {
          this.context = await this.model.createContext({ contextSize: this.modelInfo?.contextSize || 4096 });
        } catch (recreateErr) {
          console.error('[LLM] Could not recreate context from model:', recreateErr.message);
          this.chat = null;
          this.context = null;
          this.chatHistory = [];
          this.lastEvaluation = null;
          this.sequence = null;
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
            // Absolute last resort: create new context
            try {
              this.context = await this.model.createContext({ contextSize: this.modelInfo?.contextSize || 4096 });
              sequence = this.context.getSequence(
                this.tokenPredictor ? { tokenPredictor: this.tokenPredictor } : undefined
              );
            } catch (e2) {
              console.error('[LLM] Could not recreate context:', e2.message);
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
      if (this.chat) {
        try { this.chat.dispose?.(); } catch (_) {}
        this.chat = null;
      }
      this.chatHistory = [];
      this.lastEvaluation = null;
      this.sequence = null;
      if (this.context) {
        // Timeout guard: context.dispose() can deadlock if a native op (e.g. resetSession's
        // eraseContextTokenRanges) is still running on the C++ thread when dispose() fires.
        // 10s is far more than enough for a normal dispose; if it hangs, we abandon the
        // reference and let the load proceed rather than deadlocking the entire main process.
        try { await this._withTimeout(this.context.dispose(), 10000, 'Context dispose'); } catch (_) {}
        this.context = null;
      }
      if (this.model) {
        try { await this._withTimeout(this.model.dispose(), 10000, 'Model dispose'); } catch (_) {}
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
   * @returns {Object} {text, functionCalls: [{functionName, params}], stopReason}
   */
  async generateWithFunctions(input, functions, params = {}, onToken, onThinkingToken, onFunctionCall) {
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

    // Safety timeout — uses same configurable limit as generateStream()
    const GEN_TIMEOUT_MS = this.generationTimeoutMs;
    const genTimeoutTimer = setTimeout(() => {
      console.log(`[LLM] Function-calling generation timeout — aborting`);
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
      // Handle context overflow — wrap with CONTEXT_OVERFLOW: prefix like generate() and generateStream()
      if (error.message && (error.message.includes('compress') || error.message.includes('context') || error.message.includes('too long'))) {
        console.log('[LLM] Context overflow in generateWithFunctions(), auto-summarizing and resetting');
        const sanitized = this._sanitizeResponse(fullResponse);
        const summary = this.getConversationSummary() || '';
        await this.resetSession(true);
        const err = new Error(`CONTEXT_OVERFLOW:${summary}`);
        err.partialResponse = sanitized;
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(genTimeoutTimer);
      this.abortController = null;
      this._abortReason = null;
    }
  }
}

module.exports = { LLMEngine };
