/**
 * IPC Handlers: Inline Edit, Next Edit Suggestion, Terminal Suggest, Token Estimation
 */
const { ipcMain } = require('electron');

function register(ctx) {
  // ─── Inline Edit (Ctrl+I) ─────────────────────────────────────────
  ipcMain.handle('inline-edit', async (_, params) => {
    try {
      const { filePath, selectedText, cursorLine, instruction, surrounding } = params;
      const lineInfo = cursorLine ? `(cursor at line ${cursorLine})` : '';
      let prompt = `You are a code editor. The user wants you to edit code inline.\n\nFile: ${filePath} ${lineInfo}\n`;
      if (selectedText) {
        prompt += `\nSelected code to modify:\n\`\`\`\n${selectedText}\n\`\`\`\n`;
      } else if (surrounding) {
        prompt += `\nCode around cursor:\n\`\`\`\n${surrounding}\n\`\`\`\n`;
      }
      prompt += `\nInstruction: ${instruction}\n\nRespond with ONLY the replacement code. No explanation, no markdown fences, no surrounding code — just the exact code that should replace the selected/surrounding text.`;

      const isCloud = params.cloudProvider && params.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 2048, temperature: 0.3, systemPrompt: 'You are a precise code editor. Output only code.',
        });
      } else if (ctx.llmEngine.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 2048, temperature: 0.3 });
      } else {
        return { success: false, error: 'No model loaded' };
      }
      return { success: true, code: (result.text || result).trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ─── Next Edit Suggestion ──────────────────────────────────────────
  ipcMain.handle('next-edit-suggestion', async (_, params) => {
    try {
      const { filePath, fileContent, recentEdit, cursorLine } = params;

      // Build a cursor-centered context window (~12KB) instead of just first 8KB
      const lines = fileContent.split('\n');
      const totalLines = lines.length;
      const cursorIdx = Math.max(0, Math.min((cursorLine || 1) - 1, totalLines - 1));

      // Allocate ~80 lines before cursor and ~40 lines after for context
      const prefixStart = Math.max(0, cursorIdx - 80);
      const suffixEnd = Math.min(totalLines, cursorIdx + 40);
      const prefix = lines.slice(prefixStart, cursorIdx + 1).join('\n');
      const suffix = lines.slice(cursorIdx + 1, suffixEnd).join('\n');

      // Use FIM-style (Fill-in-Middle) prompting for better predictions
      const prompt = `You are a code prediction engine specialized in predicting the user's next edit.

File: ${filePath} (${totalLines} lines)
Cursor at line ${cursorLine}.

Recent edit by user: ${recentEdit}

Code BEFORE cursor (lines ${prefixStart + 1}-${cursorIdx + 1}):
\`\`\`
${prefix}
\`\`\`

Code AFTER cursor (lines ${cursorIdx + 2}-${suffixEnd}):
\`\`\`
${suffix}
\`\`\`

Based on the recent edit and surrounding code context, predict the SINGLE most likely next edit.
The prediction should be a logical continuation or companion change to the recent edit.
Multi-line edits are allowed — provide the full text including newlines.

Output ONLY a JSON object:
{"line": <line_number>, "oldText": "<exact_text_to_replace_or_empty>", "newText": "<replacement_text>"}

If no obvious next edit, output: {"line": 0, "oldText": "", "newText": ""}`;

      const isCloud = params.cloudProvider && params.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 512, temperature: 0.2, systemPrompt: 'Output only valid JSON. No markdown, no explanation.',
        });
      } else if (ctx.llmEngine.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 512, temperature: 0.2 });
      } else {
        return { success: false };
      }
      const text = (result.text || result || '').trim();
      // Use a non-greedy match to grab just the first JSON object
      const jsonMatch = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.line > 0 && parsed.newText) return { success: true, suggestion: parsed };
      }
      return { success: false };
    } catch (_) {
      return { success: false };
    }
  });

  // ─── Terminal Command Suggestions ──────────────────────────────────
  ipcMain.handle('terminal-suggest', async (_, params) => {
    try {
      const { partialCommand, cwd, recentCommands } = params;
      const prompt = `Suggest terminal command completions. Current directory: ${cwd || 'unknown'}\nRecent commands: ${(recentCommands || []).slice(-5).join(', ')}\nPartial input: "${partialCommand}"\n\nReturn a JSON array of up to 5 completion suggestions. Each: {"command": "full command", "description": "brief description"}\nOutput ONLY the JSON array.`;

      let result;
      if (ctx.llmEngine.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 512, temperature: 0.3 });
      } else {
        return { success: true, suggestions: [] };
      }
      const text = (result.text || result || '').trim();
      const arrMatch = text.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const parsed = JSON.parse(arrMatch[0]);
        return { success: true, suggestions: parsed.slice(0, 5) };
      }
      return { success: true, suggestions: [] };
    } catch (_) {
      return { success: true, suggestions: [] };
    }
  });

  // ─── Token Estimation ──────────────────────────────────────────────
  ipcMain.handle('estimate-tokens', (_, text) => {
    return { tokens: Math.ceil((text || '').length / 4) };
  });

  ipcMain.handle('get-context-usage', () => {
    const status = ctx.llmEngine.getStatus();
    const ctxSize = status.modelInfo?.contextSize || 0;
    return { contextSize: ctxSize, modelName: status.modelInfo?.name || '' };
  });

  // ─── AI Code Actions (Explain, Refactor, Fix, Tests, Optimize, Comments) ──
  ipcMain.handle('code-action', async (_, params) => {
    try {
      const { action, filePath, selectedText, fileContent, cursorLine, language } = params;
      if (!selectedText && !fileContent) return { success: false, error: 'No code provided' };

      const codeSnippet = selectedText || fileContent.substring(0, 6000);
      const langHint = language ? ` (${language})` : '';

      const ACTION_PROMPTS = {
        explain: `Explain the following code clearly and concisely. Describe what it does, key algorithms, and any important patterns or edge cases.\n\nFile: ${filePath}${langHint}, line ${cursorLine}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
        refactor: `Refactor the following code to improve readability, maintainability, and best practices while preserving functionality. Return ONLY the refactored code, no explanations.\n\nFile: ${filePath}${langHint}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
        fix: `Find and fix all bugs, errors, and potential issues in the following code. Return ONLY the fixed code, no explanations.\n\nFile: ${filePath}${langHint}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
        'add-tests': `Write comprehensive unit tests for the following code. Use the appropriate testing framework for the language (Jest for JS/TS, pytest for Python, etc). Include edge cases.\n\nFile: ${filePath}${langHint}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
        optimize: `Optimize the following code for better performance (time complexity, memory usage, algorithm choice). Return ONLY the optimized code, no explanations.\n\nFile: ${filePath}${langHint}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
        'add-comments': `Add clear, helpful comments and JSDoc/docstring documentation to the following code. Return ONLY the commented code.\n\nFile: ${filePath}${langHint}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
        'add-types': `Add complete TypeScript type annotations to the following code. Infer types accurately. Return ONLY the typed code, no explanations.\n\nFile: ${filePath}${langHint}\n\n\`\`\`\n${codeSnippet}\n\`\`\``,
      };

      const prompt = ACTION_PROMPTS[action];
      if (!prompt) return { success: false, error: `Unknown action: ${action}` };

      const isExplanation = action === 'explain';
      const systemPrompt = isExplanation
        ? 'You are a senior code reviewer. Provide clear, concise explanations.'
        : 'You are a precise code editor. Output only code — no markdown fences, no explanations.';

      const isCloud = params.cloudProvider && params.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 4096, temperature: isExplanation ? 0.5 : 0.2, systemPrompt,
        });
      } else if (ctx.llmEngine.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 4096, temperature: isExplanation ? 0.5 : 0.2 });
      } else {
        // Fallback to cloud with defaults
        try {
          result = await ctx.cloudLLM.generate(prompt, { maxTokens: 4096, temperature: isExplanation ? 0.5 : 0.2, systemPrompt });
        } catch (_e) {
          return { success: false, error: 'No model available (local or cloud)' };
        }
      }

      let text = (result.text || result || '').trim();
      // Strip markdown fences if not explanation
      if (!isExplanation) {
        text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');
      }

      return { success: true, result: text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
