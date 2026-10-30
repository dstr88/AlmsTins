/**
 * ledgerAdapters/shared.ts: what both engines' adapters hand back beside their events.
 */

/** Fiat is never a capital asset here: it takes no part in transfers and never opens a lot of its own kind. */
export const FIAT_SYMBOLS: ReadonlySet<string> = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD']);

/** What the row behind an event was, found by the event's sourceRef. */
export interface RefInfo {
	sourceType: string;
	/** The id of the import or on-chain row ('' for a Sui or custom entry). */
	sourceId: string;
	groupId: string;
	txHash: string | null;
	/** The engine's own class or category for the row. */
	transactionClass: string;
	/** The row's quantity, in whole units. */
	amount: number;
	/** The row's USD value, null when unknown. */
	valueUsd: number | null;
}
