import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 4 of the poisoning warnings: Quarantine (named by Donnie, Nov 17, 2026). Flagged addresses
 * and addresses the user quarantined sit apart from the address book, behind a quiet button on
 * each wallet card and an account-wide page. Releasing one needs "Are you sure?" and a name, and
 * is saved with its own source; quarantining one needs nothing.
 */

const MY_WALLET = `0x${'0'.repeat(39)}1`;
const COINBASE = `0xabcd${'1'.repeat(32)}9f3e`;
const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const AIRDROPPER = `0x${'5'.repeat(40)}`;
const FRIEND = `0x${'6'.repeat(40)}`;

let book: Array<{ id?: string; address: string; label: string; source: string }> = [];
let marks: Array<{ address: string; created_at: string }> = [];
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
			if (/SELECT address, created_at FROM address_quarantine/.test(q.sql)) return { rows: marks };
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

import { buildQuarantine } from '../../src/lib/quarantine';
import { countsOnButton } from '../../src/lib/quarantineEntry';
import { flagsFor, flagOf } from '../../src/lib/poisoningFlags';
import { SOURCE_RELEASED, isTrustedSource, type PoisonTransfer } from '../../src/lib/addressPoisoning';
import { POST as saveLabel } from '../../src/pages/api/address-labels';
import { POST as quarantinePost } from '../../src/pages/api/address-quarantine';
import { TENANT_TABLES } from '../../src/lib/accountDeleteTables';
import { getQuarantine } from '../../src/i18n/components/quarantine';
import { getPoisonWarning, poisonSentence, poisonTag } from '../../src/i18n/components/poisonWarning';

const dust = (counterparty: string, o: Partial<PoisonTransfer> = {}): PoisonTransfer => ({
	counterparty,
	direction: 'in',
	amount: 0.0001,
	usd: 0.01,
	tokenSymbol: 'USDT',
	at: '2026-11-10T00:00:00Z',
	wallet: 'w1',
	...o,
});

const savedBook = [{ address: COINBASE, label: 'Coinbase deposit', source: 'user' }];

beforeEach(() => {
	calls.length = 0;
	marks = [];
	book = [{ id: 'l1', address: COINBASE, label: 'Coinbase deposit', source: 'user' }];
});

describe('buildQuarantine', () => {
	it('lists dust-only senders and look-alikes, with the saved address imitated and the wallets touched', () => {
		const list = buildQuarantine(
			[dust(AIRDROPPER), dust(POISON, { amount: 0, usd: 0, wallet: 'w2' }), dust(POISON, { amount: 0, wallet: 'w1' })],
			savedBook,
			[MY_WALLET],
			[],
		);
		const poison = list.find((e) => e.address === POISON);
		expect(poison?.signal).toBe('both');
		expect(poison?.imitates).toEqual({ address: COINBASE, label: 'Coinbase deposit' });
		expect(poison?.wallets.sort()).toEqual(['w1', 'w2']);
		expect(list.find((e) => e.address === AIRDROPPER)?.signal).toBe('dust-only');
	});

	it("never lists the account's own wallets, saved addresses, or real counterparties", () => {
		const list = buildQuarantine(
			[dust(MY_WALLET), dust(COINBASE), dust(FRIEND), { counterparty: FRIEND, direction: 'out', amount: 1, usd: 900 }],
			savedBook,
			[MY_WALLET],
			[],
		);
		expect(list).toEqual([]);
	});

	it('lists an address the user quarantined, with its history, even with no signal', () => {
		const list = buildQuarantine(
			[{ counterparty: FRIEND, direction: 'out', amount: 1, usd: 900, at: '2026-09-01T00:00:00Z', wallet: 'w3' }],
			savedBook,
			[MY_WALLET],
			[{ address: FRIEND, createdAt: '2026-11-17T00:00:00Z' }],
		);
		expect(list).toEqual([
			{ address: FRIEND, signal: null, imitates: null, byUser: true, firstAt: '2026-09-01T00:00:00Z', transfers: 1, usdIn: 0, wallets: ['w3'] },
		]);
	});

	it('keeps an address out once the user released it past the warning', () => {
		const released = [...savedBook, { address: POISON, label: 'Exchange 2', source: SOURCE_RELEASED }];
		expect(isTrustedSource(SOURCE_RELEASED)).toBe(true);
		expect(buildQuarantine([dust(POISON, { amount: 0 })], released, [MY_WALLET], [])).toEqual([]);
	});
});

describe('the wallet button count', () => {
	it('counts look-alikes only: never dust-only senders, never what the user quarantined themselves', () => {
		expect(countsOnButton({ signal: 'both', byUser: false })).toBe(true);
		expect(countsOnButton({ signal: 'lookalike', byUser: false })).toBe(true);
		expect(countsOnButton({ signal: 'dust-only', byUser: false })).toBe(false);
		expect(countsOnButton({ signal: null, byUser: true })).toBe(false);
	});
});

describe('the ☠ flag in history', () => {
	it('marks an address the user quarantined, over any automatic signal', () => {
		const flags = flagsFor([FRIEND, POISON], [dust(POISON, { amount: 0 })], savedBook, [MY_WALLET], [FRIEND, POISON]);
		expect(flagOf(flags, FRIEND)?.signal).toBe('quarantined');
		expect(flagOf(flags, POISON)).toEqual({ signal: 'quarantined', imitates: 'Coinbase deposit' });
	});

	it('does not mark an address the user later saved', () => {
		expect(flagsFor([COINBASE], [], savedBook, [MY_WALLET], [COINBASE]).size).toBe(0);
	});

	it('has its own words in every language', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getPoisonWarning(lang);
			expect(poisonSentence(t, 'quarantined', null)).toBe(t.quarantined);
			expect(poisonTag(t, 'quarantined')).toBe(t.tagQuarantined);
		}
	});
});

async function post(handler: unknown, url: string, body: Record<string, unknown>) {
	const request = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	return (handler as (ctx: { request: Request }) => Promise<Response>)({ request });
}

describe('releasing an address from quarantine', () => {
	it('saves it with its own source, skips the look-alike question, and clears the mark', async () => {
		const res = await post(saveLabel, 'http://localhost/api/address-labels', { address: POISON, label: 'Exchange 2', fromQuarantine: true });
		expect(res.status).toBe(201);
		const insert = calls.find((c) => /INSERT INTO address_labels/.test(c.sql));
		expect(insert?.args).toContain(SOURCE_RELEASED);
		expect(calls.some((c) => /DELETE FROM address_quarantine/.test(c.sql))).toBe(true);
	});

	it("an ordinary save still asks about a look-alike and is stored as the user's own", async () => {
		expect((await post(saveLabel, 'http://localhost/api/address-labels', { address: POISON, label: 'Exchange 2' })).status).toBe(409);
		expect((await post(saveLabel, 'http://localhost/api/address-labels', { address: FRIEND, label: 'Friend' })).status).toBe(201);
		const insert = calls.filter((c) => /INSERT INTO address_labels/.test(c.sql)).pop();
		expect(insert?.args).toContain('user');
		expect(insert?.args).not.toContain(SOURCE_RELEASED);
	});
});

describe('quarantining an address book entry', () => {
	it("removes it from this account's book and marks it, with no prompt", async () => {
		const res = await post(quarantinePost, 'http://localhost/api/address-quarantine', { labelId: 'l1' });
		expect(res.status).toBe(200);
		expect(calls.find((c) => /DELETE FROM address_labels/.test(c.sql))?.args).toEqual(['l1', 'tenant-a']);
		expect(calls.find((c) => /INSERT INTO address_quarantine/.test(c.sql))?.args.slice(0, 2)).toEqual(['tenant-a', COINBASE]);
	});

	it("refuses an entry that is not this account's", async () => {
		expect((await post(quarantinePost, 'http://localhost/api/address-quarantine', { labelId: 'someone-else' })).status).toBe(404);
		expect(calls.some((c) => /DELETE FROM address_labels/.test(c.sql))).toBe(false);
	});

	it('needs a label id', async () => {
		expect((await post(quarantinePost, 'http://localhost/api/address-quarantine', {})).status).toBe(400);
	});
});

describe('account deletion and copy', () => {
	it('deletes the quarantine with the account, before the address book', () => {
		const t = TENANT_TABLES as readonly string[];
		expect(t).toContain('address_quarantine');
		expect(t.indexOf('address_quarantine')).toBeLessThan(t.indexOf('address_labels'));
	});

	it('has every string in every language, names the label, and never claims a crime', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getQuarantine(lang);
			expect(t.confirmLookalike('Coinbase deposit')).toContain('Coinbase deposit');
			expect(t.reasonBoth('Coinbase deposit')).toContain('Coinbase deposit');
			expect(t.modalTitle('Main')).toContain('Main');
			expect(t.link(1)).not.toBe(t.link(2));
			for (const s of [t.button, t.heading, t.description, t.keep, t.release, t.nameLabel, t.confirmDustOnly, t.confirmByUser, t.releaseBtn, t.toQuarantineBtn]) {
				expect(s.length).toBeGreaterThan(0);
				expect(s).not.toMatch(/—/);
				expect(s.toLowerCase()).not.toMatch(/\bscam(mer)?\b|\bstolen\b|danger/);
			}
		}
	});
});
