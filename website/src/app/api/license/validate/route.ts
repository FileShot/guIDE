import { NextRequest, NextResponse } from 'next/server';
import { getLicenseByKey, updateLicenseMachine, checkMachineLimit } from '@/lib/db';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 10 validation attempts per minute per IP
    const rl = checkRateLimit(req, RATE_LIMITS.licenseValidate);
    if (!rl.allowed) {
      const r = rateLimitResponse(rl);
      return NextResponse.json(r.body, { status: r.status, headers: r.headers });
    }

    const body = await req.json();
    const { key, machineId, platform, appVersion } = body;

    if (!key) {
      return NextResponse.json({ success: false, error: 'License key is required' }, { status: 400 });
    }

    const license = getLicenseByKey(key.toUpperCase());
    if (!license) {
      return NextResponse.json({ success: false, error: 'Invalid license key' }, { status: 404 });
    }

    if (license.status !== 'active') {
      return NextResponse.json({ success: false, error: 'License has been revoked' }, { status: 403 });
    }

    // Enforce machine limit (2 machines per license)
    if (machineId) {
      const machineCheck = checkMachineLimit(license.id, machineId);
      if (!machineCheck.allowed) {
        return NextResponse.json({
          success: false,
          error: `This license is already activated on ${machineCheck.machineCount} machine(s). Maximum ${machineCheck.maxMachines} allowed. Deactivate a machine from your account at graysoft.dev/account to free a slot.`,
        }, { status: 403 });
      }
      updateLicenseMachine(license.id, machineId);
    }

    console.log(`[License] Validated key ${key.substring(0, 10)}... for machine ${machineId?.substring(0, 8)}... (${platform || 'unknown'}, v${appVersion || '?'})`);

    return NextResponse.json({
      success: true,
      email: license.email,
      plan: license.plan,
      expiresAt: null, // Lifetime
    });
  } catch (err: any) {
    console.error('[License Validate]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
