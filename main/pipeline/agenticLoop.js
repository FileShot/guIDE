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
  postLoopCompaction,
  shouldSummarize,
  summarizeHistory,
} = require('./contextManager');
const { shouldContinue, continuationMessage } = require('./continuationHandler');
const { buildSystemPrompt, formatToolResults } = require('./promptAssembler');
const { RollingSummary, estimateTokens } = require('./rollingSummary');
const { ConversationSummarizer } = require('./conversationSummarizer');
const { nativeContextShiftStrategy } = require('./nativeContextStrategy');

// ─── Constants ──────────────────────────────────────────────
const WALL_CLOCK_MS   = 30 * 60 * 1000; // 30 min hard limit
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

  // Use the compact preamble for ALL models — it has the most explicit tool-use
  // instructions and works for every model size from 0.5B to 200B.
  // No size-based branching — one preamble for all.
  const basePreamble = ctx.DEFAULT_COMPACT_PREAMBLE || ctx.DEFAULT_SYSTEM_PREAMBLE;

  // Calculate budget splits — sysPromptReserve accounts for ACTUAL preamble size + tool definitions
  // generationMaxTokens: actual cap passed to node-llama-cpp — set to totalCtx so the model
  // generates freely and native context shift handles KV management mid-generation.
  // budgetResponseTokens: used only for prompt assembly budget calculations.
  const generationMaxTokens = totalCtx;
  const budgetResponseTokens = Math.min(Math.floor(totalCtx * 0.25), 4096);
  const toolCount = typeof mcpToolServer.getToolDefinitions === 'function' ? mcpToolServer.getToolDefinitions().length : 20;
  const preambleTokens = estimateTokens(basePreamble || '');
  const sysPromptReserve = Math.min(
    Math.floor(totalCtx * 0.4),  // Never more than 40% of total context
    Math.max(1500, preambleTokens + toolCount * 80),
  );
  let maxPromptTokens = Math.max(totalCtx - sysPromptReserve - budgetResponseTokens, 256);

  console.log(`[AgenticLoop] Context budget: total=${totalCtx}, sysReserve=${sysPromptReserve}, maxPrompt=${maxPromptTokens}, genMaxTokens=${generationMaxTokens}`);

  // Get compact tool hint (returns array of strings for incremental assembly)
  const toolHint = typeof mcpToolServer.getCompactToolHint === 'function'
    ? mcpToolServer.getCompactToolHint('general')
    : [];

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
      maxPromptTokens = Math.max(totalCtx - actualStaticTokens - budgetResponseTokens, 256);
      console.log(`[AgenticLoop] sysReserve corrected ${sysPromptReserve}→${actualStaticTokens}. maxPromptTokens→${maxPromptTokens}`);
    }
  }

  // Merge sampling parameters — native context shift manages KV during generation,
  // so maxTokens is set to generationMaxTokens (= totalCtx) allowing the model to
  // generate freely. The KV cache shifts seamlessly mid-generation when full.
  const params = {
    maxTokens:     Math.min(context?.params?.maxTokens || generationMaxTokens, generationMaxTokens),
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
  let suppressStream = false;        // When true, suppress token streaming to UI during post-rotation accumulation

  let tokensSinceLastCtxEmit = 0;    // Throttle live context ring updates
  let rotationCheckpoint = null;     // { filePath, content } — saved to disk during rotation for regression protection
  let lastContCheckpointLen = 0;     // Track bytes already checkpointed from current tool call accumulation (prevent double-save)
  let d6ConsecutiveSmallAppends = 0; // Fix 9: Track consecutive tiny D6 appends to detect infinite-loop completion signal
  let d6CumulativeMetrics = null;    // Fix D: Track cumulative D6 productivity { iterations, totalNewLines, lastContent }
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

    // ── Context stats (informational) ─────────────────────
    // With Solution A active, context management is handled natively by
    // node-llama-cpp via nativeContextStrategy.js. No proactive rotation needed.
    // The context shift fires automatically when context fills during generation.
    try {
      const seq = llmEngine.sequence;
      if (seq?.nextTokenIndex) {
        const pct = (seq.nextTokenIndex / totalCtx * 100).toFixed(1);
        console.log(`[AgenticLoop] Context: ${seq.nextTokenIndex}/${totalCtx} (${pct}%) — native contextShift active`);
      }
    } catch (_) {}

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

    // FIX 8: Always clear suppressStream before generating.
    // suppressStream is set to true during rotation/overflow bookkeeping (lines 305, 449)
    // to prevent tokens from flowing while context is being rebuilt. But it was never
    // cleared before the next generateStream, causing ALL tokens after any rotation to be
    // silently dropped by the token callback gate. Clearing it here means suppressStream
    // only affects the brief rotation bookkeeping period, not actual generation output.
    if (suppressStream) {
      console.log('[AgenticLoop] FIX 8: Clearing suppressStream before generation');
      suppressStream = false;
    }

    // ── Pre-generation context check (Solution A safety net) ──────
    // With generationMaxTokens = totalCtx, native context shift fires mid-generation
    // when KV fills. This check is only needed to prevent history alone from exceeding
    // contextSize (which would cause node-llama-cpp's own pre-gen compression to run
    // instead of ours). Threshold: 90% of context = only compress when history is
    // about to overflow, not just "leaving room for response."
    {
      let historyEstTokens = 0;
      for (const entry of llmEngine.chatHistory) {
        if (entry.type === 'model' && entry.response) {
          for (const seg of entry.response) {
            historyEstTokens += Math.ceil(
              (typeof seg === 'string' ? seg.length : JSON.stringify(seg).length) / 3.5
            );
          }
        } else if (entry.text) {
          historyEstTokens += Math.ceil(entry.text.length / 3.5);
        }
      }

      const threshold = Math.floor(totalCtx * 0.90);

      if (historyEstTokens > threshold && llmEngine.chatHistory.length > 3) {
        console.log(`[AgenticLoop] Pre-gen compression: est ${historyEstTokens} hist > ${threshold} threshold (${(historyEstTokens / totalCtx * 100).toFixed(1)}% of ctx)`);
        try {
          const compressed = await nativeContextShiftStrategy({
            chatHistory: llmEngine.chatHistory,
            maxTokensCount: Math.floor(totalCtx * 0.70),
            tokenizer: null,
            chatWrapper: null,
            lastShiftMetadata: null,
          });

          if (compressed && compressed.chatHistory && compressed.chatHistory.length > 0) {
            const newEst = compressed.chatHistory.reduce((sum, entry) => {
              if (entry.type === 'model' && entry.response) {
                for (const seg of entry.response) {
                  sum += Math.ceil((typeof seg === 'string' ? seg.length : JSON.stringify(seg).length) / 3.5);
                }
              } else if (entry.text) {
                sum += Math.ceil(entry.text.length / 3.5);
              }
              return sum;
            }, 0);
            llmEngine.chatHistory = compressed.chatHistory;
            llmEngine.lastEvaluation = null;
            // Reset small-append counter: post-compression short output is expected (lost context), not a stuck loop
            d6ConsecutiveSmallAppends = 0;
            console.log(`[AgenticLoop] Pre-gen compression done: ${historyEstTokens}->${newEst} tokens, ${compressed.chatHistory.length} items (dropped ${compressed.metadata?.droppedCount || '?'})`);
          }
        } catch (err) {
          console.log(`[AgenticLoop] Pre-gen compression failed: ${err.message}`);
        }
      }
    }

    let result;
    try {
      result = await llmEngine.generateStream(
        { userMessage: nextUserMessage },
        { ...params, replaceLastUser: false },
        (token) => {
          if (!suppressStream) stream.onToken(token);
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

      // With Solution A (pre-gen context check + native contextShift strategy),
      // CONTEXT_OVERFLOW should not occur. If it does, log it as unexpected
      // and return gracefully with whatever was generated so far.
      if (errMsg.startsWith('CONTEXT_OVERFLOW:')) {
        console.error(`[AgenticLoop] UNEXPECTED CONTEXT_OVERFLOW at iteration ${iteration} — Solution A pre-gen check should have prevented this. History may have grown between check and generation.`);
        stream.finalize(false);
        if (err.partialResponse) {
          fullResponseText += err.partialResponse;
          displayResponseText += err.partialResponse;
        }
        break; // Exit loop with whatever we have
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
    // Content visibility logging: show what model produced this iteration
    if (rawText.length > 0) {
      const rHead = rawText.slice(0, 150).replace(/\n/g, '\\n');
      const rTail = rawText.slice(-150).replace(/\n/g, '\\n');
      console.log(`[AgenticLoop] Raw output (${rawText.length} chars) HEAD: ${rHead}`);
      if (rawText.length > 300) console.log(`[AgenticLoop] Raw output TAIL: ${rTail}`);
    }
    let displayText, toolCalls;

    // ── Tool call accumulation across continuations ───────
    // When a tool call (e.g. write_file with large content) is truncated
    // by maxTokens, we accumulate the raw text across continuations until
    // the complete tool call can be parsed and executed.
    if (pendingToolCallBuffer !== null) {
      // ── FIX I: Detect non-file-writing tool calls during accumulation ──
      // When the model outputs a tool like read_file, search, etc. during
      // accumulation of a write_file buffer, do NOT append it to the buffer.
      // Instead: save accumulated content to disk, execute the new tool separately,
      // and clear the buffer.
      const nonFileToolMatch = rawText.match(/(?:```json\s*\n?\s*)?\{\s*"tool"\s*:\s*"(?!write_file|append_to_file|edit_file)([^"]+)"/);
      if (nonFileToolMatch && pendingToolCallBuffer.length > 500) {
        console.log(`[AgenticLoop] Non-file tool "${nonFileToolMatch[1]}" during accumulation — saving buffer and executing tool separately`);
        // Save accumulated partial content to disk
        const _saveFileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
        const _saveTargetFile = _saveFileMatch ? _saveFileMatch[1] : null;
        const _saveContent = extractContentFromPartialToolCall(pendingToolCallBuffer);
        if (_saveContent && _saveTargetFile && _saveContent.length > 100) {
          if (!rotationCheckpoint || _saveTargetFile !== rotationCheckpoint.filePath ||
              _saveContent.length >= rotationCheckpoint.content.length) {
            try {
              await mcpToolServer.executeTool('write_file', { filePath: _saveTargetFile, content: _saveContent });
              rotationCheckpoint = { filePath: _saveTargetFile, content: _saveContent };
              console.log(`[AgenticLoop] Saved accumulated buffer before non-file tool: ${_saveContent.length} chars to "${_saveTargetFile}"`);
              stream.fileAccUpdate(_saveTargetFile, _saveContent);
            } catch (e) {
              console.log(`[AgenticLoop] Failed to save accumulated buffer: ${e.message}`);
            }
          }
        }
        // Parse and execute the non-file tool call INLINE — do NOT null buffer
        // or finalize the stream. The previous code killed the buffer and called
        // stream.finalize(true) here, which closed the code block in the UI.
        // The next iteration then entered normal parse path and started a fresh
        // code block from scratch — the persistent "code block reset" bug.
        // Instead: execute the tool, feed result back, keep buffer alive, continue.
        const nonFileParsed = parseResponse(rawText, result.stopReason);
        let nonFileToolResult = null;
        if (nonFileParsed.toolCalls.length > 0) {
          const tc = nonFileParsed.toolCalls[0];
          try {
            nonFileToolResult = await mcpToolServer.executeTool(tc.name, tc.arguments);
            console.log(`[AgenticLoop] Non-file tool "${tc.name}" executed inline (result: ${JSON.stringify(nonFileToolResult).slice(0, 200)})`);
            rollingSummary.recordToolCall(tc.name, tc.arguments, iteration);
          } catch (e) {
            nonFileToolResult = { content: `Error: ${e.message}` };
            console.log(`[AgenticLoop] Non-file tool "${tc.name}" inline execution failed: ${e.message}`);
          }
        }
        // Keep buffer alive, keep stream in tool-hold mode, clear suppressStream
        // so new tokens flow to the frontend (un-freeze the code block).
        lastContCheckpointLen = rotationCheckpoint ? rotationCheckpoint.content.length : 0;
        suppressStream = false;
        // Build continuation with tool result so model can resume writing
        const _nftFileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
        const _nftTargetFile = _nftFileMatch ? _nftFileMatch[1] : null;
        const ckLines = rotationCheckpoint ? (rotationCheckpoint.content.match(/\n/g) || []).length + 1 : 0;
        const toolResultStr = nonFileToolResult ? JSON.stringify(nonFileToolResult).slice(0, 3000) : '(no result)';
        nextUserMessage = `Original task: ${message.slice(0, 300)}\nTool result for ${nonFileParsed.toolCalls?.[0]?.name || 'unknown'}: ${toolResultStr}\n\n` +
          `File "${_nftTargetFile}" has ${ckLines} lines on disk. Continue writing where you left off using append_to_file. Do NOT restart the file with write_file.`;
        continue; // next iteration — buffer stays alive, stream stays in tool-hold
      }
      // D6 FIX: Detect when the model started a brand-new tool call instead of
      // continuing the existing one (common after context rotation).
      // CRITICAL: Before discarding the old buffer, save its content to disk.
      // The rotation checkpoint does NOT always fire (only at >70% context),
      // so the old buffer's content can be lost if we just discard it.
      else {
      const newToolCallMatch = rawText.match(/```json\s*\n?\s*\{\s*"tool"\s*:\s*"(write_file|append_to_file|edit_file)"/)
        || rawText.match(/^\s*\{\s*"tool"\s*:\s*"(write_file|append_to_file|edit_file)"/);
      if (newToolCallMatch && pendingToolCallBuffer.length > 500) {
        const newToolName = newToolCallMatch[1];
        const oldFileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
        const oldTargetFile = oldFileMatch ? oldFileMatch[1] : null;
        const newFileMatch = rawText.match(/"filePath"\s*:\s*"([^"]+)"/);
        const newTargetFile = newFileMatch ? newFileMatch[1] : null;

        // FIX 3: When model outputs append_to_file for the SAME file during accumulation
        // of a write_file, merge the content: save old buffer, execute append, keep suppressed.
        if (newToolName === 'append_to_file' && oldTargetFile && newTargetFile === oldTargetFile) {
          console.log(`[AgenticLoop] D6: append_to_file for same file "${oldTargetFile}" during write_file accumulation — merging`);
          // Save old write_file content to disk first
          const oldContent = extractContentFromPartialToolCall(pendingToolCallBuffer);
          if (oldContent && oldContent.length > 100) {
            if (!rotationCheckpoint || oldTargetFile !== rotationCheckpoint.filePath ||
                oldContent.length >= rotationCheckpoint.content.length) {
              try {
                await mcpToolServer.executeTool('write_file', { filePath: oldTargetFile, content: oldContent });
                rotationCheckpoint = { filePath: oldTargetFile, content: oldContent };
                console.log(`[AgenticLoop] Saved write_file buffer before append merge: ${oldContent.length} chars to "${oldTargetFile}"`);
                stream.fileAccUpdate(oldTargetFile, oldContent);
                // Fix F: Track D6 tool executions so they appear in final message rendering
                allToolResults.push({ tool: 'write_file', params: { filePath: oldTargetFile, content: oldContent }, result: { success: true } });
              } catch (e) {
                console.log(`[AgenticLoop] Failed to save write buffer before append merge: ${e.message}`);
              }
            }
          }
          // Execute the append_to_file
          let appendContent = extractContentFromPartialToolCall(rawText);
          if (appendContent) {
            // Fix H: Overlap detection — strip leading lines that duplicate the tail of existing content
            if (rotationCheckpoint && rotationCheckpoint.content) {
              const existingTail = rotationCheckpoint.content.split('\n').slice(-30).map(l => l.trim()).filter(l => l.length > 3);
              const appendLines = appendContent.split('\n');
              let skipCount = 0;
              for (let i = 0; i < Math.min(appendLines.length, 30); i++) {
                const trimmed = appendLines[i].trim();
                if (trimmed.length > 3 && existingTail.includes(trimmed)) {
                  skipCount = i + 1;
                } else {
                  break;
                }
              }
              if (skipCount > 0) {
                appendContent = appendLines.slice(skipCount).join('\n');
                console.log(`[AgenticLoop] D6 overlap: skipped ${skipCount} overlapping leading lines`);
              }
            }
            try {
              await mcpToolServer.executeTool('append_to_file', { filePath: newTargetFile, content: appendContent });
              if (rotationCheckpoint && rotationCheckpoint.filePath === newTargetFile) {
                rotationCheckpoint.content += appendContent;
              }
              console.log(`[AgenticLoop] Merged append: appended ${appendContent.length} chars to "${newTargetFile}" (checkpoint now ${rotationCheckpoint?.content?.length || 0} chars)`);
              stream.fileAccUpdate(newTargetFile, rotationCheckpoint?.content || appendContent);
              // Fix F: Track D6 appends so they appear in final message rendering
              allToolResults.push({ tool: 'append_to_file', params: { filePath: newTargetFile, content: appendContent }, result: { success: true } });
            } catch (e) {
              console.log(`[AgenticLoop] Failed to execute append merge: ${e.message}`);
            }
          }
          // Keep pendingToolCallBuffer alive so the next iteration enters the accumulation
          // branch (which calls stream.continueToolHold() — keeping the UI code block alive).
          // DO NOT null it — nulling causes the next iteration to enter the normal parse path
          // which calls stream.reset(), killing the code block.
          // DO clear suppressStream so new tokens from subsequent iterations flow to the frontend.
          // Previously suppressStream was kept true here, causing permanent freeze at the
          // line count where the first rotation fired.
          lastContCheckpointLen = rotationCheckpoint ? rotationCheckpoint.content.length : 0;
          suppressStream = false;

          // Fix 9 + Fix D: Detect D6 loop termination.
          // Three conditions trigger finalization:
          //   (a) HTML/XML completion signal: content ends with </html>, </svg>, etc.
          //   (b) Consecutive small appends: 5+ appends under the size threshold
          //   (c) Fix D: Cumulative D6 iterations with low unique content — if 4+ D6
          //       iterations have produced fewer than 50 new unique lines total, the
          //       model is stuck repeating closing tags or tiny fragments.
          const appendTrimmed = appendContent ? appendContent.trim() : '';
          const isHtmlComplete = appendContent && appendContent.length < 600 &&
            (appendTrimmed.endsWith('</html>') || appendTrimmed.endsWith('</svg>') ||
             appendTrimmed.match(/<\/html>\s*$/) !== null);

          // Fix D: Track cumulative D6 metrics instead of just char count
          if (!d6CumulativeMetrics) {
            d6CumulativeMetrics = { iterations: 0, totalNewLines: 0, lastContent: '' };
          }
          d6CumulativeMetrics.iterations++;
          const newUniqueLines = appendContent
            ? appendContent.split('\n').filter(l => l.trim().length > 0 && !d6CumulativeMetrics.lastContent.includes(l.trim())).length
            : 0;
          d6CumulativeMetrics.totalNewLines += newUniqueLines;
          d6CumulativeMetrics.lastContent = rotationCheckpoint?.content || '';

          // Original small-append counter (raised threshold to 500 to catch more cases)
          if (appendContent && appendContent.length < 500) {
            d6ConsecutiveSmallAppends++;
          } else {
            d6ConsecutiveSmallAppends = 0;
          }
          const isSmallAppendLoop = d6ConsecutiveSmallAppends >= 5;
          // Fix D: Low-productivity loop — 4+ iterations with very few unique lines
          const isLowProductivity = d6CumulativeMetrics.iterations >= 4 &&
            d6CumulativeMetrics.totalNewLines < 50;

          if (isHtmlComplete || isSmallAppendLoop || isLowProductivity) {
            const finalLines = rotationCheckpoint ? (rotationCheckpoint.content.match(/\n/g) || []).length + 1 : 0;
            const reason = isHtmlComplete
              ? `completion signal (${appendContent?.length || 0} chars)`
              : isLowProductivity
                ? `low-productivity loop (${d6CumulativeMetrics.iterations} iters, ${d6CumulativeMetrics.totalNewLines} unique lines)`
                : `consecutive small-append loop (${d6ConsecutiveSmallAppends} appends, threshold=5)`;
            console.log(`[AgenticLoop] Fix9/D: D6 file done — ${reason} — finalizing "${newTargetFile}" (${finalLines} lines)`);
            pendingToolCallBuffer = null;
            lastContCheckpointLen = 0;
            d6ConsecutiveSmallAppends = 0;
            d6CumulativeMetrics = null;
            stream.finalize(true);
            const doneMsg = `\n\n[File "${newTargetFile}" written (${finalLines} lines)]\n`;
            stream._send('llm-token', doneMsg);
            fullResponseText += doneMsg;
            displayResponseText += doneMsg;
            break; // Exit agentic loop — file is complete
          }

          // Build continuation message telling model to keep going
          // Fix B: Include original task goal so model knows what remains after compression
          const ckLines = rotationCheckpoint ? (rotationCheckpoint.content.match(/\n/g) || []).length + 1 : 0;
          let d6ContMsg = `Original task: ${message.slice(0, 200)}\nFile "${newTargetFile}" has ${ckLines} lines. Respond ONLY with append_to_file — no explanatory text. Continue from where the file left off.`;
          if (rotationCheckpoint && rotationCheckpoint.content) {
            const ckContentLines = rotationCheckpoint.content.split('\n');
            const tailLines = ckContentLines.slice(-15).join('\n');
            d6ContMsg += `\nLast 15 lines of file:\n${tailLines}\nContinue IMMEDIATELY after this content.`;
          }
          nextUserMessage = d6ContMsg;
          continue; // next iteration
        }

        // SAVE old buffer content before discarding (original D6 path — different file or write_file restart)
        const oldToolMatch = pendingToolCallBuffer.match(/"tool"\s*:\s*"(write_file|append_to_file)"/);
        const oldToolName = oldToolMatch ? oldToolMatch[1] : 'write_file';
        const oldContent = extractContentFromPartialToolCall(pendingToolCallBuffer);
        if (oldContent && oldTargetFile && oldContent.length > 100) {
          if (oldToolName === 'append_to_file') {
            // Append content was never saved — execute it now
            try {
              await mcpToolServer.executeTool('append_to_file', { filePath: oldTargetFile, content: oldContent });
              console.log(`[AgenticLoop] Saved discarded append buffer: appended ${oldContent.length} chars to "${oldTargetFile}"`);
              // Update checkpoint with combined content
              if (rotationCheckpoint && rotationCheckpoint.filePath === oldTargetFile) {
                rotationCheckpoint.content += oldContent;
              }
              stream.fileAccUpdate(oldTargetFile, rotationCheckpoint?.filePath === oldTargetFile ? rotationCheckpoint.content : oldContent);
            } catch (e) {
              console.log(`[AgenticLoop] Failed to save discarded append buffer: ${e.message}`);
            }
          } else if (oldToolName === 'write_file') {
            // Write — use monotonic checkpoint protection
            if (!rotationCheckpoint || oldTargetFile !== rotationCheckpoint.filePath ||
                oldContent.length >= rotationCheckpoint.content.length) {
              try {
                await mcpToolServer.executeTool('write_file', { filePath: oldTargetFile, content: oldContent });
                rotationCheckpoint = { filePath: oldTargetFile, content: oldContent };
                console.log(`[AgenticLoop] Saved discarded write buffer: wrote ${oldContent.length} chars to "${oldTargetFile}"`);
                stream.fileAccUpdate(oldTargetFile, oldContent);
              } catch (e) {
                console.log(`[AgenticLoop] Failed to save discarded write buffer: ${e.message}`);
              }
            } else {
              console.log(`[AgenticLoop] Skipped discarded write buffer (${oldContent.length} < checkpoint ${rotationCheckpoint.content.length})`);
            }
          }
        }
        console.log(`[AgenticLoop] New tool call detected during accumulation — restarting buffer (old=${pendingToolCallBuffer.length}, new=${rawText.length} chars)`);
        pendingToolCallBuffer = rawText;
      } else {
        // Normal case: no new tool call detected, just append
        pendingToolCallBuffer += rawText;
      }

      // Parse accumulated buffer — check if tool call is now complete
      if (pendingToolCallBuffer !== null) {
        const accResult = parseResponse(pendingToolCallBuffer, result.stopReason);

        if (accResult.toolCalls.length > 0) {
          // Complete tool call found in accumulated buffer
          console.log(`[AgenticLoop] Accumulated tool call complete (${pendingToolCallBuffer.length} chars over ${continuationCount} continuations)`);
          displayText = accResult.displayText;
          toolCalls = accResult.toolCalls;
          pendingToolCallBuffer = null;
          lastContCheckpointLen = 0;
          suppressStream = false;  // FIX F: Re-enable stream for tool results
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
            lastContCheckpointLen = 0;
            suppressStream = false;  // FIX F: Re-enable stream
            stream.finalize(false);
            toolCalls = [];
          } else {
            continuationCount++;
            console.log(`[AgenticLoop]   Continuation (tool call accumulation, ${pendingToolCallBuffer.length} chars)`);

            // ── BUG A FIX: Always checkpoint partial tool call to disk ──
            // Previously, checkpoint saves only happened during rotation (>70% context).
            // If context stayed below threshold, content lived only in memory. When
            // contextShift removed old messages during the next generation, or the model
            // started a new tool call, the content was lost. Now we save at EVERY
            // continuation point. Uses write_file to overwrite with full extracted content
            // (accumulated buffer always contains the complete content so far).
            const _ckFileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
            const _ckTargetFile = _ckFileMatch ? _ckFileMatch[1] : null;
            const _ckToolMatch = pendingToolCallBuffer.match(/"tool"\s*:\s*"(write_file|append_to_file)"/);
            const _ckToolName = _ckToolMatch ? _ckToolMatch[1] : null;
            const _ckContent = extractContentFromPartialToolCall(pendingToolCallBuffer);

            if (_ckContent && _ckTargetFile && _ckContent.length > 100 && _ckContent.length > lastContCheckpointLen) {
              try {
                if (_ckToolName === 'append_to_file' && rotationCheckpoint &&
                    rotationCheckpoint.filePath === _ckTargetFile) {
                  // Append delta since last checkpoint
                  const delta = _ckContent.slice(lastContCheckpointLen);
                  if (delta.length > 0) {
                    await mcpToolServer.executeTool('append_to_file', { filePath: _ckTargetFile, content: delta });
                    rotationCheckpoint.content += delta;
                    console.log(`[AgenticLoop] Continuation checkpoint: appended ${delta.length} chars to "${_ckTargetFile}" (total: ${rotationCheckpoint.content.length})`);
                    stream.fileAccUpdate(_ckTargetFile, rotationCheckpoint.content);
                  }
                } else {
                  // write_file — overwrite with full content (monotonic protection)
                  if (!rotationCheckpoint || _ckTargetFile !== rotationCheckpoint.filePath ||
                      _ckContent.length >= rotationCheckpoint.content.length) {
                    await mcpToolServer.executeTool('write_file', { filePath: _ckTargetFile, content: _ckContent });
                    rotationCheckpoint = { filePath: _ckTargetFile, content: _ckContent };
                    console.log(`[AgenticLoop] Continuation checkpoint: wrote ${_ckContent.length} chars to "${_ckTargetFile}"`);
                    stream.fileAccUpdate(_ckTargetFile, _ckContent);
                  } else {
                    console.log(`[AgenticLoop] Continuation checkpoint skipped (${_ckContent.length} < existing ${rotationCheckpoint.content.length})`);
                  }
                }
                lastContCheckpointLen = _ckContent.length;
              } catch (e) {
                console.log(`[AgenticLoop] Continuation checkpoint failed: ${e.message}`);
              }
            }

            // ── BUG B FIX: Pass filename to continuation message ──
            nextUserMessage = continuationMessage({ 
              lastText: pendingToolCallBuffer, 
              toolInProgress: true,
              accumulatedBuffer: pendingToolCallBuffer,
              midFence: stream.isHoldingFenced?.() || false,
              fileName: _ckTargetFile,
              taskGoal: message,
              fileProgress: rotationCheckpoint ? `${(rotationCheckpoint.content.match(/\n/g) || []).length + 1} lines on disk` : undefined,
            });
            // Do NOT finalize the stream — keep tool-hold state alive so the UI
            // code block continues receiving live content across continuations
            continue;
          }
        } else {
          // Natural stop but tool call still incomplete — preserve content from failed tool call
          console.log('[AgenticLoop] Accumulated buffer has no complete tool call — preserving content');
          suppressStream = false;  // FIX F: Re-enable stream for content extraction output

          // FIX T18: Reset stream state BEFORE sending any content tokens,
          // to prevent leftover tool-hold from blocking the llm-token events.
          stream.reset();
          toolCalls = [];

          // Try to extract the actual content from the failed write_file call
          const contentExtracted = extractContentFromPartialToolCall(pendingToolCallBuffer);
          if (contentExtracted && contentExtracted.length > 100) {
            // FIX 2: Save content to disk instead of dumping raw JSON-escaped text into chat.
            // Previously this emitted the raw extracted content (with JSON escapes like \" and \n)
            // as display text, which showed raw tool call content in the chat bubble.
            const _failedFileMatch = pendingToolCallBuffer.match(/"filePath"\s*:\s*"([^"]+)"/);
            const _failedTargetFile = _failedFileMatch ? _failedFileMatch[1] : null;
            if (_failedTargetFile) {
              // Save to disk with monotonic protection
              if (!rotationCheckpoint || _failedTargetFile !== rotationCheckpoint.filePath ||
                  contentExtracted.length >= rotationCheckpoint.content.length) {
                try {
                  await mcpToolServer.executeTool('write_file', { filePath: _failedTargetFile, content: contentExtracted });
                  rotationCheckpoint = { filePath: _failedTargetFile, content: contentExtracted };
                  const lineCount = (contentExtracted.match(/\n/g) || []).length + 1;
                  console.log(`[AgenticLoop] Saved failed tool call content to disk: ${contentExtracted.length} chars (${lineCount} lines) to "${_failedTargetFile}"`);
                  stream.fileAccUpdate(_failedTargetFile, contentExtracted);
                  stream._send('llm-token', `\n\n[Tool call incomplete — content preserved to ${_failedTargetFile} (${lineCount} lines)]\n`);
                  fullResponseText += `\n\n[Tool call incomplete — content preserved to ${_failedTargetFile} (${lineCount} lines)]\n`;
                  displayResponseText += `\n\n[Tool call incomplete — content preserved to ${_failedTargetFile} (${lineCount} lines)]\n`;
                } catch (e) {
                  console.log(`[AgenticLoop] Failed to save failed tool call content: ${e.message}`);
                }
              } else {
                const lineCount = (rotationCheckpoint.content.match(/\n/g) || []).length + 1;
                console.log(`[AgenticLoop] Failed tool call content already preserved on disk (${rotationCheckpoint.content.length} chars, ${lineCount} lines)`);
                stream._send('llm-token', `\n\n[Tool call incomplete — content preserved to ${_failedTargetFile} (${lineCount} lines)]\n`);
                fullResponseText += `\n\n[Tool call incomplete — content preserved to ${_failedTargetFile} (${lineCount} lines)]\n`;
                displayResponseText += `\n\n[Tool call incomplete — content preserved to ${_failedTargetFile} (${lineCount} lines)]\n`;
              }
            } else {
              console.log(`[AgenticLoop] Failed tool call content extracted (${contentExtracted.length} chars) but no target file found`);
            }
          } else {
            // No extractable content — fall back to cleaned artifacts
            const cleaned = cleanTrailingArtifacts(pendingToolCallBuffer);
            fullResponseText += cleaned;
            displayResponseText += cleaned;
          }

          pendingToolCallBuffer = null;
          lastContCheckpointLen = 0;
          // NOTE: stream.finalize() is intentionally NOT called here.
          // stream.reset() above already cleared all hold state. Calling finalize
          // now would re-dump _toolCallJson (empty at this point but defensive).
        }
      }
      } // close else block from Fix I (non-file tool check)
    } else {
      // ── Normal parse path ─────────────────────────────
      console.log(`[AgenticLoop] Normal parse path: rawText=${rawText.length} chars, stopReason=${result.stopReason}`);
      const parsed = parseResponse(rawText, result.stopReason);
      console.log(`[AgenticLoop] Parse result: toolCalls=${parsed.toolCalls.length}, partial=${parsed.partial}, displayText=${(parsed.displayText || '').length} chars`);

      // FIX C: When maxTokens was hit and tryFixJson repaired truncated JSON into a
      // "complete" tool call, the content is actually truncated. Any tool call with
      // a 'content' param found at maxTokens boundary is partial — route to accumulation.
      if (parsed.toolCalls.length > 0 && result.stopReason === 'maxTokens') {
        const hasContentParam = parsed.toolCalls.some(tc => tc.arguments?.content != null);
        if (hasContentParam) {
          console.log(`[AgenticLoop] maxTokens + tool call with content param — treating as partial (content truncated by tryFixJson repair)`);
          parsed.partial = true;
          parsed.toolCalls = [];
        }
      }

      // FIX C-Extended: When maxTokens was hit, tryFixJson FAILED (toolCalls=0), but the
      // raw text begins with a raw JSON tool call pattern — force partial so the
      // accumulation path picks it up instead of injecting 6K of garbage into context.
      // This covers the case where the HTML/code content inside the JSON has \\" sequences
      // that caused tryFixJson to fail even after the escape-flag fix, or any other JSON
      // parse failure on valid-but-truncated raw tool call JSON.
      if (result.stopReason === 'maxTokens' && parsed.toolCalls.length === 0 && !parsed.partial) {
        const trimmed = rawText.trimStart();
        if (trimmed.startsWith('{"tool"') || trimmed.startsWith('{"tool_calls"') ||
            trimmed.startsWith('{"function"') || trimmed.startsWith('{"name"')) {
          console.log(`[AgenticLoop] Fix C-Extended: maxTokens + raw JSON tool call + toolCalls=0 — forcing partial for accumulation (${rawText.length} chars)`);
          parsed.partial = true;
        }
      }

      displayText = parsed.displayText;
      toolCalls = parsed.toolCalls;

      // Check for partial tool call that needs accumulation across continuations
      if (parsed.partial && shouldContinue(result)) {
        console.log('[AgenticLoop] Detected partial tool call — starting accumulation');
        pendingToolCallBuffer = rawText;
        continuationCount++;

        // BUG A FIX: Checkpoint even the FIRST partial tool call before continuing
        const _initFileMatch = rawText.match(/"filePath"\s*:\s*"([^"]+)"/);
        const _initTargetFile = _initFileMatch ? _initFileMatch[1] : null;
        const _initContent = extractContentFromPartialToolCall(rawText);
        if (_initContent && _initTargetFile && _initContent.length > 100) {
          try {
            if (!rotationCheckpoint || _initTargetFile !== rotationCheckpoint.filePath ||
                _initContent.length >= rotationCheckpoint.content.length) {
              await mcpToolServer.executeTool('write_file', { filePath: _initTargetFile, content: _initContent });
              rotationCheckpoint = { filePath: _initTargetFile, content: _initContent };
              lastContCheckpointLen = _initContent.length;
              stream.fileAccUpdate(_initTargetFile, _initContent);
              console.log(`[AgenticLoop] Initial partial checkpoint: wrote ${_initContent.length} chars to "${_initTargetFile}"`);
            }
          } catch (e) {
            console.log(`[AgenticLoop] Initial partial checkpoint failed: ${e.message}`);
          }
        }

        nextUserMessage = continuationMessage({ 
          lastText: rawText, 
          toolInProgress: true,
          accumulatedBuffer: rawText,
          midFence: stream.isHoldingFenced?.() || false,
          fileName: _initTargetFile,
          taskGoal: message,
          fileProgress: rotationCheckpoint ? `${(rotationCheckpoint.content.match(/\n/g) || []).length + 1} lines on disk` : undefined,
        });
        // Do NOT finalize — stream is holding the tool call content and should
        // keep emitting llm-tool-generating events across continuation boundaries
        continue;
      }

      stream.finalize(toolCalls.length > 0);
      console.log(`[AgenticLoop] After finalize: toolCalls=${toolCalls.length}`);
      fullResponseText += toolCalls.length > 0 ? displayText : rawText;
      displayResponseText += displayText;
    }

    // ── Branch: Tool calls ────────────────────────────────
    if (toolCalls.length > 0) {
      console.log(`[AgenticLoop] Entering tool execution branch: ${toolCalls.length} calls`);
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

        // ── Rotation checkpoint regression protection ──────────
        // When a file was saved to disk during rotation, prevent write_file from
        // overwriting it with shorter content. Convert to append if new content exists,
        // or skip entirely if no new content beyond what's already on disk.
        let effectiveName = toolCall.name;
        let effectiveArgs = toolCall.arguments;

        if (toolCall.name === 'write_file' && rotationCheckpoint &&
            toolCall.arguments?.filePath === rotationCheckpoint.filePath) {
          const newContent = toolCall.arguments.content || '';
          const checkpointContent = rotationCheckpoint.content;
          const continuation = _findContinuationContent(checkpointContent, newContent);

          if (continuation.length > 10) {
            // Model restarted but has new content beyond checkpoint — convert to append
            effectiveName = 'append_to_file';
            effectiveArgs = { filePath: toolCall.arguments.filePath, content: continuation };
            console.log(`[AgenticLoop] Rotation protection: write_file → append_to_file (${continuation.length} new chars beyond checkpoint)`);
          } else if (newContent.length > checkpointContent.length * 1.1) {
            // New content is significantly longer — model generated more. Allow write.
            console.log(`[AgenticLoop] Rotation protection: new content (${newContent.length}) > checkpoint (${checkpointContent.length}) — allowing write`);
          } else {
            // No new content beyond checkpoint — skip the write, inform model
            const lineCount = (checkpointContent.match(/\n/g) || []).length + 1;
            const tailContent = checkpointContent.split('\n').slice(-15).join('\n');
            const entry = {
              tool: toolCall.name,
              params: toolCall.arguments,
              result: { content: `File "${toolCall.arguments.filePath}" already has ${lineCount} lines on disk. Your write was blocked because it contained less content than what's already saved.\n\nThe file currently ends with:\n${tailContent}\n\nIf this file is INCOMPLETE, use append_to_file to add the remaining content. Do NOT use write_file.` },
            };
            toolResultEntries.push(entry);
            rollingSummary.recordToolCall(toolCall.name, toolCall.arguments, iteration);
            rotationCheckpoint = null;
            console.log(`[AgenticLoop] Rotation protection: skipping write_file — checkpoint has ${checkpointContent.length} chars, new has ${newContent.length}`);
            continue;
          }
          rotationCheckpoint = null;
        }

        try {
          const toolResult = await mcpToolServer.executeTool(effectiveName, effectiveArgs);
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
      // Detect if the response ended inside a fenced code block (odd count of ``` lines).
      // CRITICAL: Use fullResponseText (cumulative across ALL iterations), not displayText
      // (current iteration only). After rotation, the model outputs raw code with no ```
      // markers, so displayText has fenceCount=0. The cumulative text preserves the opening
      // ``` from iteration 1, giving the correct fence parity.
      const fenceCount = (fullResponseText.match(/^```/gm) || []).length;
      const midFence = fenceCount % 2 !== 0;
      if (midFence) console.log('[AgenticLoop]   Mid-fence detected — response was inside a code block');

      // Use fullResponseText for tail context so continuationMessage gets the
      // tail of the ENTIRE accumulated output, not just this iteration's text.
      nextUserMessage = continuationMessage({ lastText: fullResponseText, midFence, taskGoal: message });
      continue;
    }

    // ── S7-9B + D5: Natural stop with unclosed code fence → force continuation ──
    // If the model emitted eogToken but the accumulated response has an unclosed
    // code block (odd fence parity), the file is incomplete. Force continuation
    // so the model can complete and close the block. Safety-limited to 3 retries.
    // D5 fix: discard the current iteration's output from fullResponseText before
    // computing the continuation tail. The model stopped naturally (eogToken) while
    // the fence was unclosed — it was confused. Its output from this confused state
    // (often summary text, status updates, or restarted content) would corrupt the
    // continuation anchor if kept.
    {
      const fenceLines = (fullResponseText.match(/^```/gm) || []).length;
      if (fenceLines % 2 !== 0 && unclosedFenceRetries < 3) {
        // D5: Remove the current iteration's text from accumulated response
        const currentIterText = rawText || '';
        // Check for partial write_file before discarding — used for targeted continuation
        const partialWriteFileMatch = currentIterText.match(/"tool"\s*:\s*"write_file"[\s\S]*?"filePath"\s*:\s*"([^"]+)"/);
        const partialWriteFilePath = partialWriteFileMatch ? partialWriteFileMatch[1] : null;

        if (currentIterText.length > 0 && fullResponseText.endsWith(currentIterText)) {
          fullResponseText = fullResponseText.slice(0, -currentIterText.length);
          displayResponseText = displayResponseText.slice(0, -((displayText || currentIterText).length));
          console.log(`[AgenticLoop]   D5: Discarded ${currentIterText.length} chars of confused iteration output`);
          if (partialWriteFilePath) console.log(`[AgenticLoop]   D5: Partial write_file detected for "${partialWriteFilePath}"`);
          // Also clean the frontend buffer — prevents junk from false-positive
          // releases rendering as phantom code blocks in the chat
          stream.replaceLast('');
        }
        console.log(`[AgenticLoop]   Natural stop with unclosed code fence (${fenceLines} fences) — forcing continuation (retry ${unclosedFenceRetries + 1}/3)`);
        unclosedFenceRetries++;
        continuationCount++;

        // If a partial write_file was discarded, give the model a targeted message
        // so it uses append_to_file to continue rather than restarting the whole file.
        if (partialWriteFilePath) {
          nextUserMessage = `Your write_file call for "${partialWriteFilePath}" was cut off before finishing. The file is still incomplete. Use append_to_file to add the remaining content. Continue from where the data was cut off — do NOT use write_file again and do NOT restart the file.`;
        } else {
          nextUserMessage = continuationMessage({ lastText: fullResponseText, midFence: true, taskGoal: message });
        }
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

/**
 * Normalize a line for fuzzy comparison: trim whitespace, collapse internal
 * spaces, remove trailing semicolons/commas (common formatting differences).
 */
function _normalizeLine(line) {
  return (line || '').trim().replace(/\s+/g, ' ').replace(/[;,]\s*$/, '');
}

/**
 * Find continuation content between existing file (checkpoint) and new content.
 * Fix E: Uses normalized (fuzzy) line comparison instead of strict equality.
 * When the model restarts a file from scratch after rotation, this extracts only
 * the lines that come AFTER where the checkpoint ended — preventing content regression.
 *
 * @param {string} existingContent — Content already on disk (checkpoint)
 * @param {string} newContent — Content from model's new write_file call
 * @returns {string} Only the new lines to append (empty if no new content)
 */
function _findContinuationContent(existingContent, newContent) {
  if (!existingContent || !newContent) return newContent || '';

  const existingLines = existingContent.split('\n');
  const newLines = newContent.split('\n');
  // Pre-compute normalized lines for fuzzy matching
  const existingNorm = existingLines.map(_normalizeLine);
  const newNorm = newLines.map(_normalizeLine);

  if (!existingLines.length || !newLines.length) return newContent;

  // Detect restart: if newContent is shorter than existingContent AND
  // shares structural similarity, the model restarted from scratch.
  if (newContent.length < existingContent.length * 0.8) {
    const earlyMatchCount = Math.min(5, newNorm.length, existingNorm.length);
    let matches = 0;
    for (let i = 0; i < earlyMatchCount; i++) {
      if (newNorm[i] === existingNorm[i]) matches++;
    }
    if (matches >= Math.ceil(earlyMatchCount * 0.5)) {
      console.log(`[AgenticLoop] _findContinuationContent: detected restart (new=${newContent.length} < existing=${existingContent.length}, ${matches}/${earlyMatchCount} early lines match)`);
      return '';
    }
  }

  // If new content starts differently from existing, check if it's truly new
  // vs a restart with different formatting (e.g. different comment at top)
  if (existingNorm[0] !== newNorm[0]) {
    const checkDepth = Math.min(20, newNorm.length, existingNorm.length);
    let deepMatches = 0;
    for (let i = 0; i < checkDepth; i++) {
      if (newNorm[i] === existingNorm[i]) deepMatches++;
    }
    if (deepMatches > checkDepth * 0.3) {
      console.log(`[AgenticLoop] _findContinuationContent: detected reformatted restart (${deepMatches}/${checkDepth} deep matches)`);
      return '';
    }
    // Fix E: Even if it looks like "genuinely new", check if any NEW lines
    // already exist in the existing content (overlap detection).
    // Build a Set of normalized existing lines for O(1) lookup.
    const existingSet = new Set(existingNorm.filter(l => l.length > 5));
    let overlapCount = 0;
    for (let i = 0; i < Math.min(newNorm.length, 30); i++) {
      if (newNorm[i].length > 5 && existingSet.has(newNorm[i])) overlapCount++;
    }
    if (overlapCount > Math.min(newNorm.length, 30) * 0.5) {
      // More than 50% of "new" lines are already in the existing file — restart
      console.log(`[AgenticLoop] _findContinuationContent: detected overlap restart (${overlapCount} overlapping lines in first 30)`);
      return '';
    }
    return newContent;
  }

  // Same start — model restarted from scratch. Find longest matching prefix
  // using FUZZY (normalized) comparison instead of strict equality.
  let matchEnd = 0;
  const minLen = Math.min(existingNorm.length, newNorm.length);
  for (let i = 0; i < minLen; i++) {
    if (existingNorm[i] === newNorm[i]) {
      matchEnd = i + 1;
    } else {
      break;
    }
  }

  // Fix E: After the fuzzy prefix match, also check if subsequent new lines
  // overlap with lines further in the existing content (partial re-generation).
  if (matchEnd < newNorm.length) {
    const existingSet = new Set(existingNorm.filter(l => l.length > 5));
    // Skip over new lines that are already in the existing content
    let skipEnd = matchEnd;
    while (skipEnd < newNorm.length && newNorm[skipEnd].length > 5 && existingSet.has(newNorm[skipEnd])) {
      skipEnd++;
    }
    if (skipEnd > matchEnd) {
      console.log(`[AgenticLoop] _findContinuationContent: skipped ${skipEnd - matchEnd} overlapping lines after prefix match`);
      matchEnd = skipEnd;
    }
  }

  // Return only lines after the matched/overlapping prefix
  if (newLines.length <= matchEnd) return '';
  return '\n' + newLines.slice(matchEnd).join('\n');
}

module.exports = { handleLocalChat };
