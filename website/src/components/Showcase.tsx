'use client';

import Image from 'next/image';
import FadeIn from './FadeIn';

const screenshots = [
  { src: '/graysoft-screenshot-1.png', alt: 'guIDE — Code Editor' },
  { src: '/graysoft-screenshot-2.png', alt: 'guIDE — File Explorer' },
  { src: '/graysoft-screenshot-3.png', alt: 'guIDE — Browser Automation' },
  { src: '/graysoft-screenshot-4.png', alt: 'guIDE — Terminal & Output' },
];

export default function Showcase() {
  return (
    <section id="showcase" className="py-28 px-6 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <FadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              In Action
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              See it for yourself
            </h2>
            <p className="text-neutral-400 max-w-xl mx-auto">
              A modern, dark-themed editor with integrated AI chat, file explorer,
              browser automation, and everything else built right in.
            </p>
          </div>
        </FadeIn>

        {/* Screenshot Grid */}
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {screenshots.map((s, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden group hover:border-accent/20 transition-colors"
              >
                <Image
                  src={s.src}
                  alt={s.alt}
                  width={960}
                  height={540}
                  className="w-full h-auto"
                />
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
