import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserById, getLicenseByUserId } from '@/lib/db';

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const user = getUserById(auth.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const license = getLicenseByUserId(user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        license: license
          ? {
              license_key: license.license_key,
              plan: license.plan,
              status: license.status,
              machine_id: license.machine_id,
              created_at: license.created_at,
            }
          : null,
        hasPurchased: !!license,
      },
    });
  } catch (err: any) {
    console.error('[Auth Me]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
