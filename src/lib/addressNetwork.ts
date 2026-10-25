/**
 * Which network an address belongs to, read from its shape alone. Moved out of
 * src/components/dashboard/AddressLabels.tsx so the Address Labels list and
 * GET /api/address-history read an address the same way.
 *
 * The order of the checks matters and is kept as it was: Litecoin, Bitcoin, Sui, EVM, Solana.
 * A Sui address (0x and 64 hex digits) is checked before EVM (0x and 40), and the Bitcoin check
 * runs before Solana, so a base58 Solana key that starts with 1 or 3 reads as a legacy Bitcoin
 * address (src/lib/sync/syncBtcAddress.ts notes the same ambiguity). Only the stored chain can
 * tell those apart.
 *
 * An exchange account id (cex:<exchange>:<id>) is not a blockchain address: null.
 *
 * No database or server imports: React islands use this too.
 */

export type AddressNetwork = 'evm' | 'btc' | 'ltc' | 'sol' | 'sui';

export function addressNetwork(address: string): AddressNetwork | null {
	if (typeof address !== 'string' || !address) return null;
	const a = address.toLowerCase();
	if (a.startsWith('cex:'))                              return null;
	if (a.startsWith('ltc1'))                              return 'ltc';
	if (a.startsWith('bc1') || /^[13][a-z0-9]/i.test(a)) return 'btc';
	if (/^0x[a-f0-9]{64}$/.test(a))                       return 'sui';
	if (/^0x[a-f0-9]{40}$/.test(a))                       return 'evm';
	if (/^[1-9a-hj-np-za-km-z]{32,44}$/.test(address))   return 'sol';
	return null;
}

/** True for an address on a chain; false for an exchange account id or anything unrecognized. */
export function isOnchainAddress(address: string): boolean {
	return addressNetwork(address) !== null;
}
