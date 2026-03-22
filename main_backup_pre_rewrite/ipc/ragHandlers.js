/**
 * IPC Handlers: RAG Engine & Web Search
 */
const { ipcMain } = require('electron');

function register(ctx) {
  ipcMain.handle('rag-index-project', async (_, projectPath) => {
    try {
      ctx.currentProjectPath = projectPath;
      ctx.mcpToolServer.projectPath = projectPath;
      ctx.gitManager.setProjectPath(projectPath);
      const win = ctx.getMainWindow();
      const result = await ctx.ragEngine.indexProject(projectPath, (progress, done, total) => {
        if (win) win.webContents.send('rag-progress', { progress, done, total });
      });
      ctx.memoryStore.learnFact('project_path', projectPath);
      ctx.memoryStore.learnFact('project_files', `${result.totalFiles} files indexed`);
      return { success: true, ...result };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('rag-search', (_, query, maxResults) => ctx.ragEngine.search(query, maxResults));
  ipcMain.handle('rag-search-files', (_, query, maxResults) => ctx.ragEngine.searchFiles(query, maxResults));
  ipcMain.handle('rag-get-context', (_, query, maxChunks, maxTokens) => ctx.ragEngine.getContextForQuery(query, maxChunks, maxTokens));
  ipcMain.handle('rag-find-error', (_, errorMessage, stackTrace) => ctx.ragEngine.findErrorContext(errorMessage, stackTrace));
  ipcMain.handle('rag-get-status', () => ctx.ragEngine.getStatus());
  ipcMain.handle('rag-get-project-summary', () => ctx.ragEngine.getProjectSummary());
  ipcMain.handle('rag-get-file-content', (_, filePath) => ctx.ragEngine.getFileContent(filePath));

  // ─── Web Search ────────────────────────────────────────────────────
  ipcMain.handle('web-search', async (_, query, maxResults) => {
    try { return { success: true, ...(await ctx.webSearch.search(query, maxResults)) }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('web-search-code', async (_, query) => {
    try { return { success: true, ...(await ctx.webSearch.searchCode(query)) }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('web-fetch-page', async (_, url) => {
    try { return { success: true, ...(await ctx.webSearch.fetchPage(url)) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
}

module.exports = { register };
