import { NextResponse } from 'next/server';
import { getDonationTotal } from '@/lib/db';

export async function GET() {
  try {
    const totalCents = getDonationTotal();
    const goal = 30000; // $300 in cents
    return NextResponse.json({
      success: true,
      total: totalCents,
      goal,
      percentage: Math.min(Math.round((totalCents / goal) * 100), 100),
    });
  } catch (err: any) {
    console.error('[Donate Total]', err);
    return NextResponse.json({ success: true, total: 0, goal: 30000, percentage: 0 });
  }
}
