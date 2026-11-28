/**
 * Who holds an approval: the spender contract's name, when it last did anything, and what the wallet
 * checker's sources say about it.
 *
 * Names come from public contract data only: the known-contracts list (src/lib/knownProtocolContracts.ts),
 * then the explorer's verified contract name, then the page shows a short address. Nothing here links
 * an address to a person.
 *
 * Every lookup is cached per contract in this process, since the same few spenders (Permit2, routers,
 * marketplaces) turn up for nearly every wallet, and the explorer's rate limit is shared.
 */

import { getLatestTxTimestamp, getVerifiedContractName } from '@/lib/etherscan';
import { knownContract } from '@/lib/knownProtocolContracts';
import { checkSpenderAddress, type SpenderCheck } from '@/lib/walletChecker';
import type { ApprovalSpender } from './types';

const NAME_TTL_MS = 24 * 60 * 60_000;
const ACTIVE_TTL_MS = 6 * 60 * 60_000;
const CHECKER_TTL_MS = 6 * 60 * 60_000;
const MAX_ENTRIES = 5_000;

type Entry<T> = { expiresAt: number; value: T };

/** A per-key cache. A value `keep` refuses (an incomplete answer) is returned but not kept, so the next check asks again. */
function memo<T>(ttlMs: number, keep: (value: T) => boolean = () => true) {
	const map = new Map<string, Entry<T>>();
	return async (key: string, load: () => Promise<T>): Promise<T> => {
		const hit = map.get(key);
		if (hit && hit.expiresAt > Date.now()) return hit.value;
		const value = await load();
		map.delete(key);
		if (!keep(value)) return value;
		map.set(key, { expiresAt: Date.now() + ttlMs, value });
		if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
		return value;
	};
}

const nameCache = memo<string | null>(NAME_TTL_MS);
const activeCache = memo<number | null>(ACTIVE_TTL_MS);
const checkerCache = memo<SpenderCheck>(CHECKER_TTL_MS, (c) => c.complete || c.hits.length > 0);

/** The explorer's verified contract name, or null (none, or the explorer couldn't be asked). Cached a day. */
export async function verifiedContractName(chainId: number, address: string): Promise<string | null> {
	const a = address.toLowerCase();
	try {
		return await nameCache(`${chainId}:${a}`, () => getVerifiedContractName({ chainId, address: a }));
	} catch {
		return null;
	}
}

/** Runs `fn` over `items` with at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/** Everything the list says about one spender on one chain. Never throws: a part that can't be read is marked so. */
export async function describeSpender(chainId: number, address: string): Promise<ApprovalSpender> {
	const a = address.toLowerCase();
	const known = knownContract(a);

	let lastActiveAt: string | null = null;
	let lastActiveRead = true;
	try {
		const ts = await activeCache(`${chainId}:${a}`, () => getLatestTxTimestamp({ chainId, address: a }));
		lastActiveAt = ts ? new Date(ts * 1000).toISOString() : null;
	} catch {
		lastActiveRead = false;
	}

	let checker: ApprovalSpender['checker'] = null;
	try {
		const c = await checkerCache(a, () => checkSpenderAddress(a));
		checker = { hits: [...c.hits], complete: c.complete, goplus: c.goplus };
	} catch {
		checker = null;
	}

	if (known) return { address: a, name: known.name, nameSource: 'known', lastActiveAt, lastActiveRead, checker };
	const verified = await verifiedContractName(chainId, a);
	return { address: a, name: verified, nameSource: verified ? 'verified' : null, lastActiveAt, lastActiveRead, checker };
}
