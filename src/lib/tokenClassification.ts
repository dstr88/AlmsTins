/**
 * tokenClassification.ts — single source of truth for "is this token spam/scam?"
 *
 * Consolidates the name-pattern spam heuristics that were previously duplicated in
 * knownContracts (FUNGIBLE_SPAM_PATTERNS), annualBreakdown (NFT SPAM_PATTERNS) and
 * ReconciliationTin (SCAM_PATTERNS) into one categorized rule set that also returns
 * a human-readable REASON — needed by the Junk drawer so a filtered token is
 * auditable ("filtered because: contains a URL").
 *
 * Pure and isomorphic: no imports, safe in server code and React islands alike. The
 * contract-address check (classifyContract, which needs the CONTRACTS map) is passed
 * in as `contractVerdict` so this module stays dependency-free and cycle-free.
 *
 * Design note — the unified rule set is deliberately the STRONG-signal union of the
 * three prior lists. Over-broad entries that risked false positives on legitimate
 * tokens (a bare `wpol` match, and short ambiguous TLDs like `.co`/`.gg`/`.fi`) were
 * dropped; false positives are recoverable via the token override system regardless.
 */

export type TokenClass = 'clean' | 'spam' | 'scam';

export type TokenClassResult = { class: TokenClass; reason: string };

/** Verdict from knownContracts.classifyContract, passed in to keep this module pure. */
export type ContractVerdict = 'legitimate' | 'scam' | 'unknown';

// Content rules — checked against the combined "symbol name" string. A URL, link,
// lure word, or domain anywhere in a token's symbol OR name is a spam signal.
const CONTENT_RULES: { re: RegExp; reason: string }[] = [
  { re: /https?:\/\//i,                          reason: 'contains a URL' },
  { re: /www\./i,                                reason: 'contains a URL' },
  { re: /t\.me\//i,                              reason: 'contains a Telegram link' },
  { re: /t\.ly\//i,                              reason: 'contains a link shortener' },
  { re: /fli\.so/i,                              reason: 'contains a link shortener' },
  { re: /official\.link/i,                       reason: 'contains a link' },
  { re: /telegram/i,                             reason: 'references Telegram' },
  { re: /\b(claim|voucher|reward|rewards|prize|airdrop|redeem)\b/i, reason: 'airdrop / claim lure text' },
  { re: /\bvisit\b/i,                            reason: 'airdrop / claim lure text' },
  { re: /check:/i,                               reason: 'airdrop / claim lure text' },
  { re: /\.(com|net|xyz|site|top|vip|cab|lat|to)\b/i, reason: 'contains a domain name' },
  { re: /\.org\b.*earn/i,                        reason: 'contains a domain name' },
];

// Structural rules — checked against the SYMBOL only. Legitimate tokens have
// multi-word *names* ("USD Coin", "Aave Polygon USDC") but never multi-word or
// pipe-laden *symbols*; spam packs a sentence/lure into the symbol field itself.
const SYMBOL_RULES: { re: RegExp; reason: string }[] = [
  { re: /\S+ \S+ \S+/,  reason: 'multi-word symbol — not a real token' },
  { re: /\|/,           reason: 'invalid symbol character' },
];

/** Pure name/symbol spam check. Returns spam (with reason) or clean. */
export function classifyTokenName(input: { symbol?: string | null; name?: string | null }): TokenClassResult {
  const symbol = input.symbol ?? '';
  const combined = `${symbol} ${input.name ?? ''}`;
  for (const rule of CONTENT_RULES) {
    if (rule.re.test(combined)) return { class: 'spam', reason: rule.reason };
  }
  for (const rule of SYMBOL_RULES) {
    if (rule.re.test(symbol)) return { class: 'spam', reason: rule.reason };
  }
  return { class: 'clean', reason: '' };
}

/**
 * Full classification. A known-good-contract mismatch (`contractVerdict === 'scam'`)
 * is the strongest signal and takes precedence over name heuristics.
 */
export function classifyToken(input: {
  symbol?: string | null;
  name?: string | null;
  contractVerdict?: ContractVerdict;
}): TokenClassResult {
  if (input.contractVerdict === 'scam') {
    return { class: 'scam', reason: 'contract does not match the known-good address for this token' };
  }
  return classifyTokenName(input);
}

/** Back-compat boolean: true when a token's symbol/name matches a spam pattern. */
export function isSpamName(symbol: string, name?: string | null): boolean {
  return classifyTokenName({ symbol, name }).class === 'spam';
}
