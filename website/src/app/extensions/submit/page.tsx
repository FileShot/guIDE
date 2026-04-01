'use client';

import Link from 'next/link';
import FadeIn from '@/components/FadeIn';
import { Package, FileJson, FolderTree, Upload, ArrowLeft, Code, CheckCircle, AlertCircle } from 'lucide-react';

export default function SubmitExtensionPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <FadeIn>
          <Link href="/extensions" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white mb-6 transition-colors">
            <ArrowLeft size={14} />
            Back to Extensions
          </Link>
        </FadeIn>

        {/* Header */}
        <FadeIn delay={0.05}>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">Submit</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Build &amp; Submit an Extension
          </h1>
          <p className="text-neutral-400 text-lg mb-10 max-w-2xl">
            guIDE extensions are simple folder-based packages. Create a <code className="text-accent-light bg-neutral-800 px-1.5 py-0.5 rounded text-sm">manifest.json</code>,
            package your code, and share it with the community.
          </p>
        </FadeIn>

        {/* Extension Format */}
        <FadeIn delay={0.1}>
          <div className="glass-card rounded-xl p-8 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-accent/20 rounded-lg">
                <FolderTree size={20} className="text-accent-light" />
              </div>
              <h2 className="text-xl font-bold text-white">Extension Structure</h2>
            </div>
            <div className="bg-neutral-900 rounded-lg p-5 font-mono text-sm text-neutral-300 mb-4">
              <pre className="whitespace-pre">{`my-extension/
├── manifest.json        ← Required
├── main.js              ← Entry point (optional)
├── styles/
│   └── theme.css        ← Custom styles (optional)
├── snippets/
│   └── snippets.json    ← Code snippets (optional)
└── README.md            ← Description (optional)`}</pre>
            </div>
            <p className="text-neutral-400 text-sm">
              The only required file is <code className="text-accent-light bg-neutral-800 px-1 py-0.5 rounded text-xs">manifest.json</code>.
              Everything else depends on what your extension does.
            </p>
          </div>
        </FadeIn>

        {/* manifest.json */}
        <FadeIn delay={0.15}>
          <div className="glass-card rounded-xl p-8 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-accent/20 rounded-lg">
                <FileJson size={20} className="text-accent-light" />
              </div>
              <h2 className="text-xl font-bold text-white">manifest.json</h2>
            </div>
            <div className="bg-neutral-900 rounded-lg p-5 font-mono text-sm text-neutral-300 mb-4 overflow-x-auto">
              <pre className="whitespace-pre">{`{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A brief description of what this extension does.",
  "author": "Your Name",
  "category": "tools",
  "icon": "icon.png",
  "main": "main.js",
  "homepage": "https://github.com/you/my-extension",
  "repository": "https://github.com/you/my-extension"
}`}</pre>
            </div>

            <h3 className="text-white font-semibold mb-3">Required Fields</h3>
            <div className="space-y-2 mb-6">
              {[
                { field: 'id', desc: 'Unique identifier (lowercase, hyphens allowed). Must be globally unique.' },
                { field: 'name', desc: 'Display name shown in the Extensions panel.' },
                { field: 'version', desc: 'Semantic version (e.g. 1.0.0, 1.2.3).' },
              ].map(({ field, desc }) => (
                <div key={field} className="flex items-start gap-2">
                  <CheckCircle size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-neutral-300">
                    <code className="text-accent-light bg-neutral-800 px-1 py-0.5 rounded text-xs">{field}</code> — {desc}
                  </p>
                </div>
              ))}
            </div>

            <h3 className="text-white font-semibold mb-3">Optional Fields</h3>
            <div className="space-y-2">
              {[
                { field: 'description', desc: 'Short description shown in the marketplace.' },
                { field: 'author', desc: 'Your name or organization.' },
                { field: 'category', desc: 'One of: theme, formatter, linter, language, ai, tools, git, snippets, other.' },
                { field: 'icon', desc: 'Path to an icon image (relative to extension root). Displayed in the UI.' },
                { field: 'main', desc: 'JavaScript entry point if your extension has runtime behavior.' },
                { field: 'homepage', desc: 'URL to your extension\'s homepage or documentation.' },
                { field: 'repository', desc: 'URL to the source code repository.' },
              ].map(({ field, desc }) => (
                <div key={field} className="flex items-start gap-2">
                  <Code size={14} className="text-neutral-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-neutral-400">
                    <code className="text-accent-light bg-neutral-800 px-1 py-0.5 rounded text-xs">{field}</code> — {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Categories */}
        <FadeIn delay={0.2}>
          <div className="glass-card rounded-xl p-8 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Extension Categories</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { id: 'theme', label: 'Themes', desc: 'Color schemes, icon packs' },
                { id: 'formatter', label: 'Formatters', desc: 'Code formatting tools' },
                { id: 'linter', label: 'Linters', desc: 'Code quality analysis' },
                { id: 'language', label: 'Languages', desc: 'Syntax, autocomplete' },
                { id: 'ai', label: 'AI', desc: 'AI-powered features' },
                { id: 'tools', label: 'Tools', desc: 'Developer utilities' },
                { id: 'git', label: 'Git', desc: 'Version control tools' },
                { id: 'snippets', label: 'Snippets', desc: 'Code templates' },
                { id: 'other', label: 'Other', desc: 'Everything else' },
              ].map(cat => (
                <div key={cat.id} className="bg-neutral-800/50 rounded-lg p-3">
                  <p className="text-white text-sm font-medium">{cat.label}</p>
                  <p className="text-neutral-500 text-xs">{cat.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Packaging */}
        <FadeIn delay={0.25}>
          <div className="glass-card rounded-xl p-8 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-accent/20 rounded-lg">
                <Package size={20} className="text-accent-light" />
              </div>
              <h2 className="text-xl font-bold text-white">Package Your Extension</h2>
            </div>
            <div className="space-y-4 text-neutral-400 text-sm">
              <p>
                Zip your extension folder into a <code className="text-accent-light bg-neutral-800 px-1 py-0.5 rounded text-xs">.zip</code> file.
                The manifest.json should be either in the root of the zip, or inside a single top-level folder.
              </p>
              <div className="bg-neutral-900 rounded-lg p-4 font-mono text-xs">
                <p className="text-neutral-500 mb-1"># From your extension directory:</p>
                <p className="text-emerald-300">zip -r my-extension.zip .</p>
                <p className="text-neutral-500 mt-3 mb-1"># Or on Windows (PowerShell):</p>
                <p className="text-emerald-300">Compress-Archive -Path * -DestinationPath my-extension.zip</p>
              </div>
              <p>
                You can also rename <code className="text-accent-light bg-neutral-800 px-1 py-0.5 rounded text-xs">.zip</code> to{' '}
                <code className="text-accent-light bg-neutral-800 px-1 py-0.5 rounded text-xs">.guide-ext</code> for a cleaner file extension.
                Both formats are accepted.
              </p>
            </div>
          </div>
        </FadeIn>

        {/* How to Submit */}
        <FadeIn delay={0.3}>
          <div className="glass-purple rounded-xl p-8 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-accent/20 rounded-lg">
                <Upload size={24} className="text-accent-light" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Submit to the Marketplace</h2>
                <p className="text-neutral-400 text-sm mt-1">Three ways to share your extension:</p>
              </div>
            </div>
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">1</span>
                <div>
                  <p className="text-white font-medium mb-1">GitHub Pull Request</p>
                  <p className="text-neutral-400 text-sm">
                    Fork the{' '}
                    <a href="https://github.com/FileShot/guide-extensions" target="_blank" rel="noopener noreferrer" className="text-accent-light hover:underline">
                      guide-extensions
                    </a>{' '}
                    repository, add your extension folder, and open a PR. We&apos;ll review and publish it.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">2</span>
                <div>
                  <p className="text-white font-medium mb-1">Email Submission</p>
                  <p className="text-neutral-400 text-sm">
                    Send your packaged extension to{' '}
                    <a href="mailto:extensions@graysoft.dev" className="text-accent-light hover:underline">extensions@graysoft.dev</a>.
                    Include a brief description and any setup instructions.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">3</span>
                <div>
                  <p className="text-white font-medium mb-1">Community Forum</p>
                  <p className="text-neutral-400 text-sm">
                    Share your extension in the{' '}
                    <Link href="/community" className="text-accent-light hover:underline">community discussions</Link>.
                    Other users can download and install it directly from there.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Guidelines */}
        <FadeIn delay={0.35}>
          <div className="glass-card rounded-xl p-8 mb-10">
            <h2 className="text-xl font-bold text-white mb-4">Submission Guidelines</h2>
            <div className="space-y-2">
              {[
                'Extensions must include a valid manifest.json with at minimum id, name, and version.',
                'No malicious code, data collection, or network requests without user consent.',
                'Keep your extension focused — do one thing well.',
                'Include a README.md with usage instructions.',
                'Use semantic versioning (major.minor.patch).',
                'Test your extension in guIDE before submitting.',
              ].map((rule, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-neutral-400 text-sm">{rule}</p>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.4}>
          <div className="text-center">
            <Link
              href="/extensions"
              className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-medium rounded-lg transition-colors"
            >
              <ArrowLeft size={16} />
              Browse Extensions
            </Link>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
