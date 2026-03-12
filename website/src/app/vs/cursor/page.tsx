import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'guIDE vs Cursor — Local AI IDE vs Cloud-Based Code Editor',
  description: 'Cursor charges $20/mo and sends your code to their servers. guIDE runs your AI models locally, includes 69 MCP tools, and costs nothing to start. Compare guIDE vs Cursor for privacy, features, and value.',
  alternates: { canonical: 'https://graysoft.dev/vs/cursor' },
  openGraph: {
    title: 'guIDE vs Cursor — Local AI IDE vs Cloud Code Editor',
    description: 'Cursor hits rate limits and sends code to the cloud. guIDE gives you unlimited local AI inference, 69 built-in tools, and no subscription required.',
    url: 'https://graysoft.dev/vs/cursor',
    siteName: 'guIDE by GraySoft',
  },
};

const rows = [
  { feature: 'Local AI inference (on-device, no cloud)', guide: true, other: false },
  { feature: 'No rate limits, ever', guide: true, other: false },
  { feature: 'Code never leaves your machine', guide: true, other: false },
  { feature: 'Free plan available', guide: true, other: false },
  { feature: 'Built-in MCP Tools (69+)', guide: true, other: false },
  { feature: 'Browser automation (Playwright built-in)', guide: true, other: false },
  { feature: 'Voice input (Whisper STT)', guide: true, other: false },
  { feature: 'Code runner (50+ languages)', guide: true, other: 'Extension' },
  { feature: 'Hardware-aware model selection', guide: true, other: false },
  { feature: 'RAG codebase indexing', guide: true, other: true },
  { feature: 'Agentic multi-step AI loop', guide: true, other: true },
  { feature: 'AI chat / code completion', guide: true, other: true },
  { feature: 'Git integration', guide: true, other: true },
  { feature: 'Cloud LLM support (optional)', guide: true, other: true },
  { feature: 'Monthly subscription required', guide: false, other: true },
];

function Cell({ val }: { val: boolean | string }) {
  if (val === true) return <span className="text-emerald-400 text-lg font-bold">✓</span>;
  if (val === false) return <span className="text-neutral-600 text-lg">—</span>;
  return <span className="text-yellow-400 text-sm">{val}</span>;
}

export default function VsCursorPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">

        <FadeIn>
          <p className="text-sm font-medium text-purple-400 uppercase tracking-wider mb-3">Comparison</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            guIDE vs Cursor
          </h1>
          <p className="text-xl text-neutral-300 max-w-2xl mb-10">
            Cursor is a strong AI code editor — but it charges $20/month, sends your code to the cloud, and cuts you off with rate limits when you need it most. guIDE runs everything locally, includes 69 built-in tools, and starts free.
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
                  <th className="px-6 py-4 text-neutral-400 font-semibold uppercase tracking-wide text-xs text-center">Cursor</th>
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
          <h2 className="text-2xl font-bold text-white mt-20 mb-8">Why developers switch from Cursor to guIDE</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                title: 'Rate limits hit at the worst time',
                body: "Cursor's free tier is limited and the Pro tier throttles you when you exhaust fast requests. guIDE runs inference on your local GPU or CPU — there are no usage quotas, no \"try again later,\" no throttling.",
              },
              {
                title: 'Your code goes to their servers',
                body: "Every prompt, every file context, every code snippet in Cursor is sent to Anthropic/OpenAI via Cursor's servers. If you're working on proprietary code, an NDA project, or anything confidential, that's a real exposure.",
              },
              {
                title: '69 built-in tools vs manual configuration',
                body: "guIDE ships with 69 pre-wired MCP tools: browser automation, file management, web search, code execution in 50+ languages, persistent memory, Git, and more. No extensions. No marketplace hunting.",
              },
              {
                title: '$20/month adds up — guIDE is free',
                body: "Cursor Pro is $20/month ($240/year). guIDE's core is free. If you need cloud LLMs or Pro features, the paid tier is $4.99/month — 4x cheaper than Cursor. And unlike Cursor, you can run guIDE completely offline with a downloaded model.",
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
            <h2 className="text-3xl font-bold text-white mb-4">No rate limits. No cloud. No $20/month.</h2>
            <p className="text-neutral-400 mb-8">guIDE runs on your hardware with your models. Free to download.</p>
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
