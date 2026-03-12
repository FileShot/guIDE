import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'guIDE vs Windsurf — Local AI IDE vs Codeium Cloud Editor',
  description: 'Windsurf by Codeium is a capable AI editor — but your code goes to their servers, you hit rate limits, and paid tiers add up. guIDE gives you unlimited local AI, 69 MCP tools, and starts free.',
  alternates: { canonical: 'https://graysoft.dev/vs/windsurf' },
  openGraph: {
    title: 'guIDE vs Windsurf — Local AI vs Cloud Code Editor',
    description: 'Windsurf sends code to Codeium servers. guIDE keeps everything on your hardware with unlimited inference and 69 built-in tools.',
    url: 'https://graysoft.dev/vs/windsurf',
    siteName: 'guIDE by GraySoft',
  },
};

const rows = [
  { feature: 'Local AI inference (on-device, no cloud)', guide: true, other: false },
  { feature: 'No rate limits, ever', guide: true, other: false },
  { feature: 'Code never leaves your machine', guide: true, other: false },
  { feature: 'Free plan available', guide: true, other: true },
  { feature: 'Built-in MCP Tools (69+)', guide: true, other: false },
  { feature: 'Browser automation (Playwright built-in)', guide: true, other: false },
  { feature: 'Voice input (Whisper STT)', guide: true, other: false },
  { feature: 'Code runner (50+ languages)', guide: true, other: 'Extension' },
  { feature: 'Hardware-aware model selection', guide: true, other: false },
  { feature: 'RAG codebase indexing', guide: true, other: true },
  { feature: 'Agentic multi-step AI loop (Cascade)', guide: true, other: true },
  { feature: 'AI chat / code completion', guide: true, other: true },
  { feature: 'Git integration', guide: true, other: true },
  { feature: 'Cloud LLM support (optional)', guide: true, other: true },
  { feature: 'Pro plan required for unlimited usage', guide: false, other: true },
];

function Cell({ val }: { val: boolean | string }) {
  if (val === true) return <span className="text-emerald-400 text-lg font-bold">✓</span>;
  if (val === false) return <span className="text-neutral-600 text-lg">—</span>;
  return <span className="text-yellow-400 text-sm">{val}</span>;
}

export default function VsWindsurfPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">

        <FadeIn>
          <p className="text-sm font-medium text-purple-400 uppercase tracking-wider mb-3">Comparison</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            guIDE vs Windsurf
          </h1>
          <p className="text-xl text-neutral-300 max-w-2xl mb-10">
            Windsurf (by Codeium) is a polished AI editor with a generous free tier — but it routes your code through their cloud servers and throttles heavy users. guIDE runs AI models locally, ships with 69 integrated tools, and has no usage caps.
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
                  <th className="px-6 py-4 text-neutral-400 font-semibold uppercase tracking-wide text-xs text-center">Windsurf</th>
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
          <h2 className="text-2xl font-bold text-white mt-20 mb-8">What guIDE does that Windsurf can't</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                title: 'True offline operation',
                body: "Windsurf requires an internet connection and Codeium's servers to function. guIDE can operate completely air-gapped with a local model. Traveling, on a secured network, or just offline — guIDE keeps working.",
              },
              {
                title: "Windsurf's 'free' tier has hidden limits",
                body: "Windsurf's free tier includes limited Cascade (agentic) flows and credits for GPT-4/Claude sessions. Heavy users quickly exhaust free credits and face $15–$35/month to continue at the same level.",
              },
              {
                title: '69 tools vs zero built-in tools',
                body: "Windsurf is an AI editor — it edits code. guIDE includes browser automation, persistent memory, web search, code execution, file system management, and more — natively built into the AI agent loop.",
              },
              {
                title: 'Hardware-aware model selection',
                body: "guIDE detects your GPU VRAM and recommends the best local model for your hardware. Running a 7B, 13B, or 70B model? guIDE guides you to what actually fits and performs well on your machine.",
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
            <h2 className="text-3xl font-bold text-white mb-4">Local AI. 69 tools. No subscriptions.</h2>
            <p className="text-neutral-400 mb-8">Your models, your hardware, your workflow. guIDE is free to download.</p>
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
