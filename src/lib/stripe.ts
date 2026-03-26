import Stripe from 'stripe';

// Singleton Stripe client — import this everywhere instead of `new Stripe()`
export const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY, {
	apiVersion: '2025-02-24.acacia',
});

// Map Stripe Price IDs → our internal plan IDs
export const PRICE_TO_PLAN: Record<string, string> = {
	[import.meta.env.STRIPE_PRICE_STARTER_MONTHLY]: 'starter',
	[import.meta.env.STRIPE_PRICE_STARTER_YEARLY]: 'starter',
	[import.meta.env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
	[import.meta.env.STRIPE_PRICE_PRO_YEARLY]: 'pro',
	[import.meta.env.STRIPE_PRICE_UNLIMITED_MONTHLY]: 'unlimited',
	[import.meta.env.STRIPE_PRICE_UNLIMITED_YEARLY]: 'unlimited',
};
