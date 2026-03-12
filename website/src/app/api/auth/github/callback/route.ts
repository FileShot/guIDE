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
    const storedState = req.cookies.get('oauth_state_github')?.value;
    if (!state || !storedState || state !== storedState) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=csrf_failed`);
    }

    const clientId = process.env.GITHUB_CLIENT_ID!;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET!;

    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[GitHub OAuth] Token exchange failed:', tokenData);
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=token_failed`);
    }

    // Get user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ghUser = await userRes.json();

    // Get email (may need separate call if email is private)
    let email = ghUser.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const emails = await emailsRes.json();
      const primary = emails.find((e: any) => e.primary && e.verified);
      email = primary?.email || emails[0]?.email;
    }

    if (!email) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=no_email`);
    }

    // Find or create user
    let user = getUserByEmail(email);
    if (!user) {
      const created = createOAuthUser(email, ghUser.name || ghUser.login);
      user = { id: created.id, email: created.email, password_hash: '', name: created.name, stripe_customer_id: null, created_at: new Date().toISOString() };
    }

    // Sign JWT
    const token = signToken({ userId: user.id, email: user.email });

    // Resolve return URL (stored during OAuth initiation via ?return= param).
    // Validates against trusted hostnames to prevent open redirect attacks.
    // Always include guide_token: Electron desktop app reads it from the URL;
    // pocket.graysoft.dev ignores it; /account strips it on load for security.
    const returnCookie = req.cookies.get('oauth_return_github')?.value;
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
    response.headers.append('Set-Cookie', 'oauth_state_github=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    response.headers.append('Set-Cookie', 'oauth_return_github=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    return response;
  } catch (err: any) {
    console.error('[GitHub OAuth Callback]', err);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=server_error`);
  }
}
