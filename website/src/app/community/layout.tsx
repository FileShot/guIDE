import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Community Forum — Discussions & Support',
  description: 'Join the guIDE developer community. Share projects, discuss AI coding, contribute to open source, and connect with other developers using offline AI.',
  alternates: { canonical: 'https://graysoft.dev/community' },
  openGraph: {
    title: 'Community Forum — Discussions & Support | guIDE',
    description: 'Join the guIDE developer community for discussions, project showcases, feature requests, and support.',
    type: 'website',
    url: 'https://graysoft.dev/community',
  },
}

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
