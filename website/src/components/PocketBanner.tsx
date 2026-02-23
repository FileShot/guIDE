'use client';

import { Globe, MessageSquare, Code2, Search, Terminal, Sparkles } from 'lucide-react';
import FadeIn from './FadeIn';

const capabilities = [
  { icon: <MessageSquare size={18} />, label: '6 AI Models' },
  { icon: <Globe size={18} />, label: 'Browser Automation' },
  { icon: <Code2 size={18} />, label: 'Monaco Editor' },
  { icon: <Terminal size={18} />, label: 'Command Execution' },
  { icon: <Search size={18} />, label: 'Web Search' },
  { icon: <Sparkles size={18} />, label: '19 Agent Tools' },
];

export default function PocketBanner() {
  return (
    <section className="py-28 px-6 border-t border-white/5 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-accent/[0.04] rounded-full blur-[120px]" />

      <div className="max-w-6xl mx-auto relative z-10">
        <FadeIn>
          <div className="rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/[0.05] via-transparent to-purple-500/[0.03] p-8 sm:p-12">
            <div className="flex flex-col lg:flex-row items-center gap-10">
              {/* Left: Text content */}
              <div className="flex-1 text-center lg:text-left">
                <div className="flex items-center gap-2 justify-center lg:justify-start mb-4">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs font-medium text-green-400 uppercase tracking-wider">
                    Live &mdash; Free to use
                  </span>
                </div>

                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                  Don&apos;t want to install anything?
                  <br />
                  <span className="text-accent">Try Pocket <span className="brand-font">guIDE</span>.</span>
                </h2>

                <p className="text-neutral-400 mb-6 max-w-lg leading-relaxed">
                  The full agentic AI experience — directly in your browser. No downloads,
                  no setup, no GPU required. Pocket <span className="brand-font">guIDE</span> is like ChatGPT but it&apos;s actually
                  an agent: it creates files, runs commands, browses the web, and builds
                  real projects.
                </p>

                {/* Capability pills */}
                <div className="flex flex-wrap gap-2 justify-center lg:justify-start mb-8">
                  {capabilities.map((cap) => (
                    <span
                      key={cap.label}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-neutral-300"
                    >
                      <span className="text-accent">{cap.icon}</span>
                      {cap.label}
                    </span>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
                  <a
                    href="https://pocket.graysoft.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,122,204,0.25)]"
                  >
                    <Globe size={18} />
                    Open Pocket <span className="brand-font">guIDE</span>
                  </a>
                  <span className="text-xs text-neutral-500">
                    Free &middot; No account required &middot; 10 MB storage
                  </span>
                </div>
              </div>

              {/* Right: Visual representation */}
              <div className="flex-shrink-0 w-full lg:w-[380px]">
                <div className="rounded-xl border border-white/[0.08] bg-black/40 backdrop-blur-sm overflow-hidden">
                  {/* Mini title bar */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    </div>
                    <span className="text-[11px] text-neutral-500 ml-2">pocket.graysoft.dev</span>
                  </div>
                  {/* Content mockup */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] text-accent font-bold">AI</span>
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <div className="h-2.5 bg-white/[0.06] rounded w-full" />
                        <div className="h-2.5 bg-white/[0.06] rounded w-4/5" />
                        <div className="h-2.5 bg-white/[0.06] rounded w-3/5" />
                      </div>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-3 h-3 rounded bg-accent/30" />
                        <span className="text-[10px] text-neutral-500 font-mono">browser_navigate</span>
                        <span className="text-[10px] text-green-400/70 ml-auto">done</span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 bg-accent/[0.08] rounded w-full" />
                        <div className="h-2 bg-accent/[0.08] rounded w-2/3" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5">
                        <div className="text-[10px] text-neutral-500 mb-1.5">Editor</div>
                        <div className="space-y-1">
                          <div className="h-1.5 bg-white/[0.05] rounded w-full" />
                          <div className="h-1.5 bg-accent/[0.12] rounded w-3/4" />
                          <div className="h-1.5 bg-white/[0.05] rounded w-5/6" />
                        </div>
                      </div>
                      <div className="flex-1 rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5">
                        <div className="text-[10px] text-neutral-500 mb-1.5">Browser</div>
                        <div className="h-[32px] bg-white/[0.04] rounded border border-white/[0.03]" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
