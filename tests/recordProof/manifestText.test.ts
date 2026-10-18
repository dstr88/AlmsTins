import { describe, it, expect } from 'vitest';
import { entriesLine, recordKindLabel, supersededNote, versionLine } from '../../src/lib/recordProof/manifestText';

/**
 * How /verify-record describes a manifest. The page used to read a Year Summary's counts
 * unconditionally, so a bundle of any other kind would have shown "undefined" in its entries line
 * (or failed outright with no counts at all). Each kind now describes itself.
 */
describe('recordKindLabel', () => {
  it('names the kinds this code knows, in words', () => {
    expect(recordKindLabel('year_summary')).toBe('Year Summary');
    expect(recordKindLabel('agent_report')).toBe('Agent Vault report');
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
