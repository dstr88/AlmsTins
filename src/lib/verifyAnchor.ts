/**
 * Almstins Verify — domain-anchor decisions (pure: no DB, no I/O).
 *
 * An address destination carries two independent facts:
 *  - CONTROL (proof_status = 'proven', proof_method, proven_at): the owner proved they
 *    control the address — by self-send (micro_deposit) or by the .well-known file itself
 *    (well_known). Guarded globally by the claim-once index.
 *  - DOMAIN ANCHOR (proof_domain, domain_anchored_at): a proven domain's published file
 *    lists the address. This is what lifts the public level from 'claimed' to 'verified'.
 *    Only a control proof that still stands under today's rules can be anchored: a claim made
 *    under the old, unbound self-send rule (legacy_unbound) is refused until it is re-proven.
 *
 * Keeping them separate is the point. Losing the anchor (the file changed, or stopped
 * listing the address) must never destroy a control proof that still stands, and a new
 * anchor must never inherit the age of an older control proof (anti build-then-burn:
 * age an address cheaply by self-send, then attach a fresh lookalike domain).
 */

/**
 * What a successful domain proof does to one registered destination:
 *  - 'skip'           — not an address, or the published file doesn't list it.
 *  - 'legacy_unbound' — this account's claim on the wallet rests on the old, unbound
 *                       self-send rule: leave it as it is until a bound re-proof (see below).
 *  - 'flip'           — not proven yet: the file proves control AND anchors it (well_known).
 *  - 'anchor'         — proven by another method, no anchor yet: attach this domain, keep the
 *                       control proof (method + proven_at) untouched. A proof_domain with no
 *                       known anchor date (a pre-0035 leftover, see hasAnchor) is not an
 *                       anchor, so it is replaced here like an empty one.
 *  - 'reconfirm'      — already anchored to THIS domain: refresh the positive confirmation.
 *  - 'other_domain'   — already anchored to a DIFFERENT domain: leave it. A domain proof never
 *                       silently moves an address from one proven domain to another.
 */
export type AnchorAction = 'skip' | 'flip' | 'legacy_unbound' | 'anchor' | 'reconfirm' | 'other_domain';

/** The fields that say whether, and since when, an address is anchored to a domain. */
export interface AnchorFields {
  proofMethod: string;
  proofDomain: string | null;
  provenAt: string | null;
  domainAnchoredAt: string | null;
}

export interface AnchorCandidate extends AnchorFields {
  kind: string;
  proofStatus: string;
  /**
   * This account holds the wallet only through a claim made under the old self-send rule
   * (verify_destinations.legacy_unbound), where ANY new outgoing transaction from the address
   * counted, whoever made it. Anyone could register a busy address and wait for its real owner
   * to spend, so the claim may be a squat, not the owner. The caller sets it for:
   *  - a row whose own control proof is such a claim, and
   *  - any other row of the same account for the same wallet (a canonical twin: another
   *    letter case, rail or URI wrapping) that has no bound self-send proof of its own. A
   *    listing is not a control proof, so the twin must not do what the legacy row can't.
   * Every path that writes a new control proof clears the tag (a bound satoshi test, taken
   * in place on the legacy row, or a file flip). Required, so no caller can forget it and
   * anchor a legacy claim by default.
   */
  legacyUnbound: boolean;
}

export function decideAnchor(d: AnchorCandidate, domain: string, listedInFile: boolean): AnchorAction {
  if (d.kind !== 'address' || !listedInFile) return 'skip';
  // A legacy unbound claim is never flipped, anchored or re-confirmed by a listing until it
  // has a bound re-proof: that would turn a possible squat into "Verified" under the
  // squatter's domain, and a listing can't vouch for the claim. Checked first on purpose: a
  // same-account twin may still be unproven (a flip), and a legacy row may still carry a
  // pre-0035 leftover proof_domain. The bound re-proof is the satoshi test, taken again on
  // the legacy row itself (it stays Claimed meanwhile, and its flip clears the tag); then
  // this domain proof anchors it.
  if (d.legacyUnbound) return 'legacy_unbound';
  if (d.proofStatus !== 'proven') return 'flip';
  if (!hasAnchor(d)) return 'anchor';
  return d.proofDomain === domain ? 'reconfirm' : 'other_domain';
}

/**
 * What the watchman does when a proven domain stops vouching for a destination (the file no
 * longer validates, or no longer lists the address):
 *  - 'lapse'    — control was proven BY that file (well_known), so control is gone too.
 *  - 'unanchor' — control was proven some other way (self-send) and still stands: only the
 *                 domain anchor is removed (verified → claimed). Lapsing it would destroy a
 *                 valid control proof and release the claim-once index to another account.
 */
export type AnchorLossAction = 'lapse' | 'unanchor';

export function decideAnchorLoss(proofMethod: string): AnchorLossAction {
  return proofMethod === 'well_known' ? 'lapse' : 'unanchor';
}

export interface MerchantAddressRow extends AnchorFields {
  /** When the domain anchor was last positively re-confirmed by a DOMAIN proof: an owner's
   *  successful proof, or the watchman's Pass B. A published-page check (Pass C) never
   *  writes it for an address (recordMonitorResult), since any https page can show one. */
  lastConfirmedAt: string | null;
}

/**
 * When the domain anchor was attached. Rows anchored before domain_anchored_at existed were
 * all proven BY the file (well_known), so their proven_at is the anchor time. Any other
 * method without the column has no known anchor time: null (claim no age) rather than
 * borrowing the control-proof date.
 */
export function anchoredSince(row: AnchorFields): string | null {
  if (row.domainAnchoredAt) return row.domainAnchoredAt;
  return row.proofMethod === 'well_known' ? row.provenAt : null;
}

/**
 * Is the address anchored to its proof_domain? Only with a known anchor date (anchoredSince).
 * A proof_domain without one is a leftover (a self-send re-prove before domain_anchored_at
 * existed kept the lapsed file proof's domain), not an anchor the owner made. The public
 * level (merchantAddressAssurance), the domain proof (decideAnchor) and the dashboard all
 * use this one rule, so none of them can call a row anchored that another calls unanchored.
 */
export function hasAnchor(row: AnchorFields): boolean {
  return !!row.proofDomain && anchoredSince(row) !== null;
}

/**
 * Hard max-stale TTL for a domain anchor (address or Verified Entity mirror row). A row
 * not positively re-confirmed within this window is NOT trusted as 'verified' — fail-safe
 * to unverified/claimed. The Phase-5 monitor cron keeps the confirmation date advancing on
 * every successful re-check; if it stops (endpoint down, cron broken), the badge lapses
 * instead of over-claiming a stale "verified." Under-claim, never over-claim.
 *
 * The ONE window every caller shares: the public lookup (verifyEntities.ts), the domain
 * proof + watchman (verifyRegistry.ts) and the owner's own dashboard (VerifyDashboard.tsx,
 * a client component — this file is pure, no DB or Node API, safe to import there) all read
 * it from here, so none can show "Verified" a moment longer than the others do.
 */
export const MAX_STALE_MS = 24 * 60 * 60 * 1000;

/** Same 'YYYY-MM-DD HH:MM:SS' column format as nowUtc(), so a lexical >= compare is
 *  also chronological. */
export const staleCutoffUtc = (): string =>
  new Date(Date.now() - MAX_STALE_MS).toISOString().replace('T', ' ').slice(0, 19);

/**
 * The public assurance level + "since" date for a PROVEN merchant address.
 *  - 'verified' needs a domain anchor with a known anchor date (anchoredSince) that the
 *    watchman positively re-confirmed within the max-stale window (`staleCutoff`, same
 *    'YYYY-MM-DD HH:MM:SS' format so a lexical compare is chronological). "Since" is the
 *    anchor date, never the older control-proof date. A proof_domain with no known anchor
 *    date is a leftover, not an anchor (hasAnchor).
 *  - otherwise 'claimed' (control only), "since" = when control was proven.
 * Under-claim, never over-claim.
 */
export function merchantAddressAssurance(
  row: MerchantAddressRow,
  staleCutoff: string,
): { level: 'verified' | 'claimed'; since: string | null } {
  const since = anchoredSince(row);
  const confirmedAt = row.lastConfirmedAt ?? since;
  const fresh = confirmedAt !== null && confirmedAt >= staleCutoff;
  if (hasAnchor(row) && fresh) return { level: 'verified', since };
  return { level: 'claimed', since: row.provenAt };
}
