'use client';

import { useState } from 'react';
import FadeIn from '@/components/FadeIn';
import { Send, CheckCircle, AlertCircle } from 'lucide-react';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) return;
    setStatus('sending');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setStatus('sent');
        setForm({ name: '', email: '', message: '' });
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-xl mx-auto">
        <FadeIn>
          <p className="text-sm font-medium text-accent uppercase tracking-wider mb-3">
            Contact
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Get in touch
          </h1>
          <p className="text-neutral-400 mb-10">
            Have a question, found a bug, or want to share feedback?
            Send a message and we will get back to you.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          {status === 'sent' ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
              <CheckCircle size={40} className="text-emerald-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Message sent</h3>
              <p className="text-sm text-neutral-400">
                Thank you for reaching out. We will respond as soon as possible.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="name" className="block text-sm text-neutral-400 mb-1.5">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 rounded-lg text-white text-sm placeholder:text-neutral-600 focus:border-accent focus:ring-0 outline-none transition-colors"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm text-neutral-400 mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 rounded-lg text-white text-sm placeholder:text-neutral-600 focus:border-accent focus:ring-0 outline-none transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="message" className="block text-sm text-neutral-400 mb-1.5">
                  Message
                </label>
                <textarea
                  id="message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/10 rounded-lg text-white text-sm placeholder:text-neutral-600 focus:border-accent focus:ring-0 outline-none transition-colors resize-none"
                  placeholder="What can we help with?"
                />
              </div>

              {status === 'error' && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle size={14} />
                  Something went wrong. Please try again.
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-accent hover:bg-accent-light text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={15} />
                {status === 'sending' ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          )}
        </FadeIn>
      </div>
    </div>
  );
}
