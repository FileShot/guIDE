/**
 * Standalone OAuth diagnostic — run with: npx electron test-oauth.js
 * Opens Google sign-in BrowserWindow and logs EVERYTHING.
 */
const { app, BrowserWindow, session } = require('electron');

app.whenReady().then(async () => {
  const oauthSession = session.fromPartition('oauth-test-diag');
  try { await oauthSession.clearStorageData(); } catch (_) {}

  const win = new BrowserWindow({
    width: 600, height: 750,
    title: 'OAuth Diagnostic',
    webPreferences: { nodeIntegration: false, contextIsolation: true, session: oauthSession },
  });

  // Log EVERY cookie change
  oauthSession.cookies.on('changed', (_ev, cookie, cause, removed) => {
    console.log(`[COOKIE ${removed ? 'REMOVED' : 'SET'}] name=${cookie.name} domain=${cookie.domain} value=${(cookie.value || '').substring(0, 30)}... httpOnly=${cookie.httpOnly} secure=${cookie.secure} cause=${cause}`);
  });

  // Log EVERY Set-Cookie header
  oauthSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ cancel: false, responseHeaders: details.responseHeaders });
    const headers = details.responseHeaders || {};
    const setCookies = headers['set-cookie'] || headers['Set-Cookie'] || [];
    if (setCookies.length > 0) {
      console.log(`[SET-COOKIE HEADER] url=${details.url}`);
      setCookies.forEach((h, i) => console.log(`  [${i}] ${h.substring(0, 120)}`));
    }
  });

  // Log EVERY navigation
  win.webContents.on('did-navigate', (_, url) => console.log('[NAV did-navigate]', url));
  win.webContents.on('did-redirect-navigation', (_, url) => console.log('[NAV did-redirect]', url));
  win.webContents.on('did-navigate-in-page', (_, url) => console.log('[NAV in-page]', url));
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    console.log('[NAV did-finish-load]', url);

    // If we landed on /account, dump all cookies
    if (url.includes('/account')) {
      console.log('[RESULT] Landed on /account — checking URL for guide_token...');
      if (url.includes('guide_token=')) {
        console.log('[RESULT] ✅ guide_token found in URL query string!');
        try {
          const parsed = new URL(url);
          const token = parsed.searchParams.get('guide_token');
          console.log('[RESULT] Token length:', token?.length);
          console.log('[RESULT] Token preview:', token?.substring(0, 40) + '...');
        } catch (e) {
          console.log('[RESULT] URL parse error:', e.message);
        }
      } else {
        console.log('[RESULT] ❌ NO guide_token in URL');
      }

      // Also try cookie reads
      oauthSession.cookies.get({ url: 'https://graysoft.dev' }).then(cookies => {
        console.log(`[COOKIES] All cookies for graysoft.dev (${cookies.length}):`);
        cookies.forEach(c => console.log(`  ${c.name}=${(c.value || '').substring(0, 20)}... domain=${c.domain} httpOnly=${c.httpOnly}`));
        const auth = cookies.find(c => c.name === 'guide_auth');
        if (auth) {
          console.log('[RESULT] ✅ guide_auth cookie found! length:', auth.value?.length);
        } else {
          console.log('[RESULT] ❌ guide_auth cookie NOT found');
        }
      });

      oauthSession.cookies.get({ domain: '.graysoft.dev' }).then(cookies => {
        console.log(`[COOKIES] Broad .graysoft.dev search (${cookies.length}):`);
        cookies.forEach(c => console.log(`  ${c.name}=${(c.value || '').substring(0, 20)}... domain=${c.domain}`));
      });

      oauthSession.cookies.get({}).then(cookies => {
        console.log(`[COOKIES] ALL cookies in session (${cookies.length}):`);
        cookies.forEach(c => console.log(`  ${c.name} domain=${c.domain}`));
      });
    }
  });

  win.on('closed', () => {
    console.log('[DONE] Window closed');
    app.quit();
  });

  const url = 'https://graysoft.dev/api/auth/google?return=guide-desktop';
  console.log('[START] Opening:', url);
  win.loadURL(url);
});
