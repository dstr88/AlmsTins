/**
 * Adding a long list of addresses. The API takes at most 10 addresses and 50,000 characters in one
 * request (the screening source behind each check has a small free budget, so a request stays
 * small), so a longer paste is cut into requests of 10 lines and sent one after another. This is
 * that cutting, the sequencing and the adding-up, with no screen in it, so every rule is a unit test.
 *
 * Nothing is dropped without a word. Every line of the paste ends up counted as added, already
 * registered, repeated, over the plan's limit, not read as an address, or not tried (the paste ended
 * early). When the plan has no place left, or a request fails, the lines still waiting are counted
 * as not added and the sending ends: it never keeps sending into a refusal.
 *
 * A request the plan refuses as a whole (`plan_limit`) says what became of each of its lines, the same
 * way an accepted one does, so they are counted from that: a line that was already registered is
 * counted as that, not as over the limit. An answer that carries no lines (a server that does not send
 * them) falls back to counting every line of that request as over the limit.
 */
import type { Send } from './client';
import { codeOf, failureText } from './client';
import { copy } from './copy';

/** Lines in one request. The server's own MAX_BATCH (src/lib/agentVault/vault.ts) is the same number. */
export const PASTE_BATCH = 10;
/** Lines one paste may hold. A longer list is pasted in parts. */
export const PASTE_MAX_LINES = 200;
/** A line longer than this is refused by the server as too long; it is cut here so no single line can swell a request. */
const LINE_CUT = 501;

export interface PasteChunk {
  /** The lines of this request, joined. */
  text: string;
  /** The line of the whole paste this request starts at (1-based), so a line number in an answer can be turned back into the paste's. */
  firstLine: number;
  /** Lines in it that the server may read as an address (not blank, not a comment). */
  candidates: number;
}

export interface PastePlan {
  chunks: PasteChunk[];
  /** Candidate lines in the whole paste. */
  lines: number;
  /** The paste is longer than PASTE_MAX_LINES. */
  tooLong: boolean;
}

/** A line the server reads as something other than nothing: not blank, not a # or // comment. */
const isCandidate = (line: string): boolean => {
  const t = line.trim();
  return t !== '' && !t.startsWith('#') && !t.startsWith('//');
};

/** Cuts a paste into requests of `size` lines each (blank and comment lines ride along and cost nothing). */
export function planPaste(text: string, size: number = PASTE_BATCH): PastePlan {
  const rows = String(text ?? '').split(/\r\n|\r|\n/);
  const chunks: PasteChunk[] = [];
  let current: { rows: string[]; firstLine: number; candidates: number } | null = null;
  let lines = 0;
  for (const [i, raw] of rows.entries()) {
    const row = raw.length > LINE_CUT ? raw.slice(0, LINE_CUT) : raw;
    const candidate = isCandidate(row);
    if (candidate) lines += 1;
    if (!current) {
      if (!candidate) continue; // leading blanks open nothing
      current = { rows: [], firstLine: i + 1, candidates: 0 };
    } else if (candidate && current.candidates >= size) {
      chunks.push({ text: current.rows.join('\n'), firstLine: current.firstLine, candidates: current.candidates });
      current = { rows: [], firstLine: i + 1, candidates: 0 };
    }
    current.rows.push(row);
    if (candidate) current.candidates += 1;
  }
  if (current && current.candidates > 0) chunks.push({ text: current.rows.join('\n'), firstLine: current.firstLine, candidates: current.candidates });
  return { chunks, lines, tooLong: lines > PASTE_MAX_LINES };
}

export interface PasteLine {
  /** The line of the whole paste (1-based). */
  line: number;
  /** The address, or the line as pasted (cut) for a line that did not read as one. */
  text: string;
  /** The reason code (src/lib/agentVault: already_registered, repeated_in_paste, over_limit, no_address, ...). */
  reason: string;
}

export interface PasteOutcome {
  added: number;
  trusted: number;
  flagged: number;
  pending: number;
  already: number;
  repeated: number;
  overLimit: number;
  unreadable: number;
  /** Lines that were never sent, because the paste ended early. */
  notTried: number;
  /** Every line that was not added, with its reason, in paste order. */
  lines: PasteLine[];
  /** Why the paste ended early, in plain words, or null when it ran to the end. */
  endedBecause: string | null;
}

export const emptyOutcome = (): PasteOutcome => ({
  added: 0, trusted: 0, flagged: 0, pending: 0, already: 0, repeated: 0, overLimit: 0, unreadable: 0, notTried: 0, lines: [], endedBecause: null,
});

export interface PasteProgress {
  /** Requests answered so far, and in all. */
  done: number;
  total: number;
  /** The lines of the paste the request in flight covers. */
  fromLine: number;
  toLine: number;
}

const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const asList = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

/** Counts the lines an answer accounts for (its skipped and rejected lists), turning each line number back into the paste's. */
function tallyLines(out: PasteOutcome, chunk: PasteChunk, body: Record<string, unknown>): void {
  for (const s of asList(body.skipped)) {
    const reason = typeof s.reason === 'string' ? s.reason : 'already_registered';
    if (reason === 'over_limit') out.overLimit += 1;
    else if (reason === 'repeated_in_paste') out.repeated += 1;
    else out.already += 1;
    out.lines.push({ line: chunk.firstLine + asNumber(s.line) - 1, text: typeof s.address === 'string' ? s.address : '', reason });
  }
  for (const x of asList(body.rejected)) {
    out.unreadable += 1;
    out.lines.push({
      line: chunk.firstLine + asNumber(x.line) - 1,
      text: typeof x.text === 'string' ? x.text : '',
      reason: typeof x.reason === 'string' ? x.reason : 'no_address',
    });
  }
}

/**
 * Sends a planned paste, one request at a time, and adds up what came back. A request that fails
 * ends the paste there: the lines of that request and every later one are counted as not tried,
 * and the failure is said in plain words. A `plan_limit` answer is the same, with the cap's words.
 */
export async function runPaste(
  plan: PastePlan,
  opts: { tinId: string; chain: string; call: Send; errors?: Readonly<Record<string, string>>; onProgress?: (p: PasteProgress) => void },
): Promise<PasteOutcome> {
  const out = emptyOutcome();
  const inOrder = (): PasteOutcome => {
    out.lines.sort((a, b) => a.line - b.line);
    return out;
  };
  for (const [i, chunk] of plan.chunks.entries()) {
    opts.onProgress?.({ done: i, total: plan.chunks.length, fromLine: chunk.firstLine, toLine: chunk.firstLine + chunk.text.split('\n').length - 1 });
    const r = await opts.call('POST', '/api/agentics/destinations', { tinId: opts.tinId, text: chunk.text, chain: opts.chain });
    if (!r.ok || !r.body) {
      // A request whose every address was refused by the plan is the one failure that is also an answer
      // about its lines: it says what became of each of them, and they are counted from that.
      const accounted = codeOf(r) === 'plan_limit' && !!r.body && Array.isArray(r.body.skipped);
      if (accounted && r.body) tallyLines(out, chunk, r.body);
      else if (codeOf(r) === 'plan_limit') out.overLimit += chunk.candidates;
      else out.notTried += chunk.candidates;
      const later = plan.chunks.slice(i + 1);
      for (const l of later) out.notTried += l.candidates;
      // A last request that the plan refused did not end the paste early: every line of it is accounted for above.
      out.endedBecause = accounted && later.length === 0 ? null : failureText(r, opts.errors);
      return inOrder();
    }
    const summary = (r.body.summary ?? {}) as Record<string, unknown>;
    out.added += asNumber(summary.added);
    out.trusted += asNumber(summary.trusted);
    out.flagged += asNumber(summary.flagged);
    out.pending += asNumber(summary.pending);
    tallyLines(out, chunk, r.body);
  }
  opts.onProgress?.({ done: plan.chunks.length, total: plan.chunks.length, fromLine: 0, toLine: 0 });
  return inOrder();
}

/**
 * The sentences that sum a paste up, in the order a person wants them: what was added and how it
 * came out, what was skipped and why, what was not read as an address, what was never tried. The
 * first two are always said, zero or not, so a paste can be checked against its own line count.
 */
export function describePaste(o: PasteOutcome): string[] {
  const out: string[] = [copy.registry.summary.added(o.added, o.trusted, o.flagged, o.pending)];
  const skipped = o.already + o.repeated + o.overLimit;
  const parts: string[] = [];
  if (o.already > 0) parts.push(copy.registry.summary.already(o.already));
  if (o.repeated > 0) parts.push(copy.registry.summary.repeated(o.repeated));
  if (o.overLimit > 0) parts.push(copy.registry.summary.overLimit(o.overLimit));
  out.push(copy.registry.summary.skipped(skipped, parts.join(', ')));
  if (o.unreadable > 0) out.push(copy.registry.summary.unreadable(o.unreadable));
  if (o.notTried > 0) out.push(copy.registry.summary.notTried(o.notTried));
  if (o.endedBecause) out.push(copy.registry.summary.ended(o.endedBecause));
  return out;
}
