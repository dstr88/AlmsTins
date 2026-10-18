/**
 * The link from a transfer back to the check that came before it.
 *
 * Every `transaction` event carries a verify-status, and the status is the answer of the check
 * the agent asked just before it paid: the most recent `checked` event about the same address,
 * answered at or before the transfer's time, within a window. A wrong stamp is the failure to
 * design against, so the rules lean toward stamping nothing:
 *
 *   - Only the tin's own checks about this exact address count, and only a check that came BEFORE
 *     the transfer. One answered after the funds moved does not vouch for them.
 *   - The window is an hour. An agent that asks and then pays asks again the next time; a check
 *     older than that is stale evidence. (A tin-level setting can replace the constant later.)
 *   - Block times are whole seconds and a check's time has milliseconds, so a check up to one
 *     second after the block's stamp still counts as before it.
 *   - The amount is not part of the match: a check carries no amount.
 *   - Of several checks in the window the latest one wins, whatever the order they arrive in.
 *     Checks answered in the same millisecond that disagree make the link ambiguous, and an
 *     ambiguous link stamps nothing.
 *   - No check in the window: the transfer's status is `unknown`, with the reason
 *     `no_preceding_check`. Never a fifth status, never a guess.
 *
 * One check may stamp many transfers (an agent that caches an answer pays more than once on it).
 * Pure, so every rule is a unit test.
 */
import type { CheckForLink, VaultAnswer } from './events';

export const LINK_WINDOW_MS = 60 * 60 * 1000;
export const LINK_TOLERANCE_MS = 1000;
/** How many checks the lookup reads for one transfer: the newest few are all the rules ever need. */
export const LINK_LOOKUP_LIMIT = 50;

export type LinkReason = 'no_preceding_check' | 'ambiguous_checks';

export interface LinkedCheck {
  eventId: string;
  /** When that check was answered, UTC ISO-8601. */
  at: string;
  /** How long before the transfer's block the check was answered (never negative). */
  gapMs: number;
  keyId: string | null;
}

export type LinkResult =
  | { linked: true; answer: VaultAnswer; status: string | null; check: LinkedCheck }
  | { linked: false; answer: 'unknown'; status: null; reason: LinkReason };

export function linkTransactionToCheck(
  transferAtMs: number,
  checks: readonly CheckForLink[],
  opts: { windowMs?: number; toleranceMs?: number } = {},
): LinkResult {
  const windowMs = opts.windowMs ?? LINK_WINDOW_MS;
  const toleranceMs = opts.toleranceMs ?? LINK_TOLERANCE_MS;

  const inRange: Array<{ check: CheckForLink; atMs: number }> = [];
  for (const check of checks) {
    const atMs = Date.parse(check.at);
    if (!Number.isFinite(atMs)) continue;
    if (atMs > transferAtMs + toleranceMs || atMs < transferAtMs - windowMs) continue;
    inRange.push({ check, atMs });
  }
  if (!inRange.length) return { linked: false, answer: 'unknown', status: null, reason: 'no_preceding_check' };

  const latestMs = Math.max(...inRange.map((c) => c.atMs));
  const latest = inRange.filter((c) => c.atMs === latestMs).map((c) => c.check);
  const first = latest[0];
  if (latest.some((c) => c.answer !== first.answer || c.status !== first.status)) {
    return { linked: false, answer: 'unknown', status: null, reason: 'ambiguous_checks' };
  }

  // Equal in every way that matters: take the lowest id so the same input always names the same check.
  const check = latest.reduce((a, b) => (b.id < a.id ? b : a));
  return {
    linked: true,
    answer: check.answer,
    status: check.status,
    check: { eventId: check.id, at: check.at, gapMs: Math.max(0, transferAtMs - latestMs), keyId: check.keyId },
  };
}
