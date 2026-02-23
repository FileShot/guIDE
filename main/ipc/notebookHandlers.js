/**
 * guIDE — AI-Powered Offline IDE
 * Notebook / REPL Mode Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── State ───
const sessions = new Map(); // sessionId → { proc, language, history }
let sessionCounter = 0;

function _genId() {
  return 'nb-' + (++sessionCounter) + '-' + Date.now().toString(36);
}

function register(ctx) {
  // ── Execute a cell (Node.js) ──
  ipcMain.handle('notebook-exec-node', async (_, params) => {
    const { code, cellId, timeout = 30000 } = params;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, cellId, error: 'Execution timed out (30s)', output: '', outputType: 'error' });
      }, timeout);

      try {
        // Wrap code to capture output + handle async
        const wrapped = `
(async () => {
  const __outputs = [];
  const __origLog = console.log;
  const __origErr = console.error;
  const __origWarn = console.warn;
  console.log = (...args) => { __outputs.push({ type: 'log', text: args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') }); };
  console.error = (...args) => { __outputs.push({ type: 'error', text: args.join(' ') }); };
  console.warn = (...args) => { __outputs.push({ type: 'warn', text: args.join(' ') }); };
  try {
    const __result = await (async function() { ${code} })();
    if (__result !== undefined) __outputs.push({ type: 'result', text: typeof __result === 'object' ? JSON.stringify(__result, null, 2) : String(__result) });
  } catch(e) {
    __outputs.push({ type: 'error', text: e.stack || e.message });
  }
  console.log = __origLog;
  console.error = __origErr;
  console.warn = __origWarn;
  process.stdout.write('__NOTEBOOK_OUTPUT__' + JSON.stringify(__outputs) + '__END__');
})();`;

        const proc = spawn('node', ['-e', wrapped], {
          cwd: os.homedir(),
          env: { ...process.env },
          timeout,
        });

        let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
          clearTimeout(timer);
          // Parse captured output
          const marker = '__NOTEBOOK_OUTPUT__';
          const endMarker = '__END__';
          let outputs = [];
          const startIdx = stdout.indexOf(marker);
          const endIdx = stdout.indexOf(endMarker);
          if (startIdx >= 0 && endIdx >= 0) {
            try {
              outputs = JSON.parse(stdout.slice(startIdx + marker.length, endIdx));
            } catch { /* fallback */ }
          }

          if (outputs.length === 0 && (stdout || stderr)) {
            // Fallback: just return raw stdout/stderr
            const cleaned = stdout.replace(marker, '').replace(endMarker, '').trim();
            if (cleaned) outputs.push({ type: 'log', text: cleaned });
            if (stderr) outputs.push({ type: 'error', text: stderr.trim() });
          }

          const hasError = outputs.some(o => o.type === 'error') || code !== 0;
          resolve({
            success: !hasError || outputs.length > 0,
            cellId,
            outputs,
            exitCode: code,
            outputType: hasError ? 'error' : 'text',
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ success: false, cellId, error: err.message, outputs: [], outputType: 'error' });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ success: false, cellId, error: e.message, outputs: [], outputType: 'error' });
      }
    });
  });

  // ── Execute a cell (Python) ──
  ipcMain.handle('notebook-exec-python', async (_, params) => {
    const { code, cellId, timeout = 30000 } = params;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, cellId, error: 'Execution timed out (30s)', outputs: [], outputType: 'error' });
      }, timeout);

      try {
        // Wrap Python code to capture output as JSON
        const wrappedCode = `
import sys, json, io, traceback

__outputs = []
__old_stdout = sys.stdout
__old_stderr = sys.stderr
sys.stdout = __buf_out = io.StringIO()
sys.stderr = __buf_err = io.StringIO()

try:
    exec(${JSON.stringify(code)})
    __out = __buf_out.getvalue()
    __err = __buf_err.getvalue()
    if __out.strip():
        __outputs.append({"type": "log", "text": __out.strip()})
    if __err.strip():
        __outputs.append({"type": "error", "text": __err.strip()})
except Exception as e:
    __outputs.append({"type": "error", "text": traceback.format_exc()})
finally:
    sys.stdout = __old_stdout
    sys.stderr = __old_stderr

print("__NOTEBOOK_OUTPUT__" + json.dumps(__outputs) + "__END__")
`;

        const proc = spawn('python', ['-c', wrappedCode], {
          cwd: os.homedir(),
          env: { ...process.env },
          timeout,
        });

        let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('close', (code) => {
          clearTimeout(timer);
          let outputs = [];
          const marker = '__NOTEBOOK_OUTPUT__';
          const endMarker = '__END__';
          const startIdx = stdout.indexOf(marker);
          const endIdx = stdout.indexOf(endMarker);
          if (startIdx >= 0 && endIdx >= 0) {
            try { outputs = JSON.parse(stdout.slice(startIdx + marker.length, endIdx)); }
            catch { /* fallback */ }
          }
          if (outputs.length === 0 && (stdout || stderr)) {
            if (stdout.trim()) outputs.push({ type: 'log', text: stdout.replace(marker, '').replace(endMarker, '').trim() });
            if (stderr.trim()) outputs.push({ type: 'error', text: stderr.trim() });
          }
          const hasError = outputs.some(o => o.type === 'error') || code !== 0;
          resolve({ success: !hasError || outputs.length > 0, cellId, outputs, exitCode: code, outputType: hasError ? 'error' : 'text' });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ success: false, cellId, error: err.message, outputs: [], outputType: 'error' });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ success: false, cellId, error: e.message, outputs: [], outputType: 'error' });
      }
    });
  });

  // ── Execute a shell command cell ──
  ipcMain.handle('notebook-exec-shell', async (_, params) => {
    const { code, cellId, timeout = 30000 } = params;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, cellId, error: 'Timed out', outputs: [], outputType: 'error' });
      }, timeout);

      exec(code, { timeout, cwd: os.homedir() }, (err, stdout, stderr) => {
        clearTimeout(timer);
        const outputs = [];
        if (stdout?.trim()) outputs.push({ type: 'log', text: stdout.trim() });
        if (stderr?.trim()) outputs.push({ type: err ? 'error' : 'warn', text: stderr.trim() });
        if (err && outputs.length === 0) outputs.push({ type: 'error', text: err.message });
        resolve({
          success: !err,
          cellId,
          outputs,
          exitCode: err?.code || 0,
          outputType: err ? 'error' : 'text',
        });
      });
    });
  });

  // ── Save notebook to .ipynb format ──
  ipcMain.handle('notebook-save-ipynb', async (_, params) => {
    const { filePath, cells } = params;
    try {
      const ipynb = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
          kernelspec: {
            display_name: 'guIDE Notebook',
            language: 'multi',
            name: 'guide',
          },
          language_info: { name: 'multi' },
        },
        cells: cells.map(cell => ({
          cell_type: cell.type === 'markdown' ? 'markdown' : 'code',
          metadata: {
            language: cell.language || 'javascript',
          },
          source: cell.code.split('\n').map((line, i, arr) =>
            i < arr.length - 1 ? line + '\n' : line
          ),
          outputs: (cell.outputs || []).map(o => ({
            output_type: 'stream',
            name: o.type === 'error' ? 'stderr' : 'stdout',
            text: [o.text],
          })),
          execution_count: cell.executionCount || null,
        })),
      };

      const absPath = path.resolve(filePath);
      fs.writeFileSync(absPath, JSON.stringify(ipynb, null, 2));
      return { success: true, path: absPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Load notebook from .ipynb ──
  ipcMain.handle('notebook-load-ipynb', async (_, filePath) => {
    try {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) return { success: false, error: 'File not found' };
      const raw = JSON.parse(fs.readFileSync(absPath, 'utf-8'));

      const cells = (raw.cells || []).map((cell, i) => ({
        id: 'cell-' + i + '-' + Date.now().toString(36),
        type: cell.cell_type === 'markdown' ? 'markdown' : 'code',
        language: cell.metadata?.language || (raw.metadata?.kernelspec?.language === 'python' ? 'python' : 'javascript'),
        code: Array.isArray(cell.source) ? cell.source.join('') : (cell.source || ''),
        outputs: (cell.outputs || []).map(o => ({
          type: o.name === 'stderr' || o.output_type === 'error' ? 'error' : 'log',
          text: Array.isArray(o.text) ? o.text.join('') : (o.text || o.ename || ''),
        })),
        executionCount: cell.execution_count || null,
      }));

      return { success: true, cells, metadata: raw.metadata };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── AI: explain or generate a cell ──
  ipcMain.handle('notebook-ai-generate', async (_, params) => {
    const { prompt, context, language = 'javascript' } = params;

    const systemPrompt = `You are a coding assistant for an interactive notebook environment.
The user wants to write code in ${language}. Generate clean, working code for their request.
Return ONLY the code, no markdown fences, no explanation.
If they ask to explain, return a markdown cell explaining the concept.`;

    const fullPrompt = context
      ? `Previous cells context:\n${context}\n\nUser request: ${prompt}`
      : prompt;

    try {
      let text = '';
      if (ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(fullPrompt, { systemPrompt, maxTokens: 2000 });
          text = result.text || '';
        } catch { /* fall through */ }
      }
      if (!text && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(fullPrompt, { systemPrompt, maxTokens: 2000 });
          text = result.text || result;
        } catch { /* fall through */ }
      }
      if (!text) return { success: false, error: 'No LLM available' };

      // Clean up code fences if present
      let code = text.trim();
      const fenceMatch = code.match(/^```[\w]*\n([\s\S]*?)\n```$/);
      if (fenceMatch) code = fenceMatch[1];

      return { success: true, code, language };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Clear all outputs for a notebook ──
  ipcMain.handle('notebook-clear-outputs', async () => {
    return { success: true };
  });
}

module.exports = { register };
