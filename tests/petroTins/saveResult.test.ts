import { describe, it, expect } from 'vitest';
import { writeToApi } from '../../src/components/petro-tins/saveResult';

/**
 * The register used to ignore the server's answer to a save. A refused save closed the edit box
 * and reloaded the old figure, so a failed save looked like the figure snapping back, with
 * nothing said. writeToApi turns every answer into a result the page can show.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answers = (res: Response) => (async () => res) as unknown as typeof fetch;

describe('writeToApi', () => {
  it('a 200 is a save', async () => {
    expect(await writeToApi('/x', {}, answers(json({ ok: true })))).toEqual({ ok: true });
  });

  it('a 200 with no JSON body is still a save', async () => {
    expect(await writeToApi('/x', {}, answers(new Response('', { status: 200 })))).toEqual({ ok: true });
  });

  it('a 200 that says { ok: false } is a refusal', async () => {
    const r = await writeToApi('/x', {}, answers(json({ ok: false, error: 'Tin not found' })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Tin not found');
  });

  it('a 500 says the change was not saved and names the status', async () => {
    const r = await writeToApi('/x', {}, answers(json({ ok: false }, 500)));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('was not saved');
      expect(r.message).toContain('500');
    }
  });

  it('a 400 passes on the server\'s reason', async () => {
    const r = await writeToApi('/x', {}, answers(json({ ok: false, error: 'Invalid amount' }, 400)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Invalid amount');
  });

  it('a 401 and a 404 (the owner-only gate once the session is gone) both say the session ended', async () => {
    for (const status of [401, 404]) {
      const r = await writeToApi('/x', {}, answers(json({}, status)));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('session has ended');
    }
  });

  it('a 403 upgrade_required says it needs a paid plan', async () => {
    const r = await writeToApi('/x', {}, answers(json({ ok: false, error: 'upgrade_required' }, 403)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('paid plan');
  });

  it('a network failure says the server could not be reached', async () => {
    const send = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const r = await writeToApi('/x', {}, send);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Could not reach the server');
  });

  it('passes the URL and the request through unchanged', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const send = (async (url: string, init: RequestInit) => { seen = { url, init }; return json({ ok: true }); }) as unknown as typeof fetch;
    await writeToApi('/api/petro-tins/entries', { method: 'PATCH', body: '{"a":1}' }, send);
    expect(seen.url).toBe('/api/petro-tins/entries');
    expect(seen.init?.method).toBe('PATCH');
    expect(seen.init?.body).toBe('{"a":1}');
  });

  it('never throws, whatever the server sent back', async () => {
    const weird = new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    const r = await writeToApi('/x', {}, answers(weird));
    expect(r.ok).toBe(false);
  });
});
