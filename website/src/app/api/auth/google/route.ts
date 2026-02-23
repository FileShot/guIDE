import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const returnUrl = searchParams.get('return') || `${process.env.NEXT_PUBLIC_APP_URL}/account`;

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;
  const scope = encodeURIComponent('openid email profile');
  // Generate cryptographically secure state for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=select_account`;

  const response = NextResponse.redirect(url);
  // Store state in a secure, short-lived cookie for verification on callback
  response.headers.append('Set-Cookie', `oauth_state_google=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);
  // Store the return URL so callback knows where to send the user
  response.headers.append('Set-Cookie', `oauth_return_google=${encodeURIComponent(returnUrl)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);
  return response;
}
