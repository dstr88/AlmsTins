import { describe, it, expect } from 'vitest';
import { addr } from '../helpers/agentVault';
import type { ApiResult, Send } from '../../src/components/agentics/client';
import { describePaste, emptyOutcome, PASTE_BATCH, PASTE_MAX_LINES, planPaste, runPaste } from '../../src/components/agentics/paste';

/**
 * Adding a long list of addresses: cut into requests of ten lines, sent one after another, added up
 * so that every line ends up accounted for. No screen and no network here: the request is a function
 * the test supplies. Every address is invented.
 */
const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => addr(from + i));

/** What the server would answer for a request: every line added and trusted. */
const answer = (text: string, over: Record<string, unknown> = {}): ApiResult => {
  const entries = text.split('\n').filter((l) => /^0x/.test(l.trim()));
  return { status: 201, ok: true, body: { ok: true, summary: { added: entries.length, trusted: entries.length, flagged: 0, pending: 0, skipped: 0, rejected: 0 }, skipped: [], rejected: [], ...over } };
};

describe('planPaste: cutting a paste into requests', () => {
  it('sends ten lines to a request: 25 lines are three requests of 10, 10 and 5', () => {
    expect(PASTE_BATCH).toBe(10);
    const plan = planPaste(lines(1, 25).join('\n'));
    expect(plan.lines).toBe(25);
    expect(plan.chunks.map((c) => c.candidates)).toEqual([10, 10, 5]);
    expect(plan.chunks.map((c) => c.firstLine)).toEqual([1, 11, 21]);
    expect(plan.chunks.map((c) => c.text.split('\n').length)).toEqual([10, 10, 5]);
    expect(plan.tooLong).toBe(false);
  });

  it('an exact multiple makes no empty request at the end', () => {
    const plan = planPaste(lines(1, 20).join('\n'));
    expect(plan.chunks.map((c) => c.candidates)).toEqual([10, 10]);
  });

  it('one line is one request, and nothing at all is none', () => {
    expect(planPaste(addr(1)).chunks).toHaveLength(1);
    for (const empty of ['', '   ', '\n\n\n', '# only a comment', '// and another\n\n']) {
      const plan = planPaste(empty);
      expect(plan.chunks, JSON.stringify(empty)).toEqual([]);
      expect(plan.lines).toBe(0);
    }
  });

  it('blank lines and comments ride along without counting, and keep every line number true', () => {
    const text = ['', '# a note', addr(1), '', addr(2), '// another', ...lines(3, 9)].join('\n');
    const plan = planPaste(text);
    expect(plan.lines).toBe(11);
    expect(plan.chunks.map((c) => c.candidates)).toEqual([10, 1]);
    // A comment or blank line before the first address opens nothing; the first request starts at that address.
    expect(plan.chunks[0].firstLine).toBe(3);
    const all = text.split('\n');
    for (const c of plan.chunks) expect(all.slice(c.firstLine - 1, c.firstLine - 1 + c.text.split('\n').length).join('\n')).toBe(c.text);
  });

  it('handles Windows and old Mac line endings', () => {
    expect(planPaste(`${addr(1)}\r\n${addr(2)}\r${addr(3)}\n${addr(4)}`).lines).toBe(4);
    expect(planPaste(`${addr(1)}\r\n${addr(2)}`).chunks[0].text).toBe(`${addr(1)}\n${addr(2)}`);
  });

  it('a header line counts as a line, so a request never carries more than ten', () => {
    const plan = planPaste(['address,label', ...lines(1, 10)].join('\n'));
    expect(plan.lines).toBe(11);
    expect(plan.chunks.map((c) => c.candidates)).toEqual([10, 1]);
  });

  it('puts every line in exactly one request, in order: nothing is dropped and nothing is repeated', () => {
    for (const n of [1, 9, 10, 11, 19, 20, 21, 57, 200]) {
      const pasted = lines(1, n);
      const sent = planPaste(pasted.join('\n')).chunks.flatMap((c) => c.text.split('\n').filter((l) => l.trim() !== ''));
      expect(sent, `n=${n}`).toEqual(pasted);
    }
    // And with blanks and comments mixed in.
    const mixed = ['# list', '', ...lines(1, 12), '', '// end'];
    const sent = planPaste(mixed.join('\n')).chunks.flatMap((c) => c.text.split('\n'));
    expect(sent.filter((l) => /^0x/.test(l))).toEqual(lines(1, 12));
  });

  it('says a paste is too long past 200 lines, and takes exactly 200', () => {
    expect(PASTE_MAX_LINES).toBe(200);
    expect(planPaste(lines(1, 200).join('\n')).tooLong).toBe(false);
    expect(planPaste(lines(1, 201).join('\n')).tooLong).toBe(true);
  });

  it('cuts a line that is far too long, so one line cannot swell a request, and still sends it to be refused as a line', () => {
    const plan = planPaste(`${'x'.repeat(100_000)}\n${addr(1)}`);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].text.length).toBeLessThan(700);
    expect(plan.lines).toBe(2);
  });
});

describe('runPaste: sending the requests and adding up the answers', () => {
  const run = (text: string, call: Send, onProgress?: (p: unknown) => void) =>
    runPaste(planPaste(text), { tinId: 'tin-1', chain: 'ethereum', call, onProgress: onProgress as never });

  it('sends one request at a time, in order, each with the agent, the chain and its ten lines', async () => {
    const calls: Array<{ method: string; url: string; body: any }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const call: Send = async (method, url, body) => {
      calls.push({ method, url, body });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return answer((body as { text: string }).text);
    };
    const out = await run(lines(1, 25).join('\n'), call);
    expect(maxInFlight).toBe(1);
    expect(calls.map((c) => [c.method, c.url])).toEqual(Array(3).fill(['POST', '/api/agentics/destinations']));
    expect(calls.every((c) => c.body.tinId === 'tin-1' && c.body.chain === 'ethereum')).toBe(true);
    expect(calls.map((c) => c.body.text.split('\n').length)).toEqual([10, 10, 5]);
    expect(out).toMatchObject({ added: 25, trusted: 25, flagged: 0, pending: 0, already: 0, repeated: 0, overLimit: 0, unreadable: 0, notTried: 0, endedBecause: null });
  });

  it('adds up what every request said, and puts each skipped or unreadable line at its place in the whole paste', async () => {
    const replies: ApiResult[] = [
      { status: 201, ok: true, body: { ok: true, summary: { added: 8, trusted: 6, flagged: 1, pending: 1 }, skipped: [{ line: 3, address: addr(3), reason: 'already_registered' }], rejected: [{ line: 5, reason: 'bad_address', text: '0xnope' }] } },
      { status: 200, ok: true, body: { ok: true, summary: { added: 0, trusted: 0, flagged: 0, pending: 0 }, skipped: [{ line: 1, address: addr(11), reason: 'repeated_in_paste' }, { line: 2, address: addr(12), reason: 'already_registered' }], rejected: [] } },
    ];
    const out = await run(lines(1, 12).join('\n'), async () => replies.shift() as ApiResult);
    expect(out).toMatchObject({ added: 8, trusted: 6, flagged: 1, pending: 1, already: 2, repeated: 1, overLimit: 0, unreadable: 1, notTried: 0 });
    expect(out.lines).toEqual([
      { line: 3, text: addr(3), reason: 'already_registered' },
      { line: 5, text: '0xnope', reason: 'bad_address' },
      { line: 11, text: addr(11), reason: 'repeated_in_paste' },
      { line: 12, text: addr(12), reason: 'already_registered' },
    ]);
  });

  it('counts a line the plan had no place for as over the limit, and keeps it in the list with its reason', async () => {
    const call: Send = async () => ({ status: 201, ok: true, body: { ok: true, summary: { added: 2, trusted: 2, flagged: 0, pending: 0 }, skipped: [{ line: 3, address: addr(3), reason: 'over_limit' }, { line: 4, address: addr(4), reason: 'over_limit' }], rejected: [] } });
    const out = await run(lines(1, 4).join('\n'), call);
    expect(out).toMatchObject({ added: 2, overLimit: 2, already: 0 });
    expect(out.lines.map((l) => l.reason)).toEqual(['over_limit', 'over_limit']);
  });

  it('when the plan has no place left it counts that request and every later one as over the limit, says why, and sends nothing more', async () => {
    const calls: unknown[] = [];
    const replies: ApiResult[] = [
      answer(lines(1, 10).join('\n')),
      { status: 409, ok: false, body: { ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 } },
    ];
    const out = await run(lines(1, 35).join('\n'), async (_m, _u, body) => {
      calls.push(body);
      return replies.shift() as ApiResult;
    });
    expect(calls).toHaveLength(2);
    expect(out.added).toBe(10);
    expect(out.overLimit).toBe(10); // the refused request
    expect(out.notTried).toBe(15); // the two requests behind it were never sent
    expect(out.endedBecause).toBe('Your free plan covers 15 addresses. Paid plans are coming later.');
  });

  it('any other failure ends the paste there: that request and the rest are not tried, and the reason is in plain words', async () => {
    const cases: Array<[ApiResult, string]> = [
      [{ status: 0, ok: false, body: null }, 'Could not reach the server. Check your connection and try again.'],
      [{ status: 429, ok: false, body: { ok: false, error: 'rate_limited' } }, 'That is a lot of requests in a short time. Wait a minute, then try again.'],
      [{ status: 404, ok: false, body: { ok: false, error: 'tin_not_found' } }, 'That agent was not found.'],
      [{ status: 500, ok: false, body: { ok: false, error: 'server_error' } }, 'Something went wrong. Try again in a moment.'],
      [{ status: 200, ok: true, body: null }, 'Something went wrong. Try again in a moment.'],
      [{ status: 400, ok: false, body: { ok: false, error: '<script>alert(1)</script>' } }, 'Something went wrong. Try again in a moment.'],
    ];
    for (const [reply, why] of cases) {
      const calls: number[] = [];
      const replies: ApiResult[] = [answer(lines(1, 10).join('\n')), reply];
      const out = await run(lines(1, 30).join('\n'), async () => {
        calls.push(1);
        return replies.shift() as ApiResult;
      });
      expect(calls, why).toHaveLength(2);
      expect(out.added, why).toBe(10);
      expect(out.notTried, why).toBe(20);
      expect(out.overLimit, why).toBe(0);
      expect(out.endedBecause, why).toBe(why);
    }
  });

  it('reports its progress before each request and when it is done', async () => {
    const seen: Array<{ done: number; total: number; fromLine: number; toLine: number }> = [];
    await run(lines(1, 25).join('\n'), async (_m, _u, body) => answer((body as { text: string }).text), (p) => seen.push(p as never));
    expect(seen).toEqual([
      { done: 0, total: 3, fromLine: 1, toLine: 10 },
      { done: 1, total: 3, fromLine: 11, toLine: 20 },
      { done: 2, total: 3, fromLine: 21, toLine: 25 },
      { done: 3, total: 3, fromLine: 0, toLine: 0 },
    ]);
  });

  it('a paste with nothing in it sends nothing', async () => {
    let called = false;
    const out = await runPaste(planPaste(''), { tinId: 't', chain: 'ethereum', call: async () => { called = true; return answer(''); } });
    expect(called).toBe(false);
    expect(out).toEqual(emptyOutcome());
  });

  it('ignores a number it cannot trust and a skipped entry with no address, rather than counting nonsense', async () => {
    const call: Send = async () => ({ status: 201, ok: true, body: { ok: true, summary: { added: 'many', trusted: null, flagged: -0, pending: Number.NaN }, skipped: [null, { reason: 7 }, 'x'], rejected: [{ line: 'two' }] } });
    const out = await run(addr(1), call);
    expect(out).toMatchObject({ added: 0, trusted: 0, flagged: 0, pending: 0 });
    expect(out.already).toBe(1); // an entry with no recognizable reason is filed as already registered
    expect(out.unreadable).toBe(1);
  });
});

describe('describePaste: the sentences that sum a paste up', () => {
  it('always says what was added and what was skipped, zero or not, so a paste can be checked against its own line count', () => {
    expect(describePaste(emptyOutcome())).toEqual(['0 added: 0 trusted (Pass), 0 flagged (Fail), 0 pending (Limited or not checked)', '0 skipped']);
  });

  it('says how the added ones came out, and why the others were skipped', () => {
    const out = { ...emptyOutcome(), added: 12, trusted: 9, flagged: 2, pending: 1, already: 3, repeated: 1, overLimit: 4 };
    expect(describePaste(out)).toEqual([
      '12 added: 9 trusted (Pass), 2 flagged (Fail), 1 pending (Limited or not checked)',
      "8 skipped: 3 already registered, 1 repeated in the paste, 4 over the free plan's limit, not added",
    ]);
  });

  it('says what was not read as an address, what was never tried, and why the paste ended', () => {
    const out = { ...emptyOutcome(), added: 1, trusted: 1, unreadable: 2, notTried: 20, endedBecause: 'Could not reach the server. Check your connection and try again.' };
    expect(describePaste(out).slice(2)).toEqual([
      '2 lines not read as an address',
      '20 lines not tried, because the paste ended early',
      'The paste ended early: Could not reach the server. Check your connection and try again.',
    ]);
    expect(describePaste({ ...emptyOutcome(), unreadable: 1 })[2]).toBe('1 line not read as an address');
    expect(describePaste({ ...emptyOutcome(), notTried: 1 })[2]).toBe('1 line not tried, because the paste ended early');
  });

  it('accounts for every line of a paste: added + skipped + unreadable + not tried is the lines that were pasted', async () => {
    const text = lines(1, 23).join('\n');
    const replies: ApiResult[] = [
      { status: 201, ok: true, body: { ok: true, summary: { added: 6, trusted: 6, flagged: 0, pending: 0 }, skipped: [{ line: 2, address: addr(2), reason: 'already_registered' }, { line: 9, address: addr(9), reason: 'over_limit' }, { line: 10, address: addr(10), reason: 'over_limit' }], rejected: [{ line: 1, reason: 'bad_address', text: 'x' }] } },
      { status: 409, ok: false, body: { ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 } },
    ];
    const out = await runPaste(planPaste(text), { tinId: 't', chain: 'ethereum', call: async () => replies.shift() as ApiResult });
    const skipped = out.already + out.repeated + out.overLimit;
    // 10 lines answered (6 added, 3 skipped, 1 unreadable), 10 refused by the plan, 3 never sent.
    expect(out).toMatchObject({ added: 6, already: 1, overLimit: 12, unreadable: 1, notTried: 3 });
    expect(out.added + skipped + out.unreadable + out.notTried).toBe(23);
  });
});

describe('runPaste: a request the plan refuses as a whole still says what became of each of its lines', () => {
  const planLimit = (skipped: unknown[], rejected: unknown[] = []): ApiResult => ({
    status: 409, ok: false,
    body: { ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15, skipped, rejected },
  });

  it('counts the lines from the answer: already registered is not over the limit, and an unreadable line is not either', async () => {
    // 13 lines at 14 of 15: six already registered, one that is not an address, three that do not fit, then three never sent.
    const text = [...lines(1, 6), 'not an address', ...lines(40, 3), ...lines(50, 3)].join('\n');
    const reply = planLimit(
      [
        ...lines(1, 6).map((address, i) => ({ line: i + 1, chain: 'ethereum', address, reason: 'already_registered', id: `d${i}`, trustStatus: 'trusted' })),
        ...lines(40, 3).map((address, i) => ({ line: 8 + i, chain: 'ethereum', address, reason: 'over_limit' })),
      ],
      [{ line: 7, reason: 'no_address', text: 'not an address' }],
    );
    const out = await runPaste(planPaste(text), { tinId: 't', chain: 'ethereum', call: async () => reply });
    expect(out).toMatchObject({ added: 0, already: 6, repeated: 0, overLimit: 3, unreadable: 1, notTried: 3 });
    expect(out.added + out.already + out.repeated + out.overLimit + out.unreadable + out.notTried).toBe(13);
    expect(out.endedBecause).toBe('Your free plan covers 15 addresses. Paid plans are coming later.');
    // Every line that was not added is listed, in paste order, with its reason.
    expect(out.lines.map((l) => [l.line, l.reason])).toEqual([
      [1, 'already_registered'], [2, 'already_registered'], [3, 'already_registered'], [4, 'already_registered'], [5, 'already_registered'], [6, 'already_registered'],
      [7, 'no_address'], [8, 'over_limit'], [9, 'over_limit'], [10, 'over_limit'],
    ]);
    expect(describePaste(out)).toEqual([
      '0 added: 0 trusted (Pass), 0 flagged (Fail), 0 pending (Limited or not checked)',
      '9 skipped: 6 already registered, 3 over the free plan\'s limit, not added',
      '1 line not read as an address',
      '3 lines not tried, because the paste ended early',
      'The paste ended early: Your free plan covers 15 addresses. Paid plans are coming later.',
    ]);
  });

  it('turns the lines of a later request back into the paste\'s own line numbers', async () => {
    const text = lines(1, 25).join('\n');
    const replies: ApiResult[] = [
      answer(lines(1, 10).join('\n')),
      planLimit([{ line: 3, chain: 'ethereum', address: addr(13), reason: 'already_registered', id: 'x', trustStatus: 'pending' }, { line: 4, chain: 'ethereum', address: addr(14), reason: 'over_limit' }]),
    ];
    const out = await runPaste(planPaste(text), { tinId: 't', chain: 'ethereum', call: async () => replies.shift() as ApiResult });
    expect(out.lines.map((l) => [l.line, l.text, l.reason])).toEqual([[13, addr(13), 'already_registered'], [14, addr(14), 'over_limit']]);
    expect(out).toMatchObject({ added: 10, already: 1, overLimit: 1, notTried: 5 });
  });

  it('is the last request of a paste: nothing is left untried, so the box can clear and every line is somewhere', async () => {
    const out = await runPaste(planPaste(lines(1, 4).join('\n')), {
      tinId: 't', chain: 'ethereum',
      call: async () => planLimit(lines(1, 4).map((address, i) => ({ line: i + 1, chain: 'ethereum', address, reason: 'over_limit' }))),
    });
    expect(out).toMatchObject({ added: 0, overLimit: 4, notTried: 0 });
    expect(out.lines).toHaveLength(4);
  });

  it('falls back to counting every line of the request as over the limit when the answer carries no lines', async () => {
    const bare: ApiResult = { status: 409, ok: false, body: { ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 } };
    const out = await runPaste(planPaste(lines(1, 7).join('\n')), { tinId: 't', chain: 'ethereum', call: async () => bare });
    expect(out).toMatchObject({ added: 0, overLimit: 7, notTried: 0 });
    expect(out.lines).toEqual([]);
  });

  it('says a wait in the screen\'s own words when it is given them, and leaves every other reason in the general ones', async () => {
    const limited: ApiResult = { status: 429, ok: false, body: { ok: false, error: 'rate_limited' } };
    const errors = { rate_limited: 'That is a lot of checks in a short time. Wait a minute, then try again.' };
    const mine = await runPaste(planPaste(lines(1, 3).join('\n')), { tinId: 't', chain: 'ethereum', call: async () => limited, errors });
    expect(mine.endedBecause).toBe(errors.rate_limited);
    expect(mine.notTried).toBe(3);
    const other = await runPaste(planPaste(lines(1, 3).join('\n')), {
      tinId: 't', chain: 'ethereum', errors, call: async () => ({ status: 404, ok: false, body: { ok: false, error: 'tin_not_found' } }),
    });
    expect(other.endedBecause).toBe('That agent was not found.');
    const plain = await runPaste(planPaste(lines(1, 3).join('\n')), { tinId: 't', chain: 'ethereum', call: async () => limited });
    expect(plain.endedBecause).toBe('That is a lot of requests in a short time. Wait a minute, then try again.');
  });
});
