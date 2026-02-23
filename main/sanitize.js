/**
 * Shared sanitizeResponse — Single source of truth for cleaning LLM output.
 *
 * Used by llmEngine.js (as _sanitizeResponse method) and all benchmark scripts.
 * Previously duplicated in 7+ files. Changes here propagate everywhere.
 */

/**
 * Clean garbage tokens, thinking blocks, and artifacts from model output.
 * @param {string} text - Raw model output
 * @returns {string} Cleaned text
 */
function sanitizeResponse(text) {
  if (!text) return '';

  // Remove thinking blocks first (content between tags), THEN orphan tags
  // Must be in this order — removing tags first would prevent block matching
  let cleaned = text.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
  cleaned = cleaned.replace(/<\/?think(?:ing)?>/gi, '');

  // Remove all garbage tokens in a single combined regex pass
  // NOTE: <|im_start|> must be a TOP-LEVEL alternative (not inside <|...|> wrapper)
  // because its |> is part of the token itself, not a separate closing delimiter.
  cleaned = cleaned.replace(/<\|(?:file_separator|endoftext|im_end|end|eot_id|EOT)\|>|<\|im_start\|>(?:system|user|assistant)?|<\|start_header_id\|>[\s\S]*?<\|end_header_id\|>|<start_of_turn>(?:model|user)?|<end_of_turn>|<bos>|<eos>|\[INST\]|\[\/INST\]|<<\/?SYS>>/g, '');

  // Remove raw turn indicators (broken models output these)
  cleaned = cleaned.replace(/^\s*(?:assistant|user|system|model|human|assistantassistant)\s*$/gim, '');

  // Remove repetitive garbage (same line repeated 3+ times)
  const lines = cleaned.split('\n');
  const dedupedLines = [];
  let repeatCount = 0;
  let lastLine = '';
  for (const line of lines) {
    if (line.trim() === lastLine.trim() && line.trim().length > 0) {
      repeatCount++;
      if (repeatCount < 3) dedupedLines.push(line);
    } else {
      repeatCount = 0;
      dedupedLines.push(line);
    }
    lastLine = line;
  }
  cleaned = dedupedLines.join('\n');

  // Trim excessive whitespace
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n').trim();

  return cleaned;
}

module.exports = { sanitizeResponse };
