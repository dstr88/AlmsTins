/**
 * Tests for selectLotIndex — the pure lot-selection function used by
 * buildAnnualBreakdown to decide which open lot to consume on each disposal.
 *
 * These tests are critical because the wrong selection method silently shifts
 * gains/losses between tax years and between short-term / long-term buckets.
 * A FIFO → LIFO mixup on a rising-price asset, for example, would cause a
 * dramatically different Schedule D.
 */

import { describe, it, expect } from 'vitest';
import { selectLotIndex, type SelectableLot } from '../../src/lib/yearEnd/lotSelection';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function lot(amount: number, timestamp: string, costUsd: number | null): SelectableLot {
	return { amount, timestamp, costUsd };
}

// A set of four lots that usefully exercises every method:
//   idx 0 — oldest, cheapest   (FIFO picks this; HIFO picks idx 2)
//   idx 1 — second oldest, mid-cost
//   idx 2 — third oldest, most expensive
//   idx 3 — newest, mid-cost   (LIFO picks this)
const LOTS: SelectableLot[] = [
	lot(1, '2022-01-01T00:00:00Z', 100),   // idx 0: oldest, cost $100
	lot(1, '2022-06-01T00:00:00Z', 300),   // idx 1: mid,    cost $300
	lot(1, '2023-01-01T00:00:00Z', 500),   // idx 2: newer,  cost $500
	lot(1, '2023-06-01T00:00:00Z', 200),   // idx 3: newest, cost $200
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. FIFO
// ─────────────────────────────────────────────────────────────────────────────

describe('FIFO', () => {
	it('always returns index 0', () => {
		expect(selectLotIndex(LOTS, 'fifo')).toBe(0);
	});

	it('returns 0 for a single-lot list', () => {
		expect(selectLotIndex([lot(1, '2024-01-01T00:00:00Z', 1_000)], 'fifo')).toBe(0);
	});

	it('returns 0 for an empty list', () => {
		// No lots — index 0 is the conventional "nothing to select" sentinel
		expect(selectLotIndex([], 'fifo')).toBe(0);
	});

	it('returns 0 regardless of cost ordering', () => {
		const reverseLots = [...LOTS].reverse();
		expect(selectLotIndex(reverseLots, 'fifo')).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LIFO
// ─────────────────────────────────────────────────────────────────────────────

describe('LIFO', () => {
	it('returns the last index', () => {
		expect(selectLotIndex(LOTS, 'lifo')).toBe(LOTS.length - 1);
	});

	it('returns 0 for a single-lot list', () => {
		expect(selectLotIndex([lot(1, '2024-01-01T00:00:00Z', 100)], 'lifo')).toBe(0);
	});

	it('returns last index regardless of cost', () => {
		const twoLots = [
			lot(2, '2022-01-01T00:00:00Z', 9_999), // high cost, but first
			lot(1, '2024-01-01T00:00:00Z', 1),     // low cost, but last
		];
		expect(selectLotIndex(twoLots, 'lifo')).toBe(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HIFO
// ─────────────────────────────────────────────────────────────────────────────

describe('HIFO', () => {
	it('returns the index with the highest cost-per-unit', () => {
		// idx 2 has costUsd=500 and amount=1 → cpu=500, highest
		expect(selectLotIndex(LOTS, 'hifo')).toBe(2);
	});

	it('uses cost-per-unit, not raw cost (larger amount reduces cpu)', () => {
		const lots: SelectableLot[] = [
			lot(10, '2022-01-01T00:00:00Z', 5_000), // cpu = 500
			lot(1,  '2022-06-01T00:00:00Z', 600),   // cpu = 600 ← highest
		];
		expect(selectLotIndex(lots, 'hifo')).toBe(1);
	});

	it('treats null costUsd as 0 and never picks it over a priced lot', () => {
		const lots: SelectableLot[] = [
			lot(1, '2022-01-01T00:00:00Z', null),   // cpu treated as 0
			lot(1, '2022-06-01T00:00:00Z', 1),      // cpu = 1
		];
		expect(selectLotIndex(lots, 'hifo')).toBe(1);
	});

	it('treats zero-amount lot as cpu=0 and never picks it over a priced lot', () => {
		const lots: SelectableLot[] = [
			lot(0, '2022-01-01T00:00:00Z', 999),    // amount=0 → cpu=0
			lot(1, '2022-06-01T00:00:00Z', 100),    // cpu=100 ← wins
		];
		expect(selectLotIndex(lots, 'hifo')).toBe(1);
	});

	it('returns 0 when all lots have null costUsd (tie — first wins)', () => {
		const lots: SelectableLot[] = [
			lot(1, '2022-01-01T00:00:00Z', null),
			lot(1, '2022-06-01T00:00:00Z', null),
		];
		expect(selectLotIndex(lots, 'hifo')).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SPEC ID — pinned lot selection
// ─────────────────────────────────────────────────────────────────────────────

describe('Spec ID', () => {
	it('selects the pinned lot by acquiredAt timestamp', () => {
		const pins = new Map([
			['disposal-A', { acquiredAt: '2022-06-01T00:00:00Z', amountHint: 1 }],
		]);
		// idx 1 has timestamp '2022-06-01T00:00:00Z'
		expect(selectLotIndex(LOTS, 'spec_id', 'disposal-A', pins)).toBe(1);
	});

	it('selects by closest amount when multiple lots share the same timestamp', () => {
		const lots: SelectableLot[] = [
			lot(0.5, '2023-01-01T00:00:00Z', 250),  // same ts, amount 0.5
			lot(1.0, '2023-01-01T00:00:00Z', 500),  // same ts, amount 1.0 ← closer to hint 1
			lot(2.0, '2023-01-01T00:00:00Z', 1_000),
		];
		const pins = new Map([
			['disposal-B', { acquiredAt: '2023-01-01T00:00:00Z', amountHint: 1.0 }],
		]);
		expect(selectLotIndex(lots, 'spec_id', 'disposal-B', pins)).toBe(1);
	});

	it('falls back to FIFO (index 0) when disposalSourceId has no pin', () => {
		const pins = new Map<string, { acquiredAt: string; amountHint: number }>();
		expect(selectLotIndex(LOTS, 'spec_id', 'disposal-C', pins)).toBe(0);
	});

	it('falls back to FIFO when acquiredAt matches no lot', () => {
		const pins = new Map([
			['disposal-D', { acquiredAt: '1999-01-01T00:00:00Z', amountHint: 1 }],
		]);
		expect(selectLotIndex(LOTS, 'spec_id', 'disposal-D', pins)).toBe(0);
	});

	it('falls back to FIFO when no disposalSourceId is provided', () => {
		const pins = new Map([
			['disposal-E', { acquiredAt: '2022-01-01T00:00:00Z', amountHint: 1 }],
		]);
		// No disposalSourceId passed — cannot look up the pin
		expect(selectLotIndex(LOTS, 'spec_id', undefined, pins)).toBe(0);
	});

	it('falls back to FIFO when no lotPins map is provided', () => {
		expect(selectLotIndex(LOTS, 'spec_id', 'disposal-F', undefined)).toBe(0);
	});

	it('falls back to FIFO when both disposalSourceId and lotPins are absent', () => {
		expect(selectLotIndex(LOTS, 'spec_id')).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SINGLE-LOT EDGE CASE
// ─────────────────────────────────────────────────────────────────────────────

describe('Single-lot list short-circuit', () => {
	const single = [lot(5, '2024-01-01T00:00:00Z', 10_000)];

	it('returns 0 for fifo with one lot', ()  => expect(selectLotIndex(single, 'fifo')).toBe(0));
	it('returns 0 for lifo with one lot', ()  => expect(selectLotIndex(single, 'lifo')).toBe(0));
	it('returns 0 for hifo with one lot', ()  => expect(selectLotIndex(single, 'hifo')).toBe(0));
	it('returns 0 for spec_id with one lot', () => expect(selectLotIndex(single, 'spec_id')).toBe(0));
});
