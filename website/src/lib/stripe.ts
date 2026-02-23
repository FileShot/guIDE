import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia' as any,
});

export const PRICE_AMOUNT = parseInt(process.env.PRICE_AMOUNT || '999', 10);
export const PRICE_CURRENCY = process.env.PRICE_CURRENCY || 'usd';

export const API_PLANS = {
  pro:       { price: 499,  label: 'Pro',       lookupKey: 'guide_api_pro' },
  unlimited: { price: 999,  label: 'Unlimited', lookupKey: 'guide_api_unlimited' },
} as const;

export type ApiPlan = keyof typeof API_PLANS;
