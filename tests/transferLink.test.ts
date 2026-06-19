import 'dotenv/config';
import { test, expect } from 'vitest';
import { selectArrivalMatch } from '@/lib/lifecycle';

// Pure unit tests for the exchange-withdrawal -> on-chain-arrival selector (2A).
// TAX-SENSITIVE: a false link silently hides a disposal, so these pin the guards.
const ms = (iso: string) => Date.parse(iso);
const arr = (source_id: string, amount: number | null, iso: string) => ({ source_id, direction: 'in', amount, timestamp_utc: iso });
const W = 6 * 60; // 6h
const T = 0.01;   // 1%

test('links a slow (2h) same-amount arrival', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T00:00:00Z'), [arr('a', 0.5, '2024-01-01T02:00:00Z')], new Set(), W, T)?.source_id).toBe('a');
});
test('does NOT link outside the window (8h)', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T00:00:00Z'), [arr('a', 0.5, '2024-01-01T08:00:00Z')], new Set(), W, T)).toBeNull();
});
test('does NOT link an arrival BEFORE the withdrawal', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T05:00:00Z'), [arr('a', 0.5, '2024-01-01T00:00:00Z')], new Set(), W, T)).toBeNull();
});
test('picks the CLOSEST of two valid candidates', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T00:00:00Z'), [arr('far', 0.5, '2024-01-01T05:00:00Z'), arr('near', 0.5, '2024-01-01T00:30:00Z')], new Set(), W, T)?.source_id).toBe('near');
});
test('does NOT link when amount is out of tolerance (a real sale, not a transfer)', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T00:00:00Z'), [arr('a', 0.6, '2024-01-01T01:00:00Z')], new Set(), W, T)).toBeNull();
});
test('skips an arrival already linked to another withdrawal', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T00:00:00Z'), [arr('a', 0.5, '2024-01-01T01:00:00Z')], new Set(['a']), W, T)).toBeNull();
});
test('allows a small network-fee difference within tolerance', () => {
	expect(selectArrivalMatch(0.5, ms('2024-01-01T00:00:00Z'), [arr('a', 0.498, '2024-01-01T01:00:00Z')], new Set(), W, T)?.source_id).toBe('a');
});
