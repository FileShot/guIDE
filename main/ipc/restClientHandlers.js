/**
 * IPC Handlers: REST Client — make HTTP/HTTPS requests from main process (no CORS)
 * Uses Node.js built-in http/https modules — zero npm dependencies.
 */
const { ipcMain } = require('electron');
const { URL } = require('url');

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB cap

function register() {
  ipcMain.handle('rest-request', async (_, { method, url, headers = {}, body = '' }) => {
    const start = Date.now();

    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (!resolved) { resolved = true; resolve(result); }
      };

      try {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const mod = require(isHttps ? 'https' : 'http');

        const reqHeaders = { ...headers };
        let bodyBuffer = null;

        const METHOD = (method || 'GET').toUpperCase();
        if (['POST', 'PUT', 'PATCH'].includes(METHOD) && body) {
          bodyBuffer = Buffer.from(body, 'utf8');
          if (!Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-length')) {
            reqHeaders['content-length'] = String(bodyBuffer.length);
          }
          if (!Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-type')) {
            // Auto-detect JSON
            try { JSON.parse(body); reqHeaders['content-type'] = 'application/json'; }
            catch { reqHeaders['content-type'] = 'text/plain'; }
          }
        }

        if (!Object.keys(reqHeaders).some(k => k.toLowerCase() === 'user-agent')) {
          reqHeaders['user-agent'] = 'guIDE REST Client/2.0';
        }
        if (!Object.keys(reqHeaders).some(k => k.toLowerCase() === 'accept')) {
          reqHeaders['accept'] = '*/*';
        }

        const options = {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: (parsed.pathname || '/') + (parsed.search || ''),
          method: METHOD,
          headers: reqHeaders,
          rejectUnauthorized: false, // allow self-signed certs for local dev
          timeout: REQUEST_TIMEOUT_MS,
        };

        const req = mod.request(options, (res) => {
          const chunks = [];
          let totalBytes = 0;
          let truncated = false;

          res.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes <= MAX_RESPONSE_BYTES) {
              chunks.push(chunk);
            } else {
              truncated = true;
            }
          });

          res.on('end', () => {
            const durationMs = Date.now() - start;
            const rawBuffer = Buffer.concat(chunks);
            const rawBody = rawBuffer.toString('utf8');

            // Attempt JSON pretty-print
            const ct = (res.headers['content-type'] || '').toLowerCase();
            let displayBody = rawBody;
            if (ct.includes('json')) {
              try { displayBody = JSON.stringify(JSON.parse(rawBody), null, 2); } catch {}
            }

            // Normalise headers to plain object (some values are arrays)
            const responseHeaders = {};
            for (const [k, v] of Object.entries(res.headers)) {
              responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
            }

            done({
              success: true,
              status: res.statusCode,
              statusText: res.statusMessage || '',
              headers: responseHeaders,
              body: displayBody,
              rawBody,
              durationMs,
              size: totalBytes,
              truncated,
            });
          });

          res.on('error', (err) => {
            done({ success: false, error: err.message, durationMs: Date.now() - start });
          });
        });

        req.on('error', (err) => {
          done({ success: false, error: err.message, durationMs: Date.now() - start });
        });

        req.on('timeout', () => {
          req.destroy();
          done({ success: false, error: `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`, durationMs: Date.now() - start });
        });

        if (bodyBuffer) req.write(bodyBuffer);
        req.end();
      } catch (err) {
        done({ success: false, error: err.message, durationMs: Date.now() - start });
      }
    });
  });
}

module.exports = { register };
