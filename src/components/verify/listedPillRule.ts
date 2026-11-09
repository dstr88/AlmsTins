/**
 * ListedPill, the logic: when a merchant's destination row shows "Listed by a platform" (guard PR B,
 * spec 3e). Pure, so the rule is tested apart from the markup in ListedPill.tsx. Named apart from it in more than case: the
 * filesystem under the dev server does not tell listedPill.ts from ListedPill.tsx. The pill is for a
 * proven address with platform_listed_at set; a payment link is never on a platform list, and an
 * unproven row has no proof for the listing to stand beside.
 */
export interface ListedPillInput {
  kind: 'address' | 'qr';
  proofStatus: string;
  platformListedAt?: string | null;
}

export interface ListedPillView {
  /** When the listing was first seen (the row's platform_listed_at). */
  since: string;
}

export function listedPillFor(d: ListedPillInput): ListedPillView | null {
  if (d.kind !== 'address' || d.proofStatus !== 'proven' || !d.platformListedAt) return null;
  return { since: d.platformListedAt };
}
