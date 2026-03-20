/**
 * AgenticLoop — The core agentic chat loop for local LLM inference.
 *
 * This is the heart of the pipeline. It orchestrates:
 *   1. Building the system prompt with tool definitions (budget-aware)
 *   2. Generating model responses via llmEngine
 *   3. Parsing responses (separating text from tool calls)
 *   4. Executing tool calls via mcpToolServer
 *   5. Feeding tool results back using tiered context assembly
 *   6. Handling seamless continuation when maxTokens is hit
 *   7. Pre-generation context checks with progressive compaction
 *   8. CONTEXT_OVERFLOW recovery with rotation + summary
 *   9. Post-loop history compaction
 *  10. Rolling summary + conversation summarizer state tracking
 */
'use strict';

const { StreamHandler } = require('./streamHandler');
const { parseResponse, cleanTrailingArtifacts } = require('./responseParser');
const {
  progressiveContextCompaction,
  preGenerationContextCheck,
  postLoopCompaction,
  shouldSummarize,
  summarizeHistory,
} = require('./contextManager');
const { shouldContinue, continuationMessage } = require('./continuationHandler');
const { buildSystemPrompt, formatToolResults } = require('./promptAssembler');
const { RollingSummary, estimateTokens } = require('./rollingSummary');
const { ConversationSummarizer } = require('./conversationSummarizer');

// ─── Constants ──────────────────────────────────────────────
const WALL_CLOCK_MS   = 30 * 60 * 1000; // 30 min hard limit
const MAX_CONTEXT_ROTATIONS = 6; // Max rotations per request

/**
 * Handle a local model agentic chat request.
 *
 * @param {object} ctx — Server context (llmEngine, mcpToolServer, etc.)
 * @param {string} message — User's message text
 * @param {object} context — Request context from frontend
 * @param {object} helpers — { mainWindow, isStale, waitWhilePaused, _readConfig, _reportTokenStats, MAX_AGENTIC_ITERATIONS }
 * @returns {Promise<{success, text, stopReason, model}>}
 */
async function handleLocalChat(ctx, message, context, helpers) {
  const { llmEngine, mcpToolServer } = ctx;
  const {
    mainWindow, isStale, waitWhilePaused,
    _readConfig, _reportTokenStats, MAX_AGENTIC_ITERATIONS,
  } = helpers;

  // ─── Setup ──────────────────────────────────────────────
  const stream = new StreamHandler(mainWindow);
  const deadline = Date.now() + WALL_CLOCK_MS;

  // Sync project path
  if (context?.projectPath) {
    mcpToolServer.projectPath = context.projectPath;
    ctx.currentProjectPath = context.projectPath;
  }

  // Wait for model if still loading
  if (!llmEngine.isReady) {
    console.log('[AgenticLoop] Model not ready — waiting...');
    const readyDeadline = Date.now() + 15000;
    while (!llmEngine.isReady && Date.now() < readyDeadline) {
      await new Promise(r => setTimeout(r, 500));
    }
    if (!llmEngine.isReady) {
      if (mainWindow) stream._send('llm-token', '*Model is still loading — please wait and try again.*\n');
      return { success: false, error: 'Model is still loading' };
    }
  }

  // Wire todo updates
  mcpToolServer.onTodoUpdate = (todos) => stream.todoUpdate(todos);

  // Get model and context info
  const totalCtx = llmEngine.modelInfo?.contextSize || 14000;
  const paramSize = llmEngine.modelInfo?.paramSize || '';
  const isSmallModel = /^[0-4]b$/i.test(paramSize);

  // Calculate budget splits
  const maxResponseTokens = Math.min(Math.floor(totalCtx * 0.25), 4096);
  const toolCount = typeof mcpToolServer.getToolDefinitions === 'function' ? mcpToolServer.getToolDefinitions().length : 20;
  const sysPromptReserve = Math.max(500, toolCount * 55);
  const maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);

  console.log(`[AgenticLoop] Context budget: total=${totalCtx}, sysReserve=${sysPromptReserve}, maxPrompt=${maxPromptTokens}, maxResponse=${maxResponseTokens}`);

  // Get compact tool hint
  const toolHint = typeof mcpToolServer.getCompactToolHint === 'function'
    ? mcpToolServer.getCompactToolHint('general')
    : '';

  // Select preamble based on model size/context
  const contextIsConstrained = totalCtx < 8192;
  const useCompact = isSmallModel || contextIsConstrained;
  const basePreamble = useCompact
    ? (ctx.DEFAULT_COMPACT_PREAMBLE || ctx.DEFAULT_SYSTEM_PREAMBLE)
    : ctx.DEFAULT_SYSTEM_PREAMBLE;

  // ─── Initialize Context Management ──────────────────────
  const rollingSummary = new RollingSummary();
  rollingSummary.setGoal(message);

  const summarizer = new ConversationSummarizer();
  summarizer.setGoal(message);

  let contextRotations = 0;
  let continuationCount = 0;

  // Budget-aware system prompt builder (closure so it can be called repeatedly)
  const _buildSystemPrompt = () => {
    return buildSystemPrompt(
      basePreamble, toolHint,
      context?.projectPath,
      context?.currentFile,
      context?.selectedCode,
      { maxTokens: sysPromptReserve },
    );
  };

  // Build initial system prompt
  const systemPrompt = _buildSystemPrompt();

  // Set or update system message in chatHistory
  if (!llmEngine.chatHistory || llmEngine.chatHistory.length === 0) {
    llmEngine.chatHistory = [{ type: 'system', text: systemPrompt }];
  } else if (context?.conversationHistory?.length === 0) {
    llmEngine.chatHistory = [{ type: 'system', text: systemPrompt }];
    try {
      if (llmEngine.sequence) llmEngine.sequence.clearHistory?.();
      llmEngine.lastEvaluation = null;
    } catch {}
  } else {
    const sysIdx = llmEngine.chatHistory.findIndex(h => h.type === 'system');
    if (sysIdx >= 0) llmEngine.chatHistory[sysIdx].text = systemPrompt;
    else llmEngine.chatHistory.unshift({ type: 'system', text: systemPrompt });
  }

  // Record pre-loop history length for post-loop compaction
  const chatHistoryPreLoopLen = llmEngine.chatHistory.length;

  // Measure actual system prompt size and correct budget
  {
    const actualStaticTokens = estimateTokens(systemPrompt);
    if (actualStaticTokens > sysPromptReserve) {
      const corrected = Math.max(totalCtx - actualStaticTokens - maxResponseTokens, 256);
      console.log(`[AgenticLoop] sysReserve corrected ${sysPromptReserve}→${actualStaticTokens}. maxPromptTokens→${corrected}`);
    }
  }

  // Merge sampling parameters
  const params = {
    maxTokens:     context?.params?.maxTokens     || maxResponseTokens,
    temperature:   context?.params?.temperature   ?? 0.5,
    topP:          context?.params?.topP           ?? 0.9,
    topK:          context?.params?.topK           ?? 20,
    repeatPenalty: context?.params?.repeatPenalty   ?? 1.15,
    seed:          context?.params?.seed           ?? -1,
  };

  // ─── Loop state ─────────────────────────────────────────
  let fullResponseText = '';
  let displayResponseText = '';
  let nextUserMessage = message;
  let totalTokensUsed = 0;
  let lastStopReason = 'natural';
  const allToolResults = [];
  let pendingToolCallBuffer = null;  // Accumulates raw text for tool calls spanning continuations
  let tokensSinceLastCtxEmit = 0;    // Throttle live context ring updates

  // ═══ THE AGENTIC LOOP ═══════════════════════════════════
  for (let iteration = 1; iteration <= MAX_AGENTIC_ITERATIONS; iteration++) {
    // ── Guard: cancellation + timeout ──────────────────────
    if (isStale()) {
      stream._send('llm-token', '\n*[Interrupted]*\n');
      return { success: false, error: 'Request cancelled', text: fullResponseText };
    }
    if (Date.now() > deadline) {
      stream._send('llm-token', '\n*[Time limit reached]*\n');
      break;
    }
    await waitWhilePaused();

    // ── Pre-generation context check ──────────────────────
    // Proactively compact or rotate BEFORE generation to prevent CONTEXT_OVERFLOW
    const currentPrompt = {
      systemContext: systemPrompt,
      userMessage: nextUserMessage,
    };

    const preCheck = preGenerationContextCheck({
      llmEngine, totalCtx, currentPrompt, fullResponseText, allToolResults,
      contextRotations, MAX_CONTEXT_ROTATIONS, summarizer, rollingSummary,
      buildSystemPrompt: _buildSystemPrompt, maxPromptTokens, maxResponseTokens,
      message, continuationCount, mcpToolServer,
    });

    if (preCheck) {
      console.log(`[AgenticLoop] Pre-generation: context rotation #${contextRotations + 1}`);
      contextRotations++;

      // Reset session for fresh context
      try { await llmEngine.resetSession(true); } catch (e) {
        console.error('[AgenticLoop] Reset session failed:', e.message);
      }

      // Use the rotation prompt
      nextUserMessage = preCheck.prompt.userMessage;

      // Update system prompt in history
      llmEngine.chatHistory = [{ type: 'system', text: preCheck.prompt.systemContext }];

      if (preCheck.clearContinuation) continuationCount = 0;
    }

    // ── Emit iteration events ─────────────────────────────
    stream.iterationBegin();
    stream.progress(iteration, MAX_AGENTIC_ITERATIONS);
    console.log(`[AgenticLoop] Iteration ${iteration}/${MAX_AGENTIC_ITERATIONS} (rotations: ${contextRotations})`);
    if (iteration === 1) {
      const sysEntry = (llmEngine.chatHistory || []).find(h => h.type === 'system');
      console.log(`[AgenticLoop] System prompt length: ${sysEntry?.text?.length || 0}`);
      console.log(`[AgenticLoop] User message length: ${nextUserMessage?.length || 0}`);
    }

    // ── Generate response ─────────────────────────────────
    stream.reset();
    tokensSinceLastCtxEmit = 0;
    let result;
    try {
      result = await llmEngine.generateStream(
        { userMessage: nextUserMessage },
        { ...params, replaceLastUser: false },
        (token) => {
          stream.onToken(token);
          // Throttled live context ring update (~every 200 tokens)
          tokensSinceLastCtxEmit++;
          if (tokensSinceLastCtxEmit >= 200) {
            tokensSinceLastCtxEmit = 0;
            try {
              const liveUsed = llmEngine.sequence?.nextTokenIndex || 0;
              if (liveUsed > 0) stream.contextUsage(liveUsed, totalCtx);
            } catch (_) {}
          }
        },
        (thinkToken) => stream.thinkingToken(thinkToken),
      );
    } catch (err) {
      const errMsg = err.message || '';

      // ── CONTEXT_OVERFLOW Recovery ─────────────────────
      if (errMsg.startsWith('CONTEXT_OVERFLOW:')) {
        console.log(`[AgenticLoop] CONTEXT_OVERFLOW at iteration ${iteration} — performing rotation`);

        // Clear any pending tool call buffer — context is being rotated
        if (pendingToolCallBuffer !== null) {
          console.log('[AgenticLoop] Clearing pending tool call buffer due to context rotation');
          const cleaned = cleanTrailingArtifacts(pendingToolCallBuffer);
          fullResponseText += cleaned;
          displayResponseText += cleaned;
          pendingToolCallBuffer = null;
        }

        if (contextRotations >= MAX_CONTEXT_ROTATIONS) {
          console.error('[AgenticLoop] Max context rotations reached');
          stream._send('llm-token', '\n*[Context limit reached — too many rotations]*\n');
          break;
        }

        contextRotations++;
        summarizer.markRotation();
        rollingSummary.markRotation();

        // The overflow error contains a summary after the colon
        const overflowSummary = errMsg.substring('CONTEXT_OVERFLOW:'.length);

        // Reset session (already done by llmEngine on CONTEXT_OVERFLOW)
        // Build a recovery prompt with summarized context
        const rotationSummary = summarizer.generateQuickSummary(mcpToolServer?._todos);
        const rollingCtx = rollingSummary.assembleTieredContext(
          Math.floor(maxPromptTokens * 0.6), iteration, ''
        );

        llmEngine.chatHistory = [{ type: 'system', text: _buildSystemPrompt() }];

        nextUserMessage = `${rotationSummary}\n\n${rollingCtx}\n\n` +
          `Context was rotated due to overflow. Previous summary: ${overflowSummary.slice(0, 500)}\n\n` +
          `Continue the task. Original request: ${message.substring(0, 300)}\n` +
          `Do NOT output any acknowledgment or summary — make forward progress immediately.`;

        // Prepend any partial response from before the overflow
        if (err.partialResponse) {
          fullResponseText += err.partialResponse;
          displayResponseText += err.partialResponse;
        }

        continue; // Retry generation with rotated context
      }

      // Non-overflow errors are fatal
      console.error(`[AgenticLoop] Generation error (iteration ${iteration}):`, errMsg);
      stream.finalize(false);
      return {
        success: false,
        error: `Generation failed: ${errMsg}`,
        text: fullResponseText,
        stopReason: 'error',
        model: llmEngine.modelInfo?.name || 'unknown',
      };
    }

    if (isStale()) {
      return { success: false, error: 'Request cancelled', text: fullResponseText };
    }

    totalTokensUsed += result.tokensUsed || 0;
    lastStopReason = result.stopReason;

    // Report context usage (defense-in-depth: fall back to reading sequence directly)
    const ctxUsed = result.contextUsed || ctx.llmEngine?.sequence?.nextTokenIndex || 0;
    stream.contextUsage(ctxUsed, totalCtx);

    // ── Parse response ────────────────────────────────────
    const rawText = result.text || result.rawText || '';
    let displayText, toolCalls;

    // ── Tool call accumulation across continuations ───────
    // When a tool call (e.g. write_file with large content) is truncated
    // by maxTokens, we accumulate the raw text across continuations until
    // the complete tool call can be parsed and executed.
    if (pendingToolCallBuffer !== null) {
      // Append this continuation's raw text to the accumulation buffer
      pendingToolCallBuffer += rawText;

      const accResult = parseResponse(pendingToolCallBuffer, result.stopReason);

      if (accResult.toolCalls.length > 0) {
        // Complete tool call found in accumulated buffer
        console.log(`[AgenticLoop] Accumulated tool call complete (${pendingToolCallBuffer.length} chars over ${continuationCount} continuations)`);
        displayText = accResult.displayText;
        toolCalls = accResult.toolCalls;
        pendingToolCallBuffer = null;
        stream.finalize(true);
        fullResponseText += displayText;
        displayResponseText += displayText;
        // Fall through to tool execution below
      } else if (shouldContinue(result)) {
        // Still accumulating — tool call not complete yet
        if (pendingToolCallBuffer.length > 500000) {
          // Safety limit: abandon if buffer exceeds ~500K chars
          console.log('[AgenticLoop] Accumulated tool call buffer exceeded 500K — abandoning');
          const cleaned = cleanTrailingArtifacts(pendingToolCallBuffer);
          fullResponseText += cleaned;
          displayResponseText += cleaned;
          pendingToolCallBuffer = null;
          stream.finalize(false);
          toolCalls = [];
        } else {
          continuationCount++;
          console.log(`[AgenticLoop]   Continuation (tool call accumulation, ${pendingToolCallBuffer.length} chars)`);
          nextUserMessage = continuationMessage({ lastText: pendingToolCallBuffer, toolInProgress: true });
          stream.finalize(false);
          continue;
        }
      } else {
        // Natural stop but tool call still incomplete — treat as display text
        console.log('[AgenticLoop] Accumulated buffer has no complete tool call — treating as display text');
        const cleaned = cleanTrailingArtifacts(pendingToolCallBuffer);
        fullResponseText += cleaned;
        displayResponseText += cleaned;
        pendingToolCallBuffer = null;
        stream.finalize(false);
        toolCalls = [];
      }
    } else {
      // ── Normal parse path ─────────────────────────────
      const parsed = parseResponse(rawText, result.stopReason);
      displayText = parsed.displayText;
      toolCalls = parsed.toolCalls;

      // Check for partial tool call that needs accumulation across continuations
      if (parsed.partial && shouldContinue(result)) {
        console.log('[AgenticLoop] Detected partial tool call — starting accumulation');
        pendingToolCallBuffer = rawText;
        continuationCount++;
        nextUserMessage = continuationMessage({ lastText: rawText, toolInProgress: true });
        stream.finalize(false);
        continue;
      }

      stream.finalize(result.stopReason === 'tool_call');
      fullResponseText += displayText;
      displayResponseText += displayText;
    }

    // ── Branch: Tool calls ────────────────────────────────
    if (toolCalls.length > 0) {
      const toolResultEntries = [];

      stream.toolExecuting(toolCalls.map(tc => ({ tool: tc.name, params: tc.arguments })));

      for (const toolCall of toolCalls) {
        if (isStale()) return { success: false, error: 'Request cancelled', text: fullResponseText };
        await waitWhilePaused();

        console.log(`[AgenticLoop]   Tool: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 100)})`);

        try {
          const toolResult = await mcpToolServer.executeTool(toolCall.name, toolCall.arguments);
          const entry = {
            tool: toolCall.name,
            params: toolCall.arguments,
            result: toolResult,
          };
          toolResultEntries.push(entry);

          // Record in tracking systems
          rollingSummary.recordToolCall(toolCall.name, toolCall.arguments, iteration);
          rollingSummary.recordToolResult(toolCall.name, toolCall.arguments, toolResult, iteration);
          summarizer.recordToolCall(toolCall.name, toolCall.arguments, toolResult);

          if (toolCall.name === 'write_todos' || toolCall.name === 'update_todo') {
            stream.todoUpdate(mcpToolServer._todos || []);
          }
        } catch (err) {
          const entry = {
            tool: toolCall.name,
            params: toolCall.arguments,
            result: { success: false, error: err.message },
          };
          toolResultEntries.push(entry);
          rollingSummary.recordToolCall(toolCall.name, toolCall.arguments, iteration);
          rollingSummary.recordToolResult(toolCall.name, toolCall.arguments, { error: err.message }, iteration);
          console.error(`[AgenticLoop]   Tool error (${toolCall.name}):`, err.message);
        }
      }

      // Track all results
      allToolResults.push(...toolResultEntries);

      // Emit tool results to UI
      stream.toolResults(toolResultEntries);

      // ── Budget-aware tool result assembly ────────────────
      // Use formatToolResults with context-size awareness
      const formattedResults = formatToolResults(toolResultEntries, { totalCtx });

      // Use tiered context assembly if we have enough history
      const contextPct = ctxUsed / totalCtx;
      if (rollingSummary.shouldInjectSummary(iteration, contextPct)) {
        const summaryBudget = rollingSummary.getSummaryBudget(totalCtx, contextPct);
        const assembledContext = rollingSummary.assembleTieredContext(
          summaryBudget > 0 ? summaryBudget : Math.floor(maxPromptTokens * 0.15),
          iteration,
          formattedResults
        );
        nextUserMessage = `${assembledContext}\n\nContinue with the task based on these results.`;
      } else {
        // Early iterations: just use formatted results directly
        // But cap to prevent overflow
        const maxResultTokens = Math.floor(maxPromptTokens * 0.7);
        const maxResultChars = maxResultTokens * 3.5;
        const cappedResults = formattedResults.length > maxResultChars
          ? formattedResults.slice(0, maxResultChars) + '\n...(results truncated)'
          : formattedResults;
        nextUserMessage = `Tool execution results:\n\n${cappedResults}\n\nContinue with the task based on these results.`;
      }
      continue;
    }

    // ── Branch: Continuation (maxTokens) ──────────────────
    if (shouldContinue(result)) {
      console.log('[AgenticLoop]   Continuation triggered (maxTokens hit)');
      continuationCount++;
      nextUserMessage = continuationMessage({ lastText: displayText || fullResponseText });
      continue;
    }

    // ── Branch: Natural completion ────────────────────────
    // Post-loop compaction: collapse intermediate entries
    postLoopCompaction(llmEngine, message, fullResponseText, chatHistoryPreLoopLen);

    // Optionally summarize for future context health
    if (shouldSummarize(ctxUsed, totalCtx, (llmEngine.chatHistory || []).length)) {
      console.log('[AgenticLoop]   Context usage high — summarizing');
      await summarizeHistory(llmEngine, stream, summarizer);
    }

    _reportTokenStats(totalTokensUsed, mainWindow);

    return {
      success: true,
      text: fullResponseText,
      stopReason: lastStopReason,
      model: llmEngine.modelInfo?.name || 'unknown',
    };
  }

  // ── Exceeded max iterations ─────────────────────────────
  // Post-loop compaction
  postLoopCompaction(llmEngine, message, fullResponseText, chatHistoryPreLoopLen);

  _reportTokenStats(totalTokensUsed, mainWindow);

  return {
    success: true,
    text: fullResponseText + '\n\n*[Reached maximum iterations]*',
    stopReason: 'maxIterations',
    model: llmEngine.modelInfo?.name || 'unknown',
  };
}

// ─── Utilities ──────────────────────────────────────────────

module.exports = { handleLocalChat };
