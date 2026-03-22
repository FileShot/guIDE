/**
 * ContextManager — Progressive context compaction and pre-generation checks.
 *
 * This module implements REAL context management:
 *   1. Progressive compaction — 4-phase compaction based on context usage %
 *   2. Pre-generation context check — proactively compacts/rotates BEFORE generation
 *   3. History pruning — compress verbose messages to free context space
 *   4. Post-loop compaction — collapse agentic iterations into clean pairs
 *
 * Ported from main_backup_pre_rewrite/agenticChatHelpers.js (progressiveContextCompaction)
 * and main_backup_pre_rewrite/agenticChat.js (preGenerationContextCheck).
 */
'use strict';

const { estimateTokens } = require('./rollingSummary');

// ─── Progressive Context Compaction ──────────────────────────

/**
 * Operate in 4 phases based on context usage percentage.
 * For small contexts (≤8K), thresholds shift down by 25 percentage points.
 *
 * Phase 1 (35%/10%): Compress old tool results
 * Phase 2 (50%/25%): Prune verbose history
 * Phase 3 (65%/40%): Aggressive compaction
 * Phase 4 (80%/55%): Trigger context rotation
 *
 * @returns {object} { phase, shouldRotate, actions[] }
 */
function progressiveContextCompaction(options) {
  const { contextUsedTokens, totalContextTokens, allToolResults, chatHistory, fullResponseText } = options;

  const pct = totalContextTokens > 0 ? contextUsedTokens / totalContextTokens : 0;

  // Dynamic thresholds: shift down for small contexts
  const isSmallCtx = totalContextTokens <= 8192;
  const shift = isSmallCtx ? 0.25 : 0;
  const phase1 = 0.35 - shift;
  const phase2 = 0.50 - shift;
  const phase3 = 0.65 - shift;
  const phase4 = 0.80 - shift;

  const actions = [];
  let currentPhase = 0;
  let shouldRotate = false;

  if (pct >= phase1) {
    currentPhase = 1;
    // Phase 1: Compress old tool results — keep only last 3 iterations
    if (allToolResults && allToolResults.length > 6) {
      const oldCount = allToolResults.length - 6;
      for (let i = 0; i < oldCount; i++) {
        if (allToolResults[i]?.result) {
          const r = allToolResults[i].result;
          if (typeof r === 'object' && r.content && r.content.length > 200) {
            r.content = r.content.slice(0, 200) + '...(compacted)';
          }
        }
      }
      actions.push(`Phase 1: Compressed ${oldCount} old tool results`);
    }
  }

  if (pct >= phase2) {
    currentPhase = 2;
    // Phase 2: Prune verbose history messages
    if (chatHistory && chatHistory.length > 4) {
      const pruned = pruneVerboseHistory(chatHistory, 4);
      if (pruned > 0) actions.push(`Phase 2: Pruned ${pruned} verbose history entries`);
    }
  }

  if (pct >= phase3) {
    currentPhase = 3;
    // Phase 3: Aggressive compaction — truncate all non-recent tool results
    if (allToolResults) {
      for (let i = 0; i < allToolResults.length - 2; i++) {
        if (allToolResults[i]?.result) {
          const r = allToolResults[i].result;
          if (typeof r === 'object') {
            for (const key of Object.keys(r)) {
              if (typeof r[key] === 'string' && r[key].length > 100) {
                r[key] = r[key].slice(0, 100) + '...';
              }
            }
          }
        }
      }
      actions.push('Phase 3: Aggressively compacted tool results');
    }
  }

  if (pct >= phase4) {
    currentPhase = 4;
    shouldRotate = true;
    actions.push('Phase 4: Context rotation triggered');
  }

  if (actions.length > 0) {
    console.log(`[ContextManager] Compaction at ${(pct * 100).toFixed(1)}% — phase ${currentPhase}: ${actions.join('; ')}`);
  }

  // When compaction phases 2+ ran, the in-memory text has been modified.
  // Signal that KV cache should be invalidated so the NEXT generation
  // evaluates the compacted history from scratch instead of reusing stale KV.
  const needsKvInvalidation = currentPhase >= 2 && !shouldRotate;

  return { phase: currentPhase, shouldRotate, needsKvInvalidation, actions };
}

// ─── Pre-Generation Context Check ────────────────────────────

/**
 * Run BEFORE every generation to proactively manage context.
 * Estimates context usage including upcoming prompt + response budget.
 * If >50%, runs progressiveContextCompaction. If compaction says shouldRotate,
 * returns a rotation prompt for the loop to use.
 *
 * @param {object} opts
 * @returns {object|null} Rotation instruction, or null if no action needed
 */
function preGenerationContextCheck(opts) {
  const {
    llmEngine, totalCtx, currentPrompt, fullResponseText, allToolResults,
    contextRotations, MAX_CONTEXT_ROTATIONS, summarizer, rollingSummary,
    buildSystemPrompt, maxPromptTokens, maxResponseTokens, message,
    continuationCount, mcpToolServer,
  } = opts;

  let used = 0;
  let usedFromSequence = false;

  // Try to get actual KV cache usage
  try {
    if (llmEngine.sequence?.nextTokenIndex) {
      used = llmEngine.sequence.nextTokenIndex;
      usedFromSequence = true;
    }
  } catch (_) {}

  // Fallback: estimate from text — include full chatHistory
  if (!used) {
    let historyChars = 0;
    if (llmEngine.chatHistory && Array.isArray(llmEngine.chatHistory)) {
      for (const entry of llmEngine.chatHistory) {
        historyChars += (entry.text || '').length;
      }
    }
    const pLen = typeof currentPrompt === 'string'
      ? currentPrompt.length
      : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
    used = Math.ceil((historyChars + pLen + (fullResponseText || '').length) / 3.5);
  }

  // Project forward: include response budget (scaled down — generation rarely
  // uses the full maxResponseTokens, so projecting the full budget causes
  // premature rotation when actual KV usage is only ~60-66%)
  const respBudget = maxResponseTokens || Math.min(Math.floor(totalCtx * 0.25), 4096);
  const projectedRespBudget = Math.floor(respBudget * 0.6);
  if (usedFromSequence) {
    const newPromptChars = typeof currentPrompt === 'string'
      ? currentPrompt.length
      : ((currentPrompt.systemContext || '').length + (currentPrompt.userMessage || '').length);
    used += Math.ceil(newPromptChars / 3.2) + projectedRespBudget;
  } else {
    // Text estimate already includes prompt, just add response budget
    used += projectedRespBudget;
  }

  const pct = used / totalCtx;
  if (pct <= 0.50) return null;

  // Run compaction
  const compaction = progressiveContextCompaction({
    contextUsedTokens: used,
    totalContextTokens: totalCtx,
    allToolResults,
    chatHistory: llmEngine.chatHistory,
    fullResponseText,
  });

  if (!compaction.shouldRotate) {
    // Phases 2-3 compacted in-memory text. If KV invalidation is needed,
    // signal the caller so the next generation evaluates compacted history
    // from scratch instead of reusing stale KV (which still has uncompacted tokens).
    if (compaction.needsKvInvalidation) {
      llmEngine.lastEvaluation = null;
      console.log('[ContextManager] KV cache invalidated after phase 2-3 compaction — next gen will re-evaluate compacted history');
    }
    return null;
  }
  if (contextRotations >= MAX_CONTEXT_ROTATIONS) return null;

  // Generate rotation summary
  const isContinuationRotation = continuationCount > 0 && summarizer.completedSteps.length === 0;

  summarizer.markRotation();
  rollingSummary.markRotation();

  const summary = summarizer.generateQuickSummary(mcpToolServer?._todos);

  // Build progress hints
  let progressHints = '';
  if (summarizer.incrementalTask) {
    progressHints += `\n**INCREMENTAL TASK: ${summarizer.incrementalTask.current}/${summarizer.incrementalTask.target} ${summarizer.incrementalTask.type} completed.**`;
  }
  const fpKeys = Object.keys(summarizer.fileProgress);
  if (fpKeys.length > 0) {
    progressHints += '\n**FILE PROGRESS:**';
    for (const fp of fpKeys) {
      const f = summarizer.fileProgress[fp];
      progressHints += `\n- ${fp}: ${f.writtenLines} lines (${f.writtenChars} chars)`;
    }
  }

  const sysPrompt = buildSystemPrompt();

  if (isContinuationRotation) {
    return {
      shouldContinue: true,
      prompt: {
        systemContext: sysPrompt,
        userMessage: message + progressHints +
          '\n\nContext rotated. Continue generating content from where you left off. Do NOT output any acknowledgment, recap, or summary — immediately make forward progress.' +
          '\nDo NOT redo completed work. Files listed in progress exist on disk. If a plan exists, it is already active — use update_todo, do NOT call write_todos.',
      },
      rotated: true,
      summary,
      clearContinuation: true,
    };
  }

  return {
    shouldContinue: true,
    prompt: {
      systemContext: sysPrompt,
      userMessage: summary +
        `\nContext rotated. Current request: ${message.substring(0, 300)}` +
        progressHints +
        '\n\nContinue the task. Do NOT output any acknowledgment or summary — make forward progress immediately.' +
        '\nDo NOT redo completed work. Files listed in progress exist on disk. If a plan exists, it is already active — use update_todo, do NOT call write_todos.',
    },
    rotated: true,
    summary,
  };
}

// ─── History Pruning ─────────────────────────────────────────

/**
 * Compress a single text string: prune large code fences and snapshots.
 */
function _compressText(text) {
  if (!text || text.length < 800) return null;
  let compressed = text;
  compressed = compressed.replace(
    /```[\s\S]{800,}?```/g,
    (match) => `\`\`\`\n[${(match.match(/\n/g) || []).length} lines — pruned]\n\`\`\``
  );
  compressed = compressed.replace(
    /\*\*Page Snapshot\*\*\s*\([^)]*\):\n[\s\S]{500,}?(?=\n\*\*|\n###|\n---|$)/g,
    () => `**Page Snapshot**: [pruned for context]`
  );
  return compressed.length < text.length * 0.7 ? compressed : null;
}

/**
 * Prune verbose messages in chat history to free context space.
 */
function pruneVerboseHistory(chatHistory, keepRecentCount = 6) {
  if (!Array.isArray(chatHistory) || chatHistory.length <= keepRecentCount + 1) return 0;

  let pruned = 0;
  const cutoff = chatHistory.length - keepRecentCount;

  for (let i = 1; i < cutoff; i++) {
    const msg = chatHistory[i];
    if (!msg) continue;

    if (msg.type === 'model' && Array.isArray(msg.response)) {
      let changed = false;
      for (let ri = 0; ri < msg.response.length; ri++) {
        const compressed = _compressText(msg.response[ri]);
        if (compressed) { msg.response[ri] = compressed; changed = true; }
      }
      if (changed) pruned++;
      continue;
    }

    if (msg.text) {
      const compressed = _compressText(msg.text);
      if (compressed) { chatHistory[i] = { ...msg, text: compressed }; pruned++; }
      continue;
    }

    if (msg.content) {
      const compressed = _compressText(msg.content);
      if (compressed) { chatHistory[i] = { ...msg, content: compressed }; pruned++; }
    }
  }
  return pruned;
}

// ─── Post-Loop History Compaction ─────────────────────────────

/**
 * After the agentic loop completes, collapse all intermediate entries
 * into one clean user+model pair. Prevents future messages from seeing
 * 16+ entries of internal tool feedback, RAG chunks, and rolling summaries.
 */
function postLoopCompaction(llmEngine, message, fullResponseText, chatHistoryPreLoopLen) {
  if (!llmEngine.chatHistory || llmEngine.chatHistory.length <= chatHistoryPreLoopLen + 2) return;

  const sys = llmEngine.chatHistory.slice(0, 1); // preserve system prompt
  const pre = llmEngine.chatHistory.slice(1, chatHistoryPreLoopLen); // prior conversation

  const cleanedPair = [
    { type: 'user', text: message },
    { type: 'model', response: [fullResponseText || ''] },
  ];

  llmEngine.chatHistory = [...sys, ...pre, ...cleanedPair];
  llmEngine.lastEvaluation = null; // invalidate KV cache position tracking

  console.log(`[ContextManager] Post-loop compaction: ${chatHistoryPreLoopLen} → ${llmEngine.chatHistory.length} entries`);
}

// ─── Legacy API ──────────────────────────────────────────────

/**
 * Check if context usage warrants summarization (legacy interface).
 */
function shouldSummarize(contextUsed, contextTotal, historyLength) {
  if (contextTotal <= 0) return false;
  if ((historyLength || 0) < 6) return false;
  return (contextUsed / contextTotal) >= 0.75;
}

/**
 * Summarize older conversation history to free context space.
 *
 * Uses a layered approach:
 *   1. Extract structured facts from older messages (zero LLM cost)
 *   2. Attempt LLM-based summarization if context budget allows
 *   3. If LLM summarization fails, use the structured extraction as fallback
 *
 * @param {object} llmEngine
 * @param {object} stream
 * @param {object} [summarizer] — ConversationSummarizer instance for structured fallback
 */
async function summarizeHistory(llmEngine, stream, summarizer) {
  const history = llmEngine.chatHistory;
  if (!history || history.length < 6) return false;

  const systemMsg = history.find(h => h.type === 'system');
  const convMsgs = history.filter(h => h.type !== 'system');
  if (convMsgs.length <= 4) return false;

  const keepCount = Math.min(4, convMsgs.length);
  const toSummarize = convMsgs.slice(0, -keepCount);
  const toKeep = convMsgs.slice(-keepCount);

  // Layer 1: Always extract structured facts from messages being summarized (zero LLM cost)
  const structuredFacts = _extractStructuredFacts(toSummarize);

  const convText = toSummarize.map(m => {
    const role = m.type === 'user' ? 'User' : 'Assistant';
    const content = m.type === 'model'
      ? (Array.isArray(m.response) ? m.response.join('') : String(m.response || ''))
      : (m.text || '');
    return `${role}: ${content.slice(0, 600)}`;
  }).join('\n');

  if (stream) stream.phase('summarization', 'start', 'Summarizing conversation...');

  // Layer 2: Attempt LLM-based summarization with proper KV cache invalidation
  try {
    // CRITICAL: Invalidate lastEvaluation BEFORE replacing chatHistory.
    // Without this, _runGeneration attempts KV cache reuse with a completely
    // mismatched history (summarization prompt vs real conversation), causing
    // node-llama-cpp to throw context/compression errors.
    llmEngine.lastEvaluation = null;

    llmEngine.chatHistory = [
      { type: 'system', text: 'Summarize this conversation concisely. Preserve: the user\'s name, their goal, key decisions, file names, and current task status. Output only the summary.' },
    ];

    const result = await llmEngine.generateStream(
      { userMessage: convText },
      { maxTokens: 512, temperature: 0.2 },
      () => {},
    );

    const summary = result?.text || 'Previous conversation context.';

    // Merge LLM summary with structured facts for maximum recall
    const combinedSummary = structuredFacts
      ? `${structuredFacts}\n\n${summary}`
      : summary;

    const rebuilt = [];
    if (systemMsg) rebuilt.push(systemMsg);
    rebuilt.push({ type: 'user', text: `[Previous conversation summary]\n${combinedSummary}` });
    rebuilt.push({ type: 'model', response: ['Understood. Continuing with this context.'] });
    rebuilt.push(...toKeep);

    llmEngine.chatHistory = rebuilt;
    llmEngine.lastEvaluation = null; // Invalidate again — history just changed
    if (stream) stream.phase('summarization', 'done');
    console.log(`[ContextManager] Summarization succeeded. History: ${rebuilt.length} entries.`);
    return true;
  } catch (err) {
    console.error('[ContextManager] LLM summarization failed:', err.message);

    // Layer 3: Fallback to structured extraction — never drop messages without preserving SOMETHING
    let fallbackSummary = structuredFacts || '';

    // Also try using the ConversationSummarizer if available
    if (summarizer && typeof summarizer.generateQuickSummary === 'function') {
      const quickSummary = summarizer.generateQuickSummary();
      if (quickSummary) {
        fallbackSummary = fallbackSummary
          ? `${fallbackSummary}\n\n${quickSummary}`
          : quickSummary;
      }
    }

    const rebuilt = [];
    if (systemMsg) rebuilt.push(systemMsg);

    if (fallbackSummary) {
      // Inject the structured summary so key facts survive
      rebuilt.push({ type: 'user', text: `[Previous conversation summary]\n${fallbackSummary}` });
      rebuilt.push({ type: 'model', response: ['Understood. Continuing with this context.'] });
      console.log(`[ContextManager] Using structured fallback summary (${fallbackSummary.length} chars)`);
    }

    rebuilt.push(...toKeep);
    llmEngine.chatHistory = rebuilt;
    llmEngine.lastEvaluation = null; // Invalidate — history just changed
    if (stream) stream.phase('summarization', 'done');
    return false;
  }
}

/**
 * Extract structured facts from conversation messages without any LLM cost.
 * Captures user name, topics discussed, and key information.
 */
function _extractStructuredFacts(messages) {
  const facts = [];
  let userName = null;

  for (const msg of messages) {
    if (msg.type !== 'user') continue;
    const text = msg.text || '';

    // Extract user name from common patterns
    if (!userName) {
      const namePatterns = [
        /\bmy name(?:'s| is) (\w+)/i,
        /\bi'?m (\w+)/i,
        /\bcall me (\w+)/i,
        /\bhey,?\s+i'?m (\w+)/i,
      ];
      for (const pat of namePatterns) {
        const match = text.match(pat);
        if (match && match[1].length > 1 && match[1].length < 20) {
          // Filter out common false positives
          const lower = match[1].toLowerCase();
          if (!['a', 'the', 'an', 'not', 'very', 'just', 'also', 'trying', 'looking',
                'working', 'having', 'using', 'building', 'making', 'writing',
                'wondering', 'curious', 'interested', 'new', 'here', 'back',
                'sure', 'glad', 'sorry', 'happy', 'stuck', 'confused', 'done'].includes(lower)) {
            userName = match[1];
          }
        }
      }
    }
  }

  if (userName) facts.push(`User's name: ${userName}`);

  // Extract topic keywords from the first user message
  const firstUserMsg = messages.find(m => m.type === 'user');
  if (firstUserMsg?.text) {
    const topicPreview = firstUserMsg.text.slice(0, 300).replace(/\n+/g, ' ');
    facts.push(`First topic: ${topicPreview}`);
  }

  return facts.length > 0 ? facts.join('\n') : null;
}

module.exports = {
  progressiveContextCompaction,
  preGenerationContextCheck,
  pruneVerboseHistory,
  postLoopCompaction,
  shouldSummarize,
  summarizeHistory,
};
