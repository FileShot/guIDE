/**
 * ResponseParser — Parse model output into display text + tool calls.
 *
 * When the model produces a tool call, it outputs a ```json block containing
 * the tool call specification. This module:
 *  1. Detects and extracts tool call JSON from the raw response text
 *  2. Strips tool call artifacts from the displayed text
 *  3. Normalizes various tool call formats into a standard shape
 *  4. Cleans up trailing garbage (".json", incomplete markers)
 */
'use strict';

/**
 * Parse a model response into display text and tool calls.
 * @param {string} rawText  — Full raw text from the model
 * @param {string} stopReason — 'natural' | 'maxTokens' | 'tool_call' | etc.
 * @returns {{ displayText: string, toolCalls: Array<{name: string, arguments: object}>, partial: boolean }}
 */
function parseResponse(rawText, stopReason) {
  if (!rawText) return { displayText: '', toolCalls: [], partial: false };

  // Always attempt tool call extraction — the model may or may not use fences
  const { text, toolCalls } = extractToolCalls(rawText);
  if (toolCalls.length > 0) {
    return { displayText: text, toolCalls, partial: false };
  }

  // No tool calls found — check if there's a partial (truncated) tool call
  const partial = _hasPartialToolCall(rawText);

  // Clean artifacts and return as plain text
  return { displayText: cleanTrailingArtifacts(rawText), toolCalls: [], partial };
}

/**
 * Detect if the text contains a truncated tool call that could complete
 * across a continuation boundary.
 *
 * Returns true when:
 *  - There's an unclosed ```json block with tool-call-like content
 *  - There's an unclosed <tool_call> tag
 */
function _hasPartialToolCall(text) {
  // Check for unclosed ```json block with tool-call keywords
  const jsonIdx = text.lastIndexOf('```json');
  if (jsonIdx !== -1) {
    const afterMarker = text.substring(jsonIdx + 7);
    if (!afterMarker.includes('```')) {
      // Unclosed ```json — check if content looks like a tool call
      if (/("tool"\s*:|"name"\s*:|"function"\s*:)/.test(afterMarker)) {
        return true;
      }
    }
  }

  // Check for unclosed <tool_call> tag
  const xmlIdx = text.lastIndexOf('<tool_call>');
  if (xmlIdx !== -1 && !text.substring(xmlIdx).includes('</tool_call>')) {
    return true;
  }

  return false;
}

/**
 * Extract tool calls from text that contains a ```json block.
 * Returns clean display text (before the JSON) and parsed tool calls.
 */
function extractToolCalls(rawText) {
  // Find the last ```json block — that's the tool call
  const idx = rawText.lastIndexOf('```json');
  if (idx !== -1) {
    const displayText = rawText.substring(0, idx).trimEnd();
    let jsonBlock = rawText.substring(idx + 7); // skip "```json"

    // Remove closing ``` fence if present
    const closeFence = jsonBlock.lastIndexOf('```');
    if (closeFence !== -1) jsonBlock = jsonBlock.substring(0, closeFence);

    const toolCalls = parseToolCallJson(jsonBlock.trim());
    if (toolCalls.length > 0) return { text: displayText, toolCalls };
  }

  // Try XML-style <tool_call> tags (Qwen3 format)
  const xmlResult = extractXmlToolCalls(rawText);
  if (xmlResult.toolCalls.length > 0) return xmlResult;

  // Try raw JSON tool calls (no fences) — look for common patterns
  return extractRawJsonToolCalls(rawText);
}

/**
 * Try extracting tool calls from XML-style tags: <tool_call>{"name":...}</tool_call>
 */
function extractXmlToolCalls(rawText) {
  const match = rawText.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  if (!match) return { text: rawText, toolCalls: [] };

  const displayText = rawText.substring(0, rawText.indexOf('<tool_call>')).trimEnd();
  const toolCalls = parseToolCallJson(match[1].trim());
  return { text: displayText, toolCalls };
}

/**
 * Try extracting tool calls from raw JSON embedded in the text (no fences).
 * Looks for patterns like:
 *   {"tool_calls": [{"function": {"name": "...", "arguments": {...}}}]}
 *   {"tool": "read_file", "params": {"filePath": "..."}}
 *   [{"function": {"name": "...", "arguments": {...}}}]
 */
function extractRawJsonToolCalls(rawText) {
  // Pattern 1: {"tool_calls": [...]}
  let match = rawText.match(/(\{[\s\S]*?"tool_calls"\s*:\s*\[[\s\S]*)/);
  if (match) {
    const jsonStart = match.index;
    const parsed = tryExtractBalancedJson(rawText, jsonStart);
    if (parsed) {
      const toolCalls = normalizeToolCalls(parsed.obj);
      if (toolCalls.length > 0) {
        const displayText = rawText.substring(0, jsonStart).trimEnd();
        return { text: displayText, toolCalls };
      }
    }
  }

  // Pattern 2: {"tool": "...", "params": {...}}
  match = rawText.match(/(\{[\s\S]*?"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{)/);
  if (match) {
    const jsonStart = match.index;
    const parsed = tryExtractBalancedJson(rawText, jsonStart);
    if (parsed) {
      const toolCalls = normalizeToolCalls(parsed.obj);
      if (toolCalls.length > 0) {
        const displayText = rawText.substring(0, jsonStart).trimEnd();
        return { text: displayText, toolCalls };
      }
    }
  }

  // Pattern 3: {"function": {"name": "...", "arguments": {...}}}
  match = rawText.match(/(\{[\s\S]*?"function"\s*:\s*\{[\s\S]*?"name"\s*:\s*"[^"]+")/);
  if (match) {
    const jsonStart = match.index;
    const parsed = tryExtractBalancedJson(rawText, jsonStart);
    if (parsed) {
      const toolCalls = normalizeToolCalls(parsed.obj);
      if (toolCalls.length > 0) {
        const displayText = rawText.substring(0, jsonStart).trimEnd();
        return { text: displayText, toolCalls };
      }
    }
  }

  return { text: rawText, toolCalls: [] };
}

/**
 * Extract a balanced JSON object/array starting at the given position.
 * Returns {obj, endIdx} or null if parsing fails.
 */
function tryExtractBalancedJson(text, startIdx) {
  const ch = text[startIdx];
  if (ch !== '{' && ch !== '[') return null;

  const open = ch;
  const close = ch === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let prev = '';

  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && prev !== '\\') inString = !inString;
    if (!inString) {
      if (c === open) depth++;
      if (c === close) depth--;
      if (depth === 0) {
        const jsonStr = text.substring(startIdx, i + 1);
        try {
          return { obj: JSON.parse(jsonStr), endIdx: i + 1 };
        } catch {
          return null;
        }
      }
    }
    prev = c;
  }

  // Unbalanced — try fixing with tryFixJson
  const fragment = text.substring(startIdx);
  const fixed = tryFixJson(fragment);
  if (fixed) return { obj: fixed, endIdx: text.length };

  return null;
}

/**
 * Parse a JSON string into normalized tool calls.
 * Handles truncated JSON by attempting bracket fixing.
 */
function parseToolCallJson(jsonStr) {
  if (!jsonStr) return [];

  try {
    return normalizeToolCalls(JSON.parse(jsonStr));
  } catch {
    // Try fixing truncated JSON (missing closing brackets)
    const fixed = tryFixJson(jsonStr);
    return fixed ? normalizeToolCalls(fixed) : [];
  }
}

/**
 * Normalize various tool call formats into [{name, arguments}].
 * Models may use different schemas — this handles them all.
 */
function normalizeToolCalls(parsed) {
  let calls;

  if (Array.isArray(parsed)) {
    calls = parsed;
  } else if (parsed.tool_calls) {
    calls = [].concat(parsed.tool_calls);
  } else if (parsed.function || parsed.name || parsed.tool) {
    calls = [parsed];
  } else {
    return [];
  }

  return calls.map(call => {
    // Format: {function: {name, arguments}}
    if (call.function) {
      return {
        name: call.function.name,
        arguments: call.function.arguments || {},
      };
    }
    // Format: {name, arguments} or {name, parameters}
    if (call.name) {
      return {
        name: call.name,
        arguments: call.arguments || call.parameters || {},
      };
    }
    // Format: {tool, params}
    if (call.tool) {
      return {
        name: call.tool,
        arguments: call.params || call.arguments || {},
      };
    }
    return null;
  }).filter(Boolean);
}

/**
 * Clean trailing artifacts from model output that isn't a tool call.
 * Handles: ".json" suffix, incomplete ```json markers, <tool_call> tags.
 */
function cleanTrailingArtifacts(text) {
  if (!text) return text;

  // Remove trailing ".json" that isn't a file path reference
  if (text.endsWith('.json') && !/[\\/]\S+\.json$/.test(text)) {
    text = text.slice(0, -5).trimEnd();
  }

  // Remove incomplete ```json block at end (no closing ```)
  const lastJsonMarker = text.lastIndexOf('```json');
  if (lastJsonMarker !== -1) {
    const afterMarker = text.substring(lastJsonMarker + 7);
    if (!afterMarker.includes('```')) {
      text = text.substring(0, lastJsonMarker).trimEnd();
    }
  }

  // Remove trailing XML tool_call tags
  const xmlIdx = text.lastIndexOf('<tool_call>');
  if (xmlIdx !== -1 && !text.substring(xmlIdx).includes('</tool_call>')) {
    text = text.substring(0, xmlIdx).trimEnd();
  }

  return text;
}

/**
 * Attempt to fix truncated JSON by adding missing closing brackets/braces.
 */
function tryFixJson(s) {
  let str = s.trim();
  let inStr = false;
  let prev = '';
  const depth = { '{': 0, '[': 0 };

  for (const ch of str) {
    if (ch === '"' && prev !== '\\') inStr = !inStr;
    if (!inStr) {
      if (ch === '{') depth['{']++;
      if (ch === '}') depth['{']--;
      if (ch === '[') depth['[']++;
      if (ch === ']') depth['[']--;
    }
    prev = ch;
  }

  while (depth['['] > 0) { str += ']'; depth['[']--; }
  while (depth['{'] > 0) { str += '}'; depth['{']--; }

  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Extract content from a partial/failed write_file tool call.
 * When a tool call fails to complete, this salvages the actual content
 * that was inside the "content" argument so the user doesn't lose it.
 * 
 * @param {string} buffer — The accumulated buffer containing the failed tool call
 * @returns {string|null} — The extracted content, or null if none found
 */
function extractContentFromPartialToolCall(buffer) {
  if (!buffer || buffer.length < 50) return null;
  
  // Look for "content": followed by the actual content string
  // This handles write_file calls that got truncated
  const patterns = [
    /"content"\s*:\s*"([\s\S]*)/i,           // "content": "...
    /"content"\s*:\s*`([\s\S]*)/i,           // "content": `...
    /"fileContent"\s*:\s*"([\s\S]*)/i,       // "fileContent": "...
    /```[\w]*\n([\s\S]*)$/,                  // Code block at end
  ];
  
  for (const pattern of patterns) {
    const match = buffer.match(pattern);
    if (match && match[1]) {
      let content = match[1];
      
      // Unescape JSON string escapes if we matched a JSON string
      if (pattern.source.includes('"content"') || pattern.source.includes('"fileContent"')) {
        try {
          // Try to find where the string ends (unescaped quote)
          // For truncated strings, just do basic unescaping
          content = content
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        } catch {
          // Keep content as-is if unescaping fails
        }
      }
      
      // Remove any trailing incomplete JSON syntax
      content = content.replace(/["\s]*}\s*```?\s*$/, '');
      content = content.replace(/"\s*$/, '');
      
      if (content.length > 50) {
        return content.trim();
      }
    }
  }
  
  return null;
}

module.exports = { parseResponse, extractToolCalls, cleanTrailingArtifacts, extractContentFromPartialToolCall };
