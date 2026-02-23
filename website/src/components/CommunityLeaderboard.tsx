'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  hfBenchmarkData,
  hfBenchmarkStats,
  makeHFComparisonSlug,
  type HFBenchmarkEntry,
} from '@/data/hf-benchmarks';

// ── Score color helpers ──
function scoreColor(score: number): string {
  if (score >= 45) return 'text-emerald-400';
  if (score >= 30) return 'text-cyan-400';
  if (score >= 15) return 'text-yellow-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 45) return 'bg-emerald-400';
  if (score >= 30) return 'bg-cyan-400';
  if (score >= 15) return 'bg-yellow-400';
  return 'bg-red-400';
}

function rankBadge(i: number): string {
  if (i === 0) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (i === 1) return 'bg-neutral-400/20 text-neutral-300 border-neutral-400/30';
  if (i === 2) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  return 'bg-white/5 text-neutral-500 border-white/10';
}

const BENCHMARKS = ['IFEval', 'BBH', 'MATH_Lvl5', 'GPQA', 'MUSR', 'MMLU_PRO'] as const;
const BENCHMARK_LABELS: Record<string, string> = {
  IFEval: 'IFEval',
  BBH: 'BBH',
  MATH_Lvl5: 'MATH',
  GPQA: 'GPQA',
  MUSR: 'MUSR',
  MMLU_PRO: 'MMLU-PRO',
};
const BENCHMARK_DESCRIPTIONS: Record<string, string> = {
  IFEval: 'Instruction Following Eval — measures how well models follow complex instructions',
  BBH: 'Big Bench Hard — challenging reasoning tasks beyond standard benchmarks',
  MATH_Lvl5: 'MATH Level 5 — competition-level mathematics problems',
  GPQA: 'Graduate-level QA — expert-level science questions written by PhDs',
  MUSR: 'Multi-step Soft Reasoning — complex multi-hop reasoning chains',
  MMLU_PRO: 'MMLU-Pro — massive multitask language understanding, professional level',
};

type SortField = 'average' | 'IFEval' | 'BBH' | 'MATH_Lvl5' | 'GPQA' | 'MUSR' | 'MMLU_PRO' | 'params' | 'likes';

const PAGE_SIZE = 50;

const PARAM_RANGES = [
  { label: 'All Sizes', min: 0, max: Infinity },
  { label: '< 3B', min: 0, max: 3 },
  { label: '3–7B', min: 3, max: 7.01 },
  { label: '7–14B', min: 7, max: 14.01 },
  { label: '14–34B', min: 14, max: 34.01 },
  { label: '34–72B', min: 34, max: 72.01 },
  { label: '72B+', min: 72, max: Infinity },
];

export default function CommunityLeaderboard() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('average');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [familyFilter, setFamilyFilter] = useState('');
  const [paramRange, setParamRange] = useState(0);
  const [ggufOnly, setGgufOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [developerFilter, setDeveloperFilter] = useState('');
  const [hasScores, setHasScores] = useState(false);

  const toggleSelect = useCallback((slug: string) => {
    setSelectedSlugs(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else if (next.size < 2) {
        next.add(slug);
      } else {
        // Replace the first selected with new selection
        const arr = [...next];
        next.delete(arr[0]);
        next.add(slug);
      }
      return next;
    });
  }, []);

  const handleCompare = useCallback(() => {
    if (selectedSlugs.size !== 2) return;
    const [a, b] = [...selectedSlugs];
    const slug = makeHFComparisonSlug(
      hfBenchmarkData.find(e => e.model.slug === a)?.model.name || a,
      hfBenchmarkData.find(e => e.model.slug === b)?.model.name || b,
    );
    router.push(`/models/compare/${slug}`);
  }, [selectedSlugs, router]);

  const selectedNames = useMemo(() => {
    return [...selectedSlugs].map(slug => {
      const entry = hfBenchmarkData.find(e => e.model.slug === slug);
      return entry?.model.name || slug;
    });
  }, [selectedSlugs]);

  const familyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of hfBenchmarkData) {
      counts[e.model.family] = (counts[e.model.family] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count >= 3);
  }, []);

  const developerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of hfBenchmarkData) {
      counts[e.model.developer] = (counts[e.model.developer] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count >= 3);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const range = PARAM_RANGES[paramRange];

    let result = hfBenchmarkData.filter((e) => {
      if (q && !e.model.name.toLowerCase().includes(q) && !e.model.developer.toLowerCase().includes(q) && !e.model.family.toLowerCase().includes(q)) return false;
      if (familyFilter && e.model.family !== familyFilter) return false;
      if (developerFilter && e.model.developer !== developerFilter) return false;
      if (hasScores && (e.scores.average == null || e.scores.average <= 0)) return false;
      if (ggufOnly && !e.model.ggufAvailable) return false;
      const p = e.model.paramsBillion;
      if (range && p > 0 && (p < range.min || p >= range.max)) return false;
      return true;
    });

    result.sort((a, b) => {
      let av: number, bv: number;
      if (sortField === 'params') {
        av = a.model.paramsBillion; bv = b.model.paramsBillion;
      } else if (sortField === 'likes') {
        av = a.model.likes; bv = b.model.likes;
      } else {
        av = a.scores[sortField] ?? 0;
        bv = b.scores[sortField] ?? 0;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });

    return result;
  }, [search, sortField, sortDir, familyFilter, developerFilter, hasScores, paramRange, ggufOnly]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  }

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  return (
    <>
      {/* Benchmark explanations */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 mb-10">
        <h2 className="text-lg font-semibold text-white mb-4">The 6 Benchmarks</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Scores from the Open LLM Leaderboard v2 — six evaluations covering instruction following,
          reasoning, math, and knowledge.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {BENCHMARKS.map(b => (
            <div key={b}>
              <div className="text-accent font-medium mb-1">{BENCHMARK_LABELS[b]}</div>
              <p className="text-neutral-400">{BENCHMARK_DESCRIPTIONS[b]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search models, families, developers..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="flex-1 min-w-[200px] px-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-neutral-500 outline-none focus:border-accent/40 transition-colors"
        />
        <select
          value={familyFilter}
          onChange={(e) => { setFamilyFilter(e.target.value); setPage(0); }}
          className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 outline-none focus:border-accent/40 appearance-none cursor-pointer"
        >
          <option value="">All Families</option>
          {familyCounts.map(([family, count]) => (
            <option key={family} value={family}>{family} ({count})</option>
          ))}
        </select>
        <select
          value={paramRange}
          onChange={(e) => { setParamRange(Number(e.target.value)); setPage(0); }}
          className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 outline-none focus:border-accent/40 appearance-none cursor-pointer"
        >
          {PARAM_RANGES.map((r, i) => (
            <option key={i} value={i}>{r.label}</option>
          ))}
        </select>
        <button
          onClick={() => { setGgufOnly(!ggufOnly); setPage(0); }}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
            ggufOnly
              ? 'bg-accent/20 text-accent border-accent/30'
              : 'bg-white/[0.04] text-neutral-400 border-white/[0.08] hover:text-white'
          }`}
        >
          GGUF Only
        </button>
        <select
          value={developerFilter}
          onChange={(e) => { setDeveloperFilter(e.target.value); setPage(0); }}
          className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 outline-none focus:border-accent/40 appearance-none cursor-pointer"
        >
          <option value="">All Developers</option>
          {developerCounts.map(([developer, count]) => (
            <option key={developer} value={developer}>{developer} ({count})</option>
          ))}
        </select>
        <button
          onClick={() => { setHasScores(!hasScores); setPage(0); }}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
            hasScores
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : 'bg-white/[0.04] text-neutral-400 border-white/[0.08] hover:text-white'
          }`}
        >
          Has Scores
        </button>
        <div className="flex items-center gap-1.5">
          <select
            value={sortField}
            onChange={(e) => { setSortField(e.target.value as SortField); setPage(0); }}
            className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 outline-none focus:border-accent/40 appearance-none cursor-pointer"
          >
            <option value="average">Sort: Avg Score</option>
            <option value="IFEval">Sort: IFEval</option>
            <option value="BBH">Sort: BBH</option>
            <option value="MATH_Lvl5">Sort: MATH</option>
            <option value="GPQA">Sort: GPQA</option>
            <option value="MUSR">Sort: MUSR</option>
            <option value="MMLU_PRO">Sort: MMLU-PRO</option>
            <option value="params">Sort: Params</option>
            <option value="likes">Sort: Likes</option>
          </select>
          <button
            onClick={() => { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); setPage(0); }}
            className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-neutral-300 hover:text-white transition-colors"
            title="Toggle sort direction"
          >
            {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-neutral-500">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
          <span className="text-neutral-300">{filtered.length.toLocaleString()}</span> models
        </p>
      </div>

      {/* Leaderboard Table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="px-2 py-3 text-center text-neutral-500 font-medium w-8">
                <span className="sr-only">Select</span>
              </th>
              <th className="text-left px-3 py-3 text-neutral-400 font-medium w-10">#</th>
              <th className="text-left px-3 py-3 text-neutral-400 font-medium min-w-[200px]">Model</th>
              <th
                className="px-3 py-3 text-center text-neutral-400 font-medium cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => handleSort('average')}
              >
                Avg{sortArrow('average')}
              </th>
              <th
                className="px-3 py-3 text-center text-neutral-400 font-medium cursor-pointer hover:text-white transition-colors hidden sm:table-cell select-none"
                onClick={() => handleSort('params')}
              >
                Params{sortArrow('params')}
              </th>
              {BENCHMARKS.map(b => (
                <th
                  key={b}
                  className="px-2 py-3 text-center text-neutral-500 font-medium text-[11px] cursor-pointer hover:text-white transition-colors hidden lg:table-cell select-none"
                  onClick={() => handleSort(b)}
                  title={BENCHMARK_DESCRIPTIONS[b]}
                >
                  {BENCHMARK_LABELS[b]}{sortArrow(b)}
                </th>
              ))}
              <th className="px-3 py-3 text-center text-neutral-400 font-medium w-16 hidden md:table-cell">GGUF</th>
              <th className="px-3 py-3 text-center text-neutral-400 font-medium w-24">Compare</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map((entry, i) => {
              const globalRank = page * PAGE_SIZE + i;
              const isExpanded = expandedRow === entry.model.slug;
              const isSelected = selectedSlugs.has(entry.model.slug);
              return (
                <LeaderboardRow
                  key={entry.model.slug + globalRank}
                  entry={entry}
                  rank={globalRank}
                  expanded={isExpanded}
                  selected={isSelected}
                  onToggle={() => setExpandedRow(isExpanded ? null : entry.model.slug)}
                  onSelect={() => toggleSelect(entry.model.slug)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mb-10">
          <button
            onClick={() => setPage(0)}
            disabled={page === 0}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            First
          </button>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span className="px-4 py-1.5 text-sm text-neutral-300">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] text-neutral-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Last
          </button>
        </div>
      )}

      {/* Top 20 Score Chart */}
      <h2 className="text-2xl font-bold text-white mb-6">Top 20 by Average Score</h2>
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6 mb-10">
        {hfBenchmarkData.slice(0, 20).map((entry, i) => {
          const avg = entry.scores.average ?? 0;
          const maxAvg = hfBenchmarkData[0]?.scores.average ?? 1;
          return (
            <div key={entry.model.slug} className="flex items-center gap-4 mb-3 last:mb-0">
              <div className="w-8 text-right text-neutral-500 text-xs font-bold">{i + 1}</div>
              <Link href={`/models/${entry.model.slug}`} className="w-40 sm:w-56 text-sm text-accent hover:underline truncate font-medium" onClick={(e) => e.stopPropagation()}>
                {entry.model.name}
              </Link>
              <div className="flex-1 h-7 bg-white/[0.04] rounded-lg overflow-hidden relative">
                <div
                  className={`h-full rounded-lg ${scoreBg(avg)}`}
                  style={{ width: `${(avg / maxAvg) * 100}%`, opacity: 0.7 }}
                />
                <span className="absolute inset-0 flex items-center justify-end pr-3 text-xs font-bold text-white">
                  {avg.toFixed(1)}
                </span>
              </div>
              <div className="w-16 text-right text-xs text-neutral-500">
                {entry.model.params}
              </div>
            </div>
          );
        })}
      </div>

      {/* Benchmark Category Breakdown */}
      <h2 className="text-2xl font-bold text-white mb-6">Category Leaders</h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-10">
        {BENCHMARKS.map((b) => {
          const benchmarkColors: Record<string, string> = {
            IFEval: '#34d399', BBH: '#22d3ee', MATH_Lvl5: '#facc15',
            GPQA: '#fb923c', MUSR: '#a78bfa', MMLU_PRO: '#f472b6',
          };
          const color = benchmarkColors[b] || '#569cd6';
          const sorted = [...hfBenchmarkData]
            .filter(e => e.scores[b] != null)
            .sort((a, bb) => (bb.scores[b] ?? 0) - (a.scores[b] ?? 0))
            .slice(0, 8);
          return (
            <div key={b} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <h3 className="text-sm font-semibold text-white">{BENCHMARK_LABELS[b]}</h3>
              </div>
              <p className="text-xs text-neutral-500 mb-4">{BENCHMARK_DESCRIPTIONS[b]}</p>
              <div className="space-y-2">
                {sorted.map((e) => {
                  const s = e.scores[b] ?? 0;
                  return (
                    <div key={e.model.slug} className="flex items-center gap-2">
                      <span className="text-xs text-neutral-400 w-28 truncate">{e.model.name}</span>
                      <div className="flex-1 h-3 bg-white/[0.04] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${s}%`, backgroundColor: color, opacity: 0.7 }}
                        />
                      </div>
                      <span className={`text-xs font-medium w-10 text-right ${scoreColor(s)}`}>
                        {s.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
        <StatCard label="Total Models" value={hfBenchmarkStats.totalModels.toLocaleString()} />
        <StatCard label="With GGUF" value={hfBenchmarkStats.modelsWithGGUF.toString()} />
        <StatCard label="Model Families" value={hfBenchmarkStats.families.length.toString()} />
        <StatCard label="Developers" value={hfBenchmarkStats.developers.length.toString()} />
      </div>

      {/* Sticky Compare Bar */}
      {selectedSlugs.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-neutral-900/98 backdrop-blur-xl border-t-2 border-accent/50 px-6 py-4 shadow-[0_-8px_40px_rgba(0,122,204,0.25)]">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
            <div className="flex items-center gap-4 min-w-0">
              <div className="shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-accent/70 font-semibold mb-0.5">Model Compare</div>
                <div className="text-base font-bold text-white">{selectedSlugs.size}/2 selected</div>
              </div>
              <div className="h-10 w-px bg-white/10 shrink-0" />
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                {selectedNames.map((name, i) => (
                  <span key={i} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/15 text-white text-sm font-medium border border-accent/30 truncate max-w-[260px]">
                    <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    {name}
                    <button
                      onClick={() => toggleSelect([...selectedSlugs][i])}
                      className="ml-1 text-neutral-400 hover:text-white text-xs shrink-0"
                      aria-label={`Remove ${name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {selectedSlugs.size === 1 && (
                  <span className="text-sm text-neutral-500 italic">← Pick one more model to compare</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setSelectedSlugs(new Set())}
                className="px-4 py-2.5 text-sm text-neutral-400 hover:text-white border border-white/[0.1] rounded-lg transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleCompare}
                disabled={selectedSlugs.size !== 2}
                className="px-8 py-3 rounded-xl bg-accent text-white font-bold text-base hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_30px_rgba(0,122,204,0.4)] disabled:shadow-none"
              >
                {selectedSlugs.size === 2 ? 'Compare Now →' : `${selectedSlugs.size}/2 Selected`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Leaderboard row ──
function LeaderboardRow({
  entry,
  rank,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  entry: HFBenchmarkEntry;
  rank: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const avg = entry.scores.average ?? 0;
  return (
    <>
      <tr
        className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors cursor-pointer ${selected ? 'bg-accent/[0.06]' : ''}`}
        onClick={onToggle}
      >
        <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onSelect}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
              selected
                ? 'bg-accent border-accent text-black'
                : 'border-white/20 hover:border-accent/60'
            }`}
            title={selected ? 'Deselect for comparison' : 'Select for comparison'}
          >
            {selected && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </td>
        <td className="px-3 py-3">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border ${rankBadge(rank)}`}>
            {rank + 1}
          </span>
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-col">
            <Link href={`/models/${entry.model.slug}`} className="text-accent hover:underline font-medium text-[13px]" onClick={(e) => e.stopPropagation()}>{entry.model.name}</Link>
            <span className="text-[11px] text-neutral-500">
              {entry.model.developer} · {entry.model.family}
            </span>
          </div>
        </td>
        <td className="px-3 py-3 text-center">
          <span className={`text-base font-bold ${scoreColor(avg)}`}>
            {avg.toFixed(1)}
          </span>
        </td>
        <td className="px-3 py-3 text-center hidden sm:table-cell">
          <span className="text-neutral-300 text-xs">{entry.model.params}</span>
        </td>
        {BENCHMARKS.map(b => {
          const s = entry.scores[b];
          return (
            <td key={b} className="px-2 py-3 text-center hidden lg:table-cell">
              {s != null ? (
                <span className={`text-xs font-medium ${scoreColor(s)}`}>{s.toFixed(1)}</span>
              ) : (
                <span className="text-neutral-600 text-xs">—</span>
              )}
            </td>
          );
        })}
        <td className="px-3 py-3 text-center hidden md:table-cell">
          {entry.model.ggufAvailable ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              GGUF
            </span>
          ) : (
            <span className="text-neutral-600 text-xs">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onSelect}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              selected
                ? 'bg-accent/20 text-accent border-accent/30'
                : 'bg-white/[0.04] text-neutral-400 border-white/[0.08] hover:bg-accent/10 hover:text-accent hover:border-accent/20'
            }`}
          >
            {selected ? '✓ Added' : '+ Compare'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-white/[0.06]">
          <td colSpan={5 + BENCHMARKS.length + 2} className="px-4 py-4 bg-white/[0.02]">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2 text-xs mb-4">
              <div><span className="text-neutral-500">Developer:</span> <span className="text-neutral-300">{entry.model.developer}</span></div>
              <div><span className="text-neutral-500">Family:</span> <span className="text-neutral-300">{entry.model.family}</span></div>
              <div><span className="text-neutral-500">Parameters:</span> <span className="text-neutral-300">{entry.model.params}</span></div>
              <div><span className="text-neutral-500">Architecture:</span> <span className="text-neutral-300">{entry.model.architecture}</span></div>
              <div><span className="text-neutral-500">License:</span> <span className="text-neutral-300">{entry.model.license || 'Unknown'}</span></div>
              <div><span className="text-neutral-500">Likes:</span> <span className="text-neutral-300">{entry.model.likes.toLocaleString()}</span></div>
              <div className="col-span-2">
                <span className="text-neutral-500">Capabilities:</span>{' '}
                {entry.model.capabilities.map(c => (
                  <span key={c} className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 mr-1">
                    {c}
                  </span>
                ))}
              </div>
            </div>
            {/* Score bars */}
            <div className="space-y-1.5">
              {BENCHMARKS.map(b => {
                const s = entry.scores[b];
                if (s == null) return null;
                return (
                  <div key={b} className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 w-20">{BENCHMARK_LABELS[b]}</span>
                    <div className="flex-1 h-4 bg-white/[0.04] rounded overflow-hidden">
                      <div className={`h-full rounded ${scoreBg(s)}`} style={{ width: `${s}%`, opacity: 0.7 }} />
                    </div>
                    <span className={`text-xs font-medium w-10 text-right ${scoreColor(s)}`}>{s.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
            {/* Links */}
            <div className="mt-4 flex flex-wrap gap-4">
              <Link
                href={`/models/${entry.model.slug}`}
                className="text-xs text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Full Details & Compare →
              </Link>
              <a
                href={entry.model.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-neutral-400 hover:text-white hover:underline"
              >
                View Model Source →
              </a>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Stat card ──
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 text-center">
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-neutral-400">{label}</div>
    </div>
  );
}
