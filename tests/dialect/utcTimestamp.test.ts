import { describe, it, expect } from 'vitest';
import { toUtcIso, sqlTimestamptz } from '../../src/lib/utcTimestamp';

/**
 * Ledger timestamps are TEXT meant to hold ISO-8601 UTC: year filters read the first four
 * characters and date math casts to timestamptz. toUtcIso is the write-side normalizer (the
 * screenshot importers store what it returns); sqlTimestamptz is the read-side cast that turns
 * a malformed value into NULL instead of failing the whole statement.
 */

describe('toUtcIso', () => {
  it.each([
    ['2024-09-09T17:50:12Z', '2024-09-09T17:50:12.000Z'],
    ['2024-09-09T17:50:12.345Z', '2024-09-09T17:50:12.345Z'],
    ['2024-09-09T17:50:12.123456Z', '2024-09-09T17:50:12.123Z'],
    // No zone: read as UTC (the prompt tells the model to assume UTC when it is unclear).
    ['2024-04-01 00:00:00', '2024-04-01T00:00:00.000Z'],
    ['2024-04-01T00:00', '2024-04-01T00:00:00.000Z'],
    ['2024-04-01', '2024-04-01T00:00:00.000Z'],
    // An offset is converted, so the stored year is the UTC year.
    ['2024-01-01T02:00:00+05:00', '2023-12-31T21:00:00.000Z'],
    ['2024-01-01T02:00:00+0500', '2023-12-31T21:00:00.000Z'],
    ['2024-01-01T02:00:00+05', '2023-12-31T21:00:00.000Z'],
    ['2023-12-31T22:30:00-02:00', '2024-01-01T00:30:00.000Z'],
    ['  2024-09-09T17:50:12z ', '2024-09-09T17:50:12.000Z'],
  ])('%s -> %s', (raw, iso) => {
    expect(toUtcIso(raw)).toBe(iso);
  });

  it.each([
    'Sep 9 2024 5:50PM ET',
    '09/09/2024 17:50',
    '2024-02-30T00:00:00Z', // no Feb 30 (Date would roll it to Mar 1)
    '2023-02-29',
    '2024-13-01T00:00:00Z',
    '2024-01-01T24:00:00Z',
    '2024-01-01T12:60:00Z',
    '0099-01-01T00:00:00Z', // Date.UTC would map year 99 to 1999
    '2024-01-01T00:00:00+16:00',
    '',
    null,
    undefined,
    1725904212,
  ])('rejects %s', (raw) => {
    expect(toUtcIso(raw)).toBeNull();
  });
});

describe('sqlTimestamptz', () => {
  it('casts only ISO-8601-shaped text, as a CASE with no placeholders or apostrophes to escape', () => {
    const sql = sqlTimestamptz('tl.acquired_at');
    expect(sql).toMatch(/^CASE WHEN tl\.acquired_at ~ '\^[^']+\$' THEN CAST\(tl\.acquired_at AS timestamptz\) END$/);
    // The regex sits inside one single-quoted literal (so the shim skips its `?`s) and holds
    // no backslash a template literal could eat.
    expect(sql.split("'")).toHaveLength(3);
    expect(sql).not.toContain('\\');
  });

  it('the SQL regex accepts what toUtcIso accepts and rejects non-ISO text', () => {
    const re = new RegExp(/'(\^[^']+\$)'/.exec(sqlTimestamptz('x'))![1]);
    for (const ok of ['2024-09-09T17:50:12Z', '2024-04-01 00:00:00', '2024-04-01', '2024-01-01T02:00:00+05:00', '2024-01-01T02:00:00.5+0500']) {
      expect(re.test(ok)).toBe(true);
    }
    for (const bad of ['Sep 9 2024 5:50PM ET', '09/09/2024', '2024-13-01', '2024-01-01T25:00:00Z', '']) {
      expect(re.test(bad)).toBe(false);
    }
  });

  it.each(['timestamp_utc; DROP TABLE x', "a'b", 'f(x)', '', 'a.b.c'])('refuses a non-column %s', (col) => {
    expect(() => sqlTimestamptz(col)).toThrow();
  });
});
