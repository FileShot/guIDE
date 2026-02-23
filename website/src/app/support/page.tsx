import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Support — Help & Resources',
  description: 'Get help with guIDE Desktop or Pocket guIDE. Browse FAQs, join the community, or contact us directly.',
  alternates: { canonical: 'https://graysoft.dev/support' },
};

export default function SupportPage() {
  const channels = [
    {
      title: 'FAQ',
      description: 'Quick answers to the most common questions about installation, pricing, AI models, and more.',
      href: '/faq',
      icon: (
        <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      title: 'Community',
      description: <>Join the <span className="brand-font">guIDE</span> community to share tips, request features, report bugs, and connect with other users.</>,
      href: '/community',
      icon: (
        <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      ),
    },
    {
      title: 'Contact Us',
      description: 'Reach out directly for account issues, billing questions, partnership inquiries, or anything else.',
      href: '/contact',
      icon: (
        <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
    },
    {
      title: 'Email Support',
      description: 'Send us an email at support@graysoft.dev. We typically respond within 24 hours on business days.',
      href: 'mailto:support@graysoft.dev',
      icon: (
        <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 12.677a2.25 2.25 0 00-.1.661z" />
        </svg>
      ),
    },
  ];

  const topics = [
    {
      category: 'Getting Started',
      items: [
        { q: <>How do I install <span className="brand-font">guIDE</span> Desktop?</>, link: '/download' },
        { q: <>How do I access Pocket <span className="brand-font">guIDE</span>?</>, link: 'https://pocket.graysoft.dev' },
      ],
    },
    {
      category: 'Account & Billing',
      items: [
        { q: 'How do I upgrade to Pro or Unlimited?', link: '/faq' },
        { q: 'How do I cancel my subscription?', link: '/faq' },
        { q: 'How do I delete my account?', link: '/contact' },
      ],
    },
    {
      category: 'AI & Models',
      items: [
        { q: 'What AI models are available?', link: '/models' },
        { q: 'How does local AI inference work?', link: '/faq' },
        { q: 'What counts as a cloud AI message?', link: '/faq' },
      ],
    },
  ];

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <FadeIn>
          <div className="text-center mb-16">
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              Support
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              How Can We Help?
            </h1>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
              Find answers in our FAQ, connect with the community, or reach out directly.
              We&apos;re here to help with <span className="brand-font">guIDE</span> Desktop and Pocket <span className="brand-font">guIDE</span>.
            </p>
          </div>
        </FadeIn>

        {/* Support Channels */}
        <FadeIn delay={0.1}>
          <div className="grid md:grid-cols-2 gap-6 mb-20">
            {channels.map((channel) => {
              const isExternal = channel.href.startsWith('mailto:');
              const Component = isExternal ? 'a' : Link;
              return (
                <Component
                  key={channel.title}
                  href={channel.href}
                  className="group relative p-6 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 mt-1">{channel.icon}</div>
                    <div>
                      <h2 className="text-xl font-semibold text-white mb-2 group-hover:text-accent transition-colors">
                        {channel.title}
                      </h2>
                      <p className="text-neutral-400 text-sm leading-relaxed">
                        {channel.description}
                      </p>
                    </div>
                  </div>
                  <div className="absolute top-6 right-6 text-neutral-600 group-hover:text-accent transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </Component>
              );
            })}
          </div>
        </FadeIn>

        {/* Popular Topics */}
        <FadeIn delay={0.2}>
          <div className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-8 text-center">
              Popular Topics
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              {topics.map((group) => (
                <div key={group.category}>
                  <h3 className="text-lg font-semibold text-white mb-4">{group.category}</h3>
                  <ul className="space-y-3">
                    {group.items.map((item, idx) => {
                      const isExternal = item.link.startsWith('http');
                      return (
                        <li key={idx}>
                          {isExternal ? (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-neutral-400 hover:text-accent transition-colors text-sm flex items-start gap-2"
                            >
                              <span className="text-accent mt-0.5">›</span>
                              {item.q}
                            </a>
                          ) : (
                            <Link
                              href={item.link}
                              className="text-neutral-400 hover:text-accent transition-colors text-sm flex items-start gap-2"
                            >
                              <span className="text-accent mt-0.5">›</span>
                              {item.q}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Bottom CTA */}
        <FadeIn delay={0.3}>
          <div className="text-center rounded-2xl border border-white/10 bg-white/[0.02] p-10">
            <h2 className="text-2xl font-bold text-white mb-3">
              Still Need Help?
            </h2>
            <p className="text-neutral-400 mb-6 max-w-lg mx-auto">
              Can&apos;t find what you&apos;re looking for? Send us a message and
              we&apos;ll get back to you as soon as possible.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent/90 text-white font-medium px-6 py-3 rounded-lg transition-colors"
            >
              Contact Us
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
