/**
 * Shared Benchmark Scoring — single source of truth for both GUI and headless.
 *
 * This module contains the scoring logic used by BenchmarkPanel.tsx (GUI) and
 * benchmark-all-models.js (headless). Both MUST use this exact function so
 * scores are comparable across benchmark runners.
 *
 * Scoring rules:
 *   - Chat baseline: 100 if non-empty response + no tools, 50 if unnecessary tools, 0 if empty
 *   - Tool tasks: % of expectedTools matched, +10 for substantive response, -50 for refusal
 *   - Passed = at least one expected tool matched AND no refusal
 *   - Fact-checking: if expectedContent is defined, each group is an OR-array of keywords.
 *     ALL groups must have at least one match (AND across groups, OR within each group).
 *     Each failed group: -15 points + error. Passed requires ≥50% of groups satisfied.
 */

/**
 * Score a benchmark test result.
 *
 * @param {Object} tc - Test case definition (from benchmarkHandlers DEFAULT_TEST_CASES)
 * @param {Object} chatResult - Result from ai-chat IPC call ({ success, text, error, ... })
 * @param {string[]} capturedTools - Tool names invoked during the test (with duplicates)
 * @returns {{ score: number, passed: boolean, errors: string[], refusalDetected: boolean, contentChecksPassed: number, contentChecksTotal: number }}
 */
function scoreResult(tc, chatResult, capturedTools) {
  const responseText = chatResult?.text || chatResult?.response || '';
  const uniqueTools = [...new Set(capturedTools)];
  const errors = [];

  if (!chatResult?.success && chatResult?.error) {
    errors.push(chatResult.error);
  }

  // Refusal check
  let refusalDetected = false;
  if (tc.refusalPatterns && tc.refusalPatterns.length > 0) {
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

  if (!tc.expectedTools || tc.expectedTools.length === 0) {
    // Chat baseline: pass if response is non-empty and no tools
    if (responseText.length > 5 && uniqueTools.length === 0) {
      score = 100; passed = true;
    } else if (responseText.length > 5) {
      score = 50; errors.push('Unnecessary tool use');
    } else {
      score = 0; errors.push('Empty response');
    }
  } else {
    const expected = new Set(tc.expectedTools);
    let matched = 0;
    for (const t of expected) if (uniqueTools.includes(t)) matched++;
    score = expected.size > 0 ? Math.round((matched / expected.size) * 100) : 0;
    if (refusalDetected) score = Math.max(0, score - 50);
    if (responseText.length > 20) score = Math.min(100, score + 10);
    // Pass requires: all expected tools matched, score >= 70, no refusal
    passed = matched === expected.size && score >= 70 && !refusalDetected;
    if (matched === 0) {
      errors.push(`Expected: [${[...expected]}], Got: [${uniqueTools.join(', ') || 'none'}]`);
    } else if (matched < expected.size) {
      errors.push(`Partial match: ${matched}/${expected.size} tools (need all)`);
    }
  }

  // ── Fact-checking: expectedContent verification ──
  let contentChecksPassed = 0;
  let contentChecksTotal = 0;

  if (tc.expectedContent && Array.isArray(tc.expectedContent) && tc.expectedContent.length > 0) {
    const lower = responseText.toLowerCase();
    contentChecksTotal = tc.expectedContent.length;

    for (const group of tc.expectedContent) {
      // Each group is an OR-array: at least one keyword must appear
      const groupMatch = group.some(keyword => lower.includes(keyword.toLowerCase()));
      if (groupMatch) {
        contentChecksPassed++;
      } else {
        const expected = group.length === 1 ? `"${group[0]}"` : `one of [${group.join(', ')}]`;
        errors.push(`Fact-check: expected ${expected} not found`);
        score = Math.max(0, score - 15);
      }
    }

    // If less than half of content checks pass, fail the test
    if (contentChecksPassed < Math.ceil(contentChecksTotal / 2)) {
      passed = false;
    }
  }

  return { score, passed, errors, refusalDetected, contentChecksPassed, contentChecksTotal };
}

module.exports = { scoreResult };
