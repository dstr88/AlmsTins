import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A sanctions lookup that fails is a check that did not run (code review 2026-10-11).
 *
 * Before: if the local OFAC mirror could not be read, or Chainalysis answered with an error,
 * the `sanctioned` flag silently stayed false and the address read "no sanctions match",
 * green when nothing else flagged it. Now each lookup's outcome is in coverage
 * (`sanctions`, `chainalysis`), and a failure makes the scan partial ("Limited check").
 *
 * No database, no network: the OFAC mirror lookup and fetch are stubbed.
 */

vi.mock('@/lib/db', () => {
	const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
	return { db: { execute: noDb, batch: noDb } };
});
const ofac = vi.hoisted(() => ({ answer: false as boolean | null | 'throw' }));
vi.mock('@/lib/threatLists', () => ({
	lookupSanctionedAddress: async () => {
		if (ofac.answer === 'throw') throw new Error('mirror exploded');
		return ofac.answer;
	},
}));

import { checkWallet, chainalysisSanctioned, computePartialCoverage, type WalletCheckResult } from '../../src/lib/walletChecker';

const EVM = '0x2222222222222222222222222222222222222222';
const SOL = 'So11111111111111111111111111111111111111112';

let goplusDown: boolean;
let chainalysis: { status: number; body: unknown } | 'throw';

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
	const url = String(input);
	if (url.includes('api.gopluslabs.io')) {
		if (goplusDown) return new Response('error', { status: 500 });
		return new Response(JSON.stringify({
			code: 1, message: 'ok',
			result: { blacklist_doubt: '0', sanctioned: '0', mixer: '0', contract_address: '0' },
		}), { status: 200 });
	}
	if (url.includes('api.honeypot.is')) return new Response(JSON.stringify({ code: 404, error: 'No pairs found' }), { status: 404 });
	if (url.includes('public.chainalysis.com')) {
		if (chainalysis === 'throw') throw new Error('socket hang up');
		return new Response(JSON.stringify(chainalysis.body), { status: chainalysis.status });
	}
	return new Response('not found', { status: 404 });
});

beforeEach(() => {
	for (const k of ['ETHERSCAN_API_KEY', 'ALCHEMY_API_KEY', 'CHAINABUSE_API_KEY', 'CHAINALYSIS_API_KEY']) vi.stubEnv(k, '');
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockClear();
	ofac.answer = false;
	goplusDown = false;
	chainalysis = { status: 200, body: { identifications: [] } };
});

const chainalysisCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('chainalysis')).length;

describe('the local OFAC mirror', () => {
	it('read and not on the list: sanctions ran, full scan', async () => {
		const r = await checkWallet(EVM);
		expect(r.coverage.sanctions).toBe('ran');
		expect(r.flags.sanctioned).toBe(false);
		expect(r.partialCoverage).toBe(false);
		expect(r.scamLevel).toBe('clean');
	});

	it('could not be read (null): sanctions error, partial, never a clean full scan', async () => {
		ofac.answer = null;
		const r = await checkWallet(EVM);
		expect(r.coverage.sanctions).toBe('error');
		expect(r.flags.sanctioned).toBe(false);
		expect(r.partialCoverage).toBe(true);
	});

	it('lookup threw: treated the same as could not be read', async () => {
		ofac.answer = 'throw';
		const r = await checkWallet(EVM);
		expect(r.coverage.sanctions).toBe('error');
		expect(r.partialCoverage).toBe(true);
	});

	it('on the list: sanctioned, danger', async () => {
		ofac.answer = true;
		const r = await checkWallet(EVM);
		expect(r.flags.sanctioned).toBe(true);
		expect(r.scamLevel).toBe('danger');
		expect(r.coverage.sanctions).toBe('ran');
	});
});

describe('the Chainalysis fallback', () => {
	it('no key: skipped, never asked, and not listed as a failure', async () => {
		const r = await checkWallet(SOL);
		expect(r.coverage.chainalysis).toBe('skipped');
		expect(chainalysisCalls()).toBe(0);
	});

	it('not needed when GoPlus answered for an EVM address: skipped', async () => {
		vi.stubEnv('CHAINALYSIS_API_KEY', 'test-key');
		const r = await checkWallet(EVM);
		expect(r.coverage.chainalysis).toBe('skipped');
		expect(chainalysisCalls()).toBe(0);
	});

	it('asked and answered with no identification: ran, not sanctioned', async () => {
		vi.stubEnv('CHAINALYSIS_API_KEY', 'test-key');
		const r = await checkWallet(SOL);
		expect(chainalysisCalls()).toBe(1);
		expect(r.coverage.chainalysis).toBe('ran');
		expect(r.flags.sanctioned).toBe(false);
	});

	it('asked and identified: sanctioned', async () => {
		vi.stubEnv('CHAINALYSIS_API_KEY', 'test-key');
		chainalysis = { status: 200, body: { identifications: [{ category: 'sanctions' }] } };
		const r = await checkWallet(SOL);
		expect(r.flags.sanctioned).toBe(true);
		expect(r.scamLevel).toBe('danger');
	});

	it.each([
		['HTTP 500', { status: 500, body: { error: 'boom' } }],
		['HTTP 429', { status: 429, body: { error: 'rate limited' } }],
		['a malformed answer', { status: 200, body: { unexpected: true } }],
		['a network failure', 'throw'],
	] as const)('%s: chainalysis error, partial, never "no match"', async (_label, answer) => {
		vi.stubEnv('CHAINALYSIS_API_KEY', 'test-key');
		goplusDown = true; // Chainalysis is the fallback when GoPlus did not answer
		chainalysis = answer as typeof chainalysis;
		const r = await checkWallet(EVM);
		expect(chainalysisCalls()).toBe(1);
		expect(r.coverage.chainalysis).toBe('error');
		expect(r.flags.sanctioned).toBe(false);
		expect(r.partialCoverage).toBe(true);
	});
});

describe('chainalysisSanctioned', () => {
	it('answers match / clear / unavailable / skipped, and never throws', async () => {
		expect(await chainalysisSanctioned(SOL)).toBe('skipped');
		vi.stubEnv('CHAINALYSIS_API_KEY', 'test-key');
		expect(await chainalysisSanctioned(SOL)).toBe('clear');
		chainalysis = { status: 200, body: { identifications: [{}] } };
		expect(await chainalysisSanctioned(SOL)).toBe('match');
		chainalysis = { status: 503, body: {} };
		expect(await chainalysisSanctioned(SOL)).toBe('unavailable');
		chainalysis = 'throw';
		expect(await chainalysisSanctioned(SOL)).toBe('unavailable');
	});
});

describe('computePartialCoverage', () => {
	const ALL_RAN: WalletCheckResult['coverage'] = { goplus: 'ran', honeypot: 'ran', chainabuse: 'skipped' };

	it('every primary source ran, no sanctions fields (an older result): full', () => {
		expect(computePartialCoverage('evm', ALL_RAN)).toBe(false);
	});

	it('every primary source ran and both sanctions lookups fine: full', () => {
		expect(computePartialCoverage('evm', { ...ALL_RAN, sanctions: 'ran', chainalysis: 'skipped' })).toBe(false);
		expect(computePartialCoverage('evm', { ...ALL_RAN, sanctions: 'ran', chainalysis: 'ran' })).toBe(false);
	});

	it('the OFAC mirror failed: partial, even with every primary source run', () => {
		expect(computePartialCoverage('evm', { ...ALL_RAN, sanctions: 'error' })).toBe(true);
	});

	it('Chainalysis failed: partial', () => {
		expect(computePartialCoverage('evm', { ...ALL_RAN, sanctions: 'ran', chainalysis: 'error' })).toBe(true);
	});
});
