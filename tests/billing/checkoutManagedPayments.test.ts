import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stripe's Managed Payments is off by default for each Checkout Session, so the Almstins checkout
 * must turn it on per session. Otherwise Stripe does not act as merchant of record and the tax on a
 * sale is left to us. The route is called with a fake Stripe client and a fake database; no
 * network, no real keys.
 */
const state = vi.hoisted(() => ({
	create: vi.fn(async (_params: Record<string, unknown>) => ({ url: 'https://checkout.example/session' })),
}));

vi.mock('../../src/lib/stripe', () => ({
	stripe: { checkout: { sessions: { create: state.create } } },
	PRICE_TO_PLAN: { price_test_starter_monthly: 'starter' },
}));
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async () => ({ rows: [] }),
	},
}));
vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => ({ tenantId: 'tenant_test' }),
}));

import { POST } from '../../src/pages/api/billing/checkout';

const checkout = async (priceId: string) =>
	POST({
		request: new Request('https://almstins.test/api/billing/checkout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ priceId }),
		}),
	} as unknown as Parameters<typeof POST>[0]);

describe('the Almstins checkout turns Managed Payments on for each session', () => {
	beforeEach(() => {
		state.create.mockClear();
	});

	it('sends managed_payments enabled with every subscription session', async () => {
		const res = await checkout('price_test_starter_monthly');
		expect(res.status).toBe(200);
		expect(state.create).toHaveBeenCalledTimes(1);
		expect(state.create.mock.calls[0][0]).toMatchObject({
			mode: 'subscription',
			managed_payments: { enabled: true },
		});
	});

	it('sends none of the parameters Stripe rejects under Managed Payments', async () => {
		// On Nov 4, 2026 every live checkout failed with "Unsupported parameter: payment_method_types.
		// Managed Payments handles this parameter for you." Stripe controls the payment methods, tax
		// and post-sale actions of a Managed Payments session, so none of these may be sent:
		// docs.stripe.com/payments/managed-payments/update-checkout#remove-unsupported-parameters
		await checkout('price_test_starter_monthly');
		const params = state.create.mock.calls[0][0] as Record<string, unknown>;
		for (const key of [
			'payment_method_types', 'payment_method_configuration', 'automatic_tax', 'tax_id_collection',
			'adaptive_pricing', 'customer_update', 'shipping_address_collection', 'shipping_options', 'invoice_creation',
		]) {
			expect(params, key).not.toHaveProperty(key);
		}
		const sub = (params.subscription_data ?? {}) as Record<string, unknown>;
		for (const key of ['default_tax_rates', 'application_fee_percent', 'on_behalf_of', 'transfer_data', 'invoice_settings']) {
			expect(sub, `subscription_data.${key}`).not.toHaveProperty(key);
		}
	});

	it('does not create a session for a price that is not an Almstins plan', async () => {
		const res = await checkout('price_not_almstins');
		expect(res.status).toBe(400);
		expect(state.create).not.toHaveBeenCalled();
	});
});
