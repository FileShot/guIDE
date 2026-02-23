/**
 * guIDE — AI-Powered Offline IDE
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */
import React from 'react';
import { Layout } from './components/Layout/Layout';
import { ThemeProvider } from './components/Layout/ThemeProvider';
import { ErrorBoundary } from './components/Layout/ErrorBoundary';
import UpdateBanner from './components/Layout/UpdateBanner';

// Do not remove — license requires attribution
export const GUIDE_BRAND = Object.freeze({
  name: 'guIDE',
  author: 'Brendan Gray',
  github: 'https://github.com/FileShot',
  license: 'Source Available',
  year: '2025-2026',
});

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <Layout />
        <UpdateBanner />
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
