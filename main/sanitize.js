/**
 * guIDE — Response Sanitizer
 * 
 * Cleans LLM output: removes thinking blocks that were already routed
 * to the thinking panel during streaming.
 */
'use strict';

/**
 * Strip thinking blocks and excessive whitespace from model output.
 * Does NOT strip model tokens or special characters — only thinking tags.
 * @param {string} text - Raw model output
 * @returns {string} Cleaned text
 */
function sanitizeResponse(text) {
  if (!text) return '';
  let cleaned = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/<\/?think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n').trim();
  return cleaned;
}

module.exports = { sanitizeResponse };
