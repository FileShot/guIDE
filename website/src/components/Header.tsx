'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Menu, X, UserCircle } from 'lucide-react';

const navLinks = [
  { href: '/download', label: 'Download' },
  { href: '/models', label: 'Models' },
  { href: '/models/benchmarks', label: 'Benchmarks' },
];

const pocketLink = { href: 'https://pocket.graysoft.dev', label: 'Pocket', external: true };

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Check auth state on mount
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.user) {
          setUser({ name: data.user.name || data.user.email, email: data.user.email });
        }
      })
      .catch(() => {/* not logged in */})
      .finally(() => setAuthChecked(true));
  }, []);

  return (
    <header
      role="banner"
      aria-label="Site header"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-black/80 backdrop-blur-xl border-b border-white/5'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image src="/logo.png" alt="guIDE" width={32} height={32} priority />
          <span className="text-lg font-semibold tracking-tight brand-font">
            <span className="text-white group-hover:text-neutral-300 transition-colors">gu</span>
            <span className="text-accent">IDE</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8" role="navigation" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-neutral-400 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={pocketLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent hover:text-accent-light transition-colors flex items-center gap-1"
          >
            {pocketLink.label}
            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        </nav>

        {/* Desktop Auth â€” only render after auth check to prevent flash */}
        <div className="hidden md:flex items-center gap-3">
          {authChecked && (
            user ? (
              /* Logged in: show Account button */
              <Link
                href="/account"
                className="flex items-center gap-2 text-sm px-4 py-2 bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 text-white rounded-lg font-medium transition-all"
              >
                <UserCircle size={15} className="text-accent" />
                Account
              </Link>
            ) : (
              /* Logged out */
              <>
                <Link
                  href="/login"
                  className="text-sm text-neutral-400 hover:text-white transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="text-sm px-4 py-2 bg-accent hover:bg-accent-light text-white rounded-lg font-medium transition-all hover:shadow-[0_0_20px_rgba(0,122,204,0.25)]"
                >
                  Get Started
                </Link>
              </>
            )
          )}
        </div>

        {/* Mobile Toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-neutral-400 hover:text-white p-1"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-black/95 backdrop-blur-xl border-t border-white/5">
          <nav className="flex flex-col px-6 py-4 gap-1" role="navigation" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-sm text-neutral-400 hover:text-white py-2.5 transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={pocketLink.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileOpen(false)}
              className="text-sm text-accent hover:text-accent-light py-2.5 transition-colors flex items-center gap-1.5"
            >
              {pocketLink.label}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">WEB</span>
            </a>
            <div className="border-t border-white/5 my-2" />
            {authChecked && (
              user ? (
                <Link
                  href="/account"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 text-sm text-white py-2.5 transition-colors"
                >
                  <UserCircle size={15} className="text-accent" />
                  Account
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setMobileOpen(false)}
                    className="text-sm text-neutral-400 hover:text-white py-2.5 transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setMobileOpen(false)}
                    className="text-sm px-4 py-2.5 bg-accent hover:bg-accent-light text-white rounded-lg font-medium text-center transition-colors mt-1"
                  >
                    Get Started
                  </Link>
                </>
              )
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
