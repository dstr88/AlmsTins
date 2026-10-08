import { describe, it, expect } from 'vitest';
import { NEW_ACCOUNT_WINDOW_MS, newAccountKey, parseUtcTimestamp } from '../../src/lib/analytics/newAccount';

/**
 * The dashboard layout decides whether a visit is a new account's sign-up from the first
 * tenant membership's created_at. These pin the window and the timestamp formats it reads.
 */
const NOW = Date.parse('2026-10-08T15:00:00Z');

describe('parseUtcTimestamp', () => {
  it('reads the stored to_char format as UTC', () => {
    expect(parseUtcTimestamp('2026-10-08 14:55:00')).toBe(Date.parse('2026-10-08T14:55:00Z'));
  });

  it('reads ISO 8601, with or without a zone', () => {
    expect(parseUtcTimestamp('2026-10-08T14:55:00Z')).toBe(Date.parse('2026-10-08T14:55:00Z'));
    expect(parseUtcTimestamp('2026-10-08T14:55:00')).toBe(Date.parse('2026-10-08T14:55:00Z'));
    expect(parseUtcTimestamp('2026-10-08T09:55:00-05:00')).toBe(Date.parse('2026-10-08T14:55:00Z'));
  });

  it('returns null for nothing or garbage', () => {
    expect(parseUtcTimestamp(null)).toBeNull();
    expect(parseUtcTimestamp('')).toBeNull();
    expect(parseUtcTimestamp('not a date')).toBeNull();
  });
});

describe('newAccountKey', () => {
  it('counts a membership created minutes ago, keyed by its timestamp', () => {
    expect(newAccountKey('2026-10-08 14:55:00', NOW)).toBe('2026-10-08 14:55:00');
  });

  it('stops counting once the window has passed', () => {
    const justInside = new Date(NOW - NEW_ACCOUNT_WINDOW_MS + 1000).toISOString();
    const justOutside = new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1000).toISOString();
    expect(newAccountKey(justInside, NOW)).toBe(justInside);
    expect(newAccountKey(justOutside, NOW)).toBeNull();
  });

  it('never counts an old account', () => {
    expect(newAccountKey('2026-06-01 10:00:00', NOW)).toBeNull();
  });

  it('tolerates a database clock a few seconds ahead, but not a future date', () => {
    expect(newAccountKey('2026-10-08 15:00:20', NOW)).toBe('2026-10-08 15:00:20');
    expect(newAccountKey('2026-10-08 16:00:00', NOW)).toBeNull();
  });

  it('counts nothing without a membership', () => {
    expect(newAccountKey(null, NOW)).toBeNull();
    expect(newAccountKey(undefined, NOW)).toBeNull();
  });
});
