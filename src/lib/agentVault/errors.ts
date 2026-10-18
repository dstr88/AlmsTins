/**
 * The Agent Vault's operation errors: the codes every operation answers with, and the two helpers
 * that make them. Kept apart from ./vault.ts, which loads the registry checks, so the daily jobs
 * and the report code can use the same codes without loading everything an owner's request needs.
 * ./vault.ts re-exports all of it, so existing imports keep working.
 *
 * Errors are codes, never raw error text.
 */
export type VaultError =
  | 'invalid_label' | 'invalid_chain' | 'invalid_address' | 'invalid_id'
  | 'tin_not_found' | 'wallet_not_found' | 'destination_not_found'
  | 'key_not_found' | 'key_not_active' | 'key_in_use'
  | 'nothing_to_add' | 'too_many' | 'text_too_long' | 'invalid_cursor' | 'refresh_in_progress'
  | 'invalid_period' | 'report_not_found' | 'not_signed' | 'report_altered' | 'signing_unavailable' | 'invalid_settings';

export type Failure = { ok: false; error: VaultError; max?: number };

export const fail = (error: VaultError, max?: number): Failure => (max === undefined ? { ok: false, error } : { ok: false, error, max });

/** An id from a client: a non-empty string of at most 64 characters (trimmed), or null. */
export const idOf = (raw: unknown): string | null => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s && s.length <= 64 ? s : null;
};
