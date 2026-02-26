import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  // Rate limit OAuth initiations: 15 per 15 min per IP
  const rl = checkRateLimit(req, RATE_LIMITS.oauth);
  if (!rl.allowed) {
    const r = rateLimitResponse(rl);
    return NextResponse.json(r.body, { status: r.status, headers: r.headers });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GitHub OAuth not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const returnUrl = searchParams.get('return') || `${process.env.NEXT_PUBLIC_APP_URL}/account`;

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/github/callback`;
  const scope = 'user:email';
  // Generate cryptographically secure state for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');

  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;

  const response = NextResponse.redirect(url);
  // Store state in a secure, short-lived cookie for verification on callback
  response.headers.append('Set-Cookie', `oauth_state_github=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);
  // Store the return URL so callback knows where to send the user
  response.headers.append('Set-Cookie', `oauth_return_github=${encodeURIComponent(returnUrl)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);
  return response;
}
