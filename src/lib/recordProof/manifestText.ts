// How the public verify page (/verify-record) describes a proof bundle's manifest: what kind of
// record it is and what its entry counts mean. Pure and isomorphic (no DB, no node:crypto), so
// the page can import it. A Year Summary's counts are its tax lines; an Agent Vault report's
// counts are its address groups; an Agent Vault ledger export's counts are the checks and the
// transfers it holds, and it says which days it covers. A kind this code does not know is shown by
// its own name with only the number of entries, never with counts that were never there.

export interface DescribableManifest {
  record_type?: unknown;
  leaf_count?: unknown;
  counts?: unknown;
  version?: unknown;
  partial?: unknown;
  from_day?: unknown;
  to_day?: unknown;
  period_start?: unknown;
  period_end?: unknown;
}

/** The kind of record, in words: `Year Summary`, `Agent Vault report`, `Agent Vault ledger`, or the manifest's own tag. */
export function recordKindLabel(recordType: unknown): string {
  if (recordType === 'year_summary') return 'Year Summary';
  if (recordType === 'agent_report') return 'Agent Vault report';
  if (recordType === 'agent_ledger') return 'Agent Vault ledger';
  return typeof recordType === 'string' && recordType ? recordType : 'record';
}

const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '0');

/** The entries line: how many entries the root commits to, and what they are made of. */
export function entriesLine(m: DescribableManifest): string {
  const n = num(m.leaf_count);
  const c = (m.counts && typeof m.counts === 'object' ? m.counts : {}) as Record<string, unknown>;
  if (m.record_type === 'year_summary') {
    return `${n} (short ${num(c.short_term)} · long ${num(c.long_term)} · income ${num(c.income)} · held ${num(c.held)} · review ${num(c.unsettled)})`;
  }
  if (m.record_type === 'agent_report') {
    return `${n} (had issues ${num(c.issues)} · not confirmed ${num(c.not_confirmed)} · new ${num(c.new)} · no issues ${num(c.no_issues)} addresses)`;
  }
  if (m.record_type === 'agent_ledger') {
    return `${n} (checks ${num(c.checked)} · transfers ${num(c.transaction)})`;
  }
  return n;
}

/**
 * Which version of its day an Agent Vault report is, and whether it was made before the day ended,
 * in one line: "Version 3, partial: made before the day ended". A signature that checks out says the
 * file is genuine and unaltered. It does not say this is the last word on its day: a report is a
 * snapshot, and a later version of the same day can be the newest one. So the page says which
 * version this is. Null for any other kind of record, which is described as it always was.
 */
export function versionLine(m: DescribableManifest): string | null {
  if (m.record_type !== 'agent_report') return null;
  const v = m.version;
  const parts = [typeof v === 'number' && Number.isInteger(v) && v >= 1 ? `Version ${v}` : 'Version not stated'];
  if (m.partial === true) parts.push('partial: made before the day ended');
  return parts.join(', ');
}

/** What goes with it: this check reads one file and cannot see a later version. Null for any other kind of record. */
export function supersededNote(m: DescribableManifest): string | null {
  if (m.record_type !== 'agent_report') return null;
  return 'A report is a snapshot. A later version of the same day may have replaced this one as the newest; this check reads only this file and cannot see one.';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY_MS = 86_400_000;

/** An instant the manifest states, as milliseconds, or null when it is not a UTC ISO-8601 time with milliseconds. */
function instantOf(v: unknown): number | null {
  if (typeof v !== 'string' || !INSTANT.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString() === v ? ms : null;
}

const minuteText = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The days an Agent Vault ledger export covers, in one line: "Covers 2026-10-01 to 2026-10-18 (UTC
 * days, both counted)", and, for a file made before the last day ended, that it holds that day only up
 * to the moment it was made. A file that covers part of a day (a first or last moment that is not the
 * start of a UTC day) says its first and last minute instead: "Covers 2026-10-18 06:00 to 2026-10-18
 * 11:59 (UTC, to the minute, both counted)". A day or a time this code cannot read is said to be not
 * stated, never printed. Null for any other kind of record, which is described as it always was.
 */
export function ledgerRangeLine(m: DescribableManifest): string | null {
  if (m.record_type !== 'agent_ledger') return null;
  const start = instantOf(m.period_start);
  const end = instantOf(m.period_end);
  const windowed = start !== null && end !== null && end > start && (start % DAY_MS !== 0 || end % DAY_MS !== 0);
  if (windowed) {
    const range = `Covers ${minuteText(start)} to ${minuteText(end - 60_000)} (UTC, to the minute, both counted)`;
    return m.partial === true ? `${range}, partial: made before the range ended` : range;
  }
  const from = typeof m.from_day === 'string' && DAY.test(m.from_day) ? m.from_day : null;
  const to = typeof m.to_day === 'string' && DAY.test(m.to_day) ? m.to_day : null;
  const range = from && to ? `Covers ${from} to ${to} (UTC days, both counted)` : 'Range not stated';
  return m.partial === true ? `${range}, partial: made before the last day ended` : range;
}

/**
 * What goes with it: an export is a snapshot, and this check reads one file and cannot see a later
 * one, and the signature is about the ledger, not about everything the agent did. Null for any other
 * kind of record.
 */
export function ledgerNote(m: DescribableManifest): string | null {
  if (m.record_type !== 'agent_ledger') return null;
  return (
    'An export is a snapshot of the ledger when it was made. A later export of the same days can contain more, such as a transfer the chain confirmed late; ' +
    'this check reads only this file and cannot see one. It does not show that the agent asked before every payment, and it contains nothing about a transfer to an address that was never registered.'
  );
}
