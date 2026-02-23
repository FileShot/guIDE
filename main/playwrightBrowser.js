/**
 * guIDE Playwright Browser Manager — Professional-Grade Browser Automation
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Uses playwright-core to control external Chromium/Chrome instances with
 * real accessibility tree snapshots, reliable click/type via Playwright's
 * native event dispatching, multi-tab support, dialog handling, and more.
 *
 * This replaces the injected-JS approach with Playwright's CDP-based
 * automation for dramatically improved reliability on modern web apps.
 */
const path = require('path');
const fs = require('fs');

// Lazy-load playwright-core — it's ~2MB of JS that only needs parsing when
// browser automation is actually used, not on every app startup.
let _chromium = null;
function getChromium() {
  if (!_chromium) {
    _chromium = require('playwright-core').chromium;
  }
  return _chromium;
}
const os = require('os');

class PlaywrightBrowser {
  constructor() {
    /** @type {import('playwright-core').Browser|null} */
    this.browser = null;
    /** @type {import('playwright-core').BrowserContext|null} */
    this.context = null;
    /** @type {import('playwright-core').Page|null} */
    this.page = null;
    this.isLaunched = false;
    this.headless = false;
    this.consoleLog = [];
    this._dialogHandler = null;
    this._pendingDialog = null;
    this._pageSnapshotCache = null;
    this._snapshotCacheTime = 0;
    this.parentWindow = null; // Electron mainWindow for IPC notifications
  }

  /**
   * Initialize with Electron parent window (for IPC notifications)
   */
  initialize(parentWindow) {
    this.parentWindow = parentWindow;
  }

  // ─── Launch / Close ─────────────────────────────────────────────────

  /**
   * Launch a browser instance. Tries to find system Chrome/Chromium first,
   * falls back to Playwright's bundled browser if available.
   */
  async launch(options = {}) {
    if (this.isLaunched && this.browser?.isConnected()) {
      return { success: true, message: 'Browser already running' };
    }

    // Clean up any stale state
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

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    // If no executablePath found, Playwright will try its own bundled browser

    try {
      this.browser = await getChromium().launch(launchOptions);
      
      // Create a persistent context with sensible defaults
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ignoreHTTPSErrors: false, // Enforce TLS validation by default
        javaScriptEnabled: true,
        bypassCSP: false,
        acceptDownloads: true,
      });

      // Get the default page or create one
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      // Set up event listeners
      this._setupPageListeners(this.page);

      // Listen for new pages (popups, new tabs)
      this.context.on('page', (newPage) => {
        this._setupPageListeners(newPage);
      });

      this.isLaunched = true;
      console.log('[PlaywrightBrowser] Launched successfully', executablePath ? `using ${path.basename(executablePath)}` : 'using bundled browser');
      
      return { success: true, message: 'Browser launched', headless, executablePath: executablePath || 'bundled' };
    } catch (error) {
      console.error('[PlaywrightBrowser] Launch failed:', error.message);
      
      // If custom executable failed, try without it (use Playwright's bundled)
      if (executablePath) {
        try {
          delete launchOptions.executablePath;
          this.browser = await getChromium().launch(launchOptions);
          this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'en-US',
            ignoreHTTPSErrors: false, // Enforce TLS validation by default
            acceptDownloads: true,
          });
          const pages = this.context.pages();
          this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
          this._setupPageListeners(this.page);
          this.context.on('page', (newPage) => this._setupPageListeners(newPage));
          this.isLaunched = true;
          console.log('[PlaywrightBrowser] Launched with bundled browser (fallback)');
          return { success: true, message: 'Browser launched (bundled fallback)', headless };
        } catch (fallbackErr) {
          return { success: false, error: `Failed to launch browser: ${error.message}. Fallback also failed: ${fallbackErr.message}. Run "npx playwright install chromium" to install.` };
        }
      }
      
      return { success: false, error: `Failed to launch browser: ${error.message}. Try running "npx playwright install chromium".` };
    }
  }

  /**
   * Close the browser and clean up all resources
   */
  async close() {
    await this._cleanup();
    return { success: true, message: 'Browser closed' };
  }

  async _cleanup() {
    this._pageSnapshotCache = null;
    this.consoleLog = [];
    this._pendingDialog = null;
    try {
      if (this.context) await this.context.close().catch(() => {});
    } catch (_) {}
    try {
      if (this.browser) await this.browser.close().catch(() => {});
    } catch (_) {}
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isLaunched = false;
  }

  // ─── Page Setup ─────────────────────────────────────────────────────

  _setupPageListeners(page) {
    // Console messages
    page.on('console', (msg) => {
      this.consoleLog.push({
        type: msg.type(),
        text: msg.text().substring(0, 500), // Cap individual entries
        timestamp: new Date().toISOString(),
      });
      // Efficient trim: splice in-place instead of creating new array with slice
      if (this.consoleLog.length > 500) {
        this.consoleLog.splice(0, 100);
      }
    });

    // Dialog handler (alerts, confirms, prompts)
    page.on('dialog', async (dialog) => {
      this._pendingDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        dialog, // Store the actual dialog object for handling
      };
      console.log(`[PlaywrightBrowser] Dialog appeared: ${dialog.type()} — "${dialog.message()}"`);
      
      // Auto-dismiss after 3s if not handled — keeps automation flowing
      setTimeout(async () => {
        if (this._pendingDialog?.dialog === dialog) {
          try { await dialog.accept(); } catch (_) {}
          console.log('[PlaywrightBrowser] Auto-dismissed dialog after 3s');
          this._pendingDialog = null;
        }
      }, 3000);
    });

    // Page crash handler
    page.on('crash', () => {
      console.error('[PlaywrightBrowser] Page crashed!');
    });

    // Navigation events — notify Electron renderer
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

  /**
   * Wait for the page to stabilize — network idle + DOM mutations stopped.
   * More reliable than just waitForLoadState('networkidle') alone.
   */
  async _waitForPageStable(page, timeout = 1500) {
    const start = Date.now();
    try {
      // Phase 1: Wait for network idle (no pending requests for 500ms)
      await page.waitForLoadState('networkidle').catch(() => {});
      
      // Phase 2: Wait for DOM stability (no mutations for 300ms)
      // This catches SPAs, lazy-loaded content, JS-rendered pages
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
            }, 150); // 150ms mutation quiet (was 200ms)
          });
          observer.observe(document.body || document.documentElement, {
            childList: true, subtree: true, attributes: true,
          });
          // Start with a 150ms timer in case page is already stable
          timer = setTimeout(() => {
            observer.disconnect();
            clearTimeout(deadline);
            resolve();
          }, 150);
        });
      }, Math.max(timeout - (Date.now() - start), 500)).catch(() => {});
    } catch (_) {
      // Fallback: simple wait
      await page.waitForTimeout(500).catch(() => {});
    }
  }

  /**
   * Auto-dismiss common cookie consent banners after navigation.
   * Handles most popular consent frameworks (OneTrust, CookieBot, GDPR plugins).
   */
  async _dismissCookieBanners(page) {
    try {
      const dismissed = await page.evaluate(() => {
        // Common "accept" button selectors for cookie banners
        const selectors = [
          // Generic accept buttons
          'button[id*="accept" i]', 'button[class*="accept" i]',
          'a[id*="accept" i]', '[data-testid*="accept" i]',
          // OneTrust
          '#onetrust-accept-btn-handler',
          // CookieBot
          '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
          '.CybotCookiebotDialogBodyButton[id*="Allow"]',
          // Google consent
          'button[aria-label*="Accept" i]', 'button[aria-label*="Agree" i]',
          'button[aria-label*="consent" i]',
          // Generic patterns
          '[class*="cookie" i] button:first-of-type',
          '[id*="cookie" i] button:first-of-type',
          '[class*="consent" i] button:first-of-type',
          '[class*="gdpr" i] button:first-of-type',
          // Iubenda
          '.iubenda-cs-accept-btn',
          // Common text patterns
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
          } catch (_) {}
        }
        return false;
      });
      
      if (dismissed) {
        console.log('[PlaywrightBrowser] Auto-dismissed cookie consent banner');
        await page.waitForTimeout(300);
      }
    } catch (_) {
      // Non-critical — silently ignore
    }
  }

  /**
   * Auto-dismiss HTML overlay modals/popups that block page interaction.
   * Handles: "browser not supported", "update your browser", notification overlays, etc.
   */
  async _dismissOverlayPopups(page) {
    try {
      const dismissed = await page.evaluate(() => {
        let found = false;
        // Strategy 1: Find close/dismiss/OK buttons in overlay/modal containers
        const overlaySelectors = [
          '[class*="modal" i]', '[class*="overlay" i]', '[class*="popup" i]',
          '[class*="dialog" i]', '[class*="banner" i]', '[class*="notification" i]',
          '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
        ];
        for (const containerSel of overlaySelectors) {
          try {
            const containers = document.querySelectorAll(containerSel);
            for (const container of containers) {
              // Check if it's actually visible and covering content
              const style = window.getComputedStyle(container);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
              
              // Look for close/dismiss buttons inside
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
          } catch (_) {}
          if (found) break;
        }
        
        // Strategy 2: Remove fixed/absolute overlays blocking the page
        if (!found) {
          const allElements = document.querySelectorAll('div, section, aside');
          for (const el of allElements) {
            const style = window.getComputedStyle(el);
            if ((style.position === 'fixed' || style.position === 'absolute') && style.zIndex > 999) {
              const rect = el.getBoundingClientRect();
              // Only remove if it covers a significant portion of the viewport
              if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3) {
                const text = (el.textContent || '').toLowerCase();
                if (/not supported|update.*browser|upgrade.*browser|outdated|retro|incompatible/i.test(text)) {
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
    } catch (_) {}
  }

  _notifyStateChange(page) {
    if (this.parentWindow && !this.parentWindow.isDestroyed()) {
      try {
        this.parentWindow.webContents.send('browser-state-changed', {
          url: page.url() || '',
          title: '', // Title requires async, send empty
          canGoBack: true,
          canGoForward: true,
          isLoading: false,
        });
      } catch (_) {}
    }
  }

  // ─── Ensure Browser is Ready ─────────────────────────────────────────

  /**
   * Ensure browser is launched and has an active page.
   * Auto-launches if not already running.
   */
  async _ensureBrowser() {
    if (!this.isLaunched || !this.browser?.isConnected()) {
      const launchResult = await this.launch();
      if (!launchResult.success) {
        throw new Error(launchResult.error || 'Failed to launch browser');
      }
    }
    if (!this.page || this.page.isClosed()) {
      const pages = this.context?.pages() || [];
      this.page = pages.find(p => !p.isClosed()) || await this.context?.newPage();
      if (this.page) this._setupPageListeners(this.page);
    }
    return this.page;
  }

  // ─── Navigation ─────────────────────────────────────────────────────

  /**
   * Navigate to a URL
   */
  async navigate(url) {
    if (!url) return { success: false, error: 'URL is required' };
    
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      url = 'https://' + url;
    }

    try {
      const page = await this._ensureBrowser();
      
      // Navigate with timeout and wait for load
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Smart page stability: wait for network idle + DOM stability
      await this._waitForPageStable(page);
      
      const title = await page.title();
      const actualUrl = page.url();

      this._invalidateSnapshot();

      // Auto-dismiss common cookie consent banners
      await this._dismissCookieBanners(page);
      
      // Auto-dismiss HTML overlay popups (browser warnings, notifications, etc.)
      await this._dismissOverlayPopups(page);

      // Extract page text inline so models get data immediately (eliminates a round-trip)
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
      } catch (_) {}

      // Notify Electron frontend of state change (but DON'T open viewport browser)
      // Playwright has its own Chrome window — viewport tab should not auto-open
      if (this.parentWindow && !this.parentWindow.isDestroyed()) {
        try {
          this.parentWindow.webContents.send('browser-state-changed', {
            url: actualUrl,
            title: title,
            canGoBack: true,
            canGoForward: false,
            isLoading: false,
          });
        } catch (_) {}
      }

      return { 
        success: true, 
        url: actualUrl, 
        title,
        pageText,
        message: `Navigated to ${actualUrl}`,
      };
    } catch (error) {
      return { success: false, error: `Navigation failed: ${error.message}` };
    }
  }

  /**
   * Navigate back in history
   */
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

  /**
   * Navigate forward in history
   */
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

  /**
   * Reload the current page
   */
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

  // ─── Accessibility Snapshot (THE KEY FEATURE) ─────────────────────

  /**
   * Get an accessibility tree snapshot of the current page.
   * This is the core of reliable browser automation — the AI reads this
   * structured tree and uses ref= to interact with specific elements.
   * 
   * Uses Playwright's built-in accessibility snapshot API for a true
   * accessibility tree (not a DOM walk with heuristics).
   */
  async getSnapshot() {
    try {
      const page = await this._ensureBrowser();
      const url = page.url();
      const title = await page.title();

      // Return cached snapshot if still fresh (prevents redundant DOM walks
      // when auto-snapshot and explicit browser_snapshot happen close together)
      const CACHE_TTL_MS = 1500;
      if (this._pageSnapshotCache && (Date.now() - this._snapshotCacheTime) < CACHE_TTL_MS) {
        return this._pageSnapshotCache;
      }

      // Always use DOM walk + accessibility tree for reliable [ref=N] numbered snapshots.
      // ariaSnapshot() returns YAML without ref numbers, causing models to fail.
      let snapshotText;
      let elementCount = 0;

      // Strategy 1: DOM walk (most reliable — sets data-gref attributes for locator matching)
      try {
        snapshotText = await this._getDomWalkSnapshot(page);
        elementCount = (snapshotText.match(/\[ref=/g) || []).length;
      } catch (domErr) {
        console.log('[PlaywrightBrowser] DOM walk failed:', domErr.message);
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
        } catch (accErr) {
          console.log('[PlaywrightBrowser] Accessibility tree failed:', accErr.message);
        }
      }

      // Strategy 3: Playwright ariaSnapshot as last resort — post-process to add ref numbers
      if (elementCount < 3 || !snapshotText || snapshotText.trim().length < 20) {
        console.log('[PlaywrightBrowser] Falling back to ariaSnapshot with ref injection');
        try {
          const ariaRaw = await page.locator('body').ariaSnapshot({ timeout: 5000 });
          const { text: ariaWithRefs, count } = this._injectRefsIntoAriaSnapshot(ariaRaw);
          if (count > elementCount) {
            snapshotText = ariaWithRefs;
            elementCount = count;
          }
        } catch (ariaErr) {
          console.log('[PlaywrightBrowser] ariaSnapshot also failed:', ariaErr.message);
        }
      }

      if (!snapshotText || snapshotText.trim().length < 10) {
        snapshotText = '(Page appears empty or inaccessible)';
      }

      // ── Snapshot enrichment: extract actionable supplements ──
      // Models attend more to content at the beginning — put links/buttons/text BEFORE the tree.
      let linksSection = '';
      let buttonsSection = '';
      let viewportTextSection = '';
      let iframeSection = '';

      // 1. Extract visible links
      try {
        const links = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          const visible = anchors.filter(a => {
            const rect = a.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            return a.textContent.trim().length > 0 || a.title || a.querySelector('img[alt]');
          });
          return visible.slice(0, 30).map(a => {
            const text = a.textContent.trim().substring(0, 60);
            const title = a.title ? `[title: ${a.title}]` : '';
            const imgAlt = !text && a.querySelector('img[alt]') ? `[img: ${a.querySelector('img[alt]').alt}]` : '';
            const label = text || title || imgAlt || '(no text)';
            return `${label} → ${a.href}`;
          }).join('\n');
        });
        if (links && links.length > 20) {
          linksSection = '\n[Visible Links]\n' + links.substring(0, 2000) + '\n';
        }
      } catch (_) {}

      // 2. Extract key buttons/dropdowns (main page + iframes)
      try {
        const allFrames = [page, ...page.frames().slice(1, 6)];
        let allButtons = [];
        for (const frame of allFrames) {
          try {
            const frameButtons = await frame.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button, [role="button"], select, [role="combobox"], [role="listbox"]'));
              return btns
                .filter(b => {
                  const rect = b.getBoundingClientRect();
                  if (rect.width === 0 && rect.height === 0) return false;
                  const label = (b.textContent || '').trim() || b.getAttribute('aria-label') || b.title || '';
                  return label.length > 2 && label.length < 80;
                })
                .slice(0, 15)
                .map(b => ((b.textContent || '').trim() || b.getAttribute('aria-label') || b.title || '').substring(0, 60));
            });
            if (frameButtons) allButtons.push(...frameButtons);
          } catch (_) {}
        }
        const buttons = allButtons.slice(0, 25).join('\n');
        if (buttons && buttons.length > 10) {
          buttonsSection = '\n[Buttons]\n' + buttons.substring(0, 800) + '\n';
        }
      } catch (_) {}

      // 3. Extract viewport-visible text (what the user can see right now)
      try {
        const viewportText = await page.evaluate(() => {
          const scrollY = window.scrollY || 0;
          const viewH = window.innerHeight || 900;
          const viewTop = scrollY;
          const viewBot = scrollY + viewH;
          let text = '';
          const elements = document.body.querySelectorAll('p, td, th, li, h1, h2, h3, h4, h5, h6, span, div, a, label, dt, dd');
          for (const el of elements) {
            try {
              const rect = el.getBoundingClientRect();
              const absTop = rect.top + scrollY;
              const absBot = rect.bottom + scrollY;
              if (absTop < viewBot && absBot > viewTop && rect.height > 0) {
                const t = el.innerText?.trim();
                if (t && t.length > 2 && !text.includes(t.substring(0, 50))) {
                  text += t + ' ';
                }
              }
            } catch (_) {}
            if (text.length > 2000) break;
          }
          return text;
        });
        const clean = (viewportText || '').replace(/\s+/g, ' ').trim();
        if (clean.length > 100) {
          viewportTextSection = '\n[Viewport Text]\n' + clean.substring(0, 1000) + '\n';
        }
      } catch (_) {}

      // 4. Extract iframe content
      try {
        const frames = page.frames();
        if (frames.length > 1) {
          let iframeText = '';
          for (const frame of frames.slice(1, 6)) {
            try {
              const ft = await frame.evaluate(() => document.body?.innerText || '');
              if (ft && ft.trim().length > 30) {
                iframeText += ft.trim().substring(0, 800) + '\n---\n';
              }
            } catch (_) {}
          }
          if (iframeText.length > 30) {
            iframeSection = '\n[IFrame Content]\n' + iframeText.substring(0, 800) + '\n';
          }
        }
      } catch (_) {}

      // Budget: supplements first, then tree fills remaining space
      const header = `Page: ${title}\nURL: ${url}\n`;
      const supplementSize = header.length + linksSection.length + buttonsSection.length + viewportTextSection.length + iframeSection.length;
      const treeBudget = Math.max(2000, 8000 - supplementSize);
      if (snapshotText.length > treeBudget) {
        snapshotText = snapshotText.substring(0, treeBudget) + '\n... (tree truncated)';
      }

      // Assemble enriched snapshot
      const enrichedSnapshot = header + linksSection + buttonsSection + viewportTextSection + iframeSection + '\n[Interactive Elements]\n' + snapshotText;
      elementCount = (enrichedSnapshot.match(/\[ref=/g) || []).length;

      const result = {
        success: true,
        snapshot: enrichedSnapshot,
        url,
        title,
        elementCount,
      };

      // Cache the snapshot to avoid redundant DOM walks
      this._pageSnapshotCache = result;
      this._snapshotCacheTime = Date.now();

      return result;
    } catch (error) {
      return { success: false, error: `Snapshot failed: ${error.message}` };
    }
  }

  /**
   * Post-process Playwright's ariaSnapshot YAML output to inject [ref=N] numbers
   * for interactive elements. This makes the output compatible with our ref system.
   */
  _injectRefsIntoAriaSnapshot(ariaText) {
    if (!ariaText) return { text: '', count: 0 };
    let refCounter = 0;
    const interactiveRoles = new Set([
      'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox',
      'checkbox', 'radio', 'slider', 'spinbutton', 'tab', 'menuitem',
      'menuitemcheckbox', 'menuitemradio', 'switch', 'option', 'treeitem',
    ]);
    const structuralRoles = new Set([
      'heading', 'img', 'image', 'navigation', 'main', 'form',
    ]);

    const lines = ariaText.split('\n');
    const result = [];
    for (const line of lines) {
      // Match lines like: "  - role "name"" or "  - role "name" [checked]"
      const roleMatch = line.match(/^(\s*-\s+)(\w+)\s+(.*)$/);
      if (roleMatch) {
        const [, indent, role, rest] = roleMatch;
        if (interactiveRoles.has(role) || (structuralRoles.has(role) && rest.includes('"'))) {
          refCounter++;
          result.push(`${indent}[ref=${refCounter}] ${role} ${rest}`);
          continue;
        }
      }
      // Also match bare role lines like "  - text: content"
      const bareMatch = line.match(/^(\s*-\s+)(\w+):?\s*$/);
      if (bareMatch && interactiveRoles.has(bareMatch[2])) {
        refCounter++;
        result.push(`${bareMatch[1]}[ref=${refCounter}] ${bareMatch[2]}`);
        continue;
      }
      // Pass through text/structural lines as-is
      result.push(line);
    }
    return { text: result.join('\n'), count: refCounter };
  }

  /**
   * Accessibility tree snapshot using Playwright's accessibility API.
   * Assigns ref numbers to interactive/semantic elements.
   */
  async _getAccessibilityTreeSnapshot(page) {
    try {
      const tree = await page.accessibility.snapshot({ interestingOnly: false });
      if (!tree) return '(empty page)';

      let refCounter = 0;
      const lines = [];

      const walk = (node, indent) => {
        if (!node) return;
        const padding = '  '.repeat(Math.min(indent, 8));
        const role = node.role || '';
        const name = (node.name || '').replace(/\n/g, ' ').trim();
        const value = node.value || '';

        // Assign refs to interactive or named elements
        const isInteractive = [
          'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox',
          'checkbox', 'radio', 'slider', 'spinbutton', 'tab', 'menuitem',
          'menuitemcheckbox', 'menuitemradio', 'switch', 'option',
        ].includes(role);

        const isNamedStructural = name && [
          'heading', 'img', 'image', 'navigation', 'main', 'form',
          'complementary', 'banner', 'contentinfo', 'region',
        ].includes(role);

        if ((isInteractive || isNamedStructural) && refCounter < 800) {
          refCounter++;
          let line = `${padding}[ref=${refCounter}] ${role}`;
          if (name) line += ` "${name.substring(0, 100)}"`;
          if (value) line += ` value="${String(value).substring(0, 80)}"`;
          if (node.checked !== undefined) line += node.checked ? ' [checked]' : ' [unchecked]';
          if (node.pressed !== undefined) line += node.pressed ? ' [pressed]' : '';
          if (node.selected) line += ' [selected]';
          if (node.disabled) line += ' [disabled]';
          if (node.expanded !== undefined) line += node.expanded ? ' [expanded]' : ' [collapsed]';
          if (node.level) line += ` level=${node.level}`;
          lines.push(line);
        } else if (role === 'text' || role === 'StaticText') {
          // Include some text content for context
          if (name && name.length > 5 && name.length < 300) {
            lines.push(`${padding}-- "${name.substring(0, 150)}"`);
          }
        }

        // Recurse into children
        if (node.children) {
          for (const child of node.children) {
            walk(child, indent + (isInteractive || isNamedStructural ? 1 : 0));
          }
        }
      };

      walk(tree, 0);
      return lines.join('\n');
    } catch (error) {
      console.log('[PlaywrightBrowser] Accessibility tree error:', error.message);
      return '';
    }
  }

  /**
   * DOM walk snapshot fallback — injects JS to walk the DOM 
   * and assign data-gref attributes (compatible with existing ref system).
   */
  async _getDomWalkSnapshot(page) {
    try {
      // Walk all frames (main + iframes) so content inside iframes is visible
      const allFrames = page.frames();
      let globalRefCounter = 0;
      let globalTextCounter = 0;
      const allLines = [];
      const MAX_CHILD_FRAMES = 3; // Limit iframe walking to avoid ad iframe overhead
      let childFrameCount = 0;

      // Known ad/tracking domains to skip
      const skipDomains = /doubleclick|googlesyndication|googleadservices|facebook\.com\/tr|analytics|adsystem|adserver|tracking|pixel|beacon/i;

      for (let fi = 0; fi < allFrames.length; fi++) {
        const frame = allFrames[fi];
        try {
          // Skip detached or about:blank frames
          const frameUrl = frame.url();
          if (!frameUrl || frameUrl === 'about:blank') continue;

          // For child frames: enforce limits
          if (fi > 0) {
            if (childFrameCount >= MAX_CHILD_FRAMES) continue;
            if (skipDomains.test(frameUrl)) continue;
            childFrameCount++;
            allLines.push(`\n--- iframe: ${frameUrl.substring(0, 120)} ---`);
          }

          // Wrap frame evaluation with a timeout to prevent slow frames from blocking
          const frameTimeout = fi === 0 ? 5000 : 2000; // Main frame gets more time
          const evalPromise = frame.evaluate(({ startRef, startText }) => {
        // Clear previous refs
        document.querySelectorAll('[data-gref]').forEach(el => el.removeAttribute('data-gref'));
        let refCounter = startRef;
        let textCounter = startText;
        const lines = [];

        function getRole(el) {
          const role = el.getAttribute('role');
          if (role) return role;
          const tag = el.tagName.toLowerCase();
          const roleMap = {
            'a': 'link', 'button': 'button', 'select': 'combobox',
            'textarea': 'textbox', 'img': 'image', 'nav': 'navigation',
            'main': 'main', 'form': 'form', 'header': 'banner',
            'footer': 'contentinfo', 'aside': 'complementary',
            'dialog': 'dialog', 'details': 'group', 'summary': 'button',
          };
          if (roleMap[tag]) return roleMap[tag];
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
          // ARIA label takes priority
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel;
          // aria-labelledby
          const labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy) {
            const labelEl = document.getElementById(labelledBy);
            if (labelEl) return (labelEl.textContent || '').trim();
          }
          // Associated label
          if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) return (label.textContent || '').trim();
          }
          // Standard attributes
          return el.getAttribute('alt')
            || el.getAttribute('title')
            || el.getAttribute('placeholder')
            || (el.tagName === 'IMG' ? (el.src || '').split('/').pop()?.split('?')[0] : '')
            || (el.textContent || '').trim().substring(0, 100)
            || '';
        }

        function isVisible(el) {
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && parseFloat(style.opacity) > 0;
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
          // Check for click event listeners via cursor style
          if (getComputedStyle(el).cursor === 'pointer') return true;
          return false;
        }

        function walk(el, indent) {
          if (!isVisible(el)) return;
          const role = getRole(el);
          const interactive = isInteractive(el);
          const tag = el.tagName.toLowerCase();

          if ((role || interactive) && refCounter < 800) {
            refCounter++;
            el.setAttribute('data-gref', String(refCounter));
            const pad = '  '.repeat(Math.min(indent, 8));
            const name = getName(el).replace(/"/g, "'").replace(/\n/g, ' ').trim();
            let line = `${pad}[ref=${refCounter}] ${role || tag} "${name.substring(0, 100)}"`;
            if (el.value !== undefined && el.value !== '') line += ` value="${String(el.value).substring(0, 60)}"`;
            if (el.checked) line += ' [checked]';
            if (el.disabled) line += ' [disabled]';
            if (tag === 'a' && el.href) line += ` href="${el.href.substring(0, 100)}"`;
            // Heading level
            const headingMatch = tag.match(/^h(\d)$/);
            if (headingMatch) line += ` level=${headingMatch[1]}`;
            lines.push(line);
          } else if (!role && !interactive && textCounter < 200) {
            const textTags = ['p', 'span', 'li', 'td', 'th', 'label', 'h5', 'h6', 
                             'cite', 'em', 'strong', 'time', 'div', 'figcaption', 'blockquote', 'pre', 'code'];
            if (textTags.includes(tag)) {
              const directText = Array.from(el.childNodes)
                .filter(n => n.nodeType === 3)
                .map(n => n.textContent.trim())
                .join(' ').trim();
              if (directText.length > 5 && directText.length < 500) {
                const pad = '  '.repeat(Math.min(indent, 8));
                lines.push(`${pad}-- "${directText.substring(0, 200).replace(/"/g, "'").replace(/\n/g, ' ')}"`);
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
          }, { startRef: globalRefCounter, startText: globalTextCounter });

          // Apply timeout
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Frame evaluation timed out')), frameTimeout)
          );
          const result = await Promise.race([evalPromise, timeoutPromise]);

          allLines.push(result.text);
          globalRefCounter = result.refCounter;
          globalTextCounter = result.textCounter;
        } catch (frameErr) {
          // Cross-origin or detached frame — skip silently
          if (fi > 0) {
            allLines.push(`  (iframe content not accessible)`);
          }
        }
      }

      return allLines.join('\n');
    } catch (error) {
      return `(Failed to get DOM snapshot: ${error.message})`;
    }
  }

  // ─── Element Interaction ──────────────────────────────────────────

  /**
   * Click an element by visible text as fallback.
   * Tries role-based locators first (button, link), then generic text match.
   */
  async _clickByText(page, text, options = {}) {
    const clickOpts = { timeout: 5000, force: options.force || false };
    
    // Try button/link with exact text first
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
        const count = await loc.count();
        if (count > 0) {
          const first = loc.first();
          const isVisible = await first.isVisible().catch(() => false);
          if (isVisible) {
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
      } catch (_) {}
    }

    return { success: false, error: `No visible element matching text "${text}" found. Call browser_snapshot for current page state.` };
  }

  /**
   * Resolve a ref string to an element locator.
   * Supports: "5", "ref=5", or the ref is used to find data-gref attribute.
   */
  _resolveRef(refStr) {
    if (!refStr) return null;
    const str = String(refStr).trim();
    const match = str.match(/^(?:ref=)?(\d+)$/);
    if (match) return match[1];
    return null;
  }

  /**
   * Get a Playwright locator for a ref number.
   * Uses MULTIPLE fallback strategies for maximum reliability:
   * 1. data-gref attribute (from DOM walk snapshot)
   * 2. Aria snapshot role/name matching (from accessibility tree)
   * 3. Smart heuristics — visible interactive elements by index
   */
  async _getLocatorForRef(page, ref) {
    // Strategy 1: data-gref attribute — search ALL frames (main + iframes)
    const allFrames = page.frames();
    for (const frame of allFrames) {
      try {
        const grefLocator = frame.locator(`[data-gref="${ref}"]`);
        const grefCount = await grefLocator.count().catch(() => 0);
        if (grefCount > 0) {
          const isVisible = await grefLocator.first().isVisible().catch(() => false);
          if (isVisible) return grefLocator.first();
        }
      } catch (_) {}
    }

    // Strategy 2: Walk interactive elements in DOM order and match by index
    // This works even if data-gref was cleared by page navigation/mutation
    try {
      const nthLocator = page.locator(
        'a, button, input, textarea, select, [role="button"], [role="link"], ' +
        '[role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], ' +
        '[role="textbox"], [role="searchbox"], [role="combobox"], [role="switch"], ' +
        '[contenteditable="true"], summary, [tabindex]'
      );
      const count = await nthLocator.count();
      const idx = parseInt(ref, 10) - 1; // refs are 1-based
      if (idx >= 0 && idx < count) {
        const candidate = nthLocator.nth(idx);
        const isVisible = await candidate.isVisible().catch(() => false);
        if (isVisible) return candidate;
      }
    } catch (_) {}

    return null;
  }

  /**
   * Click an element by ref number.
   * Uses Playwright's native click which properly handles overlays, scrolling,
   * and triggers real browser events (not synthetic JS events).
   */
  async click(refStr, options = {}) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);
      
      if (!ref) {
        // Try text-based click as fallback: user might pass element text or name instead of ref number
        if (typeof refStr === 'string' && refStr.length > 1 && !/^\d+$/.test(String(refStr).trim())) {
          return this._clickByText(page, refStr, options);
        }
        return { success: false, error: `Invalid ref: "${refStr}". Use a number from browser_snapshot (e.g. "5"), or pass the element's visible text.` };
      }

      let locator = await this._getLocatorForRef(page, ref);
      if (!locator) {
        // Last resort: try by element description from snapshot if available
        if (options.element) {
          return this._clickByText(page, options.element, options);
        }
        return { success: false, error: `Element ref=${ref} not found. Page may have changed — call browser_snapshot to get fresh refs.` };
      }

      // Use Playwright's click with options
      const clickOptions = {
        timeout: 5000,
        force: options.force || false,
      };
      if (options.button) clickOptions.button = options.button;
      if (options.modifiers) clickOptions.modifiers = options.modifiers;
      if (options.doubleClick) {
        await locator.dblclick(clickOptions);
      } else {
        // Detect if click opens a new tab/popup by listening for the 'page' event
        let newTabPage = null;
        const newTabPromise = new Promise(resolve => {
          const handler = (page) => { newTabPage = page; resolve(page); };
          this.context.once('page', handler);
          // Timeout: if no new tab in 2s, resolve with null
          setTimeout(() => { this.context.off('page', handler); resolve(null); }, 2000);
        });

        await locator.click(clickOptions);

        // Wait briefly for new tab to appear
        await Promise.race([newTabPromise, new Promise(r => setTimeout(r, 2000))]);

        if (newTabPage) {
          console.log('[PlaywrightBrowser] Click opened new tab — switching to it');
          try {
            await newTabPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          } catch (_) {}
          this._setupPageListeners(newTabPage);
          this.page = newTabPage;
        }
      }

      // Wait for page to stabilize after click (handles navigation, AJAX, SPA routing)
      await this._waitForPageStable(page, 1500);

      this._invalidateSnapshot();
      
      // Auto-dismiss any overlay popups that appeared after click
      await this._dismissOverlayPopups(this.page || page);

      // Get element info for response
      const info = await locator.evaluate(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().substring(0, 80),
        role: el.getAttribute('role') || '',
      })).catch(() => ({ tag: 'unknown', text: '', role: '' }));

      return { success: true, ref: refStr, element: info };
    } catch (error) {
      return { success: false, error: `Click failed on ref=${refStr}: ${error.message}. Call browser_snapshot to get updated refs.` };
    }
  }

  /**
   * Type text into an input field by ref number.
   * Clears the field first, then types the text.
   */
  async type(refStr, text, options = {}) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);
      
      if (!ref) {
        // Fallback: try to find element by text/role if ref is a name like "search"
        if (typeof refStr === 'string' && refStr.length > 1 && !/^\d+$/.test(String(refStr).trim())) {
          // Try to find by role with the name
          const strategies = [
            () => page.getByRole('textbox', { name: refStr, exact: false }),
            () => page.getByRole('searchbox', { name: refStr, exact: false }),
            () => page.getByRole('combobox', { name: refStr, exact: false }),
            () => page.getByPlaceholder(refStr, { exact: false }),
          ];
          for (const getLocator of strategies) {
            try {
              const loc = getLocator();
              const count = await loc.count();
              if (count > 0) {
                const first = loc.first();
                const isVisible = await first.isVisible().catch(() => false);
                if (isVisible) {
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
                  return { success: true, ref: refStr, text };
                }
              }
            } catch (_) {}
          }
          return { success: false, error: `Could not find input "${refStr}". Use a ref number from browser_snapshot.` };
        }
        return { success: false, error: `Invalid ref: "${refStr}". Use a number from browser_snapshot.` };
      }

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) {
        return { success: false, error: `Element ref=${ref} not found. Call browser_snapshot to refresh.` };
      }

      // Clear and type
      if (options.slowly) {
        // Type character by character (triggers keydown/keyup per char)
        await locator.click({ timeout: 5000 });
        await locator.fill('');
        await locator.pressSequentially(text, { delay: 50 });
      } else {
        // Fast fill (sets value directly + dispatches input/change events)
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

  /**
   * Fill multiple form fields at once. Much more efficient than
   * calling type() multiple times.
   */
  async fillForm(fields) {
    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'fields array is required' };
    }

    try {
      const page = await this._ensureBrowser();
      const results = [];

      for (const field of fields) {
        const { ref, value, type: fieldType } = field;
        const refNum = this._resolveRef(ref);
        if (!refNum) {
          results.push({ ref, success: false, error: 'Invalid ref' });
          continue;
        }

        const locator = await this._getLocatorForRef(page, refNum);
        if (!locator) {
          results.push({ ref, success: false, error: 'Element not found' });
          continue;
        }

        try {
          if (fieldType === 'checkbox') {
            if (value === 'true' || value === true) {
              await locator.check({ timeout: 5000 });
            } else {
              await locator.uncheck({ timeout: 5000 });
            }
          } else if (fieldType === 'radio') {
            await locator.check({ timeout: 5000 });
          } else if (fieldType === 'combobox') {
            await locator.selectOption({ label: value });
          } else if (fieldType === 'slider') {
            // For range inputs, set value directly
            await locator.fill(String(value));
          } else {
            // textbox default
            await locator.fill(value);
          }
          results.push({ ref, success: true });
        } catch (err) {
          results.push({ ref, success: false, error: err.message });
        }
      }

      this._invalidateSnapshot();

      const successCount = results.filter(r => r.success).length;
      return {
        success: successCount > 0,
        results,
        message: `Filled ${successCount}/${fields.length} fields`,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Select one or more options from a dropdown by ref.
   */
  async selectOption(refStr, values) {
    try {
      const page = await this._ensureBrowser();
      const ref = this._resolveRef(refStr);
      if (!ref) return { success: false, error: `Invalid ref: "${refStr}"` };

      const locator = await this._getLocatorForRef(page, ref);
      if (!locator) return { success: false, error: `Element ref=${ref} not found` };

      // values can be a single string or array
      const selectValues = Array.isArray(values) ? values : [values];
      
      // Try selecting by label (visible text), then by value
      try {
        await locator.selectOption(selectValues.map(v => ({ label: v })));
      } catch (_) {
        await locator.selectOption(selectValues);
      }

      this._invalidateSnapshot();
      return { success: true, ref: refStr, selected: selectValues };
    } catch (error) {
      return { success: false, error: `Select failed: ${error.message}` };
    }
  }

  /**
   * Hover over an element by ref.
   */
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

  /**
   * Press a keyboard key. Works on the currently focused element or page.
   */
  async pressKey(key) {
    try {
      const page = await this._ensureBrowser();
      
      // Normalize common key names to Playwright format
      const keyMap = {
        'enter': 'Enter', 'return': 'Enter',
        'tab': 'Tab', 'escape': 'Escape', 'esc': 'Escape',
        'backspace': 'Backspace', 'delete': 'Delete',
        'arrowup': 'ArrowUp', 'arrowdown': 'ArrowDown',
        'arrowleft': 'ArrowLeft', 'arrowright': 'ArrowRight',
        'space': ' ', 'home': 'Home', 'end': 'End',
        'pageup': 'PageUp', 'pagedown': 'PageDown',
        'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4',
        'f5': 'F5', 'f6': 'F6', 'f7': 'F7', 'f8': 'F8',
        'f9': 'F9', 'f10': 'F10', 'f11': 'F11', 'f12': 'F12',
      };
      
      const normalizedKey = keyMap[key.toLowerCase()] || key;
      
      await page.keyboard.press(normalizedKey);
      await page.waitForTimeout(300);
      
      this._invalidateSnapshot();
      
      return { success: true, key: normalizedKey };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Drag and drop from one element to another.
   */
  async drag(startRef, endRef) {
    try {
      const page = await this._ensureBrowser();
      
      const startNum = this._resolveRef(startRef);
      const endNum = this._resolveRef(endRef);
      if (!startNum || !endNum) return { success: false, error: 'Both startRef and endRef are required' };

      const startLocator = await this._getLocatorForRef(page, startNum);
      const endLocator = await this._getLocatorForRef(page, endNum);
      if (!startLocator || !endLocator) return { success: false, error: 'One or both elements not found' };

      await startLocator.dragTo(endLocator, { timeout: 5000 });
      
      this._invalidateSnapshot();
      return { success: true, startRef, endRef };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── Page Utilities ───────────────────────────────────────────────

  /**
   * Scroll the page up or down.
   */
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

  /**
   * Evaluate JavaScript in the page context.
   */
  async evaluate(code, refStr) {
    try {
      const page = await this._ensureBrowser();
      
      let result;
      if (refStr) {
        const ref = this._resolveRef(refStr);
        if (ref) {
          const locator = await this._getLocatorForRef(page, ref);
          if (locator) {
            // Evaluate with element as argument
            result = await locator.evaluate(new Function('element', code));
          } else {
            return { success: false, error: `Element ref=${ref} not found` };
          }
        }
      }
      
      if (result === undefined) {
        // Evaluate in page context
        result = await page.evaluate(code);
      }
      
      return { success: true, result: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? 'undefined') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Take a screenshot of the page or a specific element.
   */
  async screenshot(options = {}) {
    try {
      const page = await this._ensureBrowser();
      
      const screenshotOptions = {
        type: options.type || 'png',
        fullPage: options.fullPage || false,
      };

      let buffer;
      if (options.ref) {
        const ref = this._resolveRef(options.ref);
        if (ref) {
          const locator = await this._getLocatorForRef(page, ref);
          if (locator) {
            buffer = await locator.screenshot(screenshotOptions);
          }
        }
      }
      
      if (!buffer) {
        buffer = await page.screenshot(screenshotOptions);
      }

      // Convert to data URL
      const dataUrl = `data:image/${screenshotOptions.type};base64,${buffer.toString('base64')}`;
      
      return {
        success: true,
        dataUrl,
        width: 1280,
        height: 900,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Wait for text to appear, text to disappear, or a fixed duration.
   */
  async waitFor(options = {}) {
    try {
      const page = await this._ensureBrowser();
      
      if (options.text) {
        // Wait for text to appear
        await page.getByText(options.text, { exact: false }).waitFor({ 
          state: 'visible', 
          timeout: options.timeout || 30000,
        });
        return { success: true, message: `Text "${options.text}" appeared` };
      }
      
      if (options.textGone) {
        // Wait for text to disappear
        await page.getByText(options.textGone, { exact: false }).waitFor({ 
          state: 'hidden', 
          timeout: options.timeout || 30000,
        });
        return { success: true, message: `Text "${options.textGone}" disappeared` };
      }
      
      if (options.time) {
        const ms = Math.min(Math.max(options.time * 1000, 100), 60000);
        await page.waitForTimeout(ms);
        return { success: true, message: `Waited ${options.time}s` };
      }

      if (options.selector) {
        await page.waitForSelector(options.selector, { 
          state: 'visible',
          timeout: options.timeout || 30000,
        });
        return { success: true, message: `Selector "${options.selector}" appeared` };
      }
      
      // Default: wait for network idle
      await page.waitForLoadState('networkidle').catch(() => {});
      return { success: true, message: 'Page settled' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the current URL and page title.
   */
  async getUrl() {
    try {
      const page = await this._ensureBrowser();
      return {
        success: true,
        url: page.url(),
        title: await page.title(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get page text content or HTML.
   */
  async getContent(selector, html = false) {
    try {
      const page = await this._ensureBrowser();

      // Playwright's Locator.innerText()/innerHTML() runs in strict mode and will
      // throw if the selector matches 0 or >1 elements. For agentic usage, we
      // want a resilient "best effort" content extraction.
      const sel = (typeof selector === 'string' && selector.trim()) ? selector.trim() : null;

      let content = '';
      if (!sel) {
        const locator = page.locator('body');
        content = html ? await locator.innerHTML() : await locator.innerText();
      } else {
        // Extract from up to N matched nodes and join.
        const extracted = await page.evaluate(({ sel, html }) => {
          const nodes = Array.from(document.querySelectorAll(sel));
          if (!nodes.length) return { ok: false, reason: 'no_match' };
          if (html) {
            const parts = nodes.slice(0, 5).map(n => n.outerHTML || '');
            return { ok: true, content: parts.join('\n\n') };
          }
          const parts = nodes.slice(0, 30).map(n => {
            const t = (n.innerText || n.textContent || '').trim();
            return t;
          }).filter(Boolean);
          return { ok: true, content: parts.join('\n') };
        }, { sel, html });

        if (extracted?.ok) {
          content = extracted.content || '';
        } else {
          // Fallback: return the whole page body when selector doesn't match.
          const locator = page.locator('body');
          content = html ? await locator.innerHTML() : await locator.innerText();
        }
      }
      
      return {
        success: true,
        content: content.substring(0, 15000),
        url: page.url(),
        title: await page.title(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all links on the page.
   */
  async getLinks(selector) {
    try {
      const page = await this._ensureBrowser();
      const container = selector || 'body';
      
      const links = await page.evaluate((sel) => {
        const root = document.querySelector(sel) || document;
        const anchors = root.querySelectorAll('a[href]');
        return Array.from(anchors).slice(0, 100).map(a => ({
          href: a.href,
          text: (a.textContent || '').trim().substring(0, 100),
          title: a.title || '',
        }));
      }, container);
      
      return { success: true, links, total: links.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── Dialog Handling ──────────────────────────────────────────────

  /**
   * Handle a pending dialog (alert, confirm, prompt).
   */
  async handleDialog(accept, promptText) {
    if (!this._pendingDialog) {
      return { success: false, error: 'No dialog is currently open' };
    }

    try {
      const dialog = this._pendingDialog.dialog;
      const dialogInfo = {
        type: this._pendingDialog.type,
        message: this._pendingDialog.message,
      };

      if (accept) {
        if (promptText !== undefined) {
          await dialog.accept(promptText);
        } else {
          await dialog.accept();
        }
      } else {
        await dialog.dismiss();
      }

      this._pendingDialog = null;
      return { success: true, action: accept ? 'accepted' : 'dismissed', ...dialogInfo };
    } catch (error) {
      this._pendingDialog = null;
      return { success: false, error: error.message };
    }
  }

  // ─── Tab Management ───────────────────────────────────────────────

  /**
   * Manage browser tabs: list, create, close, select.
   */
  async tabs(action, index) {
    try {
      const page = await this._ensureBrowser();
      
      switch (action) {
        case 'list': {
          const pages = this.context.pages();
          const tabs = await Promise.all(pages.map(async (p, i) => ({
            index: i,
            url: p.url(),
            title: await p.title().catch(() => ''),
            active: p === this.page,
          })));
          return { success: true, tabs, total: tabs.length };
        }
        
        case 'new': {
          const newPage = await this.context.newPage();
          this._setupPageListeners(newPage);
          this.page = newPage;
          this._invalidateSnapshot();
          return { success: true, message: 'New tab created', index: this.context.pages().length - 1 };
        }
        
        case 'close': {
          const pages = this.context.pages();
          if (index !== undefined && index >= 0 && index < pages.length) {
            const closingPage = pages[index];
            await closingPage.close();
            // Switch to last remaining page
            const remaining = this.context.pages();
            this.page = remaining.length > 0 ? remaining[remaining.length - 1] : await this.context.newPage();
          } else {
            // Close current tab
            const currentIndex = pages.indexOf(this.page);
            await this.page.close();
            const remaining = this.context.pages();
            this.page = remaining.length > 0 ? remaining[Math.max(0, currentIndex - 1)] : await this.context.newPage();
          }
          this._invalidateSnapshot();
          return { success: true, message: 'Tab closed' };
        }
        
        case 'select': {
          const pages = this.context.pages();
          if (index === undefined || index < 0 || index >= pages.length) {
            return { success: false, error: `Invalid tab index: ${index}. Available: 0-${pages.length - 1}` };
          }
          this.page = pages[index];
          await this.page.bringToFront();
          this._invalidateSnapshot();
          return { success: true, message: `Switched to tab ${index}`, url: this.page.url() };
        }
        
        default:
          return { success: false, error: `Invalid action: ${action}. Use 'list', 'new', 'close', or 'select'.` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── Console Messages ─────────────────────────────────────────────

  /**
   * Get console messages from the page.
   */
  async getConsoleMessages(level = 'info') {
    const levels = {
      'error': ['error'],
      'warning': ['error', 'warning'],
      'info': ['error', 'warning', 'info', 'log'],
      'debug': ['error', 'warning', 'info', 'log', 'debug', 'trace'],
    };

    const allowedTypes = levels[level] || levels['info'];
    const filtered = this.consoleLog.filter(m => allowedTypes.includes(m.type));
    
    return {
      success: true,
      messages: filtered.slice(-100),
      total: filtered.length,
      level,
    };
  }

  // ─── File Upload ──────────────────────────────────────────────────

  /**
   * Upload files to a file input element.
   */
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

  // ─── Resize ───────────────────────────────────────────────────────

  /**
   * Resize the browser viewport.
   */
  async resize(width, height) {
    try {
      const page = await this._ensureBrowser();
      await page.setViewportSize({ width, height });
      return { success: true, width, height };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── Network Requests ─────────────────────────────────────────────

  /**
   * Get recent network requests (captured since page load).
   * Note: This requires the page to have been navigated with request logging.
   */
  async getNetworkRequests(includeStatic = false) {
    try {
      const page = await this._ensureBrowser();
      
      // Get performance entries (alternative to request interception)
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

  // ─── State / Info ─────────────────────────────────────────────────

  /**
   * Get current browser state (for BrowserPanel UI sync).
   */
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

  // ─── Chromium Discovery ───────────────────────────────────────────

  /**
   * Find system Chrome/Chromium executable.
   * Checks common installation paths on Windows, macOS, and Linux.
   */
  _findChromium() {
    const paths = [];
    
    if (process.platform === 'win32') {
      // Windows Chrome paths
      const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env['LOCALAPPDATA'] || '';
      
      paths.push(
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        // Edge (Chromium-based)
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        // Brave
        path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      );
    } else if (process.platform === 'darwin') {
      paths.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      );
    } else {
      // Linux
      paths.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/brave-browser',
      );
    }

    for (const p of paths) {
      try {
        if (fs.existsSync(p)) {
          console.log(`[PlaywrightBrowser] Found browser: ${p}`);
          return p;
        }
      } catch (_) {}
    }

    console.log('[PlaywrightBrowser] No system browser found, will use Playwright bundled browser');
    return null;
  }

  /**
   * Clean up resources on app exit.
   */
  dispose() {
    this._cleanup().catch(() => {});
  }
}

module.exports = { PlaywrightBrowser };
