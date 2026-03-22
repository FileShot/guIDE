/**
 * IPC Handlers: App Utilities, System Info, Custom Instructions, System Resources
 */
const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

function register(ctx) {
  // ─── App Utilities ──────────────────────────────────────────────────
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-platform', () => process.platform);
  ipcMain.handle('get-home-dir', () => os.homedir());
  ipcMain.handle('get-app-path', () => ctx.appBasePath);
  ipcMain.handle('get-system-info', () => ({
    platform: process.platform, arch: process.arch, cpus: os.cpus().length,
    totalMemory: os.totalmem(), freeMemory: os.freemem(),
    nodeVersion: process.versions.node, electronVersion: process.versions.electron,
  }));

  // ─── Custom Instructions (.prompt.md / .guide-instructions.md) ────
  ipcMain.handle('load-custom-instructions', async (_, projectPath) => {
    if (!projectPath) return { success: true, instructions: null };
    const candidates = [
      '.guide-instructions.md', '.prompt.md', '.guide/instructions.md',
      '.github/copilot-instructions.md', 'CODING_GUIDELINES.md',
    ];
    for (const file of candidates) {
      try {
        const fullPath = path.join(projectPath, file);
        const content = await fs.readFile(fullPath, 'utf8');
        if (content.trim()) {
          console.log(`[IDE] Loaded custom instructions from ${file} (${content.length} chars)`);
          return { success: true, instructions: content.trim(), source: file };
        }
      } catch (_) { /* file doesn't exist — try next */ }
    }
    return { success: true, instructions: null };
  });

  // ─── System Resources Monitoring ───────────────────────────────────
  ipcMain.handle('get-system-resources', () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return {
      cpu: ctx.getCpuUsage(),
      ram: { used: usedMem, total: totalMem, percent: Math.round((usedMem / totalMem) * 100) },
    };
  });
}

module.exports = { register };
