# GAUNTLET TEST SCRIPT — guIDE Fresh Session

> Run this after every rebuild to generate a clean bug report.
> Do each test in order. Screenshot anything that looks wrong.
> After finishing all tests, copy `%APPDATA%\guide-ide\logs\guide-main.log` to `output/session_log.txt` and tell the agent to read it.

---

## PREP

- [ ] Fresh rebuild complete (`npm run build` or electron rebuild done)
- [ ] App launched from the new build
- [ ] Log file cleared (agent did this — verifiable: log size should be <5KB at start)
- [ ] No prior chat history loaded (start a fresh chat)
- **Recommended model for most tests:** a mid-size model (e.g. Qwen3-4B or similar)
- **Note the exact model name you're using for each test**

---

## TEST 1 — Basic response, no tools

**Purpose:** Confirm the model responds normally, no artifacts.

**Steps:**
1. Type: `What is 17 times 43?`
2. Wait for full response
3. Observe: response should be plain text, no JSON visible, no blank bubble

**Pass:** Model answers (answer is 731). Clean text, no raw JSON, no blank.
**Fail signals:** Blank bubble / raw JSON flash / response wipes mid-stream

**Screenshot if:** anything looks wrong

---

## TEST 2 — Cancel mid-generation (BUG-001 regression)

**Purpose:** Confirm cancelled generations are NOT stored in context and NOT shown as a response bubble.

**Steps:**
1. Type a long-running prompt: `Write me a 1000-word essay on the history of the Roman Empire. Include all emperors.`
2. While it's streaming (don't wait for finish), immediately send a NEW message: `What is 2 + 2?`
3. Wait for the second message to complete
4. Observe: 
   - The cancelled generation should NOT appear as a completed response bubble
   - The second message should answer "4" cleanly
5. Repeat cancel 2-3 more times back-to-back to stress it

**Pass:** No `[Generation cancelled]` text ever appears in any bubble. Second message answers normally.
**Fail signals:** `[Generation cancelled]` visible in chat, or subsequent responses echo cancel text

---

## TEST 3 — Tool call: web search (streaming artifacts)

**Purpose:** Check that tool pills appear correctly, don't flash raw JSON, and stay visible after completion.

**Steps:**
1. Type: `Search the web for the latest news about AI today and summarize what you find`
2. Watch the streaming bubble carefully while tools are running:
   - DO the tool spinner pills appear? (should see animated spinner with tool name)
   - Do you see ANY raw JSON `{"tool": "web_search", "params": {...}}` text flash in the bubble?
   - After the tool finishes, do the pills convert to checkmarks (✓) or disappear?
3. Wait for the full response
4. Observe the final rendered message

**Pass:** Spinner pill appears → converts to ✓ pill → final response prose appears. NO raw JSON ever visible.
**Fail signals:** Raw JSON flash, pills vanishing before response, blank response after tools run

**Screenshot if:** raw JSON visible at any moment / pills disappear

---

## TEST 4 — Multi-tool chain

**Purpose:** Test a sequence of multiple tool calls in one response.

**Steps:**
1. Type: `Search the web for the current price of NVIDIA stock, then search for AMD stock price, then tell me which is higher`
2. Watch both tool spinner pills appear and resolve
3. Observe the final answer cites both prices

**Pass:** Two tool pills appear in sequence (or together), both resolve to ✓, final prose answers the question.
**Fail signals:** Only one tool executes / blank bubble / response wipes after tool result arrives / raw JSON visible

---

## TEST 5 — Code generation (no tools)

**Purpose:** Confirm code blocks render correctly, no tool-call misclassification.

**Steps:**
1. Type: `Write me a Python function to calculate the Fibonacci sequence up to n terms`
2. Wait for full response
3. Observe: should get a clean code block with Python syntax highlighting

**Pass:** Clean fenced code block rendered with syntax highlighting. No tool pills. No raw JSON.
**Fail signals:** Code shows as tool call / raw JSON visible / code block rendered as plain text

---

## TEST 6 — Small model tool behavior (3B or smaller)

**Purpose:** Test with a small model (Llama 3.2 3B, Qwen3-0.6B, or DeepSeek-R1-1.5B) to catch small-model-specific bugs.

**Switch to your smallest available model first.**

**Steps:**
1. Type: `Search the web for today's weather in Dallas Texas`
2. Observe whether:
   - Model generates a tool call correctly
   - `## TOOL CALL` or `### TOOL CALL` headers appear in the bubble (BUG-012 signal)
   - Tool executes or gets blocked (BUG-002 signal: blank bubble)
   - Response appears after tool

**Pass:** Tool fires, result comes back, response contains weather info. No stray headers.
**Fail signals:**
- Blank bubble after tool = BUG-002 (chat-hard-gate strips everything)
- `## TOOL CALL` visible in prose = BUG-012 (reasoning header leaking)
- Tool never fires = possible task-type misclassification
- Model hallucinates results without using tool = BUG-013 signal

**IMPORTANT:** Note the exact model name in your bug report

---

## TEST 7 — Multi-step agentic task

**Purpose:** Test whether the agent can complete a 2-3 step task without stalling or hallucinating intermediate steps.

**Steps:**
1. Type: `Find the capital of France, then tell me what the population of that city is`
2. Watch the agent:
   - Does it plan the steps?
   - Does it call a search for "capital of France"?
   - Does it call a second search for "population of Paris"?
   - Does it synthesize both results into a final answer?

**Pass:** Two search calls, both resolve, final answer says Paris is the capital with its population (~2.1M city / ~12M metro).
**Fail signals:**
- Agent answers from memory without searching = BUG-013 (no tool use on multi-step)
- Stalls after first search = broken iteration
- Final message is blank = BUG-003 (tool-result-only FINAL RETURN)

---

## TEST 8 — Response text stability during streaming

**Purpose:** Confirm response text doesn't wipe or roll back mid-generation (BUG-002/NEW-B regression).

**Steps:**
1. Type: `Explain how a neural network learns using backpropagation. Be detailed, at least 3 paragraphs.`
2. Watch the text stream in
3. Does text ever disappear mid-stream? Does the bubble go blank and restart?

**Pass:** Text streams continuously without any rollback or wipe.
**Fail signals:** Text disappears and restarts from beginning / bubble goes blank mid-stream

---

## TEST 9 — Stress: rapid fire questions

**Purpose:** Stress test the queue and supersede logic under rapid fire.

**Steps:**
1. Type `Hello` and immediately (within 1 second) type `How are you` then immediately `What is 5+5`
2. Only the last message should complete. The first two should be cancelled cleanly.
3. After it settles, send one more normal message: `Explain what just happened`
4. Verify the model gives a coherent answer without weird context corruption

**Pass:** Only the last queued message gets a full response. No `[Generation cancelled]` pollution. Final message is coherent.
**Fail signals:** Multiple responses appearing, `[Generation cancelled]` in context, model confused about what was asked

---

## TEST 10 — Model information display

**Purpose:** Verify the model name display is correct and doesn't silently switch.

**Steps:**
1. Note what model is shown in the UI
2. Send a message: `What model are you? What are your capabilities?`
3. Note response
4. If modal switching is available, trigger it and observe if the UI updates

**Pass:** Model name is displayed correctly. If it switches, UI shows the new model name.
**Fail signals:** Model switches silently without any indication in UI = BUG-010

---

## AFTER ALL TESTS

1. **Copy the log:**
   ```
   Copy-Item "$env:APPDATA\guide-ide\logs\guide-main.log" "C:\Users\brend\IDE\output\session_log.txt"
   ```
2. **Tell the agent:** "Fresh gauntlet complete. Log is copied to output/session_log.txt. Here's what I observed: [list issues from above]"
3. **Agent will:**
   - Read the log
   - Cross-reference with your observations
   - Populate BUG_REPORT.md with numbered bugs in priority order
   - Ask for approval before fixing anything

---

## QUICK OBSERVATION CHECKLIST

While running tests, note YES/NO for each:

- [ ] Raw JSON ever visible in any streaming bubble?
- [ ] Any blank response bubbles?
- [ ] `[Generation cancelled]` text appears in any bubble?
- [ ] Tool pills disappear before response arrives?
- [ ] Response text wipes/restarts mid-stream?
- [ ] `## TOOL CALL` or `### TOOL CALL` visible in any response?
- [ ] Agent answers from memory instead of using tools when asked to search?
- [ ] Small model gives blank response when using tools?
- [ ] Multiple responses generated for a single cancelled prompt?
- [ ] Model name displayed incorrectly?
