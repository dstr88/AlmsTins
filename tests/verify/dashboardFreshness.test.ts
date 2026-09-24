import { describe, it, expect } from 'vitest';
import { isCurrentlyVerified, statusLabel } from '../../src/components/verify/VerifyDashboard';

/**
 * F12 — the dashboard's own badge must follow the exact 24h freshness rule the public
 * lookup does (merchantAddressAssurance), not just "was it ever anchored" (hasAnchor).
 * Before this, a stale anchor still showed the owner "Verified" while a customer's scan
 * of the same address already read "Claimed".
 */

const T = VerifyDashboardLocaleStub();
type DestArg = Parameters<typeof isCurrentlyVerified>[0];
function dest(over: Partial<DestArg> = {}): DestArg {
  return {
    id: 'd1', kind: 'address', rail: 'ethereum', value: '0x' + '1'.repeat(40),
    label: null, displayHint: null, proofStatus: 'proven', proofMethod: 'well_known',
    proofDomain: 'shop.example', domainAnchoredAt: '2026-01-01 00:00:00',
    lastConfirmedAt: '2026-01-01 00:00:00', provenAt: '2026-01-01 00:00:00',
    registeredAt: '2026-01-01 00:00:00', monitorUrl: null, monitorStatus: null, monitorCheckedAt: null,
    ...over,
  };
}

describe('isCurrentlyVerified (F12: same freshness rule as the public lookup)', () => {
  it('is true for an address anchored and re-confirmed inside the last 24h', () => {
    const fresh = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
    expect(isCurrentlyVerified(dest({ lastConfirmedAt: fresh }))).toBe(true);
  });

  it('is false once the last confirmation is more than 24h old, even though it was anchored', () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    expect(isCurrentlyVerified(dest({ lastConfirmedAt: stale }))).toBe(false);
  });

  it('is false for a self-send-only claim with no domain anchor', () => {
    expect(isCurrentlyVerified(dest({ proofDomain: null, domainAnchoredAt: null, proofMethod: 'micro_deposit' }))).toBe(false);
  });

  it('is false for a non-address (QR) destination', () => {
    expect(isCurrentlyVerified(dest({ kind: 'qr' }))).toBe(false);
  });

  it('is false for an unproven destination', () => {
    expect(isCurrentlyVerified(dest({ proofStatus: 'unproven' }))).toBe(false);
  });
});

describe('statusLabel reads `fresh`, not raw anchor state', () => {
  it('shows Claimed, not Verified, when the row is proven+anchored but not fresh', () => {
    expect(statusLabel('proven', false, T)).toBe(T.statusClaimed);
  });
  it('shows Verified only when fresh is true', () => {
    expect(statusLabel('proven', true, T)).toBe(T.statusProven);
  });
});

// Minimal locale stand-in — only the keys statusLabel actually reads.
function VerifyDashboardLocaleStub() {
  return {
    statusLapsed: 'Lapsed', statusRevoked: 'Revoked',
    statusProven: 'Verified', statusClaimed: 'Claimed', statusRegistered: 'Registered',
  } as any;
}
