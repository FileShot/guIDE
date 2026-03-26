/**
 * StreamHandler — Token streaming with look-ahead buffer.
 *
 * Streams tokens to the UI in real time while preventing tool call JSON
 * (```json blocks) from leaking into the displayed response. When the
 * model starts outputting a tool call, the buffer holds those tokens
 * back and emits tool-generating progress events instead.
 */
'use strict';

// Regex to match filePath in raw tool call JSON — accepts all aliases that
// mcpToolServer._normalizeFsParams handles.
const FILE_PATH_RE = /"(?:filePath|file_path|path|filename|file_name|file)"\s*:\s*"([^"]+)"/;

class StreamHandler {
  constructor(mainWindow) {
    this._win = mainWindow;
    this._buffer = '';
    this._sent = 0;
    this._holdingToolCall = false;
    this._holdingFenced = false;  // D03/D07: true when hold triggered by ```json fence, false for raw JSON
    this._toolCallJson = '';
    this._continuationMeta = null; // Fix C: preserved filePath+tool across continuations
    this._contentStreamStarted = false; // true once we've started streaming file content to UI
    this._contentStreamedFlag = false; // set at finalize, readable by agenticLoop
    this._contentStreamSent = 0;        // how many chars of extracted content we've already sent
    this._contentContinuation = false;   // true when continuing content from a previous iteration
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

    // If we've already detected a tool call block, accumulate and stream content
    if (this._holdingToolCall) {
      this._toolCallJson += text;

      // D03/D07: Look-ahead validation for fenced ```json holds.
      // Real tool calls contain "tool": or "tool_calls": within first ~50 chars.
      // Code examples (```json blocks with non-tool content) do not.
      // After 80 chars without a tool call pattern, release as regular text.
      if (this._holdingFenced && this._toolCallJson.length > 80 && !this._looksLikeToolCall()) {
        this._send('llm-token', '```json' + this._toolCallJson);
        this._holdingToolCall = false;
        this._holdingFenced = false;
        this._toolCallJson = '';
        this._contentStreamStarted = false;
        this._contentStreamSent = 0;
        this._sent = this._buffer.length;
        return;
      }

      // Stream file content to UI in real-time for write tools.
      // This ensures the user sees code being written immediately instead of
      // staring at a blank screen while the tool hold accumulates JSON.
      if (this._streamFileContent(text)) return;

      // For non-write tools or before content starts, emit tool progress metadata
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
      this._holdingFenced = true;
      this._toolCallJson = unsent.substring(jsonIdx + 7);
      console.log(`[StreamHandler] Tool hold ENTERED (fenced) — ${before.length} chars sent before hold, ${this._buffer.length} total buffered`);
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
      this._holdingFenced = false;
      this._toolCallJson = unsent.substring(rawIdx);
      console.log(`[StreamHandler] Tool hold ENTERED (raw JSON) — ${before.length} chars sent before hold, ${this._buffer.length} total buffered`);
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
    // Also check: the entire unsent text IS a prefix of or starts with the marker.
    // This catches the case where a token like '{"tool' arrives as one piece —
    // the text IS the marker, it doesn't END WITH a shorter prefix of it.
    const trimmed = text.trimStart();
    if (trimmed.length > 0 && trimmed.length <= marker.length && marker.startsWith(trimmed)) return true;
    if (trimmed.startsWith(marker)) return true;
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

  /**
   * D03/D07: Check if accumulated JSON content looks like a tool call.
   * Used for look-ahead validation on fenced ```json blocks.
   */
  _looksLikeToolCall() {
    return /"tool"\s*:/.test(this._toolCallJson) ||
           /"tool_calls"\s*:/.test(this._toolCallJson);
  }

  /**
   * Stream file content from a write tool call to the UI in real-time.
   * During tool hold, the model generates JSON like:
   *   {"tool":"write_file","params":{"filePath":"app.html","content":"<!DOCTYPE html>..."}}
   * Instead of hiding the content, extract the "content" field and send it as
   * llm-token events so the user sees code being written immediately.
   *
   * For continuation iterations (where the model continues raw content without
   * JSON wrapper), all tokens are sent directly.
   *
   * Returns true if content streaming is active (caller should not emit tool progress).
   */
  _streamFileContent(text) {
    const WRITE_TOOLS = ['write_file', 'create_file', 'append_to_file'];
    const json = this._toolCallJson;

    // Continuation mode: previous iteration was streaming content, model continues
    // with raw content (no JSON wrapper). Send all tokens directly.
    if (this._contentContinuation) {
      this._send('llm-token', text);
      return true;
    }

    // Check if this is a write tool
    const toolMatch = json.match(/"tool"\s*:\s*"([^"]+)"/);
    if (!toolMatch || !WRITE_TOOLS.includes(toolMatch[1])) return false;

    // Check if "content":" has appeared in the accumulated JSON
    const contentMatch = json.match(/"content"\s*:\s*"/);
    if (!contentMatch) return false;

    const contentStart = contentMatch.index + contentMatch[0].length;
    let raw = json.substring(contentStart);

    // Don't process trailing incomplete escape sequences
    if (raw.endsWith('\\') && (raw.length < 2 || raw.charAt(raw.length - 2) !== '\\')) {
      if (!this._contentStreamStarted) return false; // wait for next char
      return true; // content streaming active, but skip this token
    }

    // Unescape JSON string characters
    const unescaped = raw
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

    if (!this._contentStreamStarted) {
      // First time content detected — transition to streaming mode

      // Clear the frontend's generatingToolCalls by sending done:true so that
      // hasTools becomes false and streamingText renders directly (no duplication)
      const nameMatch = json.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: nameMatch ? nameMatch[1] : 'write_file',
        paramsText: '',
        done: true,
      });

      // Determine language for code fence from file extension
      const fpMatch = json.match(FILE_PATH_RE);
      const fp = fpMatch ? fpMatch[1] : '';
      const ext = fp.includes('.') ? fp.split('.').pop().toLowerCase() : '';
      let fenceLabel = ext || 'text';

      // R15-Fix-C: When file extension is unknown, sniff content type from
      // the first few chars of the content being streamed.
      if (fenceLabel === 'text') {
        const contentMatch = json.match(/"content"\s*:\s*"/);
        if (contentMatch) {
          const snippet = json.substring(contentMatch.index + contentMatch[0].length, contentMatch.index + contentMatch[0].length + 120);
          const unSnippet = snippet.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trimStart();
          if (/^<!DOCTYPE\s+html/i.test(unSnippet) || /^<html[\s>]/i.test(unSnippet)) fenceLabel = 'html';
          else if (/^import\s|^from\s|^def\s|^class\s/.test(unSnippet)) fenceLabel = 'python';
          else if (/^(?:import|export|const|let|var|function|class)\s/.test(unSnippet)) fenceLabel = 'javascript';
          else if (/^(?:#include|#pragma|int\s+main)/.test(unSnippet)) fenceLabel = 'c';
          else if (/^\{[\s\n]*"/.test(unSnippet)) fenceLabel = 'json';
          else if (/^---\n|^title:/.test(unSnippet)) fenceLabel = 'yaml';
        }
      }

      // Send code fence opener with filename
      if (fp) {
        const fname = fp.includes('/') ? fp.split('/').pop() : fp.includes('\\') ? fp.split('\\').pop() : fp;
        this._send('llm-token', `\nWriting **${fname}**...\n\`\`\`${fenceLabel}\n`);
      } else {
        this._send('llm-token', `\n\`\`\`${fenceLabel}\n`);
      }

      this._contentStreamStarted = true;
      this._contentStreamSent = 0;
      console.log(`[StreamHandler] Content streaming STARTED for ${fp || 'unknown file'} — content visible in real-time`);
    }

    // Send only the newly generated content (delta since last send)
    const newContent = unescaped.substring(this._contentStreamSent);
    if (newContent) {
      this._send('llm-token', newContent);
      this._contentStreamSent = unescaped.length;
    }

    return true;
  }

  /** Emit tool-generating progress from accumulated JSON. */
  _emitToolProgress() {
    // Match both "name": and "tool": patterns (different model output styles)
    const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: nameMatch[1],
        paramsText: this._toolCallJson,
        done: false,
      });
    } else if (this._toolCallJson.length > 10) {
      // Emit progress even before tool name is found (model is generating)
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: '...',
        paramsText: this._toolCallJson,
        done: false,
      });
    } else if (this._toolCallJson.length === 0 && this._continuationMeta) {
      // Fix C: Between continuations, _toolCallJson is empty but we preserved
      // the filePath/tool from the previous iteration. Emit a progress event
      // with the meta so the frontend can maintain the code block.
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: this._continuationMeta.tool || '...',
        paramsText: `{"tool":"${this._continuationMeta.tool}","params":{"filePath":"${this._continuationMeta.filePath}"}}`,
        done: false,
      });
    }
  }

  /**
   * Called when generation finishes.
   * If not holding a tool call, flushes remaining buffer.
   * D03/D07: If holding content that turned out NOT to be a tool call
   * (false positive — e.g. a ```json code example), flush it to the UI.
   */
  finalize(isToolCall) {
    // D03/D07: False positive recovery — release held content as regular text
    if (this._holdingToolCall && !isToolCall) {
      const prefix = this._holdingFenced ? '```json' : '';
      console.log(`[StreamHandler] Tool hold RELEASED (false positive) — ${this._toolCallJson.length} chars released as text`);
      // Clear frontend generatingToolCalls BEFORE releasing text — prevents
      // hasTools staying true and suppressing streaming text rendering
      const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
      this._send('llm-tool-generating', {
        callIndex: 0,
        functionName: nameMatch ? nameMatch[1] : '...',
        paramsText: '',
        done: true,
      });
      this._send('llm-token', prefix + this._toolCallJson);
      this._holdingToolCall = false;
      this._holdingFenced = false;
      this._toolCallJson = '';
      this._contentStreamStarted = false;
      this._contentStreamSent = 0;
      this._contentContinuation = false;
      this._sent = this._buffer.length;
    }

    if (!this._holdingToolCall && !isToolCall) {
      this._flush();
    }
    // Mark tool call generation as done (only for real tool calls still being held)
    if (this._holdingToolCall) {
      this._contentStreamedFlag = this._contentStreamStarted || this._contentContinuation;
      console.log(`[StreamHandler] Tool hold FINALIZED (real tool call) — ${this._toolCallJson.length} chars in tool JSON, contentStreamed=${this._contentStreamedFlag}`);

      // Close the code fence if we were streaming file content to the UI
      if (this._contentStreamedFlag) {
        this._send('llm-token', '\n```\n');
      }

      const nameMatch = this._toolCallJson.match(/"(?:name|tool)"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        this._send('llm-tool-generating', {
          callIndex: 0,
          functionName: nameMatch[1],
          paramsText: this._toolCallJson,
          done: true,
        });
      }
    }
  }

  /** Check if content was streamed to UI during the last finalize cycle. */
  wasContentStreamed() {
    return this._contentStreamedFlag || false;
  }

  /** Reset buffer state for the next generation cycle. */
  reset() {
    if (this._holdingToolCall && this._toolCallJson.length > 0) {
      console.log(`[StreamHandler] reset() — clearing ${this._toolCallJson.length} chars of held tool JSON (was ${this._holdingFenced ? 'fenced' : 'raw'})`);
    }
    this._buffer = '';
    this._sent = 0;
    this._holdingToolCall = false;
    this._holdingFenced = false;
    this._toolCallJson = '';
    this._continuationMeta = null;
    this._contentStreamStarted = false;
    this._contentStreamedFlag = false;
    this._contentStreamSent = 0;
    this._contentContinuation = false;
  }

  /**
   * Partial reset for continuation iterations where a tool call is in progress.
   * Preserves the tool-hold state (_holdingToolCall, _holdingFenced) so that
   * new tokens from the continuation stream directly into the same
   * tool-generating event — keeping the UI code block alive.
   * Preserves _continuationMeta (filePath+tool) so the frontend can maintain
   * the code block even when _toolCallJson is empty between continuations.
   * Only resets the buffer position counters for the new generation cycle.
   *
   * If content was being streamed to the UI, sets _contentContinuation so the
   * next iteration sends raw tokens directly (model continues without JSON wrapper).
   */
  continueToolHold() {
    // Extract filePath and tool name before clearing _toolCallJson
    if (this._toolCallJson.length > 0) {
      const fpMatch = this._toolCallJson.match(FILE_PATH_RE);
      const toolMatch = this._toolCallJson.match(/"tool"\s*:\s*"([^"]+)"/);
      if (fpMatch || toolMatch) {
        this._continuationMeta = {
          filePath: fpMatch ? fpMatch[1] : (this._continuationMeta?.filePath || ''),
          tool: toolMatch ? toolMatch[1] : (this._continuationMeta?.tool || ''),
        };
      }
    }
    // If we were streaming file content, set continuation flag so new tokens
    // are sent directly as llm-token events (model continues raw content).
    if (this._contentStreamStarted) {
      this._contentContinuation = true;
      console.log('[StreamHandler] Content continuation mode — raw tokens will stream to UI');
    }
    this._buffer = '';
    this._sent = 0;
    this._toolCallJson = '';
    this._contentStreamStarted = false;
    this._contentStreamSent = 0;
    // _holdingToolCall, _holdingFenced, _contentContinuation are intentionally preserved
  }

  getFullText()    { return this._buffer; }
  isHoldingTool()  { return this._holdingToolCall; }
  isHoldingFenced() { return this._holdingFenced; }

  /**
   * Atomic tool checkpoint — sends finalize + executing + results as ONE IPC event.
   * Prevents the race condition where generatingToolCalls is cleared before
   * completedStreamingTools is populated, causing code blocks to disappear
   * for 1-2 React render frames during context rotation.
   */
  toolCheckpoint(toolDataArray) {
    // Close code fence if content was being streamed
    if (this._contentStreamStarted || this._contentContinuation) {
      this._send('llm-token', '\n```\n');
    }
    // Finalize any held tool call state without sending the separate done:true event
    this._holdingToolCall = false;
    this._holdingFenced = false;
    this._toolCallJson = '';
    this._contentStreamStarted = false;
    this._contentStreamSent = 0;
    this._contentContinuation = false;

    // Send a single atomic event the frontend can process in one state update
    this._send('tool-checkpoint', toolDataArray);
  }

  /**
   * Notify frontend of updated accumulated file content without disrupting tool-hold state.
   * Called after every direct executeTool() checkpoint in D6/continuation paths so that
   * fileContentAccRef stays current and code blocks show the full growing file, not just
   * the tiny current-iteration stream.
   */
  fileAccUpdate(filePath, fullContent) {
    this._send('llm-file-acc-update', { filePath, fullContent });
  }

  /* ── Other UI events ────────────────────────────────────── */
  thinkingToken(t)           { this._send('llm-thinking-token', t); }
  iterationBegin()           { this._send('llm-iteration-begin'); }
  replaceLast(text)          { this._send('llm-replace-last', text); }
  progress(i, max)           { this._send('agentic-progress', { iteration: i, maxIterations: max }); }
  phase(p, s, label)         { this._send('agentic-phase', { phase: p, status: s, label }); }
  toolExecuting(tools)       { this._send('tool-executing', tools); }
  toolResults(results)       { this._send('mcp-tool-results', results); }
  contextUsage(used, total)  { this._send('context-usage', { used, total }); }
  tokenStats(stats)          { this._send('token-stats', stats); }
  todoUpdate(todos)          { this._send('todo-update', todos); }
}

module.exports = { StreamHandler };
