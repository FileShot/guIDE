import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Usage Terms & Conditions',
  description: 'Terms of service for guIDE Desktop and Pocket guIDE by GraySoft.',
  alternates: { canonical: 'https://graysoft.dev/terms' },
};

export default function TermsPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Legal
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Terms of Service
          </h1>
          <p className="text-neutral-400 mb-2">
            Effective: February 15, 2026
          </p>
          <p className="text-neutral-500 text-sm mb-12">
            These terms apply to <span className="brand-font">guIDE</span> Desktop and Pocket <span className="brand-font">guIDE</span> — products by GraySoft.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="prose prose-invert max-w-none space-y-8 text-neutral-300 leading-relaxed">

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">1. Acceptance of Terms</h2>
              <p>
                By downloading, installing, or using any GraySoft product (&ldquo;<span className="brand-font">guIDE</span> Desktop&rdquo;
                or &ldquo;Pocket <span className="brand-font">guIDE</span>&rdquo;), you agree to these Terms
                of Service. If you do not agree, do not use the products.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">2. Products & Services</h2>
              <p>GraySoft provides two products:</p>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li><strong className="text-neutral-300"><span className="brand-font">guIDE</span> Desktop</strong> — A free desktop code editor with native AI capabilities, local LLM inference, and 69+ built-in tools.</li>
                <li><strong className="text-neutral-300">Pocket <span className="brand-font">guIDE</span></strong> — A free browser-based AI agent available at pocket.graysoft.dev.</li>
              </ul>
              <p className="mt-4">
                Both products are free to use. Cloud AI access is available through paid subscription plans.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">3. Accounts</h2>
              <p>
                You may create an account using email/password, Google OAuth, or GitHub OAuth.
                You are responsible for maintaining the security of your account credentials.
                You must be at least 13 years old to create an account.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">4. Pricing & Subscriptions</h2>
              <p>All GraySoft products share a unified pricing model:</p>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li><strong className="text-neutral-300">Free tier</strong> — 30 cloud AI messages per day. Local AI inference is always free and unlimited.</li>
                <li><strong className="text-neutral-300">Pro ($4.99/month)</strong> — 500 cloud AI messages per day, multiple cloud AI providers, and priority support.</li>
                <li><strong className="text-neutral-300">Unlimited ($9.99/month)</strong> — Unlimited cloud AI messages, early access to new features.</li>
              </ul>
              <p className="mt-4">
                Payments are processed by Stripe. Subscriptions renew monthly and can be
                cancelled at any time from your account dashboard. No refunds are provided
                for partial months.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">5. Acceptable Use</h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-6 space-y-2 text-neutral-400">
                <li>Use our products for any illegal purpose.</li>
                <li>Attempt to reverse-engineer, decompile, or extract source code from compiled applications.</li>
                <li>Share, resell, or redistribute your account credentials or API keys.</li>
                <li>Circumvent rate limits, usage quotas, or authentication mechanisms.</li>
                <li>Use automated systems to abuse our API or cloud services.</li>
                <li>Interfere with or disrupt the operation of our services.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">6. Intellectual Property</h2>
              <p>
                GraySoft retains all rights to the <span className="brand-font">guIDE</span> software, branding, and website content.
                Your code, files, and AI-generated content belong to you. We claim no ownership
                over anything you create using our products.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">7. AI-Generated Content</h2>
              <p>
                Our products use AI models to generate responses. AI output may be inaccurate,
                incomplete, or inappropriate. You are responsible for reviewing and validating
                all AI-generated content before use. GraySoft is not liable for any consequences
                resulting from the use of AI-generated output.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">8. Service Availability</h2>
              <p>
                We strive to maintain high availability of our cloud services, but do not
                guarantee uninterrupted access. Local AI features in <span className="brand-font">guIDE</span> Desktop work
                entirely offline and are not affected by service availability.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">9. Limitation of Liability</h2>
              <p>
                GraySoft provides its products &ldquo;as is&rdquo; without warranties of any kind.
                To the maximum extent permitted by law, GraySoft shall not be liable for any
                indirect, incidental, special, or consequential damages arising from your use
                of our products.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">10. Account Termination</h2>
              <p>
                We reserve the right to suspend or terminate accounts that violate these terms.
                You may delete your account at any time from your dashboard or by contacting us.
                Upon deletion, your personal data will be removed from our systems.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">11. Changes to Terms</h2>
              <p>
                We may update these terms from time to time. Changes will be posted on this page
                with an updated effective date. Continued use after changes constitutes acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-white mb-4">12. Contact</h2>
              <p>
                For questions about these terms, contact GraySoft at{' '}
                <a href="mailto:legal@graysoft.dev" className="text-accent hover:underline">
                  legal@graysoft.dev
                </a>{' '}
                or use the <Link href="/contact" className="text-accent hover:underline">contact form</Link>.
              </p>
            </section>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
