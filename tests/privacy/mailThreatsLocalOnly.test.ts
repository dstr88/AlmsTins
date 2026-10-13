import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mail is other people's data, so screening an inbox must never send an address or a link
// to an outside service (privacy policy v1.2, decided 2026-10-10). The OFAC mirror and the
// domain lists are local tables; stub them so this suite needs no database and no network.
const sanctioned = new Set<string>();
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [] }), batch: async () => [] } }));
vi.mock('../../src/lib/db', () => ({ db: { execute: async () => ({ rows: [] }), batch: async () => [] } }));
vi.mock('@/lib/threatLists', () => ({
  lookupSanctionedAddress: async (a: string) => sanctioned.has(a.toLowerCase()),
  lookupDomainThreats: async () => ({ ready: true, metamaskBlacklist: false, metamaskWhitelist: false, scamsniffer: false }),
}));
vi.mock('../../src/lib/threatLists', () => ({
  lookupSanctionedAddress: async (a: string) => sanctioned.has(a.toLowerCase()),
  lookupDomainThreats: async () => ({ ready: true, metamaskBlacklist: false, metamaskWhitelist: false, scamsniffer: false }),
}));

import { scanMessage, newScanBudget } from '../../src/lib/mailThreats';

const PLAIN = '0x1111111111111111111111111111111111111111';
const SANCTIONED = '0x2222222222222222222222222222222222222222';
const TORNADO = '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf';

const fetchMock = vi.fn(async () => new Response('should not be called', { status: 500 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  sanctioned.clear();
  sanctioned.add(SANCTIONED);
});

describe('inbox screening stays local', () => {
  it('never calls fetch, whatever the message holds', async () => {
    const text = `Pay ${PLAIN} or ${SANCTIONED} or ${TORNADO}. Details: https://example.com/invoice`;
    await scanMessage(text, newScanBudget(), { tenantId: 't1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags an address on the local OFAC mirror', async () => {
    const f = await scanMessage(`send to ${SANCTIONED}`, newScanBudget());
    expect(f).toContainEqual(expect.objectContaining({ kind: 'address', severity: 'danger', reason: expect.stringMatching(/OFAC sanctioned/) }));
  });

  it('flags a known mixer contract', async () => {
    const f = await scanMessage(`send to ${TORNADO}`, newScanBudget());
    expect(f).toContainEqual(expect.objectContaining({ kind: 'address', reason: expect.stringMatching(/mixer/) }));
  });

  it('stays silent on an address that is on no local list', async () => {
    const f = await scanMessage(`send to ${PLAIN}`, newScanBudget());
    expect(f.filter((x) => x.kind === 'address')).toEqual([]);
  });

  it('does not spend the address budget', async () => {
    const budget = newScanBudget();
    const before = budget.addressChecksLeft;
    await scanMessage(`${PLAIN} ${SANCTIONED}`, budget);
    expect(budget.addressChecksLeft).toBe(before);
  });
});
