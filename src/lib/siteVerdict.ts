/**
 * The overall verdict for a /api/dapp-check site check, from the per-source results.
 *
 * Rules, in order:
 *   1. Any source that flags the site makes it red. Nothing overrides a flag: MetaMask's
 *      verified-safe list (its allowlist) only softens MetaMask's own blocklist entry, which
 *      checkMetaMask() reports as 'whitelisted' instead of 'flagged'. It never clears a flag
 *      from ScamSniffer, GoPlus, URLScan.io, OpenPhish, Google Safe Browsing or VirusTotal.
 *   2. A caution from any source makes it yellow.
 *   3. A source that could not be reached ('error') makes it yellow and marks the check
 *      limited, the way the address checker shows "Limited check": a site we could not fully
 *      check is never green. A source that is switched off ('skipped') is not counted.
 *   4. A downloaded list still loading, or a site URLScan.io has never scanned, makes it
 *      yellow. VirusTotal having no record of a link does not: most new links have none.
 *   5. Otherwise green, which means no source we asked has flagged the site yet. Not "safe".
 */

export type SourceVerdict = 'flagged' | 'caution' | 'clean' | 'whitelisted' | 'unscanned' | 'error' | 'skipped';

export type SourceResult = {
  name:    string;
  verdict: SourceVerdict;
  detail:  string;
  icon:    string;
};

export type SiteVerdict = {
  verdict: 'red' | 'yellow' | 'green';
  /** True when the site is yellow because a source could not be reached (nothing flagged it, no caution). */
  limited: boolean;
};

export function siteVerdict(sources: SourceResult[]): SiteVerdict {
  if (sources.some((s) => s.verdict === 'flagged')) return { verdict: 'red', limited: false };
  if (sources.some((s) => s.verdict === 'caution')) return { verdict: 'yellow', limited: false };
  if (sources.some((s) => s.verdict === 'error')) return { verdict: 'yellow', limited: true };
  if (sources.some((s) => s.verdict === 'unscanned' && s.name !== 'VirusTotal')) return { verdict: 'yellow', limited: false };
  return { verdict: 'green', limited: false };
}

/** The link checker's runtime strings (WalletCheckerLocale['js']) that siteVerdictText reads. */
export type SiteVerdictStrings = {
  verdictDanger?:  string;
  verdictCaution?: string;
  verdictSafe?:    string;
  verdictLimited?: string;
  tipRed?:         string;
  tipYellow?:      string;
  tipGreen?:       string;
  tipLimited?:     string;
  cleanNotSafe?:   string;
};

export type SiteVerdictText = {
  tone:  'red' | 'yellow' | 'green';
  label: string;
  tip:   string;
  /** The "clean is not safe" caution, shown only on green. */
  cleanNote: string | null;
};

/**
 * What the link checker shows for a /api/dapp-check answer. A reply without one of the three
 * verdicts (an error, a rate limit) is null: a failed check, never a pass. Yellow because a
 * source could not be reached reads as a limited check, like the address checker.
 */
export function siteVerdictText(
  data: { verdict?: unknown; limited?: unknown } | null | undefined,
  t: SiteVerdictStrings,
): SiteVerdictText | null {
  const v = data?.verdict;
  if (v === 'red') return { tone: 'red', label: t.verdictDanger ?? 'DANGER', tip: t.tipRed ?? '', cleanNote: null };
  if (v === 'yellow' && data?.limited === true) {
    return { tone: 'yellow', label: t.verdictLimited ?? 'LIMITED CHECK', tip: t.tipLimited ?? '', cleanNote: null };
  }
  if (v === 'yellow') return { tone: 'yellow', label: t.verdictCaution ?? 'CAUTION', tip: t.tipYellow ?? '', cleanNote: null };
  if (v === 'green') {
    return { tone: 'green', label: t.verdictSafe ?? 'NO FLAGS FOUND', tip: t.tipGreen ?? '', cleanNote: t.cleanNotSafe ?? '' };
  }
  return null;
}
