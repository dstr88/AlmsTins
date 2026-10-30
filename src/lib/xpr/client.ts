/**
 * Reads XPR Network (an Antelope chain, formerly Proton) through public servers: no key, no
 * account. Two kinds of server, each with its own list:
 *
 *   chain API   nodeos HTTP (/v1/chain/get_info, get_account, get_currency_balance). Many
 *               operators run one.
 *   Hyperion    the history index (/v2/health, /v2/history/get_actions, /v2/state/get_tokens).
 *               Only a few operators run a public one.
 *
 * Both lists were answered live on 2026-10-30. No operator publishes a rate limit, so every call
 * goes to the first server that answers and falls over to the next when one times out, is rate
 * limited (429), fails (5xx), is on another chain, or has fallen behind. A call that no server can
 * answer throws XprUnavailableError: callers show "unavailable", never a zero or an empty history.
 *
 * A server's answer is trusted only after it proved to be XPR Network (its chain id) and current
 * (its head block, or the last block its index read, is recent). The proof is remembered for a few
 * minutes, so it costs one extra request per server, not one per call.
 *
 * Pure of the database; `fetch` is injectable so tests run on recorded responses.
 */

export const XPR_CHAIN_ID = '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0';

/** Public chain API servers, tried in this order. */
export const XPR_CHAIN_API_URLS: readonly string[] = [
	'https://proton.eosusa.io',
	'https://api.protonnz.com',
	'https://proton.greymass.com',
	'https://proton.cryptolions.io',
	'https://api-xprnetwork-main.saltant.io',
];

/** Public Hyperion servers, tried in this order. */
export const XPR_HYPERION_URLS: readonly string[] = ['https://proton.eosusa.io', 'https://api-xprnetwork-main.saltant.io'];

/** One call to one server gives up after this long. */
export const XPR_CALL_TIMEOUT_MS = 12_000;

/** A server whose head block (chain API) or indexed block (Hyperion) is older than this is behind. */
export const XPR_MAX_LAG_MS = 15 * 60 * 1000;

/** How long a server's chain id and freshness proof is reused. */
const PROOF_TTL_MS = 5 * 60 * 1000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Every server failed, or none could prove it was XPR Network and current. Never means "zero". */
export class XprUnavailableError extends Error {
	constructor(message: string, readonly causes: readonly string[] = []) {
		super(message);
		this.name = 'XprUnavailableError';
	}
}

export type XprServerKind = 'chain' | 'hyperion';

export interface XprRequestOptions {
	fetchImpl?: FetchLike;
	/** Servers to ask instead of the default lists (tests). */
	chainServers?: readonly string[];
	hyperionServers?: readonly string[];
	timeoutMs?: number;
	/** The current time, for the freshness check. */
	now?: () => number;
}

export interface XprResponse {
	status: number;
	json: unknown;
	server: string;
}

const proven = new Map<string, number>();

/** Forget which servers were proven. For tests. */
export function resetXprServerProofs(): void {
	proven.clear();
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An Antelope timestamp ('2026-10-30T16:26:00.500', UTC, no zone) as milliseconds, or NaN. */
export function antelopeTimeMs(value: unknown): number {
	const s = String(value ?? '').trim();
	if (!s) return NaN;
	return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

async function call(server: string, path: string, init: RequestInit | undefined, fetchImpl: FetchLike, timeoutMs: number): Promise<XprResponse> {
	const res = await fetchImpl(`${server}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	// 429 and 5xx are the server failing, not an answer about the chain.
	if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
	let json: unknown = null;
	try {
		json = await res.json();
	} catch {
		throw new Error('answer was not JSON');
	}
	return { status: res.status, json, server };
}

/** Proves a server is XPR Network and current; throws when it is not. */
async function prove(kind: XprServerKind, server: string, fetchImpl: FetchLike, timeoutMs: number, now: () => number): Promise<void> {
	const key = `${kind}:${server}`;
	const at = proven.get(key);
	if (at !== undefined && now() - at < PROOF_TTL_MS) return;
	if (kind === 'chain') {
		const r = await call(server, '/v1/chain/get_info', { method: 'POST' }, fetchImpl, timeoutMs);
		const info = isObj(r.json) ? r.json : {};
		if (r.status !== 200 || info.chain_id !== XPR_CHAIN_ID) throw new Error('not XPR Network');
		const head = antelopeTimeMs(info.head_block_time);
		if (!Number.isFinite(head) || now() - head > XPR_MAX_LAG_MS) throw new Error('behind');
	} else {
		const r = await call(server, '/v2/health', undefined, fetchImpl, timeoutMs);
		const health = isObj(r.json) && Array.isArray(r.json.health) ? (r.json.health as unknown[]) : [];
		const rpc = health.find((h) => isObj(h) && h.service === 'NodeosRPC');
		const data = isObj(rpc) && isObj(rpc.service_data) ? rpc.service_data : {};
		if (r.status !== 200 || data.chain_id !== XPR_CHAIN_ID) throw new Error('not XPR Network');
	}
	proven.set(key, now());
}

/**
 * One request, answered by the first proven server that gives a usable answer. `usable` decides
 * whether a server's reply (any status below 429 that parsed as JSON) is an answer; a reply it
 * rejects counts as that server failing and the next is asked. Throws XprUnavailableError when
 * every server failed.
 */
export async function xprRequest(
	kind: XprServerKind,
	path: string,
	init: RequestInit | undefined,
	usable: (r: XprResponse) => boolean,
	opts: XprRequestOptions = {},
): Promise<XprResponse> {
	const fetchImpl = opts.fetchImpl ?? ((url, i) => fetch(url, i));
	const servers = (kind === 'chain' ? opts.chainServers ?? XPR_CHAIN_API_URLS : opts.hyperionServers ?? XPR_HYPERION_URLS);
	const timeoutMs = opts.timeoutMs ?? XPR_CALL_TIMEOUT_MS;
	const now = opts.now ?? Date.now;
	const causes: string[] = [];
	for (const server of servers) {
		const host = new URL(server).host;
		try {
			await prove(kind, server, fetchImpl, timeoutMs, now);
			const r = await call(server, path, init, fetchImpl, timeoutMs);
			if (!usable(r)) throw new Error(`unusable answer (HTTP ${r.status})`);
			return r;
		} catch (err) {
			proven.delete(`${kind}:${server}`);
			causes.push(`${host}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	throw new XprUnavailableError(`No XPR ${kind === 'chain' ? 'chain API' : 'Hyperion'} server answered`, causes);
}

/** POST a JSON body to a chain API route. */
export function xprChainPost(path: string, body: unknown, usable: (r: XprResponse) => boolean, opts?: XprRequestOptions): Promise<XprResponse> {
	return xprRequest('chain', path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, usable, opts);
}

/** GET a Hyperion route (the query string is part of `path`). */
export function xprHyperionGet(path: string, usable: (r: XprResponse) => boolean, opts?: XprRequestOptions): Promise<XprResponse> {
	return xprRequest('hyperion', path, undefined, usable, opts);
}

/**
 * True when a Hyperion answer's index is recent. Every get_actions and get_tokens answer carries
 * last_indexed_block_time; a server whose index stopped would otherwise return a history that
 * simply ends early.
 */
export function hyperionIsCurrent(json: unknown, now: () => number = Date.now): boolean {
	if (!isObj(json)) return false;
	const t = antelopeTimeMs(json.last_indexed_block_time);
	return Number.isFinite(t) && now() - t <= XPR_MAX_LAG_MS;
}
