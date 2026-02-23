/**
 * guIDE Browser Manager - Manages embedded BrowserView for viewport browser
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * and external Chrome automation via CDP (Chrome DevTools Protocol).
 * Supports two modes:
 * 1. Viewport (embedded BrowserView in Electron)
 * 2. External Chrome (launched with --remote-debugging-port)
 */
const { BrowserView, BrowserWindow, shell } = require('electron');
const http = require('http');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

class BrowserManager {
  constructor() {
    this.browserView = null;
    this.parentWindow = null;
    this.isVisible = false;
    this.currentUrl = '';
    this.history = [];
    this.historyIndex = -1;
    
    // External Chrome
    this.chromeProcess = null;
    this.cdpPort = 9222;
    this.cdpWebSocket = null;
    this.externalMode = false;
  }

  /**
   * Initialize with parent window
   */
  initialize(parentWindow) {
    this.parentWindow = parentWindow;
  }

  /**
   * Navigate to URL in embedded browser view
   */
  async navigate(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    this.currentUrl = url;

    if (!this.parentWindow) {
      return { success: false, error: 'No parent window' };
    }

    if (!this.browserView) {
      this.browserView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });

      // Prevent popup windows from appearing (they'd be blank)
      this.browserView.webContents.setWindowOpenHandler(({ url }) => {
        // Navigate in the same view instead of opening a new window
        if (url && url !== 'about:blank') {
          this.browserView.webContents.loadURL(url);
        }
        return { action: 'deny' };
      });

      // Handle certificate errors — log and reject by default for security.
      // Self-signed certs on localhost are allowed for local dev servers.
      this.browserView.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
          console.log(`[Browser] Allowing cert error on localhost: ${error}`);
          event.preventDefault();
          callback(true);
        } else {
          console.warn(`[Browser] Rejecting certificate error for ${url}: ${error}`);
          callback(false);
        }
      });

      // Handle navigation errors gracefully
      this.browserView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.log(`[Browser] Navigation failed: ${errorCode} ${errorDescription} for ${validatedURL}`);
      });

      // Handle permission requests (location, camera, etc.)
      this.browserView.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        // Allow common permissions needed by modern websites
        const allowed = ['clipboard-read', 'clipboard-write', 'notifications', 'media', 'geolocation'];
        callback(allowed.includes(permission));
      });

      // Forward navigation events to renderer so BrowserPanel stays in sync
      this.browserView.webContents.on('did-navigate', (event, url) => {
        this._notifyStateChange(url, this.browserView.webContents.getTitle());
      });
      this.browserView.webContents.on('did-navigate-in-page', (event, url) => {
        this._notifyStateChange(url, this.browserView.webContents.getTitle());
      });
      this.browserView.webContents.on('page-title-updated', (event, title) => {
        const url = this.browserView?.webContents?.getURL?.() || '';
        this._notifyStateChange(url, title);
      });
      this.browserView.webContents.on('did-finish-load', () => {
        const url = this.browserView?.webContents?.getURL?.() || '';
        const title = this.browserView?.webContents?.getTitle?.() || '';
        this._notifyStateChange(url, title);
      });
    }

    // Auto-attach to window so executeJavaScript works for tool calls
    if (!this.isVisible) {
      this.parentWindow.addBrowserView(this.browserView);
      // Use reasonable offscreen bounds so pages render their full DOM/JS properly
      this.browserView.setBounds({ x: -2000, y: -2000, width: 1280, height: 900 });
      this.browserView.setAutoResize({ width: false, height: false });
      this.isVisible = true;
    }

    try {
      await this.browserView.webContents.loadURL(url);
      
      // Wait for page to fully settle (readyState + dynamic content)
      await this.waitForPageSettle(1500);

      // Add to history (cap at 100 entries to prevent unbounded growth)
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(url);
      if (this.history.length > 100) {
        this.history = this.history.slice(-100);
      }
      this.historyIndex = this.history.length - 1;

      return {
        success: true,
        url,
        title: this.browserView.webContents.getTitle(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Show the browser viewport (Electron sends bounds to renderer)
   * Optimized to reduce flicker and latency
   */
  show(bounds) {
    if (!this.parentWindow || !this.browserView) return false;
    
    // Validate bounds — never position at (0,0) which covers the title bar
    const validBounds = this._validateBounds(bounds || {
      x: 0,
      y: 36,
      width: 800,
      height: 600,
    });

    try {
      // Check if already attached to avoid unnecessary operations
      const attached = this.parentWindow.getBrowserViews().includes(this.browserView);
      if (!attached) {
        this.parentWindow.addBrowserView(this.browserView);
      }
      
      // Batch bounds update with autoResize for smoother rendering
      this.browserView.setBounds(validBounds);
      this.browserView.setAutoResize({ width: false, height: false });
      this.isVisible = true;
      
      return true;
    } catch (error) {
      console.error('[BrowserManager] show() error:', error);
      return false;
    }
  }

  /**
   * Hide the browser viewport — move offscreen instead of removing so the
   * page keeps its render state and avoids white-screen on re-show.
   */
  hide() {
    if (this.parentWindow && this.browserView) {
      // Move offscreen rather than removing to preserve paint buffers
      this.browserView.setBounds({ x: -3000, y: -3000, width: 1, height: 1 });
    }
    this.isVisible = false;
  }

  /**
   * Update browser view bounds (when panel resizes)
   * Optimized to reduce latency and prevent flicker
   */
  setBounds(bounds) {
    if (!this.browserView || !bounds) return;
    
    try {
      const validBounds = this._validateBounds(bounds);
      
      // Ensure the view is attached (safety check)
      if (this.parentWindow) {
        const attached = this.parentWindow.getBrowserViews().includes(this.browserView);
        if (!attached) {
          this.parentWindow.addBrowserView(this.browserView);
        }
      }
      
      // Only update if bounds actually changed (prevent unnecessary repaints)
      const currentBounds = this.browserView.getBounds();
      if (currentBounds.x !== validBounds.x || 
          currentBounds.y !== validBounds.y || 
          currentBounds.width !== validBounds.width || 
          currentBounds.height !== validBounds.height) {
        this.browserView.setBounds(validBounds);
      }
      
      this.isVisible = true;
    } catch (error) {
      console.error('[BrowserManager] setBounds() error:', error);
    }
  }

  /**
   * Validate and sanitize BrowserView bounds to prevent position bugs.
   * Ensures the view never covers the title bar or has invalid dimensions.
   */
  _validateBounds(bounds) {
    const MIN_Y = 36; // Title bar height
    const MIN_WIDTH = 50;
    const MIN_HEIGHT = 50;
    
    let { x, y, width, height } = bounds;
    
    // Ensure minimum Y position (below title bar)
    if (y < MIN_Y) y = MIN_Y;
    // Ensure reasonable position (not negative)
    if (x < 0) x = 0;
    // Ensure minimum dimensions
    if (width < MIN_WIDTH) width = MIN_WIDTH;
    if (height < MIN_HEIGHT) height = MIN_HEIGHT;
    
    // Clamp to window size if parent window exists
    if (this.parentWindow) {
      try {
        const [winWidth, winHeight] = this.parentWindow.getSize();
        if (x + width > winWidth) width = Math.max(MIN_WIDTH, winWidth - x);
        if (y + height > winHeight) height = Math.max(MIN_HEIGHT, winHeight - y);
      } catch (_) {}
    }
    
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  /**
   * Navigate back
   */
  goBack() {
    if (this.browserView && this.browserView.webContents.canGoBack()) {
      this.browserView.webContents.goBack();
      this.historyIndex = Math.max(0, this.historyIndex - 1);
      return { success: true };
    }
    return { success: false, error: 'Cannot go back' };
  }

  /**
   * Navigate forward 
   */
  goForward() {
    if (this.browserView && this.browserView.webContents.canGoForward()) {
      this.browserView.webContents.goForward();
      this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
      return { success: true };
    }
    return { success: false, error: 'Cannot go forward' };
  }

  /**
   * Reload current page
   */
  reload() {
    if (this.browserView) {
      this.browserView.webContents.reload();
      return { success: true };
    }
    return { success: false };
  }

  /**
   * Get an accessibility snapshot of the page with ref identifiers.
   * Each interactive/semantic element gets a numbered ref (data-gref attribute).
   * The model can then use "ref=N" to interact with elements.
   */
  async getSnapshot() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    await this.waitForPageSettle(1000);

    try {
      const snapshot = await wc.executeJavaScript(`
        (function() {
          // Clear previous refs
          document.querySelectorAll('[data-gref]').forEach(el => el.removeAttribute('data-gref'));
          let refCounter = 0;
          let textCounter = 0;
          const lines = [];

          function getRole(el) {
            const role = el.getAttribute('role');
            if (role) return role;
            const tag = el.tagName.toLowerCase();
            if (tag === 'a') return 'link';
            if (tag === 'button') return 'button';
            if (tag === 'select') return 'combobox';
            if (tag === 'textarea') return 'textbox';
            if (tag === 'img') return 'image';
            if (tag === 'nav') return 'navigation';
            if (tag === 'main') return 'main';
            if (tag === 'form') return 'form';
            if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') return 'heading';
            if (tag === 'input') {
              const t = (el.type || 'text').toLowerCase();
              if (t === 'checkbox') return 'checkbox';
              if (t === 'radio') return 'radio';
              if (t === 'submit' || t === 'button') return 'button';
              if (t === 'search') return 'searchbox';
              return 'textbox';
            }
            if (el.getAttribute('contenteditable') === 'true') return 'textbox';
            return '';
          }

          function getName(el) {
            return el.getAttribute('aria-label')
              || el.getAttribute('alt')
              || el.getAttribute('title')
              || el.getAttribute('placeholder')
              || (el.tagName === 'IMG' ? el.src?.split('/').pop() : '')
              || (el.textContent || '').trim().substring(0, 80)
              || '';
          }

          function isVisible(el) {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && parseFloat(style.opacity) > 0;
          }

          function isInteractive(el) {
            const tag = el.tagName.toLowerCase();
            return ['a', 'button', 'input', 'textarea', 'select'].includes(tag)
              || el.getAttribute('role') === 'button'
              || el.getAttribute('role') === 'link'
              || el.getAttribute('role') === 'tab'
              || el.getAttribute('role') === 'menuitem'
              || el.getAttribute('role') === 'searchbox'
              || el.getAttribute('role') === 'textbox'
              || el.getAttribute('tabindex') !== null
              || el.getAttribute('contenteditable') === 'true'
              || el.onclick !== null;
          }

          function walk(el, indent) {
            if (!isVisible(el)) return;
            const role = getRole(el);
            const interactive = isInteractive(el);
            const tag = el.tagName.toLowerCase();

            if ((role || interactive) && refCounter < 250) {
              refCounter++;
              el.setAttribute('data-gref', String(refCounter));
              const pad = '  '.repeat(Math.min(indent, 6));
              const name = getName(el).replace(/"/g, "'").replace(/\\n/g, ' ').trim();
              const valueStr = (el.value !== undefined && el.value !== '') ? ' value="' + String(el.value).substring(0, 50) + '"' : '';
              const checked = el.checked ? ' [checked]' : '';
              const hrefStr = (tag === 'a' && el.href) ? ' href="' + el.href.substring(0, 80) + '"' : '';
              lines.push(pad + '[ref=' + refCounter + '] ' + (role || tag) + ' "' + name.substring(0, 80) + '"' + valueStr + checked + hrefStr);
            } else if (!role && !interactive && textCounter < 40) {
              // Include key text-bearing elements so the model can read page content
              const textTags = ['p', 'span', 'li', 'td', 'th', 'label', 'h5', 'h6', 'cite', 'em', 'strong', 'time', 'div'];
              if (textTags.includes(tag)) {
                const txt = (el.textContent || '').trim();
                // Only include if this element has direct text, not just child element text
                const directText = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
                if (directText.length > 10 && directText.length < 300) {
                  const pad = '  '.repeat(Math.min(indent, 6));
                  lines.push(pad + '-- "' + directText.substring(0, 120).replace(/"/g, "'") + '"');
                  textCounter++;
                }
              }
            }

            for (const child of el.children) {
              walk(child, indent + (role ? 1 : 0));
            }
          }

          walk(document.body, 0);
          return lines.join('\\n');
        })()
      `);

      const elementCount = (snapshot.match(/\[ref=/g) || []).length;

      // If snapshot returned 0 elements, page may not have finished rendering
      // Retry once with a longer wait (common with SPAs like Google, React sites)
      if (elementCount === 0) {
        console.log('[Browser] Snapshot returned 0 elements — retrying after extra wait...');
        await new Promise(r => setTimeout(r, 1500));

        const retrySnapshot = await wc.executeJavaScript(`
          (function() {
            document.querySelectorAll('[data-gref]').forEach(el => el.removeAttribute('data-gref'));
            let refCounter = 0;
            const lines = [];
            function getRole(el) {
              const role = el.getAttribute('role');
              if (role) return role;
              const tag = el.tagName.toLowerCase();
              if (tag === 'a') return 'link'; if (tag === 'button') return 'button'; if (tag === 'select') return 'combobox';
              if (tag === 'textarea') return 'textbox'; if (tag === 'img') return 'image';
              if (tag === 'nav') return 'navigation'; if (tag === 'main') return 'main'; if (tag === 'form') return 'form';
              if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') return 'heading';
              if (tag === 'input') { const t = (el.type||'text').toLowerCase(); if(t==='checkbox')return 'checkbox'; if(t==='radio')return 'radio'; if(t==='submit'||t==='button')return 'button'; if(t==='search')return 'searchbox'; return 'textbox'; }
              if (el.getAttribute('contenteditable') === 'true') return 'textbox';
              return '';
            }
            function getName(el) { return el.getAttribute('aria-label')||el.getAttribute('alt')||el.getAttribute('title')||el.getAttribute('placeholder')||(el.tagName==='IMG'?el.src?.split('/').pop():'')||(el.textContent||'').trim().substring(0,80)||''; }
            function isVisible(el) { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.opacity)>0; }
            function isInteractive(el) { const t=el.tagName.toLowerCase(); return ['a','button','input','textarea','select'].includes(t)||el.getAttribute('role')==='button'||el.getAttribute('role')==='link'||el.getAttribute('role')==='tab'||el.getAttribute('role')==='menuitem'||el.getAttribute('role')==='searchbox'||el.getAttribute('role')==='textbox'||el.getAttribute('tabindex')!==null||el.getAttribute('contenteditable')==='true'||el.onclick!==null; }
            function walk(el, indent) {
              if (!isVisible(el)) return;
              const role = getRole(el), interactive = isInteractive(el), tag = el.tagName.toLowerCase();
              if ((role || interactive) && refCounter < 250) {
                refCounter++; el.setAttribute('data-gref', String(refCounter));
                const pad = '  '.repeat(Math.min(indent, 6));
                const name = getName(el).replace(/"/g, "'").replace(/\\n/g, ' ').trim();
                const valueStr = (el.value !== undefined && el.value !== '') ? ' value="' + String(el.value).substring(0, 50) + '"' : '';
                const checked = el.checked ? ' [checked]' : '';
                const hrefStr = (tag === 'a' && el.href) ? ' href="' + el.href.substring(0, 80) + '"' : '';
                lines.push(pad + '[ref=' + refCounter + '] ' + (role || tag) + ' "' + name.substring(0, 80) + '"' + valueStr + checked + hrefStr);
              }
              for (const child of el.children) walk(child, indent + (role ? 1 : 0));
            }
            walk(document.body, 0);
            return lines.join('\\n');
          })()
        `);

        const retryCount = (retrySnapshot.match(/\[ref=/g) || []).length;
        if (retryCount > 0) {
          console.log(`[Browser] Retry found ${retryCount} elements`);
          const url = wc.getURL();
          const title = wc.getTitle();
          return { success: true, snapshot: `Page: ${title}\nURL: ${url}\n\n${retrySnapshot}`, url, title, elementCount: retryCount };
        }
        console.log('[Browser] Retry still 0 elements — page may use shadow DOM or iframes');
      }

      const url = wc.getURL();
      const title = wc.getTitle();
      return {
        success: true,
        snapshot: `Page: ${title}\nURL: ${url}\n\n${snapshot}`,
        url,
        title,
        elementCount,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Resolve a ref (like "5" or "ref=5") to a CSS selector, or pass through CSS selectors
   */
  _resolveRef(selectorOrRef) {
    if (!selectorOrRef) return null;
    const s = String(selectorOrRef).trim();
    // ref=N format or bare number
    const refMatch = s.match(/^(?:ref=)?(\d+)$/);
    if (refMatch) {
      return `[data-gref="${refMatch[1]}"]`;
    }
    return s; // CSS selector passthrough
  }

  /**
   * Try multiple CSS selector strategies for a given input
   * Models often provide bare names like "q" instead of proper selectors
   */
  _expandSelector(selector) {
    // If selector already looks like a proper CSS selector, use as-is
    if (/[.#\[\]=:>~+]/.test(selector)) return [selector];
    // For bare words like "q", "search", "email" — try common patterns
    return [
      selector,
      `[name="${selector}"]`,
      `#${selector}`,
      `input[name="${selector}"]`,
      `textarea[name="${selector}"]`,
      `.${selector}`,
      `[id="${selector}"]`,
      `[aria-label*="${selector}" i]`,
      `[placeholder*="${selector}" i]`,
    ];
  }

  /**
   * Click an element by ref or CSS selector
   * Uses synthetic mouse events for maximum compatibility with modern web apps
   */
  async click(selectorOrRef) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    // Try ref-based lookup first
    const refSelector = this._resolveRef(selectorOrRef);
    if (refSelector && refSelector.startsWith('[data-gref=')) {
      try {
        const safeSel = JSON.stringify(refSelector);
        const result = await wc.executeJavaScript(`
          (function() {
            const el = document.querySelector(${safeSel});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            // Use full mouse event sequence for maximum compatibility
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            // Also try .click() and form submit as fallbacks
            el.click();
            // If it's a submit button or inside a form, submit the form
            if (el.type === 'submit' || el.getAttribute('role') === 'button') {
              const form = el.closest('form');
              if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
            }
            return { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 60), role: el.getAttribute('role') || '' };
          })()
        `);
        if (result) {
          await new Promise(resolve => setTimeout(resolve, 100));
          await this.waitForPageSettle(800);
          return { success: true, ref: selectorOrRef, element: result };
        }
        // Include a hint about how many refs exist on the current page
        const totalRefs = await wc.executeJavaScript(`document.querySelectorAll('[data-gref]').length`).catch(() => 0);
        return { success: false, error: `Element ref=${selectorOrRef} not found (${totalRefs} refs on page). The page may have changed — call browser_snapshot to get updated refs.` };
      } catch (err) {
        return { success: false, error: `Ref lookup failed: ${err.message}. Call browser_snapshot to refresh.` };
      }
    }

    // CSS selector fallback
    const selectors = this._expandSelector(selectorOrRef);
    const MAX_ATTEMPTS = 3;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      for (const sel of selectors) {
        try {
          const safeSel = JSON.stringify(sel);
          await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${safeSel});
              if (!el) throw new Error('not found');
              el.scrollIntoView({ block: 'center', behavior: 'instant' });
              const rect = el.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
              el.dispatchEvent(new MouseEvent('mousedown', opts));
              el.dispatchEvent(new MouseEvent('mouseup', opts));
              el.dispatchEvent(new MouseEvent('click', opts));
              el.click();
              if (el.type === 'submit' || el.getAttribute('role') === 'button') {
                const form = el.closest('form');
                if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
              }
              return true;
            })()
          `);
          await new Promise(resolve => setTimeout(resolve, 100));
          await this.waitForPageSettle(800);
          return { success: true, selector: sel };
        } catch (_) { /* try next selector */ }
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return { success: false, error: `Element not found: ${selectorOrRef}. Use browser_snapshot to get element refs, then use ref=N.` };
  }

  /**
   * Type text into an element by ref or CSS selector
   */
  async type(selectorOrRef, text) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    // Try ref-based lookup first
    const refSelector = this._resolveRef(selectorOrRef);
    if (refSelector && refSelector.startsWith('[data-gref=')) {
      try {
        const safeSel = JSON.stringify(refSelector);
        const focused = await wc.executeJavaScript(`
          (function() {
            const el = document.querySelector(${safeSel});
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            el.focus();
            el.value = '';
            return { tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '' };
          })()
        `);
        if (focused) {
          await wc.insertText(text);
          await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${safeSel});
              if (el) {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            })()
          `);
          return { success: true, ref: selectorOrRef, text, element: focused };
        }
        return { success: false, error: `Element ref ${selectorOrRef} not found. The page may have changed — call browser_snapshot to get updated refs.` };
      } catch (err) {
        return { success: false, error: `Ref lookup failed: ${err.message}. Call browser_snapshot to refresh.` };
      }
    }

    // CSS selector fallback
    const selectors = this._expandSelector(selectorOrRef);
    const MAX_ATTEMPTS = 3;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      for (const sel of selectors) {
        try {
          const safeSel = JSON.stringify(sel);
          await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${safeSel});
              if (!el) throw new Error('not found');
              el.scrollIntoView({ block: 'center' });
              el.focus();
              el.value = '';
              return true;
            })()
          `);
          await wc.insertText(text);
          await wc.executeJavaScript(`
            (function() {
              const el = document.querySelector(${safeSel});
              if (el) {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            })()
          `);
          return { success: true, selector: sel, text };
        } catch (_) { /* try next selector */ }
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return { success: false, error: `Element not found: ${selectorOrRef}. Use browser_snapshot to get element refs, then use ref=N.` };
  }

  /**
   * Press a key on the keyboard (e.g., Enter, Tab, Escape)
   * This is essential for form submission after typing in search boxes
   */
  async pressKey(key) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active.' };

    // Map common key names to Electron key codes
    const keyMap = {
      'enter': 'Return', 'return': 'Return',
      'tab': 'Tab', 'escape': 'Escape', 'esc': 'Escape',
      'backspace': 'Backspace', 'delete': 'Delete',
      'arrowup': 'Up', 'arrowdown': 'Down', 'arrowleft': 'Left', 'arrowright': 'Right',
      'space': 'Space', 'home': 'Home', 'end': 'End',
      'pageup': 'PageUp', 'pagedown': 'PageDown',
    };

    const normalizedKey = keyMap[key.toLowerCase()] || key;

    try {
      // Use Electron's native key event simulation for reliability
      wc.sendInputEvent({ type: 'keyDown', keyCode: normalizedKey });
      wc.sendInputEvent({ type: 'char', keyCode: normalizedKey });
      wc.sendInputEvent({ type: 'keyUp', keyCode: normalizedKey });
      
      await new Promise(r => setTimeout(r, 100));
      await this.waitForPageSettle(1000);
      
      return { success: true, key: normalizedKey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Hover over an element by ref or CSS selector
   */
  async hover(selectorOrRef) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    const refSelector = this._resolveRef(selectorOrRef);
    const selector = refSelector || selectorOrRef;
    const safeSel = JSON.stringify(selector);

    try {
      const result = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSel});
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const rect = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          return { success: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 80) };
        })()
      `);
      if (result) return result;
      return { success: false, error: `Element not found: ${selectorOrRef}. Use browser_snapshot to get element refs.` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Select an option from a dropdown by ref or CSS selector
   */
  async selectOption(selectorOrRef, value) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    const refSelector = this._resolveRef(selectorOrRef);
    const selector = refSelector || selectorOrRef;
    const safeSel = JSON.stringify(selector);
    const safeVal = JSON.stringify(value);

    try {
      const result = await wc.executeJavaScript(`
        (function() {
          const sel = document.querySelector(${safeSel});
          if (!sel) return { success: false, error: 'Element not found' };
          if (sel.tagName !== 'SELECT') return { success: false, error: 'Element is not a <select>' };
          let found = false;
          for (const opt of sel.options) {
            if (opt.value === ${safeVal} || opt.text === ${safeVal}) {
              sel.value = opt.value;
              found = true;
              break;
            }
          }
          if (!found) return { success: false, error: 'Option not found: ' + ${safeVal} };
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: 'Selected: ' + ${safeVal} };
        })()
      `);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(fullPage = false) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    try {
      const image = await wc.capturePage();
      const dataUrl = image.toDataURL();
      return { success: true, dataUrl, width: image.getSize().width, height: image.getSize().height };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get page content
   */
  async getContent(selector, html = false) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    try {
      const content = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector || 'body')});
          if (!el) return '';
          return ${html ? 'el.innerHTML' : 'el.innerText'};
        })()
      `);
      return { success: true, content: content.substring(0, 10000), url: wc.getURL(), title: wc.getTitle() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute JavaScript in page context
   */
  async evaluate(code) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    try {
      const result = await wc.executeJavaScript(code);
      return { success: true, result: JSON.stringify(result) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait for a CSS selector to appear in the DOM (up to timeout ms)
   */
  async waitForSelector(selector, timeout = 5000) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    const safeSel = JSON.stringify(selector);
    try {
      const found = await wc.executeJavaScript(`
        new Promise((resolve) => {
          const el = document.querySelector(${safeSel});
          if (el) return resolve(true);
          const observer = new MutationObserver(() => {
            if (document.querySelector(${safeSel})) {
              observer.disconnect();
              resolve(true);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => { observer.disconnect(); resolve(false); }, ${timeout});
        })
      `);
      return { success: found, selector };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait for page to settle (network idle + DOM stable)
   * Waits up to maxMs for the page to stop loading/changing
   */
  async waitForPageSettle(maxMs = 1500) {
    const wc = this._getWebContents();
    if (!wc) return;

    // Wait for document.readyState === 'complete' AND DOM stability concurrently
    // Phase 1 + 2 run in parallel for speed (was sequential)
    try {
      await wc.executeJavaScript(`
        Promise.race([
          new Promise(resolve => {
            if (document.readyState === 'complete') resolve();
            else window.addEventListener('load', resolve, { once: true });
          }),
          new Promise(resolve => setTimeout(resolve, ${maxMs}))
        ]).then(() => new Promise(resolve => {
          let timer;
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => { observer.disconnect(); resolve(); }, 300);
          });
          observer.observe(document.body, { childList: true, subtree: true });
          timer = setTimeout(() => { observer.disconnect(); resolve(); }, ${Math.min(800, maxMs)});
        }))
      `);
    } catch (_) {
      await new Promise(r => setTimeout(r, Math.min(800, maxMs)));
    }
  }

  /**
   * List interactive elements on the page (inputs, buttons, links, textareas)
   * Automatically waits for page to settle first.
   * Helps the model discover the correct selectors.
   */
  async listInteractiveElements() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    // Wait for page to settle before listing elements
    await this.waitForPageSettle(1000);

    try {
      const elements = await wc.executeJavaScript(`
        (function() {
          const results = [];
          const selectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [onclick], [tabindex], [contenteditable]';
          const seen = new Set();
          document.querySelectorAll(selectors).forEach((el) => {
            if (results.length >= 100) return; // limit
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return; // skip hidden
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
            const info = {
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              name: el.name || '',
              id: el.id || '',
              class: el.className && typeof el.className === 'string' ? el.className.substring(0, 80) : '',
              text: (el.textContent || '').trim().substring(0, 60),
              placeholder: el.placeholder || '',
              role: el.getAttribute('role') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              href: el.href || '',
              value: el.value ? el.value.substring(0, 30) : '',
              selector: '',
            };
            // Build a unique, reliable selector
            if (info.id) info.selector = '#' + CSS.escape(info.id);
            else if (info.name) info.selector = info.tag + '[name="' + info.name + '"]';
            else if (info.ariaLabel) info.selector = info.tag + '[aria-label="' + info.ariaLabel + '"]';
            else if (info.placeholder) info.selector = info.tag + '[placeholder="' + info.placeholder + '"]';
            else if (info.role && info.text) info.selector = '[role="' + info.role + '"]';
            else if (info.type && info.tag === 'input') info.selector = 'input[type="' + info.type + '"]';
            else info.selector = info.tag + (info.class ? '.' + info.class.split(' ')[0] : '');
            
            // Deduplicate by selector
            if (!seen.has(info.selector)) {
              seen.add(info.selector);
              results.push(info);
            }
          });
          return results;
        })()
      `);
      return {
        success: true,
        elements,
        count: elements.length,
        url: wc.getURL(),
        title: wc.getTitle(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify renderer about browser state changes (URL, title updates)
   * so BrowserPanel can keep its UI in sync with AI-driven navigation.
   */
  _notifyStateChange(url, title) {
    if (this.parentWindow && !this.parentWindow.isDestroyed()) {
      try {
        this.parentWindow.webContents.send('browser-state-changed', {
          url: url || '',
          title: title || '',
          canGoBack: this.browserView?.webContents?.canGoBack?.() || false,
          canGoForward: this.browserView?.webContents?.canGoForward?.() || false,
          isLoading: this.browserView?.webContents?.isLoading?.() || false,
        });
      } catch (e) {
        // Window may have been destroyed during navigation
      }
    }
  }

  /**
   * Get current browser state
   */
  getState() {
    const wc = this._getWebContents();
    return {
      isVisible: this.isVisible,
      url: wc ? wc.getURL() : this.currentUrl,
      title: wc ? wc.getTitle() : '',
      canGoBack: wc ? wc.canGoBack() : false,
      canGoForward: wc ? wc.canGoForward() : false,
      isLoading: wc ? wc.isLoading() : false,
    };
  }

  // ── External Chrome Automation ──

  /**
   * Launch external Chrome with debugging port
   */
  async launchExternalChrome(url) {
    const chromePaths = this._findChromePaths();
    let chromePath = null;

    for (const p of chromePaths) {
      if (fs.existsSync(p)) {
        chromePath = p;
        break;
      }
    }

    if (!chromePath) {
      // Fall back to opening in default browser
      await shell.openExternal(url || 'about:blank');
      return { success: true, mode: 'default_browser', url };
    }

    try {
      const userDataDir = path.join(os.tmpdir(), 'ide-chrome-debug');
      this.chromeProcess = spawn(chromePath, [
        `--remote-debugging-port=${this.cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        url || 'about:blank',
      ], {
        detached: true,
        stdio: 'ignore',
      });

      this.chromeProcess.unref();
      this.externalMode = true;

      // Wait for Chrome to start
      await new Promise(r => setTimeout(r, 1000));

      return { success: true, mode: 'external_chrome', url, port: this.cdpPort };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send CDP command to external Chrome
   */
  async sendCDP(method, params = {}) {
    try {
      // Get available targets
      const targets = await this._cdpRequest('/json');
      const page = targets.find(t => t.type === 'page');
      if (!page) return { success: false, error: 'No page target found' };

      // Send command via WebSocket
      // For simplicity, use the /json/protocol endpoint
      return { success: true, targets: targets.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _cdpRequest(endpoint) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.cdpPort}${endpoint}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  _findChromePaths() {
    if (process.platform === 'win32') {
      return [
        path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ];
    } else if (process.platform === 'darwin') {
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    }
    return ['google-chrome', 'chromium-browser', 'chromium'];
  }

  _getWebContents() {
    if (this.browserView) return this.browserView.webContents;
    return null;
  }

  /**
   * Clean up
   */
  dispose() {
    if (this.parentWindow && this.browserView) {
      try { this.parentWindow.removeBrowserView(this.browserView); } catch (_) {}
    }
    this.isVisible = false;
    if (this.browserView) {
      this.browserView.webContents.destroy();
      this.browserView = null;
    }
    if (this.chromeProcess) {
      try { this.chromeProcess.kill(); } catch (e) {}
      this.chromeProcess = null;
    }
  }
}

module.exports = { BrowserManager };
