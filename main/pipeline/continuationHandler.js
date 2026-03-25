/**
 * ContinuationHandler — Seamless continuation when maxTokens is hit.
 *
 * When a model's response is truncated (stopReason === 'maxTokens'),
 * this module determines that continuation is needed and produces
 * the message to send back to the model to resume.
 *
 * With Solution A (native contextShift) active, the KV cache preserves
 * the model's recent output. Continuation messages can be minimal because
 * the model already has context from the KV cache — no need for elaborate
 * HEAD+TAIL anchoring that consumes precious context tokens.
 */
'use strict';

/**
 * Determine if a generation result was truncated and should be continued.
 */
function shouldContinue(result) {
  return result && result.stopReason === 'maxTokens';
}

/**
 * Build the continuation user message.
 * Kept minimal to preserve context budget — the KV cache carries the real context.
 *
 * @param {Object} [taskContext] Optional context about current state.
 * @param {string} [taskContext.lastText] Tail of accumulated output.
 * @param {boolean} [taskContext.toolInProgress] Whether a tool call was being written.
 * @param {string} [taskContext.accumulatedBuffer] Full buffer when accumulating across continuations.
 * @param {boolean} [taskContext.midFence] Whether we were inside a fenced code block.
 * @param {string} [taskContext.fileName] File being written/generated, if any.
 */
function continuationMessage(taskContext) {
  if (!taskContext) {
    return 'Continue exactly where you left off. Do not repeat any content already written.';
  }

  // Fix B: Include original task goal so model knows what to continue after compression
  const goalPrefix = taskContext.taskGoal
    ? `Original task: ${taskContext.taskGoal.slice(0, 300)}\n`
    : '';

  // Tool call in progress — minimal but specific
  if (taskContext.toolInProgress) {
    const fileName = taskContext.fileName || null;
    let msg = goalPrefix;
    msg += fileName
      ? `Continue writing "${fileName}" from exactly where you stopped. Use append_to_file.`
      : 'Continue the tool call from exactly where you stopped.';

    if (taskContext.accumulatedBuffer) {
      const contentMatch = taskContext.accumulatedBuffer.match(/"content"\s*:\s*"([\s\S]*)/);
      const fileContent = contentMatch ? contentMatch[1] : taskContext.accumulatedBuffer;
      const lineCount = (fileContent.match(/\n/g) || []).length + 1;

      // Show only the TAIL — KV cache has the full context, we just need
      // to remind the model where it was
      const tail = fileContent.slice(-800);
      msg += `\nWritten so far: ~${lineCount} lines.`;
      // Fix B: Include progress tracking if available
      if (taskContext.fileProgress) {
        msg += ` File progress: ${taskContext.fileProgress}`;
      }
      msg += `\nEnds with:\n${tail}`;
      if (fileName) {
        msg += `\nDo NOT use write_file (overwrites). Do NOT restart. Continue content after the tail shown.`;
      }
    } else if (taskContext.lastText) {
      const tail = (taskContext.lastText || '').slice(-400);
      msg += `\nEnds with:\n${tail}`;
    }

    return msg;
  }

  // Regular continuation — keep it minimal
  let msg = goalPrefix + 'Continue exactly where you left off.';

  if (taskContext.midFence) {
    msg += ' You are INSIDE a code block — output ONLY code, no text or summaries.';
  }

  if (taskContext.lastText) {
    const tail = (taskContext.lastText || '').slice(-400);
    msg += `\nEnds with:\n${tail}`;
  }

  return msg;
}

module.exports = { shouldContinue, continuationMessage };
