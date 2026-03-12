import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'guIDE vs GitHub Copilot — Local AI IDE vs GitHub Cloud Completion',
  description: 'GitHub Copilot charges $10–19/month and sends all your code to Microsoft/OpenAI servers. guIDE runs AI models locally — unlimited completions, no cloud, no subscription required.',
  alternates: { canonical: 'https://graysoft.dev/vs/github-copilot' },
  openGraph: {
    title: 'guIDE vs GitHub Copilot — Local AI vs Cloud Completion',
    description: 'GitHub Copilot costs $10–19/mo and sends your code to Microsoft servers. guIDE is local, unlimited, and starts free.',
    url: 'https://graysoft.dev/vs/github-copilot',
    siteName: 'guIDE by GraySoft',
  },
};

const rows = [
  { feature: 'Local AI inference (on-device, no cloud)', guide: true, other: false },
  { feature: 'No rate limits, ever', guide: true, other: false },
  { feature: 'Code never transmitted to servers', guide: true, other: false },
  { feature: 'Free plan available', guide: true, other: 'Limited (300 completions/mo)' },
  { feature: 'Standalone full IDE', guide: true, other: false },
  { feature: 'Built-in MCP Tools (69+)', guide: true, other: false },
  { feature: 'Browser automation (Playwright built-in)', guide: true, other: false },
  { feature: 'Voice input (Whisper STT)', guide: true, other: false },
  { feature: 'Agentic multi-step AI loop', guide: true, other: 'Limited (VS Code only)' },
  { feature: 'Hardware-aware model selection', guide: true, other: false },
  { feature: 'Privacy-first / air-gapped support', guide: true, other: false },
  { feature: 'RAG codebase indexing', guide: true, other: true },
  { feature: 'AI chat / code completion', guide: true, other: true },
  { feature: 'Git integration', guide: true, other: true },
  { feature: 'Requires VS Code / JetBrains / other host', guide: false, other: true },
];

function Cell({ val }: { val: boolean | string }) {
  if (val === true) return <span className="text-emerald-400 text-lg font-bold">✓</span>;
  if (val === false) return <span className="text-neutral-600 text-lg">—</span>;
  return <span className="text-yellow-400 text-sm">{val}</span>;
}

export default function VsGitHubCopilotPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">

        <FadeIn>
          <p className="text-sm font-medium text-purple-400 uppercase tracking-wider mb-3">Comparison</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            guIDE vs GitHub Copilot
          </h1>
          <p className="text-xl text-neutral-300 max-w-2xl mb-10">
            GitHub Copilot is an AI completion plugin. It requires VS Code or a supported IDE, sends your code to Microsoft's servers, and costs $10–19/month. guIDE is a complete, standalone IDE with local AI inference, 69 built-in tools, and no mandatory subscription.
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
                  <th className="px-6 py-4 text-neutral-400 font-semibold uppercase tracking-wide text-xs text-center">GitHub Copilot</th>
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
          <h2 className="text-2xl font-bold text-white mt-20 mb-8">The fundamental difference</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                title: 'Copilot is a plugin. guIDE is an IDE.',
                body: "GitHub Copilot requires VS Code, Vim, JetBrains, or another supported editor as a host. It adds AI to an existing workflow. guIDE is a complete IDE built from scratch around AI — the difference is like adding power steering to a car vs building a new car with power steering native.",
              },
              {
                title: 'Your code goes to Microsoft and OpenAI',
                body: "Every suggestion GitHub Copilot generates involves sending your code — including file context and surrounding code — to Microsoft's servers and OpenAI or their inference partners. For proprietary, confidential, or regulated code, this is a compliance and security issue.",
              },
              {
                title: 'Copilot free tier is 300 completions/month',
                body: "GitHub Copilot's free plan allows 300 inline code completions and 50 chat messages per month. Any real development session exhausts this in hours. guIDE with a local model has zero limits — run it 24/7 with no quota.",
              },
              {
                title: 'guIDE is an agent. Copilot is an autocomplete.',
                body: "Copilot suggests code inline. guIDE's AI agent can write code, run it, browse documentation, automate the browser, manage files, search the web, and execute multi-step tasks — all in one loop without you copy-pasting between tools.",
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
            <h2 className="text-3xl font-bold text-white mb-4">A full AI IDE. Free. No Microsoft in the loop.</h2>
            <p className="text-neutral-400 mb-8">Local inference. 69 tools. Your code stays on your machine.</p>
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
