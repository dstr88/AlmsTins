import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A label stays in the account that saved it. Saving one used to cast a cross-account
 * vote and, at 3 matching votes, publish the label to every user, which built an
 * address-to-name list from private labels (privacy policy v1.2, 2026-10-10).
 */

const calls: Array<{ sql: string; args: unknown[] }> = [];
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async (q: { sql: string; args?: unknown[] }) => {
			calls.push({ sql: q.sql, args: q.args ?? [] });
			return { rows: [], rowsAffected: 1 };
		},
		batch: async () => [],
	},
}));
vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => ({ tenantId: 'tenant-a', userId: 'user-a' }),
}));

import { POST } from '../../src/pages/api/address-labels';

beforeEach(() => { calls.length = 0; });

async function save(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/address-labels', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return (POST as unknown as (ctx: { request: Request }) => Promise<Response>)({ request });
}

describe('saving an address label', () => {
	it('never touches the shared-label tables', async () => {
		await save({ address: '0xAbC0000000000000000000000000000000000001', label: 'Jane Doe' });
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) expect(c.sql).not.toMatch(/global_address_label/i);
	});

	it('writes only to this account, scoped by tenant', async () => {
		await save({ address: '0xabc0000000000000000000000000000000000001', label: 'Coffee shop' });
		const writes = calls.filter((c) => /INSERT|UPDATE/i.test(c.sql));
		expect(writes.length).toBeGreaterThan(0);
		for (const w of writes) {
			expect(w.sql).toMatch(/address_labels/);
			expect(w.args).toContain('tenant-a');
		}
	});
});
