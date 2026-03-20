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
 * @param {string} [taskContext.lastText] Last ~200 chars of output so model knows where it stopped.
 * @param {boolean} [taskContext.toolInProgress] Whether a tool call was being written.
 * @param {string} [taskContext.fileName] File being written/generated, if any.
 */
function continuationMessage(taskContext) {
  let msg = 'Continue exactly where you left off. Do not repeat any content already written. Do not restart from the beginning.';
  if (taskContext) {
    if (taskContext.toolInProgress) {
      msg += ' You were in the middle of writing a tool call JSON — complete it.';
    }
    if (taskContext.fileName) {
      msg += ` You were writing file: ${taskContext.fileName}.`;
    }
    if (taskContext.lastText) {
      const tail = taskContext.lastText.slice(-200);
      msg += `\nYour output ended with: "${tail}"`;
    }
  }
  return msg;
}

module.exports = { shouldContinue, continuationMessage };
