import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  benchmarkResults,
  getAllComparisonPairs,
  getBenchmarkBySlug,
  makeComparisonSlug,
  generateComparisonKeywords,
  BENCHMARK_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_COLORS,
  type BenchmarkResult,
} from '@/data/benchmarks';
import {
  hfBenchmarkData,
  getHFBenchmarkBySlug,
  getTopHFComparisonPairs,
  makeHFComparisonSlug,
  generateHFComparisonKeywords,
  HF_BENCHMARK_CATEGORIES,
  HF_CATEGORY_DESCRIPTIONS,
  HF_CATEGORY_COLORS,
  type HFBenchmarkEntry,
  type HFBenchmarkScores,
} from '@/data/hf-benchmarks';

// Allow ALL comparison pairs to render on-demand
export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

type GuidePair = { type: 'guide'; a: BenchmarkResult; b: BenchmarkResult };
type CommunityPair = { type: 'community'; a: HFBenchmarkEntry; b: HFBenchmarkEntry };
type Pair = GuidePair | CommunityPair;

// ── Static generation: build pages for guIDE pairs + top 30 community pairs ──
export async function generateStaticParams() {
  const guidePairs = getAllComparisonPairs().map(p => ({ slug: p.comparisonSlug }));
  const communityPairs = getTopHFComparisonPairs(30).map(p => ({ slug: p.comparisonSlug }));
  return [...guidePairs, ...communityPairs];
}

// ── Find pair in either guIDE or community data ──
function findPair(slug: string): Pair | null {
  // Try guIDE first
  const guidePairs = getAllComparisonPairs();
  const guideMatch = guidePairs.find(p => p.comparisonSlug === slug);
  if (guideMatch) {
    const a = getBenchmarkBySlug(guideMatch.slugA);
    const b = getBenchmarkBySlug(guideMatch.slugB);
    if (a && b) {
      return a.overallScore >= b.overallScore
        ? { type: 'guide', a, b }
        : { type: 'guide', a: b, b: a };
    }
  }

  // Try community data
  const parts = slug.split('-vs-');
  if (parts.length >= 2) {
    for (let i = 1; i < parts.length; i++) {
      const slugA = parts.slice(0, i).join('-vs-');
      const slugB = parts.slice(i).join('-vs-');
      const a = getHFBenchmarkBySlug(slugA);
      const b = getHFBenchmarkBySlug(slugB);
      if (a && b) {
        return (a.scores.average ?? 0) >= (b.scores.average ?? 0)
          ? { type: 'community', a, b }
          : { type: 'community', a: b, b: a };
      }
    }
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const pair = findPair(slug);
  if (!pair) return { title: 'Comparison Not Found' };

  if (pair.type === 'guide') {
    const { a, b } = pair;
    const title = `${a.model.name} vs ${b.model.name} — AI Model Benchmark Comparison`;
    const description = `Head-to-head comparison of ${a.model.name} (${a.model.params}, ${a.overallScore}%) vs ${b.model.name} (${b.model.params}, ${b.overallScore}%). Real-world agentic AI benchmarks across tool calling, code generation, web search, and multi-step tasks.`;
    const keywords = generateComparisonKeywords(a.model, b.model);
    return {
      title, description, keywords,
      openGraph: { title: `${a.model.name} vs ${b.model.name}`, description, type: 'article', url: `https://graysoft.dev/models/compare/${slug}` },
      twitter: { card: 'summary_large_image', title: `${a.model.name} vs ${b.model.name}`, description },
      alternates: { canonical: `https://graysoft.dev/models/compare/${slug}` },
    };
  }

  const { a, b } = pair;
  const title = `${a.model.name} vs ${b.model.name} — Open LLM Leaderboard Comparison`;
  const description = `Head-to-head comparison of ${a.model.name} (${a.model.params}, avg ${a.scores.average?.toFixed(2) ?? '—'}) vs ${b.model.name} (${b.model.params}, avg ${b.scores.average?.toFixed(2) ?? '—'}). Side-by-side benchmark scores across IFEval, BBH, MATH, GPQA, MUSR, and MMLU-PRO.`;
  const keywords = generateHFComparisonKeywords(a.model, b.model);
  return {
    title, description, keywords,
    openGraph: { title: `${a.model.name} vs ${b.model.name}`, description, type: 'article', url: `https://graysoft.dev/models/compare/${slug}` },
    twitter: { card: 'summary_large_image', title: `${a.model.name} vs ${b.model.name}`, description },
    alternates: { canonical: `https://graysoft.dev/models/compare/${slug}` },
  };
}

// ── Score color helpers ──
function guideScoreColor(s: number) { return s >= 90 ? 'text-emerald-400' : s >= 70 ? 'text-cyan-400' : s >= 40 ? 'text-yellow-400' : 'text-red-400'; }
function communityScoreColor(s: number) { return s >= 45 ? 'text-emerald-400' : s >= 30 ? 'text-cyan-400' : s >= 15 ? 'text-yellow-400' : 'text-red-400'; }

function BarRow({ label, score, color, max = 100 }: { label: string; score: number; color: string; max?: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-400 w-28 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-white/[0.06] rounded-full h-2 relative">
        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(score / max * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-12 text-right" style={{ color }}>{Number.isInteger(score) ? score : score.toFixed(1)}</span>
    </div>
  );
}

export default async function ComparisonPage({ params }: Props) {
  const { slug } = await params;
  const pair = findPair(slug);
  if (!pair) notFound();

  return pair.type === 'guide'
    ? <GuideComparison pair={pair} slug={slug} />
    : <CommunityComparison pair={pair} slug={slug} />;
}

// ═══════════════════════════════════════════════════════════════
// ── guIDE Model Comparison ──
// ═══════════════════════════════════════════════════════════════
function GuideComparison({ pair, slug }: { pair: GuidePair; slug: string }) {
  const { a, b } = pair;
  const winner = a.overallScore > b.overallScore ? a : b;
  const diff = Math.abs(a.overallScore - b.overallScore);
  const isClose = diff <= 5;
  const otherModels = benchmarkResults.filter(r => r.model.slug !== a.model.slug && r.model.slug !== b.model.slug);

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <nav className="flex items-center gap-2 text-xs text-neutral-500 mb-8">
          <Link href="/models" className="hover:text-white transition-colors">Models</Link>
          <span>/</span>
          <Link href="/models/benchmarks" className="hover:text-white transition-colors">Benchmarks</Link>
          <span>/</span>
          <Link href="/models/compare" className="hover:text-white transition-colors">Compare</Link>
          <span>/</span>
          <span className="text-neutral-400">{a.model.name} vs {b.model.name}</span>
        </nav>

        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            {a.model.name} <span className="text-neutral-600">vs</span> {b.model.name}
          </h1>
          <p className="text-lg text-neutral-400 max-w-3xl mx-auto">
            Real-world head-to-head comparison through guIDE&apos;s agentic AI pipeline.
            32 tests across 6 categories — no hand-holding, no prompt tricks.
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

        {/* Score Cards */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-10">
          <GuideScoreCard result={a} color="#569cd6" isWinner={a.overallScore > b.overallScore} />
          <GuideScoreCard result={b} color="#4ec9b0" isWinner={b.overallScore > a.overallScore} />
        </div>

        {/* Verdict */}
        <div className="bg-gradient-to-br from-accent/[0.06] to-transparent border border-accent/20 rounded-xl p-6 mb-10 text-center">
          <h2 className="text-sm uppercase tracking-wider text-accent mb-2">Verdict</h2>
          {isClose ? (
            <p className="text-lg text-white">
              <strong>Too close to call.</strong> Only {diff} points separate these models. Both are strong choices.
            </p>
          ) : (
            <p className="text-lg text-white">
              <strong>{winner.model.name} wins</strong> with a {diff}-point lead
              ({winner.overallScore}% vs {winner === a ? b.overallScore : a.overallScore}%).
              {winner.model.paramsBillion < (winner === a ? b : a).model.paramsBillion
                ? ` Impressive given it\'s the smaller model (${winner.model.params} vs ${(winner === a ? b : a).model.params}).` : ''}
            </p>
          )}
        </div>

        {/* Category Breakdown */}
        <h2 className="text-2xl font-bold text-white mb-6">Category Breakdown</h2>
        <div className="space-y-4 mb-10">
          {BENCHMARK_CATEGORIES.map(cat => {
            const csA = a.categoryScores.find(c => c.category === cat);
            const csB = b.categoryScores.find(c => c.category === cat);
            const sA = csA?.score ?? 0;
            const sB = csB?.score ?? 0;
            const catWinner = sA > sB ? a.model.name : sB > sA ? b.model.name : 'Tie';
            return (
              <div key={cat} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat] }} />
                    <h3 className="text-sm font-semibold text-white">{cat}</h3>
                  </div>
                  <span className="text-xs text-neutral-500">Winner: <span className="text-white font-medium">{catWinner}</span></span>
                </div>
                <p className="text-xs text-neutral-500 mb-3">{CATEGORY_DESCRIPTIONS[cat]}</p>
                <div className="space-y-2">
                  <BarRow label={a.model.name} score={sA} color="#569cd6" />
                  <BarRow label={b.model.name} score={sB} color="#4ec9b0" />
                </div>
                {csA && csB && (
                  <div className="flex justify-between mt-3 text-[11px] text-neutral-500">
                    <span>{csA.passed}/{csA.total} passed &middot; avg {(csA.avgDuration / 1000).toFixed(1)}s</span>
                    <span>{csB.passed}/{csB.total} passed &middot; avg {(csB.avgDuration / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Specs Table */}
        <h2 className="text-2xl font-bold text-white mb-6">Technical Specifications</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="text-left px-4 py-3 text-neutral-400 font-medium">Specification</th>
                <th className="px-4 py-3 text-center" style={{ color: '#569cd6' }}>{a.model.name}</th>
                <th className="px-4 py-3 text-center" style={{ color: '#4ec9b0' }}>{b.model.name}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Overall Score', `${a.overallScore}%`, `${b.overallScore}%`],
                ['Parameters', a.model.params, b.model.params],
                ['Developer', a.model.developer, b.model.developer],
                ['Architecture', a.model.architecture, b.model.architecture],
                ['Context Window', `${a.model.contextLength.toLocaleString()} tokens`, `${b.model.contextLength.toLocaleString()} tokens`],
                ['Quantization', a.model.quant, b.model.quant],
                ['Download Size', a.model.downloadSize, b.model.downloadSize],
                ['License', a.model.license, b.model.license],
                ['Release Date', a.model.releaseDate, b.model.releaseDate],
                ['Inference Speed', a.tokensPerSecond ? `${a.tokensPerSecond} tok/s` : '—', b.tokensPerSecond ? `${b.tokensPerSecond} tok/s` : '—'],
                ['Time to First Token', a.timeToFirstToken ? `${a.timeToFirstToken}ms` : '—', b.timeToFirstToken ? `${b.timeToFirstToken}ms` : '—'],
                ['Total Benchmark Time', `${(a.totalBenchmarkTime / 1000).toFixed(0)}s`, `${(b.totalBenchmarkTime / 1000).toFixed(0)}s`],
              ].map(([label, valA, valB], ri) => (
                <tr key={label as string} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                  <td className="px-4 py-2.5 text-neutral-400">{label}</td>
                  <td className="px-4 py-2.5 text-center text-neutral-300">{valA}</td>
                  <td className="px-4 py-2.5 text-center text-neutral-300">{valB}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Capabilities */}
        <h2 className="text-2xl font-bold text-white mb-6">Capabilities</h2>
        <div className="grid grid-cols-2 gap-4 mb-10">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#569cd6' }}>{a.model.name}</h3>
            <div className="flex flex-wrap gap-1">
              {a.model.tags.map(tag => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[#569cd6]/10 text-[#569cd6] border border-[#569cd6]/20">{tag}</span>
              ))}
            </div>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#4ec9b0' }}>{b.model.name}</h3>
            <div className="flex flex-wrap gap-1">
              {b.model.tags.map(tag => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[#4ec9b0]/10 text-[#4ec9b0] border border-[#4ec9b0]/20">{tag}</span>
              ))}
            </div>
          </div>
        </div>

        {/* When to Choose Each */}
        <h2 className="text-2xl font-bold text-white mb-6">When to Choose Each</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <div className="bg-white/[0.03] border border-[#569cd6]/20 rounded-xl p-5">
            <h3 className="text-base font-semibold text-white mb-3">Choose {a.model.name} if...</h3>
            <ul className="text-sm text-neutral-400 space-y-2">
              {a.overallScore > b.overallScore && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>You want higher overall benchmark scores</span></li>}
              {a.model.paramsBillion < b.model.paramsBillion && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>You need a smaller model for limited hardware</span></li>}
              {(a.tokensPerSecond || 0) > (b.tokensPerSecond || 0) && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Faster inference speed matters to you</span></li>}
              {a.model.contextLength > b.model.contextLength && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>You need a larger context window ({a.model.contextLength.toLocaleString()} vs {b.model.contextLength.toLocaleString()})</span></li>}
              {a.model.tags.includes('coding') && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Code generation is a priority</span></li>}
              {a.model.tags.includes('tool-use') && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Tool calling and agentic tasks matter</span></li>}
            </ul>
          </div>
          <div className="bg-white/[0.03] border border-[#4ec9b0]/20 rounded-xl p-5">
            <h3 className="text-base font-semibold text-white mb-3">Choose {b.model.name} if...</h3>
            <ul className="text-sm text-neutral-400 space-y-2">
              {b.overallScore > a.overallScore && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>You want higher overall benchmark scores</span></li>}
              {b.model.paramsBillion < a.model.paramsBillion && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>You need a smaller model for limited hardware</span></li>}
              {(b.tokensPerSecond || 0) > (a.tokensPerSecond || 0) && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Faster inference speed matters to you</span></li>}
              {b.model.contextLength > a.model.contextLength && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>You need a larger context window ({b.model.contextLength.toLocaleString()} vs {a.model.contextLength.toLocaleString()})</span></li>}
              {b.model.tags.includes('coding') && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Code generation is a priority</span></li>}
              {b.model.tags.includes('multilingual') && <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>Multilingual support is important</span></li>}
            </ul>
          </div>
        </div>

        {/* Also Compare */}
        <h2 className="text-2xl font-bold text-white mb-4">Also Compare</h2>
        <div className="flex flex-wrap gap-2 mb-10">
          {otherModels.map(other => (
            <span key={other.model.slug} className="inline-flex gap-2">
              <Link href={`/models/compare/${makeComparisonSlug(a.model.slug, other.model.slug)}`} className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-400 hover:text-white hover:border-accent/30 transition-all">
                {a.model.name} vs {other.model.name}
              </Link>
              <Link href={`/models/compare/${makeComparisonSlug(b.model.slug, other.model.slug)}`} className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-neutral-400 hover:text-white hover:border-accent/30 transition-all">
                {b.model.name} vs {other.model.name}
              </Link>
            </span>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex flex-wrap justify-center gap-4 mt-12">
          <Link href="/models/benchmarks" className="inline-flex items-center gap-2 px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg font-medium transition-all border border-white/[0.08]">View Full Leaderboard</Link>
          <Link href="/models/compare" className="inline-flex items-center gap-2 px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg font-medium transition-all border border-white/[0.08]">Compare Different Models</Link>
          <Link href="/download" className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all hover:shadow-[0_0_40px_rgba(0,122,204,0.3)]">Download guIDE</Link>
        </div>

        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org', '@type': 'Article',
          headline: `${a.model.name} vs ${b.model.name}: AI Model Benchmark Comparison`,
          description: `Head-to-head comparison of ${a.model.name} and ${b.model.name} in guIDE's agentic AI benchmark.`,
          url: `https://graysoft.dev/models/compare/${slug}`,
          datePublished: a.date, dateModified: new Date().toISOString().split('T')[0],
          author: { '@type': 'Organization', name: 'GraySoft' },
          publisher: { '@type': 'Organization', name: 'GraySoft', url: 'https://graysoft.dev' },
        }) }} />
      </div>
    </div>
  );
}

function GuideScoreCard({ result, color, isWinner }: { result: BenchmarkResult; color: string; isWinner: boolean }) {
  return (
    <div className={`bg-white/[0.03] border rounded-xl p-5 sm:p-6 text-center relative overflow-hidden ${isWinner ? 'ring-1 ring-yellow-400/30' : ''}`} style={{ borderColor: color + '30' }}>
      {isWinner && <div className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 font-bold">WINNER</div>}
      <div className="w-4 h-4 rounded-full mx-auto mb-2" style={{ backgroundColor: color }} />
      <h2 className="text-lg sm:text-xl font-bold text-white mb-1">{result.model.name}</h2>
      <div className="text-xs text-neutral-500 mb-3">{result.model.params} &middot; {result.model.developer} &middot; {result.model.downloadSize}</div>
      <div className="relative w-28 h-28 mx-auto mb-3">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
          <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="8" strokeDasharray={`${(result.overallScore / 100) * 327} 327`} strokeLinecap="round" opacity="0.8" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-white">{result.overallScore}%</span>
        </div>
      </div>
      <div className="text-xs text-neutral-500">
        {result.tokensPerSecond && <span>{result.tokensPerSecond} tok/s</span>}
        {result.tokensPerSecond && result.timeToFirstToken && <span> &middot; </span>}
        {result.timeToFirstToken && <span>{result.timeToFirstToken}ms TTFT</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ── Community Model Comparison ──
// ═══════════════════════════════════════════════════════════════
function CommunityComparison({ pair, slug }: { pair: CommunityPair; slug: string }) {
  const { a, b } = pair;
  const avgA = a.scores.average ?? 0;
  const avgB = b.scores.average ?? 0;
  const winner = avgA > avgB ? a : b;
  const diff = Math.abs(avgA - avgB);
  const isClose = diff <= 2;

  const otherModels = hfBenchmarkData
    .filter(r => r.model.slug !== a.model.slug && r.model.slug !== b.model.slug && (r.scores.average ?? 0) > 0)
    .sort((x, y) => {
      const midScore = (avgA + avgB) / 2;
      return Math.abs((x.scores.average ?? 0) - midScore) - Math.abs((y.scores.average ?? 0) - midScore);
    })
    .slice(0, 8);

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org', '@type': 'TechArticle',
          headline: `${a.model.name} vs ${b.model.name} — Open LLM Leaderboard Comparison`,
          description: `Side-by-side benchmark comparison of ${a.model.name} and ${b.model.name}`,
          url: `https://graysoft.dev/models/compare/${slug}`,
          author: { '@type': 'Organization', name: 'GraySoft' },
        }) }} />

        <nav className="flex items-center gap-2 text-xs text-neutral-500 mb-8">
          <Link href="/models" className="hover:text-white transition-colors">Models</Link>
          <span>/</span>
          <Link href="/models/benchmarks" className="hover:text-white transition-colors">Benchmarks</Link>
          <span>/</span>
          <span className="text-neutral-400">{a.model.name} vs {b.model.name}</span>
        </nav>

        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
            {a.model.name} <span className="text-neutral-600">vs</span> {b.model.name}
          </h1>
          <p className="text-lg text-neutral-400 max-w-3xl mx-auto">
            Side-by-side benchmark comparison from the Open LLM Leaderboard v2.
            Six evaluation categories testing instruction following, reasoning, math, and knowledge.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-10">
          <CommunityScoreCard entry={a} color="#569cd6" isWinner={avgA > avgB} />
          <CommunityScoreCard entry={b} color="#4ec9b0" isWinner={avgB > avgA} />
        </div>

        <div className="bg-gradient-to-br from-accent/[0.06] to-transparent border border-accent/20 rounded-xl p-6 mb-10 text-center">
          <h2 className="text-sm uppercase tracking-wider text-accent mb-2">Verdict</h2>
          {isClose ? (
            <p className="text-lg text-white"><strong>Too close to call.</strong> Only {diff.toFixed(2)} points separate these models. Both are competitive choices.</p>
          ) : (
            <p className="text-lg text-white">
              <strong>{winner.model.name} wins</strong> with a {diff.toFixed(2)}-point lead
              ({(winner.scores.average ?? 0).toFixed(2)} vs {(winner === a ? avgB : avgA).toFixed(2)}).
              {winner.model.paramsBillion < (winner === a ? b : a).model.paramsBillion
                ? ` Notable: it's the smaller model (${winner.model.params} vs ${(winner === a ? b : a).model.params}).` : ''}
            </p>
          )}
        </div>

        <h2 className="text-2xl font-bold text-white mb-6">Category Breakdown</h2>
        <div className="space-y-4 mb-10">
          {HF_BENCHMARK_CATEGORIES.map(cat => {
            const sA = (a.scores[cat as keyof HFBenchmarkScores] as number) ?? 0;
            const sB = (b.scores[cat as keyof HFBenchmarkScores] as number) ?? 0;
            const catWinner = sA > sB ? a.model.name : sB > sA ? b.model.name : 'Tie';
            const catDiff = Math.abs(sA - sB);
            return (
              <div key={cat} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: HF_CATEGORY_COLORS[cat] }} />
                    <h3 className="text-sm font-semibold text-white">{cat.replace('_', ' ')}</h3>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {catWinner === 'Tie' ? 'Tie' : <>Winner: <span className="text-white font-medium">{catWinner}</span> (+{catDiff.toFixed(2)})</>}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mb-3">{HF_CATEGORY_DESCRIPTIONS[cat]}</p>
                <div className="space-y-2">
                  <BarRow label={a.model.name} score={sA} color="#569cd6" />
                  <BarRow label={b.model.name} score={sB} color="#4ec9b0" />
                </div>
              </div>
            );
          })}
        </div>

        <h2 className="text-2xl font-bold text-white mb-6">Technical Specifications</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="text-left px-4 py-3 text-neutral-400 font-medium">Specification</th>
                <th className="px-4 py-3 text-center" style={{ color: '#569cd6' }}>{a.model.name}</th>
                <th className="px-4 py-3 text-center" style={{ color: '#4ec9b0' }}>{b.model.name}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Average Score', `${avgA.toFixed(2)}`, `${avgB.toFixed(2)}`],
                ['Parameters', a.model.params, b.model.params],
                ['Developer', a.model.developer, b.model.developer],
                ['Architecture', a.model.architecture, b.model.architecture],
                ['Family', a.model.family, b.model.family],
                ['License', a.model.license, b.model.license],
                ['Likes', a.model.likes > 0 ? a.model.likes.toLocaleString() : '—', b.model.likes > 0 ? b.model.likes.toLocaleString() : '—'],
                ['GGUF Available', a.model.ggufAvailable ? 'Yes' : 'No', b.model.ggufAvailable ? 'Yes' : 'No'],
              ].map(([label, valA, valB], ri) => {
                const [clsA, clsB] = label === 'Average Score'
                  ? (avgA > avgB ? ['font-semibold text-white', ''] : avgB > avgA ? ['', 'font-semibold text-white'] : ['', ''])
                  : ['', ''];
                return (
                  <tr key={label as string} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                    <td className="px-4 py-2.5 text-neutral-400">{label}</td>
                    <td className={`px-4 py-2.5 text-center text-neutral-300 ${clsA}`}>{valA}</td>
                    <td className={`px-4 py-2.5 text-center text-neutral-300 ${clsB}`}>{valB}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Score Differences */}
        <h2 className="text-2xl font-bold text-white mb-6">Score Differences</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="text-left px-4 py-3 text-neutral-400 font-medium">Benchmark</th>
                <th className="px-4 py-3 text-center" style={{ color: '#569cd6' }}>{a.model.name}</th>
                <th className="px-4 py-3 text-center" style={{ color: '#4ec9b0' }}>{b.model.name}</th>
                <th className="px-4 py-3 text-center text-neutral-400 font-medium">Diff</th>
                <th className="px-4 py-3 text-center text-neutral-400 font-medium">Winner</th>
              </tr>
            </thead>
            <tbody>
              {HF_BENCHMARK_CATEGORIES.map((cat, ri) => {
                const sA = (a.scores[cat as keyof HFBenchmarkScores] as number) ?? 0;
                const sB = (b.scores[cat as keyof HFBenchmarkScores] as number) ?? 0;
                const d = sA - sB;
                const w = d > 0 ? a.model.name : d < 0 ? b.model.name : 'Tie';
                return (
                  <tr key={cat} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                    <td className="px-4 py-2.5 text-neutral-400">{cat.replace('_', ' ')}</td>
                    <td className={`px-4 py-2.5 text-center font-mono ${d >= 0 ? 'text-white font-semibold' : 'text-neutral-500'}`}>{sA.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 text-center font-mono ${d <= 0 ? 'text-white font-semibold' : 'text-neutral-500'}`}>{sB.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 text-center font-mono ${d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-neutral-500'}`}>{d > 0 ? '+' : ''}{d.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-neutral-300">{w}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-white/[0.06] bg-white/[0.02]">
                <td className="px-4 py-2.5 text-white font-semibold">Average</td>
                <td className={`px-4 py-2.5 text-center font-mono font-semibold ${avgA >= avgB ? 'text-white' : 'text-neutral-500'}`}>{avgA.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-center font-mono font-semibold ${avgB >= avgA ? 'text-white' : 'text-neutral-500'}`}>{avgB.toFixed(2)}</td>
                <td className={`px-4 py-2.5 text-center font-mono font-semibold ${(avgA - avgB) > 0 ? 'text-emerald-400' : (avgA - avgB) < 0 ? 'text-red-400' : 'text-neutral-500'}`}>{(avgA - avgB) > 0 ? '+' : ''}{(avgA - avgB).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-center text-xs text-white font-semibold">{avgA > avgB ? a.model.name : avgB > avgA ? b.model.name : 'Tie'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* When to Choose Each */}
        <h2 className="text-2xl font-bold text-white mb-6">When to Choose Each</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <CommunityChoiceCard entry={a} other={b} color="#569cd6" />
          <CommunityChoiceCard entry={b} other={a} color="#4ec9b0" />
        </div>

        {/* Model Detail Links */}
        <h2 className="text-2xl font-bold text-white mb-6">View Full Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <Link href={`/models/${a.model.slug}`} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] transition-colors block">
            <h3 className="text-base font-semibold text-white mb-1">{a.model.name}</h3>
            <p className="text-sm text-neutral-500">Full benchmark breakdown, specs, and comparisons &rarr;</p>
          </Link>
          <Link href={`/models/${b.model.slug}`} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] transition-colors block">
            <h3 className="text-base font-semibold text-white mb-1">{b.model.name}</h3>
            <p className="text-sm text-neutral-500">Full benchmark breakdown, specs, and comparisons &rarr;</p>
          </Link>
        </div>

        {/* Also Compare */}
        {otherModels.length > 0 && (
          <>
            <h2 className="text-2xl font-bold text-white mb-6">Also Compare</h2>
            <div className="overflow-x-auto rounded-xl border border-white/[0.06] mb-10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    <th className="text-left px-4 py-3 text-neutral-400 font-medium">Model</th>
                    <th className="px-4 py-3 text-right text-neutral-400 font-medium">Params</th>
                    <th className="px-4 py-3 text-right text-neutral-400 font-medium">Avg</th>
                    <th className="px-4 py-3 text-center text-neutral-400 font-medium" style={{ color: '#569cd6' }}>
                      vs {a.model.name.length > 15 ? a.model.name.slice(0, 15) + '…' : a.model.name}
                    </th>
                    <th className="px-4 py-3 text-center text-neutral-400 font-medium" style={{ color: '#4ec9b0' }}>
                      vs {b.model.name.length > 15 ? b.model.name.slice(0, 15) + '…' : b.model.name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {otherModels.map((other, ri) => (
                    <tr key={other.model.slug} className={`border-b border-white/[0.03] ${ri % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/models/${other.model.slug}`} className="text-accent hover:underline text-xs">{other.model.name}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-400 text-xs">{other.model.params}</td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs ${communityScoreColor(other.scores.average ?? 0)}`}>{other.scores.average?.toFixed(2) ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Link href={`/models/compare/${makeHFComparisonSlug(a.model.slug, other.model.slug)}`} className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#569cd6]/10 text-[#569cd6] border border-[#569cd6]/20 hover:bg-[#569cd6]/20 transition-colors">Compare</Link>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Link href={`/models/compare/${makeHFComparisonSlug(b.model.slug, other.model.slug)}`} className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#4ec9b0]/10 text-[#4ec9b0] border border-[#4ec9b0]/20 hover:bg-[#4ec9b0]/20 transition-colors">Compare</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* CTAs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href="/models/benchmarks" className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] transition-colors block">
            <h3 className="text-base font-semibold text-white mb-1">Browse All Models</h3>
            <p className="text-sm text-neutral-500">Search and filter 2,800+ community models and guIDE-tested local models.</p>
          </Link>
          <Link href="/download" className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:bg-white/[0.06] transition-colors block">
            <h3 className="text-base font-semibold text-white mb-1">Download guIDE</h3>
            <p className="text-sm text-neutral-500">Run any GGUF model locally — no cloud, no subscriptions.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

function CommunityScoreCard({ entry, color, isWinner }: { entry: HFBenchmarkEntry; color: string; isWinner: boolean }) {
  const avg = entry.scores.average ?? 0;
  return (
    <div className={`rounded-xl border p-5 text-center transition-all ${isWinner ? 'bg-gradient-to-b from-white/[0.06] to-transparent border-white/[0.12]' : 'bg-white/[0.03] border-white/[0.06]'}`}>
      {isWinner && <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-2">Winner</span>}
      <h3 className="text-lg font-bold text-white mb-1">{entry.model.name}</h3>
      <p className="text-xs text-neutral-500 mb-3">{entry.model.params} &middot; {entry.model.developer}</p>
      <div className="text-4xl font-bold mb-1" style={{ color }}>{avg.toFixed(2)}</div>
      <div className="text-xs text-neutral-500">Average Score</div>
    </div>
  );
}

function CommunityChoiceCard({ entry, other, color }: { entry: HFBenchmarkEntry; other: HFBenchmarkEntry; color: string }) {
  const reasons: string[] = [];
  const avgE = entry.scores.average ?? 0;
  const avgO = other.scores.average ?? 0;

  if (avgE > avgO) reasons.push('Higher overall benchmark scores');
  if (entry.model.paramsBillion < other.model.paramsBillion) reasons.push(`Smaller model (${entry.model.params} vs ${other.model.params}) — runs on less hardware`);
  if (entry.model.paramsBillion > other.model.paramsBillion) reasons.push(`Larger model (${entry.model.params}) — potentially more capable`);
  if (entry.model.ggufAvailable && !other.model.ggufAvailable) reasons.push('GGUF quantized version available for local inference');
  if (entry.model.likes > other.model.likes * 2) reasons.push(`More popular (${entry.model.likes.toLocaleString()} likes)`);

  for (const cat of HF_BENCHMARK_CATEGORIES) {
    const sE = (entry.scores[cat as keyof HFBenchmarkScores] as number) ?? 0;
    const sO = (other.scores[cat as keyof HFBenchmarkScores] as number) ?? 0;
    if (sE > sO + 5) reasons.push(`Stronger on ${cat.replace('_', ' ')} (${sE.toFixed(1)} vs ${sO.toFixed(1)})`);
  }

  if (reasons.length === 0) reasons.push('Competitive option worth considering');

  return (
    <div className="bg-white/[0.03] rounded-xl p-5" style={{ borderLeft: `3px solid ${color}` }}>
      <h3 className="text-base font-semibold text-white mb-3">Choose {entry.model.name} if...</h3>
      <ul className="text-sm text-neutral-400 space-y-2">
        {reasons.map((reason, i) => (
          <li key={i} className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">+</span><span>{reason}</span></li>
        ))}
      </ul>
    </div>
  );
}
