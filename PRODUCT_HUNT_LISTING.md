# guIDE — Product Hunt Listing

---

## Name
guIDE

## Tagline
The AI-native IDE that runs entirely on your machine.

*(alt options — pick one)*
- "VS Code was built before AI. guIDE wasn't."
- "Local LLM + 52 autonomous tools + full IDE. Zero cloud required."
- "The IDE where the AI actually owns a computer."

---

## Topics / Tags
`Developer Tools` · `Productivity` · `Artificial Intelligence` · `Open Source` · `Desktop App`

---

## Description

**guIDE** is a desktop IDE built from the ground up for the AI era — not a VS Code fork with an AI extension bolted on.

Your code runs locally. Your models run locally. Nothing leaves your machine unless you want it to.

**What makes it different from Cursor / Copilot / Windsurf:**

| | Cloud IDEs (Cursor, Copilot) | guIDE |
|---|---|---|
| Your code | Sent to cloud servers | Never leaves your machine |
| Local LLM | Not supported | node-llama-cpp with CUDA/Vulkan GPU acceleration |
| Agent tooling | Limited, cloud-gated | 52 MCP tools the AI uses autonomously |
| Cost | $10–20/month, forever | Free with local models |
| Offline | Never | Fully offline — airplane, classified, or just private |

**The IDE itself:**
- Monaco editor (VS Code's engine) — syntax highlighting, multi-cursor, IntelliSense, git blame, split editor
- Integrated terminal (node-pty + xterm.js)
- File explorer with drag & drop from Windows Explorer
- Code runner for 50+ languages (F5 to run)
- 8 themes, 364 file icons, Mermaid diagrams in chat

**The AI layer:**
- Load any GGUF model — Qwen, Llama, DeepSeek, Mistral — with one click
- CUDA & Vulkan GPU acceleration auto-detected
- RAG-powered codebase indexing — the AI knows your whole project, not just open files
- Persistent memory across sessions
- Agentic mode: up to 100 autonomous iterations with multi-agent support
- Thinking model support (DeepSeek R1, Qwen R1) with collapsible reasoning display

**52 autonomous agent tools:**
- File ops: read, write, edit, delete, rename, grep, glob search, diff
- Browser automation: navigate, click, type, screenshot, evaluate JS, extract data
- Terminal: run any command, watch output
- Memory: read/write persistent notes across sessions
- Git: status, diff, commit, branch
- System: read environment, get file metadata

**9 cloud providers pre-configured** (Gemini 2.5, Groq, OpenRouter, Cerebras, SambaNova, Anthropic, OpenAI, xAI, APIFreeLLM) with automatic failover — use cloud for speed, local for privacy, or both.

Built by a solo developer. Source available on GitHub. Windows build available now, Mac/Linux in progress.

> **Note: The Chrome extension (Side guIDE) is not yet publicly available — coming soon.**

---

## First Comment (Hunter's post)

Hey Product Hunt 👋

I built guIDE because I got frustrated paying $20/month for Copilot while it sent my code to Azure, gave me limited tools, and still couldn't run offline.

So I started from zero. guIDE is a full IDE — Monaco editor, integrated terminal, file explorer, code runner for 50+ languages — with AI woven into every part of it, not stapled on top.

The AI can actually *do things*, not just suggest them. 52 MCP tools. It reads files, writes code, runs terminal commands, controls a browser, searches the web, and remembers context across sessions — all autonomously, all locally.

Local inference runs on your GPU via node-llama-cpp. With a Qwen 3 32B model, it's fast enough to be genuinely useful. With Gemini 2.5 Flash (free tier, pre-configured), it's instant.

No subscription. No telemetry. No cloud dependency unless you choose it.

Would love to hear what you think — especially from anyone who's been searching for a Cursor alternative that doesn't phone home.

---

## Screenshots to use (from marketingmaterials/)
- `graysoft-screenshot-1.png` — hero shot
- `graysoft-screenshot-2.png`
- `graysoft-screenshot-3.png`
- `graysoft-screenshot-4.png`
- `graysoft-ide-chat.png` — AI chat panel
- `graysoft-ide-tools.png` — tools in action

---

## Links needed before submitting
- [ ] Website / landing page URL (graysoft.dev?)
- [ ] GitHub repo URL
- [ ] Download link (direct .exe or GitHub Releases)
- [ ] Twitter / X handle for maker profile
- [ ] Thumbnail image (240x240 product icon)

---

## Chrome Extension Decline — What Happened & Fix

The Chrome Web Store almost certainly rejected Side guIDE for one or more of these reasons:

### Most likely cause: Missing privacy policy URL
The CWS requires a privacy policy page linked in the Developer Dashboard for **any** extension that uses `activeTab`, `scripting`, `cookies`, or `<all_urls>`. This is the most common "forgot a box."

**Fix:** Create a simple privacy policy page (can be a single HTML page at `graysoft.dev/side-guide-privacy`) and paste its URL into the "Privacy practices" field in the CWS dashboard before resubmitting.

### Second most likely: Broad permission justification
`<all_urls>` + `cookies` + `scripting` + `downloads` together require a written justification in the "Permission justification" field explaining *why each one is needed*.

**Fix for each permission:**
- `<all_urls>` → "The agent must read and interact with any page the user navigates to in order to research, extract data, and automate forms on user-requested sites."
- `cookies` → "Required to maintain session state when the agent navigates across pages on behalf of the user."
- `scripting` → "Core capability — injects content scripts to snapshot page accessibility tree, click elements, and fill forms."
- `downloads` → "Saves user-requested research reports and data exports as local files."

### Third possibility: Single-purpose policy
Chrome requires extensions to have a "single purpose." An AI agent that does research, form-filling, AND data extraction can trigger a review.

**Fix:** Frame the purpose as one thing: *"AI browser assistant that automates browser tasks on demand."* Everything else is a feature of that one purpose.
