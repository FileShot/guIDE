/**
 * Native Context Strategy for node-llama-cpp's contextShift hook
 *
 * This is the SOLE context management system for guIDE. node-llama-cpp calls
 * this strategy when context fills during generation. The model's current
 * partial response (including any in-progress tool call) is preserved in the
 * KV cache; this function decides what OLD history to keep/drop/truncate.
 *
 * CRITICAL: The returned chatHistory MUST fit within maxTokensCount.
 * If it doesn't, node-llama-cpp falls back to its default strategy which
 * is NOT file-aware. Always verify fit before returning.
 *
 * @module nativeContextStrategy
 */

const log = require('../logger');

const CONFIG = {
  // Conservative chars-per-token estimate for budget calculations.
  // Using 3.5 is safe for English/code — real ratio is often higher (4+).
  CHARS_PER_TOKEN: 3.5,

  // Target this fraction of maxTokensCount to leave safety margin.
  // node-llama-cpp checks fit AFTER our strategy returns; being under budget
  // prevents fallback to the default strategy.
  TARGET_BUDGET_FRACTION: 0.85,

  // Maximum chars for the context summary injected as a system message.
  MAX_SUMMARY_CHARS: 1500,

  DEBUG: true,
};

// ─── Helpers ─────────────────────────────────────────────

/**
 * Estimate token count for a string.
 * Conservative: rounds UP so we stay under budget.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CONFIG.CHARS_PER_TOKEN);
}

/**
 * Estimate token count for a single chatHistory item.
 * Handles system, user, and model item types.
 */
function estimateItemTokens(item) {
  if (!item) return 0;
  if (item.type === 'system' || item.type === 'user') {
    return estimateTokens(typeof item.text === 'string' ? item.text : JSON.stringify(item.text)) + 10; // +10 for role/template tokens
  }
  if (item.type === 'model' && item.response) {
    let total = 10; // role overhead
    for (const seg of item.response) {
      if (typeof seg === 'string') {
        total += estimateTokens(seg);
      } else if (seg && seg.type === 'functionCall') {
        // Function call: name + stringified params
        total += estimateTokens(seg.name || '') + estimateTokens(JSON.stringify(seg.params || {}));
        if (seg.rawCall) total += estimateTokens(JSON.stringify(seg.rawCall));
      } else if (seg && seg.type === 'functionCallResult') {
        total += estimateTokens(JSON.stringify(seg.result || ''));
      }
    }
    return total;
  }
  return estimateTokens(JSON.stringify(item));
}

/**
 * Truncate a user/system item's text to fit within a character budget.
 * Keeps the first `headChars` and last `tailChars`, replacing the middle with "[...]".
 */
function truncateItemText(item, maxChars) {
  const text = typeof item.text === 'string' ? item.text : JSON.stringify(item.text);
  if (text.length <= maxChars) return { ...item };
  const headChars = Math.floor(maxChars * 0.15);
  const tailChars = maxChars - headChars - 10; // 10 for "[...]" marker
  const truncated = text.slice(0, headChars) + '\n[...]\n' + text.slice(-Math.max(tailChars, 0));
  return { ...item, text: truncated };
}

/**
 * Truncate a model response item to fit within a character budget.
 * Keeps the TAIL (most recent output) since that's what the model needs
 * for coherent continuation.
 */
function truncateModelItem(item, maxChars) {
  if (!item || item.type !== 'model' || !item.response) return item;

  // Serialize all response segments to measure
  let totalChars = 0;
  const segSizes = item.response.map(seg => {
    const size = typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
    totalChars += size;
    return size;
  });

  if (totalChars <= maxChars) return { ...item, response: [...item.response] };

  // Keep segments from the END (most recent). Drop/truncate from the start.
  const newResponse = [];
  let budget = maxChars;

  for (let i = item.response.length - 1; i >= 0; i--) {
    const seg = item.response[i];
    const size = segSizes[i];
    if (size <= budget) {
      newResponse.unshift(seg);
      budget -= size;
    } else if (budget > 100 && typeof seg === 'string') {
      // Truncate this string segment — keep the tail
      newResponse.unshift(seg.slice(-(budget - 20)));
      budget = 0;
    }
    // else: skip this segment entirely
    if (budget <= 0) break;
  }

  return { ...item, response: newResponse };
}

/**
 * Generate a concise summary of dropped history items.
 * Zero-LLM-cost: extracts key user requests and model actions.
 */
function summarizeDroppedItems(items) {
  if (!items || items.length === 0) return '';
  const parts = [];

  for (const item of items) {
    if (item.type === 'user' && item.text) {
      const text = (typeof item.text === 'string' ? item.text : '').slice(0, 200);
      // Extract the first sentence as the user's request
      const firstSentence = text.split(/[.!?\n]/)[0].trim();
      if (firstSentence.length > 10) {
        parts.push(`User: ${firstSentence}`);
      }
    } else if (item.type === 'model' && item.response) {
      const toolCalls = item.response.filter(r => r && r.type === 'functionCall');
      for (const call of toolCalls) {
        if (call.name === 'write_file' && call.params?.filePath) {
          const lines = call.params.content ? (call.params.content.match(/\n/g) || []).length + 1 : '?';
          parts.push(`Wrote ${call.params.filePath} (${lines} lines)`);
        } else if (call.name === 'append_to_file' && call.params?.filePath) {
          parts.push(`Appended to ${call.params.filePath}`);
        } else if (call.name === 'read_file' && call.params?.filePath) {
          parts.push(`Read ${call.params.filePath}`);
        } else if (call.name) {
          parts.push(`Tool: ${call.name}`);
        }
      }
    }
  }

  const unique = [...new Set(parts)];
  return unique.slice(0, 12).join('\n');
}

/**
 * Extract file progress info from the full chat history.
 * Tracks the LATEST write to each file path.
 */
function extractFileProgress(chatHistory) {
  const files = {};
  for (const item of chatHistory) {
    if (item.type !== 'model' || !item.response) continue;
    for (const seg of item.response) {
      if (!seg || seg.type !== 'functionCall') continue;
      if ((seg.name === 'write_file' || seg.name === 'append_to_file') && seg.params?.filePath) {
        const path = seg.params.filePath;
        const content = seg.params.content || '';
        const lines = (content.match(/\n/g) || []).length + 1;
        if (!files[path]) files[path] = { lines: 0, chars: 0, writes: 0 };
        if (seg.name === 'write_file') {
          files[path].lines = lines;
          files[path].chars = content.length;
        } else {
          files[path].lines += lines;
          files[path].chars += content.length;
        }
        files[path].writes++;
      }
    }
  }
  return files;
}

/**
 * Detect if the model is currently in the middle of writing a file.
 * Looks at the LAST item in history — if it's a model response with an
 * in-progress write_file tool call, we're mid-file-generation.
 */
function detectActiveFileGeneration(chatHistory) {
  const last = chatHistory[chatHistory.length - 1];
  if (!last || last.type !== 'model' || !last.response) return null;

  for (const seg of last.response) {
    if (typeof seg === 'string') {
      // Look for partial tool call JSON in the response text
      const writeMatch = seg.match(/"tool"\s*:\s*"write_file".*?"filePath"\s*:\s*"([^"]+)"/s);
      if (writeMatch) return { filePath: writeMatch[1], isPartial: true };
    }
    if (seg && seg.type === 'functionCall' && seg.name === 'write_file') {
      return { filePath: seg.params?.filePath, isPartial: false };
    }
  }
  return null;
}

// ─── Main Strategy ───────────────────────────────────────

/**
 * The main context shift strategy function.
 * Called by node-llama-cpp when the context window fills during generation.
 *
 * Strategy:
 *   1. Always keep system prompt (attention sink)
 *   2. Always keep the last item (current model response / most recent turn)
 *   3. Fill remaining budget with recent turns, newest first
 *   4. Truncate oversized items to fit budget
 *   5. Inject compact summary of dropped items
 *   6. Verify total fits within maxTokensCount
 */
async function nativeContextShiftStrategy(options) {
  const { chatHistory, maxTokensCount, tokenizer, chatWrapper, lastShiftMetadata } = options;

  if (CONFIG.DEBUG) {
    log.info(`[NativeCtxShift] Context shift triggered — ${chatHistory.length} items, budget ${maxTokensCount} tokens`);
  }

  // Edge case: 2 items or fewer — nothing to compress
  if (chatHistory.length <= 2) {
    return { chatHistory: [...chatHistory], metadata: { compressed: false } };
  }

  // ── Step 1: Calculate working budget in characters ──────
  const charBudget = Math.floor(maxTokensCount * CONFIG.TARGET_BUDGET_FRACTION * CONFIG.CHARS_PER_TOKEN);

  // ── Step 2: Identify must-keep items ────────────────────
  const systemItem = chatHistory[0]?.type === 'system' ? chatHistory[0] : null;
  const lastItem = chatHistory[chatHistory.length - 1]; // current model response or latest turn
  const middleItems = chatHistory.slice(systemItem ? 1 : 0, chatHistory.length - 1);

  // Measure must-keep items
  let systemChars = 0;
  if (systemItem) {
    const sysText = typeof systemItem.text === 'string' ? systemItem.text : JSON.stringify(systemItem.text);
    systemChars = sysText.length + 20; // overhead
  }

  let lastItemChars = 0;
  if (lastItem.type === 'model' && lastItem.response) {
    for (const seg of lastItem.response) {
      lastItemChars += typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
    }
  } else if (lastItem.type === 'user' || lastItem.type === 'system') {
    const t = typeof lastItem.text === 'string' ? lastItem.text : JSON.stringify(lastItem.text);
    lastItemChars = t.length;
  }
  lastItemChars += 20; // overhead

  if (CONFIG.DEBUG) {
    log.info(`[NativeCtxShift] Char budget: ${charBudget}, system: ${systemChars}, lastItem: ${lastItemChars}`);
  }

  // ── Step 3: If last item alone exceeds budget, truncate it ──
  let keptLastItem = lastItem;
  const maxLastItemChars = charBudget - systemChars - 500; // reserve 500 chars for summary
  if (lastItemChars > maxLastItemChars && maxLastItemChars > 200) {
    if (lastItem.type === 'model') {
      keptLastItem = truncateModelItem(lastItem, maxLastItemChars);
      if (CONFIG.DEBUG) log.info(`[NativeCtxShift] Truncated last model item: ${lastItemChars} → ~${maxLastItemChars} chars`);
    } else {
      keptLastItem = truncateItemText(lastItem, maxLastItemChars);
      if (CONFIG.DEBUG) log.info(`[NativeCtxShift] Truncated last item: ${lastItemChars} → ~${maxLastItemChars} chars`);
    }
    lastItemChars = maxLastItemChars;
  }

  // ── Step 4: Fill remaining budget with recent turns ─────
  let remainingBudget = charBudget - systemChars - lastItemChars;
  // Reserve space for the summary message we'll inject
  const summaryReserve = Math.min(CONFIG.MAX_SUMMARY_CHARS, Math.floor(remainingBudget * 0.3));
  remainingBudget -= summaryReserve;

  const keptMiddle = [];
  const droppedMiddle = [];

  // Walk backwards through middle items (newest first)
  for (let i = middleItems.length - 1; i >= 0; i--) {
    const item = middleItems[i];
    let itemChars;
    if (item.type === 'model' && item.response) {
      itemChars = 0;
      for (const seg of item.response) {
        itemChars += typeof seg === 'string' ? seg.length : JSON.stringify(seg).length;
      }
    } else {
      const t = typeof item.text === 'string' ? item.text : JSON.stringify(item.text || '');
      itemChars = t.length;
    }
    itemChars += 20; // overhead per item

    if (itemChars <= remainingBudget) {
      // Item fits — keep it entirely
      keptMiddle.unshift(item);
      remainingBudget -= itemChars;
    } else if (remainingBudget > 200) {
      // Item too large but we have some budget — truncate it
      if (item.type === 'model') {
        keptMiddle.unshift(truncateModelItem(item, remainingBudget - 20));
      } else {
        keptMiddle.unshift(truncateItemText(item, remainingBudget - 20));
      }
      remainingBudget = 0;
      // Everything before this is dropped
      droppedMiddle.unshift(...middleItems.slice(0, i));
      break;
    } else {
      // No budget left — drop everything remaining
      droppedMiddle.unshift(...middleItems.slice(0, i + 1));
      break;
    }
  }

  // If we finished the loop without breaking, no items were dropped from the front
  if (droppedMiddle.length === 0 && keptMiddle.length < middleItems.length) {
    // Some items weren't processed (loop ended naturally)
    const processedCount = keptMiddle.length;
    for (let i = 0; i < middleItems.length - processedCount; i++) {
      droppedMiddle.push(middleItems[i]);
    }
  }

  // ── Step 5: Build context summary ──────────────────────
  const fileProgress = extractFileProgress(chatHistory);
  const activeFile = detectActiveFileGeneration(chatHistory);
  const droppedSummary = summarizeDroppedItems(droppedMiddle);

  let summaryText = '';
  if (droppedSummary || Object.keys(fileProgress).length > 0 || activeFile) {
    const parts = ['[Context compressed — earlier conversation dropped]'];

    if (droppedSummary) {
      parts.push('Previous actions:\n' + droppedSummary);
    }

    if (Object.keys(fileProgress).length > 0) {
      parts.push('File progress:\n' +
        Object.entries(fileProgress)
          .map(([p, info]) => `- ${p}: ${info.lines} lines, ${info.writes} write(s)`)
          .join('\n'));
    }

    if (activeFile) {
      parts.push(`ACTIVE: Currently writing "${activeFile.filePath}" — continue from where you left off.`);
    }

    parts.push('Continue from where you left off. Do NOT restart completed work.');
    summaryText = parts.join('\n\n');

    // Cap summary to budget
    if (summaryText.length > summaryReserve) {
      summaryText = summaryText.slice(0, summaryReserve - 10) + '\n[...]';
    }
  }

  // ── Step 6: Assemble new history ───────────────────────
  const newHistory = [];

  if (systemItem) newHistory.push(systemItem);

  if (summaryText) {
    newHistory.push({ type: 'system', text: summaryText });
  }

  newHistory.push(...keptMiddle);
  newHistory.push(keptLastItem);

  if (CONFIG.DEBUG) {
    log.info(`[NativeCtxShift] Result: ${newHistory.length} items (kept ${keptMiddle.length} middle, dropped ${droppedMiddle.length})`);
    if (activeFile) log.info(`[NativeCtxShift] Active file generation: ${activeFile.filePath}`);
  }

  return {
    chatHistory: newHistory,
    metadata: {
      compressed: true,
      originalLength: chatHistory.length,
      newLength: newHistory.length,
      droppedCount: droppedMiddle.length,
      keptMiddleCount: keptMiddle.length,
      activeFile: activeFile?.filePath || null,
      fileProgress,
      shiftNumber: (lastShiftMetadata?.shiftNumber || 0) + 1,
      timestamp: Date.now(),
    },
  };
}

/**
 * Calculate the recommended context shift size.
 * This is the number of tokens to FREE when context is full.
 * node-llama-cpp subtracts this from contextSize to get maxTokensCount.
 *
 * Larger values = more aggressive compression but more room for generation.
 * Must be large enough that after compression, there's meaningful room to
 * continue generating (at least 1K tokens).
 */
function getContextShiftSize(sequence) {
  const contextSize = sequence?.context?.contextSize || 8192;

  if (contextSize <= 4096) return Math.floor(contextSize * 0.30); // 30% for tiny contexts
  if (contextSize <= 8192) return Math.floor(contextSize * 0.25); // 25% for small
  if (contextSize <= 16384) return Math.floor(contextSize * 0.20); // 20% for medium
  return Math.floor(contextSize * 0.15); // 15% for large
}

/**
 * Build context shift options for node-llama-cpp.
 */
function buildContextShiftOptions(llmEngine) {
  return {
    size: (sequence) => getContextShiftSize(sequence),
    strategy: nativeContextShiftStrategy,
    lastEvaluationMetadata: llmEngine?.lastEvaluation?.contextShiftMetadata || null,
  };
}

module.exports = {
  nativeContextShiftStrategy,
  buildContextShiftOptions,
  getContextShiftSize,
  CONFIG,
};
