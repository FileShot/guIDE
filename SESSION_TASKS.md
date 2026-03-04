# Session Tasks

_Last updated: current session_

---

## ✅ COMPLETED

### Website (graysoft.dev) — All deployed
- [x] Version bump: `CURRENT_VERSION` → `1.6.8` (`website/src/app/download/page.tsx:5`)
- [x] Background: `#000000` → `#080808` (`website/src/app/globals.css:28`)
- [x] CSP: added `ep1.adtrafficquality.google` + `ep2.adtrafficquality.google` to both `script-src` and `connect-src` (`website/next.config.js`)
- [x] Header auth: "Account" button shows correctly when logged in (verified via screenshot, previous session)

### App (guIDE IDE)
- [x] Auto mode model name hidden: removed `llm-token` IPC send for model selection in `main/agenticChat.js` + `pipeline-clone/main/agenticChat.js` (both trees)
  - **Needs build** — say "Ready to build." when user is ready
  - Error fallback messages (no API keys, no local model) preserved

### CI
- [x] Build #15 v1.6.8 — GREEN, 8m 28s

---

## 🔲 PENDING

### Pocket Guide (pocket.graysoft.dev) — `C:\Users\brend\all site work\pocket-guide\`

- [ ] **Void theme as default** — apply void theme CSS vars to `:root {}` in `public/index.html` (~line 31)
  - Source of truth: `ThemeProvider.tsx` `dark-void` theme
  - Key changes: `--bg:#080808`, `--accent:#a0a0a0`, `--border-focus:#888888`, all vars mapped

- [ ] **System prompt response length** — add 3-paragraph max rule to `agent.js` `SYSTEM_PROMPT` communication section (~line 76)
  - "For conversational/informational responses, 2-3 paragraphs max. Only write more when task genuinely requires it."

- [ ] **Quality audit** — navigate to pocket.graysoft.dev, send test prompts, screenshot, analyze

- [ ] **PM2 reload** after any `agent.js` changes (`pm2 reload pocket-guide`)

### App — CHANGES_LOG.md
- [ ] Log the auto mode model name removal to `C:\Users\brend\IDE\pipeline-clone\CHANGES_LOG.md`

---

## NOTES

- **Never build the app** — say "Ready to build." User builds.
- **Both trees**: any IDE `main/` changes also go to `pipeline-clone/main/`
- **Pocket Guide** is NOT in the IDE tree — no mirroring needed for those files
- Website is live at `C:\Users\brend\IDE\website\` (Next.js), deployed via `sync + pm2 reload graysoft`
- Pocket Guide PM2 process: id 17, name `pocket-guide`
