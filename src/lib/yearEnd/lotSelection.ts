/**
 * lotSelection.ts
 *
 * Pure lot-selection logic used by buildAnnualBreakdown.
 * Extracted into its own module so it can be unit-tested without a DB connection.
 *
 * Given the current open-lot list for an asset and the active cost-basis method,
 * returns the index of the lot that should be consumed next.
 */

export type CostBasisMethod = 'fifo' | 'hifo' | 'lifo' | 'spec_id';

export type SelectableLot = {
	amount: number;
	timestamp: string;
	costUsd: number | null;
};

/**
 * Returns the index into `list` of the next lot to consume under `method`.
 *
 * @param list             Open lots for the asset (already in FIFO/insertion order).
 * @param method           Cost-basis accounting method.
 * @param disposalSourceId Source ID of the disposal (used for Spec ID pin lookup).
 * @param lotPins          User-pinned lot assignments keyed by disposalSourceId.
 */
export function selectLotIndex(
	list: SelectableLot[],
	method: CostBasisMethod,
	disposalSourceId?: string,
	lotPins?: Map<string, { acquiredAt: string; amountHint: number }>,
): number {
	if (list.length <= 1) return 0;

	// ── Specific ID ─────────────────────────────────────────────────────────
	if (method === 'spec_id' && disposalSourceId && lotPins) {
		const pin = lotPins.get(disposalSourceId);
		if (pin) {
			let bestIdx = -1;
			let bestDiff = Infinity;
			for (let i = 0; i < list.length; i++) {
				if (list[i].timestamp === pin.acquiredAt) {
					const diff = Math.abs(list[i].amount - pin.amountHint);
					if (diff < bestDiff) {
						bestDiff = diff;
						bestIdx = i;
					}
				}
			}
			if (bestIdx >= 0) return bestIdx;
		}
		// No pin found — fall through to FIFO
	}

	if (method === 'fifo' || method === 'spec_id') return 0;

	if (method === 'lifo') return list.length - 1;

	// ── HIFO: highest cost-per-unit ─────────────────────────────────────────
	let bestIdx = 0;
	let bestCpu = -Infinity;
	for (let i = 0; i < list.length; i++) {
		const cpu =
			list[i].costUsd != null && list[i].amount > 0
				? list[i].costUsd! / list[i].amount
				: 0;
		if (cpu > bestCpu) {
			bestCpu = cpu;
			bestIdx = i;
		}
	}
	return bestIdx;
}
