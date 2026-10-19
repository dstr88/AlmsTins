/**
 * The Agent Vault's operation errors: the codes every operation answers with, and the two helpers
 * that make them. Kept apart from ./vault.ts, which loads the registry checks, so the daily jobs
 * and the report code can use the same codes without loading everything an owner's request needs.
 * ./vault.ts re-exports all of it, so existing imports keep working.
 *
 * Errors are codes, never raw error text.
 */
import type { RejectedLine } from './addresses';
import type { SkippedLine } from './vault';

export type VaultError =
  | 'invalid_label' | 'invalid_chain' | 'invalid_address' | 'invalid_id'
  | 'tin_not_found' | 'wallet_not_found' | 'destination_not_found'
  | 'key_not_found' | 'key_not_active' | 'key_in_use'
  | 'nothing_to_add' | 'too_many' | 'text_too_long' | 'invalid_cursor' | 'refresh_in_progress'
  | 'invalid_period' | 'report_not_found' | 'not_signed' | 'report_altered' | 'signing_unavailable' | 'invalid_settings'
  | 'rate_limited' | 'version_limit'
  | 'plan_limit' | 'export_too_large' | 'invalid_format' | 'export_busy';

/** Which of an account's caps a refused create ran into: its agents, its registered addresses, or one agent's own wallets. */
export type PlanCap = 'bots' | 'addresses' | 'wallets';

/**
 * A refusal. `max` is the most a request may carry (too_many, text_too_long) or the most versions
 * a day may have (version_limit). `plan_limit` also says which cap (`cap`), what it is (`limit`) and
 * how much of it the account uses now (`used`), so a screen can say it in words.
 */
export type Failure = {
  ok: false;
  error: VaultError;
  max?: number;
  cap?: PlanCap;
  limit?: number;
  used?: number;
  /** A refused paste (plan_limit on addresses) also says what became of every line, as an accepted one would have: nothing is hidden behind the refusal. */
  skipped?: SkippedLine[];
  rejected?: RejectedLine[];
};

export const fail = (error: VaultError, max?: number): Failure => (max === undefined ? { ok: false, error } : { ok: false, error, max });

/**
 * A create refused because the account is at its cap (HTTP 409 plan_limit). A refused paste passes
 * `lines`, the same `skipped` and `rejected` lists a paste that went through would have carried, so
 * the screen can account for every line instead of guessing.
 */
export const failLimit = (cap: PlanCap, limit: number, used: number, lines?: { skipped: SkippedLine[]; rejected: RejectedLine[] }): Failure =>
  lines ? { ok: false, error: 'plan_limit', cap, limit, used, skipped: lines.skipped, rejected: lines.rejected } : { ok: false, error: 'plan_limit', cap, limit, used };

/** An id from a client: a non-empty string of at most 64 characters (trimmed), or null. */
export const idOf = (raw: unknown): string | null => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s && s.length <= 64 ? s : null;
};
