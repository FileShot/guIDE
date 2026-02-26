/**
 * IPC Handlers: MCP Tools, External MCP Servers & File Undo
 */
const { ipcMain } = require('electron');
const { spawn } = require('child_process');

function register(ctx) {
  // ─── Built-in MCP Tools ─────────────────────────────────────────────
  ipcMain.handle('mcp-get-tools', () => ctx.mcpToolServer.getToolDefinitions());

  ipcMain.handle('mcp-execute-tool', async (_, toolName, params) => {
    try {
      const result = await ctx.mcpToolServer.executeTool(toolName, params);
      const win = ctx.getMainWindow();
      if (result?.success && ['write_file', 'create_directory', 'edit_file', 'delete_file', 'rename_file'].includes(toolName)) {
        if (win) win.webContents.send('files-changed');
        // Trigger debounced incremental RAG re-index
        if (ctx.scheduleIncrementalReindex) ctx.scheduleIncrementalReindex();
      }
      if (toolName.startsWith('browser_') && win && !ctx.playwrightBrowser.isLaunched) {
        win.webContents.send('show-browser', { url: params?.url || '' });
      }
      return { success: true, result };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('mcp-get-history', () => ctx.mcpToolServer.getHistory());

  // ─── External MCP Server Management ─────────────────────────────────
  const externalMcpServers = new Map();

  function _loadMcpServersConfig() {
    const config = ctx._readConfig();
    return config.mcpServers || [];
  }

  function _saveMcpServersConfig(servers) {
    const config = ctx._readConfig();
    config.mcpServers = servers;
    ctx._writeConfig(config);
  }

  ipcMain.handle('mcp-list-servers', () => {
    const builtInTools = ctx.mcpToolServer.getToolDefinitions();
    const servers = [{
      id: 'built-in',
      name: 'guIDE Built-in Tools',
      type: 'built-in',
      status: 'running',
      toolCount: builtInTools.length,
      tools: builtInTools.map(t => ({ name: t.name, description: t.description })),
    }];

    for (const [id, srv] of externalMcpServers) {
      servers.push({
        id, name: srv.config.name, type: srv.config.type,
        command: srv.config.command, url: srv.config.url,
        status: srv.status, toolCount: srv.tools ? srv.tools.length : 0,
        tools: srv.tools || [], error: srv.error,
      });
    }
    return servers;
  });

  ipcMain.handle('mcp-add-server', async (_, serverConfig) => {
    const id = `mcp-${Date.now()}`;
    externalMcpServers.set(id, {
      config: serverConfig, process: null, status: 'stopped', tools: [], error: null,
    });
    const configs = _loadMcpServersConfig();
    configs.push({ id, ...serverConfig });
    _saveMcpServersConfig(configs);
    return { success: true, id };
  });

  ipcMain.handle('mcp-remove-server', async (_, serverId) => {
    if (serverId === 'built-in') return { success: false, error: 'Cannot remove built-in server' };
    const srv = externalMcpServers.get(serverId);
    if (srv?.process) { try { srv.process.kill(); } catch (_) {} }
    externalMcpServers.delete(serverId);
    const configs = _loadMcpServersConfig().filter(c => c.id !== serverId);
    _saveMcpServersConfig(configs);
    return { success: true };
  });

  ipcMain.handle('mcp-restart-server', async (_, serverId) => {
    if (serverId === 'built-in') return { success: true };
    const srv = externalMcpServers.get(serverId);
    if (!srv) return { success: false, error: 'Server not found' };

    if (srv.process) { try { srv.process.kill(); } catch (_) {} }
    srv.status = 'starting';
    srv.error = null;
    const win = ctx.getMainWindow();

    try {
      if (srv.config.type === 'stdio') {
        const [cmd, ...args] = srv.config.command.split(/\s+/);
        const proc = spawn(cmd, args, {
          env: { ...process.env, ...(srv.config.env || {}) },
          cwd: ctx.currentProjectPath || undefined,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        srv.process = proc;
        srv.status = 'running';

        proc.on('error', (err) => {
          srv.status = 'error';
          srv.error = err.message;
          if (win) win.webContents.send('mcp-server-status', { id: serverId, status: 'error', error: err.message });
        });
        proc.on('exit', () => {
          srv.status = 'stopped';
          if (win) win.webContents.send('mcp-server-status', { id: serverId, status: 'stopped' });
        });
      } else if (srv.config.type === 'sse') {
        const url = srv.config.url;
        const httpMod = url.startsWith('https') ? require('https') : require('http');
        await new Promise((resolve, reject) => {
          const req = httpMod.get(url, { timeout: 5000 }, (res) => {
            srv.status = res.statusCode < 400 ? 'running' : 'error';
            srv.error = res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null;
            res.destroy();
            resolve();
          });
          req.on('error', (e) => reject(e));
          req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
      }
    } catch (e) {
      srv.status = 'error';
      srv.error = e.message;
    }

    if (win) win.webContents.send('mcp-server-status', { id: serverId, status: srv.status, error: srv.error });
    return { success: true, status: srv.status };
  });

  // Load saved external MCP servers on startup
  try {
    const savedServers = _loadMcpServersConfig();
    for (const cfg of savedServers) {
      externalMcpServers.set(cfg.id, {
        config: cfg, process: null, status: 'stopped', tools: [], error: null,
      });
    }
  } catch (_) {}

  // ─── File Change Undo ───────────────────────────────────────────────
  ipcMain.handle('file-undo-list', async () => ctx.mcpToolServer.getUndoableFiles());

  ipcMain.handle('file-undo', async (_, filePath) => {
    const result = await ctx.mcpToolServer.undoFileChange(filePath);
    const win = ctx.getMainWindow();
    if (result.success && win) {
      win.webContents.send('files-changed');
      if (filePath) win.webContents.send('open-file', filePath);
    }
    return result;
  });

  ipcMain.handle('file-undo-all', async () => {
    const results = await ctx.mcpToolServer.undoAllFileChanges();
    const win = ctx.getMainWindow();
    if (win) win.webContents.send('files-changed');
    return results;
  });

  ipcMain.handle('file-accept-changes', (_, filePaths) => ctx.mcpToolServer.acceptFileChanges(filePaths));

  // ─── Checkpoints ────────────────────────────────────────────────────
  ipcMain.handle('checkpoint-list', () => ctx.mcpToolServer.getCheckpointList());

  ipcMain.handle('checkpoint-restore', async (_, turnId) => {
    const result = await ctx.mcpToolServer.restoreCheckpoint(turnId);
    const win = ctx.getMainWindow();
    if (result.success && win) win.webContents.send('files-changed');
    return result;
  });
}

module.exports = { register };
