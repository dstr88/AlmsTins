/**
 * POST /api/vault/report-error
 *
 * Called client-side when a WalletSummary tin fails to load its data.
 * Sends an alert email to the site owner and (if set) the user's alert email.
 * Rate-limited to one email per wallet per hour to prevent floods.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { sendMail } from '@/lib/email';
import { db } from '@/lib/db';

export const prerender = false;

const OWNER_EMAIL = 'donnie@titaniumhut.com';

// Rate limit: one email per wallet per hour.
//
// This used to be in-memory only, and that was the bug behind the flood. Render's
// free tier sleeps and cold-starts constantly, wiping the Map, so "once per hour"
// silently became "once per login". The durable floor now lives in a tiny table
// that survives restarts; the Map stays as a zero-latency fast path in front of it.
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 60 * 60 * 1000;

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS vault_error_alerts (
				        tenant_id    TEXT        NOT NULL,
				        wallet_id    TEXT        NOT NULL,
				        last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				        PRIMARY KEY (tenant_id, wallet_id)
				      )`,
				args: [],
			})
			.then(() => undefined)
			.catch((err) => {
				// Reset so a later call retries; never throw out of the limiter.
				tableReady = null;
				console.error('[vault/report-error] ensureTable failed', err?.message);
			});
	}
	return tableReady;
}

/**
 * Atomically claim the one-email-per-wallet-per-hour slot. Returns true only for the
 * caller that wins the slot; concurrent duplicates return false, so a burst yields
 * exactly one email.
 *
 * This replaced a SELECT-then-INSERT pair. The check and the write were separate steps,
 * so a burst (a cold-start loading every tin at once, all failing together) let every
 * request pass the check before any write landed — turning one failure into four emails.
 * The claim is now a single statement: a fresh row wins, an existing row wins only if it
 * is older than the cooldown, and RETURNING is empty for everyone else. On any DB error
 * it falls back to an in-memory check-and-set, so a database hiccup can neither block a
 * genuine alert nor open the floodgates beyond one process.
 */
async function claimAlertSlot(tenantId: string, walletId: string): Promise<boolean> {
	const key = `${tenantId}:${walletId}`;
	const memLast = rateLimitMap.get(key) ?? 0;
	if (Date.now() - memLast < RATE_LIMIT_MS) return false; // this process already sent recently

	try {
		await ensureTable();
		const res = await db.execute({
			sql: `INSERT INTO vault_error_alerts (tenant_id, wallet_id, last_sent_at)
			      VALUES (?, ?, now())
			      ON CONFLICT (tenant_id, wallet_id) DO UPDATE
			        SET last_sent_at = now()
			        WHERE vault_error_alerts.last_sent_at < now() - INTERVAL '1 hour'
			      RETURNING wallet_id`,
			args: [tenantId, walletId],
		});
		const won = (res.rows?.length ?? 0) > 0;
		if (won) rateLimitMap.set(key, Date.now());
		return won;
	} catch {
		// DB unavailable — best-effort in-memory claim so one alert still gets through.
		rateLimitMap.set(key, Date.now());
		return true;
	}
}

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ ok: false }, 401);
	const { tenantId } = session;

	let body: { walletId?: unknown; refCode?: unknown; message?: unknown } = {};
	try { body = await request.json(); } catch { /* ignore bad JSON */ }

	const walletId = String(body.walletId ?? '').slice(0, 64);
	const refCode  = String(body.refCode  ?? '').slice(0, 32);
	const message  = String(body.message  ?? '').slice(0, 500);

	if (!walletId || !refCode) {
		return json({ ok: true, reported: false, reason: 'missing_fields' });
	}

	if (!(await claimAlertSlot(tenantId, walletId))) {
		return json({ ok: true, reported: false, reason: 'rate_limited' });
	}

	const now = new Date().toISOString();

	// Owner-only, by design. We do NOT email customers that a tin failed to load.
	// The panel retries and falls back to stale data, so most of these self-heal, and an
	// unsolicited "Almstins couldn't load your wallet" email costs more trust than it
	// saves. This is the owner's monitoring channel, not a customer-facing notice. (The
	// user's in-app error panel with its ref code + Try again still handles the rare
	// case where a tin genuinely can't load.)
	const adminSubject = `[Almstins] Vault load error — wallet …${walletId.slice(-5)}`;
	const adminText = [
		`Ref:    ${refCode}`,
		`Wallet: …${walletId.slice(-5)}`,
		`Tenant: …${tenantId.slice(-8)}`,
		`Error:  ${message || '(no message)'}`,
		`Time:   ${now}`,
		'',
		'A vault tin could not load its token data. Check Alchemy / Blockstream API',
		'status or review Render logs around the timestamp above.',
	].join('\n');

	void sendMail({ to: OWNER_EMAIL, subject: adminSubject, text: adminText }).catch(() => {});

	console.log(`[vault/report-error] owner alert for wallet …${walletId.slice(-5)}, ref ${refCode}`);
	return json({ ok: true, reported: true, refCode });
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
