import Stripe from 'stripe';

// Singleton Stripe client — import this everywhere instead of `new Stripe()`
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
	apiVersion: '2026-02-25.clover',
});

// Map Stripe Price IDs → our internal plan IDs
export const PRICE_TO_PLAN: Record<string, string> = {
	[process.env.STRIPE_PRICE_STARTER_MONTHLY]: 'starter',
	[process.env.STRIPE_PRICE_STARTER_YEARLY]: 'starter',
	[process.env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
	[process.env.STRIPE_PRICE_PRO_YEARLY]: 'pro',
	[process.env.STRIPE_PRICE_UNLIMITED_MONTHLY]: 'unlimited',
	[process.env.STRIPE_PRICE_UNLIMITED_YEARLY]: 'unlimited',
};
