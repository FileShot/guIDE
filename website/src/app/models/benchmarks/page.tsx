import type { Metadata } from 'next';
import {
  benchmarkResults,
  BENCHMARK_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
} from '@/data/benchmarks';
import BenchmarksContent from '@/components/BenchmarksContent';

export const metadata: Metadata = {
  title: 'AI Model Benchmarks — guIDE Model Leaderboard',
  description:
    'Real-world benchmarks for AI models. guIDE agentic pipeline scores for local GGUF models plus 2,800+ community models with academic benchmark data. Compare tool calling, code generation, reasoning, and more.',
  keywords: [
    'LLM benchmark', 'AI model comparison', 'GGUF model benchmark', 'small model benchmark',
    'AI model leaderboard', 'tool calling benchmark', 'agentic AI benchmark',
    'Qwen benchmark', 'Llama benchmark', 'Phi benchmark', 'Gemma benchmark',
    'offline AI performance', 'best small LLM', 'best local model for coding',
    'model comparison chart', 'guIDE benchmarks', 'community model leaderboard',
    'Open LLM Leaderboard', 'model benchmark scores',
  ],
  openGraph: {
    title: 'AI Model Benchmarks — guIDE Leaderboard',
    description: 'Real-world benchmarks for AI models — guIDE-tested local models + 2,800+ community models.',
    url: 'https://graysoft.dev/models/benchmarks',
  },
  alternates: { canonical: 'https://graysoft.dev/models/benchmarks' },
};

export default function BenchmarksPage() {
  const sorted = [...benchmarkResults].sort((a, b) => b.overallScore - a.overallScore);

  return (
    <>
      <BenchmarksContent />

      {/* JSON-LD structured data (server-rendered) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Dataset',
            name: 'guIDE AI Model Benchmark Results',
            description: 'Real-world agentic AI benchmarks for local GGUF models plus community model scores',
            url: 'https://graysoft.dev/models/benchmarks',
            creator: { '@type': 'Organization', name: 'GraySoft' },
            dateModified: sorted[0]?.date || '2026-02-15',
            variableMeasured: BENCHMARK_CATEGORIES.map(cat => ({
              '@type': 'PropertyValue',
              name: cat,
              description: CATEGORY_DESCRIPTIONS[cat],
            })),
          }),
        }}
      />
    </>
  );
}
