import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Model Recommender \u2014 Find Your Perfect LLM',
  description: 'Browse and download AI models for guIDE. Run LLMs locally with support for GGUF, ONNX, and more. Offline-first AI code assistant models.',
  alternates: { canonical: 'https://graysoft.dev/models' },
  openGraph: {
    title: 'AI Model Recommender — Find Your Perfect LLM | guIDE',
    description: 'Browse and download AI models for offline AI-powered coding in guIDE.',
    type: 'website',
    url: 'https://graysoft.dev/models',
  },
}

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
