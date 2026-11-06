/**
 * The other side of a transfer, as the Record names it. Since slice 8 ("every outflow") the Vault
 * records every direct transfer of an agent's own wallet, and each one says what the agent's
 * registry said about the other side at the moment it was written:
 *
 *   trusted       a registered destination that had passed its checks
 *   pending       a registered destination whose checks had not finished
 *   flagged       a registered destination that had failed a check
 *   unregistered  an address that was not on the agent's list
 *
 * The ledger stores this in its `registry` column (./events.ts), whose words are the registry's own
 * (trusted, flagged, pending, none); `none` is what a screen, a report and an export call
 * `unregistered`. Nothing here revises a status after the fact: it is what the Vault knew when it
 * wrote the row.
 *
 * The UNMATCHED line is the one the Record exists to show: funds that LEFT the wallet for an address
 * that was not on the list, with no check asked about that address in the hour before (./link.ts).
 * The agent paid someone it never asked about. A transfer in, a transfer to a registered address, or
 * an outflow the agent did ask about first (even one answered "unknown") is not unmatched.
 *
 * Pure and isomorphic (no database, no clock, no network), so the pages and the browser use it too.
 */
import type { RegistryVerdict } from './events';

export const COUNTERPARTY_STATUSES = ['trusted', 'pending', 'flagged', 'unregistered'] as const;
export type CounterpartyStatus = (typeof COUNTERPARTY_STATUSES)[number];

/** The reasons a transfer can carry for having no check behind it (./link.ts LinkReason). */
export const LINK_REASONS = ['no_preceding_check', 'ambiguous_checks'] as const;
export type LinkReason = (typeof LINK_REASONS)[number];

const STATUSES: ReadonlySet<string> = new Set(COUNTERPARTY_STATUSES);
const REASONS: ReadonlySet<string> = new Set(LINK_REASONS);

/** The registry's word for a transfer's other side, as the Record shows it; null for a word it does not know. */
export function counterpartyOf(registry: RegistryVerdict | string | null | undefined): CounterpartyStatus | null {
  if (registry === 'none') return 'unregistered';
  return typeof registry === 'string' && registry !== 'unregistered' && STATUSES.has(registry) ? (registry as CounterpartyStatus) : null;
}

/** The registry column's word for a counterparty status. */
export function registryOf(status: CounterpartyStatus): RegistryVerdict {
  return status === 'unregistered' ? 'none' : status;
}

/** True when `reason` is one of the two words that mean "no check stands behind this transfer". */
export const isLinkReason = (reason: unknown): reason is LinkReason => typeof reason === 'string' && REASONS.has(reason);

/**
 * Whether a transfer is the unmatched line: it left the wallet, the other side was not on the list,
 * and no check stands behind it. `linked` is whether a check does.
 */
export function isUnmatched(t: { direction: 'in' | 'out'; counterparty: CounterpartyStatus | null; linked: boolean }): boolean {
  return t.direction === 'out' && t.counterparty === 'unregistered' && !t.linked;
}
