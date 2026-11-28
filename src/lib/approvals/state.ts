/**
 * Whether an approval still stands, asked of the contract now with free read-only calls:
 *
 *   token   → token.allowance(owner, spender)
 *   nft_all → nft.isApprovedForAll(owner, operator)
 *   nft_one → nft.getApproved(tokenId) and nft.ownerOf(tokenId)
 *   permit2 → Permit2.allowance(owner, token, spender) → (amount, expiration, nonce)
 *
 * Zero or false means it was canceled or used up, and it drops off the list. A call that fails
 * (a revert, a node error) gives "couldn't check", never a silent drop.
 *
 * Encoding and decoding are pure. The caller passes a `CallFn` (Alchemy batches for Ethereum,
 * Polygon and Arbitrum, the explorer's proxy for Avalanche: see index.ts).
 */

import { PERMIT2_ADDRESS } from '@/lib/knownProtocolContracts';
import { dataWord, ZERO_ADDRESS, type ApprovalEvent } from './events';

export type ContractCall = { to: string; data: string };
/** Runs calls in order; each answer is the hex result, or null when that call failed. */
export type CallFn = (calls: ContractCall[]) => Promise<Array<string | null>>;

/** Four-byte function selectors (tests recompute them). */
export const SELECTORS = {
	allowance: '0xdd62ed3e',
	isApprovedForAll: '0xe985e9c5',
	getApproved: '0x081812fc',
	ownerOf: '0x6352211e',
	permit2Allowance: '0x927da105',
	symbol: '0x95d89b41',
	name: '0x06fdde03',
	decimals: '0x313ce567',
} as const;

function word(address: string): string {
	return String(address).toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function uintWord(n: string | bigint): string {
	return BigInt(n).toString(16).padStart(64, '0');
}

/** The calls that tell whether this approval still stands. */
export function stateCalls(e: ApprovalEvent, owner: string): ContractCall[] {
	switch (e.kind) {
		case 'token':
			return [{ to: e.token, data: `${SELECTORS.allowance}${word(owner)}${word(e.spender)}` }];
		case 'nft_all':
			return [{ to: e.token, data: `${SELECTORS.isApprovedForAll}${word(owner)}${word(e.spender)}` }];
		case 'nft_one':
			return [
				{ to: e.token, data: `${SELECTORS.getApproved}${uintWord(e.tokenId ?? '0')}` },
				{ to: e.token, data: `${SELECTORS.ownerOf}${uintWord(e.tokenId ?? '0')}` },
			];
		case 'permit2':
			return [{ to: PERMIT2_ADDRESS, data: `${SELECTORS.permit2Allowance}${word(owner)}${word(e.token)}${word(e.spender)}` }];
	}
}

/** The first word of a call result as a number, or null when it isn't one. */
export function decodeUint(hex: string | null, n = 0): bigint | null {
	if (hex === null) return null;
	const w = dataWord(hex, n);
	return w === null ? null : BigInt(`0x${w}`);
}

export function decodeAddress(hex: string | null): string | null {
	const w = hex === null ? null : dataWord(hex, 0);
	return w === null ? null : `0x${w.slice(24)}`;
}

export type CurrentState =
	| { status: 'in_force'; amount: bigint | null; expiration: number | null }
	| { status: 'ended' }
	| { status: 'unknown' };

/**
 * What the answers to stateCalls say. `nowSeconds` decides a Permit2 expiry. A single NFT approval
 * counts only while the wallet still owns the NFT and the same spender is approved for it.
 */
export function readState(e: ApprovalEvent, owner: string, answers: Array<string | null>, nowSeconds: number): CurrentState {
	switch (e.kind) {
		case 'token': {
			const amount = decodeUint(answers[0] ?? null);
			if (amount === null) return { status: 'unknown' };
			return amount === 0n ? { status: 'ended' } : { status: 'in_force', amount, expiration: null };
		}
		case 'nft_all': {
			const v = decodeUint(answers[0] ?? null);
			if (v === null) return { status: 'unknown' };
			return v === 0n ? { status: 'ended' } : { status: 'in_force', amount: null, expiration: null };
		}
		case 'nft_one': {
			const approved = decodeAddress(answers[0] ?? null);
			const holder = decodeAddress(answers[1] ?? null);
			// Both calls revert for a burned NFT, and for a contract that isn't standard: the two look
			// the same from here, so a failed call is "couldn't check", not "gone".
			if (approved === null) return { status: 'unknown' };
			if (approved === ZERO_ADDRESS || approved !== e.spender.toLowerCase()) return { status: 'ended' };
			if (holder === null) return { status: 'unknown' };
			if (holder !== owner.toLowerCase()) return { status: 'ended' };
			return { status: 'in_force', amount: null, expiration: null };
		}
		case 'permit2': {
			const amount = decodeUint(answers[0] ?? null, 0);
			const expiration = decodeUint(answers[0] ?? null, 1);
			if (amount === null || expiration === null) return { status: 'unknown' };
			const exp = Number(expiration);
			if (amount === 0n || exp < nowSeconds) return { status: 'ended' };
			return { status: 'in_force', amount, expiration: exp };
		}
	}
}

/** Runs stateCalls for every event through one CallFn and reads each answer. A CallFn that throws makes them all unknown. */
export async function checkCurrentState(
	events: ApprovalEvent[],
	owner: string,
	call: CallFn,
	nowSeconds: number,
): Promise<CurrentState[]> {
	const perEvent = events.map((e) => stateCalls(e, owner));
	const flat = perEvent.flat();
	let answers: Array<string | null>;
	try {
		answers = flat.length ? await call(flat) : [];
	} catch {
		return events.map(() => ({ status: 'unknown' as const }));
	}
	let i = 0;
	return events.map((e, k) => {
		const mine = answers.slice(i, i + perEvent[k].length);
		i += perEvent[k].length;
		return readState(e, owner, mine, nowSeconds);
	});
}

/**
 * An ABI string result (a dynamic string, or the bytes32 some old tokens return), trimmed of NULs.
 * Null when it can't be read.
 */
export function decodeString(hex: string | null): string | null {
	if (hex === null) return null;
	const h = hex.toLowerCase().replace(/^0x/, '');
	const bytesToText = (b: string) => {
		const pairs = b.match(/../g) ?? [];
		const bytes = Uint8Array.from(pairs.map((p) => parseInt(p, 16)));
		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\u0000+/g, '').trim();
		return text || null;
	};
	if (h.length === 64) return bytesToText(h);
	const offset = decodeUint(`0x${h}`, 0);
	if (offset === null || offset % 32n !== 0n) return null;
	const at = Number(offset / 32n);
	const len = decodeUint(`0x${h}`, at);
	if (len === null || len > 256n) return null;
	const start = (at + 1) * 64;
	const body = h.slice(start, start + Number(len) * 2);
	if (body.length !== Number(len) * 2) return null;
	return bytesToText(body);
}
