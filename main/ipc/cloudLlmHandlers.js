/**
 * IPC Handlers: Cloud LLM API
 */
const { ipcMain } = require('electron');
const path = require('path');
const fsSync = require('fs');

function register(ctx) {
  const classifyError = (err) => {
    const msg = String(err?.message || err || 'Unknown error');
    const lower = msg.toLowerCase();

    if (lower.includes('rate limit') || msg.includes('429')) {
      return { category: 'rate_limited', message: msg };
    }
    if (lower.includes('no api key configured')) {
      return { category: 'missing_key', message: msg };
    }
    const m = msg.match(/API error\s+(\d+)/i);
    if (m) {
      const code = Number(m[1]);
      if (code === 401 || code === 403) return { category: 'auth', message: msg, code };
      if (code === 404) return { category: 'model_not_found', message: msg, code };
      return { category: 'api_error', message: msg, code };
    }
    if (lower.includes('timeout')) return { category: 'timeout', message: msg };
    return { category: 'error', message: msg };
  };

  const doTestKey = async (provider, model) => {
    const all = ctx.cloudLLM.getAllProviders();
    const prov = all.find(p => p.provider === provider);
    const modelId = model || prov?.models?.[0]?.id;
    if (!provider) return { success: false, error: 'No provider specified' };
    if (!modelId) return { success: false, provider, error: `No model available for ${provider}` };

    const t0 = Date.now();
    const result = await ctx.cloudLLM.generate('Reply with exactly: OK', {
      provider,
      model: modelId,
      maxTokens: 8,
      temperature: 0,
      noFallback: true,
      systemPrompt: 'You are a connectivity test. Reply with exactly: OK',
    });
    const latencyMs = Date.now() - t0;
    return {
      success: true,
      provider,
      model: modelId,
      latencyMs,
      tokensUsed: result?.tokensUsed || 0,
      text: String(result?.text || '').trim().slice(0, 120),
    };
  };

  ipcMain.handle('cloud-llm-set-key', (_, provider, key) => {
    ctx.cloudLLM.setApiKey(provider, key);
    const configPath = path.join(ctx.userDataPath || ctx.appBasePath, '.guide-config.json');
    let config = {};
    try { config = JSON.parse(fsSync.readFileSync(configPath, 'utf8')); } catch (_) {}
    if (!config.apiKeys) config.apiKeys = {};
    config.apiKeys[provider] = ctx.encryptApiKey(key);
    try { fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch (e) { console.error('Failed to save config:', e); }
    return { success: true };
  });

  ipcMain.handle('cloud-llm-get-providers', () => ctx.cloudLLM.getConfiguredProviders());
  ipcMain.handle('cloud-llm-get-all-providers', () => ctx.cloudLLM.getAllProviders());
  ipcMain.handle('cloud-llm-get-status', () => ctx.cloudLLM.getStatus());

  ipcMain.handle('cloud-llm-fetch-openrouter-models', async () => {
    try {
      const models = await ctx.cloudLLM.fetchOpenRouterModels();
      return { success: true, ...models };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('cloud-llm-test-key', async (_, provider, model) => {
    try {
      return await doTestKey(provider, model);
    } catch (e) {
      const info = classifyError(e);
      return { success: false, provider, model, ...info };
    }
  });

  ipcMain.handle('cloud-llm-test-all-configured-keys', async () => {
    const configured = ctx.cloudLLM.getConfiguredProviders();
    const results = [];
    for (const p of configured) {
      const provider = p.provider;
      const model = p.models?.[0]?.id;
      if (!model) {
        results.push({ success: false, provider, category: 'no_models', message: 'No models listed for provider' });
        continue;
      }
      // Small gap between providers to avoid bursty rate limits.
      await new Promise(r => setTimeout(r, Math.max(250, ctx.cloudLLM.getRecommendedPaceMs?.() || 250)));
      try {
        results.push(await doTestKey(provider, model));
      } catch (e) {
        const info = classifyError(e);
        results.push({ success: false, provider, model, ...info });
      }
    }
    return { success: true, results };
  });

  ipcMain.handle('cloud-llm-generate', async (_, prompt, options) => {
    const access = ctx.licenseManager.checkAccess();
    if (!access.allowed) {
      return { success: false, error: '__LICENSE_BLOCKED__', reason: access.reason };
    }
    try {
      const win = ctx.getMainWindow();
      const result = await ctx.cloudLLM.generate(prompt, {
        ...options,
        onToken: options?.stream ? (token) => {
          if (win) win.webContents.send('llm-token', token);
        } : undefined,
        onThinkingToken: options?.stream ? (token) => {
          if (win) win.webContents.send('llm-thinking-token', token);
        } : undefined,
      });
      return { success: true, ...result };
    } catch (error) {
      // Quota exceeded — surface a clear upgrade prompt instead of a raw error
      if (error.isQuotaError || error.message?.includes('quota_exceeded')) {
        const msg = error.message?.replace('quota_exceeded\n', '').trim()
          || "You've reached your free daily guIDE Cloud AI limit.\n\nTo continue:\n\u2022 **Upgrade** for more cloud requests \u2192 graysoft.dev/account\n\u2022 **Load a local model** — download a free GGUF model from Quick Add (no limits, works offline)\n\u2022 **Add your own API keys** in Settings \u2192 Cloud Providers";
        return { success: false, error: msg, isQuotaError: true };
      }
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
