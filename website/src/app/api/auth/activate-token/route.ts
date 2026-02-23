import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getUserByEmail, getLicenseByUserId, checkMachineLimit, updateLicenseMachine } from '@/lib/db';

/**
 * POST /api/auth/activate-token
 * Called by the desktop IDE after OAuth flow completes.
 * Takes a JWT token + machineId and returns license info.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, machineId } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'Token is required' }, { status: 400 });
    }
    if (!machineId) {
      return NextResponse.json({ success: false, error: 'Machine ID is required' }, { status: 400 });
    }

    // Verify the JWT
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
    }

    // Get the user
    const user = getUserByEmail(payload.email);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Check for license
    const license = getLicenseByUserId(user.id);
    if (!license) {
      return NextResponse.json({
        success: false,
        error: 'No active license found. Purchase a license at graysoft.dev/account.',
        email: payload.email,
      }, { status: 403 });
    }

    // Enforce machine limit
    const machineCheck = checkMachineLimit(license.id, machineId);
    if (!machineCheck.allowed) {
      return NextResponse.json({
        success: false,
        error: `This license is already activated on ${machineCheck.machineCount} machine(s). Maximum ${machineCheck.maxMachines} allowed. Deactivate a machine at graysoft.dev/account.`,
      }, { status: 403 });
    }

    // Register the machine
    updateLicenseMachine(license.id, machineId);

    return NextResponse.json({
      success: true,
      email: payload.email,
      licenseKey: license.license_key,
      plan: license.plan,
      expiresAt: null, // Lifetime license
    });
  } catch (err: any) {
    console.error('[Auth ActivateToken]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
