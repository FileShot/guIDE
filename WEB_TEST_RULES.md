# guIDE Web Testing Environment — Complete Reference

> **To start a test session:** Tell the agent "read WEB_TEST_RULES.md" — this file contains everything needed.
> Last updated: 2026-03-13

---

## 1. THE ENVIRONMENT

### What It Is
guIDE running as a web app instead of an Electron app. The EXACT same backend pipeline
(`llmEngine.js`, `agenticChat.js`, `mcpToolServer.js`, all of `main/`) runs unchanged.
The only difference: the transport is WebSocket + HTTP instead of Electron IPC.

This lets the agent interact directly with the app through browser MCP tools, making it
possible to test, diagnose, and reproduce bugs without building a new installer.

### URLs
- **Public URL:** https://dev.graysoft.dev
- **Local URL:** http://localhost:3200 (same thing, faster for local checks)

### Architecture
```
Browser (agent's MCP browser tools)
  → https://dev.graysoft.dev
  → Cloudflare Tunnel (guide-dev)
  → http://localhost:3200
  → server.js (Express + WebSocket)
  → main/ pipeline (100% identical to Electron app)
```

---

## 2. HOW TO START EVERYTHING

### CRITICAL — NEVER USE BLOCKING TERMINAL COMMANDS
**NEVER run `node server.js` or ANY long-running command with isBackground=false.**
This causes "Terminal is awaiting output" which STOPS the agent's response and WASTES a premium request.
**ALWAYS use isBackground=true for server starts.** If the server crashes, read the error from `get_terminal_output` — do NOT re-run in foreground. Every "focus terminal" incident costs real money.

### Step 1 — Start server.js (the backend)
```powershell
# ALWAYS start as background process (isBackground=true):
node C:\Users\brend\IDE\server.js
```
Or use the npm script:
```powershell
cd C:\Users\brend\IDE
npm run start:web
```
Leave this running. It logs to console AND to:
`C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log`

### Step 2 — Start the Cloudflare tunnel
```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\guide-dev-config.yml" run
```
Leave this running. The tunnel stays up as long as this process runs.

### Step 3 — Verify everything is live
```powershell
(Invoke-WebRequest -Uri "https://dev.graysoft.dev" -UseBasicParsing).StatusCode
# Should return: 200
```

### Check if server is already running
```powershell
Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
```

### Check if cloudflared tunnel is already running
```powershell
Get-Process cloudflared -ErrorAction SilentlyContinue
```

---

## 3. LOGGING — What Exists and How to Access It

### Primary application log (same as Electron)
```powershell
# Read:
Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"

# Clear (do this before EVERY test run):
Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"

# Tail (live follow):
Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log" -Wait -Tail 50
```

### Node.js console output (what server.js prints)
The server prints all console output directly. If you started it in a terminal, it's visible there.
It also tees to the guide-main.log via the logger intercept.

### Crash logs (uncaught exceptions)
```
C:\Users\brend\AppData\Roaming\guide-ide\crash-logs\
```

### Browser console (WebSocket events, frontend errors)
Use the MCP browser tool `mcp_microsoft_pla_browser_console_messages` to see all browser console output including WebSocket errors.

### Real-time WebSocket traffic
Navigate to `dev.graysoft.dev` then use:
```
mcp_microsoft_pla_browser_evaluate → window.__wsDebug = true
```
(if debug mode is enabled)

---

## 4. MODEL SELECTION

### Primary model folder
```
D:\models\qwen3.5\
```
server.js scans this folder automatically on startup. All .gguf files in that folder appear in the model list.

### To load a model
1. Navigate to `dev.graysoft.dev`
2. Click the model selector in the status bar (bottom right says "Initializing..." or current model name)
3. Select from the dropdown
4. Or use the AI Chat panel → click the model name

### Available models (verify by running)
```powershell
Get-ChildItem "D:\models\qwen3.5\" -Filter "*.gguf" | Select-Object Name, @{n='GB';e={[math]::Round($_.Length/1GB,1)}}
```

---

## 5. TESTING RULES — NON-NEGOTIABLE

### Rule 1 — ABSOLUTE RULE: No Hard-Coding to Pass Tests
This is the single most important rule.

**NEVER modify any pipeline file to make a specific test pass.**
- Do not add keyword matchers, response filters, or special-case logic that only
  applies to the specific prompts used during testing
- Do not add `responseContains` strings the model already outputs
- Do not add `DON'T` rules to the system prompt targeting a single failing test
- The test suite exists to reveal real behavior, not to be taught to

If a test fails, the failure IS the finding. Log it. Diagnose the root cause.
Only make changes that would help ALL users with ALL prompts on ALL hardware.

### Rule 2 — Be a Normal User
When testing, use exactly the prompts a real user would type:
- Typos, run-on sentences, ambiguous phrasing
- Multi-part requests ("can you do X and also Y?")
- Follow-up messages that reference prior context
- Edge cases: very short messages, very long messages, code pastes
- NO hand-holding prompts designed to succeed ("please call the read_file tool and...")

### Rule 3 — Score All Three Dimensions
Every test response must be evaluated on all three:
1. **Coherence** — Does the response make sense? Is it relevant? Does it address what was asked?
2. **Tool correctness** — Were tools called when needed? Not called when not needed?
3. **Response quality** — Is the content accurate? Does it get the right file/function/answer?

A test passes ONLY when ALL THREE are satisfactory. A single dimension does not override the others.

### Rule 4 — After Every Test Run: Changes Must Mirror Pipeline
Any change validated as beneficial during testing MUST be applied to BOTH:
- `C:\Users\brend\IDE\main\` (production source)
- `C:\Users\brend\IDE\pipeline-clone\main\` (pipeline clone)

No exception. A change that only lives in one tree is not done.

### Rule 5 — No Speculative Changes
The pipeline is FROZEN during a test loop. No modifying source code to "try something"
mid-test. Finish the test loop, analyze findings, then plan changes separately.

### Rule 6 — Verbose Logging During Tests
Before starting any test:
```powershell
Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"
```
After the test:
```powershell
Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"
```
The log must be clear before each test so findings can be isolated.

### Rule 7 — GPU VRAM Check Before Load Tests
Before any test involving model inference:
```powershell
nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits
```
If free VRAM < 2800MB, do NOT run inference tests. Results on VRAM-constrained
hardware are hardware-degraded and cannot be trusted for diagnosing pipeline issues.

### Rule 8 — No Cheerleading
Test results are reported as defects found. If nothing broke, state exactly what
was checked and that no defect was found in those dimensions. Never say "great results",
"working well", "looking good", or any positive framing. Report facts only.

---

## 6. HOW TO CONDUCT A TEST SESSION

### Pre-test checklist (run every time before starting)
```powershell
# 1. Verify server is running
Get-NetTCPConnection -LocalPort 3200 -State Listen

# 2. Verify tunnel is running
Get-Process cloudflared

# 3. Clear logs
Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"

# 4. Check VRAM if doing inference tests
nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits

# 5. Navigate to the app
# (agent uses: mcp_microsoft_pla_browser_navigate to https://dev.graysoft.dev)
```

### MANDATORY: Take screenshots constantly
- Take a screenshot with `mcp_microsoft_pla_browser_take_screenshot` **before and after every significant action**: sending a prompt, clicking a button, observing a response, switching models, seeing an error.
- Screenshots give the only true visual on what is happening. Never rely solely on the DOM snapshot — screenshots show what the user actually sees.
- After every test prompt: screenshot to capture the full response as rendered.
- When something looks wrong or unexpected: screenshot immediately before taking any other action.
- Screenshot filenames should be descriptive: `test1-prompt-sent.png`, `test1-response.png`, `model-switch.png`, etc.

### MANDATORY: Always use a LOCAL model — NEVER cloud
**The app defaults to "guIDE Cloud AI". This MUST be switched to a local model before ANY test.**

Testing the cloud AI tells us nothing about the local pipeline. Every test must use a local model from `D:\models\qwen3.5\`.

**How to switch to local model at the start of every session:**
1. Take a screenshot to confirm current model (look at bottom of chat panel — it shows the active model)
2. In the chat panel, look at the bottom toolbar — there is a model chip showing "guIDE Cloud AI ×" or similar
3. Click on the model selector chip to open the model list
4. Select a local model (e.g. `Qwen3.5-4B-Q8_0` or `Qwen3.5-2B-Q8_0` for quick tests)
5. Take a screenshot to confirm the local model is now active
6. The statusbar at the bottom of the screen also shows the active model name

**If the model list shows "mmproj-*" files:** These are multimodal projection files, not chat models — do not select them. Select models named `Qwen3.5-*-Q*` or similar.

**Recommended test models from `D:\models\qwen3.5\` (by size):**
- `Qwen3.5-2B-Q8_0.gguf` — 1.9 GB, fast, good for quick pipeline checks
- `Qwen3.5-4B-Q8_0.gguf` — 4.2 GB, better quality, fits in 3500MB VRAM with CPU offload
- `Qwen3.5-9B-Q4_K_M.gguf` — 5.2 GB, best quality that fits in available VRAM

### CRITICAL: Chat Panel Behavior
- The chat panel is ALREADY OPEN when the page loads with a project. Do NOT click "AI Chat" or "Toggle Secondary Sidebar" — clicking these will CLOSE the panel, not open it.
- If you accidentally close it, click the toggle once to reopen.
- Never toggle the chat panel as part of normal test setup — it starts visible.

### During testing (agent workflow)
1. Navigate to `https://dev.graysoft.dev`
2. **REQUIRED: Open or create a project first.** The chat panel and most features do NOT activate until a folder is open. Click "New Project" or "Open Folder" from the start screen, OR use File → Open Folder. Without a project open, the secondary sidebar (chat) will not render. A blank project like `my-blank-apphhj` is fine for pipeline tests.
3. The chat panel should already be visible on the right. Do NOT click "AI Chat" or toggle buttons — the panel is already open. If it isn't visible, click "Toggle Secondary Sidebar (Ctrl+L)" ONCE.
4. Select a model from `D:\models\qwen3.5\`
5. Run test prompts as a normal user would type them
5. Read response in the browser (take screenshot + read snapshot)
6. Read log after each exchange
7. Record findings per the reporting format below

### Post-test
```powershell
# Read the full log
Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"
```

---

## 7. TEST RESULT REPORTING FORMAT

Use this format for every test result:

```
TEST: [what the user typed — exact]
MODEL: [model name and size]
CONTEXT SIZE AT TEST: [tokens, from log or UI]
CONTINUATION TRIGGERED: [yes/no, count if yes]
CONTEXT ROTATION TRIGGERED: [yes/no, count if yes]

RESPONSE SUMMARY: [what the model actually said — quote the key parts]

DIMENSION 1 — Coherence: [PASS/FAIL — specific observation]
DIMENSION 2 — Tool use: [PASS/FAIL — which tools called, whether correct]
DIMENSION 3 — Response quality: [PASS/FAIL — specific observation about accuracy]

DEFECTS FOUND:
  - [exact quote of defective text or behavior, with explanation of WHY it is defective]
  - None found in [list of dimensions checked], or specific defect descriptions

LOG EVIDENCE:
  - [paste the relevant log lines]

OVERALL FINDING: [factual statement, no cheerleading]
```

---

## 8. MANDATORY TEST DIMENSIONS — CONTEXT SYSTEM STRESS

> **Core principle:** The context management systems (seamless continuation, context
> summarization, context compaction/rotation) exist so that a model with ANY context
> size — 5,000 or 100,000 — can theoretically produce one million lines of output in a
> single task. Quality/bugs in the generated code are secondary. The PRIMARY concern is:
> does the pipeline START, CONTINUE, and FINISH long tasks through multiple rotations
> without breaking, stalling, duplicating, or losing track of what it was doing?

### Recommended Model for Stress Testing
Use **Qwen3.5-4B-Q8_0** (4.2 GB) or **Qwen3.5-9B-Q4_K_M** (5.2 GB). Do NOT use the
0.8B model for stress testing — it is too small to produce meaningful multi-turn output.
Switch between models across sessions to test different context/VRAM profiles.

---

### Dimension 1 — Context Rotation + Recall
**What to test:** Have a multi-turn conversation that fills context to the point where
compaction/rotation triggers. After rotation, verify the model still knows what it was
doing and can continue the task.

**How:**
1. Give the model a complex multi-step task (e.g., "Build me a full Express REST API
   with auth, CRUD for users/posts/comments, middleware, error handling, and tests")
2. Let it work through several turns, generating code and explanations
3. Watch the context counter in the UI — when it approaches the limit, compaction fires
4. After compaction fires, ask a follow-up that references earlier context:
   "What was the auth middleware you wrote earlier?" or "Add rate limiting to the
   routes you already created"
5. Check: does it recall the earlier work? Does it reference files it already created?
   Does the rolling summary preserve the key facts?

**What to report:** Context token count at rotation, what the rolling summary preserved
vs lost, whether the model could continue the task coherently after rotation.

---

### Dimension 2 — Seamless Continuation (Long Output)
**What to test:** Request output that far exceeds `maxResponseTokens` (4096). The
seamless continuation system should automatically continue the response without user
intervention, stitching output together seamlessly.

**How:**
1. Ask for a very long file: "Write a complete 800-line React component with full
   state management, form validation, API integration, error handling, and comments"
2. Or: "Write a comprehensive Python module with 20 utility functions, each with
   docstrings, type hints, error handling, and unit tests inline"
3. Watch for continuation triggers in the log (look for `seamless continuation` or
   `maxTokens reached`)
4. Check the full output for: duplicate text at stitch boundaries, missing text,
   broken code blocks, sentence fragments, loss of coherence

**Critical check:** The output must be one continuous, coherent piece — no visible
seams. Code must be syntactically valid across continuation boundaries.

---

### Dimension 3 — Long File Generation Mid-Context-Trigger
**What to test:** Request a file SO long that context rotation/compaction fires WHILE
the model is mid-file-generation. This is the hardest test — the model must resume
writing the same file after context management intervenes.

**How:**
1. First fill context partway with a few turns of conversation
2. Then ask: "Write a complete 1500-line TypeScript file implementing a full ORM
   with query builder, migrations, relationships, validation, and connection pooling"
3. The goal: context fills up MID-FILE. Compaction/rotation fires. The model must
   pick up where it left off and finish the file.
4. Check: Is the file complete? Are there duplicate sections? Did the model restart
   from scratch after rotation? Is the code syntactically valid end-to-end?

**What to report:** Exact point where rotation fired (line count of file at that point),
whether the model resumed correctly, any duplicate/missing/corrupted sections.

---

### Dimension 4 — Todo List Across Rotations
**What to test:** Give the model a task that requires a multi-step plan (todo list).
Verify it creates the plan, updates it as steps complete, and continues updating
correctly even after context rotation.

**How:**
1. Ask: "I need you to build a complete blog platform. Create a todo list for all
   the components needed, then implement them one by one: database schema, API routes,
   authentication, admin panel, comment system, search, and deployment config"
2. The model should create a todo list and begin working through items
3. As context fills and rotation triggers, check: does the todo list survive? Does
   the model still know which items are done vs pending? Does it continue from where
   it left off or restart?
4. After rotation, ask: "What's left on your todo list?" — verify accuracy

**What to report:** Whether todo list was created, how many items completed before
rotation, whether todo state survived rotation, whether the model continued correctly.

---

### Dimension 5 — Summarization Quality Under Pressure
**What to test:** After multiple rotations, check what the context summarization
system preserved. The rolling summary should capture: goal, completed work, file
names, key decisions, and current state. It should NOT lose critical context.

**How:**
1. Run a long multi-turn session (10+ turns with substantial code generation)
2. After at least one rotation, ask diagnostic questions:
   - "What files have you created so far?"
   - "What was the original task I gave you?"
   - "What's the current state of the project?"
3. Compare answers to what actually happened
4. Check logs for what the summarizer/rolling summary actually contains

**What to report:** What the summary preserved vs what was lost, whether the model's
answers match reality, specific facts that were dropped.

---

### Dimension 6 — Basic Sanity (Quick Check Only)
Short messages to verify the pipeline isn't fundamentally broken before running
longer stress tests: "hi", "what's 2+2", "explain recursion in Python".
If these fail, stop — something is fundamentally wrong. Fix that first.

---

## 9. WHAT CHANGES ARE ALLOWED AND WHERE

### During a test loop — FROZEN, no changes allowed except:
- Test harness configuration (`pipeline-clone/pipeline-runner.js` assertion fixes only)
- Fixing a broken assertion where the expected value is factually wrong

### After testing — ONLY these five levers
1. System prompt / preamble text — `main/constants.js` (and mirror in `pipeline-clone/main/constants.js`)
2. Tool descriptions — `main/mcpToolServer.js` (and mirror)
3. Sampling parameters — `main/modelProfiles.js` (and mirror)
4. Grammar constraints — `main/modelProfiles.js` (and mirror)
5. Few-shot examples — `main/modelProfiles.js` (and mirror)

**One change per iteration. Verify before making the next.**

### NEVER allowed (regardless of test results)
- Keyword/regex classifiers that match specific user phrasings
- Response filters that strip specific words because a test revealed them
- Any code that would only work for the specific test inputs used during development
- Hardcoded behavior targeting one hardware configuration or model size

---

## 10. ISOLATION GUARANTEE

The `guide-dev` Cloudflare tunnel (ID: `898ad9b3-d942-4c56-9076-d7e1aff84ede`) is:
- ONLY configured to route `dev.graysoft.dev → localhost:3200`
- Running ONLY on this dev machine (not the production server)
- Completely separate from the `graysoft` tunnel (production)
- The cloudflared config at `~/.cloudflared/guide-dev-config.yml` has a `http_status:404`
  catch-all that blocks any non-`dev.graysoft.dev` traffic

The production websites (`graysoft.dev`, `pocket.graysoft.dev`, `cp.graysoft.dev`) are
on a SEPARATE physical server running the `graysoft` tunnel. This dev machine running
the `guide-dev` tunnel has ZERO effect on production.

**If cloudflared on this machine is NOT running with guide-dev-config.yml, production is unaffected.**

---

## 11. TROUBLESHOOTING

### Site not loading at dev.graysoft.dev
```powershell
# 1. Is server.js running?
Get-NetTCPConnection -LocalPort 3200 -State Listen

# 2. Is the tunnel running?
Get-Process cloudflared

# 3. Does local respond?
(Invoke-WebRequest -Uri "http://localhost:3200" -UseBasicParsing).StatusCode

# 4. Start server if not running:
Start-Process node -ArgumentList "C:\Users\brend\IDE\server.js" -WindowStyle Normal

# 5. Start tunnel if not running:
Start-Process cloudflared -ArgumentList "tunnel","--config","$env:USERPROFILE\.cloudflared\guide-dev-config.yml","run" -WindowStyle Hidden
```

### Model not appearing in list
```powershell
Get-ChildItem "D:\models\qwen3.5\" -Filter "*.gguf" | Select-Object Name
```
If models exist but don't show, restart server.js — it scans on startup.

### WebSocket not connecting (app shows "Initializing..." indefinitely)
1. Check browser console for WebSocket errors:
   (agent: use `mcp_microsoft_pla_browser_console_messages`)
2. Check if something else is on port 3200:
   `Get-NetTCPConnection -LocalPort 3200 | Select-Object State, OwningProcess`
3. Hard refresh: Ctrl+Shift+R in browser

### Log file too large to read
```powershell
# Read only last 200 lines:
Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log" -Tail 200

# Search for specific events:
Select-String -Pattern "\[Agentic\]|\[LLM\]|\[Error\]" `
  "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log" | Select-Object -Last 50
```

---

## 12. QUICK START COMMANDS (copy-paste ready)

```powershell
# START EVERYTHING (two terminals)

# Terminal 1 — Backend:
cd C:\Users\brend\IDE ; node server.js

# Terminal 2 — Tunnel:
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\guide-dev-config.yml" run

# Pre-test log clear:
Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"

# Post-test log read:
Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"

# VRAM check:
nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits

# List models:
Get-ChildItem "D:\models\qwen3.5\" -Filter "*.gguf" | Select-Object Name, @{n='GB';e={[math]::Round($_.Length/1GB,1)}}
```

---

## 13. THE GOAL — What We Are Trying to Achieve

**Context size should NOT matter.** A model with a 2,000 token context window should be able to print a million lines of code — coherently, from start to finish, without losing track, without restarting, without content regression.

The pipeline has three systems (seamless continuation, context summarization, context compaction/rotation) that exist to make this possible. The TOP PRIORITY is getting these systems to work so the model can "print forever" — outputting arbitrarily long content through multiple continuations and rotations without breaking.

Until this works reliably, everything else (UI polish, response quality tuning, etc.) is secondary. The north star metric is: **can the model start a long task and complete it end-to-end through as many rotations as needed?**

**Success looks like:**
- Model starts writing a large file
- Hits maxTokens → seamless continuation picks up exactly where it left off
- Context fills → rotation fires, model remembers the task and continues from the right place
- File grows monotonically (never shrinks, never restarts from scratch)
- Final output is coherent and complete

**Failure looks like:**
- Line count drops (content lost during continuation/rotation)
- Model restarts the file from scratch after rotation 
- Model produces duplicate content
- Model stalls during continuation prompt eval
- Model loses track of what it was doing
- Filename changes after rotation (lost context about what it was building)

---

## 14. TESTING LOOP — How to Run Continuous Tests

When the user says "go on a testing loop" or "start testing", follow this section exactly.

### The Loop Flow
```
TEST → IDENTIFY ISSUE → READ **ALL* RULES IN COPILOT_INSTRUCTIONS AND WEB_TEST_RULES → IMPLEMENT FIX → ACCOUNTABILITY CHECK → REPEAT X100!
*READ READ READ!!! SAY "READ IT" IF YOU ACTUALLY DID!!!!! BELOW!
**CRITICAL!!!!! YOU MUST ADJUST YOUR TODO IT TO FIT THE LOOP FLOW MOLD. EVERY SINGLE TIME!!!!!!!!!!!!!! "TEST → IDENTIFY ISSUE → READ **ALL* RULES IN COPILOT_INSTRUCTIONS AND WEB_TEST_RULES → IMPLEMENT FIX → ACCOUNTABILITY CHECK → REPEAT X100"**
```

*CRITICAL* !!!!
**DO NOT** STOP ITERATING OR STOP TESTING TO ASK USER QUESTIONS! YOU CAN IMPLEMENT CHANGES FREELY AS YOU TEST IN ACCORANCE TO THE RULES AND INSTRUCTIONS HERE AND IN COPILOT_INSTRUCTIONS.MD!


### Before EVERY Test
1. Clear logs: `Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"`
2. VRAM check: `nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits` (need >2800MB)
3. New conversation in the browser
4. State which model is loaded and what you're testing

### Prompt Rules
- **NEVER use the same prompt twice** — every prompt must be drastically different
- **NEVER tell the model how long the output should be** — that's unrealistic. Real users don't say "write 500 lines". They say "build me a complete REST API" or "create a game engine"
- **Every prompt MUST stress context limits** — ask for things that will produce large output naturally
- **Prompts must be BIG** — don't hand-hold. Ask for complex multi-file systems, entire applications, comprehensive implementations. The goal is to stress the pipeline, not test simple responses.
- **The acid test**: A model with a 5,000 token context window should be able to create a 10,000+ line document in one iteration from start to finish. Closing tags, opening tags, fully complete. The pipeline's three systems exist to make this possible regardless of context size.
- **Generate thousands of lines in a single file** — this is how you stress stitching, continuation, and rotation. If the model only produces 50-100 lines, the prompt wasn't demanding enough.
- Example prompts (USE THESE AS INSPIRATION ONLY — never copy verbatim):
  - "Build me a complete inventory management system in Python with database models, API endpoints, authentication, and admin dashboard — all in one file"
  - "Create a full chess engine in TypeScript with move validation, AI opponent, board rendering, and comprehensive unit tests"
  - "Write a complete compiler for a simple programming language — lexer, parser, AST, and code generator with all the helper functions"
  - "Implement a real-time chat server with rooms, user management, message history, WebSocket handling, and an HTML client — everything in one comprehensive file"
  - "Create a complete game — Snake, Tetris, or similar — with full game logic, rendering, input handling, scoring, and menus"

### During Generation — CONSTANT MONITORING
- **Take screenshots every 5 seconds** — NOT every 15, NOT every 30. Every 5 seconds. This is non-negotiable.
- **Never sleep longer than 10 seconds** between checks
- **NEVER end a test early** — let the model completely finish its entire generation. If it takes 20 minutes, wait 20 minutes. If it takes an hour, wait an hour. Early termination produces incomplete data.
- Watch for: line count changes, context % changes, speed changes, "Reasoning..." appearing, status messages
- If line count DROPS — that's a bug. Note it immediately.
- If file name changes after rotation — that's a coherence defect. Note it.
- If "Waiting for response..." appears for more than 2 minutes after continuation — the stall watchdog may be involved. Check logs.
- **NEVER say things are going well when they aren't** — no cheerleading, ever. This is the PRIME rule of testing.
- **Monitor the todo list** — if the model has a todo system, watch whether it checks items off as it goes. If it drops the todo list after rotation, that's a defect.

### After Each Test — Required Report
```
TEST REPORT
===========
PROMPT: [summary of what was asked]
MODEL: [which model, how many GPU layers]
DURATION: [how long the test ran]
CONTINUATIONS: [how many seamless continuations triggered]
ROTATIONS: [how many context rotations triggered]
FINAL OUTPUT: [line count, file name, coherence assessment]
DEFECTS FOUND:
  - [specific defect with evidence]
  - [or "None found in dimensions checked"]
LINE COUNT PROGRESSION: [e.g., 0 → 150 → 252 → 203 (REGRESSION) → 173 (REGRESSION)]
CONTENT INTEGRITY: [did content shrink? restart? duplicate?]
```

### When a Defect is Found — Fix Flow
1. **STOP the current test** (stop generation if needed)
2. **Read ALL relevant rules**: copilot-instructions.md, WEB_TEST_RULES.md, guide-project.md
3. **Read the relevant source code** — full call chain, not summaries
4. **Propose the fix** — with PRE-CODE CHECKLIST from copilot-instructions.md
5. **Get user approval** (or if on autonomous loop, verify fix is GENERAL not test-specific)
6. **Implement in BOTH source trees** — main/ AND pipeline-clone/main/
7. **POST-CODE VERIFICATION** from copilot-instructions.md
8. **ACCOUNTABILITY CHECK** (see below)
9. **Update CHANGES_LOG.md**
10. **Restart server** (background!) and retest

### Accountability Check — MANDATORY After Every Fix
Before marking any fix complete, answer ALL of these:
```
ACCOUNTABILITY CHECK
====================
1. Did I hardcode anything specific to this test prompt? [yes/no]
2. Did I add a keyword/regex classifier? [yes/no — BANNED]
3. Would this fix work for ALL users, ALL models, ALL hardware? [yes/no]
4. Did I modify both main/ AND pipeline-clone/main/? [yes/no]
5. Did I use any banned words (confirmed, fixed, resolves, fully fixed, ready, working, all set)? [yes/no]
6. Did I cheerlead (say things were "good" when they weren't)? [yes/no]  
7. Did I specify file length in the test prompt? [yes/no — BANNED]
8. Did I reuse a prompt from a previous test? [yes/no — BANNED]
9. Did I update CHANGES_LOG.md? [yes/no]
10. Did I read copilot-instructions.md before implementing? [yes/no]
```
If ANY answer is wrong, fix it before proceeding.

### Rules That Apply at ALL Times During Testing
- **NO CHEERLEADING — PRIME RULE** — never say "looking good", "great progress", "improvement", "strong results", or any positive framing whatsoever. Report defects and facts ONLY. If you find zero defects, increase test difficulty — you're not testing hard enough.
- **Screenshots every 5 seconds** — not 10, not 15, not 30. Every 5 seconds during active generation.
- **Never end a test early** — the model must completely finish. No premature termination.
- **Test the todo system** — verify the model checks items off its todo list as it progresses. If it loses the todo list after rotation, that's a defect.
- **Both source trees** — every change goes to main/ AND pipeline-clone/main/
- **Different prompt every time** — never repeat a prompt
- **No file length in prompts** — don't say "500 lines" or "at least 300 lines"
- **Pipeline frozen during test** — observe, don't modify source during a test run
- **Log the findings** — CHANGES_LOG.md gets updated after every fix
- **Constant self-checks** — re-read rules frequently because context rotation causes you to forget them
- **What we are testing**: context rotation ability, file stitching across continuations, opening/closing tags integrity, todo list persistence across rotations, model orientation after context compaction

---

### Standard Multi-Turn Test Session Format (Session 14A)

This is the canonical test format to run when validating the pipeline with realistic usage patterns. Follow this EXACTLY every time.

#### Key rules for this format (READ BEFORE EVERY SESSION)
- **One session for all tests** — do NOT open a new browser conversation for each test. All tests run sequentially in the SAME session. This tests state, memory, and context management across turns in real usage patterns.
- **Introduce yourself** — start by saying hi to the model and telling it your name. Do not say what you're testing. Just greet it naturally.
- **Never hint about tools** — do NOT say "use web_search" or "look that up online". Do NOT tell the model which tool to use. Let it decide. If it fails to use a tool, that is a defect to log.
- **Never say positive words** — "good", "excellent", "great", "nice", "perfect", "impressive" are ALL BANNED from your vocabulary during testing. You are a hostile quality auditor. Report facts and defects only.
- **Screenshots every 5 seconds AND log monitoring simultaneously** — take a screenshot, immediately run a log tail, take another screenshot. Never go more than 5 seconds without a screenshot during active generation. Never go more than 10 seconds without checking the log.
- **Be extremely critical of both UI and backend** — check visual rendering, check log output, check context percentage, check tool calls, check code block integrity. Everything is potentially defective until proven otherwise.

#### The prompt sequence (in order, SAME session)
**Turn 1 — Greeting (Sanity Check)**
Greet the model. Say hi and give a name (different every session — pick any name that isn't the previous one). Do NOT use "hi how are you" verbatim — vary the greeting. Observe: does it respond naturally and conversationally? Any tool calls on a greeting are a defect.

**Turn 2 — Real-Time Cryptocurrency Price**
Ask for the current price of a cryptocurrency. Do NOT specify which one to use the same way each time — rotate through: Solana, Ethereum, Cardano, Avalanche, etc. (Not always Bitcoin). Do NOT say "what does X cost" in the same phrasing. Vary it: "what's SOL trading at right now?", "how much is Ethereum worth today?", "can you check the current ADA price for me?". Observe: does the model use web_search without being asked? Does it say it can't access the internet? If it says it cannot access the internet, that is a defect — the model has web_search available.

**Turn 3 — Real-Time Weather**
Ask for current weather in a city. Rotate through different cities each session: Las Vegas NV, Miami FL, Denver CO, Toronto Canada, London UK, Tokyo Japan, etc. Do NOT use the same city twice. Phrase it naturally: "what's it like outside in [city] right now?", "is it raining in [city] today?". Observe: does the model use web_search? Does it give training-data weather vs real weather?

**Turn 4 — Implicit Multi-Step Task (Todo List Trigger)**
Give the model a task that implicitly requires planning multiple steps — something with multiple distinct components. DO NOT say "make a todo list". DO NOT say "plan this". Just describe the task. Examples: "I need to build an e-commerce checkout system with cart, payment processing, order confirmation, and email receipts — can you put it all together for me?", "I want a blog platform that has posts, comments, user accounts, and a search feature". Observe: does the model autonomously call write_todos? Does it create the list without being asked? Does it then work through the list item by item and check items off? If it gives a text-only plan without calling write_todos, that is a defect.

**Turn 5 — Massive Code Generation (Stress Test)**
Give a very large, very detailed multi-paragraph prompt describing a complete website or application with specific design, functional, and technical requirements. Be specific about: colors/theme, sections, features, functionality, page layout, embedded CSS, embedded JavaScript. Do NOT specify line counts. The goal is that the model would naturally need 1500+ lines to fulfill the requirements. The prompt should be 3-6 paragraphs of dense requirements. Observe:
- Does the model call write_file (or multiple write_file calls) instead of outputting code as a chat message?
- Does the code generation stall, restart, or stop mid-way?
- Are code blocks complete (opening and closing tags, no truncation)?
- Does context rotation fire? If it does, does the model remember the task and continue from where it stopped?
- Is the final file complete and coherent, or does it stop at an incomplete point?
- Does the todo list (if created) get updated as the model progresses?

#### After the session — mandatory check
After all 5 turns, run the test report format from Section 14 for each turn separately. Note which defects appeared in which turns. Cross-reference the log for each turn's iteration count, context percentage, tool calls, and any error messages.
