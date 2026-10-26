/**
 * exchangeAccountRoutes.ts: the "add account" and "update account" handlers shared by every
 * exchange tin (POST /api/exchanges/{slug}/accounts and /api/exchanges/{slug}/accounts/update).
 * Each route file passes its stored source ('crypto_com', 'coinbase', ...).
 *
 *   Add:     { ownerLabel? }                 → { ok, accountId, name, ownerLabel }
 *   Update:  { accountId, name?, ownerLabel? } → { ok, accountId, name?, ownerLabel? }
 *
 * ownerLabel is "Whose account is this?": optional free text, at most OWNER_LABEL_MAX
 * characters, empty or null clears it (see walletOwnerLabel.ts). It is stored on the account's
 * own key, cex:{source}:{accountId}, so two accounts at one exchange have two owners.
 *
 * The tenant comes from the session only. Update answers 404 unless the account belongs to the
 * session's tenant and to this exchange, before anything is written.
 */

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { requireTenantSession } from './requireTenantSession';
import {
	OWNER_LABEL_MAX,
	ownerLabelDemoBlocked,
	ownerLabelDemoResponse,
	ownerLabelWriteAllowed,
	parseOwnerLabel,
	writeAccountOwnerLabel,
} from './walletOwnerLabel';
import { json } from '@/lib/http';

async function readBody(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);
	return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

type OwnerInput = { kind: 'absent' } | { kind: 'value'; value: string | null } | { kind: 'error'; response: Response };

/** The optional ownerLabel field: absent, a clean value (null clears), or the error answer. */
export function readOwnerLabel(body: Record<string, unknown>, tenantId: string): OwnerInput {
	if (!('ownerLabel' in body)) return { kind: 'absent' };
	if (ownerLabelDemoBlocked(tenantId)) return { kind: 'error', response: ownerLabelDemoResponse() };
	const parsed = parseOwnerLabel(body.ownerLabel);
	if (!parsed.ok) return { kind: 'error', response: json({ ok: false, error: parsed.error, max: OWNER_LABEL_MAX }, 400) };
	if (!ownerLabelWriteAllowed(tenantId)) return { kind: 'error', response: json({ ok: false, error: 'RATE_LIMITED' }, 429) };
	return { kind: 'value', value: parsed.value };
}

/** POST /api/exchanges/{slug}/accounts: a new "Account #N", with an optional owner label. */
export async function createExchangeAccount(request: Request, source: string): Promise<Response> {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = session;
	try {
		const body = await readBody(request);
		const owner = readOwnerLabel(body, tenantId);
		if (owner.kind === 'error') return owner.response;

		const countResult = await db.execute({
			sql: `SELECT COUNT(*) AS count FROM exchange_accounts WHERE tenant_id = ? AND source = ?`,
			args: [tenantId, source],
		});
		const count = Number(countResult.rows?.[0]?.count ?? 0);
		const name = `Account #${count + 1}`;
		const accountId = randomUUID();

		await db.execute({
			sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, ?, ?)`,
			args: [accountId, tenantId, source, name],
		});

		const ownerLabel = owner.kind === 'value' ? owner.value : null;
		if (ownerLabel !== null) await writeAccountOwnerLabel(tenantId, source, accountId, ownerLabel);

		return json({ ok: true, accountId, name, ownerLabel });
	} catch (err) {
		console.error(`[exchange-accounts/create] ${source}`, err instanceof Error ? err.message : String(err));
		return json({ ok: false, error: 'Could not create the account.' }, 500);
	}
}

/** POST /api/exchanges/{slug}/accounts/update: rename, set or clear the owner, or both. */
export async function updateExchangeAccount(request: Request, source: string): Promise<Response> {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = session;
	try {
		const body = await readBody(request);
		const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		const wantsOwner = 'ownerLabel' in body;

		if (!accountId || (!name && !wantsOwner)) {
			return json({ ok: false, error: 'Missing accountId or name.' }, 400);
		}

		const owner = readOwnerLabel(body, tenantId);
		if (owner.kind === 'error') return owner.response;

		// The account must be this tenant's, at this exchange.
		const found = await db.execute({
			sql: `SELECT ea.id FROM exchange_accounts ea WHERE ea.tenant_id = ? AND ea.id = ? AND ea.source = ? LIMIT 1`,
			args: [tenantId, accountId, source],
		});
		if (!found.rows?.length) return json({ ok: false, error: 'Account not found.' }, 404);

		if (name) {
			await db.execute({
				sql: `UPDATE exchange_accounts SET name = ? WHERE tenant_id = ? AND id = ? AND source = ?`,
				args: [name, tenantId, accountId, source],
			});
		}

		const out: Record<string, unknown> = { ok: true, accountId };
		if (name) out.name = name;
		if (owner.kind === 'value') {
			await writeAccountOwnerLabel(tenantId, source, accountId, owner.value);
			out.ownerLabel = owner.value;
		}
		return json(out);
	} catch (err) {
		console.error(`[exchange-accounts/update] ${source}`, err instanceof Error ? err.message : String(err));
		return json({ ok: false, error: 'Could not update the account.' }, 500);
	}
}
