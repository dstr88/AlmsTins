import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';
import { brightLineViolations } from '../helpers/brightLineWording';
import { buildReport, dayBounds, type ReportContent } from '../../src/lib/agentVault/report';
import { bundleFileName, buildReportBundle, pdfFileName, verifyReportBundle, type AgentReportBundle } from '../../src/lib/agentVault/reportProof';
import { PDF_ALPHA, PDF_COLORS, buildReportPdf, pdfSafe } from '../../src/lib/agentVault/reportPdf';
import type { LedgerEvent } from '../../src/lib/agentVault/events';

/**
 * The signed PDF: a real PDF, built only from a signed bundle, that says what the report says, carries
 * its own proof bundle, survives hostile text, and keeps to the product's words and colors. The
 * signing key is a seed generated for each test and signs nothing outside it. Every address, label
 * and tenant is invented.
 */
const ROOT = path.resolve(__dirname, '../..');
const { start: START, end: END } = dayBounds('2026-10-17');
const GENERATED = '2026-10-18T09:10:00.000Z';
const RECORD_ID = '00000000-0000-4000-8000-0000000000aa';
const at = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 9, 17, h, m, s)).toISOString();

let n = 0;
const check = (address: string, basis: string, answer: LedgerEvent['answer'], when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'checked', at: when, address, chain: 'ethereum', answer,
  registry: 'trusted', status: 'unknown', keyId: 'k', sourceIp: null, tx: null, detail: { basis },
});
const move = (direction: 'in' | 'out', usd: number | null, when: string): LedgerEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'transaction', at: when, address: addr(2), chain: 'ethereum',
  answer: 'unknown', registry: 'trusted', status: null, keyId: null, sourceIp: null,
  tx: { hash: txHash(n), direction, wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 },
  detail: { reason: 'no_preceding_check' },
});

const baseEvents = (): LedgerEvent[] => [
  check(addr(1), 'registry_flagged', 'flagged', at(8)),
  check(addr(3), 'not_in_registry', 'unknown', at(9)),
  check(addr(4), 'registered_first_check', 'unknown', at(10)),
  check(addr(5), 'domain_proof', 'proven', at(11)),
  move('in', 1270.56, at(12)),
  move('out', null, at(13)),
];

const makeContent = (over: { events?: LedgerEvent[]; label?: string; labels?: Map<string, string>; partial?: boolean } = {}): ReportContent =>
  buildReport(over.events ?? baseEvents(), {
    tin: { id: 'tin-1', label: over.label ?? 'Treasury agent' },
    period: { start: START, end: END, partial: over.partial ?? false },
    labels: over.labels ?? new Map([[addr(1), 'Ops wallet']]),
  });

const makeBundle = (content: ReportContent, over: { version?: number; prevRoot?: string | null } = {}): AgentReportBundle =>
  buildReportBundle({ tenantId: 'tenant-pdf-1', reportId: RECORD_ID, version: over.version ?? 1, generatedAt: GENERATED, content, prevRoot: over.prevRoot ?? null });

async function readPdf(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const r = await parser.getText();
    return { text: r.text, pages: r.total };
  } finally {
    await parser.destroy();
  }
}
const squeeze = (s: string) => s.replace(/\s+/g, '');
/** Lines the PDF wrapped joined back into running text. */
const flow = (s: string) => s.replace(/\s+/g, ' ');

/** Every stream in a PDF that is a zlib stream or plain text, decoded. Used to find the attached bundle. */
function streamsOf(pdf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let from = 0;
  for (;;) {
    const open = pdf.indexOf('stream', from, 'latin1');
    if (open < 0) break;
    const start = open + 'stream'.length + (pdf[open + 6] === 0x0d ? 2 : 1);
    const end = pdf.indexOf('endstream', start, 'latin1');
    if (end < 0) break;
    const raw = pdf.subarray(start, end);
    try {
      out.push(inflateSync(raw));
    } catch {
      out.push(raw);
    }
    from = end + 'endstream'.length;
  }
  return out;
}

beforeEach(() => {
  vi.stubEnv('ALMSTINS_SIGNING_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
  vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a signed report as a PDF', () => {
  it('is a real PDF: the header, the end marker, and pages a reader can open', async () => {
    const pdf = await buildReportPdf({ content: makeContent(), bundle: makeBundle(makeContent()) });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toMatch(/%%EOF\s*$/);
    const { text, pages } = await readPdf(pdf);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(text).toContain(`Page 1 of ${pages}`);
  });

  it('says what the report says: the day, the agent, the four groups, the addresses, the strip and the counts', async () => {
    const content = makeContent();
    const { text } = await readPdf(await buildReportPdf({ content, bundle: makeBundle(content) }));
    for (const expected of [
      'Operator report', 'October 17, 2026 (UTC day)', 'Treasury agent', 'Had issues', 'Not confirmed', 'New', 'No issues',
      'Ops wallet', 'BOUGHT', '$1,270.56', 'SOLD', '$0.00', '1 without a USD value (not in the total)', '1 check came back proven or consistent with history',
    ]) {
      expect(text, expected).toContain(expected);
    }
    for (const a of [addr(1), addr(3), addr(4)]) expect(squeeze(text), a).toContain(a);
    expect(squeeze(text)).not.toContain(addr(5)); // an address whose checks were all clear is a count only
    expect(flow(text)).toContain('Flagged. The address is flagged in your registry. A person should review it.');
    expect(flow(text)).toContain('Not in your registry. The agent asked about an address that is not on its list.');
    expect(flow(text)).toContain('First check of a registered address. History baseline started.');
  });

  it('prints the proof: the record id, version, time, key, root, the signature and how to verify', async () => {
    const content = makeContent();
    const bundle = makeBundle(content, { version: 3, prevRoot: 'a'.repeat(64) });
    const { text } = await readPdf(await buildReportPdf({ content, bundle }));
    const flat = squeeze(text);
    expect(text).toContain('Version 3');
    expect(flat).toContain(RECORD_ID);
    expect(flat).toContain(bundle.manifest.merkle_root);
    expect(flat).toContain(bundle.signature!.signature_hex);
    expect(flat).toContain(bundle.signature!.key_id);
    expect(flat).toContain('a'.repeat(64)); // the version before it
    expect(text).toContain('2026-10-18 09:10:00 UTC');
    expect(text).toContain('Verification');
    expect(text).toContain('/verify-record');
    expect(flat).toContain(bundleFileName(bundle.manifest));
  });

  it('is the same bytes every time for the same report', async () => {
    const content = makeContent();
    const bundle = makeBundle(content);
    const a = await buildReportPdf({ content, bundle });
    const b = await buildReportPdf({ content, bundle });
    expect(a.equals(b)).toBe(true);
  });

  it('carries its own proof bundle as an attachment, which verifies', async () => {
    const content = makeContent();
    const bundle = makeBundle(content);
    const pdf = await buildReportPdf({ content, bundle });
    expect(pdf.includes('EmbeddedFile', 0, 'latin1')).toBe(true);
    expect(pdf.includes(bundleFileName(bundle.manifest), 0, 'latin1')).toBe(true);
    const attached = streamsOf(pdf).map((s) => s.toString('utf8')).find((s) => s.includes(`"record_id": "${RECORD_ID}"`));
    expect(attached).toBeTruthy();
    const parsed = JSON.parse(attached!) as AgentReportBundle;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(bundle)));
    expect(verifyReportBundle(parsed).verdict).toBe('verified');
  });

  it('refuses to make a PDF from an unsigned bundle: nothing that is not signed is ever presented as signed', () => {
    vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
    const content = makeContent();
    const bundle = makeBundle(content);
    expect(bundle.signature).toBeNull();
    expect(() => buildReportPdf({ content, bundle })).toThrow(/signed bundle is required/);
  });

  it('says so on its first page when the report is a partial day', async () => {
    const content = makeContent({ partial: true });
    const { text } = await readPdf(await buildReportPdf({ content, bundle: makeBundle(content) }));
    expect(flow(text)).toContain('Partial day. This report was made at 2026-10-18 09:10:00 UTC, before the day ended');
    expect(text).toContain('(partial: made before the day ended)');
    const full = await readPdf(await buildReportPdf({ content: makeContent(), bundle: makeBundle(makeContent()) }));
    expect(full.text).not.toContain('Partial day');
  });

  it('a day with nothing in it is still a report, and says nothing needs a look', async () => {
    const content = makeContent({ events: [] });
    const { text } = await readPdf(await buildReportPdf({ content, bundle: makeBundle(content) }));
    expect(text).toContain('Nothing here needs a person to look at it.');
    expect(text).toContain('No transfers');
    expect(flow(text)).toContain('No check came back proven or consistent with history in this period.');
  });

  it('lists every address across as many pages as it takes, with the table head again on each', async () => {
    const events = Array.from({ length: 120 }, (_, i) => check(addr(1000 + i), 'not_in_registry', 'unknown', at(8, Math.floor(i / 60), i % 60)));
    const content = makeContent({ events });
    const { text, pages } = await readPdf(await buildReportPdf({ content, bundle: makeBundle(content) }));
    expect(pages).toBeGreaterThanOrEqual(3);
    const flat = squeeze(text);
    for (let i = 0; i < 120; i++) expect(flat, `${i}`).toContain(addr(1000 + i));
    expect((text.match(/FIRST \(UTC\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('draws a long address from another chain whole', async () => {
    const long = `bc1q${'a1b2c3d4e5'.repeat(8)}`;
    const content = makeContent({ events: [check(long, 'not_in_registry', 'unknown', at(8))] });
    const { text } = await readPdf(await buildReportPdf({ content, bundle: makeBundle(content) }));
    expect(squeeze(text)).toContain(long);
  });
});

describe('text from outside is made safe before it is drawn', () => {
  it('pdfSafe keeps printable ASCII and Latin-1, shows anything else as ?, drops control characters and cuts to length', () => {
    expect(pdfSafe('Treasury agent')).toBe('Treasury agent');
    expect(pdfSafe('Zoë Müller')).toBe('Zoë Müller');
    expect(pdfSafe('中文 text')).toBe('?? text');
    expect(pdfSafe('a\u0000b\u0007c\u001bd\u007fe')).toBe('abcde');
    expect(pdfSafe('line one\nline\ttwo\r\nthree')).toBe('line one line two three');
    expect(pdfSafe('  spaced     out  ')).toBe('spaced out');
    expect(pdfSafe('x'.repeat(500), 40)).toHaveLength(40);
    expect(pdfSafe(undefined)).toBe('');
    expect(pdfSafe(null)).toBe('');
    expect(pdfSafe(12)).toBe('12');
    expect(pdfSafe('😀')).toBe('?');
  });

  it('a hostile agent name and label still make a valid PDF that shows them as plain text', async () => {
    const label = 'Evil <script>alert(1)</script> ) ( \\ \u0000\u0007 中文 end';
    const content = makeContent({ label, labels: new Map([[addr(1), '"><img src=x onerror=alert(1)> (label) \\']]) });
    const pdf = await buildReportPdf({ content, bundle: makeBundle(content) });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { text } = await readPdf(pdf);
    expect(flow(text)).toContain('Evil <script>alert(1)</script> ) ( \\ ?? end');
    expect(flow(text)).toContain('"><img src=x onerror=alert(1)> (label) \\');
    expect(text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });
});

describe('the words in the PDF', () => {
  it('keep to the product\'s words: no claim to stop anything, nothing called safe outside a denial, no money-return words', async () => {
    const content = makeContent({ partial: true });
    const { text } = await readPdf(await buildReportPdf({ content, bundle: makeBundle(content, { prevRoot: 'b'.repeat(64) }) }));
    expect(brightLineViolations(text)).toEqual([]);
    expect(text).not.toMatch(/\b(blocked|stopped|halted|rejected|refused)\b/i);
    expect(text).not.toMatch(/cost[ -]basis|capital gain|realized|unrealized|\bP\/L\b|\bprofit|\bloss\b|\bnet\b|\b8949\b/i);
    for (const sentence of flow(text).split(/(?<=[.!?])\s+/)) {
      if (/\bsafe\b/i.test(sentence)) expect(sentence).toMatch(/\b(never|not|no)\b/i);
    }
    expect(flow(text)).toContain('does not hold or move funds and is never in the payment path');
  });
});

describe('the colors are the product\'s tokens', () => {
  const css = readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const token = (name: string): string => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css)?.[1].trim() ?? '';

  it('every color in the PDF is the value of the token it is named for', () => {
    for (const [name, value] of Object.entries(PDF_COLORS)) expect(value.toLowerCase(), name).toBe(token(name).toLowerCase());
  });

  it('every opacity is the alpha the text and border tokens carry', () => {
    for (const [name, alpha] of Object.entries(PDF_ALPHA)) {
      const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(token(name));
      expect(Number(m?.[1]), name).toBe(alpha);
    }
  });

  it('draws no other color: the only color literals in the PDF module are the pinned ones', () => {
    const src = readFileSync(path.join(ROOT, 'src/lib/agentVault/reportPdf.ts'), 'utf8');
    const outside = src.replace(/export const PDF_COLORS = \{[\s\S]*?\} as const;/, '');
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/);
  });
});

describe('what the PDF is called', () => {
  it('names the PDF and its proof bundle by the day, the version and the start of the record id', () => {
    const m = makeBundle(makeContent(), { version: 2 }).manifest;
    expect(pdfFileName(m)).toBe('almstins-agent-report-2026-10-17-v2-00000000.pdf');
    expect(bundleFileName(m)).toBe('almstins-agent-report-2026-10-17-v2-00000000-proof.json');
    expect(pdfFileName(m)).not.toMatch(/[^A-Za-z0-9._-]/); // nothing from the report is in a file name
  });
});
