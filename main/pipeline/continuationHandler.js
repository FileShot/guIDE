/**
 * ContinuationHandler — Seamless continuation when maxTokens is hit.
 *
 * When a model's response is truncated (stopReason === 'maxTokens'),
 * this module determines that continuation is needed and produces
 * the message to send back to the model to resume.
 */
'use strict';

/**
 * Determine if a generation result was truncated and should be continued.
 */
function shouldContinue(result) {
  return result && result.stopReason === 'maxTokens';
}

/**
 * Build the continuation user message with task context.
 * @param {Object} [taskContext] Optional context about current state.
 * @param {string} [taskContext.lastText] Last text of output so model knows where it stopped.
 * @param {boolean} [taskContext.toolInProgress] Whether a tool call was being written.
 * @param {string} [taskContext.accumulatedBuffer] Full buffer when accumulating across continuations.
 * @param {boolean} [taskContext.midFence] Whether we were inside a fenced code block.
 * @param {string} [taskContext.fileName] File being written/generated, if any.
 */
function continuationMessage(taskContext) {
  if (!taskContext) {
    return 'Continue exactly where you left off. Do not repeat any content already written.';
  }

  // Tool call in progress — needs structural context so model knows where it stopped
  if (taskContext.toolInProgress) {
    let msg = 'Your output was cut off mid-tool-call. Continue writing from exactly where you stopped — do not repeat content.';
    
    if (taskContext.accumulatedBuffer) {
      // Show more context for tool calls (up to 3000 chars) so model understands structure
      // Risk mitigation: cap at 3000 to avoid context overflow
      const bufLen = taskContext.accumulatedBuffer.length;
      const previewLen = Math.min(3000, bufLen);
      const preview = bufLen > previewLen 
        ? '...' + taskContext.accumulatedBuffer.slice(-previewLen)
        : taskContext.accumulatedBuffer;
      msg += `\n\nYou have written ${bufLen} chars so far. Last portion:\n${preview}`;
      msg += '\n\nContinue from that exact point. Complete the content, then close all JSON brackets.';
    } else if (taskContext.lastText) {
      const tail = (taskContext.lastText || '').slice(-500);
      msg += `\nYour output ended with:\n"${tail}"\n\nContinue from there.`;
    }
    
    if (taskContext.midFence) {
      msg += ' You were inside a fenced code block — continue inside it, do not open a new fence.';
    }
    
    return msg;
  }

  // Regular continuation (not tool call)
  let msg = 'Continue exactly where you left off. Do not repeat any content already written.';
  
  if (taskContext.midFence) {
    msg += ' You were inside a fenced code block — continue writing code immediately from where you stopped. Do NOT open a new code fence, do NOT restart the file, do NOT use write_file. Just continue the code.';
  }
  
  if (taskContext.lastText) {
    // Show 500 chars for regular continuation (more than before for better context)
    const tail = (taskContext.lastText || '').slice(-500);
    msg += `\nYour output ended with:\n"${tail}"`;
  }
  
  return msg;
}

module.exports = { shouldContinue, continuationMessage };
