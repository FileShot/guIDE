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
  const { llmEngine, cloudLLM, mcpToolServer, playwrightBrowser, browserManager, ragEngine, memoryStore, webSearch, licenseManager, ConversationSummarizer, DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE } = ctx;
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

  // BUG-038: Consecutive stutter abort counter — persists across IPC requests.
  // When a model stutters 3+ times in a row (across separate user messages or retries),
  // the chatHistory is poisoned. Auto-clear it to rescue the session.
  let _consecutiveStutterAborts = 0;

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
    const MAX_AGENTIC_ITERATIONS = context?.maxIterations || 100; // Default 100 for long browser sessions
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'clear' });

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
            if (has('cerebras')) return pick('cerebras', 'zai-glm-4.7');
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
          // Notify the UI which model was auto-selected
          if (mainWindow) {
            mainWindow.webContents.send('llm-token', `*Auto Mode selected: ${cloudLLM._getProviderLabel(autoSelect.provider)} / ${autoSelect.model}*\n\n`);
          }
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
          
          // Detect task type for cloud — same logic as local, prevents tool injection on greetings
          const cloudTaskType = (() => {
            const lower = (message || '').toLowerCase().trim();
            const greetingPattern = /^(hi+|hello+|hey+|yo+|sup|howdy|hola|greetings|good\s*(morning|evening|afternoon|night)|what'?s?\s*up|how\s*are\s*you|how'?s?\s*it\s*going|thanks?|thank\s*you|bye|goodbye|see\s*ya|cheers|nice|cool|ok|okay|sure|yep|yeah|nope|no|yes|lol|lmao|haha|wow|great|awesome|help|who\s*are\s*you|what\s*are\s*you|what\s*can\s*you\s*do|tell\s*me\s*about\s*yourself|what'?s?\s*your\s*name|wtf|omg|bruh|hmm+|idk)[!?.,\s]*$/i;
            if (greetingPattern.test(lower)) return 'chat';
            if (lower.length < 20 && !/\b(file|code|bug|error|browse|navigate|search|http|www\.|\.com|create|build|write|edit|run|fix|debug|git|install|deploy|test)\b/.test(lower)) return 'chat';
            const casualQuestion = /^(what|who|where|when|why|how|can|do|does|is|are|will|would|should|could)\b.*\b(you|weather|time|day|name|favorite|like|think|feel|opinion|recommend|suggest)\b/i;
            if (casualQuestion.test(lower) && lower.length < 80 && !/\b(file|code|bug|error|browse|http|function|variable|debug|fix|build|edit|git)\b/.test(lower)) return 'chat';
            if (/\b(browse|navigate|website|url|http|www\.|\.com|\.org|\.edu|visit|open.*site|go\s+to|login|sign\s+in)\b/i.test(lower)) return 'browser';
            return 'general';
          })();
          
          // Add MCP tool definitions for cloud models (skip for casual chat)
          const toolPrompt = mcpToolServer.getToolPromptForTask(cloudTaskType);
          const cloudSystemPrompt = systemPrompt + (toolPrompt ? '\n\n' + toolPrompt : '');

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
          // BUG-041: Sanitize conversation history before passing to cloud model.
          // Local model failures (garbage HTML, raw-JSON tool leaks, 0-tool poison turns) must
          // NEVER propagate to the cloud model — this was the root of the car-dealership
          // data-corruption chain (BUG-033→034→038→041). Filter suspicious assistant turns.
          const _rawCloudHistory = [...(context?.conversationHistory || [])];
          const _sanitizeForCloud = (history) => history.filter(turn => {
            if (turn.role !== 'assistant') return true; // Always keep user/system turns
            const c = (turn.content || '').trim();
            if (/^\[?\s*\{\s*"name"\s*:/.test(c)) return false;          // Raw OpenAI fn-call JSON leak
            if (/<\s*(html|head|body|div|h1|nav|section)\b/i.test(c) && c.length > 300) return false; // Hallucinated HTML
            if (c.length > 1500 && !/[.!?]/.test(c.slice(-200))) return false; // Long with no sentence endings
            return true;
          });
          let cloudConversationHistory = _sanitizeForCloud(_rawCloudHistory);
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
                // BUG-006: Re-check staleness after sleeping — a new request may have
                // arrived during the delay, which would cause parallel sessions.
                if (isStale()) {
                  console.log('[Cloud] Request superseded during pacing delay, exiting loop');
                  if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Interrupted — new message received]*\n');
                  break;
                }
              }
            }

            console.log(`[Cloud] Agentic iteration ${cloudIteration}/${MAX_CLOUD_ITERATIONS}`);
            
            if (mainWindow && cloudIteration > 1) {
              mainWindow.webContents.send('agentic-progress', { iteration: cloudIteration, maxIterations: MAX_CLOUD_ITERATIONS });
            }

            const cloudTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: 25, maxBufferChars: 2048 });
            const cloudThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });

            // Cloud thinking token budget — cap verbose thinking models to prevent 100-paragraph think blocks
            // Default cap: 4096 tokens (~16KB). Deduces effort from user settings if available.
            const CLOUD_THINKING_CAP = context?.params?.reasoningEffort === 'high' ? 16384
              : context?.params?.reasoningEffort === 'low' ? 1024
              : 4096;
            let cloudThinkingTokenCount = 0;
            let cloudThinkingCapped = false;

            try {
              lastCloudResult = await cloudLLM.generate(currentCloudPrompt, {
                provider: context.cloudProvider,
                model: context.cloudModel,
                systemPrompt: cloudSystemPrompt,
                // Limit responses for BUNDLED keys only (our bandwidth cost).
                // Users with their own keys face no artificial cap — they're paying for it themselves.
                // Chat bundled: ~2 paragraphs (500 tokens). Agentic bundled: 8192.
                // Own key: generous defaults (8192 chat, 32768 tools).
                ...((() => {
                  const usingBundled = cloudLLM._isBundledProvider(context.cloudProvider) && !cloudLLM.isUsingOwnKey(context.cloudProvider);
                  const chatMax = usingBundled ? 500  : 8192;
                  const genMax  = usingBundled ? 8192 : 32768;
                  const base = cloudTaskType === 'chat' ? chatMax : genMax;
                  return { maxTokens: context?.params?.maxTokens ? Math.min(context.params.maxTokens, base) : base };
                })()),
                temperature: context?.params?.temperature || 0.7,
                stream: true,
                noFallback: !context?.autoMode, // Don't auto-switch providers when user manually selected a model
                conversationHistory: cloudConversationHistory,
                images: cloudIteration === 1 ? (context?.images || []) : [],
                onToken: (token) => cloudTokenBatcher.push(token),
                onThinkingToken: (token) => {
                  cloudThinkingTokenCount++;
                  if (!cloudThinkingCapped) {
                    cloudThinkingBatcher.push(token);
                    if (cloudThinkingTokenCount >= CLOUD_THINKING_CAP) {
                      cloudThinkingCapped = true;
                      cloudThinkingBatcher.push('\n\n[Thinking truncated — reached budget of ' + CLOUD_THINKING_CAP + ' tokens]\n');
                      console.log(`[Cloud] Thinking token cap reached (${CLOUD_THINKING_CAP}), suppressing further thinking output`);
                    }
                  }
                  // Note: we still let the API continue generating — we just stop forwarding
                  // thinking tokens to the UI. The model's actual response is unaffected.
                },
              });
            } finally {
              cloudTokenBatcher.dispose();
              cloudThinkingBatcher.dispose();
              if (cloudThinkingTokenCount > 0) {
                console.log(`[Cloud] Thinking tokens this iteration: ${cloudThinkingTokenCount}${cloudThinkingCapped ? ' (CAPPED)' : ''}`);
              }
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

                if (cloudFailure.severity === 'nudge' && cloudNudgesRemaining > 0 && cloudIteration < MAX_CLOUD_ITERATIONS - 1) {
                  cloudNudgesRemaining--;
                  if (mainWindow) mainWindow.webContents.send('llm-token', '\n');
                  cloudConversationHistory.push({ role: 'user', content: currentCloudPrompt });
                  cloudConversationHistory.push({ role: 'assistant', content: responseText });
                  currentCloudPrompt = cloudFailure.recovery.prompt;
                  console.log(`[Cloud] Recovery: ${cloudFailure.type} → nudge (${cloudNudgesRemaining} remaining)`);
                  continue;
                }
              }

              // Check if work may be incomplete (no failure classified but model stopped mid-task)
              const hasUnfinishedWork = allCloudToolResults.length > 0 && cloudIteration < MAX_CLOUD_ITERATIONS - 1;
              if (hasUnfinishedWork && cloudNudgesRemaining > 0) {
                const taskDoneSignals = /\b(complete|done|finished|all\s+set|that'?s?\s+it|summary|here'?s?\s+what|task\s+is\s+complete)\b/i.test(responseText);
                if (!taskDoneSignals) {
                  cloudNudgesRemaining--;
                  console.log(`[Cloud] Work may be incomplete — nudging to continue (${cloudNudgesRemaining} remaining)`);
                  if (mainWindow) mainWindow.webContents.send('llm-token', '\n\n*Continuing...*\n');
                  cloudConversationHistory.push({ role: 'user', content: currentCloudPrompt });
                  cloudConversationHistory.push({ role: 'assistant', content: responseText });
                  currentCloudPrompt = 'The task is not yet complete. Continue with the remaining steps. Call the appropriate tools to finish the job.';
                  continue;
                }
              }

              // ── Todo-aware continuation ──
              const cloudIncompleteTodos = (mcpToolServer._todos || []).filter(t => t.status !== 'done');
              if (cloudIncompleteTodos.length > 0 && cloudIteration < 20 && cloudNudgesRemaining > 0) {
                cloudNudgesRemaining--;
                const todoSummary = cloudIncompleteTodos.map(t => `  - [${t.status}] ${t.text}`).join('\n');
                console.log(`[Cloud] Model stopped but ${cloudIncompleteTodos.length} todos incomplete — nudging (iter ${cloudIteration})`);
                if (mainWindow) mainWindow.webContents.send('llm-token', '\n');
                cloudConversationHistory.push({ role: 'user', content: currentCloudPrompt });
                cloudConversationHistory.push({ role: 'assistant', content: responseText });
                currentCloudPrompt = `You stopped but your plan has ${cloudIncompleteTodos.length} incomplete items:\n${todoSummary}\n\nDo NOT summarize or give a final answer yet. Continue executing the remaining tasks using tool calls. Pick the next incomplete item and do it now.`;
                continue;
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

            // Cloud stuck detection: same tool+params repeated STUCK_THRESHOLD times.
            for (const tr of iterationToolResults) {
              const p = tr.params || {};
              const paramsHash = `${p.filePath || p.url || p.ref || p.query || p.command || p.selector || ''}:${p.text || ''}`.substring(0, 200);
              recentCloudToolCalls.push({ tool: tr.tool, paramsHash });
            }
            if (recentCloudToolCalls.length > 20) recentCloudToolCalls = recentCloudToolCalls.slice(-20);
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
            // Catches patterns like: read_file → write_file → update_todo → read_file → write_file → ...
            // where no single tool dominates but the cycle repeats.
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
              // Add actionable error guidance for failed tools
              if (!r.result?.success && r.result?.error) {
                cloudToolFailCounts[r.tool] = (cloudToolFailCounts[r.tool] || 0) + 1;
                toolLine += enrichErrorFeedback(r.tool, r.result.error, cloudToolFailCounts);
              }
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
            // Detect when the model claimed to modify files but never called edit_file/write_file.
            {
              const fileModTools = ['write_file', 'edit_file'];
              const calledFileModTool = iterationToolResults.some(r => fileModTools.includes(r.tool));
              const userAskedForEdit = /\b(edit|change|modif|updat|upgrad|add to|fix|improve|alter)\b/i.test(message || '');
              const modelClaimedEdits = /\b(✔️|✅|upgraded|modified|edited|updated|changed|added|implemented|applied|enhanced)\b/i.test(responseText);
              if (!calledFileModTool && userAskedForEdit && modelClaimedEdits && iterationToolResults.length > 0) {
                console.log('[Cloud] Hallucination detected: model claimed file edits but no edit_file/write_file was called');
                cloudConversationHistory.push({
                  role: 'user',
                  content: '[SYSTEM] WARNING: You claimed to make file changes but never called edit_file or write_file. No files were actually modified. You MUST use edit_file or write_file to modify files — browsing a file does NOT modify it. Execute the actual edits now using edit_file.'
                });
              }
            }

            // ── Post-write verification: fabrication + completeness (cloud path) ──
            {
              const writeResults = iterationToolResults.filter(r => r.tool === 'write_file' && r.result?.success && r.params?.content);
              for (const wr of writeResults) {
                const fileContent = wr.params.content;
                const fileSize = fileContent.length;
                if (fileSize > 2000) {
                  const looksLikeScrapedData = /(?:price|product|headline|article|result|listing|review|score|rating)/i.test(fileContent);
                  if (looksLikeScrapedData) {
                    const hasBrowserData = allCloudToolResults.some(tr =>
                      ['browser_snapshot', 'browser_evaluate', 'browser_get_content', 'fetch_webpage', 'web_search'].includes(tr.tool) && tr.result?.success
                    );
                    if (!hasBrowserData) {
                      console.log(`[Cloud] FABRICATION WARNING: wrote ${fileSize} char file with data-like content but NO web data`);
                      cloudConversationHistory.push({
                        role: 'user',
                        content: `[SYSTEM] ⚠️ FABRICATION WARNING: You wrote a ${fileSize}-char file with data-like content but have NOT used any web tools to get real data. Delete this file and start over with real web_search/browser_navigate data.`
                      });
                    }
                  }
                }
                // Vague comment detection
                const vaguePatterns = /(?:people are discussing|users are talking|commenters? (?:are|seem|appear)|general (?:consensus|sentiment))/i;
                const hasCommentSection = /(?:comments?|discussion|what people (?:are )?saying):/i.test(fileContent);
                const hasSpecificQuotes = /(?:[""][^""]{20,}[""]|said:|wrote:|commented:|\bby [a-zA-Z0-9_-]+\b.*?:)/i.test(fileContent);
                if (hasCommentSection && vaguePatterns.test(fileContent) && !hasSpecificQuotes) {
                  cloudConversationHistory.push({
                    role: 'user',
                    content: '[SYSTEM] ⚠️ VAGUE COMMENT WARNING: Your file has a comments section but only vague summaries. Extract REAL comments with usernames using browser_evaluate, then rewrite with specific quotes.'
                  });
                }
              }

              // One-shot completeness check (cloud path)
              if (writeResults.length > 0) {
                if (!_completenessCheckedFiles) _completenessCheckedFiles = new Set();
                const writtenFiles = writeResults.map(r => r.params.filePath);
                const writtenContent = writeResults.map(r => r.params.content).join('\n');
                const userMsg = (message || '').toLowerCase();
                const newFiles = writtenFiles.filter(f => !_completenessCheckedFiles.has(f));
                if (newFiles.length > 0) {
                  newFiles.forEach(f => _completenessCheckedFiles.add(f));
                  const missingParts = [];
                  if (/comment|what.*say|discuss|opinion/i.test(userMsg) && !/comment/i.test(writtenContent)) missingParts.push('comments/discussion');
                  if (/who\s+post|poster|submitt|author/i.test(userMsg) && !/\bby\s+\w|author|username|submitted/i.test(writtenContent)) missingParts.push('submitter/author names');
                  if (/seller\s+rat|seller\s+score/i.test(userMsg) && !/\d+%/i.test(writtenContent)) missingParts.push('seller ratings');
                  if (missingParts.length > 0) {
                    cloudConversationHistory.push({
                      role: 'user',
                      content: `[SYSTEM — FILE NOTE] Your file may be missing: ${missingParts.join(', ')}. Check if covered. If not, add them. If unavailable, move on.`
                    });
                  }
                }
              }
            }

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

            // ── PILLAR 2+4 (cloud path): Atomic step execution + execution state ──
            let cloudStepDirective = '';
            const cloudActiveTodos = (mcpToolServer._todos || []);
            if (cloudActiveTodos.length > 0) {
              const inProg = cloudActiveTodos.find(t => t.status === 'in-progress');
              const nextPend = cloudActiveTodos.find(t => t.status === 'pending');
              const doneCount = cloudActiveTodos.filter(t => t.status === 'done').length;
              const totalCount = cloudActiveTodos.length;
              if (inProg) {
                cloudStepDirective = `\n## CURRENT STEP (${doneCount}/${totalCount} complete)\n**NOW EXECUTING:** ${inProg.text}\nFocus on THIS step. Call update_todo with status "done" when complete.\n\n`;
              } else if (nextPend) {
                cloudStepDirective = `\n## NEXT STEP (${doneCount}/${totalCount} complete)\n**DO THIS NOW:** ${nextPend.text}\n\n`;
              } else if (doneCount === totalCount) {
                cloudStepDirective = `\n## PLAN COMPLETE (${doneCount}/${totalCount} done)\nAll steps finished. Provide a final summary.\n\n`;
              }
            }
            const cloudExecState = getCloudExecutionStateSummary();

            // Build next prompt with tool results
            const hasBrowserActions = iterationToolResults.some(tr => tr.tool && tr.tool.startsWith('browser_'));
            const continueHint = hasBrowserActions
              ? 'A page snapshot was auto-captured above with element [ref=N] numbers. Use browser_click, browser_type, etc. with [ref=N] to interact. Continue the task.'
              : 'Continue with the task. If more steps are needed, call the appropriate tools. If the task is complete, provide a summary.';
            currentCloudPrompt = `${cloudExecState}${cloudStepDirective}Here are the results of the tool calls:\n\n${toolSummary}\n\n${continueHint}`;
          }

          memoryStore.addConversation('assistant', fullCloudResponse);

          // Clean up response display (heavy patterns already cleaned incrementally per-iteration)
          let cleanCloudResponse = fullCloudResponse;
          // Strip raw inline JSON tool calls — nested-brace-aware to avoid leaking trailing }
          // e.g. {"tool":"write_file","params":{"filePath":"x","content":"y"}} → fully removed
          cleanCloudResponse = cleanCloudResponse.replace(/\[?\s*\{[^{}]*"(?:tool|name)"\s*:\s*"[^"]*"[^{}]*"(?:params|arguments)"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*\}\s*\]?/g, '');
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
            success: true, text: cleanCloudResponse, model: `${context.cloudProvider}/${context.cloudModel}`,
            tokensUsed: finalTokensUsed,
          };
        }
      }

      // Default: use local LLM with agentic loop

      // node-llama-cpp 3.x has no built-in vision API — but if Ollama is running
      // locally with a VL model, we can silently re-route the request there instead.
      if (context?.images?.length > 0) {
        let routedToOllama = false;
        try {
          const ollamaUp = await cloudLLM.detectOllama();
          if (ollamaUp) {
            const vlModels = cloudLLM.getOllamaVisionModels();
            if (vlModels.length > 0) {
              console.log(`[AI Chat] Images detected with local model — routing to Ollama VL model: ${vlModels[0]}`);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-token', `*Using Ollama local vision model: ${vlModels[0]}*\n\n`);
              }
              context.cloudProvider = 'ollama';
              context.cloudModel = vlModels[0];
              routedToOllama = true;
            }
          }
        } catch (_) {}
        if (!routedToOllama) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('llm-token', `\n\n*⚠️ Local models cannot process images. Install Ollama (ollama.com) and pull a vision model (e.g. \`ollama pull llava\`), or configure Google Gemini / OpenAI in Settings → Cloud Providers.*\n\n`);
          }
          context.images = [];
        }
      }

      // BUG-024: If a model switch is in progress, wait for it to finish before dispatching.
      if (llmEngine.isLoading) {
        if (mainWindow) mainWindow.webContents.send('llm-token', '*⏳ Waiting for model to finish loading...*\n\n');
        try {
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => {
              llmEngine.removeListener('status', onStatus);
              reject(new Error('Model load timed out after 120 seconds.'));
            }, 120000);
            function onStatus(s) {
              if (s.state === 'ready') {
                clearTimeout(t);
                llmEngine.removeListener('status', onStatus);
                resolve();
              } else if (s.state === 'error') {
                clearTimeout(t);
                llmEngine.removeListener('status', onStatus);
                reject(new Error(`Model failed to load: ${s.message}`));
              }
            }
            llmEngine.on('status', onStatus);
          });
        } catch (waitErr) {
          if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[${waitErr.message}]*\n`);
          return { success: false, error: waitErr.message };
        }
        if (isStale()) return { success: false, error: 'Request superseded while waiting for model.' };
      }

      // BUG-024: If no model is loaded at all, tell the user immediately instead of throwing.
      if (!llmEngine.isReady) {
        const msg = '*No model is loaded. Please select a model before chatting.*';
        if (mainWindow) mainWindow.webContents.send('llm-token', msg);
        return { success: false, error: 'No model loaded.' };
      }

      const modelStatus = llmEngine.getStatus();
      const hwContextSize = modelStatus.modelInfo?.contextSize || 32768;

      // Helper functions (defined early — needed for budget calculation)
      const estimateTokens = (text) => Math.ceil((text || '').length / 4);
      
      // ── ModelProfile-driven budgeting ──
      // The ModelProfile registry provides effective context size, response reserve %,
      // and max response tokens tuned per model family and size tier.
      const modelTier = llmEngine.getModelTier();
      let modelProfile = modelTier.profile;
      const isSmallLocalModel = modelTier.paramSize > 0 && modelTier.paramSize <= 4;

      // Use the hardware context size — this is what node-llama-cpp actually allocated.
      // The engine already targets the profile's effectiveContextSize during allocation
      // and auto-shrinks if resources are insufficient, so hwContextSize is the true ceiling.
      const totalCtx = hwContextSize;

      const actualSystemPrompt = llmEngine._getActiveSystemPrompt();
      const sysPromptReserve = estimateTokens(actualSystemPrompt) + 50;
      console.log(`[AI Chat] Profile: ${modelProfile._meta.profileSource} | ctx=${totalCtx} (hw=${hwContextSize}) | sysReserve=${sysPromptReserve} | compact=${isSmallLocalModel}`);

      // Response budget from profile (percentage-based with hard cap)
      const maxResponseTokens = Math.min(
        Math.floor(totalCtx * modelProfile.context.responseReservePct),
        modelProfile.context.maxResponseTokens
      );
      const maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);
      
      // Detect task type for tool filtering
      const detectTaskType = (msg) => {
        const lower = (msg || '').toLowerCase().trim();
        // Greetings and casual chat — no tools needed at all
        // CRITICAL: Be VERY conservative here. Misclassifying a task as 'chat' means
        // ZERO tools are provided and the model CAN'T do anything. Only pure greetings
        // and truly conversational messages should be 'chat'.
        // Greeting detection: split the message into comma/sentence segments and check
        // if ALL segments are pure greetings. This handles compound greetings like
        // "Hi, how are you?" and "Thanks, see you later!" which a single-anchor regex misses.
        const greetingSegment = /^(hi+|hello+|hey+|yo+|sup|howdy|hola|greetings|good\s*(morning|evening|afternoon|night)|what'?s?\s*up|how\s*are\s*you|how'?s?\s*it\s*going|thanks?\s*(?:for\s+(?:the|your|all\s+(?:the|your))?\s*(?:help|assistance|support|time|effort|response|answer)[s!.]*)?|thank\s*you\s*(?:so\s*much|a\s*lot|very\s*much|again)?|bye|goodbye|see\s*ya|cheers|nice|cool|ok|okay|sure|yep|yeah|nope|no|yes|lol|lmao|haha|wow|great|awesome|who\s*are\s*you|what\s*are\s*you|what\s*can\s*you\s*do|tell\s*me\s*about\s*yourself|what'?s?\s*your\s*name|wtf|omg|bruh|hmm+|idk)[!?.,\s]*$/i;
        const greetingSegments = lower.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
        if (greetingSegments.length > 0 && greetingSegments.every(seg => greetingSegment.test(seg))) return 'chat';

        // Pure knowledge questions that don't need real-time tools.
        // These are questions about static facts (geography, history, definitions, concepts, math)
        // that a language model already knows. Only applies when no action words are present and
        // no real-time data is requested.
        // Examples: "What is the capital of France?", "Explain recursion", "Who was Einstein?"
        // NOT caught: "What's the current weather?", "Find me the latest news", "Create a file"
        const requiresRealTimeData = /\b(today|current(?:ly)?|right\s+now|latest|recent(?:ly)?|this\s+(?:week|month|year)|live|real.?time|price|weather|stock|news|headlines|trending|2024|2025|2026)\b/i;
        const knowledgeQuestionStart = /^(?:what\s+(?:is|are|was|were|does|do|did)|who\s+(?:is|are|was|were)|when\s+(?:is|are|was|were|did)|where\s+(?:is|are|was|were)|how\s+(?:is|are|does|do|did)\s+(?!(?:i|you\s+do))|why\s+(?:is|are|was|were|does|do|did)|explain\s+|describe\s+|define\s+|what\s+does\s+\w+\s+(?:mean|stand\s+for)|tell\s+me\s+(?:the|a|about\s+(?:the\s+)?(?:concept|meaning|definition|history|difference)))/i;
        const hardActionInKnowledge = /\b(find|search|look\s*up|browse|create|make|build|write|edit|install|download|buy|order|shop|navigate|go\s+to|fetch|scrape|get\s+me|show\s+me)\b/i;
        if (knowledgeQuestionStart.test(lower) && !requiresRealTimeData.test(lower) && !hardActionInKnowledge.test(lower) && lower.length < 200) {
          return 'chat';
        }

        // Action words that ALWAYS mean the user wants something done — never classify as chat
        const actionWords = /\b(find|search|look\s*up|browse|navigate|buy|order|shop|price|cheap|ebay|amazon|walmart|google|download|install|create|make|build|write|edit|open|go\s+to|show\s+me|get\s+me|fetch|scrape|research|compare|check|look\s+for|news|headlines|weather|stock|recipe|review|product|laptop|phone|computer)\b/i;
        if (actionWords.test(lower)) {
          // Has action words — determine if browser or code
          const browserWords = /\b(browse|navigate|website|webpage|url|http|www\.|\.com|\.org|\.edu|\.net|visit|open.*site|go\s+to|search\s+online|google|login|sign\s+in|ebay|amazon|walmart|shop|buy|order|price|cheap|news|headlines|weather|stock|recipe|review|product|laptop|phone|computer)\b/;
          const codeWords = /\b(code|file|function|class|variable|debug|fix|error|compile|build|refactor|write.*code|edit.*file|create.*file|read.*file|search.*code|git|commit|branch)\b/;
          const isBrowser = browserWords.test(lower);
          const isCode = codeWords.test(lower);
          if (isBrowser && isCode) return 'general';
          if (isBrowser) return 'browser';
          if (isCode) return 'code';
          return 'general';
        }

        // Short messages (under 15 chars) with no technical keywords = likely casual
        if (lower.length < 15 && !/\b(file|code|bug|error|browse|navigate|search|http|www\.|\.com|create|build|write|edit|run|fix|debug|git|install|deploy|test|compile|refactor|find|look|get|show|make)\b/.test(lower)) return 'chat';

        // Only classify as 'chat' for truly casual questions about feelings/opinions
        // with NO action verbs and NO external topics
        const pureCasualQuestion = /^(what|who|how)\s+(is|are|do|does)\s+(your|you)\s+(name|favorite|feeling|opinion)/i;
        if (pureCasualQuestion.test(lower) && lower.length < 50) return 'chat';

        const browserWords = /\b(browse|navigate|website|webpage|url|http|www\.|\.com|\.org|\.edu|\.net|visit|open.*site|go\s+to|search\s+online|google|login|sign\s+in)\b/;
        const codeWords = /\b(code|file|function|class|variable|debug|fix|error|compile|build|refactor|write.*code|edit.*file|create.*file|read.*file|search.*code|git|commit|branch)\b/;
        const isBrowser = browserWords.test(lower);
        const isCode = codeWords.test(lower);
        // Mixed tasks (browse + save/write/list files) need BOTH tool sets.
        if (isBrowser && isCode) return 'general';
        if (isBrowser) return 'browser';
        if (isCode) return 'code';
        return 'general';
      };
      let taskType = detectTaskType(message);
      console.log(`[AI Chat] Detected task type: ${taskType}`);

      // BUG-029: If the prompt budget is too tight to fit tool definitions, fall back to
      // chat-only mode with a user-facing warning rather than silently failing or looping.
      // Threshold is model-profile-aware: compact/grammar-only styles cost ~150 tok,
      // full tool prompts cost ~2000 tok.
      {
        const _isCompactStyle = modelProfile.prompt.toolPromptStyle === 'grammar-only' ||
                                 modelProfile.prompt.toolPromptStyle === 'compact';
        const _toolCostEstimate = _isCompactStyle ? 150 : 2000;
        if (taskType !== 'chat' && maxPromptTokens < _toolCostEstimate) {
          // If full tool style doesn't fit but compact would, downgrade — don't strip tools entirely.
          // This keeps small-context models in agentic mode with a reduced tool prompt.
          if (!_isCompactStyle && maxPromptTokens >= 150) {
            modelProfile = { ...modelProfile, prompt: { ...modelProfile.prompt, toolPromptStyle: 'compact' } };
            console.warn(`[Context] BUG-029: downgrading tool style to compact (maxPromptTokens=${maxPromptTokens}) — keeping tools available`);
          } else {
            // Truly too small even for compact — chat-only as last resort
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('llm-token',
                `*Note: this model's context window is too small to load tool definitions — responding without tools.*\n\n`);
            }
            taskType = 'chat';
            console.warn(`[Context] BUG-029: maxPromptTokens=${maxPromptTokens} < 150 (compact cost) — falling back to chat-only mode`);
          }
        }
      }

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

        // User's custom system prompt OR default preamble (from Advanced Settings).
        // Preamble selection priority:
        //   1. User's custom system prompt (from Advanced Settings) — always wins
        //   2. Chat preamble (3 lines) — when task type is 'chat' (greetings, casual conversation,
        //      knowledge questions). No tools are injected for chat tasks, so no executor language needed.
        //   3. Compact preamble — small models (tiny/small tier) on action tasks
        //   4. Full preamble — medium/large/xlarge models on action tasks
        const savedSettings = _readConfig()?.userSettings;
        const userPreamble = savedSettings?.systemPrompt && typeof savedSettings.systemPrompt === 'string' && savedSettings.systemPrompt.trim();
        const isSmallModel = modelProfile.prompt.style === 'compact';
        const _preambleTaskType = taskTypeOverride || taskType;
        const defaultPreamble = _preambleTaskType === 'chat'
          ? (DEFAULT_CHAT_PREAMBLE || DEFAULT_SYSTEM_PREAMBLE)
          : (isSmallModel ? (DEFAULT_COMPACT_PREAMBLE || DEFAULT_SYSTEM_PREAMBLE) : DEFAULT_SYSTEM_PREAMBLE);
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

        // Few-shot examples for small models — teaches correct tool usage format
        // by showing concrete input→output pairs. Dramatically improves tool call
        // accuracy for ≤4B models that can't reliably infer format from descriptions alone.
        if (effectiveTaskType !== 'chat' && modelProfile.prompt.fewShotExamples > 0) {
          const fewShotCount = modelProfile.prompt.fewShotExamples;
          const examples = [];

          // Task-appropriate examples — each shows a user request and the correct tool call response
          if (effectiveTaskType === 'code' || effectiveTaskType === 'general') {
            examples.push({
              user: 'Create a simple calculator app',
              assistant: '```json\n{"tool":"write_file","params":{"filePath":"calculator.html","content":"<!DOCTYPE html>\\n<html><head><title>Calculator</title></head><body><h1>Calculator</h1><input id=\\"display\\"><script>/* calculator logic */</script></body></html>"}}\n```',
            });
            examples.push({
              user: 'Read the contents of main.js',
              assistant: '```json\n{"tool":"read_file","params":{"filePath":"main.js"}}\n```',
            });
          }
          if (effectiveTaskType === 'browser' || effectiveTaskType === 'general') {
            examples.push({
              user: 'Search for the latest news about AI',
              assistant: '```json\n{"tool":"web_search","params":{"query":"latest AI news 2026"}}\n```',
            });
            examples.push({
              user: 'Go to github.com',
              assistant: '```json\n{"tool":"browser_navigate","params":{"url":"https://github.com"}}\n```',
            });
          }

          // Use up to fewShotCount examples
          const selected = examples.slice(0, fewShotCount);
          if (selected.length > 0) {
            let fewShotBlock = '## Examples\n';
            for (const ex of selected) {
              fewShotBlock += `User: ${ex.user}\nAssistant:\n${ex.assistant}\n\n`;
            }
            appendIfBudget(fewShotBlock, 'few-shot');
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
              '.github/copilot-instructions.md', 'CODING_GUIDELINES.md',
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
      const buildDynamicContext = (taskTypeOverride) => {
        const effectiveTaskType = taskTypeOverride || taskType;
        // Chat mode: no dynamic context injection — keep the full context for conversation
        if (effectiveTaskType === 'chat') return '';
        let tokenBudget = Math.floor(maxPromptTokens * 0.4); // Reserve budget for dynamic context
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
      let _incoherentOutputOccurred = false; // Set when incoherent_output fires — prevents salad being stored in memory
      // Smart continuation: track tool call patterns for stuck detection
      let recentToolCalls = []; // [{tool, paramsHash}]
      const toolFailCounts = {}; // Track per-tool failure counts for enrichErrorFeedback
      let consecutiveAllToolFailures = 0; // BUG-005: counter for iterations where every tool fails
      let nudgesRemaining = 3; // Allow 3 nudges when model responds with text instead of tool calls
      let contextRotations = 0; // Track how many times we've rotated context
      const MAX_CONTEXT_ROTATIONS = 10; // Allow up to 10 rotations for long tasks
      let lastConvSummary = ''; // Conversation summary from last rotation
      let sessionJustRotated = false; // Flag to rebuild prompt after rotation
      let savedExplanationText = ''; // Pre-rollback explanation text — used if final response is empty after cleaning
      let forcedToolFunctions = null; // Set by PILLAR 3 refusal recovery to force grammar on next iteration
      let consecutiveEmptyGrammarRetries = 0; // Track grammar failures for text-mode fallback
      let grammarNoToolsCount = 0; // Track grammar attempts that produce text but no tool calls

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
      // For chat-type tasks, the model gets no tool definitions in the system prompt
      // (buildStaticPrompt returns DEFAULT_CHAT_PREAMBLE with no tool schemas).
      // NOTE: Do NOT prepend a chatModeDirective to userMessage. Any text prepended
      // here gets stored as a permanent user turn in chatHistory. On the next request
      // with a different taskType, the engine replaces chatHistory[0] (system) but
      // leaves old user turns intact — creating a contradictory system+user state
      // that causes word salad. The preamble selection is the correct mechanism.
      const dynamicCtx = buildDynamicContext();

      let currentPrompt = {
        // Put the browser "CRITICAL INSTRUCTION" first so it isn't buried
        // under large tool prompts (improves compliance for small/finicky models).
        systemContext: basePrompt,
        userMessage: (dynamicCtx ? '<context>\n' + dynamicCtx + '</context>\n' : '') + browserInstruction + webSearchInstruction + message
      };

      // If the renderer provided conversation history (e.g., after a model switch or session reset),
      // seed the local LLM history so short follow-ups like "continue" remain coherent.
      // Only do this when the local session is effectively fresh.
      try {
        if (Array.isArray(context?.conversationHistory) && context.conversationHistory.length > 0) {
          const isFreshSession = !llmEngine.chatHistory || llmEngine.chatHistory.length <= 1;
          // Fix 5: Do not seed renderer history when the engine JUST loaded a new (different) model.
          // The renderer sends its full message history on every request, but that history was
          // generated by the previous model. Injecting it into the new model primes it with
          // foreign context (function definitions, tool responses) → wrong behavior on first message.
          // _justLoadedNewModel is set true on model switch, cleared here after the decision.
          const isNewModelLoad = llmEngine._justLoadedNewModel === true;
          llmEngine._justLoadedNewModel = false; // Always clear after first message
          if (isFreshSession && !isNewModelLoad) {
            const seeded = [{ type: 'system', text: llmEngine._getActiveSystemPrompt() }];
            // Cap seeded history to prevent overflowing small contexts.
            // Reserve 50% of context for new generation; each turn ~150 tokens avg.
            const maxSeedTurns = Math.max(2, Math.floor((totalCtx * 0.40) / 150));
            const history = context.conversationHistory;
            // Take the most recent turns (skip oldest if too many)
            const startIdx = Math.max(0, history.length - maxSeedTurns);
            let seededCount = 0;
            for (let i = startIdx; i < history.length; i++) {
              const m = history[i];
              if (!m || typeof m.content !== 'string') continue;
              // Skip very long messages that would eat context budget
              const contentLen = m.content.length;
              if (contentLen > totalCtx) continue; // Single message longer than context? Skip.
              if (m.role === 'user') {
                seeded.push({ type: 'user', text: m.content });
              } else if (m.role === 'assistant') {
                // Strip tool-call JSON blocks before seeding into the new model session.
                // Model-specific JSON syntax confuses a different model. Keep natural language
                // context intact so project goals and decisions transfer across model switches.
                const cleanContent = m.content
                  .replace(/```(?:json|tool_call|tool)[^\n]*\n[\s\S]*?```/g, '')
                  .replace(/\{\s*"(?:tool|name)"\s*:\s*"[^"]+"\s*,\s*"(?:params|arguments)"[\s\S]*?\}/g, '')
                  .replace(/\n{3,}/g, '\n\n')
                  .trim();
                if (cleanContent) seeded.push({ type: 'model', response: [cleanContent] });
              }
              seededCount++;
            }
            llmEngine.chatHistory = seeded;
            llmEngine.lastEvaluation = null;
            console.log(`[AI Chat] Seeded local chatHistory from renderer (${seededCount} of ${history.length} turns, max=${maxSeedTurns} for ${totalCtx}-token context)`);
          }
        }
      } catch (e) {
        console.warn('[AI Chat] Failed to seed local conversation history:', e?.message || e);
      }

      memoryStore.addConversation('user', message);

      // ── Model Capability Tiering ──
      // modelTier already computed above (for prompt budget calculation)
      console.log(`[AI Chat] Model: ${modelProfile._meta.profileSource} (${modelTier.paramSize}B ${modelTier.family}) — tools=${modelTier.maxToolsPerPrompt}, grammar=${modelTier.tier === 'tiny' ? 'never' : modelTier.grammarAlwaysOn ? (modelTier.tier === 'small' ? 'limited(3)' : 'always') : 'limited'}, retry=${modelTier.retryBudget}, quirks=${JSON.stringify(modelProfile.quirks)}`);

      // NOTE: Behavioral priming was removed — injecting fake tool-calling history
      // caused models of all sizes to force tool use on non-tool tasks (e.g., greetings
      // classified as 'general' would trigger unnecessary web_search calls).

      // ── Transactional Rollback State ──
      let rollbackRetries = 0;
      const maxRollbackRetries = modelTier.retryBudget;
      let savedTemperature = null; // Preserve original temperature across rollback retries (BUG-2 fix)

      let nonContextRetries = 0;
      let lastIterationResponse = ''; // Track for repetition detection
      // For chat/greeting tasks, only 1 iteration (no agentic loop)
      // Always allow full iterations — even for 'chat' tasks, the model may need tools.
      // Previously this was gated to 1 iteration for chat, which prevented tool use entirely.
      const effectiveMaxIterations = MAX_AGENTIC_ITERATIONS;
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
        // Before generating, check context usage. If already high (>60%),
        // proactively compact BEFORE the generation call. At 90%+, force
        // rotation to prevent node-llama-cpp from hanging on a full KV cache.
        // Runs on ALL iterations (including first) to catch contexts that were
        // already near-full from seeded chatHistory or prior conversations.
        {
          try {
            let preGenContextUsed = 0;
            // ACCURATE method: read actual KV cache token count from sequence
            try {
              if (llmEngine.sequence?.nTokens) preGenContextUsed = llmEngine.sequence.nTokens;
            } catch (_) {}
            // Fallback: rough character-based estimation
            if (!preGenContextUsed) {
              const promptLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
              // Also factor in chatHistory length for more accurate estimation
              let historyLen = 0;
              try {
                for (const entry of (llmEngine.chatHistory || [])) {
                  if (entry.type === 'user') historyLen += (entry.text || '').length;
                  else if (entry.type === 'model') historyLen += (Array.isArray(entry.response) ? entry.response.join('').length : 0);
                  else if (entry.type === 'system') historyLen += (entry.text || '').length;
                }
              } catch (_) {}
              preGenContextUsed = Math.ceil(Math.max(historyLen, promptLen + fullResponseText.length) / 4);
            }
            const preGenPct = preGenContextUsed / totalCtx;

            // Report context usage to UI on every iteration
            if (mainWindow) {
              mainWindow.webContents.send('context-usage', { used: preGenContextUsed, total: totalCtx });
            }

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
              // Force rotation at 80%+ (previously 85%) — prevents model from
              // entering the "nearly full" zone where generation slows to a crawl
              if ((preCompaction.shouldRotate || preGenPct > 0.80) && contextRotations < MAX_CONTEXT_ROTATIONS) {
                contextRotations++;
                console.log(`[AI Chat] Pre-generation rotation ${contextRotations}/${MAX_CONTEXT_ROTATIONS} at ${Math.round(preGenPct * 100)}%`);
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'rotating-context', status: 'start', label: `Rotating context (${Math.round(preGenPct * 100)}% used)` });
                summarizer.markRotation();
                lastConvSummary = summarizer.generateQuickSummary();
                await llmEngine.resetSession(true);
                sessionJustRotated = true;
                const rotatedBase = buildStaticPrompt();
                currentPrompt = {
                  systemContext: rotatedBase,
                  userMessage: buildDynamicContext() + '\n' + lastConvSummary + '\nContext was rotated. Continue with the task from where you left off.'
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
        const effectiveMaxTokens = taskType === 'chat' 
          ? (context?.params?.maxTokens || chatResponseBudget)
          : (context?.params?.maxTokens || maxResponseTokens);

        // ── Decide: Native Function Calling vs Legacy Text Parsing ──
        // Native function calling uses node-llama-cpp's grammar-constrained decoding
        // to produce valid tool calls. However, grammar constraining can CORRUPT output
        // for models whose probability distributions don't align with the grammar —
        // they're forced to select low-probability tokens, producing gibberish.
        //
        // ARCHITECTURE: Text-first for small models, grammar for capable ones.
        // - tiny models (≤1B): ALWAYS text mode — too small for grammar, use parser instead
        // - small models (1-4B): grammar for first 3 iterations, then text mode fallback
        // - medium models (≤8B): grammar always (these models handle it well)
        // - large models (8-14B): grammar for first 5 iterations
        // - xlarge models (14B+): grammar for first 2 iterations
        // Text mode generation + mcpToolParser is the safer path — it lets the model
        // generate from its natural distribution (coherent output) and extracts tool
        // calls from the text post-hoc. This matches how models behave in LM Studio.
        // GRAMMAR DISABLED — was causing infinite loops, stuck generation, and Phi-4 zero tokens.
        // Text mode + mcpToolParser is the only reliable path.
        const grammarIterLimit = 0;
        const useNativeFunctions = false;
        let nativeFunctions = null;
        if (consecutiveEmptyGrammarRetries >= 2 || grammarNoToolsCount >= 2) {
          // Grammar-to-text fallback: model can't produce useful grammar output.
          // This triggers on EITHER empty responses OR grammar producing text but no tool calls.
          nativeFunctions = null;
          forcedToolFunctions = null;
          console.log(`[AI Chat] Grammar disabled — text mode fallback (empty=${consecutiveEmptyGrammarRetries}, noTools=${grammarNoToolsCount})`);
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
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'optimizing-tools', status: 'start', label: 'Optimizing tool selection' });
            const filterNames = getProgressiveTools(taskType, iteration, recentToolNames, modelTier.maxToolsPerPrompt);
            nativeFunctions = LLMEngine.convertToolsToFunctions(toolDefs, filterNames);
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'optimizing-tools', status: 'done', label: 'Optimizing tool selection' });
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
          const localTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: 25, maxBufferChars: 2048 });
          const localThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });
          try {
            if (nativeFunctions && Object.keys(nativeFunctions).length > 0) {
              // ── NATIVE FUNCTION CALLING PATH ──
              // Grammar-constrained: model can only produce valid tool calls.
              // Use a SHORT timeout (5s) because grammar-constrained generation
              // either produces conformant tokens within seconds or gets permanently
              // stuck in rejection sampling. If it can't produce tokens in 5s, it
              // won't in 15s. This keeps the 2-retry → text-fallback cycle under
              // ~15s instead of ~35s.
              const GRAMMAR_TIMEOUT_MS = 5_000;
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
                  // Tool calls are surfaced via the 'tool-executing' IPC event after generation
                  // completes. Do NOT also push to llm-token — that would double-render the JSON
                  // as raw text in the chat bubble alongside the CollapsibleToolBlock.
                  void funcCall;
                },
                { timeoutMs: GRAMMAR_TIMEOUT_MS }
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
                taskType: taskType,
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
          const isContextOverflow = genError.message?.startsWith('CONTEXT_OVERFLOW:');

          // Only rotate context on actual context overflow. Previously, ANY generation
          // error could trigger rotation, which looked like the app was "summarizing"
          // on the very first turn.
          if (isContextOverflow && contextRotations < MAX_CONTEXT_ROTATIONS) {
            contextRotations++;
            console.log(`[AI Chat] Context rotation ${contextRotations}/${MAX_CONTEXT_ROTATIONS} — summarizing and continuing`);
            
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'rotating-context', status: 'start', label: 'Rotating context — freeing space' });
            
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
                mainWindow.webContents.send('llm-thinking-token', convSummary + '\n[Context rotated — continuing seamlessly]\n');
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
                  // BUG-044: Reapply correct wrapper — new LlamaChat() resets to auto-detected
                  // default which may be wrong (e.g. Llama3ChatWrapper for Llama 3.2).
                  llmEngine._applyChatWrapperOverride();
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
                      // BUG-044: Reapply correct wrapper after last-resort recreation.
                      llmEngine._applyChatWrapperOverride();
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
              currentPrompt = {
                systemContext: rotatedBase,
                userMessage: buildDynamicContext() + '\n' + convSummary + '\nContext was rotated. Continue with the task from where you left off.'
              };
              sessionJustRotated = true;
              lastConvSummary = convSummary;
              continue;
            } catch (resetErr) {
              console.error('[AI Chat] Context rotation failed:', resetErr.message);
            }
          }
          
          // BUG-012: Terminal break when context rotation limit is exhausted
          if (isContextOverflow && contextRotations >= MAX_CONTEXT_ROTATIONS) {
            const maxMsg = `\n\n*[Context rotated ${MAX_CONTEXT_ROTATIONS}/${MAX_CONTEXT_ROTATIONS} times — conversation too long. Please start a new chat.]*\n`;
            if (mainWindow) mainWindow.webContents.send('llm-token', maxMsg);
            fullResponseText += maxMsg;
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

        // ── BUG-038: Consecutive Stutter Detection & Auto-Clear ──
        // If the engine aborted due to repetition/template-spam, handle it immediately
        // before any other logic. Don't commit stutter text; track consecutive failures.
        if (result.stopReason === 'repetition' || result.stopReason === 'template') {
          _consecutiveStutterAborts++;
          console.log(`[AI Chat] Stutter abort detected (${_consecutiveStutterAborts} consecutive)`);
          if (_consecutiveStutterAborts >= 3) {
            _consecutiveStutterAborts = 0;
            // Wipe chatHistory to system prompt only — the context is poisoned
            llmEngine.chatHistory = [{ type: 'system', text: llmEngine._getActiveSystemPrompt() }];
            llmEngine.lastEvaluation = null;
            try { await llmEngine.resetSession(true); } catch (_e) {}
            const clearMsg = '\n\n*[⚠️ The model entered a stutter loop 3 times in a row. Context has been cleared to break the cycle. Please resend your message.]*\n';
            if (mainWindow) mainWindow.webContents.send('llm-token', clearMsg);
            fullResponseText += clearMsg;
          } else {
            const stutterMsg = '\n\n*[The model produced repeated output and was stopped. Please try again.]*\n';
            if (mainWindow) mainWindow.webContents.send('llm-token', stutterMsg);
            fullResponseText += stutterMsg;
          }
          break; // Never commit stutter text — end this request here
        } else {
          _consecutiveStutterAborts = 0; // Reset on any successful (non-stutter) generation
        }

        // ── Grammar Effectiveness Tracking ──
        // Track whether grammar-constrained generation is actually producing tool calls.
        // If grammar keeps producing text-only output (no function calls) for agentic tasks,
        // it means the model's distribution doesn't align with the grammar — switch to text mode.
        // This catches the case where grammar produces GIBBERISH text (not empty, so the
        // consecutiveEmptyGrammarRetries counter never fires, and grammar stays on forever).
        if (nativeFunctions && Object.keys(nativeFunctions).length > 0 && taskType !== 'chat') {
          if (nativeFunctionCalls.length === 0) {
            grammarNoToolsCount++;
            console.log(`[AI Chat] Grammar produced no tool calls (${grammarNoToolsCount} consecutive) — response length: ${responseText.length}`);
          } else {
            grammarNoToolsCount = 0; // Reset on successful grammar tool call
          }
        }

        // ── Transactional Rollback Evaluation ──
        // Evaluate the response BEFORE committing it to context.
        // If it's a failure (refusal, hallucination, empty), rollback and retry.
        // The model never sees its own failures — no failure contagion.
        const responseVerdict = evaluateResponse(responseText, nativeFunctionCalls, taskType, iteration);
        // BUG-014: Timeout results should never trigger a ROLLBACK loop — we have
        // the best partial response we can get. Force COMMIT to break the cycle.
        if (result?.wasTimeout && responseVerdict.verdict === 'ROLLBACK') {
          console.log('[AI Chat] Generation timed out — accepting partial response to avoid ROLLBACK loop');
          responseVerdict.verdict = 'COMMIT';
          responseVerdict.reason = 'timeout_accept';
        }
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
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'retrying', status: 'start', label: `Retrying (${rollbackRetries}/${maxRollbackRetries})...` });
          // BUG-019: Clear the already-streamed failed tokens from the chat UI.
          // Before clearing: save any pre-tool-call explanation text as a fallback
          // so we can show it to the user if all retries also fail to produce a clean response.
          const _preRollback = responseText
            .replace(/```(?:json|tool)?[\s\S]*?```/g, '')
            .replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, '')
            .trim();
          // BUG-FIX: Lower threshold from 20 → 3 so short planning phrases like
          // "I'll check" are preserved. Also strip <think> tags before checking length.
          const _preRollbackClean = _preRollback
            .replace(/<think(?:ing)?>([ -￿]*?)<\/think(?:ing)?>/gi, '')
            .trim();
          if (_preRollbackClean.length > 3 && !savedExplanationText) {
            savedExplanationText = _preRollbackClean;
          }
          if (mainWindow) mainWindow.webContents.send('llm-replace-last', '');

          // Restore checkpoint — model never sees its failure
          if (checkpoint.chatHistory) {
            llmEngine.chatHistory = checkpoint.chatHistory;
            llmEngine.lastEvaluation = checkpoint.lastEvaluation;
          }

          // Escalating retry strategy
          if (rollbackRetries === 1) {
            // First retry: same prompt, slightly lower temperature for focus
            if (context?.params) {
              if (savedTemperature === null) savedTemperature = context.params.temperature; // Preserve original before mutation
              context.params.temperature = Math.max((context.params.temperature || 0.7) - 0.2, 0.1);
            }
            // BUG-031/BUG-030: For described_not_executed, inject explicit correction on the FIRST retry.
            // Simply re-sending the identical prompt causes models to refuse or repeat the same
            // behaviour (they pattern-match "already tried"). An explicit JSON nudge breaks the loop.
            if (responseVerdict.reason === 'described_not_executed') {
              currentPrompt = {
                systemContext: buildStaticPrompt(),
                userMessage: `CORRECTION: Your last response described an action in plain text instead of executing it as a tool call. You MUST output a JSON tool call block \u2014 do NOT explain, narrate, or apologize. Just call the tool NOW.\n\nUser request: ${message.substring(0, 500)}\n\nOutput the JSON tool call immediately:`,
              };
            }
          } else if (rollbackRetries === 2) {
            // Second retry: simplified prompt with explicit tool instruction
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: `You MUST use a tool to respond. The user asked: ${message.substring(0, 500)}\n\nCall the appropriate tool NOW using this format:\n\`\`\`json\n{"tool": "tool_name", "params": {"key": "value"}}\n\`\`\``,
            };
          } else {
            // Third+ retry: force grammar-constrained with narrowed tools
            // MUST use forcedToolFunctions (outer-scope flag) because `continue` restarts
            // the loop and the grammar setup at the top would overwrite nativeFunctions.
            try {
              const toolDefs = mcpToolServer.getToolDefinitions();
              const lower = (message || '').toLowerCase();
              let forcedFilter = null;
              if (/\b(search|look\s*up|find|news|weather|current|latest)\b/i.test(lower)) forcedFilter = ['web_search'];
              else if (/\b(go\s*to|navigate|open|visit|browse|\.com|\.org|https?:)\b/i.test(lower)) forcedFilter = ['browser_navigate', 'web_search'];
              else if (/\b(create|write|save|make)\b.*\bfile\b/i.test(lower)) forcedFilter = ['write_file'];
              else if (/\b(read|show|open)\b.*\bfile\b/i.test(lower)) forcedFilter = ['read_file', 'list_directory'];
              else if (/\b(run|execute|install|npm|python)\b/i.test(lower)) forcedFilter = ['run_command'];
              else forcedFilter = ['web_search', 'write_file', 'read_file', 'run_command'];
              forcedToolFunctions = LLMEngine.convertToolsToFunctions(toolDefs, forcedFilter);
              console.log(`[AI Chat] Forced grammar with ${Object.keys(forcedToolFunctions).length} tools for retry ${rollbackRetries}`);
            } catch (_) {}
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: `SYSTEM OVERRIDE: Complete this request using tools. Request: ${message.substring(0, 500)}`,
            };
          }

          // Don't increment iteration — this is a retry of the same step
          iteration--;
          continue;
        }
        // Reset rollback counter on successful response
        if (responseVerdict.verdict === 'COMMIT') {
          rollbackRetries = 0;
          consecutiveEmptyGrammarRetries = 0;
          // Restore temperature that may have been lowered during rollback retries (BUG-2 fix)
          if (savedTemperature !== null && context?.params) {
            context.params.temperature = savedTemperature;
            savedTemperature = null;
          }
          // ── COMMIT: record response for display ──
          fullResponseText += responseText;
          displayResponseText += responseText;
          console.log(`[AI Chat] Response committed to display: ${responseText.length} chars | display total: ${displayResponseText.length} chars | preview: "${responseText.replace(/<think[\s\S]*?<\/think>/gi, '').substring(0, 60).replace(/\n/g, '\\n')}"`);
        } else if (responseVerdict.verdict === 'ROLLBACK') {
          // Budget exhausted — forced to accept bad response (BUG-1 fix)
          // Reset rollback counter so future iterations can still use rollback safety.
          // BUT do NOT reset consecutiveEmptyGrammarRetries — if grammar proved
          // ineffective (produced 0 tokens), re-enabling it just causes the same
          // 15s×2 timeout cycle on the next iteration, cascading into a 7+ minute hang.
          console.log(`[AI Chat] ⚠️ Rollback budget exhausted — discarding garbage response, grammar stays ${consecutiveEmptyGrammarRetries >= 2 ? 'DISABLED' : 'enabled'}`);
          rollbackRetries = 0;
          // consecutiveEmptyGrammarRetries intentionally NOT reset — grammar stays disabled
          if (savedTemperature !== null && context?.params) {
            context.params.temperature = savedTemperature;
            savedTemperature = null;
          }
          // BUG-034 FIX: Do NOT add the garbage response to displayResponseText.
          // The last retry already streamed tokens to the UI — clear them now.
          // This prevents the garbage from entering result.text → messages[] → conversationHistory,
          // which was the root cause of context contamination across model switches and to cloud.
          if (mainWindow) mainWindow.webContents.send('llm-replace-last', '');
          fullResponseText += responseText; // Keep in raw log for debugging but not display
          console.log(`[AI Chat] Response NOT committed to display (garbage rollback): ${responseText.length} chars dropped | display remains ${displayResponseText.length} chars`);
          // Skip displayResponseText += responseText intentionally
        }

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

          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'summarizing-history', status: 'start', label: 'Summarizing conversation history' });
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
            if (mainWindow) {
              mainWindow.webContents.send('llm-thinking-token', `[Context compaction phase ${compaction.phase}: ${compaction.pruned} items compacted at ${Math.round((contextUsed / totalCtx) * 100)}%]\n`);
            }
          }
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'summarizing-history', status: 'done', label: 'Summarizing conversation history' });

          // Phase 4: Hard rotation as absolute last resort
          if (compaction.shouldRotate && contextRotations < MAX_CONTEXT_ROTATIONS) {
            contextRotations++;
            console.log(`[AI Chat] Context rotation ${contextRotations}/${MAX_CONTEXT_ROTATIONS} at ${Math.round((contextUsed / totalCtx) * 100)}% (compaction phase 4)`);
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'compressing-context', status: 'start', label: 'Compressing context' });
            
            summarizer.markRotation();
            lastConvSummary = summarizer.generateQuickSummary();
            
            if (lastConvSummary && mainWindow) {
              mainWindow.webContents.send('llm-thinking-token', lastConvSummary + '\n[Context rotated — continuing seamlessly]\n');
            }
            
            await llmEngine.resetSession(true);
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'compressing-context', status: 'done', label: 'Compressing context' });
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
              // Real-time gatheredWebData update — runs BEFORE write deferral messages are built
              // for subsequent calls in the same batch. This ensures the deferral hint includes
              // the data the model just gathered, so it can write the file on the next iteration.
              if (call.tool === 'web_search' && toolResult?.success && Array.isArray(toolResult?.results)) {
                for (const r of toolResult.results) {
                  if (r.title && r.url) gatheredWebData.push({ title: r.title, url: r.url, snippet: r.snippet || '' });
                }
              }
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
        } else if (taskType === 'chat') {
          // ── BUG-016: CHAT-TYPE HARD GATE (moved before processResponse) ──
          // For chat-type tasks (greetings, casual conversation), NEVER execute tools.
          // Exception: if the ENTIRE response is function-call JSON (no text content at all),
          // route it through processResponse. Function-calling-specialist models (e.g.
          // Qwen3-4B-Function-Calling-Pro) emit OpenAI array JSON even for "hi" — we should
          // attempt to parse/execute it rather than display raw JSON to the user.
          const _cleanedForGate = (responseText || '').replace(/<think[\s\S]*?<\/think>/gi, '').trim();
          const _isPureFnCallJSON = /^\[?\s*\{\s*"name"\s*:/.test(_cleanedForGate) && !_cleanedForGate.replace(/[\s\[\]{}",:.\w-]/g, '').length;
          if (_isPureFnCallJSON) {
            console.log(`[AI Chat] Chat-type gate: response is pure function-call JSON — routing to processResponse instead of displaying raw JSON`);
            const textOpts = { toolPaceMs: localToolPace, skipWriteDeferral: modelTier.tier === 'tiny' };
            toolResults = await mcpToolServer.processResponse(responseText, textOpts);
          } else {
            console.log(`[AI Chat] Chat-type hard gate | USER_MSG="${message.substring(0, 40)}" | MODEL_GENERATED="${_cleanedForGate.substring(0, 60).replace(/\n/g, '\\n')}" (${(responseText || '').length} raw chars) — skipping tool parsing`);
            toolResults = { hasToolCalls: false, results: [], toolCalls: [], capped: false, skippedToolCalls: 0 };
          }
        } else {
          // ── LEGACY TEXT PARSING PATH ──
          const textOpts = { toolPaceMs: localToolPace, skipWriteDeferral: modelTier.tier === 'tiny' };
          if (iteration === 1 && expectedBrowserUrl) textOpts.enforceNavigateUrl = expectedBrowserUrl;
          toolResults = await mcpToolServer.processResponse(responseText, textOpts);
        }

        // Duplicate call detection: block identical tool+params within same iteration
        if (toolResults.hasToolCalls && toolResults.results.length > 0) {
          const iterationCallSigs = new Set();
          const dedupedResults = [];
          for (const tr of toolResults.results) {
            const callSig = JSON.stringify({ t: tr.tool, p: tr.params });
            if (iterationCallSigs.has(callSig)) {
              console.log(`[AI Chat] Blocking duplicate call: ${tr.tool} with same params`);
              // Replace result with a blocked message
              tr.result = { success: false, error: `BLOCKED: You already called ${tr.tool} with the exact same parameters this turn. Do NOT repeat failing calls. Change your approach.` };
            }
            iterationCallSigs.add(callSig);
            dedupedResults.push(tr);
          }
          toolResults.results = dedupedResults;
        }
        
        // ── Anti-hallucination: strip fake tool results from displayed text ──
        // Small models hallucinate tool outputs inline: "I navigated to X and found Y".
        // If real tool calls were found AND the response also contains hallucinated
        // results text, send a cleaned version to the frontend.
        if (toolResults.hasToolCalls && toolResults.results.length > 0) {
          // Strip: (a) tool call JSON blocks, (b) hallucinated result descriptions that follow them
          let cleaned = responseText;
          // Remove ```json/tool/tool_call blocks entirely
          cleaned = cleaned.replace(/```(?:tool_call|tool|json)[^\n]*\n[\s\S]*?```/g, '');
          // Remove raw JSON tool calls — nested-brace-aware pattern prevents leaking the outer }
          // e.g. {"tool":"read_file","params":{"filePath":"x"}} → fully removed (not just inner })
          cleaned = cleaned.replace(/\{[^{}]*"(?:tool|name)"\s*:\s*"[^"]*"[^{}]*"(?:params|arguments)"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*\}/g, '');
          // Remove hallucinated result lines that follow tool calls
          cleaned = cleaned.replace(/\n*(?:Result|Output|Response|Status|Success|Navigated|Clicked|Typed|Found|Page|Content|Screenshot|Done|OK)[:]\s*[^\n]+/gi, '');
          // Remove "I navigated to..." / "I clicked on..." type hallucinations
          cleaned = cleaned.replace(/\n*(?:I\s+(?:navigated|browsed|went|visited|opened|clicked|typed|searched|found|retrieved|extracted|created|wrote|saved|generated|executed|ran)\s+[^\n]+)/gi, '');
          // Collapse excessive whitespace
          cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

          // Always send llm-replace-last to wipe raw tool JSON from the streaming bubble.
          // When the entire iteration was a tool call, cleaned = '' — sending '' clears
          // the buffer so the stray JSON (or lone trailing }) never commits to the message.
          if (mainWindow) {
            console.log(`[AI Chat] Anti-hallucination: stripped tool JSON (${responseText.length} → ${cleaned.length} chars)`);
            mainWindow.webContents.send('llm-replace-last', cleaned);
          }
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
              // Terminal failure (e.g., repetition, incoherent_output) — end the loop
              if (failure.type === 'incoherent_output') {
                // BUG-039: Context-poison-induced gibberish — wipe chatHistory and reset KV cache
                // so the user's NEXT message starts clean. DO NOT nudge (nudging always fails here).
                _incoherentOutputOccurred = true;
                try {
                  llmEngine.chatHistory = [];
                  await llmEngine.resetSession(true);
                  console.log('[AI Chat] BUG-039: Cleared poisoned context after incoherent_output');
                  // Also purge the most recent assistant turn(s) from memory so that the
                  // NEXT request's buildDynamicContext() does not re-inject word salad as
                  // "Recent Conversation Context". This is what caused the self-perpetuating
                  // salad loop: old salad → stored in memoryStore → injected next turn → new salad.
                  while (memoryStore.conversations.length > 0 &&
                         memoryStore.conversations[memoryStore.conversations.length - 1].role === 'assistant') {
                    memoryStore.conversations.pop();
                  }
                  memoryStore._scheduleSave(); // Persist the purge to disk so it survives the next app launch
                  console.log('[AI Chat] BUG-039: Purged last assistant turn(s) from memoryStore');
                } catch (_) {}
                if (mainWindow) mainWindow.webContents.send('llm-token', '\n*⚠️ Model produced incoherent output (context poisoning detected). Context has been cleared — please resend your message.*\n');
              } else {
                if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[Stopped — ${failure.type}]*\n`);
              }
              break;
            }

            if (failure.severity === 'nudge' && nudgesRemaining > 0 && iteration < effectiveMaxIterations - 1) {
              nudgesRemaining--;

              // Special handling for refusal: force grammar-constrained tool calling on NEXT iteration
              if (failure.recovery.action === 'force_tool' && failure.recovery.forcedTools) {
                try {
                  const toolDefs = mcpToolServer.getToolDefinitions();
                  const forcedFunctions = LLMEngine.convertToolsToFunctions(toolDefs, failure.recovery.forcedTools);
                  if (Object.keys(forcedFunctions).length > 0) {
                    // Set the outer-scope flag so the NEXT iteration picks it up
                    forcedToolFunctions = forcedFunctions;
                    try { await llmEngine.resetSession(true); } catch (_) {}
                    if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Retrying with forced tool access...]*\n');
                  }
                } catch (_) {}
              }

              // Apply recovery prompt
              if (mainWindow) mainWindow.webContents.send('llm-token', '\n');
              currentPrompt = {
                systemContext: buildStaticPrompt(),
                userMessage: failure.recovery.prompt,
              };
              console.log(`[AI Chat] Recovery: ${failure.type} → nudge (${nudgesRemaining} remaining)`);
              continue;
            }
          }

          // ── Todo-aware continuation: don't stop if plan items are still incomplete ──
          const localIncompleteTodos = (mcpToolServer._todos || []).filter(t => t.status !== 'done');
          if (localIncompleteTodos.length > 0 && iteration < 20 && nudgesRemaining > 0) {
            nudgesRemaining--;
            const todoSummary = localIncompleteTodos.map(t => `  - [${t.status}] ${t.text}`).join('\n');
            console.log(`[AI Chat] Model stopped but ${localIncompleteTodos.length} todos incomplete — nudging continuation (iter ${iteration})`);
            if (mainWindow) mainWindow.webContents.send('llm-token', '\n');
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: `You stopped but your plan has ${localIncompleteTodos.length} incomplete items:\n${todoSummary}\n\nDo NOT summarize or give a final answer yet. Continue executing the remaining tasks using tool calls. Pick the next incomplete item and do it now.`
            };
            continue;
          }

          // No more tool calls - we're done
          console.log(`[AI Chat] No more tool calls, ending agentic loop`);
          break;
        }

        // Track last response for repetition detection (even when tools are called)
        lastIterationResponse = responseText;

        // Pre-tool acknowledgement: if the model produced no preamble text (went straight to
        // tool calls), emit a brief status so the chat bubble isn't visually empty.
        const _preToolText = responseText
          .replace(/```(?:json|tool)?[\s\S]*?```/g, '')
          .replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, '')
          .replace(/<think[\s\S]*?<\/think>/gi, '')
          .trim();
        if (_preToolText.length < 10 && mainWindow && !mainWindow.isDestroyed() && !isStale()) {
          const _firstTool = toolResults.results[0]?.tool || '';
          const _ack =
            _firstTool === 'web_search' ? 'Searching...' :
            (_firstTool === 'write_file' || _firstTool === 'edit_file' || _firstTool === 'create_directory') ? 'Working on it...' :
            (_firstTool === 'read_file' || _firstTool === 'list_directory' || _firstTool === 'grep_search') ? 'Looking at that...' :
            _firstTool.startsWith('browser_') ? 'Opening that...' :
            _firstTool === 'run_command' ? 'Running that...' : 'On it...';
          mainWindow.webContents.send('llm-token', _ack);
        }

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
              toolFeedback += `**Search Results for "${tr.params?.query}":**\n`;
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
                // node-llama-cpp 3.x has no vision API — even VL-named local models cannot
                // process images. Always false so screenshots route to cloud vision or show error.
                const hasLocalVision = false;

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
            } else {
              toolFeedback += `**Result:** ${tr.result?.message || 'Done'}\n`;
            }
          } else {
            toolFeedback += `**Error:** ${tr.result?.error || 'Unknown error'}\n`;
            toolFeedback += enrichErrorFeedback(tr.tool, tr.result?.error, toolFailCounts);
          }
        }

        // BUG-005: Track consecutive iterations where ALL tools failed
        const anyToolSuccess = toolResults.results.some(r => r.result?.success === true);
        if (toolResults.results.length > 0 && !anyToolSuccess) {
          consecutiveAllToolFailures++;
          console.log(`[AI Chat] BUG-005: All tools failed (${consecutiveAllToolFailures} consecutive all-fail iterations)`);
          if (consecutiveAllToolFailures >= 3) {
            const failMsg = `\n\n*[All tool calls have failed ${consecutiveAllToolFailures} times in a row. There may be a system or permission issue. Stopping to avoid a loop.]*\n`;
            if (mainWindow) mainWindow.webContents.send('llm-token', failMsg);
            fullResponseText += failMsg;
            break;
          }
        } else {
          consecutiveAllToolFailures = 0; // Reset on any success
        }

        // ── Domain retry limiter (ported from Pocket Guide) ──
        // If any browser_navigate was just called, check domain limits and warn the model
        for (const tr of toolResults.results) {
          if (tr.tool === 'browser_navigate' && tr.params?.url) {
            const domainWarning = checkDomainLimit(tr.params.url);
            if (domainWarning) {
              toolFeedback += `\n\n[SYSTEM] ${domainWarning}\n`;
              console.log(`[AI Chat] Domain limiter: ${domainWarning}`);
            }
          }
        }

        // ── Model claim verification (ported from Pocket Guide) ──
        // Verify the model's last response text against actual execution state
        if (responseText && responseText.length > 30) {
          const claimWarnings = verifyModelClaims(responseText);
          for (const w of claimWarnings) {
            toolFeedback += `\n\n[SYSTEM] ${w}\n`;
            console.log(`[AI Chat] Claim verification: ${w}`);
          }
        }

        // NOTE: Execution state injection moved to PILLAR 4 — now injected at the START
        // of each iteration's prompt (before tool results) instead of appended at the end.
        // This ensures the model sees ground truth FIRST, not as an afterthought.

        // Send progress update to UI
        // NOTE: toolFeedback is NOT sent to llm-token — the raw markdown (## Tool Execution
        // Results / ### toolname [OK|FAIL] / bullet lists) would appear as loose plain text in
        // the streaming bubble alongside the CollapsibleToolBlock widgets that already display
        // the same data cleanly. The results are committed to displayResponseText below and
        // parsed by extractToolResults() at render time for merging into the tool blocks.
        if (mainWindow) {
          mainWindow.webContents.send('mcp-tool-results', toolResults.results);
        }
        fullResponseText += toolFeedback;
        displayResponseText += toolFeedback; // Include [OK]/[FAIL] markers in saved message for UI parsing

        // Cap fullResponseText to prevent unbounded memory growth (same 2MB as cloud path)
        if (fullResponseText.length > 2 * 1024 * 1024) {
          fullResponseText = fullResponseText.substring(fullResponseText.length - 2 * 1024 * 1024);
        }

        // ── Anti-hallucination guard for file edits (local path) ──
        // Detect when the model claimed to modify files but never called edit_file/write_file.
        {
          const fileModTools = ['write_file', 'edit_file'];
          const calledFileModTool = toolResults.results.some(r => fileModTools.includes(r.tool));
          const userAskedForEdit = /\b(edit|change|modif|updat|upgrad|add to|fix|improve|alter)\b/i.test(message || '');
          const modelClaimedEdits = /\b(✔️|✅|upgraded|modified|edited|updated|changed|added|implemented|applied|enhanced)\b/i.test(responseText);
          if (!calledFileModTool && userAskedForEdit && modelClaimedEdits && toolResults.results.length > 0) {
            console.log('[AI Chat] Hallucination detected: model claimed file edits but no edit_file/write_file was called');
            toolFeedback += '\n\n[SYSTEM] WARNING: You claimed to make file changes but never called edit_file or write_file. No files were actually modified. You MUST use edit_file or write_file to modify files — browsing a file does NOT modify it. Execute the actual edits now using edit_file.\n';
            if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Anti-hallucination: model claimed edits without tool calls — retrying]*\n');
          }
        }

        // ── Post-write verification: fabrication detection + completeness checks (local path) ──
        {
          const writeResults = toolResults.results.filter(r => r.tool === 'write_file' && r.result?.success && r.params?.content);
          for (const wr of writeResults) {
            const fileContent = wr.params.content;
            const fileSize = fileContent.length;

            // Fabrication detection: files with data-like content that don't match actual tool results
            if (fileSize > 50) {
              const looksLikeScrapedData = /(?:\$\d|price|product|headline|article|result|listing|review|score|rating|mileage|miles|bedroom|salary)/i.test(fileContent);
              if (looksLikeScrapedData) {
                // Use persistent gatheredWebData + any browser data from allToolResults
                const gatheredSnippets = [];
                for (const wd of gatheredWebData) {
                  if (wd.url) gatheredSnippets.push(wd.url);
                  if (wd.title) gatheredSnippets.push(wd.title);
                }
                for (const tr of allToolResults) {
                  if (!tr.result?.success) continue;
                  if (['browser_snapshot', 'browser_get_content'].includes(tr.tool) && tr.result.text) {
                    const words = tr.result.text.substring(0, 2000).split(/\s+/).filter(w => w.length > 4);
                    gatheredSnippets.push(...words.slice(0, 30));
                  }
                  if (tr.tool === 'browser_evaluate' && tr.result.result) {
                    gatheredSnippets.push(String(tr.result.result).substring(0, 500));
                  }
                }

                const hasBrowserData = gatheredSnippets.length > 0;
                if (!hasBrowserData) {
                  console.log(`[AI Chat] FABRICATION WARNING: wrote ${fileSize} char file with data-like content but NO web data in history`);
                  toolFeedback += `\n\n[SYSTEM] ⚠️ FABRICATION WARNING: You wrote a ${fileSize}-char file with data-like content but have NOT gathered any web data. Use web_search/browser_navigate FIRST, then write.\n`;
                } else {
                  // Check if written content actually overlaps with gathered data
                  const contentLower = fileContent.toLowerCase();
                  const overlapCount = gatheredSnippets.filter(s => s.length > 5 && contentLower.includes(s.toLowerCase())).length;
                  if (overlapCount === 0 && gatheredWebData.length > 0) {
                    // Auto-correct: replace fabricated content with well-formatted real data
                    // (analogous to how file paths are already auto-corrected from hallucinated to real)
                    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                    const faSections = gatheredWebData.slice(0, 10).map((d, i) =>
                      `## ${i+1}. ${d.title || 'Result'}\n**URL:** ${d.url || 'N/A'}${(d.snippet || '').trim() ? '\n\n' + d.snippet.substring(0, 300) : ''}`
                    );
                    const correctedContent = `# Research Results\n*Compiled ${now}*\n\n${faSections.join('\n\n---\n\n')}`;
                    const writtenPath = wr.params?.filePath;
                    if (writtenPath && correctedContent.length > 50) {
                      try {
                        const resolvedPath = mcpToolServer._sanitizeFilePath ? mcpToolServer._sanitizeFilePath(writtenPath) : writtenPath;
                        const fullPath = path.resolve(context?.projectPath || 'C:\\Users\\brend\\Desktop', resolvedPath);
                        fsSync.writeFileSync(fullPath, correctedContent, 'utf8');
                        console.log(`[AI Chat] FABRICATION AUTO-CORRECTED: replaced ${fileSize} chars fabricated → ${correctedContent.length} chars real data in ${path.basename(fullPath)}`);
                      } catch (e) {
                        console.log(`[AI Chat] FABRICATION DETECTED but auto-correct failed: ${e.message}`);
                      }
                    } else {
                      console.log(`[AI Chat] FABRICATION DETECTED: wrote ${fileSize} char file with zero overlap against ${gatheredSnippets.length} gathered snippets`);
                    }
                  }
                }
              }
            }

            // Vague comment/discussion detection
            const vaguePatterns = /(?:people are discussing|users are talking|commenters? (?:are|seem|appear)|discussion (?:is|centers|focuses)|general (?:consensus|sentiment)|many (?:users|commenters|people))/i;
            const hasCommentSection = /(?:comments?|discussion|what people (?:are )?saying|reactions?):/i.test(fileContent);
            const hasSpecificQuotes = /(?:[""][^""]{20,}[""]|said:|wrote:|commented:|\bby [a-zA-Z0-9_-]+\b.*?:)/i.test(fileContent);
            if (hasCommentSection && vaguePatterns.test(fileContent) && !hasSpecificQuotes) {
              console.log(`[AI Chat] VAGUE COMMENT WARNING: file has comment section but no specific quotes`);
              toolFeedback += `\n\n[SYSTEM] ⚠️ VAGUE COMMENT WARNING: Your file has a comments/discussion section but contains only vague summaries instead of ACTUAL quotes. You MUST: (1) browser_navigate to the page, (2) browser_evaluate to extract REAL comments with usernames, (3) rewrite with specific quotes.\n`;
            }
          }

          // One-shot completeness check for newly written files
          if (writeResults.length > 0) {
            if (!_completenessCheckedFiles) _completenessCheckedFiles = new Set();
            const writtenFiles = writeResults.map(r => r.params.filePath);
            const writtenContent = writeResults.map(r => r.params.content).join('\n');
            const userMsg = (message || '').toLowerCase();
            const newFiles = writtenFiles.filter(f => !_completenessCheckedFiles.has(f));

            if (newFiles.length > 0) {
              newFiles.forEach(f => _completenessCheckedFiles.add(f));
              const missingParts = [];
              if (/comment|what.*say|discuss|opinion|reaction/i.test(userMsg) && !/comment/i.test(writtenContent)) {
                missingParts.push('comments/discussion');
              }
              if (/who\s+post|poster|submitt|author|by whom/i.test(userMsg) && !/\bby\s+\w|author|username|submitted/i.test(writtenContent)) {
                missingParts.push('submitter/author names');
              }
              if (/seller\s+rat|seller\s+score|seller\s+feedback/i.test(userMsg) && !/\d+%/i.test(writtenContent)) {
                missingParts.push('seller ratings');
              }
              if (/condition|pre-?owned|refurbish/i.test(userMsg) && !/condition|pre-?owned|refurbish|used|like new|open box/i.test(writtenContent)) {
                missingParts.push('item conditions');
              }
              if (missingParts.length > 0) {
                toolFeedback += `\n[SYSTEM — FILE NOTE] Your file may be missing: ${missingParts.join(', ')}. Check if these are covered. If not, add them. If the data wasn't available, that's OK — move on.\n`;
                console.log(`[AI Chat] Post-write completeness: missing ${missingParts.join(', ')}`);
              } else {
                const justReadBack = toolResults.results.some(r => r.tool === 'read_file');
                if (!justReadBack) {
                  toolFeedback += `\n[SYSTEM — VERIFY] You wrote file(s): ${writtenFiles.join(', ')}. Call read_file to verify the content.\n`;
                }
              }
            }
          }
        }

        // Smart stuck detection: track tool calls
        for (const tr of toolResults.results) {
          const p = tr.params || {};
          const paramsHash = `${p.filePath || p.url || p.ref || p.query || p.command || p.selector || ''}:${p.text || ''}`.substring(0, 200);
          recentToolCalls.push({ tool: tr.tool, paramsHash });
        }
        // Keep only last 20 entries
        if (recentToolCalls.length > 20) recentToolCalls = recentToolCalls.slice(-20);

        // Check if stuck: same tool+params called STUCK_THRESHOLD times consecutively
        let isStuck = false;
        if (recentToolCalls.length >= STUCK_THRESHOLD) {
          const last = recentToolCalls[recentToolCalls.length - 1];
          const tail = recentToolCalls.slice(-STUCK_THRESHOLD);
          if (tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash)) {
            isStuck = true;
            console.log(`[AI Chat] Detected stuck pattern: ${last.tool} called ${STUCK_THRESHOLD}+ times with same params`);
            fullResponseText += `\n\n*Detected repetitive pattern (${last.tool} called ${STUCK_THRESHOLD}+ times with identical parameters). Stopping to avoid wasting resources.*`;
            if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected repetitive loop. Auto-stopped.*`);
            break;
          }
        }

        // ── Cycle detection (local path): same SEQUENCE of 2-4 tools repeating ──
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
              if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected tool cycle. Auto-stopped.*`);
              isStuck = true;
              break;
            }
          }
          if (isStuck) break;
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
      // BUG-032: Skip summary if the request was superseded (e.g. user switched models
      // mid-generation). The old model is gone; attempting generateStream would throw
      // "Model not loaded" and log a confusing error.
      if (shouldAutoSummarize && !isStale()) {
        const lastResponseTrimmed = (fullResponseText || '').trim();
        const endsWithToolOutput = lastResponseTrimmed.endsWith('```') || 
          lastResponseTrimmed.endsWith('Done') ||
          lastResponseTrimmed.includes('## Tool Execution Results') && !lastResponseTrimmed.match(/\n[^#\n*`][^\n]{20,}$/);
        
        if (endsWithToolOutput || iteration >= MAX_AGENTIC_ITERATIONS) {
          try {
            console.log('[AI Chat] Generating final summary...');
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'generating-summary', status: 'start', label: 'Generating response summary' });
            
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
              if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('llm-token', token);
            }, (thinkToken) => {
              if (mainWindow) mainWindow.webContents.send('llm-thinking-token', thinkToken);
            });
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentic-phase', { phase: 'generating-summary', status: 'done', label: 'Generating response summary' });
            
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

        // Build corrected content from gathered data — formatted as proper Markdown report.
        // Uses a structured format with headers and URLs so it passes quality checks
        // and is actually readable for the end user. All three fallback paths use this.
        const buildCorrectedContent = () => {
          const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          const sections = gatheredWebData.slice(0, 10).map((r, i) =>
            `## ${i + 1}. ${r.title || 'Result'}\n**URL:** ${r.url}${r.snippet ? '\n\n' + r.snippet.substring(0, 300) : ''}`
          );
          return `# Research Results\n*Compiled ${now}*\n\n${sections.join('\n\n---\n\n')}`;
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

      // Skip storing incoherent output — memoryStore was already purged in BUG-039 handler.
      // Storing word salad here would re-inject it as context on the very next request.
      if (!_incoherentOutputOccurred) {
        memoryStore.addConversation('assistant', fullResponseText);
      }

      // ── Post-loop history cleanup ──
      // After the agentic loop finishes, the chatHistory contains intermediate
      // turns: injected tool feedback (as 'user'), iteration prompts, continue
      // instructions, and intermediate model responses. For large models this
      // doesn't matter, but for small models (0.6B-4B) it completely poisons
      // the next user message — they pattern-match on the tool feedback and
      // repeat "No further action is needed" regardless of the new question.
      //
      // Fix: condense chatHistory to system + original user message + final
      // model response. This gives the next message a clean slate while
      // preserving the conversation thread. KV cache must be invalidated
      // since the history no longer matches the evaluated sequence.
      if (iteration > 1 && llmEngine.chatHistory?.length > 3) {
        const systemMsg = llmEngine.chatHistory.find(h => h.type === 'system');
        const condensed = [];
        if (systemMsg) condensed.push(systemMsg);
        // Keep only the user's original message (first user entry after system)
        // and the model's final response (last model entry)
        const userEntries = llmEngine.chatHistory.filter(h => h.type === 'user');
        const modelEntries = llmEngine.chatHistory.filter(h => h.type === 'model');
        if (userEntries.length > 0) condensed.push(userEntries[0]); // Original user message
        if (modelEntries.length > 0) condensed.push(modelEntries[modelEntries.length - 1]); // Final model response
        llmEngine.chatHistory = condensed;
        llmEngine.lastEvaluation = null; // Invalidate KV cache
        console.log(`[AI Chat] Condensed chatHistory: ${userEntries.length + modelEntries.length} turns → ${condensed.length} entries (prevents template loop)`);
      }

      // Clean up response display: ONLY the assistant's natural-language responses.
      // Tool output is streamed live and should not become the final assistant message.
      let cleanLocalResponse = displayResponseText;
      cleanLocalResponse = cleanLocalResponse.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
      cleanLocalResponse = cleanLocalResponse.replace(/<\/?think(?:ing)?>/gi, '');
      // Strip fenced tool call JSON blocks (```json\n{"tool":...}```) from the committed message.
      cleanLocalResponse = cleanLocalResponse.replace(/```(?:json|tool)?\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?```/g, '');
      // Strip bare unfenced tool call JSON objects ({"tool":...}) from the committed message.
      // Nested-brace-aware: {"tool":"x","params":{"key":"val"}} → fully removed (not just inner }).
      cleanLocalResponse = cleanLocalResponse.replace(/^\s*\{[^{}]*"tool"\s*:\s*"[^"]*"[^{}]*"params"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*\}\s*$/gm, '');
      // Also strip any isolated lone } that prior cleanup may have left behind
      cleanLocalResponse = cleanLocalResponse.replace(/^\s*\}\s*$/gm, '');
      cleanLocalResponse = cleanLocalResponse.replace(/\n\n\*(?:Continuing browser automation|Detected repetitive loop|Reached max \d+ iterations)\.\.\.?\*\n?/g, '');
      cleanLocalResponse = cleanLocalResponse.replace(/\n{3,}/g, '\n\n').trim();

      // Never return an empty success response (this causes "No response generated" in the UI)
      // BUG-FIX: If we have a pre-rollback planning phrase (e.g. "I will check your code")
      // AND the committed response is also non-empty, prepend the planning phrase so the user
      // sees both the intent AND the result — not just the result.
      if (savedExplanationText && cleanLocalResponse &&
          !cleanLocalResponse.startsWith(savedExplanationText.substring(0, 20))) {
        cleanLocalResponse = savedExplanationText + '\n\n' + cleanLocalResponse;
        console.log(`[AI Chat] Prepended savedExplanationText (${savedExplanationText.length} chars) to cleanLocalResponse`);
      }

      if (!cleanLocalResponse) {
        const rawPreview = displayResponseText.substring(0, 120).replace(/\n/g, '\\n');
        console.log(`[AI Chat] ⚠️ cleanLocalResponse is EMPTY — displayResponseText was ${displayResponseText.length} chars (raw preview: "${rawPreview}") | allToolResults: ${allToolResults.length}`);
        // Use the pre-rollback explanation text if available (e.g. model explained before failing to call a tool)
        if (savedExplanationText) {
          cleanLocalResponse = savedExplanationText;
          console.log(`[AI Chat] Using savedExplanationText (${cleanLocalResponse.length} chars) as final response`);
        } else if (allToolResults.length > 0) {
          // Tools ran but no prose — return empty string. The tool call blocks in the
          // UI already show what happened; a canned sentence adds nothing.
          cleanLocalResponse = '';
        } else {
          // Model produced only <think> blocks or empty output — return '' so
          // the frontend shows the thinking block alone, not "No response generated."
          cleanLocalResponse = '';
        }
      }

      // Report token telemetry for local LLM
      const localTokensUsed = estimateTokens(fullResponseText);
      _reportTokenStats(localTokensUsed, mainWindow);

      console.log(`[AI Chat] ══ FINAL RETURN ══ ${cleanLocalResponse.length} chars → UI | preview: "${cleanLocalResponse.substring(0, 80).replace(/\n/g, '\\n')}"`);
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
