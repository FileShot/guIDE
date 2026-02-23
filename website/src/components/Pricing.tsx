'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import FadeIn from './FadeIn';

const freeFeatures = [
  'Full IDE — editor, file explorer, terminal',
  'Local LLM inference (GPU + CPU)',
  '69 built-in MCP tools',
  'Browser automation',
  'Code runner (50+ languages)',
  'Voice input (Whisper)',
  'Git integration',
  '30 cloud AI messages / day',
  'All future updates',
];

const proFeatures = [
  'Everything in Free',
  '500 cloud AI messages / day',
  'Multiple cloud AI providers',
  'Priority support',
];

const unlimitedFeatures = [
  'Everything in Pro',
  'Unlimited cloud AI messages',
  'Early access to new features',
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-28 px-6 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <FadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              Pricing
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Free to use. Pay only for what you need.
            </h2>
            <p className="text-neutral-400 max-w-xl mx-auto">
              <span className="brand-font">guIDE</span> Desktop is completely free. Upgrade your cloud AI access
              across Desktop and Pocket <span className="brand-font">guIDE</span> for one low price.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {/* Free */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7">
              <div className="mb-6">
                <p className="text-sm text-neutral-400 mb-1">Free</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">$0</span>
                </div>
                <p className="text-sm text-neutral-500 mt-2">Forever</p>
              </div>
              <ul className="space-y-3 mb-8">
                {freeFeatures.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-neutral-300">
                    <Check size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/download"
                className="block w-full py-3 border border-neutral-700 hover:border-accent text-white rounded-lg font-medium text-center transition-all duration-300"
              >
                Download Free
              </Link>
            </div>

            {/* Pro — highlighted */}
            <div className="rounded-2xl border border-accent/30 bg-gradient-to-b from-accent/[0.04] to-transparent p-7 relative overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-accent to-transparent" />
              <div className="mb-6">
                <p className="text-sm text-neutral-400 mb-1">Pro</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">$4.99</span>
                  <span className="text-sm text-neutral-500">/mo</span>
                </div>
                <p className="text-sm text-neutral-500 mt-2">Most popular</p>
              </div>
              <ul className="space-y-3 mb-8">
                {proFeatures.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-neutral-300">
                    <Check size={16} className="text-accent mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className="block w-full py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium text-center transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,122,204,0.25)]"
              >
                Get Pro
              </Link>
            </div>

            {/* Unlimited */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7 relative overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
              <div className="mb-6">
                <p className="text-sm text-neutral-400 mb-1">Unlimited</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">$9.99</span>
                  <span className="text-sm text-neutral-500">/mo</span>
                </div>
                <p className="text-sm text-neutral-500 mt-2">No limits at all</p>
              </div>
              <ul className="space-y-3 mb-8">
                {unlimitedFeatures.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-neutral-300">
                    <Check size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className="block w-full py-3 bg-gradient-to-r from-accent to-amber-400 hover:opacity-90 text-black font-semibold rounded-lg text-center transition-all duration-300"
              >
                Get Unlimited
              </Link>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.15}>
          <p className="text-center text-sm text-neutral-600 mt-8">
            All plans include the full <span className="brand-font">guIDE</span> Desktop app, Pocket <span className="brand-font">guIDE</span> browser access, 69 built-in tools, and 17 cloud AI providers.
            <br />
            Still cheaper than every competitor &mdash; Cursor is $20/mo, Windsurf is $15/mo, GitHub Copilot is $10/mo.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
