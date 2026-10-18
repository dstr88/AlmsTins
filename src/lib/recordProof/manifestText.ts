// How the public verify page (/verify-record) describes a proof bundle's manifest: what kind of
// record it is and what its entry counts mean. Pure and isomorphic (no DB, no node:crypto), so
// the page can import it. A Year Summary's counts are its tax lines; an Agent Vault report's
// counts are its address groups. A kind this code does not know is shown by its own name with
// only the number of entries, never with counts that were never there.

export interface DescribableManifest {
  record_type?: unknown;
  leaf_count?: unknown;
  counts?: unknown;
}

/** The kind of record, in words: `Year Summary`, `Agent Vault report`, or the manifest's own tag. */
export function recordKindLabel(recordType: unknown): string {
  if (recordType === 'year_summary') return 'Year Summary';
  if (recordType === 'agent_report') return 'Agent Vault report';
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
  return n;
}
