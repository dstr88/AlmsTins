import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { stripe } from '../../../lib/stripe';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const tenantSession = await requireTenantSession(request);
		if (!tenantSession) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = tenantSession;
		const body = await request.json();
		const priceId: string = body.priceId;

		if (!priceId || typeof priceId !== 'string') {
			return err('Missing priceId', 400);
		}

		// Look up user email for pre-filling checkout
		const userResult = await db.execute({
			sql: `SELECT au.email, au.id as user_id
			      FROM tenant_memberships tm
			      JOIN auth_users au ON au.id = tm.user_id
			      WHERE tm.tenant_id = ? AND tm.role = 'owner'
			      LIMIT 1`,
			args: [tenantId],
		});
		const user = userResult.rows[0] as Record<string, unknown> | undefined;
		const email = (user?.email as string | undefined) ?? undefined;

		// Re-use existing Stripe customer if we have one
		const subResult = await db.execute({
			sql: `SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = ? LIMIT 1`,
			args: [tenantId],
		});
		const existingCustomerId = (subResult.rows[0] as Record<string, unknown> | undefined)
			?.stripe_customer_id as string | undefined;

		// Managed Payments: Stripe (via Link) is the merchant of record — requires
		// API version 2025-03-31.basil+ (client pins 2026-02-25.clover). Unsupported
		// params (payment_method_types, automatic_tax, etc.) must be omitted; Stripe
		// handles payment methods and tax itself. `managed_payments` is not yet in
		// the SDK's types (stripe 20.4.1), hence the cast.
		const params: Stripe.Checkout.SessionCreateParams = {
			mode: 'subscription',
			// Surface the "Add promotion code" box at checkout. Codes (e.g. CYNIDA26)
			// and their restrictions (yearly-only, % off) are defined as coupons /
			// promotion codes in the Stripe Dashboard, not here.
			allow_promotion_codes: true,
			customer: existingCustomerId || undefined,
			customer_email: existingCustomerId ? undefined : email,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: `${new URL(request.url).origin}/dashboard/billing?success=1`,
			cancel_url: `${new URL(request.url).origin}/dashboard/billing?cancelled=1`,
			metadata: { tenant_id: tenantId },
			subscription_data: {
				metadata: { tenant_id: tenantId },
			},
		};
		(params as Record<string, unknown>).managed_payments = { enabled: true };
		const session = await stripe.checkout.sessions.create(params);

		return new Response(JSON.stringify({ url: session.url }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[billing/checkout]', error);
		return err('Failed to create checkout session', 500);
	}
};

function err(message: string, status: number) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
