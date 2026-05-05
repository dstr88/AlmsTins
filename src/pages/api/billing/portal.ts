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

		const subResult = await db.execute({
			sql: `SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = ? LIMIT 1`,
			args: [tenantId],
		});
		const customerId = (subResult.rows[0] as Record<string, unknown> | undefined)
			?.stripe_customer_id as string | undefined;

		if (!customerId) {
			return err('No active subscription found. Please subscribe first.', 404);
		}

		const session = await stripe.billingPortal.sessions.create({
			customer: customerId,
			return_url: `${new URL(request.url).origin}/dashboard/billing`,
		});

		return new Response(JSON.stringify({ url: session.url }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[billing/portal]', error);
		return err('Failed to open billing portal', 500);
	}
};

function err(message: string, status: number) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
