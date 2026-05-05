import type { APIRoute } from 'astro';
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

		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			payment_method_types: ['card'],
			customer: existingCustomerId || undefined,
			customer_email: existingCustomerId ? undefined : email,
			line_items: [{ price: priceId, quantity: 1 }],
			success_url: `${new URL(request.url).origin}/dashboard/billing?success=1`,
			cancel_url: `${new URL(request.url).origin}/dashboard/billing?cancelled=1`,
			metadata: { tenant_id: tenantId },
			subscription_data: {
				metadata: { tenant_id: tenantId },
			},
		});

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
