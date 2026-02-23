/**
 * IPC Handlers: File System Operations
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

function register(ctx) {
  ipcMain.handle('read-file', async (_, filePath) => {
    if (!ctx.isPathAllowed(filePath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try { return { success: true, content: await fs.readFile(filePath, 'utf8') }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('write-file', async (_, filePath, content) => {
    if (!ctx.isPathAllowed(filePath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('read-directory', async (_, dirPath) => {
    if (!ctx.isPathAllowed(dirPath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const items = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        let stats = null;
        try { stats = await fs.stat(fullPath); } catch (_) {}
        return {
          name: entry.name, path: fullPath,
          isDirectory: entry.isDirectory(), isFile: entry.isFile(),
          size: stats?.size || 0, modified: stats?.mtime?.toISOString() || '',
        };
      }));
      return { success: true, items };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('get-file-stats', async (_, filePath) => {
    if (!ctx.isPathAllowed(filePath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try {
      const stats = await fs.stat(filePath);
      return { success: true, size: stats.size, mtime: stats.mtime.toISOString(), isDirectory: stats.isDirectory(), isFile: stats.isFile() };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('create-directory', async (_, dirPath) => {
    if (!ctx.isPathAllowed(dirPath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try { await fs.mkdir(dirPath, { recursive: true }); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('delete-file', async (_, filePath) => {
    if (!ctx.isPathAllowed(filePath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try { await fs.unlink(filePath); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('delete-directory', async (_, dirPath) => {
    if (!ctx.isPathAllowed(dirPath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try { await fs.rm(dirPath, { recursive: true, force: true }); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('copy-file', async (_, src, dest) => {
    if (!ctx.isPathAllowed(src)) return { success: false, error: 'Access denied: source path outside allowed directories' };
    if (!ctx.isPathAllowed(dest)) return { success: false, error: 'Access denied: destination path outside allowed directories' };
    try { await fs.copyFile(src, dest); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('copy-directory', async (_, src, dest) => {
    if (!ctx.isPathAllowed(src)) return { success: false, error: 'Access denied: source path outside allowed directories' };
    if (!ctx.isPathAllowed(dest)) return { success: false, error: 'Access denied: destination path outside allowed directories' };
    try { await fs.cp(src, dest, { recursive: true }); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('move-file', async (_, src, dest) => {
    if (!ctx.isPathAllowed(src)) return { success: false, error: 'Access denied: source path outside allowed directories' };
    if (!ctx.isPathAllowed(dest)) return { success: false, error: 'Access denied: destination path outside allowed directories' };
    try { await fs.rename(src, dest); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('rename-file', async (_, oldPath, newPath) => {
    if (!ctx.isPathAllowed(oldPath)) return { success: false, error: 'Access denied: source path outside allowed directories' };
    if (!ctx.isPathAllowed(newPath)) return { success: false, error: 'Access denied: destination path outside allowed directories' };
    try { await fs.rename(oldPath, newPath); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('file-exists', async (_, filePath) => {
    if (!ctx.isPathAllowed(filePath)) return { success: true, exists: false };
    try { await fs.access(filePath); return { success: true, exists: true }; }
    catch { return { success: true, exists: false }; }
  });

  ipcMain.handle('list-directory', async (_, dirPath) => {
    if (!ctx.isPathAllowed(dirPath)) return { success: false, error: 'Access denied: path outside allowed directories' };
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      return { success: true, items: items.map(item => ({ name: item.name, isDirectory: item.isDirectory(), isFile: item.isFile() })) };
    } catch (error) { return { success: false, error: error.message }; }
  });

  // ─── Search in Files ────────────────────────────────────────────────
  ipcMain.handle('search-in-files', async (_, rootPath, query, options = {}) => {
    if (!ctx.isPathAllowed(rootPath)) return { success: false, error: 'Access denied: search root outside allowed directories' };
    try {
      const results = [];
      const maxResults = options.maxResults || 200;
      const isRegex = options.isRegex || false;
      const caseSensitive = options.caseSensitive || false;
      const wholeWord = options.wholeWord || false;

      let searchRegex;
      try {
        let pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) pattern = `\\b${pattern}\\b`;
        searchRegex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      } catch (_) { return { success: false, error: 'Invalid search pattern' }; }

      async function searchDir(dirPath) {
        if (results.length >= maxResults) return;
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= maxResults) return;
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(rootPath, fullPath);
            if (/node_modules|\.git|dist|build|\.next|\.cache/.test(relativePath)) continue;
            if (entry.name.startsWith('.') && entry.isDirectory()) continue;
            if (entry.isDirectory()) {
              await searchDir(fullPath);
            } else if (entry.isFile()) {
              try {
                const ext = path.extname(entry.name).toLowerCase();
                const textExts = ['.js', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.scss', '.md', '.txt', '.py', '.rb', '.go', '.rs', '.c', '.cpp', '.h', '.java', '.xml', '.yaml', '.yml', '.toml', '.env', '.sh', '.bat', '.ps1', '.vue', '.svelte'];
                if (!textExts.includes(ext) && ext !== '') continue;
                const stat = await fs.stat(fullPath);
                if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
                const content = await fs.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (results.length >= maxResults) break;
                  searchRegex.lastIndex = 0;
                  if (searchRegex.test(lines[i])) {
                    results.push({ file: fullPath, relativePath, line: i + 1, text: lines[i].trim().substring(0, 200) });
                  }
                }
              } catch (_) { /* skip unreadable files */ }
            }
          }
        } catch (_) {}
      }

      await searchDir(rootPath);
      return { success: true, results };
    } catch (error) { return { success: false, error: error.message }; }
  });
}

module.exports = { register };
