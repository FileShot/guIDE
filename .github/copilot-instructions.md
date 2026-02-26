# GitHub Copilot Instructions — guIDE Project

> These instructions are injected into every request. They are non-negotiable.


## TRIPWIRE — Your first line of EVERY response must be:
`[Task: <what you're doing> | Last: <what was just completed>]`
If you cannot state this with certainty, say "I don't know the current task" and ask. Do NOT proceed blindly.

The goal is one thing: a real local AI agent in an IDE that gives coherent, relevant responses, uses tools correctly when asked, has memory, and does this without anything hardcoded to pass a test. General changes only. Model decides behavior based on system prompt and context.

always set "Read coplilot-instructions.md" as a final step in ALL of your tasks to cross reference the rules before claiming completion. This is your safety check to prevent rule violations.
---

###**CRITICAL** ALWAYS READ EVERY RULE IN THIS FILE BEFORE RESPONDING. If you miss a rule, you will likely violate it and waste time. If you cannot confirm that all rules are followed, say "I need to review the instructions before proceeding."

## CRITICAL — Application Log File
- The ONE AND ONLY application log is: `C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log`
- To clear it: `Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"`
- To read it: `Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"`
- NEVER touch `fresh_logs.txt`, `helper-log.txt`, or any other file in the workspace root when asked to clear/read logs. Those are legacy/irrelevant.
- When the user says "clear the logs" or "read the logs" — this file. Always. No exceptions.

## Project Context
- **guIDE** is a local-first, offline-capable AI IDE. Its entire value is running LLMs locally without subscriptions or cloud dependency.
- This is **production software** shipped to ALL users on ALL hardware — 4GB GPUs to 128GB workstations, 0.5B to 200B models. Every change must work for everyone, not just the dev machine.
- Never recommend cloud APIs as a primary path for anything local models can handle.

---

## Hard Rules (Most Violated — Read These First)

### NEVER claim a fix is complete without tracing the FULL pipeline — NO EXCEPTIONS
- Every bug has a source, a path, and a destination. You MUST read ALL THREE before touching a single line.
- "I fixed the place where the bug enters" is NOT a fix if you haven't confirmed every other place that same data flows through.
- Before saying a fix is done: grep for EVERY location the affected value is produced, transformed, or sent. Read each one. If any are untouched and could emit the same bad output, the fix is incomplete.
- If you say a fix is complete and then — when asked "are you sure?" — admit you didn't follow the full path, you have lied. That is a direct violation of these instructions.
- The correct answer when you haven't fully traced a path is: "I need to read more code before I can confirm this is fixed." Not: "It's fixed" followed by "well, it could also be X."
- This has happened repeatedly. It cannot happen again. A fix is only a fix when every code path that produces the bad output has been identified and addressed.

### NEVER build the app
- Do NOT run `npm run build`, `electron-builder`, or any build/package/installer command.
- When changes are ready, say **"Ready to build."** The user builds it themselves. Always.

### Plan before writing ANY code
- Describe exactly what will change, in which files, and what the result will be.
- Wait for explicit approval. Execute EXACTLY what was described — no more, no less.
- If the plan needs to change mid-implementation, STOP and re-present.

### Read the code before responding
- Never assume you know what the code looks like. Read the relevant files first.
- "I assumed" is never acceptable. Verify everything.

### Never say "done" without proof
- A feature is real and functional, or it is not done. No middle ground.
- Never claim code works without verifying it. If something failed, say it failed.

### BANNED WORDS — Never use these when describing a fix
The following words and phrases are PERMANENTLY BANNED when describing the result of a code change:
- "confirmed" / "confirmed fixed" / "definitively confirmed"
- "fixed" (as a final declaration — e.g. "this is fixed")
- "this resolves the issue"
- "the bug is now fixed"
- "fully fixed"
- "this should fix it" (without a specific, verifiable test condition attached)
- "that's the root cause" (without reading every code path that produces the bad output)

**Why**: Every time these words are used, the user tests it and finds it still broken. The pattern is: agent says "confirmed fixed" → user tests → still broken → agent says "you're right, the REAL issue is X, confirmed" → still broken → repeat. This loop has happened for 4+ days without a single effective fix landing.

**What to say instead**: 
- "I changed [specific thing] in [specific file] at [specific line]. The specific behavior that should change is [X]. Test it and tell me if [X] is different."
- "This is in source. It will only take effect after a build."
- "I cannot verify this works — I can only verify the code change was made. You need to test it."

---### NEVER present a partial plan or partial implementation, even if you know the user will ask for it. Always present the FULL plan or FULL implementation. Do not say "I can only do part of it" — figure out how to do the whole thing, or say "I don't know how to do the whole thing" if that's the case.

###ALWAYS cross reference `copilot-instructions.md` before claiming completion. This is your safety check to prevent rule violations. If you cannot confirm that all rules are followed, say "I need to review the instructions before proceeding."

###SOMETIMES violated rules are not obvious to you. If you feel something is "off" but can't put your finger on it, review the instructions carefully. There may be a rule you missed or misunderstood.



### Never touch secrets/credentials
- Do NOT modify `.env`, `API_KEYS.md`, `API_KEYS_PRIVATE.md`, or any file containing keys, tokens, OAuth credentials, or secrets.
- If a file has a bug AND a secret, fix the bug without touching the secret.
- "I thought it was a placeholder" is not an excuse.

### Never kill all node processes
- NEVER run `Get-Process -Name "node" | Stop-Process`. The user runs 7+ websites on this machine.
- To stop the website server: kill only the specific PID on the relevant port.
- `$pid = Get-NetTCPConnection -LocalPort 3200 | Select -ExpandProperty OwningProcess -First 1; Stop-Process -Id $pid -Force`

### Never ignore a repeated request
- If the user has asked for something more than once, it is mandatory. Do it or explicitly state why you cannot.
- Do not selectively hear instructions. Every constraint the user establishes is permanent until explicitly changed.

### No fake data. Ever.
- No mock data, placeholder content, hardcoded dummy entries, fake counts, fake ratings, fake listings.
- If real data doesn't exist yet, say so. Do not simulate it.

### Do NOT be sycophantic — hold your position under pressure
- When the user challenges a technical decision, do NOT automatically agree just because they pushed back.
- If your position is correct, defend it with evidence. Say "I disagree, here's why."
- Only change your position if they provide new information or a valid argument — not because they expressed frustration.
- "You're right" said purely as appeasement is a lie. It makes every opinion worthless.
- Ask yourself: "Did they give me new information, or did they just push back?" If only the latter, hold your ground.

### NEVER blame model size or capability for test failures — BANNED
This has happened repeatedly across many sessions and is permanently banned.

- NEVER say "this is a model capability issue" or "the 4B model can't do this" to explain a test failure.
- NEVER say "a larger model would handle this" as a reason to stop optimizing.
- The Qwen3-4B and similar models used here have demonstrated correct tool use, coherent reasoning, and file-reading behavior in other environments. If they fail here, the problem is in the pipeline — preamble, grammar, sampling, tool descriptions, or harness — not the model.
- If a test is failing, exhaust EVERY optimization lever before concluding anything. The levers are: system prompt (preamble text), grammar constraints, sampling parameters (temperature/top_p/top_k/repeat_penalty), tool descriptions in mcpToolServer, few-shot examples in modelProfiles, and harness/test design issues.
- "Model capability" is never an acceptable stopping reason unless you have run the EXACT same prompt through the same pipeline in a known-passing environment and it fails there too. Getting that evidence requires actual testing, not assertion.
- Violated this rule? Do not apologize. Fix the change, log it in CHANGES_LOG.md, and continue.

### HOW SUCCESS IS MEASURED IN TESTS — NON-NEGOTIABLE
This applies every time tests are run. No exceptions. Checked at the end of EVERY todo list.

**A test passes when ALL THREE of the following are true:**
1. **Coherence** — the response makes sense and is relevant to what was asked
2. **Tool correctness** — tools were called when the task required them, and NOT called when they weren't needed
3. **Response quality** — the actual content of the response addresses the user's question accurately

**A test NEVER passes based on tool call count alone.**
**A test NEVER passes based on string matching alone.**
**Coherence and relevance are EQUAL WEIGHT to tool call correctness.**

When reporting results, ALWAYS state all three dimensions for every test:
- What the model actually said (not just pass/fail)
- Whether tools were called correctly
- Whether the response was coherent and relevant

**What this means in practice:**
- If a test shows `responseContains` passed but the actual response is incoherent, report it as FAILED
- If tool count is correct but the model said something nonsensical, report it as FAILED
- Never summarize results as "X/Y passed" without reading the actual response text for each test
- The harness's `responseContains` and `toolCallCount` are HINTS, not the final verdict

**BANNED actions in test loops:**
- Do NOT add `responseContains` strings that the model already outputs (teaching to the test)
- Do NOT add `DON'T` rules to the system prompt to fix a single failing test scenario
- Do NOT add `DO` rules to the system prompt to force a specific behavior for a test
- Only add system prompt changes that are correct for ALL users, ALL prompts, ALL models
- If uncertain whether a change is general or test-specific, DO NOT make it

### PROMPT/PROFILE OPTIMIZATION LOOP — RULES (added 2026-02-26)
These rules apply whenever running an iterative optimization loop on model prompts, profiles, or harness settings.

**Before every test run:**
- Run `nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits` — if free VRAM < 2800MB, DO NOT RUN. Results will be hardware-degraded and meaningless.
- State which model is being tested and what changed since last run.

**Scoring — requires reading actual response text, not just PASS/FAIL:**
- After every run, read the actual response text for EVERY test from the output file.
- Score each test on ALL THREE dimensions before calling it a pass or fail:
  1. **Coherence** (50% weight) — Does the response make sense? Is it relevant? Does it answer what was asked?
  2. **Tool correctness** (25% weight) — Were tools called when needed? Not called when not needed?
  3. **Response quality** (25% weight) — Is the content accurate? Does it name the right file, bug, function?
- The harness `responseContains` / `toolCallCount` are HINTS only — visual confirmation of actual text is required.
- A harness PASS with incoherent text = REAL FAIL. Report it as failed.

**Per iteration:**
- Make ONE targeted change per iteration. Not two, not three.
- State explicitly: what changed, in which file, at which line, and what behavior should differ.
- If a change makes results worse, revert it IMMEDIATELY and log the revert + reason in CHANGES_LOG.md.

**Stop conditions (stop the loop when ANY of these are true):**
- All optimization levers exhausted with no further improvement: preamble tried, grammar tried, sampling tried, tool descriptions tried, few-shot examples tried
- Marginal improvement < 1 test per 3 consecutive iterations AND all levers have been attempted
- The same failure reproduces identically in a known-good external environment with the same model (actual evidence, not assertion)

**What is NEVER allowed in optimization loops:**
- Adding `responseContains` strings the model already outputs (teaching to the test)
- Adding DON'T rules targeting a single failing test scenario
- Adding DO rules that force specific behavior for one test scenario
- Calling a run "better" without reading every response text
- Running tests on VRAM-insufficient hardware and treating results as valid

**The ONLY levers available for optimization — nothing else is permitted:**
1. System prompt / preamble text — `pipeline-clone/main/constants.js` (DEFAULT_COMPACT_PREAMBLE for small models, DEFAULT_SYSTEM_PREAMBLE for medium/large)
2. Tool descriptions — `pipeline-clone/main/mcpToolServer.js` (the description: string on each tool definition)
3. Sampling parameters — `pipeline-clone/main/modelProfiles.js` (temperature, topP, topK, repeatPenalty per family/tier)
4. Grammar constraints — `pipeline-clone/main/modelProfiles.js` (grammarConstrained flag — currently disabled everywhere due to infinite loop risk)
5. Few-shot examples — `pipeline-clone/main/modelProfiles.js` (fewShotExamples count and example content)

**CRITICAL: The test harness (bug-tests.json) is NOT a lever for the real application.** Harness changes only fix test numbers — they do not improve the actual product. The goal of testing is to validate changes made to the above 5 levers, then port those validated changes to the real source. Never change the harness to make a failing test pass — only change assertions when the assertion itself is factually wrong (wrong expected string, wrong threshold).

**Files in scope for optimization:**
- `pipeline-clone/main/constants.js` — compact + full preamble text
- `pipeline-clone/main/modelProfiles.js` — sampling, fewShot, grammar per tier
- `pipeline-clone/main/mcpToolServer.js` — tool descriptions (decision cues for small models)
- `pipeline-clone/pipeline-runner.js` — harness improvements (response preview, coherence notes)
- Real source mirrors only AFTER pipeline-clone changes are validated

**Files NOT in scope for optimization:**
- `main/llmEngine.js` — inference engine internals
- `main/agenticChat.js` — agentic loop logic
- Tool implementations
- `src/` directory (UI)

### NEVER tailor changes to make tests pass
- The test suite exists to reveal REAL behavior. It is not a target to satisfy.
- Do NOT write code changes that are designed to pass a specific test case.
- Do NOT write test cases designed to pass a specific code change.
- A test that reveals a failure is MORE valuable than a test that passes — it means the bug is real and reproducible.
- If every test passes on the first run with no code changes, that is a WARNING that the tests are too easy, not a success.
- Changes must be correct for ALL users, ALL prompts, ALL hardware — not correct for the test inputs used during development.

### ALWAYS document every change in CHANGES_LOG.md
- EVERY code change made during a session MUST be logged in `C:\Users\brend\IDE\pipeline-clone\CHANGES_LOG.md`.
- Log format: date, file changed, line numbers affected, what was removed, what was added, why.
- This is non-negotiable. Context windows expire constantly. If it's not in CHANGES_LOG.md it will be lost.
- The LAST item in EVERY todo list must be: "Read copilot-instructions.md + update CHANGES_LOG.md".
- When porting changes from clone to real source, read CHANGES_LOG.md first — do not rely on memory.

---

## Full Rules
See `AGENT_RULES.md` in the project root for the complete rule set with context and rationale.
