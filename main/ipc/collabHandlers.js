/**
 * guIDE — AI-Powered Offline IDE
 * Collaborative Editing (Live Share) Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const http = require('http');
const crypto = require('crypto');
const os = require('os');

// ws is already a dependency
let WebSocketServer, WebSocket;
try {
  const ws = require('ws');
  WebSocketServer = ws.WebSocketServer || ws.Server;
  WebSocket = ws;
} catch {
  WebSocketServer = null;
  WebSocket = null;
}

// ─── State ───
let collabServer = null;
let collabClients = new Map(); // peerId → { ws, username, color, cursor }
let collabDoc = null; // { content, version, filePath }
let hostSession = null; // { sessionId, port, password }
let clientConnection = null; // when joining someone else's session

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA',
];
let colorIdx = 0;

function _genSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function _genPassword() {
  return crypto.randomBytes(4).toString('hex');
}

function _getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function _broadcast(data, exclude) {
  const msg = JSON.stringify(data);
  for (const [peerId, client] of collabClients) {
    if (peerId !== exclude && client.ws.readyState === 1) {
      try { client.ws.send(msg); } catch { /* ignore */ }
    }
  }
}

function register(ctx) {
  // ── Check availability ──
  ipcMain.handle('collab-available', async () => {
    return { available: !!WebSocketServer };
  });

  // ── Host a session ──
  ipcMain.handle('collab-host', async (_, params) => {
    if (!WebSocketServer) return { success: false, error: 'ws package not available' };
    if (collabServer) return { success: false, error: 'Already hosting a session' };

    const { filePath, content, username = 'Host', port = 0 } = params;
    const sessionId = _genSessionId();
    const password = _genPassword();

    try {
      const httpServer = http.createServer();
      const wss = new WebSocketServer({ server: httpServer });

      collabDoc = { content: content || '', version: 0, filePath: filePath || 'untitled' };
      colorIdx = 0;

      wss.on('connection', (ws, req) => {
        const peerId = crypto.randomBytes(8).toString('hex');
        const peerColor = COLORS[colorIdx++ % COLORS.length];

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());

            switch (msg.type) {
              case 'auth': {
                if (msg.password !== password) {
                  ws.send(JSON.stringify({ type: 'auth-failed', error: 'Invalid password' }));
                  ws.close();
                  return;
                }
                collabClients.set(peerId, {
                  ws, username: msg.username || 'Anonymous', color: peerColor,
                  cursor: { line: 1, column: 1 },
                });
                // Send initial state
                ws.send(JSON.stringify({
                  type: 'init',
                  peerId,
                  color: peerColor,
                  doc: collabDoc,
                  peers: Array.from(collabClients.entries())
                    .filter(([id]) => id !== peerId)
                    .map(([id, c]) => ({ id, username: c.username, color: c.color, cursor: c.cursor })),
                }));
                // Notify others
                _broadcast({
                  type: 'peer-joined',
                  peerId, username: msg.username || 'Anonymous', color: peerColor,
                }, peerId);

                // Notify host renderer
                if (ctx.mainWindow) {
                  ctx.mainWindow.webContents.send('collab-event', {
                    type: 'peer-joined',
                    peerId, username: msg.username || 'Anonymous', color: peerColor,
                  });
                }
                break;
              }

              case 'edit': {
                // Apply edit to doc
                collabDoc.version++;
                collabDoc.content = msg.content;
                _broadcast({
                  type: 'edit',
                  peerId,
                  content: msg.content,
                  version: collabDoc.version,
                  selection: msg.selection,
                }, peerId);
                // Notify host renderer
                if (ctx.mainWindow) {
                  ctx.mainWindow.webContents.send('collab-event', {
                    type: 'edit', peerId, content: msg.content, version: collabDoc.version,
                  });
                }
                break;
              }

              case 'cursor': {
                const client = collabClients.get(peerId);
                if (client) client.cursor = msg.cursor;
                _broadcast({ type: 'cursor', peerId, cursor: msg.cursor }, peerId);
                if (ctx.mainWindow) {
                  ctx.mainWindow.webContents.send('collab-event', {
                    type: 'cursor', peerId, cursor: msg.cursor,
                  });
                }
                break;
              }

              case 'chat': {
                _broadcast({
                  type: 'chat', peerId,
                  username: collabClients.get(peerId)?.username || 'Unknown',
                  message: msg.message,
                  timestamp: Date.now(),
                }, null); // send to all, including sender
                if (ctx.mainWindow) {
                  ctx.mainWindow.webContents.send('collab-event', {
                    type: 'chat', peerId,
                    username: collabClients.get(peerId)?.username || 'Unknown',
                    message: msg.message,
                  });
                }
                break;
              }
            }
          } catch { /* ignore malformed messages */ }
        });

        ws.on('close', () => {
          const client = collabClients.get(peerId);
          collabClients.delete(peerId);
          _broadcast({ type: 'peer-left', peerId, username: client?.username }, null);
          if (ctx.mainWindow) {
            ctx.mainWindow.webContents.send('collab-event', {
              type: 'peer-left', peerId, username: client?.username,
            });
          }
        });
      });

      return new Promise((resolve) => {
        httpServer.listen(port, '0.0.0.0', () => {
          const actualPort = httpServer.address().port;
          collabServer = { httpServer, wss };
          hostSession = { sessionId, port: actualPort, password };

          const ips = _getLocalIPs();
          resolve({
            success: true,
            sessionId,
            port: actualPort,
            password,
            localIPs: ips,
            shareLink: `ws://${ips[0] || 'localhost'}:${actualPort}`,
          });
        });
      });
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Stop hosting ──
  ipcMain.handle('collab-stop-host', async () => {
    if (!collabServer) return { success: false, error: 'Not hosting' };
    try {
      // Disconnect all clients
      for (const [, client] of collabClients) {
        try { client.ws.close(); } catch { /* ignore */ }
      }
      collabClients.clear();
      collabServer.wss.close();
      collabServer.httpServer.close();
      collabServer = null;
      hostSession = null;
      collabDoc = null;
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Join a session (connect as client) ──
  ipcMain.handle('collab-join', async (_, params) => {
    if (!WebSocket) return { success: false, error: 'ws package not available' };
    if (clientConnection) return { success: false, error: 'Already in a session' };

    const { host, port, password, username = 'Guest' } = params;

    return new Promise((resolve) => {
      try {
        const wsUrl = `ws://${host}:${port}`;
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', password, username }));
        });

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'auth-failed') {
              ws.close();
              resolve({ success: false, error: msg.error || 'Authentication failed' });
              return;
            }
            if (msg.type === 'init') {
              clientConnection = { ws, peerId: msg.peerId };
              resolve({
                success: true,
                peerId: msg.peerId,
                color: msg.color,
                doc: msg.doc,
                peers: msg.peers,
              });
            }
            // Forward all subsequent messages to renderer
            if (ctx.mainWindow) {
              ctx.mainWindow.webContents.send('collab-event', msg);
            }
          } catch { /* ignore */ }
        });

        ws.on('close', () => {
          clientConnection = null;
          if (ctx.mainWindow) {
            ctx.mainWindow.webContents.send('collab-event', { type: 'disconnected' });
          }
        });

        ws.on('error', (err) => {
          clientConnection = null;
          resolve({ success: false, error: err.message });
        });
      } catch (e) { resolve({ success: false, error: e.message }); }
    });
  });

  // ── Leave a session (client) ──
  ipcMain.handle('collab-leave', async () => {
    if (!clientConnection) return { success: false, error: 'Not in a session' };
    try {
      clientConnection.ws.close();
      clientConnection = null;
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Send edit (from client to server) ──
  ipcMain.handle('collab-send-edit', async (_, params) => {
    const ws = clientConnection?.ws;
    if (!ws || ws.readyState !== 1) return { success: false, error: 'Not connected' };
    try {
      ws.send(JSON.stringify({ type: 'edit', content: params.content, selection: params.selection }));
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Send cursor position ──
  ipcMain.handle('collab-send-cursor', async (_, cursor) => {
    const ws = clientConnection?.ws;
    if (!ws || ws.readyState !== 1) return { success: false };
    try {
      ws.send(JSON.stringify({ type: 'cursor', cursor }));
      return { success: true };
    } catch { return { success: false }; }
  });

  // ── Send chat message ──
  ipcMain.handle('collab-send-chat', async (_, message) => {
    const ws = clientConnection?.ws;
    if (!ws || ws.readyState !== 1) return { success: false, error: 'Not connected' };
    try {
      ws.send(JSON.stringify({ type: 'chat', message }));
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Get session info ──
  ipcMain.handle('collab-get-session', async () => {
    if (hostSession) {
      const peers = Array.from(collabClients.entries()).map(([id, c]) => ({
        id, username: c.username, color: c.color, cursor: c.cursor,
      }));
      return {
        success: true,
        role: 'host',
        session: hostSession,
        peers,
        doc: collabDoc ? { filePath: collabDoc.filePath, version: collabDoc.version } : null,
      };
    }
    if (clientConnection) {
      return { success: true, role: 'client', peerId: clientConnection.peerId };
    }
    return { success: true, role: null };
  });

  // ── Update doc content from host ──
  ipcMain.handle('collab-update-doc', async (_, content) => {
    if (!collabDoc) return { success: false, error: 'No active session' };
    collabDoc.content = content;
    collabDoc.version++;
    _broadcast({
      type: 'edit', peerId: 'host', content, version: collabDoc.version,
    }, null);
    return { success: true, version: collabDoc.version };
  });
}

module.exports = { register };
