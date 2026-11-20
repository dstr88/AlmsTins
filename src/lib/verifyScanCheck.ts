/**
 * The public scanner's check, in one place.
 *
 * /verify/scan (src/components/verify/VerifyScan.tsx) and the "see what a payer sees" field on
 * the public Verify page (src/components/verify/VerifyCheckFirst.tsx) both call runScanCheck, so
 * a business owner checking their own address gets exactly the answer a payer gets.
 *
 * One value, two independent answers:
 *  1. Verification: has an account proven this destination with Almstins? (GET /api/verify/lookup)
 *  2. Safety: is the value itself flagged? A payment link goes to the site checker
 *     (GET /api/dapp-check), a wallet address to the address checker (POST /api/wallet-check).
 *     A PIX or UPI payment code has no such list, so it gets no safety screen: the match is the answer.
 *
 * Read-only. The value is sent to those endpoints and to nothing else, and nothing here stores it.
 * Browser-side: no database, no server module. `fetchImpl` is passed in so a test needs no network.
 */
import { goplusRanForAddress, goplusRanForSite } from './goplusCredit';
import { addressSafetyVerdict, type PublicVerifyLookup } from './verifyPublicCard';

/** What the scanner keeps of GET /api/verify/lookup. */
export interface ScanLookup {
  verified: boolean;
  level: PublicVerifyLookup['level'];
  since: string | null;
  source: 'entity' | 'merchant' | null;
  domain: string | null;
  provingDomain: string | null;
  label: string | null;
}

export type ScanSafety = 'idle' | 'checking' | 'clean' | 'caution' | 'danger' | 'unclear' | 'error';

/** The noun the result words use for the checked value (src/i18n/verifyScan.ts ScanNoun). */
export type ScanValueNoun = 'address' | 'link' | 'code';

export interface ScanValueKind {
  /** A payment link (http or https). */
  isUrl: boolean;
  /** The text of a PIX (EMV) or UPI payment QR. */
  isPaymentQr: boolean;
  noun: ScanValueNoun;
}

export interface ScanCheckResult {
  lookup: ScanLookup;
  /**
   * True only when the lookup itself answered. False when the value was refused (not a valid
   * address), the caller was rate limited, or the request failed. The scanner shows "not a
   * verified destination" either way; a caller that acts on "nobody has proven this" must read
   * this first, because an unanswered lookup says nothing about who holds the value.
   */
  lookupAnswered: boolean;
  safety: ScanSafety;
  /** GoPlus answered for the safety screen, so it is credited under the card (lib/goplusCredit.ts). */
  goplus: boolean;
}

const NO_HIT: ScanLookup = {
  verified: false, level: null, since: null, source: null, domain: null, provingDomain: null, label: null,
};

/** What kind of value this is: a payment link, a PIX or UPI payment code, or a wallet address. */
export function scanValueKind(value: string): ScanValueKind {
  const q = String(value ?? '').trim();
  const isUrl = /^https?:\/\//i.test(q);
  // EMV/PIX TLV or a UPI intent URI: verification is by exact match, and there is no
  // phishing or sanctions list for these.
  const isPaymentQr = /^upi:\/\//i.test(q) || /^0002\d{2}/.test(q);
  return { isUrl, isPaymentQr, noun: isUrl ? 'link' : isPaymentQr ? 'code' : 'address' };
}

/** Run both checks for one value. Never throws: a failed request reads as it does on the scanner. */
export async function runScanCheck(value: string, fetchImpl: typeof fetch = fetch): Promise<ScanCheckResult> {
  const q = String(value ?? '').trim();
  const { isUrl, isPaymentQr } = scanValueKind(q);
  const miss = (): ScanCheckResult => ({
    lookup: { ...NO_HIT }, lookupAnswered: false, safety: isPaymentQr ? 'idle' : 'error', goplus: false,
  });
  if (!q) return miss();
  try {
    const safetyFetch: Promise<any> = isPaymentQr
      ? Promise.resolve(null)
      : isUrl
        ? fetchImpl(`/api/dapp-check?url=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null)
        : fetchImpl('/api/wallet-check', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: q }),
          }).then((r) => r.json()).catch(() => null);
    const [lk, sf] = await Promise.all([
      fetchImpl(`/api/verify/lookup?address=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null),
      safetyFetch,
    ]);
    const lookupAnswered = !!(lk && lk.ok);
    const lookup: ScanLookup = lookupAnswered
      ? {
          verified: !!lk.verified, level: lk.level ?? null, since: lk.since ?? null, source: lk.source ?? null,
          domain: lk.domain ?? null, provingDomain: lk.provingDomain ?? null, label: lk.label ?? null,
        }
      : { ...NO_HIT };

    if (isPaymentQr) return { lookup, lookupAnswered, safety: 'idle', goplus: false };
    if (isUrl) {
      // dapp-check returns verdict: 'red' | 'yellow' | 'green'
      const v = sf?.verdict;
      const safety: ScanSafety = v === 'red' ? 'danger' : v === 'green' ? 'clean' : v === 'yellow' ? 'unclear' : 'error';
      return { lookup, lookupAnswered, safety, goplus: goplusRanForSite(sf) };
    }
    if (sf && sf.ok && sf.result) {
      // Community reports count as a caution flag, as on the wallet-checker.
      const lvl = addressSafetyVerdict(sf.result.scamLevel, sf.result.chainabuseReports);
      const safety: ScanSafety = lvl === 'danger' ? 'danger' : lvl === 'caution' ? 'caution' : sf.result.partialCoverage ? 'unclear' : 'clean';
      return { lookup, lookupAnswered, safety, goplus: goplusRanForAddress(sf.result) };
    }
    return { lookup, lookupAnswered, safety: 'error', goplus: false };
  } catch {
    return miss();
  }
}
