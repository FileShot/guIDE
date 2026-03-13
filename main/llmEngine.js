'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { getModelProfile, getModelSamplingParams, getEffectiveContextSize, getSizeTier } = require('./modelProfiles');
const { detectFamily, detectParamSize } = require('./modelDetection');
const { sanitizeResponse } = require('./sanitize');

// ─── Constants ───
const STALL_TIMEOUT_MS = 90_000;
const MAX_HISTORY_ENTRIES = 40;
const GPU_INIT_TIMEOUT = 120_000;
const MODEL_LOAD_TIMEOUT = 180_000;
const CTX_CREATE_TIMEOUT_GPU = 15_000;
const CTX_CREATE_TIMEOUT_CPU = 60_000;
const DISPOSE_TIMEOUT = 10_000;
const MIN_AGENTIC_CONTEXT = 4096;
const MIN_USABLE_GPU_CONTEXT = 8192;
const TOOL_DETECT_BUFFER_MAX = 60_000;
const KV_REUSE_COOLDOWN_TURNS = 2;
const MAX_PARALLEL_FUNCTION_CALLS = 4;
const CONTEXT_ABSOLUTE_CEILING = 131_072;
const VRAM_PADDING_FLOOR_MB = 800;

let _genCounter = 0;

class LLMEngine extends EventEmitter {
  constructor() {
    super();
    this.model = null;
    this.context = null;
    this.chat = null;
    this.chatHistory = [];
    this.lastEvaluation = null;
    this.sequence = null;
    this.llamaInstance = null;
    this.currentModelPath = null;
    this.isLoading = false;
    this.isReady = false;
    this.modelInfo = null;
    this.abortController = null;
    this._abortReason = null;
    this.loadAbortController = null;
    this._initializingPromise = null;
    this.gpuInfo = null;
    this.gpuPreference = 'auto';
    this.requireMinContextForGpu = false;
    this.reasoningEffort = 'medium';
    this.thoughtTokenBudget = 2048;
    this.generationTimeoutMs = 0;
    this.tokenPredictor = null;
    this._cachedVramGB = null;
    this._cachedNvidiaDedicatedVramBytes = null;
    this._lastGpuMode = null;
    this._kvReuseCooldown = 0;
    this._activeGenerationPromise = null;
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
  }

  // ─── Timeout Wrapper ───
  _withTimeout(promise, ms, label) {
    if (!ms || ms <= 0) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  // ─── GPU Configuration ───
  _getGPUConfig(modelSizeBytes) {
    try {
      const { execSync } = require('child_process');
      if (this._cachedVramGB == null) {
        const out = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { timeout: 5000 }).toString().trim();
        this._cachedVramGB = parseFloat(out) / 1024;
      }
      const vramGB = this._cachedVramGB;
      const modelSizeGB = (modelSizeBytes || 0) / (1024 ** 3);
      // Heuristic: estimate layers from model size
      const estLayers = modelSizeGB < 2 ? 32 : modelSizeGB < 8 ? 40 : modelSizeGB < 20 ? 48 : 80;
      const usableVram = Math.max(0, vramGB - VRAM_PADDING_FLOOR_MB / 1024);
      const fitsRatio = Math.min(1, usableVram / Math.max(0.1, modelSizeGB));
      const roughMaxLayers = Math.floor(estLayers * fitsRatio);
      return { roughMaxLayers, estimatedLayers: estLayers, vramGB, modelSizeGB };
    } catch {
      return { roughMaxLayers: 0, estimatedLayers: 32, vramGB: 0, modelSizeGB: 0 };
    }
  }

  _getModelParamSize() {
    return detectParamSize(this.currentModelPath);
  }

  _getModelFamily() {
    return detectFamily(this.currentModelPath);
  }

  _getModelSpecificParams() {
    const family = this._getModelFamily();
    const paramSize = this._getModelParamSize();
    const profile = getModelProfile(family, paramSize);
    const sampling = { ...profile.sampling };

    // Sync thought token budget from profile
    const tt = profile.thinkTokens || {};
    if (tt.mode === 'none') {
      this.thoughtTokenBudget = 0;
    } else if (tt.mode === 'unlimited') {
      this.thoughtTokenBudget = -1;
    } else if (tt.mode === 'budget' && tt.budget > 0) {
      this.thoughtTokenBudget = tt.budget;
    }

    // Detect thinking variants by filename
    if (this.currentModelPath) {
      const base = path.basename(this.currentModelPath).toLowerCase();
      const isThinkingVariant = /qwen3|r1-distill|qwq|-think/.test(base);
      if (isThinkingVariant && tt._thinkBudgetWhenActive) {
        this.thoughtTokenBudget = tt._thinkBudgetWhenActive;
      }
    }

    // Include maxResponseTokens from context config
    if (profile.context && profile.context.maxResponseTokens) {
      sampling.maxTokens = profile.context.maxResponseTokens;
    }

    return sampling;
  }

  _compactHistory() {
    if (this.chatHistory.length <= MAX_HISTORY_ENTRIES) return;
    const sysMsg = this.chatHistory[0];
    const keepCount = Math.ceil(this.chatHistory.length * 0.8);
    const droppedCount = this.chatHistory.length - 1 - keepCount;
    console.log(`[LLMEngine] _compactHistory: dropping ${droppedCount} of ${this.chatHistory.length} entries (keeping ${keepCount})`);
    this.chatHistory = [sysMsg, ...this.chatHistory.slice(-keepCount)];
    this.lastEvaluation = null;
    this._lastCompactDropped = droppedCount;
  }

  _sanitizeResponse(text) {
    return sanitizeResponse(text);
  }

  // ─── System Prompts ───
  _getSystemPrompt() {
    const { DEFAULT_SYSTEM_PREAMBLE } = require('./constants');
    return DEFAULT_SYSTEM_PREAMBLE;
  }

  _getCompactSystemPrompt() {
    const { DEFAULT_COMPACT_PREAMBLE } = require('./constants');
    return DEFAULT_COMPACT_PREAMBLE;
  }

  _getActiveSystemPrompt() {
    const family = this._getModelFamily();
    const paramSize = this._getModelParamSize();
    const profile = getModelProfile(family, paramSize);
    return (profile.prompt && profile.prompt.style === 'compact')
      ? this._getCompactSystemPrompt()
      : this._getSystemPrompt();
  }

  async _waitForReady(timeoutMs = 30000) {
    if (this.isReady) return;
    if (!this._initializingPromise) throw new Error('No model is loading');
    await this._withTimeout(this._initializingPromise, timeoutMs, 'Model load wait');
    if (!this.isReady) throw new Error('Model failed to initialize');
  }

  // ─── Model Loading ───
  async initialize(modelPath) {
    // Serialize concurrent loads — prevent native C++ double-op crash
    if (this._initializingPromise) {
      if (this.loadAbortController) this.loadAbortController.abort();
      try { await this._initializingPromise; } catch {}
    }

    this.loadAbortController = new AbortController();
    const loadSignal = this.loadAbortController.signal;

    this._initializingPromise = this._doInitialize(modelPath, loadSignal);
    try {
      await this._initializingPromise;
    } finally {
      this._initializingPromise = null;
    }
  }

  async _doInitialize(modelPath, loadSignal) {
    this.isLoading = true;
    this.isReady = false;
    this.emit('status', { state: 'loading', message: `Loading ${path.basename(modelPath)}...` });

    try {
      // CUDA path injection
      this._injectCudaPath();

      // Dynamic import of node-llama-cpp
      const llamaCppPath = this._getNodeLlamaCppPath();
      const { getLlama, LlamaChat, InputLookupTokenPredictor } = await import(pathToFileURL(llamaCppPath).href);

      // Cancel any in-flight generation FIRST, then wait
      if (this.abortController) {
        this.cancelGeneration('model-switch');
      }
      // Wait for active generation to fully complete before disposing
      if (this._activeGenerationPromise) {
        try { 
          await Promise.race([
            this._activeGenerationPromise,
            new Promise(r => setTimeout(r, 3000)), // Max 3s wait for stuck generation
          ]); 
        } catch {}
      }
      // Extended settle time for node-llama-cpp internal async ops
      // (_eraseContextTokenRanges, streaming callbacks, etc.)
      // Increased from 500ms to 1000ms to prevent "Object is disposed" race
      await new Promise(r => setTimeout(r, 1000));

      // Preserve conversation history across model switch (exclude system message)
      // User experience: switching models mid-conversation should not lose context
      const _preservedHistory = Array.isArray(this.chatHistory) && this.chatHistory.length > 1
        ? this.chatHistory.filter(m => m.type !== 'system')
        : [];
      
      // Wrap dispose in additional try-catch for race protection
      try {
        await this._dispose();
      } catch (disposeErr) {
        const log = require('./logger');
        log.warn(`Dispose error (may be expected during model switch): ${disposeErr.message}`);
      }

      if (loadSignal.aborted) throw new Error('Load cancelled');

      // Detect VRAM
      this._probeVram();
      const modelStats = fs.statSync(modelPath);
      const gpuConfig = this._getGPUConfig(modelStats.size);

      // GPU mode fallback chain — model LOAD + CONTEXT creation together
      const gpuModes = this._buildGpuModeList(gpuConfig);
      let loadedModel = null;
      let loadedContext = null;
      let usedGpuMode = false;
      let bestAutoGpuLayers = 0;

      for (const mode of gpuModes) {
        if (loadSignal.aborted) throw new Error('Load cancelled');
        try {
          // Create or reuse Llama backend instance
          const backendMode = mode === false ? false : (typeof mode === 'number' ? 'cuda' : mode);
          if (!this.llamaInstance || this._lastGpuMode !== backendMode) {
            if (this.llamaInstance) {
              // Don't dispose — reuse for CUDA kernel caching
            }
            this.llamaInstance = await this._withTimeout(
              getLlama({
                gpu: backendMode,
                vramPadding: (ctx) => {
                  const padding = Math.max(VRAM_PADDING_FLOOR_MB * 1024 * 1024, ctx.totalVram * 0.05);
                  return padding;
                },
                ramPadding: () => {
                  const totalRam = os.totalmem();
                  return Math.min(totalRam * 0.08, 2 * 1024 ** 3);
                },
              }),
              GPU_INIT_TIMEOUT,
              'GPU initialization',
            );
            this._lastGpuMode = backendMode;
          }

          this.emit('status', { state: 'loading', message: `Trying GPU mode: ${mode}...` });

          loadedModel = await this._withTimeout(
            this.llamaInstance.loadModel({
              modelPath,
              gpuLayers: typeof mode === 'number' ? mode : undefined,
              defaultContextFlashAttention: true,
              useMmap: true,
              onLoadProgress: (p) => {
                this.emit('status', { state: 'loading', message: `Loading model... ${Math.round(p * 100)}%`, progress: p });
              },
            }),
            MODEL_LOAD_TIMEOUT,
            'Model loading',
          );

          // Track auto mode GPU layer usage
          if (mode === 'auto' && loadedModel.gpuLayers != null) {
            bestAutoGpuLayers = loadedModel.gpuLayers;
          }

          // Reject 'cuda' OR 'auto' mode if it loaded 0 layers despite available VRAM
          // AND there are explicit layer modes to try. This forces fallback to explicit
          // layer counts which work better on constrained VRAM GPUs.
          if ((mode === 'cuda' || mode === 'auto') && loadedModel.gpuLayers === 0 && gpuConfig.vramGB > 0.5 && gpuConfig.roughMaxLayers > 0) {
            const log = require('./logger');
            log.warn(`${mode.toUpperCase()} mode loaded 0 layers despite ${gpuConfig.vramGB.toFixed(1)}GB VRAM & ${gpuConfig.roughMaxLayers} estimated layers — trying explicit layer count`);
            loadedModel.dispose?.();
            loadedModel = null;
            continue;
          }

          // Now try to create context on this model
          const ctxTimeout = mode === false ? CTX_CREATE_TIMEOUT_CPU : CTX_CREATE_TIMEOUT_GPU;
          let maxCtx = this._computeMaxContext(gpuConfig.modelSizeGB);
          // CPU mode uses same RAM-based context sizing as GPU — no artificial cap
          const contextMin = (mode === false) ? 2048 : MIN_USABLE_GPU_CONTEXT;
          console.log(`[LLM DIAG] Context creation: mode=${mode}, maxCtx=${maxCtx}, contextMin=${contextMin}, modelSizeGB=${gpuConfig.modelSizeGB.toFixed(2)}`);
          loadedContext = await this._withTimeout(
            loadedModel.createContext({
              contextSize: { min: contextMin, max: maxCtx },
              flashAttention: true,
              ignoreMemorySafetyChecks: mode === false,
              failedCreationRemedy: { retries: 8, autoContextSizeShrink: 0.5 },
            }),
            ctxTimeout,
            'Context creation',
          );
          console.log(`[LLM DIAG] Context created: actualSize=${loadedContext.contextSize || 0}, mode=${mode}`);

          // Verify context is usable (need enough for system prompt + meaningful generation)
          const actualCtx = loadedContext.contextSize || 0;
          if (actualCtx < MIN_USABLE_GPU_CONTEXT && mode !== false) {
            const log = require('./logger');
            log.warn(`GPU mode ${mode} context too small (${actualCtx}), trying next mode`);
            loadedContext.dispose?.();
            loadedContext = null;
            loadedModel.dispose?.();
            loadedModel = null;
            continue;
          }

          usedGpuMode = mode;
          break;
        } catch (err) {
          const log = require('./logger');
          log.warn(`GPU mode ${mode} failed: ${err.message}`);
          if (loadedModel) { loadedModel.dispose?.(); loadedModel = null; }
          if (loadedContext) { loadedContext.dispose?.(); loadedContext = null; }
        }
      }

      if (!loadedModel || !loadedContext) throw new Error(`Failed to load model from ${modelPath} on any GPU mode`);
      if (loadSignal.aborted) { loadedContext.dispose?.(); loadedModel.dispose?.(); throw new Error('Load cancelled'); }

      this.model = loadedModel;
      this.context = loadedContext;
      this.currentModelPath = modelPath;

      // Reject GPU context if too small
      if (this.requireMinContextForGpu && usedGpuMode !== false) {
        const actualCtxSize = this.context.contextSize || 0;
        if (actualCtxSize < MIN_AGENTIC_CONTEXT) {
          this.context.dispose?.();
          this.context = null;
          throw new Error(`GPU context too small (${actualCtxSize}), need ${MIN_AGENTIC_CONTEXT}`);
        }
      }

      // Session setup
      this.tokenPredictor = new InputLookupTokenPredictor();
      this.sequence = this.context.getSequence();
      this.chat = new LlamaChat({ contextSequence: this.sequence });

      const sysPreamble = this._getActiveSystemPrompt();
      this.chatHistory = [{ type: 'system', text: sysPreamble }];
      this.lastEvaluation = null;

      // Restore preserved conversation history (if any) with fresh system message
      // This allows users to switch models mid-conversation without losing context
      if (_preservedHistory.length > 0) {
        // Cap preserved history to fit new model's context (keep most recent 60%)
        const maxHistory = Math.floor((this.context?.contextSize || 8192) * 0.15);
        const historyChars = _preservedHistory.reduce((sum, m) => sum + (typeof m.text === 'string' ? m.text.length : 0), 0);
        if (historyChars < maxHistory * 4) {
          this.chatHistory.push(..._preservedHistory);
          const log = require('./logger');
          log.info(`Model switch: preserved ${_preservedHistory.length} conversation turns (${historyChars} chars)`);
        } else {
          // History too large for new context — keep only recent portion
          const keep = Math.ceil(_preservedHistory.length * 0.4);
          this.chatHistory.push(..._preservedHistory.slice(-keep));
          const log = require('./logger');
          log.info(`Model switch: preserved ${keep}/${_preservedHistory.length} recent turns due to context limits`);
        }
      }

      // Model info
      const paramSize = this._getModelParamSize();
      const family = this._getModelFamily();
      this.modelInfo = {
        path: modelPath,
        name: path.basename(modelPath),
        size: modelStats.size,
        contextSize: this.context.contextSize || 0,
        gpuLayers: loadedModel.gpuLayers || 0,
        family,
        paramSize,
        tier: getSizeTier(paramSize),
        gpuMode: usedGpuMode,
      };

      this.isReady = true;
      this.isLoading = false;

      const log = require('./logger');
      log.info(`Model loaded: ${this.modelInfo.name} (${family}/${getSizeTier(paramSize)}, ctx=${this.modelInfo.contextSize}, gpu=${usedGpuMode}, layers=${this.modelInfo.gpuLayers})`);
      if (this.chat._chatWrapper) {
        log.info(`Chat wrapper: ${this.chat._chatWrapper.constructor?.name || 'unknown'}`);
      }

      this.emit('status', {
        state: 'ready',
        message: `Model ready: ${this.modelInfo.name}`,
        modelInfo: this.modelInfo,
      });
    } catch (err) {
      this.isLoading = false;
      this.isReady = false;
      this.emit('status', { state: 'error', message: err.message });
      throw err;
    }
  }

  _injectCudaPath() {
    try {
      const { app } = require('electron');
      const cudaStatePath = path.join(app.getPath('userData'), 'cuda-setup-state.json');
      if (fs.existsSync(cudaStatePath)) {
        const state = JSON.parse(fs.readFileSync(cudaStatePath, 'utf8'));
        if (state.cudaBinDir && fs.existsSync(state.cudaBinDir)) {
          const Module = require('module');
          if (!process.env.NODE_PATH?.includes(state.cudaBinDir)) {
            process.env.NODE_PATH = (process.env.NODE_PATH || '') + path.delimiter + state.cudaBinDir;
            Module._initPaths();
          }
        }
      }
    } catch {}
  }

  _getNodeLlamaCppPath() {
    try {
      return require.resolve('node-llama-cpp');
    } catch {
      // Asar-packed fallback
      const asarPath = path.join(__dirname, '..', 'node_modules', 'node-llama-cpp', 'dist', 'index.js');
      return asarPath;
    }
  }

  _probeVram() {
    if (this._cachedNvidiaDedicatedVramBytes != null) return;
    try {
      const { execSync } = require('child_process');
      const out = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { timeout: 5000 }).toString().trim();
      this._cachedNvidiaDedicatedVramBytes = parseFloat(out) * 1024 * 1024;
      this._cachedVramGB = parseFloat(out) / 1024;
    } catch {
      this._cachedNvidiaDedicatedVramBytes = 0;
      this._cachedVramGB = 0;
    }
  }

  _buildGpuModeList(gpuConfig) {
    if (this.gpuPreference === 'cpu') return [false];
    const modes = ['cuda', 'auto'];
    if (gpuConfig.roughMaxLayers > 0) {
      modes.push(gpuConfig.roughMaxLayers);
      // Add partial GPU modes (half layers, quarter layers) for small VRAM GPUs
      const half = Math.floor(gpuConfig.roughMaxLayers / 2);
      const quarter = Math.floor(gpuConfig.roughMaxLayers / 4);
      if (half >= 4) modes.push(half);
      if (quarter >= 4 && quarter !== half) modes.push(quarter);
    }
    modes.push(false); // CPU fallback
    return modes;
  }

  _computeMaxContext(modelSizeGB) {
    const freeRam = os.freemem();
    const kvPerToken = modelSizeGB < 2 ? 0.5 : modelSizeGB < 8 ? 1.0 : 2.0; // KB per token estimate
    const availableForKV = Math.max(0, freeRam - 2 * 1024 ** 3); // reserve 2GB RAM
    const maxFromRam = Math.floor(availableForKV / (kvPerToken * 1024));
    const result = Math.min(CONTEXT_ABSOLUTE_CEILING, Math.max(2048, maxFromRam));
    console.log(`[LLM] _computeMaxContext: modelSize=${modelSizeGB.toFixed(2)}GB, freeRam=${(freeRam / 1024 ** 3).toFixed(1)}GB, kvPerToken=${kvPerToken}KB, availableForKV=${(availableForKV / 1024 ** 3).toFixed(1)}GB, maxFromRam=${maxFromRam}, result=${result}`);
    return result;
  }

  // ─── Generation ───
  async generateStream(input, params = {}, onToken, onThinkingToken) {
    if (!this.isReady || !this.chat) throw new Error('Model not ready');

    // Parse input
    let userMessage, systemContext;
    if (typeof input === 'string') {
      userMessage = input;
    } else {
      userMessage = input.userMessage;
      systemContext = input.systemContext;
    }

    // Update system context if provided and changed
    if (systemContext) {
      const sysEntry = this.chatHistory[0];
      if (!sysEntry || sysEntry.type !== 'system') {
        this.chatHistory.unshift({ type: 'system', text: systemContext });
      } else if (typeof sysEntry.text === 'string' && sysEntry.text !== systemContext) {
        this.chatHistory[0] = { type: 'system', text: systemContext };
      }
    }

    // Add user message to history
    this.chatHistory.push({ type: 'user', text: userMessage });

    // Merge sampling params: defaultParams → modelOverrides → caller params
    const modelOverrides = this._getModelSpecificParams();
    const merged = { ...this.defaultParams, ...modelOverrides, ...params };

    // Setup abort
    this.abortController = new AbortController();
    this._abortReason = null;
    const genId = ++_genCounter;

    // Compact history if too long
    this._compactHistory();

    // Stall watchdog
    let stallTimer = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (_genCounter === genId && this.abortController) {
          console.log(`[LLM] Stall watchdog fired after ${STALL_TIMEOUT_MS / 1000}s — aborting generation`);
          this.cancelGeneration('timeout');
        }
      }, STALL_TIMEOUT_MS);
    };

    // Generation timeout
    let genTimeoutTimer = null;
    if (this.generationTimeoutMs > 0) {
      genTimeoutTimer = setTimeout(() => {
        if (_genCounter === genId && this.abortController) {
          this.cancelGeneration('timeout');
        }
      }, this.generationTimeoutMs);
    }

    let fullResponse = '';
    let toolDetectBuffer = '';
    let detectedToolBlock = null;
    let insideThinkBlock = false;
    let tagBuffer = '';
    let thinkingTokenCount = 0;

    const tryDetectToolBlock = () => {
      // Find last complete fenced JSON block with "tool" key
      const fenceMatch = toolDetectBuffer.match(/```(?:json|tool)?\s*\n(\{[\s\S]*?\})\s*\n```/);
      if (fenceMatch) {
        try {
          const parsed = JSON.parse(fenceMatch[1]);
          if (parsed.tool || parsed.name) return parsed;
        } catch {}
      }
      return null;
    };

    const onResponseChunk = (chunk) => {
      resetStallTimer();

      if (chunk.segmentType === 'thought') {
        // Thinking token from native segmented output
        thinkingTokenCount++;
        if (onThinkingToken) onThinkingToken(chunk.text);
        // Still check for tool calls inside thought blocks
        if (toolDetectBuffer.length < TOOL_DETECT_BUFFER_MAX) {
          toolDetectBuffer += chunk.text;
        }
        return;
      }

      let text = chunk.text;

      // Manual think-tag filtering (for models emitting raw think tags)
      text = text.replace(/<\|?thinking\|?>/gi, '<think>').replace(/<\|?\/?thinking\|?>/gi, (m) => m.includes('/') ? '</think>' : '<think>');

      // Process text character by character for think tag detection
      let outputText = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        tagBuffer += ch;

        if (tagBuffer === '<think>' || tagBuffer.endsWith('<think>')) {
          insideThinkBlock = true;
          tagBuffer = '';
          continue;
        }
        if (tagBuffer === '</think>' || tagBuffer.endsWith('</think>')) {
          insideThinkBlock = false;
          tagBuffer = '';
          continue;
        }

        // Partial tag — keep buffering
        if (tagBuffer.length > 0 && '<think>'.startsWith(tagBuffer)) continue;
        if (tagBuffer.length > 0 && '</think>'.startsWith(tagBuffer)) continue;

        // Not a tag — flush buffer
        if (insideThinkBlock) {
          if (onThinkingToken) onThinkingToken(tagBuffer);
          thinkingTokenCount += tagBuffer.length;
        } else {
          outputText += tagBuffer;
        }
        tagBuffer = '';
      }

      if (outputText) {
        fullResponse += outputText;
        if (onToken) onToken(outputText);
      }

      // Tool detection
      if (toolDetectBuffer.length < TOOL_DETECT_BUFFER_MAX) {
        toolDetectBuffer += outputText;
      }
      const detected = tryDetectToolBlock();
      if (detected) {
        detectedToolBlock = detected;
        fullResponse = toolDetectBuffer.slice(0, toolDetectBuffer.lastIndexOf('```'));
        this.cancelGeneration('tool_call');
      }
    };

    resetStallTimer();

    // Track generation so model-switch can await settlement before disposal
    let resolveGenDone;
    this._activeGenerationPromise = new Promise(r => { resolveGenDone = r; });

    try {
      const result = await this._runGeneration(merged, onResponseChunk);

      // Flush remaining tag buffer
      if (tagBuffer) {
        if (insideThinkBlock) {
          if (onThinkingToken) onThinkingToken(tagBuffer);
        } else {
          fullResponse += tagBuffer;
          if (onToken) onToken(tagBuffer);
        }
        tagBuffer = '';
      }

      // Empty response retry with KV cache cleared
      if (!fullResponse.trim() && this.lastEvaluation) {
        this.lastEvaluation = null;
        this._kvReuseCooldown = KV_REUSE_COOLDOWN_TURNS;
        const retryResult = await this._runGeneration(merged, (chunk) => {
          resetStallTimer();
          fullResponse += chunk.text;
          if (onToken) onToken(chunk.text);
        });
        if (retryResult?.lastEvaluation) {
          this.lastEvaluation = retryResult.lastEvaluation;
          this.chatHistory = retryResult.lastEvaluation.cleanHistory || this.chatHistory;
        }
      } else if (result?.lastEvaluation) {
        this.lastEvaluation = result.lastEvaluation;
        this.chatHistory = result.lastEvaluation.cleanHistory || this.chatHistory;
      }

      if (this._kvReuseCooldown > 0) this._kvReuseCooldown--;

      const sanitized = this._sanitizeResponse(fullResponse);
      // Pass through node-llama-cpp's stopReason when it indicates maxTokens
      let finalStopReason = detectedToolBlock ? 'tool_call' : 'natural';
      if (result?.metadata?.stopReason === 'maxTokens') {
        finalStopReason = 'maxTokens';
        console.log(`[LLM] Generation stopped at maxTokens (${fullResponse.length} chars)`);
      }
      return {
        text: sanitized,
        rawText: fullResponse,
        model: this.modelInfo?.name || 'unknown',
        tokensUsed: this.sequence?.nextTokenIndex || 0,
        contextUsed: this.context?.contextSize || 0,
        stopReason: finalStopReason,
      };
    } catch (err) {
      return this._handleGenerationError(err, fullResponse, detectedToolBlock);
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (genTimeoutTimer) clearTimeout(genTimeoutTimer);
      resolveGenDone();
      this._activeGenerationPromise = null;
    }
  }

  async _runGeneration(params, onResponseChunk) {
    // KV cache reuse
    const useKvCache = this._kvReuseCooldown <= 0 && this.lastEvaluation;

    // EOS-sequence protection: clear sequence if not reusing KV cache
    // v1.8.23 fix: dispose chat FIRST, then sequence, then recreate both
    // (v1.8.22 bug: disposed sequence but LlamaChat still held old reference → "Object is disposed")
    if (!useKvCache && this.sequence && this.sequence.nextTokenIndex > 0) {
      try { this.chat?.dispose?.(); } catch {}
      try { this.sequence.dispose?.(); } catch {}
      this.sequence = this.context.getSequence();
      const llamaCppPath = this._getNodeLlamaCppPath();
      const { LlamaChat } = await import(pathToFileURL(llamaCppPath).href);
      this.chat = new LlamaChat({ contextSequence: this.sequence });
    }

    const thoughtBudget = this.thoughtTokenBudget;
    const budgets = {};
    if (thoughtBudget === -1) budgets.thoughtTokens = Infinity;
    else if (thoughtBudget === 0) budgets.thoughtTokens = 0;
    else budgets.thoughtTokens = thoughtBudget;

    return this.chat.generateResponse(this.chatHistory, {
      maxTokens: params.maxTokens || this.defaultParams.maxTokens,
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      repeatPenalty: {
        penalty: params.repeatPenalty,
        frequencyPenalty: params.frequencyPenalty,
        presencePenalty: params.presencePenalty,
        lastTokens: params.lastTokensPenaltyCount,
      },
      seed: params.seed !== -1 ? params.seed : undefined,
      lastEvaluationContextWindow: useKvCache ? this.lastEvaluation : undefined,
      contextShift: useKvCache ? {
        lastEvaluationContextWindowHistory: this.lastEvaluation?.contextShiftMetadata,
      } : undefined,
      budgets,
      signal: this.abortController?.signal,
      tokenPredictor: this.tokenPredictor,
      onResponseChunk,
    });
  }

  _handleGenerationError(err, fullResponse, detectedToolBlock) {
    const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');

    if (isAbort && this._abortReason === 'tool_call' && detectedToolBlock) {
      // Tool call detected — return the tool block
      const sanitized = this._sanitizeResponse(fullResponse);
      this.chatHistory.push({ type: 'model', response: [sanitized] });
      return {
        text: sanitized,
        rawText: fullResponse,
        model: this.modelInfo?.name || 'unknown',
        tokensUsed: this.sequence?.nextTokenIndex || 0,
        contextUsed: this.context?.contextSize || 0,
        stopReason: 'tool_call',
      };
    }

    if (isAbort && this._abortReason === 'timeout') {
      const partial = fullResponse.trim() || '[Generation timed out — retrying]';
      this.chatHistory.push({ type: 'model', response: [partial] });
      return {
        text: partial,
        rawText: fullResponse,
        model: this.modelInfo?.name || 'unknown',
        tokensUsed: this.sequence?.nextTokenIndex || 0,
        contextUsed: this.context?.contextSize || 0,
        stopReason: 'timeout',
      };
    }

    if (isAbort) {
      const partial = this._sanitizeResponse(fullResponse) || '[Generation cancelled]';
      this.chatHistory.push({ type: 'model', response: [partial] });
      return {
        text: partial,
        rawText: fullResponse,
        model: this.modelInfo?.name || 'unknown',
        tokensUsed: this.sequence?.nextTokenIndex || 0,
        contextUsed: this.context?.contextSize || 0,
        stopReason: 'cancelled',
      };
    }

    // Context overflow detection
    const msg = (err.message || '').toLowerCase();
    console.error(`[LLM] Generation error (non-abort): name=${err.name}, message=${err.message}, stack=${err.stack?.split('\n').slice(0,3).join(' | ')}`);
    if (msg.includes('compress') || msg.includes('context') || msg.includes('too long')) {
      console.error(`[LLM] Treating as CONTEXT_OVERFLOW (matched: ${msg.includes('compress') ? 'compress' : msg.includes('context') ? 'context' : 'too long'})`);
      const summary = this.getConversationSummary();
      this.resetSession(true);
      const overflowErr = new Error(`CONTEXT_OVERFLOW:${summary}`);
      overflowErr.partialResponse = fullResponse;
      throw overflowErr;
    }

    // Log non-abort errors
    const log = require('./logger');
    log.error('Generation error:', {
      name: err.name,
      message: err.message,
      contextDisposed: !this.context || this.context._disposed,
      seqTokens: this.sequence?.nextTokenIndex,
      stack: err.stack?.split('\n').slice(0, 4).join('\n'),
    });
    throw err;
  }

  // ─── One-shot Generation (temp session, no KV pollution) ───
  async generate(prompt, params = {}) {
    if (!this.isReady || !this.context) throw new Error('Model not ready');

    let tempSeq = null;
    let tempChat = null;

    try {
      const llamaCppPath = this._getNodeLlamaCppPath();
      const { LlamaChat } = await import(pathToFileURL(llamaCppPath).href);

      tempSeq = this.context.getSequence();
      tempChat = new LlamaChat({ contextSequence: tempSeq });

      const modelOverrides = this._getModelSpecificParams();
      const merged = { ...this.defaultParams, ...modelOverrides, ...params };

      const history = [
        { type: 'system', text: this._getActiveSystemPrompt() },
        { type: 'user', text: prompt },
      ];

      const result = await tempChat.generateResponse(history, {
        maxTokens: merged.maxTokens,
        temperature: merged.temperature,
        topP: merged.topP,
        topK: merged.topK,
        repeatPenalty: {
          penalty: merged.repeatPenalty,
          frequencyPenalty: merged.frequencyPenalty,
          presencePenalty: merged.presencePenalty,
          lastTokens: merged.lastTokensPenaltyCount,
        },
      });

      const text = this._sanitizeResponse(typeof result === 'string' ? result : (result?.response || ''));
      return { text, model: this.modelInfo?.name || 'unknown', tokensUsed: tempSeq?.nextTokenIndex || 0 };
    } catch (err) {
      // Fallback: use main chat if temp session fails
      if (!tempChat && this.chat) {
        const result = await this.chat.generateResponse(
          [{ type: 'system', text: this._getActiveSystemPrompt() }, { type: 'user', text: prompt }],
          { maxTokens: params.maxTokens || this.defaultParams.maxTokens },
        );
        const text = this._sanitizeResponse(typeof result === 'string' ? result : (result?.response || ''));
        return { text, model: this.modelInfo?.name || 'unknown', tokensUsed: 0 };
      }
      throw err;
    } finally {
      if (tempSeq) {
        try { tempSeq.eraseContextTokenRanges([{ start: 0, end: tempSeq.nextTokenIndex }]); } catch {}
        try { tempSeq.dispose?.(); } catch {}
      }
    }
  }

  // ─── Function Calling ───
  async generateWithFunctions(input, functions, params = {}, onToken, onThinkingToken, onFunctionCall) {
    if (!this.isReady || !this.chat) throw new Error('Model not ready');

    let userMessage;
    if (typeof input === 'string') {
      userMessage = input;
    } else {
      userMessage = input.userMessage;
      if (input.systemContext) {
        const sysEntry = this.chatHistory[0];
        if (sysEntry && sysEntry.type === 'system' && typeof sysEntry.text === 'string' && sysEntry.text !== input.systemContext) {
          this.chatHistory[0] = { type: 'system', text: input.systemContext };
        }
      }
    }

    this.chatHistory.push({ type: 'user', text: userMessage });
    const modelOverrides = this._getModelSpecificParams();
    const merged = { ...this.defaultParams, ...modelOverrides, ...params };

    this.abortController = new AbortController();
    this._abortReason = null;
    const genId = ++_genCounter;

    // Stall watchdog
    let stallTimer = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (_genCounter === genId && this.abortController) {
          console.log(`[LLM] Stall watchdog fired after ${STALL_TIMEOUT_MS / 1000}s — aborting generation (functions mode)`);
          this.cancelGeneration('timeout');
        }
      }, STALL_TIMEOUT_MS);
    };

    const collectedCalls = [];
    let fullResponse = '';
    let thinkingTokenCount = 0;

    resetStallTimer();

    try {
      // KV cache reuse
      const useKvCache = this._kvReuseCooldown <= 0 && this.lastEvaluation;
      // v1.8.23 fix: dispose chat FIRST, then sequence, then recreate both
      // (v1.8.22 bug: disposed sequence but LlamaChat still held old reference → "Object is disposed")
      if (!useKvCache && this.sequence?.nextTokenIndex > 0) {
        try { this.chat?.dispose?.(); } catch {}
        try { this.sequence.dispose?.(); } catch {}
        this.sequence = this.context.getSequence();
        const llamaCppPath = this._getNodeLlamaCppPath();
        const { LlamaChat } = await import(pathToFileURL(llamaCppPath).href);
        this.chat = new LlamaChat({ contextSequence: this.sequence });
      }

      const thoughtBudget = this.thoughtTokenBudget;
      const budgets = {};
      if (thoughtBudget === -1) budgets.thoughtTokens = Infinity;
      else if (thoughtBudget === 0) budgets.thoughtTokens = 0;
      else budgets.thoughtTokens = thoughtBudget;

      const result = await this.chat.generateResponse(this.chatHistory, {
        functions,
        maxParallelFunctionCalls: MAX_PARALLEL_FUNCTION_CALLS,
        maxTokens: merged.maxTokens,
        temperature: merged.temperature,
        topP: merged.topP,
        topK: merged.topK,
        repeatPenalty: {
          penalty: merged.repeatPenalty,
          frequencyPenalty: merged.frequencyPenalty,
          presencePenalty: merged.presencePenalty,
          lastTokens: merged.lastTokensPenaltyCount,
        },
        seed: merged.seed !== -1 ? merged.seed : undefined,
        lastEvaluationContextWindow: useKvCache ? this.lastEvaluation : undefined,
        contextShift: useKvCache ? {
          lastEvaluationContextWindowHistory: this.lastEvaluation?.contextShiftMetadata,
        } : undefined,
        budgets,
        signal: this.abortController?.signal,
        tokenPredictor: this.tokenPredictor,
        onFunctionCall: (call) => {
          resetStallTimer();
          const log = require('./logger');
          log.info(`Function call: ${call.functionName}(${JSON.stringify(call.params)})`);
          collectedCalls.push({ functionName: call.functionName, params: call.params });
          if (onFunctionCall) onFunctionCall(call);
        },
        onFunctionCallParamsChunk: (chunk) => {
          resetStallTimer();
          if (chunk.done && onToken) {
            onToken(JSON.stringify(chunk.params));
          }
        },
        onResponseChunk: (chunk) => {
          resetStallTimer();
          if (chunk.segmentType === 'thought') {
            thinkingTokenCount++;
            if (onThinkingToken) onThinkingToken(chunk.text);
          } else {
            fullResponse += chunk.text;
            if (onToken) onToken(chunk.text);
          }
        },
      });

      // Save KV state
      if (result?.lastEvaluation) {
        this.lastEvaluation = result.lastEvaluation;
        this.chatHistory = result.lastEvaluation.cleanHistory || this.chatHistory;
      }

      if (this._kvReuseCooldown > 0) this._kvReuseCooldown--;

      // Merge function calls from result
      const resultCalls = result?.functionCalls || [];
      for (const rc of resultCalls) {
        const dup = collectedCalls.find(c =>
          c.functionName === rc.functionName && JSON.stringify(c.params) === JSON.stringify(rc.params)
        );
        if (!dup) collectedCalls.push({ functionName: rc.functionName, params: rc.params });
      }

      // Pass through node-llama-cpp's stopReason when it indicates maxTokens
      let finalStopReason = collectedCalls.length > 0 ? 'function_call' : 'natural';
      if (result?.metadata?.stopReason === 'maxTokens') finalStopReason = 'maxTokens';
      return {
        text: this._sanitizeResponse(fullResponse),
        response: fullResponse,
        functionCalls: collectedCalls,
        stopReason: finalStopReason,
      };
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        return {
          text: this._sanitizeResponse(fullResponse) || '[Generation cancelled]',
          response: fullResponse,
          functionCalls: collectedCalls,
          stopReason: this._abortReason === 'timeout' ? 'timeout' : 'cancelled',
        };
      }
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
  }

  // ─── Tool Definition Conversion ───
  static convertToolsToFunctions(toolDefs, filterNames = null) {
    const functions = {};
    for (const tool of toolDefs) {
      if (filterNames && !filterNames.includes(tool.name)) continue;

      const funcDef = { description: tool.description || '' };
      const inputSchema = tool.inputSchema || tool.parameters;

      if (inputSchema && inputSchema.properties) {
        funcDef.params = {};
        for (const [pName, pDef] of Object.entries(inputSchema.properties)) {
          const paramEntry = { description: pDef.description || '' };

          // Map type
          const rawType = pDef.type || 'string';
          if (rawType === 'integer' || rawType === 'number') paramEntry.type = 'number';
          else if (rawType === 'boolean') paramEntry.type = 'boolean';
          else paramEntry.type = 'string';

          if (pDef.enum) paramEntry.enum = pDef.enum;
          if (inputSchema.required && inputSchema.required.includes(pName)) {
            paramEntry.required = true;
          }

          funcDef.params[pName] = paramEntry;
        }
      }

      functions[tool.name] = funcDef;
    }
    return functions;
  }

  // ─── Cancellation ───
  cancelGeneration(reason = 'user') {
    this._abortReason = reason;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ─── Conversation Summary ───
  getConversationSummary() {
    const parts = [];
    const followUps = [];
    const toolNames = new Set();
    const keyResults = [];
    let lastModelResponse = '';

    for (let i = 0; i < this.chatHistory.length; i++) {
      const entry = this.chatHistory[i];
      if (entry.type === 'user' && typeof entry.text === 'string') {
        // Skip injected prompts (tool results, system injections)
        if (!entry.text.startsWith('[Tool result') && !entry.text.startsWith('[System')) {
          if (i === 1) parts.push(`Original request: ${entry.text.slice(0, 200)}`);
          else followUps.push(entry.text.slice(0, 100));
        }
      }
      if (entry.type === 'model' && entry.response) {
        const text = Array.isArray(entry.response) ? entry.response.join('') : String(entry.response);
        lastModelResponse = text.slice(0, 200);

        // Extract tool names
        const toolMatches = text.matchAll(/"tool"\s*:\s*"([^"]+)"/g);
        for (const m of toolMatches) toolNames.add(m[1]);

        // Key result lines
        for (const line of text.split('\n')) {
          if (/\b(OK|FAIL|done|error|Navigated|Page|Edited)\b/i.test(line)) {
            keyResults.push(line.trim().slice(0, 80));
          }
        }
      }
    }

    // Limit follow-ups to last 5 to prevent summary explosion
    if (followUps.length > 0) {
      const recentFollowUps = followUps.slice(-5);
      if (followUps.length > 5) {
        parts.push(`Follow-ups (${followUps.length} total, showing last 5): ${recentFollowUps.join(' | ')}`);
      } else {
        parts.push(`Follow-ups: ${recentFollowUps.join(' | ')}`);
      }
    }
    if (toolNames.size > 0) parts.push(`Tools used: ${[...toolNames].join(', ')}`);
    if (keyResults.length > 0) parts.push(`Key results: ${keyResults.slice(0, 5).join('; ')}`);
    if (lastModelResponse) parts.push(`Last response: ${lastModelResponse}`);
    parts.push(`Total exchanges: ${Math.floor(this.chatHistory.length / 2)}`);

    // Cap total summary length to prevent context overflow
    let summary = parts.join('\n');
    if (summary.length > 1500) {
      summary = summary.slice(0, 1500) + '... (truncated)';
    }
    return summary;
  }

  // ─── Session Management ───
  async resetSession(useCompactPrompt = false) {
    // Wait for any in-flight model load to finish first
    if (this._initializingPromise) {
      try { await this._initializingPromise; } catch {}
    }

    if (!this.model || !this.isReady) {
      throw new Error('Cannot reset session — no model loaded');
    }

    // Check if context is still usable
    if (!this.context || this.context._disposed) {
      this.context = await this.model.createContext({
        contextSize: { min: 2048, max: this._computeMaxContext(0) },
        flashAttention: true,
        ignoreMemorySafetyChecks: !this.modelInfo || this.modelInfo.gpuMode === false,
        failedCreationRemedy: { retries: 8, autoContextSizeShrink: 0.5 },
      });
    }

    // Dispose old chat
    if (this.chat) {
      try { this.chat.dispose?.(); } catch {}
    }

    // Dispose old sequence and get a fresh one (avoids eraseContextTokenRanges hang on degraded KV cache)
    if (this.sequence) {
      try { this.sequence.dispose?.(); } catch {}
      this.sequence = null;
    }
    
    // Try to get a new sequence, with fallback to recreate context if "No sequences left"
    if (this.context) {
      try {
        this.sequence = this.context.getSequence();
      } catch (seqErr) {
        const log = require('./logger');
        log.warn(`getSequence failed: ${seqErr.message} — recreating context`);
        
        // Context is exhausted, recreate it
        try { this.context.dispose?.(); } catch {}
        this.context = await this.model.createContext({
          contextSize: { min: 2048, max: this._computeMaxContext(0) },
          flashAttention: true,
          ignoreMemorySafetyChecks: !this.modelInfo || this.modelInfo.gpuMode === false,
          failedCreationRemedy: { retries: 8, autoContextSizeShrink: 0.5 },
        });
        
        if (this.context) {
          this.sequence = this.context.getSequence();
        }
      }
    }

    if (!this.sequence || this.sequence._disposed) {
      throw new Error('Cannot reset session: sequence unavailable after all fallback attempts');
    }

    const llamaCppPath = this._getNodeLlamaCppPath();
    const { LlamaChat } = await import(pathToFileURL(llamaCppPath).href);
    this.chat = new LlamaChat({ contextSequence: this.sequence });

    const sysPreamble = useCompactPrompt ? this._getCompactSystemPrompt() : this._getActiveSystemPrompt();
    this.chatHistory = [{ type: 'system', text: sysPreamble }];
    this.lastEvaluation = null;
  }

  // ─── Disposal ───
  async dispose() {
    if (this.chat) {
      try { this.chat.dispose?.(); } catch {}
      this.chat = null;
    }
    this.chatHistory = [];
    this.lastEvaluation = null;

    if (this.sequence) {
      try { this.sequence.dispose?.(); } catch {}
      this.sequence = null;
    }

    if (this.context) {
      try {
        await this._withTimeout(Promise.resolve(this.context.dispose?.()), DISPOSE_TIMEOUT, 'Context dispose');
      } catch {}
      this.context = null;
    }

    if (this.model) {
      try {
        await this._withTimeout(Promise.resolve(this.model.dispose?.()), DISPOSE_TIMEOUT, 'Model dispose');
      } catch {}
      this.model = null;
    }

    // Intentionally NOT disposing llamaInstance — reused for CUDA kernel caching
    this.isReady = false;
    this.currentModelPath = null;
    this.modelInfo = null;
    this.tokenPredictor = null;
  }

  // Alias for internal use
  async _dispose() {
    return this.dispose();
  }

  // ─── Status ───
  getStatus() {
    return {
      isReady: this.isReady,
      isLoading: this.isLoading,
      modelInfo: this.modelInfo,
      currentModelPath: this.currentModelPath,
      gpuPreference: this.gpuPreference,
    };
  }

  async getGPUInfo() {
    try {
      const { execSync } = require('child_process');
      const csv = execSync(
        'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
        { timeout: 5000 },
      ).toString().trim();

      const [name, memTotal, memUsed, memFree, utilGpu, temp] = csv.split(',').map(s => s.trim());
      const totalMB = parseFloat(memTotal);
      const usedMB = parseFloat(memUsed);
      const freeMB = parseFloat(memFree);

      this.gpuInfo = {
        name,
        memoryTotal: totalMB,
        memoryUsed: usedMB,
        memoryFree: freeMB,
        memoryTotalGB: totalMB / 1024,
        memoryUsedGB: usedMB / 1024,
        memoryFreeGB: freeMB / 1024,
        usagePercent: (usedMB / totalMB) * 100,
        utilization: parseInt(utilGpu) || 0,
        temperature: parseInt(temp) || 0,
        isActive: true,
        gpuLayers: this.modelInfo?.gpuLayers || 0,
        backend: this.modelInfo?.gpuMode || 'unknown',
      };
      return this.gpuInfo;
    } catch {
      // Return default values instead of null to prevent undefined UI display
      if (!this.gpuInfo) {
        return {
          name: 'Unknown',
          memoryTotal: 0,
          memoryUsed: 0,
          memoryFree: 0,
          memoryTotalGB: 0,
          memoryUsedGB: 0,
          memoryFreeGB: 0,
          usagePercent: 0,
          utilization: 0,
          temperature: 0,
          isActive: false,
          gpuLayers: this.modelInfo?.gpuLayers || 0,
          backend: this.modelInfo?.gpuMode || 'unknown',
        };
      }
      return this.gpuInfo; // Return cached valid value
    }
  }

  setGPUPreference(pref) {
    this.gpuPreference = pref === 'cpu' ? 'cpu' : 'auto';
  }

  setRequireMinContextForGpu(val) {
    this.requireMinContextForGpu = !!val;
  }

  updateParams(params) {
    Object.assign(this.defaultParams, params);
  }

  getModelProfile() {
    const family = this._getModelFamily();
    const paramSize = this._getModelParamSize();
    return getModelProfile(family, paramSize);
  }

  getModelTier() {
    const family = this._getModelFamily();
    const paramSize = this._getModelParamSize();
    const profile = getModelProfile(family, paramSize);
    const tier = getSizeTier(paramSize);

    return {
      tier,
      paramSize,
      family,
      profile,
      maxToolsPerPrompt: profile.generation?.maxToolsPerTurn || 14,
      grammarAlwaysOn: profile.generation?.grammarConstrained || false,
      retryBudget: profile.retry?.maxRetries || 3,
      pruneAggression: tier === 'tiny' ? 'aggressive' : tier === 'small' ? 'standard' : tier === 'medium' ? 'light' : 'none',
    };
  }
}

module.exports = { LLMEngine };
