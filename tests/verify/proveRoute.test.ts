import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/verify/destinations/:id/prove maps what the domain proof did to THIS destination
 * onto one outcome code the dashboard localizes. Pinned here: a destination the proof refused
 * as a legacy unbound claim answers 'reprove_required' (not 'address_not_listed', which would
 * send the owner off to fix a file that is fine), and the other codes keep their meaning.
 */
const mem = vi.hoisted(() => ({
  result: { flipped: [] as string[], otherDomain: [] as string[], claimedElsewhere: [] as string[], legacyUnbound: [] as string[] },
  fileOk: true,
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: 't-1', isDemo: false }) }));
vi.mock('@/lib/verifyRegistry', () => ({
  getDestination: async (_t: string, id: string) => ({ id, kind: 'address' }),
  getChallenge: async () => 'almstins-verify=challenge',
  recordProofResult: async () => mem.result,
  recordDomainControlProof: async () => {},
  markProofChecked: async () => {},
}));
vi.mock('@/lib/verifyProof', () => ({
  normalizeProofDomain: (d: string) => d.trim().toLowerCase(),
  verifyDomainProof: async () => (mem.fileOk ? { ok: true, addresses: ['x'] } : { ok: false, code: 'address_not_listed' }),
  verifyDnsTxt: async () => ({ ok: false }),
}));

import { POST } from '../../src/pages/api/verify/destinations/[id]/prove';

async function prove(id: string): Promise<string> {
  const request = new Request(`https://almstins.com/api/verify/destinations/${id}/prove`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'shop.example', method: 'file' }),
  });
  const res: Response = await (POST as any)({ request, params: { id } });
  return (await res.json()).outcome;
}

beforeEach(() => {
  mem.result = { flipped: [], otherDomain: [], claimedElsewhere: [], legacyUnbound: [] };
  mem.fileOk = true;
});

describe('prove route outcome', () => {
  it('a legacy unbound claim the file lists is reprove_required', async () => {
    mem.result.legacyUnbound = ['d1'];
    expect(await prove('d1')).toBe('reprove_required');
  });

  it('keeps the other codes: proven, anchored elsewhere, claimed elsewhere, not listed', async () => {
    mem.result = { flipped: ['a'], otherDomain: ['b'], claimedElsewhere: ['c'], legacyUnbound: ['d'] };
    expect(await prove('a')).toBe('proven');
    expect(await prove('b')).toBe('anchored_other_domain');
    expect(await prove('c')).toBe('claimed_elsewhere');
    expect(await prove('d')).toBe('reprove_required');
    expect(await prove('e')).toBe('address_not_listed');
  });
});
