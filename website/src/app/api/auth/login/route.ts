import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail } from '@/lib/db';
import { verifyPassword, signToken, createAuthCookieHeader } from '@/lib/auth';
import { getLicenseByUserId, checkMachineLimit, updateLicenseMachine } from '@/lib/db';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 5 login attempts per 15 minutes per IP
    const rl = checkRateLimit(req, RATE_LIMITS.auth);
    if (!rl.allowed) {
      const r = rateLimitResponse(rl);
      return NextResponse.json(r.body, { status: r.status, headers: r.headers });
    }

    const body = await req.json();
    const { email, password, machineId } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = getUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const token = signToken({ userId: user.id, email: user.email });

    // Check for license
    const license = getLicenseByUserId(user.id);

    // Build response – include token in body so the Chrome extension can read it
    // (HttpOnly cookies are invisible to extensions)
    const responseData: any = { success: true, token };

    // If this is a desktop app sign-in (machineId present), return license info
    if (machineId && license) {
      // Enforce machine limit
      const machineCheck = checkMachineLimit(license.id, machineId);
      if (!machineCheck.allowed) {
        return NextResponse.json({
          success: false,
          error: `This license is already activated on ${machineCheck.machineCount} machine(s). Maximum ${machineCheck.maxMachines} allowed. Deactivate a machine from your account at graysoft.dev/account to free a slot.`,
        }, { status: 403 });
      }
      updateLicenseMachine(license.id, machineId);
      responseData.licenseKey = license.license_key;
      responseData.plan = license.plan;
      responseData.expiresAt = null; // Lifetime license
    } else if (machineId && !license) {
      responseData.error = 'No active license found for this account. Purchase a license at graysoft.dev/account.';
      responseData.success = false;
    }

    const response = NextResponse.json(responseData);
    response.headers.set('Set-Cookie', createAuthCookieHeader(token));
    return response;
  } catch (err: any) {
    console.error('[Auth Login]', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
