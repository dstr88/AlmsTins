/**
 * Almstins Verify — domain-anchor decisions (pure: no DB, no I/O).
 *
 * An address destination carries two independent facts:
 *  - CONTROL (proof_status = 'proven', proof_method, proven_at): the owner proved they
 *    control the address — by self-send (micro_deposit) or by the .well-known file itself
 *    (well_known). Guarded globally by the claim-once index.
 *  - DOMAIN ANCHOR (proof_domain, domain_anchored_at): a proven domain's published file
 *    lists the address. This is what lifts the public level from 'claimed' to 'verified'.
 *
 * Keeping them separate is the point. Losing the anchor (the file changed, or stopped
 * listing the address) must never destroy a control proof that still stands, and a new
 * anchor must never inherit the age of an older control proof (anti build-then-burn:
 * age an address cheaply by self-send, then attach a fresh lookalike domain).
 */

/**
 * What a successful domain proof does to one registered destination:
 *  - 'skip'         — not an address, or the published file doesn't list it.
 *  - 'flip'         — not proven yet: the file proves control AND anchors it (well_known).
 *  - 'anchor'       — proven by another method, no domain yet: attach this domain, keep the
 *                     control proof (method + proven_at) untouched.
 *  - 'reconfirm'    — already anchored to THIS domain: refresh the positive confirmation.
 *  - 'other_domain' — already anchored to a DIFFERENT domain: leave it. A domain proof never
 *                     silently moves an address from one proven domain to another.
 */
export type AnchorAction = 'skip' | 'flip' | 'anchor' | 'reconfirm' | 'other_domain';

export interface AnchorCandidate {
  kind: string;
  proofStatus: string;
  proofDomain: string | null;
}

export function decideAnchor(d: AnchorCandidate, domain: string, listedInFile: boolean): AnchorAction {
  if (d.kind !== 'address' || !listedInFile) return 'skip';
  if (d.proofStatus !== 'proven') return 'flip';
  if (!d.proofDomain) return 'anchor';
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

export interface MerchantAddressRow {
  proofMethod: string;
  proofDomain: string | null;
  provenAt: string | null;
  domainAnchoredAt: string | null;
  lastConfirmedAt: string | null;
}

/**
 * When the domain anchor was attached. Rows anchored before domain_anchored_at existed were
 * all proven BY the file (well_known), so their proven_at is the anchor time. Any other
 * method without the column has no known anchor time: null (claim no age) rather than
 * borrowing the control-proof date.
 */
export function anchoredSince(row: MerchantAddressRow): string | null {
  if (row.domainAnchoredAt) return row.domainAnchoredAt;
  return row.proofMethod === 'well_known' ? row.provenAt : null;
}

/**
 * The public assurance level + "since" date for a PROVEN merchant address.
 *  - 'verified' needs a domain anchor that the watchman positively re-confirmed within the
 *    max-stale window (`staleCutoff`, same 'YYYY-MM-DD HH:MM:SS' format so a lexical compare
 *    is chronological). "Since" is the anchor date, never the older control-proof date.
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
  if (row.proofDomain && fresh) return { level: 'verified', since };
  return { level: 'claimed', since: row.provenAt };
}
