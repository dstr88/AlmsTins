/**
 * The signed PDF of an operator report: the period, the four buckets, the bought and sold strip,
 * when and from what it was made, and how anyone can check the signature. This PDF is the one
 * surface where the report's addresses appear, and it is only ever served to the signed-in owner.
 *
 * It is built only from a SIGNED bundle (./reportProof.ts). It refuses an unsigned one outright,
 * so there is no way to produce a PDF that looks signed and is not. The bundle that carries the
 * signature is printed in part (the record id, the Merkle root, the key and the signature) and is
 * also embedded in the PDF as an attachment, so the file can be checked on its own: upload the
 * attachment at /verify-record, or run the offline verifier.
 *
 * Every string that came from outside this code (the tin's name, a registry label, an address, a
 * reason) goes through pdfSafe before it is drawn: control characters out, and anything the
 * built-in fonts cannot draw shown as `?`, so no text can break the layout or the file.
 *
 * Colors are the product's tokens (src/styles/tokens.css), pinned by a test, with the opacity the
 * text tokens carry applied to dark ink on white paper. Times are UTC and say so.
 */
import PDFDocument from 'pdfkit';
import { LISTED_BUCKETS, MAX_LISTED_PER_BUCKET, type ListedBucketName, type ReportAddress, type ReportBucket, type ReportContent } from './report';
import { bundleFileName, type AgentReportBundle } from './reportProof';
import { formatClock, formatCount, formatDayLong, formatUsd, formatUtc, plural } from './reportFormat';
import { BUCKET_MEANING, BUCKET_TITLE, VERIFY_STATUS_TITLE, reasonText } from './reportText';

/** The token values this PDF uses, keyed by token name. tests/agentics/reportPdf.test.ts checks every one against tokens.css. */
export const PDF_COLORS = {
  '--surface-bg': '#0a0f1a',
  '--text-primary': '#f5f8ff',
  '--accent': '#2dd4a8',
  '--gain': '#34d399',
  '--loss': '#ef4444',
  '--warning': '#f59e0b',
} as const;

/** The opacity of the text and border tokens, applied to the ink. Checked against tokens.css too. */
export const PDF_ALPHA = { '--text-secondary': 0.7, '--text-muted': 0.38, '--border-bright': 0.12 } as const;

const INK = PDF_COLORS['--surface-bg'];
const PAPER = PDF_COLORS['--text-primary'];
const BUCKET_COLOR: Record<ReportBucket, string> = {
  issues: PDF_COLORS['--loss'],
  not_confirmed: PDF_COLORS['--warning'],
  new: PDF_COLORS['--accent'],
  no_issues: PDF_COLORS['--gain'],
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = { top: 48, bottom: 60, left: 48, right: 48 } as const;
const CONTENT_W = PAGE_W - MARGIN.left - MARGIN.right;

/**
 * Text as the built-in fonts can draw it: printable ASCII and the Latin-1 letters, with whitespace
 * collapsed and everything else shown as `?`. Cut to `max` characters.
 */
export function pdfSafe(input: unknown, max = 400): string {
  let out = '';
  for (const ch of String(input ?? '')) {
    const c = ch.codePointAt(0) as number;
    if (c === 0x09 || c === 0x0a || c === 0x0d) out += ' ';
    else if (c < 0x20 || c === 0x7f) continue;
    else if (c <= 0x7e || (c >= 0xa0 && c <= 0xff)) out += ch;
    else out += '?';
  }
  return out.replace(/ {2,}/g, ' ').trim().slice(0, max);
}

interface Column {
  title: string;
  width: number;
  mono?: boolean;
  align?: 'left' | 'right';
}

const COLUMNS: readonly Column[] = [
  { title: 'First (UTC)', width: 52 },
  { title: 'Address', width: 192, mono: true },
  { title: 'Label', width: 80 },
  { title: 'What happened', width: 154 },
  { title: 'Checks', width: 38, align: 'right' },
];

/** The signed PDF for one report, from its signed bundle and its frozen content. Throws for an unsigned bundle. */
export function buildReportPdf(input: { content: ReportContent; bundle: AgentReportBundle }): Promise<Buffer> {
  const { content, bundle } = input;
  const manifest = bundle.manifest;
  if (!bundle.signature) throw new Error('reportPdf: a signed bundle is required');
  const signature = bundle.signature;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: MARGIN,
      bufferPages: true,
      info: {
        Title: `Almstins Agent Vault operator report ${manifest.period}`,
        Author: 'Almstins',
        Creator: 'Almstins',
        Subject: 'Operator report',
        CreationDate: new Date(manifest.generated_at),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 0;

    // ── Small drawing helpers ────────────────────────────────────────────────
    const write = (
      text: string,
      x: number,
      at: number,
      o: { size?: number; font?: string; width?: number; align?: 'left' | 'right' | 'center'; color?: string; alpha?: number; lineBreak?: boolean } = {},
    ) => {
      doc.font(o.font ?? 'Helvetica').fontSize(o.size ?? 9).fillColor(o.color ?? INK, o.alpha ?? 1);
      doc.text(text, x, at, { width: o.width, align: o.align ?? 'left', lineBreak: o.lineBreak ?? true });
    };
    const heightOf = (text: string, width: number, size: number, font = 'Helvetica'): number => {
      doc.font(font).fontSize(size);
      return doc.heightOfString(text, { width });
    };
    /** Writes wrapped text at the left margin, starting a new page first if it will not fit, and moves y below it. */
    const para = (text: string, o: { size?: number; font?: string; alpha?: number; x?: number; after?: number } = {}) => {
      const x = o.x ?? MARGIN.left;
      const width = PAGE_W - MARGIN.right - x;
      const h = heightOf(text, width, o.size ?? 9, o.font);
      ensure(h);
      write(text, x, y, { size: o.size, font: o.font, alpha: o.alpha, width });
      y += h + (o.after ?? 0);
    };
    const rule = (at: number, alpha: number = PDF_ALPHA['--border-bright']) => {
      doc.save().strokeColor(INK, alpha).lineWidth(0.6).moveTo(MARGIN.left, at).lineTo(PAGE_W - MARGIN.right, at).stroke().restore();
    };

    const runningHeader = () => {
      write(`Almstins  ·  Agent Vault  ·  Operator report ${manifest.period}  ·  ${pdfSafe(content.tin.label, 60)}`, MARGIN.left, 24, {
        size: 7.5,
        alpha: PDF_ALPHA['--text-muted'] + 0.3,
        width: CONTENT_W,
        lineBreak: false,
      });
      rule(38);
    };
    const newPage = () => {
      doc.addPage();
      y = MARGIN.top;
      runningHeader();
      y = 52;
    };
    const ensure = (h: number) => {
      if (y + h > PAGE_H - MARGIN.bottom) newPage();
    };

    // ── The hero ─────────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 104).fill(INK);
    write('ALMSTINS  ·  AGENT VAULT', MARGIN.left, 24, { size: 8, font: 'Helvetica-Bold', color: PDF_COLORS['--accent'], lineBreak: false });
    write('Operator report', MARGIN.left, 38, { size: 24, font: 'Helvetica-Bold', color: PAPER, lineBreak: false });
    write(`${formatDayLong(manifest.period)} (UTC day)  ·  ${pdfSafe(content.tin.label, 70)}`, MARGIN.left, 72, {
      size: 10,
      color: PAPER,
      alpha: 0.78,
      width: 340,
      lineBreak: false,
    });
    write(`Version ${manifest.version}`, PAGE_W - MARGIN.right - 190, 26, { size: 9, font: 'Helvetica-Bold', color: PAPER, width: 190, align: 'right', lineBreak: false });
    write(`Generated ${formatUtc(manifest.generated_at)}`, PAGE_W - MARGIN.right - 190, 40, { size: 8, color: PAPER, alpha: 0.78, width: 190, align: 'right', lineBreak: false });
    write(`Signed with Almstins key ${manifest.signing_key_id ?? ''}`, PAGE_W - MARGIN.right - 190, 53, { size: 7, color: PDF_COLORS['--accent'], width: 190, align: 'right', lineBreak: false });
    y = 120;

    if (content.period.partial) {
      const note = `Partial day. This report was made at ${formatUtc(manifest.generated_at)}, before the day ended, so it covers ${formatUtc(content.period.start)} up to that moment.`;
      const h = heightOf(note, CONTENT_W - 20, 8.5, 'Helvetica-Bold') + 14;
      doc.rect(MARGIN.left, y, CONTENT_W, h).fillColor(PDF_COLORS['--warning'], 0.12).fill();
      doc.rect(MARGIN.left, y, 3, h).fillColor(PDF_COLORS['--warning'], 1).fill();
      write(note, MARGIN.left + 12, y + 7, { size: 8.5, font: 'Helvetica-Bold', width: CONTENT_W - 20 });
      y += h + 12;
    }

    // ── The four tiles ───────────────────────────────────────────────────────
    const gap = 8;
    const tileW = (CONTENT_W - gap * 3) / 4;
    const tileH = 78;
    const tiles: Array<{ bucket: ReportBucket; n: number; second: string }> = [
      { bucket: 'issues', n: content.buckets.issues.addresses, second: plural(content.buckets.issues.checks, 'check', 'checks') },
      { bucket: 'not_confirmed', n: content.buckets.not_confirmed.addresses, second: plural(content.buckets.not_confirmed.checks, 'check', 'checks') },
      { bucket: 'new', n: content.buckets.new.addresses, second: plural(content.buckets.new.checks, 'check', 'checks') },
      { bucket: 'no_issues', n: content.buckets.no_issues.addresses, second: plural(content.buckets.no_issues.checks, 'check', 'checks') },
    ];
    tiles.forEach((t, i) => {
      const x = MARGIN.left + i * (tileW + gap);
      doc.roundedRect(x, y, tileW, tileH, 6).fillColor(INK, 0.045).fill();
      doc.rect(x, y, tileW, 3.5).fillColor(BUCKET_COLOR[t.bucket], 1).fill();
      write(formatCount(t.n), x + 10, y + 13, { size: 22, font: 'Helvetica-Bold', width: tileW - 16, lineBreak: false });
      write(BUCKET_TITLE[t.bucket], x + 10, y + 42, { size: 9, font: 'Helvetica-Bold', width: tileW - 16, lineBreak: false });
      write(`${t.n === 1 ? 'address' : 'addresses'}  ·  ${t.second}`, x + 10, y + 55, {
        size: 7,
        alpha: PDF_ALPHA['--text-secondary'],
        width: tileW - 12,
        lineBreak: false,
      });
    });
    y += tileH + 10;
    para(
      `${plural(content.events.checked, 'check', 'checks')} about ${plural(content.addresses, 'address', 'addresses')} in this period. Each address is listed once, in the most severe group any of its checks fell in; the checks in each group are counted by their own answer.`,
      { size: 7.5, alpha: PDF_ALPHA['--text-secondary'], after: 12 },
    );

    // ── The bought and sold strip ────────────────────────────────────────────
    const strip = content.strip;
    const stripH = 56;
    doc.roundedRect(MARGIN.left, y, CONTENT_W, stripH, 6).lineWidth(0.8).strokeColor(INK, PDF_ALPHA['--border-bright'] + 0.1).stroke();
    const half = CONTENT_W / 2;
    const side = (x: number, label: string, s: typeof strip.bought) => {
      write(label.toUpperCase(), x + 12, y + 9, { size: 7.5, font: 'Helvetica-Bold', alpha: PDF_ALPHA['--text-secondary'], lineBreak: false });
      write(formatUsd(s.usd), x + 12, y + 20, { size: 17, font: 'Helvetica-Bold', width: half - 24, lineBreak: false });
      const sub =
        s.count === 0
          ? 'No transfers'
          : `${plural(s.count, 'transfer', 'transfers')}${s.unpricedCount ? `, ${s.unpricedCount} without a USD value (not in the total)` : ''}`;
      write(sub, x + 12, y + 42, { size: 7, alpha: PDF_ALPHA['--text-secondary'], width: half - 20, lineBreak: false });
    };
    side(MARGIN.left, 'Bought', strip.bought);
    side(MARGIN.left + half, 'Sold', strip.sold);
    doc.save().strokeColor(INK, PDF_ALPHA['--border-bright']).lineWidth(0.6).moveTo(MARGIN.left + half, y + 8).lineTo(MARGIN.left + half, y + stripH - 8).stroke().restore();
    y += stripH + 6;
    para('Raw value in (bought) and out (sold) between the agent\'s wallets and registered destinations, priced at the time of each transfer. The two sides are not compared.', {
      size: 7.5,
      alpha: PDF_ALPHA['--text-secondary'],
      after: 4,
    });
    if (strip.transfers > 0) {
      const statuses = (['proven', 'consistent-with-history', 'flagged', 'unknown'] as const)
        .map((k) => `${VERIFY_STATUS_TITLE[k].toLowerCase()} ${formatCount(strip.byStatus[k])}`)
        .join('  ·  ');
      const noCheck = strip.noPrecedingCheck ? `  (${formatCount(strip.noPrecedingCheck)} with no check before them)` : '';
      para(`Transfers by the verify-status they inherited from the check before them: ${statuses}${noCheck}.`, {
        size: 7.5,
        alpha: PDF_ALPHA['--text-secondary'],
        after: 6,
      });
    }
    y += 8;

    // ── The groups, each with its addresses ──────────────────────────────────
    const drawHead = () => {
      doc.rect(MARGIN.left, y, CONTENT_W, 16).fillColor(INK, 0.06).fill();
      let x = MARGIN.left;
      for (const col of COLUMNS) {
        write(col.title.toUpperCase(), x + 4, y + 5, { size: 6.5, font: 'Helvetica-Bold', alpha: PDF_ALPHA['--text-secondary'], width: col.width - 8, align: col.align, lineBreak: false });
        x += col.width;
      }
      y += 18;
    };

    const drawGroup = (bucket: ListedBucketName) => {
      const group = content.buckets[bucket];
      if (group.listed.length === 0) return;
      ensure(70);
      doc.circle(MARGIN.left + 4, y + 5, 3.4).fillColor(BUCKET_COLOR[bucket], 1).fill();
      write(`${BUCKET_TITLE[bucket]}  ·  ${formatCount(group.addresses)}`, MARGIN.left + 14, y, { size: 11, font: 'Helvetica-Bold', lineBreak: false });
      y += 16;
      para(BUCKET_MEANING[bucket], { size: 7.5, alpha: PDF_ALPHA['--text-secondary'], after: 6 });
      drawHead();
      for (const a of group.listed) drawRow(a);
      if (group.omitted > 0) {
        para(`${plural(group.omitted, 'more address', 'more addresses')} counted above but not listed (a report lists up to ${formatCount(MAX_LISTED_PER_BUCKET)} per group).`, {
          size: 7.5,
          alpha: PDF_ALPHA['--text-secondary'],
          after: 2,
        });
      }
      y += 12;
    };

    const drawRow = (a: ReportAddress) => {
      const cells = [
        formatClock(a.firstAt),
        pdfSafe(a.address, 120),
        pdfSafe(a.label ?? '', 80),
        a.reasons.map(reasonText).join(' '),
        a.checksInPeriod > a.checks ? `${a.checks} of ${a.checksInPeriod}` : String(a.checks),
      ];
      let rowH = 0;
      cells.forEach((text, i) => {
        const col = COLUMNS[i];
        rowH = Math.max(rowH, heightOf(text, col.width - 8, col.mono ? 7 : 7.5, col.mono ? 'Courier' : 'Helvetica'));
      });
      rowH += 8;
      if (y + rowH > PAGE_H - MARGIN.bottom) {
        newPage();
        drawHead();
      }
      let x = MARGIN.left;
      cells.forEach((text, i) => {
        const col = COLUMNS[i];
        write(text, x + 4, y + 4, { size: col.mono ? 7 : 7.5, font: col.mono ? 'Courier' : 'Helvetica', width: col.width - 8, align: col.align });
        x += col.width;
      });
      y += rowH;
      rule(y);
    };

    const anyListed = LISTED_BUCKETS.some((b) => content.buckets[b].listed.length > 0);
    if (anyListed) {
      for (const bucket of LISTED_BUCKETS) drawGroup(bucket);
    }

    // ── What came back clear ─────────────────────────────────────────────────
    ensure(60);
    doc.rect(MARGIN.left, y, 3, 34).fillColor(PDF_COLORS['--gain'], 1).fill();
    const clear = content.buckets.no_issues;
    const attention = content.buckets.issues.addresses + content.buckets.not_confirmed.addresses;
    const lead = attention === 0 ? 'Nothing here needs a person to look at it.' : `${plural(attention, 'address calls', 'addresses call')} for a look (the groups above).`;
    write(lead, MARGIN.left + 12, y, { size: 9.5, font: 'Helvetica-Bold', width: CONTENT_W - 12 });
    const clearText =
      clear.checks === 0
        ? 'No check came back proven or consistent with history in this period.'
        : `${plural(clear.checks, 'check', 'checks')} came back proven or consistent with history. ${plural(clear.addresses, 'address', 'addresses')} had only such checks and ${clear.addresses === 1 ? 'is' : 'are'} not listed. A clear result means the checks that ran came back without a flag; it is not a statement that an address is safe or legitimate.`;
    y += 14;
    para(clearText, { size: 8, alpha: PDF_ALPHA['--text-secondary'], x: MARGIN.left + 12, after: 18 });

    // ── Verification ─────────────────────────────────────────────────────────
    ensure(230);
    rule(y, 0.3);
    y += 12;
    write('Verification', MARGIN.left, y, { size: 12, font: 'Helvetica-Bold', lineBreak: false });
    y += 20;
    const line = (label: string, value: string, mono = false) => {
      const labelW = 112;
      const h = Math.max(heightOf(label, labelW - 6, 8, 'Helvetica-Bold'), heightOf(value, CONTENT_W - labelW, mono ? 7 : 8, mono ? 'Courier' : 'Helvetica'));
      ensure(h + 4);
      write(label, MARGIN.left, y, { size: 8, font: 'Helvetica-Bold', alpha: PDF_ALPHA['--text-secondary'], width: labelW - 6 });
      write(value, MARGIN.left + labelW, y, { size: mono ? 7 : 8, font: mono ? 'Courier' : 'Helvetica', width: CONTENT_W - labelW });
      y += h + 5;
    };
    line('Record ID', manifest.record_id, true);
    line('Version', `${manifest.version}${manifest.prev_root ? ' (supersedes the version before it; its root is below)' : ' (the first version of this day)'}`);
    line('Covers (UTC)', `${formatUtc(manifest.period_start)} up to ${formatUtc(manifest.period_end)}${manifest.partial ? ' (partial: made before the day ended)' : ''}`);
    line('Generated', `${formatUtc(manifest.generated_at)}. This report holds every event the Agent Vault had recorded up to that moment.`);
    line('Merkle root', manifest.merkle_root, true);
    line('Entries committed', `${formatCount(manifest.leaf_count)} (the summary, and one for each listed address)`);
    line('Signed', `Yes, with Almstins key ${signature.key_id} (${signature.alg})`);
    line('Signature', signature.signature_hex, true);
    if (manifest.prev_root) line('Version before', manifest.prev_root, true);
    y += 4;
    const how =
      `This PDF carries its own proof bundle as an attachment named ${bundleFileName(manifest)} (the same file the Reports page offers). ` +
      `To check it, upload that file at ${manifest.verify_url}, or run the standalone verifier from the Almstins repository: node scripts/verify-record.mjs <file> --well-known <site>/.well-known/almstins-signing-key.json. ` +
      'The check runs in your browser or offline and needs no account. A match shows that the lines of this report are unaltered and were signed by the key named above.';
    ensure(heightOf(how, CONTENT_W, 8) + 30);
    write('How anyone can verify this report', MARGIN.left, y, { size: 9, font: 'Helvetica-Bold', lineBreak: false });
    y += 14;
    para(how, { size: 8, alpha: PDF_ALPHA['--text-secondary'], after: 10 });
    const about =
      'This report is a snapshot of what the Agent Vault recorded: the checks an agent asked for, what each was answered, and the transfers the chain confirmed between the agent\'s own wallets and registered destinations. ' +
      'Transfers are recorded after the chain confirms them, so a later version of this day may list one that this version does not. ' +
      manifest.disclaimer +
      ' Almstins verifies, flags and records. It does not hold or move funds and is never in the payment path.';
    para(about, { size: 7.5, alpha: PDF_ALPHA['--text-secondary'] });

    // ── The proof bundle, attached ───────────────────────────────────────────
    const created = new Date(manifest.generated_at);
    doc.file(Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8'), {
      name: bundleFileName(manifest),
      type: 'application/json',
      description: 'Almstins proof bundle for this report. Upload it at the verify page, or run the offline verifier.',
      creationDate: created,
      modifiedDate: created,
    });

    // ── Page footers ─────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      write(`Almstins  ·  Agent Vault  ·  Operator report ${manifest.period}  ·  version ${manifest.version}`, MARGIN.left, PAGE_H - 36, {
        size: 7,
        alpha: PDF_ALPHA['--text-muted'] + 0.3,
        width: CONTENT_W - 80,
        lineBreak: false,
      });
      write(`Page ${i + 1} of ${range.count}`, PAGE_W - MARGIN.right - 80, PAGE_H - 36, {
        size: 7,
        alpha: PDF_ALPHA['--text-muted'] + 0.3,
        width: 80,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
