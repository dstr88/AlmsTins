import { beforeEach, describe, expect, it } from 'vitest';
import { XprUnavailableError, resetXprServerProofs } from '@/lib/xpr/client';
import { xprAccountStatus } from '@/lib/xpr/account';
import { fetchXprBalances, parseAssetString } from '@/lib/xpr/balances';
import { isXprNativeAsset, xprAssetSymbol, xprContractOfAsset } from '@/lib/xpr/assets';
import { ALICE, CHAIN, CHAIN2, HYPER, chainServer, fakeFetch, hyperionServer, now, tokens } from './fixtures';

beforeEach(() => resetXprServerProofs());

/** get_account answers as the chain gives them: the account (200), or an Antelope error (400). */
const account = (extra: Record<string, unknown> = {}) => ({ json: { account_name: ALICE, head_block_num: 1, voter_info: { owner: ALICE, staked: 0 }, refund_request: null, ...extra } });
const unknownAccount = { status: 400, json: { code: 400, message: 'Account lookup', error: { code: 3060002, name: 'account_query_exception', what: 'Account Query Exception' } } };
const invalidName = { status: 400, json: { code: 400, message: 'Invalid Request', error: { code: 3200006, name: 'invalid_http_request' } } };

describe('account existence is asked of the chain, never decided by shape', () => {
	it('exists / missing / invalid', async () => {
		const { fetchImpl } = fakeFetch({
			[CHAIN]: chainServer({ '/v1/chain/get_account': (b) => (b.account_name === ALICE ? account() : b.account_name === 'badshape' ? invalidName : unknownAccount) }),
		});
		const opts = { fetchImpl, chainServers: [CHAIN], now };
		expect(await xprAccountStatus(ALICE, opts)).toBe('exists');
		expect(await xprAccountStatus('testnobody1', opts)).toBe('missing');
		// A name of the right shape the server still refuses as not normalized: invalid.
		expect(await xprAccountStatus('badshape', opts)).toBe('invalid');
	});

	it('a name with the wrong shape is invalid without asking anyone', async () => {
		const { fetchImpl, calls } = fakeFetch({ [CHAIN]: chainServer({}) });
		expect(await xprAccountStatus('Alice!', { fetchImpl, chainServers: [CHAIN], now })).toBe('invalid');
		expect(await xprAccountStatus('abc.', { fetchImpl, chainServers: [CHAIN], now })).toBe('invalid');
		expect(calls).toHaveLength(0);
	});

	it('is case-insensitive about what was typed', async () => {
		const { fetchImpl, calls } = fakeFetch({ [CHAIN]: chainServer({ '/v1/chain/get_account': () => account() }) });
		expect(await xprAccountStatus(` ${ALICE.toUpperCase()} `, { fetchImpl, chainServers: [CHAIN], now })).toBe('exists');
		expect(calls.find((c) => c.path === '/v1/chain/get_account')?.body).toEqual({ account_name: ALICE });
	});

	it('when no server answers it throws: an outage is never "missing"', async () => {
		const { fetchImpl } = fakeFetch({ [CHAIN]: () => new Error('connect ECONNREFUSED') });
		await expect(xprAccountStatus(ALICE, { fetchImpl, chainServers: [CHAIN], now })).rejects.toBeInstanceOf(XprUnavailableError);
	});

	it('a server that fails is skipped; the next one decides', async () => {
		const { fetchImpl } = fakeFetch({
			[CHAIN]: chainServer({ '/v1/chain/get_account': () => ({ status: 500, json: {} }) }),
			[CHAIN2]: chainServer({ '/v1/chain/get_account': () => unknownAccount }),
		});
		expect(await xprAccountStatus(ALICE, { fetchImpl, chainServers: [CHAIN, CHAIN2], now })).toBe('missing');
	});
});

describe('assets are a contract and a symbol', () => {
	it('only the XPR of eosio.token is the chain\'s own coin', () => {
		expect(isXprNativeAsset('XPR', 'eosio.token')).toBe(true);
		expect(isXprNativeAsset('xpr', 'EOSIO.TOKEN')).toBe(true);
		expect(isXprNativeAsset('XPR', 'fakecontract')).toBe(false);
		expect(isXprNativeAsset('XUSDC', 'eosio.token')).toBe(false);
	});

	it('every other token is SYMBOL@contract, so a look-alike never merges with the real one', () => {
		expect(xprAssetSymbol('XPR', 'eosio.token')).toBe('XPR');
		expect(xprAssetSymbol('XPR', 'fakecontract')).toBe('XPR@fakecontract');
		expect(xprAssetSymbol('xusdc', 'xtokens')).toBe('XUSDC@xtokens');
		expect(xprAssetSymbol('XUSDC', 'scamtoken1')).not.toBe(xprAssetSymbol('XUSDC', 'xtokens'));
		expect(xprContractOfAsset('XUSDC@xtokens')).toBe('xtokens');
		expect(xprContractOfAsset('XPR')).toBe('eosio.token');
		expect(xprContractOfAsset('BTC')).toBeNull();
	});
});

describe('balances', () => {
	const setup = (o: {
		balance?: unknown;
		list?: Array<{ symbol: string; contract: string; amount: number; precision?: number }>;
		acct?: ReturnType<typeof account>;
		hyperion?: 'down' | 'ok';
	}) =>
		fakeFetch({
			[CHAIN]: chainServer({
				'/v1/chain/get_currency_balance': () => ({ json: o.balance ?? ['63.2736 XPR'] }),
				'/v1/chain/get_account': () => o.acct ?? account(),
			}),
			...(o.hyperion === 'down' ? {} : { [HYPER]: hyperionServer({ '/v2/state/get_tokens': () => ({ json: tokens(o.list ?? [{ symbol: 'XPR', contract: 'eosio.token', amount: 63.2736 }]) }) }) }),
		});
	const servers = (o: Parameters<typeof setup>[0]) => setup(o);
	const readWith = (o: Parameters<typeof setup>[0]) => {
		const { fetchImpl } = servers(o);
		return fetchXprBalances(ALICE, { fetchImpl, chainServers: [CHAIN], hyperionServers: [HYPER], now });
	};

	it('parses an asset string, and refuses another symbol', () => {
		expect(parseAssetString('63.2736 XPR', 'XPR')).toBe(63.2736);
		expect(parseAssetString('63.2736 XUSDC', 'XPR')).toBeNull();
		expect(parseAssetString('lots', 'XPR')).toBeNull();
		expect(parseAssetString(undefined, 'XPR')).toBeNull();
	});

	it('the chain\'s own coin is liquid + staked + unstaking; the stake is in 1/10000 XPR', async () => {
		const b = await readWith({
			balance: ['10.5000 XPR'],
			acct: account({ voter_info: { staked: '25000000' }, refund_request: { owner: ALICE, net_amount: '1.2500 XPR', cpu_amount: '0.7500 XPR' } }),
		});
		expect(b.liquid).toBe(10.5);
		expect(b.staked).toBe(2500);
		expect(b.unstaking).toBe(2);
		expect(b.native).toBe(2512.5);
	});

	it('an account that never held XPR has a real zero (an empty list), not an error', async () => {
		const b = await readWith({ balance: [], list: [] });
		expect(b.native).toBe(0);
		expect(b.tokens).toEqual([]);
	});

	it('lists every other token by contract and symbol, and keeps a fake XPR apart from the real coin', async () => {
		const b = await readWith({
			list: [
				{ symbol: 'XPR', contract: 'eosio.token', amount: 63.2736 },
				{ symbol: 'XUSDC', contract: 'xtokens', amount: 12.5, precision: 6 },
				{ symbol: 'XPR', contract: 'fakecontract', amount: 1000 },
				{ symbol: 'DUST', contract: 'spamairdrop', amount: 0 },
			],
		});
		expect(b.tokens.map((t) => t.symbol)).toEqual(['XUSDC@xtokens', 'XPR@fakecontract']);
		expect(b.tokens[0]).toMatchObject({ contract: 'xtokens', amount: 12.5, precision: 6 });
		expect(b.native).toBe(63.2736);
	});

	it('when no chain server can answer, the read is unavailable: never a partial balance', async () => {
		const { fetchImpl } = fakeFetch({
			[CHAIN]: () => new Error('connect ECONNREFUSED'),
			[HYPER]: hyperionServer({ '/v2/state/get_tokens': () => ({ json: tokens([{ symbol: 'XPR', contract: 'eosio.token', amount: 5.25 }]) }) }),
		});
		await expect(fetchXprBalances(ALICE, { fetchImpl, chainServers: [CHAIN], hyperionServers: [HYPER], now })).rejects.toBeInstanceOf(XprUnavailableError);
	});

	it('when Hyperion cannot be reached the read is unavailable, never a balance without its tokens', async () => {
		await expect(readWith({ hyperion: 'down' })).rejects.toBeInstanceOf(XprUnavailableError);
	});

	it('refuses a name that is not shaped like one', async () => {
		await expect(fetchXprBalances('Not A Name')).rejects.toThrow('not an XPR account name');
	});
});
