import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Download guIDE — Free Offline AI Code Editor',
  description: 'Download guIDE for Windows, Linux, and macOS. A free AI-powered IDE with local LLM inference, unlimited completions, and complete privacy — no subscription required.',
  alternates: { canonical: 'https://graysoft.dev/download' },
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
