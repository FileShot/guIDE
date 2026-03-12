import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, createOAuthUser } from '@/lib/db';
import { signToken, createAuthCookieHeader } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=no_code`);
    }

    // Verify CSRF state parameter
    const storedState = req.cookies.get('oauth_state_google')?.value;
    if (!state || !storedState || state !== storedState) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=csrf_failed`);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[Google OAuth] Token exchange failed:', tokenData);
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=token_failed`);
    }

    // Get user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoRes.json();

    if (!userInfo.email) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=no_email`);
    }

    // Find or create user
    let user = getUserByEmail(userInfo.email);
    if (!user) {
      const created = createOAuthUser(userInfo.email, userInfo.name);
      user = { id: created.id, email: created.email, password_hash: '', name: created.name, stripe_customer_id: null, created_at: new Date().toISOString() };
    }

    // Sign JWT
    const token = signToken({ userId: user.id, email: user.email });

    // Resolve return URL (stored during OAuth initiation via ?return= param).
    // Validates against trusted hostnames to prevent open redirect attacks.
    // Always include guide_token: Electron desktop app reads it from the URL;
    // pocket.graysoft.dev ignores it; /account strips it on load for security.
    const returnCookie = req.cookies.get('oauth_return_google')?.value;
    let finalBase = `${process.env.NEXT_PUBLIC_APP_URL}/account`;
    if (returnCookie) {
      try {
        const decoded = decodeURIComponent(returnCookie);
        const parsed = new URL(decoded);
        const trustedHosts = ['graysoft.dev', 'pocket.graysoft.dev', 'www.graysoft.dev'];
        if (trustedHosts.includes(parsed.hostname)) {
          finalBase = decoded.split('?')[0]; // strip any existing query string
        }
      } catch {
        // invalid URL — fall back to default /account
      }
    }
    const sep = finalBase.includes('?') ? '&' : '?';
    const finalDestination = `${finalBase}${sep}guide_token=${encodeURIComponent(token)}`;

    const response = NextResponse.redirect(finalDestination);
    response.headers.set('Set-Cookie', createAuthCookieHeader(token));
    // Clear the OAuth state + return cookies
    response.headers.append('Set-Cookie', 'oauth_state_google=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    response.headers.append('Set-Cookie', 'oauth_return_google=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    return response;
  } catch (err: any) {
    console.error('[Google OAuth Callback]', err);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=server_error`);
  }
}
