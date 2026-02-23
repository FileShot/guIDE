import Link from 'next/link';

const footerLinks = {
  Product: [
    { href: '/download', label: 'Download' },
    { href: 'https://pocket.graysoft.dev', label: <>Pocket <span className="brand-font">guIDE</span></>, external: true },
    { href: '/models', label: 'Model Recommender' },
    { href: '/models/benchmarks', label: 'Benchmarks' },
    { href: '/models/compare', label: 'Model Comparisons' },
    { href: '/faq', label: 'FAQ' },
    { href: '/#features', label: 'Features' },
    { href: '/#pricing', label: 'Pricing' },
  ],
  Community: [
    { href: '/blog', label: 'Blog' },
    { href: '/community', label: 'Discussions' },
    { href: '/projects', label: 'Projects' },
  ],
  Company: [
    { href: '/about', label: 'About Us' },
    { href: '/contact', label: 'Contact' },
    { href: '/support', label: 'Support' },
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
  ],
  Account: [
    { href: '/login', label: 'Sign In' },
    { href: '/register', label: 'Create Account' },
    { href: '/account', label: 'Dashboard' },
  ],
};

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-black" role="contentinfo" aria-label="Site footer">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <img src="/logo.png" alt="guIDE" className="w-7 h-7" />
              <span className="text-base font-semibold tracking-tight brand-font">
                <span className="text-white">gu</span>
                <span className="text-accent">IDE</span>
              </span>
            </Link>
            <p className="text-sm text-neutral-500 leading-relaxed">
              The AI-native code editor with local LLM inference and 69 built-in tools.
            </p>
          </div>

          {/* Link Columns */}
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">
                {heading}
              </h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    {'external' in link ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-neutral-500 hover:text-white transition-colors inline-flex items-center gap-1"
                      >
                        {link.label}
                        <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-neutral-500 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/5 mt-12 pt-8 flex flex-col sm:flex-row justify-between items-center gap-6">
          <p className="text-xs text-neutral-600">
            &copy; {new Date().getFullYear()} <span className="brand-font">guIDE</span>. All rights reserved.
          </p>
          <a
            href="https://www.producthunt.com/posts/guide-5?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-guide&#0045;5"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <img
              src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1083041&theme=dark"
              alt="guIDE – Local LLM IDE. Free forever. Private by design. | Product Hunt"
              width="200"
              height="43"
            />
          </a>
          <p className="text-xs text-neutral-600">
            Built by GraySoft
          </p>
        </div>
      </div>
    </footer>
  );
}
