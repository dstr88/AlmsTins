import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 4 of the poisoning warnings: the Danger Zone on the Addresses page. Flagged addresses and
 * addresses the user sent there sit apart from the address book; moving one into the book needs
 * "Are you sure?" and a name, and is saved with its own source; sending one back needs nothing.
 */

const MY_WALLET = `0x${'0'.repeat(39)}1`;
const COINBASE = `0xabcd${'1'.repeat(32)}9f3e`;
const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const AIRDROPPER = `0x${'5'.repeat(40)}`;
const FRIEND = `0x${'6'.repeat(40)}`;

let book: Array<{ id?: string; address: string; label: string; source: string }> = [];
const calls: Array<{ sql: string; args: unknown[] }> = [];
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async (q: { sql: string; args?: unknown[] }) => {
			calls.push({ sql: q.sql, args: q.args ?? [] });
			if (/SELECT address FROM address_labels WHERE id = \?/.test(q.sql)) {
				const hit = book.find((b) => b.id === q.args?.[0]);
				return { rows: hit ? [{ address: hit.address }] : [] };
			}
			if (/SELECT address, label, source FROM address_labels/.test(q.sql)) return { rows: book };
			if (/SELECT address FROM wallets/.test(q.sql)) return { rows: [{ address: MY_WALLET }] };
			if (/FROM address_danger_marks/.test(q.sql)) return { rows: [] };
			return { rows: [], rowsAffected: 1 };
		},
		batch: async () => [],
	},
}));
vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => ({ tenantId: 'tenant-a', userId: 'user-a' }),
}));
vi.mock('../../src/lib/historyRows', () => ({
	loadHistoryRows: async () => [],
	HistoryTooLargeError: class extends Error {},
}));

import { buildDangerZone } from '../../src/lib/dangerZone';
import { SOURCE_FROM_DANGER, isTrustedSource, type PoisonTransfer } from '../../src/lib/addressPoisoning';
import { POST as saveLabel } from '../../src/pages/api/address-labels';
import { POST as sendToDanger } from '../../src/pages/api/address-danger';
import { TENANT_TABLES } from '../../src/lib/accountDeleteTables';
import { getDangerZone } from '../../src/i18n/components/dangerZone';

const dust = (counterparty: string, o: Partial<PoisonTransfer> = {}): PoisonTransfer => ({
	counterparty,
	direction: 'in',
	amount: 0.0001,
	usd: 0.01,
	tokenSymbol: 'USDT',
	at: '2026-11-10T00:00:00Z',
	...o,
});

const savedBook = [{ address: COINBASE, label: 'Coinbase deposit', source: 'user' }];

beforeEach(() => {
	calls.length = 0;
	book = [{ id: 'l1', address: COINBASE, label: 'Coinbase deposit', source: 'user' }];
});

describe('buildDangerZone', () => {
	it('lists dust-only senders and look-alikes, naming the saved address imitated', () => {
		const list = buildDangerZone([dust(AIRDROPPER), dust(POISON, { amount: 0, usd: 0 })], savedBook, [MY_WALLET], []);
		const poison = list.find((e) => e.address === POISON);
		expect(poison?.signal).toBe('both');
		expect(poison?.imitates).toEqual({ address: COINBASE, label: 'Coinbase deposit' });
		expect(list.find((e) => e.address === AIRDROPPER)?.signal).toBe('dust-only');
	});

	it('never lists the account\'s own wallets, saved addresses, or real counterparties', () => {
		const list = buildDangerZone(
			[dust(MY_WALLET), dust(COINBASE), dust(FRIEND), { counterparty: FRIEND, direction: 'out', amount: 1, usd: 900 }],
			savedBook,
			[MY_WALLET],
			[],
		);
		expect(list).toEqual([]);
	});

	it('lists an address the user sent here, even with no signal', () => {
		const list = buildDangerZone([], savedBook, [MY_WALLET], [{ address: FRIEND, createdAt: '2026-11-17T00:00:00Z' }]);
		expect(list).toEqual([
			{ address: FRIEND, signal: null, imitates: null, marked: true, firstAt: '2026-11-17T00:00:00Z', transfers: 0, usdIn: 0 },
		]);
	});

	it('keeps an address out once the user moved it into the book past the warning', () => {
		const moved = [...savedBook, { address: POISON, label: 'Exchange 2', source: SOURCE_FROM_DANGER }];
		expect(isTrustedSource(SOURCE_FROM_DANGER)).toBe(true);
		expect(buildDangerZone([dust(POISON, { amount: 0 })], moved, [MY_WALLET], [])).toEqual([]);
	});

	it('puts newer entries first', () => {
		const list = buildDangerZone(
			[dust(AIRDROPPER, { at: '2026-10-01T00:00:00Z' }), dust(POISON, { at: '2026-11-15T00:00:00Z' })],
			savedBook,
			[MY_WALLET],
			[],
		);
		expect(list.map((e) => e.address)).toEqual([POISON, AIRDROPPER]);
	});
});

async function post(handler: unknown, url: string, body: Record<string, unknown>) {
	const request = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	return (handler as (ctx: { request: Request }) => Promise<Response>)({ request });
}

describe('moving an address out of the Danger Zone', () => {
	it('saves it with its own source, skips the look-alike question, and clears the mark', async () => {
		const res = await post(saveLabel, 'http://localhost/api/address-labels', { address: POISON, label: 'Exchange 2', fromDangerZone: true });
		expect(res.status).toBe(201);
		const insert = calls.find((c) => /INSERT INTO address_labels/.test(c.sql));
		expect(insert?.args).toContain(SOURCE_FROM_DANGER);
		expect(calls.some((c) => /DELETE FROM address_danger_marks/.test(c.sql))).toBe(true);
	});

	it('an ordinary save still asks about a look-alike and is stored as the user\'s own', async () => {
		const res = await post(saveLabel, 'http://localhost/api/address-labels', { address: POISON, label: 'Exchange 2' });
		expect(res.status).toBe(409);
		const ok = await post(saveLabel, 'http://localhost/api/address-labels', { address: FRIEND, label: 'Friend' });
		expect(ok.status).toBe(201);
		const insert = calls.filter((c) => /INSERT INTO address_labels/.test(c.sql)).pop();
		expect(insert?.args).toContain('user');
		expect(insert?.args).not.toContain(SOURCE_FROM_DANGER);
	});
});

describe('sending an address book entry to the Danger Zone', () => {
	it('removes it from this account\'s book and marks it, with no prompt', async () => {
		const res = await post(sendToDanger, 'http://localhost/api/address-danger', { labelId: 'l1' });
		expect(res.status).toBe(200);
		const del = calls.find((c) => /DELETE FROM address_labels/.test(c.sql));
		expect(del?.args).toEqual(['l1', 'tenant-a']);
		const mark = calls.find((c) => /INSERT INTO address_danger_marks/.test(c.sql));
		expect(mark?.args.slice(0, 2)).toEqual(['tenant-a', COINBASE]);
	});

	it('refuses an entry that is not this account\'s', async () => {
		const res = await post(sendToDanger, 'http://localhost/api/address-danger', { labelId: 'someone-else' });
		expect(res.status).toBe(404);
		expect(calls.some((c) => /DELETE FROM address_labels/.test(c.sql))).toBe(false);
	});

	it('needs a label id', async () => {
		expect((await post(sendToDanger, 'http://localhost/api/address-danger', {})).status).toBe(400);
	});
});

describe('account deletion and copy', () => {
	it('deletes the Danger Zone marks with the account, before the address book', () => {
		const t = TENANT_TABLES as readonly string[];
		expect(t).toContain('address_danger_marks');
		expect(t.indexOf('address_danger_marks')).toBeLessThan(t.indexOf('address_labels'));
	});

	it('has every string in every language, names the label, and never claims a crime', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getDangerZone(lang);
			expect(t.confirmLookalike('Coinbase deposit')).toContain('Coinbase deposit');
			expect(t.reasonBoth('Coinbase deposit')).toContain('Coinbase deposit');
			for (const s of [t.heading, t.description, t.keep, t.move, t.nameLabel, t.confirmDustOnly, t.confirmMarked]) {
				expect(s.length).toBeGreaterThan(0);
				expect(s).not.toMatch(/—/);
				expect(s.toLowerCase()).not.toMatch(/\bscam(mer)?\b|\bstolen\b/);
			}
		}
	});
});
