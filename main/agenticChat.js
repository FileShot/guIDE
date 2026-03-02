/**
 * Agentic AI Chat Handler — the core conversational loop with RAG, MCP tools, memory, and browser automation.
 * Also contains the find-bug analysis handler.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fsSync = require('fs');
const { pathToFileURL } = require('url');
const {
  autoSnapshotAfterBrowserAction,
  sendToolExecutionEvents,
  capArray,
  createIpcTokenBatcher,
  enrichErrorFeedback,
  pruneCloudHistory,
  evaluateResponse,
  getProgressiveTools,
  classifyResponseFailure,
  progressiveContextCompaction,
} = require('./agenticChatHelpers');
const { LLMEngine } = require('./llmEngine');
const { repairToolCalls: repairToolCallsFn } = require('./tools/mcpToolParser');

/**
 * Get the path to node-llama-cpp that works in both dev and production (asar).
 * In production, native modules are unpacked to app.asar.unpacked/node_modules/
 */
function getNodeLlamaCppPath() {
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

function register(ctx) {
  // Destructure services (they don't change after creation)
  const { llmEngine, cloudLLM, mcpToolServer, playwrightBrowser, browserManager, ragEngine, memoryStore, webSearch, licenseManager, ConversationSummarizer, DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE } = ctx;
  const _truncateResult = ctx._truncateResult;
  const _readConfig = ctx._readConfig;
  
  // Pre-require constant dependencies (avoid per-message require overhead)
  const { ImageGenerationService } = require('./imageGenerationService');
  
  // Token telemetry tracking (cumulative across session)
  let _sessionTokensUsed = 0;
  let _sessionRequestCount = 0;
  const _reportTokenStats = (tokensUsed, mainWindow) => {
    _sessionTokensUsed += tokensUsed || 0;
    _sessionRequestCount++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('token-stats', {
        sessionTokens: _sessionTokensUsed,
        requestCount: _sessionRequestCount,
        lastRequestTokens: tokensUsed || 0
      });
    }
  };
  
  // Instruction file cache (per-project, avoids sync FS on every message)
  let _instructionCache = null;
  let _instructionCacheProject = null;

  // Active request tracking — used to cancel stale loops when a new message arrives
  let _activeRequestId = 0;

  // Pause/resume support for live takeover
  let _isPaused = false;
  let _pauseResolve = null; // resolve function to continue when resumed
  
  const waitWhilePaused = async () => {
    while (_isPaused) {
      await new Promise(resolve => {
        _pauseResolve = resolve;
      });
    }
  };
  
  // IPC handlers for pause/resume
  ipcMain.handle('agent-pause', async () => {
    _isPaused = true;
    const mainWindow = ctx.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-paused', true);
    }
    return { success: true, paused: true };
  });
  
  ipcMain.handle('agent-resume', async () => {
    _isPaused = false;
    if (_pauseResolve) {
      _pauseResolve();
      _pauseResolve = null;
    }
    const mainWindow = ctx.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-paused', false);
    }
    return { success: true, paused: false };
  });

  ipcMain.handle('ai-chat', async (_, message, context) => {
    const mainWindow = ctx.getMainWindow();
    const MAX_AGENTIC_ITERATIONS = context?.maxIterations || _readConfig()?.userSettings?.maxAgenticIterations || 100; // Default 100; overridable via Settings UI
    const STUCK_THRESHOLD = 3; // Same tool+params repeated this many times = stuck
    const CYCLE_MIN_REPEATS = 3; // A 2-4 tool cycle must repeat this many times to be flagged
    let _completenessCheckedFiles = null; // One-shot guard for post-write completeness checks
    
    // Cancel any running agentic loop from a previous message
    const prevId = _activeRequestId;
    _activeRequestId++;
    const myRequestId = _activeRequestId;
    
    // If a previous request was running, abort its generation and signal cancellation
    if (prevId > 0) {
      ctx.agenticCancelled = true; // Signal old loop to stop
      try { llmEngine.cancelGeneration(); } catch (_) {} // Abort mid-stream generation
      // Brief yield to let the old loop's iteration check fire
      await new Promise(r => setTimeout(r, 50));
    }
    ctx.agenticCancelled = false; // Reset cancel flag for this new request

    // Helper: check if this request is still the active one
    const isStale = () => myRequestId !== _activeRequestId || ctx.agenticCancelled;
  
    try {
      // ── Image / Video Generation Detection ──
      // If the user is asking for image/video generation, handle it directly instead of routing to an LLM
      const imgDetect = ImageGenerationService.detectImageRequest(message);
      const vidDetect = ImageGenerationService.detectVideoRequest(message);

      if (vidDetect) {
        // Attempt video generation via Pollinations (requires free API key)
        const imageGen = ctx.imageGen;
        if (!imageGen || imageGen._pollinationsKeys.length === 0) {
          // No Pollinations API keys — inform user how to enable video gen
          if (mainWindow) {
            mainWindow.webContents.send('llm-token',
              '⚠️ **Video generation requires a free Pollinations API key.**\n\n' +
              '1. Go to **https://enter.pollinations.ai** and create a free account\n' +
              '2. Copy your API key\n' +
              '3. Paste it in **Settings → Pollinations API Key**\n\n' +
              'Free video models available: **Seedance** (2-10s, best quality), **Wan** (2-15s, with audio), **Grok Video** (alpha).\n\n' +
              'I can **generate a still image** instead if you\'d like — just ask me to "generate an image of …"'
            );
          }
          return { success: true, response: 'Video generation requires Pollinations API key.', isVideoRequest: true };
        }

        if (mainWindow) {
          mainWindow.webContents.send('llm-token', `🎬 *Generating video: "${vidDetect.extractedPrompt.substring(0, 100)}${vidDetect.extractedPrompt.length > 100 ? '…' : ''}"*\n\n⏳ Videos take 30-120 seconds to generate — please be patient…\n\n`);
        }

        try {
          const result = await imageGen.generateVideo(vidDetect.extractedPrompt, {});

          if (result.success) {
            const videoPayload = JSON.stringify({
              type: 'generated-video',
              videoBase64: result.videoBase64,
              mimeType: result.mimeType,
              prompt: result.prompt,
              provider: result.provider,
              model: result.model,
              duration: result.duration,
            });

            if (mainWindow) {
              mainWindow.webContents.send('llm-token', `\n\n<!--GENERATED_VIDEO:${videoPayload}-->\n\n`);
              mainWindow.webContents.send('llm-token', `✅ Video generated via **Pollinations AI** (${result.model}). Use the buttons below the video to save it.`);
            }
            return { success: true, response: 'Video generated successfully.', isVideoGeneration: true, video: result };
          } else {
            if (mainWindow) {
              mainWindow.webContents.send('llm-token', `❌ Video generation failed: ${result.error}\n\nI can **generate a still image** instead — just ask!`);
            }
            return { success: false, error: result.error, isVideoGeneration: true };
          }
        } catch (vidErr) {
          if (mainWindow) {
            mainWindow.webContents.send('llm-token', `❌ Video generation error: ${vidErr.message}\n\nPlease try again.`);
          }
          return { success: false, error: vidErr.message, isVideoGeneration: true };
        }
      }

      if (imgDetect.isImageRequest) {
        const imageGen = ctx.imageGen;
        if (mainWindow) {
          mainWindow.webContents.send('llm-token', `🎨 *Generating image: "${imgDetect.extractedPrompt.substring(0, 100)}${imgDetect.extractedPrompt.length > 100 ? '…' : ''}"*\n\n`);
        }

        try {
          const result = await imageGen.generate(imgDetect.extractedPrompt, {
            width: 1024,
            height: 1024,
          });

          if (result.success) {
            // Send a special token that the renderer will parse as an inline image
            const imagePayload = JSON.stringify({
              type: 'generated-image',
              imageBase64: result.imageBase64,
              mimeType: result.mimeType,
              prompt: result.prompt,
              provider: result.provider,
              model: result.model,
            });

            if (mainWindow) {
              mainWindow.webContents.send('llm-token', `\n\n<!--GENERATED_IMAGE:${imagePayload}-->\n\n`);
              mainWindow.webContents.send('llm-token', `✅ Image generated via **${result.provider === 'pollinations' ? 'Pollinations AI' : 'Google Gemini'}** (${result.model}). Use the buttons below the image to save or discard it.`);
            }
            return { success: true, response: 'Image generated successfully.', isImageGeneration: true, image: result };
          } else {
            if (mainWindow) {
              mainWindow.webContents.send('llm-token', `❌ Image generation failed: ${result.error}\n\nI can still help you with text-based tasks — just let me know!`);
            }
            return { success: false, error: result.error, isImageGeneration: true };
          }
        } catch (imgErr) {
          if (mainWindow) {
            mainWindow.webContents.send('llm-token', `❌ Image generation error: ${imgErr.message}\n\nPlease try again.`);
          }
          return { success: false, error: imgErr.message, isImageGeneration: true };
        }
      }

      // ── Auto Mode: automatically pick the best model for this task ──
      if (context?.autoMode && !context?.cloudProvider) {
        const autoSelect = (() => {
          const lower = (message || '').toLowerCase();
          const isBrowser = /\b(browse|navigate|website|webpage|url|http|www\.|\.com|\.org|visit|open.*site|go\s+to|search\s+online|google|login|sign\s+in)\b/.test(lower);
          const isCode = /\b(code|file|function|class|variable|debug|fix|error|compile|build|refactor|write.*code|edit.*file|create.*file|read.*file|search.*code|git|commit|branch)\b/.test(lower);
          const isReasoning = /\b(think|reason|explain|why|analyze|compare|plan|architect|design|strategy)\b/.test(lower);
          const hasImages = context?.images?.length > 0;

          // Priority order for model selection by task type
          const configured = cloudLLM.getConfiguredProviders();
          const has = (p) => configured.some(c => c.provider === p);
          const pick = (provider, model) => ({ provider, model });

          // Vision tasks — need multimodal models
          if (hasImages) {
            if (has('google')) return pick('google', 'gemini-2.5-flash');
            if (has('openai')) return pick('openai', 'gpt-4o');
            if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
            if (has('xai')) return pick('xai', 'grok-3');
          }

          // Browser tasks — need fast, capable models
          if (isBrowser) {
            if (has('groq')) return pick('groq', 'llama-3.3-70b-versatile');
            if (has('cerebras')) return pick('cerebras', 'llama-3.3-70b');
            if (has('google')) return pick('google', 'gemini-2.5-flash');
            if (has('openai')) return pick('openai', 'gpt-4o');
            if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
          }

          // Coding tasks — prefer best coding models
          if (isCode) {
            if (has('groq')) return pick('groq', 'llama-3.3-70b-versatile');
            if (has('cerebras')) return pick('cerebras', 'zai-glm-4.7');
            if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
            if (has('openai')) return pick('openai', 'gpt-4o');
            if (has('google')) return pick('google', 'gemini-2.5-pro');
          }

          // Reasoning tasks — prefer thinking models
          if (isReasoning) {
            if (has('groq')) return pick('groq', 'llama-3.3-70b-versatile');
            if (has('cerebras')) return pick('cerebras', 'zai-glm-4.7');
            if (has('google')) return pick('google', 'gemini-2.5-pro');
            if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
            if (has('openai')) return pick('openai', 'gpt-4o');
          }

          // General / default — prefer balanced models
          if (has('groq')) return pick('groq', 'llama-3.3-70b-versatile');
          if (has('cerebras')) return pick('cerebras', 'zai-glm-4.7');
          if (has('google')) return pick('google', 'gemini-2.5-flash');
          if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
          if (has('openai')) return pick('openai', 'gpt-4o');

          return null; // No cloud providers available — fall through to local
        })();

        if (autoSelect) {
          context.cloudProvider = autoSelect.provider;
          context.cloudModel = autoSelect.model;
          console.log(`[Auto Mode] Selected: ${autoSelect.provider} / ${autoSelect.model}`);
          // Model selection is intentionally not shown in chat — auto mode is meant to be seamless
        } else {
          console.log('[Auto Mode] No cloud providers available, falling back to local model');
          if (mainWindow) {
            const localStatus = llmEngine.getStatus();
            if (localStatus.isReady) {
              mainWindow.webContents.send('llm-token', `*Auto Mode: No cloud API keys configured. Using local model.*\n\n`);
            } else {
              mainWindow.webContents.send('llm-token', `*Auto Mode: No cloud API keys configured and no local model loaded. Please configure an API key in settings or load a local model.*\n\n`);
              return { success: false, error: 'No AI models available. Configure a cloud API key or load a local model.' };
            }
          }
        }
      }

      // Check if user wants to use a cloud provider
      if (context?.cloudProvider && context?.cloudModel) {
        const cloudStatus = cloudLLM.getStatus();
        if (cloudStatus.providers.includes(context.cloudProvider)) {
          let fullPrompt = message;

          // Add context (same as local path)
          if (context?.currentFile?.content) {
            fullPrompt = `## Currently Open File: ${context.currentFile.path}\n\`\`\`\n${context.currentFile.content.substring(0, 12000)}\n\`\`\`\n\n${message}`;
          }
          if (context?.selectedCode) {
            fullPrompt = `## Selected Code:\n\`\`\`\n${context.selectedCode}\n\`\`\`\n\n${fullPrompt}`;
          }

          // Add web search results if requested
          if (context?.webSearch) {
            try {
              const searchResults = await webSearch.search(context.webSearch, 5);
              if (searchResults.length > 0) {
                const searchContext = searchResults.map((r, i) => `${i+1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
                fullPrompt = `## Web Search Results for "${context.webSearch}":\n${searchContext}\n\n${fullPrompt}`;
              }
            } catch (e) { console.log('[Cloud] Web search failed:', e.message); }
          }

          // Use the full system prompt so cloud models have tool awareness
          const systemPrompt = llmEngine._getSystemPrompt();
          
          // Task-type routing is handled by the model via system prompt — always use 'general'
          // so cloud models receive full tool context. The regex classifier was removed because
          // keyword matching is unreliable across phrasing, typos, and multi-part messages.
          const cloudTaskType = 'general'; // see CHANGES_LOG.md 2026-02-25

                    const toolPrompt = mcpToolServer.getToolPromptForTask(cloudTaskType);
          const isBundledCloudProvider = cloudLLM._isBundledProvider(context.cloudProvider) && !cloudLLM.isUsingOwnKey(context.cloudProvider);
          const _brevityDirective = isBundledCloudProvider
            ? '\n\nStyle rules (apply silently — never mention these rules to the user):\n- Always respond in a professional, clear, and articulate style with proper grammar, capitalization, and punctuation regardless of how the user writes.\n- Keep responses concise. For conversational or informational questions, use no more than 3 paragraphs. Never exceed 3 paragraphs for non-code responses.\n- For code or technical output, always provide the complete solution without padding or filler text.'
            : '';
          const cloudSystemPrompt = systemPrompt + (toolPrompt ? '\n\n' + toolPrompt : '') + _brevityDirective;

          // ── Free-tier daily quota for Guide Cloud AI (bundled keys, no session token) ──
          // When the user has no session token AND no active paid license, requests bypass
          // the server proxy and use bundled keys directly. Enforce a local daily cap so
          // free users get 20 messages/day; once exhausted, show the upgrade prompt.
          // Paid users (active license OR valid session token) are not quota-gated here.
          const _isQuotaExempt = licenseManager.isActivated || !!licenseManager.getSessionToken();
          if (isBundledCloudProvider && !_isQuotaExempt) {
            const _usageFile = path.join(ctx.userDataPath || require('electron').app.getPath('userData'), '.bundled-daily-usage.json');
            const _today = new Date().toISOString().slice(0, 10);
            let _usage = { date: _today, count: 0 };
            try {
              if (fsSync.existsSync(_usageFile)) {
                const _raw = JSON.parse(fsSync.readFileSync(_usageFile, 'utf8'));
                if (_raw.date === _today) _usage = _raw;
              }
            } catch (_) {}
            const FREE_DAILY_LIMIT = 20;
            if (_usage.count >= FREE_DAILY_LIMIT) {
              return { success: false, error: '__QUOTA_EXCEEDED__', isQuotaError: true };
            }
            _usage.count++;
            _usage.date = _today;
            try { fsSync.writeFileSync(_usageFile, JSON.stringify(_usage, null, 2)); } catch (_) {}
          }

          memoryStore.addConversation('user', message);

          // Wire todo updates for cloud path too
          mcpToolServer.onTodoUpdate = (todos) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('todo-update', todos);
            }
          };
          
          // Cloud agentic loop — iterate tool calls up to 500 rounds
          // For chat/greeting messages, skip the loop entirely (no tools injected)
          // Safety: stuck detection + repetition detection are the real guards
          const MAX_CLOUD_ITERATIONS = cloudTaskType === 'chat' ? 1 : 500;
          const WALL_CLOCK_DEADLINE = Date.now() + 30 * 60 * 1000; // 30-minute hard deadline
          let cloudIteration = 0;
          let currentCloudPrompt = fullPrompt;
          let cloudConversationHistory = [...(context?.conversationHistory || [])];
          let allCloudToolResults = [];
          let fullCloudResponse = '';
          // Cap fullCloudResponse to prevent unbounded memory growth
          const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2MB cap
          let lastCloudResult = null;
          let cloudNudgesRemaining = 3; // Nudge up to 3 times like local loop
          let lastCloudIterationResponse = '';
          let recentCloudToolCalls = [];
          const cloudToolFailCounts = {}; // Track per-tool failure counts for enrichErrorFeedback

          // ── PILLAR 4 (cloud): Execution state tracking ──
          const cloudExecutionState = {
            urlsVisited: [],
            filesCreated: [],
            filesEdited: [],
            searchesPerformed: [],
            dataExtracted: [],
            domainsBlocked: new Set(),
          };
          const updateCloudExecutionState = (toolName, params, result, iter) => {
            if (toolName === 'browser_navigate' && params?.url) {
              cloudExecutionState.urlsVisited.push({ url: params.url, iteration: iter, success: result?.success !== false });
            } else if (toolName === 'write_file' && params?.filePath) {
              cloudExecutionState.filesCreated.push({ path: params.filePath, iteration: iter });
            } else if (toolName === 'edit_file' && params?.filePath) {
              cloudExecutionState.filesEdited.push({ path: params.filePath, iteration: iter });
            } else if (toolName === 'web_search' && params?.query) {
              cloudExecutionState.searchesPerformed.push({ query: params.query, iteration: iter });
            } else if (['browser_evaluate', 'browser_get_content', 'browser_snapshot'].includes(toolName) && result?.success) {
              cloudExecutionState.dataExtracted.push({ tool: toolName, iteration: iter });
            }
          };
          const getCloudExecutionStateSummary = () => {
            const parts = [];
            if (cloudExecutionState.urlsVisited.length > 0) {
              const recent = cloudExecutionState.urlsVisited.slice(-5);
              parts.push(`URLs visited: ${recent.map(v => `${v.success ? '✓' : '✗'} ${v.url}`).join(', ')}`);
            }
            if (cloudExecutionState.filesCreated.length > 0) {
              parts.push(`Files created: ${cloudExecutionState.filesCreated.map(f => f.path).join(', ')}`);
            }
            if (cloudExecutionState.filesEdited.length > 0) {
              parts.push(`Files edited: ${cloudExecutionState.filesEdited.map(f => f.path).join(', ')}`);
            }
            if (cloudExecutionState.searchesPerformed.length > 0) {
              parts.push(`Searches: ${cloudExecutionState.searchesPerformed.map(s => s.query).join(', ')}`);
            }
            return parts.length > 0 ? `\n[EXECUTION STATE]\n${parts.join('\n')}\n` : '';
          };

          // Structured summarizer for cloud models too
          const cloudSummarizer = new ConversationSummarizer();
          cloudSummarizer.setGoal(message);

          while (cloudIteration < MAX_CLOUD_ITERATIONS) {
            // Check if a newer request superseded us or user cancelled
            if (isStale()) {
              console.log('[Cloud] Request superseded or cancelled, exiting loop');
              if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Interrupted — new message received]*\n');
              break;
            }
            // Wall-clock deadline guard — prevent infinite execution
            if (Date.now() > WALL_CLOCK_DEADLINE) {
              console.log('[Cloud] Wall-clock deadline (30 min) reached, stopping loop');
              if (mainWindow) mainWindow.webContents.send('llm-token', '\n\n*Session time limit reached (30 min). Stopping to preserve resources. You can continue by sending another message.*\n');
              break;
            }
            cloudIteration++;

            // Proactive inter-iteration pacing — uses RPM budget to avoid 429s
            // Only delays when approaching the rate limit ceiling; instant when there's headroom
            if (cloudIteration > 1) {
              const iterPace = cloudLLM.getProactivePaceMs?.(context.cloudProvider) || 0;
              if (iterPace > 0) {
                console.log(`[Cloud] Proactive inter-iteration pace: ${iterPace}ms`);
                await new Promise(r => setTimeout(r, iterPace));
              }
            }

            console.log(`[Cloud] Agentic iteration ${cloudIteration}/${MAX_CLOUD_ITERATIONS}`);
            
            if (mainWindow && cloudIteration > 1) {
              mainWindow.webContents.send('agentic-progress', { iteration: cloudIteration, maxIterations: MAX_CLOUD_ITERATIONS });
            }

            // Signal renderer to track where this iteration's text starts in the buffer.
            // Required so llm-replace-last (sent after tool calls) can preserve prior
            // iterations' text while only correcting the current iteration's portion.
            if (mainWindow) mainWindow.webContents.send('llm-iteration-begin');

            // Guide Cloud AI (bundled) paces tokens to ~15–20 tok/s so responses stream
            // visually rather than arriving as an instant wall of text.
            // flushOnNewline is disabled for cloud so paragraph newlines don't bypass charsPerFlush pacing.
            const _tokenFlushMs = isBundledCloudProvider ? 50 : 25;
            const _tokenCharsPerFlush = isBundledCloudProvider ? 4 : undefined;
            const _tokenMaxBufferChars = isBundledCloudProvider ? 256 : 2048;
            const cloudTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: _tokenFlushMs, maxBufferChars: _tokenMaxBufferChars, charsPerFlush: _tokenCharsPerFlush, flushOnNewline: !isBundledCloudProvider });
            const cloudThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });
            try {
              lastCloudResult = await cloudLLM.generate(currentCloudPrompt, {
                provider: context.cloudProvider,
                model: context.cloudModel,
                systemPrompt: cloudSystemPrompt,
                maxTokens: cloudTaskType === 'chat' ? Math.min(context?.params?.maxTokens || 1024, 1024) : (context?.params?.maxTokens || 32768),
                temperature: context?.params?.temperature || 0.7,
                stream: true,
                noFallback: !context?.autoMode, // Don't auto-switch providers when user manually selected a model
                conversationHistory: cloudConversationHistory,
                images: cloudIteration === 1 ? (context?.images || []) : [],
                onToken: (token) => { if (!isStale()) cloudTokenBatcher.push(token); },
                onThinkingToken: (token) => { if (!isStale()) cloudThinkingBatcher.push(token); },
              });
            } finally {
              cloudTokenBatcher.dispose();
              cloudThinkingBatcher.dispose();
            }

            // Check stale after cloud generation completes
            if (isStale()) {
              console.log('[Cloud] Request superseded after generation, exiting loop');
              break;
            }

            const responseText = lastCloudResult.text || '';
            // Clean tool call artifacts from response text before accumulating
            // (incremental cleanup is much faster than running regexes on the full 2MB at end)
            let cleanedResponseText = responseText;
            cleanedResponseText = cleanedResponseText.replace(/```(?:tool_call|tool|json)[^\n]*\n[\s\S]*?```/g, '');
            cleanedResponseText = cleanedResponseText.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
            cleanedResponseText = cleanedResponseText.replace(/<\/?think(?:ing)?>/gi, '');
            // Cap response accumulation to prevent unbounded memory growth in long sessions
            if (fullCloudResponse.length < MAX_RESPONSE_SIZE) {
              fullCloudResponse += cleanedResponseText;
            }

            // Save previous response for repetition detection in classifyResponseFailure
            const previousCloudResponse = lastCloudIterationResponse;
            lastCloudIterationResponse = responseText;

            // Let cloud summarizer detect task plans
            if (responseText.length > 50) {
              cloudSummarizer.recordPlan(responseText);
            }

            // Parse and execute tool calls using the MCP parser (more robust)
            // Inter-tool pace: small delay for UI feedback only (rate limiting is handled proactively)
            // No tool burst cap: let models execute as many tools as needed for complex tasks
            const cloudToolPace = cloudLLM.getRecommendedPaceMs?.() || 50;
            const toolResults = await mcpToolServer.processResponse(responseText, { toolPaceMs: cloudToolPace });

            // ── Cloud tool-call display cleanup ──
            // Cloud models sometimes emit conversational text + raw JSON inline, e.g.:
            //   "We will call tools.{"tool":"browser_navigate","params":{...}}"
            // The raw JSON gets streamed to the renderer token-by-token and appears in the
            // chat bubble. Fix: extract only the conversational prefix (text before the first
            // {"tool": occurrence) and send it back as llm-replace-last so the renderer
            // replaces only this iteration's streamed content with the clean version.
            // Prior iterations' text is preserved by the iterationStartOffsetRef mechanism.
            if (toolResults.hasToolCalls && toolResults.results.length > 0 && mainWindow) {
              // Extract conversational planning text — everything before the first tool call
              // indicator in responseText. The model often emits "We should navigate to X..."
              // before emitting the tool JSON. That text belongs in the thinking panel, not
              // the main chat bubble. Route it there, then wipe the main chat iteration slot.
              const toolIndicators = ['{"tool":', '```tool_call', '```json\n{"tool"'];
              let splitIdx = responseText.length;
              for (const indicator of toolIndicators) {
                const idx = responseText.indexOf(indicator);
                if (idx >= 0 && idx < splitIdx) splitIdx = idx;
              }
              const planningText = responseText.substring(0, splitIdx).trim();
              if (planningText) {
                mainWindow.webContents.send('llm-thinking-token', planningText);
              }
              // Wipe this iteration's content from main chat — the final answer arrives in
              // the last iteration that produces no tool calls (preserved by iterationStartOffsetRef).
              mainWindow.webContents.send('llm-replace-last', '');
            }

            if (!toolResults.hasToolCalls || toolResults.results.length === 0) {
              // ── PILLAR 3: Structured Error Recovery (cloud path) ──
              const cloudIsBrowserTask = /\b(browse|navigate|website|url|http|www\.|\.com|visit|open.*site)\b/i.test(message || '') ||
                allCloudToolResults.some(tr => tr.tool?.startsWith('browser_'));
              const cloudFailure = classifyResponseFailure(
                responseText, false, cloudTaskType, cloudIteration, message, previousCloudResponse,
                { isBrowserTask: cloudIsBrowserTask, nudgesRemaining: cloudNudgesRemaining, allToolResults: allCloudToolResults }
              );

              if (cloudFailure) {
                console.log(`[Cloud] Failure classified: ${cloudFailure.type} (severity: ${cloudFailure.severity})`);

                if (cloudFailure.severity === 'stop') {
                  if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[Stopped — ${cloudFailure.type}]*\n`);
                  break;
                }
              }

              console.log(`[Cloud] No tool calls in iteration ${cloudIteration}, ending`);
              break;
            }

            if (toolResults.capped && toolResults.skippedToolCalls > 0 && mainWindow) {
              mainWindow.webContents.send('llm-token', `\n\n*Tool burst cap: executed ${toolResults.results.length}, skipped ${toolResults.skippedToolCalls}. Continuing next iteration...*\n`);
            }

            // Execute tools and collect results
            const iterationToolResults = [];
            for (const tr of toolResults.results) {
              // Check stale before each tool execution
              if (isStale()) {
                console.log('[Cloud] Request superseded before tool execution, exiting');
                break;
              }
              // Wait if paused (live takeover)
              await waitWhilePaused();
              console.log(`[Cloud] Executing tool: ${tr.tool}`);
              iterationToolResults.push(tr);
              allCloudToolResults.push(tr);
              cloudSummarizer.recordToolCall(tr.tool, tr.params, tr.result);
              cloudSummarizer.markPlanStepCompleted(tr.tool, tr.params);
              updateCloudExecutionState(tr.tool, tr.params, tr.result, cloudIteration);
              // Pace update_todo calls so each IPC message gets its own renderer paint
              if (tr.tool === 'update_todo') await new Promise(r => setTimeout(r, 80));
            }

            // Cloud stuck/cycle detection — disabled by default.
            // Enable via Settings → enableLoopDetection: true.
            for (const tr of iterationToolResults) {
              const p = tr.params || {};
              const paramsHash = `${p.filePath || p.url || p.ref || p.query || p.command || p.selector || ''}:${p.text || ''}`.substring(0, 200);
              recentCloudToolCalls.push({ tool: tr.tool, paramsHash });
            }
            if (recentCloudToolCalls.length > 20) recentCloudToolCalls = recentCloudToolCalls.slice(-20);
            if (_readConfig()?.userSettings?.enableLoopDetection ?? false) {
              if (recentCloudToolCalls.length >= STUCK_THRESHOLD) {
                const last = recentCloudToolCalls[recentCloudToolCalls.length - 1];
                const tail = recentCloudToolCalls.slice(-STUCK_THRESHOLD);
                if (tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash)) {
                  console.log(`[Cloud] Detected stuck pattern: ${last.tool} called ${STUCK_THRESHOLD}+ times with same params`);
                  if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected repetitive loop (${last.tool}). Auto-stopped.*`);
                  break;
                }
              }
              // ── Cycle detection: same SEQUENCE of 2-4 tools repeating ──
              if (recentCloudToolCalls.length >= 8) {
                let cycleDetected = false;
                for (let cycleLen = 2; cycleLen <= 4; cycleLen++) {
                  if (recentCloudToolCalls.length < cycleLen * CYCLE_MIN_REPEATS) continue;
                  const toolNames = recentCloudToolCalls.map(tc => tc.tool);
                  const lastCycle = toolNames.slice(-cycleLen);
                  let repeats = 0;
                  for (let pos = toolNames.length - cycleLen; pos >= 0; pos -= cycleLen) {
                    const segment = toolNames.slice(pos, pos + cycleLen);
                    if (segment.join(',') === lastCycle.join(',')) repeats++;
                    else break;
                  }
                  if (repeats >= CYCLE_MIN_REPEATS) {
                    const cycleSig = lastCycle.join(' → ');
                    console.log(`[Cloud] Tool cycle detected: [${cycleSig}] repeated ${repeats} times`);
                    if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected tool cycle (${cycleSig}). Breaking loop.*`);
                    cycleDetected = true;
                    break;
                  }
                }
                if (cycleDetected) break;
              }
            }

            // Send UI notifications for all tool executions at once
            sendToolExecutionEvents(mainWindow, iterationToolResults, playwrightBrowser);
            capArray(allCloudToolResults, 50);

            // Send tool results indicator to UI (use dedicated event, not llm-token)
            if (mainWindow) {
              mainWindow.webContents.send('mcp-tool-results');
            }

            // Build tool results for next prompt  
            // For browser actions, auto-snapshot to give cloud model fresh element refs
            const toolSummaryParts = [];

            if (toolResults.capped && toolResults.skippedToolCalls > 0) {
              toolSummaryParts.push(`NOTE: Tool burst cap enforced. Executed ${toolResults.results.length} tool call(s), skipped ${toolResults.skippedToolCalls}. Re-issue any remaining tool calls in the next response.`);
            }
            
            for (const r of iterationToolResults) {
              // Pre-truncate large fields before JSON.stringify to avoid serializing MBs
              const truncResult = _truncateResult(r.result);
              const resultStr = JSON.stringify(truncResult).substring(0, 4000);
              let toolLine = `Tool "${r.tool}" result:\n${resultStr}`;
              toolSummaryParts.push(toolLine);
            }
            let toolSummary = toolSummaryParts.join('\n\n');
            
            // Auto-snapshot for cloud after browser actions
            const snapResult = await autoSnapshotAfterBrowserAction(iterationToolResults, mcpToolServer, playwrightBrowser, browserManager);
            if (snapResult) {
              toolSummary += `\nPage snapshot after ${snapResult.triggerTool}:\n${snapResult.snapshotText}\n\n${snapResult.elementCount} elements. Use [ref=N] with browser_click/type.\n`;
            }

            // Update conversation history
            cloudConversationHistory.push({ role: 'user', content: currentCloudPrompt });
            cloudConversationHistory.push({ role: 'assistant', content: responseText });

            // ── Anti-hallucination guard for file edits (cloud path) ──
            // DISABLED 2026-02-25: Part of the over-engineered hallucination detection.
            // Commented out for testing/simplification.
            // {
            //   const fileModTools = ['write_file', 'edit_file'];
            //   const calledFileModTool = iterationToolResults.some(r => fileModTools.includes(r.tool));
            //   const userAskedForEdit = /\b(edit|change|modif|...)\b/i.test(message || '');
            //   const modelClaimedEdits = /\b(✔️|✅|upgraded|...)\b/i.test(responseText);
            //   if (!calledFileModTool && userAskedForEdit && modelClaimedEdits && iterationToolResults.length > 0) {
            //     cloudConversationHistory.push({ role: 'user', content: '[SYSTEM] WARNING: ...' });
            //   }
            // }

            // Progressive pruning: compress verbose messages at ~60% of budget before hard rotation
            const cloudHistorySize = cloudConversationHistory.reduce((acc, m) => acc + (m.content || '').length, 0);
            const cloudHistoryTokenEst = Math.ceil(cloudHistorySize / 4);
            const cloudMaxHistory = 30000; // ~30K tokens — compress early to keep costs down
            if (cloudHistoryTokenEst > cloudMaxHistory * 0.6 && cloudHistoryTokenEst <= cloudMaxHistory) {
              pruneCloudHistory(cloudConversationHistory, 6);
            }

            // Hard rotation: summarize cloud conversation history when it gets too large
            const cloudHistorySizeAfterPrune = cloudConversationHistory.reduce((acc, m) => acc + (m.content || '').length, 0);
            const cloudHistoryTokenEstAfterPrune = Math.ceil(cloudHistorySizeAfterPrune / 4);
            if (cloudHistoryTokenEstAfterPrune > cloudMaxHistory && cloudConversationHistory.length > 6) {
              console.log(`[Cloud] History at ~${cloudHistoryTokenEstAfterPrune} tokens — compressing with summarizer`);
              cloudSummarizer.markRotation();
              const cloudSummary = cloudSummarizer.generateSummary({ maxTokens: 3000 });
              // Keep only the summary as the first message + last 4 exchanges
              const recentExchanges = cloudConversationHistory.slice(-4);
              cloudConversationHistory = [
                { role: 'user', content: cloudSummary },
                { role: 'assistant', content: 'Understood. I have the full context from the summary above. Continuing the task.' },
                ...recentExchanges,
              ];
              console.log(`[Cloud] Compressed history: ${cloudHistoryTokenEst} → ~${Math.ceil(cloudConversationHistory.reduce((a, m) => a + (m.content || '').length, 0) / 4)} tokens`);
            }

            // Build next prompt with tool results
            const hasBrowserActions = iterationToolResults.some(tr => tr.tool && tr.tool.startsWith('browser_'));
            const continueHint = hasBrowserActions
              ? 'A page snapshot was auto-captured above with element [ref=N] numbers. Use browser_click, browser_type, etc. with [ref=N] to interact. Continue the task.'
              : 'Continue with the task. If more steps are needed, call the appropriate tools. If the task is complete, provide a summary.';
            currentCloudPrompt = `Here are the results of the tool calls:\n\n${toolSummary}\n\n${continueHint}`;
          }

          memoryStore.addConversation('assistant', fullCloudResponse);

          // Clean up response display (heavy patterns already cleaned incrementally per-iteration)
          let cleanCloudResponse = fullCloudResponse;
          // Strip raw inline JSON tool calls ({"tool": "..."...} or [{"tool": "..."...}])
          cleanCloudResponse = cleanCloudResponse.replace(/\[?\s*\{\s*"(?:tool|name)"\s*:\s*"[^"]*"[\s\S]*?\}\s*\]?/g, '');
          // Strip tool execution result sections (in case cloud model echoed them)
          cleanCloudResponse = cleanCloudResponse.replace(/\n*## Tool Execution Results\n[\s\S]*?(?=\n## [^T]|\n\*(?:Detected|Reached)|$)/g, '');
          // Strip any remaining ### toolname [OK|FAIL] headers and their content
          cleanCloudResponse = cleanCloudResponse.replace(/\n*### \S+ \[(?:OK|FAIL)\]\n?(?:[^\n].*\n)*/g, '\n');
          // Collapse excessive newlines
          cleanCloudResponse = cleanCloudResponse.replace(/\n{3,}/g, '\n\n').trim();

          // Estimate and send context usage for cloud models
          // historySize already includes the system prompt (first user msg) + all responses
          {
            const historySize = cloudConversationHistory.reduce((acc, m) => acc + (m.content || '').length, 0);
            const estimatedUsed = Math.ceil(historySize / 4);
            const modelCtx = 128000; // Most cloud models now support 128k+
            if (mainWindow) {
              mainWindow.webContents.send('context-usage', { used: estimatedUsed, total: modelCtx });
            }
          }

          // Report token telemetry
          const finalTokensUsed = lastCloudResult?.tokensUsed || Math.ceil(fullCloudResponse.length / 4);
          _reportTokenStats(finalTokensUsed, mainWindow);

          return {
            success: true, text: cleanCloudResponse,
            model: isBundledCloudProvider ? 'Guide Cloud AI' : `${context.cloudProvider}/${context.cloudModel}`,
            tokensUsed: finalTokensUsed,
          };
        }
      }

      // Default: use local LLM with agentic loop
      const modelStatus = llmEngine.getStatus();
      const hwContextSize = modelStatus.modelInfo?.contextSize || 32768;

      // Helper functions (defined early — needed for budget calculation)
      // /3.5 gives ~14% more conservative token estimate than /4 — real LLM tokenizers
      // produce 3–3.5 chars/token for code and JSON (shorter than English prose).
      // This prevents buildStaticPrompt + buildDynamicContext from overcommitting budget.
      const estimateTokens = (text) => Math.ceil((text || '').length / 3.5);
      
      // ── ModelProfile-driven budgeting ──
      // The ModelProfile registry provides effective context size, response reserve %,
      // and max response tokens tuned per model family and size tier.
      const modelTier = llmEngine.getModelTier();
      const modelProfile = modelTier.profile;
      const isSmallLocalModel = modelTier.paramSize > 0 && modelTier.paramSize <= 4;

      // Use the SMALLER of hardware context and profile's effective context.
      // This prevents small models from being given more context than they handle well.
      const totalCtx = Math.min(hwContextSize, modelProfile.context.effectiveContextSize);

      const actualSystemPrompt = llmEngine._getActiveSystemPrompt();
      // FIX 4: Also account for tool schema tokens that generateWithFunctions() injects at
      // evaluation time. These tokens are NOT part of the static system prompt text but DO
      // consume KV cache slots and cause overflow if unaccounted for.
      // Estimate: profile.generation.maxToolsPerTurn × ~55 tokens/schema (name+description+params).
      const toolSchemaTokenEstimate = (modelProfile.generation?.maxToolsPerTurn ?? 0) * 55;
      const sysPromptReserve = estimateTokens(actualSystemPrompt) + 50 + toolSchemaTokenEstimate;
      console.log(`[AI Chat] Profile: ${modelProfile._meta.profileSource} | ctx=${totalCtx} (hw=${hwContextSize}) | sysReserve=${sysPromptReserve} (incl ~${toolSchemaTokenEstimate} tool schema est.) | compact=${isSmallLocalModel}`);

      // Response budget from profile (percentage-based with hard cap)
      const maxResponseTokens = Math.min(
        Math.floor(totalCtx * modelProfile.context.responseReservePct),
        modelProfile.context.maxResponseTokens
      );
      const maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);
      
      // Task-type routing is handled by the model via system prompt — always return 'general'
      // so the model receives full tool context. The regex classifier was removed because
      // keyword matching is unreliable across phrasing, typos, and multi-part messages.
      // The system prompt instructs the model when to use tools vs answer conversationally.
      // See CHANGES_LOG.md 2026-02-25 for rationale.
      const detectTaskType = (msg) => { return 'general'; };
            const taskType = detectTaskType(message);
      console.log(`[AI Chat] Detected task type: ${taskType}`);

      // Build initial context
      // Split into STATIC (tool defs, project instructions) and DYNAMIC (memory, RAG, file)
      // Static part goes in systemContext (preserved across iterations for KV cache efficiency).
      // Dynamic part is injected into the user message so systemContext doesn't change.
      // Memoize buildStaticPrompt per task type — it's called 11+ times per message
      // but the result is constant for a given taskType within a single message request
      const _staticPromptCache = new Map();
      const buildStaticPrompt = (taskTypeOverride) => {
        const cacheKey = taskTypeOverride || taskType || '_default';
        if (_staticPromptCache.has(cacheKey)) return _staticPromptCache.get(cacheKey);

        let tokenBudget = maxPromptTokens;
        let prompt = '';
        
        const appendIfBudget = (text, label) => {
          const cost = estimateTokens(text);
          if (cost < tokenBudget) {
            prompt += text;
            tokenBudget -= cost;
            return true;
          }
          return false;
        };

        // User's custom system prompt OR default preamble (from Advanced Settings)
        // Use compact preamble for small local models to preserve context budget.
        // Cloud models and large local models get the full preamble.
        const savedSettings = _readConfig()?.userSettings;
        const userPreamble = savedSettings?.systemPrompt && typeof savedSettings.systemPrompt === 'string' && savedSettings.systemPrompt.trim();
        // Use ModelProfile to select preamble style
        const isSmallModel = modelProfile.prompt.style === 'compact';
        const defaultPreamble = isSmallModel ? (DEFAULT_COMPACT_PREAMBLE || DEFAULT_SYSTEM_PREAMBLE) : DEFAULT_SYSTEM_PREAMBLE;
        const preamble = userPreamble || defaultPreamble;
        appendIfBudget(preamble + '\n\n', 'system-preamble');

        // MCP tool definitions — task-filtered for efficiency
        // Skip tools entirely for casual chat/greetings to prevent unprompted tool use
        //
        // OPTIMIZATION: When grammar-constrained generation is active (small models),
        // the grammar already enforces valid tool names and param schemas. The full
        // text tool prompt (~1900 tokens) is redundant — use a compact hint (~80 tokens)
        // instead. This reclaims ~1800 tokens for conversation context.
        // Large models and cloud models still get the full text prompt.
        const effectiveTaskType = taskTypeOverride || taskType;
        if (effectiveTaskType !== 'chat') {
          // ModelProfile controls tool prompt style:
          //   'grammar-only' → ultra-compact hint (grammar handles structure)
          //   'compact'      → compact hint for small models
          //   'full'         → full verbose tool prompt
          const toolPromptStyle = modelProfile.prompt.toolPromptStyle;
          const useCompactTools = toolPromptStyle === 'grammar-only' || toolPromptStyle === 'compact';
          if (useCompactTools) {
            // Grammar handles structural validity — just tell the model it has tools
            const compactHint = mcpToolServer.getCompactToolHint(effectiveTaskType);
            appendIfBudget(compactHint + '\n', 'tools-compact');
          } else {
            // Full tool prompt for large models, text-mode fallback, and first-time context
            const toolPrompt = mcpToolServer.getToolPromptForTask(effectiveTaskType);
            if (!appendIfBudget(toolPrompt + '\n', 'tools')) {
              // Fallback: try with just browser or general tools
              const fallbackPrompt = mcpToolServer.getToolPromptForTask('browser');
              if (!appendIfBudget(fallbackPrompt + '\n', 'tools-fallback')) {
                console.warn('[Context] Tool prompt too large for token budget');
              }
            }
          }
        }

        // Custom project instructions (.prompt.md / .guide-instructions.md)
        // Cached per-project to avoid sync FS reads on every message
        // Skip for chat tasks — keep casual conversation minimal
        if (effectiveTaskType !== 'chat' && context?.projectPath) {
          const cacheKey = context.projectPath;
          if (!_instructionCache || _instructionCacheProject !== cacheKey) {
            _instructionCacheProject = cacheKey;
            _instructionCache = null;
            const instructionsCandidates = [
              '.guide-instructions.md', '.prompt.md', '.guide/instructions.md',
              'CODING_GUIDELINES.md',
            ];
            for (const file of instructionsCandidates) {
              try {
                const instrPath = path.join(context.projectPath, file);
                if (fsSync.existsSync(instrPath)) {
                  const instrContent = fsSync.readFileSync(instrPath, 'utf8').trim();
                  if (instrContent) {
                    _instructionCache = { file, content: instrContent };
                    break;
                  }
                }
              } catch (_) {}
            }
          }
          if (_instructionCache) {
            const section = `## Project Custom Instructions (from ${_instructionCache.file})\n${_instructionCache.content}\n\n`;
            if (appendIfBudget(section, 'custom-instructions')) {
              console.log(`[AI Chat] Injected custom instructions from ${_instructionCache.file}`);
            }
          }
        }

        _staticPromptCache.set(cacheKey, prompt);
        return prompt;
      };

      // Dynamic context: memory, RAG, file, error — changes between iterations.
      // Injected into user message instead of system context to avoid KV cache invalidation.
      // Chat mode: skip ALL dynamic context to maximize conversation space.
      // budgetOverride: optional cap for dynamic context tokens — used by overflow retry
      // to shed memory/RAG/file context while preserving tools and preamble.
      const buildDynamicContext = (taskTypeOverride, budgetOverride) => {
        const effectiveTaskType = taskTypeOverride || taskType;
        // Chat mode: no dynamic context injection — keep the full context for conversation
        if (effectiveTaskType === 'chat') return '';
        let tokenBudget = budgetOverride !== undefined ? budgetOverride : Math.floor(maxPromptTokens * 0.4); // default: 40% of prompt budget
        let prompt = '';
        
        const appendIfBudget = (text, label) => {
          const cost = estimateTokens(text);
          if (cost < tokenBudget) {
            prompt += text;
            tokenBudget -= cost;
            return true;
          }
          return false;
        };

        // Memory context — skip for chat tasks to keep casual conversation minimal
        if (effectiveTaskType !== 'chat') {
          const memoryContext = memoryStore.getContextPrompt();
          if (memoryContext) appendIfBudget(memoryContext + '\n', 'memory');
        }

        // Error context — skip for chat tasks
        if (effectiveTaskType !== 'chat' && context?.errorMessage) {
          const errorContext = ragEngine.findErrorContext(context.errorMessage, context.stackTrace || '');
          if (errorContext.results.length > 0) {
            const errorHeader = `## Error Analysis Context\n\nError: ${context.errorMessage}\n`;
            if (appendIfBudget(errorHeader, 'error-header')) {
              for (const result of errorContext.results.slice(0, 3)) {
                const chunk = `### ${result.relativePath}\n\`\`\`\n${result.content.substring(0, 1000)}\n\`\`\`\n\n`;
                if (!appendIfBudget(chunk, 'error-context')) break;
              }
            }
          }
        }

        // RAG context — skip for browser AND chat tasks to prevent context bleed
        // Also reduce injection when user is asking to CREATE new content
        // (not asking about existing project files)
        if (effectiveTaskType !== 'browser' && effectiveTaskType !== 'chat' && context?.projectPath && ragEngine.projectPath) {
          const maxChunks = tokenBudget > 2000 ? 5 : tokenBudget > 1000 ? 3 : 1;
          const ragContext = ragEngine.getContextForQuery(message, maxChunks, tokenBudget * 2);
          
          // Detect "create new content" intent — user wants to build something
          // new, not reference existing project code. Common pattern: "create a
          // website/app/page for X" where X is unrelated to the current project.
          const createNewPattern = /\b(create|build|make|generate|write|design)\b.*\b(html|website|web\s*page|app|application|page|document|site|landing\s*page|portfolio|dashboard)\b(?!.*\b(for\s+this|in\s+this|our|the\s+project|this\s+project|existing|current)\b)/i;
          const isCreatingNew = createNewPattern.test(message);
          
          // When creating new content, only inject RAG if results are strongly
          // relevant (high score) — prevents project context from leaking into
          // unrelated creative work
          const highScoreThreshold = 5.0;
          const filteredChunks = isCreatingNew
            ? ragContext.chunks.filter(c => c.score >= highScoreThreshold)
            : ragContext.chunks;
          
          if (filteredChunks.length > 0) {
            let ragSection = '## Relevant Code from Project\n\n';
            for (const chunk of filteredChunks) {
              const piece = `### ${chunk.file}\n\`\`\`\n${chunk.content}\n\`\`\`\n\n`;
              if (!appendIfBudget(piece, 'rag-chunk')) break;
            }
          }
        }

        // Current file — skip for browser and chat tasks to prevent context bleed
        if (effectiveTaskType !== 'browser' && effectiveTaskType !== 'chat' && context?.currentFile) {
          const maxFileChars = Math.min(tokenBudget * 3, 3000);
          let fileSection = `## Currently Open File: ${context.currentFile.path}\n`;
          if (context.currentFile.content) {
            fileSection += '```\n' + context.currentFile.content.substring(0, maxFileChars) + '\n```\n\n';
          }
          appendIfBudget(fileSection, 'current-file');
        }

        // Selected code — skip for chat tasks
        if (effectiveTaskType !== 'chat' && context?.selectedCode) {
          appendIfBudget(`## Selected Code:\n\`\`\`\n${context.selectedCode}\n\`\`\`\n\n`, 'selection');
        }

        // User's custom instructions (from Advanced Settings) — appended to every message
        const dynSettings = _readConfig()?.userSettings;
        if (dynSettings?.customInstructions && typeof dynSettings.customInstructions === 'string' && dynSettings.customInstructions.trim()) {
          appendIfBudget(`## User Custom Instructions\n${dynSettings.customInstructions.trim()}\n\n`, 'custom-instructions');
        }

        return prompt;
      };

      // ── Wire Todo Updates to Frontend ──
      // When the model calls write_todos/update_todo, send the updated list to the UI
      mcpToolServer.onTodoUpdate = (todos) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('todo-update', todos);
        }
      };

      // Agentic loop
      let basePrompt = buildStaticPrompt();
      let allToolResults = [];
      let gatheredWebData = []; // Persistent store for web data — survives allToolResults capping
      let fullResponseText = '';
      let displayResponseText = '';
      let iteration = 0;
      // Smart continuation: track tool call patterns for stuck detection
      let recentToolCalls = []; // [{tool, paramsHash}]
      const toolFailCounts = {}; // Track per-tool failure counts for enrichErrorFeedback
      let nudgesRemaining = 3; // Allow 3 nudges when model responds with text instead of tool calls
      let contextRotations = 0; // Track how many times we've rotated context
      const MAX_CONTEXT_ROTATIONS = 10; // Allow up to 10 rotations for long tasks
      let lastConvSummary = ''; // Conversation summary from last rotation
      let sessionJustRotated = false; // Flag to rebuild prompt after rotation
      let overflowResponseBudgetReduced = false; // Flag: already tried reducing response budget on first-turn overflow
      let forcedToolFunctions = null; // Set by PILLAR 3 refusal recovery to force grammar on next iteration
      let consecutiveEmptyGrammarRetries = 0; // Track grammar failures for text-mode fallback

      // ── Execution State Tracking (ported from Pocket Guide) ──
      // Ground truth of what actually happened — used for verification & context injection
      const executionState = {
        urlsVisited: [],       // [{ url, iteration, success }]
        filesCreated: [],      // [{ path, iteration }]
        filesEdited: [],       // [{ path, iteration }]
        dataExtracted: [],     // [{ source, snippet, iteration }]
        searchesPerformed: [], // [{ query, iteration }]
        domainsBlocked: new Set(),
      };
      const domainAttempts = {}; // { domain: { attempts, failures, lastIteration } }
      const MAX_DOMAIN_ATTEMPTS = 4;

      // Track execution state from tool results
      const updateExecutionState = (toolName, params, result, iter) => {
        if (toolName === 'browser_navigate' && params?.url) {
          const success = result?.success !== false;
          executionState.urlsVisited.push({ url: params.url, iteration: iter, success });
          try {
            const domain = new URL(params.url).hostname;
            if (!domainAttempts[domain]) domainAttempts[domain] = { attempts: 0, failures: 0, lastIteration: 0 };
            domainAttempts[domain].attempts++;
            domainAttempts[domain].lastIteration = iter;
            if (!success) domainAttempts[domain].failures++;
            const resultText = JSON.stringify(result || '').toLowerCase();
            if (/captcha|bot.detect|challenge|cloudflare|blocked|security.check|verify.human/i.test(resultText)) {
              executionState.domainsBlocked.add(domain);
              domainAttempts[domain].failures += 2;
              console.log(`[AI Chat] Domain blocked: ${domain}`);
            }
          } catch (_) {}
        }
        if (toolName === 'write_file' && result?.success && params?.filePath) {
          executionState.filesCreated.push({ path: params.filePath, iteration: iter });
        }
        if (toolName === 'edit_file' && result?.success && params?.filePath) {
          executionState.filesEdited.push({ path: params.filePath, iteration: iter });
        }
        if (['browser_snapshot', 'browser_evaluate', 'fetch_webpage'].includes(toolName) && result?.success) {
          const content = result.content || result.snapshot || result.output || '';
          if (typeof content === 'string' && content.length > 50) {
            executionState.dataExtracted.push({ source: toolName, snippet: content.substring(0, 200), iteration: iter });
          }
        }
        if (toolName === 'web_search' && params?.query) {
          executionState.searchesPerformed.push({ query: params.query, iteration: iter });
        }
      };

      // Check if a domain has exceeded retry limits
      const checkDomainLimit = (url) => {
        try {
          const domain = new URL(url).hostname;
          const info = domainAttempts[domain];
          if (!info) return null;
          if (executionState.domainsBlocked.has(domain)) {
            return `STOP: ${domain} has bot detection/CAPTCHA. Do NOT retry browser tools on this domain. Use web_search or fetch_webpage instead.`;
          }
          if (info.attempts >= MAX_DOMAIN_ATTEMPTS) {
            return `STOP: You've tried ${domain} ${info.attempts} times (${info.failures} failures). Switch to web_search/fetch_webpage or try a different source.`;
          }
          if (info.failures >= 3) {
            return `WARNING: ${domain} has failed ${info.failures}/${info.attempts} times. Consider web_search or fetch_webpage instead.`;
          }
        } catch (_) {}
        return null;
      };

      // Verify model claims against ground truth
      const verifyModelClaims = (responseText) => {
        const warnings = [];
        if (!responseText || typeof responseText !== 'string') return warnings;
        // Check: model claims to have visited a URL not in history
        const urlMentions = responseText.match(/https?:\/\/[^\s"'<>)}\]]+/g) || [];
        for (const url of urlMentions) {
          let claimsVisit = false;
          try {
            const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 60).replace(/\\$/, '');
            claimsVisit = new RegExp(`(?:navigat|visit|went to|opened|accessed|browsed).*${escaped}`, 'i').test(responseText);
          } catch (_) {}
          if (claimsVisit) {
            try {
              const actuallyVisited = executionState.urlsVisited.some(v => v.url.includes(new URL(url).hostname));
              if (!actuallyVisited) {
                warnings.push(`VERIFICATION FAILURE: You claim to have visited ${url} but no browser_navigate to that domain exists. This data may be hallucinated.`);
              }
            } catch (_) {}
          }
        }
        // Check: claims completion but no work done
        const claimsComplete = /(?:completed|finished|done|all tasks? (?:are )?(?:complete|done)|here(?:'s| is) the (?:final|complete))/i.test(responseText);
        if (claimsComplete && executionState.dataExtracted.length === 0 && executionState.filesCreated.length === 0 && allToolResults.length === 0) {
          warnings.push(`VERIFICATION FAILURE: You claim the task is complete but no data was extracted and no files were created.`);
        }
        // Check: specific data cited but no extraction performed
        const hasSpecificData = /\$[\d,.]+|[\d,]+\s*(?:users|results|items|products|reviews|ratings|stars|votes)/i.test(responseText);
        if (hasSpecificData && executionState.dataExtracted.length === 0 && executionState.searchesPerformed.length === 0) {
          warnings.push(`VERIFICATION WARNING: You're citing specific data but no extraction tools have been used.`);
        }
        return warnings;
      };

      // Build execution state summary for context injection
      const getExecutionStateSummary = () => {
        const parts = [];
        if (executionState.urlsVisited.length > 0) {
          const recent = executionState.urlsVisited.slice(-5);
          parts.push(`URLs visited: ${recent.map(v => `${v.success ? '✓' : '✗'} ${v.url}`).join(', ')}`);
        }
        if (executionState.filesCreated.length > 0) {
          parts.push(`Files created: ${executionState.filesCreated.map(f => f.path).join(', ')}`);
        }
        if (executionState.domainsBlocked.size > 0) {
          parts.push(`BLOCKED domains (do NOT retry): ${[...executionState.domainsBlocked].join(', ')}`);
        }
        const problemDomains = Object.entries(domainAttempts).filter(([_, i]) => i.failures >= 2).map(([d, i]) => `${d}: ${i.failures}/${i.attempts} failures`);
        if (problemDomains.length > 0) parts.push(`Problem domains: ${problemDomains.join(', ')}`);
        return parts.length > 0 ? `\n[EXECUTION STATE]\n${parts.join('\n')}\n` : '';
      };

      // Structured conversation summarizer — survives context rotations
      const summarizer = new ConversationSummarizer();
      summarizer.setGoal(message);
      
      // Detect browser intent from user message BEFORE the first iteration
      // so the nudge logic can trigger even when no browser tools have been used yet
      const browserIntentPattern = /\b(go\s+to|navigate\s+to|open|visit|browse|load|show\s+me|check\s+out|head\s+to|pull\s+up)\b.*\b([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b|\bhttps?:\/\/|\bwww\./i;
      const userWantsBrowser = browserIntentPattern.test(message);
      if (userWantsBrowser) {
        console.log('[AI Chat] Browser intent detected in user message');
      }

      // currentPrompt lives outside the loop so subsequent iterations can use the value set at end of prior iteration
      let webSearchInstruction = '';
      if (context?.webSearch) {
        webSearchInstruction = '## Web Search Enabled\nThe user has enabled web search. Use the `web_search` tool to find up-to-date information from the internet to help answer their question. Search first, then respond with what you find.\n\n';
      }
      // If browser intent detected, prepend a strong instruction to use browser_navigate
      let browserInstruction = '';
      let expectedBrowserUrl = null;
      if (userWantsBrowser) {
        // Extract URL from the message
        const urlMatch = message.match(/(?:https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|co|dev|app|me|info|biz|us|uk|ca|au|de|fr|jp|cn|in|br|ru|mx|es|it|nl|se|no|dk|fi|pl|cz|at|ch|be|ie|pt|gr|hu|ro|bg|hr|si|sk|lt|lv|ee|is|lu|mt|cy|li|mc|sm|ad|va|maine\.edu)[^\s]*)/i);
        const detectedUrl = urlMatch ? urlMatch[0] : null;
        if (detectedUrl) {
          const fullUrl = detectedUrl.startsWith('http') ? detectedUrl : `https://${detectedUrl}`;
          expectedBrowserUrl = fullUrl;
          browserInstruction = `\n\n## CRITICAL INSTRUCTION\nThe user wants you to navigate to a website. You MUST call the browser_navigate tool IMMEDIATELY with this URL: ${fullUrl}\nDo NOT read local files. Do NOT describe the project. Do NOT do anything else first. Just call browser_navigate NOW.\nOutput EXACTLY this:\n\`\`\`json\n{"tool": "browser_navigate", "params": {"url": "${fullUrl}"}}\n\`\`\`\n\n`;
        }
      }
      // Build structured prompt with proper system/user role separation
      // systemContext = tool defs + memory + RAG + file context (goes in system message)
      // userMessage = the actual user request (goes in user message)
      let currentPrompt = {
        // Put the browser "CRITICAL INSTRUCTION" first so it isn't buried
        // under large tool prompts (improves compliance for small/finicky models).
        systemContext: basePrompt,
        userMessage: buildDynamicContext() + browserInstruction + webSearchInstruction + message
      };

      // If the renderer provided conversation history (e.g., after a model switch or session reset),
      // seed the local LLM history so short follow-ups like "continue" remain coherent.
      // Only do this when the local session is effectively fresh.
      try {
        if (Array.isArray(context?.conversationHistory) && context.conversationHistory.length > 0) {
          const isFreshSession = !llmEngine.chatHistory || llmEngine.chatHistory.length <= 1;
          if (isFreshSession) {
            const seeded = [{ type: 'system', text: llmEngine._getActiveSystemPrompt() }];
            for (const m of context.conversationHistory) {
              if (!m || typeof m.content !== 'string') continue;
              if (m.role === 'user') seeded.push({ type: 'user', text: m.content });
              else if (m.role === 'assistant') seeded.push({ type: 'model', response: [m.content] });
            }
            llmEngine.chatHistory = seeded;
            llmEngine.lastEvaluation = null;
            console.log(`[AI Chat] Seeded local chatHistory from renderer (${seeded.length - 1} turns)`);
          }
        }
      } catch (e) {
        console.warn('[AI Chat] Failed to seed local conversation history:', e?.message || e);
      }

      memoryStore.addConversation('user', message);

      // ── Model Capability Tiering ──
      // modelTier already computed above (for prompt budget calculation)
      console.log(`[AI Chat] Model: ${modelProfile._meta.profileSource} (${modelTier.paramSize}B ${modelTier.family}) — tools=${modelTier.maxToolsPerPrompt}, grammar=${modelTier.grammarAlwaysOn ? 'always' : 'limited'}, retry=${modelTier.retryBudget}, quirks=${JSON.stringify(modelProfile.quirks)}`);

      // NOTE: Behavioral priming was removed — injecting fake tool-calling history
      // caused models of all sizes to force tool use on non-tool tasks (e.g., greetings
      // classified as 'general' would trigger unnecessary web_search calls).

      // ── Transactional Rollback State ──
      let rollbackRetries = 0;
      const maxRollbackRetries = modelTier.retryBudget;

      let nonContextRetries = 0;
      let lastIterationResponse = ''; // Track for repetition detection
      // For chat/greeting tasks, only 1 iteration (no agentic loop)
      // Always allow full iterations — even for 'chat' tasks, the model may need tools.
      // Previously this was gated to 1 iteration for chat, which prevented tool use entirely.
      const effectiveMaxIterations = MAX_AGENTIC_ITERATIONS;
      // Seamless continuation counter — tracks how many times we've continued a
      // truncated response in the same bubble. Reset to 0 each new user message.
      let continuationCount = 0;
      while (iteration < effectiveMaxIterations) {
        // Check if user cancelled or a newer request superseded us
        if (isStale()) {
          console.log('[AI Chat] Request superseded or cancelled, breaking agentic loop');
          if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Interrupted]*');
          break;
        }
        // Wait if paused (live takeover)
        await waitWhilePaused();
        iteration++;
        console.log(`[AI Chat] Agentic iteration ${iteration}/${MAX_AGENTIC_ITERATIONS}`);
        
        console.log(`[AI Chat] Prompt: ~${estimateTokens(typeof currentPrompt === 'string' ? currentPrompt : (currentPrompt.systemContext || '') + (currentPrompt.userMessage || ''))} tokens`);

        // ── PROACTIVE PRE-GENERATION CONTEXT CHECK ──
        // Before generating, estimate context usage. If it's already high (>60%),
        // proactively compact BEFORE the generation call instead of waiting for
        // the post-generation check. This prevents context overflow errors that
        // waste an entire generation cycle.
        if (iteration > 1) {
          try {
            let preGenContextUsed = 0;
            try {
              if (llmEngine.sequence?.nTokens) preGenContextUsed = llmEngine.sequence.nTokens;
            } catch (_) {}
            if (!preGenContextUsed) {
              const promptLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
              preGenContextUsed = Math.ceil((promptLen + fullResponseText.length) / 4);
            }
            const preGenPct = preGenContextUsed / totalCtx;
            if (preGenPct > 0.60) {
              const preCompaction = progressiveContextCompaction({
                contextUsedTokens: preGenContextUsed,
                totalContextTokens: totalCtx,
                allToolResults,
                chatHistory: llmEngine.chatHistory,
                fullResponseText,
              });
              if (preCompaction.pruned > 0) {
                fullResponseText = preCompaction.newFullResponseText;
                console.log(`[AI Chat] Pre-generation compaction: phase ${preCompaction.phase}, ${preCompaction.pruned} items at ${Math.round(preGenPct * 100)}%`);
              }
              if (preCompaction.shouldRotate && contextRotations < MAX_CONTEXT_ROTATIONS) {
                contextRotations++;
                console.log(`[AI Chat] Pre-generation rotation ${contextRotations}/${MAX_CONTEXT_ROTATIONS}`);
                summarizer.markRotation();
                lastConvSummary = summarizer.generateQuickSummary();
                await llmEngine.resetSession(true);
                sessionJustRotated = true;
                const rotatedBase = buildStaticPrompt();
                currentPrompt = {
                  systemContext: rotatedBase,
                  userMessage: buildDynamicContext() + '\n' + lastConvSummary + `\nContext was rotated. The current user request is: ${message.substring(0, 300)}${message.length > 300 ? '...' : ''}`
                };
              }
            }
          } catch (_) {}
        }

        // Send iteration progress to UI
        if (mainWindow && iteration > 1) {
          mainWindow.webContents.send('agentic-progress', { iteration, maxIterations: MAX_AGENTIC_ITERATIONS });
        }

        // Generate response
        let result;
        let nativeFunctionCalls = []; // From grammar-constrained generation
        // Chat mode: give the model more response room for explanations/conversation.
        // Response budget derived from ModelProfile context settings.
        // Agentic mode: use the profile's responseReservePct.
        const chatResponseBudget = Math.min(Math.floor(totalCtx * 0.50), modelProfile.context.maxResponseTokens);
        // FIX 1: Cap effectiveMaxTokens against profile safety limits.
        // The UI default is 16384 — larger than many loaded n_ctx values.
        // Without the Math.min, the profile budget is computed but silently ignored,
        // causing prompt+maxTokens > n_ctx overflow before any token is generated.
        let effectiveMaxTokens = taskType === 'chat'
          ? Math.min(context?.params?.maxTokens || chatResponseBudget, chatResponseBudget)
          : Math.min(context?.params?.maxTokens || maxResponseTokens, maxResponseTokens);

        // ── Decide: Native Function Calling vs Legacy Text Parsing ──
        // Native function calling uses node-llama-cpp's grammar-constrained decoding
        // to FORCE valid tool calls. The model literally cannot produce invalid JSON,
        // wrong tool names, or malformed parameters. This is the key reliability improvement.
        //
        // ARCHITECTURAL CHANGE: Grammar constraining is now tier-aware.
        // - tiny/small/medium models (≤8B): grammar ON for ALL agentic iterations
        // - large models (8-14B): grammar ON for first 5 iterations
        // - xlarge models (14B+): grammar ON for first 2 iterations (original behavior)
        // The model can still output free text even with grammar constraining enabled —
        // the grammar only ensures that WHEN tool calls are made, they're structurally valid.
        const grammarIterLimit = modelTier.grammarAlwaysOn ? Infinity
          : modelTier.tier === 'large' ? 5 : 2;
        const useNativeFunctions = (taskType !== 'chat') && iteration <= grammarIterLimit;
        let nativeFunctions = null;
        if (consecutiveEmptyGrammarRetries >= 1) {
          // Grammar-to-text fallback: model can't produce grammar output, degrade gracefully.
          // Threshold lowered to 1 — the second native function call attempt can hang at the
          // C++ level and never return. One failure is enough to switch to text mode safely.
          nativeFunctions = null;
          forcedToolFunctions = null;
          console.log(`[AI Chat] Grammar disabled — falling back to text mode after ${consecutiveEmptyGrammarRetries} consecutive empty grammar responses`);
        } else if (forcedToolFunctions) {
          // PILLAR 3 refusal recovery: override normal grammar with forced tool set
          nativeFunctions = forcedToolFunctions;
          forcedToolFunctions = null; // One-shot: clear after use
          console.log(`[AI Chat] Using FORCED function calling with ${Object.keys(nativeFunctions).length} functions (refusal recovery)`);
        } else if (useNativeFunctions) {
          try {
            const toolDefs = mcpToolServer.getToolDefinitions();
            // ── Progressive Tool Disclosure ──
            // Instead of giving the model ALL tools, narrow the decision space
            // based on task type, iteration, and what tools have been used recently.
            // Turns a 30-way decision into a 5-10 way decision for small models.
            const recentToolNames = (recentToolCalls || []).map(tc => tc.tool);
            const filterNames = getProgressiveTools(taskType, iteration, recentToolNames, modelTier.maxToolsPerPrompt);
            nativeFunctions = LLMEngine.convertToolsToFunctions(toolDefs, filterNames);
            console.log(`[AI Chat] Using native function calling with ${Object.keys(nativeFunctions).length} functions (tier=${modelTier.tier}, iter=${iteration}/${grammarIterLimit === Infinity ? '∞' : grammarIterLimit})`);
          } catch (e) {
            console.warn(`[AI Chat] Failed to build native functions, falling back to text: ${e.message}`);
            nativeFunctions = null;
          }
        }

        // ── Transactional Checkpoint ──
        // Save context state BEFORE generation so we can rollback on failure.
        // The model never sees its own failures — from its perspective, every step succeeded.
        const checkpoint = {
          chatHistory: llmEngine.chatHistory ? llmEngine.chatHistory.map(h => ({ ...h })) : null,
          lastEvaluation: llmEngine.lastEvaluation,
        };

        try {
          // Signal UI to record current stream buffer length as iteration start offset.
          // This allows llm-replace-last to preserve prior iterations' text when cleaning fences.
          if (mainWindow) mainWindow.webContents.send('llm-iteration-begin');
          const localTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: 25, maxBufferChars: 2048 });
          const localThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });
          try {
            if (nativeFunctions && Object.keys(nativeFunctions).length > 0) {
              // ── NATIVE FUNCTION CALLING PATH ──
              // Grammar-constrained: model can only produce valid tool calls
              const nativeResult = await llmEngine.generateWithFunctions(
                currentPrompt,
                nativeFunctions,
                { ...(context?.params || {}), maxTokens: effectiveMaxTokens },
                (token) => {
                  if (isStale()) { llmEngine.cancelGeneration('user'); return; }
                  localTokenBatcher.push(token);
                },
                (thinkToken) => {
                  if (isStale()) { llmEngine.cancelGeneration('user'); return; }
                  localThinkingBatcher.push(thinkToken);
                },
                (funcCall) => {
                  // Tool execution is visualized via the tool-executing IPC event (sendToolExecutionEvents),
                  // which drives the ToolCallGroup in the renderer. Injecting raw JSON into the
                  // llm-token text stream caused duplicate code bubbles when parseToolCall failed
                  // on aliased or alternate-format tool calls from small models. Suppressed here.
                  void funcCall;
                }
              );
              result = nativeResult;
              nativeFunctionCalls = nativeResult.functionCalls || [];
              if (nativeFunctionCalls.length > 0) {
                console.log(`[AI Chat] Native function calling produced ${nativeFunctionCalls.length} tool call(s): ${nativeFunctionCalls.map(f => f.functionName).join(', ')}`);
              }
            } else {
              // ── LEGACY TEXT PARSING PATH ──
              result = await llmEngine.generateStream(currentPrompt, {
                ...(context?.params || {}),
                maxTokens: effectiveMaxTokens,
              }, (token) => {
                if (isStale()) { llmEngine.cancelGeneration('user'); return; }
                localTokenBatcher.push(token);
              }, (thinkToken) => {
                if (isStale()) { llmEngine.cancelGeneration('user'); return; }
                localThinkingBatcher.push(thinkToken);
              });
            }
          } finally {
            localTokenBatcher.dispose();
            localThinkingBatcher.dispose();
          }
        } catch (genError) {
          // Context overflow or generation error — attempt seamless rotation
          console.error(`[AI Chat] Generation error on iteration ${iteration}:`, genError.message);
          
          // Handle CONTEXT_OVERFLOW from llmEngine (it already reset the session)
          // Also treat the node-llama-cpp "default context shift strategy" error as a context overflow —
          // it is a context overflow but is not prefixed with CONTEXT_OVERFLOW:.
          const isContextOverflow = genError.message?.startsWith('CONTEXT_OVERFLOW:') ||
            genError.message?.includes('default context shift strategy did not return') ||
            genError.message?.includes('context size is too small');

          // Only rotate context on actual context overflow. Previously, ANY generation
          // error could trigger rotation, which looked like the app was "summarizing"
          // on the very first turn.
          if (isContextOverflow && contextRotations < MAX_CONTEXT_ROTATIONS) {
            // ── FIRST-TURN OVERFLOW DETECTION ──
            // If no tool calls have been made (completedSteps === 0), there's nothing to
            // summarize. Rotation is pointless — the rebuilt prompt will be the same size.
            // Instead: reduce the response budget and retry once. If that also overflows,
            // break cleanly instead of looping 10 times through empty summaries.
            if (summarizer.completedSteps.length === 0 && !overflowResponseBudgetReduced) {
              overflowResponseBudgetReduced = true;
              contextRotations++;
              // FIX 2: Actually reduce effectiveMaxTokens so the retry is not identical to the
              // failed attempt. Previous code set a flag but never changed the budget, so the
              // retry would overflow with exactly the same arithmetic every time.
              effectiveMaxTokens = Math.max(Math.floor(effectiveMaxTokens / 2), Math.min(512, maxResponseTokens));
              console.log(`[AI Chat] First-turn overflow — reducing response budget to ${effectiveMaxTokens} tokens and retrying.`);
              if (genError.partialResponse) fullResponseText += genError.partialResponse;
              try { await llmEngine.resetSession(true); } catch (_) {}
              sessionJustRotated = true;
              const rotatedBase = buildStaticPrompt();
              // Fix C: use 10% of prompt budget for dynamic context on retry — drops memory/RAG/file
              // context but keeps tools and preamble fully intact. Prevents repeat overflow on
              // small-context models without touching the model's tool access.
              // Fix D: if partial content was generated before the overflow, inject it so the model
              // continues from where it left off rather than restarting the response from scratch.
              const _firstTurnPartial = fullResponseText.trim().length > 0
                ? fullResponseText.substring(Math.max(0, fullResponseText.length - 1500))
                : '';
              const _firstTurnHint = _firstTurnPartial
                ? `\n\nYou were generating a response and the context was reset due to size constraints. Here is the end of what you wrote:\n---\n${_firstTurnPartial}\n---\nContinue directly from where you left off without repeating what you already wrote.`
                : '';
              currentPrompt = {
                systemContext: rotatedBase,
                userMessage: buildDynamicContext(undefined, Math.floor(maxPromptTokens * 0.10)) + '\n' + message + _firstTurnHint
              };
              continue;
            }
            if (summarizer.completedSteps.length === 0 && overflowResponseBudgetReduced) {
              console.log(`[AI Chat] First-turn overflow persists after budget reduction — context too small for this prompt.`);
              const overflowMsg = '\n\n*[The context size is too small to generate a response for this prompt. Try a shorter message or a model with more context capacity.]*\n';
              if (mainWindow) mainWindow.webContents.send('llm-token', overflowMsg);
              fullResponseText += overflowMsg;
              break;
            }
            contextRotations++;
            console.log(`[AI Chat] Context rotation ${contextRotations}/${MAX_CONTEXT_ROTATIONS} — summarizing and continuing`);
            // Do NOT send rotation status via llm-thinking-token — internal detail that pollutes the reasoning panel (see line 1610 comment).
            
            try {
              // Use structured summarizer instead of lossy getConversationSummary
              summarizer.markRotation();
              const convSummary = summarizer.generateSummary({ maxTokens: Math.min(Math.floor(totalCtx * 0.25), 3000) });
              
              if (isContextOverflow) {
                // Preserve any partial response
                if (genError.partialResponse) {
                  fullResponseText += genError.partialResponse;
                }
              } else {
                await llmEngine.resetSession(true);
              }
              
              // Show the summary content in the thinking bubble so the user can see it
              if (convSummary && mainWindow) {
                // Strip tool-call code blocks from the summary before sending to the thinking bubble.
                // The auto-generated summary includes raw tool call JSON fences (e.g. ```json {...}) which
                // bleed into the model's reasoning panel as visible ```json artifacts.
                const thinkableSummary = convSummary
                  .replace(/```(?:json|tool_call|tool)[^\n]*\n[\s\S]*?```/g, '');
                mainWindow.webContents.send('llm-thinking-token', thinkableSummary + '\n[Context rotated — continuing seamlessly]\n');
              }
              
              if (!llmEngine.chat) {
                // Re-create chat — guard against disposed context
                if (!llmEngine.context) {
                  // Context was fully disposed — try to recreate from the model
                  console.warn('[AI Chat] Context is null after reset, attempting full context recreation...');
                  try {
                    if (llmEngine.model) {
                      llmEngine.context = await llmEngine.model.createContext();
                      console.log('[AI Chat] Context recreated from model');
                    } else {
                      console.error('[AI Chat] Model is also null — cannot recover');
                      const fatalMsg = '\n\n*[Session expired. Starting fresh — please resend your request.]*\n';
                      if (mainWindow) mainWindow.webContents.send('llm-token', fatalMsg);
                      fullResponseText += fatalMsg;
                      break;
                    }
                  } catch (ctxErr) {
                    console.error('[AI Chat] Context recreation from model failed:', ctxErr.message);
                    const fatalMsg = '\n\n*[Session expired. Starting fresh — please resend your request.]*\n';
                    if (mainWindow) mainWindow.webContents.send('llm-token', fatalMsg);
                    fullResponseText += fatalMsg;
                    break;
                  }
                }
                try {
                  const { LlamaChat } = await import(getNodeLlamaCppPath());
                  llmEngine.sequence = llmEngine.context.getSequence(
                    llmEngine.tokenPredictor ? { tokenPredictor: llmEngine.tokenPredictor } : undefined
                  );
                  llmEngine.chat = new LlamaChat({ contextSequence: llmEngine.sequence });
                  llmEngine.chatHistory = [{ type: 'system', text: llmEngine._getActiveSystemPrompt() }];
                  llmEngine.lastEvaluation = null;
                } catch (sessErr) {
                  console.error('[AI Chat] Chat recreation failed:', sessErr.message);
                  // Last resort: try disposing and recreating context entirely
                  try {
                    if (llmEngine.model) {
                      if (llmEngine.context) { try { llmEngine.context.dispose(); } catch (_) {} }
                      llmEngine.context = await llmEngine.model.createContext();
                      const { LlamaChat } = await import(getNodeLlamaCppPath());
                      llmEngine.sequence = llmEngine.context.getSequence(
                        llmEngine.tokenPredictor ? { tokenPredictor: llmEngine.tokenPredictor } : undefined
                      );
                      llmEngine.chat = new LlamaChat({ contextSequence: llmEngine.sequence });
                      llmEngine.chatHistory = [{ type: 'system', text: llmEngine._getActiveSystemPrompt() }];
                      llmEngine.lastEvaluation = null;
                      console.log('[AI Chat] Full context+chat recreated as last resort');
                    } else {
                      throw new Error('Model not available');
                    }
                  } catch (lastResortErr) {
                    const fatalMsg = '\n\n*[Session expired. Please resend your request.]*\n';
                    if (mainWindow) mainWindow.webContents.send('llm-token', fatalMsg);
                    fullResponseText += fatalMsg;
                    break;
                  }
                }
              }
              
              const rotatedBase = buildStaticPrompt();
              // Fix D: include the end of what was generated so far so the model continues
              // seamlessly rather than restarting the response after context rotation.
              const _rotationPartial = fullResponseText.trim().length > 0
                ? fullResponseText.substring(Math.max(0, fullResponseText.length - 1500))
                : '';
              const _rotationHint = _rotationPartial
                ? `\n\nYou were generating a response and context was rotated. Here is the end of what you wrote:\n---\n${_rotationPartial}\n---\nContinue directly from where you left off without repeating what you already wrote.`
                : `\nContext was rotated. The current user request is: ${message.substring(0, 300)}${message.length > 300 ? '...' : ''}`;
              currentPrompt = {
                systemContext: rotatedBase,
                userMessage: buildDynamicContext() + '\n' + convSummary + _rotationHint
              };
              sessionJustRotated = true;
              lastConvSummary = convSummary;
              continue;
            } catch (resetErr) {
              console.error('[AI Chat] Context rotation failed:', resetErr.message);
            }
          }
          // Context overflow with no rotations remaining — stop cleanly.
          // Do NOT fall through to nonContextRetries which would send the raw CONTEXT_OVERFLOW
          // error message (including the entire conversation summary) as visible llm-token text.
          if (isContextOverflow) {
            const overflowMsg = '\n\n*[This conversation has exceeded the model\'s context limit. Please start a new chat to continue.]*\n';
            if (mainWindow) mainWindow.webContents.send('llm-token', overflowMsg);
            fullResponseText += overflowMsg;
            break;
          }

          // Non-context errors (e.g., 504 gateway timeout) — DON'T wipe the response
          // Show error as inline note, don't break the conversation
          
          // Fatal errors that won't resolve with retries — break immediately
          const fatalPatterns = ['model not loaded', 'object is disposed', 'model is disposed', 'session is disposed', 'context is disposed'];
          const errLower = (genError.message || '').toLowerCase();
          const isFatal = fatalPatterns.some(pat => errLower.includes(pat));
          
          if (isFatal) {
            const fatalMsg = `\n\n*[Generation stopped: ${genError.message.substring(0, 200)}. Please reload the model.]*\n`;
            if (mainWindow) mainWindow.webContents.send('llm-token', fatalMsg);
            fullResponseText += fatalMsg;
            break; // Don't retry fatal errors
          }
          
          // Track non-context error retries to prevent infinite loops
          if (!nonContextRetries) nonContextRetries = 0;
          nonContextRetries++;
          
          if (nonContextRetries > 2) {
            const giveUpMsg = `\n\n*[Generation error: ${genError.message.substring(0, 200)}. Giving up after ${nonContextRetries} retries.]*\n`;
            if (mainWindow) mainWindow.webContents.send('llm-token', giveUpMsg);
            fullResponseText += giveUpMsg;
            break;
          }
          
          const errMsg = `\n\n*[Generation error: ${genError.message.substring(0, 200)}. Retrying (${nonContextRetries}/2)...]*\n`;
          if (mainWindow) mainWindow.webContents.send('llm-token', errMsg);
          fullResponseText += errMsg;
          
          // For non-context errors, try once more before giving up
          if (iteration < MAX_AGENTIC_ITERATIONS - 1) {
            continue; // Retry the iteration
          }
          break;
        }

        // Send context usage after generation
        try {
          const total = totalCtx;
          let used = 0;
          // Use the existing sequence reference — do NOT call context.getSequence()
          // which creates a NEW sequence and wastes resources
          try {
            if (llmEngine.sequence?.nTokens) used = llmEngine.sequence.nTokens;
          } catch (_) {}
          // Cheap fallback: estimate from prompt + response length (no JSON.stringify)
          if (!used) {
            const promptLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
            used = Math.ceil((promptLen + (result.text || '').length) / 4);
          }
          if (mainWindow) {
            mainWindow.webContents.send('context-usage', { used, total });
          }
        } catch (_) {}

        const responseText = result.text || '';

        // Issue C: If the 120s generation timeout fired mid-synthesis, commit the partial response
        // rather than letting it hit retry/nudge logic. The classifier no longer has truncation
        // detection, so this is mainly a safeguard for future classifier additions.
        const _timedOut = llmEngine._lastAbortReason === 'timeout';
        if (_timedOut) llmEngine._lastAbortReason = null;

        // ── Transactional Rollback Evaluation ──
        // Evaluate the response BEFORE committing it to context.
        // If it's a failure (refusal, hallucination, empty), rollback and retry.
        // The model never sees its own failures — no failure contagion.
        const responseVerdict = (_timedOut && responseText.length > 50)
          ? { verdict: 'COMMIT', reason: 'timeout_commit' }
          : evaluateResponse(responseText, nativeFunctionCalls, taskType, iteration);
        if (responseVerdict.verdict === 'ROLLBACK' && rollbackRetries < maxRollbackRetries) {
          rollbackRetries++;
          // Track consecutive empty grammar failures for text-mode fallback
          if (responseVerdict.reason === 'empty' && nativeFunctions) {
            consecutiveEmptyGrammarRetries++;
            console.log(`[AI Chat] Empty grammar response (${consecutiveEmptyGrammarRetries} consecutive)`);
          } else {
            consecutiveEmptyGrammarRetries = 0; // Reset on non-empty or non-grammar failure
          }
          console.log(`[AI Chat] ⚠️ ROLLBACK (${responseVerdict.reason}) — retry ${rollbackRetries}/${maxRollbackRetries}, restoring checkpoint`);
          // Clear any streamed tokens from this failed attempt before the retry renders
          const _rollbackWin = ctx.getMainWindow();
          if (_rollbackWin && !_rollbackWin.isDestroyed()) _rollbackWin.webContents.send('llm-stream-reset');
          // Do NOT send retry status as llm-thinking-token — internal detail that pollutes the reasoning dropdown.

          // Restore checkpoint — model never sees its failure
          if (checkpoint.chatHistory) {
            llmEngine.chatHistory = checkpoint.chatHistory;
            llmEngine.lastEvaluation = checkpoint.lastEvaluation;
          }

          // Escalating retry strategy
          if (rollbackRetries === 1) {
            // First retry: same prompt, slightly lower temperature for focus
            if (context?.params) context.params.temperature = Math.max((context.params.temperature || 0.7) - 0.2, 0.1);
          } else if (rollbackRetries === 2) {
            // Second retry: same as first (temperature already reduced)
          } else {
            // Third+ retry: force grammar-constrained with all available tools
            // MUST use forcedToolFunctions (outer-scope flag) because `continue` restarts
            // the loop and the grammar setup at the top would overwrite nativeFunctions.
            try {
              const toolDefs = mcpToolServer.getToolDefinitions();
              forcedToolFunctions = LLMEngine.convertToolsToFunctions(toolDefs, null);
              console.log(`[AI Chat] Forced grammar with all ${Object.keys(forcedToolFunctions).length} tools for retry ${rollbackRetries}`);
            } catch (_) {}
          }

          // Don't increment iteration — this is a retry of the same step
          iteration--;
          continue;
        }
        // Reset rollback counter on successful response
        if (responseVerdict.verdict === 'COMMIT') {
          rollbackRetries = 0;
          consecutiveEmptyGrammarRetries = 0;
        }

        fullResponseText += responseText;
        // Strip tool-call JSON fences from the user-visible copy before accumulating.
        // fullResponseText (fed back to the model for context) keeps the raw text.
        // displayResponseText (committed to the chat message) should only have natural language.
        // Targets: ```tool_call```, ```tool```, and ```json``` whose root object is a tool call.
        const displayChunk = responseText
          .replace(/```(?:tool_call|tool)[^\n]*\n[\s\S]*?```/g, '')
          .replace(/```json[^\n]*\n\s*(?:\[\s*)?\{\s*"(?:tool|name)"\s*:[\s\S]*?```/g, '')
          .replace(/\n{3,}/g, '\n\n');
        displayResponseText += displayChunk;

        // ── SEAMLESS CONTINUATION ──
        // If generation stopped because maxTokens was hit (not a natural EOS), and no tool
        // calls were returned, loop back and continue generating into the SAME open bubble.
        // The UI sees one uninterrupted stream throughout. Guard: max 3 continuations.
        const _wasTruncated = (result?.stopReason === 'maxTokens' || result?.stopReason === 'max-tokens')
          && nativeFunctionCalls.length === 0
          && !_timedOut
          && !isStale();
        if (_wasTruncated && continuationCount < 3) {
          continuationCount++;
          console.log(`[AI Chat] Seamless continuation ${continuationCount}/3 — response hit maxTokens, continuing in same bubble`);
          iteration--; // Continuation is not a new agentic step
          currentPrompt = {
            systemContext: currentPrompt.systemContext, // Unchanged — KV cache preserved
            userMessage: '[Continue your response exactly where you left off. Output only the continuation — no preamble, no summary, no repeated content.]',
          };
          continue;
        }
        // Natural stop or max continuations reached — reset counter for next response
        if (!_wasTruncated) continuationCount = 0;

        // Check stale after generation — user may have sent a new message during inference
        if (isStale()) {
          console.log('[AI Chat] Request superseded after generation, exiting loop');
          break;
        }

        // Let summarizer detect task plans from model response (numbered steps, checklists)
        if (responseText.length > 50) {
          summarizer.recordPlan(responseText);
        }

        // ── PILLAR 5: Progressive Context Compaction ──
        // Single unified system replaces the two separate pruning passes + hard rotation.
        // Operates in 4 phases based on context usage: compress tool results → prune history
        // → aggressive compaction → hard rotation (last resort only).
        try {
          let contextUsed = 0;
          try {
            if (llmEngine.sequence?.nTokens) contextUsed = llmEngine.sequence.nTokens;
          } catch (_) {}
          if (!contextUsed) {
            const promptLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
            contextUsed = Math.ceil((promptLen + fullResponseText.length) / 4);
          }

          const compaction = progressiveContextCompaction({
            contextUsedTokens: contextUsed,
            totalContextTokens: totalCtx,
            allToolResults,
            chatHistory: llmEngine.chatHistory,
            fullResponseText,
          });

          // Apply compaction results
          if (compaction.pruned > 0) {
            fullResponseText = compaction.newFullResponseText;
            // Do NOT send compaction status via llm-thinking-token — pollutes reasoning panel.
          }

          // Phase 4: Hard rotation as absolute last resort
          if (compaction.shouldRotate && contextRotations < MAX_CONTEXT_ROTATIONS) {
            contextRotations++;
            console.log(`[AI Chat] Context rotation ${contextRotations}/${MAX_CONTEXT_ROTATIONS} at ${Math.round((contextUsed / totalCtx) * 100)}% (compaction phase 4)`);
            // Do NOT send context% status via llm-thinking-token — pollutes reasoning panel.
            
            summarizer.markRotation();
            lastConvSummary = summarizer.generateQuickSummary();
            
            if (lastConvSummary && mainWindow) {
              const thinkableSummary = lastConvSummary
                .replace(/```(?:json|tool_call|tool)[^\n]*\n[\s\S]*?```/g, '');
              mainWindow.webContents.send('llm-thinking-token', thinkableSummary + '\n[Context rotated — continuing seamlessly]\n');
            }
            
            await llmEngine.resetSession(true);
            sessionJustRotated = true;
          }

          // Update context usage for UI
          if (mainWindow) {
            mainWindow.webContents.send('context-usage', { used: contextUsed, total: totalCtx });
          }
        } catch (_) {}

        // Process tool calls — prefer native function calls, fallback to text parsing
        const localToolPace = context?.cloudProvider ? 0 : 50;
        let toolResults;

        if (nativeFunctionCalls.length > 0) {
          // ── UNIFIED TOOL PIPELINE: Native function calls ──
          // Grammar-constrained generation guarantees valid JSON format, but the CONTENT
          // can still have issues: empty write_file params, stale browser refs, etc.
          // Route through the SAME repair→cap→dedup pipeline as text-parsed calls.
          // This is pure JS post-processing — zero latency impact on generation.
          console.log(`[AI Chat] Processing ${nativeFunctionCalls.length} native function call(s) through unified pipeline`);

          // Step 1: Normalize to the same {tool, params} format processResponse uses
          let unifiedCalls = nativeFunctionCalls.map(fc => ({
            tool: fc.functionName,
            params: fc.params || {},
          }));

          // Step 2: Repair — recover empty write_file content, fix URLs, drop unrecoverable calls
          const { repaired, issues } = repairToolCallsFn(unifiedCalls, responseText);
          if (issues.length > 0) {
            console.log(`[AI Chat] Unified pipeline repair: ${issues.length} issue(s) fixed/dropped`);
          }
          unifiedCalls = repaired;

          // Step 3: Dedup — remove identical calls within same response
          {
            const seen = new Set();
            const deduped = [];
            for (const call of unifiedCalls) {
              const sig = `${call.tool}:${JSON.stringify(call.params)}`;
              if (!seen.has(sig)) { seen.add(sig); deduped.push(call); }
            }
            unifiedCalls = deduped;
          }

          // Step 4: Browser cap — max 2 state-changing browser actions per turn
          const BROWSER_STATE_CHANGERS = new Set([
            'browser_navigate', 'browser_click', 'browser_type', 'browser_select',
            'browser_select_option', 'browser_press_key', 'browser_back',
            'browser_fill_form', 'browser_drag', 'browser_file_upload',
          ]);
          let browserStateChanges = 0;
          let browserSkipped = 0;
          const cappedCalls = [];
          for (const call of unifiedCalls) {
            if (BROWSER_STATE_CHANGERS.has(call.tool) && browserStateChanges >= 2) {
              browserSkipped++;
              console.log(`[AI Chat] Browser cap: skipping ${call.tool} (refs are stale after ${browserStateChanges} state changes)`);
              continue;
            }
            cappedCalls.push(call);
            if (BROWSER_STATE_CHANGERS.has(call.tool)) browserStateChanges++;
          }
          unifiedCalls = cappedCalls;

          // Step 5: Write deferral — same logic as processResponse
          // Prevents fabricated writes when grammar path co-batches gather+write
          const DATA_GATHER_TOOLS = new Set(['browser_navigate','browser_snapshot','browser_click','browser_type','browser_evaluate','browser_get_content','web_search','fetch_webpage']);
          const DATA_WRITE_TOOLS = new Set(['write_file', 'edit_file']);
          const batchHasGather = unifiedCalls.some(c => DATA_GATHER_TOOLS.has(c.tool));
          const batchHasWrite = unifiedCalls.some(c => DATA_WRITE_TOOLS.has(c.tool));
          // Tiny models (0.6B) always co-batch search+write and can't retry after deferral.
          // Let writes through — fabrication auto-correction will fix content with real data.
          const shouldDeferNativeWrites = batchHasGather && batchHasWrite && modelTier.tier !== 'tiny';
          if (shouldDeferNativeWrites) {
            console.log('[AI Chat] Native pipeline write deferral: batch has gather+write — deferring writes');
          }

          // Step 6: Execute through the same executeTool as text-parsed path
          const results = [];
          for (const call of unifiedCalls) {
            if (localToolPace > 0 && results.length > 0) {
              await new Promise(r => setTimeout(r, localToolPace));
            }
            try {
              // Normalize params same as processResponse does
              if (call.tool.startsWith('browser_')) call.params = mcpToolServer._normalizeBrowserParams(call.tool, call.params);
              else call.params = mcpToolServer._normalizeFsParams(call.tool, call.params);
              // Write deferral: skip writes when co-batched with data-gathering tools
              if (shouldDeferNativeWrites && DATA_WRITE_TOOLS.has(call.tool)) {
                console.log(`[AI Chat] Native write deferred: ${call.tool} (re-issue next turn with real data)`);
                // Include actual gathered data so the model can use it on retry
                let deferMsg = 'DEFERRED: This write was batched with data-gathering tools. Re-issue the write next turn using ONLY the ACTUAL data from your tool results.';
                if (gatheredWebData.length > 0) {
                  const dataSnippet = gatheredWebData.slice(-5).map((d, i) => `${i+1}. ${d.title || 'Untitled'}\n   URL: ${d.url || 'N/A'}\n   ${(d.snippet || '').substring(0, 100)}`).join('\n');
                  deferMsg += `\n\nHere is the REAL data you gathered — use THIS in your file:\n${dataSnippet}`;
                }
                results.push({ tool: call.tool, params: call.params, result: { success: false, error: deferMsg } });
                continue;
              }
              const toolResult = await mcpToolServer.executeTool(call.tool, call.params);
              results.push({ tool: call.tool, params: call.params, result: toolResult });
              // Pace update_todo calls so each IPC message gets its own renderer paint
              if (call.tool === 'update_todo') await new Promise(r => setTimeout(r, 80));
            } catch (execErr) {
              results.push({ tool: call.tool, params: call.params, result: { success: false, error: execErr.message } });
            }
          }
          toolResults = {
            hasToolCalls: unifiedCalls.length > 0,
            results,
            toolCalls: unifiedCalls,
            capped: browserSkipped > 0,
            skippedToolCalls: browserSkipped,
          };
        } else {
          // ── LEGACY TEXT PARSING PATH ──
          const textOpts = { toolPaceMs: localToolPace, skipWriteDeferral: modelTier.tier === 'tiny' };
          if (iteration === 1 && expectedBrowserUrl) textOpts.enforceNavigateUrl = expectedBrowserUrl;
          toolResults = await mcpToolServer.processResponse(responseText, textOpts);
        }

        // Duplicate call detection — disabled by default.
        // Enable via Settings → enableLoopDetection: true.
        if ((_readConfig()?.userSettings?.enableLoopDetection ?? false) && toolResults.hasToolCalls && toolResults.results.length > 0) {
          const iterationCallSigs = new Set();
          const dedupedResults = [];
          for (const tr of toolResults.results) {
            const callSig = JSON.stringify({ t: tr.tool, p: tr.params });
            if (iterationCallSigs.has(callSig)) {
              console.log(`[AI Chat] Blocking duplicate call: ${tr.tool} with same params`);
              tr.result = { success: false, error: `BLOCKED: You already called ${tr.tool} with the exact same parameters this turn. Do NOT repeat failing calls. Change your approach.` };
            }
            iterationCallSigs.add(callSig);
            dedupedResults.push(tr);
          }
          toolResults.results = dedupedResults;
        }
        
        // ── Strip code-fence artifacts from displayed text ──
        // Route any conversational planning text to the thinking panel, then wipe the
        // main chat iteration slot clean. This prevents raw JSON tool calls from flashing
        // in the chat bubble and matches the cloud path behavior.
        if (toolResults.hasToolCalls && toolResults.results.length > 0 && mainWindow) {
          // Extract planning text — everything the model wrote before the first tool call indicator
          const toolIndicators = ['{"tool":', '```tool_call', '```json\n{"tool"', '<tool_call>'];
          let splitIdx = responseText.length;
          for (const indicator of toolIndicators) {
            const idx = responseText.indexOf(indicator);
            if (idx >= 0 && idx < splitIdx) splitIdx = idx;
          }
          const planningText = responseText.substring(0, splitIdx).trim();
          if (planningText) {
            // Planning text belongs in the thinking panel, not the main chat bubble
            mainWindow.webContents.send('llm-thinking-token', planningText);
          }
          // Wipe this iteration's streamed content from main chat — the final answer
          // streams clean in the last iteration that produces no tool calls.
          mainWindow.webContents.send('llm-replace-last', '');
        }
        
        if (!toolResults.hasToolCalls || toolResults.results.length === 0) {
          // ── PILLAR 3: Structured Error Recovery ──
          // Single unified failure classifier replaces 6 scattered if/else chains.
          // Each failure type → specific recovery strategy. No generic placeholders.
          const isBrowserTask = userWantsBrowser || allToolResults.some(tr => tr.tool?.startsWith('browser_'));
          const failure = classifyResponseFailure(
            responseText, false, taskType, iteration, message, lastIterationResponse,
            { isBrowserTask, nudgesRemaining, allToolResults }
          );

          lastIterationResponse = responseText;

          if (failure) {
            console.log(`[AI Chat] Failure classified: ${failure.type} (severity: ${failure.severity})`);

            if (failure.severity === 'stop') {
              // Terminal failure (e.g., repetition) — end the loop
              if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[Stopped — ${failure.type}]*\n`);
              break;
            }

            }

          // No more tool calls - we're done
          console.log(`[AI Chat] No more tool calls, ending agentic loop`);
          break;
        }

        // Track last response for repetition detection (even when tools are called)
        lastIterationResponse = responseText;

        // Send live tool execution indicators BEFORE executing
        if (mainWindow) {
          for (const tr of toolResults.results) {
            mainWindow.webContents.send('tool-executing', { tool: tr.tool, params: tr.params });
          }
        }

        // Check stale before committing to tool execution
        if (isStale()) {
          console.log('[AI Chat] Request superseded before tool execution, exiting');
          break;
        }

        // Accumulate tool results and feed into structured summarizer
        allToolResults.push(...toolResults.results);
        capArray(allToolResults, 50);

        // ── PROACTIVE TOOL RESULT COMPRESSION ──
        // Compress tool results from PREVIOUS iterations (not this one) so the model
        // has already seen the full data once. This prevents context bloat without
        // losing information — the summarizer already has the structured ledger.
        // Only compress results older than the current iteration's to preserve
        // current-turn data the model hasn't acted on yet.
        const currentIterationStart = allToolResults.length - toolResults.results.length;
        for (let i = 0; i < currentIterationStart; i++) {
          const tr = allToolResults[i];
          if (tr._compressed) continue; // Already compressed
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result || '');
          if (resultStr.length > 400) {
            const status = tr.result?.success !== false ? 'ok' : 'fail';
            const snippet = (tr.result?.title || tr.result?.content || resultStr).substring(0, 120);
            tr._compressed = true;
            tr._originalResult = tr.result; // Keep for fabrication detection
            tr.result = { _pruned: true, tool: tr.tool, status, snippet };
          }
        }

        // Persist web data separately — never capped, used by fabrication detection
        for (const tr of toolResults.results) {
          if (tr.tool === 'web_search' && tr.result?.success && Array.isArray(tr.result.results)) {
            for (const r of tr.result.results) {
              if (r.title && r.url) gatheredWebData.push({ title: r.title, url: r.url, snippet: r.snippet || '' });
            }
          }
        }
        for (const tr of toolResults.results) {
          summarizer.recordToolCall(tr.tool, tr.params, tr.result);
          summarizer.markPlanStepCompleted(tr.tool, tr.params);
          // ── Update execution state tracking (ported from Pocket Guide) ──
          updateExecutionState(tr.tool, tr.params, tr.result, iteration);
        }

        // Auto-open created/edited files in editor & notify file explorer
        sendToolExecutionEvents(mainWindow, toolResults.results, playwrightBrowser, { checkSuccess: true });

        // Build tool results summary to feed back to LLM
        let toolFeedback = '\n\n## Tool Execution Results\n';
        if (toolResults.capped && toolResults.skippedToolCalls > 0) {
          toolFeedback += `\n*Tool burst cap enforced: executed ${toolResults.results.length}, skipped ${toolResults.skippedToolCalls}. Re-issue remaining tool calls next iteration.*\n`;
        }
        for (const tr of toolResults.results) {
          const status = tr.result?.success ? '[OK]' : '[FAIL]';
          toolFeedback += `\n### ${tr.tool} ${status}\n`;
          if (!tr.result?.success) {
            toolFailCounts[tr.tool] = (toolFailCounts[tr.tool] || 0) + 1;
          }
          
          if (tr.result?.success) {
            // Include relevant result data
            if (tr.tool === 'browser_get_content' && tr.result?.content) {
              const content = tr.result.content.substring(0, 2000);
              toolFeedback += `**Page Title:** ${tr.result.title || 'Unknown'}\n`;
              toolFeedback += `**URL:** ${tr.result.url || 'Unknown'}\n`;
              toolFeedback += `**Content:**\n\`\`\`\n${content}\n\`\`\`\n`;
            } else if (tr.tool === 'read_file' && tr.result?.content) {
              toolFeedback += `**File:** ${tr.params?.filePath}${tr.result.readRange ? ` (lines ${tr.result.readRange})` : ''} (${tr.result.totalLines} total lines)\n`;
              toolFeedback += `\`\`\`\n${tr.result.content.substring(0, 2000)}\n\`\`\`\n`;
            } else if (tr.tool === 'list_directory' && tr.result?.items) {
              toolFeedback += `**Contents of ${tr.params?.dirPath}:**\n${tr.result.items.map(f => f.name + (f.type === 'directory' ? '/' : '')).join(', ')}\n`;
            } else if (tr.tool === 'search_codebase' && tr.result?.results) {
              toolFeedback += `**Search Results (${tr.result.results.length} matches):**\n`;
              for (const r of tr.result.results.slice(0, 5)) {
                toolFeedback += `- ${r.file}:${r.startLine}: ${(r.preview || r.snippet || '').substring(0, 150)}\n`;
              }
            } else if (tr.tool === 'run_command' && tr.result?.output) {
              toolFeedback += `**Command:** ${tr.params?.command}\n**Exit Code:** ${tr.result.exitCode || 0}\n`;
              toolFeedback += `**Output:**\n\`\`\`\n${tr.result.output.substring(0, 2000)}\n\`\`\`\n`;
            } else if (tr.tool === 'find_files' && tr.result?.files) {
              toolFeedback += `**Found ${tr.result.files.length} Files:**\n${tr.result.files.slice(0, 20).join('\n')}\n`;
            } else if (tr.tool === 'web_search' && tr.result?.results) {
              // Include the actual current date so the model can evaluate whether search result snippets are stale.
              const searchDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
              toolFeedback += `**Search Results for "${tr.params?.query}":** *(search performed on ${searchDate})*\n`;
              for (const r of (tr.result.results || []).slice(0, 5)) {
                toolFeedback += `- [${r.title}](${r.url}): ${r.snippet?.substring(0, 120)}\n`;
              }
            } else if (tr.tool === 'fetch_webpage' && tr.result?.content) {
              toolFeedback += `**Page:** ${tr.result.title || 'Unknown'} (${tr.result.url || tr.params?.url})\n`;
              toolFeedback += `\`\`\`\n${tr.result.content.substring(0, 3000)}\n\`\`\`\n`;
            } else if (tr.tool === 'get_project_structure' && tr.result?.structure) {
              const struct = tr.result.structure;
              toolFeedback += `**Project:** ${struct.projectPath || 'Unknown'}\n`;
              toolFeedback += `**Files:** ${struct.totalFiles || 0}, **Dirs:** ${(struct.directories || []).length}\n`;
              if (struct.files) toolFeedback += `\`\`\`\n${struct.files.slice(0, 50).join('\n')}\n\`\`\`\n`;
            } else if (tr.tool === 'browser_screenshot' && tr.result?.dataUrl) {
              toolFeedback += `**Screenshot captured** (${tr.result.width}x${tr.result.height})\n`;
              // ── Vision Auto-Switch: Route screenshot to a vision model for analysis ──
              try {
                const currentProvider = context?.cloudProvider || '';
                const currentModel = context?.cloudModel || '';
                const hasVision = currentProvider && cloudLLM._supportsVision?.(currentProvider, currentModel);
                const hasLocalVision = !currentProvider && llmEngine?.modelInfo?.name?.toLowerCase().includes('vl');

                if (!hasVision && !hasLocalVision) {
                  // Current model can't see images — try available vision-capable provider
                  // Priority: Google Gemini (if user has key), else skip vision analysis
                  const configured = cloudLLM.getConfiguredProviders();
                  const hasProvider = (p) => configured.some(c => c.provider === p);
                  let visionProvider = null, visionModel = null;
                  if (hasProvider('google')) { visionProvider = 'google'; visionModel = 'gemini-2.5-flash'; }
                  else if (hasProvider('openai')) { visionProvider = 'openai'; visionModel = 'gpt-4o'; }
                  else if (hasProvider('anthropic')) { visionProvider = 'anthropic'; visionModel = 'claude-sonnet-4-20250514'; }

                  if (visionProvider) {
                  const visionPrompt = 'Describe this screenshot in detail. Include all visible text, UI elements, buttons, links, navigation, content layout, and any data shown. Be thorough but concise.';
                  const visionResult = await cloudLLM.generate(visionPrompt, {
                    provider: visionProvider,
                    model: visionModel,
                    systemPrompt: 'You are a screenshot analysis tool. Describe exactly what you see in the image — all text, UI elements, layout, and data. Output structured markdown.',
                    maxTokens: 1500,
                    temperature: 0.2,
                    images: [tr.result.dataUrl],
                  });
                  if (visionResult?.text) {
                    toolFeedback += `**Screenshot Analysis (via vision model):**\n${visionResult.text.substring(0, 2000)}\n`;
                    console.log(`[AI Chat] Vision auto-switch: analyzed screenshot via ${visionProvider}/${visionModel}`);
                  }
                  } else {
                    // No vision-capable provider configured — pass raw screenshot info
                    toolFeedback += `**Screenshot captured** — no vision model available. Configure Google Gemini, OpenAI, or Anthropic for image analysis.\n`;
                  }
                } else {
                  // Current model supports vision — pass image directly for next iteration
                  if (!context.images) context.images = [];
                  context.images.push(tr.result.dataUrl);
                  // Cap images to last 3 to prevent unbounded context growth
                  if (context.images.length > 3) {
                    context.images = context.images.slice(-3);
                  }
                  toolFeedback += `*Screenshot attached for analysis.*\n`;
                }
              } catch (visionErr) {
                console.log('[AI Chat] Vision auto-switch failed:', visionErr.message);
                toolFeedback += `*Could not analyze screenshot: ${visionErr.message}*\n`;
              }
            } else if (tr.tool === 'browser_list_elements' && tr.result?.elements) {
              toolFeedback += `**Found ${tr.result.elements.length} interactive elements:**\n`;
              for (const el of tr.result.elements.slice(0, 50)) {
                const desc = el.text || el.placeholder || el.ariaLabel || el.name || el.id || el.type || el.tag;
                toolFeedback += `- \`${el.selector}\` — ${el.tag}${el.type ? '[' + el.type + ']' : ''}: "${desc.substring(0, 60)}"\n`;
              }
              if (tr.result.elements.length > 50) {
                toolFeedback += `... and ${tr.result.elements.length - 50} more\n`;
              }
            } else if (tr.tool === 'browser_snapshot' && tr.result?.snapshot) {
              toolFeedback += `**Page Snapshot** (${tr.result.elementCount} elements):\n`;
              // Snapshots can be extremely large (SSO pages, complex SPAs) and can
              // immediately blow the local context window. Truncate aggressively.
              // Small models (≤8K ctx) get 4K, medium (≤16K) get 6K, large get 12K cap
              const snap = String(tr.result.snapshot || '');
              const maxSnapChars = totalCtx <= 8192 ? 4000 : totalCtx <= 16384 ? 6000 : 12000;
              toolFeedback += snap.substring(0, maxSnapChars);
              if (snap.length > maxSnapChars) toolFeedback += `\n...(snapshot truncated: ${snap.length} chars total)`;
              toolFeedback += `\n`;
            } else if (tr.tool === 'browser_click' || tr.tool === 'browser_type') {
              const target = tr.params?.ref || tr.params?.selector || 'unknown';
              toolFeedback += `**${tr.tool === 'browser_click' ? 'Clicked' : 'Typed into'} element:** ref=${target}\n`;
              if (tr.tool === 'browser_type') toolFeedback += `**Text:** "${tr.params?.text}"\n`;
              if (tr.result?.element) {
                const el = tr.result.element;
                toolFeedback += `**Element:** ${el.tag}${el.role ? ' [' + el.role + ']' : ''} "${el.text || ''}"\n`;
              }
              if (tr.tool === 'browser_click') toolFeedback += `*Page may have changed. Auto-snapshot will provide updated refs.*\n`;
            } else if (tr.tool === 'browser_press_key') {
              toolFeedback += `**Pressed key:** ${tr.result?.key || tr.params?.key}\n`;
            } else if (tr.tool === 'browser_navigate') {
              toolFeedback += `**Navigated to:** ${tr.result?.url || tr.params?.url}\n`;
              toolFeedback += `**Title:** ${tr.result?.title || 'Loading...'}\n`;
              if (tr.result?.pageText && tr.result.pageText.length > 50) {
                toolFeedback += `**Page Text:**\n${tr.result.pageText.substring(0, 2000)}\n`;
              }
            } else if (tr.tool === 'browser_get_url') {
              toolFeedback += `**Current URL:** ${tr.result?.url || 'Unknown'}\n`;
            } else if (tr.tool === 'edit_file') {
              toolFeedback += `**Edited:** ${tr.params?.filePath} (${tr.result.replacements} replacement(s))\n`;
            } else if (tr.tool === 'git_status' && tr.result?.files) {
              toolFeedback += `**Branch:** ${tr.result.branch}\n**Changes:** ${tr.result.totalChanges} file(s)\n`;
              for (const f of tr.result.files.slice(0, 10)) {
                toolFeedback += `- ${f.status} ${f.path}\n`;
              }
            } else if (tr.tool === 'git_diff' && tr.result?.diff) {
              toolFeedback += `\`\`\`diff\n${tr.result.diff.substring(0, 2000)}\n\`\`\`\n`;
            } else if (tr.tool === 'get_file_info') {
              toolFeedback += `**${tr.result.name}:** ${tr.result.sizeFormatted}, modified ${tr.result.modified}\n`;
            } else if (tr.tool === 'list_memories' && tr.result?.keys) {
              toolFeedback += `**Saved memories:** ${tr.result.keys.join(', ') || 'none'}\n`;
            } else if (tr.tool === 'get_memory' && tr.result?.value) {
              toolFeedback += `**${tr.params?.key}:** ${tr.result.value.substring(0, 500)}\n`;
            } else if (tr.tool === 'analyze_error' && tr.result?.analysis) {
              const analysis = tr.result.analysis;
              toolFeedback += `**Error Analysis (${analysis.results?.length || 0} related files):**\n`;
              for (const r of (analysis.results || []).slice(0, 3)) {
                toolFeedback += `- ${r.relativePath}:${r.startLine}\n`;
              }
            } else if ((tr.tool === 'write_file' || tr.tool === 'append_to_file') && tr.result?.path) {
              const byteCount = (tr.params?.content || '').length;
              toolFeedback += `**File written:** \`${tr.result.path}\` (${byteCount.toLocaleString()} chars, ${tr.result.isNew ? 'new file' : 'updated'})\n`;
            } else {
              toolFeedback += `**Result:** ${tr.result?.message || 'Done'}\n`;
            }
          } else {
            toolFeedback += `**Error:** ${tr.result?.error || 'Unknown error'}\n`;
          }
          // If this tool has failed repeatedly, inject a stop directive so the model doesn't retry indefinitely
          if (!tr.result?.success && (toolFailCounts[tr.tool] || 0) >= 2) {
            toolFeedback += `**STOP: \`${tr.tool}\` has failed ${toolFailCounts[tr.tool]}x in a row. Do NOT call it again. Read the error above and explain to the user what is blocking the task instead of retrying.**\n`;
          }
        }

        // NOTE: Execution state injection moved to PILLAR 4 — now injected at the START
        // of each iteration's prompt (before tool results) instead of appended at the end.
        // This ensures the model sees ground truth FIRST, not as an afterthought.

        // Normalize toolFeedback to end with \n\n so ChatPanel's trailingProse regex
        // finds a clean paragraph boundary before model synthesis. Without this, the
        // synthesis paragraph is consumed by the tool section stripper.
        if (!toolFeedback.endsWith('\n\n')) toolFeedback = toolFeedback.trimEnd() + '\n\n';

        // Send progress update to UI — only mcp-tool-results, NOT llm-token.
        // Sending toolFeedback via llm-token causes raw browser snapshot refs ([ref=XX])
        // to appear in the visible chat window and pollute chatHistory re-seeds next turn.
        if (mainWindow) {
          mainWindow.webContents.send('mcp-tool-results', toolResults.results);
        }
        fullResponseText += toolFeedback;

        // Cap fullResponseText to prevent unbounded memory growth (same 2MB as cloud path)
        if (fullResponseText.length > 2 * 1024 * 1024) {
          fullResponseText = fullResponseText.substring(fullResponseText.length - 2 * 1024 * 1024);
        }

        // ── Anti-hallucination guard for file edits (local path) ──
        // DISABLED 2026-02-25: Part of the over-engineered hallucination detection that was
        // causing more problems than it solved. Commented out for testing/simplification.
        // {
        //   const fileModTools = ['write_file', 'edit_file'];
        //   const calledFileModTool = toolResults.results.some(r => fileModTools.includes(r.tool));
        //   const userAskedForEdit = /\b(edit|change|modif|...)\b/i.test(message || '');
        //   const modelClaimedEdits = /\b(✔️|✅|upgraded|modified|...)\b/i.test(responseText);
        //   if (!calledFileModTool && userAskedForEdit && modelClaimedEdits && toolResults.results.length > 0) {
        //     toolFeedback += '\n\n[SYSTEM] WARNING: ...';
        //     if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Anti-hallucination...]*\n');
        //   }
        // }

        // Stuck/cycle detection — always active.
        // STUCK_THRESHOLD=3 consecutive identical calls = stuck.
        for (const tr of toolResults.results) {
          const p = tr.params || {};
          const paramsHash = `${p.filePath || p.dirPath || p.url || p.ref || p.query || p.command || p.selector || ''}:${p.text || ''}`.substring(0, 200);
          recentToolCalls.push({ tool: tr.tool, paramsHash });
        }
        if (recentToolCalls.length > 20) recentToolCalls = recentToolCalls.slice(-20);

        {
          let isStuck = false;
          if (recentToolCalls.length >= STUCK_THRESHOLD) {
            const last = recentToolCalls[recentToolCalls.length - 1];
            const tail = recentToolCalls.slice(-STUCK_THRESHOLD);
            if (tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash)) {
              isStuck = true;
              console.log(`[AI Chat] Detected stuck pattern: ${last.tool} called ${STUCK_THRESHOLD}+ times with same params`);
              fullResponseText += `\n\n*Detected repetitive pattern (${last.tool} called ${STUCK_THRESHOLD}+ times with identical parameters). Stopping to avoid wasting resources.*`;
              break;
            }
          }
          if (!isStuck && recentToolCalls.length >= 8) {
            for (let cycleLen = 2; cycleLen <= 4; cycleLen++) {
              if (recentToolCalls.length < cycleLen * CYCLE_MIN_REPEATS) continue;
              const toolNames = recentToolCalls.map(tc => tc.tool);
              const lastCycle = toolNames.slice(-cycleLen);
              let repeats = 0;
              for (let pos = toolNames.length - cycleLen; pos >= 0; pos -= cycleLen) {
                const segment = toolNames.slice(pos, pos + cycleLen);
                if (segment.join(',') === lastCycle.join(',')) repeats++;
                else break;
              }
              if (repeats >= CYCLE_MIN_REPEATS) {
                const cycleSig = lastCycle.join(' → ');
                console.log(`[AI Chat] Tool cycle detected: [${cycleSig}] repeated ${repeats} times`);
                fullResponseText += `\n\n*Detected tool cycle (${cycleSig}). Breaking loop.*`;
                isStuck = true;
                break;
              }
            }
            if (isStuck) break;
          }
        }

        // Auto-inject page state after browser actions so the model knows what happened
        // Skip if the model already called browser_snapshot this iteration (avoid double-snapshot)
        // Auto-snapshot after browser actions
        const snapResult = await autoSnapshotAfterBrowserAction(toolResults.results, mcpToolServer, playwrightBrowser, browserManager);
        if (snapResult) {
          toolFeedback += `\n### Page snapshot after ${snapResult.triggerTool}\n`;
          toolFeedback += `${snapResult.snapshotText}\n`;
          toolFeedback += `\n**${snapResult.elementCount} elements.** Use [ref=N] with browser_click/type.\n`;
        }

        // Cap snapshot text in toolFeedback for small models.
        // Adaptive: use model context size to decide the cap, or user override from Advanced Settings.
        const userSnapCap = _readConfig()?.userSettings?.snapshotMaxChars;
        const snapshotCap = userSnapCap && userSnapCap > 0 ? userSnapCap : (totalCtx <= 8192 ? 4000 : totalCtx <= 16384 ? 6000 : 12000);
        if (toolFeedback.length > snapshotCap + 2000) {
          // Find and truncate the snapshot section specifically
          const snapIdx = toolFeedback.indexOf('**Page Snapshot**');
          if (snapIdx > 0 && toolFeedback.length - snapIdx > snapshotCap) {
            toolFeedback = toolFeedback.substring(0, snapIdx + snapshotCap) + '\n...(snapshot truncated for context efficiency)\n';
          }
        }

        // Set up prompt for next iteration
        // If context was rotated, rebuild system context with conversation summary
        // Otherwise, just pass tool feedback as a user turn (chatHistory retains prior context)
        //
        // CRITICAL FIX: Always include a task reminder so small models (3B-7B) don't
        // forget the original goal after 2-3 iterations of tool results. Without this,
        // the original user message gets pushed out of the attention window and the
        // model reverts to generic behavior ("Hello! How can I assist you today?").
        const taskReminder = `CURRENT TASK: ${message.substring(0, 300)}${message.length > 300 ? '...' : ''}\n\n`;

        // ── PILLAR 2: Atomic Step Execution ──
        // If the model has a todo plan, inject the current step as the PRIMARY directive.
        // The model doesn't have to remember what it was doing — the system tells it.
        let stepDirective = '';
        const activeTodos = (mcpToolServer._todos || []);
        if (activeTodos.length > 0) {
          const inProgress = activeTodos.find(t => t.status === 'in-progress');
          const nextPending = activeTodos.find(t => t.status === 'pending');
          const done = activeTodos.filter(t => t.status === 'done').length;
          const total = activeTodos.length;
          
          if (inProgress) {
            stepDirective = `\n## CURRENT STEP (${done}/${total} complete)\n**NOW EXECUTING:** ${inProgress.text}\nFocus on THIS step. Call update_todo with status "done" when complete, then move to the next step.\n\n`;
          } else if (nextPending) {
            stepDirective = `\n## NEXT STEP (${done}/${total} complete)\n**DO THIS NOW:** ${nextPending.text}\nCall update_todo id=${nextPending.id} status="in-progress", then execute it.\n\n`;
          } else if (done === total) {
            stepDirective = `\n## PLAN COMPLETE (${done}/${total} done)\nAll steps are finished. Provide a final summary.\n\n`;
          }
        }

        // ── PILLAR 4: Execution State as Primary Context ──
        // Ground truth of what actually happened goes FIRST, before tool results.
        // The model operates from facts, not from its own memory.
        const executionStateBlock = getExecutionStateSummary() || '';

        const hasBrowserAction = toolResults.results.some(tr => tr.tool && tr.tool.startsWith('browser_'));
        const continueInstruction = hasBrowserAction
          ? `\n\nThe page snapshot above has element [ref=N] numbers. Do NOT call browser_snapshot — you already have it. Use browser_click, browser_type, etc. with [ref=N]. Output your next tool call as a fenced JSON block NOW.`
          : `\n\nOutput the next tool call to make progress. Only provide a final summary when ALL steps are fully complete.`;
        
        // Build the iteration prompt with structured context ordering:
        // 1. Execution state (ground truth — PILLAR 4)
        // 2. Step directive (atomic step — PILLAR 2)
        // 3. Task reminder (original user request)
        // 4. Tool results (what just happened)
        // 5. Continue instruction
        const iterationContext = executionStateBlock + stepDirective + taskReminder;

        if (sessionJustRotated) {
          sessionJustRotated = false;
          const rotatedBase = buildStaticPrompt();
          currentPrompt = {
            systemContext: rotatedBase,
            userMessage: iterationContext + buildDynamicContext() + '\n' + lastConvSummary + `\nLatest results:\n${toolFeedback.substring(0, 6000)}${continueInstruction}`
          };
        } else {
          currentPrompt = {
            systemContext: buildStaticPrompt(),
            userMessage: iterationContext + buildDynamicContext() + '\n' + toolFeedback + continueInstruction
          };
        }
      }

      if (iteration >= MAX_AGENTIC_ITERATIONS) {
        fullResponseText += `\n\n*Reached maximum ${MAX_AGENTIC_ITERATIONS} iterations. Task may be incomplete.*`;
        if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Reached max ${MAX_AGENTIC_ITERATIONS} iterations.*`);
      }

      // If the last iteration used tool calls, generate a final summary so the response
      // never ends abruptly on raw tool output
      // IMPORTANT: avoid blocking browser automations with an extra summary call.
      const shouldAutoSummarize = allToolResults.length > 0 && iteration >= 2 && !userWantsBrowser;
      if (shouldAutoSummarize) {
        const lastResponseTrimmed = (fullResponseText || '').trim();
        const endsWithToolOutput = lastResponseTrimmed.endsWith('```') || 
          lastResponseTrimmed.endsWith('Done') ||
          lastResponseTrimmed.includes('## Tool Execution Results') && !lastResponseTrimmed.match(/\n[^#\n*`][^\n]{20,}$/);
        
        if (endsWithToolOutput || iteration >= MAX_AGENTIC_ITERATIONS) {
          try {
            console.log('[AI Chat] Generating final summary...');
            // Do NOT send summary status via llm-thinking-token — pollutes reasoning panel.
            
            const toolsSummary = allToolResults.slice(-10).map(tr => {
              const s = tr.result?.success ? 'done' : 'failed';
              return `${tr.tool}: ${s}`;
            }).join(', ');
            
            const summaryPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: `You just completed a task using these tools: ${toolsSummary}\n\nProvide a brief, clear summary of what was accomplished and any important results. Be concise (2-4 sentences). Do NOT call any tools.`
            };
            
            const summaryResult = await llmEngine.generateStream(summaryPrompt, {
              maxTokens: 512,
              temperature: 0.3,
            }, (token) => {
              // Stream summary tokens so the user sees generation in real time instead of a silent hang.
              if (mainWindow) mainWindow.webContents.send('llm-token', token);
            }, (thinkToken) => {
              if (mainWindow) mainWindow.webContents.send('llm-thinking-token', thinkToken);
            });
            
            if (summaryResult.text) {
              fullResponseText += '\n\n' + summaryResult.text;
              displayResponseText += '\n\n' + summaryResult.text;
            }
          } catch (summaryErr) {
            console.log('[AI Chat] Summary generation failed:', summaryErr.message);
          }
        }
      }

      // ── Completion Guarantee (post-loop) ──
      // Ensures files contain real data, not fabricated content. Two cases:
      // A) No file written → create file from gathered data
      // B) File written but fabricated → overwrite with gathered data
      // This runs AFTER the loop so corrections can't be overwritten by subsequent model writes.
      if (gatheredWebData.length > 0) {
        const userWantsFile = /\b(?:save|write|create|put|store|make)\b.*\b(?:file|desktop|document|txt|csv)\b/i.test(message) ||
                              /\b(?:file|desktop|document)\b.*\b(?:save|write|create)\b/i.test(message);
        const wroteFile = allToolResults.some(tr => tr.tool === 'write_file' && tr.result?.success);

        // Build corrected content from gathered data
        const buildCorrectedContent = () => {
          const lines = gatheredWebData.slice(0, 10).map((r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}${r.snippet ? '\n   ' + r.snippet.substring(0, 200) : ''}`
          );
          return `Results gathered from web search:\n\n${lines.join('\n\n')}`;
        };

        if (userWantsFile && !wroteFile) {
          // Case A: no file written at all
          console.log('[AI Chat] Completion guarantee (case A): no file written — auto-generating');
          try {
            const content = buildCorrectedContent();
            const desktopPath = require('path').join(require('os').homedir(), 'Desktop');
            const filePath = require('path').join(desktopPath, 'search_results.txt');
            require('fs').writeFileSync(filePath, content, 'utf8');
            console.log(`[AI Chat] Completion guarantee: wrote ${content.length} chars to ${filePath}`);
            fullResponseText += `\n\nResults saved to ${filePath}`;
            displayResponseText += `\n\nResults saved to ${filePath}`;
            if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Results saved to Desktop/search_results.txt*`);
          } catch (e) {
            console.log(`[AI Chat] Completion guarantee (case A) failed: ${e.message}`);
          }
        } else if (wroteFile) {
          // Case B: file was written — check if content is fabricated
          const lastWrite = [...allToolResults].reverse().find(tr => tr.tool === 'write_file' && tr.result?.success && tr.params?.filePath);
          if (lastWrite) {
            try {
              // Sanitize filePath same way MCPToolServer does — model stores hallucinated paths
              const sanitized = mcpToolServer._sanitizeFilePath(lastWrite.params.filePath);
              const absPath = require('path').resolve(mcpToolServer.projectPath || '.', sanitized);
              const currentContent = require('fs').readFileSync(absPath, 'utf8');
              const contentLower = currentContent.toLowerCase();
              const looksLikeData = /(?:\$\d|price|product|listing|mileage|miles|bedroom|salary)/i.test(currentContent);
              if (looksLikeData) {
                const snippets = gatheredWebData.flatMap(wd => [wd.url, wd.title].filter(Boolean));
                const overlap = snippets.filter(s => s.length > 5 && contentLower.includes(s.toLowerCase())).length;
                if (overlap === 0) {
                  const corrected = buildCorrectedContent();
                  require('fs').writeFileSync(absPath, corrected, 'utf8');
                  console.log(`[AI Chat] Completion guarantee (case B): overwrote fabricated ${currentContent.length} chars with ${corrected.length} chars of real data in ${absPath}`);
                }
              }
            } catch (_) {}
          }
        }
      }

      memoryStore.addConversation('assistant', fullResponseText);

      // Clean up response display: ONLY the assistant's natural-language responses.
      // Tool output is streamed live and should not become the final assistant message.
      let cleanLocalResponse = displayResponseText;
      cleanLocalResponse = cleanLocalResponse.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
      cleanLocalResponse = cleanLocalResponse.replace(/<\/?think(?:ing)?>/gi, '');
      cleanLocalResponse = cleanLocalResponse.replace(/\n\n\*(?:Continuing browser automation|Detected repetitive loop|Reached max \d+ iterations)\.\.\.?\*\n?/g, '');
      cleanLocalResponse = cleanLocalResponse.replace(/\n{3,}/g, '\n\n').trim();

      // Never return an empty success response (this causes "No response generated" in the UI)
      if (!cleanLocalResponse) {
        if (allToolResults.length > 0) cleanLocalResponse = 'Tools executed. Continue with the next step or ask for a summary.';
        else cleanLocalResponse = 'No response generated.';
      }

      // Report token telemetry for local LLM
      const localTokensUsed = estimateTokens(fullResponseText);
      _reportTokenStats(localTokensUsed, mainWindow);

      return {
        success: true,
        text: cleanLocalResponse,
        model: modelStatus.modelInfo?.name || 'local',
        tokensUsed: localTokensUsed,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        iterations: iteration,
      };
    } catch (error) { return { success: false, error: error.message }; }
  });

  // ─── Bug Finding ─────────────────────────────────────────────────────
  ipcMain.handle('find-bug', async (_, errorMessage, stackTrace, projectPath) => {
    const mainWindow = ctx.getMainWindow();
    try {
      if (!ragEngine.projectPath || ragEngine.projectPath !== projectPath) {
        await ragEngine.indexProject(projectPath);
      }
      const errorContext = ragEngine.findErrorContext(errorMessage, stackTrace);
      const pastErrors = memoryStore.findSimilarErrors(errorMessage);

      let prompt = `## Bug Analysis Request\n\n**Error Message:** ${errorMessage}\n\n`;
      if (stackTrace) prompt += `**Stack Trace:**\n\`\`\`\n${stackTrace}\n\`\`\`\n\n`;
      if (pastErrors.length > 0) {
        prompt += `**Similar Past Errors:**\n`;
        for (const pe of pastErrors) prompt += `- ${pe.error} → Resolution: ${pe.resolution}\n`;
        prompt += '\n';
      }
      prompt += `**Related Files:**\n\n`;
      for (const result of errorContext.results) {
        prompt += `### ${result.relativePath} (lines ${result.startLine + 1}-${result.endLine})\n\`\`\`\n${result.content}\n\`\`\`\n\n`;
      }
      prompt += `Analyze this error: identify root cause, explain why, provide exact code fixes.\nFormat: ### Fix: [filename]\n\`\`\`[language]\n[corrected code]\n\`\`\`\n`;

      const result = await llmEngine.generateStream({
        systemContext: 'You are a bug analysis assistant. Analyze errors, identify root causes, and provide exact code fixes.',
        userMessage: prompt
      }, { maxTokens: 4096, temperature: 0.3 }, (token) => {
        if (mainWindow) mainWindow.webContents.send('llm-token', token);
      }, (thinkToken) => {
        if (mainWindow) mainWindow.webContents.send('llm-thinking-token', thinkToken);
      });

      memoryStore.recordError(errorMessage, result.text || '', errorContext.results.map(r => r.relativePath));
      return { success: true, text: result.text, errorContext, model: result.model };
    } catch (error) { return { success: false, error: error.message }; }
  });
}

module.exports = { register };
