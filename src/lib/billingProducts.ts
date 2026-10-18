// Which product a Stripe price or subscription belongs to.
//
// Every paid product (the Almstins tracker, and later Agentics, Receivables and PetroTins) is
// billed on its own, with its own entitlement table, but they share one Stripe account and so
// one webhook endpoint. The tracker's checkout and webhook (src/pages/api/billing/) therefore
// act only on the tracker's own plans: a subscription for another product must never overwrite
// or cancel a customer's tracker plan.
//
// Pure on purpose: no Stripe import, the price-to-plan map is passed in (PRICE_TO_PLAN in
// src/lib/stripe.ts), so tests/billing/billingProducts.test.ts needs no mocks.

/** The `product` metadata value checkout puts on every Almstins session and subscription. */
export const ALMSTINS_PRODUCT = 'almstins';

type Metadata = Record<string, unknown> | null | undefined;

/**
 * The Almstins plan id a Stripe price id belongs to, or null when it is not an Almstins price.
 *
 * Own keys only: the map is a plain object, so `constructor`, `toString` and `__proto__` would
 * otherwise find something. And the map is built from STRIPE_PRICE_* env vars, so one that was
 * unset when the app was built became the literal key "undefined" (one set to nothing, the key
 * ""): neither is a price.
 */
export function almstinsPlanForPrice(priceId: unknown, priceToPlan: Record<string, string>): string | null {
	if (typeof priceId !== 'string' || priceId === '' || priceId === 'undefined') return null;
	return Object.hasOwn(priceToPlan, priceId) ? priceToPlan[priceId] : null;
}

/**
 * Whether Stripe metadata tags something as another product's. No tag at all is not another
 * product's: subscriptions created before checkout started tagging carry none, and are
 * Almstins's. Any value but "almstins" is another product's, so an unexpected one is ignored
 * rather than trusted.
 */
export function isTaggedForAnotherProduct(metadata: Metadata): boolean {
	const product = metadata?.product;
	return product !== undefined && product !== null && product !== ALMSTINS_PRODUCT;
}

/**
 * The Almstins plan id a subscription is for, or null when it is not an Almstins subscription.
 * It is one only if its first item's price is an Almstins price AND none of the metadata given
 * (the subscription's and, for a completed checkout, the session's) tags another product.
 */
export function almstinsPlanForSubscription(
	priceId: unknown,
	metadata: Metadata[],
	priceToPlan: Record<string, string>,
): string | null {
	if (metadata.some(isTaggedForAnotherProduct)) return null;
	return almstinsPlanForPrice(priceId, priceToPlan);
}
