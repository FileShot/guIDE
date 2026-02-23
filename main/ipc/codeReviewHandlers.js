/**
 * guIDE — AI-Powered Offline IDE
 * AI Code Review Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register(ctx) {
  // ── Review a single file ──
  ipcMain.handle('code-review-file', async (_, params) => {
    try {
      const { filePath, cloudProvider, cloudModel } = params;
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      const ext = path.extname(absPath).toLowerCase();
      const fileName = path.basename(absPath);

      // Truncate very large files
      const maxLen = 15000;
      const truncated = content.length > maxLen;
      const codeToReview = truncated ? content.slice(0, maxLen) + '\n...(truncated)' : content;

      const prompt = `You are a senior code reviewer. Review the following ${ext} file "${fileName}" for issues.

Analyze the code for:
1. **Bugs** — Logic errors, off-by-one, null/undefined access, race conditions
2. **Security** — Injection, XSS, hardcoded secrets, path traversal, unsafe eval
3. **Performance** — Unnecessary re-renders, O(n²) loops, memory leaks, missing cleanup
4. **Best Practices** — Naming, DRY violations, unused code, missing error handling, typing issues

Return your review as a JSON array of findings. Each finding should have:
- "severity": "critical" | "warning" | "suggestion"
- "line": approximate line number (integer)
- "title": short title (max 60 chars)
- "description": detailed explanation
- "fix": suggested code fix (optional, the actual corrected code snippet)

Return ONLY the JSON array, no markdown or explanation. If no issues found, return [].

Code to review:
\`\`\`${ext.replace('.', '')}
${codeToReview}
\`\`\``;

      let reviewText = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 4000 });
          reviewText = result.text || '';
        } catch { /* fall through */ }
      }
      if (!reviewText && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 4000 });
          reviewText = result.text || '';
        } catch { /* ignore */ }
      }

      if (!reviewText) return { success: false, error: 'No LLM available for code review' };

      // Parse JSON from response
      let findings = [];
      try {
        // Extract JSON array from response
        const jsonMatch = reviewText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          findings = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // If JSON parsing fails, return raw text
        return { success: true, findings: [], rawReview: reviewText };
      }

      // Validate and normalize findings
      findings = findings.map((f, i) => ({
        id: `finding_${i}`,
        severity: ['critical', 'warning', 'suggestion'].includes(f.severity) ? f.severity : 'suggestion',
        line: typeof f.line === 'number' ? f.line : null,
        title: String(f.title || 'Issue found').slice(0, 100),
        description: String(f.description || ''),
        fix: f.fix || null,
      }));

      return { success: true, findings, filePath: absPath, truncated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Review staged git changes ──
  ipcMain.handle('code-review-staged', async (_, params) => {
    try {
      const { cloudProvider, cloudModel } = params || {};

      if (!ctx.gitManager || !ctx.currentProjectPath) {
        return { success: false, error: 'No git repository open' };
      }

      const diff = await ctx.gitManager.getStagedDiff();
      if (!diff || !diff.trim()) {
        return { success: false, error: 'No staged changes to review' };
      }

      // Truncate large diffs
      const maxLen = 12000;
      const truncated = diff.length > maxLen;
      const diffToReview = truncated ? diff.slice(0, maxLen) + '\n...(truncated)' : diff;

      const prompt = `You are a senior code reviewer performing a pre-commit review. Review the following git diff of staged changes.

Analyze for:
1. **Bugs** — Logic errors, null access, race conditions introduced by changes
2. **Security** — Any security issues in the new/changed code
3. **Performance** — Performance regressions or improvements missed
4. **Best Practices** — Code quality issues in the changed code

Return your review as a JSON array of findings. Each finding should have:
- "severity": "critical" | "warning" | "suggestion"
- "file": affected file path
- "line": approximate line number in the new version (integer or null)
- "title": short title (max 60 chars)
- "description": detailed explanation
- "fix": suggested code fix (optional)

Return ONLY the JSON array, no markdown. If no issues found, return [].

Staged diff:
\`\`\`diff
${diffToReview}
\`\`\``;

      let reviewText = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 4000 });
          reviewText = result.text || '';
        } catch { /* fall through */ }
      }
      if (!reviewText && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 4000 });
          reviewText = result.text || '';
        } catch { /* ignore */ }
      }

      if (!reviewText) return { success: false, error: 'No LLM available for code review' };

      let findings = [];
      try {
        const jsonMatch = reviewText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          findings = JSON.parse(jsonMatch[0]);
        }
      } catch {
        return { success: true, findings: [], rawReview: reviewText };
      }

      findings = findings.map((f, i) => ({
        id: `finding_${i}`,
        severity: ['critical', 'warning', 'suggestion'].includes(f.severity) ? f.severity : 'suggestion',
        file: f.file || null,
        line: typeof f.line === 'number' ? f.line : null,
        title: String(f.title || 'Issue found').slice(0, 100),
        description: String(f.description || ''),
        fix: f.fix || null,
      }));

      return { success: true, findings, truncated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Review a specific diff (e.g., between branches or commits) ──
  ipcMain.handle('code-review-diff', async (_, params) => {
    try {
      const { diff, context, cloudProvider, cloudModel } = params;

      if (!diff || !diff.trim()) {
        return { success: false, error: 'No diff provided' };
      }

      const maxLen = 12000;
      const truncated = diff.length > maxLen;
      const diffToReview = truncated ? diff.slice(0, maxLen) + '\n...(truncated)' : diff;

      const prompt = `You are a senior code reviewer. Review the following code diff${context ? ` (${context})` : ''}.

Analyze for bugs, security issues, performance problems, and best practices violations.

Return your review as a JSON array of findings. Each finding should have:
- "severity": "critical" | "warning" | "suggestion"
- "file": affected file path (if identifiable)
- "line": approximate line number (integer or null)
- "title": short title (max 60 chars)
- "description": detailed explanation
- "fix": suggested code fix (optional)

Return ONLY the JSON array. If no issues, return [].

Diff:
\`\`\`diff
${diffToReview}
\`\`\``;

      let reviewText = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 4000 });
          reviewText = result.text || '';
        } catch { /* fall through */ }
      }
      if (!reviewText && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 4000 });
          reviewText = result.text || '';
        } catch { /* ignore */ }
      }

      if (!reviewText) return { success: false, error: 'No LLM available for code review' };

      let findings = [];
      try {
        const jsonMatch = reviewText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          findings = JSON.parse(jsonMatch[0]);
        }
      } catch {
        return { success: true, findings: [], rawReview: reviewText };
      }

      findings = findings.map((f, i) => ({
        id: `finding_${i}`,
        severity: ['critical', 'warning', 'suggestion'].includes(f.severity) ? f.severity : 'suggestion',
        file: f.file || null,
        line: typeof f.line === 'number' ? f.line : null,
        title: String(f.title || 'Issue found').slice(0, 100),
        description: String(f.description || ''),
        fix: f.fix || null,
      }));

      return { success: true, findings, truncated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Apply a review fix suggestion ──
  ipcMain.handle('code-review-apply-fix', async (_, params) => {
    try {
      const { filePath, line, fix, cloudProvider, cloudModel } = params;
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        return { success: false, error: `File not found: ${absPath}` };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');

      // If fix is a direct code snippet, ask LLM to apply it intelligently
      const contextStart = Math.max(0, (line || 1) - 10);
      const contextEnd = Math.min(lines.length, (line || 1) + 10);
      const surroundingCode = lines.slice(contextStart, contextEnd).map((l, i) => `${contextStart + i + 1}: ${l}`).join('\n');

      const prompt = `Apply the following fix to the code. Return ONLY the complete modified file content, no markdown or explanation.

File: ${path.basename(absPath)}
Fix to apply near line ${line || '(unknown)'}:
${fix}

Surrounding code context:
${surroundingCode}

Full file:
${content.length > 20000 ? content.slice(0, 20000) + '\n...(truncated)' : content}`;

      let newContent = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 8000 });
          newContent = result.text || '';
        } catch { /* fall through */ }
      }
      if (!newContent && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 8000 });
          newContent = result.text || '';
        } catch { /* ignore */ }
      }

      if (!newContent) return { success: false, error: 'No LLM available to apply fix' };

      // Clean up markdown fences
      newContent = newContent.replace(/^```[\w]*\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

      // Write the fixed file
      fs.writeFileSync(absPath, newContent, 'utf-8');

      return { success: true, filePath: absPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
