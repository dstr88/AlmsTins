/**
 * Standing approvals for one wallet, on Ethereum, Polygon, Avalanche and Arbitrum, read from public
 * chain data by address. No wallet connection and no signature: Almstins only reads.
 *
 *   1. events.ts   every approval the wallet ever gave (logs by owner, through the explorer)
 *   2. state.ts    which still stand (read-only calls: Alchemy, or the explorer's proxy for Avalanche)
 *   3. spenders.ts who holds each one, when it last did anything, what the checker says
 *   4. flags.ts    the order to look at them ("Revoke first", "Still a risk"); nothing is "safe"
 *
 * Computed when asked and cached by the caller (the route keeps it 30 minutes); nothing is stored.
 */

import { alchemyEthCallBatch, type AlchemyChain } from '@/lib/alchemy';
import { APPROVAL_CHAINS, CHAINS, type ApprovalChain } from '@/lib/chains';
import { ethCall, weiToDecimalString } from '@/lib/etherscan';
import { knownContract } from '@/lib/knownProtocolContracts';
import { endedByLatestEvent, fetchApprovalEvents, latestPerApproval, approvalKey, type ApprovalEvent } from './events';
import { flagApproval, isUnlimitedApproval, sortApprovals } from './flags';
import { approvalCheckerUrl, revokeCashUrl } from './links';
import { mapLimit, describeSpender } from './spenders';
import { checkCurrentState, decodeString, decodeUint, SELECTORS, type CallFn, type CurrentState } from './state';
import type { ApprovalSpender, ApprovalToken, ApprovalsReport, ChainReadStatus, StandingApproval } from './types';

/**
 * Approvals asked of the contracts per chain, newest first; the rest show as "couldn't check". Alchemy
 * answers 50 calls in one request; the explorer's proxy (Avalanche) answers one call at a time, about two
 * a second, so its cap is lower to keep a check under a couple of minutes.
 */
export const MAX_STATE_CHECKS_PER_CHAIN = 200;
export const MAX_STATE_CHECKS_PROXY = 60;
/** Spender lookups at a time (each is a few explorer and GoPlus calls). */
const SPENDER_CONCURRENCY = 3;

const ALCHEMY_NETWORK: Partial<Record<ApprovalChain, AlchemyChain>> = {
	ethereum: 'eth-mainnet',
	polygon: 'polygon-mainnet',
	arbitrum: 'arb-mainnet',
};

/** The read-only call transport for a chain: Alchemy batches where Alchemy serves it, else the explorer's proxy, one call at a time. */
export function callerFor(chain: ApprovalChain): CallFn {
	const network = ALCHEMY_NETWORK[chain];
	if (network) return (calls) => alchemyEthCallBatch(network, calls);
	const chainId = CHAINS[chain].evmChainId;
	return async (calls) => {
		const out: Array<string | null> = [];
		for (const c of calls) out.push(await ethCall({ chainId, to: c.to, data: c.data }).catch(() => null));
		return out;
	};
}

export interface ApprovalDeps {
	fetchEvents?: typeof fetchApprovalEvents;
	caller?: (chain: ApprovalChain) => CallFn;
	spender?: (chainId: number, address: string) => Promise<ApprovalSpender>;
	now?: () => number;
}

const tokenCache = new Map<string, { expiresAt: number; value: ApprovalToken }>();
const TOKEN_TTL_MS = 24 * 60 * 60_000;

async function tokenInfo(chain: ApprovalChain, addresses: string[], call: CallFn): Promise<Map<string, ApprovalToken>> {
	const out = new Map<string, ApprovalToken>();
	const missing: string[] = [];
	for (const a of addresses) {
		const hit = tokenCache.get(`${chain}:${a}`);
		if (hit && hit.expiresAt > Date.now()) out.set(a, hit.value);
		else missing.push(a);
	}
	if (missing.length === 0) return out;
	const calls = missing.flatMap((a) => [
		{ to: a, data: SELECTORS.symbol },
		{ to: a, data: SELECTORS.name },
		{ to: a, data: SELECTORS.decimals },
	]);
	const answers = await call(calls).catch(() => calls.map(() => null));
	missing.forEach((a, i) => {
		const dec = decodeUint(answers[i * 3 + 2] ?? null);
		const value: ApprovalToken = {
			address: a,
			symbol: decodeString(answers[i * 3] ?? null),
			name: decodeString(answers[i * 3 + 1] ?? null),
			decimals: dec !== null && dec <= 77n ? Number(dec) : null,
		};
		out.set(a, value);
		// A token whose details couldn't be read isn't kept, so the next check asks again.
		if (value.symbol || value.name) {
			tokenCache.set(`${chain}:${a}`, { expiresAt: Date.now() + TOKEN_TTL_MS, value });
			if (tokenCache.size > 5_000) tokenCache.delete(tokenCache.keys().next().value as string);
		}
	});
	return out;
}

function emptySpender(address: string): ApprovalSpender {
	const known = knownContract(address);
	return { address, name: known?.name ?? null, nameSource: known ? 'known' : null, lastActiveAt: null, lastActiveRead: false, checker: null };
}

/** One approval as the list shows it, from its newest event and what the contract says now. Pure. */
export function buildApproval(
	chain: ApprovalChain,
	wallet: string,
	e: ApprovalEvent,
	state: CurrentState,
	token: ApprovalToken,
	spender: ApprovalSpender,
	nowMs: number,
): StandingApproval | null {
	if (state.status === 'ended') return null;
	const base = {
		id: `${chain}:${approvalKey(e)}${e.kind === 'nft_one' ? `:${e.spender}` : ''}`,
		chain,
		chainId: CHAINS[chain].evmChainId,
		kind: e.kind,
		token,
		tokenId: e.tokenId,
		spender,
		givenAt: e.timestamp > 0 ? new Date(e.timestamp * 1000).toISOString() : null,
		givenTx: e.txHash || null,
		links: { revoke: revokeCashUrl(chain, wallet), checker: approvalCheckerUrl(chain) },
	};
	if (state.status === 'unknown') {
		return { ...base, amountRaw: null, amountText: null, unlimited: false, expiresAt: null, group: 'unknown', reasons: [], unknownWhy: 'state' };
	}
	const unlimited = isUnlimitedApproval(e.kind, state.amount);
	const amountText =
		state.amount !== null && !unlimited && token.decimals !== null ? weiToDecimalString(state.amount, token.decimals) : null;
	const { group, reasons } = flagApproval(
		{ kind: e.kind, amount: state.amount, lastActiveAt: spender.lastActiveAt, checkerHits: spender.checker?.hits ?? null },
		nowMs,
	);
	return {
		...base,
		amountRaw: state.amount !== null ? state.amount.toString() : null,
		amountText,
		unlimited,
		expiresAt: e.kind === 'permit2' && state.expiration ? new Date(state.expiration * 1000).toISOString() : null,
		group,
		reasons,
	};
}

async function checkChain(chain: ApprovalChain, wallet: string, deps: Required<ApprovalDeps>): Promise<ChainOutcome> {
	const chainId = CHAINS[chain].evmChainId;
	const nowMs = deps.now();
	const nowSeconds = Math.floor(nowMs / 1000);

	let found: { events: ApprovalEvent[]; complete: boolean };
	try {
		found = await deps.fetchEvents(chainId, wallet);
	} catch (err) {
		console.warn('[approvals] logs unavailable', { chain, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
		return { status: 'unavailable', approvals: [] };
	}

	const candidates = latestPerApproval(found.events)
		.filter((e) => !endedByLatestEvent(e, nowSeconds))
		.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
	const cap = ALCHEMY_NETWORK[chain] ? MAX_STATE_CHECKS_PER_CHAIN : MAX_STATE_CHECKS_PROXY;
	const checked = candidates.slice(0, cap);
	const overflow = candidates.slice(cap);

	const call = deps.caller(chain);
	const states: CurrentState[] = [
		...(await checkCurrentState(checked, wallet, call, nowSeconds)),
		...overflow.map(() => ({ status: 'unknown' as const })),
	];
	const standing = [...checked, ...overflow].map((e, i) => ({ e, s: states[i] })).filter((x) => x.s.status !== 'ended');

	// Token details for the approvals that were asked about; the rows past the cap show the token's short address.
	const checkedSet = new Set(checked);
	const tokenAddrs = [...new Set(standing.filter((x) => checkedSet.has(x.e)).map((x) => x.e.token))];
	const tokens = await tokenInfo(chain, tokenAddrs, call);
	// Only approvals in force are flagged, so only their spenders get the full lookup (explorer and GoPlus calls).
	const spenderAddrs = [...new Set(standing.filter((x) => x.s.status === 'in_force').map((x) => x.e.spender))];
	const described = await mapLimit(spenderAddrs, SPENDER_CONCURRENCY, (a) => deps.spender(chainId, a).catch(() => emptySpender(a)));
	const spenders = new Map(spenderAddrs.map((a, i) => [a, described[i]]));

	const approvals = standing
		.map(({ e, s }) =>
			buildApproval(
				chain,
				wallet,
				e,
				s,
				tokens.get(e.token) ?? { address: e.token, symbol: null, name: null, decimals: null },
				spenders.get(e.spender) ?? emptySpender(e.spender),
				nowMs,
			),
		)
		.filter((a): a is StandingApproval => a !== null);

	return { status: found.complete && overflow.length === 0 ? 'read' : 'partial', approvals };
}

/** One chain's finished read. */
export type ChainOutcome = { status: ChainReadStatus; approvals: StandingApproval[] };

/**
 * The longest one chain may take inside a check. A busy wallet on Avalanche can take minutes; past this
 * the chain is reported as "couldn't be read right now" (never silently empty) and the check finishes.
 */
export const CHAIN_DEADLINE_MS = 4 * 60_000;

/**
 * The report from the chains read so far. A chain still being read is `pending`, and `complete` is false
 * until every chain has an outcome. Pure.
 */
export function buildReport(walletId: string, address: string, outcomes: Array<ChainOutcome | undefined>, nowMs: number): ApprovalsReport {
	const wallet = address.trim().toLowerCase();
	const approvals = sortApprovals(outcomes.flatMap((o) => o?.approvals ?? []));
	return {
		ok: true,
		walletId,
		checkedAt: new Date(nowMs).toISOString(),
		complete: outcomes.length === APPROVAL_CHAINS.length && outcomes.every((o) => o !== undefined),
		chains: APPROVAL_CHAINS.map((chain, i) => ({
			chain,
			status: outcomes[i]?.status ?? 'pending',
			revoke: revokeCashUrl(chain, wallet),
			checker: approvalCheckerUrl(chain),
		})),
		approvals,
		counts: {
			total: approvals.length,
			revokeFirst: approvals.filter((a) => a.group === 'revoke_first').length,
			stillARisk: approvals.filter((a) => a.group === 'still_a_risk').length,
			unknown: approvals.filter((a) => a.group === 'unknown').length,
		},
	};
}

export interface CheckOptions extends ApprovalDeps {
	/** Called as each chain finishes (index into APPROVAL_CHAINS), so a caller can show the list as it fills. */
	onChain?: (index: number, outcome: ChainOutcome) => void;
	/** Per-chain ceiling; default CHAIN_DEADLINE_MS. */
	chainDeadlineMs?: number;
}

/**
 * The standing approvals report for one EVM wallet. The chains are read at the same time. Never throws
 * for an unreadable chain, and never waits past the per-chain deadline: that chain says it couldn't be read.
 */
export async function checkWalletApprovals(walletId: string, address: string, opts: CheckOptions = {}): Promise<ApprovalsReport> {
	const wallet = address.trim().toLowerCase();
	const full: Required<ApprovalDeps> = {
		fetchEvents: opts.fetchEvents ?? ((chainId, owner) => fetchApprovalEvents(chainId, owner)),
		caller: opts.caller ?? callerFor,
		spender: opts.spender ?? describeSpender,
		now: opts.now ?? Date.now,
	};
	const deadline = opts.chainDeadlineMs ?? CHAIN_DEADLINE_MS;
	const outcomes = await Promise.all(
		APPROVAL_CHAINS.map(async (chain, i) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = new Promise<ChainOutcome>((resolve) => {
				timer = setTimeout(() => {
					console.warn('[approvals] chain deadline reached', { chain });
					resolve({ status: 'unavailable', approvals: [] });
				}, deadline);
			});
			const outcome = await Promise.race([
				checkChain(chain, wallet, full).catch((): ChainOutcome => ({ status: 'unavailable', approvals: [] })),
				timedOut,
			]);
			clearTimeout(timer);
			opts.onChain?.(i, outcome);
			return outcome;
		}),
	);
	return buildReport(walletId, wallet, outcomes, full.now());
}
