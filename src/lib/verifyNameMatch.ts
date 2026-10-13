/**
 * Verify business-name ↔ domain rule. Pure (no DB, no Node APIs), so the server registry
 * and the public cards in the browser apply the exact same rule.
 *
 * A business name is DNS-arbitrated: it counts only when it derives from a domain the
 * account proved. Almstins does no KYC and never links an address to a person.
 */

/**
 * Canonical form of a business name for the global-uniqueness check. Like an email,
 * the name is case-insensitive and whitespace-normalized, so "Joe's Coffee", "joe's
 * coffee", and "Joe's   Coffee " all collide. Returns '' for an empty/blank name.
 */
export function normalizeName(raw: string): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Alphanumeric-only slug for matching a name against a domain label. */
function nameSlug(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Common second-level public labels (co.uk, com.br, …) so we can find the brand label
 *  left of the public suffix without shipping a full Public Suffix List. */
const CCSLD_2ND = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'gob', 'go']);

/**
 * The registrable brand label of a host (the part DNS actually sells), slugified.
 *   starbucks.com → "starbucks" · shop.starbucks.com → "starbucks" · starbucks.co.uk → "starbucks"
 * Approximate (no PSL) but safe for the common cases — and safe against squatting: a
 * lookalike like starbucks-pay.com yields "starbuckspay", not "starbucks".
 */
export function registrableLabel(host: string): string {
  const parts = (host ?? '').toLowerCase().split('.').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return nameSlug(parts[0]);
  let suffixStart = parts.length - 1; // index of the TLD
  if (parts[suffixStart].length === 2 && suffixStart - 1 >= 1 && CCSLD_2ND.has(parts[suffixStart - 1])) {
    suffixStart -= 1; // .co.uk / .com.br style
  }
  return nameSlug(parts[suffixStart - 1] ?? parts[0]);
}

/**
 * Does a business name "derive from" a domain — its slug equals the domain's registrable
 * brand label? This is the anti-squat anchor: only the controller of exactly that domain
 * can claim the name. We let DNS arbitrate the name; Almstins does no KYC.
 */
export function nameMatchesDomain(label: string, domain: string): boolean {
  const s = nameSlug(normalizeName(label));
  return !!s && s === registrableLabel(domain);
}
