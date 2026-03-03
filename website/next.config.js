/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  output: 'standalone',
  distDir: '.next-ready',
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      // Prevent Cloudflare (and any CDN) from caching the download page.
      // The version number is baked into the static HTML at build time;
      // if Cloudflare caches it users see a stale version number after deploys.
      {
        source: '/download',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Cloudflare-CDN-Cache-Control', value: 'no-store' },
        ],
      },
      // Allow the 404 game page to be embedded in same-origin iframes
      // (not-found.tsx renders the game in an iframe; DENY would block it)
      {
        source: '/404-game.html',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com https://shopsuptight.com https://pagead2.googlesyndication.com https://adservice.google.com https://googleads.g.doubleclick.net https://ep1.adtrafficquality.google https://ep2.adtrafficquality.google",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://api.stripe.com https://accounts.google.com https://github.com https://api.github.com https://www.google-analytics.com https://www.googletagmanager.com https://static.cloudflareinsights.com https://shopsuptight.com https://pagead2.googlesyndication.com https://adservice.google.com https://googleads.g.doubleclick.net https://ep1.adtrafficquality.google https://ep2.adtrafficquality.google",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://shopsuptight.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
