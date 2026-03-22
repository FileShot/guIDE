/**
 * IPC Handlers: Git Integration + AI-Powered Git Workflow
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ipcMain.handle('git-status', async () => {
    try { return await ctx.gitManager.getStatus(); }
    catch (error) { return { files: [], branch: '', error: error.message }; }
  });

  ipcMain.handle('git-diff', async (_, filePath, staged) => ctx.gitManager.getDiff(filePath, staged));
  ipcMain.handle('git-stage', async (_, filePath) => ctx.gitManager.stage(filePath));
  ipcMain.handle('git-stage-all', async () => ctx.gitManager.stageAll());
  ipcMain.handle('git-unstage', async (_, filePath) => ctx.gitManager.unstage(filePath));
  ipcMain.handle('git-unstage-all', async () => ctx.gitManager.unstageAll());
  ipcMain.handle('git-discard', async (_, filePath) => ctx.gitManager.discardChanges(filePath));
  ipcMain.handle('git-commit', async (_, message) => ctx.gitManager.commit(message));
  ipcMain.handle('git-log', async (_, count) => ctx.gitManager.getLog(count));
  ipcMain.handle('git-branches', async () => ctx.gitManager.getBranches());
  ipcMain.handle('git-checkout', async (_, branch) => ctx.gitManager.checkout(branch));
  ipcMain.handle('git-init', async () => ctx.gitManager.init());
  ipcMain.handle('git-ahead-behind', async () => ctx.gitManager.getAheadBehind());

  ipcMain.handle('git-blame', async (_, filePath) => {
    try {
      const blame = await ctx.gitManager.getBlame(filePath);
      return { success: true, blame };
    } catch (e) {
      return { success: false, error: e.message, blame: [] };
    }
  });

  // ─── NEW: Push / Pull / Fetch ──────────────────────────────────────
  ipcMain.handle('git-push', async (_, remote, branch) => {
    try { return await ctx.gitManager.push(remote, branch); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-pull', async (_, remote, branch) => {
    try { return await ctx.gitManager.pull(remote, branch); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-fetch', async (_, remote) => {
    try { return await ctx.gitManager.fetch(remote); }
    catch (e) { return { success: false, error: e.message }; }
  });

  // ─── NEW: Branch management ────────────────────────────────────────
  ipcMain.handle('git-create-branch', async (_, name, checkout) => {
    try { return await ctx.gitManager.createBranch(name, checkout); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-delete-branch', async (_, name, force) => {
    try { return await ctx.gitManager.deleteBranch(name, force); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-merge', async (_, branch) => {
    try { return await ctx.gitManager.merge(branch); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-merge-abort', async () => {
    try { return await ctx.gitManager.mergeAbort(); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-merge-state', async () => {
    try { return await ctx.gitManager.getMergeState(); }
    catch (e) { return { inMerge: false, conflictFiles: [] }; }
  });

  // ─── NEW: Commit detail ────────────────────────────────────────────
  ipcMain.handle('git-commit-detail', async (_, hash) => {
    try { return await ctx.gitManager.getCommitDetail(hash); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('git-commit-diff', async (_, hash) => {
    try { return await ctx.gitManager.getCommitDiff(hash); }
    catch (e) { return { success: false, diff: '', error: e.message }; }
  });

  ipcMain.handle('git-staged-diff', async () => {
    try { return await ctx.gitManager.getStagedDiff(); }
    catch (e) { return { success: false, diff: '', error: e.message }; }
  });

  // ─── AI: Generate commit message from staged diff ──────────────────
  ipcMain.handle('git-ai-commit-message', async (_, params) => {
    try {
      const diffResult = await ctx.gitManager.getStagedDiff();
      if (!diffResult.success || !diffResult.diff.trim()) {
        return { success: false, error: 'No staged changes to generate a commit message for' };
      }
      // Truncate large diffs to avoid context overflow
      const diff = diffResult.diff.substring(0, 12000);
      const status = await ctx.gitManager.getStatus();
      const stagedFiles = (status.files || []).filter(f => f.staged).map(f => `${f.status}: ${f.path}`);

      const prompt = `You are a Git commit message generator. Analyze the following diff and staged files, then generate a clear, concise, conventional commit message.

Follow Conventional Commits format:
<type>(<scope>): <subject>

<body>

Types: feat, fix, refactor, style, docs, test, chore, perf, ci, build
- Subject should be imperative mood, max 72 chars, no period at end
- Body should explain WHAT changed and WHY (not HOW), wrapped at 72 chars
- If changes are trivial, skip the body

Staged files:
${stagedFiles.join('\n')}

Diff:
\`\`\`
${diff}
\`\`\`

Output ONLY the commit message text. No markdown fences, no explanation.`;

      const isCloud = params?.cloudProvider && params?.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 512, temperature: 0.3,
          systemPrompt: 'You write precise git commit messages. Output only the commit message.',
        });
      } else if (ctx.llmEngine?.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 512, temperature: 0.3 });
      } else {
        try {
          result = await ctx.cloudLLM.generate(prompt, {
            maxTokens: 512, temperature: 0.3,
            systemPrompt: 'You write precise git commit messages. Output only the commit message.',
          });
        } catch {
          return { success: false, error: 'No AI model available' };
        }
      }
      const text = (result.text || result || '').trim();
      return { success: true, message: text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ─── AI: Explain a commit ──────────────────────────────────────────
  ipcMain.handle('git-ai-explain-commit', async (_, params) => {
    try {
      const { hash } = params;
      const [detail, diffResult] = await Promise.all([
        ctx.gitManager.getCommitDetail(hash),
        ctx.gitManager.getCommitDiff(hash),
      ]);

      if (!detail.success) return { success: false, error: detail.error };

      const commit = detail.commit;
      const diff = (diffResult.diff || '').substring(0, 12000);

      const prompt = `Explain the following git commit clearly and concisely. Describe what was changed, why it was likely changed, and any notable patterns or concerns.

Commit: ${commit.hash}
Author: ${commit.author} <${commit.email}>
Date: ${commit.date}
Subject: ${commit.subject}
${commit.body ? `Body: ${commit.body}` : ''}

File changes:
${commit.stats}

Diff:
\`\`\`
${diff}
\`\`\`

Provide a clear, developer-friendly explanation in 2-4 paragraphs.`;

      const isCloud = params?.cloudProvider && params?.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 2048, temperature: 0.4,
          systemPrompt: 'You are a senior developer explaining git commits.',
        });
      } else if (ctx.llmEngine?.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 2048, temperature: 0.4 });
      } else {
        try {
          result = await ctx.cloudLLM.generate(prompt, {
            maxTokens: 2048, temperature: 0.4,
            systemPrompt: 'You are a senior developer explaining git commits.',
          });
        } catch {
          return { success: false, error: 'No AI model available' };
        }
      }
      const text = (result.text || result || '').trim();
      return { success: true, explanation: text, commit };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ─── AI: Resolve merge conflicts ───────────────────────────────────
  ipcMain.handle('git-ai-resolve-conflict', async (_, params) => {
    try {
      const { filePath, fileContent } = params;
      if (!fileContent) return { success: false, error: 'No file content provided' };

      // Extract conflict markers
      const hasConflicts = fileContent.includes('<<<<<<<') && fileContent.includes('>>>>>>>');
      if (!hasConflicts) return { success: false, error: 'No conflict markers found in file' };

      const prompt = `You are a merge conflict resolver. The following file has git merge conflicts (marked with <<<<<<<, =======, >>>>>>>).

Analyze both sides of each conflict and produce the BEST merged version that:
1. Preserves all intended functionality from both sides
2. Resolves any logical conflicts intelligently
3. Removes all conflict markers

File: ${filePath}

Content with conflicts:
\`\`\`
${fileContent.substring(0, 15000)}
\`\`\`

Output ONLY the resolved file content. No explanation, no markdown fences. Just the clean, merged code.`;

      const isCloud = params?.cloudProvider && params?.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 8192, temperature: 0.1,
          systemPrompt: 'You resolve merge conflicts precisely. Output only the resolved code.',
        });
      } else if (ctx.llmEngine?.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 8192, temperature: 0.1 });
      } else {
        try {
          result = await ctx.cloudLLM.generate(prompt, {
            maxTokens: 8192, temperature: 0.1,
            systemPrompt: 'You resolve merge conflicts precisely. Output only the resolved code.',
          });
        } catch {
          return { success: false, error: 'No AI model available' };
        }
      }
      let text = (result.text || result || '').trim();
      // Strip markdown fences if present
      text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');
      return { success: true, resolved: text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ─── Voice Command Processing ──────────────────────────────────────
  ipcMain.handle('voice-command', async (_, params) => {
    try {
      const { transcription } = params;
      if (!transcription?.trim()) return { success: false, error: 'Empty transcription' };

      const prompt = `You are a voice command interpreter for a code editor (IDE). Parse the user's spoken command and output a JSON action.

Supported commands and their JSON format:
- Open a file: {"action": "open-file", "query": "<filename or path>"}
- Go to a line: {"action": "go-to-line", "line": <number>}
- Search in files: {"action": "search", "query": "<search term>"}
- Run terminal command: {"action": "run-command", "command": "<shell command>"}
- New file: {"action": "new-file"}
- Save file: {"action": "save"}
- Toggle terminal: {"action": "toggle-terminal"}
- Toggle sidebar: {"action": "toggle-sidebar"}
- Open command palette: {"action": "command-palette"}
- Undo: {"action": "undo"}
- Redo: {"action": "redo"}
- Find and replace: {"action": "find-replace", "find": "<text>", "replace": "<text>"}
- Git commit: {"action": "git-commit", "message": "<commit message>"}
- Git push: {"action": "git-push"}
- Git pull: {"action": "git-pull"}
- Create branch: {"action": "git-create-branch", "name": "<branch name>"}
- Ask AI: {"action": "ask-ai", "message": "<question or instruction>"}
- Insert text at cursor: {"action": "insert-text", "text": "<code or text>"}
- Close file: {"action": "close-file"}
- New project: {"action": "new-project"}
- None of the above: {"action": "ask-ai", "message": "<original transcription>"}

User said: "${transcription}"

Output ONLY the JSON object. No explanation.`;

      const isCloud = params?.cloudProvider && params?.cloudModel;
      let result;
      if (isCloud) {
        result = await ctx.cloudLLM.generate(prompt, {
          provider: params.cloudProvider, model: params.cloudModel,
          maxTokens: 256, temperature: 0.1,
          systemPrompt: 'You parse voice commands into JSON actions. Output only valid JSON.',
        });
      } else if (ctx.llmEngine?.isReady) {
        result = await ctx.llmEngine.generate(prompt, { maxTokens: 256, temperature: 0.1 });
      } else {
        try {
          result = await ctx.cloudLLM.generate(prompt, {
            maxTokens: 256, temperature: 0.1,
            systemPrompt: 'You parse voice commands into JSON actions. Output only valid JSON.',
          });
        } catch {
          // Fallback: treat as chat message
          return { success: true, command: { action: 'ask-ai', message: transcription } };
        }
      }
      const text = (result.text || result || '').trim();
      const jsonMatch = text.match(/\{[^{}]*\}/);
      if (jsonMatch) {
        const command = JSON.parse(jsonMatch[0]);
        return { success: true, command };
      }
      // Fallback: treat as chat message
      return { success: true, command: { action: 'ask-ai', message: transcription } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
