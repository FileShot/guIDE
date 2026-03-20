/**
 * StreamHandler — Token streaming with look-ahead buffer.
 *
 * Streams tokens to the UI in real time while preventing tool call JSON
 * (```json blocks) from leaking into the displayed response. When the
 * model starts outputting a tool call, the buffer holds those tokens
 * back and emits tool-generating progress events instead.
 */
'use strict';

class StreamHandler {
  constructor(mainWindow) {
    this._win = mainWindow;
    this._buffer = '';
    this._sent = 0;
    this._holdingToolCall = false;
    this._toolCallJson = '';
  }

  /* ── Core send (safe against destroyed windows) ─────────── */
  _send(event, data) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(event, data);
    }
  }

  /* ── Token handling with look-ahead buffer ──────────────── */

  /**
   * Called for every token the model produces.
   * Buffers tokens that might be the start of a ```json tool call block
   * and sends everything else to the UI immediately.
   */
  onToken(text) {
    this._buffer += text;

    // If we've already detected a tool call block, swallow all subsequent tokens
    if (this._holdingToolCall) {
      this._toolCallJson += text;
      this._emitToolProgress();
      return;
    }

    const unsent = this._buffer.slice(this._sent);

    // Check if unsent text contains a complete ```json marker
    const jsonIdx = unsent.indexOf('```json');
    if (jsonIdx !== -1) {
      const before = unsent.substring(0, jsonIdx);
      if (before) this._send('llm-token', before);
      this._sent = this._buffer.length;
      this._holdingToolCall = true;
      this._toolCallJson = unsent.substring(jsonIdx + 7);
      this._emitToolProgress();
      return;
    }

    // Check for raw JSON tool call patterns (no fences)
    const rawIdx = this._detectRawJsonToolCall(unsent);
    if (rawIdx !== -1) {
      const before = unsent.substring(0, rawIdx);
      if (before) this._send('llm-token', before);
      this._sent = this._buffer.length;
      this._holdingToolCall = true;
      this._toolCallJson = unsent.substring(rawIdx);
      this._emitToolProgress();
      return;
    }

    // Check if unsent ends with a partial marker (prefix of "```json")
    if (this._endsWithPartialMarker(unsent)) {
      return;
    }

    // Check if unsent ends with a partial raw JSON marker
    if (this._endsWithPartialJsonMarker(unsent)) {
      return;
    }

    // No tool call pattern — safe to send
    this._flush();
  }

  /**
   * Check if `text` ends with any prefix of "```json".
   */
  _endsWithPartialMarker(text) {
    const marker = '```json';
    for (let len = 1; len < marker.length; len++) {
      if (text.endsWith(marker.substring(0, len))) return true;
    }
    return false;
  }

  /**
   * Detect a raw JSON tool call pattern in text (no fences).
   * Returns the index where the JSON object starts, or -1 if none found.
   */
  _detectRawJsonToolCall(text) {
    // Only match if the JSON appears to be a tool call, not regular JSON in prose
    const patterns = [
      /\{"tool_calls"\s*:\s*\[/,
      /\{"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:/,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) return m.index;
    }
    return -1;
  }

  /**
   * Check if text ends with a partial raw JSON tool call marker.
   * Holds buffer when we see opening chars that could become {"tool or {"tool_calls
   */
  _endsWithPartialJsonMarker(text) {
    // Check if text ends with any prefix of '{"tool' (min 2 chars to avoid false positives)
    const marker = '{"tool';
    for (let len = 2; len < marker.length; len++) {
      if (text.endsWith(marker.substring(0, len))) return true;
    }
    return false;
  }

  /** Send all unsent text to the UI. */
  _flush() {
    const unsent = this._buffer.slice(this._sent);
    if (unsent) {
      this._send('llm-token', unsent);
      this._sent = this._buffer.length;
    }
  }

  /** Emit tool-generating progress from accumulated JSON. */
  _emitToolProgress() {
    const nameMatch = this._toolCallJson.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: nameMatch[1],
        paramsText: this._toolCallJson.slice(0, 300),
        done: false,
      });
    }
  }

  /**
   * Called when generation finishes.
   * If not holding a tool call, flushes remaining buffer.
   */
  finalize(isToolCall) {
    if (!this._holdingToolCall && !isToolCall) {
      this._flush();
    }
    // Mark tool call generation as done
    if (this._holdingToolCall) {
      const nameMatch = this._toolCallJson.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        this._send('llm-tool-generating', {
          callIndex: 0,
          functionName: nameMatch[1],
          paramsText: this._toolCallJson.slice(0, 300),
          done: true,
        });
      }
    }
  }

  /** Reset buffer state for the next generation cycle. */
  reset() {
    this._buffer = '';
    this._sent = 0;
    this._holdingToolCall = false;
    this._toolCallJson = '';
  }

  getFullText()    { return this._buffer; }
  isHoldingTool()  { return this._holdingToolCall; }

  /* ── Other UI events ────────────────────────────────────── */
  thinkingToken(t)           { this._send('llm-thinking-token', t); }
  iterationBegin()           { this._send('llm-iteration-begin'); }
  progress(i, max)           { this._send('agentic-progress', { iteration: i, maxIterations: max }); }
  phase(p, s, label)         { this._send('agentic-phase', { phase: p, status: s, label }); }
  toolExecuting(tools)       { this._send('mcp-executing-tools', tools); }
  toolResults(results)       { this._send('mcp-tool-results', results); }
  contextUsage(used, total)  { this._send('context-usage', { used, total }); }
  tokenStats(stats)          { this._send('token-stats', stats); }
  todoUpdate(todos)          { this._send('todo-update', todos); }
}

module.exports = { StreamHandler };
