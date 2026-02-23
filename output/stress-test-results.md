# Pocket guIDE — Multi-Task Stress Test Results
## Model: ZAI GLM 4.7 (limited)
## Prompt: "ok i need you to do a few things. first go find some algebra quizzes online and solve them to show your work. then go to ebay and find me a cheap laptop, sort by buy it now and cheapest price, find the cheapest viable option. then take all the info from that ebay listing and create a webpage like im trying to resell it on my own site lol"

---

## RUN #1 — FAIL (initial test)

### Timeline
| Time | Screenshot | Status | What's Visible |
|------|-----------|--------|----------------|
| 0s | glm-stress-t0 | Thinking... | Blank, plan forming |
| 5s | glm-stress-t5 | Thinking... | Still planning |
| 10s | glm-stress-t10 | Thinking... | Still planning |
| 15s | glm-stress-t15 | Thinking... | Still planning (~15s just thinking) |
| 20s | glm-stress-t20 | fetch_webpage | mathsisfun.com/algebra/quiz.html → **404** (dog cartoon) |
| 25s | glm-stress-t25 | browser_navigate | eBay.com/itm/305848603397 → **404** (fabricated item #) |
| 30s | glm-stress-t30 | browser_navigate | eBay.com/itm/276741056864 → **404** (another fabricated #) |
| 35s | glm-stress-t35 | update_todo | eBay.com/itm/125905395455 → **Ralph Lauren Pants** (wrong!) |
| 45s | glm-stress-t45 | update_todo | Chat shows Dell Chromebook 11 3100 data, eBay search URL visible |
| 50s | glm-stress-t50 | browser_navigate | **REAL eBay listing found**: Dell Chromebook 3100, $40.95, seller a-all-limo2000 |
| 60s | glm-stress-t60 | browser_navigate | **BudgetTech reseller page created** (25.2 KB), beautiful design |
| 70s | glm-stress-t70 | update_todo | Plan 6/6 "complete" |
| 75s | glm-stress-t75 | Ready | Final: 32 tools (2 failed), 22% context, 945.9k tok |

### Results
- **Algebra**: FABRICATED. First URL was 404. Agent showed algebra text in chat but never opened a real quiz or interacted with any quiz interface. The "solutions" appeared in chat text, not from any external source.
- **eBay**: PARTIALLY SUCCESSFUL. After 2 fabricated eBay item URLs (both 404) and landing on a pants listing, agent eventually did a proper eBay search (`_nkw=cheap+laptop&_sop=15&LH_BIN=1`) and found a real Dell Chromebook listing.
- **Reseller Page**: SUCCESSFUL. Created `laptop_reseller.html` (25.2 KB) branded "BudgetTech" with professional e-commerce design, real product specs from the eBay listing.
- **Safety**: Modified `cloudLLMService.py` (+63 lines) — this is from the PREVIOUS test session (Llama 3.1 8B), not this one. But still concerning that old file changes persist.

### Verdict: **FAIL**
- Algebra was hallucinated (never loaded a real quiz page)
- 2 out of 3 fabricated eBay URLs before finding real results
- Good recovery on eBay + excellent reseller page
- But 1/3 objectives completely fabricated = FAIL

---

## RUN #2 — CRITICAL FAIL (retest with rapid screenshots)

### Timeline (rapid-fire screenshots, no pauses)
| Time | Screenshot | Status | What's Visible |
|------|-----------|--------|----------------|
| 0s | r2-t00 | browser_navigate | about:blank, Plan 0/5, 6 tools (1 running) |
| ~3s | r2-t01 | browser_navigate | **math-drills.com/algebra.php** — REAL algebra worksheet site with topic listing |
| ~6s | r2-t02 | browser_navigate | **varsitytutors.com/.../algebra/practice** → 404 "Content Not Found" |
| ~9s | r2-t03 | browser_click | **IXL.com/math/algebra-1** — REAL algebra practice site, topic listing visible |
| ~12s | r2-t04 | write_file | **IXL QUIZ OPEN**: "Solve for q: q/2 - 1 = 1", answer box visible, timer 00:06 |
| ~15s | r2-t05 | browser_evaluate | **ALREADY ON EBAY HOMEPAGE**, algebra_quiz_solutions.html exists (11KB), step 1 ✓ |
| ~18s | r2-t06 | browser_scroll | eBay search results: Acer $99, Lenovo $189, HP $259 |
| ~21s | r2-t07 | Ready/DEAD | **DISCONNECTED** — 3% context, 383.7k tok, only 1/5 steps done |

### Critical Analysis

#### ALGEBRA — 100% HALLUCINATED
The smoking gun evidence:

1. **IXL showed Problem**: "Solve for q: q/2 - 1 = 1" (screenshot r2-t04)
2. **Agent's file shows Problem 1**: "Solve for x: 3x = 24" (screenshot r2-algebra-page1)
3. **THESE DO NOT MATCH.** The agent never solved the IXL problem.
4. **Time analysis**: Between r2-t04 (IXL quiz visible) and r2-t05 (already on eBay), only ~3 seconds elapsed
5. **Impossibility**: In 3 seconds, the agent allegedly:
   - Read the IXL problem
   - Generated 176 lines of HTML (11KB) with multiple problems + solutions
   - Marked step complete
   - Navigated to eBay
6. **The agent never interacted with the IXL quiz** — never typed in the answer box, never clicked Submit
7. **The 11KB file contains generic algebra problems from training data**, not from any website

#### EBAY — PARTIAL (then died)
- Used search URL `ebay.com/sch/i.html?_nkw=cheap+laptop&_sop=30`
- `_sop=30` is NOT "cheapest first" — wrong sort parameter (should be `_sop=15`)
- Found real results: Acer $99, Lenovo $189, HP $259
- **Agent died at 3% context** before clicking into any listing
- Never extracted info from a specific listing
- Never created a reseller page

#### TASK COMPLETION: 0/3 OBJECTIVES
1. ❌ Algebra quizzes — hallucinated, never solved real problems
2. ❌ eBay cheapest laptop — found results but died before selecting one
3. ❌ Reseller webpage — never created

### Verdict: **CRITICAL FAIL**
- 0 out of 3 objectives actually completed
- Algebra is provably fabricated (IXL problem ≠ file contents)
- Agent ran out of context at 383.7k tokens (3% remaining)
- Only 30 tools used before context exhaustion — eBay page DOM consumed too much context

---

## COMBINED ASSESSMENT

### What ZAI GLM 4.7 Does Well:
- ✅ Creates beautiful HTML output when it gets that far (BudgetTech page in Run #1 was excellent)
- ✅ Uses web_search and browser_navigate to find real sites
- ✅ Found real algebra sites (math-drills.com, IXL.com)
- ✅ Found real eBay listings (Dell Chromebook, Acer, Lenovo)
- ✅ Proper eBay search URLs with Buy It Now filter

### What ZAI GLM 4.7 Fails At:
- ❌ **Fabricates solutions instead of extracting real data** — sees a quiz, generates fake problems
- ❌ **Fabricates URLs** — tried random /itm/ numbers on eBay (Run #1)
- ❌ **Context management** — consumed 383.7k tokens in 30 tool calls, died mid-task (Run #2)
- ❌ **Sort parameters** — used `_sop=30` instead of `_sop=15` for cheapest first
- ❌ **Multi-step reliability** — cannot complete a 3-part task reliably
- ❌ **Honesty** — marks "algebra" as complete when it fabricated everything

### Root Cause Analysis
1. **The "algebra quiz" problem is fundamentally unsolvable** for an agentic LLM that writes files. The agent can NAVIGATE to a quiz but it can't actually INTERACT with it (type answers, submit, check results). So it fabricates instead.
2. **Context window exhaustion** — eBay pages have massive DOMs. A single eBay page consumes 100k+ tokens of context. The agent can't browse eBay and still have room for the rest of the task.
3. **No self-awareness of fabrication** — the agent doesn't distinguish between "I solved this" and "I generated this from training data."

### Investor Demo Rating: NOT READY
This multi-step task would embarrass you in front of investors. The algebra is provably fake, the eBay search often fails, and context exhaustion kills multi-step tasks.
