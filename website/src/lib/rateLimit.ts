import { NextRequest } from 'next/server';

/**
 * In-memory rate limiter for API routes.
 * Tracks requests by IP address with configurable windows and limits.
 * 
 * Since this runs in a single Node.js process (standalone deployment),
 * in-memory tracking is sufficient and performant.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores: Map<string, Map<string, RateLimitEntry>> = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [, store] of stores) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }
}, 5 * 60 * 1000);

/**
 * Get the client IP from the request (respects Cloudflare headers)
 */
export function getClientIp(req: NextRequest): string {
  // Cloudflare puts the real IP here
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  
  return 'unknown';
}

interface RateLimitConfig {
  /** Unique identifier for this limiter (e.g. 'login', 'register') */
  name: string;
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given IP and route.
 * Returns whether the request is allowed.
 */
export function checkRateLimit(req: NextRequest, config: RateLimitConfig): RateLimitResult {
  const ip = getClientIp(req);
  const key = `${config.name}:${ip}`;
  
  if (!stores.has(config.name)) {
    stores.set(config.name, new Map());
  }
  const store = stores.get(config.name)!;
  
  const now = Date.now();
  const entry = store.get(key);
  
  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowSeconds * 1000 });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowSeconds * 1000 };
  }
  
  entry.count++;
  
  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  
  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Pre-configured rate limiters for different API routes
 */
export const RATE_LIMITS = {
  /** Auth: 5 attempts per 15 minutes per IP */
  auth: { name: 'auth', maxRequests: 5, windowSeconds: 15 * 60 },
  /** Registration: 3 per hour per IP */
  register: { name: 'register', maxRequests: 3, windowSeconds: 60 * 60 },
  /** License validation: 10 per minute per IP */
  licenseValidate: { name: 'license-validate', maxRequests: 10, windowSeconds: 60 },
  /** Contact form: 3 per hour per IP */
  contact: { name: 'contact', maxRequests: 3, windowSeconds: 60 * 60 },
  /** Community posts: 5 per 10 minutes per IP */
  community: { name: 'community', maxRequests: 5, windowSeconds: 10 * 60 },
  /** Donations: 5 per hour per IP */
  donate: { name: 'donate', maxRequests: 5, windowSeconds: 60 * 60 },
  /** Analytics: 30 per minute per IP (page views fire fast) */
  analytics: { name: 'analytics', maxRequests: 30, windowSeconds: 60 },
  /** General API: 60 per minute per IP */
  general: { name: 'general', maxRequests: 60, windowSeconds: 60 },
  /** OAuth initiations (GitHub/Google login): 15 per 15 min per IP */
  oauth: { name: 'oauth', maxRequests: 15, windowSeconds: 15 * 60 },
  /** Stripe checkout session creation: 10 per hour per IP */
  checkout: { name: 'checkout', maxRequests: 10, windowSeconds: 60 * 60 },
} as const;

/**
 * Helper that returns a 429 JSON response if rate limited
 */
export function rateLimitResponse(result: RateLimitResult) {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
  return {
    status: 429,
    body: { error: 'Too many requests. Please try again later.', retryAfter },
    headers: {
      'Retry-After': retryAfter.toString(),
      'X-RateLimit-Remaining': '0',
    },
  };
}
