# Agent Reference Document — READ THIS FIRST

This document exists because Brendan has had to repeat himself hundreds of times.
If you are an AI agent working on this project, READ THIS BEFORE DOING ANYTHING.

## What guIDE Is

A desktop IDE where users load ANY local GGUF model and it just works. Chat, tool calling,
browsing, code generation — powered by whatever model the user chose. Model-agnostic.
The app adapts at runtime via dynamic model profiles.

## What Success Means

- User loads any model. Asks it to do something. It does it coherently to the best of
  that model's actual ability.
- If a model produces good output in LM Studio, it must produce equally good or better
  output in guIDE. The pipeline helps, never hinders.
- Works out of the box. No hand-tuning per model.

## What Success Does NOT Mean

- Tailoring code to specific model names
- Benchmarking one model and declaring victory
- Guardrails/quality gates/kill switches that prevent models from working
- Timeouts that mask underlying problems (timeouts = failure)

## Dynamic Model Profiles ARE the Correct Architecture

The profile system (family + size tier) IS the right approach. Different size models
genuinely need different parameters. A 0.6B model needs different sampling than a 30B.
This is NOT "hand-tuning per model" — it's per-family-per-size-tier configuration,
which scales. The profile system is NOT a fallback — it IS the runtime.

Unknown models get sensible defaults derived from the closest matching tier.

## Model Capabilities — Do NOT Underestimate

- 0.6B models: CAN make tool calls, CAN chain a couple of them. They hallucinate
  and repeat themselves but they ARE capable. Don't restrict them to single calls
  without testing first. They've proven they can do it.
- 1-4B models: Should handle multi-step tasks reliably.
- 4B+: Should handle complex chains.
- ALL models must produce COHERENT output. Even if smaller ones do less, they must
  not produce gibberish.

## How to Work With Brendan

### DO:
- Test before implementing. Prove a problem exists before fixing it.
- When shown a failing interaction, analyze what ACTUALLY happened.
- If something works, leave it alone. "Looks good" is a valid answer.
- Say "Brendan you're wrong" or "there's nothing else to do" when that's the truth.
- Give honest opinions, even if they disagree with what Brendan said.
- Find ROOT CAUSES, not bandaids.
- Be concise. Do the work. Stop narrating.

### DO NOT:
- Manufacture problems. If there's nothing to fix, SAY SO.
- Cheerleader language: "smoking gun", "this changes everything", "game changer"
- Agree with everything. Brendan needs honest pushback.
- Run audit/fix loops that create new problems to fix later.
- Implement changes based on hypotheses — test first.
- Reference specific model names when discussing general architecture.
- Apologize repeatedly. Just work.
- Throw bandaids. If you can't find the root cause, say so.

## Known Recurring Issues (as of Feb 18, 2026)

### FIXED — Files Not Being Created
- **Root cause found and fixed**: `projectPath` was null at startup because it's only set
  when user opens a folder via File > Open Folder. `_writeFile` joined basename with `''` → 
  wrote to process CWD. Orphaned files confirmed at D:\models\models\, C:\Users\brend\IDE\, etc.
- **Fix**: `_writeFile` and `_createDirectory` now return clear error when no project is open.
  Removed `|| ''` fallback. Added `files-changed` IPC notification so FileTree auto-refreshes.
- **Note**: File Explorer New Folder/New File buttons — not yet investigated.

### FIXED (Attempt 4) — Google Sign-In
- **Root cause**: `onHeadersReceived` callback was `async` with `await` inside, which
  caused timing issues with Electron's webRequest callback mechanism. The `callback()`
  was delayed while `activateWithToken` ran, potentially blocking the OAuth redirect.
  Multiple strategies (4) all failed due to race conditions.
- **Fix (v4)**: Replaced `onHeadersReceived` with `session.cookies.on('changed')` event.
  This is Electron's native cookie change event — fires synchronously when any cookie
  is set in the session, no timing race possible. Fallback: if cookie event doesn't fire
  within 2s of landing on /account, tries direct cookie read.
- **Caveat**: Cannot test OAuth end-to-end in this environment. If it fails again,
  check logs at %APPDATA%/guIDE/logs/guide-main.log for `[OAuth]` entries.

### FIXED — Template Response Loop (0.6B)
- **Root cause**: chatHistory persisted intermediate agentic turns (injected tool feedback,
  continue instructions) across separate user messages. For 0.6B models with limited
  attention, the pattern `user: [tool feedback]` → `model: "No further action"` was
  strongly reinforced, causing the model to repeat it regardless of new input.
- **Fix**: After agentic loop completes, chatHistory is condensed to system + original
  user message + final model response. KV cache invalidated.

### FIXED — Thinking Model Gibberish (Llama-3.2-3B-thinking etc.)
- **Root cause**: `thinkTokens.mode = 'none'` in llama profile suppressed thinking tokens
  for ALL llama models. Thinking-variant models (trained with chain-of-thought) NEED to
  generate `<think>...</think>` before answering — without it, their logits produce gibberish.
- **Fix**: `_getModelSpecificParams()` now detects "thinking", "cot", "r1-distill",
  "reasoning" in the model name and overrides thinkTokens to budget mode.

### FIXED — Phi-4-mini Stuck on "Thinking..." (Grammar Retry Cascade)
- **Root cause**: Grammar-constrained generation hung (0 tokens in rejection sampling).
  After 2 grammar timeouts + 1 text-mode timeout, rollback budget exhaustion RESET
  `consecutiveEmptyGrammarRetries` to 0, re-enabling grammar for next iteration.
  With 3 nudges × (5s+5s+120s) = 7.5+ minutes of dead time.
- **Fix**: Don't reset `consecutiveEmptyGrammarRetries` on rollback budget exhaustion.
  Once grammar fails, it stays disabled. Grammar timeout reduced from 15s → 5s.

### FIXED — Model Switch Mid-Load Race Condition
- **Root cause**: `initialize()` called `loadModel()` (180s timeout) but had no way to
  know it was superseded. Second `initialize()` call ran concurrently, both wrote to
  `this.model`/`this.context`, wrong model ended up loaded.
- **Fix**: Added `_loadGeneration` monotonic counter. Each `initialize()` gets a unique ID
  and calls `checkSuperseded()` after every heavy await. Superseded loads throw immediately.

### NOT YET INVESTIGATED
- File Explorer New Folder / New File buttons don't work
- Tool call dropdowns expanding during streaming (code defaults to collapsed — may be
  streaming render issue where JSON isn't parsed as a tool call block)
- System may be over-engineered — Brendan suspects too many moving parts actively hindering
- When investigating issues, consider whether existing code is CAUSING the problem
  before adding more code on top.
- Simplicity > cleverness. If a simpler approach works, use it.

## HARD RULES — READ BEFORE DOING ANYTHING

### NO FAKE FIXES
- Only implement fixes you are CERTAIN will solve the problem.
- If you cannot determine the root cause, say "I don't know" — this is always acceptable.
- Never implement a guess and call it a fix. Bandaids waste Brendan's time.
- If a fix requires testing you can't do (e.g., OAuth), SAY SO explicitly.

### NO MANUFACTURED PROBLEMS
- When asked to find problems, genuinely look. If there are none, say "I found nothing."
- Do not fabricate issues to appear helpful. Brendan catches this every time.

### HONESTY OVER HELPFULNESS
- "I don't know" is always better than a wrong answer.
- "There's nothing to fix" is always better than a fake fix.
- "I can't test this" is always better than claiming something works when you haven't verified it.
- Never claim a fix works unless you have proof (build output, test result, etc.).

### LOGGING
- Persistent file logs exist at %APPDATA%/guIDE/logs/guide-main.log
- All info/warn/error logs are written to file automatically
- Set LOG_LEVEL=debug for verbose output
- Always check log files first when diagnosing issues

## Technical Stack

- Electron + Vite + React
- node-llama-cpp for local inference
- Main process: main/ directory (agenticChat.js, llmEngine.js, modelProfiles.js, etc.)
- Frontend: src/ directory
- Website: website/ directory (Next.js)
- Models on D:\models

## The Pipeline Difference From LM Studio

LM Studio: simple prompt, no grammar constraining, default sampling → coherent output.
guIDE: system prompt + tool definitions + few-shot examples + grammar constraining + 
custom sampling → potentially degraded output.

The pipeline must HELP models, not fight them.
