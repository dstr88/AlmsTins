import { beforeEach, describe, expect, it } from 'vitest';
import { XPR_CHAIN_ID, XprUnavailableError, antelopeTimeMs, hyperionIsCurrent, resetXprServerProofs, xprChainPost, xprHyperionGet } from '@/lib/xpr/client';
import { CHAIN, CHAIN2, HYPER, HYPER2, actionsPage, chainServer, fakeFetch, hyperionServer, now } from './fixtures';

/**
 * The XPR client asks public servers, one after another, and trusts an answer only from a server
 * that proved to be XPR Network and current. When none can answer it throws XprUnavailableError:
 * never an empty answer a caller could read as "zero".
 */

beforeEach(() => resetXprServerProofs());

const ok = (r: { status: number; json: unknown }) => r.status === 200;
const balance = { '/v1/chain/get_currency_balance': () => ({ json: ['63.2736 XPR'] }) };

describe('chain API failover', () => {
	it('asks the first server that answers, and only it', async () => {
		const { fetchImpl, calls } = fakeFetch({ [CHAIN]: chainServer(balance), [CHAIN2]: chainServer(balance) });
		const r = await xprChainPost('/v1/chain/get_currency_balance', { account: 'x' }, ok, { fetchImpl, chainServers: [CHAIN, CHAIN2], now });
		expect(r.server).toBe(CHAIN);
		expect(calls.some((c) => c.origin === CHAIN2)).toBe(false);
	});

	it('moves on when a server fails to connect, errors (5xx), is rate limited (429) or times out', async () => {
		for (const bad of [new Error('connect ECONNREFUSED'), { status: 503, json: {} }, { status: 429, json: {} }, 'hang' as const]) {
			resetXprServerProofs();
			const { fetchImpl } = fakeFetch({
				[CHAIN]: (path) => (path === '/v1/chain/get_info' ? { json: { chain_id: XPR_CHAIN_ID, head_block_time: '2026-10-30T16:29:58.500' } } : (bad as never)),
				[CHAIN2]: chainServer(balance),
			});
			const r = await xprChainPost('/v1/chain/get_currency_balance', {}, ok, { fetchImpl, chainServers: [CHAIN, CHAIN2], now });
			expect(r.server, String(JSON.stringify(bad))).toBe(CHAIN2);
		}
	});

	it('skips a server that is on another chain', async () => {
		const { fetchImpl, calls } = fakeFetch({
			[CHAIN]: chainServer(balance, { chain_id: 'ab'.repeat(32) }),
			[CHAIN2]: chainServer(balance),
		});
		const r = await xprChainPost('/v1/chain/get_currency_balance', {}, ok, { fetchImpl, chainServers: [CHAIN, CHAIN2], now });
		expect(r.server).toBe(CHAIN2);
		// The wrong-chain server was asked only for its chain id, never for the balance.
		expect(calls.filter((c) => c.origin === CHAIN).map((c) => c.path)).toEqual(['/v1/chain/get_info']);
	});

	it('skips a server whose head block is more than 15 minutes old', async () => {
		const { fetchImpl } = fakeFetch({
			[CHAIN]: chainServer(balance, { head_block_time: '2026-10-30T15:00:00.000' }),
			[CHAIN2]: chainServer(balance),
		});
		const r = await xprChainPost('/v1/chain/get_currency_balance', {}, ok, { fetchImpl, chainServers: [CHAIN, CHAIN2], now });
		expect(r.server).toBe(CHAIN2);
	});

	it('moves on when a server gives an answer the caller does not accept', async () => {
		const { fetchImpl } = fakeFetch({
			[CHAIN]: chainServer({ '/v1/chain/get_currency_balance': () => ({ json: { surprise: true } }) }),
			[CHAIN2]: chainServer(balance),
		});
		const r = await xprChainPost('/v1/chain/get_currency_balance', {}, (x) => Array.isArray(x.json), { fetchImpl, chainServers: [CHAIN, CHAIN2], now });
		expect(r.server).toBe(CHAIN2);
	});

	it('throws XprUnavailableError, naming each server, when every server fails', async () => {
		const { fetchImpl } = fakeFetch({ [CHAIN]: () => new Error('connect ECONNREFUSED'), [CHAIN2]: () => ({ status: 502, json: {} }) });
		const err = await xprChainPost('/v1/chain/get_currency_balance', {}, ok, { fetchImpl, chainServers: [CHAIN, CHAIN2], now }).catch((e) => e);
		expect(err).toBeInstanceOf(XprUnavailableError);
		expect(err.causes).toHaveLength(2);
		expect(err.causes[0]).toContain('chain.test');
	});

	it('proves a server once, not on every call', async () => {
		const { fetchImpl, calls } = fakeFetch({ [CHAIN]: chainServer(balance) });
		for (let i = 0; i < 3; i++) await xprChainPost('/v1/chain/get_currency_balance', {}, ok, { fetchImpl, chainServers: [CHAIN], now });
		expect(calls.filter((c) => c.path === '/v1/chain/get_info')).toHaveLength(1);
	});
});

describe('Hyperion', () => {
	const route = { '/v2/state/get_tokens': () => ({ json: actionsPage([]) }) };

	it('skips a Hyperion whose node is on another chain, and uses the next', async () => {
		const { fetchImpl } = fakeFetch({ [HYPER]: hyperionServer(route, 'cd'.repeat(32)), [HYPER2]: hyperionServer(route) });
		const r = await xprHyperionGet('/v2/state/get_tokens?account=x', ok, { fetchImpl, hyperionServers: [HYPER, HYPER2], now });
		expect(r.server).toBe(HYPER2);
	});

	it('a Hyperion that does not answer is not an empty history', async () => {
		const { fetchImpl } = fakeFetch({ [HYPER]: () => new Error('connect ECONNREFUSED') });
		await expect(xprHyperionGet('/v2/state/get_tokens?account=x', ok, { fetchImpl, hyperionServers: [HYPER], now })).rejects.toBeInstanceOf(XprUnavailableError);
	});

	it('an index that stopped more than 15 minutes ago is not current', () => {
		expect(hyperionIsCurrent({ last_indexed_block_time: '2026-10-30T16:29:00.000' }, now)).toBe(true);
		expect(hyperionIsCurrent({ last_indexed_block_time: '2026-10-30T15:00:00.000' }, now)).toBe(false);
		expect(hyperionIsCurrent({}, now)).toBe(false);
		expect(hyperionIsCurrent(null, now)).toBe(false);
	});
});

describe('antelopeTimeMs', () => {
	it('reads the chain\'s zone-less timestamps as UTC', () => {
		expect(antelopeTimeMs('2026-10-30T16:25:54.500')).toBe(Date.parse('2026-10-30T16:25:54.500Z'));
		expect(antelopeTimeMs('2026-10-30T16:25:54.000Z')).toBe(Date.parse('2026-10-30T16:25:54.000Z'));
		expect(Number.isNaN(antelopeTimeMs(''))).toBe(true);
		expect(Number.isNaN(antelopeTimeMs('later'))).toBe(true);
	});
});
