'use client';

import FadeIn from './FadeIn';

const features = [
  { name: 'Local AI Inference (On-Device)', guide: true, cursor: false, windsurf: false, vscode: false },
  { name: 'Built-in MCP Tools (69+)', guide: true, cursor: false, windsurf: false, vscode: false },
  { name: 'Browser Automation (Playwright)', guide: true, cursor: false, windsurf: false, vscode: false },
  { name: 'Code Runner (50+ Languages)', guide: true, cursor: false, windsurf: false, vscode: 'ext' },
  { name: 'Voice Input (Whisper STT)', guide: true, cursor: false, windsurf: false, vscode: false },
  { name: 'RAG Codebase Indexing', guide: true, cursor: true, windsurf: true, vscode: false },
  { name: 'AI Chat / Copilot', guide: true, cursor: true, windsurf: true, vscode: true },
  { name: 'Cloud LLM Providers (17)', guide: true, cursor: true, windsurf: true, vscode: true },
  { name: 'Git Integration', guide: true, cursor: true, windsurf: true, vscode: true },
  { name: 'File Explorer + Search', guide: true, cursor: true, windsurf: true, vscode: true },
  { name: 'Agentic AI Loop (Multi-Step)', guide: true, cursor: true, windsurf: true, vscode: false },
  { name: 'Hardware-Aware Model Selection', guide: true, cursor: false, windsurf: false, vscode: false },
  { name: 'Privacy First (Air-Gapped)', guide: true, cursor: false, windsurf: false, vscode: false },
  { name: 'Free Tier Available', guide: true, cursor: false, windsurf: false, vscode: true },
  { name: 'Subscription Required', guide: false, cursor: true, windsurf: true, vscode: false },
];

const Cell = ({ value }: { value: boolean | string }) => {
  if (value === 'ext') return <span className="text-yellow-400 text-sm" title="Requires extension">⚡</span>;
  if (value === true) return <span className="text-emerald-400 text-lg">✓</span>;
  return <span className="text-neutral-600 text-lg">—</span>;
};

export default function Comparison() {
  return (
    <section id="comparison" className="py-28 px-6 border-t border-white/5">
      <div className="max-w-5xl mx-auto">
        <FadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              Compare
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              How <span className="brand-font">guIDE</span> stacks up
            </h2>
            <p className="text-neutral-400 max-w-xl mx-auto">
              See what you get out of the box — no rate limits, no subscriptions, no cloud dependency.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-4 py-3 text-neutral-400 font-medium">Feature</th>
                  <th className="px-4 py-3 text-center">
                    <span className="text-accent font-bold brand-font">guIDE</span>
                  </th>
                  <th className="px-4 py-3 text-center text-neutral-400 font-medium">Cursor</th>
                  <th className="px-4 py-3 text-center text-neutral-400 font-medium">Windsurf</th>
                  <th className="px-4 py-3 text-center text-neutral-400 font-medium">VS Code</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f, i) => (
                  <tr
                    key={f.name}
                    className={`border-b border-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : ''} hover:bg-white/[0.03] transition-colors`}
                  >
                    <td className="px-4 py-2.5 text-neutral-300">{f.name}</td>
                    <td className="px-4 py-2.5 text-center"><Cell value={f.guide} /></td>
                    <td className="px-4 py-2.5 text-center"><Cell value={f.cursor} /></td>
                    <td className="px-4 py-2.5 text-center"><Cell value={f.windsurf} /></td>
                    <td className="px-4 py-2.5 text-center"><Cell value={f.vscode} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-neutral-600 mt-4">
            ⚡ = Requires third-party extension &nbsp;·&nbsp; Comparison based on default/built-in features as of 2026
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
