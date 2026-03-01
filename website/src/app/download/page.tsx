'use client';

// Single source of truth for the displayed release version.
// Updated automatically by: npm run release:deploy (from IDE root)
const CURRENT_VERSION = '1.6.3';

import Link from 'next/link';
import { useState } from 'react';
import FadeIn from '@/components/FadeIn';
import DonateProgress from '@/components/DonateProgress';
import { Download, Monitor, HardDrive, Cpu, Shield, AlertTriangle, Apple, Terminal } from 'lucide-react';

type Platform = 'windows' | 'linux' | 'mac';

const platforms: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: 'windows', label: 'Windows', icon: <Monitor size={16} /> },
  { id: 'linux', label: 'Linux', icon: <Terminal size={16} /> },
  { id: 'mac', label: 'macOS', icon: <Apple size={16} /> },
];

const downloads: Record<Platform, { name: string; file: string; size: string; format: string; available: boolean; note?: string }> = {
  windows: { name: 'guIDE for Windows', file: 'https://github.com/FileShot/guIDE/releases/download/v2.4.3/guIDE-Setup.exe', size: '~180 MB', format: 'NSIS Installer (.exe)', available: true },
  linux: { name: 'guIDE for Linux', file: 'https://github.com/FileShot/guIDE/releases/download/v2.4.3/guIDE-Linux-x64.tar.gz', size: '~149 MB', format: 'Portable Archive (.tar.gz)', available: true, note: 'Extract and run ./guIDE' },
  mac: { name: 'guIDE for macOS', file: '#', size: 'TBD', format: 'DMG (Intel + Apple Silicon)', available: false, note: 'macOS builds coming soon via CI/CD' },
};

const requirementsByPlatform: Record<Platform, { icon: React.ReactNode; label: string; value: string }[]> = {
  windows: [
    { icon: <Monitor size={18} />, label: 'OS', value: 'Windows 10 or later (64-bit)' },
    { icon: <Cpu size={18} />, label: 'CPU', value: 'x86-64 processor' },
    { icon: <HardDrive size={18} />, label: 'Storage', value: '500 MB for the application' },
    { icon: <HardDrive size={18} />, label: 'RAM', value: '8 GB minimum, 16 GB recommended' },
    { icon: <Cpu size={18} />, label: 'GPU (Optional)', value: 'NVIDIA GPU with 4+ GB VRAM for local AI' },
  ],
  linux: [
    { icon: <Terminal size={18} />, label: 'OS', value: 'Ubuntu 20.04+, Fedora 36+, or equivalent (64-bit)' },
    { icon: <Cpu size={18} />, label: 'CPU', value: 'x86-64 processor' },
    { icon: <HardDrive size={18} />, label: 'Storage', value: '500 MB for the application' },
    { icon: <HardDrive size={18} />, label: 'RAM', value: '8 GB minimum, 16 GB recommended' },
    { icon: <Cpu size={18} />, label: 'GPU (Optional)', value: 'NVIDIA GPU with 4+ GB VRAM for local AI (CUDA required)' },
  ],
  mac: [
    { icon: <Apple size={18} />, label: 'OS', value: 'macOS 12 Monterey or later' },
    { icon: <Cpu size={18} />, label: 'CPU', value: 'Intel x64 or Apple Silicon (M1/M2/M3/M4)' },
    { icon: <HardDrive size={18} />, label: 'Storage', value: '500 MB for the application' },
    { icon: <HardDrive size={18} />, label: 'RAM', value: '8 GB minimum, 16 GB recommended' },
    { icon: <Cpu size={18} />, label: 'GPU', value: 'Metal-compatible GPU for local AI (Apple Silicon recommended)' },
  ],
};

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>('windows');
  const dl = downloads[platform];
  const reqs = requirementsByPlatform[platform];

  const trackDownload = (dlPlatform: Platform) => {
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'download', platform: dlPlatform }),
    }).catch(() => {});
  };

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Download
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Get guIDE
          </h1>
          <p className="text-neutral-400 mb-8">
            Download and start building &mdash; guIDE is completely free. Upgrade to Pro for more cloud AI messages.
          </p>

          {/* Pocket guIDE alternative */}
          <div className="rounded-xl border border-accent/20 bg-accent/[0.03] p-5 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white mb-1">
                Don&apos;t want to install anything?
              </p>
              <p className="text-xs text-neutral-400">
                Try Pocket guIDE &mdash; the full AI agent experience in your browser, free with no download.
              </p>
            </div>
            <a
              href="https://pocket.graysoft.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-sm px-5 py-2.5 border border-accent/40 text-accent hover:bg-accent/10 rounded-lg font-medium transition-all whitespace-nowrap"
            >
              Open Pocket guIDE &rarr;
            </a>
          </div>
        </FadeIn>

        {/* Platform Tabs */}
        <FadeIn delay={0.05}>
          <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] mb-8">
            {platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                  platform === p.id
                    ? 'bg-accent text-white shadow-lg shadow-accent/20'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </div>
        </FadeIn>

        {/* Download Card */}
        <FadeIn delay={0.1}>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 mb-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">
                  {dl.name}
                </h2>
                <p className="text-sm text-neutral-400">
                  Version {CURRENT_VERSION} &middot; {dl.size} &middot; {dl.format}
                </p>
                {dl.note && (
                  <p className="text-xs text-neutral-500 mt-1">{dl.note}</p>
                )}
              </div>
              {dl.available ? (
                <a
                  href={dl.file}
                  onClick={() => trackDownload(platform)}
                  className="flex items-center gap-2 px-8 py-3.5 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,122,204,0.25)] whitespace-nowrap"
                >
                  <Download size={18} />
                  Download
                </a>
              ) : (
                <span className="flex items-center gap-2 px-8 py-3.5 bg-neutral-800 text-neutral-500 rounded-lg font-medium whitespace-nowrap cursor-not-allowed">
                  Coming Soon
                </span>
              )}
            </div>
          </div>
        </FadeIn>

        {/* System Requirements */}
        <FadeIn delay={0.15}>
          <h3 className="text-lg font-semibold text-white mb-5">
            System Requirements
          </h3>
          <div className="space-y-3 mb-12">
            {reqs.map((req) => (
              <div
                key={req.label}
                className="flex items-center gap-4 py-3 px-4 rounded-lg border border-white/[0.04] bg-white/[0.01]"
              >
                <div className="text-neutral-500">{req.icon}</div>
                <div>
                  <span className="text-sm font-medium text-neutral-300">{req.label}: </span>
                  <span className="text-sm text-neutral-400">{req.value}</span>
                </div>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* SmartScreen Warning (Windows only) */}
        {platform === 'windows' && (
          <FadeIn delay={0.2}>
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.03] p-6 mb-10">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-white mb-1">
                    Windows SmartScreen Warning
                  </h4>
                  <p className="text-sm text-neutral-400 leading-relaxed">
                    guIDE is not yet code-signed. Windows may display a SmartScreen warning
                    when you run the installer. This is normal for independent software.
                    Click <strong className="text-neutral-300">&ldquo;More info&rdquo;</strong> &rarr;{' '}
                    <strong className="text-neutral-300">&ldquo;Run anyway&rdquo;</strong> to proceed.
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>
        )}

        {/* Linux instructions */}
        {platform === 'linux' && (
          <FadeIn delay={0.2}>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-10">
              <h4 className="text-sm font-semibold text-white mb-3">Installation</h4>
              <div className="bg-[#0d0d0d] rounded-lg p-4 font-mono text-sm text-neutral-300 space-y-1">
                <p className="text-neutral-500"># Extract the archive</p>
                <p>tar -xzf guIDE-Linux-x64.tar.gz</p>
                <p className="text-neutral-500 mt-3"># Run guIDE</p>
                <p>cd guIDE-{CURRENT_VERSION}-x64</p>
                <p>./guide-ide</p>
              </div>
              <p className="text-xs text-neutral-500 mt-3">
                For NVIDIA GPU acceleration, ensure you have CUDA 12+ and the latest drivers installed.
              </p>
            </div>
          </FadeIn>
        )}

        <FadeIn delay={0.25}>
          <div className="mb-10">
            <DonateProgress />
          </div>
        </FadeIn>

        {/* Licensing / Activation */}
        <FadeIn delay={0.3}>
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-6">
            <div className="flex items-start gap-3">
              <Shield size={18} className="text-accent mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-semibold text-white mb-1">
                  Free &mdash; No License Required
                </h4>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  guIDE is free to download and use with 30 cloud AI messages per day.
                  Upgrade to Pro ($4.99/mo) for 500 messages/day, or Unlimited ($9.99/mo)
                  for no limits at all. Local AI inference is always free and unlimited.{' '}
                  <Link href="/register" className="text-accent hover:underline">
                    Create an account
                  </Link>{' '}
                  to get started.
                </p>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
