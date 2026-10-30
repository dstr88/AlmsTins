/**
 * The identifications page, the add-wallet prompt and their copy.
 *
 *   - The page checks the owner before it reads anything, and neither script builds HTML from data.
 *   - The prompt only ever opens after an add succeeds, records only on a click, and "Skip for now"
 *     closes it without recording anything.
 *   - A wallet or account with no entry keeps its button on the row (it clears only by recording).
 *   - The copy is records-and-estimates wording in all three languages, with no legal-effect claims,
 *     and the exchange warning never says the exchange will follow the choice.
 *   - Which wallets are undecided, and the groups they belong to, come from the tenant's own rows.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const PAGE = 'src/pages/dashboard/yearEnd/identifications.astro';
const PROMPT = 'src/components/LotIdentificationPrompt.astro';

describe('the page and the prompt', () => {
	it('the page checks the owner before it reads anything', () => {
		const src = read(PAGE);
		const front = src.slice(0, src.indexOf('---', 3));
		const gate = front.indexOf('if (!(await hasTaxAccess(Astro.request))) return Astro.redirect(TAX_DENIED_REDIRECT, 302);');
		expect(gate).toBeGreaterThan(-1);
		for (const op of ['computeLedger(', 'loadIdentificationState(', 'perWalletEnabled(', 'db.execute(']) {
			const at = front.indexOf(op, gate > -1 ? 0 : 0);
			if (at > -1) expect(gate, `gate before ${op}`).toBeLessThan(at);
		}
	});

	it.each([PAGE, PROMPT])('%s never turns data into HTML', (file) => {
		const src = read(file);
		expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|set:html|document\.write/);
	});

	it('the prompt opens only after a successful add, and only a click records', () => {
		const src = read(PROMPT);
		// The two add calls, nothing else.
		expect(src).toContain('/api\\/wallets');
		expect(src).toMatch(/\/api\\\/exchanges\\\/\[a-z0-9_-\]\+\\\/accounts/);
		expect(src).toMatch(/if \(res\.ok && before\)/);
		// Recording is a function called from click handlers; "Skip" only closes.
		expect(src).toMatch(/skip\.addEventListener\('click', \(\) => dlg\.close\(\)\)/);
		const recordCalls = [...src.matchAll(/\brecord\(/g)].length;
		expect(recordCalls).toBeGreaterThan(0);
		for (const m of src.matchAll(/\brecord\([^)]*\)/g)) {
			const before = src.slice(Math.max(0, m.index! - 80), m.index!);
			expect(before, `record( is called from a click handler: ${m[0]}`).toMatch(/addEventListener\('click'|async function /);
		}
		expect(src).toMatch(/import '@\/styles\/dialog\.css';/);
	});

	it('every wallet and account row can carry the persistent button, and it hides only when decided', () => {
		expect(read('src/components/ExchangeAccountCard.astro')).toMatch(/data-li-key=\{`cex:\$\{source\}:\$\{accountId\}`\}/);
		expect(read('src/components/ExchangeAccountCard.astro')).toContain('data-li-link');
		expect(read('src/components/dashboard/WalletOverview.tsx')).toContain('data-li-address={wallet.address}');
		expect(read('src/components/dashboard/WalletOverview.tsx')).toContain('data-li-link');
		const prompt = read(PROMPT);
		expect(prompt).toMatch(/group && group\.undecided/);
		// no timer hides the button
		expect(prompt).not.toMatch(/setTimeout\([^)]*(hidden|display)/);
	});

	it('the page has the pieces the owner asked for', () => {
		const src = read(PAGE);
		expect(src).toContain('id="li-apply-all"'); // Apply to all
		expect(src).toContain('li-keep-default'); // keeping the default is a recorded decision
		expect(src).toContain('id="li-exchange-warning"');
		expect(src).toContain('id="li-count"'); // count of undecided wallets
		expect(src).toContain('li-confirm'); // owner marks an exchange entry confirmed
		expect(src).toContain('id="reconcile"'); // the per-year view
		expect(src).toMatch(/entries\('earliest', null\)/);
		// no edit or delete control for entries
		expect(src).not.toMatch(/method:\s*'(PUT|PATCH|DELETE)'/);
	});
});

describe('copy', async () => {
	const { getIdentifications } = await import('../../src/i18n/dashboard/yearEnd/identifications');
	const langs = ['en', 'es', 'fr'] as const;
	const flat = (v: unknown, out: string[] = []): string[] => {
		if (typeof v === 'string') out.push(v);
		else if (typeof v === 'function') {
			const f = v as (...a: unknown[]) => unknown;
			out.push(String(f(3, 5)), String(f('Latest acquired', 'Oct 1, 2026')), String(f(850000, 'today')));
		} else if (v && typeof v === 'object') for (const x of Object.values(v)) flat(x, out);
		return out;
	};
	const shape = (v: unknown): unknown =>
		typeof v === 'string' || typeof v === 'function' ? typeof v : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v;

	it('has the same keys in English, Spanish and French', () => {
		const en = shape(getIdentifications('en'));
		for (const l of langs) expect(shape(getIdentifications(l))).toEqual(en);
	});

	it.each(langs)('%s: records and estimates wording only', (lang) => {
		const text = flat(getIdentifications(lang)).join('\n');
		expect(text).not.toMatch(/legally binding|juridiquement contraignant|jurídicamente vinculante|guarantee|garant|will be accepted|IRS-approved/i);
		expect(text).not.toMatch(/tax[- ]prep|file your|déclarez|declara tus/i);
	});

	it.each(langs)('%s: the exchange warning never says the exchange will follow the choice', (lang) => {
		const w = getIdentifications(lang).exchangeWarning;
		expect(w).not.toMatch(/will follow|will honor|will use|will apply|suivra|respectera|seguirá|respetará/i);
		expect(w).toContain('1.1012-1(j)(3)(ii)');
	});

	it('English says it is a record at a date and time, that the tax professional decides, and that it is not tax advice', () => {
		const t = getIdentifications('en');
		expect(t.intro).toMatch(/dated/);
		expect(t.intro).toMatch(/can't be edited/);
		expect(t.disclaimer).toMatch(/not tax advice/);
		expect(t.disclaimer).toMatch(/you and your tax professional to decide/);
		expect(t.stampMeaning).toMatch(/no later than/);
	});

	it('the Settings toggle is labeled an estimate for comparison', async () => {
		const { en } = await import('../../src/i18n/dashboard/settings');
		expect(en.costBasisLabel).toMatch(/estimate for comparison/);
		expect(en.costBasisEstimateNote).toMatch(/does not show an identification was made/);
	});
});

// ── Which wallets are undecided ──────────────────────────────────────────────

const rows = vi.hoisted(() => ({ statements: [] as { sql: string; args: unknown[] }[] }));
vi.mock('@/lib/db', () => ({
	db: {
		execute: vi.fn(async ({ sql, args }: { sql: string; args: unknown[] }) => {
			rows.statements.push({ sql, args });
			if (/FROM wallets WHERE tenant_id/.test(sql)) {
				return { rows: [
					{ id: 'w1', address: '0x' + 'a'.repeat(40), label: 'Cold wallet', chains: '["ethereum","polygon"]', wallet_type: 'onchain' },
					{ id: 'w2', address: 'custom_abc', label: 'Cash', chains: '[]', wallet_type: 'custom' },
				] };
			}
			if (/FROM exchange_accounts WHERE tenant_id/.test(sql)) return { rows: [{ id: 'acct-1', source: 'coinbase', name: 'Account #1' }] };
			return { rows: [] };
		}),
	},
}));
vi.mock('@/lib/walletIdentity', () => ({
	loadOwnerIndex: async () => ({ byKey: new Map(), byAddress: new Map() }),
	ownerForAccount: () => 'Pat',
	ownerForWalletAddress: () => null,
}));
vi.mock('@/lib/walletOwnerLabel', () => ({
	walletKeysForWallet: async (_t: string, w: { address: string }) => [`ethereum:${w.address}`, `polygon:${w.address}`],
}));

describe('wallets and accounts an entry can be recorded for', async () => {
	const { loadWalletGroups, undecidedGroups } = await import('../../src/lib/lotIdentificationWallets');

	it('groups an on-chain address with its chains and keeps each exchange account on its own, skipping custom entries', async () => {
		const groups = await loadWalletGroups('tenant-1');
		expect(groups.map((g) => [g.kind, g.keys, g.exchangeHeld])).toEqual([
			['exchange', ['cex:coinbase:acct-1'], true],
			['onchain', [`ethereum:0x${'a'.repeat(40)}`, `polygon:0x${'a'.repeat(40)}`], false],
		]);
		expect(groups[0].ownerLabel).toBe('Pat');
		expect(groups[1].display).toBe('Cold wallet');
		for (const s of rows.statements) expect(s.args[0]).toBe('tenant-1');
	});

	it('a group is undecided until every one of its keys has an entry', async () => {
		const groups = await loadWalletGroups('tenant-1');
		expect(undecidedGroups(groups, []).map((g) => g.id)).toEqual(['cex:coinbase:acct-1', '0x' + 'a'.repeat(40)]);
		expect(undecidedGroups(groups, [{ walletKey: 'cex:coinbase:acct-1' }, { walletKey: `ethereum:0x${'a'.repeat(40)}` }]).map((g) => g.id)).toEqual(['0x' + 'a'.repeat(40)]);
		expect(undecidedGroups(groups, [{ walletKey: 'cex:coinbase:acct-1' }, { walletKey: `ethereum:0x${'a'.repeat(40)}` }, { walletKey: `polygon:0x${'a'.repeat(40)}` }])).toEqual([]);
	});
});
