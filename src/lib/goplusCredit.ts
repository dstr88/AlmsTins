/**
 * GoPlus Security credit.
 *
 * The GoPlus API License Agreement (https://docs.gopluslabs.io/reference/api-license-agreement-new)
 * asks an app that shows results from its API to credit GoPlus: s.3 with a backlink or a
 * "Powered by" mention, s.5 with the GoPlus logo and "Powered by GoPlus". This is the text and
 * backlink half. The logo is NOT added yet because GoPlus has been asked for its brand kit; when
 * it arrives, add it inside <PoweredByGoPlus> (src/components/PoweredByGoPlus.tsx) and every
 * surface below picks it up.
 *
 * The credit shows wherever GoPlus-derived results reach a person:
 *   - the public wallet / site checker (/wallet-checker, /es, /fr)
 *   - the public scan page (/verify/scan)
 *   - the safety screen in the Verify dashboard (/dashboard/verify)
 * It is shown next to a result only when GoPlus actually answered for that check, so it never
 * sits beside a result that did not come from GoPlus. The wording is a brand credit that mirrors
 * the license, so it is the same in every language (the i18n files carry it as-is).
 */

/** Where the credit links: GoPlus's home page. */
export const GOPLUS_URL = 'https://gopluslabs.io';

/**
 * Did GoPlus's address screen answer for this /api/wallet-check result?
 * `coverage.goplus` is 'ran' only when every GoPlus chain query returned a complete answer;
 * 'skipped' (a chain GoPlus does not cover) and 'error' (it did not answer) both mean no credit.
 */
export function goplusRanForAddress(
  result: { coverage?: { goplus?: string } } | null | undefined,
): boolean {
  return result?.coverage?.goplus === 'ran';
}

/**
 * Did GoPlus return a verdict in this /api/dapp-check response? The source is named
 * 'GoPlus Security' there; 'error' means it never answered, and a community-database
 * short-circuit returns no GoPlus source at all.
 */
export function goplusRanForSite(
  data: { sources?: Array<{ name?: string; verdict?: string }> } | null | undefined,
): boolean {
  const sources = data?.sources;
  return Array.isArray(sources)
    && sources.some((s) => s?.name === 'GoPlus Security' && (s.verdict === 'clean' || s.verdict === 'flagged'));
}
