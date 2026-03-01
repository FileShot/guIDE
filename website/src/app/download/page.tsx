'use client';

// Single source of truth for the displayed release version.
// Updated automatically by: npm run release:deploy (from IDE root)
const CURRENT_VERSION = '1.6.4';

import Link from 'next/link';
import { useState } from 'react';
import FadeIn from '@/components/FadeIn';
import DonateProgress from '@/components/DonateProgress';
import { Download, Monitor, HardDrive, Cpu, Shield, AlertTriangle, Apple, Terminal, Zap } from 'lucide-react';

type Platform = 'windows' | 'linux' | 'mac';
type Variant = 'standard' | 'cuda';

const platforms: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: 'windows', label: 'Windows', icon: <Monitor size={16} /> },
  { id: 'linux', label: 'Linux', icon: <Terminal size={16} /> },
  { id: 'mac', label: 'macOS', icon: <Apple size={16} /> },
];

const BASE = `https://github.com/FileShot/guIDE/releases/download/v${CURRENT_VERSION}`;

const downloads: Record<Platform, Record<Variant, { name: string; file: string; size: string; format: string; available: boolean; note?: string }>> = {
  windows: {
    standard: { name: 'guIDE for Windows', file: `${BASE}/guIDE-Setup-${CURRENT_VERSION}.exe`, size: '~180 MB', format: 'NSIS Installer (.exe)', available: true },
    cuda: { name: 'guIDE for Windows · CUDA Edition', file: `${BASE}/guIDE-CUDA-Setup-${CURRENT_VERSION}.exe`, size: '~450 MB', format: 'NSIS Installer (.exe)', available: true, note: 'Includes NVIDIA CUDA binaries — larger download, best GPU performance' },
  },
  linux: {
    standard: { name: 'guIDE for Linux', file: `${BASE}/guIDE-${CURRENT_VERSION}-x86_64.AppImage`, size: '~150 MB', format: 'AppImage', available: true },
    cuda: { name: 'guIDE for Linux · CUDA Edition', file: `${BASE}/guIDE-CUDA-${CURRENT_VERSION}-x86_64.AppImage`, size: '~420 MB', format: 'AppImage', available: true, note: 'Includes NVIDIA CUDA binaries — requires CUDA 12+ and drivers 525+' },
  },
  mac: {
    standard: { name: 'guIDE for macOS', file: `${BASE}/guIDE-${CURRENT_VERSION}-x64.dmg`, size: '~180 MB', format: 'DMG (Intel + Apple Silicon)', available: true },
    cuda: { name: 'guIDE for macOS', file: `${BASE}/guIDE-${CURRENT_VERSION}-x64.dmg`, size: '~180 MB', format: 'DMG (Intel + Apple Silicon)', available: true },
  },
};

const requirementsByPlatform: Record<Platform, { icon: React.ReactNode; label: string; value: string }[]> = {
  windows: [
    { icon: <Monitor size={18} />, label: 'OS', value: 'Windows 10 or later (64-bit)' },
    { icon: <Cpu size={18} />, label: 'CPU', value: 'x86-64 processor' },
    { icon: <HardDrive size={18} />, label: 'Storage', value: '500 MB (Standard) · 1.2 GB (CUDA)' },
    { icon: <HardDrive size={18} />, label: 'RAM', value: '8 GB minimum, 16 GB recommended' },
    { icon: <Cpu size={18} />, label: 'GPU', value: 'NVIDIA GPU with 4+ GB VRAM — use CUDA build for hardware acceleration' },
  ],
  linux: [
    { icon: <Terminal size={18} />, label: 'OS', value: 'Ubuntu 20.04+, Fedora 36+, or equivalent (64-bit)' },
    { icon: <Cpu size={18} />, label: 'CPU', value: 'x86-64 processor' },
    { icon: <HardDrive size={18} />, label: 'Storage', value: '500 MB (Standard) · 1.1 GB (CUDA)' },
    { icon: <HardDrive size={18} />, label: 'RAM', value: '8 GB minimum, 16 GB recommended' },
    { icon: <Cpu size={18} />, label: 'GPU', value: 'NVIDIA GPU with 4+ GB VRAM · CUDA 12+ required for CUDA build' },
  ],
  mac: [
    { icon: <Apple size={18} />, label: 'OS', value: 'macOS 12 Monterey or later' },
    { icon: <Cpu size={18} />, label: 'CPU', value: 'Intel x64 or Apple Silicon (M1/M2/M3/M4)' },
    { icon: <HardDrive size={18} />, label: 'Storage', value: '500 MB for the application' },
    { icon: <HardDrive size={18} />, label: 'RAM', value: '8 GB minimum, 16 GB recommended' },
    { icon: <Cpu size={18} />, label: 'GPU', value: 'Metal-compatible GPU · Apple Silicon recommended for best performance' },
  ],
};

export default function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>('windows');
  const [variant, setVariant] = useState<Variant>('standard');

  const hasCuda = platform === 'windows' || platform === 'linux';
  const activeVariant: Variant = hasCuda ? variant : 'standard';
  const dl = downloads[platform][activeVariant];
  const reqs = requirementsByPlatform[platform];

  const handlePlatformChange = (p: Platform) => {
    setPlatform(p);
    if (p === 'mac') setVariant('standard');
  };

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
          <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] mb-4">
            {platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePlatformChange(p.id)}
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

        {/* Variant Toggle — Windows + Linux only */}
        {hasCuda ? (
          <FadeIn delay={0.07}>
            <div className="flex items-center gap-2 mb-8">
              <button
                onClick={() => setVariant('standard')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                  activeVariant === 'standard'
                    ? 'border-white/20 bg-white/[0.05] text-white'
                    : 'border-white/[0.06] text-neutral-500 hover:text-neutral-300 hover:border-white/10'
                }`}
              >
                Standard
              </button>
              <button
                onClick={() => setVariant('cuda')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                  activeVariant === 'cuda'
                    ? 'border-green-500/40 bg-green-500/[0.07] text-green-400'
                    : 'border-white/[0.06] text-neutral-500 hover:text-neutral-300 hover:border-white/10'
                }`}
              >
                <Zap size={13} />
                NVIDIA CUDA
              </button>
              <span className="ml-1 text-xs text-neutral-600">
                {activeVariant === 'cuda'
                  ? 'Requires NVIDIA GPU · CUDA 12+'
                  : 'Works on any hardware · smaller download'}
              </span>
            </div>
          </FadeIn>
        ) : (
          <div className="mb-8" />
        )}

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

        {/* Windows SmartScreen note */}
        {platform === 'windows' && (
          <FadeIn delay={0.2}>
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/[0.03] p-6 mb-10">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-white mb-1">
                    Windows SmartScreen
                  </h4>
                  <p className="text-sm text-neutral-400 leading-relaxed">
                    Windows may show a SmartScreen prompt the first time you run the installer
                    while our certificate builds trust reputation. Click{' '}
                    <strong className="text-neutral-300">&ldquo;More info&rdquo;</strong> &rarr;{' '}
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
                <p className="text-neutral-500"># Make executable and run</p>
                <p>chmod +x {activeVariant === 'cuda'
                  ? `guIDE-CUDA-${CURRENT_VERSION}-x86_64.AppImage`
                  : `guIDE-${CURRENT_VERSION}-x86_64.AppImage`}
                </p>
                <p>./{activeVariant === 'cuda'
                  ? `guIDE-CUDA-${CURRENT_VERSION}-x86_64.AppImage`
                  : `guIDE-${CURRENT_VERSION}-x86_64.AppImage`}
                </p>
              </div>
              {activeVariant === 'cuda' && (
                <p className="text-xs text-neutral-500 mt-3">
                  CUDA build requires NVIDIA drivers 525+ and CUDA Toolkit 12.0+.
                </p>
              )}
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
