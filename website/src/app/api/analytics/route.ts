import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getAnalytics } from '@/lib/db';

// Admin emails that can access analytics (from env or defaults)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'brendan36363@gmail.com,fileshot.adm@gmail.com').split(',').map(e => e.trim());

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || !ADMIN_EMAILS.includes(user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const analytics = getAnalytics();
    return NextResponse.json(analytics);
  } catch {
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
