/**
 * playwrightBrowser.js — Playwright-Based Browser Automation
 *
 * Uses playwright-core to control external Chromium/Chrome for AI-driven
 * web browsing with real accessibility tree snapshots, reliable interaction
 * via Playwright's native event dispatching, multi-tab support, and dialog handling.
 *
 * Three snapshot strategies (tried in order):
 *  1. DOM walk — injects data-gref attributes for ref-based element targeting
 *  2. Accessibility tree API — Playwright's built-in a11y tree
 *  3. ariaSnapshot — Playwright YAML output, post-processed with ref injection
 *
 * IPC contract — sends 'browser-state-changed' to renderer with:
 *   { url, title, canGoBack, canGoForward, isLoading }
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Lazy-load playwright-core (~2MB JS) — only parsed when browser automation is used
let _chromium = null;
function getChromium() {
  if (!_chromium) _chromium = require('playwright-core').chromium;
  return _chromium;
}

// ── Constants ──

const SNAPSHOT_CACHE_TTL = 1500;  // ms before snapshot cache expires
const MAX_REFS = 800;             // max data-gref references in DOM walk
const MAX_TEXT_NODES = 200;       // max text-only nodes in DOM walk
const MAX_CHILD_FRAMES = 3;      // max iframe frames to walk
const CONSOLE_LOG_CAP = 500;     // max stored console messages
const SNAPSHOT_BUDGET = 8000;     // character budget for enriched snapshot

// Ad/tracking domains to skip during iframe traversal
const SKIP_DOMAINS = /doubleclick|googlesyndication|googleadservices|facebook\.com\/tr|analytics|adsystem|adserver|tracking|pixel|beacon/i;

// Interactive roles for ref assignment
const INTERACTIVE_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox',
  'checkbox', 'radio', 'slider', 'spinbutton', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'switch', 'option', 'treeitem',
]);

// Structural roles that get refs when they have names
const STRUCTURAL_ROLES = new Set([
  'heading', 'img', 'image', 'navigation', 'main', 'form',
  'complementary', 'banner', 'contentinfo', 'region',
]);


class PlaywrightBrowser {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isLaunched = false;
    this.headless = false;
    this.consoleLog = [];
    this._pendingDialog = null;
    this._pageSnapshotCache = null;
    this._snapshotCacheTime = 0;
    this.parentWindow = null;
  }

  initialize(parentWindow) {
    this.parentWindow = parentWindow;
  }

  // ── Launch / Close ──

  async launch(options = {}) {
    if (this.isLaunched && this.browser?.isConnected()) {
      return { success: true, message: 'Browser already running' };
    }

    await this._cleanup();

    const headless = options.headless ?? this.headless;
    const executablePath = options.executablePath || this._findChromium();

    const launchOptions = {
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--disable-extensions',
        '--disable-popup-blocking',
        '--disable-translate',
        '--disable-background-networking',
        '--metrics-recording-only',
        '--no-sandbox',
      ],
    };
    if (executablePath) launchOptions.executablePath = executablePath;

    const contextOptions = {
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      bypassCSP: false,
      acceptDownloads: true,
    };

    try {
      this.browser = await getChromium().launch(launchOptions);
      this.context = await this.browser.newContext(contextOptions);
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
      this._setupPageListeners(this.page);
      this.context.on('page', (p) => this._setupPageListeners(p));
      this.isLaunched = true;
      console.log('[PlaywrightBrowser] Launched', executablePath ? `using ${path.basename(executablePath)}` : 'using bundled browser');
      return { success: true, message: 'Browser launched', headless, executablePath: executablePath || 'bundled' };
    } catch (error) {
      // Fallback: try without custom executable
      if (executablePath) {
        try {
          delete launchOptions.executablePath;
          this.browser = await getChromium().launch(launchOptions);
          this.context = await this.browser.newContext(contextOptions);
          const pages = this.context.pages();
          this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
          this._setupPageListeners(this.page);
          this.context.on('page', (p) => this._setupPageListeners(p));
          this.isLaunched = true;
          console.log('[PlaywrightBrowser] Launched with bundled browser (fallback)');
          return { success: true, message: 'Browser launched (bundled fallback)', headless };
        } catch (fallbackErr) {
          return { success: false, error: `Launch failed: ${error.message}. Fallback: ${fallbackErr.message}. Run "npx playwright install chromium".` };
        }
      }
      return { success: false, error: `Launch failed: ${error.message}. Try "npx playwright install chromium".` };
    }
  }

  async close() {
    await this._cleanup();
    return { success: true, message: 'Browser closed' };
  }

  async _cleanup() {
    this._pageSnapshotCache = null;
    this.consoleLog = [];
    this._pendingDialog = null;
    try { if (this.context) await this.context.close().catch(() => {}); } catch {}
    try { if (this.browser) await this.browser.close().catch(() => {}); } catch {}
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isLaunched = false;
  }

  // ── Page Listeners ──

  _setupPageListeners(page) {
    page.on('console', (msg) => {
      this.consoleLog.push({
        type: msg.type(),
        text: msg.text().substring(0, 500),
        timestamp: new Date().toISOString(),
      });
      if (this.consoleLog.length > CONSOLE_LOG_CAP) {
        this.consoleLog.splice(0, 100);
      }
    });

    page.on('dialog', async (dialog) => {
      this._pendingDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        dialog,
      };
      console.log(`[PlaywrightBrowser] Dialog: ${dialog.type()} — "${dialog.message()}"`);
      // Auto-dismiss after 3s if not handled
      setTimeout(async () => {
        if (this._pendingDialog?.dialog === dialog) {
          try { await dialog.accept(); } catch {}
          this._pendingDialog = null;
        }
      }, 3000);
    });

    page.on('crash', () => console.error('[PlaywrightBrowser] Page crashed'));

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this._invalidateSnapshot();
        this._notifyStateChange(page);
      }
    });
  }

  _invalidateSnapshot() {
    this._pageSnapshotCache = null;
    this._snapshotCacheTime = 0;
  }

  _notifyStateChange(page) {
    if (this.parentWindow && !this.parentWindow.isDestroyed()) {
      try {
        this.parentWindow.webContents.send('browser-state-changed', {
          url: page.url() || '',
          title: '',
          canGoBack: true,
          canGoForward: true,
          isLoading: false,
        });
      } catch {}
    }
  }

  // ── Page Stability ──

  async _waitForPageStable(page, timeout = 1500) {
    try {
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.evaluate((timeoutMs) => {
        return new Promise((resolve) => {
          let timer = null;
          const deadline = setTimeout(resolve, timeoutMs);
          const observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              clearTimeout(deadline);
              resolve();
            }, 150);
          });
          observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true, attributes: true,
          });
          timer = setTimeout(() => {
            observer.disconnect();
            clearTimeout(deadline);
            resolve();
          }, 150);
        });
      }, Math.max(timeout - 200, 500)).catch(() => {});
    } catch {
      await page.waitForTimeout(500).catch(() => {});
    }
  }

  // ── Auto-Dismiss Helpers ──

  async _dismissCookieBanners(page) {
    try {
      const dismissed = await page.evaluate(() => {
        const selectors = [
          'button[id*="accept" i]', 'button[class*="accept" i]',
          'a[id*="accept" i]', '[data-testid*="accept" i]',
          '#onetrust-accept-btn-handler',
          '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
          '.CybotCookiebotDialogBodyButton[id*="Allow"]',
          'button[aria-label*="Accept" i]', 'button[aria-label*="Agree" i]',
          'button[aria-label*="consent" i]',
          '[class*="cookie" i] button:first-of-type',
          '[id*="cookie" i] button:first-of-type',
          '[class*="consent" i] button:first-of-type',
          '[class*="gdpr" i] button:first-of-type',
          '.iubenda-cs-accept-btn',
          'button',
        ];
        for (const sel of selectors) {
          try {
            const elements = document.querySelectorAll(sel);
            for (const el of elements) {
              const text = (el.textContent || '').toLowerCase().trim();
              const isAccept = /^(accept|agree|ok|got it|allow|i agree|accept all|allow all|accept cookies|i understand)$/i.test(text)
                || (text.length < 30 && /accept|agree|allow|consent/i.test(text));
              if (isAccept && el.offsetParent !== null) {
                el.click();
                return true;
              }
            }
          } catch {}
        }
        return false;
      });
      if (dismissed) {
        console.log('[PlaywrightBrowser] Auto-dismissed cookie consent');
        await page.waitForTimeout(300);
      }
    } catch {}
  }

  async _dismissOverlayPopups(page) {
    try {
      const dismissed = await page.evaluate(() => {
        let found = false;
        const overlaySelectors = [
          '[class*="modal" i]', '[class*="overlay" i]', '[class*="popup" i]',
          '[class*="dialog" i]', '[class*="banner" i]', '[class*="notification" i]',
          '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
        ];
        for (const containerSel of overlaySelectors) {
          try {
            const containers = document.querySelectorAll(containerSel);
            for (const container of containers) {
              const style = window.getComputedStyle(container);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
              const buttons = container.querySelectorAll('button, a, [role="button"], .close, [class*="close" i], [class*="dismiss" i]');
              for (const btn of buttons) {
                const text = (btn.textContent || '').trim().toLowerCase();
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                const isClose = /^(close|dismiss|ok|got it|continue|x|×|✕|✖)$/i.test(text)
                  || text.length <= 3
                  || /close|dismiss/i.test(ariaLabel)
                  || btn.classList.contains('close')
                  || btn.getAttribute('data-dismiss');
                if (isClose && btn.offsetParent !== null) {
                  btn.click();
                  found = true;
                  break;
                }
              }
              if (found) break;
            }
          } catch {}
          if (found) break;
        }

        // Fallback: remove high-z-index overlays with browser-warning text
        if (!found) {
          for (const el of document.querySelectorAll('div, section, aside')) {
            const style = window.getComputedStyle(el);
            if ((style.position === 'fixed' || style.position === 'absolute') && style.zIndex > 999) {
              const rect = el.getBoundingClientRect();
              if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3) {
                if (/not supported|update.*browser|upgrade.*browser|outdated|incompatible/i.test(el.textContent || '')) {
                  el.remove();
                  found = true;
                  break;
                }
              }
            }
          }
        }
        return found;
      });
      if (dismissed) {
        console.log('[PlaywrightBrowser] Auto-dismissed overlay popup');
        await page.waitForTimeout(300);
        this._invalidateSnapshot();
      }
    } catch {}
  }

  // ── Ensure Browser Ready ──

  async _ensureBrowser() {
    if (!this.isLaunched || !this.browser?.isConnected()) {
      const result = await this.launch();
      if (!result.success) throw new Error(result.error || 'Failed to launch browser');
    }
    if (!this.page || this.page.isClosed()) {
      const pages = this.context?.pages() || [];
      this.page = pages.find(p => !p.isClosed()) || await this.context?.newPage();
      if (this.page) this._setupPageListeners(this.page);
    }
    return this.page;
  }

  // ── Navigation ──

  async navigate(url) {
    if (!url) return { success: false, error: 'URL is required' };
    if (!/^https?:\/\//i.test(url) && !url.startsWith('about:')) url = 'https://' + url;

    try {
      const page = await this._ensureBrowser();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this._waitForPageStable(page);

      const title = await page.title();
      const actualUrl = page.url();
      this._invalidateSnapshot();

      await this._dismissCookieBanners(page);
      await this._dismissOverlayPopups(page);

      // Extract page text inline for immediate model access
      let pageText = '';
      try {
        pageText = await page.evaluate(() => {
          const walk = (node) => {
            if (node.nodeType === 3) return node.textContent.trim();
            if (node.nodeType !== 1) return '';
            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) return '';
            let t = '';
            for (const child of node.childNodes) t += walk(child) + ' ';
            return t.trim();
          };
          return walk(document.body || document.documentElement);
        });
        pageText = pageText.replace(/\s+/g, ' ').substring(0, 2000);
      } catch {}

      this._notifyStateChange(page);

      return { success: true, url: actualUrl, title, pageText, message: `Navigated to ${actualUrl}` };
    } catch (error) {
      return { success: false, error: `Navigation failed: ${error.message}` };
    }
  }

  async goBack() {
    try {
      const page = await this._ensureBrowser();
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
      this._invalidateSnapshot();
      return { success: true, url: page.url() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async goForward() {
    try {
      const page = await this._ensureBrowser();
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
      this._invalidateSnapshot();
      return { success: true, url: page.url() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async reload() {
    try {
      const page = await this._ensureBrowser();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      this._invalidateSnapshot();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Snapshot ──

  async getSnapshot() {
    try {
      const page = await this._ensureBrowser();
      const url = page.url();
      const title = await page.title();

      // Return cached snapshot if still fresh
      if (this._pageSnapshotCache && (Date.now() - this._snapshotCacheTime) < SNAPSHOT_CACHE_TTL) {
        return this._pageSnapshotCache;
      }

      let snapshotText = '';
      let elementCount = 0;

      // Strategy 1: DOM walk (most reliable — sets data-gref for locator matching)
      try {
        snapshotText = await this._getDomWalkSnapshot(page);
        elementCount = (snapshotText.match(/\[ref=/g) || []).length;
      } catch (err) {
        console.log('[PlaywrightBrowser] DOM walk failed:', err.message);
      }

      // Strategy 2: Accessibility tree API fallback
      if (elementCount < 3 || !snapshotText || snapshotText.trim().length < 20) {
        console.log('[PlaywrightBrowser] DOM walk insufficient, trying accessibility tree');
        try {
          const accSnapshot = await this._getAccessibilityTreeSnapshot(page);
          const accCount = (accSnapshot.match(/\[ref=/g) || []).length;
          if (accCount > elementCount) {
            snapshotText = accSnapshot;
            elementCount = accCount;
          }
        } catch (err) {
          console.log('[PlaywrightBrowser] Accessibility tree failed:', err.message);
        }
      }

      // Strategy 3: ariaSnapshot with post-processed ref injection
      if (elementCount < 3 || !snapshotText || snapshotText.trim().length < 20) {
        console.log('[PlaywrightBrowser] Falling back to ariaSnapshot');
        try {
          const ariaRaw = await page.locator('body').ariaSnapshot({ timeout: 5000 });
          const { text: ariaWithRefs, count } = this._injectRefsIntoAriaSnapshot(ariaRaw);
          if (count > elementCount) {
            snapshotText = ariaWithRefs;
            elementCount = count;
          }
        } catch (err) {
          console.log('[PlaywrightBrowser] ariaSnapshot failed:', err.message);
        }
      }

      if (!snapshotText || snapshotText.trim().length < 10) {
        snapshotText = '(Page appears empty or inaccessible)';
      }

      // Enrich snapshot with supplementary sections
      const enriched = await this._enrichSnapshot(page, url, title, snapshotText);
      elementCount = (enriched.match(/\[ref=/g) || []).length;

      const result = { success: true, snapshot: enriched, url, title, elementCount };
      this._pageSnapshotCache = result;
      this._snapshotCacheTime = Date.now();
      return result;
    } catch (error) {
      return { success: false, error: `Snapshot failed: ${error.message}` };
    }
  }

  async _enrichSnapshot(page, url, title, snapshotText) {
    const header = `Page: ${title}\nURL: ${url}\n`;
    let links = '', buttons = '', viewportText = '', iframes = '';

    // Extract visible links
    try {
      const linkData = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .filter(a => {
            const r = a.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && (a.textContent.trim().length > 0 || a.title);
          })
          .slice(0, 30)
          .map(a => {
            const text = a.textContent.trim().substring(0, 60) || a.title || '(no text)';
            return `${text} → ${a.href}`;
          }).join('\n');
      });
      if (linkData && linkData.length > 20) links = '\n[Visible Links]\n' + linkData.substring(0, 2000) + '\n';
    } catch {}

    // Extract key buttons
    try {
      const allFrames = [page, ...page.frames().slice(1, 6)];
      let allBtns = [];
      for (const frame of allFrames) {
        try {
          const frameBtns = await frame.evaluate(() => {
            return Array.from(document.querySelectorAll('button, [role="button"], select, [role="combobox"]'))
              .filter(b => {
                const r = b.getBoundingClientRect();
                const label = (b.textContent || '').trim() || b.getAttribute('aria-label') || '';
                return r.width > 0 && r.height > 0 && label.length > 2 && label.length < 80;
              })
              .slice(0, 15)
              .map(b => ((b.textContent || '').trim() || b.getAttribute('aria-label') || '').substring(0, 60));
          });
          if (frameBtns) allBtns.push(...frameBtns);
        } catch {}
      }
      const btnText = allBtns.slice(0, 25).join('\n');
      if (btnText.length > 10) buttons = '\n[Buttons]\n' + btnText.substring(0, 800) + '\n';
    } catch {}

    // Extract viewport-visible text
    try {
      const vt = await page.evaluate(() => {
        const scrollY = window.scrollY || 0;
        const viewH = window.innerHeight || 900;
        let text = '';
        for (const el of document.body.querySelectorAll('p, td, th, li, h1, h2, h3, h4, h5, h6, span, div, a, label')) {
          const rect = el.getBoundingClientRect();
          const absTop = rect.top + scrollY;
          if (absTop < scrollY + viewH && absTop + rect.height > scrollY && rect.height > 0) {
            const t = el.innerText?.trim();
            if (t && t.length > 2 && !text.includes(t.substring(0, 50))) text += t + ' ';
          }
          if (text.length > 2000) break;
        }
        return text;
      });
      const clean = (vt || '').replace(/\s+/g, ' ').trim();
      if (clean.length > 100) viewportText = '\n[Viewport Text]\n' + clean.substring(0, 1000) + '\n';
    } catch {}

    // Extract iframe content
    try {
      const frames = page.frames();
      if (frames.length > 1) {
        let iframeText = '';
        for (const frame of frames.slice(1, 6)) {
          try {
            const ft = await frame.evaluate(() => document.body?.innerText || '');
            if (ft && ft.trim().length > 30) iframeText += ft.trim().substring(0, 800) + '\n---\n';
          } catch {}
        }
        if (iframeText.length > 30) iframes = '\n[IFrame Content]\n' + iframeText.substring(0, 800) + '\n';
      }
    } catch {}

    // Budget: supplements first, tree fills remaining
    const supplementSize = header.length + links.length + buttons.length + viewportText.length + iframes.length;
    const treeBudget = Math.max(2000, SNAPSHOT_BUDGET - supplementSize);
    if (snapshotText.length > treeBudget) {
      snapshotText = snapshotText.substring(0, treeBudget) + '\n... (tree truncated)';
    }

    return header + links + buttons + viewportText + iframes + '\n[Interactive Elements]\n' + snapshotText;
  }

  // ── Snapshot Strategies ──

  _injectRefsIntoAriaSnapshot(ariaText) {
    if (!ariaText) return { text: '', count: 0 };
    let refCounter = 0;
    const lines = ariaText.split('\n');
    const result = [];

    for (const line of lines) {
      const roleMatch = line.match(/^(\s*-\s+)(\w+)\s+(.*)$/);
      if (roleMatch) {
        const [, indent, role, rest] = roleMatch;
        if (INTERACTIVE_ROLES.has(role) || (STRUCTURAL_ROLES.has(role) && rest.includes('"'))) {
          refCounter++;
          result.push(`${indent}[ref=${refCounter}] ${role} ${rest}`);
          continue;
        }
      }
      const bareMatch = line.match(/^(\s*-\s+)(\w+):?\s*$/);
      if (bareMatch && INTERACTIVE_ROLES.has(bareMatch[2])) {
        refCounter++;
        result.push(`${bareMatch[1]}[ref=${refCounter}] ${bareMatch[2]}`);
        continue;
      }
      result.push(line);
    }
    return { text: result.join('\n'), count: refCounter };
  }

  async _getAccessibilityTreeSnapshot(page) {
    const tree = await page.accessibility.snapshot({ interestingOnly: false });
    if (!tree) return '(empty page)';

    let refCounter = 0;
    const lines = [];

    const walk = (node, indent) => {
      if (!node) return;
      const padding = '  '.repeat(Math.min(indent, 8));
      const role = node.role || '';
      const name = (node.name || '').replace(/\n/g, ' ').trim();

      const isInteractive = INTERACTIVE_ROLES.has(role);
      const isNamedStructural = name && STRUCTURAL_ROLES.has(role);

      if ((isInteractive || isNamedStructural) && refCounter < MAX_REFS) {
        refCounter++;
        let line = `${padding}[ref=${refCounter}] ${role}`;
        if (name) line += ` "${name.substring(0, 100)}"`;
        if (node.value) line += ` value="${String(node.value).substring(0, 80)}"`;
        if (node.checked !== undefined) line += node.checked ? ' [checked]' : ' [unchecked]';
        if (node.pressed !== undefined && node.pressed) line += ' [pressed]';
        if (node.selected) line += ' [selected]';
        if (node.disabled) line += ' [disabled]';
        if (node.expanded !== undefined) line += node.expanded ? ' [expanded]' : ' [collapsed]';
        if (node.level) line += ` level=${node.level}`;
        lines.push(line);
      } else if ((role === 'text' || role === 'StaticText') && name.length > 5 && name.length < 300) {
        lines.push(`${padding}-- "${name.substring(0, 150)}"`);
      }

      if (node.children) {
        for (const child of node.children) {
          walk(child, indent + (isInteractive || isNamedStructural ? 1 : 0));
        }
      }
    };

    walk(tree, 0);
    return lines.join('\n');
  }

  async _getDomWalkSnapshot(page) {
    const allFrames = page.frames();
    let globalRefCounter = 0;
    let globalTextCounter = 0;
    const allLines = [];
    let childFrameCount = 0;

    for (let fi = 0; fi < allFrames.length; fi++) {
      const frame = allFrames[fi];
      try {
        const frameUrl = frame.url();
        if (!frameUrl || frameUrl === 'about:blank') continue;

        if (fi > 0) {
          if (childFrameCount >= MAX_CHILD_FRAMES) continue;
          if (SKIP_DOMAINS.test(frameUrl)) continue;
          childFrameCount++;
          allLines.push(`\n--- iframe: ${frameUrl.substring(0, 120)} ---`);
        }

        const frameTimeout = fi === 0 ? 5000 : 2000;
        const evalPromise = frame.evaluate(({ startRef, startText, maxRefs, maxText }) => {
          document.querySelectorAll('[data-gref]').forEach(el => el.removeAttribute('data-gref'));
          let refCounter = startRef;
          let textCounter = startText;
          const lines = [];

          function getRole(el) {
            const role = el.getAttribute('role');
            if (role) return role;
            const tag = el.tagName.toLowerCase();
            const map = {
              a: 'link', button: 'button', select: 'combobox', textarea: 'textbox',
              img: 'image', nav: 'navigation', main: 'main', form: 'form',
              header: 'banner', footer: 'contentinfo', aside: 'complementary',
              dialog: 'dialog', summary: 'button',
            };
            if (map[tag]) return map[tag];
            if (/^h[1-6]$/.test(tag)) return 'heading';
            if (tag === 'input') {
              const t = (el.type || 'text').toLowerCase();
              if (t === 'checkbox') return 'checkbox';
              if (t === 'radio') return 'radio';
              if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
              if (t === 'search') return 'searchbox';
              if (t === 'range') return 'slider';
              if (t === 'number') return 'spinbutton';
              return 'textbox';
            }
            if (el.getAttribute('contenteditable') === 'true') return 'textbox';
            return '';
          }

          function getName(el) {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;
            const labelledBy = el.getAttribute('aria-labelledby');
            if (labelledBy) {
              const labelEl = document.getElementById(labelledBy);
              if (labelEl) return (labelEl.textContent || '').trim();
            }
            if (el.id) {
              const label = document.querySelector('label[for="' + el.id + '"]');
              if (label) return (label.textContent || '').trim();
            }
            return el.getAttribute('alt')
              || el.getAttribute('title')
              || el.getAttribute('placeholder')
              || (el.tagName === 'IMG' ? (el.src || '').split('/').pop()?.split('?')[0] : '')
              || (el.textContent || '').trim().substring(0, 100)
              || '';
          }

          function isVisible(el) {
            if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
          }

          function isInteractive(el) {
            const tag = el.tagName.toLowerCase();
            if (['a', 'button', 'input', 'textarea', 'select', 'summary'].includes(tag)) return true;
            const role = el.getAttribute('role');
            if (['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
                 'searchbox', 'textbox', 'combobox', 'switch', 'slider', 'option',
                 'checkbox', 'radio', 'spinbutton', 'treeitem'].includes(role)) return true;
            if (el.getAttribute('tabindex') !== null) return true;
            if (el.getAttribute('contenteditable') === 'true') return true;
            if (el.onclick !== null || el.getAttribute('onclick')) return true;
            if (getComputedStyle(el).cursor === 'pointer') return true;
            return false;
          }

          function walk(el, indent) {
            if (!isVisible(el)) return;
            const role = getRole(el);
            const interactive = isInteractive(el);
            const tag = el.tagName.toLowerCase();

            if ((role || interactive) && refCounter < maxRefs) {
              refCounter++;
              el.setAttribute('data-gref', String(refCounter));
              const pad = '  '.repeat(Math.min(indent, 8));
              const name = getName(el).replace(/"/g, "'").replace(/\n/g, ' ').trim();
              let line = pad + '[ref=' + refCounter + '] ' + (role || tag) + ' "' + name.substring(0, 100) + '"';
              if (el.value !== undefined && el.value !== '') line += ' value="' + String(el.value).substring(0, 60) + '"';
              if (el.checked) line += ' [checked]';
              if (el.disabled) line += ' [disabled]';
              if (tag === 'a' && el.href) line += ' href="' + el.href.substring(0, 100) + '"';
              const hm = tag.match(/^h(\d)$/);
              if (hm) line += ' level=' + hm[1];
              lines.push(line);
            } else if (!role && !interactive && textCounter < maxText) {
              const textTags = ['p', 'span', 'li', 'td', 'th', 'label', 'h5', 'h6',
                               'cite', 'em', 'strong', 'time', 'div', 'figcaption', 'blockquote', 'pre', 'code'];
              if (textTags.includes(tag)) {
                const directText = Array.from(el.childNodes)
                  .filter(n => n.nodeType === 3)
                  .map(n => n.textContent.trim())
                  .join(' ').trim();
                if (directText.length > 5 && directText.length < 500) {
                  const pad = '  '.repeat(Math.min(indent, 8));
                  lines.push(pad + '-- "' + directText.substring(0, 200).replace(/"/g, "'").replace(/\n/g, ' ') + '"');
                  textCounter++;
                }
              }
            }
            for (const child of el.children) {
              walk(child, indent + (role ? 1 : 0));
            }
          }

          walk(document.body, 0);
          return { text: lines.join('\n'), refCounter, textCounter };
        }, { startRef: globalRefCounter, startText: globalTextCounter, maxRefs: MAX_REFS, maxText: MAX_TEXT_NODES });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Frame evaluation timed out')), frameTimeout)
        );
        const result = await Promise.race([evalPromise, timeoutPromise]);

        allLines.push(result.text);
        globalRefCounter = result.refCounter;
        globalTextCounter = result.textCounter;
      } catch (err) {
        if (fi > 0) allLines.push('  (iframe content not accessible)');
      }
    }

    return allLines.join('\n');
  }

  // ── Ref Resolution ──

  _resolveRef(refStr) {
    if (!refStr) return null;
    const str = String(refStr).trim();
    const match = str.match(/^(?:ref=)?(\d+)$/);
    return match ? match[1] : null;
  }

  async _getLocatorForRef(page, ref) {
    // Strategy 1: data-gref attribute (search all frames)
    for (const frame of page.frames()) {
      try {
        const loc = frame.locator(`[data-gref="${ref}"]`);
        if (await loc.count().catch(() => 0) > 0) {
          if (await loc.first().isVisible().catch(() => false)) return loc.first();
        }
      } catch {}
    }

    // Strategy 2: nth interactive element by DOM order
    try {
      const nthLocator = page.locator(
        'a, button, input, textarea, select, [role="button"], [role="link"], ' +
        '[role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], ' +
        '[role="textbox"], [role="searchbox"], [role="combobox"], [role="switch"], ' +
        '[contenteditable="true"], summary, [tabindex]'
      );
      const idx = parseInt(ref, 10) - 1;
      const count = await nthLocator.count();
      if (idx >= 0 && idx < count) {
        const candidate = nthLocator.nth(idx);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }
    } catch {}

    return null;
  }

  // ── Click ──

  async click(refStr, options = {}) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);

      if (!ref) {
        // Text-based click fallback
        if (typeof refStr === 'string' && refStr.length > 1 && !/^\d+$/.test(String(refStr).trim())) {
          return this._clickByText(page, refStr, options);
        }
        return { success: false, error: `Invalid ref: "${refStr}". Use a number from browser_snapshot.` };
      }

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) {
        if (options.element) return this._clickByText(page, options.element, options);
        return { success: false, error: `Element ref=${ref} not found. Call browser_snapshot to refresh.` };
      }

      const clickOpts = { timeout: 5000, force: options.force || false };
      if (options.button) clickOpts.button = options.button;
      if (options.modifiers) clickOpts.modifiers = options.modifiers;

      if (options.doubleClick) {
        await locator.dblclick(clickOpts);
      } else {
        // Listen for new tab opened by click
        let newTabPage = null;
        const newTabPromise = new Promise(resolve => {
          const handler = (p) => { newTabPage = p; resolve(p); };
          this.context.once('page', handler);
          setTimeout(() => { this.context.off('page', handler); resolve(null); }, 2000);
        });

        await locator.click(clickOpts);
        await Promise.race([newTabPromise, new Promise(r => setTimeout(r, 2000))]);

        if (newTabPage) {
          console.log('[PlaywrightBrowser] Click opened new tab — switching');
          try { await newTabPage.waitForLoadState('domcontentloaded', { timeout: 10000 }); } catch {}
          this._setupPageListeners(newTabPage);
          this.page = newTabPage;
        }
      }

      await this._waitForPageStable(page, 1500);
      this._invalidateSnapshot();
      await this._dismissOverlayPopups(this.page || page);

      const info = await locator.evaluate(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 80),
        role: el.getAttribute('role') || '',
      })).catch(() => ({ tag: 'unknown', text: '', role: '' }));

      return { success: true, ref: refStr, element: info };
    } catch (error) {
      return { success: false, error: `Click failed on ref=${refStr}: ${error.message}. Call browser_snapshot to refresh.` };
    }
  }

  async _clickByText(page, text, options = {}) {
    const clickOpts = { timeout: 5000, force: options.force || false };
    const strategies = [
      () => page.getByRole('button', { name: text, exact: false }),
      () => page.getByRole('link', { name: text, exact: false }),
      () => page.getByRole('tab', { name: text, exact: false }),
      () => page.getByRole('menuitem', { name: text, exact: false }),
      () => page.getByText(text, { exact: false }),
    ];

    for (const getLocator of strategies) {
      try {
        const loc = getLocator();
        if (await loc.count() > 0) {
          const first = loc.first();
          if (await first.isVisible().catch(() => false)) {
            await first.click(clickOpts);
            await this._waitForPageStable(page, 1500);
            this._invalidateSnapshot();
            const info = await first.evaluate(el => ({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().substring(0, 80),
              role: el.getAttribute('role') || '',
            })).catch(() => ({ tag: 'unknown', text, role: '' }));
            return { success: true, ref: `text:"${text}"`, element: info };
          }
        }
      } catch {}
    }

    return { success: false, error: `No visible element matching text "${text}" found. Call browser_snapshot for current page state.` };
  }

  // ── Type ──

  async type(refStr, text, options = {}) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);

      if (!ref) {
        // Name-based fallback
        if (typeof refStr === 'string' && refStr.length > 1 && !/^\d+$/.test(String(refStr).trim())) {
          return this._typeByName(page, refStr, text, options);
        }
        return { success: false, error: `Invalid ref: "${refStr}". Use a number from browser_snapshot.` };
      }

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) {
        return { success: false, error: `Element ref=${ref} not found. Call browser_snapshot to refresh.` };
      }

      if (options.slowly) {
        await locator.click({ timeout: 5000 });
        await locator.fill('');
        await locator.pressSequentially(text, { delay: 50 });
      } else {
        await locator.fill(text);
      }

      if (options.submit) {
        await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }

      this._invalidateSnapshot();
      return { success: true, ref: refStr, text };
    } catch (error) {
      return { success: false, error: `Type failed on ref=${refStr}: ${error.message}` };
    }
  }

  async _typeByName(page, name, text, options = {}) {
    const strategies = [
      () => page.getByRole('textbox', { name, exact: false }),
      () => page.getByRole('searchbox', { name, exact: false }),
      () => page.getByRole('combobox', { name, exact: false }),
      () => page.getByPlaceholder(name, { exact: false }),
    ];
    for (const getLocator of strategies) {
      try {
        const loc = getLocator();
        if (await loc.count() > 0) {
          const first = loc.first();
          if (await first.isVisible().catch(() => false)) {
            if (options.slowly) {
              await first.click({ timeout: 5000 });
              await first.fill('');
              await first.pressSequentially(text, { delay: 50 });
            } else {
              await first.fill(text);
            }
            if (options.submit) {
              await page.keyboard.press('Enter');
              await page.waitForLoadState('domcontentloaded').catch(() => {});
            }
            this._invalidateSnapshot();
            return { success: true, ref: name, text };
          }
        }
      } catch {}
    }
    return { success: false, error: `Could not find input "${name}". Use a ref number from browser_snapshot.` };
  }

  // ── Fill Form ──

  async fillForm(fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'fields array is required' };
    }

    try {
      const page = await this._ensureBrowser();
      const results = [];

      for (const field of fields) {
        const refNum = this._resolveRef(field.ref);
        if (!refNum) { results.push({ ref: field.ref, success: false, error: 'Invalid ref' }); continue; }

        const locator = await this._getLocatorForRef(page, refNum);
        if (!locator) { results.push({ ref: field.ref, success: false, error: 'Element not found' }); continue; }

        try {
          const ft = field.type;
          if (ft === 'checkbox') {
            if (field.value === 'true' || field.value === true) await locator.check({ timeout: 5000 });
            else await locator.uncheck({ timeout: 5000 });
          } else if (ft === 'radio') {
            await locator.check({ timeout: 5000 });
          } else if (ft === 'combobox') {
            await locator.selectOption({ label: field.value });
          } else {
            await locator.fill(field.value);
          }
          results.push({ ref: field.ref, success: true });
        } catch (err) {
          results.push({ ref: field.ref, success: false, error: err.message });
        }
      }

      this._invalidateSnapshot();
      const ok = results.filter(r => r.success).length;
      return { success: ok > 0, results, message: `Filled ${ok}/${fields.length} fields` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Select Option ──

  async selectOption(refStr, values) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);
      if (!ref) return { success: false, error: `Invalid ref: "${refStr}"` };

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) return { success: false, error: `Element ref=${ref} not found` };

      const selectValues = Array.isArray(values) ? values : [values];
      try {
        await locator.selectOption(selectValues.map(v => ({ label: v })));
      } catch {
        await locator.selectOption(selectValues);
      }

      this._invalidateSnapshot();
      return { success: true, ref: refStr, selected: selectValues };
    } catch (error) {
      return { success: false, error: `Select failed: ${error.message}` };
    }
  }

  // ── Hover ──

  async hover(refStr) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);
      if (!ref) return { success: false, error: `Invalid ref: "${refStr}"` };

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) return { success: false, error: `Element ref=${ref} not found` };

      await locator.hover({ timeout: 5000 });
      const info = await locator.evaluate(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 80),
      })).catch(() => ({ tag: 'unknown', text: '' }));

      return { success: true, ref: refStr, element: info };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Press Key ──

  async pressKey(key) {
    try {
      const page = await this._ensureBrowser();
      const keyMap = {
        enter: 'Enter', return: 'Enter',
        tab: 'Tab', escape: 'Escape', esc: 'Escape',
        backspace: 'Backspace', delete: 'Delete',
        arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
        arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
        space: ' ', home: 'Home', end: 'End',
        pageup: 'PageUp', pagedown: 'PageDown',
      };
      const normalized = keyMap[key.toLowerCase()] || key;
      await page.keyboard.press(normalized);
      await page.waitForTimeout(300);
      this._invalidateSnapshot();
      return { success: true, key: normalized };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Drag ──

  async drag(startRef, endRef) {
    try {
      const page = await this._ensureBrowser();
      const startNum = this._resolveRef(startRef);
      const endNum = this._resolveRef(endRef);
      if (!startNum || !endNum) return { success: false, error: 'Both startRef and endRef are required' };

      const startLoc = await this._getLocatorForRef(page, startNum);
      const endLoc = await this._getLocatorForRef(page, endNum);
      if (!startLoc || !endLoc) return { success: false, error: 'One or both elements not found' };

      await startLoc.dragTo(endLoc, { timeout: 5000 });
      this._invalidateSnapshot();
      return { success: true, startRef, endRef };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Scroll ──

  async scroll(direction = 'down', amount = 500) {
    try {
      const page = await this._ensureBrowser();
      const pixels = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
      await page.evaluate((px) => window.scrollBy(0, px), pixels);
      this._invalidateSnapshot();
      return { success: true, direction, amount, message: `Scrolled ${direction} by ${amount}px` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Evaluate ──

  async evaluate(code, refStr) {
    try {
      const page = await this._ensureBrowser();
      let result;

      if (refStr) {
        const ref = this._resolveRef(refStr);
        if (ref) {
          const locator = await this._getLocatorForRef(page, ref);
          if (locator) {
            result = await locator.evaluate(new Function('element', code));
          } else {
            return { success: false, error: `Element ref=${ref} not found` };
          }
        }
      }

      if (result === undefined) {
        result = await page.evaluate(code);
      }

      return {
        success: true,
        result: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? 'undefined'),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Screenshot ──

  async screenshot(options = {}) {
    try {
      const page = await this._ensureBrowser();
      const screenshotOpts = { type: options.type || 'png', fullPage: options.fullPage || false };

      let buffer;
      if (options.ref) {
        const ref = this._resolveRef(options.ref);
        if (ref) {
          const locator = await this._getLocatorForRef(page, ref);
          if (locator) buffer = await locator.screenshot(screenshotOpts);
        }
      }
      if (!buffer) buffer = await page.screenshot(screenshotOpts);

      return {
        success: true,
        dataUrl: `data:image/${screenshotOpts.type};base64,${buffer.toString('base64')}`,
        width: 1280,
        height: 900,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Wait For ──

  async waitFor(options = {}) {
    try {
      const page = await this._ensureBrowser();
      const timeout = options.timeout || 30000;

      if (options.text) {
        await page.getByText(options.text, { exact: false }).waitFor({ state: 'visible', timeout });
        return { success: true, message: `Text "${options.text}" appeared` };
      }
      if (options.textGone) {
        await page.getByText(options.textGone, { exact: false }).waitFor({ state: 'hidden', timeout });
        return { success: true, message: `Text "${options.textGone}" disappeared` };
      }
      if (options.time) {
        const ms = Math.min(Math.max(options.time * 1000, 100), 60000);
        await page.waitForTimeout(ms);
        return { success: true, message: `Waited ${options.time}s` };
      }
      if (options.selector) {
        await page.waitForSelector(options.selector, { state: 'visible', timeout });
        return { success: true, message: `Selector "${options.selector}" appeared` };
      }

      await page.waitForLoadState('networkidle').catch(() => {});
      return { success: true, message: 'Page settled' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Content ──

  async getUrl() {
    try {
      const page = await this._ensureBrowser();
      return { success: true, url: page.url(), title: await page.title() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getContent(selector, html = false) {
    try {
      const page = await this._ensureBrowser();
      const sel = (typeof selector === 'string' && selector.trim()) ? selector.trim() : null;
      let content = '';

      if (!sel) {
        const loc = page.locator('body');
        content = html ? await loc.innerHTML() : await loc.innerText();
      } else {
        const extracted = await page.evaluate(({ sel, html }) => {
          const nodes = Array.from(document.querySelectorAll(sel));
          if (!nodes.length) return { ok: false };
          if (html) return { ok: true, content: nodes.slice(0, 5).map(n => n.outerHTML || '').join('\n\n') };
          return { ok: true, content: nodes.slice(0, 30).map(n => (n.innerText || n.textContent || '').trim()).filter(Boolean).join('\n') };
        }, { sel, html });

        if (extracted?.ok) {
          content = extracted.content || '';
        } else {
          const loc = page.locator('body');
          content = html ? await loc.innerHTML() : await loc.innerText();
        }
      }

      return { success: true, content: content.substring(0, 15000), url: page.url(), title: await page.title() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getLinks(selector) {
    try {
      const page = await this._ensureBrowser();
      const links = await page.evaluate((sel) => {
        const root = document.querySelector(sel) || document;
        return Array.from(root.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
          href: a.href,
          text: (a.textContent || '').trim().substring(0, 100),
          title: a.title || '',
        }));
      }, selector || 'body');
      return { success: true, links, total: links.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Dialog Handling ──

  async handleDialog(accept, promptText) {
    if (!this._pendingDialog) return { success: false, error: 'No dialog is currently open' };

    try {
      const dialog = this._pendingDialog.dialog;
      const info = { type: this._pendingDialog.type, message: this._pendingDialog.message };

      if (accept) {
        await dialog.accept(promptText !== undefined ? promptText : undefined);
      } else {
        await dialog.dismiss();
      }

      this._pendingDialog = null;
      return { success: true, action: accept ? 'accepted' : 'dismissed', ...info };
    } catch (error) {
      this._pendingDialog = null;
      return { success: false, error: error.message };
    }
  }

  // ── Tab Management ──

  async tabs(action, index) {
    try {
      const page = await this._ensureBrowser();

      if (action === 'list') {
        const pages = this.context.pages();
        const tabs = await Promise.all(pages.map(async (p, i) => ({
          index: i,
          url: p.url(),
          title: await p.title().catch(() => ''),
          active: p === this.page,
        })));
        return { success: true, tabs, total: tabs.length };
      }

      if (action === 'new') {
        const newPage = await this.context.newPage();
        this._setupPageListeners(newPage);
        this.page = newPage;
        this._invalidateSnapshot();
        return { success: true, message: 'New tab created', index: this.context.pages().length - 1 };
      }

      if (action === 'close') {
        const pages = this.context.pages();
        if (index !== undefined && index >= 0 && index < pages.length) {
          await pages[index].close();
        } else {
          const currentIdx = pages.indexOf(this.page);
          await this.page.close();
          index = currentIdx;
        }
        const remaining = this.context.pages();
        this.page = remaining.length > 0 ? remaining[Math.max(0, (index || 0) - 1)] : await this.context.newPage();
        this._invalidateSnapshot();
        return { success: true, message: 'Tab closed' };
      }

      if (action === 'select') {
        const pages = this.context.pages();
        if (index === undefined || index < 0 || index >= pages.length) {
          return { success: false, error: `Invalid tab index: ${index}. Available: 0-${pages.length - 1}` };
        }
        this.page = pages[index];
        await this.page.bringToFront();
        this._invalidateSnapshot();
        return { success: true, message: `Switched to tab ${index}`, url: this.page.url() };
      }

      return { success: false, error: `Invalid action: ${action}. Use 'list', 'new', 'close', or 'select'.` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Console Messages ──

  async getConsoleMessages(level = 'info') {
    const levels = {
      error: ['error'],
      warning: ['error', 'warning'],
      info: ['error', 'warning', 'info', 'log'],
      debug: ['error', 'warning', 'info', 'log', 'debug', 'trace'],
    };
    const allowed = levels[level] || levels.info;
    const filtered = this.consoleLog.filter(m => allowed.includes(m.type));
    return { success: true, messages: filtered.slice(-100), total: filtered.length, level };
  }

  // ── File Upload ──

  async uploadFiles(refStr, filePaths) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);
      if (!ref) return { success: false, error: 'Invalid ref' };

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) return { success: false, error: `Element ref=${ref} not found` };

      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
      await locator.setInputFiles(paths);
      this._invalidateSnapshot();
      return { success: true, files: paths.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Resize ──

  async resize(width, height) {
    try {
      const page = await this._ensureBrowser();
      await page.setViewportSize({ width, height });
      return { success: true, width, height };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── Network Requests ──

  async getNetworkRequests(includeStatic = false) {
    try {
      const page = await this._ensureBrowser();
      const entries = await page.evaluate((includeStatic) => {
        const resources = performance.getEntriesByType('resource');
        const staticTypes = ['img', 'css', 'font', 'script'];
        return resources
          .filter(r => includeStatic || !staticTypes.some(t => r.initiatorType === t))
          .slice(-100)
          .map(r => ({
            url: r.name.substring(0, 200),
            type: r.initiatorType,
            duration: Math.round(r.duration),
            size: r.transferSize || 0,
          }));
      }, includeStatic);
      return { success: true, requests: entries, total: entries.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ── State ──

  getState() {
    return {
      isVisible: this.isLaunched,
      url: this.page && !this.page.isClosed() ? this.page.url() : '',
      title: '',
      canGoBack: true,
      canGoForward: true,
      isLoading: false,
      isPlaywright: true,
    };
  }

  // ── Chromium Discovery ──

  _findChromium() {
    const paths = [];
    if (process.platform === 'win32') {
      const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
      const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
      const local = process.env['LOCALAPPDATA'] || '';
      paths.push(
        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      );
    } else if (process.platform === 'darwin') {
      paths.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      );
    } else {
      paths.push(
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser',
      );
    }

    for (const p of paths) {
      try {
        if (fs.existsSync(p)) {
          console.log(`[PlaywrightBrowser] Found browser: ${p}`);
          return p;
        }
      } catch {}
    }

    console.log('[PlaywrightBrowser] No system browser found, will use Playwright bundled');
    return null;
  }

  // ── Cleanup ──

  dispose() {
    this._cleanup().catch(() => {});
  }
}

module.exports = { PlaywrightBrowser };
