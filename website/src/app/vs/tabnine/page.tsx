import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'guIDE vs Tabnine — Local AI IDE vs AI Code Completion Tool',
  description: 'Tabnine offers local model options but charges for team/enterprise tiers. guIDE is a complete local-first AI IDE with 69 built-in tools, unlimited inference, and a free plan.',
  alternates: { canonical: 'https://graysoft.dev/vs/tabnine' },
  openGraph: {
    title: 'guIDE vs Tabnine — Full Local AI IDE vs AI Completion Tool',
    description: "Tabnine's local models are limited in the free tier. guIDE runs full local inference with no restrictions and includes 69 built-in developer tools.",
    url: 'https://graysoft.dev/vs/tabnine',
    siteName: 'guIDE by GraySoft',
  },
};

const rows = [
  { feature: 'Full IDE (standalone, not a plugin)', guide: true, other: false },
  { feature: 'Local AI inference (on-device)', guide: true, other: 'Pro/Enterprise only' },
  { feature: 'Local model — no size restrictions', guide: true, other: false },
  { feature: 'No rate limits on local inference', guide: true, other: false },
  { feature: 'Built-in MCP Tools (69+)', guide: true, other: false },
  { feature: 'Browser automation (Playwright)', guide: true, other: false },
  { feature: 'Voice input (Whisper STT)', guide: true, other: false },
  { feature: 'Agentic multi-step AI loop', guide: true, other: false },
  { feature: 'Code runner (50+ languages)', guide: true, other: false },
  { feature: 'Privacy-first / air-gapped support', guide: true, other: 'Enterprise' },
  { feature: 'Free plan with full local inference', guide: true, other: false },
  { feature: 'AI chat / code completion', guide: true, other: true },
  { feature: 'RAG codebase indexing', guide: true, other: true },
  { feature: 'Team knowledge base / snippets', guide: false, other: true },
  { feature: 'Requires VS Code / JetBrains host', guide: false, other: true },
];

function Cell({ val }: { val: boolean | string }) {
  if (val === true) return <span className="text-emerald-400 text-lg font-bold">✓</span>;
  if (val === false) return <span className="text-neutral-600 text-lg">—</span>;
  return <span className="text-yellow-400 text-sm">{val}</span>;
}

export default function VsTabninePage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">

        <FadeIn>
          <p className="text-sm font-medium text-purple-400 uppercase tracking-wider mb-3">Comparison</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            guIDE vs Tabnine
          </h1>
          <p className="text-xl text-neutral-300 max-w-2xl mb-10">
            Tabnine was one of the first AI completion tools, and they do offer local model support — but it's restricted to paid tiers, their local models are small completion models, and Tabnine is still just a plugin. guIDE is a complete IDE built around local AI inference from the ground up.
          </p>
          <Link
            href="/download"
            className="inline-block bg-purple-600 hover:bg-purple-500 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-base"
          >
            Download guIDE Free &rarr;
          </Link>
        </FadeIn>

        <FadeIn delay={0.1}>
          <h2 className="text-2xl font-bold text-white mt-20 mb-8">Feature Comparison</h2>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  <th className="text-left px-6 py-4 text-neutral-400 font-semibold uppercase tracking-wide text-xs w-1/2">Feature</th>
                  <th className="px-6 py-4 text-purple-400 font-semibold uppercase tracking-wide text-xs text-center">guIDE</th>
                  <th className="px-6 py-4 text-neutral-400 font-semibold uppercase tracking-wide text-xs text-center">Tabnine</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 text-neutral-200">{row.feature}</td>
                    <td className="px-6 py-4 text-center bg-purple-500/[0.04]"><Cell val={row.guide} /></td>
                    <td className="px-6 py-4 text-center text-neutral-400"><Cell val={row.other} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>

        <FadeIn delay={0.15}>
          <h2 className="text-2xl font-bold text-white mt-20 mb-8">Where guIDE goes further</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                title: "Tabnine's local models are small and restricted",
                body: "Tabnine's local mode uses small on-device completion models optimized for speed, not intelligence. Full local model support is behind their Pro/Enterprise plans. guIDE lets you run any GGUF model — 7B, 13B, 34B, 70B — on your GPU with no restrictions.",
              },
              {
                title: 'An agent, not just completions',
                body: "Tabnine generates inline completions and chat suggestions. guIDE's AI agent can plan multi-step tasks, write code, test it, browse documentation, run terminal commands, and iterate — an autonomous development loop, not just tab-to-accept suggestions.",
              },
              {
                title: 'guIDE is free where Tabnine charges',
                body: "Tabnine's free tier uses cloud models with limited context. Local model access requires a paid plan. guIDE's free tier includes full local inference with any model you download — no credit card, no trial period.",
              },
              {
                title: '69 tools baked in, zero setup',
                body: "guIDE ships production-ready with 69 MCP tools: Playwright browser automation, file management, web search, code execution across 50+ languages, persistent AI memory, Git, and more. Tabnine is a completion plugin — it does completions.",
              },
            ].map((card) => (
              <div key={card.title} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6">
                <h3 className="text-base font-semibold text-purple-400 mb-3">{card.title}</h3>
                <p className="text-neutral-300 text-sm leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.2}>
          <div className="mt-20 text-center border-t border-white/10 pt-20">
            <h2 className="text-3xl font-bold text-white mb-4">Go beyond completions. Build with a full AI agent.</h2>
            <p className="text-neutral-400 mb-8">69 tools. Local inference. No plugin host required.</p>
            <Link
              href="/download"
              className="inline-block bg-purple-600 hover:bg-purple-500 text-white font-semibold px-8 py-4 rounded-lg transition-colors text-base"
            >
              Download guIDE &rarr;
            </Link>
          </div>
        </FadeIn>

      </div>
    </div>
  );
}
