/**
 * Where the Agentics pages and their downloads live. One place, so a link can never drift from the
 * route it names (tests/agentics/agenticsUi.test.ts and vaultUi.test.ts check each one against the
 * files under src/pages).
 */
import type { VaultChain } from '@/lib/agentVault/addresses';

/** The Agentics home inside the app: the agents (and, for an account without the Vault, the welcome letter). */
export const HOME_PATH = '/dashboard/agentics';

export const REPORTS_PATH = '/dashboard/agentics/reports';

/** The live feed: the ledger of every agent, as it is written. */
export const FEED_PATH = '/dashboard/agentics/feed';

/** The account page: who is signed in, and deleting the account. For every account with a real session, with or without the Vault. */
export const ACCOUNT_PATH = '/agentics/account';

/** Where the browser goes once the account is gone. */
export const AFTER_DELETE_PATH = '/agentics';

/** The page of one agent. */
export const agentHref = (id: string): string => `${HOME_PATH}/tins/${encodeURIComponent(id)}`;

/** The page of one report. */
export const reportHref = (id: string): string => `${REPORTS_PATH}/${encodeURIComponent(id)}`;

/** The signed PDF of one report. */
export const pdfHref = (id: string): string => `/api/agentics/reports/pdf?id=${encodeURIComponent(id)}`;

/** The proof bundle of one report (what /verify-record reads). */
export const bundleHref = (id: string): string => `/api/agentics/reports/bundle?id=${encodeURIComponent(id)}`;

/** The public page that checks a proof bundle in the browser. */
export const VERIFY_RECORD_PATH = '/verify-record';

/** Where an agent key is minted (a domain proof; nobody approves anybody). */
export const KEYS_PATH = '/verify/agent-keys';

/** The public docs for the pre-send check an agent calls. */
export const DOCS_PATH = '/agentics/docs';

/** The transaction pages of the block explorers the Vault reads, by chain. */
const EXPLORER_TX: Record<VaultChain, string> = {
  ethereum: 'https://etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  avalanche: 'https://snowtrace.io/tx/',
};

const TX_HASH = /^0x[0-9a-f]{64}$/;

/**
 * The explorer page of a transaction, or null when there is no safe one to link: a chain the Vault
 * does not read, or a hash that is not 0x and 64 hex digits. The hash came from the chain's own
 * listing, so it is checked before it goes into an address.
 */
export function explorerTxHref(chain: string | null | undefined, hash: string): string | null {
  const base = typeof chain === 'string' && Object.prototype.hasOwnProperty.call(EXPLORER_TX, chain) ? EXPLORER_TX[chain as VaultChain] : null;
  const h = String(hash ?? '').toLowerCase();
  return base && TX_HASH.test(h) ? `${base}${h}` : null;
}
