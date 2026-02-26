import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PageTracker from '@/components/PageTracker';

export const metadata: Metadata = {
  metadataBase: new URL('https://graysoft.dev'),
  title: {
    default: 'guIDE — The First Native LLM IDE | Offline AI Code Editor',
    template: '%s | guIDE',
  },
  description:
    'guIDE is the first truly native LLM IDE — unlimited completions, complete privacy, no subscriptions. Built like VSCode, but designed for your native LLM AI models directly on your machine.',
  keywords: [
    'AI IDE', 'offline AI IDE', 'local LLM IDE', 'AI code editor', 'offline code editor',
    'AI powered IDE', 'native LLM IDE', 'Cursor alternative', 'Windsurf alternative',
    'VS Code AI', 'local AI coding', 'private AI IDE', 'no subscription IDE',
    'free AI IDE', 'GGUF models', 'developer tools', 'guIDE', 'GraySoft',
    'AI programming', 'code completion', 'AI pair programming', 'open source IDE',
    'unlimited AI completions', 'air-gapped IDE', 'GPU inference',
  ],
  authors: [{ name: 'Brendan Gray', url: 'https://graysoft.dev' }],
  creator: 'GraySoft',
  publisher: 'GraySoft',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'guIDE — The First Truly Native LLM IDE',
    description:
      'Unlimited AI completions, complete privacy, no subscriptions. Run AI models directly on your hardware with 53+ built-in tools.',
    type: 'website',
    url: 'https://graysoft.dev',
    siteName: 'guIDE by GraySoft',
    images: [{
      url: '/logo.png',
      width: 512,
      height: 512,
      alt: 'guIDE - AI Native Code Editor',
    }],
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'guIDE — The First Truly Native LLM IDE',
    description: 'Unlimited AI completions, complete privacy, no subscriptions. Built like VSCode for your local AI models.',
    images: ['/logo.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://graysoft.dev',
  },
  verification: {
    google: 'G-MT0SYC8BJE',
  },
  manifest: '/manifest.json',
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is guIDE?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'guIDE is the first truly native LLM IDE that runs AI models locally on your machine. It provides offline AI code assistance without sending your code to external servers.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does guIDE work offline?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, guIDE runs AI models locally using your GPU or CPU, providing full AI code assistance even without an internet connection.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does guIDE cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'guIDE is free to download and use. Cloud AI tiers start at $4.99/mo for Pro (500 messages/day) and $9.99/mo for Unlimited. Local AI inference is always free.',
      },
    },
  ],
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'guIDE',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Windows 10+',
  offers: {
    '@type': 'Offer',
    price: '0.00',
    priceCurrency: 'USD',
  },
  description: 'The first truly native LLM IDE — unlimited completions, complete privacy, no subscriptions.',
  url: 'https://graysoft.dev',
  author: {
    '@type': 'Person',
    name: 'Brendan Gray',
  },
  publisher: {
    '@type': 'Organization',
    name: 'GraySoft',
    url: 'https://graysoft.dev',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* font-display:swap fallback for any web fonts */}
        <style dangerouslySetInnerHTML={{__html: '@font-face{font-display:swap;src:local("system-ui")}'}} />
        {/* Resource hints */}
        <link rel="dns-prefetch" href="//www.googletagmanager.com" />
        <link rel="dns-prefetch" href="//www.google-analytics.com" />
        <link rel="preconnect" href="https://www.googletagmanager.com" crossOrigin="anonymous" />
        {/* Google Analytics */}
        <Script async src="https://www.googletagmanager.com/gtag/js?id=G-MT0SYC8BJE" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-MT0SYC8BJE');`}
        </Script>
        {/* Google AdSense */}
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8992203205244704"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        {/* Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Graysoft',
            url: 'https://graysoft.dev',
            logo: 'https://graysoft.dev/logo.png',
            description: 'Creator of guIDE, the first truly native offline AI code editor.',
            contactPoint: {
              '@type': 'ContactPoint',
              contactType: 'customer support',
              url: 'https://graysoft.dev/contact',
            },
          }) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'guIDE by GraySoft',
            url: 'https://graysoft.dev',
            description: 'The first truly native LLM IDE — unlimited completions, complete privacy, no subscriptions.',
            publisher: { '@type': 'Organization', name: 'GraySoft' },
            potentialAction: {
              '@type': 'SearchAction',
              target: 'https://graysoft.dev/docs?q={search_term_string}',
              'query-input': 'required name=search_term_string',
            },
          }) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://graysoft.dev' },
              { '@type': 'ListItem', position: 2, name: 'Features', item: 'https://graysoft.dev/features' },
              { '@type': 'ListItem', position: 3, name: 'Download', item: 'https://graysoft.dev/download' },
            ],
          }) }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <PageTracker />
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:bg-white focus:text-black focus:px-4 focus:py-2" aria-label="Skip to content">Skip to content</a>
        <Header />
        <main id="main-content" role="main" aria-label="Main content" className="flex-1" style={{paddingBottom: 'clamp(58px, 8vw, 100px)'}}>
          <article>{children}</article>
          <aside className="sr-only" aria-label="Supplementary information">
            <p>guIDE by GraySoft — the first native LLM IDE. Run AI models locally with complete privacy, no subscriptions, and unlimited completions.</p>
          </aside>
        </main>
        <Footer />
        {/* Sticky bottom banner ad — 320×50 mobile, 728×90 desktop */}
        <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:9999,display:'flex',justifyContent:'center',alignItems:'center',backgroundColor:'rgba(0,0,0,0.95)',borderTop:'1px solid rgba(255,255,255,0.08)',padding:'4px 0',overflow:'hidden'}}>
          <div className="hidden sm:block">
            <iframe src="//shopsuptight.com/watchnew?key=394217cb689e940d870aef10bfeecd47" width="728" height="90" frameBorder="0" scrolling="no" style={{border:0,maxWidth:'100%'}} />
          </div>
          <div className="block sm:hidden">
            <iframe src="//shopsuptight.com/watchnew?key=0496beb6abbf30571b993deaa7013d86" width="320" height="50" frameBorder="0" scrolling="no" style={{border:0,maxWidth:'100%'}} />
          </div>
        </div>
        <Script src="/pwa.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
