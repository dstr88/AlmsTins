import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { insertColumns } from '../helpers/migrationColumns';

/**
 * Almstins is not tax software (owner rule, Oct 12 2026), so an Aave liquidation is recorded as
 * an event: what was seized and what it was worth at the time. Nothing Almstins writes for a
 * liquidation calls it a disposal, a taxable event, or a capital gain or loss. This pins the
 * places that text comes from: the liquidation sync (the row it inserts), the liquidation alert
 * email (EN/ES/FR), the note under each liquidation on the Vault page (EN/ES/FR), and the sample
 * liquidation the demo seeds. Notes already stored on
 * real transactions are not rewritten; only the text written from now on changes.
 *
 * No database and no network: '@/lib/db' is stubbed, fetch returns one Aave liquidation on
 * Ethereum, and sendMail is a spy.
 */

const state = vi.hoisted(() => ({
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	recipients: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => {
	const execute = async (stmt: { sql: string; args?: unknown[] }) => {
		state.calls.push({ sql: stmt.sql, args: stmt.args ?? [] });
		if (/INSERT INTO import_transactions/.test(stmt.sql)) return { rows: [], rowsAffected: 1 };
		if (/FROM tenant_memberships/.test(stmt.sql)) return { rows: state.recipients, rowsAffected: 0 };
		return { rows: [], rowsAffected: 0 };
	};
	return {
		db: {
			execute,
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => Promise.all(stmts.map(execute)),
		},
	};
});

const mail = vi.hoisted(() => ({ sendMail: vi.fn(async (_m: { to: string; subject: string; text: string }) => undefined) }));
vi.mock('@/lib/email', () => mail);
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));

import { syncLiquidationsToImportTransactions } from '../../src/lib/aave/syncAaveLiquidations';
import { getLiquidationAlert } from '../../src/i18n/emails/liquidationAlert';
import { getAaveHealthSummary } from '../../src/i18n/components/aaveHealthSummary';

const LANGS = ['en', 'es', 'fr'] as const;

// A tax characterization in any of the three languages.
const TAX_WORDS =
	/tax|disposal|dispos|capital (gain|loss)|treated as|impuesto|gravable|imponible|fiscal|impôt|imposable|cession|plus-value|moins-value/i;

const LIQUIDATION = {
	__typename: 'UserLiquidationCallTransaction',
	txHash: '0x00000000000000000000000000000000000000000000000000000000000000aa',
	timestamp: '2025-03-14T08:23:41.000Z',
	blockExplorerUrl: 'https://etherscan.io/tx/0xaa',
	collateral: {
		amount: { amount: { value: '5000000000000000', decimals: 18 }, usd: '14.00', usdPerToken: '2800' },
		reserve: { underlyingToken: { symbol: 'WETH', address: '0x00000000000000000000000000000000000000c0' } },
	},
	debtRepaid: {
		amount: { amount: { value: '13300000', decimals: 6 }, usd: '13.30' },
		reserve: { underlyingToken: { symbol: 'USDC' } },
	},
};

const WALLET = '0x00000000000000000000000000000000000000e1';

beforeEach(() => {
	state.calls = [];
	state.recipients = [];
	mail.sendMail.mockClear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init?: { body?: string }) => {
			const chainId = JSON.parse(String(init?.body ?? '{}'))?.variables?.request?.chainId;
			const items = chainId === 1 ? [LIQUIDATION] : [];
			return new Response(JSON.stringify({ data: { userTransactionHistory: { items, pageInfo: { next: null } } } }), {
				status: 200,
			});
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const inserted = () => state.calls.filter((c) => /INSERT INTO import_transactions/.test(c.sql));

describe('the liquidation sync records the event only', () => {
	it('writes a description and note with the amounts and no tax characterization', async () => {
		const imported = await syncLiquidationsToImportTransactions('tenant-a', WALLET);
		expect(imported).toBe(1);

		const rows = inserted();
		expect(rows).toHaveLength(1);
		const args = rows[0].args;
		const col = (name: string) => args[insertColumns(rows[0].sql)!.columns.indexOf(name)];
		expect(col('tenant_id')).toBe('tenant-a');

		const description = String(col('description'));
		const notes = String(col('notes'));
		expect(description).toMatch(/0\.005000 WETH seized to repay USDC loan/);
		expect(notes).toMatch(/Debt cleared: \$13\.30/);
		expect(notes).toMatch(/Liquidation penalty: \$0\.70/);
		expect(`${description}\n${notes}`).not.toMatch(TAX_WORDS);
	});

	it('the alert email it sends says the event was recorded, in each language, with no tax characterization', async () => {
		state.recipients = LANGS.map((lang) => ({ alert_email: `${lang}@example.test`, lang }));
		await syncLiquidationsToImportTransactions('tenant-a', WALLET);

		const tenantQuery = state.calls.find((c) => /FROM tenant_memberships/.test(c.sql))!;
		expect(tenantQuery.args).toEqual(['tenant-a']);

		expect(mail.sendMail).toHaveBeenCalledTimes(3);
		for (const [m] of mail.sendMail.mock.calls) {
			expect(m.text, m.text).not.toMatch(TAX_WORDS);
			expect(m.text, m.text).toMatch(/records|registros|registres/);
		}
	});
});

describe('the liquidation alert email (EN/ES/FR)', () => {
	it.each(LANGS)('%s: records the liquidation, with no tax characterization or em dash', (lang) => {
		const { subject, text } = getLiquidationAlert(lang).render({
			address: WALLET,
			imported: 1,
			appBase: 'https://app.test',
		});
		expect(`${subject}\n${text}`).not.toMatch(TAX_WORDS);
		expect(text).toMatch(/Almstins/);
		expect(text).not.toMatch(/—/);
	});
});

describe('the demo liquidation note describes the event only', () => {
	const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/demo/start.ts'), 'utf8');
	const start = src.indexOf("'demo-itx-aave-liq-eth-1'");
	const block = src.slice(start, src.indexOf('] },', start));
	const note = block.match(/'(Aave liquidated part of your [^']*)'/)?.[1] ?? '';

	it('says what was seized and what it was worth at the time', () => {
		expect(start).toBeGreaterThan(-1);
		expect(note).toBe(
			'Aave liquidated part of your WETH collateral after your health factor dropped below 1.0. Seized: 0.005 WETH, about $14.00 at the time ($2,800 per ETH).',
		);
	});

	it('draws no tax conclusion and carries no em dash', () => {
		expect(note).not.toMatch(TAX_WORDS);
		expect(note).not.toMatch(/—/);
		expect(src).not.toMatch(/treated as a disposal|This is a taxable event|capital loss of/);
	});
});

describe('the Vault liquidation card (EN/ES/FR)', () => {
	const LOGGED = {
		en: 'Logged to your Almstins records',
		es: 'Registrada en tus registros de Almstins',
		fr: 'Enregistrée dans vos registres Almstins',
	} as const;

	it.each(LANGS)('%s: the note under each liquidation says it was logged, with no tax characterization or em dash', (lang) => {
		const note = getAaveHealthSummary(lang).liquidationLogged;
		expect(note).toBe(LOGGED[lang]);
		expect(note).not.toMatch(TAX_WORDS);
		expect(note).not.toMatch(/—|⚠/);
	});

	it.each(LANGS)('%s: no string on the card carries a tax characterization', (lang) => {
		const t = getAaveHealthSummary(lang);
		const strings = Object.values(t).filter((v): v is string => typeof v === 'string');
		strings.push(t.liquidationHeader('Ethereum', 'Mar 14, 2025'));
		expect(Object.keys(t)).not.toContain('taxableDisposal');
		for (const s of strings) expect(s, s).not.toMatch(TAX_WORDS);
	});

	it('the card renders the logged note, not the old taxable-disposal label', () => {
		const src = readFileSync(path.resolve(__dirname, '../../src/components/dashboard/AaveHealthSummary.tsx'), 'utf8');
		expect(src).toMatch(/\{t\.liquidationLogged\}/);
		expect(src).not.toMatch(/taxableDisposal|aave-liq-tax/);
	});
});
