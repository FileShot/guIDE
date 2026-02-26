/**
 * IPC Handlers: Live Server — static file server with WebSocket live-reload
 * No external npm packages for HTTP. Uses built-in `http` + `ws` (already a dep).
 */
const { ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const net = require('net');
const fs = require('fs').promises;

let _server = null;
let _wss = null;
let _currentPort = null;

// ── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.cjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ts':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
};

function getMime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Find an available port starting from `start`
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(start, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on('error', () => {
      if (start >= 3100) return reject(new Error('No free port found between 3000-3100'));
      resolve(findFreePort(start + 1));
    });
  });
}

// Live-reload script injected into all HTML responses
function liveReloadScript(wsPort) {
  return `<script>
(function(){
  var ws=new WebSocket('ws://127.0.0.1:${wsPort}');
  ws.onmessage=function(e){if(e.data==='reload')location.reload();};
  ws.onclose=function(){setTimeout(function(){location.reload();},2000);};
})();
</script>`;
}

// Broadcast reload to all connected WebSocket clients — called by fileSystemHandlers
function notifyReload() {
  if (!_wss) return;
  _wss.clients.forEach(client => {
    try { if (client.readyState === 1) client.send('reload'); } catch {}
  });
}

function register(ctx) {
  ipcMain.handle('live-server-start', async (_, filePath) => {
    // Root = directory of the provided file path
    const rootPath = path.dirname(filePath);

    // Stop any existing server
    if (_server) {
      try { _wss && _wss.close(); } catch {}
      try { _server.close(); } catch {}
      _server = null;
      _wss = null;
      _currentPort = null;
    }

    try {
      const port = await findFreePort(3000);
      const wsPort = await findFreePort(port + 1);

      // WebSocket server for live reload
      const { WebSocketServer } = require('ws');
      _wss = new WebSocketServer({ port: wsPort, host: '127.0.0.1' });

      // HTTP server
      _server = http.createServer(async (req, res) => {
        let urlPath = (req.url || '/').split('?')[0];
        if (urlPath === '/') urlPath = '/index.html';

        // Sanitize path — prevent directory traversal
        try { urlPath = decodeURIComponent(urlPath); } catch {}
        urlPath = urlPath.replace(/\.\./g, '').replace(/\\/g, '/');

        const absPath = path.join(rootPath, urlPath);
        if (!absPath.startsWith(rootPath)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }

        try {
          let content = await fs.readFile(absPath);
          const ext = path.extname(absPath).toLowerCase();
          const mime = getMime(absPath);

          // Inject live-reload script into HTML files
          if (ext === '.html' || ext === '.htm') {
            let html = content.toString('utf8');
            const script = liveReloadScript(wsPort);
            html = html.includes('</body>')
              ? html.replace('</body>', script + '</body>')
              : html + script;
            content = Buffer.from(html, 'utf8');
          }

          res.writeHead(200, {
            'Content-Type': mime,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, no-store',
          });
          res.end(content);
        } catch {
          // SPA fallback — try serving index.html
          try {
            const indexPath = path.join(rootPath, 'index.html');
            let html = (await fs.readFile(indexPath)).toString('utf8');
            const script = liveReloadScript(wsPort);
            html = html.includes('</body>') ? html.replace('</body>', script + '</body>') : html + script;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(html);
          } catch {
            res.writeHead(404);
            res.end(`Not found: ${urlPath}`);
          }
        }
      });

      _server.listen(port, '127.0.0.1');
      _currentPort = port;

      return { success: true, port, wsPort, url: `http://127.0.0.1:${port}/` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('live-server-stop', async () => {
    try {
      if (_wss) { _wss.close(); _wss = null; }
      if (_server) { _server.close(); _server = null; }
      _currentPort = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('live-server-status', async () => {
    return { running: !!_server && !!_currentPort, port: _currentPort };
  });
}

module.exports = { register, notifyReload };
