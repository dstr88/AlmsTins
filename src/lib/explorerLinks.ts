/**
 * Block explorer links for the chains Almstins reads. One place, so a link can never point at the
 * wrong chain's explorer (the Bookkeeping drawer once sent Bitcoin addresses and Polygon
 * transactions to Etherscan).
 *
 * The rule is the one `explorerTxHref` in src/components/agentics/paths.ts set first: a missing
 * link is better than a wrong one. An unknown or missing chain, or a value that does not have that
 * chain's shape, gives null, and the caller shows the value as plain text with its copy button.
 *
 * No database or server imports: React islands use this too.
 */

import {
  BASE58_CHAR,
  EVM_ADDRESS_LOWER,
  EVM_TX_HASH_LOWER,
  SOLANA_ADDRESS,
  SUI_ADDRESS_LOWER,
  XPR_ACCOUNT_NAME,
  XPR_TX_ID,
  bech32Pattern,
} from './addressFormats';
import { CHAINS, EXPLORER_EVM_CHAINS, type ExplorerChain } from './chains';

export type { ExplorerChain };

interface ExplorerRule {
  /** The explorer's name, as a link's text shows it. */
  name: string;
  address: string;
  tx: string;
  /** Returns the value as it goes into the link, or null when it is not an address on this chain. */
  normalizeAddress: (v: string) => string | null;
  normalizeTx: (v: string) => string | null;
}

const HEX_64 = /^[0-9a-f]{64}$/;
const BTC_LEGACY = new RegExp(`^[13]${BASE58_CHAR}{25,34}$`);
const LTC_LEGACY = new RegExp(`^[LM3]${BASE58_CHAR}{26,33}$`);
const SOLANA_SIGNATURE = new RegExp(`^${BASE58_CHAR}{32,88}$`);
const SUI_DIGEST = new RegExp(`^${BASE58_CHAR}{32,44}$`);

/** Hex is case-free, so EVM values are lowercased; anything else is refused. */
function hexOr(pattern: RegExp) {
  return (v: string): string | null => {
    const lower = v.toLowerCase();
    return pattern.test(lower) ? lower : null;
  };
}

/** Base58 is case-sensitive: kept exactly as stored, since lowercasing it makes a different value. */
function exact(pattern: RegExp) {
  return (v: string): string | null => (pattern.test(v) ? v : null);
}

/**
 * A bech32 address (bc1…, ltc1…) is all lowercase or all uppercase, never mixed; both spell the same
 * address, so it goes into the link lowercase.
 */
function bech32(hrp: string) {
  const pattern = bech32Pattern(hrp);
  return (v: string): string | null => {
    if (v !== v.toLowerCase() && v !== v.toUpperCase()) return null;
    const lower = v.toLowerCase();
    return pattern.test(lower) ? lower : null;
  };
}

function either(...checks: Array<(v: string) => string | null>) {
  return (v: string): string | null => {
    for (const check of checks) {
      const out = check(v);
      if (out) return out;
    }
    return null;
  };
}

/** An XPR value is lowercase on the chain: it goes into the link lowercase, if it has the shape. */
function xprValue(pattern: RegExp) {
  return (v: string): string | null => {
    const lower = v.toLowerCase();
    return pattern.test(lower) ? lower : null;
  };
}

/** A chain's explorer pages (from src/lib/chains.ts) with the checks a value must pass to go into a link. */
function rule(chain: ExplorerChain, normalizeAddress: ExplorerRule['normalizeAddress'], normalizeTx: ExplorerRule['normalizeTx']): ExplorerRule {
  const { name, address, tx } = CHAINS[chain].explorer;
  return { name, address, tx, normalizeAddress, normalizeTx };
}

const evm = (chain: ExplorerChain) => rule(chain, hexOr(EVM_ADDRESS_LOWER), hexOr(EVM_TX_HASH_LOWER));

const EXPLORERS = new Map<ExplorerChain, ExplorerRule>([
  ['ethereum', evm('ethereum')],
  ['polygon', evm('polygon')],
  ['avalanche', evm('avalanche')],
  ['bsc', evm('bsc')],
  ['bitcoin', rule('bitcoin', either(bech32('bc'), exact(BTC_LEGACY)), hexOr(HEX_64))],
  ['litecoin', rule('litecoin', either(bech32('ltc'), exact(LTC_LEGACY)), hexOr(HEX_64))],
  ['solana', rule('solana', exact(SOLANA_ADDRESS), exact(SOLANA_SIGNATURE))],
  // A Sui address is 0x and 64 hex digits, the same shape as an EVM transaction hash; only the
  // chain tells them apart.
  ['sui', rule('sui', hexOr(SUI_ADDRESS_LOWER), exact(SUI_DIGEST))],
  // An XPR account name and transaction id are lowercase; the name is checked for shape only, which
  // is all a link needs (the explorer says if no such account exists).
  ['xpr', rule('xpr', xprValue(XPR_ACCOUNT_NAME), xprValue(XPR_TX_ID))],
]);

function ruleFor(chain: string | null | undefined): ExplorerRule | null {
  if (typeof chain !== 'string') return null;
  return EXPLORERS.get(chain.trim().toLowerCase() as ExplorerChain) ?? null;
}

function build(base: string, value: string | null): string | null {
  return value ? `${base}${encodeURIComponent(value)}` : null;
}

/** The name of a chain's explorer, or 'block explorer' for a chain with none. */
export function explorerName(chain: string | null | undefined): string {
  return ruleFor(chain)?.name ?? 'block explorer';
}

/** The explorer page of an address on a chain, or null when there is no safe one to link. */
export function explorerAddressUrl(chain: string | null | undefined, address: string): string | null {
  const rule = ruleFor(chain);
  if (!rule) return null;
  return build(rule.address, rule.normalizeAddress(String(address ?? '').trim()));
}

/** The explorer page of a transaction on a chain, or null when there is no safe one to link. */
export function explorerTxUrl(chain: string | null | undefined, hash: string): string | null {
  const rule = ruleFor(chain);
  if (!rule) return null;
  return build(rule.tx, rule.normalizeTx(String(hash ?? '').trim()));
}

/** EVM address with no known chain: one link per EVM chain, so the user picks. Empty when it is not an EVM address. */
export function evmExplorerLinks(address: string): { chain: ExplorerChain; url: string }[] {
  const links: { chain: ExplorerChain; url: string }[] = [];
  for (const chain of EXPLORER_EVM_CHAINS) {
    const url = explorerAddressUrl(chain, address);
    if (url) links.push({ chain, url });
  }
  return links;
}
