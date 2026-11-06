import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { addr } from '../helpers/agentVault';
import type { LedgerEvent } from '../../src/lib/agentVault/events';

/**
 * What a screened check leaves in the Record (decided Nov 5, 2026): the ledger row, the signed export's
 * leaf and the CSV copy say what the screening found, when it was made, and whether it was reused from
 * the warm-address cache, so the Record shows how fresh each answer was. The fields are appended only to
 * checks that carry them, so a check written before stays the leaf it was and an older file still
 * verifies. And the words: the agent's page, the docs, the privacy policy, the terms and the changelog.
 * No database, no network; the signing key is a random one made for this run. Every value is invented.
 */

vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const SCREENED = '2026-11-05T13:59:58.000Z';
const SERVED = '2026-11-05T14:04:00.123Z';
const check = (detail: Record<string, unknown>, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: '00000000-0000-4000-8000-000000000001', tinId: 'tin-1', kind: 'checked', at: SERVED, address: addr(1), chain: 'ethereum', answer: 'consistent-with-history', registry: 'trusted',
  status: 'unknown', keyId: 'k1', sourceIp: null, tx: null, detail: { basis: 'registered_and_checked_before', ...detail }, ...over,
});
const cachedScreening = { result: 'pass', hits: [], limits: [], checkedAt: SCREENED, cached: true, servedAt: SERVED };

let ex: typeof import('../../src/lib/agentVault/ledgerExport');
let view: typeof import('../../src/lib/agentVault/ledgerView');
let LedgerItem: typeof import('../../src/components/agentics/LedgerPanel').LedgerItem;

beforeAll(async () => {
  process.env.ALMSTINS_SIGNING_KEY = randomBytes(32).toString('hex');
  (globalThis as { React?: typeof React }).React = React;
  ex = await import('../../src/lib/agentVault/ledgerExport');
  view = await import('../../src/lib/agentVault/ledgerView');
  LedgerItem = (await import('../../src/components/agentics/LedgerPanel')).LedgerItem;
});
afterAll(() => {
  delete process.env.ALMSTINS_SIGNING_KEY;
});

describe('the signed export', () => {
  it('a cached check carries its screening, when it was made, and the cached mark; the leaf date is when it was served', () => {
    const leaf = ex.leafOf(check({ screening: cachedScreening })) as unknown as Record<string, unknown>;
    expect(leaf).toMatchObject({ date: SERVED, screening: 'pass', screened_at: SCREENED, cached: true });
  });

  it('a fresh check carries its screening without the cached mark', () => {
    const leaf = ex.leafOf(check({ screening: { ...cachedScreening, cached: false, servedAt: undefined } })) as unknown as Record<string, unknown>;
    expect(leaf).toMatchObject({ screening: 'pass', screened_at: SCREENED });
    expect('cached' in leaf).toBe(false);
  });

  it('a check written before checks were screened is exactly the leaf it was: no new keys, so an older file still verifies', () => {
    const before = ex.leafOf(check({}));
    expect(before).toEqual({
      v: 1, kind: 'checked', date: SERVED, event_id: '00000000-0000-4000-8000-000000000001', address: addr(1), chain: 'ethereum', answer: 'consistent-with-history', registry: 'trusted',
      basis: 'registered_and_checked_before', key_id: 'k1',
    });
  });

  it('carries only values it recognizes: a damaged screening record adds nothing, and its text never reaches the file', () => {
    for (const screening of [null, 'pass', { result: 'maybe' }, { result: '<b>pass</b>' }, []]) {
      const leaf = ex.leafOf(check({ screening })) as unknown as Record<string, unknown>;
      expect('screening' in leaf, JSON.stringify(screening)).toBe(false);
    }
    const odd = ex.leafOf(check({ screening: { result: 'fail', checkedAt: '<img src=x onerror=alert(1)>', cached: 'yes' } })) as unknown as Record<string, unknown>;
    expect(odd).toMatchObject({ screening: 'fail' });
    expect('screened_at' in odd).toBe(false);
    expect('cached' in odd).toBe(false);
  });

  it('a file with old and new checks signs and verifies, and its CSV copy has the three columns before the last', () => {
    const leaves = [ex.leafOf(check({}))!, ex.leafOf(check({ screening: cachedScreening }, { id: '00000000-0000-4000-8000-000000000002', at: '2026-11-05T14:05:00.000Z' }))!];
    const bundle = ex.buildLedgerBundle({
      tenantId: 'tenant-a', tin: { id: 'tin-1', label: 'Treasury agent' }, range: { from: '2026-11-05', to: '2026-11-05' }, partial: false, generatedAt: '2026-11-05T15:00:00.000Z', leaves,
    });
    expect(ex.verifyLedgerBundle(bundle).verdict).toBe('verified');
    const cols = [...ex.CSV_COLUMNS];
    expect(cols.slice(-4)).toEqual(['screening', 'screened_at', 'cached', 'unsigned_copy_of_bundle_id']);
    const lines = ex.ledgerCsv(bundle).replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(','));
    const at = (row: string[], col: (typeof cols)[number]) => row[cols.indexOf(col)];
    expect([at(lines[1], 'screening'), at(lines[1], 'screened_at'), at(lines[1], 'cached')]).toEqual(['', '', '']);
    expect([at(lines[2], 'screening'), at(lines[2], 'screened_at'), at(lines[2], 'cached')]).toEqual(['pass', SCREENED, 'true']);
  });
});

describe('the ledger on the agent\'s page', () => {
  it('reads the screening of a check, and nothing for a transfer or an older check', () => {
    expect(view.toLedgerRow(check({ screening: cachedScreening }) as never)?.screening).toEqual({ result: 'pass', checkedAt: SCREENED, cached: true });
    expect(view.toLedgerRow(check({}) as never)?.screening).toBeNull();
    expect(view.toLedgerRow(check({ screening: { result: 'nope' } }) as never)?.screening).toBeNull();
  });

  it('says a cached answer reused the screening made at its time, and warns on a screening hit', () => {
    const row = view.toLedgerRow(check({ screening: cachedScreening }) as never)!;
    const text = renderToStaticMarkup(React.createElement(LedgerItem, { row })).replace(/<[^>]*>/g, ' ');
    expect(text).toContain('Sanctions and security screening: nothing found.');
    expect(text).toMatch(/Cached: this answer reused the screening made at [^.]*13:59:58[^.]*UTC\. It was served at the time above\./);
    const hit = view.toLedgerRow(check({ basis: 'screening_flagged', screening: { result: 'fail', hits: ['sanctioned'], limits: [], checkedAt: SCREENED, cached: false } }, { answer: 'flagged' }) as never)!;
    const html = renderToStaticMarkup(React.createElement(LedgerItem, { row: hit }));
    expect(html).toContain('ag-event__line ag-event__line--warn');
    expect(html).toContain('Sanctions and security screening: found something. A person should review it.');
    expect(html).not.toContain('Cached:');
  });
});

describe('the words', () => {
  const noDash = (s: string) => expect(s).not.toContain('—');

  it('the docs explain the screening field and the warm-address cache', () => {
    const docs = read('src/pages/agentics/docs.astro');
    expect(docs).toContain("['screening', ");
    expect(docs).toContain('<b>Each check is screened.</b>');
    expect(docs).toContain('the last 10 addresses whose screening passed');
    expect(docs).toContain('within 10 minutes of its last use reuses that screening');
    expect(docs).toContain('Any flag takes the address out of the list, and a flag is never');
    expect(docs).toContain("Your agent's code does not change: ask before every");
  });

  it('the privacy policy says, in English, Spanish and French, that a recent answer may be reused for up to ten minutes and is marked cached', async () => {
    const { en, es, fr } = await import('../../src/i18n/privacyPolicy');
    const clause = (body: string, start: string) => body.slice(body.indexOf(start), body.indexOf('</li>', body.indexOf(start)));
    const e = clause(en.body, '<strong>Almstins Agentics &mdash; the Agent Vault:</strong>');
    expect(e).toContain('Each check your agent asks with its API key is screened the same way at that moment');
    expect(e).toContain('for up to ten minutes after the address was last checked; the record marks such a check as cached');
    expect(e).toContain('a short list of up to ten addresses whose screening passed');
    const s = clause(es.body, '<strong>Almstins Agentics &mdash; el Agent Vault:</strong>');
    expect(s).toContain('durante un máximo de diez minutos desde la última vez que se verificó la dirección; el registro marca esa verificación como "cached"');
    const f = clause(fr.body, "<strong>Almstins Agentics &mdash; l'Agent Vault :</strong>");
    expect(f).toContain('pendant au plus dix minutes après la dernière vérification de l\'adresse ; le registre marque cette vérification comme « cached »');
    for (const c of [e, s, f]) noDash(c);
  });

  it('Terms B.9.7 says each check carries its screening and a reused one is marked cached, in all three languages', async () => {
    const terms = read('src/i18n/termsOfService.ts');
    expect(terms).toContain('Each check is recorded with the result of the sanctions and security screening run for it');
    expect(terms).toContain('la verificación se marca como "cached" y muestra cuándo se hizo esa revisión');
    expect(terms).toContain('la vérification est marquée « cached » et indique quand ce filtrage a été fait');
  });

  it('the changelog announces it and keeps the rule for the agent', () => {
    const log = read('src/pages/changelog.astro');
    expect(log).toContain('Every check your agent asks with its key now also screens the address at that moment');
    expect(log).toContain("Your agent's code does not change: ask before every payment.");
  });

  it('never calls an address safe in anything new', () => {
    const copy = read('src/components/agentics/copy.ts');
    const screening = copy.slice(copy.indexOf('screening: {'), copy.indexOf('cached: (screenedAt'));
    for (const s of [screening, read('src/lib/agentVault/checkScreening.ts'), read('src/lib/agentVault/warmCache.ts'), read('src/lib/agentVault/warmRule.ts')]) {
      expect(s).not.toMatch(/\bsafe\b/i);
      noDash(s);
    }
  });
});
