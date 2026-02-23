/**
 * IPC Handlers: Model Management, Download & Hardware Recommendations
 */
const { ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const fsSync = require('fs');

function register(ctx) {
  ipcMain.handle('models-list', () => ctx.modelManager.availableModels);
  ipcMain.handle('models-scan', async () => ctx.modelManager.scanModels());
  ipcMain.handle('models-get-default', () => ctx.modelManager.getDefaultModel());
  ipcMain.handle('models-dir', () => ctx.modelManager.modelsDir);

  ipcMain.handle('models-add', async () => {
    const win = ctx.getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Select GGUF Model Files',
      filters: [{ name: 'GGUF Models', extensions: ['gguf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, models: [] };
    }
    const added = await ctx.modelManager.addModels(result.filePaths);
    return { success: true, models: added };
  });

  ipcMain.handle('models-remove', async (_, modelPath) => {
    await ctx.modelManager.removeModel(modelPath);
    return { success: true };
  });

  // ─── Hardware Info & Model Recommendations ──────────────────────────
  ipcMain.handle('get-hardware-info', async () => {
    const gpu = await ctx._detectGPU();
    const totalRAM = Math.round(os.totalmem() / (1024 ** 3));
    const freeRAM = Math.round(os.freemem() / (1024 ** 3));
    const cpuModel = os.cpus()[0]?.model || 'Unknown CPU';
    const cpuCores = os.cpus().length;
    return { ...gpu, totalRAM, freeRAM, cpuModel, cpuCores };
  });

  ipcMain.handle('get-recommended-models', async () => {
    const gpu = await ctx._detectGPU();
    const vramGB = gpu.vramGB;
    const totalRAM = os.totalmem() / (1024 ** 3);
    const maxModelGB = vramGB > 2 ? Math.max(vramGB - 1.5, 1) : totalRAM * 0.6;

    const allModels = [
      { name: 'Qwen2.5-Coder-1.5B-Instruct', file: 'Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf', size: 1.0, hfRepo: 'lmstudio-community/Qwen2.5-Coder-1.5B-Instruct-GGUF', desc: 'Fast coding model, great for autocomplete', category: 'coding', vision: false },
      { name: 'Qwen3-0.6B', file: 'Qwen3-0.6B-Q8_0.gguf', size: 0.6, hfRepo: 'unsloth/Qwen3-0.6B-GGUF', desc: 'Ultra-lightweight general chat model', category: 'general', vision: false },
      { name: 'Qwen3-4B', file: 'Qwen3-4B-Q4_K_M.gguf', size: 2.5, hfRepo: 'lmstudio-community/Qwen3-4B-GGUF', desc: 'Fast reasoning model with thinking mode', category: 'general', vision: false },
      { name: 'Qwen2.5-Coder-7B-Instruct', file: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf', size: 4.7, hfRepo: 'lmstudio-community/Qwen2.5-Coder-7B-Instruct-GGUF', desc: 'Strong coding model, Q4 quantized', category: 'coding', vision: false },
      { name: 'Llama-3.1-8B-Instruct', file: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', size: 4.9, hfRepo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', desc: 'Excellent general-purpose model by Meta', category: 'general', vision: false },
      { name: 'Qwen3-8B', file: 'Qwen3-8B-Q4_K_M.gguf', size: 5.0, hfRepo: 'lmstudio-community/Qwen3-8B-GGUF', desc: 'Strong reasoning model with thinking', category: 'general', vision: false },
      { name: 'DeepSeek-R1-Distill-Qwen-14B', file: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf', size: 8.7, hfRepo: 'bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF', desc: 'DeepSeek R1 reasoning distilled into 14B', category: 'reasoning', vision: false },
      { name: 'Qwen3-14B', file: 'Qwen3-14B-Q4_K_M.gguf', size: 9.0, hfRepo: 'lmstudio-community/Qwen3-14B-GGUF', desc: 'High-quality reasoning model', category: 'general', vision: false },
      { name: 'Mistral-Small-3.1-24B', file: 'Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf', size: 14.3, hfRepo: 'lmstudio-community/Mistral-Small-3.1-24B-Instruct-2503-GGUF', desc: 'Powerful multi-language coding + reasoning', category: 'general', vision: false },
      { name: 'Qwen3-Coder-30B-A3B (MoE)', file: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf', size: 18.6, hfRepo: 'lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF', desc: 'Best coding model — only uses 3B active params (fast!)', category: 'coding', vision: false },
      { name: 'Qwen3-30B-A3B (MoE)', file: 'Qwen3-30B-A3B-Q4_K_M.gguf', size: 18.6, hfRepo: 'lmstudio-community/Qwen3-30B-A3B-GGUF', desc: 'Best general model — MoE, fast + smart', category: 'general', vision: false },
      { name: 'Qwen3-32B', file: 'Qwen3-32B-Q4_K_M.gguf', size: 19.8, hfRepo: 'lmstudio-community/Qwen3-32B-GGUF', desc: 'Top-tier reasoning, dense 32B', category: 'general', vision: false },
    ];

    const recommended = [];
    const compatible = [];

    for (const m of allModels) {
      const fits = m.size <= maxModelGB;
      const obj = { ...m, fits, maxModelGB: Math.round(maxModelGB * 10) / 10, downloadUrl: `https://huggingface.co/${m.hfRepo}/resolve/main/${m.file}` };
      if (fits) recommended.push(obj);
      else compatible.push(obj);
    }

    recommended.sort((a, b) => b.size - a.size);
    return { recommended, other: compatible, maxModelGB: Math.round(maxModelGB * 10) / 10, vramGB: Math.round(vramGB * 10) / 10 };
  });

  // ─── HuggingFace Model Download ──────────────────────────────────
  const activeDownloads = new Map();

  ipcMain.handle('models-download-hf', async (_, { url, fileName }) => {
    const targetPath = path.join(ctx.modelManager.modelsDir, fileName);
    const tempPath = targetPath + '.part';

    try { fsSync.mkdirSync(ctx.modelManager.modelsDir, { recursive: true }); } catch (_) {}

    if (fsSync.existsSync(targetPath)) {
      return { success: true, path: targetPath, alreadyExists: true };
    }

    console.log(`[Model] Downloading: ${fileName} from ${url}`);

    return new Promise((resolve) => {
      const doRequest = (reqUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          resolve({ success: false, error: 'Too many redirects' });
          return;
        }

        const mod = reqUrl.startsWith('https') ? https : http;
        const req = mod.get(reqUrl, { headers: { 'User-Agent': 'guIDE/2.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            console.log(`[Model] Redirect ${res.statusCode} → ${res.headers.location.substring(0, 80)}...`);
            res.destroy();
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            resolve({ success: false, error: `HTTP ${res.statusCode}` });
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;
          const fileStream = fsSync.createWriteStream(tempPath);
          let lastProgressTime = 0;

          activeDownloads.set(fileName, { req, fileStream, tempPath });

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (now - lastProgressTime > 500) {
              lastProgressTime = now;
              const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
              const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
              const totalMB = (totalBytes / (1024 * 1024)).toFixed(0);
              const win = ctx.getMainWindow();
              if (win && !win.isDestroyed()) {
                win.webContents.send('model-download-progress', { fileName, progress, downloadedMB, totalMB, downloadedBytes, totalBytes });
              }
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            activeDownloads.delete(fileName);
            try {
              fsSync.renameSync(tempPath, targetPath);
              console.log(`[Model] Download complete: ${fileName}`);
              ctx.modelManager.scanModels();
              const win = ctx.getMainWindow();
              if (win && !win.isDestroyed()) {
                win.webContents.send('model-download-progress', { fileName, progress: 100, downloadedMB: (totalBytes / (1024 * 1024)).toFixed(0), totalMB: (totalBytes / (1024 * 1024)).toFixed(0), downloadedBytes: totalBytes, totalBytes, complete: true });
              }
              resolve({ success: true, path: targetPath });
            } catch (e) {
              resolve({ success: false, error: 'Failed to finalize download: ' + e.message });
            }
          });

          fileStream.on('error', (err) => {
            activeDownloads.delete(fileName);
            try { fsSync.unlinkSync(tempPath); } catch (_) {}
            resolve({ success: false, error: err.message });
          });
        });

        req.on('error', (err) => {
          activeDownloads.delete(fileName);
          try { fsSync.unlinkSync(tempPath); } catch (_) {}
          resolve({ success: false, error: err.message });
        });
      };

      doRequest(url);
    });
  });

  ipcMain.handle('models-cancel-download', (_, fileName) => {
    const dl = activeDownloads.get(fileName);
    if (dl) {
      try { dl.req.destroy(); } catch (_) {}
      try { dl.fileStream.destroy(); } catch (_) {}
      try { fsSync.unlinkSync(dl.tempPath); } catch (_) {}
      activeDownloads.delete(fileName);
      console.log(`[Model] Download cancelled: ${fileName}`);
      return { success: true };
    }
    return { success: false, error: 'No active download' };
  });
}

module.exports = { register };
