import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  hfBenchmarkData,
  hfBenchmarkStats,
  getHFBenchmarkBySlug,
  getAllHFModelSlugs,
  makeHFComparisonSlug,
  HF_BENCHMARK_CATEGORIES,
  HF_CATEGORY_DESCRIPTIONS,
  HF_CATEGORY_COLORS,
  type HFBenchmarkEntry,
  type HFBenchmarkScores,
} from '@/data/hf-benchmarks';

// Allow ALL slugs to render on-demand (not just statically built ones)
export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

// ── Static generation: pre-build top 500 models, rest render on-demand ──
export async function generateStaticParams() {
  // Pre-build the top 500 (sorted by score/popularity from the source script)
  // All 21,000+ others still work via dynamicParams = true
  return getAllHFModelSlugs().slice(0, 500).map(slug => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = getHFBenchmarkBySlug(slug);
  if (!entry) return { title: 'Model Not Found' };

  const { model, scores } = entry;
  const title = `${model.name} — AI Model Benchmark Results`;
  const description = `${model.name} by ${model.developer} — ${model.params} parameters, ${model.architecture}. Average score: ${scores.average?.toFixed(2) ?? 'N/A'}/100. IFEval: ${scores.IFEval ?? '—'}, BBH: ${scores.BBH ?? '—'}, MATH: ${scores.MATH_Lvl5 ?? '—'}, GPQA: ${scores.GPQA ?? '—'}, MUSR: ${scores.MUSR ?? '—'}, MMLU-PRO: ${scores.MMLU_PRO ?? '—'}. View benchmarks and compare with other models.`;

  return {
    title,
    description,
    keywords: [
      model.name,
      `${model.name} benchmark`,
      `${model.name} vs`,
      model.developer,
      model.family,
      'Open LLM Leaderboard',
      'LLM comparison',
      'AI model benchmarks',
    ],
    openGraph: {
      title: `${model.name} Benchmark Results`,
      description,
      type: 'article',
      url: `https://graysoft.dev/models/${slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${model.name} Benchmark Results`,
      description,
    },
    alternates: { canonical: `https://graysoft.dev/models/${slug}` },
  };
}

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

function getRank(entry: HFBenchmarkEntry): number {
  const sorted = [...hfBenchmarkData]
    .filter(r => (r.scores.average ?? 0) > 0)
    .sort((a, b) => (b.scores.average ?? 0) - (a.scores.average ?? 0));
  return sorted.findIndex(r => r.model.slug === entry.model.slug) + 1;
}

function getFamilyRank(entry: HFBenchmarkEntry): { rank: number; total: number } {
  const family = hfBenchmarkData
    .filter(r => r.model.family === entry.model.family && (r.scores.average ?? 0) > 0)
    .sort((a, b) => (b.scores.average ?? 0) - (a.scores.average ?? 0));
  return { rank: family.findIndex(r => r.model.slug === entry.model.slug) + 1, total: family.length };
}

function getSimilarModels(entry: HFBenchmarkEntry): HFBenchmarkEntry[] {
  const avg = entry.scores.average ?? 0;
  const params = entry.model.paramsBillion;
  return hfBenchmarkData
    .filter(r =>
      r.model.slug !== entry.model.slug &&
      Math.abs((r.scores.average ?? 0) - avg) < 5 &&
      Math.abs(r.model.paramsBillion - params) < params * 0.5
    )
    .sort((a, b) => (b.scores.average ?? 0) - (a.scores.average ?? 0))
    .slice(0, 10);
}

function getFamilyModels(entry: HFBenchmarkEntry): HFBenchmarkEntry[] {
  return hfBenchmarkData
    .filter(r => r.model.family === entry.model.family && r.model.slug !== entry.model.slug)
    .sort((a, b) => (b.scores.average ?? 0) - (a.scores.average ?? 0))
    .slice(0, 10);
}

export default async function CommunityModelPage({ params }: Props) {
  const { slug } = await params;
  const entry = getHFBenchmarkBySlug(slug);
  if (!entry) notFound();

  const { model, scores } = entry;
  const rank = getRank(entry);
  const familyRank = getFamilyRank(entry);
  const similarModels = getSimilarModels(entry);
  const familyModels = getFamilyModels(entry);
  const totalRanked = hfBenchmarkData.filter(r => (r.scores.average ?? 0) > 0).length;

  // Find best category
  const catScores = HF_BENCHMARK_CATEGORIES.map(cat => ({
    cat,
    score: scores[cat as keyof HFBenchmarkScores] as number ?? 0,
  })).filter(c => c.score > 0);
  const bestCat = catScores.length > 0 ? catScores.sort((a, b) => b.score - a.score)[0] : null;

  // JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `${model.name} — Open LLM Leaderboard Benchmark Results`,
    description: `Benchmark scores for ${model.name} (${model.params}) by ${model.developer}`,
    url: `https://graysoft.dev/models/${slug}`,
    author: { '@type': 'Organization', name: 'GraySoft' },
    about: {
      '@type': 'SoftwareApplication',
      name: model.name,
      applicationCategory: 'AI Model',
      operatingSystem: 'Cross-platform',
    },
  };

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        {/* JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-xs text-neutral-500 mb-8">
          <Link href="/models" className="hover:text-white transition-colors">Models</Link>
          <span>/</span>
          <Link href="/models/benchmarks" className="hover:text-white transition-colors">Benchmarks</Link>
          <span>/</span>
          <span className="text-neutral-400">{model.name}</span>
        </nav>

        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
            <div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-2">
                {model.name}
              </h1>
              <p className="text-neutral-400 text-lg">
                by <span className="text-white">{model.developer}</span> &middot; {model.params} &middot; {model.architecture}
              </p>
            </div>
            <a
              href={model.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/80 text-white rounded-lg font-medium transition-colors text-sm"
            >
              View Model Source &rarr;
            </a>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {model.capabilities.map(cap => (
              <span key={cap} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                {cap}
              </span>
            ))}
            {model.ggufAvailable && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                GGUF Available
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-neutral-400 border border-white/[0.06]">
              {model.license}
            </span>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${scoreColor(scores.average ?? 0)}`}>
              {scores.average?.toFixed(2) ?? '—'}
            </div>
            <div className="text-xs text-neutral-500 mt-1">Average Score</div>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">
              #{rank}
            </div>
            <div className="text-xs text-neutral-500 mt-1">of {totalRanked} models</div>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">
              #{familyRank.rank}
            </div>
            <div className="text-xs text-neutral-500 mt-1">in {model.family} ({familyRank.total})</div>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-white">
              {model.likes > 0 ? model.likes.toLocaleString() : '—'}
            </div>
            <div className="text-xs text-neutral-500 mt-1">Likes</div>
          </div>
        </div>

        {/* Benchmark Scores */}
        <h2 className="text-2xl font-bold text-white mb-6">Benchmark Scores</h2>
        <div className="space-y-3 mb-10">
          {HF_BENCHMARK_CATEGORIES.map(cat => {
            const score = scores[cat as keyof HFBenchmarkScores] as number ?? 0;
            return (
              <div key={cat} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: HF_CATEGORY_COLORS[cat] }} />
                    <h3 className="text-sm font-semibold text-white">{cat.replace('_', ' ')}</h3>
                  </div>
                  <span className={`text-sm font-bold ${scoreColor(score)}`}>{score.toFixed(2)}</span>
                </div>
                <p className="text-[11px] text-neutral-500 mb-2">{HF_CATEGORY_DESCRIPTIONS[cat]}</p>
                <div className="w-full bg-white/[0.06] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${scoreBg(score)}`}
                    style={{ width: `${Math.min(score, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Best Category Highlight */}
        {bestCat && (
          <div className="bg-gradient-to-br from-accent/[0.06] to-transparent border border-accent/20 rounded-xl p-6 mb-10 text-center">
            <h2 className="text-sm uppercase tracking-wider text-accent mb-2">Strongest Benchmark</h2>
            <p className="text-lg text-white">
              <strong>{model.name}</strong> scores highest on <strong>{bestCat.cat.replace('_', ' ')}</strong> with {bestCat.score.toFixed(2)}/100.
            </p>
          </div>
        )}

        {/* Technical Specifications */}
        <h2 className="text-2xl font-bold text-white mb-6">Technical Specifications</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
          <table className="w-full text-sm">
            <tbody>
              {[
                ['Model Name', model.name],
                ['Developer', model.developer],
                ['Family', model.family],
                ['Parameters', model.params],
                ['Architecture', model.architecture],
                ['License', model.license],
                ['GGUF Available', model.ggufAvailable ? 'Yes' : 'No'],
                ['Likes', model.likes > 0 ? model.likes.toLocaleString() : '—'],
                ['Average Score', scores.average?.toFixed(2) ?? '—'],
                ['Global Rank', `#${rank} of ${totalRanked}`],
              ].map(([label, value], ri) => (
                <tr key={label} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                  <td className="px-4 py-2.5 text-neutral-400 font-medium">{label}</td>
                  <td className="px-4 py-2.5 text-neutral-300">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Compare with Similar Models */}
        {similarModels.length > 0 && (
          <>
            <h2 className="text-2xl font-bold text-white mb-6">Compare with Similar Models</h2>
            <p className="text-sm text-neutral-500 mb-4">
              Models with similar parameter count and benchmark scores.
            </p>
            <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    <th className="text-left px-4 py-3 text-neutral-400 font-medium">Model</th>
                    <th className="px-4 py-3 text-right text-neutral-400 font-medium">Params</th>
                    <th className="px-4 py-3 text-right text-neutral-400 font-medium">Avg Score</th>
                    <th className="px-4 py-3 text-center text-neutral-400 font-medium">Compare</th>
                  </tr>
                </thead>
                <tbody>
                  {similarModels.map((other, ri) => (
                    <tr key={other.model.slug} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/models/${other.model.slug}`} className="text-accent hover:underline">
                          {other.model.name}
                        </Link>
                        <span className="text-neutral-500 text-xs ml-2">{other.model.developer}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-400">{other.model.params}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${scoreColor(other.scores.average ?? 0)}`}>
                        {other.scores.average?.toFixed(2) ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Link
                          href={`/models/compare/${makeHFComparisonSlug(model.slug, other.model.slug)}`}
                          className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                        >
                          vs
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Other Models in Same Family */}
        {familyModels.length > 0 && (
          <>
            <h2 className="text-2xl font-bold text-white mb-6">Other {model.family} Models</h2>
            <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    <th className="text-left px-4 py-3 text-neutral-400 font-medium">Model</th>
                    <th className="px-4 py-3 text-right text-neutral-400 font-medium">Params</th>
                    <th className="px-4 py-3 text-right text-neutral-400 font-medium">Avg Score</th>
                    <th className="px-4 py-3 text-center text-neutral-400 font-medium">Compare</th>
                  </tr>
                </thead>
                <tbody>
                  {familyModels.map((other, ri) => (
                    <tr key={other.model.slug} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/models/${other.model.slug}`} className="text-accent hover:underline">
                          {other.model.name}
                        </Link>
                        <span className="text-neutral-500 text-xs ml-2">{other.model.developer}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-400">{other.model.params}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${scoreColor(other.scores.average ?? 0)}`}>
                        {other.scores.average?.toFixed(2) ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Link
                          href={`/models/compare/${makeHFComparisonSlug(model.slug, other.model.slug)}`}
                          className="text-xs px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                        >
                          vs
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* CTA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/models/benchmarks"
            className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] transition-colors block"
          >
            <h3 className="text-base font-semibold text-white mb-1">Browse All Models</h3>
            <p className="text-sm text-neutral-500">
              Search and filter {hfBenchmarkStats.totalModels.toLocaleString()}+ community models and <span className="brand-font">guIDE</span>-tested local models.
            </p>
          </Link>
          <Link
            href="/download"
            className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] transition-colors block"
          >
            <h3 className="text-base font-semibold text-white mb-1">Download <span className="brand-font">guIDE</span></h3>
            <p className="text-sm text-neutral-500">
              Run any GGUF model locally with <span className="brand-font">guIDE</span> — no cloud, no subscriptions.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
