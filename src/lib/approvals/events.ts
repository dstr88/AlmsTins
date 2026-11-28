/**
 * Finding every approval a wallet ever gave, from public event logs read by address. No wallet
 * connection: the owner is an indexed topic in each event, so one logs query per event type per chain
 * finds them all.
 *
 *   Approval(address indexed owner, address indexed spender, uint256 value)           ERC-20, 3 topics
 *   Approval(address indexed owner, address indexed approved, uint256 indexed tokenId) ERC-721, 4 topics
 *   ApprovalForAll(address indexed owner, address indexed operator, bool approved)     ERC-721 and ERC-1155
 *   Permit2 Approval(owner, token, spender indexed; uint160 amount, uint48 expiration)
 *   Permit2 Permit(owner, token, spender indexed; uint160 amount, uint48 expiration, uint48 nonce)
 *
 * An event only says an approval was given once. Whether it still stands is asked of the contract
 * now (state.ts). The decoding here is pure; fetchApprovalEvents does the reading.
 */

import { getLatestBlockNumber, getLogsPage, isLogsRangeTooWide, LOGS_PAGE_SIZE, type ExplorerLog } from '@/lib/etherscan';
import { PERMIT2_ADDRESS } from '@/lib/knownProtocolContracts';
import type { ApprovalKind } from './types';

/** keccak256 of each event signature (tests/approvals/approvals.test.ts recomputes them). */
export const TOPICS = {
	approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
	approvalForAll: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
	permit2Approval: '0xda9fa7c1b00402c17d0161b249b1ab8bbec047c5a52207b9c112deffd817036b',
	permit2Permit: '0xc6a377bfc4eb120024a8ac08eef205be16b817020812c73223e81d1bdb9708ec',
} as const;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Pages read for one block range that can't be split further, before the list is called partial. */
export const MAX_LOG_PAGES = 5;
/**
 * A logs query over a chain's whole history can be refused as too wide (Routescan refuses all of
 * Avalanche's ~100 million blocks, and answers a 30 million block range in about 12 seconds; checked
 * Nov 28, 2026). A refused range, or one with a full page of logs, is split in half and each half
 * read, newest first, down to this size.
 */
export const MIN_LOG_RANGE = 250_000;
/**
 * Logs requests per query (four queries per chain) for one wallet. A wallet run by a bot can have tens of
 * thousands of approval events; past this budget the list is called partial. Newest ranges are read
 * first, so what is cut is the oldest history. Each query has its own budget, so a long token history
 * never stops the NFT and Permit2 queries from running.
 */
export const MAX_LOG_REQUESTS = 16;

export interface ApprovalEvent {
	kind: ApprovalKind;
	/** The token or NFT contract. */
	token: string;
	spender: string;
	/** `nft_one`: the NFT id (decimal string). */
	tokenId: string | null;
	/** `token` and `permit2`: the amount in the event. */
	amount: bigint | null;
	/** `nft_all`: true when given, false when withdrawn. */
	approved: boolean | null;
	/** `permit2`: expiry in Unix seconds. */
	expiration: number | null;
	timestamp: number;
	blockNumber: number;
	logIndex: number;
	txHash: string;
}

/** A 32-byte topic holding an address (left-padded with zeros). */
export function addressTopic(address: string): string {
	return `0x${'0'.repeat(24)}${String(address).trim().toLowerCase().replace(/^0x/, '')}`;
}

function topicToAddress(topic: string | undefined): string | null {
	const t = String(topic ?? '').toLowerCase();
	if (!/^0x[0-9a-f]{64}$/.test(t)) return null;
	return `0x${t.slice(26)}`;
}

/** The n-th 32-byte word of hex data, or null when the data is too short. */
export function dataWord(data: string, n: number): string | null {
	const hex = String(data ?? '').toLowerCase().replace(/^0x/, '');
	const word = hex.slice(n * 64, n * 64 + 64);
	return word.length === 64 && /^[0-9a-f]+$/.test(word) ? word : null;
}

function hexNumber(v: string | undefined): number {
	const s = String(v ?? '').trim();
	if (!s) return 0;
	const n = s.startsWith('0x') ? parseInt(s, 16) : Number(s);
	return Number.isFinite(n) ? n : 0;
}

/**
 * One log as an approval event, or null when it isn't one this module reads (a different event,
 * malformed topics, or an event for another owner).
 */
export function decodeApprovalLog(log: ExplorerLog, owner: string): ApprovalEvent | null {
	const topics = Array.isArray(log?.topics) ? log.topics.map((t) => String(t ?? '').toLowerCase()) : [];
	const topic0 = topics[0];
	const ownerLower = owner.toLowerCase();
	const base = {
		timestamp: hexNumber(log.timeStamp),
		blockNumber: hexNumber(log.blockNumber),
		logIndex: hexNumber(log.logIndex),
		txHash: String(log.transactionHash ?? '').toLowerCase(),
	};
	const contract = String(log.address ?? '').toLowerCase();

	if (topic0 === TOPICS.approval) {
		if (topicToAddress(topics[1]) !== ownerLower) return null;
		const spender = topicToAddress(topics[2]);
		if (!spender) return null;
		if (topics.length === 4) {
			// ERC-721: the token id is the third indexed value.
			return { kind: 'nft_one', token: contract, spender, tokenId: BigInt(topics[3]).toString(), amount: null, approved: null, expiration: null, ...base };
		}
		if (topics.length !== 3) return null;
		const word = dataWord(log.data, 0);
		if (word === null) return null;
		return { kind: 'token', token: contract, spender, tokenId: null, amount: BigInt(`0x${word}`), approved: null, expiration: null, ...base };
	}

	if (topic0 === TOPICS.approvalForAll) {
		if (topics.length !== 3 || topicToAddress(topics[1]) !== ownerLower) return null;
		const operator = topicToAddress(topics[2]);
		const word = dataWord(log.data, 0);
		if (!operator || word === null) return null;
		return { kind: 'nft_all', token: contract, spender: operator, tokenId: null, amount: null, approved: BigInt(`0x${word}`) !== 0n, expiration: null, ...base };
	}

	if (topic0 === TOPICS.permit2Approval || topic0 === TOPICS.permit2Permit) {
		if (contract !== PERMIT2_ADDRESS || topics.length !== 4) return null;
		if (topicToAddress(topics[1]) !== ownerLower) return null;
		const token = topicToAddress(topics[2]);
		const spender = topicToAddress(topics[3]);
		const amount = dataWord(log.data, 0);
		const expiration = dataWord(log.data, 1);
		if (!token || !spender || amount === null || expiration === null) return null;
		return { kind: 'permit2', token, spender, tokenId: null, amount: BigInt(`0x${amount}`), approved: null, expiration: Number(BigInt(`0x${expiration}`)), ...base };
	}

	return null;
}

/** The key one approval is known by: an NFT has one approved address at a time, so its key leaves the spender out. */
export function approvalKey(e: Pick<ApprovalEvent, 'kind' | 'token' | 'spender' | 'tokenId'>): string {
	return e.kind === 'nft_one' ? `nft_one:${e.token}:${e.tokenId}` : `${e.kind}:${e.token}:${e.spender}`;
}

function isLater(a: ApprovalEvent, b: ApprovalEvent): boolean {
	return a.blockNumber !== b.blockNumber ? a.blockNumber > b.blockNumber : a.logIndex > b.logIndex;
}

/** The newest event for each approval. */
export function latestPerApproval(events: ApprovalEvent[]): ApprovalEvent[] {
	const latest = new Map<string, ApprovalEvent>();
	for (const e of events) {
		const k = approvalKey(e);
		const seen = latest.get(k);
		if (!seen || isLater(e, seen)) latest.set(k, e);
	}
	return [...latest.values()];
}

/**
 * Whether the newest event already says the approval is gone, so the contract needn't be asked:
 * an allowance set to 0, a collection approval withdrawn, a single NFT approval cleared, or a
 * Permit2 allowance at 0 or past its expiry. Anything else is asked of the contract (state.ts),
 * since an allowance can be spent down, or a Permit2 allowance locked down, without a new event here.
 */
export function endedByLatestEvent(e: ApprovalEvent, nowSeconds: number): boolean {
	switch (e.kind) {
		case 'token':
			return e.amount === 0n;
		case 'nft_all':
			return e.approved === false;
		case 'nft_one':
			return e.spender === ZERO_ADDRESS;
		case 'permit2':
			return e.amount === 0n || (e.expiration !== null && e.expiration < nowSeconds);
	}
}

type LogQuery = { topics: Array<string | null>; address?: string };

/** The four logs queries for one owner on one chain. */
export function approvalLogQueries(owner: string): LogQuery[] {
	const o = addressTopic(owner);
	return [
		{ topics: [TOPICS.approval, o] },
		{ topics: [TOPICS.approvalForAll, o] },
		{ topics: [TOPICS.permit2Approval, o], address: PERMIT2_ADDRESS },
		{ topics: [TOPICS.permit2Permit, o], address: PERMIT2_ADDRESS },
	];
}

/**
 * Every approval event for this owner on one chain, from block 0 to the newest. The explorer lists logs
 * oldest first, so a range with a full page is split in half (newest half first) rather than paged,
 * until it is small; a range the explorer refuses as too wide is split the same way. `complete` is false
 * when the request budget or the page limit cut the reading short (the oldest history is what's missing).
 * Any other failure throws: the chain couldn't be read.
 */
export async function fetchApprovalEvents(
	chainId: number,
	owner: string,
	opts: { requestId?: string; fetchPage?: typeof getLogsPage; latestBlock?: () => Promise<number> } = {},
): Promise<{ events: ApprovalEvent[]; complete: boolean }> {
	const fetchPage = opts.fetchPage ?? getLogsPage;
	const latest = await (opts.latestBlock ?? (() => getLatestBlockNumber({ chainId, requestId: opts.requestId })))();
	const events: ApprovalEvent[] = [];
	let complete = true;
	let requests = 0; // reset for each query below

	const take = (logs: ExplorerLog[]) => {
		for (const log of logs) {
			const e = decodeApprovalLog(log, owner);
			if (e) events.push(e);
		}
	};

	const readRange = async (q: LogQuery, fromBlock: number, toBlock: number): Promise<void> => {
		const splittable = toBlock - fromBlock + 1 > MIN_LOG_RANGE;
		const split = async () => {
			const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2);
			await readRange(q, mid + 1, toBlock);
			await readRange(q, fromBlock, mid);
		};
		for (let page = 1; page <= MAX_LOG_PAGES; page++) {
			if (requests >= MAX_LOG_REQUESTS) {
				complete = false;
				return;
			}
			requests += 1;
			let logs: ExplorerLog[];
			try {
				logs = await fetchPage({ chainId, topics: q.topics, address: q.address, page, fromBlock, toBlock, requestId: opts.requestId });
			} catch (err) {
				if (page === 1 && splittable && isLogsRangeTooWide(err)) return split();
				throw err;
			}
			if (logs.length < LOGS_PAGE_SIZE) {
				take(logs);
				return;
			}
			// A full first page of a wide range: its halves are read instead (they hold these logs too).
			if (page === 1 && splittable) return split();
			take(logs);
			if (page === MAX_LOG_PAGES) complete = false;
		}
	};

	for (const q of approvalLogQueries(owner)) {
		requests = 0;
		await readRange(q, 0, latest);
	}
	return { events, complete };
}
