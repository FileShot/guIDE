import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createDonation } from '@/lib/db';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 5 donation attempts per hour per IP
    const rl = checkRateLimit(req, RATE_LIMITS.donate);
    if (!rl.allowed) {
      const r = rateLimitResponse(rl);
      return NextResponse.json(r.body, { status: r.status, headers: r.headers });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('[Donate] STRIPE_SECRET_KEY is not set');
      return NextResponse.json(
        { success: false, error: 'Payment system not configured' },
        { status: 503 }
      );
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as any });

    const body = await req.json();
    const { amount, name } = body; // amount in dollars

    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents < 100) {
      return NextResponse.json(
        { success: false, error: 'Minimum donation is $1.00' },
        { status: 400 }
      );
    }
    if (amountCents > 50000) {
      return NextResponse.json(
        { success: false, error: 'Maximum donation is $500.00' },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'guIDE Code Signing Fund',
              description: `Donation toward code signing certificate for guIDE`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://graysoft.dev'}/download?donated=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://graysoft.dev'}/download`,
      metadata: {
        type: 'donation',
        donor_name: name || 'Anonymous',
      },
    });

    // Record in database
    try {
      createDonation(session.id, amountCents, 'usd', name);
    } catch (dbErr) {
      console.error('[Donate DB]', dbErr);
      // Don't fail the request if DB write fails — Stripe session is already created
    }

    return NextResponse.json({ success: true, url: session.url });
  } catch (err: any) {
    console.error('[Donate]', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to create donation session' },
      { status: 500 }
    );
  }
}
