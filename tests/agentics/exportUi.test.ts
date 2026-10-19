import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { copy } from '../../src/components/agentics/copy';
import { exportErrorText, exportUrl, filenameFrom, presetRange, requestExport } from '../../src/components/agentics/exportDownload';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * The export card and the code behind its two buttons. The card says what the signature covers and
 * what it does not, and that the CSV is only a copy and is not signed; it is off, with a notice, on a
 * server that cannot sign; the file is fetched with a request whose every part is encoded, and a
 * refusal ends in the card's own plain words (a range that is too large says to narrow it), never in
 * a page of JSON. The request is a function the test supplies: no network.
 */
let ExportCard: typeof import('../../src/components/agentics/ExportCard').default;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  ExportCard = (await import('../../src/components/agentics/ExportCard')).default;
});

const render = (props: Partial<React.ComponentProps<typeof ExportCard>> = {}) =>
  renderToStaticMarkup(React.createElement(ExportCard, { tinId: 'tin-1', since: '2026-10-01', today: '2026-10-18', signing: { available: true }, ...props }));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('the export card', () => {
  it('says what the signature covers, what it does not, and that the CSV is a copy that is not signed', () => {
    const t = textOf(render());
    expect(t).toContain('The signature covers the ledger as Almstins stored it when you exported it: every check and every transfer recorded for this agent in the range, and the moment the file was made.');
    expect(t).toContain('It does not show that the agent asked before every payment, and it does not cover transfers to addresses that were never registered.');
    expect(t).toContain('The CSV is a convenience copy. It is not signed. Its first line carries the Merkle root and the bundle ID of the signed file, so the two can be matched.');
    expect(t).toContain('One file covers at most 366 days and 50,000 events.');
  });

  it('has the presets, two labeled date inputs and the two downloads', () => {
    const html = render();
    const t = textOf(html);
    expect(t).toContain('Last 7 days');
    expect(t).toContain('Last 30 days');
    expect(t).toContain('From (UTC)');
    expect(t).toContain('To (UTC)');
    expect(t).toContain('Download signed file');
    expect(t).toContain('Download CSV');
    expect((html.match(/type="date"/g) ?? []).length).toBe(2);
    expect(html).toContain('role="group" aria-label="Range"');
    // Every control sits in a label or a named group, and the buttons are buttons that do not submit.
    expect((html.match(/<label class="ag-field">/g) ?? []).length).toBe(2);
    expect((html.match(/<button[^>]*type="button"/g) ?? []).length).toBe(4);
    expect(html).not.toMatch(/<button[^>]*type="submit"/);
  });

  it('opens on the last 30 days, never before the agent existed, and never after today', () => {
    const html = render();
    expect(html).toMatch(/<input[^>]*value="2026-10-01"[^>]*min="2026-10-01"[^>]*max="2026-10-18"|<input[^>]*min="2026-10-01"[^>]*value="2026-10-01"/);
    expect(html).toContain('value="2026-10-18"');
    expect(html).toContain('max="2026-10-18"');
    // An agent made long ago opens on the 30 days that end today.
    const old = render({ since: '2026-01-01' });
    expect(old).toContain('value="2026-09-19"');
    expect(old).toContain('value="2026-10-18"');
  });

  it('with no signing key says so and offers nothing to download', () => {
    const off = render({ signing: { available: false } });
    expect(textOf(off)).toContain('No signing key is configured on this server, so neither file can be made.');
    expect((off.match(/<button[^>]*type="button"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="button"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    for (const label of ['Download signed file', 'Download CSV']) {
      expect(off, label).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    }
    const on = render();
    expect(textOf(on)).not.toContain('No signing key');
    for (const label of ['Download signed file', 'Download CSV']) expect(on, label).not.toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
  });

  it('links to the public page that checks a signed file in the browser, and to nothing else', () => {
    const html = render();
    const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['/verify-record']);
    expect(textOf(html)).toContain('The check runs in your browser and needs no account.');
  });

  it('every class is Agentics\' and there is a live place for what happens', () => {
    const html = render();
    for (const c of [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean))) expect(c, c).toMatch(/^ag-/);
    expect(html).toContain('role="status" aria-live="polite"');
  });

  it('its words keep to the product\'s verbs and say nothing about price, gain or loss', () => {
    const strings = (v: unknown, out: string[] = []): string[] => {
      if (typeof v === 'string') out.push(v);
      else if (typeof v === 'function') {
        const r = (v as (...a: unknown[]) => unknown)('sample');
        if (typeof r === 'string') out.push(r);
      } else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
      return out;
    };
    const all = strings(copy.export);
    expect(all.length).toBeGreaterThan(15);
    for (const s of all) {
      expect(brightLineViolations(s), s).toEqual([]);
      expect(s, s).not.toMatch(/\b(blocked|stopped|halted|rejected|refused|holds?)\b|\bloss\b|\bnet\b|\bprofit|cost[ -]basis|capital gain|\$\d|\bprices?\b|\bbilling\b|!/i);
      if (/\bsafe\b/i.test(s)) expect(s, s).toMatch(/\b(never|not|no)\b/i);
    }
  });
});

describe('asking for the file', () => {
  it('encodes every part of the address, so a value can never change the path or the query', () => {
    expect(exportUrl({ tinId: 'tin-1', from: '2026-10-01', to: '2026-10-18', format: 'json' })).toBe('/api/agentics/export?tinId=tin-1&from=2026-10-01&to=2026-10-18');
    expect(exportUrl({ tinId: 'tin-1', from: '2026-10-01', to: '2026-10-18', format: 'csv' })).toBe('/api/agentics/export?tinId=tin-1&from=2026-10-01&to=2026-10-18&format=csv');
    const odd = exportUrl({ tinId: 'a&from=1/../x', from: '2026-10-01&tinId=y', to: '#', format: 'json' });
    expect(odd).toBe('/api/agentics/export?tinId=a%26from%3D1%2F..%2Fx&from=2026-10-01%26tinId%3Dy&to=%23');
    expect(odd.match(/&/g)).toHaveLength(2);
  });

  it('turns a preset into the days that end today: 7 days start six days back, 30 start 29 back, never before the agent', () => {
    expect(presetRange('2026-10-18', 7, '2026-01-01')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(presetRange('2026-10-18', 30, '2026-01-01')).toEqual({ from: '2026-09-19', to: '2026-10-18' });
    expect(presetRange('2026-10-18', 30, '2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-18' });
    expect(presetRange('2026-03-02', 7, '2026-01-01')).toEqual({ from: '2026-02-24', to: '2026-03-02' }); // across a month end
    expect(presetRange('2026-10-18', 1, '2026-01-01')).toEqual({ from: '2026-10-18', to: '2026-10-18' });
  });

  it('takes the name the server chose when it is a plain one, and the fallback for anything else', () => {
    expect(filenameFrom('attachment; filename="almstins-agent-ledger-2026-10-01-to-2026-10-18-12345678-proof.json"', 'x.json')).toBe('almstins-agent-ledger-2026-10-01-to-2026-10-18-12345678-proof.json');
    for (const odd of [null, '', 'attachment', 'attachment; filename=""', 'attachment; filename="../../etc/passwd"', 'attachment; filename="a b.json"', 'attachment; filename="a\r\nb"', 'attachment; filename=" x.json"', `attachment; filename="${'a'.repeat(300)}"`, 'attachment; filename="/x"', 'attachment; filename=".hidden"']) {
      expect(filenameFrom(odd, 'fallback.json'), String(odd)).toBe('fallback.json');
    }
  });

  const params = { tinId: 'tin-1', from: '2026-10-01', to: '2026-10-18', format: 'json' as const };

  it('hands back the file and its name on success, sending the account\'s cookie to the Vault\'s own endpoint only', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response('{"manifest":{}}', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="almstins-agent-ledger-2026-10-01-to-2026-10-18-abcdef12-proof.json"' } });
    }) as unknown as typeof fetch;
    const r = await requestExport(params, fetchFn);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filename).toBe('almstins-agent-ledger-2026-10-01-to-2026-10-18-abcdef12-proof.json');
      expect(await r.blob.text()).toBe('{"manifest":{}}');
    }
    expect(calls).toEqual([['/api/agentics/export?tinId=tin-1&from=2026-10-01&to=2026-10-18', { credentials: 'same-origin' }]]);
  });

  it('names the file itself when the server sent no usable name', async () => {
    const r = await requestExport({ ...params, format: 'csv' }, (async () => new Response('a,b', { status: 200 })) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, filename: 'almstins-agent-ledger.csv' });
    const j = await requestExport(params, (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch);
    expect(j).toMatchObject({ ok: true, filename: 'almstins-agent-ledger.json' });
  });

  it('says in plain words what each refusal means: a range that is too large says to narrow it', async () => {
    const refuse = (status: number, error: unknown) => requestExport(params, (async () => new Response(JSON.stringify({ ok: false, error }), { status })) as unknown as typeof fetch);
    expect(await refuse(413, 'export_too_large')).toEqual({ ok: false, message: copy.export.errors.export_too_large });
    expect(copy.export.errors.export_too_large).toMatch(/Narrow the range/);
    expect(await refuse(503, 'signing_unavailable')).toEqual({ ok: false, message: copy.export.errors.signing_unavailable });
    expect(await refuse(429, 'rate_limited')).toEqual({ ok: false, message: copy.export.errors.rate_limited });
    expect(copy.export.errors.rate_limited).toMatch(/Wait a minute/);
    expect(await refuse(400, 'invalid_period')).toEqual({ ok: false, message: copy.export.errors.invalid_period });
    expect(await refuse(404, 'tin_not_found')).toEqual({ ok: false, message: copy.errors.tin_not_found });
  });

  it('turns a code it does not know, a body that is not JSON and anything that looks like markup into the plain fallback', async () => {
    for (const error of ['nope', '<script>alert(1)</script>', 'constructor', '__proto__', 7, null, undefined]) {
      const r = await requestExport(params, (async () => new Response(JSON.stringify({ error }), { status: 500 })) as unknown as typeof fetch);
      expect(r, String(error)).toEqual({ ok: false, message: copy.errors.generic });
    }
    const html = await requestExport(params, (async () => new Response('<html>nope</html>', { status: 502 })) as unknown as typeof fetch);
    expect(html).toEqual({ ok: false, message: copy.errors.generic });
    expect(exportErrorText('hasOwnProperty')).toBe(copy.errors.generic);
  });

  it('a dropped connection, or a file that cannot be read, is a message and not a thrown error', async () => {
    expect(await requestExport(params, (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch)).toEqual({ ok: false, message: copy.errors.network });
    const broken = { ok: true, status: 200, headers: new Headers(), blob: async () => { throw new Error('stream failed'); } } as unknown as Response;
    expect(await requestExport(params, (async () => broken) as unknown as typeof fetch)).toEqual({ ok: false, message: copy.errors.network });
  });
});
