import { describe, it, expect, vi, afterEach } from 'vitest';
import { announcePlan, codeOf, failureText, PLAN_EVENT, planFactsOf, send, type ApiResult } from '../../src/components/agentics/client';
import { errorText, planLimitText } from '../../src/components/agentics/errors';
import { copy } from '../../src/components/agentics/copy';
import { planMeterText } from '../../src/components/agentics/PlanMeter';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * How the Agentics pages talk to the Vault's API from the browser, and how a failure becomes words:
 * a dropped connection is an answer (status 0), never a thrown error; an answer that is not JSON is
 * handled; a code the page does not know becomes the plain fallback; a plan limit says which cap and
 * what the plan covers, calmly, with no mention of money.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

describe('send', () => {
  it('sends JSON with the account\'s cookie, and hands back the status and the object it got', async () => {
    const fetchMock = vi.fn(async () => reply(201, { ok: true, tin: { id: 'x' } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await send('POST', '/api/agentics/tins', { label: 'Agent' });
    expect(r).toEqual({ status: 201, ok: true, body: { ok: true, tin: { id: 'x' } } });
    expect(fetchMock).toHaveBeenCalledWith('/api/agentics/tins', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"label":"Agent"}',
    });
  });

  it('sends no body and no content type for a request without one', async () => {
    const fetchMock = vi.fn(async () => reply(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await send('GET', '/api/agentics/plan');
    expect(fetchMock).toHaveBeenCalledWith('/api/agentics/plan', { method: 'GET', credentials: 'same-origin', headers: undefined, body: undefined });
  });

  it('a dropped connection is status 0, not an error to catch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await send('GET', '/api/agentics/plan')).toEqual({ status: 0, ok: false, body: null });
  });

  it('an answer that is not JSON, or not an object, has no body; an answer that says ok: false is not ok whatever the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 502, ok: false, json: async () => { throw new SyntaxError('no'); } }) as unknown as Response));
    expect(await send('GET', '/x')).toEqual({ status: 502, ok: false, body: null });
    for (const odd of [[1, 2], 'text', 7, null]) {
      vi.stubGlobal('fetch', vi.fn(async () => reply(200, odd)));
      expect((await send('GET', '/x')).body).toBeNull();
    }
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { ok: false, error: 'tin_not_found' })));
    expect(await send('GET', '/x')).toMatchObject({ status: 200, ok: false });
  });
});

describe('codeOf and failureText', () => {
  const r = (status: number, body: Record<string, unknown> | null): ApiResult => ({ status, ok: false, body });

  it('uses the API\'s code, `network` when there was no answer and `server_error` when there was no code', () => {
    expect(codeOf(r(404, { ok: false, error: 'tin_not_found' }))).toBe('tin_not_found');
    expect(codeOf(r(0, null))).toBe('network');
    expect(codeOf(r(500, null))).toBe('server_error');
    expect(codeOf(r(500, { error: 7 }))).toBe('server_error');
  });

  it('turns it into the page\'s words, and anything it does not know into the plain fallback', () => {
    expect(failureText(r(404, { error: 'tin_not_found' }))).toBe(copy.errors.tin_not_found);
    expect(failureText(r(0, null))).toBe(copy.errors.network);
    expect(failureText(r(500, null))).toBe(copy.errors.generic);
    expect(failureText(r(400, { error: '<script>alert(1)</script>' }))).toBe(copy.errors.generic);
    expect(failureText(r(400, { error: 'constructor' }))).toBe(copy.errors.generic);
  });

  it('says which cap a plan limit ran into and what the plan covers, in calm words', () => {
    expect(failureText(r(409, { error: 'plan_limit', cap: 'bots', limit: 3, used: 3 }))).toBe('Your free plan covers 3 agents. Paid plans are coming later.');
    expect(failureText(r(409, { error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 }))).toBe('Your free plan covers 15 addresses. Paid plans are coming later.');
    expect(failureText(r(409, { error: 'plan_limit', cap: 'wallets', limit: 5, used: 5 }))).toBe('Your free plan covers 5 wallets for each agent. Paid plans are coming later.');
  });

  it('falls back to a general line for a plan limit it cannot word: an unknown cap, no limit, a limit that is not a number', () => {
    for (const odd of [{ cap: 'galaxies', limit: 3 }, { cap: 'bots' }, { cap: 'bots', limit: '3' }, { cap: 'bots', limit: Number.NaN }, {}, { cap: 'constructor', limit: 3 }, { cap: '__proto__', limit: 1 }]) {
      expect(errorText('plan_limit', odd), JSON.stringify(odd)).toBe(copy.errors.plan_limit);
    }
    expect(planLimitText('bots', 3)).toBe(copy.plan.limit.bots(3));
  });

  it('never talks about money: no price, no upgrade, no billing, no exclamation', () => {
    const words = [
      copy.plan.limit.bots(3), copy.plan.limit.addresses(15), copy.plan.limit.wallets(5), copy.errors.plan_limit,
      copy.plan.full.bots, copy.plan.full.addresses, copy.plan.full.wallets,
      copy.plan.free(2, 3, 9, 15), copy.plan.unlimited(2, 9),
    ];
    for (const w of words) {
      expect(w, w).not.toMatch(/upgrade|price|pric|billing|subscri|checkout|invoice|\$|premium|!/i);
      expect(brightLineViolations(w), w).toEqual([]);
    }
    expect(copy.plan.limit.bots(3)).toMatch(/Paid plans are coming later\.$/);
  });
});

describe('the plan summary', () => {
  const body = (over: Record<string, unknown> = {}) => ({ ok: true, plan: 'free', label: 'Free', limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 2, addresses: 9 }, ...over });

  it('is read out of an answer, and null limits (no limit) are allowed', () => {
    expect(planFactsOf(body())).toEqual({ plan: 'free', label: 'Free', limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 2, addresses: 9 } });
    expect(planFactsOf(body({ plan: 'unlimited', label: 'Unlimited', limits: { bots: null, addresses: null, walletsPerBot: null } }))?.limits).toEqual({ bots: null, addresses: null, walletsPerBot: null });
  });

  it('is null for anything that is not a plan summary: nothing is made up', () => {
    for (const bad of [null, {}, body({ limits: null }), body({ use: null }), body({ plan: 7 }), body({ label: null }), body({ limits: { bots: 'x', addresses: 15, walletsPerBot: 5 } }), body({ limits: { bots: 3, addresses: 15 } }), body({ use: { bots: 1 } })]) {
      expect(planFactsOf(bad as never), JSON.stringify(bad)).toBeNull();
    }
  });

  it('says a plan it does not know by name is the free one, never an unlimited one', () => {
    expect(planFactsOf(body({ plan: 'platinum' }))?.plan).toBe('free');
  });

  it('is announced to the meter as a browser event, and handed back', async () => {
    const dispatched: Array<{ type: string; detail: unknown }> = [];
    vi.stubGlobal('window', { dispatchEvent: (e: { type: string; detail: unknown }) => { dispatched.push({ type: e.type, detail: e.detail }); return true; } });
    const plan = await announcePlan(async () => ({ status: 200, ok: true, body: body() }));
    expect(plan?.use).toEqual({ bots: 2, addresses: 9 });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe(PLAN_EVENT);
    expect(PLAN_EVENT).toBe('agentics:plan');
    expect((dispatched[0].detail as { use: unknown }).use).toEqual({ bots: 2, addresses: 9 });
  });

  it('announces nothing when the plan could not be read, and says so by answering null', async () => {
    const dispatched: unknown[] = [];
    vi.stubGlobal('window', { dispatchEvent: (e: unknown) => dispatched.push(e) });
    expect(await announcePlan(async () => ({ status: 0, ok: false, body: null }))).toBeNull();
    expect(await announcePlan(async () => ({ status: 200, ok: true, body: { ok: true } }))).toBeNull();
    expect(dispatched).toEqual([]);
  });
});

describe('the meter', () => {
  it('says what the account uses and what the free plan covers', () => {
    expect(planMeterText({ limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 2, addresses: 9 } })).toBe('Free plan: 2 of 3 agents, 9 of 15 addresses');
  });

  it('says what an account with no limits uses and that nothing limits it', () => {
    expect(planMeterText({ limits: { bots: null, addresses: null, walletsPerBot: null }, use: { bots: 1, addresses: 1 } })).toBe('No limits on this account: 1 agent, 1 address');
    expect(planMeterText({ limits: { bots: null, addresses: null, walletsPerBot: null }, use: { bots: 4, addresses: 17 } })).toBe('No limits on this account: 4 agents, 17 addresses');
  });
});
