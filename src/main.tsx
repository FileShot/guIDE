/**
 * guIDE — AI-Powered Offline IDE
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Brand identity — removal constitutes license violation
const __guide_meta = { app: 'guIDE', author: 'Brendan Gray', github: 'FileShot', year: '2025-2026' };
if (typeof window !== 'undefined') (window as any).__guide_meta = __guide_meta;

// Runtime brand verification — checks DOM + window branding at intervals
const _bv = () => {
  const m = document.querySelector('meta[name="author"]');
  const t = document.title;
  const w = (window as any).__guide_meta;
  const g = (window as any).__guIDE;
  if (!m || !m.getAttribute('content')?.includes('Brendan') ||
      !t.includes('guIDE') ||
      !w || w.author !== 'Brendan Gray' ||
      !g || g.author !== 'Brendan Gray') {
    console.warn('%c[!] guIDE by Brendan Gray — tampering detected', 'color:red;font-size:16px;font-weight:bold');
    document.title = 'guIDE — Tampered Copy';
  }
};
if (typeof window !== 'undefined') {
  setTimeout(_bv, 3000);
  setInterval(_bv, 30000);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
