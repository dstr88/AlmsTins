/**
 * Does an XPR Network account exist? Asked of the chain, never decided from the name's shape (a
 * name is plain text; '1abc' is a real account and 'zzzzzzzzzzzz' too).
 *
 * The chain API answers get_account with 200 and the account, or 400 with an Antelope error code:
 * 3060002 (account_query_exception) for a well-formed name no account has, 3200006 for a string
 * that is not a valid name at all. Recorded from proton.eosusa.io on 2026-10-30.
 */

import { normalizeXprAccountName } from '../addressFormats';
import { xprChainPost, type XprRequestOptions, type XprResponse } from './client';

export type XprAccountStatus = 'exists' | 'missing' | 'invalid';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const errorCode = (json: unknown): number | null => (isObj(json) && isObj(json.error) && typeof json.error.code === 'number' ? json.error.code : null);

/**
 * 'exists', 'missing' (a valid name with no account) or 'invalid' (not a valid name). Throws
 * XprUnavailableError when no server can answer: the caller must not treat that as "missing".
 */
export async function xprAccountStatus(rawName: unknown, opts?: XprRequestOptions): Promise<XprAccountStatus> {
	const name = normalizeXprAccountName(rawName);
	if (!name) return 'invalid';
	const answered = (r: XprResponse) => (r.status === 200 && isObj(r.json) && r.json.account_name === name) || (r.status === 400 && [3060002, 3200006].includes(errorCode(r.json) ?? 0));
	const r = await xprChainPost('/v1/chain/get_account', { account_name: name }, answered, opts);
	if (r.status === 200) return 'exists';
	return errorCode(r.json) === 3200006 ? 'invalid' : 'missing';
}

/** The account's get_account answer, or null when the account does not exist. Throws when unavailable. */
export async function xprGetAccount(rawName: unknown, opts?: XprRequestOptions): Promise<Record<string, unknown> | null> {
	const name = normalizeXprAccountName(rawName);
	if (!name) return null;
	const r = await xprChainPost(
		'/v1/chain/get_account',
		{ account_name: name },
		(x) => (x.status === 200 && isObj(x.json) && x.json.account_name === name) || (x.status === 400 && errorCode(x.json) === 3060002),
		opts,
	);
	return r.status === 200 && isObj(r.json) ? r.json : null;
}
