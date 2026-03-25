/**
 * ContextManager — Post-loop compaction and conversation summarization.
 *
 * Context management during generation is now handled by Solution A:
 *   - Pre-generation budget check (agenticLoop.js)
 *   - Native contextShift strategy (nativeContextStrategy.js)
 *
 * This module handles:
 *   1. Post-loop compaction — collapse agentic iterations into clean pairs
 *   2. Conversation summarization — LLM-based + structured fallback
 */
'use strict';

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
  pruneVerboseHistory,
  postLoopCompaction,
  shouldSummarize,
  summarizeHistory,
};
