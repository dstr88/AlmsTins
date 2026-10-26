/**
 * Agent Vault addresses: which chains the Vault tracks, how an address is normalized on each
 * one, and how a pasted list becomes destinations. Everything here is pure (no database, no
 * network), so it is unit-tested directly.
 *
 * The normalized form is what the Vault stores and what "one live row per (tenant, tin, chain,
 * address)" compares, so two spellings of one wallet can never be two destinations. Slice 1
 * tracks the EVM chains the rest of the app already reads (Ethereum, Polygon, Avalanche); a new
 * chain is one entry in CHAIN_RULES. An address on any other chain is refused with a reason, never
 * stored half-understood.
 */

import { EVM_ADDRESS_ANY_PREFIX, EVM_ADDRESS_ANY_PREFIX_SOURCE } from '@/lib/addressFormats';
import { CHAINS, VAULT_CHAINS } from '@/lib/chains';

export { VAULT_CHAINS };
export type VaultChain = (typeof VAULT_CHAINS)[number];

/** What a pasted list or a client may call each chain. A Map, so a name like "constructor" is never a hit. */
const CHAIN_NAMES = new Map<string, VaultChain>([
  // Each chain's name and its coin's symbol: ethereum/eth, polygon/pol, avalanche/avax.
  ...VAULT_CHAINS.flatMap((c): Array<[string, VaultChain]> => [[c, c], [CHAINS[c].native.symbol.toLowerCase(), c]]),
  // Polygon's coin before the 2024 rename.
  ['matic', 'polygon'],
]);

/** The canonical chain for a name (case and surrounding spaces ignored), or null if the Vault does not track it. */
export function parseChain(raw: unknown): VaultChain | null {
  if (typeof raw !== 'string') return null;
  return CHAIN_NAMES.get(raw.trim().toLowerCase()) ?? null;
}

interface ChainRule {
  /** The normalized address, or null when the text is not an address on this chain. */
  normalize(raw: string): string | null;
}

// An EVM address is the same 20 bytes on every EVM chain, written as 0x plus 40 hex digits. The
// letter case carries only an optional checksum, never identity, so the lowercase form is the
// canonical one (the same form Verify's registry and lookups key on).
const evm: ChainRule = { normalize: (raw) => (EVM_ADDRESS_ANY_PREFIX.test(raw) ? raw.toLowerCase() : null) };

const CHAIN_RULES: Record<VaultChain, ChainRule> = {
  ethereum: evm,
  polygon: evm,
  avalanche: evm,
};

/**
 * The normalized form of `raw` on `chain`, or null when the chain is not tracked or the text is
 * not an address there. Surrounding whitespace is ignored; nothing inside the address is
 * "repaired" (a typo is a rejection, not a guess).
 */
export function normalizeAddress(chain: unknown, raw: unknown): string | null {
  const c = parseChain(chain);
  if (!c || typeof raw !== 'string') return null;
  return CHAIN_RULES[c].normalize(raw.trim());
}

// ── Pasted lists ─────────────────────────────────────────────────────────────

export const MAX_LABEL_LENGTH = 80;
/** A pasted line longer than this is refused outright (it is not a destination row). */
export const MAX_LINE_LENGTH = 500;

export type RejectReason = 'no_address' | 'bad_address' | 'several_addresses' | 'unsupported_chain' | 'line_too_long';

export interface ParsedEntry {
  /** 1-based line of the pasted text. */
  line: number;
  chain: VaultChain;
  /** Normalized (see normalizeAddress). */
  address: string;
  label: string | null;
}

export interface RejectedLine {
  line: number;
  reason: RejectReason;
  /** The line as pasted, cut to 80 characters. */
  text: string;
}

export interface ParsedDestinations {
  entries: ParsedEntry[];
  rejected: RejectedLine[];
}

// An EVM address as a token of its own: no letter or digit on either side, so the first 40 digits
// of a longer hex value (a 32-byte address, a transaction hash) are never read as an address.
const ADDRESS_TOKEN = new RegExp(`(?<![0-9A-Za-z])${EVM_ADDRESS_ANY_PREFIX_SOURCE}(?![0-9A-Za-z])`, 'g');
// Any 0x-prefixed token, to tell "an address with a typo" from "no address on this line".
const HEX_TOKEN = /(?<![0-9A-Za-z])0[xX][0-9A-Za-z]*/;
// A long single word of letters and digits: what an address on another chain looks like.
const LONG_WORD = /(?<![0-9A-Za-z])[0-9A-Za-z]{26,90}(?![0-9A-Za-z])/;
const HEADER_WORDS = new Set(['address', 'wallet', 'wallet address', 'destination']);

/** Cells of one pasted line: comma, tab, semicolon or pipe separated, with "double quoted" cells kept whole. */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (c === ',' || c === '\t' || c === ';' || c === '|') {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  return cells.map((s) => s.trim());
}

const clip = (s: string) => s.slice(0, 80);

/** A label for display: control characters out, whitespace collapsed, loose separators trimmed, 80 characters at most. */
function cleanLabel(parts: string[]): string | null {
  const joined = parts
    .join(' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:=>]+|[\s\-:=>]+$/g, '');
  if (!joined) return null;
  return Array.from(joined).slice(0, MAX_LABEL_LENGTH).join('');
}

/**
 * Reads a pasted list, one destination per line, in any of the shapes people paste:
 *
 *   0x…                      address only
 *   0x…, Kraken deposit      address, label (or label, address)
 *   polygon, 0x…, Payroll    a chain name or ticker in any cell sets that line's chain
 *
 * Cells are separated by comma, tab, semicolon or pipe ("double quotes" keep a cell whole). Blank
 * lines and lines starting with # or // are skipped, and so is a first line that is a header
 * ("address,label"). Every other line ends up in `entries` or in `rejected` with a reason, so
 * nothing a person pasted vanishes without a word. `defaultChain` applies to a line with no chain.
 */
export function parseDestinationText(text: string, defaultChain: VaultChain): ParsedDestinations {
  const entries: ParsedEntry[] = [];
  const rejected: RejectedLine[] = [];
  const lines = String(text ?? '').split(/\r\n|\r|\n/);
  let seenContent = false;

  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    const body = rawLine.trim();
    if (!body || body.startsWith('#') || body.startsWith('//')) continue;
    const isFirst = !seenContent;
    seenContent = true;

    if (body.length > MAX_LINE_LENGTH) {
      rejected.push({ line, reason: 'line_too_long', text: clip(body) });
      continue;
    }

    const cells = splitCells(body);
    const found: Array<{ cell: number; address: string }> = [];
    for (const [cell, value] of cells.entries()) {
      for (const m of value.matchAll(ADDRESS_TOKEN)) found.push({ cell, address: m[0] });
    }

    if (found.length === 0) {
      if (isFirst && cells.some((c) => HEADER_WORDS.has(c.toLowerCase()))) continue; // a header row
      const reason: RejectReason = HEX_TOKEN.test(body) ? 'bad_address' : LONG_WORD.test(body) ? 'unsupported_chain' : 'no_address';
      rejected.push({ line, reason, text: clip(body) });
      continue;
    }
    if (found.length > 1) {
      rejected.push({ line, reason: 'several_addresses', text: clip(body) });
      continue;
    }

    const { cell: addressCell, address } = found[0];
    let chain: VaultChain | null = null;
    const labelParts: string[] = [];
    for (const [cell, value] of cells.entries()) {
      if (cell === addressCell) {
        const rest = value.replace(ADDRESS_TOKEN, ' ').trim();
        if (rest) labelParts.push(rest);
        continue;
      }
      const named = parseChain(value);
      if (named && !chain) { chain = named; continue; }
      if (value) labelParts.push(value);
    }

    const lineChain: VaultChain = chain ?? defaultChain;
    const normalized = normalizeAddress(lineChain, address);
    if (!normalized) {
      rejected.push({ line, reason: 'bad_address', text: clip(body) });
      continue;
    }
    entries.push({ line, chain: lineChain, address: normalized, label: cleanLabel(labelParts) });
  }

  return { entries, rejected };
}

export interface RepeatedEntry {
  line: number;
  chain: VaultChain;
  address: string;
}

/**
 * One entry per (chain, address): the first line wins, and a later line fills in a label the first
 * one lacked. Later repeats are returned so the caller can say they were skipped.
 */
export function dedupeEntries(entries: readonly ParsedEntry[]): { unique: ParsedEntry[]; repeated: RepeatedEntry[] } {
  const seen = new Map<string, ParsedEntry>();
  const unique: ParsedEntry[] = [];
  const repeated: RepeatedEntry[] = [];
  for (const e of entries) {
    const key = `${e.chain}:${e.address}`;
    const prior = seen.get(key);
    if (!prior) {
      const copy = { ...e };
      seen.set(key, copy);
      unique.push(copy);
      continue;
    }
    if (!prior.label && e.label) prior.label = e.label;
    repeated.push({ line: e.line, chain: e.chain, address: e.address });
  }
  return { unique, repeated };
}
