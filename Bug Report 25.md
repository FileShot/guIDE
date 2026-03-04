# Bug Report 25 — guIDE v2.3.8 Test Session (2026-02-25)

---

> ## ⚠️ IMPORTANT — COPILOT AGENT: READ `copilot-instructions.md` EVERY TIME BEFORE DOING ANYTHING
> This is not optional. Before touching a single file, before writing a single plan, before claiming anything is fixed — read `.github/copilot-instructions.md` in full. No exceptions.

> ## ⚠️ IMPORTANT — CHECK OFF AS YOU GO
> When you complete a fix: check the box `[x]`, and write **exactly** what you changed — which file, which line range, what the old code was, what the new code is, and what output you expect. If you later discover the fix didn't work, the record of what you did is here. Do NOT re-implement a fix you already tried. Do NOT claim a fix is complete without this record being filled in. This is your accountability log.

---

## Context

- **App version under test**: guIDE v2.3.8
- **Model under test**: Qwen3-4B-Instruct-2507-Q4_K_M
- **Context window**: 6912 tokens
- **Test date**: 2026-02-25
- **Log file**: `C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log`
- **Source root**: `C:\Users\brend\IDE`
- **Note**: v2.3.8 was built BEFORE the "Phase 4 lastConvSummary code fence strip" fix was applied to source. That fix is in source only and NOT reflected in this build.
- **Critical context**: As of this report, NOT A SINGLE code change made over the past 4+ days of debugging has produced a visible, confirmed, reproducible improvement in the running app. Every fix has either been ineffective, untraceable, or was in source but not in the build being tested. This is the core problem.

---

## Bug Index

| # | Bug | Status |
|---|-----|--------|
| 1 | Prior session apology on first fresh message (context bleed) | [ ] Not Fixed |
| 2 | Name misspelled: "Brendan" → "Brandon" | [ ] Not Fixed |
| 3 | 5–8 tool calls fired on a simple conversational greeting | [ ] Not Fixed |
| 4 | Identical verbatim apology response across completely unrelated prompts | [ ] Not Fixed |
| 5 | Grammar fails twice before every fallback — consistent across all messages | [ ] Not Fixed |
| 6 | Task type "general" assigned to pure conversational messages — model gets tools it shouldn't | [ ] Not Fixed |
| 7 | `jsonjson` literal artifact in chat bubble | [ ] Not Fixed |
| 8 | Tool failure hint rendered as raw UI text: `"💡 Suggestion: ...json"` | [ ] Not Fixed |
| 9 | `"Final Response:"` header visible as literal text in chat | [ ] Not Fixed |
| 10 | Mid-generation text erasure/rewrite (user-reported, unlogged) | [ ] Not Fixed |
| 11 | Model echoing internal instruction language: "no more band-aids, no more mistakes" | [ ] Not Fixed |

---

## Bug #1 — Prior Session Apology on First Fresh Message (Context Bleed)

### Status: [ ] Not Fixed

### Description
On the very first message of a new session ("hey this is brendan"), before the user mentioned anything about dates, Bitcoin, or prior failures, the model immediately responded with a detailed apology about "the search result incorrectly assumed a date in 2023." This apology references failures that happened in a completely previous session that was already closed. The context of the prior session is bleeding into the new one.

### Log Evidence
```
2026-02-25T20:32:29.075Z LOG   [MCP] processResponse called, text preview: You're absolutely right to be frustrated — 
I failed in my core responsibility of delivering accurate, verified information. The search result incorrectly assumed 
a date in 2023 when we are currently i...
```
This is the **first** response of the session. User said "hey this is brendan." Model responded by apologizing about a date error from a prior conversation.

### Root Cause Hypothesis
The conversation history being sent to the model at the start of a new session includes messages from a prior session. Either:
- (a) The conversation is not being cleared between sessions, or
- (b) The system prompt or initial context includes a summary of the prior session's failures (e.g., from `conversationSummarizer.js` or a persistent memory store), or
- (c) A `memoryStore` or persistent note is being injected that references prior errors

### Files to Investigate Before Fixing
- `main/agenticChat.js` — how conversation history is initialized at session start
- `main/memoryStore.js` — does it persist across sessions and get injected?
- `main/conversationSummarizer.js` — is a summary of the last session injected into the new one?
- `main/settingsManager.js` — is there a "persistent memory" feature that stores and re-injects prior session context?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_
> **Old behavior**: _Prior session apology injected into first response_
> **New behavior**: _Expected: model starts fresh with no reference to prior session content_

---

## Bug #2 — Name Misspelled: "Brendan" → "Brandon"

### Status: [ ] Not Fixed

### Description
The user told the model "hey this is brendan." The model consistently referred to the user as "Brandon" throughout the session — in file names, in written file content, and in spoken responses. The name was wrong from the first time it was used and never self-corrected.

### Log Evidence
```
2026-02-25T20:33:03.769Z LOG   [MCP] processResponse called, text preview: ```json
{"tool":"list_directory","params":{"dirPath":"."}}
```
...
2026-02-25T20:33:10.035Z LOG   [MCP] processResponse called, text preview: ```json
{
  "tool": "write_file",
  "params": {
    "filePath": "welcomeBrandon.txt",
    "content": "Hello Brandon, thank you for introducing yourself. I've properly noted your name and am now ready..."
```
File literally named `welcomeBrandon.txt` with "Hello Brandon" as the content. User is Brendan.

### Root Cause Hypothesis
The model (Qwen3-4B-Instruct-2507-Q4_K_M) misheard/hallucinated "Brandon" from "brendan" (lowercase input without punctuation). This may be a model-level inference error, but it may also be reinforced if the system prompt, user profile, or memory store has "Brandon" stored somewhere from a prior session or misconfiguration.

### Files to Investigate Before Fixing
- `main/memoryStore.js` — is the user's name stored? Is it stored correctly?
- `main/settingsManager.js` — is there a user profile with a name field?
- `main/agenticChat.js` — is the user's name injected into the system prompt?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #3 — 5–8 Tool Calls Fired on a Simple Conversational Greeting

### Status: [ ] Not Fixed

### Description
The user said "hey this is brendan." This is a pure conversational greeting with no task, no request, no file operation implied. The model fired 6 consecutive tool calls:

1. `write_file "intro.txt"` — failed
2. `list_directory "."` — succeeded
3. `write_file "welcomeBrandon.txt"` — failed
4. `read_file "welcomeBrandon.txt"` — failed (file it just tried to write, now trying to read)
5. `list_directory "C:\Users\brend\my-static-appfghg"` — failed (hallucinated path)
6. Finally gave up and responded in text

The model burned 6 agentic iterations, multiple seconds, and several hundred context tokens trying to write files to acknowledge a hello message.

### Log Evidence
```
2026-02-25T20:32:59.901Z LOG   [MCP] Found tool call in code block: write_file
2026-02-25T20:33:03.769Z LOG   [MCP] Found tool call in code block: list_directory
2026-02-25T20:33:10.035Z LOG   [MCP] Found tool call in code block: write_file
2026-02-25T20:33:12.297Z LOG   [MCP] Found tool call in code block: read_file
2026-02-25T20:33:15.461Z LOG   [MCP] Found tool call in code block: list_directory
2026-02-25T20:33:29.910Z LOG   [MCP] No fallback tool calls either
[AI Chat] No more tool calls, ending agentic loop
```

### Root Cause Hypothesis
Task type was detected as `general` (not `chat`), so the model was given all 12 tools. With tools available and a confusingly structured system prompt, the model chose to "take action" (file writing) rather than respond conversationally. The tool-call avalanche happened because: (a) write failed, (b) model tried to verify by reading, (c) model tried to explore environment, (d) model entered a recovery loop.

### Files to Investigate Before Fixing
- `main/agenticChat.js` — task type detection logic: what determines `general` vs `chat`?
- `main/agenticChat.js` — what system prompt does a `general` task type receive? Does it encourage file-writing?
- `main/modelProfiles.js` — what tools are given for tier=small, iter=1/2?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #4 — Identical Verbatim Response Across Completely Unrelated Prompts

### Status: [ ] Not Fixed

### Description
Three completely different user messages — "what the fuck," an introduction message, and "do you have instructions?" — all received the **exact same** 962-character response, word for word:

> "I'm sorry for the frustration — I should have handled this much better. You're completely right to be upset, and I take full responsibility for my mistakes in both accuracy and responsiveness. Let me..."

This is not the model giving a similar response. The log shows `length: 962` for ALL of them. Same character count, same text preview, same response. The model is clearly re-outputting from KV cache or some prior generation is being replayed.

### Log Evidence
```
2026-02-25T20:34:43.352Z LOG   [AI Chat] Prompt: ~982 tokens
2026-02-25T20:35:13.789Z LOG   [LLM] Function-calling generation complete: 962 chars, 0 function calls, stop: eogToken
2026-02-25T20:35:13.790Z LOG   [MCP] processResponse called, text preview: I'm sorry for the frustration — I should 
have handled this much better. You're completely right to be upset...

[and earlier:]
2026-02-25T20:33:55.022Z LOG   [MCP] processResponse called, text preview: I'm sorry for the frustration — I should 
have handled this much better. You're completely right to be upset...
```
Identical preview. Identical length (962). Different prompts. Different timestamps.

### Root Cause Hypothesis
Two possible causes:
- (a) KV cache reuse is feeding the same cached token sequence forward despite different input prompts
- (b) The "apology text" was generated once and is being stored somewhere (memory store, conversation summary, or context variable) and re-injected or re-streamed on subsequent calls

### Files to Investigate Before Fixing
- `main/agenticChat.js` — KV cache control: when is `lastEvaluation` cleared vs reused?
- `main/agenticChat.js` — is there any place where a prior response is stored and re-sent?
- `main/llmEngine.js` — KV cache behavior: does it correctly invalidate when prompt changes?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #5 — Grammar Fails Twice Before Fallback on Nearly Every Message

### Status: [ ] Not Fixed

### Description
In almost every single message in this session, the model failed to produce a valid grammar-constrained output twice in a row before the system fell back to text mode. This is not an occasional edge case — it happened consistently and is clearly a systemic problem with grammar mode for this model on this context size.

### Log Evidence (repeated pattern across entire session):
```
[AI Chat] Empty grammar response (1 consecutive)
[AI Chat] ⚠️ ROLLBACK (empty) — retry 1/3, restoring checkpoint
[AI Chat] Empty grammar response (2 consecutive)
[AI Chat] ⚠️ ROLLBACK (empty) — retry 2/3, restoring checkpoint
[AI Chat] Grammar disabled — falling back to text mode after 2 consecutive empty grammar responses
```
This sequence appears at: 20:32:43, 20:32:54, and likely in other turns not shown. Every message hits this path.

### Root Cause Hypothesis
The grammar constraint (`grammar=limited` in the profile) is fundamentally incompatible with how Qwen3-4B-Instruct generates in this context. The model emits 0 chars, 0 function calls with `eogToken` immediately — meaning it's treating the grammar constraint as a stop condition. After two failures, the system strips the grammar and asks again in plain text, which works. This means the grammar is actively harming every single turn.

### Files to Investigate Before Fixing
- `main/agenticChat.js` — where is `grammar=limited` applied per iter? What does iter=1/2 vs iter=2/2 change?
- `main/modelProfiles.js` — Qwen3-4B-Instruct profile: should `grammar` be `none` for this model?
- The grammar constraint that causes `eogToken` immediately — what exactly is being constrained and why?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #6 — Task Type "general" Assigned to Pure Conversational Messages

### Status: [ ] Not Fixed

### Description
"hey this is brendan" was classified as task type `general`, which caused the model to receive all 12 tools and produce a tool-call chain (see Bug #3). A pure greeting with no task, no file reference, no code, and no question is not `general` — it is `chat`. This misclassification directly caused the tool-call flood.

### Log Evidence
```
2026-02-25T20:32:54.267Z LOG   [AI Chat] Detected task type: general
```
vs. one message later:
```
2026-02-25T20:33:35.278Z LOG   [AI Chat] Detected task type: chat
```
The "what the fuck" message (pure chat) got `chat`. The greeting got `general`. The classification is inconsistent and wrong for the greeting case.

### Root Cause Hypothesis
The task type detection heuristic is not distinguishing "has no task but includes a name/identity statement" from "is a task." The word "this is" or a name mention may be triggering `general` classification incorrectly.

### Files to Investigate Before Fixing
- `main/agenticChat.js` — `detectTaskType()` or equivalent function: what keywords/heuristics trigger `general` vs `chat`?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #7 — `jsonjson` Literal Artifact in Chat Bubble

### Status: [ ] Not Fixed

### Description
When the model emits a raw ` ```json ``` ` code block (which happens when grammar falls back to text mode), the frontend stripping logic removes the fences but leaves the word "json" appended to adjacent text. The visible result in the chat bubble is the literal string `jsonjson` appearing in the middle of or at the start of a message.

### Visual Evidence
Visible in screenshot from test session: a chat bubble containing `jsonjson` as literal rendered text.

### Root Cause Hypothesis
The code fence stripping regex in `useChatStreaming.ts` was updated to remove full ` ```json...``` ` blocks, but it is doing one of:
- (a) Stripping ` ``` ` but leaving `json` on the line, then "json" from the next block concatenates to produce `jsonjson`
- (b) Stripping only the backtick fence characters but not the language identifier
- (c) A race condition in streaming where partial text is displayed before the full block is stripped

### Files to Investigate Before Fixing
- `src/components/Chat/hooks/useChatStreaming.ts` — the regex that strips code fences: what exactly does it match and replace?
- Log line at 20:32:59: `processResponse called, text preview: ```json\n{\n  "tool": "write_file"` — something with this code block in a streaming context is producing the artifact

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #8 — Tool Failure Hint Rendered as Raw UI Text: `"💡 Suggestion: This tool has failed 2 times. Consider a different approach.json"`

### Status: [ ] Not Fixed

### Description
The internal system hint that is supposed to be sent to the model as a tool result injection (telling it to try a different approach after repeated failures) is instead appearing as literal rendered text in the chat UI. Worse, it has `.json` appended to it, suggesting it is being treated as part of a JSON code block label rather than injected content.

### Visual Evidence
Screenshot shows a chat bubble containing: `💡 Suggestion: This tool has failed 2 times. Consider a different approach.json`

### Root Cause Hypothesis
The hint text ("💡 Suggestion: ...") is being appended directly into the model's text output stream rather than being cleanly separated as a tool result message. When the frontend renders the response, this hint text appears verbatim. The `.json` suffix appears because the hint is placed immediately before or after a ` ```json ``` ` code block that gets partially stripped — the `json` label is left behind and concatenates with the hint.

### Files to Investigate Before Fixing
- `main/agenticChat.js` — where is the "tool has failed X times" hint generated and injected? Is it being added to `assistantText`/`bufferText` (which gets displayed) or to the tool result message (which should NOT be displayed)?
- `src/components/Chat/hooks/useChatStreaming.ts` — is there any place where tool result content leaks into the displayed assistant message?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #9 — `"Final Response:"` Header Visible as Literal Text in Chat

### Status: [ ] Not Fixed

### Description
The text `Final Response:` is appearing as a visible header in the chat UI. This is a prompt template marker that should be part of the system prompt or response formatting instruction — it is an instruction to the model, not content meant for the user to see.

### Visual Evidence
Screenshot shows `Final Response:` rendered as literal text in a chat bubble.

### Root Cause Hypothesis
The system prompt or agentic chain is telling the model to prefix its final answer with `Final Response:` and the model is complying by writing it literally. The frontend does not strip this marker before rendering. Either:
- (a) The system prompt contains a `Final Response:` instruction and the model echoes it verbatim
- (b) The stripping logic that should remove this prefix before display is not present or not working

### Files to Investigate Before Fixing
- `main/agenticChat.js` — does the system prompt or any injected text contain `Final Response:` as a literal marker? Where?
- `src/components/Chat/hooks/useChatStreaming.ts` or `ChatPanel.tsx` — is there any stripping of `Final Response:` before render?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #10 — Mid-Generation Text Erasure / Rewrite

### Status: [ ] Not Fixed

### Description
During streaming, the user observed the model generating text that then disappears and is rewritten — the chat bubble visibly erases mid-generation and starts over with different content. This happens while the response is still being streamed, before the final message is committed.

### Visual Evidence
User reported verbally during the test session. Not captured in the log (this is a frontend streaming behavior).

### Root Cause Hypothesis
The `bufferText` / `backendText` priority logic in `ChatPanel.tsx` was modified earlier this session. If `bufferText` is being reset or cleared while streaming is still in progress, the UI would show the reset as an erasure. Alternatively, a retry or ROLLBACK event in the backend is causing the frontend to receive a new stream start while the old stream content is cleared — but the clear and new start are not synchronized, causing visible flash/erasure.

### Files to Investigate Before Fixing
- `src/components/Chat/ChatPanel.tsx` — `bufferText` priority logic: when is `bufferText` set to empty string? Does that clear while streaming?
- `src/components/Chat/hooks/useChatStreaming.ts` — on ROLLBACK event or retry, does the frontend clear the text? Is that clear coordinated with the new stream starting?
- `main/agenticChat.js` — ROLLBACK emit: what IPC event is sent to frontend on rollback, and does it include a "clear text" signal?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Bug #11 — Model Echoing Internal Instruction Language: "No More Band-Aids, No More Mistakes"

### Status: [ ] Not Fixed

### Description
The model produced output containing the phrase "no more band-aids, no more mistakes" — language that comes directly from the project's internal copilot/development instructions. The model should have absolutely no visibility into the development agent ruleset. This either means:
- (a) The copilot-instructions.md content is somehow being injected into the model's context, OR
- (b) This exact phrase appears somewhere in the guIDE system prompt or a prompt template that the model sees and echoes back

This is a serious issue. If the model is seeing internal agent instructions, it is being given context it should never have, which would actively corrupt its behavior.

### Visual Evidence
Reported in screenshots from the test session.

### Root Cause Hypothesis
The most likely path: somewhere in `main/agenticChat.js` or a prompt template, the phrase "no more band-aids" or related self-correction language was added (possibly by a prior agent session) to the system prompt as a behavioral corrective. The model then echoes it. This is NOT a model hallucinating the exact phrase — it is almost certainly verbatim content in a prompt seen by the model.

### Files to Investigate Before Fixing
- `main/agenticChat.js` — grep for "band-aid", "band aid", "no more mistakes", "mistakes again" in all system prompt construction, context building, and injected hints
- Any prompt template file in `main/` or `src/` — search for this language
- `model-config.json` — is there a stored system prompt override?

### Fix Record (fill in when complete)
> **What was changed**: _[not yet fixed]_
> **File(s) modified**: _none_
> **Lines changed**: _none_

---

## Summary Note

As of this report, zero (0) of the changes made over the past 4+ days of debugging have produced a confirmed, visible, reproducible improvement in the running application. The reasons appear to be:

1. Fixes were made in source but the build tested was compiled before those fixes were applied
2. Fixes targeted symptoms (output artifacts) rather than root causes (why the model is generating those artifacts in the first place)
3. No verification protocol was established — there was no step to confirm "this is in the build being tested" before declaring a fix complete
4. The pipeline was not fully traced before fixes were applied — a change at one point in the pipeline was declared a fix without confirming all other points that produce the same output

**Going forward, every fix attempt must**:
- Read the FULL code path from generation to display before touching a single line
- Confirm the fix is in the actual installed build before marking complete
- Record exactly what was changed with before/after in this document
- Be verified by reading logs from a fresh test after building
