/**
 * How a ledger event reaches a screen. The ledger (./events.ts) stores everything about an event,
 * including the address the check came from and the whole of what was answered. A screen needs
 * less, and needs it in one shape whether the page was rendered on the server or a "load more"
 * came from the browser: this is that shape, and the one function that makes it.
 *
 * Pure and isomorphic (no database, no clock, no network), so the page and its components can both
 * import it. It imports only types from the modules that talk to the database.
 *
 * What it leaves out on purpose: the caller's address (metadata for the rate limiter, not part of
 * what the owner reads), the public check's own status, and the free text inside `detail`. Of the
 * rest it keeps only values it recognizes, so a row can never carry text a screen would have to
 * trust: the reason a check was answered as it was is a code the report knows (or `other`), and a
 * transfer's chain-supplied text (its asset's symbol) is the one string left, and a screen renders
 * it as text.
 */
import type { VaultChain } from './addresses';
import type { RegistryVerdict, VaultAnswer } from './events';
import { basisOf, hasLimitMarker } from './report';
import type { EventView } from './vault';

export type LinkReason = 'no_preceding_check' | 'ambiguous_checks';
export type KeyState = 'active' | 'pending' | 'revoked' | 'unknown';

export interface LedgerTransfer {
  /** The transaction hash, as the chain reported it. */
  hash: string;
  /** `in` reached the agent's wallet (bought); `out` left it (sold). */
  direction: 'in' | 'out';
  /** The exact amount, in whole units of the asset, as a decimal string. */
  amount: string;
  /** The asset's symbol as the explorer reported it. Untrusted text. */
  asset: string;
  /** USD at the time of the transfer, or null when it could not be priced. Never 0 for "unknown". */
  usd: number | null;
}

export interface LedgerRow {
  id: string;
  /** When it happened, UTC ISO-8601 with milliseconds. */
  at: string;
  kind: 'checked' | 'transaction';
  /** Normalized: lowercase for an EVM address. For a transfer, the registered destination. */
  address: string;
  chain: VaultChain | null;
  /** For a check, what it answered. For a transfer, the answer of the check that came before it. */
  answer: VaultAnswer | null;
  registry: RegistryVerdict | null;
  /** For a check: why it was answered as it was (a reason the report knows, or `other`). Null for a transfer. */
  basis: string | null;
  /** For a transfer: why no check stands behind it, or null when one does. */
  linkReason: LinkReason | null;
  /** For a check: whether it is the one that found the agent's daily limit of recorded checks used up. Checks after it that day were answered and not recorded, except flagged ones. */
  limitReached: boolean;
  /** For a check: whether the key that asked is still in use. A rotated key stays marked. Null for a transfer. */
  keyState: KeyState | null;
  tx: LedgerTransfer | null;
}

// A Record over each union, so a word added to the ledger without a line here fails the build.
const ANSWERS: Record<VaultAnswer, true> = { proven: true, 'consistent-with-history': true, flagged: true, unknown: true };
const REGISTRIES: Record<RegistryVerdict, true> = { trusted: true, flagged: true, pending: true, none: true };
const CHAINS: Record<VaultChain, true> = { ethereum: true, polygon: true, avalanche: true };
const KEY_STATES: Record<KeyState, true> = { active: true, pending: true, revoked: true, unknown: true };
const LINK_REASONS: Record<LinkReason, true> = { no_preceding_check: true, ambiguous_checks: true };

const has = (set: object, v: unknown): boolean => typeof v === 'string' && Object.prototype.hasOwnProperty.call(set, v);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function transferOf(raw: unknown): LedgerTransfer | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const hash = text(t.hash);
  const amount = text(t.amount);
  const asset = text(t.asset);
  if (hash === null || amount === null || asset === null) return null;
  const usd = typeof t.usd === 'number' && Number.isFinite(t.usd) ? t.usd : null;
  return { hash, direction: t.direction === 'out' ? 'out' : 'in', amount, asset, usd };
}

/** One event as a screen reads it, or null when what came back is not an event (no id, no time, an unknown kind). */
export function toLedgerRow(event: Partial<EventView> | null | undefined): LedgerRow | null {
  if (!event || typeof event !== 'object') return null;
  const id = text(event.id);
  const at = text(event.at);
  const address = text(event.address);
  if (!id || !at || address === null) return null;
  if (event.kind !== 'checked' && event.kind !== 'transaction') return null;
  const detail = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? (event.detail as Record<string, unknown>) : null;
  const isCheck = event.kind === 'checked';
  const tx = isCheck ? null : transferOf(event.tx);
  const reason = detail?.reason;
  return {
    id,
    at,
    kind: event.kind,
    address,
    chain: has(CHAINS, event.chain) ? (event.chain as VaultChain) : null,
    answer: has(ANSWERS, event.answer) ? (event.answer as VaultAnswer) : null,
    registry: has(REGISTRIES, event.registry) ? (event.registry as RegistryVerdict) : null,
    basis: isCheck ? basisOf(detail) : null,
    linkReason: !isCheck && has(LINK_REASONS, reason) ? (reason as LinkReason) : null,
    limitReached: isCheck && hasLimitMarker(detail),
    keyState: isCheck && event.keyId ? (has(KEY_STATES, event.keyStatus) ? (event.keyStatus as KeyState) : 'unknown') : null,
    tx,
  };
}

/** A list of events from an answer, as rows, dropping anything that is not an event. */
export function parseLedgerRows(list: unknown): LedgerRow[] {
  if (!Array.isArray(list)) return [];
  const rows: LedgerRow[] = [];
  for (const item of list) {
    const row = toLedgerRow(item as Partial<EventView>);
    if (row) rows.push(row);
  }
  return rows;
}
