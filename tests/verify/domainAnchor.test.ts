import { describe, it, expect } from 'vitest';
import {
  decideAnchor, decideAnchorLoss, anchoredSince, hasAnchor, merchantAddressAssurance,
  type AnchorCandidate, type MerchantAddressRow,
} from '../../src/lib/verifyAnchor';

/**
 * Control (proven_at, proof_method) and the domain anchor (proof_domain, domain_anchored_at)
 * are separate facts. These pin the decisions that keep them separate: a domain proof may
 * attach a domain to a self-send-proven address but never move it between domains, losing the
 * anchor never destroys a self-send control proof, and "verified since" is the anchor's age.
 * A claim made under the old, unbound self-send rule (legacy_unbound) is never anchored.
 */
/** A self-send address; a proof_domain gets a real anchor date unless `o` says otherwise. */
const addr = (proofStatus: string, proofDomain: string | null, legacyUnbound = false, o: Partial<AnchorCandidate> = {}): AnchorCandidate => ({
  kind: 'address', proofStatus, proofMethod: 'micro_deposit', proofDomain, provenAt: '2026-01-01 00:00:00',
  domainAnchoredAt: proofDomain ? '2026-09-01 00:00:00' : null, legacyUnbound, ...o,
});

describe('decideAnchor (what a successful domain proof does to a destination)', () => {
  it('skips anything the file does not list, and every QR', () => {
    expect(decideAnchor(addr('unproven', null), 'shop.com', false)).toBe('skip');
    expect(decideAnchor(addr('proven', null), 'shop.com', false)).toBe('skip');
    expect(decideAnchor({ ...addr('proven', null), kind: 'qr', proofMethod: 'account_claim' }, 'shop.com', true)).toBe('skip');
  });

  it('proves and anchors an unproven or lapsed address', () => {
    expect(decideAnchor(addr('unproven', null), 'shop.com', true)).toBe('flip');
    expect(decideAnchor(addr('lapsed', 'shop.com'), 'shop.com', true)).toBe('flip');
  });

  it('attaches the domain to a self-send-proven address (Claimed → Verified)', () => {
    expect(decideAnchor(addr('proven', null), 'shop.com', true)).toBe('anchor');
  });

  it('re-confirms an address already anchored to the same domain', () => {
    expect(decideAnchor(addr('proven', 'shop.com'), 'shop.com', true)).toBe('reconfirm');
    // A file-proven row anchored before domain_anchored_at existed is anchored too (its
    // proven_at is when the file anchored it).
    expect(decideAnchor(addr('proven', 'shop.com', false, { proofMethod: 'well_known', domainAnchoredAt: null }), 'shop.com', true))
      .toBe('reconfirm');
  });

  it('treats a leftover proof_domain with no anchor date as no anchor: a new, guarded, dated anchor', () => {
    // Before domain_anchored_at, a self-send re-prove of a lapsed file-proven row kept the old
    // domain. The public lookup never called that Verified, so the proof must not either: a
    // 'reconfirm' would skip the claim guard and date a brand-new anchor.
    const leftover = addr('proven', 'shop.com', false, { domainAnchoredAt: null });
    expect(decideAnchor(leftover, 'shop.com', true)).toBe('anchor');
    // And a leftover of another domain is not stuck as 'other_domain'.
    expect(decideAnchor(leftover, 'shop-pay.com', true)).toBe('anchor');
  });

  it('never moves an address anchored to a different domain', () => {
    expect(decideAnchor(addr('proven', 'shop.com'), 'shop-pay.com', true)).toBe('other_domain');
  });

  it('refuses to anchor a legacy unbound claim: it may be a squat, and a listing cannot vouch for it', () => {
    // Proven under the old rule (any outgoing tx counted), no domain yet: the exact case a
    // naive rebase would lift to Verified under whatever domain lists it.
    expect(decideAnchor(addr('proven', null, true), 'shop.com', true)).toBe('legacy_unbound');
  });

  it('never re-confirms a legacy unbound claim either, even one carrying a leftover domain', () => {
    // A pre-0035 leftover proof_domain on a legacy row must not become an anchor date.
    expect(decideAnchor(addr('proven', 'shop.com', true), 'shop.com', true)).toBe('legacy_unbound');
    expect(decideAnchor(addr('proven', 'shop.com', true), 'other.com', true)).toBe('legacy_unbound');
  });

  it('refuses to flip an unproven twin of a legacy claim (the caller sets the flag for it)', () => {
    // The same account's checksum/lowercase or URI-wrapped copy of a legacy wallet: flipping
    // it would do exactly what anchoring the legacy row would.
    expect(decideAnchor(addr('unproven', null, true, { proofMethod: 'none' }), 'shop.com', true)).toBe('legacy_unbound');
  });

  it('anchors the same wallet once a bound re-proof has cleared the tag', () => {
    // The bound satoshi test's flip writes legacy_unbound = false.
    expect(decideAnchor(addr('proven', null, false), 'shop.com', true)).toBe('anchor');
  });

  it('still skips a legacy claim the file does not list', () => {
    expect(decideAnchor(addr('proven', null, true), 'shop.com', false)).toBe('skip');
  });
});

describe('decideAnchorLoss (the watchman sees the domain stop vouching)', () => {
  it('lapses only an address whose control was proven by the file itself', () => {
    expect(decideAnchorLoss('well_known')).toBe('lapse');
  });

  it('keeps a self-send control proof and only drops the anchor', () => {
    expect(decideAnchorLoss('micro_deposit')).toBe('unanchor');
    // Any other method is also control proven elsewhere: never lapse it on a file change.
    expect(decideAnchorLoss('none')).toBe('unanchor');
    expect(decideAnchorLoss('')).toBe('unanchor');
  });
});

const CUTOFF = '2026-09-22 12:00:00'; // 24h before "now" in these cases
const row = (o: Partial<MerchantAddressRow>): MerchantAddressRow => ({
  proofMethod: 'micro_deposit', proofDomain: null, provenAt: '2026-01-01 00:00:00',
  domainAnchoredAt: null, lastConfirmedAt: null, ...o,
});

describe('hasAnchor (one rule for the proof, the lookup and the dashboard)', () => {
  it('needs a domain and a known anchor date', () => {
    expect(hasAnchor(row({}))).toBe(false);
    expect(hasAnchor(row({ proofDomain: 'shop.com', domainAnchoredAt: '2026-09-20 08:00:00' }))).toBe(true);
    expect(hasAnchor(row({ proofMethod: 'well_known', proofDomain: 'shop.com' }))).toBe(true);
    // A leftover self-send domain with no anchor date is not an anchor.
    expect(hasAnchor(row({ proofDomain: 'shop.com' }))).toBe(false);
    // An anchor date with no domain (never written together that way) is not one either.
    expect(hasAnchor(row({ domainAnchoredAt: '2026-09-20 08:00:00' }))).toBe(false);
  });
});

describe('anchoredSince', () => {
  it('uses the recorded anchor date when present', () => {
    expect(anchoredSince(row({ proofDomain: 'shop.com', domainAnchoredAt: '2026-09-20 08:00:00' }))).toBe('2026-09-20 08:00:00');
  });

  it('falls back to proven_at only for legacy file-proven rows (the file anchored them then)', () => {
    expect(anchoredSince(row({ proofMethod: 'well_known', proofDomain: 'shop.com' }))).toBe('2026-01-01 00:00:00');
  });

  it('never borrows a self-send proof date as the anchor date', () => {
    expect(anchoredSince(row({ proofDomain: 'shop.com' }))).toBeNull();
  });
});

describe('merchantAddressAssurance (public level + since)', () => {
  it('self-send only → claimed, since = control proof date', () => {
    expect(merchantAddressAssurance(row({}), CUTOFF)).toEqual({ level: 'claimed', since: '2026-01-01 00:00:00' });
  });

  it('self-send + fresh domain anchor → verified, since = anchor date (not the older self-send)', () => {
    const r = row({ proofDomain: 'shop.com', domainAnchoredAt: '2026-09-22 20:00:00', lastConfirmedAt: '2026-09-22 20:00:00' });
    expect(merchantAddressAssurance(r, CUTOFF)).toEqual({ level: 'verified', since: '2026-09-22 20:00:00' });
  });

  it('a stale anchor degrades to claimed and reports the control date', () => {
    const r = row({ proofDomain: 'shop.com', domainAnchoredAt: '2026-09-01 00:00:00', lastConfirmedAt: '2026-09-10 00:00:00' });
    expect(merchantAddressAssurance(r, CUTOFF)).toEqual({ level: 'claimed', since: '2026-01-01 00:00:00' });
  });

  it('freshness falls back to the anchor date, never to an old self-send date', () => {
    // Anchored but never confirmed since: the self-send date (Jan) must not count as a confirm.
    expect(merchantAddressAssurance(row({ proofDomain: 'shop.com' }), CUTOFF).level).toBe('claimed');
    const fresh = row({ proofDomain: 'shop.com', domainAnchoredAt: '2026-09-23 01:00:00' });
    expect(merchantAddressAssurance(fresh, CUTOFF)).toEqual({ level: 'verified', since: '2026-09-23 01:00:00' });
  });

  it('legacy file-proven row keeps its behavior: verified since proven_at while fresh', () => {
    const r = row({ proofMethod: 'well_known', proofDomain: 'shop.com', provenAt: '2026-05-01 12:00:00', lastConfirmedAt: '2026-09-23 00:00:00' });
    expect(merchantAddressAssurance(r, CUTOFF)).toEqual({ level: 'verified', since: '2026-05-01 12:00:00' });
  });

  it('a leftover self-send domain with no known anchor date is not verified, even if confirmed', () => {
    // Pre-fix, a self-send re-prove of a lapsed file-proven row kept the old proof_domain.
    const r = row({ proofDomain: 'shop.com', lastConfirmedAt: '2026-09-23 00:00:00' });
    expect(merchantAddressAssurance(r, CUTOFF)).toEqual({ level: 'claimed', since: '2026-01-01 00:00:00' });
  });

  it('a cleared anchor is claimed even if a published-page check was fresh', () => {
    const r = row({ proofDomain: null, lastConfirmedAt: '2026-09-23 00:00:00' });
    expect(merchantAddressAssurance(r, CUTOFF).level).toBe('claimed');
  });
});
