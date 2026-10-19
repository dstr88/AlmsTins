import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

/**
 * The first visit of an account that has the Vault (src/lib/agenticsFirstVisit.ts): once the Vault is open,
 * a new account is handed straight to its home, so its signup and welcome letter are done behind the page.
 * The signup module and the session are replaced; every address and tenant is invented.
 */
const spies = vi.hoisted(() => ({ welcome: vi.fn<(i: any) => Promise<string>>(), session: vi.fn<(r: Request) => Promise<any>>() }));
vi.mock('@/lib/agenticsSignup', () => ({ welcomeOnFirstVisit: (i: any) => spies.welcome(i) }));
vi.mock('@/lib/authSession', () => ({ getAuthSession: (r: Request) => spies.session(r) }));

import { recordVaultFirstVisit } from '../../src/lib/agenticsFirstVisit';

const OTHER = '00000000-0000-4000-8000-000000000002';
const request = new Request('https://almstins.com/dashboard/agentics?src=linkedin');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  spies.welcome.mockReset().mockResolvedValue('sent');
  spies.session.mockReset().mockResolvedValue({ user: { email: 'new.person@example.test' } });
});

describe('recording the first visit of an account that has the Vault', () => {
  it('records the signup and sends the letter for an ordinary account, with the address from its session and the campaign label cleaned', async () => {
    recordVaultFirstVisit(request, { tenantId: OTHER }, ' LinkedIn ');
    await settle();
    expect(spies.welcome).toHaveBeenCalledTimes(1);
    expect(spies.welcome).toHaveBeenCalledWith({ tenantId: OTHER, email: 'new.person@example.test', source: 'linkedin' });
  });

  it('turns a label that is not one into direct, and a missing one too', async () => {
    recordVaultFirstVisit(request, { tenantId: OTHER }, '<script>');
    recordVaultFirstVisit(request, { tenantId: OTHER }, null);
    await settle();
    expect(spies.welcome.mock.calls.map((c) => c[0].source)).toEqual(['direct', 'direct']);
  });

  it('leaves the deployment owner out: it is not a signup, whatever the letter case of its id', async () => {
    recordVaultFirstVisit(request, { tenantId: OWNER_TENANT_ID }, null);
    recordVaultFirstVisit(request, { tenantId: OWNER_TENANT_ID.toUpperCase() }, null);
    await settle();
    expect(spies.welcome).not.toHaveBeenCalled();
    expect(spies.session).not.toHaveBeenCalled();
  });

  it('does nothing for a demo session, a visitor with no tenant, or no session at all', async () => {
    recordVaultFirstVisit(request, { tenantId: DEMO_TENANT_ID, isDemo: true }, null);
    recordVaultFirstVisit(request, { tenantId: null }, null);
    recordVaultFirstVisit(request, { tenantId: '' }, null);
    recordVaultFirstVisit(request, null, null);
    recordVaultFirstVisit(request, undefined, null);
    await settle();
    expect(spies.welcome).not.toHaveBeenCalled();
  });

  it('returns at once, before the letter is sent: the Vault\'s home never waits for a mail server', () => {
    let release: () => void = () => {};
    spies.welcome.mockImplementation(() => new Promise((resolve) => { release = () => resolve('sent'); }));
    expect(recordVaultFirstVisit(request, { tenantId: OTHER }, null)).toBeUndefined();
    release();
  });

  it('a session that cannot be read sends no address (the signup is still recorded), and never throws', async () => {
    spies.session.mockRejectedValue(new Error('session store down'));
    expect(() => recordVaultFirstVisit(request, { tenantId: OTHER }, null)).not.toThrow();
    await settle();
    expect(spies.welcome).toHaveBeenCalledWith({ tenantId: OTHER, email: null, source: 'direct' });
  });

  it('an unexpected failure of the letter code is swallowed, not an unhandled rejection', async () => {
    spies.welcome.mockRejectedValue(new Error('boom'));
    expect(() => recordVaultFirstVisit(request, { tenantId: OTHER }, null)).not.toThrow();
    await settle();
    await settle();
  });
});
