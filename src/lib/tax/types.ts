// ─────────────────────────────────────────────────────────────────────────────
// Tax pipeline shared types
// ─────────────────────────────────────────────────────────────────────────────

export type TaxCategory =
	| 'buy'
	| 'sell'
	| 'swap'
	| 'transfer'
	| 'income'
	| 'airdrop'
	| 'burn'
	| 'lost'
	| 'loan-proceeds'
	| 'loan-repayment'
	| 'collateral-deposit'
	| 'liquidation'
	| 'fee'
	| 'nft-sale'
	| 'loan-interest-paid'
	| 'unknown';

export type SourceType = 'import' | 'onchain';

export type ReviewReason =
	| 'unmatched_transfer'
	| 'missing_price'
	| 'possible_loan'
	| 'low_confidence'
	| 'unknown_type'
	| 'airdrop_unpriced';

// ── Raw rows from DB ──────────────────────────────────────────────────────────

export type RawImportTx = {
	id: string;
	timestamp_utc: string;
	asset_symbol: string | null;
	direction: string | null;
	kind: string | null;
	amount: number | null;
	to_amount: number | null;
	native_usd: number | null;
	tx_hash: string | null;
	source: string;
	notes: string | null;
	category: string | null;
};

export type RawOnchainTx = {
	id: string;
	timestamp: string;
	token_symbol: string | null;
	value: string | null;
	from_address: string | null;
	to_address: string | null;
	tx_type: string | null;
	usd_value: number | null;
	chain: string;
	wallet_address?: string;
};

// ── Classification result produced by each pass ───────────────────────────────

export type ClassificationResult = {
	sourceType: SourceType;
	sourceId: string;
	category: TaxCategory;
	subCategory?: string;
	confidence: number;
	linkedTxId?: string;
	linkedSourceType?: SourceType;
	assetSymbol?: string | null;
	amountUsd?: number | null;
	taxYear?: number | null;
};

// ── Review item produced by pass 5 ───────────────────────────────────────────

export type ReviewItem = {
	sourceType: SourceType;
	sourceId: string;
	reason: ReviewReason;
	reasonDetail: string;
	snapshotJson: string;
};

// ── FIFO lot ──────────────────────────────────────────────────────────────────

export type TaxLot = {
	id: string;
	assetSymbol: string;
	acquiredAt: string;
	quantity: number;
	remainingQty: number;
	costBasisUsd: number | null;
	pricePerUnit: number | null;
	sourceType: SourceType;
	sourceId: string;
	lotType: 'purchase' | 'income' | 'airdrop' | 'transfer';
	originLotId?: string | null;
};

// ── Tax disposal ──────────────────────────────────────────────────────────────

export type TaxDisposal = {
	id: string;
	assetSymbol: string;
	disposedAt: string;
	quantity: number;
	proceedsUsd: number | null;
	costBasisUsd: number | null;
	gainLossUsd: number | null;
	isShortTerm: boolean;
	category: TaxCategory;
	sourceType: SourceType;
	sourceId: string;
	lotId: string;
	notes?: string | null;
};

// ── Pipeline run stats ────────────────────────────────────────────────────────

export type PipelineStats = {
	pass1Easy: number;
	pass2Transfers: number;
	pass2bLoans: number;
	pass3Income: number;
	pass3bInterest: number;
	pass4Lots: number;
	pass4Disposals: number;
	pass5ReviewItems: number;
	totalClassified: number;
	totalUnknown: number;
};
