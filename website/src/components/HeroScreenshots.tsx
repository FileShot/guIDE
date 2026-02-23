'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

export default function HeroScreenshots() {
  return (
    <section className="py-16 px-6 border-t border-white/5">
      <div className="max-w-6xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="rounded-xl border border-white/[0.06] overflow-hidden shadow-2xl shadow-black/40">
            <Image
              src="/graysoft-ide-chat.png"
              alt="guIDE — AI Chat Interface"
              width={1920}
              height={1080}
              className="w-full h-auto"
              priority
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          <div className="rounded-xl border border-white/[0.06] overflow-hidden shadow-2xl shadow-black/40">
            <Image
              src="/graysoft-ide-tools.png"
              alt="guIDE — 69 Built-in Tools"
              width={1920}
              height={1080}
              className="w-full h-auto"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
