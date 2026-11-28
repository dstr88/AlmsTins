import { describe, expect, it, vi } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Standing approvals (src/lib/approvals): decoding each kind of approval event, reading whether it
 * still stands, the "unlimited" rule, each flag, and the whole report built from fake chain data.
 *
 * Hermetic: '@/lib/db' is stubbed (the checker's OFAC mirror imports it), and the report is built
 * with fake transports. No network. Every address and amount here is invented.
 */

vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [] }), batch: async () => [] } }));

import { addressTopic, decodeApprovalLog, endedByLatestEvent, fetchApprovalEvents, latestPerApproval, TOPICS, MAX_LOG_REQUESTS } from '@/lib/approvals/events';
import { checkCurrentState, decodeString, readState, SELECTORS, stateCalls } from '@/lib/approvals/state';
import { flagApproval, INACTIVE_MONTHS, isUnlimitedAmount, monthsBetween, sortApprovals } from '@/lib/approvals/flags';
import { revokeCashUrl, approvalCheckerUrl } from '@/lib/approvals/links';
import { buildReport, checkWalletApprovals } from '@/lib/approvals/index';
import { flaggedApprovalItems, APPROVAL_DIGEST_REASON } from '@/lib/approvals/digest';
import { PERMIT2_ADDRESS } from '@/lib/knownProtocolContracts';
import type { ExplorerLog } from '@/lib/etherscan';
import type { ApprovalSpender, StandingApproval } from '@/lib/approvals/types';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NFT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SPENDER = '0xcccccccccccccccccccccccccccccccccccccccc';
const SPENDER2 = '0xdddddddddddddddddddddddddddddddddddddddd';
const MAX256 = (1n << 256n) - 1n;

const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const hexWords = (...ns: Array<bigint | number>) => `0x${ns.map(word).join('')}`;
const hexAddr = (a: string) => `0x${word(BigInt(a))}`;

function log(partial: Partial<ExplorerLog> & { topics: string[] }): ExplorerLog {
	return {
		address: TOKEN,
		data: '0x',
		blockNumber: '0x10',
		timeStamp: '0x65000000',
		transactionHash: `0x${'e'.repeat(64)}`,
		logIndex: '0x1',
		...partial,
	};
}

const keccak = (s: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(s)))}`;

describe('event topics and function selectors match their signatures', () => {
	it('topics', () => {
		expect(TOPICS.approval).toBe(keccak('Approval(address,address,uint256)'));
		expect(TOPICS.approvalForAll).toBe(keccak('ApprovalForAll(address,address,bool)'));
		expect(TOPICS.permit2Approval).toBe(keccak('Approval(address,address,address,uint160,uint48)'));
		expect(TOPICS.permit2Permit).toBe(keccak('Permit(address,address,address,uint160,uint48,uint48)'));
	});
	it('selectors', () => {
		const sel = (s: string) => keccak(s).slice(0, 10);
		expect(SELECTORS.allowance).toBe(sel('allowance(address,address)'));
		expect(SELECTORS.isApprovedForAll).toBe(sel('isApprovedForAll(address,address)'));
		expect(SELECTORS.getApproved).toBe(sel('getApproved(uint256)'));
		expect(SELECTORS.ownerOf).toBe(sel('ownerOf(uint256)'));
		expect(SELECTORS.permit2Allowance).toBe(sel('allowance(address,address,address)'));
		expect(SELECTORS.symbol).toBe(sel('symbol()'));
		expect(SELECTORS.name).toBe(sel('name()'));
		expect(SELECTORS.decimals).toBe(sel('decimals()'));
	});
});

describe('decoding each kind of approval', () => {
	it('an ERC-20 token approval (3 topics, amount in data)', () => {
		const e = decodeApprovalLog(log({ topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(MAX256) }), OWNER);
		expect(e).toMatchObject({ kind: 'token', token: TOKEN, spender: SPENDER, amount: MAX256, tokenId: null });
		expect(e?.timestamp).toBe(0x65000000);
	});

	it('a single NFT approval (ERC-721, token id as the 4th topic)', () => {
		const e = decodeApprovalLog(
			log({ address: NFT, topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER), `0x${word(4242)}`] }),
			OWNER,
		);
		expect(e).toMatchObject({ kind: 'nft_one', token: NFT, spender: SPENDER, tokenId: '4242', amount: null });
	});

	it('a whole-collection NFT approval (ApprovalForAll)', () => {
		const on = decodeApprovalLog(log({ address: NFT, topics: [TOPICS.approvalForAll, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(1) }), OWNER);
		const off = decodeApprovalLog(log({ address: NFT, topics: [TOPICS.approvalForAll, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(0) }), OWNER);
		expect(on).toMatchObject({ kind: 'nft_all', token: NFT, spender: SPENDER, approved: true });
		expect(off?.approved).toBe(false);
	});

	it('a Uniswap Permit2 allowance, from its Approval and Permit events', () => {
		const topics = (t0: string) => [t0, addressTopic(OWNER), addressTopic(TOKEN), addressTopic(SPENDER)];
		const a = decodeApprovalLog(log({ address: PERMIT2_ADDRESS, topics: topics(TOPICS.permit2Approval), data: hexWords(500, 1_900_000_000) }), OWNER);
		const p = decodeApprovalLog(log({ address: PERMIT2_ADDRESS, topics: topics(TOPICS.permit2Permit), data: hexWords(700, 1_900_000_001, 3) }), OWNER);
		expect(a).toMatchObject({ kind: 'permit2', token: TOKEN, spender: SPENDER, amount: 500n, expiration: 1_900_000_000 });
		expect(p).toMatchObject({ kind: 'permit2', amount: 700n, expiration: 1_900_000_001 });
	});

	it('a Permit2-shaped event from any other contract is ignored', () => {
		const e = decodeApprovalLog(
			log({ address: TOKEN, topics: [TOPICS.permit2Approval, addressTopic(OWNER), addressTopic(TOKEN), addressTopic(SPENDER)], data: hexWords(5, 5) }),
			OWNER,
		);
		expect(e).toBeNull();
	});

	it("another owner's event, an unknown event and malformed data are ignored", () => {
		expect(decodeApprovalLog(log({ topics: [TOPICS.approval, addressTopic(OTHER), addressTopic(SPENDER)], data: hexWords(1) }), OWNER)).toBeNull();
		expect(decodeApprovalLog(log({ topics: [`0x${'1'.repeat(64)}`, addressTopic(OWNER)] }), OWNER)).toBeNull();
		expect(decodeApprovalLog(log({ topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: '0x12' }), OWNER)).toBeNull();
	});

	it('keeps only the newest event for each approval', () => {
		const older = decodeApprovalLog(log({ blockNumber: '0x10', topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(MAX256) }), OWNER)!;
		const newer = decodeApprovalLog(log({ blockNumber: '0x20', topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(0) }), OWNER)!;
		const latest = latestPerApproval([newer, older]);
		expect(latest).toHaveLength(1);
		expect(latest[0].amount).toBe(0n);
		expect(endedByLatestEvent(latest[0], 1_800_000_000)).toBe(true);
	});

	it('a full page splits the range, newest half first, and a spent budget makes the list partial', async () => {
		const full = Array.from({ length: 1000 }, () => log({ topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(1) }));
		const calls: Array<[number, number]> = [];
		const fetchPage = vi.fn(async ({ topics, fromBlock, toBlock }: { topics: Array<string | null>; fromBlock: number; toBlock: number }) => {
			if (topics[0] !== TOPICS.approval) return [];
			calls.push([fromBlock, toBlock]);
			return full;
		});
		const res = await fetchApprovalEvents(1, OWNER, { fetchPage: fetchPage as never, latestBlock: async () => 100_000_000 });
		expect(res.complete).toBe(false);
		expect(calls.length).toBe(MAX_LOG_REQUESTS);
		expect(calls[0]).toEqual([0, 100_000_000]);
		// After the whole range, the newest half is read before the oldest.
		expect(calls[1][1]).toBe(100_000_000);
		expect(calls[1][0]).toBeGreaterThan(0);
		// The other queries still ran (each has its own budget).
		expect(fetchPage.mock.calls.length).toBe(MAX_LOG_REQUESTS + 3);
	});

	it('a wallet with few approvals is read in one request per query', async () => {
		const fetchPage = vi.fn(async () => [log({ topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(1) })]);
		const res = await fetchApprovalEvents(1, OWNER, { fetchPage: fetchPage as never, latestBlock: async () => 100_000_000 });
		expect(res.complete).toBe(true);
		expect(fetchPage).toHaveBeenCalledTimes(4);
	});

	it('splits a block range the explorer refuses as too wide, and reads every part', async () => {
		const hit = log({ topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(1) });
		const ranges: Array<[number, number]> = [];
		const fetchPage = vi.fn(async ({ topics, fromBlock, toBlock }: { topics: Array<string | null>; fromBlock: number; toBlock: number }) => {
			if (topics[0] !== TOPICS.approval) return [];
			if (toBlock - fromBlock + 1 > 30_000_000) throw new Error('snowtrace NOTOK: Timeout reached, please use a narrower block range | result=null');
			ranges.push([fromBlock, toBlock]);
			return [hit];
		});
		const res = await fetchApprovalEvents(43114, OWNER, { fetchPage: fetchPage as never, latestBlock: async () => 100_000_000 });
		expect(res.complete).toBe(true);
		// Newest first, and together the parts cover block 0 to the newest with no gap or overlap.
		expect(ranges[0][1]).toBe(100_000_000);
		const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
		expect(sorted[0][0]).toBe(0);
		expect(sorted[sorted.length - 1][1]).toBe(100_000_000);
		for (let i = 1; i < sorted.length; i++) expect(sorted[i][0]).toBe(sorted[i - 1][1] + 1);
		expect(res.events).toHaveLength(ranges.length);
	});

	it('any other explorer failure makes the chain unreadable (it throws)', async () => {
		const fetchPage = async () => {
			throw new Error('etherscan HTTP 502');
		};
		await expect(fetchApprovalEvents(1, OWNER, { fetchPage: fetchPage as never, latestBlock: async () => 10 })).rejects.toThrow('502');
	});
});

describe('whether an approval still stands', () => {
	const token = decodeApprovalLog(log({ topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(MAX256) }), OWNER)!;
	const nftOne = decodeApprovalLog(log({ address: NFT, topics: [TOPICS.approval, addressTopic(OWNER), addressTopic(SPENDER), `0x${word(7)}`] }), OWNER)!;
	const nftAll = decodeApprovalLog(log({ address: NFT, topics: [TOPICS.approvalForAll, addressTopic(OWNER), addressTopic(SPENDER)], data: hexWords(1) }), OWNER)!;
	const permit = decodeApprovalLog(
		log({ address: PERMIT2_ADDRESS, topics: [TOPICS.permit2Approval, addressTopic(OWNER), addressTopic(TOKEN), addressTopic(SPENDER)], data: hexWords(500, 1_900_000_000) }),
		OWNER,
	)!;
	const NOW = 1_800_000_000;

	it('asks the right function of the right contract', () => {
		expect(stateCalls(token, OWNER)).toEqual([{ to: TOKEN, data: `${SELECTORS.allowance}${word(BigInt(OWNER))}${word(BigInt(SPENDER))}` }]);
		expect(stateCalls(permit, OWNER)[0].to).toBe(PERMIT2_ADDRESS);
		expect(stateCalls(nftOne, OWNER).map((c) => c.data.slice(0, 10))).toEqual([SELECTORS.getApproved, SELECTORS.ownerOf]);
	});

	it('a canceled token approval drops off (allowance now 0)', () => {
		expect(readState(token, OWNER, [hexWords(0)], NOW)).toEqual({ status: 'ended' });
		expect(readState(token, OWNER, [hexWords(25)], NOW)).toEqual({ status: 'in_force', amount: 25n, expiration: null });
	});

	it('a withdrawn collection approval drops off', () => {
		expect(readState(nftAll, OWNER, [hexWords(0)], NOW).status).toBe('ended');
		expect(readState(nftAll, OWNER, [hexWords(1)], NOW).status).toBe('in_force');
	});

	it('a single NFT approval counts only while the same spender is approved and the wallet holds the NFT', () => {
		expect(readState(nftOne, OWNER, [hexAddr(SPENDER), hexAddr(OWNER)], NOW).status).toBe('in_force');
		expect(readState(nftOne, OWNER, [hexAddr(SPENDER2), hexAddr(OWNER)], NOW).status).toBe('ended');
		expect(readState(nftOne, OWNER, [hexAddr(SPENDER), hexAddr(OTHER)], NOW).status).toBe('ended');
		expect(readState(nftOne, OWNER, [null, null], NOW).status).toBe('unknown');
	});

	it('a Permit2 allowance past its expiry or at 0 drops off; otherwise it shows its expiry', () => {
		expect(readState(permit, OWNER, [hexWords(500, NOW + 100, 0)], NOW)).toEqual({ status: 'in_force', amount: 500n, expiration: NOW + 100 });
		expect(readState(permit, OWNER, [hexWords(500, NOW - 1, 0)], NOW).status).toBe('ended');
		expect(readState(permit, OWNER, [hexWords(0, NOW + 100, 0)], NOW).status).toBe('ended');
	});

	it("a call that fails is \"couldn't check\", never dropped", async () => {
		expect(readState(token, OWNER, [null], NOW).status).toBe('unknown');
		const states = await checkCurrentState([token, nftAll], OWNER, async () => {
			throw new Error('node down');
		}, NOW);
		expect(states.map((s) => s.status)).toEqual(['unknown', 'unknown']);
	});

	it('reads token names, dynamic or bytes32', () => {
		const dyn = `0x${word(32)}${word(4)}${Buffer.from('USDX').toString('hex').padEnd(64, '0')}`;
		expect(decodeString(dyn)).toBe('USDX');
		expect(decodeString(`0x${Buffer.from('OLD').toString('hex').padEnd(64, '0')}`)).toBe('OLD');
		expect(decodeString(null)).toBeNull();
	});
});

describe('unlimited and the flags', () => {
	const NOW = Date.parse('2026-11-28T00:00:00Z');

	it('unlimited: the max of each common integer size, or anything at or above 2^200', () => {
		for (const bits of [96, 112, 128, 160, 256]) expect(isUnlimitedAmount((1n << BigInt(bits)) - 1n)).toBe(true);
		expect(isUnlimitedAmount(MAX256 - 12345n)).toBe(true);
		expect(isUnlimitedAmount(1_000_000n * 10n ** 18n)).toBe(false);
		expect(isUnlimitedAmount(null)).toBe(false);
	});

	it('flag (a): an unlimited amount, or a whole collection', () => {
		expect(flagApproval({ kind: 'token', amount: MAX256, lastActiveAt: null, checkerHits: [] }, NOW)).toEqual({ group: 'revoke_first', reasons: [{ code: 'unlimited' }] });
		expect(flagApproval({ kind: 'nft_all', amount: null, lastActiveAt: null, checkerHits: [] }, NOW).reasons).toEqual([{ code: 'unlimited' }]);
		expect(flagApproval({ kind: 'nft_one', amount: null, lastActiveAt: null, checkerHits: [] }, NOW).reasons).toEqual([]);
	});

	it('flag (b): no transaction in 12 months or more', () => {
		expect(monthsBetween(Date.parse('2025-09-15T00:00:00Z'), NOW)).toBe(14);
		const old = flagApproval({ kind: 'token', amount: 10n, lastActiveAt: '2025-09-15T00:00:00Z', checkerHits: [] }, NOW);
		expect(old).toEqual({ group: 'revoke_first', reasons: [{ code: 'inactive', months: 14 }] });
		const recent = flagApproval({ kind: 'token', amount: 10n, lastActiveAt: '2026-01-01T00:00:00Z', checkerHits: [] }, NOW);
		expect(recent.reasons).toEqual([]);
		expect(INACTIVE_MONTHS).toBe(12);
	});

	it('flag (c): the wallet checker flags the spender', () => {
		const f = flagApproval({ kind: 'token', amount: 10n, lastActiveAt: null, checkerHits: ['phishing', 'sanctioned'] }, NOW);
		expect(f).toEqual({ group: 'revoke_first', reasons: [{ code: 'checker', hits: ['phishing', 'sanctioned'] }] });
	});

	it('no flag is "still a risk", never a safe or ok state', () => {
		const f = flagApproval({ kind: 'token', amount: 10n, lastActiveAt: '2026-11-01T00:00:00Z', checkerHits: [] }, NOW);
		expect(f.group).toBe('still_a_risk');
	});
});

describe('links to cancel', () => {
	it('revoke.cash opens this wallet on this network', () => {
		expect(revokeCashUrl('ethereum', OWNER)).toBe(`https://revoke.cash/address/${OWNER}?chainId=1`);
		expect(revokeCashUrl('polygon', OWNER)).toContain('chainId=137');
		expect(revokeCashUrl('avalanche', OWNER)).toContain('chainId=43114');
		expect(revokeCashUrl('arbitrum', OWNER)).toContain('chainId=42161');
		expect(approvalCheckerUrl('ethereum')).toBe('https://etherscan.io/tokenapprovalchecker');
	});
});

describe('the whole report, from fake chain data', () => {
	const NOW = Date.parse('2026-11-28T00:00:00Z');
	const nowS = Math.floor(NOW / 1000);

	// Ethereum: an unlimited USDX approval still in force, one canceled since (allowance 0), and an
	// approval whose call fails. Polygon: nothing. Avalanche: the explorer is down. Arbitrum: a small one.
	const events = async (chainId: number) => {
		if (chainId === 43114) throw new Error('explorer down');
		const mk = (spender: string, token = TOKEN, block = 1) => ({
			kind: 'token' as const, token, spender, tokenId: null, amount: MAX256, approved: null, expiration: null,
			timestamp: nowS - 86_400 * 400, blockNumber: block, logIndex: 0, txHash: `0x${'f'.repeat(64)}`,
		});
		if (chainId === 1) return { events: [mk(SPENDER, TOKEN, 3), mk(SPENDER2, TOKEN, 2), mk(SPENDER, NFT, 1)], complete: true };
		if (chainId === 42161) return { events: [{ ...mk(SPENDER), amount: 5n }], complete: true };
		return { events: [], complete: true };
	};
	const caller = (chain: string) => async (calls: Array<{ to: string; data: string }>) =>
		calls.map((c) => {
			if (c.data === SELECTORS.symbol) return `0x${word(32)}${word(4)}${Buffer.from('USDX').toString('hex').padEnd(64, '0')}`;
			if (c.data === SELECTORS.name) return null;
			if (c.data === SELECTORS.decimals) return hexWords(6);
			if (chain === 'arbitrum') return hexWords(5_000_000);
			if (c.to === NFT) return null; // the call fails
			return c.data.includes(SPENDER2.slice(2)) ? hexWords(0) : hexWords(MAX256);
		});
	const spender = async (_chainId: number, address: string): Promise<ApprovalSpender> => ({
		address, name: address === SPENDER ? 'Example Router' : null, nameSource: address === SPENDER ? 'known' : null,
		lastActiveAt: '2026-11-01T00:00:00Z', lastActiveRead: true, checker: { hits: [], complete: true, goplus: true },
	});

	it('lists what stands, drops the canceled one, keeps the unreadable one as couldn\'t check, and says which chain failed', async () => {
		const report = await checkWalletApprovals('w-1', OWNER, { fetchEvents: events as never, caller: caller as never, spender, now: () => NOW });
		const groups = report.approvals.map((a) => [a.chain, a.spender.address, a.group]);
		expect(groups).toEqual([
			['ethereum', SPENDER, 'revoke_first'],
			['arbitrum', SPENDER, 'still_a_risk'],
			['ethereum', SPENDER, 'unknown'],
		]);
		expect(report.approvals.find((a) => a.spender.address === SPENDER2)).toBeUndefined();
		expect(report.approvals[1].amountText).toBe('5');
		expect(report.chains.find((c) => c.chain === 'avalanche')?.status).toBe('unavailable');
		expect(report.chains.find((c) => c.chain === 'polygon')?.status).toBe('read');
		expect(report.counts).toEqual({ total: 3, revokeFirst: 1, stillARisk: 1, unknown: 1 });
		expect(report.approvals[0].links.revoke).toBe(revokeCashUrl('ethereum', OWNER));
	});

	it('the monthly check-up lists only the "Revoke first" ones, in the digest item shape', async () => {
		const report = await checkWalletApprovals('w-1', OWNER, { fetchEvents: events as never, caller: caller as never, spender, now: () => NOW });
		const items = flaggedApprovalItems(report, 'w-1');
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ sourceType: 'approval', reason: APPROVAL_DIGEST_REASON, amountUsd: null, counterparty: SPENDER });
		expect(items[0].description).toBe('Standing approval on Ethereum: Example Router can spend USDX (Unlimited). Cancel it on revoke.cash.');
		expect(items[0].sourceId.startsWith('w-1:')).toBe(true);
	});

	it('sorts "Revoke first", then "Still a risk", then "Couldn\'t check"', () => {
		const base = { reasons: [], givenAt: null } as unknown as StandingApproval;
		const sorted = sortApprovals([
			{ ...base, id: 'c', group: 'unknown' },
			{ ...base, id: 'b', group: 'still_a_risk' },
			{ ...base, id: 'a', group: 'revoke_first', reasons: [{ code: 'unlimited' }] },
		] as StandingApproval[]);
		expect(sorted.map((a) => a.group)).toEqual(['revoke_first', 'still_a_risk', 'unknown']);
	});
});

describe('a slow chain never holds the check', () => {
	it('a chain past its deadline is reported as couldn\'t be read, and the rest are listed', async () => {
		const fetchEvents = (chainId: number) =>
			chainId === 43114 ? new Promise<never>(() => {}) : Promise.resolve({ events: [], complete: true });
		const seen: number[] = [];
		const started = Date.now();
		const report = await checkWalletApprovals('w-1', OWNER, {
			fetchEvents: fetchEvents as never,
			caller: (() => async () => []) as never,
			chainDeadlineMs: 80,
			onChain: (i) => seen.push(i),
		});
		expect(Date.now() - started).toBeLessThan(1000);
		expect(report.complete).toBe(true);
		expect(report.chains.map((c) => c.status)).toEqual(['read', 'read', 'unavailable', 'read']);
		expect(seen.sort()).toEqual([0, 1, 2, 3]);
	});

	it('the report so far marks unread chains pending and is not complete', () => {
		const r = buildReport('w-1', OWNER, [{ status: 'read', approvals: [] }, undefined, undefined, { status: 'partial', approvals: [] }], Date.now());
		expect(r.complete).toBe(false);
		expect(r.chains.map((c) => c.status)).toEqual(['read', 'pending', 'pending', 'partial']);
	});
});
