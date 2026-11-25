/**
 * Wallet Watcher: the first-run rule for the Vault (/dashboard/vault).
 *
 * An account with nothing in it yet meets a welcome card at the top of the Vault: what Almstins
 * is for, the two ways to start (paste a wallet address, or upload an exchange CSV) and an
 * optional four-step tour of the page. This file is the one place that decides who sees it; the
 * page asks it once per request (src/pages/dashboard/vault.astro), with the facts read by
 * ./vaultFirstRunFacts.ts.
 *
 * Who sees it: a signed-in account that holds no wallet (on-chain or custom), no exchange account
 * and no imported transaction. It goes away for good once the first of those exists.
 *
 * Who never sees it:
 *   - the demo: its sample vault has its own tour (src/components/dashboard/DemoTutorial.astro);
 *   - an account whose records could not be read: it gets the Vault as it always was.
 *
 * "Not now" and "Yes, show me" hide the card in that browser only, with a marker in local
 * storage (VAULT_WELCOME_SEEN_KEY). Nothing about the answer is sent to or kept on the server;
 * the privacy policy's Section 9 already covers this kind of marker ("whether you have already
 * seen a page's introduction, kept in your browser").
 *
 * Pure and import-free, so the page, the client script and the tests all read the same rule.
 */

export interface VaultFirstRunFacts {
	/** The seeded sample account (requireTenantSession's isDemo). */
	isDemo: boolean;
	/** Wallets of any kind the account holds (on-chain and custom). */
	walletCount: number;
	/** Exchange accounts and imported transactions the account holds. null: could not be read. */
	importCount: number | null;
}

/** True when the account meets the welcome card. */
export function isVaultFirstRun(facts: VaultFirstRunFacts): boolean {
	if (facts.isDemo) return false;
	if (facts.importCount === null) return false;
	return facts.walletCount === 0 && facts.importCount === 0;
}

/** The local-storage key that hides the card in one browser once it has been answered. */
export const VAULT_WELCOME_SEEN_KEY = 'almstins-vault-welcome-seen';

/**
 * What each tour step points at, in step order. Every one of these is on the Vault for an empty
 * account (tests/vault/welcome.test.ts checks them against the page), unlike the demo tour's
 * wallet tins, which an empty account does not have.
 */
export const VAULT_TOUR_SELECTORS = [
	'.tile--r1c3', // Add Asset: the wallet address field
	'.smart-import-bar', // Smart Import: drop an exchange CSV
	'.exchange-lane', // the exchange cards
	'.tile--r1c2', // Portfolio and Sync
] as const;

/** The field the tour ends on, with the cursor in it. */
export const VAULT_ADDRESS_FIELD = '[data-add-address]';
