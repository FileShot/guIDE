'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  hfBenchmarkData,
  makeHFComparisonSlug,
  type HFBenchmarkEntry,
} from '@/data/hf-benchmarks';

// â”€â”€ Color palette for compared models â”€â”€
const MODEL_COLORS = ['#569cd6', '#4ec9b0', '#c586c0', '#dcdcaa', '#d7ba7d', '#89d185'];

const BENCHMARKS = ['IFEval', 'BBH', 'MATH_Lvl5', 'GPQA', 'MUSR', 'MMLU_PRO'] as const;
const BENCHMARK_LABELS: Record<string, string> = {
  IFEval: 'IFEval', BBH: 'BBH', MATH_Lvl5: 'MATH', GPQA: 'GPQA', MUSR: 'MUSR', MMLU_PRO: 'MMLU-PRO',
};
const BENCHMARK_DESCRIPTIONS: Record<string, string> = {
  IFEval: 'Instruction Following Eval',
  BBH: 'Big Bench Hard â€” complex reasoning',
  MATH_Lvl5: 'MATH Level 5 â€” competition math',
  GPQA: 'Graduate-level expert science QA',
  MUSR: 'Multi-step Soft Reasoning',
  MMLU_PRO: 'MMLU-Pro â€” professional knowledge',
};

const PICKER_PAGE_SIZE = 100;
const PICKER_PARAM_RANGES = [
  { label: 'All Sizes', min: 0, max: Infinity },
  { label: '< 3B', min: 0, max: 3 },
  { label: '3â€“7B', min: 3, max: 7.01 },
  { label: '7â€“14B', min: 7, max: 14.01 },
  { label: '14â€“34B', min: 14, max: 34.01 },
  { label: '34â€“72B', min: 34, max: 72.01 },
  { label: '72B+', min: 72, max: Infinity },
];

function scoreColor(score: number): string {
  if (score >= 45) return 'text-emerald-400';
  if (score >= 30) return 'text-cyan-400';
  if (score >= 15) return 'text-yellow-400';
  return 'text-red-400';
}

export default function ComparePage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [communitySearch, setCommunitySearch] = useState('');
  const [pickerFamilyFilter, setPickerFamilyFilter] = useState('');
  const [pickerSizeFilter, setPickerSizeFilter] = useState(0);
  const [pickerPage, setPickerPage] = useState(0);

  const selectedCommunity = useMemo(
    () => hfBenchmarkData.filter(e => selected.has('hf:' + e.model.slug)),
    [selected],
  );

  const pickerFamilyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of hfBenchmarkData) {
      counts[e.model.family] = (counts[e.model.family] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 3);
  }, []);

  const filteredCommunity = useMemo(() => {
    const q = communitySearch.toLowerCase().trim();
    let result: HFBenchmarkEntry[] = hfBenchmarkData;
    if (q) result = result.filter(e =>
      e.model.name.toLowerCase().includes(q) ||
      e.model.family.toLowerCase().includes(q) ||
      e.model.developer.toLowerCase().includes(q)
    );
    if (pickerFamilyFilter) result = result.filter(e => e.model.family === pickerFamilyFilter);
    if (pickerSizeFilter > 0) {
      const range = PICKER_PARAM_RANGES[pickerSizeFilter];
      result = result.filter(e => {
        const p = e.model.paramsBillion;
        return p <= 0 || (p >= range.min && p < range.max);
      });
    }
    return result;
  }, [communitySearch, pickerFamilyFilter, pickerSizeFilter]);

  const visibleCommunity = filteredCommunity.slice(0, (pickerPage + 1) * PICKER_PAGE_SIZE);
  const hasMore = visibleCommunity.length < filteredCommunity.length;

  const toggleModel = (slug: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else if (next.size < 6) {
        next.add(slug);
      }
      return next;
    });
  };

  const comparisonSlug = useMemo(() => {
    const hfOnly = [...selected].filter(s => s.startsWith('hf:'));
    if (hfOnly.length !== 2) return null;
    const a = hfBenchmarkData.find(e => 'hf:' + e.model.slug === hfOnly[0]);
    const b = hfBenchmarkData.find(e => 'hf:' + e.model.slug === hfOnly[1]);
    if (a && b) return makeHFComparisonSlug(a.model.name, b.model.name);
    return null;
  }, [selected]);

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Compare
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Model Head-to-Head
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            Select 2&ndash;6 models to compare their benchmark scores side by side.
          </p>
        </div>

        {/* Ad banner — 728×90 desktop / 320×50 mobile */}
        <div className="flex justify-center mb-8">
          <div className="hidden sm:block">
            <iframe src="//shopsuptight.com/watchnew?key=394217cb689e940d870aef10bfeecd47" width="728" height="90" frameBorder="0" scrolling="no" style={{border:0,maxWidth:'100%'}} />
          </div>
          <div className="block sm:hidden w-full px-2" style={{maxWidth:'100vw'}}>
            <iframe src="//shopsuptight.com/watchnew?key=0496beb6abbf30571b993deaa7013d86" width="100%" height="50" frameBorder="0" scrolling="no" style={{border:0,display:'block'}} />
          </div>
        </div>

        {/* Model Picker */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Select Models</h2>
            <span className="text-xs text-neutral-500">
              {selected.size}/6 selected
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              placeholder="Search by name, family, developer..."
              value={communitySearch}
              onChange={(e) => { setCommunitySearch(e.target.value); setPickerPage(0); }}
              className="flex-1 min-w-[200px] px-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-neutral-500 outline-none focus:border-accent/40 transition-colors"
            />
            <select
              value={pickerFamilyFilter}
              onChange={(e) => { setPickerFamilyFilter(e.target.value); setPickerPage(0); }}
              className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 outline-none focus:border-accent/40 appearance-none cursor-pointer"
            >
              <option value="">All Families</option>
              {pickerFamilyCounts.map(([family, count]) => (
                <option key={family} value={family}>{family} ({count})</option>
              ))}
            </select>
            <select
              value={pickerSizeFilter}
              onChange={(e) => { setPickerSizeFilter(Number(e.target.value)); setPickerPage(0); }}
              className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 outline-none focus:border-accent/40 appearance-none cursor-pointer"
            >
              {PICKER_PARAM_RANGES.map((r, i) => (
                <option key={i} value={i}>{r.label}</option>
              ))}
            </select>
          </div>

          <p className="text-xs text-neutral-500 mb-3">
            Showing {visibleCommunity.length.toLocaleString()} of{' '}
            {filteredCommunity.length.toLocaleString()} models
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[420px] overflow-y-auto pr-1">
            {visibleCommunity.map(entry => {
              const hfSlug = 'hf:' + entry.model.slug;
              const isSelected = selected.has(hfSlug);
              const colorIdx = [...selected].indexOf(hfSlug);
              const avg = entry.scores.average ?? 0;
              return (
                <button
                  key={entry.model.slug}
                  onClick={() => toggleModel(hfSlug)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'bg-accent/10 border-accent/30'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.12]'
                  }`}
                >
                  {isSelected && (
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: MODEL_COLORS[colorIdx] || MODEL_COLORS[0] }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{entry.model.name}</span>
                      {avg > 0 && (
                        <span className={`text-xs font-medium ${scoreColor(avg)}`}>{avg.toFixed(1)}</span>
                      )}
                      {entry.model.ggufAvailable && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          GGUF
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-neutral-500">
                      {entry.model.params} &middot; {entry.model.developer} &middot; {entry.model.family}
                    </span>
                  </div>
                </button>
              );
            })}
            {filteredCommunity.length === 0 && (
              <p className="text-sm text-neutral-500 col-span-full py-4 text-center">
                No models match your filters.
              </p>
            )}
          </div>

          {hasMore && (
            <button
              onClick={() => setPickerPage(p => p + 1)}
              className="mt-3 w-full py-2.5 rounded-lg text-sm text-neutral-400 hover:text-white border border-white/[0.08] hover:border-white/[0.16] transition-colors"
            >
              Load more ({(filteredCommunity.length - visibleCommunity.length).toLocaleString()} remaining)
            </button>
          )}
        </div>

        {/* Comparison Content */}
        <AnimatePresence mode="wait">
          {selectedCommunity.length >= 2 ? (
            <motion.div
              key="comparison"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Quick Stats */}
              <div
                className="grid gap-4 mb-8"
                style={{ gridTemplateColumns: `repeat(${Math.min(selectedCommunity.length, 4)}, 1fr)` }}
              >
                {selectedCommunity.map((entry, i) => {
                  const avg = entry.scores.average ?? 0;
                  return (
                    <div
                      key={entry.model.slug}
                      className="bg-white/[0.03] border rounded-xl p-5 text-center"
                      style={{ borderColor: MODEL_COLORS[i] + '40' }}
                    >
                      <div
                        className="w-4 h-4 rounded-full mx-auto mb-2"
                        style={{ backgroundColor: MODEL_COLORS[i] }}
                      />
                      <h3 className="text-sm font-semibold text-white mb-1">{entry.model.name}</h3>
                      <div className={`text-3xl font-bold mb-2 ${scoreColor(avg)}`}>
                        {avg.toFixed(1)}
                      </div>
                      <div className="space-y-1 text-xs text-neutral-400">
                        <div>{entry.model.params}</div>
                        <div>{entry.model.developer}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Benchmark Bars */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6 mb-8">
                <h2 className="text-lg font-semibold text-white mb-6">Benchmark Scores</h2>
                <div className="space-y-6">
                  {BENCHMARKS.map(b => (
                    <div key={b}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm text-white font-medium">{BENCHMARK_LABELS[b]}</span>
                        <span className="text-xs text-neutral-600">{BENCHMARK_DESCRIPTIONS[b]}</span>
                      </div>
                      <div className="space-y-1.5">
                        {selectedCommunity.map((entry, i) => {
                          const s = entry.scores[b];
                          return (
                            <div key={entry.model.slug} className="flex items-center gap-3">
                              <span className="text-xs text-neutral-400 w-28 truncate">
                                {entry.model.name}
                              </span>
                              <div className="flex-1 h-5 bg-white/[0.04] rounded-md overflow-hidden relative">
                                {s != null && (
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${s}%` }}
                                    transition={{ duration: 0.8, delay: i * 0.1 }}
                                    className="h-full rounded-md"
                                    style={{ backgroundColor: MODEL_COLORS[i], opacity: 0.75 }}
                                  />
                                )}
                                <span className="absolute right-2 top-0 h-full flex items-center text-[11px] font-bold text-white">
                                  {s != null ? s.toFixed(1) : 'â€”'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-white/[0.06]">
                  {selectedCommunity.map((entry, i) => (
                    <div key={entry.model.slug} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MODEL_COLORS[i] }} />
                      <span className="text-xs text-neutral-300">{entry.model.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Specs Table */}
              <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-8">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                      <th className="text-left px-4 py-3 text-neutral-400 font-medium">Specification</th>
                      {selectedCommunity.map((entry, i) => (
                        <th key={entry.model.slug} className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[i] }} />
                            <span className="text-white font-medium">{entry.model.name}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      {
                        label: 'Avg Score',
                        render: (e: HFBenchmarkEntry) => (
                          <span className={`font-bold ${scoreColor(e.scores.average ?? 0)}`}>
                            {e.scores.average?.toFixed(1) ?? 'â€”'}
                          </span>
                        ),
                      },
                      { label: 'Parameters', render: (e: HFBenchmarkEntry) => e.model.params },
                      { label: 'Developer', render: (e: HFBenchmarkEntry) => e.model.developer },
                      { label: 'Family', render: (e: HFBenchmarkEntry) => e.model.family },
                      { label: 'Architecture', render: (e: HFBenchmarkEntry) => e.model.architecture },
                      { label: 'License', render: (e: HFBenchmarkEntry) => e.model.license || 'Unknown' },
                      {
                        label: 'HF Likes',
                        render: (e: HFBenchmarkEntry) => e.model.likes.toLocaleString(),
                      },
                      {
                        label: 'GGUF',
                        render: (e: HFBenchmarkEntry) =>
                          e.model.ggufAvailable ? (
                            <span className="text-emerald-400">âœ“ Available</span>
                          ) : (
                            <span className="text-neutral-600">â€”</span>
                          ),
                      },
                    ] as const).map(({ label, render }, ri) => (
                      <tr
                        key={label}
                        className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}
                      >
                        <td className="px-4 py-2.5 text-neutral-400">{label}</td>
                        {selectedCommunity.map(entry => (
                          <td key={entry.model.slug} className="px-4 py-2.5 text-center text-neutral-300">
                            {render(entry)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Shareable Link */}
              {comparisonSlug && (
                <div className="text-center mt-8 mb-4">
                  <Link
                    href={`/models/compare/${comparisonSlug}`}
                    className="text-sm text-accent hover:underline"
                  >
                    Permanent link to this comparison &rarr;
                  </Link>
                </div>
              )}

              {/* Winner Summary */}
              <WinnerSummary entries={selectedCommunity} />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16 text-neutral-500"
            >
              <svg
                className="w-16 h-16 mx-auto mb-4 text-neutral-700"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <p className="text-lg mb-2">Select at least 2 models to compare</p>
              <p className="text-sm">
                Choose from {hfBenchmarkData.length.toLocaleString()} community models above
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// â”€â”€ Winner summary â”€â”€
function WinnerSummary({ entries }: { entries: HFBenchmarkEntry[] }) {
  if (entries.length < 2) return null;

  const sorted = [...entries].sort((a, b) => (b.scores.average ?? 0) - (a.scores.average ?? 0));
  const winner = sorted[0];
  const winnerAvg = winner.scores.average ?? 0;
  const runnerAvg = sorted[1].scores.average ?? 0;
  const isClose = winnerAvg - runnerAvg <= 2;

  return (
    <div className="bg-gradient-to-br from-accent/[0.08] to-transparent border border-accent/20 rounded-xl p-6 text-center">
      <h3 className="text-xs uppercase tracking-wider text-accent mb-2">
        {isClose ? 'Very Close Match' : 'Leader'}
      </h3>
      <h2 className="text-2xl font-bold text-white mb-2">{winner.model.name}</h2>
      <p className="text-neutral-400 text-sm mb-4">
        {isClose
          ? `Only ${(winnerAvg - runnerAvg).toFixed(1)} points ahead of ${sorted[1].model.name}`
          : `Leads with ${winnerAvg.toFixed(1)} average score`}
      </p>
      <div className="flex flex-wrap justify-center gap-3 text-xs">
        {BENCHMARKS.map(b => {
          const scores = entries.map(e => ({ name: e.model.name, score: e.scores[b] ?? 0 }));
          const top = [...scores].sort((a, c) => c.score - a.score)[0];
          if (!top.score) return null;
          return (
            <span key={b} className="px-3 py-1 rounded-full bg-white/[0.05] text-neutral-400">
              {BENCHMARK_LABELS[b]}: <span className="text-white font-medium">{top.name}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

