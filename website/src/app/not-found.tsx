'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';

const DOOM_BUNDLE = 'https://v8.js-dos.com/bundles/doom.jsdos';

// DOSBox KBD enum values (counted from keyboard.h)
const KBD_ESC = 49, KBD_ENTER = 52, KBD_SPACE = 53;
const KBD_LCTRL = 56, KBD_LSHIFT = 58;
const KBD_LEFT = 83, KBD_UP = 84, KBD_DOWN = 85, KBD_RIGHT = 86;
const KBD_COMMA = 72, KBD_PERIOD = 71;

const GP_MAP: Record<number, number> = {
  12: KBD_UP, 13: KBD_DOWN, 14: KBD_LEFT, 15: KBD_RIGHT,
  0: KBD_LCTRL, 2: KBD_SPACE, 1: KBD_LSHIFT, 3: KBD_ENTER,
  4: KBD_COMMA, 5: KBD_PERIOD, 9: KBD_ESC,
};

export default function NotFound() {
  const dosRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/js-dos@8.3.20/dist/js-dos.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/js-dos@8.3.20/dist/js-dos.js';
    script.onload = () => {
      if (!dosRef.current) return;
      let gci: any = null;
      const gps: Record<number, boolean> = {};
      const ax = { u: false, d: false, l: false, r: false };
      const DEAD = 0.35;

      function sk(k: number, p: boolean) {
        if (gci) gci.sendKeyEvent(k, p);
      }

      function poll() {
        requestAnimationFrame(poll);
        if (!gci) return;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) {
          const pad = pads[i];
          if (!pad) continue;
          for (let b = 0; b < pad.buttons.length; b++) {
            const pr = pad.buttons[b].pressed;
            if (pr !== !!gps[b] && GP_MAP[b] !== undefined) {
              sk(GP_MAP[b], pr);
              gps[b] = pr;
            }
          }
          const lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
          const wu = ly < -DEAD, wd = ly > DEAD, wl = lx < -DEAD, wr = lx > DEAD;
          if (wu !== ax.u) { sk(KBD_UP, wu); ax.u = wu; }
          if (wd !== ax.d) { sk(KBD_DOWN, wd); ax.d = wd; }
          if (wl !== ax.l) { sk(KBD_LEFT, wl); ax.l = wl; }
          if (wr !== ax.r) { sk(KBD_RIGHT, wr); ax.r = wr; }
          break;
        }
      }

      (window as any).Dos(dosRef.current, { url: DOOM_BUNDLE, autoStart: true, onEvent: (ev: string, ci: any) => { if (ev === 'ci-ready') { gci = ci; requestAnimationFrame(poll); } } });
    };
    document.body.appendChild(script);
    return () => { try { document.head.removeChild(link); } catch (_) {} };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0c0d10',
      color: '#e2e8f0',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '80px 12px 40px',
    }}>
      <div style={{
        fontSize: '4.5rem',
        fontWeight: 900,
        color: '#a78bfa',
        textShadow: '0 0 40px rgba(167,139,250,.5)',
        marginBottom: '8px',
        lineHeight: 1,
      }}>404</div>
      <p style={{ fontSize: '.85rem', color: '#64748b', marginBottom: '24px', textAlign: 'center' }}>
        Page not found &mdash; play FreeDoom while you&apos;re here
      </p>
      <div style={{ width: '100%', maxWidth: '700px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
        <div
          ref={dosRef}
          style={{ width: '100%', maxWidth: '640px', height: 'min(400px,60vw)', background: '#000', borderRadius: '8px', overflow: 'hidden', border: '2px solid rgba(46,48,56,0.4)' }}
        />
        <p style={{ fontSize: '.75rem', color: '#64748b', fontFamily: 'monospace', textAlign: 'center', padding: '4px 0', maxWidth: '640px' }}>
          Keyboard: Arrows=Move &bull; Ctrl=Shoot &bull; Space=Use &bull; Shift=Run &bull; Esc=Menu<br />
          PS Controller: D-pad=Move &bull; X=Shoot &bull; &#9633;=Use &bull; &#9675;=Run &bull; Start=Menu &bull; R1=Strafe
        </p>
      </div>
      <Link href="/" style={{ color: '#a78bfa', fontSize: '.85rem', textDecoration: 'none' }}>
        &larr; Go Home
      </Link>
    </div>
  );
}