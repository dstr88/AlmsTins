/**
 * lotIdentificationState.ts: what the identifications page, its API and the add-wallet prompt show,
 * assembled in one place so they cannot disagree. Read-only.
 */

import { loadConfirmedIds, loadIdentifications } from './lotIdentificationStore';
import { loadStamps, type StampRow, type StampStatus } from './lotIdentificationStamp';
import { loadWalletGroups, undecidedGroups, type WalletGroup } from './lotIdentificationWallets';
import { exchangeStatusOf, type ExchangeStatus, type IdentificationMethod, type LotIdentification } from './tax/lotIdentification';

export interface EntryView extends LotIdentification {
	exchangeStatus: ExchangeStatus;
	/** The batch's Bitcoin timestamp, as far as it has got. */
	stampStatus: StampStatus;
	blockHeight: number | null;
	blockTime: string | null;
}

export interface GroupView extends WalletGroup {
	undecided: boolean;
}

export interface IdentificationState {
	groups: GroupView[];
	entries: EntryView[];
	undecidedCount: number;
	/** The method of the newest Apply to all, the choice the add-wallet prompt offers to reuse. */
	applyAllMethod: IdentificationMethod | null;
}

/** The newest entry's stamp, exchange status and the like, joined onto each entry. Pure. */
export function buildState(
	groups: readonly WalletGroup[],
	entries: readonly LotIdentification[],
	stamps: ReadonlyMap<string, StampRow>,
	confirmed: ReadonlySet<string>,
): IdentificationState {
	const undecided = new Set(undecidedGroups(groups, entries).map((g) => g.id));
	return {
		groups: groups.map((g) => ({ ...g, undecided: undecided.has(g.id) })),
		entries: entries.map((e) => {
			const stamp = stamps.get(e.batchId);
			return {
				...e,
				exchangeStatus: exchangeStatusOf(e.walletKey, confirmed, e.id),
				stampStatus: stamp?.status ?? 'unstamped',
				blockHeight: stamp?.blockHeight ?? null,
				blockTime: stamp?.blockTime ?? null,
			};
		}),
		undecidedCount: undecided.size,
		applyAllMethod: [...entries].reverse().find((e) => e.source === 'apply_all')?.method ?? null,
	};
}

export async function loadIdentificationState(tenantId: string): Promise<IdentificationState> {
	const [groups, entries, stamps, confirmed] = await Promise.all([
		loadWalletGroups(tenantId),
		loadIdentifications(tenantId),
		loadStamps(tenantId),
		loadConfirmedIds(tenantId),
	]);
	return buildState(groups, entries, stamps, confirmed);
}
