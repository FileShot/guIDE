# Uncoached Agent Testing Results
## Live Site: https://pocket.graysoft.dev

### Test #1: Quantum Computing Research (Vague Prompt)
**Prompt**: "hey i need info on quantum computing stuff like whats new"  
**Model**: gpt-oss-120b (OpenRouter)  
**Verdict**: ❌ FAIL — 0/3 objectives completed, 2+ minutes runtime, all URLs returned 404

#### Failures:
1. **URL Hallucination** — Agent fabricated every URL it visited:
   - `example.com` — nonsensical for quantum computing research
   - `google.com/ai/quantum-supremacy-2026` — 404, invented path
   - `azure.microsoft.com/en-us/blog/azure-quantum-gen2-launch` — 404, invented path
   - The agent NEVER used web_search results to find real URLs

2. **60+ Second Hang** — final `fetch_webpage` ran for 60+ seconds with no abort
   - Root cause: HTTP 404 triggered a 25s browser fallback, compounding delays
   - User requirement: "should never hang around pages for more than 5 seconds"

3. **Zero Deliverables** — 11 tools executed, 0 objectives completed (0/3 plan items done)
   - No research report generated
   - No real data extracted from any page
   - No quantum computing information delivered to user

4. **Wrong Workflow** — Agent skipped web_search and went straight to guessed URLs
   - Correct approach: web_search("quantum computing news 2026") → get real URLs → fetch those
   - Actual approach: invented plausible-looking URLs from training data → all 404

#### Root Causes Identified & Fixed:
1. **fetch_webpage browser fallback on 404** — tools.js now skips browser fallback for HTTP 4xx/5xx errors (no point loading a 404 page in a browser)
2. **Browser fallback timeout too long** — reduced from 25s to 10s
3. **No URL invention rule** — agent.js system prompt now explicitly forbids inventing URLs
4. **No web_search-first rule** — system prompt now mandates web_search before any URL fetch
5. **No 404 recovery rule** — system prompt now requires web_search after 2 consecutive 404s

#### Tool Calls (11 total):
| # | Tool | Result |
|---|------|--------|
| 1 | write_todos | ✓ Created 3-item plan |
| 2 | web_search | ✓ Returned results (but agent ignored the URLs) |
| 3 | fetch_webpage (example.com) | ✗ Nonsensical target |
| 4 | fetch_webpage (google.com/ai/...) | ✗ 404 — fabricated URL |
| 5 | write_scratchpad | ✓ Wrote notes (no real data to save) |
| 6 | fetch_webpage (azure.microsoft.com/...) | ✗ 404 — fabricated URL |
| 7 | write_scratchpad | ✓ Wrote notes (no real data) |
| 8 | fetch_webpage (unknown) | ✗ 404 or timeout |
| 9 | write_scratchpad | ✓ |
| 10 | read_file | ✗ Failed |
| 11 | fetch_webpage | ✗ Hung 60+ seconds |

#### Screenshots:
- `test1-started.png` through `test1-tools-detailed.png` (8 captures)
- Evidence: Microsoft Azure 404 page visible, "Tools: 11 (1 running)", Plan: 0/3

---

## Test Status Summary
- ❌ Test #1: Quantum computing — **FAIL** (0 results, all 404s, 60s hang)
- ⏳ Test #2: cloudLLMService bugs — started, pending results
- ⏳ Tests #3-16: Pending

## Fixes Applied (to pocket-guide codebase):
1. `tools.js` — Skip browser fallback for HTTP 4xx/5xx (saves 10-25s per bad URL)
2. `tools.js` — Reduced browser fallback timeout from 25s → 10s  
3. `agent.js` — Added "NEVER INVENT URLs" rule to system prompt
4. `agent.js` — Added "RESEARCH WORKFLOW" rule (web_search first, always)
5. `agent.js` — Added "404 RECOVERY" rule (use web_search after 2 consecutive 404s)
6. `agent.js` — Added "NEVER visit example.com" rule
4. Check browser automation accuracy
5. Confirm no web scraping/copy-paste behavior
