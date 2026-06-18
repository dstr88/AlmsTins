import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import nodemailer from 'nodemailer';
import { stripe, PRICE_TO_PLAN } from '../../../lib/stripe';
import { db } from '../../../lib/db';
import { getTenantLang } from '@/lib/i18n/userLang';
import { getSubscriptionWelcome } from '@/i18n/emails/subscriptionWelcome';

// ── Email helpers ──────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
	starter: 'Starter ($9/mo)',
	pro: 'Pro ($20/mo)',
	unlimited: 'Premium ($39/mo)',
};

function getMailTransport() {
	const server = import.meta.env.EMAIL_SERVER;
	const from = import.meta.env.EMAIL_FROM;
	if (!server || !from) return null;
	return { transport: nodemailer.createTransport(server), from };
}

async function sendOwnerNotification(opts: {
	customerEmail: string;
	planId: string;
	tenantId: string;
	amountPaid: number;
}) {
	const mailer = getMailTransport();
	if (!mailer) return;

	const planLabel = PLAN_LABELS[opts.planId] ?? opts.planId;
	const amount = (opts.amountPaid / 100).toFixed(2);

	await mailer.transport.sendMail({
		to: 'titaniumhut@gmail.com',
		from: mailer.from,
		subject: `🎉 New almsTins subscriber — ${planLabel}`,
		text: [
			'New subscriber on almsTins!',
			'',
			`Plan:       ${planLabel}`,
			`Customer:   ${opts.customerEmail}`,
			`Amount:     $${amount}`,
			`Tenant ID:  ${opts.tenantId}`,
			'',
			'View in Stripe: https://dashboard.stripe.com/customers',
		].join('\n'),
		html: `
			<div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#1a1a1a;color:#f0f0f0;border-radius:10px;padding:32px;">
				<h2 style="color:#FA8072;margin-top:0;">🎉 New almsTins Subscriber!</h2>
				<table style="width:100%;border-collapse:collapse;">
					<tr><td style="padding:8px 0;color:#aaa;">Plan</td><td style="padding:8px 0;font-weight:bold;">${planLabel}</td></tr>
					<tr><td style="padding:8px 0;color:#aaa;">Customer</td><td style="padding:8px 0;">${opts.customerEmail}</td></tr>
					<tr><td style="padding:8px 0;color:#aaa;">Amount</td><td style="padding:8px 0;">$${amount}</td></tr>
					<tr><td style="padding:8px 0;color:#aaa;">Tenant ID</td><td style="padding:8px 0;font-size:12px;color:#888;">${opts.tenantId}</td></tr>
				</table>
				<a href="https://dashboard.stripe.com/customers" style="display:inline-block;margin-top:20px;background:#FA8072;color:#1a1a1a;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">View in Stripe →</a>
			</div>
		`,
	});
}

async function sendWelcomeEmail(opts: {
	customerEmail: string;
	planId: string;
	lang?: import('@/lib/i18n/locale').Lang;
}) {
	const mailer = getMailTransport();
	if (!mailer) return;

	const planLabel = PLAN_LABELS[opts.planId] ?? opts.planId;
	const { subject, text, html } = getSubscriptionWelcome(opts.lang ?? 'en').render({
		planLabel,
		dashboardUrl: 'https://almstins.com/dashboard',
		appUrl: 'https://almstins.com',
	});

	await mailer.transport.sendMail({
		to: opts.customerEmail,
		from: mailer.from,
		subject,
		text,
		html,
	});
}

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
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
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

	// Send notification emails (fire-and-forget — don't let email failure break the webhook)
	const customerEmail = session.customer_details?.email ?? session.customer_email ?? '';
	const amountPaid = session.amount_total ?? 0;

	if (customerEmail) {
		// Resolve the tenant's stored language for the user-facing welcome email.
		// getTenantLang defaults to 'en' on any error, so this is always safe.
		const lang = await getTenantLang(tenantId);

		Promise.allSettled([
			sendOwnerNotification({ customerEmail, planId, tenantId, amountPaid }),
			sendWelcomeEmail({ customerEmail, planId, lang }),
		]).then((results) => {
			results.forEach((r, i) => {
				if (r.status === 'rejected') {
					console.error(`[webhook] email ${i === 0 ? 'owner notification' : 'welcome'} failed:`, r.reason);
				}
			});
		});
	}
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
