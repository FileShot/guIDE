import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/session-check
 * Returns the raw guide_auth JWT token if present.
 * Used by the desktop Electron app as a last-resort fallback
 * when cookie detection via Electron APIs fails.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('guide_auth')?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false, token: null });
  }
  return NextResponse.json({ authenticated: true, token });
}
