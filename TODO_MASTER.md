# guIDE Master TODO List
**Created: February 8, 2026**
**Domain: graysoft.dev**

---

## Domain & Hosting

- [x] Purchase domain: **graysoft.dev** (Namecheap)
- [x] Configure Namecheap nameservers to Cloudflare
- [ ] Create Cloudflare tunnel for website (isolate from existing tunnels/ports)
- [ ] DNS A/CNAME record pointing to tunnel
- [ ] Update website `.env.local` with `NEXT_PUBLIC_APP_URL=https://graysoft.dev`
- [ ] Update `NEXT_PUBLIC_STRIPE_SUCCESS_URL` and `CANCEL_URL` to use graysoft.dev
- [ ] Update IDE `LicenseManager.serverHost` to `https://graysoft.dev`
- [ ] Test Stripe webhook with production domain
- [ ] Set up Cloudflare SSL (Full Strict)

---

## Browser Issues (CRITICAL)

### Issue 1: Browser overlay stays on top of everything
- **Symptom:** BrowserView (native Electron overlay) renders above all modals/menus
- **Root Cause:** `ExplainFileModal`, `TaskCreator`, and FileTree context menu do NOT dispatch `browser-overlay-show`/`browser-overlay-hide` custom events
- **Fix:** Add event dispatching to all overlays/modals that render with `fixed/absolute` positioning

### Issue 2: Browser doesn't auto-open when AI starts browser task
- **Symptom:** AI makes browser tool calls but viewport shows nothing; user must manually click Browser sidebar icon
- **Root Cause:** `show-browser` IPC fires but BrowserPanel mount + `browserShow(bounds)` may have timing race; BrowserView stays at offscreen coords (-2000, -2000)
- **Fix:** Ensure `show-browser` → `openBrowserTab` → `BrowserPanel.mount` → `browserShow(bounds)` pipeline is reliable; add fallback re-show after tool completion

### Issue 3: User cannot click/submit in browser
- **Symptom:** User can type in browser input fields but cannot click buttons (e.g., Google Search)
- **Possible causes:** DPI scaling mismatch, BrowserView bounds not matching displayed content, rapid hide/show cycles interrupting click events
- **Fix:** Investigate BrowserView bounds accuracy, test mouse event propagation, check DPI scaling

### Issue 4: Browser disappears when clicking other UI elements
- **Symptom:** Browser "turns gray" or disappears when clicking sidebar buttons, file explorer, etc.
- **Root Cause:** Tab switch effect in `Editor.tsx` calls `browserHide()` when active tab changes. Clicking activity bar buttons may trigger state changes that affect tab focus
- **Fix:** Only hide BrowserView when **explicitly** switching to a non-browser editor tab, not when interacting with sidebar panels

### Issue 5: Browser only works after opening a directory
- **Symptom:** Without a folder open, browser stays on Google.com even though AI is making tool calls. Once a directory is chosen, browser properly displays navigated pages
- **Root Cause:** Opening a folder triggers layout re-render → ResizeObserver → `updateBrowserBounds()` which moves BrowserView from offscreen (-2000, -2000) to correct position. Without this trigger, BrowserView stays offscreen
- **Fix:** Ensure `browserShow(bounds)` is called reliably regardless of folder state; add explicit bounds update after browser tab creation

### Issue 6: AI chat sidebar disappears after using Explain File
- **Symptom:** After right-clicking file → Explain File → closing the modal, the AI chat sidebar vanishes and clicking View → AI Chat doesn't restore it
- **Possible causes:** ExplainFileModal's close handler or the context menu interaction may inadvertently toggle sidebar state; possible React state race condition
- **Fix:** Investigate state flow from context menu → ExplainFile → close; ensure no accidental `setChatVisible(false)` calls

### Issue 7: Model struggles to actually navigate/interact with pages
- **Symptom:** Model makes browser tool calls but appears stuck on Google; can't seem to click search results or navigate to actual restaurant pages
- **Root Cause:** Combined effect of multiple issues - BrowserView at offscreen bounds means snapshots may work (JS executes at offscreen) but user doesn't see the actual page; model may also struggle with Google's dynamic DOM
- **Fix:** Fix visibility issues first, then improve tool feedback so model knows what's happening

---

## Browser Improvements

- [ ] Add **external Chrome instance** option (already partially implemented via `launchExternalChrome`)
- [ ] Allow user preference: viewport browser vs external Chrome vs both
- [ ] External Chrome should use CDP (Chrome DevTools Protocol) for AI tool interactions
- [ ] Fix "Open in Chrome" button to also allow AI-controlled external browser
- [ ] Browser should be viewable while interacting with other panels (not hidden on sidebar click)

---

## Icon Errors

- **`icons/lib.svg` not found:** Files with `.lib` extension have no icon and no alias
- **`icons/powershell.svg` not found:** `ps1` is aliased to `'powershell'` but only `ps1.svg` exists
- **Fix:** Remove incorrect aliases, add missing SVGs or map to existing ones

---

## Website (graysoft.dev)

- [x] All 36 source files created
- [x] npm install working (JSON file store, no native deps)
- [x] All pages tested and verified working
- [ ] Update domain references from placeholder to graysoft.dev
- [ ] Copy installer to `website/public/downloads/guIDE-Setup.exe`
- [ ] Add real screenshots to Showcase section
- [ ] Production build testing (`next build`)
- [ ] Set up PM2 or systemd for production process management
- [ ] Configure Stripe webhooks for production domain

---

## Marketing & Exposure

- [ ] Create GitHub repository (public, with README, but without full source code)
- [ ] Upload compelling README with feature list, screenshots, architecture overview
- [ ] Create GitHub Releases page with download link to installer
- [ ] Submit to Product Hunt (prepare launch page, tagline, screenshots)
- [ ] Create Product Hunt listing via MCP browser
- [ ] Consider: open-source select components while keeping core proprietary

---

## Previously Completed (Phase 52-53)

- [x] Explain File — right-click context menu item
- [x] Vision Auto-Switching — transparent routing to Gemini Flash
- [x] Hardware-Aware Model Suggestions — GPU VRAM detection
- [x] Licensing Infrastructure — LicenseManager class, IPC handlers
- [x] Commercial website — Next.js + Tailwind + Framer Motion
- [x] User authentication — bcryptjs + JWT
- [x] Stripe payments — $10 one-time lifetime license
- [x] JSON file database (replaced SQLite/better-sqlite3)
