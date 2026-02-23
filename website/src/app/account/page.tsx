'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FadeIn from '@/components/FadeIn';
import { Key, Copy, Check, LogOut, CreditCard, User, Shield, Loader2, Cloud, Smartphone, Trash2, ExternalLink } from 'lucide-react';

interface UserData {
  id: number;
  email: string;
  name: string | null;
  created_at: string;
  license: {
    license_key: string;
    plan: string;
    status: string;
    machine_id: string | null;
    created_at: string;
  } | null;
  hasPurchased: boolean;
}

interface PocketSession {
  id: number;
  session_id: string;
  name: string;
  created_at: string;
  last_active: string;
  storage_used: number;
}

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [pocketSessions, setPocketSessions] = useState<PocketSession[]>([]);
  const [pocketLoading, setPocketLoading] = useState(true);

  useEffect(() => {
    // Strip guide_token from URL for security (desktop app reads it before page loads)
    if (typeof window !== 'undefined' && window.location.search.includes('guide_token=')) {
      window.history.replaceState({}, '', '/account');
    }
    fetchUser();
    fetchPocketSessions();
  }, []);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
      } else {
        router.push('/login');
      }
    } catch {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const fetchPocketSessions = async () => {
    try {
      const res = await fetch('https://pocket.graysoft.dev/api/account/sessions', {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.sessions) {
        setPocketSessions(data.sessions);
      }
    } catch {
      // Pocket guIDE may not be available
    } finally {
      setPocketLoading(false);
    }
  };

  const deletePocketSession = async (sessionId: string) => {
    try {
      await fetch('https://pocket.graysoft.dev/api/account/sessions', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      setPocketSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const handleBuyLicense = async (plan?: string) => {
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan || 'pro' }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setCheckoutLoading(false);
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="pt-24 pb-20 px-6 min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-neutral-500" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-2xl mx-auto">
        <FadeIn>
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="text-3xl font-bold text-white">Account</h1>
              <p className="text-sm text-neutral-400 mt-1">
                Manage your guIDE license and account
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-neutral-500 hover:text-white transition-colors"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </FadeIn>

        {/* Profile */}
        <FadeIn delay={0.05}>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-5">
            <div className="flex items-center gap-3 mb-4">
              <User size={16} className="text-neutral-500" />
              <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
                Profile
              </h2>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Email</span>
                <span className="text-white">{user.email}</span>
              </div>
              {user.name && (
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Name</span>
                  <span className="text-white">{user.name}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Member since</span>
                <span className="text-white">
                  {new Date(user.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* License */}
        <FadeIn delay={0.1}>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-5">
            <div className="flex items-center gap-3 mb-4">
              <Key size={16} className="text-neutral-500" />
              <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
                License
              </h2>
            </div>

            {user.license ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-emerald-500" />
                  <span className="text-sm text-emerald-400 font-medium">Active</span>
                </div>

                <div className="bg-black/30 rounded-lg p-4 border border-white/[0.04]">
                  <p className="text-xs text-neutral-500 mb-2">License Key</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-white font-mono flex-1 select-all">
                      {user.license.license_key}
                    </code>
                    <button
                      onClick={() => copyKey(user.license!.license_key)}
                      className="p-1.5 text-neutral-500 hover:text-white transition-colors"
                      title="Copy license key"
                    >
                      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Plan</span>
                    <span className="text-white capitalize">{user.license.plan}</span>
                  </div>
                  {user.license.machine_id && (
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Bound to machine</span>
                      <span className="text-white font-mono text-xs">
                        {user.license.machine_id.substring(0, 12)}...
                      </span>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/5 pt-4 mt-4">
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    Enter this key in guIDE under Settings &rarr; License, or sign in
                    with your account email and password directly from the app.
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-neutral-400 mb-1">
                  You&apos;re on the <span className="text-white font-medium">Free</span> plan
                </p>
                <p className="text-xs text-neutral-500 mb-5">
                  30 cloud AI messages/day. Local AI is always free &amp; unlimited.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    onClick={() => handleBuyLicense('pro')}
                    disabled={checkoutLoading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-light text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 hover:shadow-[0_0_25px_rgba(0,122,204,0.25)]"
                  >
                    <CreditCard size={16} />
                    {checkoutLoading ? 'Redirecting...' : 'Upgrade to Pro — $4.99/mo'}
                  </button>
                  <button
                    onClick={() => handleBuyLicense('unlimited')}
                    disabled={checkoutLoading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-accent to-amber-400 hover:opacity-90 text-black rounded-lg font-semibold text-sm transition-all disabled:opacity-50"
                  >
                    <CreditCard size={16} />
                    {checkoutLoading ? 'Redirecting...' : 'Unlimited — $9.99/mo'}
                  </button>
                </div>
                <p className="text-xs text-neutral-600 mt-3">
                  Plans work across guIDE Desktop &amp; Pocket guIDE. Cancel anytime.
                </p>
              </div>
            )}
          </div>
        </FadeIn>

        {/* Pocket guIDE — Cloud Sessions */}
        <FadeIn delay={0.15}>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-5">
            <div className="flex items-center gap-3 mb-4">
              <Cloud size={16} className="text-neutral-500" />
              <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
                Pocket guIDE &mdash; Cloud Sessions
              </h2>
              <a
                href="https://pocket.graysoft.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-accent hover:underline flex items-center gap-1"
              >
                Open Pocket guIDE <ExternalLink size={10} />
              </a>
            </div>

            {pocketLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 size={16} className="animate-spin text-neutral-500" />
              </div>
            ) : pocketSessions.length === 0 ? (
              <div className="text-center py-4">
                <Smartphone size={20} className="text-neutral-600 mx-auto mb-2" />
                <p className="text-sm text-neutral-500">No cloud sessions yet</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Start a session at{' '}
                  <a
                    href="https://pocket.graysoft.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    pocket.graysoft.dev
                  </a>
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pocketSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/[0.04]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        {session.name || 'Untitled Session'}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Last active{' '}
                        {new Date(session.last_active).toLocaleDateString()}
                        {' · '}
                        {(session.storage_used / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <button
                      onClick={() => deletePocketSession(session.session_id)}
                      className="p-1.5 text-neutral-600 hover:text-red-400 transition-colors"
                      title="Delete session"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FadeIn>

        {/* Quick Start */}
        {user.license && (
          <FadeIn delay={0.15}>
            <div className="rounded-xl border border-accent/20 bg-accent/[0.03] p-6">
              <h3 className="text-sm font-semibold text-white mb-3">
                Activate guIDE
              </h3>
              <ol className="space-y-2 text-sm text-neutral-400">
                <li className="flex gap-2">
                  <span className="text-accent font-mono text-xs">1.</span>
                  <Link href="/download" className="text-accent hover:underline">
                    Download and install guIDE
                  </Link>
                </li>
                <li className="flex gap-2">
                  <span className="text-accent font-mono text-xs">2.</span>
                  Open the app and click the settings icon in the chat panel
                </li>
                <li className="flex gap-2">
                  <span className="text-accent font-mono text-xs">3.</span>
                  Scroll to the License section and sign in with your account, or paste your key
                </li>
              </ol>
            </div>
          </FadeIn>
        )}
      </div>
    </div>
  );
}
