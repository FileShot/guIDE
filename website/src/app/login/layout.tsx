import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In to Your guIDE Account',
  robots: { index: false, follow: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
