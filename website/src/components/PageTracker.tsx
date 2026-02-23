'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export default function PageTracker() {
  const pathname = usePathname();
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    // Only track once per path change
    if (tracked.current === pathname) return;
    tracked.current = pathname;

    // Small delay to avoid tracking bot prefetches
    const timer = setTimeout(() => {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'page_view',
          page: pathname,
          referrer: document.referrer || undefined,
        }),
      }).catch(() => {}); // Fail silently
    }, 300);

    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
