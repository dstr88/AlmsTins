// ─────────────────────────────────────────────────────────────────────────────
// Pass 5 — Review queue builder
//
// Collects all items that the user needs to look at:
//   • Still 'unknown' after all passes
//   • Missing USD price on taxable events
//   • Low confidence classifications (< 0.7)
//
// Items already added by passes 2 and 3 are deduplicated.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClassificationResult, ReviewItem, RawImportTx, RawOnchainTx } from './types';

export function buildReviewQueue(
	importRows: RawImportTx[],
	onchainRows: RawOnchainTx[],
	classifications: Map<string, ClassificationResult>,
	existingReviewKeys: Set<string>, // "sourceType:sourceId:reason" already queued
): ReviewItem[] {
	const items: ReviewItem[] = [];
	const taxableCategories = new Set(['sell', 'swap', 'liquidation', 'burn', 'lost', 'nft-sale', 'income', 'airdrop']);

	const alreadyQueued = (sourceType: string, sourceId: string, reason: string) =>
		existingReviewKeys.has(`${sourceType}:${sourceId}:${reason}`);

	// ── Import transactions ──────────────────────────────────────────────────

	for (const row of importRows) {
		const key = `import:${row.id}`;
		const cls = classifications.get(key);

		// Still unknown
		if (!cls || cls.category === 'unknown') {
			if (!alreadyQueued('import', row.id, 'unknown_type')) {
				items.push({
					sourceType: 'import',
					sourceId: row.id,
					reason: 'unknown_type',
					reasonDetail: `Transaction on ${row.timestamp_utc.slice(0, 10)} of type "${row.kind ?? '(none)'}" could not be automatically classified. Please select the correct category below.`,
					snapshotJson: JSON.stringify({
						symbol: row.asset_symbol,
						kind: row.kind,
						direction: row.direction,
						amount: row.amount,
						usd: row.native_usd,
						timestamp: row.timestamp_utc,
					}),
				});
			}
			continue;
		}

		// Low confidence
		if (cls.confidence < 0.7 && !alreadyQueued('import', row.id, 'low_confidence')) {
			items.push({
				sourceType: 'import',
				sourceId: row.id,
				reason: 'low_confidence',
				reasonDetail: `Auto-classified as "${cls.category}" with ${Math.round(cls.confidence * 100)}% confidence. Please confirm or correct.`,
				snapshotJson: JSON.stringify({
					symbol: row.asset_symbol,
					kind: row.kind,
					direction: row.direction,
					amount: row.amount,
					usd: row.native_usd,
					timestamp: row.timestamp_utc,
					autoCategory: cls.category,
				}),
			});
		}

		// Missing price on taxable disposal event
		if (taxableCategories.has(cls.category) && !row.native_usd && !alreadyQueued('import', row.id, 'missing_price')) {
			items.push({
				sourceType: 'import',
				sourceId: row.id,
				reason: 'missing_price',
				reasonDetail: `${cls.category} of ${row.asset_symbol ?? 'tokens'} on ${row.timestamp_utc.slice(0, 10)} has no USD value. Enter the price per token on that date to calculate gain/loss.`,
				snapshotJson: JSON.stringify({
					symbol: row.asset_symbol,
					amount: row.amount,
					timestamp: row.timestamp_utc,
					category: cls.category,
				}),
			});
		}

		// Missing cost basis on acquisition event (buy, income, airdrop, transfer-in,
		// loan-proceeds).  These silently produce a null-basis lot in pass4 and only
		// surface on the Form 8949 as a "—" column — flag them here so the user can
		// enter the price before tax time rather than discovering it filing day.
		const acquisitionCategories = new Set(['buy', 'income', 'airdrop', 'transfer', 'loan-proceeds']);
		if (
			acquisitionCategories.has(cls.category)
			&& row.direction === 'in'
			&& !row.native_usd
			&& !alreadyQueued('import', row.id, 'missing_cost_basis')
		) {
			items.push({
				sourceType: 'import',
				sourceId: row.id,
				reason: 'missing_cost_basis',
				reasonDetail: `${cls.category} of ${row.asset_symbol ?? 'tokens'} on ${row.timestamp_utc.slice(0, 10)} has no USD value. Without a cost basis this lot will show as "$0" on Form 8949 — enter the fair market value per token on the acquisition date.`,
				snapshotJson: JSON.stringify({
					symbol: row.asset_symbol,
					amount: row.amount,
					timestamp: row.timestamp_utc,
					category: cls.category,
				}),
			});
		}
	}

	// ── On-chain transactions ────────────────────────────────────────────────

	for (const row of onchainRows) {
		const key = `onchain:${row.id}`;
		const cls = classifications.get(key);

		if (!cls || cls.category === 'unknown') {
			if (!alreadyQueued('onchain', row.id, 'unknown_type')) {
				items.push({
					sourceType: 'onchain',
					sourceId: row.id,
					reason: 'unknown_type',
					reasonDetail: `On-chain transaction on ${row.timestamp.slice(0, 10)} of ${row.token_symbol ?? 'ETH'} could not be automatically classified.`,
					snapshotJson: JSON.stringify({
						symbol: row.token_symbol,
						value: row.value,
						from: row.from_address,
						to: row.to_address,
						timestamp: row.timestamp,
						chain: row.chain,
					}),
				});
			}
			continue;
		}

		if (taxableCategories.has(cls.category) && !row.usd_value && !alreadyQueued('onchain', row.id, 'missing_price')) {
			items.push({
				sourceType: 'onchain',
				sourceId: row.id,
				reason: 'missing_price',
				reasonDetail: `${cls.category} of ${row.token_symbol ?? 'tokens'} on ${row.timestamp.slice(0, 10)} has no USD value recorded. Enter the price per token to calculate gain/loss.`,
				snapshotJson: JSON.stringify({
					symbol: row.token_symbol,
					value: row.value,
					timestamp: row.timestamp,
					category: cls.category,
				}),
			});
		}
	}

	return items;
}
