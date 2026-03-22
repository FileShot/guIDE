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
  classifyResponseFailure,
  progressiveContextCompaction,
  buildToolFeedback,
  checkFileCompleteness,
  buildFileStructureDigest,
  ExecutionState,
} = require('./agenticChatHelpers');
const { LLMEngine } = require('./llmEngine');
const { RollingSummary } = require('./rollingSummary');
const { SessionStore } = require('./sessionStore');
const { LongTermMemory } = require('./longTermMemory');
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
const STUCK_THRESHOLD = 10;
const CYCLE_MIN_REPEATS = 5;
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

      // ─── Clear per-turn state to prevent cross-conversation contamination ──
      mcpToolServer._todos = [];
      mcpToolServer._todoNextId = 1;
      mcpToolServer._filesWrittenThisTurn = new Set();

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

    // Sync project path from frontend context (survives server restarts)
    if (context?.projectPath) {
      mcpToolServer.projectPath = context.projectPath;
      ctx.currentProjectPath = context.projectPath;
    }

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
      // Strip XML tool_call tags (Qwen3 and other models use this format)
      cleanedText = cleanedText.replace(/<tool_calls?>\s*[\s\S]*?<\/tool_calls?>/gi, '');
      cleanedText = cleanedText.replace(/<\/?tool_calls?>/gi, '');
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
        const toolIndicators = ['{"tool":', '```tool_call', '```json\n{"tool"', '<tool_call>'];
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
          { allToolResults: allCloudToolResults }
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
      if (mainWindow) mainWindow.webContents.send('mcp-tool-results', iterationToolResults);

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
        : '';
      currentCloudPrompt = `Here are the results of the tool calls:\n\n${toolSummary}\n\n${continueHint}`;
    }

    memoryStore.addConversation('assistant', fullCloudResponse);

    // Clean up display — strip inline JSON tool calls with proper brace matching
    // Only match objects with "tool" key — "name" is too common in generated code
    let cleanResponse = fullCloudResponse;
    // Strip XML tool_call tags
    cleanResponse = cleanResponse.replace(/<tool_calls?>\s*[\s\S]*?<\/tool_calls?>/gi, '');
    cleanResponse = cleanResponse.replace(/<\/?tool_calls?>/gi, '');
    {
      const toolPat = /\[?\s*\{\s*"tool"\s*:\s*"/g;
      let tm;
      const ranges = [];
      while ((tm = toolPat.exec(cleanResponse)) !== null) {
        const bs = cleanResponse.indexOf('{', tm.index);
        let d = 1, ci = bs + 1;
        while (ci < cleanResponse.length && d > 0) {
          if (cleanResponse[ci] === '{') d++;
          else if (cleanResponse[ci] === '}') d--;
          ci++;
        }
        if (d === 0) {
          let end = ci;
          const after = cleanResponse.slice(end).match(/^\s*\]?/);
          if (after) end += after[0].length;
          ranges.push([tm.index, end]);
        }
      }
      for (let ri = ranges.length - 1; ri >= 0; ri--) {
        cleanResponse = cleanResponse.slice(0, ranges[ri][0]) + cleanResponse.slice(ranges[ri][1]);
      }
    }
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

    // Sync project path from frontend context (survives server restarts)
    if (context?.projectPath) {
      mcpToolServer.projectPath = context.projectPath;
      ctx.currentProjectPath = context.projectPath;
    }

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
        return { success: false, error: 'Model is still loading — please wait and try again' };
      }
    }

    const hwContextSize = modelStatus.modelInfo?.contextSize || 32768;

    // Conservative token estimate: /3.2 instead of /4 to prevent context overflow
    // JSON, code, tool schemas tokenize at ~3 chars/token, not 4
    const estimateTokens = (text) => Math.ceil((text || '').length / 3.2);

    // ModelProfile-driven budgeting
    const modelTier = llmEngine.getModelTier();
    const modelProfile = modelTier.profile;
    const isSmallLocalModel = modelTier.paramSize > 0 && modelTier.paramSize <= 4;

    const totalCtx = Math.min(hwContextSize, modelProfile.context.effectiveContextSize);
    const actualSystemPrompt = llmEngine._getActiveSystemPrompt();
    const toolSchemaTokenEstimate = (modelProfile.generation?.maxToolsPerTurn ?? 0) * 55;
    const sysPromptReserve = estimateTokens(actualSystemPrompt) + 50 + toolSchemaTokenEstimate;
    console.log(`[AI Chat] Profile: ${modelProfile._meta.profileSource} | ctx=${totalCtx} (hw=${hwContextSize}) | sysReserve=${sysPromptReserve}`);

    // Guard: if system prompt + tool schemas exceed available context, fall back to compact preamble
    let usedCompactFallback = false;
    if (sysPromptReserve >= totalCtx * 0.9) {
      const compactPrompt = llmEngine._getCompactSystemPrompt();
      const compactReserve = estimateTokens(compactPrompt) + 50 + toolSchemaTokenEstimate;
      if (compactReserve < totalCtx * 0.9) {
        console.log(`[AI Chat] sysReserve (${sysPromptReserve}) exceeds ctx (${totalCtx}), switching to compact preamble (reserve=${compactReserve})`);
        // Reset session with compact prompt
        try { await llmEngine.resetSession(true); } catch (_) {}
        usedCompactFallback = true;
      } else {
        // Even compact preamble doesn't fit — inform user
        console.error(`[AI Chat] FATAL: Even compact preamble (${compactReserve} tokens) exceeds context (${totalCtx}). Cannot generate.`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('llm-response-chunk', {
            text: `\n\n**Error:** This model's context window (${totalCtx} tokens) is too small for tool-assisted generation. The system prompt alone requires ~${compactReserve} tokens. Please load a model with a larger context window, or use Cloud AI.`,
            done: true,
          });
        }
        return { success: false, error: `Context window too small (${totalCtx} tokens) for tool-assisted generation` };
      }
    }
    console.log(`[AI Chat] Model: ${modelTier.family} (${modelTier.paramLabel} ${modelTier.family}) \u2014 tools=${modelProfile.generation?.maxToolsPerTurn ?? 0}, grammar=${modelProfile.generation?.grammarConstrained ? 'strict' : 'limited'}`);

    const maxResponseTokens = Math.min(
      Math.floor(totalCtx * modelProfile.context.responseReservePct),
      modelProfile.context.maxResponseTokens
    );
    let maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);

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

      // Memory context (project facts, code patterns) — belongs in system prompt, not user message
      const memoryContext = memoryStore.getContextPrompt();
      if (memoryContext) appendIfBudget('\n' + memoryContext + '\n');

      // Long-term memory — cross-session relevant memories
      if (longTermMemory) {
        const ltmBudget = Math.floor(tokenBudget * 0.08); // 8% of remaining budget
        const ltmBlock = longTermMemory.getRelevantMemories(message, ltmBudget);
        if (ltmBlock) appendIfBudget('\n' + ltmBlock + '\n');
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

      // Memory context is injected into system prompt (buildStaticPrompt), not user message

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
          appendIfBudget('## Relevant Code from Project\n\n');
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

    const summarizer = new ConversationSummarizer();
    summarizer.setGoal(message);
    summarizer.setDigestBuilder(buildFileStructureDigest);

    const rollingSummary = new RollingSummary();
    rollingSummary.setGoal(message);

    // ── Long-Term Memory (Phase 4) — cross-session memory injection & extraction ──
    // MUST be initialized before buildStaticPrompt() which references it
    const longTermMemory = new LongTermMemory();
    try { longTermMemory.initialize(context?.projectPath); } catch (e) {
      console.warn('[AI Chat] Long-term memory init failed:', e.message);
    }

    let basePrompt = buildStaticPrompt();
    // Correct sysPromptReserve after building the actual static prompt — the initial
    // estimate (toolCount×55) underestimates the real formatted prompt size. Measure
    // actual size and adjust maxPromptTokens to prevent budget starvation.
    {
      const actualStaticTokens = estimateTokens(basePrompt);
      if (actualStaticTokens > sysPromptReserve) {
        const corrected = Math.max(totalCtx - actualStaticTokens - maxResponseTokens, 256);
        console.log(`[AI Chat] sysReserve corrected ${sysPromptReserve}→${actualStaticTokens} tokens (+${actualStaticTokens - sysPromptReserve}). maxPromptTokens ${maxPromptTokens}→${corrected}`);
        maxPromptTokens = corrected;
      }
    }
    let allToolResults = [];
    let gatheredWebData = [];
    let fullResponseText = '';
    let displayResponseText = '';
    let iteration = 0;
    let recentToolCalls = [];
    const writeFileHistory = {};
    let _pendingDroppedFilePaths = [];
    const toolFailCounts = {};
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
    let _contCharSizes = []; // Track char counts for pattern detection
    let _pendingPartialBlock = null;
    let lastIterationResponse = '';
    let nonContextRetries = 0;
    let iterationDisplayStartLen = 0; // Where the current iteration's display text starts
    let _incompleteFileLastLines = {}; // Track line counts for no-progress detection (BUG 8/18)
    let _incompleteFileStallCount = 0; // Consecutive iterations with no line growth
    let _cycleRecoveryAttempted = false; // Track if cycle recovery was already tried
    const executionState = new ExecutionState();

    // ── Session Store (Phase 3) — persistent session state for crash recovery ──
    const sessionBasePath = path.join(ctx.userDataPath || require('electron').app.getPath('userData'), 'sessions');
    const sessionStore = new SessionStore(sessionBasePath);
    const sessionId = `${Date.now()}_${message.substring(0, 30).replace(/[^a-z0-9]/gi, '')}`;
    const recovered = sessionStore.initialize(sessionId);
    if (!recovered) {
      // Check for crash recovery from recent session
      // Only recover if message key matches — prevents cross-task session contamination
      const recoverable = SessionStore.findRecoverableSession(sessionBasePath);
      const currentMsgKey = message.substring(0, 30).replace(/[^a-z0-9]/gi, '');
      const recoveredMsgKey = (recoverable?.sessionId || '').replace(/^\d+_/, '');
      if (recoverable?.hasRollingSummary && recoveredMsgKey === currentMsgKey) {
        const recoveredSummary = sessionStore.initialize(recoverable.sessionId)
          ? sessionStore.loadRollingSummary(RollingSummary)
          : null;
        if (recoveredSummary) {
          // Merge recovered state into current rolling summary
          rollingSummary._completedWork = recoveredSummary._completedWork;
          rollingSummary._fileState = recoveredSummary._fileState;
          rollingSummary._userCorrections = recoveredSummary._userCorrections;
          rollingSummary._keyDecisions = recoveredSummary._keyDecisions;
          rollingSummary._currentPlan = recoveredSummary._currentPlan;
          rollingSummary._rotationCount = recoveredSummary._rotationCount;
          rollingSummary._fullResults = recoveredSummary._fullResults || [];
          console.log(`[AI Chat] Recovered session state: ${recoveredSummary._completedWork.length} tool calls, ${recoveredSummary._rotationCount} rotations`);
        }
      }
    }
    // Clean up old sessions (async, non-blocking)
    try { sessionStore.cleanup(); } catch (_) {}

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

    // Track chatHistory size before agentic loop — used for post-loop compaction
    const chatHistoryPreLoopLen = llmEngine.chatHistory ? llmEngine.chatHistory.length : 0;

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

      // ── Pre-generation context check ──
      // Run for ALL iterations, not just > 1, to catch critically high context on first turn
      // This prevents stalls when context is near full from conversation history
      {
        const preGenResult = preGenerationContextCheck({
          llmEngine, totalCtx, currentPrompt, fullResponseText,
          allToolResults, contextRotations, MAX_CONTEXT_ROTATIONS: MAX_CONTEXT_ROTATIONS,
          summarizer, buildStaticPrompt, buildDynamicContext, maxPromptTokens, maxResponseTokens, message,
          continuationCount, _pendingPartialBlock, mcpToolServer,
        });
        if (preGenResult) {
          if (preGenResult.shouldContinue) {
            currentPrompt = preGenResult.prompt;
            sessionJustRotated = preGenResult.rotated || false;
            if (preGenResult.rotated) {
              contextRotations++;
              lastConvSummary = preGenResult.summary || '';
              // Reset LLM session so stale pruned chatHistory doesn't confuse the model.
              // Without this, Phase 3 compaction leaves 2 chatHistory entries with old
              // operator content → model continues from wrong position after rotation.
              try { await llmEngine.resetSession(true); } catch (_) {}
              try { await ensureLlmChat(llmEngine, getNodeLlamaCppPath); } catch (_) {}
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
          nativeFunctions = LLMEngine.convertToolsToFunctions(toolDefs, null);
          console.log(`[AI Chat] Native function calling with ${Object.keys(nativeFunctions).length} functions (ctx=${totalCtx})`);
        } catch (e) {
          console.warn(`[AI Chat] Failed to build native functions: ${e.message}`);
          nativeFunctions = null;
        }
      }

      // ── Transactional Checkpoint ──
      const checkpoint = {
        chatHistory: llmEngine.chatHistory ? llmEngine.chatHistory.map(h => {
          if (h.type === 'model' && Array.isArray(h.response)) {
            return { ...h, response: [...h.response] };
          }
          return { ...h };
        }) : null,
        lastEvaluation: llmEngine.lastEvaluation,
      };

      // Text-mode tool bubble state
      let _tb = '';
      let _tIdx = 9000;
      let _tStart = -1;
      let _tEnd = -1;
      let _tName = null;
      if (_pendingPartialBlock) {
        const seedMatch = _pendingPartialBlock.match(/\{\s*"tool"\s*:\s*"([^"]+)"/);
        if (seedMatch) { _tStart = 0; _tEnd = -1; _tName = seedMatch[1]; }
      }

      let result;
      try {
        // Only send llm-iteration-begin on first pass of each iteration —
        // continuation passes reuse the same logical iteration so the frontend's
        // iterationStartOffsetRef stays at the iteration start.
        if (mainWindow && continuationCount === 0) mainWindow.webContents.send('llm-iteration-begin');
        // Track iteration display start offset (only reset for new iterations, not continuations).
        if (continuationCount === 0) iterationDisplayStartLen = displayResponseText.length;

        const localTokenBatcher = createIpcTokenBatcher(mainWindow, 'llm-token', () => !isStale(), { flushIntervalMs: 25, maxBufferChars: 2048 });
        const localThinkingBatcher = createIpcTokenBatcher(mainWindow, 'llm-thinking-token', () => !isStale(), { flushIntervalMs: 35, maxBufferChars: 2048 });

        // Throttled context usage updates during streaming (every 500ms)
        let _streamingResponseLen = 0;
        let _streamingTailBuf = ''; // last ~100 chars for log preview
        let _lastStreamLogTime = Date.now();
        const promptLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
        const _contextUsageInterval = mainWindow ? setInterval(() => {
          try {
            let used = 0;
            try { if (llmEngine.sequence?.nextTokenIndex) used = llmEngine.sequence.nextTokenIndex; } catch (_) {}
            if (!used) used = Math.ceil((promptLen + _streamingResponseLen) / 4);
            mainWindow.webContents.send('context-usage', { used, total: totalCtx });
            // Periodic streaming progress log (every 30s) for debugging
            const now = Date.now();
            if (now - _lastStreamLogTime >= 30000) {
              // Include content preview: last 80 chars of what was generated
              const preview = _streamingTailBuf.slice(-80).replace(/\n/g, '\\n');
              console.log(`[AI Chat] Streaming progress: ${_streamingResponseLen} chars, ~${used}/${totalCtx} ctx tokens (${Math.round(used/totalCtx*100)}%) | tail: "${preview}"`);
              _lastStreamLogTime = now;
            }
          } catch (_) {}
        }, 500) : null;

        try {
          if (nativeFunctions && Object.keys(nativeFunctions).length > 0) {
            // ── NATIVE FUNCTION CALLING PATH ──
            const nativeResult = await llmEngine.generateWithFunctions(
              currentPrompt, nativeFunctions,
              { ...(context?.params || {}), maxTokens: effectiveMaxTokens, replaceLastUser: iteration > 0 && continuationCount === 0 },
              (token) => { if (isStale()) { llmEngine.cancelGeneration('user'); return; } _streamingResponseLen += token.length; _streamingTailBuf = (_streamingTailBuf + token).slice(-100); localTokenBatcher.push(token); },
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
              replaceLastUser: iteration > 0 && continuationCount === 0,
            }, (token) => {
              if (isStale()) { llmEngine.cancelGeneration('user'); return; }
              _streamingResponseLen += token.length;
              _streamingTailBuf = (_streamingTailBuf + token).slice(-100);

              // Live tool-call bubble
              _tb += token;
              const wasToolDetected = _tStart !== -1;
              if (_tStart === -1) {
                const m = _tb.match(/\{\s*"tool"\s*:\s*"([^"]+)"/);
                if (m) { _tStart = m.index; _tName = m[1]; _tEnd = -1; }
              }

              // Only stream to display if no tool-call JSON detected yet.
              // Once tool JSON starts, tokens go to the tool-generating bubble
              // (below) but NOT to the chat display — prevents raw JSON from
              // appearing in the chat stream and eliminates the need for
              // post-generation llm-replace-last cleanup.
              if (!wasToolDetected && _tStart === -1) {
                localTokenBatcher.push(token);
              }
              // Detect when tool JSON ends (balanced braces) to avoid including post-JSON text
              if (_tStart !== -1 && _tEnd === -1) {
                const raw = _tb.slice(_tStart);
                let depth = 0, idx = 0;
                for (; idx < raw.length; idx++) {
                  if (raw[idx] === '{') depth++;
                  else if (raw[idx] === '}') depth--;
                  if (depth === 0 && idx > 0) { _tEnd = _tStart + idx + 1; break; }
                }
              }
              if (_tStart !== -1 && _tName && mainWindow && !mainWindow.isDestroyed()) {
                // Only include up to the end of the JSON (or all if not yet closed)
                const endPos = _tEnd !== -1 ? _tEnd : _tb.length;
                const raw = _tb.slice(_tStart, endPos);
                // Smart truncation: ensure "content" key is always visible for preview
                let paramsText;
                if (raw.length <= 8000) {
                  paramsText = raw;
                } else {
                  // Keep first 1000 chars (covers tool name, filePath) + last 4000 chars (covers content tail)
                  const contentIdx = raw.indexOf('"content"');
                  if (contentIdx !== -1 && contentIdx < raw.length) {
                    // Keep from content key onward (up to 6000 chars) plus the header
                    paramsText = raw.slice(0, Math.min(contentIdx + 6000, raw.length));
                  } else {
                    paramsText = raw.slice(0, 4000);
                  }
                }
                mainWindow.webContents.send('llm-tool-generating', {
                  callIndex: _tIdx, functionName: _tName, paramsText, done: false,
                  // Line count from untruncated content
                  lineCount: (() => {
                    const cIdx = raw.indexOf('"content"');
                    if (cIdx === -1) return 0;
                    const afterContent = raw.slice(cIdx);
                    return (afterContent.match(/\\n/g) || []).length + 1;
                  })(),
                });
              }
            }, (thinkToken) => {
              if (isStale()) { llmEngine.cancelGeneration('user'); return; }
              localThinkingBatcher.push(thinkToken);
            });
          }
        } finally {
          if (_contextUsageInterval) clearInterval(_contextUsageInterval);
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

          // Continuation-overflow: preserve partial content and provide context
          // Generic solution: works for file writing, conversations, reading, browsing, etc.
          if (continuationCount > 0 && summarizer.completedSteps.length === 0) {
            // Preserve partial output for context instead of wiping it
            const partialOutput = fullResponseText.slice(-Math.min(fullResponseText.length, 2000));
            fullResponseText = '';  // Clear for rotation, but we have partialOutput for context
            continuationCount = 0;
            overflowResponseBudgetReduced = true;
            contextRotations++;
            try { await llmEngine.resetSession(true); } catch (_) {}
            sessionJustRotated = true;
            
            // Generate a generic summary of what was happening (uses recorded plans/actions)
            const actionsSummary = summarizer.generateQuickSummary(mcpToolServer?._todos);
            
            // Build generic continuation prompt that works for ANY task type
            const partialHint = partialOutput.trim() 
              ? `\n\n## CONTINUE FROM HERE\n---\n${partialOutput.substring(Math.max(0, partialOutput.length - 1500))}\n---`
              : '';
            
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + 
                (actionsSummary ? '\n\n' + actionsSummary : '') +
                '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                executionState.getSummary() +
                partialHint +
                '\n\n**Context rotated. Continue the task from where you left off.**\n' + message,
            };
            rollingSummary.markRotation();
            sessionStore.saveRollingSummary(rollingSummary);
            sessionStore.flush();
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

            // Only send minimal notification to thinking panel — NOT the full summary
            // The summary (with ## COMPLETED WORK, ## INSTRUCTION, etc.) goes into the model's prompt,
            // NOT into the reasoning dropdown. The reasoning dropdown should only show model thinking.
            if (mainWindow) {
              mainWindow.webContents.send('llm-thinking-token', '\n[Context rotated — continuing task]\n');
            }

            const partial = fullResponseText.trim().length > 0 ? fullResponseText.substring(Math.max(0, fullResponseText.length - 1500)) : '';
            
            const incrementalHint = summarizer.incrementalTask
              ? `\n**INCREMENTAL TASK: ${summarizer.incrementalTask.current}/${summarizer.incrementalTask.target} ${summarizer.incrementalTask.type} completed.**`
              : '';
            const fileProgressHint = buildFileProgressHint(summarizer.fileProgress);

            const hint = partial
              ? `\n\n## CONTINUE FROM HERE\n---\n${partial}\n---` +
                incrementalHint + fileProgressHint +
                `\n\nContext rotated. Continue generating content from where you left off. Do NOT output any acknowledgment, recap, or summary of prior work — immediately continue producing code/content.`
              : `\nContext was rotated. The user request is: ${message.substring(0, 300)}` +
                incrementalHint + fileProgressHint +
                `\n\nContinue the task. Do NOT output any acknowledgment or summary — immediately make forward progress.`;

            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: buildDynamicContext() + '\n' + convSummary +
                '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                executionState.getSummary() + hint,
            };
            sessionJustRotated = true;
            lastConvSummary = convSummary;
            rollingSummary.markRotation();
            sessionStore.saveRollingSummary(rollingSummary);
            sessionStore.flush();
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

        // Fatal errors — attempt recovery for disposal errors before giving up
        const errLower = (genError.message || '').toLowerCase();
        const isDisposed = ['object is disposed', 'model is disposed'].some(pat => errLower.includes(pat));
        const isFatalNoRecovery = errLower.includes('model not loaded');

        if (isDisposed && !isFatalNoRecovery) {
          console.log('[AI Chat] Sequence disposed — attempting recovery via resetSession');
          try {
            await Promise.race([
              llmEngine.resetSession(true),
              new Promise((_, rej) => setTimeout(() => rej(new Error('resetSession timeout')), 15000)),
            ]);
            console.log('[AI Chat] Recovery after disposal succeeded — continuing loop');
            sessionJustRotated = true;
            contextRotations++;
            summarizer.markRotation();
            lastConvSummary = summarizer.generateQuickSummary(mcpToolServer?._todos);
            currentPrompt = {
              systemContext: buildStaticPrompt(),
              userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) +
                '\n' + (lastConvSummary || '') +
                '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                executionState.getSummary() +
                '\n\n**Context was recovered after an error. Continue the task.**\n' + message,
            };
            rollingSummary.markRotation();
            continue;
          } catch (recoveryErr) {
            console.error('[AI Chat] Recovery via resetSession failed:', recoveryErr.message, '— attempting full context recreation');
            // Second attempt: dispose everything and recreate context from scratch
            try {
              if (llmEngine.chat) { try { llmEngine.chat.dispose?.(); } catch {} llmEngine.chat = null; }
              if (llmEngine.sequence) { try { llmEngine.sequence.dispose?.(); } catch {} llmEngine.sequence = null; }
              if (llmEngine.context) { try { llmEngine.context.dispose?.(); } catch {} llmEngine.context = null; }
              // Force resetSession to recreate context (it checks for null context)
              await Promise.race([
                llmEngine.resetSession(true),
                new Promise((_, rej) => setTimeout(() => rej(new Error('full recreation timeout')), 20000)),
              ]);
              console.log('[AI Chat] Full context recreation succeeded — continuing loop');
              sessionJustRotated = true;
              contextRotations++;
              summarizer.markRotation();
              lastConvSummary = summarizer.generateQuickSummary(mcpToolServer?._todos);
              currentPrompt = {
                systemContext: buildStaticPrompt(),
                userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) +
                  '\n' + (lastConvSummary || '') +
                  '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                  executionState.getSummary() +
                  '\n\n**Context was fully recovered. Continue the task.**\n' + message,
              };
              rollingSummary.markRotation();
              continue;
            } catch (recreateErr) {
              console.error('[AI Chat] Full context recreation also failed:', recreateErr.message);
            }
          }
        }

        if (isFatalNoRecovery || isDisposed) {
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
        try { if (llmEngine.sequence?.nextTokenIndex) used = llmEngine.sequence.nextTokenIndex; } catch (_) {}
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

      // ── Overlap de-duplication for ALL continuation passes ──
      // Detect if model repeated the tail we sent as context.
      // Applied BEFORE accumulating to fullResponseText/displayResponseText
      // so duplicate content never enters the display pipeline.
      let _overlapLen = 0;
      if (_pendingPartialBlock && continuationCount > 0) {
        // Pass 1: Exact character-level overlap (fast, precise)
        const maxCheck = Math.min(_pendingPartialBlock.length, responseText.length, 2000);
        for (let len = maxCheck; len >= 20; len--) {
          const suffix = _pendingPartialBlock.slice(-len);
          if (responseText.startsWith(suffix)) { _overlapLen = len; break; }
        }
        // Pass 2: Line-level overlap (catches near-duplicates with whitespace differences)
        if (_overlapLen === 0) {
          const prevLines = _pendingPartialBlock.split('\n');
          const newLines = responseText.split('\n');
          const tailCheck = Math.min(prevLines.length, 50);
          for (let tailSize = tailCheck; tailSize >= 3; tailSize--) {
            const prevTail = prevLines.slice(-tailSize);
            let match = true;
            for (let j = 0; j < tailSize && j < newLines.length; j++) {
              if (prevTail[j].trimEnd() !== newLines[j].trimEnd()) { match = false; break; }
            }
            if (match && tailSize <= newLines.length) {
              // Calculate byte offset for the matched line count
              _overlapLen = newLines.slice(0, tailSize).join('\n').length;
              if (tailSize < newLines.length) _overlapLen++; // account for the newline
              console.log(`[AI Chat] Continuation line-level overlap: ${tailSize} lines (${_overlapLen} chars)`);
              break;
            }
          }
        }
        if (_overlapLen > 0 && _overlapLen === maxCheck) {
          // Exact match logged already
        } else if (_overlapLen > 0) {
          console.log(`[AI Chat] Continuation overlap: removed ${_overlapLen} duplicate chars`);
        }
      }
      const newContent = _overlapLen > 0 ? responseText.slice(_overlapLen) : responseText;

      fullResponseText += newContent;

      // Strip tool fences from display copy — but preserve legitimate ```json code blocks
      // Only strip ```tool/```tool_call fences (always tool calls) and ```json fences
      // that actually contain tool call JSON ({"tool": "..."}). This prevents stripping
      // legitimate JSON code examples (package.json, API responses, configs) which caused
      // line count regressions (e.g. 210 → 160 lines when Express.js tutorials were stripped).
      let displayChunk = newContent
        .replace(/\n?```(?:tool_call|tool)\b[\s\S]*?```\n?/g, '')
        .replace(/\n?```(?:tool_call|tool)\b[\s\S]*$/g, '')
        .replace(/\n?```json\b([\s\S]*?)```\n?/g, (match, content) => {
          return /"\s*tool\s*"\s*:\s*"/.test(content) ? '' : match;
        })
        .replace(/\n?```json\b([\s\S]*)$/g, (match, content) => {
          return /"\s*tool\s*"\s*:\s*"/.test(content) ? '' : match;
        });
      // Strip XML tool_call tags (Qwen3 and other models use this format)
      displayChunk = displayChunk.replace(/<tool_calls?>\s*[\s\S]*?<\/tool_calls?>/gi, '');
      displayChunk = displayChunk.replace(/<\/?tool_calls?>/gi, '');
      // Strip inline JSON tool calls with proper brace matching (handles nested objects)
      // Only match objects with "tool" key — "name" is too common in generated code
      {
        const toolPattern = /\[?\s*\{\s*"tool"\s*:\s*"/g;
        let tm;
        const ranges = [];
        while ((tm = toolPattern.exec(displayChunk)) !== null) {
          const braceStart = displayChunk.indexOf('{', tm.index);
          let depth = 1, ci = braceStart + 1;
          while (ci < displayChunk.length && depth > 0) {
            if (displayChunk[ci] === '{') depth++;
            else if (displayChunk[ci] === '}') depth--;
            ci++;
          }
          if (depth === 0) {
            let end = ci;
            const after = displayChunk.slice(end).match(/^\s*\]?/);
            if (after) end += after[0].length;
            ranges.push([tm.index, end]);
          }
        }
        // Remove matched ranges in reverse to preserve indices
        for (let ri = ranges.length - 1; ri >= 0; ri--) {
          displayChunk = displayChunk.slice(0, ranges[ri][0]) + displayChunk.slice(ranges[ri][1]);
        }
      }
      displayChunk = displayChunk.replace(/\n{3,}/g, '\n\n');
      if (continuationCount > 0) {
        displayChunk = displayChunk.replace(/\[(?:Continue your response|You were generating a tool call)[\s\S]*?\]/gi, '');
      }
      // Save length before adding this iteration's text (for removing reasoning routed to thinking panel)
      const priorDisplayLen = displayResponseText.length;
      displayResponseText += displayChunk;

      // Correct UI stream buffer: the overlapping tokens were already streamed
      // during generation. Replace the current iteration's display with the
      // de-duplicated content instead of resetting (avoids visual flash/jarring).
      // Correct UI stream buffer: send the full accumulated display for this iteration
      // so it grows monotonically across continuation passes.
      if (_overlapLen > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('llm-replace-last', displayResponseText.slice(iterationDisplayStartLen));
      }

      // ── SEAMLESS CONTINUATION — stitch for MCP tool detection ──
      let _stitchedForMcp;
      if (_pendingPartialBlock) {
        _stitchedForMcp = _pendingPartialBlock + responseText.slice(_overlapLen);

        // Fence-aware cleanup: if stitching produced duplicate ```json fences,
        // keep only the LAST complete one (the continuation's fresh attempt)
        const fencePattern = /```(?:json|tool_call|tool)\b/g;
        const fencePositions = [];
        let fm;
        while ((fm = fencePattern.exec(_stitchedForMcp)) !== null) fencePositions.push(fm.index);
        if (fencePositions.length >= 2) {
          // Multiple fence opens — the first is from the truncated pass, the second from continuation
          // Keep from the last fence open onward (it has the complete JSON)
          const lastFenceStart = fencePositions[fencePositions.length - 1];
          const textBeforeFences = _stitchedForMcp.slice(0, fencePositions[0]);
          _stitchedForMcp = textBeforeFences + _stitchedForMcp.slice(lastFenceStart);
          console.log(`[AI Chat] Fence dedup: removed ${fencePositions.length - 1} duplicate fence(s)`);
        }
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
          try { if (llmEngine.sequence?.nextTokenIndex) contUsed = llmEngine.sequence.nextTokenIndex; } catch (_) {}
          if (!contUsed) {
            const pLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
            contUsed = Math.ceil((pLen + fullResponseText.length) / 4);
          }
          contContextPct = contUsed / totalCtx;
        } catch (_) {}

        const budgetLimit = _hasUnclosedToolFence ? 0.92 : 0.70;
        if (contContextPct > budgetLimit) {
          // Context budget exceeded — trigger rotation instead of aborting
          // This allows large content generation (HTML, code files) to complete
          console.log(`[AI Chat] Continuation budget rotation: context at ${Math.round(contContextPct * 100)}% (limit=${Math.round(budgetLimit * 100)}%)`);
          continuationCount = 0;
          
          // Attempt context rotation to continue the task
          if (contextRotations < MAX_CONTEXT_ROTATIONS) {
            console.log(`[AI Chat] Budget-triggered rotation (${contextRotations + 1}/${MAX_CONTEXT_ROTATIONS})`);
            contextRotations++;
            try {
              summarizer.markRotation();
              const convSummary = summarizer.generateSummary({
                maxTokens: Math.min(Math.floor(totalCtx * 0.25), 3000),
                activeTodos: mcpToolServer?._todos || [],
              });
              
              // Store partial output for context
              const partialOutput = fullResponseText.slice(-Math.min(fullResponseText.length, 2000));
              await llmEngine.resetSession(true);
              await ensureLlmChat(llmEngine, getNodeLlamaCppPath);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('llm-thinking-token', '\n[Context rotated to continue generation]\n');
              }
              
              // Build continuation prompt with summary and partial output
              const incrementalHint = summarizer.incrementalTask
                ? `\n**INCREMENTAL TASK: ${summarizer.incrementalTask.current}/${summarizer.incrementalTask.target} ${summarizer.incrementalTask.type} completed.**`
                : '';
              const fileProgressHint = buildFileProgressHint(summarizer.fileProgress);
              
              currentPrompt = {
                systemContext: buildStaticPrompt(),
                userMessage: buildDynamicContext() + '\n\n' + convSummary +
                  '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                  executionState.getSummary() +
                  `\n\n## CONTINUE FROM HERE\n---\n${partialOutput}\n---` +
                  incrementalHint + fileProgressHint +
                  `\n\nContext rotated. Continue generating content from where you left off. Do NOT output any acknowledgment, recap, or summary — immediately continue producing code/content.`,
              };
              sessionJustRotated = true;
              rollingSummary.markRotation();
              sessionStore.saveRollingSummary(rollingSummary);
              sessionStore.flush();
              continue;
            } catch (rotErr) {
              console.error('[AI Chat] Budget-triggered rotation failed:', rotErr.message);
            }
          }
          
          // Rotation failed or exhausted — try salvage as fallback
          if (_hasUnclosedToolFence && _stitchedForMcp) {
            const salvageResult = salvagePartialToolCall(_stitchedForMcp, _fenceIdx);
            if (salvageResult) {
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
          } else if (_lastContText.length > 0 && responseText.length > 0) {
            // Similarity-based detection: if >80% of chars overlap, count as repeat
            const a = responseText.trim(), b = _lastContText.trim();
            const shorter = Math.min(a.length, b.length), longer = Math.max(a.length, b.length);
            if (shorter > 50 && longer > 0) {
              // Simple char overlap ratio: count matching chars at same positions
              let matches = 0;
              for (let ci = 0; ci < shorter; ci++) { if (a[ci] === b[ci]) matches++; }
              const similarity = matches / longer;
              if (similarity > 0.8) {
                _contRepeatCount++;
                console.log(`[AI Chat] Near-identical continuation detected (similarity=${(similarity * 100).toFixed(1)}%)`);
              } else {
                _contRepeatCount = 0;
              }
            } else {
              _contRepeatCount = 0;
            }
          } else {
            _contRepeatCount = 0;
          }
          _lastContText = responseText;

          // Track output sizes for pattern detection (Step 9)
          _contCharSizes.push(responseText.length);

          // Content-overlap detection: check if new response recycles content already in fullResponseText
          // This catches the pattern where model repeats chapter bodies with incrementing headers
          if (_contRepeatCount < 2 && fullResponseText.length > 500 && responseText.length > 200) {
            const priorText = fullResponseText.slice(0, fullResponseText.length - responseText.length);
            if (priorText.length > 200) {
              // Context-aware overlap detection: file content has natural boilerplate
              // (HTML tags, CSS declarations, repeated style= attributes) that triggers
              // false positives with small chunks. Use larger chunks + higher threshold
              // for file content, moderate settings for non-file content.
              const isFileContent = /\\n|\\"|write_file|filePath|"content"\s*:/.test(responseText.substring(0, 500));
              const CHUNK_SIZE = isFileContent ? 300 : 200;
              const THRESHOLD = isFileContent ? 0.75 : 0.60;
              const SAMPLE_COUNT = 8;
              const step = Math.max(1, Math.floor((responseText.length - CHUNK_SIZE) / SAMPLE_COUNT));
              let foundCount = 0;
              let totalSamples = 0;
              for (let si = 0; si < responseText.length - CHUNK_SIZE && totalSamples < SAMPLE_COUNT; si += step) {
                totalSamples++;
                const chunk = responseText.slice(si, si + CHUNK_SIZE);
                if (priorText.includes(chunk)) foundCount++;
              }
              if (totalSamples > 0 && foundCount / totalSamples >= THRESHOLD) {
                _contRepeatCount += 2; // immediately trigger abort threshold
                console.log(`[AI Chat] Content-overlap detected: ${foundCount}/${totalSamples} chunks (threshold ${THRESHOLD}, chunkSize ${CHUNK_SIZE}) in prior output`);
              }
            }
          }
          // Hard total accumulated char limit: stop runaway continuation
          // Increased from 50K to allow large file generation — context rotation will handle memory
          const MAX_CONTINUATION_CHARS = 500000; // 500K chars (~125K lines of code)
          let _contAbortReason = '';
          // ALWAYS attempt rotation on any abort reason if rotations available
          let _contShouldRotate = contextRotations < MAX_CONTEXT_ROTATIONS;
          if (fullResponseText.length > MAX_CONTINUATION_CHARS) {
            _contAbortReason = `total output exceeds ${MAX_CONTINUATION_CHARS} chars — rotating context`;
          } else if (_contLowProgressCount >= 3) {
            _contAbortReason = 'no forward progress — rotating context to recover';
          } else if (_contRepeatCount >= 2) {
            _contAbortReason = 'repeated/near-identical content — rotating context';
          }

          // Forward-progress scoring: after 5 passes, if avg chars per pass varies <10% from first pass, abort
          if (!_contAbortReason && _contCharSizes.length >= 5) {
            const firstSize = _contCharSizes[0];
            const avgSize = _contCharSizes.reduce((s, v) => s + v, 0) / _contCharSizes.length;
            if (firstSize > 0 && Math.abs(avgSize - firstSize) / firstSize < 0.10) {
              _contAbortReason = `uniform output size (~${Math.round(avgSize)} chars/pass for ${_contCharSizes.length} passes)`;
            }
          }

          if (_contAbortReason) {
            console.log(`[AI Chat] Continuation aborted: ${_contAbortReason}`);
            continuationCount = 0;
            _contLowProgressCount = 0;
            _contRepeatCount = 0;
            _contCharSizes = [];
            
            // ALWAYS attempt rotation to recover and continue the task
            if (_contShouldRotate && contextRotations < MAX_CONTEXT_ROTATIONS) {
              console.log(`[AI Chat] Large-output rotation triggered (${contextRotations + 1}/${MAX_CONTEXT_ROTATIONS})`);
              contextRotations++;
              try {
                // Generate full summary with file progress tracking
                summarizer.markRotation();
                const convSummary = summarizer.generateSummary({
                  maxTokens: Math.min(Math.floor(totalCtx * 0.25), 3000),
                  activeTodos: mcpToolServer?._todos || [],
                });

                // Store partial output for context
                const partialOutput = fullResponseText.slice(-Math.min(fullResponseText.length, 2000));
                await llmEngine.resetSession(true);
                await ensureLlmChat(llmEngine, getNodeLlamaCppPath);
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('llm-thinking-token', '\n[Context rotated for large output]\n');
                }

                const incrementalHint = summarizer.incrementalTask
                  ? `\n**INCREMENTAL TASK: ${summarizer.incrementalTask.current}/${summarizer.incrementalTask.target} ${summarizer.incrementalTask.type} completed.**`
                  : '';
                const fileProgressHint = buildFileProgressHint(summarizer.fileProgress);

                currentPrompt = {
                  systemContext: buildStaticPrompt(),
                  userMessage: buildDynamicContext() + '\n\n' + convSummary +
                    '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                    executionState.getSummary() +
                    `\n\n## CONTINUE FROM HERE\n---\n${partialOutput}\n---` +
                    incrementalHint + fileProgressHint +
                    `\n\nContext rotated. Continue generating content from where you left off. Do NOT output any acknowledgment, recap, or summary — immediately continue producing code/content.`,
                };
                sessionJustRotated = true;
                rollingSummary.markRotation();
                sessionStore.saveRollingSummary(rollingSummary);
                sessionStore.flush();
                continue;
              } catch (rotErr) {
                console.error('[AI Chat] Large-output rotation failed:', rotErr.message);
              }
            }
            // Fall through to normal processing
          } else {
            const truncReason = _hasUnclosedToolFence ? 'unclosed fence' : 'maxTokens';
            console.log(`[AI Chat] Seamless continuation ${continuationCount}/50 — ${truncReason} (${responseText.length} chars this pass, ${fullResponseText.length} total)`);
            iteration--;

            // Cap effectiveMaxTokens on continuation passes to avoid overflowing context.
            // Use actual KV cache position (nextTokenIndex) instead of char estimate — char
            // estimate is off by ~3-4x at high context, allowing fatal C++ context shift at 99%+.
            let _seqUsedForCap = 0;
            try { if (llmEngine.sequence?.nextTokenIndex) _seqUsedForCap = llmEngine.sequence.nextTokenIndex; } catch (_) {}
            if (!_seqUsedForCap) _seqUsedForCap = Math.ceil(((typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length)) + fullResponseText.length) / 4);
            const remainingTokens = Math.max(0, Math.floor(totalCtx * 0.88) - _seqUsedForCap);
            effectiveMaxTokens = Math.min(effectiveMaxTokens, Math.max(256, Math.floor(remainingTokens * 0.70)));

            let continuationMsg;
            // Include up to 500 chars of the original task for model context
            const taskHint = message ? `[Task: ${message.substring(0, 500)}${message.length > 500 ? '...' : ''}]\n` : '';
            // Include written-files manifest so model knows what already exists
            const writtenPaths = Object.keys(writeFileHistory).filter(k => writeFileHistory[k].count > 0);
            const fileManifest = writtenPaths.length > 0
              ? `[Files already written this turn: ${writtenPaths.join(', ')}. Do NOT overwrite these files.]\n`
              : '';
            // Dynamic tail size: scale with remaining context, clamped to [500, 3000] chars
            const maxTailChars = Math.max(500, Math.min(Math.floor(remainingTokens * 0.3 * 4), 3000));
            if (_hasUnclosedToolFence) {
              const partialFence = _stitchedForMcp.slice(_fenceIdx);

              // ── Salvage-and-Append: when a write_file or append_to_file call is
              //    truncated mid-content, salvage the partial content, write/append it
              //    to disk, then tell the model to continue with append_to_file for the
              //    remaining content. This prevents content loss during long generations. ──
              const _isWriteFile = partialFence.includes('"write_file"');
              const _isAppendFile = partialFence.includes('"append_to_file"');
              const _hasFP = /"filePath"\s*:\s*"[^"]+"/.test(partialFence);
              const _hasLongContent = /"content"\s*:\s*"[\s\S]{200,}/.test(partialFence);

              let _didSalvageAppend = false;
              if ((_isWriteFile || _isAppendFile) && _hasFP && _hasLongContent) {
                const salvaged = salvagePartialToolCall(_stitchedForMcp, _fenceIdx);
                if (salvaged) {
                  try {
                    const salvageMatch = salvaged.match(/```json\n([\s\S]*?)\n```/);
                    const salvageJson = salvageMatch ? JSON.parse(salvageMatch[1]) : null;
                    const salvagePath = salvageJson?.params?.filePath;
                    const salvageContent = salvageJson?.params?.content || '';

                    if (salvagePath && salvageContent.length >= 100) {
                      // Determine salvage tool based on original intent + truncation protection
                      // If the model intended write_file, honor that UNLESS the salvaged content
                      // is shorter than what already exists on disk — that means the model's
                      // generation was truncated mid-content and overwriting would cause regression
                      let salvageTool = _isAppendFile ? 'append_to_file' : 'write_file';
                      if (salvageTool === 'write_file') {
                        try {
                          const _absSalvPath = path.resolve(mcpToolServer.projectPath || '.', salvagePath);
                          if (fsSync.existsSync(_absSalvPath)) {
                            const existingSize = fsSync.statSync(_absSalvPath).size;
                            if (existingSize > 0 && salvageContent.length < existingSize) {
                              salvageTool = 'append_to_file';
                              console.log(`[AI Chat] Salvage: write_file→append_to_file (salvage ${salvageContent.length} chars < existing ${existingSize} chars — truncation protection)`);
                            }
                          }
                        } catch (_) {}
                      }
                      const writeResult = await mcpToolServer.executeTool(salvageTool, {
                        filePath: salvagePath,
                        content: salvageContent,
                      });
                      // For append, use fullContent (entire file) for accurate line count
                      const finalContent = (salvageTool === 'append_to_file' && writeResult?.fullContent)
                        ? writeResult.fullContent : salvageContent;
                      const lineCount = finalContent.split('\n').length;
                      console.log(`[AI Chat] Salvage-and-append: ${salvageTool === 'append_to_file' ? 'appended' : 'wrote'} ${lineCount} lines to "${salvagePath}"`);

                      // Update writeFileHistory — only for write_file, not append_to_file
                      // append_to_file is inherently incremental and should never be blocked
                      if (!writeFileHistory[salvagePath]) writeFileHistory[salvagePath] = { count: 0, maxLen: 0 };
                      if (salvageTool === 'write_file') {
                        writeFileHistory[salvagePath].count++;
                      }
                      if (finalContent.length > writeFileHistory[salvagePath].maxLen) {
                        writeFileHistory[salvagePath].maxLen = finalContent.length;
                      }

                      // Send UI events for the artifact — first executing, then results,
                      // so the frontend's completedStreamingTools picks up the code block.
                      // For append, use fullContent so the unified code block shows the entire file.
                      const salvageDisplayContent = (salvageTool === 'append_to_file' && writeResult?.fullContent)
                        ? writeResult.fullContent : salvageContent;
                      const salvageToolEntry = {
                        tool: salvageTool,
                        params: { filePath: salvagePath, content: salvageDisplayContent },
                        result: writeResult,
                      };
                      if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('mcp-executing-tools', [{ tool: salvageTool, params: { filePath: salvagePath, content: salvageDisplayContent } }]);
                        mainWindow.webContents.send('mcp-tool-results', [salvageToolEntry]);
                        // Notify file explorer that a file was created/modified
                        mainWindow.webContents.send('files-changed');
                        mainWindow.webContents.send('open-file', salvagePath);
                      }
                      // Track in allToolResults so the committed message includes this code block
                      allToolResults.push(salvageToolEntry);

                      // Track in summarizers + execution state (include content for accurate line counting)
                      try {
                        const salvageParams = { filePath: salvagePath, content: salvageContent };
                        summarizer.recordToolCall(salvageTool, salvageParams, writeResult);
                        rollingSummary.recordToolCall(salvageTool, salvageParams, writeResult, iteration);
                        rollingSummary.recordToolResult(salvageTool, salvageParams, writeResult, iteration);
                        executionState.update(salvageTool, salvageParams, writeResult, iteration);
                      } catch (_) {}

                      // Build continuation prompt with completeness detection
                      // For append, use finalContent (full file) for completeness check
                      const checkContent = finalContent;
                      const allLines = checkContent.split('\n');
                      const lastLines = allLines.slice(-10).join('\n');
                      _pendingPartialBlock = null; // switch from JSON stitching to free-form

                      // Use extracted checkFileCompleteness heuristic
                      const looksComplete = checkFileCompleteness(checkContent, salvagePath);
                      const lastCodeLine = checkContent.trimEnd().split('\n').pop().trim();

                      if (looksComplete) {
                        // File appears complete — redirect model to remaining task
                        console.log(`[AI Chat] Salvaged file "${salvagePath}" looks complete (${lineCount} lines, ends: "${lastCodeLine.substring(0, 50)}")`);
                        continuationMsg = `${taskHint}${fileManifest}[File "${salvagePath}" has been written successfully (${lineCount} lines). This file is COMPLETE — do NOT rewrite or append to it. Continue with your original task — create the remaining files that were requested. Use write_file for each new file.]`;
                      } else {
                        // File is mid-content — provide structural digest + tail for informed continuation
                        const salvageDigest = buildFileStructureDigest(salvagePath, checkContent);
                        continuationMsg = `${taskHint}${fileManifest}[File "${salvagePath}" has ${lineCount} lines so far. The file is NOT complete — more content is needed.\n${salvageDigest}\nContinue from where you left off. Do NOT redefine any selectors, functions, or tags listed above. Do NOT output any acknowledgment — immediately continue generating content.]`;
                      }

                      // Counteract iteration-- from above: salvage is a new agentic pass
                      iteration++;
                      _didSalvageAppend = true;

                      // ── Session reset after salvage-and-append ──
                      // Without this, the KV cache contains the model's own write_file
                      // call from the previous iteration. The model "sees" that output
                      // and re-generates the same file from scratch instead of continuing
                      // with append_to_file. Resetting gives the model a clean slate.
                      try {
                        await llmEngine.resetSession(true);
                        await ensureLlmChat(llmEngine, getNodeLlamaCppPath);
                        _pendingPartialBlock = null;

                        // Budget-aware post-salvage assembly — compute remaining space
                        // for userMessage after accounting for system context + response reserve
                        const _salvContTokens = estimateTokens(continuationMsg);
                        const _salvFileProgress = buildFileProgressHint(summarizer.fileProgress);
                        const _salvExecTokens = estimateTokens(executionState.getSummary()) + estimateTokens(_salvFileProgress);
                        // Dynamic context gets 25% of prompt budget, summaries get the rest
                        const _salvDynBudget = Math.max(Math.floor(maxPromptTokens * 0.25), 200);
                        const _salvSummBudget = Math.max(
                          maxPromptTokens - _salvDynBudget - _salvContTokens - _salvExecTokens - 100,
                          200
                        );
                        const salvSummary = summarizer.generateSummary({
                          maxTokens: _salvSummBudget,
                          activeTodos: mcpToolServer?._todos || [],
                        });

                        currentPrompt = {
                          systemContext: buildStaticPrompt(),
                          userMessage: buildDynamicContext(_salvDynBudget) + '\n\n' + salvSummary +
                            '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                            executionState.getSummary() +
                            _salvFileProgress +
                            `\n\n${continuationMsg}`,
                        };
                        sessionJustRotated = true;
                        console.log(`[AI Chat] Post-salvage session reset: clean context for append continuation`);
                        // Close any unclosed code fence in displayResponseText so the
                        // continuation's new content doesn't get merged with the old
                        // fence by the frontend's regex parser. Count ``` occurrences;
                        // odd = unclosed fence.
                        const fenceCount = (displayResponseText.match(/```/g) || []).length;
                        if (fenceCount % 2 === 1) {
                          displayResponseText += '\n```\n';
                          console.log(`[AI Chat] Closed unclosed code fence in displayResponseText after salvage`);
                        }
                        // Reset continuationCount so the next loop pass sends
                        // llm-iteration-begin and properly resets the frontend's
                        // iteration tracking (iterationStartOffsetRef).
                        continuationCount = 0;
                        // Sync frontend buffer: replace raw streamed tokens (which may contain
                        // an unclosed code fence from the truncated output) with the cleaned
                        // display text. Without this, the unclosed fence from iteration 1
                        // bleeds into iteration 2's text, causing the code block to "reset."
                        if (mainWindow && !mainWindow.isDestroyed()) {
                          mainWindow.webContents.send('llm-replace-last', displayResponseText.slice(iterationDisplayStartLen));
                        }
                        continue;
                      } catch (resetErr) {
                        console.warn(`[AI Chat] Post-salvage reset failed: ${resetErr.message}`);
                        // Fall through to generic continuation prompt
                      }
                    }
                  } catch (salvErr) {
                    console.warn(`[AI Chat] Salvage-and-append failed: ${salvErr.message}`);
                  }
                }
              }

              if (!_didSalvageAppend) {
                // Existing logic: continue the JSON from where it was cut
                _pendingPartialBlock = partialFence; // keep FULL text for stitching
                const tailForModel = partialFence.length > maxTailChars ? partialFence.slice(-maxTailChars) : partialFence;
                continuationMsg = `${taskHint}${fileManifest}[Continue the tool call JSON from exactly where it was cut. Output ONLY the JSON continuation. Do NOT restart the tool call. Continue from:\n${tailForModel}]`;
              }
            } else {
              _pendingPartialBlock = responseText; // enable overlap detection for ALL continuation types
              const tailForModel = responseText.length > maxTailChars ? responseText.slice(-maxTailChars) : responseText;
              continuationMsg = `${taskHint}${fileManifest}[Continue your response exactly where you left off. Do not restart or repeat content. Here is the end of what you wrote:\n${tailForModel}]`;
            }

            // Enrich maxTokens continuation prompt with full context (conversation summary,
            // rolling summary, execution state, file progress) — same as the salvage-and-append path.
            // Without this, the model only sees systemContext + lean continuationMsg, loses track of
            // what files were written, and starts over from scratch.
            {
              const contSummary = summarizer.generateSummary({
                maxTokens: Math.min(Math.floor(totalCtx * 0.25), 3000),
                activeTodos: mcpToolServer?._todos || [],
              });
              const contFileProgress = buildFileProgressHint(summarizer.fileProgress);

              currentPrompt = {
                systemContext: currentPrompt.systemContext || buildStaticPrompt(),
                userMessage: buildDynamicContext() + '\n\n' + contSummary +
                  '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
                  executionState.getSummary() +
                  contFileProgress +
                  `\n\n${continuationMsg}`,
              };
            }

            // Sync frontend buffer before continuation: strip tool-fence fragments
            // from raw streamed tokens so the committed message doesn't contain broken
            // code fences. Send the full accumulated display for this iteration
            // so the frontend buffer grows monotonically (same as the overlap case).
            if (_overlapLen === 0 && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('llm-replace-last', displayResponseText.slice(iterationDisplayStartLen));
            }

            continue;
          }
        }
      }

      // Not truncated — reset continuation
      if (!_wasTruncated) continuationCount = 0;

      if (isStale()) break;

      // Record plan
      if (responseText.length > 50) {
        summarizer.recordPlan(responseText);
        rollingSummary.recordPlanFromResponse(responseText);
      }

      // ── Progressive Context Compaction ──
      try {
        let contextUsed = 0;
        try { if (llmEngine.sequence?.nextTokenIndex) contextUsed = llmEngine.sequence.nextTokenIndex; } catch (_) {}
        if (!contextUsed) {
          const pLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
          contextUsed = Math.ceil((pLen + fullResponseText.length) / 3.2);
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
          toolPaceMs: 0, skipWriteDeferral: modelTier.tier === 'tiny',
          userMessage: message, lastDroppedFilePaths: _pendingDroppedFilePaths, writeFileHistory,
          continuationCount,
        };
        toolResults = await mcpToolServer.processResponse(_stitchedForMcp, textOpts);
        _pendingDroppedFilePaths = toolResults.droppedFilePaths || [];
      }

      // Route planning text to thinking panel — ONLY for thinking models
      // Non-thinking models' intro text ("Let me create that...") is their response, not reasoning
      const _modelPath = llmEngine?.currentModelPath || '';
      const _isThinkingModel = /qwq|r1-distill|deepseek.*r1|-think/i.test(_modelPath);
      if (_isThinkingModel && toolResults.hasToolCalls && toolResults.results.length > 0 && mainWindow) {
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
          // Wipe reasoning from stream buffer (it's now in thinking panel only)
          mainWindow.webContents.send('llm-replace-last', '');
          // Also remove from displayResponseText so it doesn't appear in committed message
          displayResponseText = displayResponseText.substring(0, priorDisplayLen);
        }
      }

      // Tool-call JSON is now suppressed from the stream buffer during generation
      // (token callback skips localTokenBatcher once tool JSON is detected), so no
      // post-generation llm-replace-last cleanup is needed for non-thinking models.

      if (!toolResults.hasToolCalls || toolResults.results.length === 0) {
        // Clear text-mode tool generating bubble when no tool calls were found.
        // The model may have streamed partial tool JSON (triggering the generating bubble)
        // but the final response didn't contain valid tool calls. Clear the stale bubble.
        if (_tStart !== -1 && _tName && !nativeFunctionCalls.length && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('llm-tool-generating', {
            callIndex: _tIdx, functionName: _tName, paramsText: '', done: true,
          });
        }

        // Check for repetition
        const failure = classifyResponseFailure(responseText, false, 'general', iteration, message, lastIterationResponse, {});
        lastIterationResponse = responseText;

        if (failure?.severity === 'stop') {
          if (mainWindow) mainWindow.webContents.send('llm-token', `\n*[Stopped — ${failure.type}]*\n`);
          break;
        }

        console.log('[AI Chat] No tool calls, ending agentic loop');
        break;
      }

      lastIterationResponse = responseText;

      if (isStale()) break;

      // Filter out deferred results from UI pipeline — they haven't executed yet
      const uiToolResults = toolResults.results.filter(tr => !tr._deferred);

      // Accumulate only non-deferred tool results for UI
      // For append_to_file, replace params.content with the full file content
      // so the committed message shows one unified code block per file
      const enrichedForStorage = uiToolResults.map(tr => {
        if (tr.tool === 'append_to_file' && tr.result?.fullContent) {
          return { ...tr, params: { ...tr.params, content: tr.result.fullContent } };
        }
        return tr;
      });
      allToolResults.push(...enrichedForStorage);
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
        rollingSummary.recordToolCall(tr.tool, tr.params, tr.result, iteration);
        rollingSummary.recordToolResult(tr.tool, tr.params, tr.result, iteration);
        // Notify long-term memory when model saves a memory
        if (tr.tool === 'save_memory' && tr.result?.success && tr.params?.key) {
          longTermMemory.notifySaved(tr.params.key, tr.params.value);
        }
      }

      // Persist rolling summary to disk (debounced)
      sessionStore.saveRollingSummary(rollingSummary);

      // UI events — send only non-deferred results to prevent duplicate bubbles
      // Send done:true for text-mode tool bubble RIGHT BEFORE tool-executing events —
      // minimizes the gap where generating bubble is gone but executing hasn't appeared.
      if (_tStart !== -1 && _tName && !nativeFunctionCalls.length && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('llm-tool-generating', {
          callIndex: _tIdx, functionName: _tName, paramsText: '', done: true,
        });
      }
      sendToolExecutionEvents(mainWindow, uiToolResults, playwrightBrowser, { checkSuccess: true });

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

      if (mainWindow) {
        // For append_to_file, replace params.content with the full file content
        // so the frontend can display one unified code block per file
        const enrichedResults = uiToolResults.map(tr => {
          if (tr.tool === 'append_to_file' && tr.result?.fullContent) {
            return { ...tr, params: { ...tr.params, content: tr.result.fullContent } };
          }
          return tr;
        });
        mainWindow.webContents.send('mcp-tool-results', enrichedResults);
      }
      fullResponseText += toolFeedback + snapFeedback;
      if (fullResponseText.length > MAX_RESPONSE_SIZE) {
        fullResponseText = fullResponseText.substring(fullResponseText.length - MAX_RESPONSE_SIZE);
      }

      // Stuck/cycle detection — recover via context rotation instead of hard-stop
      if (detectStuckCycle(recentToolCalls, toolResults.results, mainWindow, _readConfig)) {
        if (!_cycleRecoveryAttempted && contextRotations < MAX_CONTEXT_ROTATIONS) {
          // First detection: attempt recovery via context rotation
          _cycleRecoveryAttempted = true;
          contextRotations++;
          recentToolCalls.length = 0; // Clear cycle history so model gets a fresh start
          console.log(`[AI Chat] Cycle detected — attempting recovery via context rotation (${contextRotations}/${MAX_CONTEXT_ROTATIONS})`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('llm-thinking-token', '\n[Cycle detected — rotating context to recover]\n');
          }
          summarizer.markRotation();
          try { await llmEngine.resetSession(true); } catch (_) {}
          await ensureLlmChat(llmEngine, getNodeLlamaCppPath);
          sessionJustRotated = true;
          lastConvSummary = summarizer.generateSummary({
            maxTokens: Math.min(Math.floor(totalCtx * 0.25), 3000),
            activeTodos: mcpToolServer?._todos || [],
          });
          currentPrompt = {
            systemContext: buildStaticPrompt(),
            userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.15)) + '\n\n' + lastConvSummary +
              '\n' + rollingSummary.generateRotationSummary(mcpToolServer?._todos) +
              executionState.getSummary() +
              `\n\nContext rotated. Continue the task from where you left off. Make forward progress.`,
          };
          rollingSummary.markRotation();
          sessionStore.saveRollingSummary(rollingSummary);
          sessionStore.flush();
          continue;
        }
        // Second detection (recovery already attempted) — hard stop
        fullResponseText += '\n\n*Detected repetitive pattern after recovery attempt. Stopping.*';
        break;
      }

      // Task reminder + step directive
      // Only inject task reminder when the model has established a structured plan (todos).
      // Without todos, the model sees only tool results and naturally summarizes/stops.
      // Re-injecting the user's message every iteration drives small models to keep
      // "working on" the task indefinitely (e.g., repeating web_search 50 times).
      let taskReminder = '';
      let stepDirective = '';
      const activeTodos = mcpToolServer._todos || [];
      if (activeTodos.length > 0) {
        taskReminder = `User's message: ${message.substring(0, 300)}${message.length > 300 ? '...' : ''}\n\n`;
        const inProgress = activeTodos.find(t => t.status === 'in-progress');
        const nextPending = activeTodos.find(t => t.status === 'pending');
        const done = activeTodos.filter(t => t.status === 'done').length;
        const total = activeTodos.length;
        if (inProgress) {
          stepDirective = `\n## CURRENT STEP (${done}/${total} complete)\n**NOW EXECUTING:** ${inProgress.text}\nWhen done: call update_todo with id=${inProgress.id} status="done".\n\n`;
        } else if (nextPending) {
          stepDirective = `\n## NEXT STEP (${done}/${total} complete)\n**DO THIS NOW:** ${nextPending.text}\nFirst call update_todo id=${nextPending.id} status="in-progress", then execute it.\n\n`;
        } else if (done === total) {
          stepDirective = `\n## PLAN COMPLETE (${done}/${total})\nAll steps finished. Provide a summary.\n\n`;
        }
      }

      const executionBlock = executionState.getSummary();
      const hasBrowserAction = toolResults.results.some(tr => tr.tool?.startsWith('browser_'));

      // Check if any file written/appended is still incomplete.
      const incompleteFiles = toolResults.results
        .filter(tr => (tr.tool === 'write_file' || tr.tool === 'append_to_file'))
        .filter(tr => {
          if (tr.result?.success) {
            const fullContent = tr.result?.fullContent || tr.params?.content || '';
            const filePath = tr.result?.path || tr.params?.filePath || '';
            return fullContent.length > 50 && !checkFileCompleteness(fullContent, filePath);
          }
          // Failed append due to empty content — file is still incomplete
          if (tr.tool === 'append_to_file' && !tr.result?.success && tr.result?.error?.includes('empty')) {
            return true;
          }
          return false;
        })
        .map(tr => tr.result?.path || tr.params?.filePath);

      let continueInstruction;
      if (hasBrowserAction) {
        continueInstruction = '\n\nThe snapshot above has [ref=N]. Use browser_click/type with ref. Output next tool call now.';
      } else if (incompleteFiles.length > 0) {
        const lastFile = incompleteFiles[incompleteFiles.length - 1];
        const lastResult = toolResults.results.find(tr => (tr.result?.path || tr.params?.filePath) === lastFile);
        const lastFullContent = lastResult?.result?.fullContent || lastResult?.params?.content || '';
        const currentLineCount = lastFullContent ? lastFullContent.split('\n').length : 0;

        // No-progress detection for incomplete file continuations (BUG 8/18)
        const prevLineCount = _incompleteFileLastLines[lastFile] || 0;
        if (currentLineCount > 0 && currentLineCount <= prevLineCount) {
          _incompleteFileStallCount++;
          console.log(`[AI Chat] Incomplete file no progress: "${lastFile}" at ${currentLineCount} lines (stall #${_incompleteFileStallCount})`);
        } else {
          _incompleteFileStallCount = 0;
        }
        _incompleteFileLastLines[lastFile] = currentLineCount;

        // After 2 stalls, rotate context to give model a fresh start focused on completion
        if (_incompleteFileStallCount >= 2 && contextRotations < MAX_CONTEXT_ROTATIONS) {
          console.log(`[AI Chat] Incomplete file stall x${_incompleteFileStallCount} — rotating context for focused completion`);
          _incompleteFileStallCount = 0;
          contextRotations++;
          summarizer.markRotation();
          try { await llmEngine.resetSession(true); } catch (_) {}
          sessionJustRotated = true;

          // Read the file from disk for accurate state
          let diskContent = lastFullContent;
          try {
            const _fs = require('fs'), _path = require('path');
            const fp = _path.resolve(mcpToolServer.projectPath || '.', lastFile);
            if (_fs.existsSync(fp)) diskContent = _fs.readFileSync(fp, 'utf-8');
          } catch {}
          const diskLines = diskContent.split('\n');
          const tail50 = diskLines.slice(-50).join('\n');

          currentPrompt = {
            systemContext: buildStaticPrompt(),
            userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) +
              `\n\n## FILE COMPLETION TASK\nYou are continuing an incomplete file: "${lastFile}" (${diskLines.length} lines so far).\n` +
              `The file is NOT complete — it is missing closing tags/content.\n` +
              `Here are the last 50 lines:\n\`\`\`\n${tail50}\n\`\`\`\n\n` +
              `Continue this file from where it left off.`,
          };
          rollingSummary.markRotation();
          continue;
        }

        // Normal incomplete file continuation
        let fileTail = '';
        if (lastFullContent) {
          const fileLines = lastFullContent.split('\n');
          const tail15 = fileLines.slice(-15).join('\n');
          fileTail = `\nThe file currently has ${fileLines.length} lines. Here are the last 15 lines — continue from here:\n\`\`\`\n${tail15}\n\`\`\`\n`;
        }
        continueInstruction = `\n\n**FILE NOT COMPLETE:** The file "${lastFile}" is still missing content (no closing tags found). The file has ${currentLineCount} lines so far. Do NOT declare completion.${fileTail}Continue the file from where it left off.`;
        console.log(`[AI Chat] Incomplete file detected after tool execution: ${lastFile} — forcing continuation`);
      } else {
        _incompleteFileStallCount = 0; // Reset stall counter when no incomplete files
        // When no structured plan (todos) exists, the model must respond to the user
        // using the tool results above — not make additional tool calls.
        // Without this, small models loop indefinitely (web_search x50, list_directory x30)
        // because they interpret tool results as an ongoing task.
        if (activeTodos.length === 0) {
          continueInstruction = '\n\nRespond to the user using the tool results above. Do not call any more tools.';
        } else {
          continueInstruction = '';
        }
      }

      const iterContext = executionBlock + stepDirective + taskReminder;
      const allFeedback = toolFeedback + snapFeedback;

      // ── Budget-Aware Tiered Context Assembly (Phase 2) ──
      // Instead of dumping raw feedback + rolling summary separately,
      // assemble a single context block within calculated token budget.
      // HOT tier: current iteration results (full)
      // WARM tier: recent iterations (compressed)
      // COLD tier: old iterations (bullets)
      const dynamicCtx = buildDynamicContext();
      const dynamicTokens = estimateTokens(dynamicCtx);
      const iterTokens = estimateTokens(iterContext);
      const contTokens = estimateTokens(continueInstruction);
      // maxPromptTokens already accounts for the actual system context size,
      // so staticTokens is not subtracted here (avoids double-subtraction)
      const availableBudget = Math.max(
        maxPromptTokens - dynamicTokens - iterTokens - contTokens - 100,
        200
      );

      if (sessionJustRotated) {
        sessionJustRotated = false;
        const rotSummaryTokens = estimateTokens(lastConvSummary);
        const rotBudget = Math.max(availableBudget - rotSummaryTokens, 200);
        const assembledContext = rollingSummary.assembleTieredContext(rotBudget, iteration, allFeedback);
        currentPrompt = {
          systemContext: buildStaticPrompt(),
          userMessage: iterContext + dynamicCtx + '\n' + lastConvSummary + '\n' + assembledContext + continueInstruction,
        };
      } else {
        const assembledContext = rollingSummary.assembleTieredContext(availableBudget, iteration, allFeedback);
        currentPrompt = {
          systemContext: buildStaticPrompt(),
          userMessage: iterContext + dynamicCtx + '\n' + assembledContext + continueInstruction,
        };
      }
    }

    // ── Post-loop ──
    if (iteration >= MAX_AGENTIC_ITERATIONS) {
      fullResponseText += `\n\n*Reached max ${MAX_AGENTIC_ITERATIONS} iterations.*`;
      if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Reached max ${MAX_AGENTIC_ITERATIONS} iterations.*`);
    }

    // Auto-summarize if last iteration used tools
    // Guard: skip summary generation if context is near full to prevent CONTEXT_OVERFLOW in summarizer
    let _skipSummary = false;
    try {
      let _summaryCtxUsed = 0;
      try { if (llmEngine.sequence?.nextTokenIndex) _summaryCtxUsed = llmEngine.sequence.nextTokenIndex; } catch (_) {}
      if (_summaryCtxUsed > 0 && _summaryCtxUsed / totalCtx > 0.80) {
        console.log(`[AI Chat] Skipping auto-summary: context at ${Math.round(_summaryCtxUsed / totalCtx * 100)}% — would overflow`);
        _skipSummary = true;
      }
    } catch (_) {}
    if (!_skipSummary && allToolResults.length > 0 && iteration >= 2 && !allToolResults.some(tr => tr.tool?.startsWith('browser_'))) {
      const lastTrimmed = (fullResponseText || '').trim();
      const endsWithToolOutput = lastTrimmed.endsWith('```') || lastTrimmed.includes('## Tool Execution Results');
      if (endsWithToolOutput || iteration >= MAX_AGENTIC_ITERATIONS) {
        try {
          const toolsSummary = allToolResults.slice(-10).map(tr => `${tr.tool}: ${tr.result?.success ? 'done' : 'failed'}`).join(', ');
          const summaryResult = await llmEngine.generateStream({
            systemContext: buildStaticPrompt(),
            userMessage: `Tools used: ${toolsSummary}\n\nProvide a brief summary of what was accomplished (2-4 sentences). Do NOT call any tools.`,
          }, { maxTokens: 512, temperature: 0.3, replaceLastUser: true }, (token) => {
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

    // ── Post-loop chatHistory compaction ──
    // The agentic loop pushed multiple user+model entries (one pair per iteration).
    // Collapse all intermediate entries into one clean pair: user's original message
    // + model's final response. This prevents future messages from seeing 16+ entries
    // of internal tool feedback, RAG chunks, and rolling summaries that were only
    // relevant during this turn's tool work.
    if (llmEngine.chatHistory && llmEngine.chatHistory.length > chatHistoryPreLoopLen + 2) {
      const sys = llmEngine.chatHistory.slice(0, 1); // preserve system prompt
      const pre = llmEngine.chatHistory.slice(1, chatHistoryPreLoopLen); // prior conversation
      const cleanedPair = [
        { type: 'user', text: message },
        { type: 'model', response: [fullResponseText || ''] },
      ];
      llmEngine.chatHistory = [...sys, ...pre, ...cleanedPair];
      llmEngine.lastEvaluation = null; // invalidate KV cache position tracking
      console.log(`[AI Chat] Post-loop compaction: ${chatHistoryPreLoopLen} → ${llmEngine.chatHistory.length} entries (collapsed ${iteration} iterations)`);
    }

    memoryStore.addConversation('assistant', fullResponseText);

    // Extract and save long-term memories from this conversation
    try { longTermMemory.extractAndSave(rollingSummary, message); } catch (e) {
      console.warn('[AI Chat] Long-term memory extraction failed:', e.message);
    }

    // Flush session store on conversation end
    sessionStore.saveRollingSummary(rollingSummary);
    sessionStore.flush();

    // Clean display text
    let cleanResponse = displayResponseText;
    cleanResponse = cleanResponse.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
    cleanResponse = cleanResponse.replace(/<\/?think(?:ing)?>/gi, '');
    // Strip XML tool_call tags (Qwen3 and other models use this format)
    cleanResponse = cleanResponse.replace(/<tool_calls?>\s*[\s\S]*?<\/tool_calls?>/gi, '');
    cleanResponse = cleanResponse.replace(/<\/?tool_calls?>/gi, '');
    // Strip tool call fence artifacts — but preserve legitimate ```json code blocks
    cleanResponse = cleanResponse.replace(/\n?```(?:tool_call|tool)\b[\s\S]*?```\n?/g, '');
    cleanResponse = cleanResponse.replace(/\n?```(?:tool_call|tool)\b[\s\S]*/g, '');
    cleanResponse = cleanResponse.replace(/\n?```json\b([\s\S]*?)```\n?/g, (match, content) => {
      return /"\s*tool\s*"\s*:\s*"/.test(content) ? '' : match;
    });
    cleanResponse = cleanResponse.replace(/\n?```json\b([\s\S]*)$/g, (match, content) => {
      return /"\s*tool\s*"\s*:\s*"/.test(content) ? '' : match;
    });
    cleanResponse = cleanResponse.replace(/^\s*```\s*$/gm, '');
    // Strip raw inline JSON tool calls with proper brace matching (handles nested objects)
    // Only match objects with "tool" key — "name" is too common in generated code
    {
      const toolPat = /\[?\s*\{\s*"tool"\s*:\s*"/g;
      let tm;
      const ranges = [];
      while ((tm = toolPat.exec(cleanResponse)) !== null) {
        const bs = cleanResponse.indexOf('{', tm.index);
        let d = 1, ci = bs + 1;
        while (ci < cleanResponse.length && d > 0) {
          if (cleanResponse[ci] === '{') d++;
          else if (cleanResponse[ci] === '}') d--;
          ci++;
        }
        if (d === 0) {
          let end = ci;
          const after = cleanResponse.slice(end).match(/^\s*\]?/);
          if (after) end += after[0].length;
          ranges.push([tm.index, end]);
        }
      }
      for (let ri = ranges.length - 1; ri >= 0; ri--) {
        cleanResponse = cleanResponse.slice(0, ranges[ri][0]) + cleanResponse.slice(ranges[ri][1]);
      }
    }
    cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim();

    if (!cleanResponse) {
      cleanResponse = allToolResults.length > 0 ? 'Tools executed successfully.' : 'No response generated.';
    }

    const localTokensUsed = estimateTokens(fullResponseText);
    _reportTokenStats(localTokensUsed, mainWindow);

    // Dedup write tools by filePath: keep only the latest entry per file
    // so the committed message shows one unified code block per file
    const WRITE_TOOLS_DEDUP = new Set(['write_file', 'create_file', 'edit_file', 'append_to_file']);
    const writePathLatest = new Map();
    for (let i = allToolResults.length - 1; i >= 0; i--) {
      const tr = allToolResults[i];
      if (WRITE_TOOLS_DEDUP.has(tr.tool) && tr.params?.filePath) {
        if (!writePathLatest.has(tr.params.filePath)) {
          writePathLatest.set(tr.params.filePath, i);
        }
      }
    }
    const dedupedToolResults = allToolResults.filter((tr, idx) => {
      if (!WRITE_TOOLS_DEDUP.has(tr.tool) || !tr.params?.filePath) return true;
      return writePathLatest.get(tr.params.filePath) === idx;
    });

    return {
      success: true,
      text: cleanResponse,
      model: modelStatus.modelInfo?.name || 'local',
      tokensUsed: localTokensUsed,
      toolResults: dedupedToolResults.length > 0 ? dedupedToolResults : undefined,
      iterations: iteration,
    };
  }
}

// ─────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────

/**
 * Build file progress hint with structural digests.
 * Module-level so it's accessible from both performAgenticChat and preGenerationContextCheck.
 */
function buildFileProgressHint(fileProgress) {
  const keys = Object.keys(fileProgress || {});
  if (keys.length === 0) return '';
  const parts = keys.map(fp => {
    const p = fileProgress[fp];
    if (p.structureDigest) return '\n' + p.structureDigest;
    return `\n- ${fp}: ${p.writtenLines} lines (${p.writtenChars} chars)`;
  });
  return '\n**FILE STRUCTURE ON DISK:**' + parts.join('');
}

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
 * Pre-generation context check — compact or rotate before generating.
 */
function preGenerationContextCheck(opts) {
  const { llmEngine, totalCtx, currentPrompt, fullResponseText, allToolResults,
    contextRotations, MAX_CONTEXT_ROTATIONS, summarizer, buildStaticPrompt,
    buildDynamicContext, maxPromptTokens, maxResponseTokens, message, continuationCount, _pendingPartialBlock, mcpToolServer } = opts;

  let used = 0;
  let usedFromSequence = false;
  try {
    if (llmEngine.sequence?.nextTokenIndex) {
      used = llmEngine.sequence.nextTokenIndex;
      usedFromSequence = true;
    }
  } catch (_) {}
  if (!used) {
    const pLen = typeof currentPrompt === 'string' ? currentPrompt.length : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
    used = Math.ceil((pLen + fullResponseText.length) / 4);
  }

  // Project forward: when usage comes from KV cache (sequence), it doesn't include
  // the upcoming prompt for this iteration or the response budget. Estimate both
  // to catch overflow BEFORE it happens — critical for small contexts (< 16K).
  if (usedFromSequence) {
    // Count BOTH systemContext + userMessage — systemContext may not be in KV cache after rotation
    const newPromptChars = typeof currentPrompt === 'string'
      ? currentPrompt.length
      : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
    const respBudget = maxResponseTokens || Math.min(Math.floor(totalCtx * 0.25), 4096);
    used += Math.ceil(newPromptChars / 3.2) + respBudget;
  }

  const pct = used / totalCtx;
  if (pct <= 0.50) return null;

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

  // Build incremental progress hints
  const incrementalHint = summarizer.incrementalTask
    ? `\n**INCREMENTAL TASK: ${summarizer.incrementalTask.current}/${summarizer.incrementalTask.target} ${summarizer.incrementalTask.type} completed.**`
    : '';
  const fileProgressHint = buildFileProgressHint(summarizer.fileProgress || {});
  if (isContinuationRotation) {
    return {
      shouldContinue: true,
      prompt: {
        systemContext: buildStaticPrompt(),
        userMessage: buildDynamicContext(Math.floor(maxPromptTokens * 0.10)) + '\n' + message +
          incrementalHint + fileProgressHint +
          '\n\nContext rotated. Continue generating content from where you left off. Do NOT output any acknowledgment, recap, or summary — immediately make forward progress.',
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
      userMessage: buildDynamicContext() + '\n' + summary +
        `\nContext rotated. Current request: ${message.substring(0, 300)}` +
        incrementalHint + fileProgressHint +
        '\n\nContinue the task. Do NOT output any acknowledgment or summary — make forward progress immediately.',
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

      // Write deferral
      if (shouldDefer && DATA_WRITE_TOOLS.has(call.tool)) {
        results.push({ tool: call.tool, params: call.params, _deferred: true, result: { success: false, error: 'DEFERRED: Re-issue write next turn using actual data from tool results.' } });
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
    // Use full JSON stringification for better differentiation of similar calls
    const paramsHash = JSON.stringify(p).substring(0, 400);
    recentToolCalls.push({ tool: tr.tool, paramsHash });
  }
  if (recentToolCalls.length > 20) recentToolCalls.splice(0, recentToolCalls.length - 20);

  // Stuck detection — single threshold for all tools
  const last = recentToolCalls[recentToolCalls.length - 1];

  if (recentToolCalls.length >= STUCK_THRESHOLD) {
    const tail = recentToolCalls.slice(-STUCK_THRESHOLD);
    // Always match on paramsHash — different params means different intent
    const isStuck = tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash);

    if (isStuck) {
      console.log(`[AI Chat] Stuck: ${last.tool} ${STUCK_THRESHOLD}+ times with same params`);
      if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected loop (${last.tool}). Stopped.*`);
      return true;
    }
  }

  // Cycle detection — uses tool+paramsHash signatures, not just tool names.
  // Different params = different intent (e.g. read_file lines 1-50 vs 260-275).
  if (recentToolCalls.length >= 8) {
    for (let cycleLen = 2; cycleLen <= 4; cycleLen++) {
      if (recentToolCalls.length < cycleLen * CYCLE_MIN_REPEATS) continue;
      const sigs = recentToolCalls.map(tc => `${tc.tool}:${tc.paramsHash}`);
      const lastCycle = sigs.slice(-cycleLen);
      let repeats = 0;
      for (let pos = sigs.length - cycleLen; pos >= 0; pos -= cycleLen) {
        const segment = sigs.slice(pos, pos + cycleLen);
        if (segment.join(',') === lastCycle.join(',')) repeats++;
        else break;
      }
      if (repeats >= CYCLE_MIN_REPEATS) {
        const sig = recentToolCalls.slice(-cycleLen).map(tc => tc.tool).join(' → ');
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
  // Detect actual tool name from salvaged content
  const toolMatch = fenceContent.match(/"(write_file|append_to_file)"/);
  const toolName = toolMatch ? toolMatch[1] : 'write_file';
  const json = JSON.stringify({ tool: toolName, params: { filePath: fpMatch[1], content } });
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
