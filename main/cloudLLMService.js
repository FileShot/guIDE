/**
 * guIDE Cloud LLM Service - Multi-provider cloud API integration
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Supports OpenAI, Anthropic Claude, Google Gemini, xAI Grok, OpenRouter, Cerebras, SambaNova, and APIFreeLLM APIs
 */
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

// Connection pooling: reuse TCP+TLS connections across requests
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 6, timeout: 60000 });

class CloudLLMService extends EventEmitter {
  constructor() {
    super();
    this.apiKeys = {
      graysoft: '',      // GraySoft Cloud (your account JWT token)
      openai: '',
      anthropic: '',
      google: '',
      xai: '',
      openrouter: '',
      groq: '',
      apifreellm: '',
      cerebras: '',
      sambanova: '',
      together: '',
      fireworks: '',
      nvidia: '',
      cohere: '',
      mistral: '',
      huggingface: '',
      cloudflare: '',
      perplexity: '',
      deepseek: '',
      ai21: '',
      deepinfra: '',
      hyperbolic: '',
      novita: '',
      moonshot: '',
      upstage: '',
      lepton: '',
    };
    this.activeProvider = null;
    this.activeModel = 'gpt-oss-120b';  // Default model
    this._openRouterModelsCache = null;
    this._openRouterModelsFetchedAt = 0;
    // Track rate-limited providers with cooldown timestamps
    this._rateLimitedUntil = {}; // { provider: timestamp }
    // Key pools: providers with multiple API keys for rotation (e.g., Cerebras)
    // Format: { provider: [{ key: 'xxx', cooldownUntil: 0 }, ...] }
    this._keyPools = {};
    this._keyPoolIndex = {}; // Round-robin index per provider
    // Adaptive pacing: track recent 429s to recommend execution pace
    this._recent429Timestamps = [];
    // Proactive RPM budget: sliding window of request timestamps per provider
    this._requestTimestamps = {}; // { provider: [timestamp, ...] }
    // Known RPM limits per key per provider (learned from headers or defaults)
    this._providerRPMPerKey = {}; // { provider: number }
    // Default RPM per-key estimates for free tiers
    this._defaultRPMPerKey = {
      groq: 30,       // Confirmed: free tier = 30 RPM/key
      cerebras: 30,   // 30 RPM/key — only gpt-oss-120b is used (GLM removed; lower limit)
      sambanova: 1,   // 20 RPD ≈ trivial
      google: 15,     // Gemini free tier varies
      openrouter: 20, // OpenRouter free models
      openai: 3,      // Free GPT-4o-mini
      anthropic: 5,   // Free tier
      xai: 60,        // Grok free
    };
    // APIFreeLLM: enforce 5s minimum between requests (12 RPM hard limit)
    this._apifreellmLastRequest = 0;
    // Cloudflare needs account ID stored separately
    this._cloudflareAccountId = '';
    // Optional reference to LicenseManager, set after construction via setLicenseManager()
    this._licenseManager = null;
    // Track providers where the user explicitly set their own key (not bundled)
    this._userOwnedProviders = new Set();
    // Ollama local LLM detection state (lazy, cached 30s)
    this._ollamaAvailable = null;
    this._ollamaModels = [];
    this._ollamaLastCheck = 0;
    // Seed bundled keys (free-tier providers only)
    this._seedBundledKeys();
  }

  /** Wire up the LicenseManager so proxy routing can obtain the session token. */
  setLicenseManager(lm) {
    this._licenseManager = lm;
  }

  /**
   * Returns true when a provider is using one of our seeded bundled keys
   * (as opposed to a user-supplied key).
   * Bundled-key requests should route through the guIDE proxy so server-side
   * quotas are enforced.
   */
  _isBundledProvider(provider) {
    // Only route these providers through the proxy — they are the ones with bundled keys.
    return ['groq', 'cerebras', 'sambanova', 'google', 'openrouter'].includes(provider);
  }

  /**
   * Seed obfuscated bundled API keys for free-tier providers.
   * Only sets keys that haven't been explicitly configured by the user.
   * XOR deobfuscation — NOT security, just prevents casual scraping from source.
   * Real security comes from server-side rate limiting and free-tier quotas.
   */
  _seedBundledKeys() {
    const _x = 0x5A;
    const _d = (e) => Buffer.from(Buffer.from(e, 'base64').map(b => b ^ _x)).toString();
    const _bundled = {
      groq:       'PSkxBSo0Fg4QaREdEgstG21qajwdFi9jDR0+IzhpHAMAbTkoChQUHx4vEiMjaRIYMAoKAzIVDWI=',
      cerebras:   'OSkxdzRvNDwuNyNpNz8/OSMqIm8jMDwtLSMxaCwtPi1jLSxiOWI/OWMqLTIxbzQyKGM5NA==',
      sambanova:  'Ozs/Pj9tOG53bmxoP3duaWhqdztrbmx3bTg8OG0+az9jbmlr',
      google:     'GxMgOwkjGDAKAgwSYygiKCBoETssDz4wGxcVKw4WFR0MIxQoFhwD',
      openrouter: 'KTF3NSh3LGt3bm1rP2xjYzs8az4/O2JrOD8+ajs8bm5tOz5ibTg/bWJvY2pvPGlpb2lrPmlpbGJja21pOT5qbjloaTs4Pz48Pg==',
    };
    // All 21 Cerebras keys — 630 RPM combined (21 × 30 RPM/key)
    const _cerebrasPool = [
      'OSkxdzRvNDwuNyNpNz8/OSMqIm8jMDwtLSMxaCwtPi1jLSxiOWI/OWMqLTIxbzQyKGM5NA==',
      'OSkxd2gqNDQtPzdpLixiPDEsaShpYiMoaG8/aTI8b2NjaSNvLDRiI2w/NDRvLC40LCJibw==',
      'OSkxdy45PDwxMm4qLSJjKixoPDE0PjFuPi4saDciKi4qbC5sPzFvPD8uYzkyPyM0OWMyaA==',
      'OSkxdzdsaDwtYi0uPjJsPCJuPD8wMSoiOWIyLjQibCJoPDcuNz40YmI+I2JjaGkjLSMwPw==',
      'OSkxdzkyMTIyMCIqMDI0LippY2JpLjIoaGJvKDEwNG8jLWhvN25iLW8uIjFiPzQ+aCo3Yg==',
      'OSkxd2lsYyg/KGkyaT4wLigjbD5uP2g/LTc5aC4xOSpvMjk+LiI5LCoqKDAwYio3KmwyNA==',
      'OSkxdzwxLG4jaDcxMGJoMiwqPy0iPjkoOTkoKDRjYmJvIyowMGkib24wMi5ibDksaTxuLA==',
      'OSkxd2lpIm5oKDcxKGluaS1uPzdsOTRjPz4iLioxPDxuPzwsLmluPD8tY2MobGgyPzI5Nw==',
      'OSkxd2I0LjA+KGk+Py1pImIqLG8sOSI+Py1jNz9jMTciPD4iKDc3LSM5Ii4/Km8wMDwsaA==',
      'OSkxdzIyPzI0bjRvbzkuLT5sMWljPC40b2g8P25sLS0sbzdsN2IxIjEyPzk5MD83LC1sLg==',
      'OSkxd2w0MjkwYmhibigobDE+NzkwbCNuaCJjMiNsbGJuY2M/LmxjN28jPjw8Kj5jPGM5bg==',
      'OSkxdz4qPygyPiJiLG9uaS05MG5oIz5oby43LGk+Mmk3I2kjPmMuLGw0bGMxOTA5LG4tPw==',
      'OSkxdzlobzQ3PiwuOTQqN283Mi00KjIuKixjMj9pIippIzE+IjQtbGI3IzkjbD8uN28xIg==',
      'OSkxdzdubzxoLSosMWw8OSIxaCMtLjQ+MjEjPj5jbm4yLi5ubzJpYyosaCxoNDE+OS5jMg==',
      'OSkxd2gwKigiaD85LjwxPCguLCxpbC4wLi1jMihoaSIqaTQsPzI0aWg0PjkjP2IxOSJvIg==',
      'OSkxd2ljLDk3NCpsNGg8Yi0+YjIoPDxsPjE+LCIibCo0aCgtMSo3Yj8qPz8/PGNjIj43LQ==',
      'OSkxd29iPC40b2MsKCMxPy4yN24uYipub2wqLGkxYj8yLD8yPz4+bDxpaCM3Kj4sYywjOQ==',
      'OSkxdz5vMSJuMGw0MGw8MD4ybmhsaCM3MWxvLDktKm5uaDxpIio/OTliLG4wLGkwKmkxMg==',
      'OSkxd28qKiIuYiwtYiwtbmhpIjEiMGw3Yz4yPChvYjc+LipuaW40KCI+MTdpbyxjbyhiPw==',
      'OSkxd29oPj83bChubj4oP280MWwqLi0uMTFoLjFvMjw8P2gwIy4iLGIjYmNjbGlpbzAtaA==',
      'OSkxdz8taDkxLm4jbz9jLDluNy0wbDc5OWIyLGwwMm9jKDxvLG4iIypoPC03MSJjND9jMQ==',
    ];
    // All 7 Groq keys — 210 RPM combined (7 × 30 RPM/key)
    const _groqPool = [
      'PSkxBSo0Fg4QaREdEgstG21qajwdFi9jDR0+IzhpHAMAbTkoChQUHx4vEiMjaRIYMAoKAzIVDWI=',
      'PSkxBTZjYhUuGRsRPh0DID5uKj4vMzUwDR0+IzhpHAMMHT0gOGMRKiseLDYQEzYDGCMTLWJqDCM=',
      'PSkxBT8oOW8oFRE+bwkCOTAtCRILPiIUDR0+IzhpHANiFjM3CQAdGxwpKykIEW0YPhYVLhUbNCg=',
      'PSkxBQ1vEBcLK2oUDAoiNgMfag5paTgzDR0+IzhpHAM9DBUiEA0ea2M0IDcuFAgvPiktMQpqbhg=',
      'PSkxBR4rODkuFSkCOABpaxIcHwsCbCovDR0+IzhpHAMWDG4gH20zC2gSaRQiaDgYIGozPTcPCSk=',
      'PSkxBQwiFG5qET0CIG0qEhcJEBkpCms0DR0+IzhpHAMACGgjNRlsLD0yLz41Am1iLSA2HmkWDyk=',
      'PSkxBWwADm0rHhxiEyArIBViKWoRbTUtDR0+IzhpHAM/PDQ9HgorGRU9PRANFQMNFQsebwkjDAM=',
    ];
    try {
      for (const [provider, encoded] of Object.entries(_bundled)) {
        if (!this.apiKeys[provider] || !this.apiKeys[provider].trim()) {
          this.apiKeys[provider] = _d(encoded);
        }
      }
      // Seed Cerebras key pool (always add all — addKeyToPool deduplicates)
      for (const encoded of _cerebrasPool) {
        this.addKeyToPool('cerebras', _d(encoded));
      }
      // Seed Groq key pool (7 keys × 30 RPM = 210 RPM combined)
      for (const encoded of _groqPool) {
        this.addKeyToPool('groq', _d(encoded));
      }
    } catch (e) {
      console.warn('[CloudLLM] Key seed error:', e.message);
    }
  }

  /**
   * Record that an API request was made to a provider.
   * Called from generate() before each LLM call.
   */
  _recordRequest(provider) {
    if (!this._requestTimestamps[provider]) this._requestTimestamps[provider] = [];
    this._requestTimestamps[provider].push(Date.now());
  }

  /**
   * Learn the actual RPM limit from response rate-limit headers.
   * Called after successful API responses.
   */
  _learnRPMFromHeaders(provider, headers) {
    if (!headers) return;
    // Try common header patterns: x-ratelimit-limit-requests, ratelimit-limit, x-ratelimit-limit-requests-minute
    const limitStr = headers['x-ratelimit-limit-requests']
      || headers['ratelimit-limit']
      || headers['x-ratelimit-limit-requests-minute'];
    if (limitStr) {
      const limit = parseInt(limitStr, 10);
      if (limit > 0 && limit < 10000) {
        const prev = this._providerRPMPerKey[provider];
        this._providerRPMPerKey[provider] = limit;
        if (prev !== limit) {
          console.log(`[CloudLLM] Learned ${provider} RPM/key = ${limit} (was ${prev || 'default'})`);
        }
      }
    }
  }

  /**
   * Get the effective RPM limit for a single key of a provider.
   */
  _getPerKeyRPM(provider) {
    return this._providerRPMPerKey[provider]
      || this._defaultRPMPerKey[provider]
      || 30; // Conservative default
  }

  /**
   * Proactive RPM pacer: calculates ms to wait before the next API call
   * to avoid ever hitting a 429. Uses a sliding window of actual request
   * timestamps and the known pool size + per-key RPM.
   *
   * Returns 0 when there's plenty of headroom (feels instant).
   * Returns a delay only when approaching the rate limit ceiling.
   * This is invisible to the user — no UI indicators, just smooth pacing.
   */
  getProactivePaceMs(provider) {
    if (!provider) return 0;
    const now = Date.now();
    const poolSize = this._keyPools[provider]?.length || 1;
    const perKeyRPM = this._getPerKeyRPM(provider);
    const poolRPM = poolSize * perKeyRPM;

    // Sliding window: count requests in the last 60 seconds
    if (!this._requestTimestamps[provider]) this._requestTimestamps[provider] = [];
    const ts = this._requestTimestamps[provider];
    // Prune older than 65s (small buffer beyond the 60s window)
    const cutoff = now - 65000;
    while (ts.length > 0 && ts[0] < cutoff) ts.shift();

    const windowStart = now - 60000;
    const recentCount = ts.filter(t => t > windowStart).length;

    // Target: stay at 85% of pool RPM to leave headroom
    // Guard: ensure safeRPM is at least 1 to avoid division by zero (e.g. SambaNova RPM=1)
    const safeRPM = Math.max(1, Math.floor(poolRPM * 0.85));

    if (recentCount < safeRPM * 0.5) {
      // Under 50% usage — plenty of headroom, no delay
      return 0;
    }

    if (recentCount >= safeRPM) {
      // At or over safe limit — wait for a slot to free up
      const oldestInWindow = ts.find(t => t > windowStart);
      if (oldestInWindow) {
        // Wait until the oldest request exits the 60s window, plus a small buffer
        return Math.max(200, (oldestInWindow + 60000) - now + 200);
      }
      return 2000; // Fallback: 2s wait
    }

    // Between 50-85% — gentle proportional pacing
    const ratio = recentCount / safeRPM;
    // At 50% ratio → 0ms delay, at 85% → full min-interval delay
    const minInterval = Math.ceil(60000 / safeRPM);
    const scaledDelay = Math.round(minInterval * ((ratio - 0.5) / 0.35));
    return Math.max(0, scaledDelay);
  }

  /**
   * Get recommended inter-tool delay based on recent rate limit pressure.
   * Returns ms to wait between tool executions during local-model loops.
   * For cloud models, the proactive pacer handles API-call pacing;
   * this provides a small inter-tool delay so execution is "watchable".
   */
  getRecommendedPaceMs() {
    const now = Date.now();
    this._recent429Timestamps = this._recent429Timestamps.filter(t => t > now - 120000);
    const count = this._recent429Timestamps.length;
    // After a 429, ramp up inter-tool delay as a secondary safety net
    if (count >= 4) return 400;
    if (count >= 2) return 200;
    if (count >= 1) return 100;
    return 50; // Base: 50ms between tools (UI feedback, not rate limiting)
  }

  setApiKey(provider, key) {
    // Cloudflare uses 'accountId:apiToken' format
    if (provider === 'cloudflare' && key && key.includes(':')) {
      const [accountId, token] = key.split(':', 2);
      this._cloudflareAccountId = accountId;
      this.apiKeys[provider] = token;
    } else {
      this.apiKeys[provider] = key;
    }
    // Mark as user-supplied so token cap exemption applies
    if (key && key.trim()) this._userOwnedProviders.add(provider);
  }

  /** True when the user has explicitly configured their own key for this provider. */
  isUsingOwnKey(provider) {
    return this._userOwnedProviders.has(provider);
  }

  /**
   * Detect whether Ollama is running locally on the default port (11434).
   * Result is cached for 30 seconds to avoid hammering localhost on every call.
   * Also caches the list of installed model names.
   */
  detectOllama() {
    const now = Date.now();
    if (now - this._ollamaLastCheck < 30000 && this._ollamaAvailable !== null) {
      return Promise.resolve(this._ollamaAvailable);
    }
    this._ollamaLastCheck = now;
    return new Promise((resolve) => {
      const req = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            this._ollamaModels = (parsed.models || []).map(m => m.name || m.model || '').filter(Boolean);
            this._ollamaAvailable = true;
            console.log(`[CloudLLM] Ollama detected: ${this._ollamaModels.length} model(s)`);
          } catch {
            this._ollamaAvailable = false;
          }
          resolve(this._ollamaAvailable);
        });
      });
      req.on('error', () => { this._ollamaAvailable = false; resolve(false); });
      req.on('timeout', () => { req.destroy(); this._ollamaAvailable = false; resolve(false); });
    });
  }

  /** All installed Ollama model names (from last detectOllama() call). */
  getOllamaModels() { return this._ollamaModels; }

  /** Ollama models that are known to support image input. */
  getOllamaVisionModels() {
    const VL = /llava|bakllava|qwen.*vl|minicpm.*v|moondream|internvl|cogvlm|-vl\b|\.vision\b|vision-/i;
    return this._ollamaModels.filter(m => VL.test(m));
  }

  /**
   * Add a key to the rotation pool for a provider.
   * Multiple keys = automatic round-robin with instant failover on 429.
   */
  addKeyToPool(provider, key) {
    if (!key || !key.trim()) return;
    if (!this._keyPools[provider]) {
      this._keyPools[provider] = [];
      this._keyPoolIndex[provider] = 0;
    }
    // Avoid duplicates
    if (this._keyPools[provider].some(entry => entry.key === key)) return;
    this._keyPools[provider].push({ key, cooldownUntil: 0 });
    // Also set the first key as the default single key
    if (!this.apiKeys[provider] || !this.apiKeys[provider].trim()) {
      this.apiKeys[provider] = key;
    }
    console.log(`[CloudLLM] ${provider} key pool: ${this._keyPools[provider].length} key(s)`);
  }

  /**
   * Get the next available key from the pool for a provider.
   * Returns the key string, or null if all keys are on cooldown.
   * Uses round-robin with cooldown-aware skipping.
   */
  _getPoolKey(provider) {
    const pool = this._keyPools[provider];
    if (!pool || pool.length === 0) return this.apiKeys[provider] || null;

    const now = Date.now();
    const poolSize = pool.length;
    const startIdx = this._keyPoolIndex[provider] || 0;

    // Try each key starting from current index
    for (let i = 0; i < poolSize; i++) {
      const idx = (startIdx + i) % poolSize;
      const entry = pool[idx];
      if (entry.cooldownUntil <= now) {
        // Advance index to next for round-robin
        this._keyPoolIndex[provider] = (idx + 1) % poolSize;
        return entry.key;
      }
    }

    // All keys on cooldown — return the one with shortest remaining cooldown
    const soonest = pool.reduce((best, entry) => entry.cooldownUntil < best.cooldownUntil ? entry : best);
    const waitSec = Math.ceil((soonest.cooldownUntil - now) / 1000);
    console.log(`[CloudLLM] All ${provider} pool keys on cooldown, shortest wait: ${waitSec}s`);
    return null;
  }

  /**
   * Mark a specific key in the pool as rate-limited.
   */
  _cooldownPoolKey(provider, key, durationMs = 60000) {
    const pool = this._keyPools[provider];
    if (!pool) return;
    const entry = pool.find(e => e.key === key);
    if (entry) {
      entry.cooldownUntil = Date.now() + durationMs;
      console.log(`[CloudLLM] ${provider} key ...${key.slice(-6)} on cooldown for ${durationMs / 1000}s`);
    }
  }

  /**
   * Get pool status for a provider (for diagnostics/UI).
   */
  getPoolStatus(provider) {
    const pool = this._keyPools[provider];
    if (!pool || pool.length === 0) return null;
    const now = Date.now();
    return {
      provider,
      totalKeys: pool.length,
      availableKeys: pool.filter(e => e.cooldownUntil <= now).length,
      keys: pool.map((e, i) => ({
        index: i,
        available: e.cooldownUntil <= now,
        cooldownRemaining: Math.max(0, Math.ceil((e.cooldownUntil - now) / 1000)),
      })),
    };
  }

  getConfiguredProviders() {
    return Object.entries(this.apiKeys)
      .filter(([_, key]) => key && key.trim().length > 0)
      .map(([provider]) => ({
        provider,
        label: this._getProviderLabel(provider),
        models: this._getProviderModels(provider),
        isBundled: this._isBundledProvider(provider) && !this.isUsingOwnKey(provider),
      }));
  }

  /** Returns ALL providers (configured and unconfigured) with hasKey flag. */
  getAllProviders() {
    return Object.keys(this.apiKeys).map(provider => ({
      provider,
      label: this._getProviderLabel(provider),
      models: this._getProviderModels(provider),
      hasKey: !!(this.apiKeys[provider] && this.apiKeys[provider].trim().length > 0),
      isBundled: this._isBundledProvider(provider) && !this.isUsingOwnKey(provider),
    }));
  }

  /**
   * Fetch live model catalog from OpenRouter API.
   * Returns categorized models (free first, then paid).
   * Caches for 10 minutes to avoid excessive API calls.
   */
  async fetchOpenRouterModels() {
    // Return cache if fresh (10 min)
    const now = Date.now();
    if (this._openRouterModelsCache && (now - this._openRouterModelsFetchedAt) < 600000) {
      return this._openRouterModelsCache;
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/models',
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'guIDE/1.0',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.data || !Array.isArray(parsed.data)) {
              return reject(new Error('Invalid OpenRouter models response'));
            }

            // Filter to text-capable chat models that support system prompts
            const _blockedModelPatterns = [
              /^google\/gemma-3/i,        // Gemma 3 models: "Developer instruction is not enabled"
              /^google\/gemma-2/i,        // Gemma 2 models: often same issue
              /^google\/gemma3/i,         // alternate naming
            ];
            const textModels = parsed.data.filter(m => {
              // Must support text input and output
              if (!m.architecture?.output_modalities?.includes('text')) return false;
              if (!m.architecture?.input_modalities?.includes('text')) return false;
              // Must have instruct_type (null = no system prompt support)
              if (!m.architecture?.instruct_type && m.architecture?.instruct_type !== undefined) return false;
              // Skip image-only models (e.g. Flux, DALL-E, Riverflow)
              if (m.architecture?.output_modalities?.includes('image') && !m.architecture?.output_modalities?.includes('text')) return false;
              // Must have a reasonable context length
              if ((m.context_length || 0) < 1024) return false;
              // Skip models with known issues: no top_provider or 0 max_completion_tokens
              if (m.top_provider?.max_completion_tokens === 0) return false;
              // Skip models known to not support system/developer instructions
              if (_blockedModelPatterns.some(p => p.test(m.id))) return false;
              return true;
            });

            // Categorize: free vs paid
            const freeModels = [];
            const paidModels = [];

            for (const m of textModels) {
              const promptCost = parseFloat(m.pricing?.prompt || '1');
              const completionCost = parseFloat(m.pricing?.completion || '1');
              const isFree = promptCost === 0 && completionCost === 0;
              const ctx = m.context_length || 0;
              const entry = {
                id: m.id,
                name: m.name || m.id,
                context: ctx,
                free: isFree,
                promptCost,
                completionCost,
              };

              if (isFree) freeModels.push(entry);
              else paidModels.push(entry);
            }

            // Sort: free by context desc, paid by prompt cost asc
            freeModels.sort((a, b) => b.context - a.context);
            paidModels.sort((a, b) => a.promptCost - b.promptCost);

            const result = { free: freeModels, paid: paidModels, total: textModels.length, fetchedAt: now };
            this._openRouterModelsCache = result;
            this._openRouterModelsFetchedAt = now;
            resolve(result);
          } catch (e) {
            reject(new Error('Failed to parse OpenRouter models: ' + e.message));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('OpenRouter models request timed out')); });
      req.end();
    });
  }

  _getProviderLabel(provider) {
    const labels = {
      graysoft: 'GraySoft Cloud (Pro)',
      openai: 'OpenAI',
      anthropic: 'Anthropic (Claude)',
      google: 'Google Gemini (Free)',
      xai: 'xAI (Grok)',
      groq: 'Groq (Free, Ultra-Fast, 1K RPM)',
      openrouter: 'OpenRouter',
      apifreellm: 'APIFreeLLM (Free)',
      cerebras: 'Cerebras (Free, Ultra-Fast)',
      sambanova: 'SambaNova (Free, Fast)',
      together: 'Together.ai',
      fireworks: 'Fireworks.ai',
      nvidia: 'NVIDIA NIM (Free)',
      cohere: 'Cohere (Free)',
      mistral: 'Mistral AI (Free)',
      huggingface: 'HuggingFace (Free)',
      cloudflare: 'Cloudflare AI (Free)',
      perplexity: 'Perplexity AI',
      deepseek: 'DeepSeek',
      ai21: 'AI21 Labs (Jamba)',
      deepinfra: 'DeepInfra',
      hyperbolic: 'Hyperbolic',
      novita: 'Novita AI',
      moonshot: 'Moonshot (Kimi)',
      upstage: 'Upstage (Solar)',
      lepton: 'Lepton AI',
    };
    return labels[provider] || provider;
  }

  _getProviderModels(provider) {
    const models = {
      graysoft: [
        { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Reasoning)' },
        { id: 'qwen-3-235b-a22b-instruct-2507', name: 'Qwen 3 235B MoE (Large)' },
        { id: 'llama3.1-8b', name: 'Llama 3.1 8B (Lightweight)' },
      ],
      openai: [
        { id: 'gpt-4.1', name: 'GPT-4.1 (Newest)' },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini (Newest, Fast)' },
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      ],
      anthropic: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
      ],
      google: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Free, 1M ctx, Default)' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Free, 1M ctx)' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Free, 1M ctx)' },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (Free)' },
        { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite (Free)' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview (Free)' },
      ],
      xai: [
        { id: 'grok-3', name: 'Grok 3' },
        { id: 'grok-3-mini', name: 'Grok 3 Mini' },
      ],
      openrouter: [
        { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)' },
        { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen3 235B (Free)' },
        { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)' },
        { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)' },
        { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1 (Free)' },
      ],
      apifreellm: [
        { id: 'apifreellm', name: 'APIFreeLLM 200B+ (Free)' },
      ],
      groq: [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Free, 12K TPM, Default)' },
        { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B (Free)' },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Free, 30K TPM)' },
        { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 131K (Free, Moonshot AI)' },
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Free)' },
        { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Free, 1000 tps)' },
        { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B (Free)' },
        { id: 'groq/compound', name: 'Groq Compound (Agentic, Tools)' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Free, 14K RPM)' },
      ],
      cerebras: [
        { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Free, Default, 30 RPM/key)' },
        { id: 'qwen-3-235b-a22b-instruct-2507', name: 'Qwen 3 235B MoE (Free)' },
      ],
      sambanova: [
        { id: 'DeepSeek-V3.2', name: 'DeepSeek V3.2 (Free, Newest)' },
        { id: 'DeepSeek-V3.1', name: 'DeepSeek V3.1 (Free)' },
        { id: 'DeepSeek-R1-0528', name: 'DeepSeek R1 Reasoning (Free)' },
        { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (Free)' },
        { id: 'Llama-4-Maverick-17B-128E-Instruct', name: 'Llama 4 Maverick 17B (Free)' },
        { id: 'Qwen3-235B', name: 'Qwen 3 235B (Free)' },
        { id: 'Qwen3-32B', name: 'Qwen 3 32B (Free)' },
        { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Free)' },
        { id: 'MiniMax-M2.5', name: 'MiniMax M2.5 (Free)' },
      ],
      together: [
        { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo' },
        { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', name: 'Llama 3.1 405B Turbo' },
        { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
        { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo' },
        { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', name: 'Mixtral 8x22B' },
        { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B' },
      ],
      fireworks: [
        { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B' },
        { id: 'accounts/fireworks/models/deepseek-r1', name: 'DeepSeek R1' },
        { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', name: 'Qwen 2.5 72B' },
      ],
      nvidia: [
        { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (Free)' },
        { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Free)' },
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B (Free)' },
        { id: 'qwen/qwq-32b', name: 'QWQ 32B Reasoning (Free)' },
      ],
      cohere: [
        { id: 'command-a-03-2025', name: 'Command A (Free, Flagship)' },
        { id: 'command-r-plus', name: 'Command R+ (Free)' },
        { id: 'command-r', name: 'Command R (Free)' },
        { id: 'command-r7b-12-2024', name: 'Command R 7B (Free, Fast)' },
      ],
      mistral: [
        { id: 'mistral-small-latest', name: 'Mistral Small 3.2 (Free)' },
        { id: 'mistral-large-latest', name: 'Mistral Large 3 (Free)' },
        { id: 'magistral-medium-2509', name: 'Magistral Medium 1.2 (Reasoning)' },
        { id: 'magistral-small-2509', name: 'Magistral Small 1.2 (Reasoning)' },
        { id: 'ministral-8b-latest', name: 'Ministral 8B (Free, Fast)' },
        { id: 'devstral-small-latest', name: 'Devstral Small (Code Agents)' },
        { id: 'mistral-nemo', name: 'Mistral Nemo 12B (Free)' },
        { id: 'pixtral-12b-2409', name: 'Pixtral 12B Vision (Free)' },
      ],
      huggingface: [
        { id: 'deepseek-ai/DeepSeek-V3-0324', name: 'DeepSeek V3 (Free)' },
        { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B (Free)' },
        { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (Free)' },
        { id: 'mistralai/Mistral-Small-3.1-24B-Instruct-2503', name: 'Mistral Small 3.1 (Free)' },
      ],
      cloudflare: [
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (Free)' },
        { id: '@cf/qwen/qwq-32b', name: 'QWQ 32B Reasoning (Free)' },
        { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill 32B (Free)' },
        { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1 (Free)' },
        { id: '@cf/google/gemma-3-12b-it', name: 'Gemma 3 12B (Free)' },
      ],
      perplexity: [
        { id: 'sonar-pro', name: 'Sonar Pro (Web Search)' },
        { id: 'sonar', name: 'Sonar (Web Search, Fast)' },
        { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro' },
        { id: 'sonar-reasoning', name: 'Sonar Reasoning' },
        { id: 'r1-1776', name: 'R1-1776 (Offline, No Search)' },
      ],
      deepseek: [
        { id: 'deepseek-chat', name: 'DeepSeek V3 (Flagship)' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoning)' },
      ],
      ai21: [
        { id: 'jamba-2.5', name: 'Jamba 2.5 (256K context)' },
        { id: 'jamba-2.5-mini', name: 'Jamba 2.5 Mini (256K, Fast)' },
      ],
      deepinfra: [
        { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
        { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
        { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (Reasoning)' },
        { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B MoE' },
        { id: 'Qwen/QwQ-32B', name: 'QwQ 32B Reasoning' },
      ],
      hyperbolic: [
        { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
        { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (Reasoning)' },
        { id: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B MoE' },
        { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
      ],
      novita: [
        { id: 'deepseek/deepseek-v3-0324', name: 'DeepSeek V3' },
        { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Reasoning)' },
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
        { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B MoE' },
      ],
      moonshot: [
        { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K' },
        { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K' },
        { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K' },
        { id: 'kimi-k2', name: 'Kimi K2 (Agentic)' },
      ],
      upstage: [
        { id: 'solar-pro2', name: 'Solar Pro 2 (Flagship)' },
        { id: 'solar-mini-ja', name: 'Solar Mini' },
      ],
      lepton: [
        { id: 'llama3-3-70b', name: 'Llama 3.3 70B' },
        { id: 'deepseek-r1', name: 'DeepSeek R1 (Reasoning)' },
        { id: 'qwen3-235b', name: 'Qwen3 235B MoE' },
      ],
    };
    return models[provider] || [];
  }

  _getEndpoint(provider) {
    const endpoints = {
      graysoft: { host: 'pocket.graysoft.dev', path: '/api/v1/chat/completions' },
      openai: { host: 'api.openai.com', path: '/v1/chat/completions' },
      anthropic: { host: 'api.anthropic.com', path: '/v1/messages' },
      google: { host: 'generativelanguage.googleapis.com', path: '/v1beta/openai/chat/completions' },
      xai: { host: 'api.x.ai', path: '/v1/chat/completions' },
      groq: { host: 'api.groq.com', path: '/openai/v1/chat/completions' },
      openrouter: { host: 'openrouter.ai', path: '/api/v1/chat/completions' },
      apifreellm: { host: 'apifreellm.com', path: '/api/v1/chat' },
      cerebras: { host: 'api.cerebras.ai', path: '/v1/chat/completions' },
      sambanova: { host: 'api.sambanova.ai', path: '/v1/chat/completions' },
      together: { host: 'api.together.xyz', path: '/v1/chat/completions' },
      fireworks: { host: 'api.fireworks.ai', path: '/inference/v1/chat/completions' },
      nvidia: { host: 'integrate.api.nvidia.com', path: '/v1/chat/completions' },
      cohere: { host: 'api.cohere.ai', path: '/compatibility/v1/chat/completions' },
      mistral: { host: 'api.mistral.ai', path: '/v1/chat/completions' },
      huggingface: { host: 'router.huggingface.co', path: '/v1/chat/completions' },
      cloudflare: { host: 'api.cloudflare.com', path: `/client/v4/accounts/${this._cloudflareAccountId || 'ACCOUNT_ID'}/ai/v1/chat/completions` },
      perplexity: { host: 'api.perplexity.ai', path: '/chat/completions' },
      deepseek: { host: 'api.deepseek.com', path: '/v1/chat/completions' },
      ai21: { host: 'api.ai21.com', path: '/studio/v1/chat/completions' },
      deepinfra: { host: 'api.deepinfra.com', path: '/v1/openai/chat/completions' },
      hyperbolic: { host: 'api.hyperbolic.xyz', path: '/v1/chat/completions' },
      novita: { host: 'api.novita.ai', path: '/v3/openai/chat/completions' },
      moonshot: { host: 'api.moonshot.cn', path: '/v1/chat/completions' },
      upstage: { host: 'api.upstage.ai', path: '/v1/chat/completions' },
      lepton: { host: 'emc.lepton.run', path: '/api/v1/chat/completions' },
    };
    return endpoints[provider];
  }

  /**
   * Check if a model supports vision (image input)
   */
  _supportsVision(provider, model) {
    // Ollama: vision support depends on which model is loaded
    if (provider === 'ollama') {
      const VL = /llava|bakllava|qwen.*vl|minicpm.*v|moondream|internvl|cogvlm|-vl\b|\.vision\b|vision-/i;
      return VL.test(model);
    }
    // Models known to support vision/multimodal
    const visionModels = {
      openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
      anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
      google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-3-flash-preview'],
      xai: ['grok-3', 'grok-3-mini'],
      // OpenRouter model IDs vary — most major models support vision
      openrouter: ['google/gemini-2.0-flash-exp:free'],
      apifreellm: [], // Unknown
      cerebras: [], // Text-only
      sambanova: [], // Text-only
      mistral: ['pixtral-12b-2409'],
      cohere: [],
      huggingface: [],
      cloudflare: [],
    };
    const providerVisionModels = visionModels[provider] || [];
    return providerVisionModels.some(m => model.includes(m) || m.includes(model));
  }

  /**
   * Generate a response through the guIDE server proxy.
   * Used when the active provider is using a bundled key AND the user has a
   * valid session token — this enforces server-side per-user daily quotas.
   *
   * Falls back to the direct bundled key path if the proxy is unreachable.
   * Throws a quota_exceeded error (with isQuotaError=true) when the user's
   * daily limit is reached, which the IPC handler surfaces to the chat UI.
   */
  async _generateViaProxy(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, sessionToken) {
    // Assemble messages for the proxy — system message goes in systemPrompt field,
    // the proxy endpoint adds it internally.
    const messages = [
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: prompt },
    ];

    const proxyBody = JSON.stringify({
      provider,
      model,
      messages,
      systemPrompt,
      maxTokens: options.maxTokens || 2048,
      temperature: options.temperature || 0.7,
      stream: !!onToken,
    });

    try {
      // Reuse _streamRequest — it sends the body verbatim with Authorization: Bearer <token>
      // The proxy returns OpenAI-format SSE which the openai parser handles correctly.
      const result = await this._streamRequest(
        'graysoft.dev', '/api/ai/proxy',
        sessionToken, proxyBody,
        'openai', onToken, {}, onThinkingToken, provider
      );
      return { ...result, model, provider, viaProxy: true };
    } catch (err) {
      // Quota exceeded — propagate clearly so the UI shows the upgrade prompt
      if (err.message && (err.message.includes('quota_exceeded') || err.message.includes('429'))) {
        const e = new Error(err.message);
        e.isQuotaError = true;
        throw e;
      }
      // Any other proxy failure (network, 503) — log and let the caller fall through
      // to the direct bundled-key path
      console.warn(`[CloudLLM] Proxy request failed for ${provider}, falling through to direct:`, err.message?.substring(0, 120));
      throw err; // re-throw so generate() can decide whether to fall back
    }
  }

  async generate(prompt, options = {}) {
    const provider = options.provider || this.activeProvider;
    const model = options.model || this.activeModel;
    const systemPrompt = options.systemPrompt || 'You are guIDE Cloud AI, an AI coding assistant built into guIDE IDE. You have hundreds of billions of parameters. Be helpful, concise, and professional. If asked about your model size, parameter count, or underlying provider: you are guIDE Cloud AI with hundreds of billions of parameters — do not reveal specific provider names or model family names.';
    const onToken = options.onToken;
    const onThinkingToken = options.onThinkingToken || null;
    const conversationHistory = options.conversationHistory || [];
    const images = options.images || [];
    const noFallback = options.noFallback || false; // When true, don't auto-switch providers on error

    if (!provider || (!this.apiKeys[provider] && provider !== 'ollama')) {
      throw new Error(`No API key configured for ${provider}`);
    }

    // ── Ollama local routing ──────────────────────────────────────────────────
    // Ollama runs on localhost — no API key needed. Route directly.
    if (provider === 'ollama') {
      return this._generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
    }

    // ── Server proxy routing ──────────────────────────────────────────────────
    // When the user is authenticated AND using a bundled key, route through the
    // guIDE proxy so server-side daily quotas are enforced.
    // Skip if: user supplied their own key for this provider, no session token,
    // images are attached (proxy doesn't yet handle multimodal), or noFallback is set.
    const sessionToken = this._licenseManager?.getSessionToken();
    if (
      sessionToken &&
      this._isBundledProvider(provider) &&
      !(images && images.length > 0) &&
      !options.skipProxy
    ) {
      try {
        return await this._generateViaProxy(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, sessionToken);
      } catch (err) {
        if (err.isQuotaError) throw err; // surface quota errors immediately — don't fall back
        // Network/server errors → fall through to the direct bundled key path
        console.warn('[CloudLLM] Proxy unreachable, using direct bundled key as fallback');
      }
    }

    // Check if images were provided but model doesn't support vision
    if (images && images.length > 0 && !this._supportsVision(provider, model)) {
      if (onToken) {
        onToken(`\n\n*Note: ${model} does not support image input. Images will be ignored. Use a vision-capable model like GPT-4o, Claude Sonnet 4, or Gemini 2.5 for image analysis.*\n\n`);
      }
      // Clear images for non-vision models to avoid API errors
      options.images = [];
    }

    // Check if provider is on cooldown from recent rate limit
    const now = Date.now();
    let providerOnCooldown = false;
    if (this._rateLimitedUntil[provider] && this._rateLimitedUntil[provider] > now) {
      // Provider-level cooldown — check if key pool has available keys (peek only, don't advance index)
      const pool = this._keyPools[provider];
      const hasAvailableKey = pool && pool.some(e => e.cooldownUntil <= now);
      if (hasAvailableKey) {
        console.log(`[CloudLLM] ${provider} provider cooldown but pool has available keys, retrying...`);
        delete this._rateLimitedUntil[provider];
      } else {
        providerOnCooldown = true;
        const waitSec = Math.ceil((this._rateLimitedUntil[provider] - now) / 1000);
        console.log(`[CloudLLM] ${provider} on cooldown for ${waitSec}s, skipping to fallback`);
        const _cooldownLabel = (this._isBundledProvider(provider) && !this.isUsingOwnKey(provider)) ? 'guIDE Cloud AI' : this._getProviderLabel(provider);
        if (onToken) onToken(`\n*${_cooldownLabel} on cooldown (${waitSec}s remaining), trying alternatives...*\n`);
        // Fall through to fallback chain — skip pacing and generation
      }
    }

    // Only pace and attempt generation if provider is NOT on full cooldown
    if (!providerOnCooldown) {
      // Proactive pacing: wait if we're approaching the RPM ceiling for this provider
      const proactivePace = this.getProactivePaceMs(provider);
      if (proactivePace > 0) {
        console.log(`[CloudLLM] Proactive pacing: waiting ${proactivePace}ms before ${provider} request (RPM budget management)`);
        await new Promise(r => setTimeout(r, proactivePace));
      }

      // Attempt generation with key pool rotation on 429
      const pool = this._keyPools[provider];
      const maxPoolRetries = pool ? pool.length : 1;

      for (let attempt = 0; attempt < maxPoolRetries; attempt++) {
        // Get the key ONCE per attempt — avoid double-advancing the index
        const attemptKey = this._getPoolKey(provider) || this.apiKeys[provider];
        if (!attemptKey) break; // No keys available

        // Record this request ONLY now that we are actually sending it
        this._recordRequest(provider);

        try {
          return await this._executeGeneration(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images, attemptKey);
        } catch (err) {
          if (err.message && (err.message.includes('429') || err.message.includes('401') || err.message.includes('413') || err.message.toLowerCase().includes('rate limit') || err.message.toLowerCase().includes('unauthorized') || err.message.toLowerCase().includes('too large') || err.message.toLowerCase().includes('tokens per minute'))) {
            // Record rate limit event for adaptive pacing
            this._recent429Timestamps.push(Date.now());
            // Cooldown the specific key that was just used
            this._cooldownPoolKey(provider, attemptKey, 60000);

            if (pool && pool.length > 1 && attempt < maxPoolRetries - 1) {
              console.log(`[CloudLLM] 429 on ${provider} key ...${attemptKey.slice(-6)}, rotating (attempt ${attempt + 2}/${maxPoolRetries})`);
              continue; // Try next key immediately
            }

            // No more pool keys available — apply provider-level cooldown
            this._rateLimitedUntil[provider] = Date.now() + 60000;
            console.log(`[CloudLLM] 429 on ${provider} (all pool keys exhausted), cooldown for 60s`);
            const _rlLabel = (this._isBundledProvider(provider) && !this.isUsingOwnKey(provider)) ? 'guIDE Cloud AI' : this._getProviderLabel(provider);
            if (onToken) onToken(`\n*${_rlLabel} rate limited, trying alternatives...*\n`);
            if (noFallback) {
              throw new Error(`${_rlLabel} rate limited. Please wait a minute or try a different model.`);
            }
            break; // Fall through to provider fallback chain
          } else {
            throw err;
          }
        }
      }
    }

    // Auto-fallback on 429 rate limit (only when noFallback is false)
    // Strategy: If using Google, try other Gemini models first (rate limits are per-model)
    // Then fall back to other free providers
    const fallbackChain = [];

    if (provider === 'google') {
      // Try other Gemini models first — Google rate limits are per-model
      const geminiModels = this._getProviderModels('google').map(m => m.id).filter(m => m !== model);
      for (const altModel of geminiModels) {
        fallbackChain.push({ provider: 'google', model: altModel });
      }
    }

    // Then try other bundled providers in priority order — Cerebras → SambaNova → OpenRouter → Groq → Google last (worst rate limits)
    const PREFERRED_FALLBACK_MODEL = {
      cerebras:   'gpt-oss-120b',
      sambanova:  'Meta-Llama-3.3-70B-Instruct',
      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
      groq:       'llama-3.3-70b-versatile',
      google:     'gemini-2.5-flash',
    };
    const otherProviders = ['cerebras', 'sambanova', 'openrouter', 'groq', 'google', 'nvidia', 'cohere', 'mistral', 'huggingface', 'cloudflare', 'together', 'fireworks']
      .filter(p => p !== provider && this.apiKeys[p] && (!this._rateLimitedUntil[p] || this._rateLimitedUntil[p] <= Date.now()));
    for (const p of otherProviders) {
      const pModel = PREFERRED_FALLBACK_MODEL[p] || this._getProviderModels(p)[0]?.id;
      if (pModel) fallbackChain.push({ provider: p, model: pModel });
    }

    for (const fb of fallbackChain) {
      const fbProvider = fb.provider;
      const fbModel = fb.model;

      // Skip if this provider is on cooldown (but only skip non-Google, since Google is per-model)
      if (fbProvider !== 'google' && this._rateLimitedUntil[fbProvider] && this._rateLimitedUntil[fbProvider] > Date.now()) continue;

      console.log(`[CloudLLM] Falling back to ${fbProvider}/${fbModel}`);
      // Only show fallback message when switching to a DIFFERENT provider (not other Gemini models)
      const isDifferentProvider = fbProvider !== provider;
      if (onToken && isDifferentProvider) {
        const _fbLabel = (this._isBundledProvider(fbProvider) && !this.isUsingOwnKey(fbProvider)) ? 'guIDE Cloud AI' : this._getProviderLabel(fbProvider);
        onToken(`\n\n*Switching to ${_fbLabel}...*\n\n`);
      }

      // No delay between fallbacks — rotate instantly for zero-latency retry
      await new Promise(r => setTimeout(r, 0));

      try {
        const result = await this._executeGeneration(fbProvider, fbModel, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
        result.fallbackUsed = { from: provider, to: fbProvider, model: fbModel };
        return result;
      } catch (fbErr) {
        if (fbErr.message && (fbErr.message.includes('429') || fbErr.message.includes('413') || fbErr.message.toLowerCase().includes('rate limit') || fbErr.message.toLowerCase().includes('too large') || fbErr.message.toLowerCase().includes('tokens per minute'))) {
          this._rateLimitedUntil[fbProvider] = Date.now() + 60000;
          console.log(`[CloudLLM] Fallback ${fbProvider} also rate limited (cooldown 60s), trying next...`);
          continue;
        }
        // Transient errors (500, 503, network) — log and try next fallback instead of aborting
        if (fbErr.message && (fbErr.message.includes('500') || fbErr.message.includes('503') || fbErr.message.includes('timeout') || fbErr.message.includes('ECONNRESET'))) {
          console.log(`[CloudLLM] Fallback ${fbProvider} transient error: ${fbErr.message.substring(0, 100)}, trying next...`);
          continue;
        }
        throw fbErr;
      }
    }
    // All fallbacks exhausted
    throw new Error(`Rate limited on all available providers. Please wait a minute and try again.`);
  }

  _executeGeneration(provider, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images = [], _overrideKey = null) {
    // Ollama has no API key — route before the key check
    if (provider === 'ollama') {
      return this._generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
    }
    // Use override key (from pool rotation in generate), or pool key, or single key
    const apiKey = _overrideKey || this._getPoolKey(provider) || this.apiKeys[provider];
    if (!apiKey) throw new Error(`No API key configured for ${provider}`);

    switch (provider) {
      case 'graysoft':
      case 'openai':
      case 'xai':
      case 'openrouter':
      case 'google':
      case 'cerebras':
      case 'sambanova':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'nvidia':
      case 'cohere':
      case 'mistral':
      case 'huggingface':
      case 'cloudflare':
      case 'perplexity':
      case 'deepseek':
      case 'ai21':
      case 'deepinfra':
      case 'hyperbolic':
      case 'novita':
      case 'moonshot':
      case 'upstage':
      case 'lepton':
        return this._generateOpenAICompatible(provider, apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
      case 'apifreellm':
        return this._generateAPIFreeLLM(apiKey, systemPrompt, prompt, options, onToken, conversationHistory);
      case 'anthropic':
        return this._generateAnthropic(apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory, onThinkingToken, images);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Approximate context window (in tokens) for known cloud models.
   * Used to auto-trim messages before sending, preventing context_length_exceeded 400s.
   */
  _getModelContextLimit(provider, model) {
    const limits = {
      // OpenAI
      'gpt-4.1': 1047576, 'gpt-4.1-mini': 1047576,
      'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
      // Anthropic
      'claude-sonnet-4-20250514': 200000, 'claude-3-5-sonnet-20241022': 200000, 'claude-3-haiku-20240307': 200000,
      // Google
      'gemini-2.5-pro': 1048576, 'gemini-2.5-flash': 1048576, 'gemini-2.0-flash': 1048576,
      'gemini-2.5-flash-lite': 1048576, 'gemini-2.0-flash-lite': 1048576,
      'gemini-3-flash-preview': 1048576,
      // xAI
      'grok-3': 131072, 'grok-3-mini': 131072,
      // Groq
      'llama-3.3-70b-versatile': 32768, 'llama-3.1-8b-instant': 8192,
      'meta-llama/llama-4-maverick-17b-128e-instruct': 131072,
      'meta-llama/llama-4-scout-17b-16e-instruct': 131072,
      'moonshotai/kimi-k2-instruct': 131072,
      'openai/gpt-oss-120b': 32768, 'qwen/qwen3-32b': 32768,
      // Cerebras (only 3 models available as of Feb 2026)
      'gpt-oss-120b': 32768,
      'qwen-3-235b-a22b-instruct-2507': 65536, 'llama3.1-8b': 8192,
      // SambaNova
      'DeepSeek-V3.2': 65536, 'DeepSeek-V3.1': 65536, 'Meta-Llama-3.3-70B-Instruct': 8192,
      'DeepSeek-R1-0528': 65536, 'Qwen3-235B': 32768, 'Qwen3-32B': 32768,
      'Llama-4-Maverick-17B-128E-Instruct': 131072, 'MiniMax-M2.5': 65536,
      // Cohere
      'command-a-03-2025': 256000, 'command-r-plus': 128000, 'command-r': 128000, 'command-r7b-12-2024': 128000,
      // Mistral
      'mistral-small-latest': 32768, 'mistral-large-latest': 131072,
      'ministral-8b-latest': 131072, 'mistral-nemo': 131072, 'pixtral-12b-2409': 131072,
      // Perplexity
      'sonar-pro': 127072, 'sonar': 127072, 'sonar-reasoning-pro': 127072, 'sonar-reasoning': 127072, 'r1-1776': 128000,
      // DeepSeek
      'deepseek-chat': 65536, 'deepseek-reasoner': 65536,
      // AI21
      'jamba-2.5': 262144, 'jamba-2.5-mini': 262144,
      // DeepInfra / Hyperbolic / Novita (model IDs vary, defaults fine)
      // Moonshot
      'moonshot-v1-8k': 8192, 'moonshot-v1-32k': 32768, 'moonshot-v1-128k': 131072, 'kimi-k2': 131072,
      // Upstage
      'solar-pro2': 32768, 'solar-mini-ja': 32768,
    };
    return limits[model] || 32768; // Safe default for unknown models
  }

  /**
   * Auto-trim conversation history to stay within model context window.
   * This is a LAST-RESORT safety net — the ConversationSummarizer in agenticChat.js
   * handles intelligent summarization first. This only fires if the summarized messages
   * STILL exceed the model's hard context limit (e.g. user picks a tiny 8K model).
   * Removes oldest messages first, always keeping system prompt and current user message.
   */
  _trimToContextLimit(messages, provider, model, maxTokens) {
    const contextLimit = this._getModelContextLimit(provider, model);
    const reserveForOutput = maxTokens || 2048;
    const budgetChars = (contextLimit - reserveForOutput) * 3.5; // ~3.5 chars per token (conservative)
    if (budgetChars <= 0) return messages;

    let totalChars = 0;
    for (const m of messages) {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      totalChars += content.length;
    }

    if (totalChars <= budgetChars) return messages; // Fits fine

    // Keep system (first) and user (last), trim conversation history from oldest
    const system = messages[0];
    const user = messages[messages.length - 1];
    const middle = messages.slice(1, -1);

    const systemLen = (typeof system.content === 'string' ? system.content : JSON.stringify(system.content)).length;
    const userLen = (typeof user.content === 'string' ? user.content : JSON.stringify(user.content)).length;
    let remaining = budgetChars - systemLen - userLen;

    // Keep recent messages, drop oldest
    const kept = [];
    for (let i = middle.length - 1; i >= 0; i--) {
      const content = typeof middle[i].content === 'string' ? middle[i].content : JSON.stringify(middle[i].content);
      if (remaining - content.length > 0) {
        kept.unshift(middle[i]);
        remaining -= content.length;
      } else {
        break; // Can't fit any more
      }
    }

    const trimmed = middle.length - kept.length;
    if (trimmed > 0) {
      console.log(`[CloudLLM] Auto-trimmed ${trimmed} oldest messages to fit ${model} context (${contextLimit} tokens)`);
    }
    return [system, ...kept, user];
  }

  async _generateOpenAICompatible(provider, apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = []) {
    const endpoint = this._getEndpoint(provider);
    let messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
    ];

    // Build user message — with or without images (vision)
    if (images && images.length > 0) {
      const userContent = [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: img.data.startsWith('data:') ? img.data : `data:${img.mimeType || 'image/png'};base64,${img.data}` },
        })),
      ];
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    // Auto-trim to stay within model context window — prevents 400 context_length_exceeded
    messages = this._trimToContextLimit(messages, provider, model, options.maxTokens);

    const body = JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages,
      max_tokens: options.maxTokens || 2048,
      temperature: options.temperature || 0.7,
      stream: !!onToken,
    });

    if (onToken) {
      return this._streamRequest(endpoint.host, endpoint.path, apiKey, body, 'openai', onToken, {}, onThinkingToken, provider);
    }

    const data = await this._makeRequest(endpoint.host, endpoint.path, apiKey, body, {}, provider);
    try {
      const parsed = JSON.parse(data);
      return {
        text: parsed.choices?.[0]?.message?.content || '',
        model: parsed.model || model,
        tokensUsed: parsed.usage?.total_tokens || 0,
      };
    } catch (parseErr) {
      throw new Error(`Invalid JSON response from ${provider}: ${String(data).substring(0, 200)}`);
    }
  }

  /**
   * Ollama local LLM — calls http://localhost:11434/api/chat (NDJSON streaming).
   * Supports vision models (LLaVA, Qwen2-VL, etc.) by embedding base64 images directly
   * in the user message. Zero install overhead: Ollama is already on the user's machine.
   */
  async _generateOllama(model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = []) {
    const maxTokens = options.maxTokens || 4096;
    const temperature = options.temperature ?? 0.7;

    // Build messages — Ollama format mirrors OpenAI
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const h of conversationHistory) {
      messages.push({ role: h.role, content: h.content });
    }

    // Last user message — attach base64 images if present (strip data URL prefix)
    const userMsg = { role: 'user', content: prompt };
    if (images && images.length > 0) {
      userMsg.images = images.map(img => {
        // Accept { data: 'data:image/jpeg;base64,...' }, plain base64, or dataUrl string
        const src = typeof img === 'string' ? img : (img.data || img.dataUrl || '');
        const b64Match = src.match(/^data:[^;]+;base64,(.+)$/);
        return b64Match ? b64Match[1] : src;
      }).filter(Boolean);
    }
    messages.push(userMsg);

    const body = JSON.stringify({
      model,
      messages,
      stream: !!onToken,
      options: { temperature, num_predict: maxTokens },
    });

    return new Promise((resolve, reject) => {
      const postOptions = {
        hostname: 'localhost',
        port: 11434,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000,
      };

      let fullText = '';
      const req = http.request(postOptions, (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', c => errBody += c);
          res.on('end', () => reject(new Error(`Ollama ${res.statusCode}: ${errBody.substring(0, 200)}`)));
          return;
        }

        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop(); // keep incomplete line in buffer
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              const token = obj?.message?.content || '';
              if (token) {
                fullText += token;
                if (onToken) onToken(token);
              }
              if (obj.done) {
                resolve({ text: fullText, model, provider: 'ollama', tokensUsed: Math.ceil(fullText.length / 4) });
              }
            } catch { /* skip malformed lines */ }
          }
        });
        res.on('end', () => {
          // Flush any remaining buffer
          if (buf.trim()) {
            try {
              const obj = JSON.parse(buf);
              const token = obj?.message?.content || '';
              if (token) { fullText += token; if (onToken) onToken(token); }
            } catch { /* ignore */ }
          }
          resolve({ text: fullText, model, provider: 'ollama', tokensUsed: Math.ceil(fullText.length / 4) });
        });
        res.on('error', reject);
      });

      req.on('error', (err) => reject(new Error(`Ollama connection failed: ${err.message}. Is Ollama running? (ollama serve)`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timed out after 120s')); });
      req.write(body);
      req.end();
    });
  }

  async _generateAnthropic(apiKey, model, systemPrompt, prompt, options, onToken, conversationHistory = [], onThinkingToken = null, images = []) {
    const endpoint = this._getEndpoint('anthropic');
    const messages = [
      ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
    ];

    // Build user message — with or without images (vision)
    if (images && images.length > 0) {
      const userContent = [
        ...images.map(img => {
          // Strip data: prefix for Anthropic format
          let base64Data = img.data;
          let mediaType = img.mimeType || 'image/png';
          if (base64Data.startsWith('data:')) {
            const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) { mediaType = match[1]; base64Data = match[2]; }
          }
          return {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          };
        }),
        { type: 'text', text: prompt },
      ];
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: prompt });
    }
    const body = JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: options.maxTokens || 2048,
      system: systemPrompt,
      messages,
      stream: !!onToken,
    });

    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };

    if (onToken) {
      return this._streamRequest(endpoint.host, endpoint.path, apiKey, body, 'anthropic', onToken, headers, onThinkingToken, 'anthropic');
    }

    const data = await this._makeRequest(endpoint.host, endpoint.path, apiKey, body, headers, 'anthropic');
    try {
      const parsed = JSON.parse(data);
      const text = parsed.content?.map(b => b.text).join('') || '';
      return {
        text,
        model: parsed.model || model,
        tokensUsed: (parsed.usage?.input_tokens || 0) + (parsed.usage?.output_tokens || 0),
      };
    } catch (parseErr) {
      throw new Error(`Invalid JSON response from anthropic: ${String(data).substring(0, 200)}`);
    }
  }

  /**
   * APIFreeLLM — custom non-OpenAI format
   * POST https://apifreellm.com/api/v1/chat
   * Body: { message: "..." }
   * Response: { success: true, response: "..." }
   */
  async _generateAPIFreeLLM(apiKey, systemPrompt, prompt, options, onToken, conversationHistory = []) {
    // Enforce 5-second minimum gap between requests (12 RPM hard limit)
    const now = Date.now();
    const elapsed = now - this._apifreellmLastRequest;
    if (elapsed < 5000) {
      const waitMs = 5000 - elapsed;
      console.log(`[CloudLLM] APIFreeLLM throttle: waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    this._apifreellmLastRequest = Date.now();

    const endpoint = this._getEndpoint('apifreellm');

    // APIFreeLLM takes a single `message` field — pack system + history + user prompt into it
    let fullMessage = '';
    if (systemPrompt) {
      fullMessage += `[System: ${systemPrompt}]\n\n`;
    }
    if (conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        fullMessage += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n\n`;
      }
    }
    fullMessage += `User: ${prompt}`;

    const body = JSON.stringify({
      message: fullMessage,
      model: 'apifreellm',
    });

    try {
      const data = await this._makeRequest(endpoint.host, endpoint.path, apiKey, body, {}, 'apifreellm');
      const parsed = JSON.parse(data);

      if (!parsed.success) {
        throw new Error(parsed.error || 'APIFreeLLM returned an error');
      }

      const text = parsed.response || '';

      // Simulate streaming by emitting tokens in chunks (API doesn't support real streaming)
      if (onToken && text) {
        const words = text.split(' ');
        for (const word of words) {
          onToken(word + ' ');
        }
      }

      return {
        text,
        model: 'APIFreeLLM 200B+',
        tokensUsed: Math.ceil(text.length / 4),
      };
    } catch (error) {
      // Handle rate limiting (5s delay for free tier)
      if (error.message && error.message.includes('429')) {
        throw new Error('APIFreeLLM rate limit — free tier allows 1 request every 5 seconds. Please wait and retry.');
      }
      throw error;
    }
  }

  _makeRequest(host, path, apiKey, body, extraHeaders = {}, provider = null) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      };
      if (apiKey && !extraHeaders['x-api-key']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const req = https.request({ host, path, method: 'POST', headers, agent: keepAliveAgent }, (res) => {
        // Learn RPM limits from response headers on success
        if (provider && res.statusCode < 400) {
          this._learnRPMFromHeaders(provider, res.headers);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            // Parse and provide cleaner error messages
            try {
              const errObj = JSON.parse(data);
              const errMsg = errObj?.error?.message || errObj?.error || data.substring(0, 300);
              const code = errObj?.error?.code || res.statusCode;
              // BUG-013: Log ALL API errors at [CloudLLM] level (not just 429s)
              if (code !== 429) {
                console.error(`[CloudLLM] API error from ${provider || host}: HTTP ${res.statusCode} / code=${code} — ${String(errMsg).substring(0, 200)}`);
              }
              if (code === 429) {
                reject(new Error(`Rate limited (429). Free model quota exhausted. Try switching to a different model or wait a few minutes.`));
              } else if (code === 404) {
                reject(new Error(`Model not found (404). It may have been removed or renamed. Try a different model.`));
              } else if (code === 400 && String(errMsg).toLowerCase().includes('decommission')) {
                reject(new Error(`This model has been decommissioned. Please select a different model.`));
              } else if (code === 400 && (String(errMsg).includes('not enabled') || String(errMsg).toLowerCase().includes('developer instruction'))) {
                reject(new Error(`Model error (400): ${errMsg}. This model doesn't support system prompts. Try a different model.`));
              } else {
                reject(new Error(`API error ${code}: ${errMsg}`));
              }
            } catch {
              console.error(`[CloudLLM] API error from ${provider || host}: HTTP ${res.statusCode} — ${data.substring(0, 200)}`);
              reject(new Error(`API error ${res.statusCode}: ${data.substring(0, 300)}`));
            }
          } else {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error(`Request timeout to ${host}. Try again or switch models.`));
      });
      req.write(body);
      req.end();
    });
  }

  _streamRequest(host, path, apiKey, body, format, onToken, extraHeaders = {}, onThinkingToken = null, provider = null) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      };
      if (apiKey && !extraHeaders['x-api-key']) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      let fullText = '';
      const STREAM_TIMEOUT = 20000; // 20 second timeout for first data
      const IDLE_TIMEOUT = 10000; // 10 second timeout between data chunks

      const doRequest = () => {
      let firstDataTimer = null;
      let idleTimer = null;

      const clearTimers = () => {
        if (firstDataTimer) { clearTimeout(firstDataTimer); firstDataTimer = null; }
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      };

      const req = https.request({ host, path, method: 'POST', headers, agent: keepAliveAgent }, (res) => {
        // Learn RPM limits from response headers on success
        if (provider && res.statusCode < 400) {
          this._learnRPMFromHeaders(provider, res.headers);
        }
        if (res.statusCode >= 400) {
          clearTimers();
          let errData = '';
          res.on('data', chunk => errData += chunk);
          res.on('end', () => {
            // Parse error for better messages
            let errMsg = `API error ${res.statusCode}: ${errData.substring(0, 500)}`;
            try {
              const errObj = JSON.parse(errData);
              const msg = errObj?.error?.message || errObj?.error || errData.substring(0, 300);
              if (res.statusCode === 429) {
                // Throw immediately — pool rotation in generate() will swap to the next key.
                // Never retry within _streamRequest: that delays key rotation and leaks
                // rate-limit messages into the chat stream via onToken.
                errMsg = `Rate limited (429). Pool rotation will handle this.`;
              } else if (res.statusCode === 400) {
                if (String(msg).toLowerCase().includes('decommission')) {
                  errMsg = `This model has been decommissioned. Please select a different model.`;
                } else if (String(msg).toLowerCase().includes('not enabled') || String(msg).toLowerCase().includes('developer instruction')) {
                  errMsg = `This model doesn't support system/developer prompts. Try a different model.`;
                } else {
                  errMsg = `Model error (400): ${msg}`;
                }
              } else if (res.statusCode === 404) {
                errMsg = `Model not found (404). It may have been removed or renamed. Try a different model.`;
              } else {
                errMsg = `API error ${res.statusCode}: ${msg}`;
              }
            } catch {}
            reject(new Error(errMsg));
          });
          return;
        }

        let buffer = '';
        let gotFirstData = false;

        // Timeout if no data at all within STREAM_TIMEOUT
        firstDataTimer = setTimeout(() => {
          console.error(`[CloudLLM] Stream timeout: no data received within ${STREAM_TIMEOUT/1000}s from ${host}`);
          clearTimers();
          req.destroy();
          reject(new Error(`No response from ${host} within ${STREAM_TIMEOUT/1000}s. The model may be overloaded. Try again or switch models.`));
        }, STREAM_TIMEOUT);

        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            console.error(`[CloudLLM] Stream idle timeout: no data for ${IDLE_TIMEOUT/1000}s from ${host}`);
            clearTimers();
            req.destroy();
            if (fullText) {
              resolve({ text: fullText, model: 'cloud', tokensUsed: fullText.length / 4 });
            } else {
              reject(new Error(`Stream stalled from ${host}. Try again or switch models.`));
            }
          }, IDLE_TIMEOUT);
        };

        res.on('data', (chunk) => {
          if (!gotFirstData) {
            gotFirstData = true;
            if (firstDataTimer) { clearTimeout(firstDataTimer); firstDataTimer = null; }
          }
          resetIdleTimer();

          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              let token = '';
              let thinkingToken = '';

              if (format === 'openai') {
                const delta = parsed.choices?.[0]?.delta;
                token = delta?.content || '';
                thinkingToken = delta?.reasoning_content || delta?.reasoning || '';
              } else if (format === 'anthropic') {
                if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking') {
                  // Anthropic thinking block start — no content yet
                } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
                  thinkingToken = parsed.delta?.thinking || '';
                } else if (parsed.type === 'content_block_delta') {
                  // Text delta (must check after thinking_delta to avoid consuming thinking tokens)
                  token = parsed.delta?.text || '';
                }
              }

              if (thinkingToken && onThinkingToken) {
                onThinkingToken(thinkingToken);
              }
              if (token) {
                fullText += token;
                onToken(token);
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        });

        res.on('end', () => {
          clearTimers();
          resolve({ text: fullText, model: 'cloud', tokensUsed: fullText.length / 4 });
        });
      });

      req.on('error', (err) => {
        clearTimers();
        reject(err);
      });
      req.setTimeout(STREAM_TIMEOUT, () => {
        console.error(`[CloudLLM] Socket timeout from ${host}`);
        clearTimers();
        req.destroy();
        reject(new Error(`Connection timeout to ${host}. Try again or switch models.`));
      });
      req.write(body);
      req.end();
      }; // end doRequest

      doRequest();
    });
  }

  getStatus() {
    const configured = this.getConfiguredProviders();
    return {
      hasKeys: configured.length > 0,
      providers: configured.map(p => p.provider),
      activeProvider: this.activeProvider,
      activeModel: this.activeModel,
    };
  }
}

module.exports = { CloudLLMService };
