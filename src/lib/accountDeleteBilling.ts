import type Stripe from 'stripe';
import { db } from '@/lib/db';

/** Statuses after which Stripe never charges the subscription again. */
const ENDED = new Set<Stripe.Subscription.Status>(['canceled', 'incomplete_expired']);

/** Stripe search query string literal: backslash and single quote escaped. */
const searchLiteral = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Cancels every Stripe subscription this tenant still has, before self-serve account
 * deletion (src/pages/api/account/delete.ts) removes its subscriptions row. Throws when that
 * can't be confirmed, so the caller keeps the account and the owner can retry, instead of
 * leaving a subscription that keeps billing an account that no longer exists.
 *
 * Where the subscriptions are found, all at once, because the stored ids alone can miss one:
 *   - the subscriptions row: its stripe_subscription_id, and every subscription on its
 *     stripe_customer_id (switching plans starts a new checkout on the same customer, so the
 *     customer can hold an older subscription the row no longer names);
 *   - Stripe's search on the tenant_id metadata checkout puts on every subscription, for one
 *     the webhook never stored.
 * A subscription whose metadata names another tenant is left alone.
 *
 * Immediately, not at period end like a cancel in the billing portal: period end keeps the
 * plan usable until the paid period runs out, and after deletion there is no account left to
 * use it. It would only keep a live subscription on the customer, and Stripe would keep
 * retrying the card on a past-due invoice until the period ended. Canceling now also stops
 * Stripe collecting on the subscription's open invoices.
 *
 * With no Stripe key in this environment nothing can be checked: a tenant with stored Stripe
 * ids is refused, one without goes ahead (local development has no billing).
 */
export async function cancelTenantStripeSubscriptions(tenantId: string): Promise<{ canceled: string[] }> {
  const res = await db.execute({
    sql: `SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const customerIds = new Set<string>();
  const subscriptionIds = new Set<string>();
  for (const row of res.rows as Array<Record<string, unknown>>) {
    if (row.stripe_customer_id) customerIds.add(String(row.stripe_customer_id));
    if (row.stripe_subscription_id) subscriptionIds.add(String(row.stripe_subscription_id));
  }

  if (!import.meta.env.STRIPE_SECRET_KEY) {
    if (customerIds.size || subscriptionIds.size) {
      throw new Error('Stripe is not configured, so the stored subscription cannot be canceled');
    }
    return { canceled: [] };
  }
  // Loaded here, not at the top: the client throws on import without a key.
  const { stripe } = await import('@/lib/stripe');

  const live = new Map<string, Stripe.Subscription>();
  const consider = (sub: Stripe.Subscription) => {
    if (ENDED.has(sub.status)) return;
    const owner = sub.metadata?.tenant_id;
    if (owner && owner !== tenantId) return;
    live.set(sub.id, sub);
  };

  for (const customer of customerIds) {
    for await (const sub of stripe.subscriptions.list({ customer, limit: 100 })) consider(sub);
  }
  for await (const sub of stripe.subscriptions.search({
    query: `metadata['tenant_id']:${searchLiteral(tenantId)}`,
    limit: 100,
  })) consider(sub);
  for (const id of subscriptionIds) {
    if (!live.has(id)) consider(await stripe.subscriptions.retrieve(id));
  }

  for (const id of live.keys()) {
    await cancelSubscriptionNow(stripe, id, 'The owner deleted their Almstins account.');
  }
  return { canceled: [...live.keys()] };
}

/**
 * Cancels one subscription now. One that has already ended counts as done (another tab, a
 * cancel in the billing portal meanwhile, a redelivered webhook event); any other failure
 * throws.
 */
export async function cancelSubscriptionNow(stripe: Stripe, id: string, comment: string): Promise<void> {
  try {
    await stripe.subscriptions.cancel(id, { cancellation_details: { comment } });
  } catch (err) {
    const now = await stripe.subscriptions.retrieve(id).catch(() => null);
    if (!now || !ENDED.has(now.status)) throw err;
  }
}
