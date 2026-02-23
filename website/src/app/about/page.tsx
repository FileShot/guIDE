import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';

export const metadata: Metadata = {
  title: 'About Us — The Vision for AI-Native Development',
  description: 'Learn about GraySoft and the story behind guIDE — the first truly native LLM-powered IDE built for offline, private, unlimited AI coding.',
  alternates: { canonical: 'https://graysoft.dev/about' },
};

export default function AboutPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            About
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-8">
            Why guIDE exists
          </h1>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="prose prose-invert max-w-none space-y-6 text-neutral-300 leading-relaxed">
            <p className="text-lg">
              I was hitting rate limits on my $20/month Cursor subscription at 2am,
              mid-debug, with a deadline. The AI chat told me I&apos;d used too many
              &ldquo;premium&rdquo; requests and to try again later.
            </p>
            <p className="text-lg">
              That&apos;s when I decided to build guIDE.
            </p>

            <h2 className="text-2xl font-semibold text-white mt-12 mb-4">
              The Problem
            </h2>
            <p>
              The current generation of AI coding tools &mdash; Cursor, Windsurf,
              GitHub Copilot &mdash; all share the same model: pay a monthly
              subscription, send your code to their servers, and hope you don&apos;t
              hit your usage cap at the worst possible time.
            </p>
            <p>
              Rate limits are real. Hit your &ldquo;fast request&rdquo; quota and
              you&apos;re throttled to slower models or locked out entirely. For
              developers working long hours on real projects, this isn&apos;t a minor
              inconvenience &mdash; it&apos;s a workflow-breaking interruption.
            </p>
            <p>
              And privacy? Every keystroke, every file, every prompt goes through
              someone else&apos;s infrastructure. If you&apos;re working on proprietary
              code, a government project, or anything under NDA, that&apos;s a
              non-starter.
            </p>

            <h2 className="text-2xl font-semibold text-white mt-12 mb-4">
              Why Not Continue.dev or an Extension?
            </h2>
            <p>
              Continue.dev and similar tools are VS Code extensions that bolt AI
              onto an existing editor. They&apos;re useful, but they&apos;re limited
              by what the extension API allows. They can&apos;t control the browser,
              can&apos;t manage files natively, can&apos;t run code in 50+ languages,
              can&apos;t do hardware-aware model selection.
            </p>
            <p>
              guIDE isn&apos;t an extension. It&apos;s a complete IDE built from
              the ground up with AI as a first-class citizen. Every tool &mdash; file
              management, browser automation, git operations, web search, persistent
              memory, code execution &mdash; is integrated directly into the AI&apos;s
              toolkit. 69 tools, zero configuration.
            </p>

            <h2 className="text-2xl font-semibold text-white mt-12 mb-4">
              The Solution
            </h2>
            <p>
              guIDE runs large language models directly on your GPU or CPU. No rate
              limits. No throttling. No &ldquo;try again in 30 minutes.&rdquo; Your
              hardware, your AI, your rules.
            </p>
            <p>
              Want cloud providers too? guIDE supports 17 providers including Google
              Gemini, OpenAI, Anthropic, SambaNova, Cerebras, OpenRouter, xAI, Groq,
              Together, Fireworks, NVIDIA, Cohere, Mistral, Hugging Face, and more &mdash;
              with automatic fallback if one provider is down. Use local models for
              privacy, cloud models for capability, or both.
            </p>
            <p>
              Free to download and use. Pro plans available for more cloud AI messages.
            </p>

            <h2 className="text-2xl font-semibold text-white mt-12 mb-4">
              Built for Real Work
            </h2>
            <p>
              guIDE isn&apos;t a toy or a demo. It&apos;s designed for developers who
              want AI assistance without compromising on privacy, control, or
              reliability. Whether you&apos;re debugging a production issue at 3am,
              prototyping an idea, or automating a repetitive task, guIDE provides
              the tools to get it done &mdash; without waiting for a rate limit to
              reset.
            </p>

            <h2 className="text-2xl font-semibold text-white mt-12 mb-4">
              Pocket guIDE &mdash; The Web Version
            </h2>
            <p>
              Not everyone has a powerful GPU or wants to install desktop software.
              That&apos;s why we built{' '}
              <a
                href="https://pocket.graysoft.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Pocket guIDE
              </a>
              {' '}&mdash; the full agentic AI experience running directly in your browser.
            </p>
            <p>
              Pocket guIDE gives you 6 cloud AI models, 19 agent tools including
              Playwright browser automation, a Monaco code editor, file management,
              command execution, web search, and voice input &mdash; all without
              downloading a thing. Think of it as ChatGPT, but it&apos;s actually an
              agent that creates files, runs commands, and browses the web for you.
            </p>
            <p>
              It&apos;s free to start with 10 MB of storage, no account required.
              Sign in with your GraySoft account to sync sessions across devices
              and unlock additional storage.
            </p>

            <div className="border-t border-white/5 mt-12 pt-8">
              <p className="text-sm text-neutral-500">
                guIDE is created and maintained by Brendan Gray &mdash; an independent
                developer who got tired of paying monthly to be told &ldquo;slow down.&rdquo;
              </p>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
