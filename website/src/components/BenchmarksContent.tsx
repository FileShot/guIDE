'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { hfBenchmarkStats } from '@/data/hf-benchmarks';

// Lazy-load community leaderboard (heavy data file only loads when page renders)
const CommunityLeaderboard = dynamic(() => import('./CommunityLeaderboard'), {
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="text-neutral-500 text-sm">Loading community models...</div>
    </div>
  ),
});

export default function BenchmarksContent() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Benchmarks
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Model Benchmarks
          </h1>
          <p className="text-lg text-neutral-400 max-w-3xl mx-auto">
            Community benchmark data from the Hugging Face Open LLM Leaderboard.{' '}
            <span className="text-white font-medium">{hfBenchmarkStats.totalModels.toLocaleString()}+</span>{' '}
            GGUF models — all downloadable and runnable locally in{' '}
            <span className="brand-font">guIDE</span>.
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

        <CommunityLeaderboard />

        {/* CTA */}
        <div className="text-center mt-12">
          <p className="text-neutral-400 mb-4">
            Run any GGUF model locally with <span className="brand-font">guIDE</span> — no cloud, no subscriptions.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/download"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all hover:shadow-[0_0_40px_rgba(0,122,204,0.3)]"
            >
              Download <span className="brand-font">guIDE</span>
            </Link>
            <Link
              href="/models/compare"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg font-medium transition-all border border-white/[0.08]"
            >
              Compare Models Head-to-Head
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
