import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildReport, dayBounds } from '../../src/lib/agentVault/report';
import { buildReportBundle } from '../../src/lib/agentVault/reportProof';
import type { VerifyOutcome } from '../../src/lib/recordProof/verify';

/**
 * The result the public verifier (/verify-record) shows after a proof bundle is checked, rendered
 * the way the server renders it. A Year Summary must read exactly as it always has: the GOLDEN
 * strings below are that page's markup for four Year Summary results, captured from the component
 * before the Agent Vault report got its version line, and the component must still produce them
 * byte for byte. An Agent Vault report additionally says which version of its day it is and whether
 * it was made before the day ended, so a signature that checks out does not read as the last word.
 * Every value is invented.
 */
let Result: typeof import('../../src/components/recordProof/VerifyRecord').Result;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  Result = (await import('../../src/components/recordProof/VerifyRecord')).Result;
});

const GOLDEN: Record<string, string> = {
  "yearVerified": "<div class=\"vr__out\"><div class=\"vr__result vr__result--ok\"><span class=\"vr__result-icon\" aria-hidden=\"true\">✅</span><div><div class=\"vr__result-title\">Genuine, unaltered Almstins record</div><div class=\"vr__result-detail\">The Merkle root matches these entries and the signature is valid against the published Almstins key.</div></div></div><dl class=\"vr__facts\"><div><dt>Period</dt><dd>2025 Year Summary</dd></div><div><dt>Generated</dt><dd>2026-02-01T10:00:00.000Z</dd></div><div><dt>Entries committed</dt><dd>14 (short 3 · long 4 · income 5 · held 1 · review 1)</dd></div><div><dt>Merkle root</dt><dd class=\"vr__mono\">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</dd></div><div><dt>Signed by</dt><dd>Almstins key almstins-key-1</dd></div><div><dt>Checked against</dt><dd>published key (almstins.com/.well-known)</dd></div></dl><button class=\"vr__toggle\">Show the 2 entry commitments (hashes only)</button><p class=\"vr__disclaimer\">This proof attests INTEGRITY.</p></div>",
  "yearPrior": "<div class=\"vr__out\"><div class=\"vr__result vr__result--warn\"><span class=\"vr__result-icon\" aria-hidden=\"true\">⚠️</span><div><div class=\"vr__result-title\">Intact, but origin not confirmed</div><div class=\"vr__result-detail\">Signed, but with a key id not in the published key list (provide the key, or it may be rotated/forged).</div></div></div><dl class=\"vr__facts\"><div><dt>Period</dt><dd>2025 Year Summary</dd></div><div><dt>Generated</dt><dd>2026-02-01T10:00:00.000Z</dd></div><div><dt>Entries committed</dt><dd>14 (short 3 · long 4 · income 5 · held 1 · review 1)</dd></div><div><dt>Merkle root</dt><dd class=\"vr__mono\">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</dd></div><div><dt>Signed by</dt><dd>Almstins key almstins-key-1</dd></div><div><dt>Checked against</dt><dd>published key (almstins.com/.well-known)</dd></div><div><dt>Prior record</dt><dd class=\"vr__mono\">eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee</dd></div></dl><button class=\"vr__toggle\">Show the 2 entry commitments (hashes only)</button><p class=\"vr__disclaimer\">This proof attests INTEGRITY.</p></div>",
  "yearUnsigned": "<div class=\"vr__out\"><div class=\"vr__result vr__result--warn\"><span class=\"vr__result-icon\" aria-hidden=\"true\">⚠️</span><div><div class=\"vr__result-title\">Intact, but origin not confirmed</div><div class=\"vr__result-detail\">No signature present — integrity holds, but origin cannot be attested.</div></div></div><dl class=\"vr__facts\"><div><dt>Period</dt><dd>2025 Year Summary</dd></div><div><dt>Generated</dt><dd>2026-02-01T10:00:00.000Z</dd></div><div><dt>Entries committed</dt><dd>14 (short 3 · long 4 · income 5 · held 1 · review 1)</dd></div><div><dt>Merkle root</dt><dd class=\"vr__mono\">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</dd></div><div><dt>Signed by</dt><dd>Unsigned</dd></div><div><dt>Checked against</dt><dd>published key (almstins.com/.well-known)</dd></div></dl><button class=\"vr__toggle\">Show the 2 entry commitments (hashes only)</button><p class=\"vr__disclaimer\">This proof attests INTEGRITY.</p></div>",
  "yearTampered": "<div class=\"vr__out\"><div class=\"vr__result vr__result--err\"><span class=\"vr__result-icon\" aria-hidden=\"true\">❌</span><div><div class=\"vr__result-title\">Does not verify — altered or corrupt</div><div class=\"vr__result-detail\">The entries do not hash to the recorded Merkle root — at least one line was changed.</div></div></div><dl class=\"vr__facts\"><div><dt>Period</dt><dd>2025 Year Summary</dd></div><div><dt>Generated</dt><dd>2026-02-01T10:00:00.000Z</dd></div><div><dt>Entries committed</dt><dd>14 (short 3 · long 4 · income 5 · held 1 · review 1)</dd></div><div><dt>Merkle root</dt><dd class=\"vr__mono\">aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</dd></div><div><dt>Signed by</dt><dd>Almstins key almstins-key-1</dd></div><div><dt>Checked against</dt><dd>published key (almstins.com/.well-known)</dd></div></dl><button class=\"vr__toggle\">Show the 2 entry commitments (hashes only)</button><p class=\"vr__disclaimer\">This proof attests INTEGRITY.</p></div>"
};

const yearManifest = {
  v: 1, record_id: '00000000-0000-4000-8000-0000000000aa', tenant_scope_tag: 'tst-abc', record_type: 'year_summary', period: '2025', data_source: 'lifecycle',
  merkle_root: 'a'.repeat(64), leaf_count: 14, leaf_schema_version: 1, tree_algo: 'sha256-merkle-v1',
  counts: { short_term: 3, long_term: 4, income: 5, held: 1, unsettled: 1 }, prev_root: null, generated_at: '2026-02-01T10:00:00.000Z',
  signing_key_id: 'almstins-key-1', schema_version: '1', verify_url: 'https://almstins.com/verify-record', disclaimer: 'This proof attests INTEGRITY.',
};
const bundleOf = (manifest: unknown, signed: boolean) => ({
  manifest,
  signature: signed ? { alg: 'Ed25519', key_id: 'almstins-key-1', signature_hex: 'b'.repeat(128) } : null,
  leaves: [],
  leaf_hashes: ['c'.repeat(64), 'd'.repeat(64)],
  proof_format: 'almstins-merkle-v1',
});
const KEY_SOURCE = 'published key (almstins.com/.well-known)';
const render = (bundle: unknown, outcome: Pick<VerifyOutcome, 'verdict' | 'code'>) =>
  renderToStaticMarkup(React.createElement(Result as never, { bundle, outcome, keySource: KEY_SOURCE } as never));
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('a Year Summary reads exactly as it did', () => {
  it('verified', () => {
    expect(render(bundleOf(yearManifest, true), { verdict: 'verified', code: 'ok' })).toBe(GOLDEN.yearVerified);
  });
  it('with a prior record and an origin that is not confirmed', () => {
    expect(render(bundleOf({ ...yearManifest, prev_root: 'e'.repeat(64) }, true), { verdict: 'unverifiable', code: 'unknown_key' })).toBe(GOLDEN.yearPrior);
  });
  it('unsigned', () => {
    expect(render(bundleOf({ ...yearManifest, signing_key_id: null }, false), { verdict: 'unverifiable', code: 'unsigned' })).toBe(GOLDEN.yearUnsigned);
  });
  it('altered', () => {
    expect(render(bundleOf(yearManifest, true), { verdict: 'tampered', code: 'root_mismatch' })).toBe(GOLDEN.yearTampered);
  });
  it('says nothing of a version or a partial day, even when its manifest happens to carry the fields', () => {
    const html = render(bundleOf({ ...yearManifest, version: 7, partial: true }, true), { verdict: 'verified', code: 'ok' });
    expect(html).toBe(GOLDEN.yearVerified);
    expect(text(html)).not.toMatch(/Version|partial|snapshot/i);
  });
});

describe('an Agent Vault report says which version it is, and whether the day was over', () => {
  const content = (partial: boolean) => buildReport([], { tin: { id: 'tin-1', label: 'Treasury agent' }, period: { ...dayBounds('2026-10-17'), partial } });
  const reportBundle = (version: number, partial: boolean) =>
    buildReportBundle({ tenantId: 'tenant-1', reportId: '00000000-0000-4000-8000-0000000000bb', version, generatedAt: '2026-10-18T09:10:00.000Z', content: content(partial), prevRoot: null });

  it('a mid-day version says so beside the verdict: "Version 3, partial: made before the day ended"', () => {
    const html = render(reportBundle(3, true), { verdict: 'verified', code: 'ok' });
    expect(text(html)).toContain('Genuine, unaltered Almstins record');
    expect(text(html)).toContain('Version 3, partial: made before the day ended.');
    expect(text(html)).toContain('A later version of the same day may have replaced this one as the newest');
    expect(text(html)).toContain('this check reads only this file and cannot see one');
    // The words are inside the result box, with the verdict, not buried in the facts below it.
    expect(html.indexOf('Version 3, partial')).toBeLessThan(html.indexOf('<dl class="vr__facts">'));
    expect(html.indexOf('Version 3, partial')).toBeGreaterThan(html.indexOf('vr__result-title'));
  });

  it('a version made after the day ended says its version and no partial day', () => {
    const html = render(reportBundle(1, false), { verdict: 'verified', code: 'ok' });
    expect(text(html)).toContain('Version 1.');
    expect(text(html)).not.toMatch(/partial/i);
    expect(text(html)).toContain('A later version of the same day may have replaced this one');
  });

  it('a report is still described as an Agent Vault report, with its address groups', () => {
    const html = render(reportBundle(2, false), { verdict: 'verified', code: 'ok' });
    expect(text(html)).toContain('2026-10-17 Agent Vault report');
    expect(text(html)).toMatch(/Entries committed 1 \(had issues 0 · not confirmed 0 · new 0 · no issues 0 addresses\)/);
  });

  it('the caution is there whatever the verdict', () => {
    for (const outcome of [{ verdict: 'unverifiable', code: 'unsigned' }, { verdict: 'tampered', code: 'root_mismatch' }, { verdict: 'unverifiable', code: 'unknown_key' }] as const) {
      expect(text(render(reportBundle(4, true), outcome)), outcome.code).toContain('Version 4, partial: made before the day ended.');
    }
  });

  it('a report bundle that carries no version still says so rather than saying nothing', () => {
    const bundle = reportBundle(1, false);
    const stripped = { ...bundle, manifest: { ...bundle.manifest, version: undefined, partial: undefined } };
    expect(text(render(stripped, { verdict: 'verified', code: 'ok' }))).toContain('Version not stated.');
  });
});

describe('an Agent Vault ledger export says which days it covers and what its signature does not reach', () => {
  const ledgerManifest = {
    v: 1, record_id: '00000000-0000-4000-8000-0000000000cc', tenant_scope_tag: 'tst-abc', record_type: 'agent_ledger', period: '2026-10-01 to 2026-10-18', from_day: '2026-10-01', to_day: '2026-10-18',
    period_start: '2026-10-01T00:00:00.000Z', period_end: '2026-10-19T00:00:00.000Z', partial: false, tin_id: 'tin-1', tin_label: 'Treasury agent', data_source: 'ledger',
    merkle_root: 'f'.repeat(64), leaf_count: 9, leaf_schema_version: 1, tree_algo: 'sha256-merkle-v1', counts: { checked: 6, transaction: 3 }, prev_root: null,
    generated_at: '2026-10-18T12:00:00.000Z', signing_key_id: 'almstins-key-1', schema_version: '1', verify_url: 'https://almstins.com/verify-record', disclaimer: 'This proof attests INTEGRITY.',
  };

  it('is described as an Agent Vault ledger, with its range and its checks and transfers', () => {
    const html = render(bundleOf(ledgerManifest, true), { verdict: 'verified', code: 'ok' });
    expect(text(html)).toContain('Genuine, unaltered Almstins record');
    expect(text(html)).toContain('2026-10-01 to 2026-10-18 Agent Vault ledger');
    expect(text(html)).toContain('Entries committed 9 (checks 6 · transfers 3)');
    expect(text(html)).toContain('Covers 2026-10-01 to 2026-10-18 (UTC days, both counted).');
    expect(text(html)).toContain('An export is a snapshot of the ledger when it was made.');
    expect(text(html)).toContain('does not show that the agent asked before every payment');
    // The words are inside the result box, with the verdict, not buried in the facts below it.
    expect(html.indexOf('Covers 2026-10-01')).toBeLessThan(html.indexOf('<dl class="vr__facts">'));
    expect(html.indexOf('Covers 2026-10-01')).toBeGreaterThan(html.indexOf('vr__result-title'));
    expect(text(html)).not.toMatch(/undefined|NaN|Version/);
  });

  it('says a file made before the last day ended is partial, whatever the verdict, and a version of nothing is not stated', () => {
    for (const outcome of [{ verdict: 'verified', code: 'ok' }, { verdict: 'unverifiable', code: 'unsigned' }, { verdict: 'tampered', code: 'root_mismatch' }] as const) {
      const html = render(bundleOf({ ...ledgerManifest, partial: true }, true), outcome);
      expect(text(html), outcome.code).toContain('partial: made before the last day ended.');
    }
  });

  it('says nothing of a version, which only a report has', () => {
    expect(text(render(bundleOf({ ...ledgerManifest, version: 3 }, true), { verdict: 'verified', code: 'ok' }))).not.toMatch(/Version/);
  });

  it('leaves a Year Summary exactly as it was, even when its manifest happens to carry the ledger\'s fields', () => {
    const html = render(bundleOf({ ...yearManifest, from_day: '2026-10-01', to_day: '2026-10-18' }, true), { verdict: 'verified', code: 'ok' });
    expect(html).toBe(GOLDEN.yearVerified);
  });
});
