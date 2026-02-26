import { NextResponse, NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserById, updateUserStripeCustomer } from '@/lib/db';
import { stripe, PRICE_CURRENCY, API_PLANS, ApiPlan } from '@/lib/stripe';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    // Rate limit checkout creation: 10 per hour per IP
    const rl = checkRateLimit(req, RATE_LIMITS.checkout);
    if (!rl.allowed) {
      const r = rateLimitResponse(rl);
      return NextResponse.json({ success: false, ...r.body }, { status: r.status, headers: r.headers });
    }

    const user = getUserById(auth.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id.toString() },
      });
      customerId = customer.id;
      updateUserStripeCustomer(user.id, customerId);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://graysoft.dev';

    // Check if this is an API plan subscription
    const body = await req.json().catch(() => ({}));
    const plan = body.plan as ApiPlan | undefined;

    if (plan && API_PLANS[plan]) {
      // Create a subscription checkout for API tier
      const planConfig = API_PLANS[plan];
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: PRICE_CURRENCY,
              product_data: {
                name: `guIDE ${planConfig.label}`,
                description: `${planConfig.label} cloud AI access — works across guIDE Desktop and Pocket guIDE`,
                metadata: { guide_product: `guide_api_${plan}` },
              },
              unit_amount: planConfig.price,
              recurring: { interval: 'month' },
            },
            quantity: 1,
          },
        ],
        success_url: `${appUrl}/account?plan=${plan}&upgraded=true`,
        cancel_url: `${appUrl}/account`,
        metadata: {
          userId: user.id.toString(),
          plan,
        },
      });
      return NextResponse.json({ url: session.url });
    }

    // Legacy: one-time license purchase (kept for existing license holders)
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: PRICE_CURRENCY,
            product_data: {
              name: 'guIDE Pro License (Legacy)',
              description: 'Legacy lifetime license for guIDE — The AI-Native Code Editor',
            },
            unit_amount: 999,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/account?purchased=true`,
      cancel_url: `${appUrl}/account`,
      metadata: {
        userId: user.id.toString(),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[Stripe Checkout]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
