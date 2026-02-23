import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Projects & Portfolio — Software by GraySoft',
  description: 'Explore the full portfolio of developer tools, platforms, and open-source projects built by Brendan Gray and GraySoft.',
  alternates: { canonical: 'https://graysoft.dev/projects' },
};

const projects = [
  {
    name: 'guIDE',
    url: 'https://graysoft.dev',
    color: 'from-purple-500 to-violet-400',
    icon: '🧠',
    tagline: 'AI-Native Code Editor',
    nameClass: 'brand-font',
    description:
      'A full-featured IDE with local LLM inference, 69+ MCP tools, agentic AI loop, 17 cloud providers, and the Monaco editor — all running on your hardware with zero rate limits.',
    features: ['Local AI Inference', 'Monaco Editor', '69+ Tools', '8 Themes', 'Browser Automation', 'RAG Context'],
    status: 'Live',
  },
  {
    name: 'FileShot',
    url: 'https://fileshot.io',
    color: 'from-emerald-500 to-teal-400',
    icon: '📁',
    tagline: 'Privacy-First File Sharing',
    description:
      'End-to-end encrypted file sharing with AES-256 encryption. Unlimited free storage, built-in PDF editor, file converter, and zero-knowledge architecture. Your files, truly private.',
    features: ['AES-256 E2E Encryption', 'Unlimited Storage', 'PDF Editor', 'File Converter', 'Zero-Knowledge', 'No Account Required'],
    status: 'Live',
  },
  {
    name: 'ZipDex',
    url: 'https://zipdex.io',
    color: 'from-orange-500 to-yellow-400',
    icon: '📈',
    tagline: 'Crypto Trading Automation',
    description:
      'Smart trading bots with DCA, Grid, and custom strategies across 106+ coins. Automated portfolio management starting at $1/bot/month. Built for traders who want to automate, not babysit.',
    features: ['DCA & Grid Bots', '106+ Coins', '$1/Bot/Month', 'Smart Strategies', 'Portfolio Tracking', 'Real-Time Data'],
    status: 'Live',
  },
  {
    name: 'DiggaByte',
    url: 'https://diggabyte.com',
    color: 'from-purple-500 to-pink-400',
    icon: '🧩',
    tagline: 'SaaS Boilerplate Marketplace',
    description:
      'Production-ready SaaS templates and boilerplates built with Next.js and TypeScript. 50+ templates from $20 — authentication, payments, dashboards, and full stacks ready to deploy.',
    features: ['Next.js Templates', 'TypeScript', '50+ Templates', 'Auth & Payments', 'From $20', 'Production-Ready'],
    status: 'Live',
  },
  {
    name: 'iByte',
    url: 'https://ibyte.site',
    color: 'from-red-500 to-orange-400',
    icon: '📰',
    tagline: 'Tech & AI News Hub',
    description:
      'Curated tech, gaming, and AI news aggregation with editorial content, daily briefs, and in-depth analysis. Stay current with what matters in technology without the noise.',
    features: ['AI News', 'Gaming Coverage', 'Daily Briefs', 'Editorial Content', 'Curated Feed', 'In-Depth Analysis'],
    status: 'Live',
  },
  {
    name: 'iStack',
    url: 'https://istack.site',
    color: 'from-violet-500 to-purple-400',
    icon: '🏗️',
    tagline: 'Developer Portfolio Platform',
    description:
      'Build and showcase your developer portfolio with modern templates, project galleries, and skill tracking. Stand out to employers and clients with a polished online presence.',
    features: ['Portfolio Builder', 'Project Gallery', 'Skill Tracking', 'Modern Templates', 'Custom Domains', 'Analytics'],
    status: 'Coming Soon',
  },
  {
    name: 'SEODoc',
    url: 'https://seodoc.site',
    color: 'from-orange-600 to-amber-500',
    icon: '🔍',
    tagline: 'Free SEO Audit Tool',
    description:
      'Get a detailed, comprehensive analysis of any website. Technical SEO, on-page optimization, performance, security, and structured data — all in one free report.',
    features: ['Full Site Crawl', 'Technical SEO', 'Performance Audit', 'Security Check', '9-Category Score', 'Structured Data'],
    status: 'Live',
  },
];

export default function ProjectsPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              Portfolio
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Built by GraySoft
            </h1>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
              A growing ecosystem of developer tools, platforms, and products —
              all built independently by Brendan Gray.
            </p>
          </div>
        </FadeIn>

        {/* Project Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, i) => (
            <FadeIn key={project.name} delay={i * 0.08}>
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block h-full"
              >
                <div className="relative h-full bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 transition-all duration-300 hover:bg-white/[0.06] hover:border-white/[0.12] hover:shadow-[0_0_40px_rgba(0,122,204,0.08)]">
                  {/* Status Badge */}
                  <div className="absolute top-4 right-4">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                        project.status === 'Live'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>

                  {/* Icon & Name */}
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${project.color} flex items-center justify-center shadow-lg overflow-hidden p-1`}
                    >
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${new URL(project.url).hostname}&sz=64`}
                        alt={`${project.name} icon`}
                        width={32}
                        height={32}
                        className="w-8 h-8 object-contain"
                      />
                    </div>
                    <div>
                      <h3 className={`text-xl font-bold text-white group-hover:text-accent transition-colors ${(project as any).nameClass || ''}`}>
                        {project.name}
                      </h3>
                      <p className="text-xs text-neutral-500">{project.tagline}</p>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-neutral-400 leading-relaxed mb-5 line-clamp-3">
                    {project.description}
                  </p>

                  {/* Feature Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {project.features.map((f) => (
                      <span
                        key={f}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] text-neutral-500 border border-white/[0.06]"
                      >
                        {f}
                      </span>
                    ))}
                  </div>

                  {/* Visit Arrow */}
                  <div className="mt-5 flex items-center gap-1.5 text-xs text-neutral-500 group-hover:text-accent transition-colors">
                    <span>Visit {project.name}</span>
                    <svg
                      className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition-transform"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </a>
            </FadeIn>
          ))}
        </div>

        {/* CTA */}
        <FadeIn delay={0.3}>
          <div className="text-center mt-20">
            <p className="text-neutral-500 text-sm mb-4">
              Interested in working together or have a project idea?
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium text-sm transition-all hover:shadow-[0_0_20px_rgba(0,122,204,0.25)]"
            >
              Get in Touch
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
