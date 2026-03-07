# Test 36 — Seamless Continuation / Compaction / Context Summarization

> **Reference this file every session.** Pass it to the agent the moment context resets.
> Runner: `pipeline-clone/run-test.js` | Model: configured in MODEL_PATH constant

---

## What This Application Is

**guIDE** is a local-first, offline-capable AI IDE. Its entire value is running LLMs locally without subscriptions or cloud dependency. It is production software shipped to ALL users on ALL hardware — 4GB GPUs to 128GB workstations, 0.5B to 200B parameter models. Every change must work for everyone, not just the dev machine. Cloud APIs are never the answer here. The application proves that even a 1B model on a low-end GPU can complete large, complex tasks — through infrastructure that extends context, tracks task state, and continues generation intelligently.

---

## What We Are Testing

The guIDE application has three context-extension systems that are supposed to let a model
with any native context size (even 1000 tokens) complete a task that requires generating
tens of thousands of characters:

1. **Seamless Continuation** — when the model hits its token limit mid-generation, the system
   silently feeds the last N characters back as context and asks the model to continue from
   exactly where it left off, in the same "bubble" (same message, not a new turn).

2. **Context Compaction** — when chatHistory grows too large, the oldest entries are
   condensed/summarized to free up context while preserving the relevant state.

3. **Context Summarization** — a lightweight extractive summary of the conversation history
   that can be injected as a preamble on context overflow.

**We are NOT testing:** general model intelligence, response perfection, or 100% HTML accuracy.
A couple of syntax errors in a 50,000-character file is expected and acceptable.

**We ARE testing:** Can the three systems above keep a model productive across multiple
continuation passes, resulting in a meaningfully complete output file?

---

## The Exact Prompt

```
Create a fully functional single-file HTML webpage called "site.html" for a modern file
sharing service named "FileShot".

All HTML, CSS, and JavaScript must be embedded in the same file using inline <style> and
<script> blocks. Do not use external files, frameworks, or CDNs.

The result should look like a polished modern SaaS startup landing page.

Design Requirements:
- Dark theme
- Orange accent color
- Glassmorphism UI elements (glassy cards with blur)
- Smooth hover animations
- Modern tech-style fonts
- Clean spacing and layout
- Subtle gradients and shadows
- Beautiful glowing orange buttons
- Smooth transitions
- Mobile responsive design
- Professional visual quality

Layout Structure:
1. Sticky Header Navigation — logo "FileShot", nav links, mobile hamburger menu
2. Hero Section — title, subtitle, CTAs, large drag-and-drop upload zone
3. Drag & Drop Upload Zone — glass card, progress bar, success message, orange glow on drag
4. Features Section — 4–6 glassmorphism feature cards with hover lift and orange glow
5. Pricing Section — Free / Pro / Business cards, Pro highlighted in orange
6. About Section — simplicity, speed, privacy, modern file sharing
7. Footer — logo, nav links, copyright

Interactivity (JavaScript):
- Working drag and drop with file name display
- Simulated upload progress bar
- Smooth scroll navigation
- Mobile menu toggle
- Pricing tab switching
- Scroll-triggered animations
```

---

## What Success Looks Like

A passing run must show evidence of ALL THREE of the following:

### Dimension 1 — Coherence
The model's responses make sense. It understands the task and produces relevant content.
It does not output random characters, word salad, or off-topic responses.

### Dimension 2 — Tool Correctness
- The model calls `write_file` to create `site.html` (not just describes it)
- The model does NOT call `list_directory` or `read_file` before creating a new file
  (creation task — no existing files to explore)
- Tool calls happen when the task requires them; no spurious calls

### Dimension 3 — Response Quality / Continuation Evidence
- `site.html` is created in `pipeline-clone/output/files/`
- The file contains recognizable HTML structure (DOCTYPE, head, body, CSS, JS)
- The seamless continuation system triggered at least once (seen in run-log.txt as
  "Seamless continuation N/50")
- The final file is substantially complete — major sections present even if imperfect

---

## Criteria for "Continuation Working"

Look for this pattern in `pipeline-clone/output/run-log.txt`:
```
[AI Chat] Seamless continuation 1/50 — ... continuing in same bubble
[AI Chat] Seamless continuation 2/50 — ... continuing in same bubble
```
This means the model hit its token limit and the system fed it back. If you see 3+ continuations
and the output HTML file grows with each pass, the system is working.

A FAILING run looks like:
- Zero continuation events — model wrote nothing, or wrote everything in one pass (too short)
- Infinite continuation loop — same continuation fires 50 times with no progress (broken)
- Model called `list_directory` repeatedly and stopped — never created the file
- Model produced gibberish and got stuck

---

## What Is ABSOLUTELY BANNED

These things are permanently banned from both `main/` and `pipeline-clone/main/`.
If you find any of these, remove them immediately and update CHANGES_LOG.md.

### Output Detectors (ALL BANNED — NO EXCEPTIONS)
- Repetition detectors (substring, word-level, any kind)
- Stuttering pattern detectors
- Turn indicator spam detectors
- "Runaway output" / verbose output detectors
- Any code that inspects generated text and calls `cancelGeneration()` based on content

### Output Filters / Strips (ALL BANNED — NO EXCEPTIONS)
- Garbage token regex strips applied to streaming output (`garbageTokenRegex`)
- Turn indicator removal (`assistant|user|system|model|human` replacements)
- Repetitive line deduplication in `sanitizeResponse`
- Any post-processing regex that removes or modifies model output content
- Any `Array.filter()`, `String.replace()`, or `String.slice()` on the model's response
  that is triggered by content detection logic

### What IS Allowed
- The `<think>` / `<thinking>` tag routing — this sends thinking tokens to the thinking panel
  only; it is UI routing, not output stripping. Think content still reaches the thinking display.
- `sanitizeResponse` removing `<think>` block markers from history entries (prevents model
  confusion in multi-turn context — think content was already shown in the think panel)
- Whitespace normalization (`\n{4,}` → `\n\n\n`) and `.trim()` in sanitizeResponse
- Timeout abort (user-configurable, prevents infinite hang)
- User abort (user presses Stop)
- Tool-call abort (abort generation early when a complete tool call is detected — this is
  an optimization, not a filter; the full tool call text is still passed to the next step)
- `model-switch` abort (user switches model)

### Fix Levers (the ONLY things allowed for optimization)
1. `pipeline-clone/main/constants.js` — system prompt / preamble text
2. `pipeline-clone/main/mcpToolServer.js` — tool descriptions
3. `pipeline-clone/main/modelProfiles.js` — sampling params (temperature, topP, etc.)
4. `pipeline-clone/main/agenticChat.js` — agentic loop termination / continuation logic
5. additional infrastrutural tools like the context summarization, compaction, and seamless continuation system


Nothing else. No classifiers, no keyword matching, no intent detection, no output inspection.

---

## Test Setup

**Runner:** `pipeline-clone/run-test.js`
**Run command:** `cd C:\Users\brend\IDE\pipeline-clone; node run-test.js`
**Output files:**
- `pipeline-clone/output/run-log.txt` — IPC events (tool calls, iterations, continuations)
- `pipeline-clone/output/token-stream.txt` — visible tokens emitted to user
- `pipeline-clone/output/think-stream.txt` — thinking tokens (if model has think mode)
- `pipeline-clone/output/last-response.txt` — full final agentic response
- `pipeline-clone/output/files/site.html` — the file the model should write

**Clear before each run:**
```powershell
Clear-Content "pipeline-clone/output/run-log.txt"
Clear-Content "pipeline-clone/output/token-stream.txt"
Clear-Content "pipeline-clone/output/think-stream.txt"
Remove-Item "pipeline-clone/output/last-response.txt" -ErrorAction SilentlyContinue
```

**Model choice:** Use a model that:
- Fits in VRAM (avoid Q8_0 of 3B+ on 4GB VRAM)
- Does NOT have extended thinking mode (no Qwen3 thinking variants)
- Is Q4_K_M or Q4_K_S for 3B–4B range
- Good options on this machine: `qwen2.5-3b-instruct-q4_k_m.gguf`, `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`

**Current MODEL_PATH:** Set in `pipeline-clone/run-test.js` line ~273

---

## Context Config

The runner sets `context.currentFile = null` because this is a creation task (not editing).
Setting it to a non-existent path caused the model to run `read_file` instead of `write_file`.

The preamble in `constants.js` (`DEFAULT_COMPACT_PREAMBLE`) has been updated with:
> "When asked to CREATE a new file that does not exist yet — call write_file immediately.
>  Do not call list_directory or read_file first."

---

## Known Issues / History

| Run | Model | Result | Root Cause |
|-----|-------|--------|------------|
| Run 1 | Qwen3-4B-Instruct Q4_K_M | 6 tool calls (read/list), no write_file, froze | currentFile pointed to nonexistent path; no create rule in preamble |
| Run 2 | Qwen3-4B-Instruct Q4_K_M | No output for 11 min, killed | Qwen3 extended thinking consumed all 5632 tokens in think phase silently |
| Run 3 | Llama-3.2-3B Q4_K_S | Gibberish + repetition detector fired | Q4_K_S quantization too aggressive for 3B; word salad output |
| Run 4 | Llama-3.2-3B Q8_0 | Not enough VRAM (CPU fallback, killed) | Q8_0 too large for 4GB VRAM |
| Run 5 | Qwen2.5-3B Q4_K_M | Infinite seamless continuation loop (50x) | Model produced empty/garbled first response; continuation retried forever |
| Run 6 | Qwen2.5-3B Q4_K_M | 4 write_file calls, site.html = 663 chars, no continuation | write_file OVERWRITES on each call. Context loaded as 9,984 tokens (VRAM binary search). Context full after 2 write_file calls. Seamless continuation never fired — model hit maxTokens cleanly, not mid-fence. Iterations 3–12 produced no tool calls (context full, model emitted built-in out-of-context message). |
| Run 7 | Qwen2.5-3B Q4_K_M | 1 write_file call, site.html = 6,420 chars (10x improvement) | write_file description update + append_to_file description + maxTokens tail injection worked. Model wrote one comprehensive write_file call (6,420 chars) instead of 4 overwrites. MCP partial recovery executed the truncated JSON successfully. _hasUnclosedToolFence continuation fired → iteration 2 model response was a coherent text summary (task considered done). FILE HAS PROPER `</html>` CLOSING TAG — structurally complete. Two artifacts: (1) `"}` at end of file from MCP partial recovery cleanup bug, (2) model did not use append_to_file to add more sections. |
| Run 8 | Qwen2.5-3B Q4_K_M | Fix 4 v1 broke partial recovery — 0 tool calls, no file written | Applied Fix 4 v1 (front-scan for first unescaped `"` in rawTail). Continuation fired (_hasUnclosedToolFence). Continuation response = 11,612-char JSON with literal unescaped newlines → JSON.parse failed at position 291. Partial recovery ran but Fix 4 v1 clipped at first unescaped `"` inside HTML content (e.g. `lang="en"`) → recoveredContent = ~28 chars < 100 guard threshold → recovery rejected. No file written. |
| Run 9 | Qwen2.5-3B Q4_K_M | Fix 4 v2 (tail-strip) — site.html = 11,035 chars, CLEAN ending | Replaced front-scan with tail-strip: only strips `"\s*\}[\s\}]*$` from end of rawTail. Continuation fired (_hasUnclosedToolFence). Continuation produced 11,229-char JSON. THIS TIME: `[MCP] Found tool call in code block: write_file` — the JSON parsed WITHOUT partial recovery path! write_file executed, 11,035 chars written. File ends cleanly with `</html>` — NO `"}` artifact. Iteration 2 returned `{}` → loop ended. Final summary coherent. |
| Run 10 | Qwen2.5-3B Q4_K_M | Preamble-only change — site.html = 8,803 chars, partial recovery | Changed preamble from "if cannot fit in single call" → "always write section by section." Model still wrote entire file in one write_file call (8,803 chars via partial recovery). Model DID NOT break into sections per instruction. Continuation fired once (EOS mid-block). All 7 sections present. Preamble alone insufficient to change model behavior. |
| Run 11 | Qwen2.5-3B Q4_K_M | write_file tool result hint added — site.html = 10,341 chars, BASE CRITERIA MET | Added continuation hint to agenticChat.js toolFeedback builder: after write_file, model receives "First section written. If more sections needed, call append_to_file IMMEDIATELY." Continuation fired once (EOS mid-block). 10,341 chars written via partial recovery. All 7 sections present. BUT: iteration 2 model echoed the hint text as a text response (not a tool call). Model considered task done. BASE 36_TEST CRITERIA MET (1 continuation, file complete, coherent). |
| Run 12 | Qwen2.5-3B Q4_K_M | REGRESSION — write_file description change broke JSON encoding | Added "IMPORTANT: write ONLY head section in first call" to write_file tool description. Model generated 14,276 chars but switched from escaped `\n` to literal newlines inside JSON. JSON.parse failed at position 94. Partial recovery also failed. No file written. CHANGE REVERTED SAME SESSION. |

**Diagnosis from Run 7:**
- 10x size improvement confirms the write_file/append_to_file description changes made an impact
- Model fitted as much as it could into one write_file call — correct behavior per updated preamble  
- `_hasUnclosedToolFence` continuation path fired correctly — proof seamless continuation system works
- New bug found: MCP partial recovery writes `"}` at end of file (JSON closing chars leak into content)
- New issue: continuation fires AFTER MCP already executed the tool (model sees: tool succeeded + "continue the JSON" → confused, writes summary instead of appending more content)
- Root cause of no append_to_file: the continuation message targeted the truncated JSON fence, not document continuation

**Diagnosis from Run 8:**
- Fix 4 v1 (front-scan) was wrong: it scanned rawTail for first unescaped `"` to find JSON string end
- But HTML content contains unescaped quotes (e.g. `lang="en"`), so the scan clipped at position ~28
- recoveredContent = 28 chars < 100 threshold → partial recovery rejected → no file written
- The Run 8 continuation also produced JSON with literal unescaped newlines (11,612 chars), which caused JSON.parse to fail before reaching partial recovery anyway

**Diagnosis from Run 9:**
- Fix 4 v2 (tail-strip) is correct: only strips `"\s*\}` from the END of rawTail — HTML never ends with `"}`
- The continuation produced 11,229-char JSON block that PARSED FORMALLY (not via partial recovery path)
- This is because Run 9's model response had properly escaped content, unlike Run 8
- Result: 11,035-char file with clean `</html>` ending and no `"}` artifact
- The file is roughly 2x Run 7 (6,420 → 11,035) because the seamless continuation produced a larger JSON block
- Remaining issue: model still considers task complete after the first write_file (11k chars vs. 50k target)
- Root cause: 9,984 token context (VRAM-limited) leaves ~3k tokens for iteration 2 after tool result overhead

**Diagnosis from Runs 10–12:**
- Run 10: Preamble "always write section by section" → model ignored it. Default training behavior dominates.
- Run 11: Tool result hint "If more sections, call append_to_file NOW" → model echoed the hint as text (considers task done). File written correctly (10,341 chars, all 7 sections). BASE CRITERIA MET.
- Run 12: write_file description "write ONLY head section" → model switched JSON encoding to literal newlines — causing JSON.parse failure. REGRESSION. Change was reverted same session.
- Key finding: BASE 36_TEST CRITERIA are fully met as of Run 11. The seamless continuation system works (fires correctly on EOS mid JSON block). Stretch goal of 3+ continuations not achievable on 3B model at 9,984 token context for a ~10K char HTML task.

**Three dimensions — Run 9:**
| Dimension | Result | Evidence |
|-----------|--------|----------|
| Coherence | PASS | Final summary: coherent, describes FileShot sections accurately |
| Tool Correctness | PASS | write_file called once (continuation-resolved), no overwrite |
| Response Quality | IMPROVED | 11,035 chars, proper HTML structure, dark theme, JS, clean ending. No `"}` artifact. Still short of 50k target. |

**Three dimensions — Run 11 (CURRENT BEST PASSING STATE):**
| Dimension | Result | Evidence |
|-----------|--------|----------|
| Coherence | PASS | Model understood the task, produced correct FileShot HTML |
| Tool Correctness | PASS | write_file called once, no spurious read_file/list_directory |
| Response Quality | PASS | 10,341 chars, all 7 sections, dark theme, JS animations. Seamless continuation fired once. Screenshot confirmed all sections rendered correctly. |

**Three dimensions — Run 7:**
| Dimension | Result | Evidence |
|-----------|--------|----------|
| Coherence | PASS | Iteration 2 response: coherent summary of sections written. Model understood the task. |
| Tool Correctness | PASS | write_file called once with no spurious exploration. No overwrite. |
| Response Quality | PARTIAL | 6,420 chars, proper HTML structure, dark theme, JS — but short vs. 50KB goal. `"}` artifact at end. |
- Removed repetition detector, stuttering detector, turn indicator detector from llmEngine.js (both trees)
- Removed garbage token regex from streaming and from sanitize.js (both trees)
- Removed repetitive line dedup from sanitize.js
- Updated sanitize.js to contain ONLY <think> block removal + whitespace trim

**Diagnosis from Run 6:**
- Real bug: `write_file` is an overwrite-only tool. Model splits file across sequential calls, each wipes the previous.
- `maxTokens` continuation path injects ZERO context tail — model told "continue where you left off" with no hint.
- `_hasUnclosedToolFence` path (the only path that feeds back context) uses last 200 chars.
- Context loaded at 9,984 tokens due to VRAM binary search — profile says 32,768 but hardware limited it.
- Seamless continuation requires `stopReason === 'maxTokens'` OR unclosed tool fence. Neither occurred — model finished cleanly.

**Proposed fixes (pending approval):**
1. Add `append_to_file` tool to mcpToolServer.js — model writes beginning via write_file, adds sections via append_to_file
2. Inject last ~2,000 chars of partial response into maxTokens continuation path (currently injects 0)
3. Preamble update: instruct model to use write_file for first section, append_to_file for subsequent sections

---

## Three Dimensions (final success judgment)

| Dimension | Weight | How to Measure |
|-----------|--------|----------------|
| Coherence | 50% | Read the token stream — does it make sense? Is it writing HTML? |
| Tool correctness | 25% | Did write_file fire? No spurious list_directory before write_file? |
| Response quality | 25% | Open `output/files/site.html` in a browser. Does it look like a real landing page? |

**Never score on tool call count alone. Never score on string matching alone.**
Read the actual output. Judge the rendered HTML visually.

---

## Rules That Apply To This Test

1. One change per iteration
2. Read actual output text — never judge from PASS/FAIL numbers alone
3. Never add keyword classifiers, regex matchers, or output filters to fix a failing run
4. Changes to allowed levers (preamble, tool descriptions, sampling, loop logic) only
5. VRAM check before every run: `nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits`
   If free VRAM < 2800MB, do not run — results will be hardware-degraded
6. Update CHANGES_LOG.md after every code change
7. Both source trees receive every validated change (`pipeline-clone/main/` AND `main/`)
