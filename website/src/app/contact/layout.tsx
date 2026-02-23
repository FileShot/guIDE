import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Us — Reach the GraySoft Team',
  description: 'Get in touch with the GraySoft team for support, partnerships, feedback, or questions about guIDE — the offline AI-powered code editor.',
  alternates: { canonical: 'https://graysoft.dev/contact' },
  openGraph: {
    title: 'Contact Us — Reach the GraySoft Team | guIDE',
    description: 'Get in touch with the GraySoft team for support, feedback, or questions about guIDE.',
    type: 'website',
    url: 'https://graysoft.dev/contact',
  },
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
