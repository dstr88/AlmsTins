import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 3 of the poisoning warnings: saving an address that starts and ends like one the user
 * already saved is answered with 409 and the entry it looks like, and nothing is written, until
 * the form resends with confirmLookalike: true.
 */

const COINBASE = `0xabcd${'1'.repeat(32)}9f3e`;
const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const STRANGER = `0x${'5'.repeat(40)}`;

let book: Array<{ address: string; label: string; source: string }> = [];
const calls: Array<{ sql: string; args: unknown[] }> = [];
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async (q: { sql: string; args?: unknown[] }) => {
			calls.push({ sql: q.sql, args: q.args ?? [] });
			if (/SELECT address, label, source FROM address_labels/.test(q.sql)) return { rows: book };
			return { rows: [], rowsAffected: 1 };
		},
		batch: async () => [],
	},
}));
vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => ({ tenantId: 'tenant-a', userId: 'user-a' }),
}));

import { POST } from '../../src/pages/api/address-labels';

beforeEach(() => {
	calls.length = 0;
	book = [{ address: COINBASE, label: 'Coinbase deposit', source: 'user' }];
});

async function save(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/address-labels', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return (POST as unknown as (ctx: { request: Request }) => Promise<Response>)({ request });
}

const writes = () => calls.filter((c) => /INSERT|UPDATE/i.test(c.sql));

describe('saving a look-alike to the address book', () => {
	it('asks first: 409 with the saved entry it looks like, and writes nothing', async () => {
		const res = await save({ address: POISON, label: 'Coinbase' });
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.lookalike).toEqual({ address: COINBASE, label: 'Coinbase deposit' });
		expect(writes()).toHaveLength(0);
	});

	it('saves once the user confirms', async () => {
		const res = await save({ address: POISON, label: 'Coinbase', confirmLookalike: true });
		expect(res.status).toBe(201);
		expect(writes().length).toBeGreaterThan(0);
	});

	it('only takes a literal true as the confirmation', async () => {
		const res = await save({ address: POISON, label: 'Coinbase', confirmLookalike: 'yes' });
		expect(res.status).toBe(409);
	});

	it('saves an ordinary new address without asking', async () => {
		const res = await save({ address: STRANGER, label: 'Friend' });
		expect(res.status).toBe(201);
	});

	it('does not ask when relabelling an address already in the book', async () => {
		const res = await save({ address: COINBASE, label: 'Coinbase main' });
		expect(res.status).toBe(201);
	});

	it('does not ask about a look-alike of an automatic entry', async () => {
		book = [{ address: COINBASE, label: 'Matched', source: 'auto' }];
		const res = await save({ address: POISON, label: 'Coinbase' });
		expect(res.status).toBe(201);
	});

	it('reads only this account\'s address book', async () => {
		await save({ address: POISON, label: 'Coinbase' });
		const read = calls.find((c) => /SELECT address, label, source FROM address_labels/.test(c.sql));
		expect(read?.args).toEqual(['tenant-a']);
	});
});
