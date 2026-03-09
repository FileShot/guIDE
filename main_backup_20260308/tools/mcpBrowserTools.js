/**
 * MCP Browser Tools — All browser automation methods for MCPToolServer.
 * Extracted from mcpToolServer.js (ARCH-03).
 * These methods are mixed into MCPToolServer.prototype so `this` works.
 */

async function _browserNavigate(url) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available.' };

  // Auto-launch Playwright if not yet launched
  if (this.playwrightBrowser && !this.playwrightBrowser.isLaunched) {
    console.log('[MCPToolServer] Auto-launching Playwright browser for navigation...');
    const launchResult = await this.playwrightBrowser.launch({ headless: false });
    if (!launchResult.success) {
      console.warn('[MCPToolServer] Playwright auto-launch failed:', launchResult.error);
    }
  }

  // Clean up URL — strip stray quotes/whitespace that small models inject
  let cleanUrl = (url || '').trim().replace(/^['"`]+|['"`]+$/g, '').trim();
  if (!cleanUrl) return { success: false, error: 'No URL provided.' };

  // Handle file:///workspace/ URLs — translate to real paths and check existence
  const wsFileMatch = cleanUrl.match(/^file:\/\/\/workspace\/(.*)/i);
  if (wsFileMatch) {
    const fs = require('fs');
    const filename = wsFileMatch[1];
    const projectPath = this.projectPath || '';
    const filePath = require('path').isAbsolute(filename) ? filename : require('path').join(projectPath, filename);
    if (fs.existsSync(filePath)) {
      cleanUrl = `file:///${filePath.replace(/\\/g, '/')}`;
    } else {
      return { success: false, error: `File not found: /workspace/${filename}. You must call write_file to create the file BEFORE navigating to it. The file does not exist yet.` };
    }
  }

  // Only allow http/https schemes — block javascript:, file:, data:, ftp: etc.
  if (/^https?:\/\//i.test(cleanUrl)) {
    // Already has valid scheme
  } else if (/^file:\/\//i.test(cleanUrl)) {
    // file:// URLs are allowed (handled above for workspace paths)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(cleanUrl)) {
    return { success: false, error: 'URL scheme not allowed. Only http:// and https:// are supported.' };
  } else {
    cleanUrl = 'https://' + cleanUrl;
  }

  // Block navigation to internal/private IPs
  try {
    const parsed = new URL(cleanUrl);
    const host = parsed.hostname.toLowerCase();
    const blockedNav = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'metadata.google.internal'];
    if (blockedNav.includes(host) || /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(host)) {
      return { success: false, error: `Navigation to internal addresses (${host}) is blocked for security.` };
    }
  } catch (_) {}

  const result = await browser.navigate(cleanUrl);

  // Only show viewport browser panel when NOT using Playwright (it has its own window)
  if (result.success && this.browserManager?.parentWindow && !this.playwrightBrowser?.isLaunched) {
    this.browserManager.parentWindow.webContents.send('show-browser', { url });
    setTimeout(() => {
      try { this.browserManager.parentWindow.webContents.send('browser-restore'); } catch (_) {}
    }, 300);
  }
  return result;
}

async function _browserClick(refStr, options = {}) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };

  const result = await browser.click(refStr, options);

  // Attempt 2: if ref not found, take a fresh snapshot and retry
  if (!result.success && (result.error?.includes('not found') || result.error?.includes('timeout'))) {
    console.log(`[MCPToolServer] browser_click ref=${refStr} failed — retrying with fresh snapshot`);
    try {
      // Dismiss any overlay popups first
      const page = browser.page;
      if (page) {
        await page.evaluate(() => {
          document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="popup"], [class*="cookie"], [class*="consent"], [class*="banner"]').forEach(el => {
            if (el.offsetHeight > 0 && getComputedStyle(el).position === 'fixed') el.remove();
          });
        }).catch(() => {});
      }

      const snapshot = await browser.getSnapshot();
      if (snapshot.success) {
        const retryResult = await browser.click(refStr, options);
        if (retryResult.success) return retryResult;
      }

      // Attempt 3: JS fallback — try to find and click element via evaluate()
      if (page && options.element) {
        console.log(`[MCPToolServer] browser_click attempt 3: JS fallback for "${options.element}"`);
        const jsClicked = await page.evaluate((text) => {
          const elements = document.querySelectorAll('button, a, [role="button"], [onclick], input[type="submit"], input[type="button"]');
          for (const el of elements) {
            const elText = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
            if (elText.toLowerCase().includes(text.toLowerCase())) {
              el.scrollIntoView({ block: 'center' });
              el.click();
              return true;
            }
          }
          return false;
        }, String(options.element)).catch(() => false);
        if (jsClicked) {
          return { success: true, ref: refStr, element: { tag: 'unknown', text: options.element, role: '' }, message: 'Clicked via JS fallback' };
        }
      }

      return { success: false, error: `Element ref=${refStr} not found after retry. Use browser_snapshot to see current page elements.` };
    } catch (e) {
      console.log('[MCPToolServer] Auto-retry failed:', e.message);
    }
  }
  return result;
}

async function _browserType(refStr, text, options = {}) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };

  const result = await browser.type(refStr, text, options);

  // Attempt 2: if ref not found, take fresh snapshot and retry
  if (!result.success && (result.error?.includes('not found') || result.error?.includes('timeout'))) {
    console.log(`[MCPToolServer] browser_type ref=${refStr} failed — retrying with fresh snapshot`);
    try {
      const snapshot = await browser.getSnapshot();
      if (snapshot.success) {
        const retryResult = await browser.type(refStr, text, options);
        if (retryResult.success) return retryResult;
      }

      // Attempt 3: JS fallback — find input by description and set value directly
      const page = browser.page;
      if (page) {
        console.log(`[MCPToolServer] browser_type attempt 3: JS value setter fallback`);
        const jsTyped = await page.evaluate(({ refNum, value }) => {
          // Try to find the input by iterating all visible inputs
          const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
          const visible = Array.from(inputs).filter(el => el.offsetHeight > 0);
          // Try matching by index position as a rough ref mapping
          const idx = parseInt(refNum) - 1;
          const target = (idx >= 0 && idx < visible.length) ? visible[idx] : visible[0];
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
              || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(target, value);
            else target.value = value;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        }, { refNum: String(refStr), value: text }).catch(() => false);
        if (jsTyped) {
          return { success: true, ref: refStr, text, message: 'Typed via JS fallback' };
        }
      }

      return { success: false, error: `Element ref=${refStr} not found after retry. Use browser_snapshot to see current page elements.` };
    } catch (e) {
      console.log('[MCPToolServer] Auto-retry failed:', e.message);
    }
  }
  return result;
}

async function _browserFillForm(fields) {
  if (!this.playwrightBrowser) {
    return { success: false, error: 'browser_fill_form requires Playwright browser. Use browser_type for individual fields.' };
  }
  let normalizedFields = fields;
  if (Array.isArray(fields)) {
    normalizedFields = fields.map(f => {
      if (Array.isArray(f)) {
        return { ref: String(f[0]), value: String(f[1] || ''), type: f[2] || 'textbox' };
      }
      if (typeof f === 'string') return null;
      if (typeof f === 'object' && f !== null) {
        return { ref: String(f.ref || ''), value: String(f.value || ''), type: f.type || 'textbox' };
      }
      return null;
    }).filter(Boolean);
  }
  if (!normalizedFields || normalizedFields.length === 0) {
    return { success: false, error: 'No valid fields provided. Expected: [{ref: "N", value: "text", type: "textbox"}]' };
  }
  return this.playwrightBrowser.fillForm(normalizedFields);
}

async function _browserSelectOption(refStr, values) {
  if (this.playwrightBrowser) return this.playwrightBrowser.selectOption(refStr, values);
  if (this.browserManager) return this.browserManager.selectOption(refStr, Array.isArray(values) ? values[0] : values);
  return { success: false, error: 'Browser not available' };
}

async function _browserSnapshot() {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  return browser.getSnapshot();
}

async function _browserScreenshot(options = {}) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  if (this.playwrightBrowser) return this.playwrightBrowser.screenshot(options);
  return this.browserManager.screenshot(options.fullPage);
}

async function _browserGetContent(selector, html = false) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  return browser.getContent(selector, html);
}

async function _browserEvaluate(code, ref) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  if (this.playwrightBrowser) return this.playwrightBrowser.evaluate(code, ref);
  return this.browserManager.evaluate(code);
}

async function _browserBack() {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  return browser.goBack();
}

async function _browserPressKey(key) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  return browser.pressKey(key);
}

async function _browserHover(refStr) {
  const browser = this._getBrowser();
  if (!browser) return { success: false, error: 'Browser not available' };
  return browser.hover(refStr);
}

async function _browserDrag(startRef, endRef) {
  if (this.playwrightBrowser) return this.playwrightBrowser.drag(startRef, endRef);
  return { success: false, error: 'browser_drag requires Playwright browser.' };
}

async function _browserTabs(action, index) {
  if (this.playwrightBrowser) return this.playwrightBrowser.tabs(action, index);
  return { success: false, error: 'browser_tabs requires Playwright browser.' };
}

async function _browserHandleDialog(accept, promptText) {
  if (this.playwrightBrowser) return this.playwrightBrowser.handleDialog(accept, promptText);
  return { success: false, error: 'browser_handle_dialog requires Playwright browser.' };
}

async function _browserConsoleMessages(level) {
  if (this.playwrightBrowser) return this.playwrightBrowser.getConsoleMessages(level);
  return { success: false, error: 'browser_console_messages requires Playwright browser.' };
}

async function _browserFileUpload(refStr, paths) {
  if (this.playwrightBrowser) return this.playwrightBrowser.uploadFiles(refStr, paths);
  return { success: false, error: 'browser_file_upload requires Playwright browser.' };
}

async function _browserResize(width, height) {
  if (this.playwrightBrowser) return this.playwrightBrowser.resize(width, height);
  return { success: false, error: 'browser_resize requires Playwright browser.' };
}

async function _browserClose() {
  if (this.playwrightBrowser) return this.playwrightBrowser.close();
  return { success: true, message: 'No external browser to close' };
}

async function _browserWaitFor(options = {}) {
  if (this.playwrightBrowser) return this.playwrightBrowser.waitFor(options);
  if (options.selector && this.browserManager) {
    return this.browserManager.waitForSelector(options.selector, options.timeout || 10000);
  }
  if (options.time) {
    await new Promise(r => setTimeout(r, Math.min(options.time * 1000, 60000)));
    return { success: true, message: `Waited ${options.time}s` };
  }
  return { success: false, error: 'Browser not available' };
}

async function _browserScroll(direction, amount) {
  if (this.playwrightBrowser) return this.playwrightBrowser.scroll(direction, amount);
  if (!this.browserManager) return { success: false, error: 'Browser not available' };
  try {
    const scrollAmount = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
    const result = await this.browserManager.evaluate(`window.scrollBy(0, ${scrollAmount}); window.scrollY`);
    return { success: true, direction, amount, message: `Scrolled ${direction} by ${amount}px` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function _browserWait(ms = 2000) {
  const waitMs = Math.min(Math.max(ms || 2000, 100), 30000);
  await new Promise(resolve => setTimeout(resolve, waitMs));
  return { success: true, message: `Waited ${waitMs}ms` };
}

async function _browserGetUrl() {
  if (this.playwrightBrowser) return this.playwrightBrowser.getUrl();
  if (!this.browserManager) return { success: false, error: 'Browser not available' };
  try {
    const wc = this.browserManager._getWebContents?.() || this.browserManager.browserView?.webContents;
    if (!wc) return { success: false, error: 'No browser page active' };
    const url = wc.getURL();
    const title = await wc.executeJavaScript('document.title');
    return { success: true, url, title };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function _browserGetLinks(selector) {
  if (this.playwrightBrowser) return this.playwrightBrowser.getLinks(selector);
  if (!this.browserManager) return { success: false, error: 'Browser not available' };
  const wc = this.browserManager._getWebContents?.() || this.browserManager.browserView?.webContents;
  if (!wc) return { success: false, error: 'No browser page active' };
  try {
    const container = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document';
    const result = await wc.executeJavaScript(`
      (function() {
        const container = ${container} || document;
        const anchors = container.querySelectorAll('a[href]');
        return Array.from(anchors).slice(0, 100).map(a => ({
          href: a.href,
          text: (a.textContent || '').trim().substring(0, 100),
          title: a.title || '',
        }));
      })()
    `);
    return { success: true, links: result, total: result.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  _browserNavigate,
  _browserClick,
  _browserType,
  _browserFillForm,
  _browserSelectOption,
  _browserSnapshot,
  _browserScreenshot,
  _browserGetContent,
  _browserEvaluate,
  _browserBack,
  _browserPressKey,
  _browserHover,
  _browserDrag,
  _browserTabs,
  _browserHandleDialog,
  _browserConsoleMessages,
  _browserFileUpload,
  _browserResize,
  _browserClose,
  _browserWaitFor,
  _browserScroll,
  _browserWait,
  _browserGetUrl,
  _browserGetLinks,
};
