import { NextRequest, NextResponse } from 'next/server';
import { trackEvent } from '@/lib/db';
import crypto from 'crypto';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + '_graysoft_salt').digest('hex').slice(0, 16);
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 30 tracking events per minute per IP
    const rl = checkRateLimit(request, RATE_LIMITS.analytics);
    if (!rl.allowed) {
      return NextResponse.json({ ok: true }); // Silently drop, don't reveal rate limiting
    }

    const body = await request.json();
    const { type, page, platform, referrer } = body;

    if (!type || !['page_view', 'download', 'signup', 'purchase'].includes(type)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }

    // Get IP for unique visitor tracking (hashed for privacy)
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const ip_hash = hashIp(ip);

    const ua = request.headers.get('user-agent') || undefined;

    trackEvent(type, {
      page,
      platform,
      referrer: referrer || undefined,
      ip_hash,
      user_agent: ua,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to track event' }, { status: 500 });
  }
}
