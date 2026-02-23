import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createPurchase, completePurchase, createLicense, getUserById, completeDonation } from '@/lib/db';
import { generateLicenseKey } from '@/lib/license';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;

      // Check if this is a donation
      if (session.metadata?.type === 'donation') {
        completeDonation(session.id, session.payment_intent);
        console.log(`[Stripe Webhook] Donation completed: ${session.id}, amount: ${session.amount_total}`);
        return NextResponse.json({ received: true });
      }

      // Check if this is an API subscription checkout (not a license purchase)
      if (session.mode === 'subscription' || session.metadata?.plan) {
        console.log(`[Stripe Webhook] API subscription activated: user ${session.metadata?.userId}, plan: ${session.metadata?.plan}`);
        return NextResponse.json({ received: true });
      }

      // Otherwise, it's a legacy license purchase
      const userId = parseInt(session.metadata?.userId, 10);

      if (!userId) {
        console.error('[Stripe Webhook] No userId in metadata');
        return NextResponse.json({ received: true });
      }

      // Record purchase
      createPurchase(userId, session.id, session.amount_total || 999, session.currency || 'usd');
      completePurchase(session.id, session.payment_intent);

      // Generate and save license key
      const licenseKey = generateLicenseKey();
      createLicense(userId, licenseKey, 'standard');

      console.log(`[Stripe Webhook] License created for user ${userId}: ${licenseKey}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[Stripe Webhook]', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
