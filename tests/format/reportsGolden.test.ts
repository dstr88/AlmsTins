import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnnualBreakdown } from '@/lib/annualBreakdown';

/**
 * The tax and year-end files, run on one fixed breakdown, compared with copies recorded before
 * Area 3 (one formatter module) touched them: the Annual Records PDF, the Year Summary PDF, every
 * Bookkeeping CSV section, the Form 8949 JSON, and the Agent Vault report PDF. They must not
 * change by a single byte.
 *
 * A PDF is compared with every compressed stream inflated (the zlib Node ships may differ between
 * this machine and CI, the text inside may not). CSV and JSON are compared as they are.
 * The copies were recorded with TZ=UTC, the zone the server runs in; the test also runs in other
 * zones, so a file whose dates follow the machine's zone fails here. Rerecord (only on purpose)
 * with UPDATE_REPORT_GOLDEN=1.
 *
 * Every amount, asset and date here is invented. No database, no network, no signing key.
 */

const GOLDEN_DIR = path.resolve(__dirname, '__golden__');
const NOW = new Date('2026-10-20T15:04:05.000Z');
const YEAR = 2024;

vi.mock('node:crypto', async (orig) => ({
	...(await orig<typeof import('node:crypto')>()),
	randomUUID: () => '00000000-0000-4000-8000-00000000f00d',
}));
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: 'tenant-golden' }) }));
vi.mock('@/lib/taxAuth', () => ({ requireTaxOwner: async () => null }));
vi.mock('@/lib/subscriptions', () => ({ getActivePlan: async () => ({ id: 'unlimited' }) }));
vi.mock('@/lib/costBasisMethodSetting', () => ({ getCostBasisMethod: async () => 'fifo' }));
vi.mock('@/lib/recordProof/store', () => ({ getLatestRoot: async () => null, persistRecordProof: async () => undefined }));
vi.mock('@/lib/tursoCache', () => ({ getCache: async () => ({ value: null }), setCache: async () => undefined }));
vi.mock('@/lib/annualBreakdown', () => ({ buildAnnualBreakdown: async () => BREAKDOWN }));

// Times near midnight UTC on purpose: in any zone west of UTC they fall on the day before.
const BREAKDOWN: AnnualBreakdown = {
	year: YEAR,
	availableYears: [2023, 2024],
	needsAttention: [
		{ asset: 'ETH', amount: 0.75, sellDate: '2024-03-01T02:30:00.000Z', proceedsUsd: 2512.5, sourceId: 's1', groupId: 'g1', txHash: '0xabc', transactionClass: 'other', sourceType: 'Coinbase CSV' },
		{ asset: 'SOL, "wrapped"', amount: 12, sellDate: '2024-07-04T00:15:00.000Z', proceedsUsd: null, sourceId: 's2', groupId: 'g2', txHash: null, transactionClass: 'sell', sourceType: 'Venmo' },
	],
	stillHolding: [
		{ asset: 'BTC', amount: 0.12345678, acquiredDate: '2023-01-15T01:00:00.000Z', costUsd: 2050.1, daysHeld: 716, longTerm: true, daysToLongTerm: 0 },
		{ asset: 'POL', amount: 1234567.891234, acquiredDate: '2024-11-30T23:59:59.000Z', costUsd: null, daysHeld: 31, longTerm: false, daysToLongTerm: 335 },
	],
	shortTerm: [
		{ asset: 'ETH', amount: 1.5, buyDate: '2024-01-02T03:04:05.000Z', sellDate: '2024-06-01T00:30:00.000Z', costUsd: 3450, proceedsUsd: 5600.256, gainLossUsd: 2150.256, daysHeld: 151, basisSource: 'recorded', originNote: 'Coinbase buy' },
		{ asset: 'AVAX', amount: 40, buyDate: '2024-02-10T12:00:00.000Z', sellDate: '2024-09-15T05:00:00.000Z', costUsd: null, proceedsUsd: 980.4, gainLossUsd: 980.4, daysHeld: 218, basisSource: 'missing' },
		{ asset: 'DOGE', amount: 1000000.123456789, buyDate: '2024-03-03T00:00:00.000Z', sellDate: '2024-12-31T23:59:00.000Z', costUsd: 120000.5, proceedsUsd: 98765.43, gainLossUsd: -21235.07, daysHeld: 303, basisSource: 'estimated' },
		{ asset: 'USDC', amount: 0, buyDate: 'not a date', sellDate: '2024-05-05T10:00:00.000Z', costUsd: 0, proceedsUsd: 0, gainLossUsd: 0, daysHeld: 0, basisSource: 'manual' },
	],
	longTerm: [
		{ asset: 'BTC', amount: 0.5, buyDate: '2021-04-01T01:00:00.000Z', sellDate: '2024-04-02T01:00:00.000Z', costUsd: 29000, proceedsUsd: 34500.99, gainLossUsd: 5500.99, daysHeld: 1097, basisSource: 'recorded' },
		{ asset: 'LTC', amount: 3.333333333, buyDate: '2020-12-31T23:00:00.000Z', sellDate: '2024-10-10T03:00:00.000Z', costUsd: 1500, proceedsUsd: 250.01, gainLossUsd: -1249.99, daysHeld: 1379 },
	],
	income: [
		{ asset: 'ETH', amount: 0.0123, usdValue: 41.07, date: '2024-08-01T00:05:00.000Z', kind: 'staking', description: 'Staking reward' },
		{ asset: 'USDC', amount: 25, usdValue: null, date: '2024-02-29T22:00:00.000Z', kind: 'referral', description: null },
	],
	cardRebates: [{ asset: 'CRO', amount: 10, usdValue: 0.95, date: '2024-05-20T01:00:00.000Z', kind: 'card_rebate', description: 'Card Rebate' }],
	nftHoldings: [],
	aaveDeposits: [
		{ asset: 'WBTC', amount: 0.2, date: '2024-06-15T02:00:00.000Z', amountUsd: 13000.4, costBasisUsd: 9000, gainLossUsd: 4000.4, txHash: '0xdef' },
		{ asset: 'WETH', amount: 2, date: '2024-06-16T02:00:00.000Z', amountUsd: null, costBasisUsd: null, gainLossUsd: null, txHash: null },
	],
	aaveDepositTax: 'undecided',
	totals: { unsettledProceeds: 2512.5, shortTermGain: -18104.414, longTermGain: 4251, totalIncome: 41.07, heldCostBasis: 2050.1 },
	dataSource: 'pipeline',
};

/** A PDF with every zlib stream inflated, so a different zlib cannot fail the comparison. */
function inflatedPdf(pdf: Buffer): string {
	const parts: string[] = [];
	let from = 0;
	for (;;) {
		const open = pdf.indexOf('stream', from, 'latin1');
		if (open < 0) break;
		const start = open + 'stream'.length + (pdf[open + 6] === 0x0d ? 2 : 1);
		const end = pdf.indexOf('endstream', start, 'latin1');
		if (end < 0) break;
		parts.push(pdf.subarray(from, start).toString('latin1'));
		const raw = pdf.subarray(start, end);
		let body: Buffer;
		try { body = inflateSync(raw); } catch { body = raw; }
		parts.push(body.toString('latin1'));
		from = end;
	}
	parts.push(pdf.subarray(from).toString('latin1'));
	// The object offsets in the xref table and the stream lengths follow the compressed size.
	return parts.join('').replace(/\/Length \d+/g, '/Length _').replace(/^\d{10} \d{5} [nf] $/gm, 'xref-entry').replace(/startxref\n\d+/, 'startxref\n_');
}

const sha = (s: string, enc: BufferEncoding) => createHash('sha256').update(s, enc).digest('hex');

function golden(name: string, actual: string): void {
	const file = path.join(GOLDEN_DIR, name);
	// An inflated PDF is bytes, kept one char per byte; CSV and JSON are UTF-8 text.
	const enc: BufferEncoding = name.endsWith('.pdf.txt') ? 'latin1' : 'utf8';
	if (process.env.UPDATE_REPORT_GOLDEN === '1' || !existsSync(file)) {
		mkdirSync(GOLDEN_DIR, { recursive: true });
		writeFileSync(file, actual, enc);
		if (process.env.UPDATE_REPORT_GOLDEN !== '1') throw new Error(`recorded missing golden ${name}; rerun`);
		return;
	}
	const expected = readFileSync(file, enc);
	if (actual !== expected) writeFileSync(`${file}.actual`, actual, enc);
	expect(sha(actual, enc), `${name} changed (see ${name}.actual)`).toBe(sha(expected, enc));
}

const req = (url: string) => new Request(url, { headers: { cookie: 'almstins-lang=fr' } });

beforeAll(() => {
	delete process.env.ALMSTINS_SIGNING_KEY;
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterAll(() => vi.useRealTimers());

describe('tax and year-end files are byte-identical to the recorded copies', () => {
	it('Annual Records PDF', async () => {
		const { GET } = await import('@/pages/api/annual-records/report');
		const res = await GET({ request: req(`https://almstins.test/api/annual-records/report?year=${YEAR}`) } as never);
		expect(res.status).toBe(200);
		golden('annual-records.pdf.txt', inflatedPdf(Buffer.from(await res.arrayBuffer())));
	});

	it('Year Summary PDF', async () => {
		const { GET } = await import('@/pages/api/year-summary/report');
		const res = await GET({ request: req(`https://almstins.test/api/year-summary/report?year=${YEAR}`) } as never);
		expect(res.status).toBe(200);
		golden('year-summary.pdf.txt', inflatedPdf(Buffer.from(await res.arrayBuffer())));
	});

	for (const section of ['needsAttention', 'stillHolding', 'shortTerm', 'longTerm', 'income', 'turbotax']) {
		it(`Bookkeeping CSV: ${section}`, async () => {
			const { GET } = await import('@/pages/api/yearEnd/breakdown-csv');
			const url = new URL(`https://almstins.test/api/yearEnd/breakdown-csv?year=${YEAR}&section=${section}`);
			const res = await GET({ request: req(url.href), url } as never);
			expect(res.status).toBe(200);
			golden(`breakdown-${section}.csv`, `${res.headers.get('content-disposition')}\n${await res.text()}`);
		});
	}

	it('Form 8949 JSON', async () => {
		const { GET } = await import('@/pages/api/yearEnd/form8949');
		const res = await GET({ request: req(`https://almstins.test/api/yearEnd/form8949?year=${YEAR}`) } as never);
		expect(res.status).toBe(200);
		golden('form8949.json', await res.text());
	});

	it('Agent Vault report PDF', async () => {
		// The PDF is only built from a signed bundle. An invented seed that signs nothing outside this test.
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '7'.repeat(64));
		const { buildReport, dayBounds } = await import('@/lib/agentVault/report');
		const { buildReportBundle } = await import('@/lib/agentVault/reportProof');
		const { buildReportPdf } = await import('@/lib/agentVault/reportPdf');
		const { start, end } = dayBounds('2026-10-17');
		const at = (h: number) => new Date(Date.UTC(2026, 9, 17, h, 7, 9)).toISOString();
		const wallet = (n: number) => `0x${String(n).padStart(40, '0')}`;
		const base = { tinId: 'tin-1', chain: 'ethereum', registry: 'trusted', keyId: 'k', sourceIp: null } as const;
		const events = [
			{ ...base, id: 'e1', kind: 'checked', at: at(8), address: wallet(1), answer: 'flagged', status: 'unknown', tx: null, detail: { basis: 'registry_flagged' } },
			{ ...base, id: 'e2', kind: 'checked', at: at(9), address: wallet(3), answer: 'unknown', status: 'unknown', tx: null, detail: { basis: 'not_in_registry' } },
			{ ...base, id: 'e3', kind: 'checked', at: at(11), address: wallet(5), answer: 'proven', status: 'unknown', tx: null, detail: { basis: 'domain_proof' } },
			{ ...base, id: 'e4', kind: 'transaction', at: at(12), address: wallet(2), answer: 'unknown', status: null, keyId: null,
				tx: { hash: `0x${'a'.repeat(64)}`, direction: 'in', wallet: wallet(1), amount: '1', asset: 'ETH', assetContract: null, usd: 1270.56, blockNumber: 1 },
				detail: { reason: 'no_preceding_check' } },
			{ ...base, id: 'e5', kind: 'transaction', at: at(13), address: wallet(2), answer: 'unknown', status: null, keyId: null,
				tx: { hash: `0x${'b'.repeat(64)}`, direction: 'out', wallet: wallet(1), amount: '2', asset: 'ETH', assetContract: null, usd: -98765.4, blockNumber: 2 },
				detail: { reason: 'no_preceding_check' } },
		];
		const content = buildReport(events as never, {
			tin: { id: 'tin-1', label: 'Treasury agent' },
			period: { start, end, partial: false },
			labels: new Map([[wallet(1), 'Ops wallet']]),
		});
		const bundle = buildReportBundle({ tenantId: 'tenant-golden', reportId: '00000000-0000-4000-8000-0000000000aa', version: 1, generatedAt: '2026-10-18T09:10:00.000Z', content, prevRoot: null });
		golden('agent-report.pdf.txt', inflatedPdf(await buildReportPdf({ content, bundle })));
		vi.unstubAllEnvs();
	});
});
