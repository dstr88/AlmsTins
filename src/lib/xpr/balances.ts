/**
 * An XPR Network account's holdings: the chain's own coin (liquid, staked and unstaking) and every
 * other token, each by contract and symbol.
 *
 *   liquid XPR      chain API get_currency_balance (eosio.token, XPR): the exact amount the chain
 *                   holds. If no chain server answers, the XPR row of Hyperion's token list.
 *   staked XPR      get_account voter_info.staked, in units of 1/10000 XPR. Staking moves coins
 *                   to the staking contract; they are still the account's.
 *   unstaking XPR   get_account refund_request, when there is one.
 *   other tokens    Hyperion /v2/state/get_tokens, which lists every token the account holds.
 *
 * Every part must be answered: a missing part would silently understate the balance, so any part
 * that no server answers throws XprUnavailableError and the caller writes nothing.
 */

import { normalizeXprAccountName } from '../addressFormats';
import { hyperionIsCurrent, xprChainPost, xprHyperionGet, type XprRequestOptions, type XprResponse } from './client';
import { xprGetAccount } from './account';
import { isXprNativeAsset, xprAssetSymbol, XPR_NATIVE_CONTRACT } from './assets';
import { CHAINS } from '../chains';

const NATIVE_SYMBOL = CHAINS.xpr.native.symbol;
const NATIVE_UNITS = 10 ** CHAINS.xpr.native.decimals;

export interface XprToken {
	/** The stored name: 'SYMBOL@contract' (xprAssetSymbol). */
	symbol: string;
	contract: string;
	amount: number;
	precision: number;
}

export interface XprBalances {
	liquid: number;
	staked: number;
	unstaking: number;
	/** liquid + staked + unstaking: what the account owns in the chain's own coin. */
	native: number;
	/** Every token but the chain's own coin, with a balance above zero. */
	tokens: XprToken[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** '63.2736 XPR' to 63.2736 when the symbol is the given one, else null. */
export function parseAssetString(value: unknown, symbol: string): number | null {
	const m = /^(-?\d+(?:\.\d+)?) ([A-Z0-9]{1,7})$/.exec(String(value ?? '').trim());
	if (!m || m[2] !== symbol) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) ? n : null;
}

/** An integer count of 1/10000 XPR (a number or a numeric string) as XPR; 0 for anything else. */
function unitsToXpr(value: unknown): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
	return Number.isFinite(n) && n > 0 ? n / NATIVE_UNITS : 0;
}

/** Hyperion's token list of an account. Throws XprUnavailableError when no current index answers. */
export async function fetchXprTokenList(name: string, opts?: XprRequestOptions): Promise<Array<{ symbol: string; contract: string; amount: number; precision: number }>> {
	const usable = (r: XprResponse) => r.status === 200 && isObj(r.json) && Array.isArray(r.json.tokens) && hyperionIsCurrent(r.json, opts?.now);
	const r = await xprHyperionGet(`/v2/state/get_tokens?account=${encodeURIComponent(name)}`, usable, opts);
	const out: Array<{ symbol: string; contract: string; amount: number; precision: number }> = [];
	for (const t of (r.json as { tokens: unknown[] }).tokens) {
		if (!isObj(t)) continue;
		const amount = Number(t.amount);
		const symbol = String(t.symbol ?? '').trim();
		const contract = String(t.contract ?? '').trim();
		if (!symbol || !contract || !Number.isFinite(amount)) continue;
		out.push({ symbol, contract, amount, precision: Number.isInteger(t.precision) ? Number(t.precision) : 0 });
	}
	return out;
}

async function liquidFromChain(name: string, opts?: XprRequestOptions): Promise<number> {
	const r = await xprChainPost(
		'/v1/chain/get_currency_balance',
		{ code: XPR_NATIVE_CONTRACT, account: name, symbol: NATIVE_SYMBOL },
		(x) => x.status === 200 && Array.isArray(x.json),
		opts,
	);
	const first = (r.json as unknown[])[0];
	// An account that never held the coin gets an empty list: a real zero.
	return first === undefined ? 0 : (parseAssetString(first, NATIVE_SYMBOL) ?? Number.NaN);
}

export async function fetchXprBalances(rawName: unknown, opts?: XprRequestOptions): Promise<XprBalances> {
	const name = normalizeXprAccountName(rawName);
	if (!name) throw new Error('not an XPR account name');

	const list = await fetchXprTokenList(name, opts);
	let liquid: number;
	try {
		liquid = await liquidFromChain(name, opts);
	} catch {
		liquid = Number.NaN;
	}
	if (!Number.isFinite(liquid)) {
		// The chain servers could not answer: the token list's own XPR row is the same number.
		const row = list.find((t) => isXprNativeAsset(t.symbol, t.contract));
		liquid = row ? row.amount : 0;
	}

	const account = await xprGetAccount(name, opts);
	const voter = account && isObj(account.voter_info) ? account.voter_info : null;
	const staked = unitsToXpr(voter?.staked);
	const refund = account && isObj(account.refund_request) ? account.refund_request : null;
	const unstaking = refund ? (parseAssetString(refund.net_amount, NATIVE_SYMBOL) ?? 0) + (parseAssetString(refund.cpu_amount, NATIVE_SYMBOL) ?? 0) : 0;

	const tokens: XprToken[] = list
		.filter((t) => !isXprNativeAsset(t.symbol, t.contract) && t.amount > 0)
		.map((t) => ({ symbol: xprAssetSymbol(t.symbol, t.contract), contract: t.contract.toLowerCase(), amount: t.amount, precision: t.precision }));

	return { liquid, staked, unstaking, native: liquid + staked + unstaking, tokens };
}
