import { describe, it, expect } from 'vitest';
import { entriesLine, ledgerNote, ledgerRangeLine, recordKindLabel, supersededNote, versionLine } from '../../src/lib/recordProof/manifestText';

/**
 * How /verify-record describes a manifest. The page used to read a Year Summary's counts
 * unconditionally, so a bundle of any other kind would have shown "undefined" in its entries line
 * (or failed outright with no counts at all). Each kind now describes itself.
 */
describe('recordKindLabel', () => {
  it('names the kinds this code knows, in words', () => {
    expect(recordKindLabel('year_summary')).toBe('Year Summary');
    expect(recordKindLabel('agent_report')).toBe('Agent Vault report');
    expect(recordKindLabel('agent_ledger')).toBe('Agent Vault ledger');
  });

  it('shows another kind by its own tag, and a missing one as `record`', () => {
    expect(recordKindLabel('receivable_set')).toBe('receivable_set');
    expect(recordKindLabel(undefined)).toBe('record');
    expect(recordKindLabel('')).toBe('record');
    expect(recordKindLabel(7)).toBe('record');
  });
});

describe('entriesLine', () => {
  it('keeps a Year Summary line exactly as it was', () => {
    expect(entriesLine({ record_type: 'year_summary', leaf_count: 14, counts: { short_term: 3, long_term: 4, income: 5, held: 1, unsettled: 1 } })).toBe(
      '14 (short 3 · long 4 · income 5 · held 1 · review 1)',
    );
  });

  it('describes an Agent Vault report by its address groups', () => {
    expect(entriesLine({ record_type: 'agent_report', leaf_count: 4, counts: { issues: 1, not_confirmed: 2, new: 3, no_issues: 12 } })).toBe(
      '4 (had issues 1 · not confirmed 2 · new 3 · no issues 12 addresses)',
    );
  });

  it('never prints undefined: missing or malformed counts read as zero, and an unknown kind shows only its number of entries', () => {
    expect(entriesLine({ record_type: 'agent_report', leaf_count: 1 })).toBe('1 (had issues 0 · not confirmed 0 · new 0 · no issues 0 addresses)');
    expect(entriesLine({ record_type: 'year_summary', leaf_count: 2, counts: null })).toBe('2 (short 0 · long 0 · income 0 · held 0 · review 0)');
    expect(entriesLine({ record_type: 'year_summary', leaf_count: 2, counts: { short_term: 'x', long_term: Number.NaN } })).toBe('2 (short 0 · long 0 · income 0 · held 0 · review 0)');
    expect(entriesLine({ record_type: 'something_else', leaf_count: 9, counts: { a: 1 } })).toBe('9');
    expect(entriesLine({})).toBe('0');
    for (const line of [entriesLine({ record_type: 'agent_report' }), entriesLine({ record_type: 'year_summary' }), entriesLine({ record_type: 'x' })]) {
      expect(line).not.toMatch(/undefined|NaN|null/);
    }
  });
});

describe('versionLine', () => {
  it('says which version of its day an Agent Vault report is, and that a mid-day one was made before the day ended', () => {
    expect(versionLine({ record_type: 'agent_report', version: 3, partial: true })).toBe('Version 3, partial: made before the day ended');
    expect(versionLine({ record_type: 'agent_report', version: 1, partial: false })).toBe('Version 1');
    expect(versionLine({ record_type: 'agent_report', version: 12 })).toBe('Version 12');
  });

  it('says so when a report bundle does not state its version, and never prints undefined', () => {
    expect(versionLine({ record_type: 'agent_report' })).toBe('Version not stated');
    expect(versionLine({ record_type: 'agent_report', partial: true })).toBe('Version not stated, partial: made before the day ended');
    for (const version of ['3', 0, -1, 1.5, Number.NaN, null, {}, [3]]) {
      expect(versionLine({ record_type: 'agent_report', version }), String(version)).toBe('Version not stated');
    }
    // Only a real true marks a day partial.
    for (const partial of ['true', 1, 'yes', null]) expect(versionLine({ record_type: 'agent_report', version: 2, partial }), String(partial)).toBe('Version 2');
  });

  it('is nothing at all for any other kind of record, so a Year Summary reads as it always did', () => {
    expect(versionLine({ record_type: 'year_summary', version: 3, partial: true })).toBeNull();
    expect(versionLine({ record_type: 'receivable_set', version: 2 })).toBeNull();
    expect(versionLine({})).toBeNull();
    expect(versionLine({ record_type: 7 })).toBeNull();
  });
});

describe('supersededNote', () => {
  it('tells the reader a later version of the day may be the newest, and that this check cannot see it', () => {
    const note = supersededNote({ record_type: 'agent_report', version: 1 });
    expect(note).toMatch(/later version of the same day/);
    expect(note).toMatch(/cannot see one/);
  });

  it('is nothing for any other kind of record', () => {
    expect(supersededNote({ record_type: 'year_summary' })).toBeNull();
    expect(supersededNote({})).toBeNull();
  });
});

describe('an Agent Vault ledger export', () => {
  it('is described by the checks and the transfers it holds', () => {
    expect(entriesLine({ record_type: 'agent_ledger', leaf_count: 9, counts: { checked: 6, transaction: 3 } })).toBe('9 (checks 6 · transfers 3)');
    expect(entriesLine({ record_type: 'agent_ledger', leaf_count: 0, counts: { checked: 0, transaction: 0 } })).toBe('0 (checks 0 · transfers 0)');
  });

  it('never prints undefined: missing or malformed counts read as zero', () => {
    expect(entriesLine({ record_type: 'agent_ledger', leaf_count: 2 })).toBe('2 (checks 0 · transfers 0)');
    expect(entriesLine({ record_type: 'agent_ledger', leaf_count: 2, counts: { checked: 'x', transaction: Number.NaN } })).toBe('2 (checks 0 · transfers 0)');
    expect(entriesLine({ record_type: 'agent_ledger' })).not.toMatch(/undefined|NaN|null/);
  });

  it('says which days it covers, and that a file made before the last day ended covers part of it', () => {
    expect(ledgerRangeLine({ record_type: 'agent_ledger', from_day: '2026-10-01', to_day: '2026-10-18' })).toBe('Covers 2026-10-01 to 2026-10-18 (UTC days, both counted)');
    expect(ledgerRangeLine({ record_type: 'agent_ledger', from_day: '2026-10-01', to_day: '2026-10-18', partial: true })).toBe(
      'Covers 2026-10-01 to 2026-10-18 (UTC days, both counted), partial: made before the last day ended',
    );
    for (const partial of ['true', 1, 'yes', null, undefined]) {
      expect(ledgerRangeLine({ record_type: 'agent_ledger', from_day: '2026-10-01', to_day: '2026-10-18', partial })).toBe('Covers 2026-10-01 to 2026-10-18 (UTC days, both counted)');
    }
  });

  it('says the first and last minute when the file covers part of a day, and keeps saying days when it covers whole days', () => {
    const windowed = (over: Record<string, unknown> = {}) => ({
      record_type: 'agent_ledger', from_day: '2026-10-18', to_day: '2026-10-18', period_start: '2026-10-18T06:00:00.000Z', period_end: '2026-10-18T12:00:00.000Z', ...over,
    });
    expect(ledgerRangeLine(windowed())).toBe('Covers 2026-10-18 06:00 to 2026-10-18 11:59 (UTC, to the minute, both counted)');
    expect(ledgerRangeLine(windowed({ period_end: '2026-10-19T06:01:00.000Z', to_day: '2026-10-19' }))).toBe('Covers 2026-10-18 06:00 to 2026-10-19 06:00 (UTC, to the minute, both counted)');
    expect(ledgerRangeLine(windowed({ partial: true }))).toBe('Covers 2026-10-18 06:00 to 2026-10-18 11:59 (UTC, to the minute, both counted), partial: made before the range ended');
    // Whole days, even when their start and end are stated: the days are named, as ever.
    const whole = { period_start: '2026-10-01T00:00:00.000Z', period_end: '2026-10-19T00:00:00.000Z' };
    expect(ledgerRangeLine({ record_type: 'agent_ledger', from_day: '2026-10-01', to_day: '2026-10-18', ...whole })).toBe('Covers 2026-10-01 to 2026-10-18 (UTC days, both counted)');
    // A first and last moment that cannot be read as moments fall back to the days; they are never printed.
    for (const odd of [{ period_start: 'x', period_end: 'y' }, { period_start: '2026-10-18T06:00:00Z', period_end: '2026-10-18T12:00:00.000Z' }, { period_start: 5, period_end: 6 }, { period_start: '2026-10-18T12:00:00.000Z', period_end: '2026-10-18T06:00:00.000Z' }, { period_start: '<b>x</b>', period_end: '2026-10-18T12:00:00.000Z' }]) {
      expect(ledgerRangeLine(windowed(odd)), JSON.stringify(odd)).toBe('Covers 2026-10-18 to 2026-10-18 (UTC days, both counted)');
    }
  });

  it('says so when the days are not stated or are not days, and prints nothing it was not given', () => {
    for (const odd of [{}, { from_day: '2026-10-01' }, { to_day: '2026-10-18' }, { from_day: 'x', to_day: 'y' }, { from_day: 5, to_day: 6 }, { from_day: '2026-1-1', to_day: '2026-10-18' }, { from_day: '<b>2026-10-01</b>', to_day: '2026-10-18' }]) {
      const line = ledgerRangeLine({ record_type: 'agent_ledger', ...odd });
      expect(line, JSON.stringify(odd)).toBe('Range not stated');
    }
  });

  it('says what its signature does not reach: a snapshot, a later export may hold more, nothing about the agent\'s own behavior, nothing about an unregistered address', () => {
    const note = ledgerNote({ record_type: 'agent_ledger' }) ?? '';
    expect(note).toMatch(/snapshot of the ledger when it was made/);
    expect(note).toMatch(/later export of the same days can contain more/);
    expect(note).toMatch(/cannot see one/);
    expect(note).toMatch(/does not show that the agent asked before every payment/);
    expect(note).toMatch(/never registered/);
    // It says "contain", never "hold": the Vault's wording rule keeps that word for what an agent does with a payment.
    expect(note).not.toMatch(/\bholds?\b/i);
  });

  it('is nothing at all for any other kind of record, so a Year Summary and a report read as they always did', () => {
    for (const record_type of ['year_summary', 'agent_report', 'receivable_set', undefined, 7]) {
      expect(ledgerRangeLine({ record_type, from_day: '2026-10-01', to_day: '2026-10-18' }), String(record_type)).toBeNull();
      expect(ledgerNote({ record_type }), String(record_type)).toBeNull();
    }
    expect(ledgerRangeLine({})).toBeNull();
    expect(ledgerNote({})).toBeNull();
  });
});
