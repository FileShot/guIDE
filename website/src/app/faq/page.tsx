import type { Metadata } from 'next';
import FadeIn from '@/components/FadeIn';

export const metadata: Metadata = {
  title: 'FAQ — Common Questions About the AI IDE',
  description: 'Frequently asked questions about guIDE — setup, GPU requirements, supported models, privacy, pricing, and how it compares to Cursor and Windsurf.',
  alternates: { canonical: 'https://graysoft.dev/faq' },
};

const faqs = [
  {
    q: 'What is guIDE?',
    a: 'guIDE is a desktop code editor with native AI capabilities. It combines a VS Code-grade Monaco editor with local LLM inference, 69 built-in tools, browser automation, and everything else you need for AI-assisted development — all in a single application with no extensions required.',
  },
  {
    q: 'Do I need a GPU?',
    a: 'No, but it helps. guIDE supports both GPU (CUDA, Vulkan) and CPU inference. With a modern NVIDIA GPU, you will get significantly faster AI responses, but the editor works fine with CPU-only inference using smaller models. guIDE automatically detects your hardware and recommends appropriate models.',
  },
  {
    q: 'What AI models does it support?',
    a: 'guIDE runs GGUF-format models locally via node-llama-cpp, including popular models like Qwen, Llama, Mistral, and DeepSeek. It also supports cloud providers including Google Gemini, OpenRouter, OpenAI, Anthropic, Cerebras, SambaNova, and xAI — many with free tiers.',
  },
  {
    q: 'Is my code private?',
    a: 'When using local models, your code never leaves your machine. Completely air-gapped. When using cloud providers, standard API data policies apply. You choose which mode to use on a per-conversation basis.',
  },
  {
    q: 'What programming languages are supported?',
    a: 'The Monaco editor supports syntax highlighting for 80+ languages. The built-in code runner can execute code in 50+ languages including Python, JavaScript, TypeScript, Go, Rust, C/C++, Java, Ruby, and more — without any additional configuration.',
  },
  {
    q: 'How is this different from VS Code with extensions?',
    a: 'In VS Code, every AI capability requires a separately installed, separately configured, and separately updated extension. In guIDE, everything is built in and works together natively — the AI can directly control the file explorer, browser, terminal, and editor without extension API limitations.',
  },
  {
    q: 'What is included in the license?',
    a: 'guIDE Desktop is completely free to download and use, with 30 cloud AI messages per day included. For more cloud AI usage, Pro is $4.99/mo (500 messages/day) and Unlimited is $9.99/mo. Local AI inference is always free and unlimited. These plans work across guIDE Desktop and Pocket guIDE.',
  },
  {
    q: 'Can I try it before buying?',
    a: 'Yes. guIDE is free to download. You can explore the interface and features before purchasing a license to activate the full product.',
  },
  {
    q: 'Can I use it on multiple machines?',
    a: 'Each license is bound to one machine at a time. You can deactivate and reactivate on a different machine through your account dashboard.',
  },
  {
    q: 'What operating systems are supported?',
    a: 'guIDE currently supports Windows 10 and later. Linux is also available. macOS support is planned for a future release.',
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.a,
    },
  })),
};

export default function FAQPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            FAQ
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Frequently asked questions
          </h1>
          <p className="text-neutral-400 mb-12">
            Everything you need to know about guIDE.
          </p>
        </FadeIn>

        <div className="space-y-0">
          {faqs.map((faq, i) => (
            <FadeIn key={i} delay={i * 0.03}>
              <div className="border-b border-white/5 py-8 first:pt-0">
                <h3 className="text-base font-semibold text-white mb-3">
                  {faq.q}
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  {faq.a}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </div>
  );
}
