/**
 * guIDE — Benchmark Scorer
 *
 * Single source of truth for scoring benchmark test results.
 * Used by both BenchmarkPanel.tsx (GUI) and pipeline-runner.js (headless).
 *
 * Scoring dimensions:
 *   Chat baseline (no tools expected):
 *     100 — non-empty response, no unnecessary tool use
 *      50 — non-empty but spurious tool calls
 *       0 — empty / error
 *
 *   Tool tasks:
 *     Base = % of expectedTools matched (0–100)
 *     +10 for substantive response text (>20 chars)
 *     −50 for refusal detected
 *     Pass requires ALL expected tools matched, score ≥ 70, no refusal
 *
 *   Content verification (expectedContent):
 *     Each group is an OR-array — at least one keyword must appear.
 *     All groups must satisfy (AND across groups, OR within each).
 *     −15 per failed group. Fail if < 50 % groups pass.
 */
'use strict';

/**
 * @param {Object} tc - Test case definition (expectedTools, refusalPatterns, expectedContent)
 * @param {Object} chatResult - { success, text|response, error }
 * @param {string[]} capturedTools - Tool names invoked during the test (may have duplicates)
 * @returns {{ score: number, passed: boolean, errors: string[], refusalDetected: boolean,
 *             contentChecksPassed: number, contentChecksTotal: number }}
 */
function scoreResult(tc, chatResult, capturedTools) {
  const responseText = chatResult?.text || chatResult?.response || '';
  const uniqueTools = [...new Set(capturedTools)];
  const errors = [];

  if (!chatResult?.success && chatResult?.error) {
    errors.push(chatResult.error);
  }

  // ── Refusal detection ──
  let refusalDetected = false;
  if (tc.refusalPatterns?.length) {
    const lower = responseText.toLowerCase();
    for (const p of tc.refusalPatterns) {
      if (lower.includes(p.toLowerCase())) {
        refusalDetected = true;
        errors.push(`Refusal: "${p}"`);
        break;
      }
    }
  }

  let score = 0;
  let passed = false;

  if (!tc.expectedTools?.length) {
    // ── Chat baseline ──
    if (responseText.length > 5 && uniqueTools.length === 0) {
      score = 100;
      passed = true;
    } else if (responseText.length > 5) {
      score = 50;
      errors.push('Unnecessary tool use');
    } else {
      errors.push('Empty response');
    }
  } else {
    // ── Tool task ──
    const expected = new Set(tc.expectedTools);
    let matched = 0;
    for (const t of expected) {
      if (uniqueTools.includes(t)) matched++;
    }

    score = expected.size > 0 ? Math.round((matched / expected.size) * 100) : 0;
    if (refusalDetected) score = Math.max(0, score - 50);
    if (responseText.length > 20) score = Math.min(100, score + 10);

    passed = matched === expected.size && score >= 70 && !refusalDetected;

    if (matched === 0) {
      errors.push(`Expected: [${[...expected]}], Got: [${uniqueTools.join(', ') || 'none'}]`);
    } else if (matched < expected.size) {
      errors.push(`Partial match: ${matched}/${expected.size} tools (need all)`);
    }
  }

  // ── Content verification ──
  let contentChecksPassed = 0;
  let contentChecksTotal = 0;

  if (Array.isArray(tc.expectedContent) && tc.expectedContent.length) {
    const lower = responseText.toLowerCase();
    contentChecksTotal = tc.expectedContent.length;

    for (const group of tc.expectedContent) {
      if (group.some(kw => lower.includes(kw.toLowerCase()))) {
        contentChecksPassed++;
      } else {
        const label = group.length === 1
          ? `"${group[0]}"`
          : `one of [${group.join(', ')}]`;
        errors.push(`Fact-check: expected ${label} not found`);
        score = Math.max(0, score - 15);
      }
    }

    if (contentChecksPassed < Math.ceil(contentChecksTotal / 2)) {
      passed = false;
    }
  }

  return { score, passed, errors, refusalDetected, contentChecksPassed, contentChecksTotal };
}

module.exports = { scoreResult };
