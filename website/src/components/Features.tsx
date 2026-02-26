'use client';

import { useState } from 'react';
import FadeIn from './FadeIn';
import {
  Cpu, Globe, Terminal, Code2, Brain, Shield,
  Mic, GitBranch, Monitor, Zap, Database, Layout,
} from 'lucide-react';

const tabs = [
  {
    id: 'ai',
    label: 'AI Engine',
    features: [
      {
        icon: <Cpu size={22} />,
        title: 'Local LLM Inference',
        description: 'Run AI models directly on your GPU or CPU. Your code never leaves your machine.',
      },
      {
        icon: <Brain size={22} />,
        title: 'Agentic AI Loop',
        description: 'Autonomous multi-step task execution. Plans, calls tools, evaluates results, and iterates.',
      },
      {
        icon: <Database size={22} />,
        title: 'RAG Context',
        description: 'Indexes your codebase for smarter, context-aware AI responses.',
      },
    ],
  },
  {
    id: 'tools',
    label: 'Built-in Tools',
    features: [
      {
        icon: <Terminal size={22} />,
        title: '82 Native Tools',
        description: 'File management, browser automation, git operations, memory, and web search — all built in.',,
      },
      {
        icon: <Globe size={22} />,
        title: 'Browser Automation',
        description: 'Embedded Chromium with Playwright-powered automation for testing and scraping.',
      },
      {
        icon: <Code2 size={22} />,
        title: 'Code Runner',
        description: 'Execute code in 50+ languages without leaving the editor. Instant feedback.',
      },
    ],
  },
  {
    id: 'editor',
    label: 'Editor',
    features: [
      {
        icon: <Layout size={22} />,
        title: 'Monaco Editor',
        description: 'VS Code-grade editing with full syntax highlighting, IntelliSense, and multi-language support.',
      },
      {
        icon: <GitBranch size={22} />,
        title: 'Git Integration',
        description: 'Built-in version control with staging, commits, diffs, and branch management.',
      },
      {
        icon: <Mic size={22} />,
        title: 'Voice Input',
        description: 'Whisper-powered speech recognition. Talk to your AI assistant hands-free.',
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    features: [
      {
        icon: <Zap size={22} />,
        title: '26 Cloud Providers',
        description: 'OpenAI, Anthropic, Gemini, xAI, Groq, Mistral, Cohere, DeepSeek, Perplexity, and more — use any or go fully offline.',,
      },
      {
        icon: <Monitor size={22} />,
        title: 'Hardware-Aware',
        description: 'Detects your GPU and recommends optimal models for your hardware.',
      },
      {
        icon: <Shield size={22} />,
        title: 'Privacy First',
        description: 'With local models, your code never touches external servers. Air-gap capable.',
      },
    ],
  },
];

export default function Features() {
  const [activeTab, setActiveTab] = useState('ai');
  const currentTab = tabs.find(t => t.id === activeTab) || tabs[0];

  return (
    <section id="features" className="py-28 px-6">
      <div className="max-w-6xl mx-auto">
        <FadeIn>
          <div className="text-center mb-12">
            <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
              Features
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Everything you need. Nothing you don&apos;t.
            </h2>
            <p className="text-neutral-400 max-w-xl mx-auto">
              A complete AI-powered development environment with no rate limits,
              no subscriptions, and no compromises.
            </p>
          </div>
        </FadeIn>

        {/* Tabs */}
        <FadeIn delay={0.1}>
          <div className="flex justify-center mb-10">
            <div className="inline-flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 sm:px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ${
                    activeTab === tab.id
                      ? 'bg-accent text-white shadow-lg shadow-accent/20'
                      : 'text-neutral-500 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* Features for active tab */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {currentTab.features.map((feature, i) => (
            <FadeIn key={feature.title} delay={i * 0.08}>
              <div className="group p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-accent/30 hover:bg-white/[0.04] transition-all duration-300 h-full">
                <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                  {feature.icon}
                </div>
                <h3 className="text-base font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Summary stats */}
        <FadeIn delay={0.3}>
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { value: '82', label: 'Built-in Tools' },
              { value: '50+', label: 'Languages' },
              { value: '26', label: 'Cloud Providers' },
              { value: '100%', label: 'Offline Capable' },
            ].map((stat) => (
              <div key={stat.label} className="text-center p-4 rounded-xl border border-white/[0.04] bg-white/[0.015]">
                <div className="text-2xl font-bold text-accent mb-1">{stat.value}</div>
                <div className="text-xs text-neutral-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
