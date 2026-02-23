import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getLicenseByUserId, removeLicenseMachine } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { machineId } = body;

    if (!machineId) {
      return NextResponse.json({ success: false, error: 'machineId is required' }, { status: 400 });
    }

    const license = getLicenseByUserId(auth.userId);
    if (!license) {
      return NextResponse.json({ success: false, error: 'No active license found' }, { status: 404 });
    }

    const removed = removeLicenseMachine(license.id, machineId);
    if (!removed) {
      return NextResponse.json({ success: false, error: 'Machine not found on this license' }, { status: 404 });
    }

    console.log(`[License] Machine ${machineId.substring(0, 8)}... removed from license ${license.id} by user ${auth.userId}`);

    return NextResponse.json({ success: true, message: 'Machine deactivated successfully' });
  } catch (err: any) {
    console.error('[License Deactivate Machine]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
