/**
 * guIDE — Agentic AI Chat Handler
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 *
 * Complete rewrite of the agentic chat system. The core conversational loop
 * with RAG, MCP tools, memory, cloud/local LLM support, and browser automation.
 *
 * Architecture:
 *   - This file is the orchestrator — it delegates to focused modules
 *   - ContextManager handles continuation/compaction/rotation
 *   - agenticChatHelpers has utility functions
 *   - mcpToolParser handles tool call extraction
 *   - mcpToolServer handles tool execution
 */
'use strict';

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
  buildToolFeedback,
  ExecutionState,
} = require('./agenticChatHelpers');
const { LLMEngine } = require('./llmEngine');
const { repairToolCalls: repairToolCallsFn } = require('./tools/toolParser');

/**
 * Get the path to node-llama-cpp that works in both dev and production (asar).
 */
function getNodeLlamaCppPath() {
  if (__dirname.includes('app.asar')) {
    const unpackedPath = __dirname.replace('app.asar', 'app.asar.unpacked');
    const entryFile = path.join(unpackedPath, '..', 'node_modules', 'node-llama-cpp', 'dist', 'index.js');
    return pathToFileURL(entryFile).href;
  }
  return 'node-llama-cpp';
}

// ─── Constants ──────────────────────────────────────────────
const STUCK_THRESHOLD = 3;
const CYCLE_MIN_REPEATS = 3;
const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2MB cap
const WALL_CLOCK_DEADLINE_MS = 30 * 60 * 1000; // 30 minutes
const BROWSER_STATE_CHANGERS = new Set([
  'browser_navigate', 'browser_click', 'browser_type', 'browser_select',
  'browser_select_option', 'browser_press_key', 'browser_back',
  'browser_fill_form', 'browser_drag', 'browser_file_upload',
]);
const DATA_GATHER_TOOLS = new Set([
  'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_evaluate', 'browser_get_content', 'web_search', 'fetch_webpage',
]);
const DATA_WRITE_TOOLS = new Set(['write_file', 'edit_file']);

function register(ctx) {
  const {
    llmEngine, cloudLLM, mcpToolServer, playwrightBrowser, browserManager,
    ragEngine, memoryStore, webSearch, licenseManager,
    ConversationSummarizer, DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE,
  } = ctx;
  const _truncateResult = ctx._truncateResult;
  const _readConfig = ctx._readConfig;

  // Session-level state
  let _sessionTokensUsed = 0;
  let _sessionRequestCount = 0;
  let _instructionCache = null;
  let _instructionCacheProject = null;
  let _activeRequestId = 0;
  let _isPaused = false;
  let _pauseResolve = null;

  const _reportTokenStats = (tokensUsed, mainWindow) => {
    _sessionTokensUsed += tokensUsed || 0;
    _sessionRequestCount++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('token-stats', {
        sessionTokens: _sessionTokensUsed,
        requestCount: _sessionRequestCount,
        lastRequestTokens: tokensUsed || 0,
      });
    }
  };

  const waitWhilePaused = async () => {
    while (_isPaused) {
      await new Promise(resolve => { _pauseResolve = resolve; });
    }
  };

  // ─── IPC: Pause / Resume ─────────────────────────────────
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
    if (_pauseResolve) { _pauseResolve(); _pauseResolve = null; }
    const mainWindow = ctx.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent-paused', false);
    }
    return { success: true, paused: false };
  });

  // ─── IPC: Main AI Chat Handler ───────────────────────────
  ipcMain.handle('ai-chat', async (_, message, context) => {
    const mainWindow = ctx.getMainWindow();
    const MAX_AGENTIC_ITERATIONS = context?.maxIterations || _readConfig()?.userSettings?.maxAgenticIterations || 100;

    // Cancel any previous active request
    const prevId = _activeRequestId;
    _activeRequestId++;
    const myRequestId = _activeRequestId;

    if (prevId > 0) {
      ctx.agenticCancelled = true;
      try { llmEngine.cancelGeneration(); } catch (_) {}
      await new Promise(r => setTimeout(r, 50));
    }
    ctx.agenticCancelled = false;

    const isStale = () => myRequestId !== _activeRequestId || ctx.agenticCancelled;

    try {
      // ─── Auto Mode: pick best cloud provider ────────────
      if (context?.autoMode && !context?.cloudProvider) {
        const autoSelect = selectCloudProvider(cloudLLM, message, context);
        if (autoSelect) {
          context.cloudProvider = autoSelect.provider;
          context.cloudModel = autoSelect.model;
          console.log(`[Auto Mode] Selected: ${autoSelect.provider} / ${autoSelect.model}`);
        } else {
          console.log('[Auto Mode] No cloud providers available, falling back to local model');
          const localStatus = llmEngine.getStatus();
          if (!localStatus.isReady) {
            if (mainWindow) mainWindow.webContents.send('llm-token', '*Auto Mode: No AI models available.*\n\n');
            return { success: false, error: 'No AI models available.' };
          }
          if (mainWindow) mainWindow.webContents.send('llm-token', '*Auto Mode: Using local model.*\n\n');
        }
      }

      // ─── Cloud Path ─────────────────────────────────────
      if (context?.cloudProvider && context?.cloudModel) {
        return await handleCloudChat(ctx, message, context, {
          mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats,
        });
      }

      // ─── Local Path ─────────────────────────────────────
      return await handleLocalChat(ctx, message, context, {
        mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats,
        MAX_AGENTIC_ITERATIONS,
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ─── IPC: Bug Analysis ───────────────────────────────────
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
      prompt += `Analyze this error: identify root cause, explain why, provide exact code fixes.\n`;

      const result = await llmEngine.generateStream({
        systemContext: 'You are a bug analysis assistant. Analyze errors, identify root causes, provide exact code fixes.',
        userMessage: prompt,
      }, { maxTokens: 4096, temperature: 0.3 }, (token) => {
        if (mainWindow) mainWindow.webContents.send('llm-token', token);
      }, (thinkToken) => {
        if (mainWindow) mainWindow.webContents.send('llm-thinking-token', thinkToken);
      });

      memoryStore.recordError(errorMessage, result.text || '', errorContext.results.map(r => r.relativePath));
      return { success: true, text: result.text, errorContext, model: result.model };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // Cloud Chat Handler
  // ─────────────────────────────────────────────────────────
  async function handleCloudChat(ctx, message, context, helpers) {
    const { mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats } = helpers;
    const { cloudLLM, mcpToolServer, playwrightBrowser, browserManager, ragEngine, memoryStore, webSearch, licenseManager } = ctx;

    const cloudStatus = cloudLLM.getStatus();
    if (!cloudStatus.providers.includes(context.cloudProvider)) {
      return { success: false, error: `Provider "${context.cloudProvider}" not configured.` };
    }

    let fullPrompt = message;

    // Add current file context
    if (context?.currentFile?.content) {
      fullPrompt = `## Currently Open File: ${context.currentFile.path}\n\`\`\`\n${context.currentFile.content.substring(0, 12000)}\n\`\`\`\n\n${message}`;
    }
    if (context?.selectedCode) {
      fullPrompt = `## Selected Code:\n\`\`\`\n${context.selectedCode}\n\`\`\`\n\n${fullPrompt}`;
    }

    // Web search results
    if (context?.webSearch) {
      try {
        const searchResults = await webSearch.search(context.webSearch, 5);
        if (searchResults.length > 0) {
          const searchContext = searchResults.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
          fullPrompt = `## Web Search Results for "${context.webSearch}":\n${searchContext}\n\n${fullPrompt}`;
        }
      } catch (e) { console.log('[Cloud] Web search failed:', e.message); }
    }

    // System prompt with tool definitions
    const systemPrompt = llmEngine._getSystemPrompt();
    const toolPrompt = mcpToolServer.getToolPromptForTask('general');
    const isBundledCloudProvider = cloudLLM._isBundledProvider(context.cloudProvider) && !cloudLLM.isUsingOwnKey(context.cloudProvider);
    const cloudSystemPrompt = systemPrompt + (toolPrompt ? '\n\n' + toolPrompt : '');

    // Free-tier daily quota
    const isQuotaExempt = licenseManager.isActivated || !!licenseManager.getSessionToken();
    if (isBundledCloudProvider && !isQuotaExempt) {
      const usageFile = path.join(ctx.userDataPath || require('electron').app.getPath('userData'), '.bundled-daily-usage.json');
      const today = new Date().toISOString().slice(0, 10);
      let usage = { date: today, count: 0 };
      try {
        if (fsSync.existsSync(usageFile)) {
          const raw = JSON.parse(fsSync.readFileSync(usageFile, 'utf8'));
          if (raw.date === today) usage = raw;
        }
      } catch (_) {}
      if (usage.count >= 20) {
        return { success: false, error: '__QUOTA_EXCEEDED__', isQuotaError: true };
      }
      usage.count++;
      usage.date = today;
      try { fsSync.writeFileSync(usageFile, JSON.stringify(usage, null, 2)); } catch (_) {}
    }

    memoryStore.addConversation('user', message);

    // Wire todo updates
    mcpToolServer.onTodoUpdate = (todos) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('todo-update', todos);
    };

    // Cloud agentic loop
    const MAX_CLOUD_ITERATIONS = 500;
    const deadline = Date.now() + WALL_CLOCK_DEADLINE_MS;
    let iteration = 0;
    let currentCloudPrompt = fullPrompt;
    let cloudHistory = [...(context?.conversationHistory || [])];
    let allCloudToolResults = [];
    let fullCloudResponse = '';
    let lastCloudResult = null;
    let lastCloudIterResponse = '';
    let recentCloudToolCalls = [];
    const executionState = new ExecutionState();
    const summarizer = new ctx.ConversationSummarizer();
    summarizer.setGoal(message);

    while (iteration < MAX_CLOUD_ITERATIONS) {
      if (isStale()) {
        if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Interrupted]*\n');
        break;
      }
      if (Date.now() > deadline) {
        if (mainWindow) mainWindow.webContents.send('llm-token', '\n\n*Session time limit reached (30 min).*\n');
        break;
      }
      iteration++;

      // Proactive pacing
      if (iteration > 1) {
        const pace = cloudLLM.getProactivePaceMs?.(context.cloudProvider) || 0;
        if (pace > 0) await new Promise(r => setTimeout(r, pace));
      }

      console.log(`[Cloud] Agentic iteration ${iteration}/${MAX_CLOUD_ITERATIONS}`);
      if (mainWindow && iteration > 1) {
        mainWindow.webContents.send('agentic-progress', { iteration, maxIterations: MAX_CLOUD_ITERATIONS });
      }
      if (mainWindow) mainWindow.webContents.send('llm-iteration-begin');

      // Token batching for cloud
      const tokenFlushMs = isBundledCloudProvider ? 50 : 25;
      const charsPerFlush = isBundledCloudProvider ? 4 : undefined;
      const maxBufferChars = isBundledCloudProvider ? 256 : 2048;
      const cloudTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: tokenFlushMs, maxBufferChars, charsPerFlush, flushOnNewline: !isBundledCloudProvider });
      const cloudThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });

      try {
        lastCloudResult = await cloudLLM.generate(currentCloudPrompt, {
          provider: context.cloudProvider,
          model: context.cloudModel,
          systemPrompt: cloudSystemPrompt,
          maxTokens: context?.params?.maxTokens || 32768,
          temperature: context?.params?.temperature || 0.7,
          stream: true,
          noFallback: !context?.autoMode,
          conversationHistory: cloudHistory,
          images: iteration === 1 ? (context?.images || []) : [],
          onToken: (token) => { if (!isStale()) cloudTokenBatcher.push(token); },
          onThinkingToken: (token) => { if (!isStale()) cloudThinkingBatcher.push(token); },
        });
      } finally {
        cloudTokenBatcher.dispose();
        cloudThinkingBatcher.dispose();
      }

      if (isStale()) break;

      const responseText = lastCloudResult.text || '';

      // Clean tool call artifacts from display text
      let cleanedText = responseText;
      cleanedText = cleanedText.replace(/```(?:tool_call|tool|json)[^\n]*\n[\s\S]*?```/g, '');
      cleanedText = cleanedText.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
      cleanedText = cleanedText.replace(/<\/?think(?:ing)?>/gi, '');
      if (fullCloudResponse.length < MAX_RESPONSE_SIZE) {
        fullCloudResponse += cleanedText;
      }

      const previousResponse = lastCloudIterResponse;
      lastCloudIterResponse = responseText;

      if (responseText.length > 50) summarizer.recordPlan(responseText);

      // Parse tool calls
      const cloudToolPace = cloudLLM.getRecommendedPaceMs?.() || 50;
      const toolResults = await mcpToolServer.processResponse(responseText, { toolPaceMs: cloudToolPace });

      // Route planning text to thinking panel
      if (toolResults.hasToolCalls && toolResults.results.length > 0 && mainWindow) {
        const toolIndicators = ['{"tool":', '```tool_call', '```json\n{"tool"'];
        let splitIdx = responseText.length;
        for (const ind of toolIndicators) {
          const idx = responseText.indexOf(ind);
          if (idx >= 0 && idx < splitIdx) splitIdx = idx;
        }
        const planningText = responseText.substring(0, splitIdx).trim();
        if (planningText) {
          mainWindow.webContents.send('llm-thinking-token', planningText);
          mainWindow.webContents.send('llm-replace-last', planningText);
        }
      }

      if (!toolResults.hasToolCalls || toolResults.results.length === 0) {
        // Check for repetition
        const failure = classifyResponseFailure(
          responseText, false, 'general', iteration, message, previousResponse,
          { nudgesRemaining: 0, allToolResults: allCloudToolResults }
        );
        if (failure?.severity === 'stop') {
          if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[Stopped — ${failure.type}]*\n`);
          break;
        }
        console.log(`[Cloud] No tool calls in iteration ${iteration}, ending`);
        break;
      }

      // Execute tools
      const iterationToolResults = [];
      for (const tr of toolResults.results) {
        if (isStale()) break;
        await waitWhilePaused();
        console.log(`[Cloud] Executing tool: ${tr.tool}`);
        iterationToolResults.push(tr);
        allCloudToolResults.push(tr);
        summarizer.recordToolCall(tr.tool, tr.params, tr.result);
        summarizer.markPlanStepCompleted(tr.tool, tr.params);
        executionState.update(tr.tool, tr.params, tr.result, iteration);
        if (tr.tool === 'update_todo') await new Promise(r => setTimeout(r, 80));
      }

      // Stuck/cycle detection
      if (detectStuckCycle(recentCloudToolCalls, iterationToolResults, mainWindow, _readConfig)) break;

      sendToolExecutionEvents(mainWindow, iterationToolResults, playwrightBrowser);
      capArray(allCloudToolResults, 50);
      if (mainWindow) mainWindow.webContents.send('mcp-tool-results');

      // Build tool feedback
      const toolSummaryParts = [];
      for (const r of iterationToolResults) {
        const truncResult = _truncateResult(r.result);
        toolSummaryParts.push(`Tool "${r.tool}" result:\n${JSON.stringify(truncResult).substring(0, 4000)}`);
      }
      let toolSummary = toolSummaryParts.join('\n\n');

      // Auto-snapshot
      const snapResult = await autoSnapshotAfterBrowserAction(iterationToolResults, mcpToolServer, playwrightBrowser, browserManager);
      if (snapResult) {
        toolSummary += `\nPage snapshot after ${snapResult.triggerTool}:\n${snapResult.snapshotText}\n\n${snapResult.elementCount} elements. Use [ref=N] with browser_click/type.\n`;
      }

      // Update cloud history
      cloudHistory.push({ role: 'user', content: currentCloudPrompt });
      cloudHistory.push({ role: 'assistant', content: responseText });

      // Progressive pruning
      const historySize = cloudHistory.reduce((acc, m) => acc + (m.content || '').length, 0);
      const historyTokenEst = Math.ceil(historySize / 4);
      if (historyTokenEst > 18000 && historyTokenEst <= 30000) {
        pruneCloudHistory(cloudHistory, 6);
      }

      // Hard rotation
      const historyAfterPrune = cloudHistory.reduce((acc, m) => acc + (m.content || '').length, 0);
      if (Math.ceil(historyAfterPrune / 4) > 30000 && cloudHistory.length > 6) {
        console.log('[Cloud] History rotation — compressing with summarizer');
        summarizer.markRotation();
        const summary = summarizer.generateSummary({ maxTokens: 3000, activeTodos: mcpToolServer?._todos || [] });
        const recentExchanges = cloudHistory.slice(-4);
        cloudHistory = [
          { role: 'user', content: summary },
          { role: 'assistant', content: 'Understood. Continuing the task.' },
          ...recentExchanges,
        ];
      }

      // Next iteration prompt
      const hasBrowserActions = iterationToolResults.some(tr => tr.tool?.startsWith('browser_'));
      const continueHint = hasBrowserActions
        ? 'A page snapshot is above with [ref=N]. Use browser_click/type with ref. Continue the task.'
        : 'Continue with the task. If more steps needed, call tools. If complete, provide a summary.';
      currentCloudPrompt = `Here are the results of the tool calls:\n\n${toolSummary}\n\n${continueHint}`;
    }

    memoryStore.addConversation('assistant', fullCloudResponse);

    // Clean up display
    let cleanResponse = fullCloudResponse;
    cleanResponse = cleanResponse.replace(/\[?\s*\{\s*"(?:tool|name)"\s*:\s*"[^"]*"[\s\S]*?\}\s*\]?/g, '');
    cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim();

    // Context usage
    if (mainWindow) {
      const used = Math.ceil(cloudHistory.reduce((a, m) => a + (m.content || '').length, 0) / 4);
      mainWindow.webContents.send('context-usage', { used, total: 128000 });
    }

    const tokensUsed = lastCloudResult?.tokensUsed || Math.ceil(fullCloudResponse.length / 4);
    _reportTokenStats(tokensUsed, mainWindow);

    return {
      success: true,
      text: cleanResponse,
      model: isBundledCloudProvider ? 'Guide Cloud AI' : `${context.cloudProvider}/${context.cloudModel}`,
      tokensUsed,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Local Chat Handler
  // ─────────────────────────────────────────────────────────
  async function handleLocalChat(ctx, message, context, helpers) {
    const { mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats, MAX_AGENTIC_ITERATIONS } = helpers;
    const { llmEngine, mcpToolServer, playwrightBrowser, browserManager, ragEngine, memoryStore, ConversationSummarizer, DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE } = ctx;

    const modelStatus = llmEngine.getStatus();

    // Wait for model to be ready before proceeding (prevents "Model not ready" errors)
    if (!llmEngine.isReady) {
      console.log('[AI Chat] Model not ready — waiting…');
      const readyTimeout = Date.now() + 15000;
      while (!llmEngine.isReady && Date.now() < readyTimeout) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (!llmEngine.isReady) {
        if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Model is still loading — please wait and try again]*\n');
        if (mainWindow) mainWindow.webContents.send('llm-done');
        return;
      }
    }

    const hwContextSize = modelStatus.modelInfo?.contextSize || 32768;

    const estimateTokens = (text) => Math.ceil((text || '').length / 3.5);

    // ModelProfile-driven budgeting
    const modelTier = llmEngine.getModelTier();
    const modelProfile = modelTier.profile;
    const isSmallLocalModel = modelTier.paramSize > 0 && modelTier.paramSize <= 4;

    const totalCtx = Math.min(hwContextSize, modelProfile.context.effectiveContextSize);
    const actualSystemPrompt = llmEngine._getActiveSystemPrompt();
    const toolSchemaTokenEstimate = (modelProfile.generation?.maxToolsPerTurn ?? 0) * 55;
    const sysPromptReserve = estimateTokens(actualSystemPrompt) + 50 + toolSchemaTokenEstimate;
    console.log(`[AI Chat] Profile: ${modelProfile._meta.profileSource} | ctx=${totalCtx} (hw=${hwContextSize}) | sysReserve=${sysPromptReserve}`);

    const maxResponseTokens = Math.min(
      Math.floor(totalCtx * modelProfile.context.responseReservePct),
      modelProfile.context.maxResponseTokens
    );
    const maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);

    const MAX_CONTEXT_ROTATIONS = totalCtx < 4096 ? 5 : (totalCtx < 8192 ? 15 : 50);

    // ──────────────────────────────────────────────────────
    // Prompt Builders
    // ──────────────────────────────────────────────────────
    const _staticPromptCache = new Map();

    const buildStaticPrompt = (taskTypeOverride) => {
      const cacheKey = taskTypeOverride || 'general';
      if (_staticPromptCache.has(cacheKey)) return _staticPromptCache.get(cacheKey);

      let tokenBudget = maxPromptTokens;
      let prompt = '';

      const appendIfBudget = (text) => {
        const cost = estimateTokens(text);
        if (cost < tokenBudget) { prompt += text; tokenBudget -= cost; return true; }
        return false;
      };

      // Preamble
      const savedSettings = _readConfig()?.userSettings;
      const userPreamble = savedSettings?.systemPrompt?.trim();
      const contextIsConstrained = totalCtx < 8192;
      const isSmallModel = modelProfile.prompt.style === 'compact' || contextIsConstrained;
      const defaultPreamble = isSmallModel ? (DEFAULT_COMPACT_PREAMBLE || DEFAULT_SYSTEM_PREAMBLE) : DEFAULT_SYSTEM_PREAMBLE;
      const preamble = userPreamble || defaultPreamble;
      appendIfBudget(preamble + '\n\n');

      // Tool definitions
      const effectiveTaskType = taskTypeOverride || 'general';
      if (effectiveTaskType !== 'chat') {
        const toolPromptStyle = modelProfile.prompt.toolPromptStyle;
        const useCompactTools = toolPromptStyle === 'grammar-only' || toolPromptStyle === 'compact' || contextIsConstrained;
        if (useCompactTools) {
          const compactHint = totalCtx < 8192
            ? mcpToolServer.getCompactToolHint(effectiveTaskType, { minimal: true })
            : mcpToolServer.getCompactToolHint(effectiveTaskType);
          appendIfBudget(compactHint + '\n');

          // Few-shot examples
          const fewShotCount = modelProfile.prompt?.fewShotExamples ?? 0;
          if (fewShotCount > 0 && tokenBudget > 150) {
            const fewShotExample = '### Tool Call Example\nUser: Create an HTML page called hello.html with a greeting\nAssistant:\n```json\n{"tool":"write_file","params":{"filePath":"hello.html","content":"<!DOCTYPE html>\\n<html><head><title>Hello</title></head><body><h1>Hello!</h1></body></html>"}}\n```\n';
            appendIfBudget(fewShotExample);
          }
        } else {
          const toolPrompt = mcpToolServer.getToolPromptForTask(effectiveTaskType);
          if (!appendIfBudget(toolPrompt + '\n')) {
            const fallback = mcpToolServer.getToolPromptForTask('browser');
            appendIfBudget(fallback + '\n');
          }
        }
      }

      // Project instructions
      if (effectiveTaskType !== 'chat' && context?.projectPath) {
        if (!_instructionCache || _instructionCacheProject !== context.projectPath) {
          _instructionCacheProject = context.projectPath;
          _instructionCache = null;
          const candidates = ['.guide-instructions.md', '.prompt.md', '.guide/instructions.md', 'CODING_GUIDELINES.md'];
          for (const file of candidates) {
            try {
              const instrPath = path.join(context.projectPath, file);
              if (fsSync.existsSync(instrPath)) {
                const instrContent = fsSync.readFileSync(instrPath, 'utf8').trim();
                if (instrContent) { _instructionCache = { file, content: instrContent }; break; }
              }
            } catch (_) {}
          }
        }
        if (_instructionCache) {
          appendIfBudget(`## Project Instructions (from ${_instructionCache.file})\n${_instructionCache.content}\n\n`);
        }
      }

      _staticPromptCache.set(cacheKey, prompt);
      return prompt;
    };

    const buildDynamicContext = (budgetOverride) => {
      let tokenBudget = budgetOverride !== undefined ? budgetOverride : Math.floor(maxPromptTokens * 0.4);
      let prompt = '';

      const appendIfBudget = (text) => {
        const cost = estimateTokens(text);
        if (cost < tokenBudget) { prompt += text; tokenBudget -= cost; return true; }
        return false;
      };

      // Memory
      const memoryContext = memoryStore.getContextPrompt();
      if (memoryContext) appendIfBudget(memoryContext + '\n');

      // Error context
      if (context?.errorMessage) {
        const errorContext = ragEngine.findErrorContext(context.errorMessage, context.stackTrace || '');
        if (errorContext.results.length > 0) {
          appendIfBudget(`## Error Context\nError: ${context.errorMessage}\n`);
          for (const result of errorContext.results.slice(0, 3)) {
            appendIfBudget(`### ${result.relativePath}\n\`\`\`\n${result.content.substring(0, 1000)}\n\`\`\`\n\n`);
          }
        }
      }

      // RAG context
      if (context?.projectPath && ragEngine.projectPath) {
        const maxChunks = tokenBudget > 2000 ? 5 : tokenBudget > 1000 ? 3 : 1;
        const ragContext = ragEngine.getContextForQuery(message, maxChunks, tokenBudget * 2);
        if (ragContext.chunks.length > 0) {
          let ragSection = '## Relevant Code from Project\n\n';
          for (const chunk of ragContext.chunks) {
            if (!appendIfBudget(`### ${chunk.file}\n\`\`\`\n${chunk.content}\n\`\`\`\n\n`)) break;
          }
        }
      }

      // Current file
      if (context?.currentFile) {
        const maxFileChars = Math.min(tokenBudget * 3, 3000);
        appendIfBudget(`## Currently Open File: ${context.currentFile.path}\n\`\`\`\n${(context.currentFile.content || '').substring(0, maxFileChars)}\n\`\`\`\n\n`);
      }

      // Selected code
      if (context?.selectedCode) {
        appendIfBudget(`## Selected Code:\n\`\`\`\n${context.selectedCode}\n\`\`\`\n\n`);
      }

      // Custom instructions
      const dynSettings = _readConfig()?.userSettings;
      if (dynSettings?.customInstructions?.trim()) {
        appendIfBudget(`## Custom Instructions\n${dynSettings.customInstructions.trim()}\n\n`);
      }

      return prompt;
    };

    // ──────────────────────────────────────────────────────
    // Wire Todo Updates
    // ──────────────────────────────────────────────────────
    mcpToolServer.onTodoUpdate = (todos) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('todo-update', todos);
    };

    // ──────────────────────────────────────────────────────
    // Agentic Loop State
    // ──────────────────────────────────────────────────────
    let basePrompt = buildStaticPrompt();
    let allToolResults = [];
    let gatheredWebData = [];
    let fullResponseText = '';
    let displayResponseText = '';
    let iteration = 0;
    let recentToolCalls = [];
    const writeFileHistory = {};
    let _pendingDroppedFilePaths = [];
    const toolFailCounts = {};
    let nudgesRemaining = 3;
    let contextRotations = 0;
    let lastConvSummary = '';
    let sessionJustRotated = false;
    let overflowResponseBudgetReduced = false;
    let forcedToolFunctions = null;
    let consecutiveEmptyGrammarRetries = 0;
    let continuationCount = 0;
    let _contLowProgressCount = 0;
    let _contRepeatCount = 0;
    let _lastContText = '';
    let _pendingPartialBlock = null;
    let lastIterationResponse = '';
    let nonContextRetries = 0;
    const executionState = new ExecutionState();

    const summarizer = new ConversationSummarizer();
    summarizer.setGoal(message);

    // Transactional rollback
    let rollbackRetries = 0;
    const maxRollbackRetries = modelTier.retryBudget;

    let effectiveMaxTokens = Math.min(context?.params?.maxTokens || maxResponseTokens, maxResponseTokens);

    // Web search instruction
    let webSearchInstruction = '';
    if (context?.webSearch) {
      webSearchInstruction = '## Web Search Enabled\nUse the `web_search` tool to find up-to-date information from the internet.\n\n';
    }

    // Build initial prompt
    let currentPrompt = {
      systemContext: basePrompt,
      userMessage: buildDynamicContext() + webSearchInstruction + message,
    };

    // Seed conversation history from renderer if fresh session
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
          console.log(`[AI Chat] Seeded chatHistory from renderer (${seeded.length - 1} turns)`);
        }
      }
    } catch (e) {
      console.warn('[AI Chat] Failed to seed conversation history:', e?.message);
    }

    memoryStore.addConversation('user', message);

    console.log(`[AI Chat] Model: ${modelProfile._meta.profileSource} (${modelTier.paramSize}B ${modelTier.family}) — tools=${modelTier.maxToolsPerPrompt}, grammar=${modelTier.grammarAlwaysOn ? 'always' : 'limited'}`);

    // ──────────────────────────────────────────────────────
    // Main Agentic Loop
    // ──────────────────────────────────────────────────────
    while (iteration < MAX_AGENTIC_ITERATIONS) {
      if (isStale()) {
        console.log('[AI Chat] Request superseded, breaking loop');
        if (mainWindow) mainWindow.webContents.send('llm-token', '\n*[Interrupted]*');
        break;
      }
      await waitWhilePaused();
      iteration++;
      console.log(`[AI Chat] Agentic iteration ${iteration}/${MAX_AGENTIC_ITERATIONS}`);

      // ── First-turn overflow guard ──
      if (iteration === 1) {
        currentPrompt = guardFirstTurnOverflow(currentPrompt, totalCtx, estimateTokens, buildStaticPrompt, buildDynamicContext, maxPromptTokens, mcpToolServer, message);
      }

      // ── Pre-generation context check ──
      if (iteration > 1) {
        const preGenResult = preGenerationContextCheck({
          llmEngine, totalCtx, currentPrompt, fullResponseText,
          allToolResults, contextRotations, MAX_CONTEXT_ROTATIONS: MAX_CONTEXT_ROTATIONS,
          summarizer, buildStaticPrompt, buildDynamicContext, maxPromptTokens, message,
          continuationCount, _pendingPartialBlock, mcpToolServer,
        });
        if (preGenResult) {
          if (preGenResult.shouldContinue) {
            currentPrompt = preGenResult.prompt;
            sessionJustRotated = preGenResult.rotated || false;
            if (preGenResult.rotated) {
              contextRotations++;
              lastConvSummary = preGenResult.summary || '';
            }
            if (preGenResult.clearContinuation) {
              fullResponseText = '';
              continuationCount = 0;
            }
          }
        }
      }

      // Send iteration progress
      if (mainWindow && iteration > 1) {
        mainWindow.webContents.send('agentic-progress', { iteration, maxIterations: MAX_AGENTIC_ITERATIONS });
      }

      // ── Decide: Native Function Calling vs Text Parsing ──
      const grammarEnabled = _readConfig()?.userSettings?.enableGrammar ?? false;
      const grammarIterLimit = modelTier.grammarAlwaysOn ? Infinity : modelTier.tier === 'large' ? 5 : 2;
      const useNativeFunctions = grammarEnabled && iteration <= grammarIterLimit;
      let nativeFunctions = null;
      let nativeFunctionCalls = [];

      if (consecutiveEmptyGrammarRetries >= 1) {
        // Grammar disabled — falling back to text mode
        nativeFunctions = null;
        forcedToolFunctions = null;
      } else if (forcedToolFunctions) {
        nativeFunctions = forcedToolFunctions;
        forcedToolFunctions = null;
      } else if (useNativeFunctions) {
        try {
          const toolDefs = mcpToolServer.getToolDefinitions();
          const filterNames = getProgressiveTools('general', iteration, (recentToolCalls || []).map(tc => tc.tool), modelTier.maxToolsPerPrompt);
          nativeFunctions = LLMEngine.convertToolsToFunctions(toolDefs, filterNames);
          console.log(`[AI Chat] Native function calling with ${Object.keys(nativeFunctions).length} functions`);
        } catch (e) {
          console.warn(`[AI Chat] Failed to build native functions: ${e.message}`);
          nativeFunctions = null;
        }
      }

      // ── Transactional Checkpoint ──
      const checkpoint = {
        chatHistory: llmEngine.chatHistory ? llmEngine.chatHistory.map(h => ({ ...h })) : null,
        lastEvaluation: llmEngine.lastEvaluation,
      };

      // Text-mode tool bubble state
      let _tb = '';
      let _tIdx = 9000;
      let _tStart = -1;
      let _tName = null;
      if (_pendingPartialBlock) {
        const seedMatch = _pendingPartialBlock.match(/\{\s*"tool"\s*:\s*"([^"]+)"/);
        if (seedMatch) { _tStart = 0; _tName = seedMatch[1]; }
      }

      let result;
      try {
        if (mainWindow) mainWindow.webContents.send('llm-iteration-begin');

        const localTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: 25, maxBufferChars: 2048 });
        const localThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });

        try {
          if (nativeFunctions && Object.keys(nativeFunctions).length > 0) {
            // ── NATIVE FUNCTION CALLING PATH ──
            const nativeResult = await llmEngine.generateWithFunctions(
              currentPrompt, nativeFunctions,
              { ...(context?.params || {}), maxTokens: effectiveMaxTokens },
              (token) => { if (isStale()) { llmEngine.cancelGeneration('user'); return; } localTokenBatcher.push(token); },
              (thinkToken) => { if (isStale()) { llmEngine.cancelGeneration('user'); return; } localThinkingBatcher.push(thinkToken); },
              (funcCall) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('llm-tool-generating', {
                    callIndex: 0, functionName: funcCall.functionName, paramsText: JSON.stringify(funcCall.params || {}), done: true,
                  });
                }
              }
            );
            result = nativeResult;
            nativeFunctionCalls = nativeResult.functionCalls || [];
            if (nativeFunctionCalls.length > 0) {
              console.log(`[AI Chat] Native: ${nativeFunctionCalls.length} tool(s): ${nativeFunctionCalls.map(f => f.functionName).join(', ')}`);
            }
          } else {
            // ── TEXT PARSING PATH ──
            result = await llmEngine.generateStream(currentPrompt, {
              ...(context?.params || {}),
              maxTokens: effectiveMaxTokens,
              isContinuation: continuationCount > 0,
            }, (token) => {
              if (isStale()) { llmEngine.cancelGeneration('user'); return; }
              localTokenBatcher.push(token);

              // Live tool-call bubble
              _tb += token;
              if (_tStart === -1) {
                const m = _tb.match(/\{\s*"tool"\s*:\s*"([^"]+)"/);
                if (m) { _tStart = m.index; _tName = m[1]; }
              }
              if (_tStart !== -1 && _tName && mainWindow && !mainWindow.isDestroyed()) {
                const raw = _tb.slice(_tStart);
                const paramsText = raw.length > 4000 ? raw.slice(-4000) : raw;
                mainWindow.webContents.send('llm-tool-generating', {
                  callIndex: _tIdx, functionName: _tName, paramsText, done: false,
                });
              }
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
        // ── Handle generation errors ──
        console.error(`[AI Chat] Generation error on iteration ${iteration}:`, genError.message);

        const isContextOverflow = genError.message?.startsWith('CONTEXT_OVERFLOW:') ||
          genError.message?.includes('default context shift strategy did not return') ||
          genError.message?.includes('context size is too small');

        if (isContextOverflow && contextRotations < MAX_CONTEXT_ROTATIONS) {
          if (_pendingPartialBlock) { _pendingPartialBlock = null; }

          // Continuation-overflow: clear partial content and retry
          if (continuationCount > 0 && summarizer.completedSteps.length === 0) {
            fullResponseText = '';
            continuationCount = 0;
            overflowResponseBudgetReduced = true;
            contextRotations++;
            try { await llmEngine.resetSession(true); } catch (_) {}
            sessionJustRotated = true;
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + '\n' + message,
            };
            continue;
          }

          // First-turn overflow: reduce budget and retry
          if (summarizer.completedSteps.length === 0 && !overflowResponseBudgetReduced) {
            overflowResponseBudgetReduced = true;
            contextRotations++;
            effectiveMaxTokens = Math.max(Math.floor(effectiveMaxTokens / 2), Math.min(512, maxResponseTokens));
            if (genError.partialResponse) fullResponseText += genError.partialResponse;
            try { await llmEngine.resetSession(true); } catch (_) {}
            sessionJustRotated = true;
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + '\n' + message,
            };
            continue;
          }

          if (summarizer.completedSteps.length === 0 && overflowResponseBudgetReduced) {
            const msg = '\n\n*[Context too small for this prompt. Try a shorter message or larger model.]*\n';
            if (mainWindow) mainWindow.webContents.send('llm-token', msg);
            fullResponseText += msg;
            break;
          }

          // Normal rotation
          contextRotations++;
          try {
            summarizer.markRotation();
            // Auto-checkpoint on rotation — persist state for recovery
            try {
              const checkpoint = {
                todos: mcpToolServer?._todos || [],
                lastFile: summarizer.currentState.lastFile || null,
                lastAction: summarizer.completedSteps.length > 0 ? summarizer.completedSteps[summarizer.completedSteps.length - 1] : null,
                rotationCount: summarizer.rotationCount,
                goal: summarizer.originalGoal,
                timestamp: Date.now(),
              };
              await mcpToolServer._saveMemory('_checkpoint', JSON.stringify(checkpoint));
            } catch (_) {}
            const convSummary = summarizer.generateSummary({ maxTokens: Math.min(Math.floor(totalCtx * 0.25), 3000), activeTodos: mcpToolServer?._todos || [] });
            if (genError.partialResponse) fullResponseText += genError.partialResponse;
            await llmEngine.resetSession(true);
            await ensureLlmChat(llmEngine, getNodeLlamaCppPath);

            if (convSummary && mainWindow) {
              const cleaned = convSummary.replace(/```(?:json|tool_call|tool)[^\n]*\n[\s\S]*?```/g, '');
              mainWindow.webContents.send('llm-thinking-token', cleaned + '\n[Context rotated]\n');
            }

            const partial = fullResponseText.trim().length > 0 ? fullResponseText.substring(Math.max(0, fullResponseText.length - 1500)) : '';
            const hint = partial
              ? `\n\nYou were generating and context was rotated. Here is the end of what you wrote:\n---\n${partial}\n---\nContinue from where you left off.`
              : `\nContext was rotated. The user request is: ${message.substring(0, 300)}`;

            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: buildDynamicContext() + '\n' + convSummary + hint,
            };
            sessionJustRotated = true;
            lastConvSummary = convSummary;
            continue;
          } catch (resetErr) {
            console.error('[AI Chat] Context rotation failed:', resetErr.message);
          }
        }

        if (isContextOverflow) {
          const msg = '\n\n*[Context limit exceeded. Please start a new chat.]*\n';
          if (mainWindow) mainWindow.webContents.send('llm-token', msg);
          fullResponseText += msg;
          break;
        }

        // Fatal errors
        const errLower = (genError.message || '').toLowerCase();
        const isFatal = ['model not loaded', 'object is disposed', 'model is disposed'].some(pat => errLower.includes(pat));
        if (isFatal) {
          const msg = `\n\n*[Generation stopped: ${genError.message.substring(0, 200)}. Please reload the model.]*\n`;
          if (mainWindow) mainWindow.webContents.send('llm-token', msg);
          fullResponseText += msg;
          break;
        }

        nonContextRetries++;
        if (nonContextRetries > 2) {
          const msg = `\n\n*[Generation error after ${nonContextRetries} retries: ${genError.message.substring(0, 200)}]*\n`;
          if (mainWindow) mainWindow.webContents.send('llm-token', msg);
          fullResponseText += msg;
          break;
        }
        continue;
      }

      // ── Post-generation: context usage ──
      try {
        const total = totalCtx;
        let used = 0;
        try { if (llmEngine.sequence?.nTokens) used = llmEngine.sequence.nTokens; } catch (_) {}
        if (!used) {
          const promptLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
          used = Math.ceil((promptLen + (result.text || '').length) / 4);
        }
        if (mainWindow) mainWindow.webContents.send('context-usage', { used, total });
      } catch (_) {}

      const responseText = result.text || '';
      const _timedOut = llmEngine._lastAbortReason === 'timeout';
      if (_timedOut) llmEngine._lastAbortReason = null;

      // ── Transactional Rollback Evaluation ──
      const responseVerdict = (_timedOut && responseText.length > 50)
        ? { verdict: 'COMMIT', reason: 'timeout_commit' }
        : evaluateResponse(responseText, nativeFunctionCalls, 'general', iteration);

      if (responseVerdict.verdict === 'ROLLBACK' && rollbackRetries < maxRollbackRetries) {
        rollbackRetries++;
        if (responseVerdict.reason === 'empty' && nativeFunctions) {
          consecutiveEmptyGrammarRetries++;
        } else {
          consecutiveEmptyGrammarRetries = 0;
        }
        console.log(`[AI Chat] ROLLBACK (${responseVerdict.reason}) — retry ${rollbackRetries}/${maxRollbackRetries}`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('llm-stream-reset');

        if (checkpoint.chatHistory) {
          llmEngine.chatHistory = checkpoint.chatHistory;
          llmEngine.lastEvaluation = checkpoint.lastEvaluation;
        }

        if (rollbackRetries >= 3) {
          try {
            const toolDefs = mcpToolServer.getToolDefinitions();
            forcedToolFunctions = LLMEngine.convertToolsToFunctions(toolDefs, null);
          } catch (_) {}
        }

        iteration--;
        continue;
      }

      if (responseVerdict.verdict === 'COMMIT') {
        rollbackRetries = 0;
        consecutiveEmptyGrammarRetries = 0;
      }

      fullResponseText += responseText;

      // Strip tool fences from display copy
      let displayChunk = responseText
        .replace(/\n?```(?:json|tool_call|tool)\b[\s\S]*?```\n?/g, '')
        .replace(/\n?```(?:json|tool_call|tool)\b[\s\S]*$/g, '')
        .replace(/\n{3,}/g, '\n\n');
      if (continuationCount > 0) {
        displayChunk = displayChunk.replace(/\[(?:Continue your response|You were generating a tool call)[\s\S]*?\]/gi, '');
      }
      displayResponseText += displayChunk;

      // ── SEAMLESS CONTINUATION ──
      let _stitchedForMcp;
      if (_pendingPartialBlock) {
        // Overlap de-duplication: detect if model repeated the tail we sent
        let overlap = 0;
        const maxCheck = Math.min(_pendingPartialBlock.length, responseText.length, 2000);
        for (let len = maxCheck; len >= 20; len--) {
          const suffix = _pendingPartialBlock.slice(-len);
          if (responseText.startsWith(suffix)) { overlap = len; break; }
        }
        _stitchedForMcp = _pendingPartialBlock + responseText.slice(overlap);
      } else {
        _stitchedForMcp = responseText;
      }
      _pendingPartialBlock = null;
      const _fenceIdx = _stitchedForMcp.search(/```(?:json|tool_call|tool)\b/);
      const _afterFence = _fenceIdx !== -1 ? _stitchedForMcp.slice(_fenceIdx) : '';
      // Check for closing ``` — with or without leading newline
      let _hasUnclosedToolFence = _fenceIdx !== -1 &&
        !_afterFence.match(/```(?:json|tool_call|tool)\b[\s\S]*?\n```/) &&
        !_afterFence.match(/```(?:json|tool_call|tool)\b[\s\S]*?[^`]```\s*$/);

      // If the unclosed fence contains a complete JSON tool call, don't treat as truncated
      if (_hasUnclosedToolFence) {
        const jsonMatch = _afterFence.match(/```(?:json|tool_call|tool)\s*\n?([\s\S]*)/);
        if (jsonMatch) {
          try {
            const jsonContent = jsonMatch[1].replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(jsonContent);
            if (parsed && typeof parsed.tool === 'string') {
              _hasUnclosedToolFence = false;
            }
          } catch {}
        }
      }

      const _wasTruncated = (
        (result?.stopReason === 'maxTokens' || result?.stopReason === 'max-tokens') ||
        _hasUnclosedToolFence
      ) && nativeFunctionCalls.length === 0 && !_timedOut && !isStale();

      if (_wasTruncated && continuationCount < 50) {
        // Context budget check before continuing
        let contContextPct = 0;
        try {
          let contUsed = 0;
          try { if (llmEngine.sequence?.nTokens) contUsed = llmEngine.sequence.nTokens; } catch (_) {}
          if (!contUsed) {
            const pLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
            contUsed = Math.ceil((pLen + fullResponseText.length) / 4);
          }
          contContextPct = contUsed / totalCtx;
        } catch (_) {}

        const budgetLimit = _hasUnclosedToolFence ? 0.92 : 0.70;
        if (contContextPct > budgetLimit) {
          console.log(`[AI Chat] Continuation aborted: context at ${Math.round(contContextPct * 100)}%`);
          continuationCount = 0;
          // Try salvage
          if (_hasUnclosedToolFence && _stitchedForMcp) {
            const salvageResult = salvagePartialToolCall(_stitchedForMcp, _fenceIdx);
            if (salvageResult) {
              // Replace responseText with reconstructed tool call
              fullResponseText = fullResponseText.slice(0, fullResponseText.length - (result.text || '').length) + salvageResult;
            }
          }
          // Fall through to normal processing
        } else {
          continuationCount++;
          // Forward progress guard
          if (responseText.length < 20) {
            _contLowProgressCount++;
          } else {
            _contLowProgressCount = 0;
          }

          // Detect repeated identical content (model stuck in loop)
          if (responseText.trim() === _lastContText.trim() && responseText.length > 0) {
            _contRepeatCount++;
          } else {
            _contRepeatCount = 0;
          }
          _lastContText = responseText;

          if (_contLowProgressCount >= 3 || _contRepeatCount >= 2) {
            console.log(`[AI Chat] Continuation aborted: ${_contRepeatCount >= 2 ? 'repeated identical content' : 'no forward progress'}`);
            continuationCount = 0;
            _contLowProgressCount = 0;
            _contRepeatCount = 0;
            // Fall through
          } else {
            const truncReason = _hasUnclosedToolFence ? 'unclosed fence' : 'maxTokens';
            console.log(`[AI Chat] Seamless continuation ${continuationCount}/50 — ${truncReason} (${responseText.length} chars this pass, ${fullResponseText.length} total)`);
            iteration--;

            // Cap effectiveMaxTokens on continuation passes to avoid overflowing context
            const remainingTokens = Math.max(0, totalCtx - Math.ceil(((typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length)) + fullResponseText.length) / 4));
            effectiveMaxTokens = Math.min(effectiveMaxTokens, Math.max(256, Math.floor(remainingTokens * 0.70)));

            let continuationMsg;
            const taskHint = message ? `[Task: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}]\n` : '';
            // Include written-files manifest so model knows what already exists
            const writtenPaths = Object.keys(writeFileHistory).filter(k => writeFileHistory[k].count > 0);
            const fileManifest = writtenPaths.length > 0
              ? `[Files already written this turn: ${writtenPaths.join(', ')}. Do NOT write to these files again. Use append_to_file or edit_file if changes needed.]\n`
              : '';
            // Dynamic tail size: scale with remaining context, clamped to [500, 3000] chars
            const maxTailChars = Math.max(500, Math.min(Math.floor(remainingTokens * 0.3 * 4), 3000));
            if (_hasUnclosedToolFence) {
              const partialFence = _stitchedForMcp.slice(_fenceIdx);
              _pendingPartialBlock = partialFence; // keep FULL text for stitching
              const tailForModel = partialFence.length > maxTailChars ? partialFence.slice(-maxTailChars) : partialFence;
              continuationMsg = `${taskHint}${fileManifest}[Continue the tool call JSON from exactly where it was cut. Output ONLY the JSON continuation. Do NOT restart the tool call. Continue from:\n${tailForModel}]`;
            } else {
              const tailForModel = responseText.length > maxTailChars ? responseText.slice(-maxTailChars) : responseText;
              continuationMsg = `${taskHint}${fileManifest}[Continue your response exactly where you left off. Do not restart or repeat content. Here is the end of what you wrote:\n${tailForModel}]`;
            }

            currentPrompt = {
              systemContext: currentPrompt.systemContext,
              userMessage: continuationMsg,
            };
            continue;
          }
        }
      }

      // Not truncated — reset continuation
      if (!_wasTruncated) continuationCount = 0;

      // Send done:true for text-mode tool bubble
      if (_tStart !== -1 && _tName && !nativeFunctionCalls.length && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('llm-tool-generating', {
          callIndex: _tIdx, functionName: _tName, paramsText: '', done: true,
        });
      }

      if (isStale()) break;

      // Record plan
      if (responseText.length > 50) summarizer.recordPlan(responseText);

      // ── Progressive Context Compaction ──
      try {
        let contextUsed = 0;
        try { if (llmEngine.sequence?.nTokens) contextUsed = llmEngine.sequence.nTokens; } catch (_) {}
        if (!contextUsed) {
          const pLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
          contextUsed = Math.ceil((pLen + fullResponseText.length) / 4);
        }
        const compaction = progressiveContextCompaction({
          contextUsedTokens: contextUsed, totalContextTokens: totalCtx,
          allToolResults, chatHistory: llmEngine.chatHistory, fullResponseText,
        });
        if (compaction.pruned > 0) fullResponseText = compaction.newFullResponseText;
        if (compaction.shouldRotate && contextRotations < MAX_CONTEXT_ROTATIONS) {
          contextRotations++;
          summarizer.markRotation();
          lastConvSummary = summarizer.generateQuickSummary(mcpToolServer?._todos);
          await llmEngine.resetSession(true);
          sessionJustRotated = true;
        }
        if (mainWindow) mainWindow.webContents.send('context-usage', { used: contextUsed, total: totalCtx });
      } catch (_) {}

      // ── Process Tool Calls ──
      let toolResults;
      if (nativeFunctionCalls.length > 0) {
        toolResults = await executeNativeToolCalls({
          nativeFunctionCalls, responseText, mcpToolServer, modelTier,
          writeFileHistory, allToolResults, gatheredWebData,
          isStale, waitWhilePaused, continuationCount,
        });
      } else {
        const textOpts = {
          toolPaceMs: 50, skipWriteDeferral: modelTier.tier === 'tiny',
          userMessage: message, lastDroppedFilePaths: _pendingDroppedFilePaths, writeFileHistory,
          continuationCount,
        };
        toolResults = await mcpToolServer.processResponse(_stitchedForMcp, textOpts);
        _pendingDroppedFilePaths = toolResults.droppedFilePaths || [];
      }

      // Cross-turn dedup
      if (toolResults.hasToolCalls && toolResults.results.length > 0) {
        const sigs = new Set();
        for (const tr of toolResults.results) {
          const sig = JSON.stringify({ t: tr.tool, p: tr.params });
          if (sigs.has(sig)) {
            tr.result = { success: false, error: `BLOCKED: Duplicate call to ${tr.tool} with same params.` };
          }
          sigs.add(sig);
        }
      }

      // Route planning text to thinking panel
      if (toolResults.hasToolCalls && toolResults.results.length > 0 && mainWindow) {
        let planningText;
        if (toolResults.formalCallCount > 0) {
          // Formal tool calls — strip from tool indicators onward
          const toolIndicators = ['{"tool":', '```tool_call', '```json\n{"tool"', '<tool_call>'];
          let splitIdx = responseText.length;
          for (const ind of toolIndicators) {
            const idx = responseText.indexOf(ind);
            if (idx >= 0 && idx < splitIdx) splitIdx = idx;
          }
          planningText = responseText.substring(0, splitIdx).trim();
        } else {
          // Fallback-detected tool calls — strip large code blocks (they appear in tool result panels)
          planningText = responseText
            .replace(/```[^\n]*\n([\s\S]*?)```/g, (match, content) => content.length > 200 ? '' : match)
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }
        if (planningText) {
          mainWindow.webContents.send('llm-thinking-token', planningText);
          mainWindow.webContents.send('llm-replace-last', planningText);
        }
      }

      if (!toolResults.hasToolCalls || toolResults.results.length === 0) {
        // Check for repetition
        const failure = classifyResponseFailure(responseText, false, 'general', iteration, message, lastIterationResponse, {});
        lastIterationResponse = responseText;

        if (failure?.severity === 'stop') {
          if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[Stopped — ${failure.type}]*\n`);
          break;
        }

        // Code-dump nudge — detect large code blocks (fenced or raw) that should be files
        const _codeBlockMatch = responseText.match(/```(?:html?|css|javascript|js|typescript|ts|python|py|json)\s*\n([\s\S]*?)```/i);
        const hasCodeBlocks = _codeBlockMatch && _codeBlockMatch[1].length > 500;
        // Also detect unclosed code fences (model hit maxTokens before closing ```)
        const _unclosedFenceMatch = !hasCodeBlocks && responseText.match(/```(?:html?|css|javascript|js|typescript|ts|python|py|json)\s*\n([\s\S]{500,})$/i);
        const hasUnclosedLargeBlock = !!_unclosedFenceMatch;
        // Detect raw HTML/code dumped without fences (model obeyed "no code blocks" but didn't use write_file)
        const hasRawCodeDump = !hasCodeBlocks && !hasUnclosedLargeBlock && responseText.length > 500 &&
          (/<html[\s>]/i.test(responseText) || /<style[\s>]/i.test(responseText) || /<script[\s>]/i.test(responseText) ||
           (/<\w+[\s>]/.test(responseText) && (responseText.match(/<\w+/g) || []).length > 10));
        if ((hasCodeBlocks || hasUnclosedLargeBlock || hasRawCodeDump) && nudgesRemaining > 0 && iteration < MAX_AGENTIC_ITERATIONS - 1) {
          nudgesRemaining--;
          // Strip the raw code dump from accumulated response to free context budget.
          // The model will regenerate the content properly via write_file.
          fullResponseText = '';
          try { await llmEngine.resetSession(true); } catch (_) {}
          sessionJustRotated = true;
          currentPrompt = {
            systemContext: buildStaticPrompt(),
            userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + '\n' + message + '\n\n[SYSTEM: You wrote code directly in chat. Use write_file tool to save it. Format: ```json\n{"tool":"write_file","params":{"filePath":"filename.ext","content":"..."}}\n```]',
          };
          continue;
        }

        console.log('[AI Chat] No tool calls, ending agentic loop');
        break;
      }

      lastIterationResponse = responseText;

      if (isStale()) break;

      // Accumulate tool results
      allToolResults.push(...toolResults.results);
      capArray(allToolResults, 50);

      // Compress old tool results
      const currentIterStart = allToolResults.length - toolResults.results.length;
      for (let i = 0; i < currentIterStart; i++) {
        const tr = allToolResults[i];
        if (tr._compressed) continue;
        const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result || '');
        if (resultStr.length > 400) {
          const status = tr.result?.success !== false ? 'ok' : 'fail';
          tr._compressed = true;
          tr._originalResult = tr.result;
          tr.result = { _pruned: true, tool: tr.tool, status, snippet: (tr.result?.title || resultStr).substring(0, 120) };
        }
      }

      // Persist web data
      for (const tr of toolResults.results) {
        if (tr.tool === 'web_search' && tr.result?.success && Array.isArray(tr.result.results)) {
          for (const r of tr.result.results) {
            if (r.title && r.url) gatheredWebData.push({ title: r.title, url: r.url, snippet: r.snippet || '' });
          }
        }
        summarizer.recordToolCall(tr.tool, tr.params, tr.result);
        summarizer.markPlanStepCompleted(tr.tool, tr.params);
        executionState.update(tr.tool, tr.params, tr.result, iteration);
      }

      // UI events
      sendToolExecutionEvents(mainWindow, toolResults.results, playwrightBrowser, { checkSuccess: true });

      // Build tool feedback
      const toolFeedback = buildToolFeedback(toolResults.results, {
        truncateResult: _truncateResult, totalCtx, allToolResults,
        writeFileHistory, currentIterationStart: currentIterStart,
      });

      // Auto-snapshot
      const snapResult = await autoSnapshotAfterBrowserAction(toolResults.results, mcpToolServer, playwrightBrowser, browserManager);
      let snapFeedback = '';
      if (snapResult) {
        snapFeedback = `\n### Page snapshot after ${snapResult.triggerTool}\n${snapResult.snapshotText}\n\n**${snapResult.elementCount} elements.** Use [ref=N] with browser_click/type.\n`;
      }

      if (mainWindow) mainWindow.webContents.send('mcp-tool-results', toolResults.results);
      fullResponseText += toolFeedback + snapFeedback;
      if (fullResponseText.length > MAX_RESPONSE_SIZE) {
        fullResponseText = fullResponseText.substring(fullResponseText.length - MAX_RESPONSE_SIZE);
      }

      // Stuck/cycle detection
      if (detectStuckCycle(recentToolCalls, toolResults.results, mainWindow, _readConfig)) {
        fullResponseText += '\n\n*Detected repetitive pattern. Stopping.*';
        break;
      }

      // Task reminder + step directive
      const taskReminder = `CURRENT TASK: ${message.substring(0, 300)}${message.length > 300 ? '...' : ''}\n\n`;
      let stepDirective = '';
      const activeTodos = mcpToolServer._todos || [];
      if (activeTodos.length > 0) {
        const inProgress = activeTodos.find(t => t.status === 'in-progress');
        const nextPending = activeTodos.find(t => t.status === 'pending');
        const done = activeTodos.filter(t => t.status === 'done').length;
        const total = activeTodos.length;
        if (inProgress) {
          stepDirective = `\n## CURRENT STEP (${done}/${total})\n**NOW:** ${inProgress.text}\n\n`;
        } else if (nextPending) {
          stepDirective = `\n## NEXT STEP (${done}/${total})\n**DO NOW:** ${nextPending.text}\n\n`;
        } else if (done === total) {
          stepDirective = `\n## PLAN COMPLETE (${done}/${total})\nAll steps finished. Provide a summary.\n\n`;
        }
      }

      const executionBlock = executionState.getSummary();
      const hasBrowserAction = toolResults.results.some(tr => tr.tool?.startsWith('browser_'));
      const continueInstruction = hasBrowserAction
        ? '\n\nThe snapshot above has [ref=N]. Use browser_click/type with ref. Output next tool call now.'
        : '\n\nSummarize what was accomplished. Only call another tool if the user\'s request clearly requires additional steps not yet started.';

      const iterContext = executionBlock + stepDirective + taskReminder;
      const allFeedback = toolFeedback + snapFeedback;

      if (sessionJustRotated) {
        sessionJustRotated = false;
        currentPrompt = {
          systemContext: buildStaticPrompt(),
          userMessage: iterContext + buildDynamicContext() + '\n' + lastConvSummary + `\nLatest results:\n${allFeedback.substring(0, 6000)}${continueInstruction}`,
        };
      } else {
        currentPrompt = {
          systemContext: buildStaticPrompt(),
          userMessage: iterContext + buildDynamicContext() + '\n' + allFeedback + continueInstruction,
        };
      }
    }

    // ── Post-loop ──
    if (iteration >= MAX_AGENTIC_ITERATIONS) {
      fullResponseText += `\n\n*Reached max ${MAX_AGENTIC_ITERATIONS} iterations.*`;
      if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Reached max ${MAX_AGENTIC_ITERATIONS} iterations.*`);
    }

    // Auto-summarize if last iteration used tools
    if (allToolResults.length > 0 && iteration >= 2 && !allToolResults.some(tr => tr.tool?.startsWith('browser_'))) {
      const lastTrimmed = (fullResponseText || '').trim();
      const endsWithToolOutput = lastTrimmed.endsWith('```') || lastTrimmed.includes('## Tool Execution Results');
      if (endsWithToolOutput || iteration >= MAX_AGENTIC_ITERATIONS) {
        try {
          const toolsSummary = allToolResults.slice(-10).map(tr => `${tr.tool}: ${tr.result?.success ? 'done' : 'failed'}`).join(', ');
          const summaryResult = await llmEngine.generateStream({
            systemContext: buildStaticPrompt(),
            userMessage: `Tools used: ${toolsSummary}\n\nProvide a brief summary of what was accomplished (2-4 sentences). Do NOT call any tools.`,
          }, { maxTokens: 512, temperature: 0.3 }, (token) => {
            if (mainWindow) mainWindow.webContents.send('llm-token', token);
          }, (thinkToken) => {
            if (mainWindow) mainWindow.webContents.send('llm-thinking-token', thinkToken);
          });
          if (summaryResult.text) {
            fullResponseText += '\n\n' + summaryResult.text;
            displayResponseText += '\n\n' + summaryResult.text;
          }
        } catch (e) {
          console.log('[AI Chat] Summary generation failed:', e.message);
        }
      }
    }

    memoryStore.addConversation('assistant', fullResponseText);

    // Clean display text
    let cleanResponse = displayResponseText;
    cleanResponse = cleanResponse.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
    cleanResponse = cleanResponse.replace(/<\/?think(?:ing)?>/gi, '');
    // Strip any tool call fence artifacts that leaked through continuation boundaries
    cleanResponse = cleanResponse.replace(/\n?```(?:json|tool_call|tool)\b[\s\S]*?```\n?/g, '');
    cleanResponse = cleanResponse.replace(/\n?```(?:json|tool_call|tool)\b[\s\S]*/g, '');
    cleanResponse = cleanResponse.replace(/^\s*```\s*$/gm, '');
    cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim();

    if (!cleanResponse) {
      cleanResponse = allToolResults.length > 0 ? 'Tools executed successfully.' : 'No response generated.';
    }

    const localTokensUsed = estimateTokens(fullResponseText);
    _reportTokenStats(localTokensUsed, mainWindow);

    return {
      success: true,
      text: cleanResponse,
      model: modelStatus.modelInfo?.name || 'local',
      tokensUsed: localTokensUsed,
      toolResults: allToolResults.length > 0 ? allToolResults : undefined,
      iterations: iteration,
    };
  }
}

// ─────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────

/**
 * Select the best cloud provider based on available providers and task.
 */
function selectCloudProvider(cloudLLM, message, context) {
  const configured = cloudLLM.getConfiguredProviders();
  if (configured.length === 0) return null;
  const has = (p) => configured.some(c => c.provider === p);
  const pick = (provider, model) => ({ provider, model });

  if (context?.images?.length > 0) {
    if (has('google')) return pick('google', 'gemini-2.5-flash');
    if (has('openai')) return pick('openai', 'gpt-4o');
    if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
  }

  if (has('groq')) return pick('groq', 'llama-3.3-70b-versatile');
  if (has('cerebras')) return pick('cerebras', 'zai-glm-4.7');
  if (has('google')) return pick('google', 'gemini-2.5-flash');
  if (has('anthropic')) return pick('anthropic', 'claude-sonnet-4-20250514');
  if (has('openai')) return pick('openai', 'gpt-4o');

  return null;
}

/**
 * Guard against first-turn prompt overflow.
 */
function guardFirstTurnOverflow(currentPrompt, totalCtx, estimateTokens, buildStaticPrompt, buildDynamicContext, maxPromptTokens, mcpToolServer, message) {
  const text = (currentPrompt.systemContext || '') + (currentPrompt.userMessage || '');
  const tokens = estimateTokens(text);
  const headroom = totalCtx - tokens;

  if (headroom >= Math.floor(totalCtx * 0.15)) return currentPrompt;

  console.log(`[AI Chat] First-turn overflow guard: ~${tokens} tokens, ctx=${totalCtx}, headroom=${headroom}`);

  // Step 1: Minimal dynamic context
  let prompt = {
    systemContext: buildStaticPrompt(),
    userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + message,
  };
  let retryTokens = estimateTokens((prompt.systemContext || '') + (prompt.userMessage || ''));

  if (totalCtx - retryTokens < Math.floor(totalCtx * 0.15)) {
    // Step 2: No dynamic context
    prompt = { systemContext: buildStaticPrompt(), userMessage: message };
    retryTokens = estimateTokens((prompt.systemContext || '') + (prompt.userMessage || ''));
  }

  if (totalCtx - retryTokens < Math.floor(totalCtx * 0.15)) {
    // Step 3: Minimal tool hint
    const minHint = mcpToolServer.getCompactToolHint('general', { minimal: true });
    const preambleOnly = buildStaticPrompt('chat');
    prompt = { systemContext: preambleOnly + '\n' + minHint + '\n', userMessage: message };
    retryTokens = estimateTokens((prompt.systemContext || '') + (prompt.userMessage || ''));
    console.log(`[AI Chat] Overflow step 3: minimal tools, ~${retryTokens} tokens`);
  }

  return prompt;
}

/**
 * Pre-generation context check — compact or rotate before generating.
 */
function preGenerationContextCheck(opts) {
  const { llmEngine, totalCtx, currentPrompt, fullResponseText, allToolResults,
    contextRotations, MAX_CONTEXT_ROTATIONS, summarizer, buildStaticPrompt,
    buildDynamicContext, maxPromptTokens, message, continuationCount, _pendingPartialBlock, mcpToolServer } = opts;

  let used = 0;
  try { if (llmEngine.sequence?.nTokens) used = llmEngine.sequence.nTokens; } catch (_) {}
  if (!used) {
    const pLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
    used = Math.ceil((pLen + fullResponseText.length) / 4);
  }

  const pct = used / totalCtx;
  if (pct <= 0.60) return null;

  const compaction = progressiveContextCompaction({
    contextUsedTokens: used, totalContextTokens: totalCtx,
    allToolResults, chatHistory: llmEngine.chatHistory, fullResponseText,
  });

  if (!compaction.shouldRotate) return null;
  if (contextRotations >= MAX_CONTEXT_ROTATIONS) return null;

  const isContinuationRotation = continuationCount > 0 && summarizer.completedSteps.length === 0;

  summarizer.markRotation();
  // Auto-checkpoint on rotation
  try {
    const ckpt = {
      todos: mcpToolServer?._todos || [],
      lastFile: summarizer.currentState.lastFile || null,
      lastAction: summarizer.completedSteps.length > 0 ? summarizer.completedSteps[summarizer.completedSteps.length - 1] : null,
      rotationCount: summarizer.rotationCount,
      goal: summarizer.originalGoal,
      timestamp: Date.now(),
    };
    mcpToolServer?._saveMemory?.('_checkpoint', JSON.stringify(ckpt));
  } catch (_) {}
  const summary = summarizer.generateQuickSummary(mcpToolServer?._todos);

  if (isContinuationRotation) {
    return {
      shouldContinue: true,
      prompt: {
        systemContext: buildStaticPrompt(),
        userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + '\n' + message,
      },
      rotated: true,
      summary,
      clearContinuation: true,
    };
  }

  return {
    shouldContinue: true,
    prompt: {
      systemContext: buildStaticPrompt(),
      userMessage: buildDynamicContext() + '\n' + summary + `\nContext rotated. Current request: ${message.substring(0, 300)}`,
    },
    rotated: true,
    summary,
  };
}

/**
 * Execute native function calls through the unified pipeline.
 */
async function executeNativeToolCalls(opts) {
  const { nativeFunctionCalls, responseText, mcpToolServer, modelTier,
    writeFileHistory, allToolResults, gatheredWebData, isStale, waitWhilePaused, continuationCount } = opts;

  // Normalize to {tool, params} format
  let calls = nativeFunctionCalls.map(fc => ({
    tool: fc.functionName, params: fc.params || {},
  }));

  // Repair
  const { repaired, issues } = repairToolCallsFn(calls, responseText);
  if (issues.length > 0) console.log(`[AI Chat] Repair: ${issues.length} issue(s)`);
  calls = repaired;

  // Dedup
  const seen = new Set();
  calls = calls.filter(call => {
    const sig = `${call.tool}:${JSON.stringify(call.params)}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  // Browser cap
  let browserChanges = 0;
  let browserSkipped = 0;
  calls = calls.filter(call => {
    if (BROWSER_STATE_CHANGERS.has(call.tool) && browserChanges >= 2) {
      browserSkipped++;
      return false;
    }
    if (BROWSER_STATE_CHANGERS.has(call.tool)) browserChanges++;
    return true;
  });

  // Write deferral
  const batchHasGather = calls.some(c => DATA_GATHER_TOOLS.has(c.tool));
  const batchHasWrite = calls.some(c => DATA_WRITE_TOOLS.has(c.tool));
  const shouldDefer = batchHasGather && batchHasWrite && modelTier.tier !== 'tiny';

  // Execute
  const results = [];
  for (const call of calls) {
    if (isStale()) break;
    await waitWhilePaused();

    if (results.length > 0) await new Promise(r => setTimeout(r, 50));

    try {
      if (call.tool.startsWith('browser_')) call.params = mcpToolServer._normalizeBrowserParams(call.tool, call.params);
      else call.params = mcpToolServer._normalizeFsParams(call.tool, call.params);

      // Cross-iteration write dedup (stricter during continuation)
      if (call.tool === 'write_file') {
        const filePath = call.params?.filePath || call.params?.path;
        const writeLimit = (continuationCount || 0) > 0 ? 1 : 2;
        if (filePath && writeFileHistory[filePath]?.count >= writeLimit) {
          results.push({ tool: call.tool, params: call.params, result: { success: false, error: `BLOCKED: "${filePath}" already written ${writeFileHistory[filePath].count} times. Use append_to_file or edit_file instead.` } });
          continue;
        }
      }

      // Write deferral
      if (shouldDefer && DATA_WRITE_TOOLS.has(call.tool)) {
        results.push({ tool: call.tool, params: call.params, result: { success: false, error: 'DEFERRED: Re-issue write next turn using actual data from tool results.' } });
        continue;
      }

      const toolResult = await mcpToolServer.executeTool(call.tool, call.params);
      results.push({ tool: call.tool, params: call.params, result: toolResult });
      if (call.tool === 'update_todo') await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      results.push({ tool: call.tool, params: call.params, result: { success: false, error: err.message } });
    }
  }

  return {
    hasToolCalls: calls.length > 0,
    results,
    toolCalls: calls,
    capped: browserSkipped > 0,
    skippedToolCalls: browserSkipped,
  };
}

/**
 * Detect stuck/cycle patterns in tool calls.
 */
function detectStuckCycle(recentToolCalls, newResults, mainWindow, _readConfig) {
  for (const tr of newResults) {
    const p = tr.params || {};
    const paramsHash = `${p.filePath || p.dirPath || p.url || p.ref || p.query || p.command || p.selector || ''}:${(p.text || p.content || '').substring(0, 80)}`.substring(0, 200);
    recentToolCalls.push({ tool: tr.tool, paramsHash });
  }
  if (recentToolCalls.length > 20) recentToolCalls.splice(0, recentToolCalls.length - 20);

  // Stuck detection
  if (recentToolCalls.length >= STUCK_THRESHOLD) {
    const last = recentToolCalls[recentToolCalls.length - 1];
    const tail = recentToolCalls.slice(-STUCK_THRESHOLD);
    if (tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash)) {
      console.log(`[AI Chat] Stuck: ${last.tool} ${STUCK_THRESHOLD}+ times`);
      if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected loop (${last.tool}). Stopped.*`);
      return true;
    }
  }

  // Cycle detection
  if (recentToolCalls.length >= 8) {
    for (let cycleLen = 2; cycleLen <= 4; cycleLen++) {
      if (recentToolCalls.length < cycleLen * CYCLE_MIN_REPEATS) continue;
      const names = recentToolCalls.map(tc => tc.tool);
      const lastCycle = names.slice(-cycleLen);
      let repeats = 0;
      for (let pos = names.length - cycleLen; pos >= 0; pos -= cycleLen) {
        const segment = names.slice(pos, pos + cycleLen);
        if (segment.join(',') === lastCycle.join(',')) repeats++;
        else break;
      }
      if (repeats >= CYCLE_MIN_REPEATS) {
        const sig = lastCycle.join(' → ');
        console.log(`[AI Chat] Cycle: [${sig}] ×${repeats}`);
        if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected cycle (${sig}). Stopped.*`);
        return true;
      }
    }
  }

  return false;
}

/**
 * Salvage a partial write_file tool call from truncated content.
 */
function salvagePartialToolCall(text, fenceIdx) {
  const fenceContent = text.slice(fenceIdx);
  const fpMatch = fenceContent.match(/"filePath"\s*:\s*"([^"]+)"/);
  const ctMatch = fenceContent.match(/"content"\s*:\s*"([\s\S]+)/);

  if (!fpMatch || !ctMatch || ctMatch[1].length < 20) {
    if (fpMatch) console.warn(`[AI Chat] Salvage dropped: "${fpMatch[1]}" — content too short (${ctMatch ? ctMatch[1].length : 0} chars)`);
    return null;
  }

  let content = ctMatch[1];
  const lastNewline = content.lastIndexOf('\\n');
  if (lastNewline > 50) content = content.substring(0, lastNewline);

  try {
    content = JSON.parse('"' + content + '"');
  } catch (_) {
    content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  if (content.length < 20) return null;

  console.log(`[AI Chat] Salvaged ${content.length} chars for "${fpMatch[1]}"`);
  const json = JSON.stringify({ tool: 'write_file', params: { filePath: fpMatch[1], content } });
  return '```json\n' + json + '\n```';
}

/**
 * Ensure LLM engine has a valid chat session after reset.
 */
async function ensureLlmChat(llmEngine, getNodeLlamaCppPath) {
  if (llmEngine.chat) return;

  if (!llmEngine.context) {
    if (llmEngine.model) {
      llmEngine.context = await llmEngine.model.createContext();
    } else {
      throw new Error('Model not available');
    }
  }

  const { LlamaChat } = await import(getNodeLlamaCppPath());
  llmEngine.sequence = llmEngine.context.getSequence(
    llmEngine.tokenPredictor ? { tokenPredictor: llmEngine.tokenPredictor } : undefined
  );
  llmEngine.chat = new LlamaChat({ contextSequence: llmEngine.sequence });
  llmEngine.chatHistory = [{ type: 'system', text: llmEngine._getActiveSystemPrompt() }];
  llmEngine.lastEvaluation = null;
}

module.exports = { register };
