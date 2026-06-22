/**
 * Canonical HTML escaper for the dashboard's client-side innerHTML builders.
 *
 * Many .astro client <script> blocks build DOM via `el.innerHTML = `...${value}...``
 * from attacker-influenceable data — on-chain token symbols/descriptions, user notes,
 * cross-tenant community address labels, uploaded filenames. Every such value MUST pass
 * through this before interpolation, in BOTH text and attribute contexts.
 *
 * Encodes all five HTML-significant characters INCLUDING the single quote, so a value
 * dropped into a single-quoted attribute (or an inline handler argument) can't break out.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
