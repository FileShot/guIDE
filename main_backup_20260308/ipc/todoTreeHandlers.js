/**
 * IPC Handlers: TODO Tree — scans workspace for TODO/FIXME/HACK/NOTE/BUG comments
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// Matches single-line comment TODOs: // TODO:, # FIXME:, /* HACK:, * NOTE: etc.
const TODO_PATTERN = /(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|HACK|NOTE|BUG|XXX)(?:\s*[(:]\s*|\s+)(.+)/i;

const SKIP_DIRS = /node_modules|\.git|dist|build|\.next|\.cache|__pycache__|\.venv|venv|coverage|\.turbo|\.parcel-cache/;
const TEXT_EXTS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx',
  '.py', '.rb', '.go', '.rs',
  '.c', '.cpp', '.h', '.cc', '.hh',
  '.java', '.kt', '.swift',
  '.css', '.scss', '.less',
  '.html', '.vue', '.svelte',
  '.md', '.mdx',
  '.yaml', '.yml',
  '.sh', '.bash', '.ps1', '.bat',
  '.php', '.lua', '.r',
]);

function register(ctx) {
  ipcMain.handle('scan-todos', async (_, rootPath) => {
    if (!rootPath) return { success: false, error: 'No root path provided' };
    if (!ctx.isPathAllowed(rootPath)) return { success: false, error: 'Access denied: path outside allowed directories' };

    const results = [];
    const MAX_RESULTS = 500;

    async function scanDir(dirPath) {
      if (results.length >= MAX_RESULTS) return;
      let entries;
      try { entries = await fs.readdir(dirPath, { withFileTypes: true }); }
      catch { return; }

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) break;
        // Skip hidden directories
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        const fullPath = path.join(dirPath, entry.name);
        const rel = path.relative(rootPath, fullPath);
        if (SKIP_DIRS.test(rel.replace(/\\/g, '/'))) continue;

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!TEXT_EXTS.has(ext)) continue;

          let content;
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > 512 * 1024) continue; // skip files > 512 KB
            content = await fs.readFile(fullPath, 'utf8');
          } catch { continue; }

          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(TODO_PATTERN);
            if (match) {
              results.push({
                file: fullPath,
                relativePath: rel.replace(/\\/g, '/'),
                line: i + 1,
                type: match[1].toUpperCase(),
                text: match[2].trim().replace(/\*\/\s*$/, '').substring(0, 200),
              });
              if (results.length >= MAX_RESULTS) break;
            }
          }
        }
      }
    }

    try {
      await scanDir(rootPath);
      return { success: true, todos: results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
