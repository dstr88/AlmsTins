import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { stripe, PRICE_TO_PLAN } from '../../../lib/stripe';
import { db } from '../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const sig = request.headers.get('stripe-signature');
	const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;

	if (!sig || !webhookSecret) {
		return new Response('Missing signature', { status: 400 });
	}

	let event: Stripe.Event;
	try {
		const rawBody = await request.text();
		event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
	} catch (err) {
		console.error('[webhook] signature verification failed', err);
		return new Response('Invalid signature', { status: 400 });
	}

	try {
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as Stripe.Checkout.Session;
				await handleCheckoutComplete(session);
				break;
			}
			case 'customer.subscription.updated': {
				const sub = event.data.object as Stripe.Subscription;
				await handleSubscriptionUpdate(sub);
				break;
			}
			case 'customer.subscription.deleted': {
				const sub = event.data.object as Stripe.Subscription;
				await handleSubscriptionDeleted(sub);
				break;
			}
			default:
				// Ignore other events
				break;
		}
	} catch (err) {
		console.error(`[webhook] handler error for ${event.type}`, err);
		return new Response('Handler error', { status: 500 });
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
	const tenantId = session.metadata?.tenant_id;
	if (!tenantId || session.mode !== 'subscription') return;

	// Retrieve full subscription to get price info
	const subscriptionId = session.subscription as string;
	const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
		expand: ['items.data.price'],
	});

	const priceId = subscription.items.data[0]?.price?.id;
	const planId = (priceId && PRICE_TO_PLAN[priceId]) ?? 'free';
	const customerId = subscription.customer as string;
	const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

	await db.execute({
		sql: `INSERT INTO subscriptions (tenant_id, plan_id, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end, created_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		      ON CONFLICT(tenant_id) DO UPDATE SET
		        plan_id = excluded.plan_id,
		        status = excluded.status,
		        stripe_customer_id = excluded.stripe_customer_id,
		        stripe_subscription_id = excluded.stripe_subscription_id,
		        stripe_price_id = excluded.stripe_price_id,
		        current_period_end = excluded.current_period_end,
		        cancel_at_period_end = excluded.cancel_at_period_end`,
		args: [
			tenantId,
			planId,
			subscription.status,
			customerId,
			subscriptionId,
			priceId ?? null,
			periodEnd,
			subscription.cancel_at_period_end ? 1 : 0,
		],
	});

	console.log(`[webhook] checkout.session.completed — tenant ${tenantId} → ${planId}`);
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
	const tenantId = subscription.metadata?.tenant_id;
	if (!tenantId) {
		// Fall back to looking up by stripe_customer_id
		await updateByCustomerId(subscription);
		return;
	}

	const priceId = subscription.items.data[0]?.price?.id;
	const planId = (priceId && PRICE_TO_PLAN[priceId]) ?? 'free';
	const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

	await db.execute({
		sql: `UPDATE subscriptions SET
		        plan_id = ?,
		        status = ?,
		        stripe_price_id = ?,
		        current_period_end = ?,
		        cancel_at_period_end = ?
		      WHERE tenant_id = ?`,
		args: [
			planId,
			subscription.status,
			priceId ?? null,
			periodEnd,
			subscription.cancel_at_period_end ? 1 : 0,
			tenantId,
		],
	});

	console.log(`[webhook] subscription.updated — tenant ${tenantId} → ${planId} (${subscription.status})`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
	const tenantId = subscription.metadata?.tenant_id;
	const customerId = subscription.customer as string;

	const sql = tenantId
		? `UPDATE subscriptions SET plan_id = 'free', status = 'canceled', stripe_subscription_id = NULL, stripe_price_id = NULL, current_period_end = NULL, cancel_at_period_end = 0 WHERE tenant_id = ?`
		: `UPDATE subscriptions SET plan_id = 'free', status = 'canceled', stripe_subscription_id = NULL, stripe_price_id = NULL, current_period_end = NULL, cancel_at_period_end = 0 WHERE stripe_customer_id = ?`;

	await db.execute({ sql, args: [tenantId ?? customerId] });
	console.log(`[webhook] subscription.deleted — ${tenantId ?? customerId} → free`);
}

async function updateByCustomerId(subscription: Stripe.Subscription) {
	const customerId = subscription.customer as string;
	const priceId = subscription.items.data[0]?.price?.id;
	const planId = (priceId && PRICE_TO_PLAN[priceId]) ?? 'free';
	const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

	await db.execute({
		sql: `UPDATE subscriptions SET
		        plan_id = ?,
		        status = ?,
		        stripe_price_id = ?,
		        current_period_end = ?,
		        cancel_at_period_end = ?
		      WHERE stripe_customer_id = ?`,
		args: [
			planId,
			subscription.status,
			priceId ?? null,
			periodEnd,
			subscription.cancel_at_period_end ? 1 : 0,
			customerId,
		],
	});
}
