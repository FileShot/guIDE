'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  allModels,
  capabilityInfo,
  tierLabels,
  type Model,
  type Capability,
  type Tier,
} from '@/data/models';

interface SystemSpecs {
  ram: number;
  vram: number;
  cpuCores: number;
}

const speedColors: Record<string, string> = {
  'Very Fast': 'text-green-400',
  Fast: 'text-green-400',
  Moderate: 'text-yellow-400',
  Slower: 'text-orange-400',
  Slow: 'text-red-400',
};

const qualityColors: Record<string, string> = {
  Basic: 'text-neutral-400',
  Good: 'text-purple-400',
  'Very Good': 'text-cyan-400',
  Excellent: 'text-purple-400',
  Outstanding: 'text-yellow-400',
};

// Score a model for a given system — higher is better fit
function scoreModel(model: Model, specs: SystemSpecs): number {
  const headroom = specs.ram * 0.85 - model.ramNeeded;
  if (headroom < 0) return -1; // can't run
  // Prefer models that use most of available RAM (within 40%)
  const utilizationScore = 1 - Math.abs(headroom) / (specs.ram * 0.85);
  // Quality bonus
  const qualityBonus =
    model.quality === 'Outstanding' ? 5 :
    model.quality === 'Excellent'   ? 4 :
    model.quality === 'Very Good'   ? 3 :
    model.quality === 'Good'        ? 2 : 1;
  // VRAM bonus — if user has a GPU and model can use it
  const vramBonus = specs.vram > 0 && model.vramNeeded > 0 && model.vramNeeded <= specs.vram ? 1.5 : 0;
  // Recommended/editor pick bonus
  const recBonus = model.recommended ? 0.8 : 0;
  return utilizationScore * 3 + qualityBonus + vramBonus + recBonus;
}

export default function ModelRecommenderPage() {
  const [specs, setSpecs] = useState<SystemSpecs>({ ram: 16, vram: 0, cpuCores: 8 });
  const [filterTier, setFilterTier] = useState<string>('all');
  const [selectedCaps, setSelectedCaps] = useState<Set<Capability>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  // Compatible models (fit in RAM)
  const compatible = useMemo(
    () => allModels.filter((m) => m.ramNeeded <= specs.ram * 0.85),
    [specs.ram],
  );

  // Top picks — score and pick the best 5
  const topPicks = useMemo(() => {
    const scored = compatible
      .map((m) => ({ model: m, score: scoreModel(m, specs) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    // Pick top 5, but ensure variety — max 2 per tier
    const picks: Model[] = [];
    const tierCount: Record<string, number> = {};
    for (const { model } of scored) {
      const tc = tierCount[model.tier] || 0;
      if (tc >= 2) continue;
      picks.push(model);
      tierCount[model.tier] = tc + 1;
      if (picks.length >= 5) break;
    }
    return picks;
  }, [compatible, specs]);

  // Apply all filters
  const filteredModels = useMemo(() => {
    let pool = showAll ? allModels : compatible;
    if (filterTier !== 'all') pool = pool.filter((m) => m.tier === filterTier);
    if (selectedCaps.size > 0) {
      pool = pool.filter((m) =>
        Array.from(selectedCaps).every((cap) => m.capabilities.includes(cap)),
      );
    }
    return pool;
  }, [showAll, compatible, filterTier, selectedCaps]);

  const toggleCap = (cap: Capability) => {
    setSelectedCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  };

  const compatibleNames = useMemo(() => new Set(compatible.map((m) => m.name)), [compatible]);

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Model Recommender
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Find Your Perfect Model
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            {allModels.length} curated GGUF models across every size and specialty.
            Set your specs, filter by capability, and download.
          </p>
          <div className="flex items-center justify-center gap-4 mt-6">
            <Link
              href="/models/benchmarks"
              className="text-sm px-4 py-2 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
            >
              View Benchmark Leaderboard →
            </Link>
            <Link
              href="/models/compare"
              className="text-sm px-4 py-2 rounded-lg bg-white/5 text-neutral-300 border border-white/10 hover:bg-white/10 transition-colors"
            >
              Compare Models Head-to-Head →
            </Link>
          </div>
        </motion.div>

        {/* System Specs Card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 sm:p-8 mb-8"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">Your System Specs</h2>
            <span className="text-xs text-neutral-500">
              {compatible.length} models can run on your hardware
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* RAM */}
            <div>
              <label className="block text-sm text-neutral-400 mb-2">System RAM (GB)</label>
              <input
                type="range" min={4} max={128} step={4} value={specs.ram}
                onChange={(e) => setSpecs({ ...specs, ram: Number(e.target.value) })}
                className="w-full accent-accent"
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-neutral-600">4 GB</span>
                <span className="text-lg font-bold text-white">{specs.ram} GB</span>
                <span className="text-xs text-neutral-600">128 GB</span>
              </div>
            </div>
            {/* VRAM */}
            <div>
              <label className="block text-sm text-neutral-400 mb-2">GPU VRAM (GB)</label>
              <input
                type="range" min={0} max={48} step={2} value={specs.vram}
                onChange={(e) => setSpecs({ ...specs, vram: Number(e.target.value) })}
                className="w-full accent-accent"
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-neutral-600">0 GB</span>
                <span className="text-lg font-bold text-white">{specs.vram} GB</span>
                <span className="text-xs text-neutral-600">48 GB</span>
              </div>
            </div>
            {/* CPU Cores */}
            <div>
              <label className="block text-sm text-neutral-400 mb-2">CPU Cores</label>
              <input
                type="range" min={2} max={32} step={2} value={specs.cpuCores}
                onChange={(e) => setSpecs({ ...specs, cpuCores: Number(e.target.value) })}
                className="w-full accent-accent"
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-neutral-600">2</span>
                <span className="text-lg font-bold text-white">{specs.cpuCores} Cores</span>
                <span className="text-xs text-neutral-600">32</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Top Picks Section */}
        <AnimatePresence>
          {topPicks.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-10"
            >
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                Top Picks for Your System
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {topPicks.map((model, i) => (
                  <motion.a
                    key={model.name}
                    href={model.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="group bg-gradient-to-br from-accent/[0.06] to-transparent border border-accent/15 hover:border-accent/30 rounded-xl p-4 transition-all hover:shadow-[0_0_20px_rgba(0,122,204,0.1)]"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${tierLabels[model.tier].color}`}>
                        {tierLabels[model.tier].label}
                      </span>
                      {model.new && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                          New
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-white group-hover:text-accent transition-colors truncate">
                      {model.name}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{model.bestFor}</p>
                    <div className="flex items-center justify-between mt-3 text-xs">
                      <span className={qualityColors[model.quality]}>{model.quality}</span>
                      <span className="text-neutral-600">{model.downloadSize}</span>
                    </div>
                  </motion.a>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Capability Filters */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-6"
        >
          <h3 className="text-sm font-medium text-neutral-400 mb-3">Filter by Capability</h3>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(capabilityInfo) as [Capability, typeof capabilityInfo[Capability]][]).map(
              ([key, info]) => {
                const active = selectedCaps.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleCap(key)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                      active
                        ? info.color + ' font-semibold'
                        : 'bg-white/[0.03] border-white/[0.06] text-neutral-500 hover:text-white hover:border-white/[0.12]'
                    }`}
                    title={info.description}
                  >
                    {info.label}
                  </button>
                );
              },
            )}
            {selectedCaps.size > 0 && (
              <button
                onClick={() => setSelectedCaps(new Set())}
                className="text-xs px-3 py-1.5 rounded-lg text-neutral-600 hover:text-white transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </motion.div>

        {/* Tier Filters + Show All */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            onClick={() => setFilterTier('all')}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              filterTier === 'all'
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white/[0.03] border-white/[0.06] text-neutral-500 hover:text-white'
            }`}
          >
            All Tiers
          </button>
          {(Object.entries(tierLabels) as [Tier, typeof tierLabels[Tier]][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setFilterTier(key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filterTier === key
                  ? val.color
                  : 'bg-white/[0.03] border-white/[0.06] text-neutral-500 hover:text-white'
              }`}
            >
              {val.label}
              <span className="ml-1 text-neutral-600">
                ({(showAll ? allModels : compatible).filter((m) => m.tier === key).length})
              </span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-neutral-600">{filteredModels.length} models</span>
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-xs text-neutral-500 hover:text-white transition-colors"
            >
              {showAll ? 'Show compatible only' : 'Show all models'}
            </button>
          </div>
        </div>

        {/* Model Cards */}
        <div className="grid gap-3">
          {filteredModels.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">
              <p className="text-lg mb-2">No models match your filters</p>
              <p className="text-sm">
                Try adjusting your specs, clearing capability filters, or clicking &ldquo;Show all models&rdquo;
              </p>
            </div>
          ) : (
            filteredModels.map((model, i) => {
              const isCompat = compatibleNames.has(model.name);
              const isTopPick = topPicks.some((tp) => tp.name === model.name);
              const isExpanded = expandedModel === model.name;
              return (
                <motion.div
                  key={model.name}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.6) }}
                  className={`bg-white/[0.03] border rounded-xl p-5 transition-all hover:bg-white/[0.05] cursor-pointer ${
                    isCompat
                      ? 'border-white/[0.06] hover:border-white/[0.12]'
                      : 'border-red-500/10 opacity-60'
                  } ${isTopPick ? 'ring-1 ring-accent/20' : ''}`}
                  onClick={() => setExpandedModel(isExpanded ? null : model.name)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Model Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-lg font-semibold text-white">{model.name}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${tierLabels[model.tier].color}`}>
                          {tierLabels[model.tier].label}
                        </span>
                        {model.new && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                            New
                          </span>
                        )}
                        {model.recommended && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-semibold flex items-center gap-0.5">
                            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                            Pick
                          </span>
                        )}
                        {!isCompat && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                            Needs more RAM
                          </span>
                        )}
                        {isTopPick && isCompat && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-semibold">
                            Top Pick
                          </span>
                        )}
                      </div>

                      {/* Capability tags */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {model.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${capabilityInfo[cap].color}`}
                          >
                            {capabilityInfo[cap].label}
                          </span>
                        ))}
                      </div>

                      <p className="text-sm text-neutral-500 mb-2">{model.description}</p>

                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                        <span className="text-neutral-500">
                          Params: <span className="text-neutral-300">{model.params}</span>
                        </span>
                        <span className="text-neutral-500">
                          Quant: <span className="text-neutral-300">{model.quant}</span>
                        </span>
                        <span className="text-neutral-500">
                          RAM: <span className="text-neutral-300">{model.ramNeeded} GB</span>
                        </span>
                        <span className="text-neutral-500">
                          VRAM: <span className="text-neutral-300">{model.vramNeeded} GB</span>
                        </span>
                        <span className="text-neutral-500">
                          Speed: <span className={speedColors[model.speed]}>{model.speed}</span>
                        </span>
                        <span className="text-neutral-500">
                          Quality: <span className={qualityColors[model.quality]}>{model.quality}</span>
                        </span>
                      </div>

                      {/* Expanded details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-neutral-400">
                              <span className="text-neutral-500">Best for:</span>{' '}
                              <span className="text-neutral-300">{model.bestFor}</span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Download Button */}
                    <a
                      href={model.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-accent/20 border border-white/[0.08] hover:border-accent/30 text-neutral-300 hover:text-white rounded-lg text-sm transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      {model.downloadSize}
                    </a>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-16 grid gap-6 sm:grid-cols-3"
        >
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-base font-semibold text-white mb-2">How to Use</h3>
            <ol className="text-sm text-neutral-400 space-y-1.5 list-decimal list-inside">
              <li>Download a .gguf model file</li>
              <li>Open <span className="brand-font">guIDE</span> &rarr; Settings &rarr; Local Model</li>
              <li>Select the downloaded file</li>
              <li>Start chatting -- all runs locally!</li>
            </ol>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-base font-semibold text-white mb-2">What is GGUF?</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              GGUF is a quantized model format that runs efficiently on consumer hardware.
              Q4_K_M means 4-bit quantization -- smaller file size with minimal quality loss.
              All models here are pre-quantized and ready to use.
            </p>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-base font-semibold text-white mb-2">GPU vs CPU</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Models run faster on GPU (VRAM) but work fine on CPU (RAM) too.
              <span className="brand-font">guIDE</span> automatically uses your GPU if available. For the best experience,
              choose a model that fits in your VRAM.
            </p>
          </div>
        </motion.div>

        {/* CTA */}
        <div className="text-center mt-12">
          <Link
            href="/download"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all hover:shadow-[0_0_40px_rgba(0,122,204,0.3)]"
          >
            Download <span className="brand-font">guIDE</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
