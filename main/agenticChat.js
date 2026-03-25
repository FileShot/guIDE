/**
 * guIDE — Agentic AI Chat Handler
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 *
 * Clean rewrite. Local path uses the new modular pipeline (./pipeline/).
 * Cloud path kept intact — it uses a different API (cloudLLM.generate()).
 */
'use strict';

const { ipcMain } = require('electron');
const path = require('path');
const fsSync = require('fs');

// Cloud path helpers (unchanged)
const {
  autoSnapshotAfterBrowserAction,
  sendToolExecutionEvents,
  capArray,
  createIpcTokenBatcher,
  pruneCloudHistory,
  classifyResponseFailure,
  ExecutionState,
} = require('./agenticChatHelpers');

// New local pipeline
const { handleLocalChat: pipelineLocalChat } = require('./pipeline/agenticLoop');

// ─── Constants (cloud path) ─────────────────────────────────
const STUCK_THRESHOLD = 3;
const CYCLE_MIN_REPEATS = 3;
const MAX_RESPONSE_SIZE = 2 * 1024 * 1024;
const WALL_CLOCK_DEADLINE_MS = 30 * 60 * 1000;

function register(ctx) {
  const {
    llmEngine, cloudLLM, mcpToolServer, playwrightBrowser, browserManager,
    ragEngine, memoryStore, webSearch, licenseManager,
    ConversationSummarizer, DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE,
  } = ctx;
  const _truncateResult = ctx._truncateResult;
  const _readConfig = ctx._readConfig;

  // ─── Session state ──────────────────────────────────────
  let _sessionTokensUsed = 0;
  let _sessionRequestCount = 0;
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
    const MAX_AGENTIC_ITERATIONS = context?.maxIterations
      || _readConfig()?.userSettings?.maxAgenticIterations
      || 100;

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
      // ─── Auto Mode: pick best cloud provider ──────────
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

      // ─── Clear per-turn state ─────────────────────────
      mcpToolServer._todos = [];
      mcpToolServer._todoNextId = 1;


      // ─── Cloud Path ───────────────────────────────────
      if (context?.cloudProvider && context?.cloudModel) {
        return await handleCloudChat(ctx, message, context, {
          mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats,
        });
      }

      // ─── Local Path — NEW PIPELINE ────────────────────
      return await pipelineLocalChat(ctx, message, context, {
        mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats,
        MAX_AGENTIC_ITERATIONS,
      });
    } catch (error) {
      console.error('[AgenticChat] Pipeline error:', error.stack || error.message || error);
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

  // ═══════════════════════════════════════════════════════════
  //  Cloud Chat Handler (unchanged from original)
  // ═══════════════════════════════════════════════════════════
  async function handleCloudChat(ctx, message, context, helpers) {
    const { mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats } = helpers;
    const { cloudLLM, mcpToolServer, playwrightBrowser, browserManager, ragEngine, memoryStore, webSearch, licenseManager } = ctx;

    // Sync project path from frontend context
    if (context?.projectPath) {
      mcpToolServer.projectPath = context.projectPath;
      ctx.currentProjectPath = context.projectPath;
    }

    // Apply tool toggles from frontend settings
    if (typeof mcpToolServer.setDisabledTools === 'function') {
      mcpToolServer.setDisabledTools(context?.disabledTools || []);
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
    let cleanResponse = fullCloudResponse;
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
}

// ─── Utility Functions (module-level) ────────────────────────

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

function detectStuckCycle(recentToolCalls, newResults, mainWindow, _readConfig) {
  for (const tr of newResults) {
    const p = tr.params || {};
    const paramsHash = JSON.stringify(p).substring(0, 400);
    recentToolCalls.push({ tool: tr.tool, paramsHash });
  }
  if (recentToolCalls.length > 20) recentToolCalls.splice(0, recentToolCalls.length - 20);

  const last = recentToolCalls[recentToolCalls.length - 1];

  if (recentToolCalls.length >= STUCK_THRESHOLD) {
    const tail = recentToolCalls.slice(-STUCK_THRESHOLD);
    const isStuck = tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash);

    if (isStuck) {
      console.log(`[AI Chat] Stuck: ${last.tool} ${STUCK_THRESHOLD}+ times with same params`);
      if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected loop (${last.tool}). Stopped.*`);
      return true;
    }
  }

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
        const sig = recentToolCalls.slice(-cycleLen).map(tc => tc.tool).join(' -> ');
        console.log(`[AI Chat] Cycle: [${sig}] x${repeats}`);
        if (mainWindow) mainWindow.webContents.send('llm-token', `\n\n*Detected cycle (${sig}). Stopped.*`);
        return true;
      }
    }
  }

  return false;
}

module.exports = { register };
