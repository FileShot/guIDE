/**
 * Shared sanitizeResponse — Single source of truth for cleaning LLM output.
 *
 * Used by llmEngine.js (as _sanitizeResponse method) and all benchmark scripts.
 */

/**
 * Clean thinking blocks from model output so they do not appear in the
 * main response text or get stored in chat history.
 * Special tokens and garbage characters are NOT stripped here — the model
 * is expected to produce clean output. Stripping model output is banned.
 * @param {string} text - Raw model output
 * @returns {string} Cleaned text
 */
function sanitizeResponse(text) {
  if (!text) return '';

  // Remove thinking blocks (content between <think> / <thinking> tags).
  // Thinking content is already routed to the dedicated thinking panel
  // during streaming. This pass ensures no stale think blocks remain in
  // the text stored back into chat history.
  let cleaned = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/<\/?think(?:ing)?>/gi, '');

  // Trim excessive whitespace only
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n').trim();

  return cleaned;
}

module.exports = { sanitizeResponse };
