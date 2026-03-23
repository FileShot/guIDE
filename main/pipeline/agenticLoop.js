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
const { parseResponse, cleanTrailingArtifacts, extractContentFromPartialToolCall } = require('./responseParser');
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
const STUCK_THRESHOLD = 3;       // Same tool+params N times in a row = stuck
const CYCLE_MIN_REPEATS = 3;     // Pattern repeating N times = cycle

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

  // Apply tool toggles from frontend settings
  if (typeof mcpToolServer.setDisabledTools === 'function') {
    mcpToolServer.setDisabledTools(context?.disabledTools || []);
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

  // Get compact tool hint FIRST so we can measure its actual size for budget
  const toolHint = typeof mcpToolServer.getCompactToolHint === 'function'
    ? mcpToolServer.getCompactToolHint('general')
    : '';

  // Compute sysPromptReserve from ACTUAL measured sizes (not per-tool estimate)
  const toolHintTokens = estimateTokens(toolHint);
  const sysPromptReserve = Math.max(500, toolHintTokens + 600); // +600 for preamble + project context + buffer
  let maxPromptTokens = Math.max(totalCtx - sysPromptReserve - maxResponseTokens, 256);

  console.log(`[AgenticLoop] Context budget: total=${totalCtx}, sysReserve=${sysPromptReserve} (toolHint=${toolHintTokens}tok), maxPrompt=${maxPromptTokens}, maxResponse=${maxResponseTokens}`);

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
  let unclosedFenceRetries = 0;       // S7-9B: forced continuations for unclosed code blocks

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
      maxPromptTokens = Math.max(totalCtx - actualStaticTokens - maxResponseTokens, 256);
      console.log(`[AgenticLoop] sysReserve corrected ${sysPromptReserve}→${actualStaticTokens}. maxPromptTokens→${maxPromptTokens}`);
    }
  }

  // Merge sampling parameters — cap maxTokens to computed budget to prevent
  // node-llama-cpp from reserving more response tokens than the context supports
  const params = {
    maxTokens:     Math.min(context?.params?.maxTokens || maxResponseTokens, maxResponseTokens),
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
  let lastMidFence = false;          // S7-7: Persists midFence state for rotation anchoring
  let tokensSinceLastCtxEmit = 0;    // Throttle live context ring updates
  const recentToolSigs = [];         // Track tool call signatures for stuck/cycle detection
  const toolExecCache = new Map();   // Cross-iteration dedup: signature → { iteration, resultSummary }
  const DEDUP_EXEMPT_TOOLS = new Set(['write_file', 'append_to_file', 'edit_file', 'write_todos', 'update_todo', 'run_command', 'web_search', 'browser_navigate', 'browser_click', 'browser_type']);

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

      // FIX T07: If a write_file call was accumulating when rotation fired, anchor
      // the continuation so the model resumes the same file instead of starting fresh.
      // Without this the model loses all knowledge of the pending write_file and
      // generates an unrelated tool call on the next iteration.
      if (pendingToolCallBuffer !== null && pendingToolCallBuffer.length > 0) {
        const bufLen = pendingToolCallBuffer.length;
        const fileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
        const targetFile = fileMatch ? fileMatch[1] : 'the file';
        const bufTail = pendingToolCallBuffer.slice(-2500);
        nextUserMessage +=
          `\n\nIMPORTANT — IN-PROGRESS WRITE: You were in the middle of a write_file call for "${targetFile}" ` +
          `(${bufLen} chars generated so far). The context was rotated to free memory. ` +
          `You MUST continue that write_file call. Produce the COMPLETE remaining content ` +
          `and close all JSON properly so write_file can execute.\n` +
          `Last portion already generated:\n${bufTail}\n\nContinue from exactly where that stopped.`;
        console.log(`[AgenticLoop] Pre-check rotation: anchored write_file continuation for "${targetFile}" (${bufLen} chars in buffer)`);
      }

      // S7-7: Anchor inline code continuation through rotation.
      // When the model was mid-code-block (midFence detected in shouldContinue branch),
      // provide the tail of generated code so the model can continue from that point
      // instead of restarting from scratch.
      if (lastMidFence && fullResponseText.length > 0) {
        const codeTail = fullResponseText.slice(-2500);
        nextUserMessage +=
          `\n\nCRITICAL — You were in the middle of writing inline code (a markdown code block). ` +
          `You have already generated ${fullResponseText.length} characters. ` +
          `Here is the end of what you wrote:\n${codeTail}\n\n` +
          `Continue writing from EXACTLY where that code ends. ` +
          `Do NOT open a new code fence (you are already inside one). ` +
          `Do NOT restart the file from the beginning. ` +
          `Do NOT output \`\`\`html or any fence marker. ` +
          `Just continue the code directly from where it stopped.`;
        console.log(`[AgenticLoop] Pre-check rotation: anchored inline code continuation (${fullResponseText.length} chars generated)`);
        lastMidFence = false;
      } else if (!lastMidFence && continuationCount > 0 && fullResponseText.length > 0) {
        // Plain text continuation through rotation — provide tail for context
        const textTail = fullResponseText.slice(-1500);
        nextUserMessage +=
          `\n\nYou were in the middle of writing a response. ` +
          `Here is the end of what you wrote:\n${textTail}\n\n` +
          `Continue from exactly where that text ends. Do not repeat any content.`;
        console.log(`[AgenticLoop] Pre-check rotation: anchored plain text continuation (${fullResponseText.length} chars generated)`);
      }

      // Update system prompt in history
      llmEngine.chatHistory = [{ type: 'system', text: preCheck.prompt.systemContext }];

      if (preCheck.clearContinuation) continuationCount = 0;

      // Clear dedup cache — rotation means fresh context
      toolExecCache.clear();
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
    // When accumulating a tool call across continuations, preserve the stream's
    // tool-hold state so new tokens feed into the same llm-tool-generating event.
    // This keeps the UI code block alive across continuation boundaries.
    if (pendingToolCallBuffer !== null) {
      stream.continueToolHold();
    } else {
      stream.reset();
    }
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

        // Clear any pending tool call buffer — context is being rotated.
        // FIX T07: Capture write_file context BEFORE clearing so we can anchor
        // the continuation in nextUserMessage after rotation.
        let overflowPendingFileCtx = null;
        if (pendingToolCallBuffer !== null) {
          console.log('[AgenticLoop] Clearing pending tool call buffer due to context rotation');
          const bufLen = pendingToolCallBuffer.length;
          const fileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
          const targetFile = fileMatch ? fileMatch[1] : 'the file';
          const bufTail = pendingToolCallBuffer.slice(-2500);
          overflowPendingFileCtx = { bufLen, targetFile, bufTail };
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
          `Do NOT output any acknowledgment or summary — make forward progress immediately.\n` +
          `Do NOT redo completed work. Files listed in progress exist on disk. If a plan exists, it is already active — use update_todo, do NOT call write_todos.`;

        // FIX T07: Anchor any in-progress write_file so the model resumes it after rotation
        if (overflowPendingFileCtx) {
          const { bufLen, targetFile, bufTail } = overflowPendingFileCtx;
          nextUserMessage +=
            `\n\nIMPORTANT — IN-PROGRESS WRITE: You were in the middle of a write_file call for "${targetFile}" ` +
            `(${bufLen} chars generated so far). Context overflow forced a rotation. ` +
            `You MUST resume that write_file call. Produce the COMPLETE remaining content ` +
            `and close all JSON properly so write_file can execute.\n` +
            `Last portion already generated:\n${bufTail}\n\nContinue from exactly where that stopped.`;
          console.log(`[AgenticLoop] Overflow rotation: anchored write_file continuation for "${targetFile}" (${bufLen} chars in buffer)`);
        }

        // S7-7: Anchor inline code continuation through overflow rotation
        if (lastMidFence && fullResponseText.length > 0) {
          const codeTail = fullResponseText.slice(-2500);
          nextUserMessage +=
            `\n\nCRITICAL — You were in the middle of writing inline code (a markdown code block). ` +
            `You have already generated ${fullResponseText.length} characters. ` +
            `Here is the end of what you wrote:\n${codeTail}\n\n` +
            `Continue writing from EXACTLY where that code ends. ` +
            `Do NOT open a new code fence (you are already inside one). ` +
            `Do NOT restart the file from the beginning. ` +
            `Do NOT output \`\`\`html or any fence marker. ` +
            `Just continue the code directly from where it stopped.`;
          console.log(`[AgenticLoop] Overflow rotation: anchored inline code continuation (${fullResponseText.length} chars generated)`);
          lastMidFence = false;
        } else if (!lastMidFence && continuationCount > 0 && fullResponseText.length > 0) {
          const textTail = fullResponseText.slice(-1500);
          nextUserMessage +=
            `\n\nYou were in the middle of writing a response. ` +
            `Here is the end of what you wrote:\n${textTail}\n\n` +
            `Continue from exactly where that text ends. Do not repeat any content.`;
          console.log(`[AgenticLoop] Overflow rotation: anchored plain text continuation (${fullResponseText.length} chars generated)`);
        }

        // Prepend any partial response from before the overflow
        if (err.partialResponse) {
          fullResponseText += err.partialResponse;
          displayResponseText += err.partialResponse;
        }

        // Clear dedup cache — overflow rotation means fresh context
        toolExecCache.clear();

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
          nextUserMessage = continuationMessage({ 
            lastText: pendingToolCallBuffer, 
            toolInProgress: true,
            accumulatedBuffer: pendingToolCallBuffer,
            midFence: stream.isHoldingFenced?.() || false
          });
          // Do NOT finalize the stream — keep tool-hold state alive so the UI
          // code block continues receiving live content across continuations
          continue;
        }
      } else {
        // Natural stop but tool call still incomplete — preserve content from failed tool call
        console.log('[AgenticLoop] Accumulated buffer has no complete tool call — preserving content');

        // FIX T18: Reset stream BEFORE emitting extracted content so that
        // the stream is not in tool-hold state when we send llm-token events.
        // Previously stream.finalize(false) was called AFTER _send, which
        // triggered the false-positive recovery path in StreamHandler and dumped
        // the entire raw _toolCallJson buffer (~11K chars) as a second llm-token
        // event — causing tool JSON to appear inside the user's code block.
        stream.reset();
        toolCalls = [];

        // Try to extract the actual content from the failed write_file call
        const contentExtracted = extractContentFromPartialToolCall(pendingToolCallBuffer);
        if (contentExtracted && contentExtracted.length > 100) {
          // Substantial content found inside the failed tool call — emit it progressively.
          // FIX T19: Chunk delivery so the browser event loop can process the
          // invoke-reply WebSocket frame between chunks, preventing the UI from
          // getting stuck in "generating" state. Without chunking, a single
          // large llm-token event (~11K chars) blocked React's reconciliation
          // long enough that the invoke-reply frame sat unprocessed in the queue.
          console.log(`[AgenticLoop] Extracted ${contentExtracted.length} chars from failed tool call — emitting in chunks`);
          const CHUNK = 200;
          stream._send('llm-token', '\n\n[Tool call incomplete — content preserved:]\n');
          for (let i = 0; i < contentExtracted.length; i += CHUNK) {
            stream._send('llm-token', contentExtracted.slice(i, i + CHUNK));
            if (i + CHUNK < contentExtracted.length) {
              await new Promise(r => setImmediate(r)); // yield to event loop between chunks
            }
          }
          fullResponseText += '\n\n[Tool call incomplete — content preserved:]\n' + contentExtracted;
          displayResponseText += '\n\n[Tool call incomplete — content preserved:]\n' + contentExtracted;
        } else {
          // No extractable content — fall back to cleaned artifacts
          const cleaned = cleanTrailingArtifacts(pendingToolCallBuffer);
          fullResponseText += cleaned;
          displayResponseText += cleaned;
        }

        pendingToolCallBuffer = null;
        // NOTE: stream.finalize() is intentionally NOT called here.
        // stream.reset() above already cleared all hold state. Calling finalize
        // now would re-dump _toolCallJson (empty at this point but defensive).
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
        nextUserMessage = continuationMessage({ 
          lastText: rawText, 
          toolInProgress: true,
          accumulatedBuffer: rawText,
          midFence: stream.isHoldingFenced?.() || false
        });
        // Do NOT finalize — stream is holding the tool call content and should
        // keep emitting llm-tool-generating events across continuation boundaries
        continue;
      }

      stream.finalize(toolCalls.length > 0);
      fullResponseText += toolCalls.length > 0 ? displayText : rawText;
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

        // ── Cross-iteration dedup: skip if same tool+params ran within last 2 iterations ──
        let dedupHit = false;
        if (!DEDUP_EXEMPT_TOOLS.has(toolCall.name)) {
          const sig = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
          const cached = toolExecCache.get(sig);
          if (cached && (iteration - cached.iteration) <= 2) {
            console.log(`[AgenticLoop]   Dedup: ${toolCall.name} already ran in iteration ${cached.iteration} — returning cached summary`);
            const entry = {
              tool: toolCall.name,
              params: toolCall.arguments,
              result: { content: `(Previously executed in iteration ${cached.iteration}. Result: ${cached.resultSummary})` },
            };
            toolResultEntries.push(entry);
            rollingSummary.recordToolCall(toolCall.name, toolCall.arguments, iteration);
            dedupHit = true;
          }
        }
        if (dedupHit) continue;

        try {
          const toolResult = await mcpToolServer.executeTool(toolCall.name, toolCall.arguments);
          const entry = {
            tool: toolCall.name,
            params: toolCall.arguments,
            result: toolResult,
          };
          toolResultEntries.push(entry);

          // Cache result for cross-iteration dedup
          if (!DEDUP_EXEMPT_TOOLS.has(toolCall.name)) {
            const sig = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
            const summary = typeof toolResult === 'string' ? toolResult.slice(0, 200) :
              (toolResult?.content ? String(toolResult.content).slice(0, 200) : 'OK');
            toolExecCache.set(sig, { iteration, resultSummary: summary });
          }

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

      // ── Stuck/cycle detection ───────────────────────────
      // Track tool call signatures and detect repetitive patterns
      for (const tr of toolResultEntries) {
        const paramsHash = JSON.stringify(tr.params || {}).substring(0, 400);
        recentToolSigs.push({ tool: tr.tool, paramsHash });
      }
      if (recentToolSigs.length > 20) recentToolSigs.splice(0, recentToolSigs.length - 20);

      let stuckDetected = false;
      if (recentToolSigs.length >= STUCK_THRESHOLD) {
        const last = recentToolSigs[recentToolSigs.length - 1];
        const tail = recentToolSigs.slice(-STUCK_THRESHOLD);
        if (tail.every(tc => tc.tool === last.tool && tc.paramsHash === last.paramsHash)) {
          console.log(`[AgenticLoop] Stuck: ${last.tool} called ${STUCK_THRESHOLD}+ times with identical params`);
          stuckDetected = true;
        }
      }

      if (!stuckDetected && recentToolSigs.length >= 8) {
        for (let cycleLen = 2; cycleLen <= 4; cycleLen++) {
          if (recentToolSigs.length < cycleLen * CYCLE_MIN_REPEATS) continue;
          const sigs = recentToolSigs.map(tc => `${tc.tool}:${tc.paramsHash}`);
          const lastCycle = sigs.slice(-cycleLen);
          let repeats = 0;
          for (let pos = sigs.length - cycleLen; pos >= 0; pos -= cycleLen) {
            const segment = sigs.slice(pos, pos + cycleLen);
            if (segment.join(',') === lastCycle.join(',')) repeats++;
            else break;
          }
          if (repeats >= CYCLE_MIN_REPEATS) {
            const sig = recentToolSigs.slice(-cycleLen).map(tc => tc.tool).join(' → ');
            console.log(`[AgenticLoop] Cycle detected: [${sig}] x${repeats}`);
            stuckDetected = true;
            break;
          }
        }
      }

      // ── Budget-aware tool result assembly ────────────────
      // Use formatToolResults with context-size awareness
      const formattedResults = formatToolResults(toolResultEntries, { totalCtx });

      // If stuck/cycle detected, append redirect instruction
      const stuckSuffix = stuckDetected
        ? '\n\nWARNING: You are repeating the same tool calls in a loop. Stop and assess: is the task complete? If so, provide your final response without tool calls. If not, try a DIFFERENT approach.'
        : '';

      // Use tiered context assembly if we have enough history
      const contextPct = ctxUsed / totalCtx;
      if (rollingSummary.shouldInjectSummary(iteration, contextPct)) {
        const summaryBudget = rollingSummary.getSummaryBudget(totalCtx, contextPct);
        const assembledContext = rollingSummary.assembleTieredContext(
          summaryBudget > 0 ? summaryBudget : Math.floor(maxPromptTokens * 0.15),
          iteration,
          formattedResults
        );
        nextUserMessage = `${assembledContext}\n\nContinue with the task based on these results. Original request: ${message.substring(0, 300)}${stuckSuffix}`;
      } else {
        // Early iterations: just use formatted results directly
        // But cap to prevent overflow
        const maxResultTokens = Math.floor(maxPromptTokens * 0.7);
        const maxResultChars = maxResultTokens * 3.5;
        const cappedResults = formattedResults.length > maxResultChars
          ? formattedResults.slice(0, maxResultChars) + '\n...(results truncated)'
          : formattedResults;
        nextUserMessage = `Tool execution results:\n\n${cappedResults}\n\nContinue with the task based on these results. Original request: ${message.substring(0, 300)}${stuckSuffix}`;
      }

      // If stuck detected, also clear the recent sigs so detection resets
      if (stuckDetected) recentToolSigs.length = 0;

      continue;
    }

    // ── Branch: Continuation (maxTokens) ──────────────────
    if (shouldContinue(result)) {
      console.log('[AgenticLoop]   Continuation triggered (maxTokens hit)');
      continuationCount++;
      // Detect if the response ended inside a fenced code block (odd count of ``` lines)
      const responseText = displayText || fullResponseText;
      const fenceCount = (responseText.match(/^```/gm) || []).length;
      const midFence = fenceCount % 2 !== 0;
      if (midFence) console.log('[AgenticLoop]   Mid-fence detected — response was inside a code block');
      lastMidFence = midFence;  // S7-7: persist for rotation anchoring
      nextUserMessage = continuationMessage({ lastText: responseText, midFence });
      continue;
    }

    // ── S7-9B: Natural stop with unclosed code fence → force continuation ──
    // If the model emitted eogToken but the accumulated response has an unclosed
    // code block (odd fence parity), the file is incomplete. Force continuation
    // so the model can complete and close the block. Safety-limited to 3 retries.
    {
      const fenceLines = (fullResponseText.match(/^```/gm) || []).length;
      if (fenceLines % 2 !== 0 && unclosedFenceRetries < 3) {
        console.log(`[AgenticLoop]   Natural stop with unclosed code fence (${fenceLines} fences) — forcing continuation (retry ${unclosedFenceRetries + 1}/3)`);
        unclosedFenceRetries++;
        continuationCount++;
        lastMidFence = true;
        nextUserMessage = continuationMessage({ lastText: fullResponseText, midFence: true });
        continue;
      }
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
      toolResults: allToolResults,
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
    toolResults: allToolResults,
  };
}

// ─── Utilities ──────────────────────────────────────────────

module.exports = { handleLocalChat };
