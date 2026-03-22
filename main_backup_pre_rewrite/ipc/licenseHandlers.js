/**
 * IPC Handlers: License Management
 */
const { ipcMain, BrowserWindow, session } = require('electron');

// BUG-009: Guard against concurrent OAuth flows opening multiple windows
let oauthInProgress = false;

function register(ctx) {
  ipcMain.handle('license-get-status', () => ctx.licenseManager.getStatus());

  ipcMain.handle('license-activate', async (_, key) => {
    if (key && key.trim().toUpperCase().startsWith('GUIDE-DEV0')) {
      return ctx.licenseManager.devActivate(key);
    }
    return ctx.licenseManager.activate(key);
  });

  ipcMain.handle('license-activate-account', async (_, email, password) => ctx.licenseManager.activateWithAccount(email, password));
  ipcMain.handle('license-deactivate', async () => ctx.licenseManager.deactivate());
  ipcMain.handle('license-load', () => ctx.licenseManager.loadLicense());
  ipcMain.handle('license-revalidate', async () => ctx.licenseManager.revalidate());
  ipcMain.handle('license-check-access', () => ctx.licenseManager.checkAccess());

  // OAuth Sign-In via BrowserWindow
  ipcMain.handle('license-oauth-signin', async (_, provider) => {
    if (!['google', 'github'].includes(provider)) {
      return { success: false, error: 'Invalid OAuth provider' };
    }

    // BUG-009: Prevent multiple concurrent OAuth windows
    if (oauthInProgress) {
      return { success: false, error: 'Sign-in already in progress. Please complete or close the existing sign-in window.' };
    }
    oauthInProgress = true;

    return new Promise(async (resolve) => {
      let resolved = false;
      let activationInProgress = false;
      const finish = (result) => {
        if (!resolved) {
          resolved = true;
          oauthInProgress = false; // BUG-009: Release the lock
          resolve(result);
        }
      };

      const oauthSession = session.fromPartition('oauth-signin');
      try { await oauthSession.clearStorageData(); } catch (_) {}

      const authWin = new BrowserWindow({
        width: 520,
        height: 700,
        autoHideMenuBar: true,
        title: `Sign in with ${provider === 'google' ? 'Google' : 'GitHub'}`,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: oauthSession,
        },
      });

      const serverUrl = 'https://graysoft.dev';

      // ── Detection 1: guide_auth cookie set ──
      const cookieChangeHandler = async (_event, cookie, _cause, removed) => {
        if (removed || resolved || activationInProgress) return;
        if (cookie.name !== 'guide_auth' || !cookie.value) return;
        activationInProgress = true;
        console.log('[OAuth] guide_auth cookie detected');
        try {
          const result = await ctx.licenseManager.activateWithToken(cookie.value);
          console.log('[OAuth] activateWithToken result:', JSON.stringify(result));
          try { authWin.close(); } catch (_) {}
          finish(result);
        } catch (err) {
          console.error('[OAuth] Token activation failed:', err);
          try { authWin.close(); } catch (_) {}
          finish({ success: false, error: `Token activation failed: ${err.message}` });
        }
      };
      oauthSession.cookies.on('changed', cookieChangeHandler);

      // ── Detection 2: guide_token in URL (query param or hash fragment) ──
      const checkUrl = (url) => {
        if (resolved || activationInProgress || !url.includes('guide_token=')) return;
        console.log('[OAuth] guide_token found in URL:', url.substring(0, 80));
        try {
          const parsed = new URL(url);
          // Try query param first: /account?guide_token=JWT
          let token = parsed.searchParams.get('guide_token');
          // Try hash fragment: /account#guide_token=JWT
          if (!token && parsed.hash.includes('guide_token=')) {
            token = new URLSearchParams(parsed.hash.substring(1)).get('guide_token');
          }
          if (token) {
            activationInProgress = true;
            console.log('[OAuth] Token extracted (length:', token.length, ')');
            ctx.licenseManager.activateWithToken(token).then(result => {
              console.log('[OAuth] activateWithToken result:', JSON.stringify(result));
              try { authWin.close(); } catch (_) {}
              finish(result);
            }).catch(err => {
              console.error('[OAuth] Token activation failed:', err);
              try { authWin.close(); } catch (_) {}
              finish({ success: false, error: `Token activation failed: ${err.message}` });
            });
          }
        } catch (err) {
          console.error('[OAuth] URL parse error:', err);
        }
      };

      // ── Error detection ──
      const checkError = (url) => {
        if (resolved || !url.includes('/login?error=')) return;
        const errorParam = new URL(url).searchParams.get('error') || 'unknown';
        const errorMessages = {
          no_code: 'OAuth provider did not return an authorization code.',
          csrf_failed: 'Security verification failed. Please try again.',
          token_failed: 'Failed to exchange authorization code.',
          no_email: 'Could not retrieve email from your account.',
          server_error: 'Server error during authentication.',
        };
        try { authWin.close(); } catch (_) {}
        finish({ success: false, error: errorMessages[errorParam] || `OAuth error: ${errorParam}` });
      };

      authWin.webContents.on('did-navigate', (_, url) => { checkUrl(url); checkError(url); });
      authWin.webContents.on('did-redirect-navigation', (_, url) => { checkUrl(url); checkError(url); });
      authWin.webContents.on('did-navigate-in-page', (_, url) => checkUrl(url));
      authWin.webContents.on('did-finish-load', () => {
        const url = authWin.webContents.getURL();
        checkUrl(url);
        // BUG-017: Detect JSON error responses from the OAuth server
        // (e.g., {"error":"OAuth not configured"} returned as page body)
        if (!resolved) {
          authWin.webContents.executeJavaScript('document.body && document.body.innerText').then(bodyText => {
            if (!resolved && bodyText) {
              try {
                const parsed = JSON.parse(bodyText.trim());
                if (parsed?.error) {
                  console.error('[OAuth] Server returned JSON error:', parsed.error);
                  try { authWin.close(); } catch (_) {}
                  finish({ success: false, error: `OAuth server error: ${parsed.error}. The sign-in service may be temporarily unavailable.` });
                }
              } catch (_) {
                // Not JSON — normal page content, ignore
              }
            }
          }).catch(() => {});
        }
      });

      const oauthUrl = `${serverUrl}/api/auth/${provider}?return=guide-desktop`;
      console.log('[OAuth] Opening:', oauthUrl);
      authWin.loadURL(oauthUrl);

      authWin.on('closed', () => {
        oauthSession.cookies.removeListener('changed', cookieChangeHandler);
        finish({ success: false, error: 'Sign-in window was closed.' });
      });

      // 2-minute timeout
      setTimeout(() => {
        if (!resolved) {
          oauthSession.cookies.removeListener('changed', cookieChangeHandler);
          try { authWin.close(); } catch (_) {}
          finish({ success: false, error: 'Sign-in timed out. Please try again.' });
        }
      }, 120000);
    });
  });
}

module.exports = { register };
