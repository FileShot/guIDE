'use client';

import Link from 'next/link';
import { useState } from 'react';
import FadeIn from '@/components/FadeIn';
import { Search, Package, Code, Palette, Wrench, Sparkles, GitBranch, Puzzle, ArrowRight, ExternalLink } from 'lucide-react';

const categories = [
  { id: 'all', label: 'All', icon: Package },
  { id: 'theme', label: 'Themes', icon: Palette },
  { id: 'formatter', label: 'Formatters', icon: Code },
  { id: 'linter', label: 'Linters', icon: Wrench },
  { id: 'language', label: 'Languages', icon: Code },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'snippets', label: 'Snippets', icon: Puzzle },
];

// Initial showcase extensions to demonstrate the format
const showcaseExtensions = [
  {
    id: 'example-dark-theme',
    name: 'Midnight Pro Theme',
    author: 'Community',
    category: 'theme',
    description: 'A deep dark theme with purple accents, designed for long coding sessions.',
    version: '1.0.0',
    featured: true,
  },
  {
    id: 'example-python-snippets',
    name: 'Python Snippets Pack',
    author: 'Community',
    category: 'snippets',
    description: 'Common Python code snippets: list comprehensions, decorators, context managers, and more.',
    version: '1.0.0',
    featured: true,
  },
  {
    id: 'example-react-tools',
    name: 'React Developer Tools',
    author: 'Community',
    category: 'tools',
    description: 'Component hierarchy viewer, hooks inspector, and prop validation for React projects.',
    version: '1.0.0',
    featured: true,
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  theme: 'bg-violet-500/20 text-violet-300',
  formatter: 'bg-blue-500/20 text-blue-300',
  linter: 'bg-amber-500/20 text-amber-300',
  language: 'bg-emerald-500/20 text-emerald-300',
  ai: 'bg-purple-500/20 text-purple-300',
  tools: 'bg-cyan-500/20 text-cyan-300',
  git: 'bg-orange-500/20 text-orange-300',
  snippets: 'bg-pink-500/20 text-pink-300',
};

export default function ExtensionsPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const filtered = showcaseExtensions.filter(ext => {
    const matchesSearch = !search || ext.name.toLowerCase().includes(search.toLowerCase()) || ext.description.toLowerCase().includes(search.toLowerCase());
    const matchesCat = activeCategory === 'all' || ext.category === activeCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">Extensions</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Extend <span className="brand-font">guIDE</span>
          </h1>
          <p className="text-neutral-400 text-lg mb-8 max-w-2xl">
            Browse community-built extensions to add new themes, snippets, tools, and integrations to your editor.
            Or <Link href="/extensions/submit" className="text-accent hover:text-accent-light underline underline-offset-2">submit your own</Link>.
          </p>
        </FadeIn>

        {/* Coming Soon Banner */}
        <FadeIn delay={0.1}>
          <div className="glass-purple rounded-xl p-6 mb-10">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-accent/20 rounded-lg">
                <Package size={24} className="text-accent-light" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Marketplace Launching Soon</h3>
                <p className="text-neutral-400 text-sm">
                  The guIDE extension marketplace is in early development. Below are example extensions showing what&apos;s possible.
                  Want to be among the first contributors?{' '}
                  <Link href="/extensions/submit" className="text-accent-light hover:underline">
                    Learn how to submit an extension &rarr;
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Search + Categories */}
        <FadeIn delay={0.2}>
          <div className="mb-8">
            <div className="relative mb-4">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                placeholder="Search extensions..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-accent text-white'
                      : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                  }`}
                >
                  <cat.icon size={14} />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Extension Cards */}
        <FadeIn delay={0.3}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-12">
            {filtered.map(ext => (
              <div key={ext.id} className="glass-card rounded-xl p-5 hover:border-accent/40 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-accent/10 rounded-lg">
                    <Package size={20} className="text-accent-light" />
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[ext.category] || 'bg-neutral-700 text-neutral-300'}`}>
                    {ext.category}
                  </span>
                </div>
                <h3 className="text-white font-semibold mb-1">{ext.name}</h3>
                <p className="text-neutral-400 text-sm mb-3 line-clamp-2">{ext.description}</p>
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>by {ext.author}</span>
                  <span>v{ext.version}</span>
                </div>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* How to Install */}
        <FadeIn delay={0.4}>
          <div className="glass-card rounded-xl p-8 mb-10">
            <h2 className="text-2xl font-bold text-white mb-4">How to Install Extensions</h2>
            <div className="space-y-4 text-neutral-400">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">1</span>
                <p>Download the extension <code className="text-accent-light bg-neutral-800 px-1.5 py-0.5 rounded text-sm">.zip</code> or <code className="text-accent-light bg-neutral-800 px-1.5 py-0.5 rounded text-sm">.guide-ext</code> file.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">2</span>
                <p>Open guIDE and go to the <strong className="text-white">Extensions</strong> panel in the sidebar (puzzle piece icon).</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">3</span>
                <p>Click <strong className="text-white">Install from File</strong> and select the downloaded extension package.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-accent/20 rounded-full flex items-center justify-center text-accent-light text-sm font-bold">4</span>
                <p>The extension will be extracted, validated, and installed automatically. Toggle it on/off from the Installed tab.</p>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.5}>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-3">Build Your Own Extension</h2>
            <p className="text-neutral-400 mb-6 max-w-lg mx-auto">
              Extensions are simple folders with a <code className="text-accent-light bg-neutral-800 px-1.5 py-0.5 rounded text-sm">manifest.json</code>.
              Learn the format and submit yours to the marketplace.
            </p>
            <Link
              href="/extensions/submit"
              className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-light text-white font-medium rounded-lg transition-colors"
            >
              Submit an Extension
              <ArrowRight size={16} />
            </Link>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
