/**
 * Almstins Verify: what a business pasted into the first-run card's one field.
 *
 * Some businesses ask to be paid at a wallet address; others publish a payment link or a QR and
 * no address at all. The card has one field for both, so this file reads the pasted text and says
 * which it is, and for an address, which network it is on. The card then registers it through the
 * one registration call (src/lib/verifyRegister.ts): a wallet address as kind 'address' on its
 * network, a payment link or QR text as kind 'qr'.
 *
 * Shape only, like src/lib/addressFormats.ts: no checksum is verified. Where the shape cannot
 * settle the network the answer lists every candidate and the card asks:
 *   - a 0x address is the same key on every EVM network Verify offers;
 *   - a "3…" address is valid on Bitcoin and, in its older form, on Litecoin;
 *   - anything this file does not recognize at all (kind 'unknown') is offered every network and
 *     "payment link or QR", so no business is shut out by a format missing from this file.
 * Nothing here decides what is accepted: the server does (createDestination).
 *
 * Pure: no database, no network, safe in a React island.
 */
import { BASE58_CHAR, bech32Pattern, findEvmAddress } from './addressFormats';
import { VERIFY_ADDRESS_RAILS, VERIFY_EVM_RAILS, VERIFY_P2SH_RAILS } from './chains';
import { paymentFormat } from './paymentQr';
import type { RegisterInput } from './verifyRegister';

export type VerifyRail = (typeof VERIFY_ADDRESS_RAILS)[number];

export type DestinationInput =
	| { kind: 'empty' }
	/** A payment link (an https address) or the text of a payment QR (EMV, PIX or UPI). */
	| { kind: 'qr'; what: 'link' | 'code'; value: string }
	/** A wallet address. `rails` lists every network its shape fits, most likely first. */
	| { kind: 'address'; value: string; rails: readonly VerifyRail[] }
	| { kind: 'unknown'; value: string };

/** What the card's select holds when the field alone does not settle it: a network, or 'qr'. */
export type InputChoice = VerifyRail | 'qr' | '';

const EVM_RAILS: readonly VerifyRail[] = VERIFY_ADDRESS_RAILS.filter((r) => VERIFY_EVM_RAILS.has(r));

const BTC_SEGWIT = bech32Pattern('bc');
const LTC_SEGWIT = bech32Pattern('ltc');
/** A legacy base58 address (a version byte and a checksum): 26 to 35 characters. Case-sensitive. */
const legacy = (first: string): RegExp => new RegExp(`^[${first}]${BASE58_CHAR}{25,34}$`);
const BTC_P2PKH = legacy('1');
/** "3…": a Bitcoin script address, and the older form of a Litecoin one. */
const P2SH = legacy('3');
const LTC_LEGACY = legacy('LM');
/**
 * A Solana address is a 32-byte key: 43 or 44 base58 characters for all but about one key in a
 * thousand. A shorter base58 string is left to the owner to name (it could be another chain's).
 */
const SOLANA_USUAL = new RegExp(`^${BASE58_CHAR}{43,44}$`);

/** A web address typed without its scheme: a host with a dot and a letters-only ending. */
const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;
/** Name-service handles (name.eth, name.sol) look like a host and are not a web address. */
const NAME_SERVICE = /\.(eth|sol|crypto|nft|wallet|bnb|x|dao|zil|blockchain|888)$/i;

/** The scheme of a payment URI ("bitcoin:bc1…?amount=1"), lowercased; '' when there is none. */
function uriScheme(s: string): string {
	return (/^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s)?.[1] ?? '').toLowerCase();
}

/** The networks a bare address's shape fits, most likely first. Empty when it fits none. */
function railsOf(address: string): VerifyRail[] {
	const lower = address.toLowerCase();
	// Segwit is all lowercase, or all uppercase inside a QR; a mixed-case one is not an address.
	const oneCase = address === lower || address === address.toUpperCase();
	if (BTC_SEGWIT.test(lower)) return oneCase ? ['bitcoin'] : [];
	if (LTC_SEGWIT.test(lower)) return oneCase ? ['litecoin'] : [];
	if (BTC_P2PKH.test(address)) return ['bitcoin'];
	if (P2SH.test(address)) return [...VERIFY_P2SH_RAILS];
	if (LTC_LEGACY.test(address)) return ['litecoin'];
	if (SOLANA_USUAL.test(address)) return ['solana'];
	return [];
}

/** Read the pasted text. */
export function readDestinationInput(raw: string): DestinationInput {
	const s = String(raw ?? '').trim();
	if (!s) return { kind: 'empty' };

	const format = paymentFormat(s);
	if (format === 'url') return { kind: 'qr', what: 'link', value: s };
	if (format === 'emv' || format === 'upi') return { kind: 'qr', what: 'code', value: s };

	// A 0x address, bare or inside a payment URI (ethereum:0x…@1): one key on every EVM network.
	const evm = findEvmAddress(s);
	if (evm) return { kind: 'address', value: evm, rails: EVM_RAILS };

	// Any other address, with a payment URI's scheme and parameters taken off.
	const scheme = uriScheme(s);
	const bare = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, '').split(/[?@\s]/)[0].trim();
	const rails = railsOf(bare);
	if (rails.length) {
		// "litecoin:3…" settles what the shape alone cannot.
		const named = rails.find((r) => r === scheme);
		return { kind: 'address', value: bare, rails: named ? [named] : rails };
	}

	// A link pasted without https:// would never match the same link read from a QR.
	const host = s.split(/[/?#:]/)[0];
	if (HOST_LIKE.test(s) && !NAME_SERVICE.test(host)) return { kind: 'qr', what: 'link', value: `https://${s}` };

	return { kind: 'unknown', value: s };
}

/** What the select offers for this input: nothing when the field settles it. */
export function choicesFor(input: DestinationInput): readonly InputChoice[] {
	if (input.kind === 'address') return input.rails.length > 1 ? input.rails : [];
	if (input.kind === 'unknown') return [...VERIFY_ADDRESS_RAILS, 'qr'];
	return [];
}

const isRail = (v: string): v is VerifyRail => (VERIFY_ADDRESS_RAILS as readonly string[]).includes(v);

/**
 * The registration this input stands for, or null while it is empty or a choice is still owed.
 * The first-run card has one field, so a destination registered from it carries no label.
 */
export function registrationFor(input: DestinationInput, choice: InputChoice): RegisterInput | null {
	switch (input.kind) {
		case 'empty':
			return null;
		case 'qr':
			return { kind: 'qr', rail: 'url', value: input.value, label: null };
		case 'address': {
			const rail = input.rails.length === 1 ? input.rails[0] : input.rails.find((r) => r === choice);
			return rail ? { kind: 'address', rail, value: input.value, label: null } : null;
		}
		case 'unknown':
			if (choice === 'qr') return { kind: 'qr', rail: 'url', value: input.value, label: null };
			return isRail(choice) ? { kind: 'address', rail: choice, value: input.value, label: null } : null;
	}
}
