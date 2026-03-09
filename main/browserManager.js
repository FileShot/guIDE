/**
 * browserManager.js — Embedded Browser Manager
 *
 * Manages an embedded BrowserView inside the IDE window for AI-driven web browsing,
 * plus external Chrome automation via CDP (Chrome DevTools Protocol).
 *
 * Two modes:
 *  1. Viewport — embedded BrowserView in Electron
 *  2. External Chrome — launched with --remote-debugging-port
 *
 * IPC contract — sends 'browser-state-changed' to renderer with:
 *   { url, title, canGoBack, canGoForward, isLoading }
 */

'use strict';

const { BrowserView, BrowserWindow, shell } = require('electron');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

// ── Constants ──

const MIN_Y = 36;          // Title bar height — never place BrowserView above this
const MAX_REFS = 250;       // Maximum data-gref references in a snapshot
const MAX_TEXT_NODES = 40;  // Maximum text-only nodes in a snapshot
const SETTLE_DOM_MS = 300;  // DOM stability window for page settle
const CDP_PORT = 9222;      // Default Chrome DevTools Protocol port

// ── DOM Snapshot Script ──
// Injected into the page to build a text representation of interactive elements.
// Each interactive element gets a data-gref attribute for later targeting.
// This script is shared between initial snapshot and retry to avoid duplication.

const SNAPSHOT_SCRIPT = `
(function() {
  document.querySelectorAll('[data-gref]').forEach(el => el.removeAttribute('data-gref'));
  let refCounter = 0;
  let textCounter = 0;
  const lines = [];

  function getRole(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    const roleMap = {
      a: 'link', button: 'button', select: 'combobox', textarea: 'textbox',
      img: 'image', nav: 'navigation', main: 'main', form: 'form',
    };
    if (roleMap[tag]) return roleMap[tag];
    if (/^h[1-4]$/.test(tag)) return 'heading';
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
      || (el.tagName === 'IMG' ? (el.src || '').split('/').pop() : '')
      || (el.textContent || '').trim().substring(0, 80)
      || '';
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0
      && s.display !== 'none' && s.visibility !== 'hidden'
      && parseFloat(s.opacity) > 0;
  }

  function isInteractive(el) {
    const t = el.tagName.toLowerCase();
    return ['a','button','input','textarea','select'].includes(t)
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

    if ((role || interactive) && refCounter < ${MAX_REFS}) {
      refCounter++;
      el.setAttribute('data-gref', String(refCounter));
      const pad = '  '.repeat(Math.min(indent, 6));
      const name = getName(el).replace(/"/g, "'").replace(/\\\\n/g, ' ').trim();
      const valueStr = (el.value !== undefined && el.value !== '')
        ? ' value="' + String(el.value).substring(0, 50) + '"' : '';
      const checked = el.checked ? ' [checked]' : '';
      const hrefStr = (tag === 'a' && el.href)
        ? ' href="' + el.href.substring(0, 80) + '"' : '';
      lines.push(pad + '[ref=' + refCounter + '] ' + (role || tag)
        + ' "' + name.substring(0, 80) + '"' + valueStr + checked + hrefStr);
    } else if (!role && !interactive && textCounter < ${MAX_TEXT_NODES}) {
      const textTags = ['p','span','li','td','th','label','h5','h6','cite','em','strong','time','div'];
      if (textTags.includes(tag)) {
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join(' ').trim();
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
`;


class BrowserManager {
  constructor() {
    this.browserView = null;
    this.parentWindow = null;
    this.isVisible = false;
    this.currentUrl = '';
    this.history = [];
    this.historyIndex = -1;

    // External Chrome state
    this.chromeProcess = null;
    this.externalMode = false;
    this.cdpPort = CDP_PORT;

    // Resize handler reference for cleanup
    this._resizeHandler = null;
  }

  initialize(parentWindow) {
    this.parentWindow = parentWindow;
  }

  // ── Navigation ──

  async navigate(url, parentWindow) {
    if (!url) return { success: false, error: 'No URL provided' };

    // Normalize URL
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Validate URL
    try {
      new URL(normalizedUrl);
    } catch {
      return { success: false, error: `Invalid URL: ${url}` };
    }

    // Store parent window reference
    if (parentWindow) this.parentWindow = parentWindow;
    if (!this.parentWindow) {
      this.parentWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    }
    if (!this.parentWindow) return { success: false, error: 'No parent window available' };

    try {
      // Create BrowserView if needed
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
        this.parentWindow.addBrowserView(this.browserView);

        // Security: block new windows and restrict navigation
        this.browserView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        this.browserView.webContents.on('will-navigate', (event, navUrl) => {
          try {
            const parsed = new URL(navUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              event.preventDefault();
            }
          } catch {
            event.preventDefault();
          }
        });

        // Track navigation state changes
        const wc = this.browserView.webContents;
        wc.on('did-navigate', (_ev, navUrl) => {
          this.currentUrl = navUrl;
          this._notifyStateChange(navUrl, wc.getTitle());
        });
        wc.on('did-navigate-in-page', (_ev, navUrl) => {
          this.currentUrl = navUrl;
          this._notifyStateChange(navUrl, wc.getTitle());
        });
        wc.on('page-title-updated', (_ev, title) => {
          this._notifyStateChange(wc.getURL(), title);
        });
        wc.on('did-start-loading', () => this._notifyStateChange(wc.getURL(), wc.getTitle()));
        wc.on('did-stop-loading', () => this._notifyStateChange(wc.getURL(), wc.getTitle()));
      }

      // Load URL and wait for page to settle
      await this.browserView.webContents.loadURL(normalizedUrl);
      this.currentUrl = normalizedUrl;

      // Update history
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }
      this.history.push(normalizedUrl);
      this.historyIndex = this.history.length - 1;

      await this.waitForPageSettle(2000);

      const title = this.browserView.webContents.getTitle();
      this._notifyStateChange(normalizedUrl, title);

      return { success: true, url: normalizedUrl, title };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Visibility & Positioning ──

  show(bounds) {
    if (!this.browserView || !this.parentWindow) return;

    const validated = this._validateBounds(bounds);
    this.browserView.setBounds(validated);
    this.isVisible = true;

    // Attach resize handler
    if (!this._resizeHandler) {
      this._resizeHandler = () => {
        if (this.isVisible && this.browserView && this.parentWindow && !this.parentWindow.isDestroyed()) {
          const [w, h] = this.parentWindow.getContentSize();
          const newBounds = {
            x: validated.x,
            y: validated.y,
            width: Math.max(200, w - validated.x),
            height: Math.max(200, h - validated.y),
          };
          this.browserView.setBounds(newBounds);
        }
      };
      this.parentWindow.on('resize', this._resizeHandler);
    }
  }

  hide() {
    if (!this.browserView) return;
    // Move offscreen rather than removing — preserves page state
    this.browserView.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
    this.isVisible = false;

    // Remove resize handler
    if (this._resizeHandler && this.parentWindow && !this.parentWindow.isDestroyed()) {
      this.parentWindow.removeListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
  }

  setBounds(bounds) {
    if (!this.browserView) return;
    const validated = this._validateBounds(bounds);
    const current = this.browserView.getBounds();
    // Only update if bounds actually changed
    if (current.x !== validated.x || current.y !== validated.y
        || current.width !== validated.width || current.height !== validated.height) {
      this.browserView.setBounds(validated);
    }
  }

  _validateBounds(bounds) {
    if (!bounds || !this.parentWindow) {
      return { x: 0, y: MIN_Y, width: 800, height: 600 };
    }
    const [winW, winH] = this.parentWindow.getContentSize();
    return {
      x: Math.max(0, Math.min(bounds.x || 0, winW - 100)),
      y: Math.max(MIN_Y, Math.min(bounds.y || MIN_Y, winH - 100)),
      width: Math.max(200, Math.min(bounds.width || 800, winW)),
      height: Math.max(200, Math.min(bounds.height || 600, winH - MIN_Y)),
    };
  }

  // ── Basic Navigation ──

  async goBack() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser active' };
    if (wc.canGoBack()) {
      wc.goBack();
      await this.waitForPageSettle(1500);
      this._notifyStateChange(wc.getURL(), wc.getTitle());
      return { success: true, url: wc.getURL() };
    }
    return { success: false, error: 'Cannot go back — no history' };
  }

  async goForward() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser active' };
    if (wc.canGoForward()) {
      wc.goForward();
      await this.waitForPageSettle(1500);
      this._notifyStateChange(wc.getURL(), wc.getTitle());
      return { success: true, url: wc.getURL() };
    }
    return { success: false, error: 'Cannot go forward — at newest page' };
  }

  async reload() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser active' };
    wc.reload();
    await this.waitForPageSettle(2000);
    return { success: true, url: wc.getURL() };
  }

  // ── DOM Snapshot ──

  async getSnapshot() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    try {
      const snapshot = await wc.executeJavaScript(SNAPSHOT_SCRIPT);
      const elementCount = (snapshot.match(/\[ref=/g) || []).length;

      // SPA retry — if zero elements found, page may still be rendering
      if (elementCount === 0) {
        console.log('[Browser] Snapshot returned 0 elements — retrying after extra wait...');
        await new Promise(r => setTimeout(r, 1500));
        const retrySnapshot = await wc.executeJavaScript(SNAPSHOT_SCRIPT);
        const retryCount = (retrySnapshot.match(/\[ref=/g) || []).length;
        if (retryCount > 0) {
          console.log(`[Browser] Retry found ${retryCount} elements`);
          return this._buildSnapshotResult(wc, retrySnapshot, retryCount);
        }
        console.log('[Browser] Retry still 0 elements — page may use shadow DOM or iframes');
      }

      return this._buildSnapshotResult(wc, snapshot, elementCount);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _buildSnapshotResult(wc, snapshot, elementCount) {
    const url = wc.getURL();
    const title = wc.getTitle();
    return {
      success: true,
      snapshot: `Page: ${title}\nURL: ${url}\n\n${snapshot}`,
      url,
      title,
      elementCount,
    };
  }

  // ── Element Reference Resolution ──

  _resolveRef(selectorOrRef) {
    if (!selectorOrRef) return null;
    const s = String(selectorOrRef).trim();
    const refMatch = s.match(/^(?:ref=)?(\d+)$/);
    if (refMatch) return `[data-gref="${refMatch[1]}"]`;
    return s;
  }

  _expandSelector(selector) {
    // If it's already a proper CSS selector, use as-is
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

  // ── Click ──

  async click(selectorOrRef) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    const refSelector = this._resolveRef(selectorOrRef);

    // Try ref-based lookup first
    if (refSelector && refSelector.startsWith('[data-gref=')) {
      const result = await this._clickBySelector(wc, refSelector);
      if (result) return result;

      // Ref not found — hint about current page state
      const totalRefs = await wc.executeJavaScript(
        `document.querySelectorAll('[data-gref]').length`
      ).catch(() => 0);
      return {
        success: false,
        error: `Element ref=${selectorOrRef} not found (${totalRefs} refs on page). The page may have changed — call browser_snapshot to get updated refs.`,
      };
    }

    // CSS selector fallback with retry
    const selectors = this._expandSelector(selectorOrRef);
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const sel of selectors) {
        const result = await this._clickBySelector(wc, sel);
        if (result) return result;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }

    return {
      success: false,
      error: `Element not found: ${selectorOrRef}. Use browser_snapshot to get element refs, then use ref=N.`,
    };
  }

  async _clickBySelector(wc, selector) {
    try {
      const safeSel = JSON.stringify(selector);
      const result = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSel});
          if (!el) return null;
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
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 60),
            role: el.getAttribute('role') || '',
          };
        })()
      `);
      if (!result) return null;
      await new Promise(r => setTimeout(r, 100));
      await this.waitForPageSettle(800);
      return { success: true, selector, element: result };
    } catch {
      return null;
    }
  }

  // ── Type ──

  async type(selectorOrRef, text) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    const refSelector = this._resolveRef(selectorOrRef);

    // Try ref-based lookup first
    if (refSelector && refSelector.startsWith('[data-gref=')) {
      const result = await this._typeIntoSelector(wc, refSelector, text);
      if (result) return result;
      return {
        success: false,
        error: `Element ref ${selectorOrRef} not found. The page may have changed — call browser_snapshot to get updated refs.`,
      };
    }

    // CSS selector fallback with retry
    const selectors = this._expandSelector(selectorOrRef);
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const sel of selectors) {
        const result = await this._typeIntoSelector(wc, sel, text);
        if (result) return result;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 500));
    }

    return {
      success: false,
      error: `Element not found: ${selectorOrRef}. Use browser_snapshot to get element refs, then use ref=N.`,
    };
  }

  async _typeIntoSelector(wc, selector, text) {
    try {
      const safeSel = JSON.stringify(selector);
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
      if (!focused) return null;

      await wc.insertText(text);

      // Fire input/change events for framework compatibility
      await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSel});
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);

      return { success: true, selector, text, element: focused };
    } catch {
      return null;
    }
  }

  // ── Press Key ──

  async pressKey(key) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active.' };

    const keyMap = {
      enter: 'Return', return: 'Return',
      tab: 'Tab', escape: 'Escape', esc: 'Escape',
      backspace: 'Backspace', delete: 'Delete',
      arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
      space: 'Space', home: 'Home', end: 'End',
      pageup: 'PageUp', pagedown: 'PageDown',
    };

    const normalizedKey = keyMap[key.toLowerCase()] || key;

    try {
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

  // ── Hover ──

  async hover(selectorOrRef) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    const selector = this._resolveRef(selectorOrRef) || selectorOrRef;
    const safeSel = JSON.stringify(selector);

    try {
      const result = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSel});
          if (!el) return null;
          el.scrollIntoView({ block: 'center' });
          const rect = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('mouseover', {
            bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2
          }));
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

  // ── Select Option ──

  async selectOption(selectorOrRef, value) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active. Use browser_navigate first.' };

    const selector = this._resolveRef(selectorOrRef) || selectorOrRef;
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

  // ── Screenshot ──

  async screenshot() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    try {
      const image = await wc.capturePage();
      const dataUrl = image.toDataURL();
      return {
        success: true,
        dataUrl,
        width: image.getSize().width,
        height: image.getSize().height,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Content & Evaluate ──

  async getContent(selector, html = false) {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    try {
      const safeSel = JSON.stringify(selector || 'body');
      const content = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSel});
          if (!el) return '';
          return ${html ? 'el.innerHTML' : 'el.innerText'};
        })()
      `);
      return {
        success: true,
        content: content.substring(0, 10000),
        url: wc.getURL(),
        title: wc.getTitle(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

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

  // ── Waiting ──

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

  async waitForPageSettle(maxMs = 1500) {
    const wc = this._getWebContents();
    if (!wc) return;

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
            timer = setTimeout(() => { observer.disconnect(); resolve(); }, ${SETTLE_DOM_MS});
          });
          observer.observe(document.body, { childList: true, subtree: true });
          timer = setTimeout(() => { observer.disconnect(); resolve(); }, ${Math.min(800, maxMs)});
        }))
      `);
    } catch {
      await new Promise(r => setTimeout(r, Math.min(800, maxMs)));
    }
  }

  // ── Interactive Element Listing ──

  async listInteractiveElements() {
    const wc = this._getWebContents();
    if (!wc) return { success: false, error: 'No browser page active' };

    await this.waitForPageSettle(1000);

    try {
      const elements = await wc.executeJavaScript(`
        (function() {
          const results = [];
          const selectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [onclick], [tabindex], [contenteditable]';
          const seen = new Set();
          document.querySelectorAll(selectors).forEach((el) => {
            if (results.length >= 100) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
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
            if (info.id) info.selector = '#' + CSS.escape(info.id);
            else if (info.name) info.selector = info.tag + '[name="' + info.name + '"]';
            else if (info.ariaLabel) info.selector = info.tag + '[aria-label="' + info.ariaLabel + '"]';
            else if (info.placeholder) info.selector = info.tag + '[placeholder="' + info.placeholder + '"]';
            else if (info.role && info.text) info.selector = '[role="' + info.role + '"]';
            else if (info.type && info.tag === 'input') info.selector = 'input[type="' + info.type + '"]';
            else info.selector = info.tag + (info.class ? '.' + info.class.split(' ')[0] : '');
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

  // ── State ──

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
      } catch {
        // Window may have been destroyed during navigation
      }
    }
  }

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

      await new Promise(r => setTimeout(r, 1000));
      return { success: true, mode: 'external_chrome', url, port: this.cdpPort };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendCDP(method, params = {}) {
    try {
      const targets = await this._cdpRequest('/json');
      const page = targets.find(t => t.type === 'page');
      if (!page) return { success: false, error: 'No page target found' };
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
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
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
    }
    if (process.platform === 'darwin') {
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    }
    return ['google-chrome', 'chromium-browser', 'chromium'];
  }

  _getWebContents() {
    return this.browserView ? this.browserView.webContents : null;
  }

  // ── Cleanup ──

  dispose() {
    if (this.parentWindow && this.browserView) {
      try { this.parentWindow.removeBrowserView(this.browserView); } catch {}
    }
    if (this._resizeHandler && this.parentWindow && !this.parentWindow.isDestroyed()) {
      this.parentWindow.removeListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    this.isVisible = false;
    if (this.browserView) {
      this.browserView.webContents.destroy();
      this.browserView = null;
    }
    if (this.chromeProcess) {
      try { this.chromeProcess.kill(); } catch {}
      this.chromeProcess = null;
    }
  }
}

module.exports = { BrowserManager };
