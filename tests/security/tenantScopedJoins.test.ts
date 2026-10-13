import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Every JOIN onto a tenant-owned table must match within the tenant, not by row id alone.
 * Tenant isolation is enforced in the app (every query scoped by tenant_id), so a JOIN that
 * matches `x.id = y.source_id` with no tenant predicate can pull another tenant's row in when
 * ids collide. Two queries did that:
 *
 *   - src/lib/getNeedsAttention.ts: the suggested and resolved transfer-match queries joined
 *     import_transactions (both legs) and, for suggested, exchange_accounts by id only.
 *   - src/pages/api/cron/monthly-digest.ts: the review-item queries joined transactions and
 *     import_transactions by id only.
 *
 * The check runs on the SQL each module actually sends: '@/lib/db' is a stub that records
 * every statement. A LEFT JOIN must carry `<alias>.tenant_id =` in its ON clause (a WHERE
 * predicate would turn it into an inner join); an inner JOIN may carry it in ON or WHERE.
 * Same idea as the source pins PR #204 added for annualBreakdown and transaction-history
 * (tests/tax/taxDocsOwnerOnly.test.ts).
 */

const state = vi.hoisted(() => ({
	calls: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
			const sql = typeof stmt === 'string' ? stmt : stmt.sql;
			const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
			state.calls.push({ sql, args });
			// The digest's first query lists tenants; answer it with one so the loop runs.
			if (/SELECT DISTINCT tenant_id FROM wallets/.test(sql)) return { rows: [{ tenant_id: 'tenant-a' }], rowsAffected: 0 };
			return { rows: [], rowsAffected: 0 };
		},
	},
}));
vi.mock('@/lib/activityLog', () => ({ logNeedsAttention: () => {} }));

import { runNeedsAttentionQueries } from '../../src/lib/getNeedsAttention';
import { GET as monthlyDigest } from '../../src/pages/api/cron/monthly-digest';

// CTEs and derived tables that are already scoped inside, so their alias has no tenant_id.
const SCOPED_INSIDE = new Set(['latest']);

type Join = { kind: 'LEFT' | 'INNER'; table: string; alias: string; on: string; rest: string };

function joinsIn(sql: string): Join[] {
	const out: Join[] = [];
	const re = /\b(LEFT\s+(?:OUTER\s+)?)?JOIN\s+(\w+)\s+(?:AS\s+)?(\w+)\s+ON\s+/gi;
	for (const m of sql.matchAll(re)) {
		const after = sql.slice(m.index! + m[0].length);
		const end = after.search(/\b(?:(?:LEFT\s+(?:OUTER\s+)?)?JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i);
		out.push({
			kind: m[1] ? 'LEFT' : 'INNER',
			table: m[2],
			alias: m[3],
			on: end === -1 ? after : after.slice(0, end),
			rest: after,
		});
	}
	return out;
}

function unscoped(sql: string): string[] {
	return joinsIn(sql)
		.filter((j) => !SCOPED_INSIDE.has(j.table))
		.filter((j) => {
			const pred = new RegExp(`\\b${j.alias}\\.tenant_id\\s*=`);
			return j.kind === 'LEFT' ? !pred.test(j.on) : !pred.test(j.rest);
		})
		.map((j) => `${j.kind} JOIN ${j.table} ${j.alias}`);
}

beforeEach(() => {
	state.calls = [];
	vi.stubEnv('CRON_SECRET', 'test-secret');
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('the checker itself', () => {
	it('flags a JOIN by id alone and passes one scoped to the tenant', () => {
		expect(unscoped('FROM a m JOIN b x ON x.id = m.b_id WHERE m.tenant_id = ?')).toEqual(['INNER JOIN b x']);
		expect(unscoped('FROM a m JOIN b x ON x.id = m.b_id AND x.tenant_id = m.tenant_id WHERE m.tenant_id = ?')).toEqual([]);
		expect(unscoped('FROM a m JOIN b x ON x.id = m.b_id WHERE m.tenant_id = ? AND x.tenant_id = ?')).toEqual([]);
	});

	it('requires a LEFT JOIN to scope in its ON clause', () => {
		expect(unscoped('FROM a m LEFT JOIN b x ON x.id = m.b_id WHERE x.tenant_id = ?')).toEqual(['LEFT JOIN b x']);
		expect(unscoped('FROM a m LEFT JOIN b x ON x.id = m.b_id AND x.tenant_id = m.tenant_id LEFT JOIN c y ON y.id = x.c_id')).toEqual([
			'LEFT JOIN c y',
		]);
	});
});

describe('runNeedsAttentionQueries matches every joined row within the tenant', () => {
	it('sends its three queries with no JOIN by id alone', async () => {
		await runNeedsAttentionQueries('tenant-a');
		expect(state.calls).toHaveLength(3);
		const joins = state.calls.flatMap((c) => joinsIn(c.sql));
		expect(joins.length).toBeGreaterThanOrEqual(9); // 1 + 4 + 4: the check is looking at real JOINs
		for (const c of state.calls) expect(unscoped(c.sql), c.sql).toEqual([]);
	});

	it('the transfer-match legs and their accounts join within the match tenant', async () => {
		await runNeedsAttentionQueries('tenant-a');
		const matchQueries = state.calls.filter((c) => /FROM transfer_matches m/.test(c.sql));
		expect(matchQueries).toHaveLength(2);
		for (const { sql } of matchQueries) {
			expect(sql).toMatch(/JOIN import_transactions t_out ON t_out\.id = m\.out_tx_id\s+AND t_out\.tenant_id = m\.tenant_id/);
			expect(sql).toMatch(/JOIN import_transactions t_in\s+ON t_in\.id\s+= m\.in_tx_id\s+AND t_in\.tenant_id\s+= m\.tenant_id/);
			expect(sql).toMatch(/LEFT JOIN exchange_accounts ea_out ON ea_out\.id = t_out\.account_id\s+AND ea_out\.tenant_id = m\.tenant_id/);
			expect(sql).toMatch(/LEFT JOIN exchange_accounts ea_in\s+ON ea_in\.id\s+= t_in\.account_id\s+AND ea_in\.tenant_id\s+= m\.tenant_id/);
		}
	});
});

describe('the monthly digest matches every joined row within the tenant', () => {
	const run = () =>
		monthlyDigest({
			request: new Request('https://app.test/api/cron/monthly-digest?month=2026-09', {
				headers: { 'x-cron-secret': 'test-secret' },
			}),
		} as never);

	it('sends no JOIN by id alone', async () => {
		const res = await run();
		expect(res.status).toBe(200);
		const withJoins = state.calls.filter((c) => joinsIn(c.sql).length > 0);
		expect(withJoins.length).toBeGreaterThanOrEqual(4); // onchain, import, lifecycle, snapshots
		for (const c of state.calls) expect(unscoped(c.sql), c.sql).toEqual([]);
	});

	it('the review items join their transactions within the review item tenant', async () => {
		await run();
		const review = state.calls.filter((c) => /FROM tax_review_items tri/.test(c.sql)).map((c) => c.sql);
		expect(review).toHaveLength(2);
		expect(review[0]).toMatch(/JOIN transactions t ON t\.id = tri\.source_id\s+AND t\.tenant_id = tri\.tenant_id/);
		expect(review[1]).toMatch(/JOIN import_transactions it ON it\.id = tri\.source_id\s+AND it\.tenant_id = tri\.tenant_id/);
	});
});
