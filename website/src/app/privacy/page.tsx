import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';

export const metadata: Metadata = {
  title: 'Privacy Policy — How We Handle Your Data',
  description: 'Privacy policy for guIDE Desktop and Pocket guIDE. Learn how GraySoft handles your data.',
  alternates: { canonical: 'https://graysoft.dev/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Legal
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Privacy Policy
          </h1>
          <p className="text-neutral-400 mb-2">
            Effective: February 15, 2026
          </p>
          <p className="text-neutral-500 text-sm mb-12">
            This policy covers <span className="brand-font">guIDE</span> Desktop — a product by GraySoft.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="prose prose-invert max-w-none space-y-8 text-neutral-300 leading-relaxed">

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">1. What We Collect</h2>
              <p>We collect the minimum data necessary to provide our services:</p>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li><strong className="text-neutral-300">Account information</strong> — Email address, name, and hashed password when you create an account. If you sign in with Google or GitHub, we receive your name, email, and profile picture from those providers.</li>
                <li><strong className="text-neutral-300">Authentication tokens</strong> — Session tokens and API keys stored locally on your device to maintain your login state.</li>
                <li><strong className="text-neutral-300">Usage metrics</strong> — Aggregate counts of cloud AI messages used (for plan limit enforcement). We do not log the content of your messages.</li>
                <li><strong className="text-neutral-300">Payment information</strong> — Processed by Stripe. We never see or store your full credit card number.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">2. What We Do NOT Collect</h2>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li>We do <strong className="text-neutral-300">not</strong> collect, store, or transmit your source code, files, or project data.</li>
                <li>We do <strong className="text-neutral-300">not</strong> log your AI conversation content.</li>
                <li>We do <strong className="text-neutral-300">not</strong> track your browsing history or web activity.</li>
                <li>We do <strong className="text-neutral-300">not</strong> use analytics cookies or third-party trackers on our products.</li>
                <li>We do <strong className="text-neutral-300">not</strong> sell, rent, or share your personal data with third parties.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">3. Local AI Inference</h2>
              <p>
                When you use local models in <span className="brand-font">guIDE</span> Desktop, all inference happens entirely on your
                device. No data is sent to any server. Your code, prompts, and AI responses
                never leave your machine. This is fully air-gapped.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">4. Cloud AI Access</h2>
              <p>
                When you use cloud AI features (available in <span className="brand-font">guIDE</span> Desktop and Pocket <span className="brand-font">guIDE</span>), your prompts are routed through GraySoft Cloud to the selected
                AI provider (e.g., Google Gemini, OpenAI, Anthropic). We act as a passthrough:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li>Your prompts are forwarded to the AI provider and the response is returned to you.</li>
                <li>We do not store the content of your prompts or responses.</li>
                <li>We log only the count and timestamp of requests for rate limiting and billing.</li>
                <li>Each AI provider has its own data handling policy which applies to the data they process.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">5. Data Storage</h2>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li><strong className="text-neutral-300"><span className="brand-font">guIDE</span> Desktop</strong> — All data (settings, chat history, files) is stored locally on your machine.</li>
                <li><strong className="text-neutral-300">Pocket <span className="brand-font">guIDE</span></strong> — Session data and files are stored in your browser&apos;s local storage and IndexedDB. Nothing is sent to our servers.</li>
                <li><strong className="text-neutral-300">Account data</strong> — Email, hashed password, and subscription status are stored in our database hosted on secure infrastructure.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">6. Third-Party Services</h2>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li><strong className="text-neutral-300">Stripe</strong> — Payment processing. Subject to <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Stripe&apos;s Privacy Policy</a>.</li>
                <li><strong className="text-neutral-300">Google OAuth</strong> — Sign-in authentication. Subject to <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google&apos;s Privacy Policy</a>.</li>
                <li><strong className="text-neutral-300">GitHub OAuth</strong> — Sign-in authentication. Subject to <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub&apos;s Privacy Statement</a>.</li>
                <li><strong className="text-neutral-300">AI Providers</strong> — When using cloud AI, your prompts pass through the selected provider. Each has its own data policy.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">7. Your Rights</h2>
              <p>You can:</p>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li>Request a copy of the personal data we hold about you.</li>
                <li>Request deletion of your account and all associated data.</li>
                <li>Export your data at any time from your account dashboard.</li>
                <li>Opt out of cloud AI entirely by using only local models.</li>
              </ul>
              <p className="mt-4">
                To exercise any of these rights, contact us at{' '}
                <a href="mailto:privacy@graysoft.dev" className="text-accent hover:underline">
                  privacy@graysoft.dev
                </a>{' '}
                or use the <a href="/contact" className="text-accent hover:underline">contact form</a>.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">8. Children&apos;s Privacy</h2>
              <p>
                Our products are not directed at children under 13. We do not knowingly
                collect personal information from children under 13. If you believe a child
                has provided us with personal data, please contact us and we will delete it.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">9. Changes to This Policy</h2>
              <p>
                We may update this privacy policy from time to time. Changes will be posted
                on this page with an updated effective date. Continued use of our products
                after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">10. Contact</h2>
              <p>
                For privacy-related questions or requests, contact GraySoft at:{' '}
                <a href="mailto:privacy@graysoft.dev" className="text-accent hover:underline">
                  privacy@graysoft.dev
                </a>
              </p>
            </section>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
