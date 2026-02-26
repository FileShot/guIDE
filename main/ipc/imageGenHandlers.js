/**
 * IPC Handlers: Image & Video Generation
 * Exposes image and video generation capabilities to the renderer process.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register(ctx) {
  const imageGen = ctx.imageGen;
  const localImageEngine = ctx.localImageEngine;

  // ── Local Image Generation (stable-diffusion.cpp) ──
  // Returns { success, imageBase64, mimeType, prompt, error? }
  ipcMain.handle('local-image-generate', async (event, params) => {
    if (!localImageEngine) {
      return { success: false, error: 'Local image engine not initialized.' };
    }
    if (!params?.prompt || typeof params.prompt !== 'string') {
      return { success: false, error: 'No prompt provided.' };
    }
    if (!params?.modelPath || typeof params.modelPath !== 'string') {
      return { success: false, error: 'No model path provided.' };
    }

    const mainWindow = ctx.getMainWindow();

    // Wire progress updates to renderer
    const onProgress = (current, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('local-image-progress', { current, total });
      }
    };

    try {
      const result = await localImageEngine.generate({
        prompt: params.prompt,
        modelPath: params.modelPath,
        negativePrompt: params.negativePrompt || '',
        steps: params.steps || 20,
        cfgScale: params.cfgScale || 7.0,
        width: params.width || 512,
        height: params.height || 512,
        seed: params.seed !== undefined ? params.seed : -1,
        backend: params.backend || 'cpu',
        samplingMethod: params.samplingMethod || 'euler_a',
        onProgress,
      });
      return result;
    } catch (err) {
      console.error('[LocalImageGen IPC] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Check local image engine availability ──
  ipcMain.handle('local-image-engine-status', async () => {
    if (!localImageEngine) return { available: false, error: 'Not initialized' };
    return localImageEngine.checkAvailability();
  });

  // ── Cancel local image generation ──
  ipcMain.handle('local-image-cancel', async () => {
    if (localImageEngine) localImageEngine.cancel();
    return { success: true };
  });

  // ── Generate Image ──
  // Returns { success, imageBase64, mimeType, prompt, provider, model, error? }
  ipcMain.handle('image-generate', async (_, prompt, options) => {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return { success: false, error: 'No prompt provided' };
    }
    // Sanitize prompt length (max 2000 chars)
    const sanitizedPrompt = prompt.trim().substring(0, 2000);
    try {
      const result = await imageGen.generate(sanitizedPrompt, options || {});
      return result;
    } catch (err) {
      console.error('[ImageGen IPC] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Save Generated Image to Project Directory ──
  ipcMain.handle('image-save', async (_, imageBase64, mimeType, suggestedName) => {
    const mainWindow = ctx.getMainWindow();
    if (!mainWindow) return { success: false, error: 'No window' };
    if (!imageBase64) return { success: false, error: 'No image data' };

    // Determine file extension from MIME type
    const extMap = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    const ext = extMap[mimeType] || '.png';
    const defaultName = suggestedName || `generated-image-${Date.now()}${ext}`;

    try {
      const { dialog } = require('electron');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Generated Image',
        defaultPath: path.join(ctx.currentProjectPath || '', defaultName),
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
      }

      // Validate path
      if (ctx.isPathAllowed && !ctx.isPathAllowed(result.filePath)) {
        return { success: false, error: 'Path not allowed' };
      }

      const buffer = Buffer.from(imageBase64, 'base64');
      fs.writeFileSync(result.filePath, buffer);
      console.log(`[ImageGen] Saved image to: ${result.filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      console.error('[ImageGen] Save error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Quick Save to Project Directory (no dialog) ──
  ipcMain.handle('image-save-to-project', async (_, imageBase64, mimeType, fileName) => {
    if (!imageBase64) return { success: false, error: 'No image data' };
    const projectPath = ctx.currentProjectPath;
    if (!projectPath) return { success: false, error: 'No project open' };

    const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
    const ext = extMap[mimeType] || '.png';
    const name = fileName || `generated-${Date.now()}${ext}`;

    // Create images directory if it doesn't exist
    const imagesDir = path.join(projectPath, 'generated-images');
    try {
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }
    } catch { /* ignore */ }

    const filePath = path.join(imagesDir, name);

    // Validate path
    if (ctx.isPathAllowed && !ctx.isPathAllowed(filePath)) {
      return { success: false, error: 'Path not allowed' };
    }

    try {
      const buffer = Buffer.from(imageBase64, 'base64');
      fs.writeFileSync(filePath, buffer);
      console.log(`[ImageGen] Quick-saved to: ${filePath}`);
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Get image generation status ──
  ipcMain.handle('image-gen-status', () => {
    return imageGen.getStatus();
  });

  // ── Generate Video ──
  ipcMain.handle('video-generate', async (_, prompt, options) => {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return { success: false, error: 'No prompt provided' };
    }
    const sanitizedPrompt = prompt.trim().substring(0, 2000);
    try {
      const result = await imageGen.generateVideo(sanitizedPrompt, options || {});
      return result;
    } catch (err) {
      console.error('[VideoGen IPC] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Save Generated Video (dialog) ──
  ipcMain.handle('video-save', async (_, videoBase64, mimeType) => {
    const mainWindow = ctx.getMainWindow();
    if (!mainWindow) return { success: false, error: 'No window' };
    if (!videoBase64) return { success: false, error: 'No video data' };

    const extMap = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/avi': '.avi' };
    const ext = extMap[mimeType] || '.mp4';
    const defaultName = `generated-video-${Date.now()}${ext}`;

    try {
      const { dialog } = require('electron');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Generated Video',
        defaultPath: path.join(ctx.currentProjectPath || '', defaultName),
        filters: [
          { name: 'Videos', extensions: ['mp4', 'webm', 'avi'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
      }

      if (ctx.isPathAllowed && !ctx.isPathAllowed(result.filePath)) {
        return { success: false, error: 'Path not allowed' };
      }

      const buffer = Buffer.from(videoBase64, 'base64');
      fs.writeFileSync(result.filePath, buffer);
      console.log(`[VideoGen] Saved video to: ${result.filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      console.error('[VideoGen] Save error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Quick Save Video to Project Directory ──
  ipcMain.handle('video-save-to-project', async (_, videoBase64, mimeType, fileName) => {
    if (!videoBase64) return { success: false, error: 'No video data' };
    const projectPath = ctx.currentProjectPath;
    if (!projectPath) return { success: false, error: 'No project open' };

    const extMap = { 'video/mp4': '.mp4', 'video/webm': '.webm' };
    const ext = extMap[mimeType] || '.mp4';
    const name = fileName || `generated-${Date.now()}${ext}`;

    const videosDir = path.join(projectPath, 'generated-videos');
    try {
      if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
      }
    } catch { /* ignore */ }

    const filePath = path.join(videosDir, name);
    if (ctx.isPathAllowed && !ctx.isPathAllowed(filePath)) {
      return { success: false, error: 'Path not allowed' };
    }

    try {
      const buffer = Buffer.from(videoBase64, 'base64');
      fs.writeFileSync(filePath, buffer);
      console.log(`[VideoGen] Quick-saved to: ${filePath}`);
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
