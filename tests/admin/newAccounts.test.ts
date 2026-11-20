import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The New accounts list on the owner's admin page (src/lib/adminNewAccounts.ts), and the
 * Accounts by country count above it.
 *
 * Pinned here: the order (newest first by the time the account was made); each evidence tag's
 * rule; how an account signs in, read from what is stored; the last active day; that a failed
 * check behind a tag drops only that tag; the free-mail list; and that the page renders the
 * list as a component with its own stylesheet and prints no verdict. Every id and address is
 * invented.
 */
const mem = vi.hoisted(() => ({
	accounts: [] as Record<string, unknown>[],
	withRecords: [] as string[],
	destinations: [] as Record<string, unknown>[],
	plans: [] as Record<string, unknown>[],
	countries: [] as Record<string, unknown>[],
	failOn: null as RegExp | null,
	statements: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('@/lib/verifyRegistry', () => ({ ensureVerifyTables: async () => {} }));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		mem.statements.push({ sql, args });
		if (mem.failOn?.test(sql)) throw new Error('fake database error');
		const ok = (rows: unknown[]) => ({ rows, rowsAffected: 0 });
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) return ok([{ column_name: 'signup_service' }, { column_name: 'last_active_on' }]);
		if (sql.startsWith('SELECT u.id, u.email, u.email_verified, u.created_at')) return ok(mem.accounts.slice(0, Number(args[0])));
		if (sql.startsWith('SELECT u.id FROM auth_users u WHERE u.id IN (')) return ok(mem.withRecords.filter((id) => args.includes(id)).map((id) => ({ id })));
		if (sql.startsWith('SELECT tenant_id, kind, proof_status')) return ok(mem.destinations.filter((d) => args.slice(1).includes(d.tenant_id)));
		if (sql.startsWith('SELECT tenant_id, plan, status, paid_through FROM verify_subscriptions')) return ok(mem.plans.filter((p) => args.includes(p.tenant_id)));
		if (sql.startsWith('SELECT last_login_country AS country, COUNT(*) AS accounts')) return ok(mem.countries);
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import {
	NEW_ACCOUNTS_LIMIT,
	NEW_ACCOUNTS_SQL,
	atVerifyFreeLimit,
	countAccountsByCountry,
	evidenceTags,
	isProvenSignIn,
	lastActiveDay,
	listNewAccounts,
	signInMethods,
	type NewAccountFacts,
} from '../../src/lib/adminNewAccounts';
import { compareNewestFirst } from '../../src/lib/adminVerifySteps';
import { FREE_MAIL_DOMAINS, isCompanyEmail, mailDomain } from '../../src/lib/freeMailDomains';
import { PERSON_RECORD_TABLES, hasPersonRecordsSql } from '../../src/lib/personRecords';
import { VERIFY_PLANS } from '../../src/lib/verifyPlans';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { NEW_ACCOUNTS_COPY } from '../../src/components/admin/adminAccounts.copy';
import { __resetAccountActivityForTests } from '../../src/lib/accountActivity';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/**
 * An address at a given domain. The free-mail rule has to be tried against real providers'
 * domains, so the address is put together here and no mailbox at one is ever written out.
 */
const at = (domain: string) => `invented.for.this.test@${domain}`;

/** An account with nothing going for it; each test turns on the one thing it is about. */
const facts = (over: Partial<NewAccountFacts> = {}): NewAccountFacts => ({
	id: 'u-1',
	email: at('gmail.com'),
	emailVerified: null,
	createdAt: '2026-11-19 00:58:00',
	lastLogin: null,
	lastLoginCountry: null,
	signupService: null,
	lastActiveOn: null,
	providers: [],
	hasPassword: true,
	hasPersonRecords: false,
	verify: null,
	...over,
});
const tagIds = (a: NewAccountFacts) => evidenceTags(a).map((t) => t.id);

/** A row as the accounts query returns it. */
const row = (over: Record<string, unknown>) => ({
	email_verified: null, last_login: null, last_login_country: null, signup_service: null,
	last_active_on: null, active_tenant_id: null, has_password: false, providers: null, ...over,
});

beforeEach(() => {
	mem.accounts = [];
	mem.withRecords = [];
	mem.destinations = [];
	mem.plans = [];
	mem.countries = [];
	mem.failOn = null;
	mem.statements = [];
	__resetAccountActivityForTests();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('the order: newest first', () => {
	it('the query sorts by the time the account was made, newest first, and takes the newest 50', () => {
		expect(NEW_ACCOUNTS_SQL).toMatch(/ORDER BY u\.created_at DESC NULLS LAST, u\.id ASC\s+LIMIT \?/);
		expect(NEW_ACCOUNTS_SQL).not.toMatch(/ORDER BY u\.last_login/);
		expect(NEW_ACCOUNTS_LIMIT).toBe(50);
	});

	it('the list comes back newest first even when the database hands the rows over out of order', async () => {
		mem.accounts = [
			row({ id: 'u-old', email: 'old@example.test', created_at: '2026-10-01 08:00:00' }),
			row({ id: 'u-undated', email: 'undated@example.test', created_at: null }),
			row({ id: 'u-newest', email: 'newest@example.test', created_at: '2026-11-19 00:58:00' }),
			row({ id: 'u-mid', email: 'mid@example.test', created_at: '2026-11-18 23:59:59' }),
		];
		const view = await listNewAccounts();
		expect(view.rows.map((r) => r.id)).toEqual(['u-newest', 'u-mid', 'u-old', 'u-undated']);
		expect(mem.statements.find((s) => s.sql.startsWith('SELECT u.id, u.email, u.email_verified'))?.args).toEqual([NEW_ACCOUNTS_LIMIT]);
	});

	it('an account that never signed in again is not pushed down the list: the order ignores the last sign-in', async () => {
		mem.accounts = [
			row({ id: 'u-regular', email: 'regular@example.test', created_at: '2026-06-01 08:00:00', last_login: '2026-11-19T20:00:00.000Z' }),
			row({ id: 'u-new', email: 'new@example.test', created_at: '2026-11-19 00:58:00', last_login: null }),
		];
		expect((await listNewAccounts()).rows.map((r) => r.id)).toEqual(['u-new', 'u-regular']);
	});

	it('the comparison: newest first, no sign-up time last, then by id', () => {
		const sorted = [
			{ id: 'b', createdAt: null },
			{ id: 'c', createdAt: '2026-11-01 00:00:00' },
			{ id: 'a', createdAt: null },
			{ id: 'e', createdAt: '2026-11-19 00:00:00' },
			{ id: 'd', createdAt: '2026-11-19 00:00:00' },
		].sort(compareNewestFirst);
		expect(sorted.map((r) => r.id)).toEqual(['d', 'e', 'c', 'a', 'b']);
	});
});

describe('tag: Proven sign-in', () => {
	it('a linked Google or GitHub account proves it', () => {
		expect(isProvenSignIn({ providers: ['google'], emailVerified: null })).toBe(true);
		expect(isProvenSignIn({ providers: ['github'], emailVerified: '' })).toBe(true);
		expect(tagIds(facts({ providers: ['google'], hasPassword: false }))).toContain('proven-sign-in');
	});

	it('a confirmed email proves it', () => {
		expect(isProvenSignIn({ providers: [], emailVerified: '2026-11-19 01:00:00' })).toBe(true);
		expect(tagIds(facts({ emailVerified: '2026-11-19 01:00:00' }))).toContain('proven-sign-in');
	});

	it('a password sign-up that never confirmed its address does not', () => {
		for (const emailVerified of [null, undefined, '', '   ']) {
			expect(isProvenSignIn({ providers: [], emailVerified })).toBe(false);
		}
		expect(tagIds(facts())).not.toContain('proven-sign-in');
	});
});

describe('tag: Company email', () => {
	it('an address at a domain that is not a free-mail one', () => {
		expect(isCompanyEmail('ap@northwind-traders.example')).toBe(true);
		expect(tagIds(facts({ email: 'ap@northwind-traders.example' }))).toContain('company-email');
	});

	it.each(['gmail.com', 'GMAIL.com', 'outlook.com', 'yahoo.fr', 'proton.me', 'icloud.com', 'qq.com', 'comcast.net', 'users.noreply.github.com'])(
		'an address at %s is free mail',
		(domain) => {
			expect(isCompanyEmail(at(domain))).toBe(false);
			expect(tagIds(facts({ email: at(domain) }))).not.toContain('company-email');
		},
	);

	it('no address, or something that is not one, is not a company email', () => {
		for (const email of [null, undefined, '', 'not-an-address', '@nodomain', 'a@localhost']) {
			expect(isCompanyEmail(email as any)).toBe(false);
		}
		expect(mailDomain('Person@Example.TEST')).toBe('example.test');
	});

	it('the list is data: lowercase domains, each once', () => {
		const all = [...FREE_MAIL_DOMAINS];
		expect(all.length).toBeGreaterThan(100);
		for (const d of all) expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
		const source = read('src/lib/freeMailDomains.ts');
		const listed = source.slice(source.indexOf('new Set(['), source.indexOf(']);')).match(/'[^']+'/g) ?? [];
		expect(new Set(listed).size).toBe(listed.length);
	});
});

describe('tag: Set something up', () => {
	it('an account with a record a person makes', () => {
		expect(tagIds(facts({ hasPersonRecords: true }))).toContain('set-up');
		expect(tagIds(facts({ hasPersonRecords: false }))).not.toContain('set-up');
	});

	it('is never guessed when the check could not be read', () => {
		expect(tagIds(facts({ hasPersonRecords: null }))).not.toContain('set-up');
	});

	it('counts the same records the abandoned-account outline counts, in any tenant the account belongs to', () => {
		expect(PERSON_RECORD_TABLES).toEqual([
			'wallets', 'transactions', 'import_transactions', 'exchange_accounts',
			'transaction_screenshots', 'petro_tins', 'verify_destinations', 'verify_agent_keys', 'verify_claimed_names',
			'agent_tins', 'receivables', 'receivable_claims', 'receivable_attestations', 'receivable_documents',
			'cairn_projects', 'cairn_documents',
		]);
		const sql = hasPersonRecordsSql('u');
		for (const table of PERSON_RECORD_TABLES) {
			expect(sql).toContain(`EXISTS (SELECT 1 FROM ${table} x WHERE x.tenant_id IN (SELECT tm2.tenant_id FROM tenant_memberships tm2 WHERE tm2.user_id = u.id))`);
		}
	});
});

describe('tag: At limit', () => {
	const free = VERIFY_PLANS.free.limits;

	it("reads the Free plan's caps from the file the Verify dashboard enforces", () => {
		expect(free).toEqual({ address: 2, qr: 1, total: null });
	});

	it('on the Free plan with every address the plan holds', () => {
		expect(atVerifyFreeLimit({ plan: 'free', addresses: free.address!, qrs: 0 })).toBe(true);
		expect(tagIds(facts({ verify: { plan: 'free', addresses: 2, qrs: 0 } }))).toContain('at-limit');
	});

	it('on the Free plan with its one payment QR', () => {
		expect(atVerifyFreeLimit({ plan: 'free', addresses: 0, qrs: free.qr! })).toBe(true);
	});

	it('not while there is room for another address and another QR', () => {
		expect(atVerifyFreeLimit({ plan: 'free', addresses: 1, qrs: 0 })).toBe(false);
		expect(atVerifyFreeLimit({ plan: 'free', addresses: 0, qrs: 0 })).toBe(false);
		expect(tagIds(facts({ verify: { plan: 'free', addresses: 1, qrs: 0 } }))).not.toContain('at-limit');
	});

	it("never for a paid plan or the owner's account, whatever they hold", () => {
		expect(atVerifyFreeLimit({ plan: 'business', addresses: 10, qrs: 0 })).toBe(false);
		expect(atVerifyFreeLimit({ plan: 'pro', addresses: 50, qrs: 5 })).toBe(false);
		expect(atVerifyFreeLimit({ plan: 'unlimited', addresses: 99, qrs: 9 })).toBe(false);
	});

	it('never for an account with no tenant, or when Verify could not be read', () => {
		expect(atVerifyFreeLimit(null)).toBe(false);
	});
});

describe('tag: the Verify plan', () => {
	it('a paid plan shows as a tag with its name', () => {
		expect(evidenceTags(facts({ verify: { plan: 'business', addresses: 3, qrs: 0 } }))).toContainEqual({ id: 'verify-plan', plan: 'business' });
		expect(evidenceTags(facts({ verify: { plan: 'pro', addresses: 0, qrs: 0 } }))).toContainEqual({ id: 'verify-plan', plan: 'pro' });
		expect(NEW_ACCOUNTS_COPY.tags['verify-plan'].label.replace('{plan}', VERIFY_PLANS.business.name)).toBe('Verify Business');
	});

	it('Free, the owner and an account with no tenant show none', () => {
		for (const verify of [{ plan: 'free' as const, addresses: 0, qrs: 0 }, { plan: 'unlimited' as const, addresses: 0, qrs: 0 }, null]) {
			expect(tagIds(facts({ verify }))).not.toContain('verify-plan');
		}
	});
});

describe('the tags together', () => {
	it('an account with every piece of evidence shows them in one order', () => {
		const a = facts({ email: 'ap@northwind-traders.example', providers: ['google'], hasPassword: false, hasPersonRecords: true, verify: { plan: 'free', addresses: 2, qrs: 1 } });
		expect(tagIds(a)).toEqual(['proven-sign-in', 'company-email', 'set-up', 'at-limit']);
	});

	it('an account with none shows none', () => {
		expect(evidenceTags(facts())).toEqual([]);
	});

	it('no tag is a verdict about the person', () => {
		const words = JSON.stringify(NEW_ACCOUNTS_COPY).toLowerCase();
		for (const verdict of ['bot', 'spam', 'fake', 'customer', 'real person', 'suspicious', 'fraud']) {
			expect(words, verdict).not.toMatch(new RegExp(`\\b${verdict}\\b`));
		}
		expect(Object.values(NEW_ACCOUNTS_COPY.tags).map((t) => t.label)).toEqual(['Proven sign-in', 'Company email', 'Set something up', 'At limit', 'Verify {plan}']);
	});

	it('the words carry no em dash', () => {
		expect(read('src/components/admin/adminAccounts.copy.ts').replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('—');
	});
});

describe('how an account signs in', () => {
	it('is read from its linked accounts and its password', () => {
		expect(signInMethods({ providers: ['google'], hasPassword: false })).toEqual(['google']);
		expect(signInMethods({ providers: ['github'], hasPassword: false })).toEqual(['github']);
		expect(signInMethods({ providers: [], hasPassword: true })).toEqual(['credentials']);
		expect(signInMethods({ providers: ['github', 'google'], hasPassword: true })).toEqual(['google', 'github', 'credentials']);
	});

	it('an account with neither can only have come in by an emailed link', () => {
		expect(signInMethods({ providers: [], hasPassword: false })).toEqual(['email']);
	});
});

describe('the last active day', () => {
	it('is the later of the stored day and the day of the last sign-in', () => {
		expect(lastActiveDay({ lastActiveOn: '2026-11-19', lastLogin: '2026-11-13T04:49:00.000Z' })).toBe('2026-11-19');
		expect(lastActiveDay({ lastActiveOn: '2026-11-10', lastLogin: '2026-11-13T04:49:00.000Z' })).toBe('2026-11-13');
	});

	it('an account from before the day was kept falls back to its last sign-in', () => {
		expect(lastActiveDay({ lastActiveOn: null, lastLogin: '2026-11-13T04:49:00.000Z' })).toBe('2026-11-13');
	});

	it('neither is Never', () => {
		expect(lastActiveDay({ lastActiveOn: null, lastLogin: null })).toBeNull();
		expect(NEW_ACCOUNTS_COPY.never).toBe('Never');
	});
});

describe('the list, from the database', () => {
	it('each row carries its facts, its sign-in methods and its tags', async () => {
		mem.accounts = [
			row({ id: 'u-a', email: 'ap@northwind-traders.example', created_at: '2026-11-19 00:58:00', last_login: '2026-11-19T00:58:01.000Z',
				last_login_country: 'US', signup_service: 'verify', last_active_on: '2026-11-19', active_tenant_id: 't-a', providers: 'google' }),
			row({ id: 'u-b', email: at('gmail.com'), created_at: '2026-11-18 10:00:00', has_password: true }),
		];
		mem.withRecords = ['u-a'];
		mem.destinations = [
			{ tenant_id: 't-a', kind: 'address', proof_status: 'unproven', proof_method: 'none' },
			{ tenant_id: 't-a', kind: 'address', proof_status: 'proven', proof_method: 'micro_deposit', proven_at: '2026-11-19 01:10:00' },
		];
		const view = await listNewAccounts();
		expect(view.recordsKnown).toBe(true);
		expect(view.verifyKnown).toBe(true);
		expect(view.rows[0]).toMatchObject({
			id: 'u-a', lastLoginCountry: 'US', signupService: 'verify', lastActiveDay: '2026-11-19',
			methods: ['google'], verify: { plan: 'free', addresses: 2, qrs: 0 },
		});
		expect(view.rows[0].tags.map((t) => t.id)).toEqual(['proven-sign-in', 'company-email', 'set-up', 'at-limit']);
		expect(view.rows[1]).toMatchObject({ id: 'u-b', methods: ['credentials'], lastActiveDay: null, verify: null, tags: [] });
	});

	it('a live paid plan is read from the plan row, and a canceled one reads as Free', async () => {
		mem.accounts = [
			row({ id: 'u-paid', email: 'a@example.test', created_at: '2026-11-19 00:00:00', active_tenant_id: 't-paid', providers: 'google' }),
			row({ id: 'u-was', email: 'b@example.test', created_at: '2026-11-18 00:00:00', active_tenant_id: 't-was', providers: 'google' }),
			row({ id: 'u-owner', email: 'c@example.test', created_at: '2026-11-17 00:00:00', active_tenant_id: OWNER_TENANT_ID, providers: 'google' }),
		];
		mem.plans = [
			{ tenant_id: 't-paid', plan: 'business', status: 'active', paid_through: null },
			{ tenant_id: 't-was', plan: 'pro', status: 'canceled', paid_through: null },
		];
		const view = await listNewAccounts();
		expect(view.rows.map((r) => r.verify?.plan)).toEqual(['business', 'free', 'unlimited']);
		expect(view.rows[0].tags).toContainEqual({ id: 'verify-plan', plan: 'business' });
		expect(view.rows[1].tags.map((t) => t.id)).not.toContain('verify-plan');
	});

	it('a failed records check drops only that tag, and says so', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mem.accounts = [row({ id: 'u-a', email: 'ap@northwind-traders.example', created_at: '2026-11-19 00:58:00', providers: 'google' })];
		mem.failOn = /SELECT u\.id FROM auth_users u WHERE u\.id IN/;
		const view = await listNewAccounts();
		expect(view.recordsKnown).toBe(false);
		expect(view.rows[0].hasPersonRecords).toBeNull();
		expect(view.rows[0].tags.map((t) => t.id)).toEqual(['proven-sign-in', 'company-email']);
		expect(warn).toHaveBeenCalled();
	});

	it('a failed Verify read drops only the limit and plan tags, and says so', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mem.accounts = [row({ id: 'u-a', email: at('gmail.com'), created_at: '2026-11-19 00:58:00', active_tenant_id: 't-a', providers: 'github' })];
		mem.withRecords = ['u-a'];
		mem.failOn = /^SELECT tenant_id, kind, proof_status/;
		const view = await listNewAccounts();
		expect(view.verifyKnown).toBe(false);
		expect(view.rows[0].tags.map((t) => t.id)).toEqual(['proven-sign-in', 'set-up']);
	});

	it('the accounts query failing fails the list, so the page can say so instead of showing an empty table', async () => {
		mem.failOn = /SELECT u\.id, u\.email, u\.email_verified/;
		await expect(listNewAccounts()).rejects.toThrow();
	});

	it('logs no address when a check fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mem.accounts = [row({ id: 'u-a', email: 'private.person@example.test', created_at: '2026-11-19 00:58:00' })];
		mem.failOn = /SELECT u\.id FROM auth_users u WHERE u\.id IN/;
		await listNewAccounts();
		expect(JSON.stringify(warn.mock.calls)).not.toContain('private.person');
	});
});

describe('accounts by country', () => {
	it('counts accounts by the country of their last sign-in, most first, unknown kept as its own row', async () => {
		mem.countries = [{ country: 'US', accounts: 12 }, { country: null, accounts: 9 }, { country: 'SG', accounts: 3 }];
		expect(await countAccountsByCountry()).toEqual([
			{ country: 'US', accounts: 12 },
			{ country: null, accounts: 9 },
			{ country: 'SG', accounts: 3 },
		]);
		expect(mem.statements[0].sql).toContain('GROUP BY last_login_country ORDER BY COUNT(*) DESC');
	});
});

describe('the page', () => {
	const page = read('src/pages/admin/index.astro');
	const list = read('src/components/admin/NewAccounts.astro');
	const countries = read('src/components/admin/AccountsByCountry.astro');

	it('renders the list as a component, above the older sections', () => {
		expect(page).toContain("import NewAccounts from '@/components/admin/NewAccounts.astro';");
		expect(page).toContain('<NewAccounts />');
		expect(page.indexOf('<NewAccounts />')).toBeLessThan(page.indexOf('Adoption — wallets'));
	});

	it('the country count sits above the list, and the country sits next to the sign-up time in each row', () => {
		expect(list.indexOf('<AccountsByCountry />')).toBeLessThan(list.indexOf('id="new-accounts"'));
		expect(list.indexOf('<AccountsByCountry />')).toBeGreaterThan(-1);
		const head = list.slice(list.indexOf('<thead>'), list.indexOf('</thead>'));
		expect(head.match(/copy\.col\w+/g)).toEqual([
			'copy.colSignedUp', 'copy.colCountry', 'copy.colAccount', 'copy.colProduct',
			'copy.colMethods', 'copy.colLastSignIn', 'copy.colLastActive', 'copy.colEvidence',
		]);
		expect(countries).toContain('countAccountsByCountry()');
	});

	it('keeps the word Never for an empty last sign-in', () => {
		expect(list).toContain('<AdminTime value={a.lastLogin} empty={copy.never} />');
		expect(read('src/components/admin/adminAccounts.copy.ts')).not.toMatch(/not recorded/i);
	});

	it('has its queries and rules in src/lib, its words in the copy file and its styles in stylesheets', () => {
		for (const markup of [list, countries, read('src/components/admin/VerifySteps.astro'), read('src/components/admin/AdminTime.astro')]) {
			expect(markup).not.toMatch(/<style[\s>]/);
			expect(markup).not.toMatch(/\sstyle=/);
			expect(markup).not.toMatch(/db\.execute|SELECT /);
		}
		expect(list).toContain("from '@/lib/adminNewAccounts'");
		expect(list).toContain("import './NewAccounts.css';");
		expect(list).toContain("from './adminAccounts.copy'");
	});
});
