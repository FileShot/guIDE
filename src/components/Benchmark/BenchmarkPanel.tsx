import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Square, BarChart3, CheckCircle, XCircle,
  Clock, Cpu, ChevronDown, ChevronRight, RefreshCw,
  Loader2, Zap, Target, MessageSquare, Code, Copy,
} from 'lucide-react';
import type {
  AvailableModel, LLMStatusEvent, BenchmarkTestCase,
  BenchmarkTestResult, BenchmarkModelResult,
} from '@/types/electron';

interface BenchmarkPanelProps {
  availableModels: AvailableModel[];
  llmStatus: LLMStatusEvent;
}

// Score a result based on the test case definition.
// ⚠️  CANONICAL SOURCE: main/benchmarkScorer.js — keep this in sync!
// This is duplicated here because the renderer cannot import Node modules.
// The headless benchmark script uses the canonical module directly.
function scoreResult(
  tc: BenchmarkTestCase,
  chatResult: any,
  capturedTools: string[]
): { score: number; passed: boolean; errors: string[]; refusalDetected: boolean; contentChecksPassed: number; contentChecksTotal: number } {
  const responseText: string = chatResult?.text || chatResult?.response || '';
  const uniqueTools = [...new Set(capturedTools)];
  const errors: string[] = [];

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

  if (tc.expectedTools.length === 0) {
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
    passed = matched > 0 && !refusalDetected;
    if (matched === 0) {
      errors.push(`Expected: [${[...expected]}], Got: [${uniqueTools.join(', ') || 'none'}]`);
    }
  }

  // ── Fact-checking: expectedContent verification ──
  let contentChecksPassed = 0;
  let contentChecksTotal = 0;

  if ((tc as any).expectedContent && Array.isArray((tc as any).expectedContent) && (tc as any).expectedContent.length > 0) {
    const lower = responseText.toLowerCase();
    const expectedContent: string[][] = (tc as any).expectedContent;
    contentChecksTotal = expectedContent.length;

    for (const group of expectedContent) {
      const groupMatch = group.some((keyword: string) => lower.includes(keyword.toLowerCase()));
      if (groupMatch) {
        contentChecksPassed++;
      } else {
        const exp = group.length === 1 ? `"${group[0]}"` : `one of [${group.join(', ')}]`;
        errors.push(`Fact-check: expected ${exp} not found`);
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

// Category icons
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Explicit Task': <Target size={12} className="text-[#569cd6]" />,
  'Vague Inference': <Zap size={12} className="text-[#dcdcaa]" />,
  'Multi-step': <RefreshCw size={12} className="text-[#c586c0]" />,
  'Coding': <Code size={12} className="text-[#4ec9b0]" />,
  'Chat Baseline': <MessageSquare size={12} className="text-[#89d185]" />,
  'Duplicate Tool': <Copy size={12} className="text-[#d7ba7d]" />,
};

export const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({
  availableModels,
  llmStatus,
}) => {
  const [testCases, setTestCases] = useState<BenchmarkTestCase[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<Record<string, BenchmarkModelResult>>({});
  const [liveResults, setLiveResults] = useState<BenchmarkTestResult[]>([]);
  const [progress, setProgress] = useState<{ phase: string; model: string; test: string; pct: number } | null>(null);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [showTestPicker, setShowTestPicker] = useState(true);
  const cancelledRef = useRef(false);
  const capturedToolsRef = useRef<string[]>([]);
  const capturedFileWritesRef = useRef<Array<{ path: string; content: string }>>([]); 
  const allResultsRef = useRef<Record<string, BenchmarkModelResult>>({});

  // ── Reliability constants ──
  const CONSECUTIVE_FAIL_SKIP = 3;   // Skip remaining tests after N consecutive timeouts/failures
  const PER_TEST_TIMEOUT = 90_000;   // 90 seconds per test
  const MODEL_LOAD_TIMEOUT = 180_000; // 3 minutes to load a model
  const SETTLE_DELAY = 2000;          // ms after model load
  const POST_RESET_DELAY = 300;       // ms after session reset
  const POST_CANCEL_DELAY = 1000;     // ms after cancel to let engine recover
  const SAVE_INTERVAL = 3;            // Save results every N tests

  // Load test cases on mount
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.benchmarkGetTests) {
      api.benchmarkGetTests().then((tests: BenchmarkTestCase[]) => {
        setTestCases(tests);
        setSelectedTests(new Set(tests.map(t => t.id)));
      });
    }
  }, []);

  // Toggle model selection
  const toggleModel = useCallback((path: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // Toggle test selection
  const toggleTest = useCallback((id: string) => {
    setSelectedTests(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Select/deselect all tests in a category
  const toggleCategory = useCallback((category: string) => {
    const catTests = testCases.filter(t => t.category === category);
    setSelectedTests(prev => {
      const next = new Set(prev);
      const allSelected = catTests.every(t => next.has(t.id));
      for (const t of catTests) {
        if (allSelected) next.delete(t.id); else next.add(t.id);
      }
      return next;
    });
  }, [testCases]);

  // Run the benchmark — hardened for multi-model reliability
  const runBenchmark = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;

    const modelPaths = [...selectedModels];
    const testIds = [...selectedTests];
    if (modelPaths.length === 0 || testIds.length === 0) return;

    setIsRunning(true);
    setResults({});
    setLiveResults([]);
    cancelledRef.current = false;
    const allResults: Record<string, BenchmarkModelResult> = {};
    allResultsRef.current = allResults;

    const activeTests = testCases.filter(tc => testIds.includes(tc.id));

    // Subscribe to tool execution events to capture tools + file writes
    const toolCleanup = api.onToolExecuting?.((data: { tool: string; params: any }) => {
      if (data?.tool) capturedToolsRef.current.push(data.tool);
      // Capture file write contents for HTML output examples
      if (data?.tool && /write|create|save/i.test(data.tool) && data.params) {
        const p = data.params;
        const filePath = p.path || p.filePath || p.file || '';
        const content = p.content || p.data || p.text || '';
        if (filePath && content && /\.html?$/i.test(filePath)) {
          capturedFileWritesRef.current.push({ path: filePath, content });
        }
      }
    });

    // Helper: run a promise with a timeout (prevents benchmark freeze)
    const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms / 1000}s`)), ms)
        ),
      ]);
    };

    // Helper: aggressive engine reset (fixes stuck state after timeouts)
    const hardReset = async () => {
      try { await api.llmCancel?.(); } catch (_) {}
      await new Promise(r => setTimeout(r, POST_CANCEL_DELAY));
      try { await api.llmResetSession(); } catch (_) {}
      try { await (api as any).memoryClearConversations?.(); } catch (_) {}
      await new Promise(r => setTimeout(r, POST_RESET_DELAY));
    };

    // Helper: save intermediate results so nothing is lost
    const saveIntermediate = () => {
      if (Object.keys(allResults).length > 0 && api.benchmarkSaveResults) {
        api.benchmarkSaveResults({
          timestamp: new Date().toISOString(),
          models: { ...allResults },
          partial: true,
        });
      }
    };

    try {
      for (let mi = 0; mi < modelPaths.length; mi++) {
        if (cancelledRef.current) break;
        const modelPath = modelPaths[mi];
        const modelName = modelPath.split(/[\\/]/).pop()?.replace(/\.gguf$/i, '') || 'unknown';

        setProgress({ phase: 'Loading model...', model: modelName, test: '', pct: (mi / modelPaths.length) * 100 });

        // ── Full hard reset before loading new model ──
        await hardReset();

        // Load model (with timeout for large models)
        try {
          const loadResult = await withTimeout(
            api.llmLoadModel(modelPath),
            MODEL_LOAD_TIMEOUT,
            `Loading ${modelName}`
          );
          if (!loadResult.success) throw new Error(loadResult.error || 'Load failed');
          // Give model time to settle
          await new Promise(r => setTimeout(r, SETTLE_DELAY));
        } catch (loadErr: any) {
          console.warn(`[Benchmark] Model load failed for ${modelName}: ${loadErr.message}`);
          allResults[modelName] = {
            modelName, modelPath, error: loadErr.message,
            tests: activeTests.map(tc => ({
              testId: tc.id, category: tc.category, description: tc.description,
              modelName, passed: false, score: 0, toolsCalled: [],
              response: '', errors: [`Load failed: ${loadErr.message}`],
              refusalDetected: false, durationMs: 0,
            })),
            overallScore: 0, totalPassed: 0, totalTests: activeTests.length,
          };
          setResults({ ...allResults });
          saveIntermediate();
          continue; // Skip to next model
        }

        const modelResults: BenchmarkTestResult[] = [];
        let consecutiveFailures = 0;
        let skippedRemainder = false;

        for (let ti = 0; ti < activeTests.length; ti++) {
          if (cancelledRef.current) break;
          const tc = activeTests[ti];

          // ── Auto-skip: if model timed out/failed N times in a row, skip rest ──
          if (consecutiveFailures >= CONSECUTIVE_FAIL_SKIP) {
            if (!skippedRemainder) {
              console.warn(`[Benchmark] ${modelName}: ${consecutiveFailures} consecutive failures — skipping remaining ${activeTests.length - ti} tests`);
              skippedRemainder = true;
            }
            modelResults.push({
              testId: tc.id, category: tc.category, description: tc.description,
              modelName, passed: false, score: 0, toolsCalled: [],
              response: '', errors: [`Skipped: model failed ${consecutiveFailures} consecutive tests`],
              refusalDetected: false, durationMs: 0,
            });
            setLiveResults(prev => [...prev, modelResults[modelResults.length - 1]]);
            continue;
          }

          setProgress({
            phase: skippedRemainder ? 'Skipping...' : 'Testing...',
            model: modelName,
            test: tc.description,
            pct: ((mi * activeTests.length + ti) / (modelPaths.length * activeTests.length)) * 100,
          });

          // ── Full state reset between EVERY test ──
          try { await api.llmResetSession(); } catch (_) {}
          try { await (api as any).memoryClearConversations?.(); } catch (_) {}
          await new Promise(r => setTimeout(r, POST_RESET_DELAY));

          // Clear captured tools and file writes
          capturedToolsRef.current = [];
          capturedFileWritesRef.current = [];

          const start = Date.now();
          let chatResult: any;
          let timedOut = false;
          try {
            chatResult = await withTimeout(
              api.aiChat(tc.prompt, {
                maxIterations: tc.maxIterations || 3,
              }),
              PER_TEST_TIMEOUT,
              `Test: ${tc.description}`
            );
          } catch (err: any) {
            chatResult = { success: false, error: err.message };
            timedOut = err.message?.includes('Timeout');
            // Force-cancel any stuck generation
            try { await api.llmCancel?.(); } catch (_) {}
            await new Promise(r => setTimeout(r, POST_CANCEL_DELAY));
            // Extra reset after timeout to clear corrupted state
            if (timedOut) {
              try { await api.llmResetSession(); } catch (_) {}
              await new Promise(r => setTimeout(r, POST_RESET_DELAY));
            }
          }

          const { score, passed, errors, refusalDetected } = scoreResult(tc, chatResult, capturedToolsRef.current);
          const uniqueTools = [...new Set(capturedToolsRef.current)];

          // For coding tests, capture the full HTML output
          const isCoding = tc.category === 'Coding';
          const responseText = chatResult?.text || chatResult?.response || '';
          let htmlOutput: string | undefined;
          if (isCoding) {
            // First try: captured file write content
            const htmlWrite = capturedFileWritesRef.current.find(w => /\.html?$/i.test(w.path));
            if (htmlWrite?.content) {
              htmlOutput = htmlWrite.content;
            } else {
              // Fallback: try to read HTML from desktop
              try {
                const desktop = (await (api as any).getDesktopPath?.()) || `C:\\Users\\${require('os')?.userInfo?.()?.username || 'brend'}\\Desktop`;
                // Check common filenames from our coding prompts
                const candidates = ['tic-tac-toe.html', 'tictactoe.html', 'portfolio.html', 'snake.html', 'calculator.html', 'bean-there.html', 'landing.html', 'index.html'];
                for (const fname of candidates) {
                  try {
                    const content = await api.readFile?.(`${desktop}\\${fname}`);
                    if (content && typeof content === 'string' && content.length > 50) {
                      htmlOutput = content;
                      break;
                    }
                  } catch (_) {}
                }
              } catch (_) {}
            }
            // Last fallback: extract HTML from response if it contains a full document
            if (!htmlOutput && responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
              const htmlMatch = responseText.match(/<!DOCTYPE[\s\S]*<\/html>/i) || responseText.match(/<html[\s\S]*<\/html>/i);
              if (htmlMatch) htmlOutput = htmlMatch[0];
            }
          }

          const result: BenchmarkTestResult = {
            testId: tc.id, category: tc.category, description: tc.description,
            modelName, passed, score, toolsCalled: uniqueTools,
            response: isCoding ? responseText : responseText.substring(0, 500),
            ...(htmlOutput ? { htmlOutput } : {}),
            errors, refusalDetected, durationMs: Date.now() - start,
          };

          modelResults.push(result);
          setLiveResults(prev => [...prev, result]);

          // Track consecutive failures (timeout or score=0)
          if (timedOut || (score === 0 && !passed)) {
            consecutiveFailures++;
          } else {
            consecutiveFailures = 0;
          }

          // Periodic intermediate save
          if ((ti + 1) % SAVE_INTERVAL === 0) {
            const partialScore = modelResults.length > 0
              ? Math.round(modelResults.reduce((a, r) => a + r.score, 0) / modelResults.length) : 0;
            allResults[modelName] = {
              modelName, modelPath, tests: [...modelResults], overallScore: partialScore,
              totalPassed: modelResults.filter(r => r.passed).length,
              totalTests: modelResults.length,
            };
            allResultsRef.current = { ...allResults };
            setResults({ ...allResults });
            saveIntermediate();
          }
        }

        const overallScore = modelResults.length > 0
          ? Math.round(modelResults.reduce((a, r) => a + r.score, 0) / modelResults.length)
          : 0;

        allResults[modelName] = {
          modelName, modelPath, tests: modelResults, overallScore,
          totalPassed: modelResults.filter(r => r.passed).length,
          totalTests: modelResults.length,
        };
        allResultsRef.current = { ...allResults };
        setResults({ ...allResults });
        setExpandedModels(prev => new Set([...prev, modelName]));

        // Save after each model completes
        saveIntermediate();
      }
    } finally {
      if (typeof toolCleanup === 'function') toolCleanup();
      setIsRunning(false);
      setProgress(null);

      // Final save
      const finalResults = Object.keys(allResults).length > 0 ? allResults : allResultsRef.current;
      if (Object.keys(finalResults).length > 0 && api.benchmarkSaveResults) {
        api.benchmarkSaveResults({
          timestamp: new Date().toISOString(),
          models: finalResults,
        });
      }
    }
  }, [selectedModels, selectedTests, testCases]);

  // Cancel
  const cancelBenchmark = useCallback(() => {
    cancelledRef.current = true;
    window.electronAPI?.llmCancel?.();
  }, []);

  // Group tests by category
  const categories = [...new Set(testCases.map(t => t.category))];

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e] text-[#cccccc] text-[12px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <BarChart3 size={14} className="text-[#569cd6]" />
        <span className="font-semibold text-[13px]">Model Benchmark</span>
        <div className="flex-1" />
        {isRunning ? (
          <button
            onClick={cancelBenchmark}
            className="flex items-center gap-1 px-2 py-1 bg-[#d32f2f] hover:bg-[#e53935] text-white rounded text-[11px]"
          >
            <Square size={10} /> Stop
          </button>
        ) : (
          <button
            onClick={runBenchmark}
            disabled={selectedModels.size === 0 || selectedTests.size === 0}
            className="flex items-center gap-1 px-2 py-1 bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-[11px]"
          >
            <Play size={10} /> Run Benchmark
          </button>
        )}
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="px-3 py-1.5 bg-[#2d2d2d] border-b border-[#3c3c3c]">
          <div className="flex items-center gap-2 text-[11px] text-[#858585] mb-1">
            <Loader2 size={10} className="animate-spin text-[#569cd6]" />
            <span>{progress.phase}</span>
            <span className="text-[#cccccc]">{progress.model}</span>
            {progress.test && <span className="text-[#858585]">— {progress.test}</span>}
          </div>
          <div className="h-1 bg-[#3c3c3c] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#569cd6] transition-all duration-300"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {/* Model Selection */}
        <div className="px-3 py-2 border-b border-[#3c3c3c]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1 text-[11px] text-[#858585] uppercase tracking-wider">
              <Cpu size={10} /> Select Models to Test
            </div>
            {availableModels.length > 0 && (
              <button
                onClick={() => {
                  if (selectedModels.size === availableModels.length) {
                    setSelectedModels(new Set());
                  } else {
                    setSelectedModels(new Set(availableModels.map(m => m.path)));
                  }
                }}
                className="text-[10px] text-[#569cd6] hover:text-[#7ec0ee] transition-colors"
              >
                {selectedModels.size === availableModels.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          <div className="space-y-0.5 max-h-[150px] overflow-auto">
            {availableModels.map(model => (
              <label
                key={model.path}
                className="flex items-center gap-2 px-2 py-1 hover:bg-[#2a2d2e] rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedModels.has(model.path)}
                  onChange={() => toggleModel(model.path)}
                  className="accent-[#569cd6]"
                />
                <Cpu size={10} className="text-[#858585] flex-shrink-0" />
                <span className="truncate text-[11px]">{model.name}</span>
                <span className="text-[10px] text-[#858585] ml-auto flex-shrink-0">
                  {model.sizeFormatted} • {model.details?.quantization}
                </span>
              </label>
            ))}
            {availableModels.length === 0 && (
              <div className="text-[11px] text-[#858585] py-2">No local models found. Add .gguf files first.</div>
            )}
          </div>
        </div>

        {/* Test Selection */}
        <div className="px-3 py-2 border-b border-[#3c3c3c]">
          <button
            onClick={() => setShowTestPicker(!showTestPicker)}
            className="flex items-center gap-1 text-[11px] text-[#858585] uppercase tracking-wider mb-1 hover:text-[#cccccc]"
          >
            {showTestPicker ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Test Cases ({selectedTests.size}/{testCases.length})
          </button>
          {showTestPicker && (
            <div className="space-y-1 max-h-[200px] overflow-auto">
              {categories.map(cat => {
                const catTests = testCases.filter(t => t.category === cat);
                const allSelected = catTests.every(t => selectedTests.has(t.id));
                return (
                  <div key={cat}>
                    <label className="flex items-center gap-2 px-2 py-0.5 hover:bg-[#2a2d2e] rounded cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => toggleCategory(cat)}
                        className="accent-[#569cd6]"
                      />
                      {CATEGORY_ICONS[cat] || <Target size={12} />}
                      <span className="text-[11px]">{cat}</span>
                    </label>
                    {catTests.map(tc => (
                      <label
                        key={tc.id}
                        className="flex items-center gap-2 pl-7 pr-2 py-0.5 hover:bg-[#2a2d2e] rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTests.has(tc.id)}
                          onChange={() => toggleTest(tc.id)}
                          className="accent-[#569cd6]"
                        />
                        <span className="text-[11px] text-[#b0b0b0]">{tc.description}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Results */}
        {Object.keys(results).length > 0 && (
          <div className="px-3 py-2">
            <div className="text-[11px] text-[#858585] uppercase tracking-wider mb-2 flex items-center gap-1">
              <BarChart3 size={10} /> Results
            </div>

            {/* Summary cards */}
            <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${Math.min(Object.keys(results).length, 3)}, 1fr)` }}>
              {Object.values(results).map(model => (
                <div
                  key={model.modelName}
                  className={`p-2 rounded border ${
                    model.overallScore >= 70 ? 'border-[#89d185] bg-[#89d18510]' :
                    model.overallScore >= 40 ? 'border-[#dcdcaa] bg-[#dcdcaa10]' :
                    'border-[#f14c4c] bg-[#f14c4c10]'
                  }`}
                >
                  <div className="text-[11px] font-medium truncate">{model.modelName}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[18px] font-bold ${
                      model.overallScore >= 70 ? 'text-[#89d185]' :
                      model.overallScore >= 40 ? 'text-[#dcdcaa]' :
                      'text-[#f14c4c]'
                    }`}>
                      {model.overallScore}%
                    </span>
                    <span className="text-[10px] text-[#858585]">
                      {model.totalPassed}/{model.totalTests} passed
                    </span>
                  </div>
                  {model.error && (
                    <div className="text-[10px] text-[#f14c4c] mt-1">{model.error}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Detailed results per model */}
            {Object.values(results).map(model => (
              <div key={model.modelName} className="mb-3">
                <button
                  onClick={() => setExpandedModels(prev => {
                    const next = new Set(prev);
                    if (next.has(model.modelName)) next.delete(model.modelName);
                    else next.add(model.modelName);
                    return next;
                  })}
                  className="flex items-center gap-2 w-full text-left py-1 hover:bg-[#2a2d2e] rounded px-1"
                >
                  {expandedModels.has(model.modelName) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <Cpu size={10} className="text-[#858585]" />
                  <span className="text-[11px] font-medium">{model.modelName}</span>
                  <span className={`text-[11px] ml-auto ${
                    model.overallScore >= 70 ? 'text-[#89d185]' :
                    model.overallScore >= 40 ? 'text-[#dcdcaa]' :
                    'text-[#f14c4c]'
                  }`}>
                    {model.overallScore}%
                  </span>
                </button>

                {expandedModels.has(model.modelName) && (
                  <div className="ml-4 mt-1 space-y-0.5">
                    {model.tests.map(test => (
                      <div
                        key={test.testId}
                        className="flex items-start gap-2 py-1 px-2 rounded bg-[#252526] border border-[#3c3c3c]"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {test.passed ? (
                            <CheckCircle size={12} className="text-[#89d185]" />
                          ) : (
                            <XCircle size={12} className="text-[#f14c4c]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px]">{test.description}</span>
                            <span className={`text-[10px] px-1 rounded ${
                              test.score >= 70 ? 'bg-[#89d18530] text-[#89d185]' :
                              test.score >= 40 ? 'bg-[#dcdcaa30] text-[#dcdcaa]' :
                              'bg-[#f14c4c30] text-[#f14c4c]'
                            }`}>
                              {test.score}%
                            </span>
                            <span className="text-[10px] text-[#858585] flex items-center gap-0.5">
                              <Clock size={8} /> {(test.durationMs / 1000).toFixed(1)}s
                            </span>
                          </div>
                          {test.toolsCalled.length > 0 && (
                            <div className="text-[10px] text-[#569cd6] mt-0.5">
                              Tools: {test.toolsCalled.join(', ')}
                            </div>
                          )}
                          {test.errors.length > 0 && (
                            <div className="text-[10px] text-[#f14c4c] mt-0.5">
                              {test.errors.join(' | ')}
                            </div>
                          )}
                          {test.refusalDetected && (
                            <div className="text-[10px] text-[#d7ba7d] mt-0.5">
                              ⚠️ Model refused the task
                            </div>
                          )}
                          {test.response && (
                            <div className="text-[10px] text-[#858585] mt-0.5 truncate max-w-full">
                              Response: {test.response.substring(0, 150)}...
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Live results during benchmark */}
        {isRunning && liveResults.length > 0 && Object.keys(results).length === 0 && (
          <div className="px-3 py-2">
            <div className="text-[11px] text-[#858585] uppercase tracking-wider mb-2">Live Results</div>
            {liveResults.slice(-5).map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                {r.passed ? (
                  <CheckCircle size={10} className="text-[#89d185]" />
                ) : (
                  <XCircle size={10} className="text-[#f14c4c]" />
                )}
                <span className="text-[#858585]">{r.modelName}</span>
                <span>{r.description}</span>
                <span className={r.score >= 70 ? 'text-[#89d185]' : r.score >= 40 ? 'text-[#dcdcaa]' : 'text-[#f14c4c]'}>
                  {r.score}%
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isRunning && Object.keys(results).length === 0 && (
          <div className="px-3 py-8 text-center">
            <BarChart3 size={32} className="mx-auto text-[#3c3c3c] mb-3" />
            <div className="text-[12px] text-[#858585] mb-1">Model Benchmark</div>
            <div className="text-[11px] text-[#555] max-w-[250px] mx-auto">
              Select models and test cases above, then click "Run Benchmark" to test them sequentially through the exact same pipeline used in the IDE.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
