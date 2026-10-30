/**
 * lotLedger.ts: the one place lot rules live. Pure: no database, no clock, no I/O.
 *
 * Both gain engines turn their rows into LedgerEvents (acquire, dispose, move, sendUnmatched) and
 * run them through runLotLedger. Classification is the only thing allowed to differ between them;
 * lots, moves, pools, terms and findings are decided here.
 *
 * Time. Every event is processed in order of its parsed instant (stored times come in two
 * spellings, see normalize.parseInstant), then kind (acquire, move out, move in, dispose), then
 * sourceRef, then id, so the result never depends on the order the events were passed. All dates
 * are UTC calendar dates: the holding period (yearEnd/holdingPeriod.ts), the year a sale falls in,
 * and the January 1, 2025 boundary.
 *
 * Pools. Before `perWalletFrom` (2025-01-01) there is one pool per asset, whichever wallet a lot
 * or a sale sits in, and a move changes no lot: it only moves units between the wallets of a
 * quantity ledger kept alongside. At the boundary the leftover lots are allocated to the wallets
 * that actually hold the units (Run.reconstruct below). From then on there is one pool per asset
 * and wallet, ordered by original acquisition time, and a sale selects (FIFO, HIFO, LIFO or Spec
 * ID, as the method says) inside its own wallet's pool. A tenant with no `perWalletFrom` keeps the
 * single pool for every year.
 *
 * Moves. A move is two-phase: the units leave at outAt and land at max(inAt, outAt). After the
 * boundary the leaving units are the source wallet's oldest lots (first in, first out, whatever
 * the method), cut into slices; the slices that arrive keep their original date and cost and name
 * the lot they came from (originLotId). Units that left but did not arrive (a fee) are carved from
 * the last slices and reported, not booked. Units that arrived beyond what left, and units the
 * source had no lots for, arrive with missing basis, and say so. Nothing is ever booked as a sale
 * by a move. Moves that touch one wallet at the same instant run every departure before any landing
 * (the order above), so a second hop that leaves a wallet at the instant the first lands in it finds
 * the wallet empty: its units arrive without a lot behind them and a source shortfall is raised for
 * review. A hop stamped before the landing it depends on is the same case.
 *
 * Nothing is dropped. A sale the pool cannot cover records the rest as unmatched, with its share
 * of the proceeds. An event the ledger cannot read becomes a finding that carries its quantity and
 * amount. Quantities of 1e-10 or less are dust: no lot, no slice, no unmatched row. Float noise grows
 * with the size of the numbers, so for a position of millions of units dust is one part in 1e12 of
 * the quantities involved instead (`tol`).
 *
 * Findings are review items, not figures. They carry no prose: the surfaces word them.
 *
 * For adapters. Give each event an `id` that is unique in the run and a `sourceRef` that names the
 * row it came from (findings, unmatched rows and Spec ID pins refer to it). Give `asset` as
 * normalizeAsset gives it, `wallet` as walletKey.ts gives it (blank means 'unresolved'), times as
 * stored (ISO, or "YYYY-MM-DD HH:MM:SS" meaning UTC), quantities in whole units and absolute, and
 * costs and proceeds as totals in USD, null when unknown. A transfer the resolver
 * (transferLinks.ts) paired is one `move`. An out it left unpaired is a `sendUnmatched` when the
 * source called it a transfer and a taxable `dispose` when it did not; an in it left unpaired is
 * an `acquire` with origin 'transfer_in_untracked'.
 */

import { selectLotIndex, type CostBasisMethod, type SelectableLot } from '../yearEnd/lotSelection';
import { isLongTermHold } from '../yearEnd/holdingPeriod';
import { normalizeAsset, parseInstant } from './normalize';

export type { CostBasisMethod };

/** Part of the cache key for a computed ledger: change it whenever a rule here changes results. */
export const ENGINE_VERSION = 'lot-ledger-1';
/**
 * Quantities at or below this are dust, everywhere. Float noise grows with the size of the numbers a
 * quantity was worked out from (a million units carries noise of about 1e-10), so for big quantities
 * dust is one part in 1e12 of the biggest quantity involved instead (see `tol`).
 */
export const EPSILON = 1e-10;
/** The pool for events with no resolvable wallet: demo seeds, fixtures, rows with no wallet. */
export const UNRESOLVED_WALLET = 'unresolved';
/** Where snapshots count units that have left a wallet and not yet landed. An event's wallet of this name is read as 'unresolved'. */
export const TRANSIT_WALLET = 'transit';
/**
 * Where January 1 puts basis the wallets' units could not take. Nothing can be sold from it, and it
 * stays in every later snapshot: filter it when counting what is held. An event's wallet of this
 * name is read as 'unresolved'.
 */
export const UNALLOCATED_WALLET = 'unallocated';

// ── Events ───────────────────────────────────────────────────────────────────

export type AcquireOrigin = 'purchase' | 'income' | 'airdrop' | 'swap_in' | 'loan_proceeds' | 'transfer_in_untracked' | 'other';
/** What a lot came from: an acquire's origin, or one the ledger itself makes. */
export type LotOrigin = AcquireOrigin | 'transfer_surplus' | 'jan1_placeholder';
export type BasisSource = 'recorded' | 'estimated' | 'manual' | 'missing';
export type Term = 'short' | 'long';
/** How a move was linked: by transaction hash, confirmed by the owner, or guessed. */
export type MoveLink = 'hash' | 'confirmed' | 'heuristic';

/** A basis the owner entered for one sale: it wins over the lots matched to it. */
export interface ManualBasis {
	pricePerToken: number;
	/** Where the holding period starts. Empty: the sale date, so short-term. */
	buyDateIso: string;
	notes?: string | null;
}

/** Coins arrive: a purchase, income, an airdrop, the received leg of a swap, loan proceeds, or an arrival from a source that is not tracked. */
export interface AcquireEvent {
	kind: 'acquire';
	id: string;
	asset: string;
	wallet: string;
	at: string;
	qty: number;
	/** Total cost, not per unit. Null: unknown, so the lot has missing basis. */
	costUsd: number | null;
	origin: AcquireOrigin;
	sourceRef: string;
}

/** Coins leave: a sale, the sent leg of a swap, a burn, a loss, or (taxable false) a deposit as collateral or a repayment. */
export interface DisposeEvent {
	kind: 'dispose';
	id: string;
	asset: string;
	wallet: string;
	at: string;
	qty: number;
	/** Total proceeds, not per unit. Null: unknown. */
	proceedsUsd: number | null;
	taxable: boolean;
	category: string;
	sourceRef: string;
	manualBasis?: ManualBasis;
}

/** Coins move between wallets or accounts of the same asset: not a sale. */
export interface MoveEvent {
	kind: 'move';
	id: string;
	asset: string;
	fromWallet: string;
	toWallet: string;
	outAt: string;
	inAt: string;
	qtyOut: number;
	qtyIn: number;
	link: MoveLink;
	/** The two wallets have different owner labels. */
	ownersDiffer: boolean;
	outRef: string;
	inRef: string;
	/** Carried only so the ledger can say it was ignored: a move has no basis to book. */
	manualBasis?: ManualBasis;
}

/** An explicit send nothing was found for: the coins leave, nothing is sold, the owner is told. */
export interface SendUnmatchedEvent {
	kind: 'sendUnmatched';
	/** Defaults to sourceRef. */
	id?: string;
	asset: string;
	wallet: string;
	at: string;
	qty: number;
	valueUsd: number | null;
	sourceRef: string;
}

export type LedgerEvent = AcquireEvent | DisposeEvent | MoveEvent | SendUnmatchedEvent;

// ── Options ──────────────────────────────────────────────────────────────────

/** One row of an allocation the owner recorded: units of one unused lot, placed in one wallet. */
export interface AllocationOverrideRow {
	wallet: string;
	/** The unused lot, by its acquisition time (any spelling parseInstant reads). */
	acquiredAt: string;
	qty: number;
	/** The basis for these units, as a check: it must match the lot's own basis for them. Null: no check. */
	costUsd?: number | null;
}

/**
 * The owner's own January 1 allocation for one asset. It replaces the reconstruction, all or nothing.
 * It must place exactly the units each wallet held, drawing only on lots left at the end of 2024.
 * When those lots cover fewer units than the wallets held, it must place all of them, and what
 * a wallet holds beyond its rows is a placeholder with missing basis (a finding says so).
 */
export interface AllocationOverride {
	asset: string;
	rows: readonly AllocationOverrideRow[];
}

export interface LedgerOptions {
	/**
	 * The UTC date (YYYY-MM-DD) from which each wallet has its own pool, and so the January 1
	 * reconstruction happens at its start. Null or omitted: one pool for every year.
	 */
	perWalletFrom?: string | null;
	/** Applies to sales, inside the single pool before the boundary and inside a wallet's pool after. Default 'fifo'. */
	method?: CostBasisMethod;
	/** Spec ID pins by sale (a dispose's sourceRef). */
	lotPins?: Map<string, { acquiredAt: string; amountHint: number }>;
	/** At most one per asset: two for one asset are both refused. */
	allocationOverrides?: readonly AllocationOverride[];
	/** Instants to report the open lots at. A snapshot holds the state after every event at or before it. */
	snapshotsAt?: readonly string[];
}

// ── Results ──────────────────────────────────────────────────────────────────

/** How a lot got its wallet at the January 1 boundary. */
export interface LotAllocation {
	/**
	 * origin: placed in the wallet it was acquired in. fill: placed in another wallet that held the
	 * units. override: the owner's allocation. placeholder: units with no basis. unallocated: basis
	 * with no units to take it.
	 */
	pass: 'origin' | 'fill' | 'override' | 'placeholder' | 'unallocated';
	/** The wallet the lot sat in before the boundary, when it differs. */
	fromWallet: string | null;
}

export interface LedgerLot {
	id: string;
	asset: string;
	/** The wallet that holds it. Before the boundary, the wallet it was acquired in. */
	wallet: string;
	/** The original acquisition time, as the event gave it. A moved lot keeps it. */
	acquiredAt: string;
	/** Units this record started with. */
	qty: number;
	remainingQty: number;
	/** Cost of those units; null when unknown. */
	costUsd: number | null;
	remainingCostUsd: number | null;
	basisSource: BasisSource;
	origin: LotOrigin;
	/** The lot this one was cut from by a move or by the January 1 allocation. */
	originLotId: string | null;
	sourceRef: string;
	allocation?: LotAllocation;
}

export interface LedgerSlice {
	id: string;
	/** The lot the units came from; null for units no lot backs (a sale with an entered basis the lots could not cover). */
	lotId: string | null;
	asset: string;
	/** The wallet it was sold from. */
	wallet: string;
	acquiredAt: string;
	disposedAt: string;
	qty: number;
	/** Null when the basis is unknown. */
	cost: number | null;
	proceeds: number | null;
	gain: number | null;
	term: Term;
	/** False for the units a collateral deposit, a repayment or an unmatched send consumed. */
	taxable: boolean;
	basisSource: BasisSource;
	originNote: string;
	category: string;
	sourceRef: string;
}

/** The part of a sale no lot covered. */
export interface LedgerUnmatched {
	asset: string;
	wallet: string;
	at: string;
	qty: number;
	/** How much of `qty` was units a January 1 placeholder stood for (the rest: no lot at all). */
	placeholderQty: number;
	proceeds: number | null;
	taxable: boolean;
	category: string;
	sourceRef: string;
}

/** Every reason a finding can have: the surfaces that show findings (labels, ordering) need one entry for each. */
export const FINDING_REASONS = [
	'transfer_fee_units',
	'transfer_amount_mismatch',
	'transfer_source_shortfall',
	'transfer_link_unconfirmed',
	'transfer_between_owners',
	'unmatched_transfer',
	'estimated_transfer_basis',
	'manual_basis_on_transfer',
	'jan1_position_gap',
	'allocation_override_rejected',
	'unreadable_event_date',
	'invalid_event',
] as const;

export type FindingReason = (typeof FINDING_REASONS)[number];

export interface LedgerFinding {
	reason: FindingReason;
	asset: string;
	/** The wallet it is about: the sender of a transfer, else the event's wallet. */
	wallet: string | null;
	/** The receiving wallet, for a transfer. */
	toWallet: string | null;
	/** The event's own time, as given. */
	at: string | null;
	qty: number | null;
	costUsd: number | null;
	valueUsd: number | null;
	/** The original acquisition time of the units concerned, when known. */
	acquiredAt: string | null;
	/** The sourceRefs of the rows involved. */
	refs: string[];
	/** A code that refines the reason (it never holds user text). */
	detail: string | null;
}

export interface SnapshotLot {
	lotId: string;
	asset: string;
	/** TRANSIT_WALLET for units between wallets. */
	wallet: string;
	acquiredAt: string;
	/** What is left of it at the snapshot. */
	qty: number;
	costUsd: number | null;
	basisSource: BasisSource;
	origin: LotOrigin;
	originLotId: string | null;
}

export interface LedgerSnapshot {
	/** The instant asked for, as given. */
	at: string;
	/** Includes UNALLOCATED_WALLET lots after January 1 (basis with no units behind it). */
	lots: SnapshotLot[];
}

export interface Jan1Lot {
	/** The lot that holds these units in the wallet. */
	lotId: string;
	/** The pooled lot they were split from; null for a placeholder. */
	fromLotId: string | null;
	acquiredAt: string;
	qty: number;
	costUsd: number | null;
	basisSource: BasisSource;
	pass: LotAllocation['pass'];
}

export interface Jan1Position {
	wallet: string;
	/** Units the wallet held at the end of December 31 (UNALLOCATED_WALLET: units of unallocated basis). */
	units: number;
	/** Basis of its lots; null when none of them has a known basis. */
	costUsd: number | null;
	lots: Jan1Lot[];
}

export interface Jan1UnusedLot {
	lotId: string;
	wallet: string;
	acquiredAt: string;
	qty: number;
	costUsd: number | null;
}

/** The January 1 positions of one asset, with where each came from. */
export interface Jan1Asset {
	asset: string;
	/** The boundary instant. */
	at: string;
	source: 'reconstruction' | 'override';
	/** An override was given for this asset and refused (a finding says why). */
	overrideRejected: boolean;
	positions: Jan1Position[];
	/** The pooled lots left at the boundary, before they were allocated. */
	unused: Jan1UnusedLot[];
}

export interface LedgerResult {
	engineVersion: string;
	/** Every lot ever made, by asset then acquisition time. */
	lots: LedgerLot[];
	/** In the order the sales happened. */
	slices: LedgerSlice[];
	unmatched: LedgerUnmatched[];
	findings: LedgerFinding[];
	jan1: Jan1Asset[];
	snapshots: LedgerSnapshot[];
}

// ── Internals ────────────────────────────────────────────────────────────────

interface Lot {
	id: string;
	asset: string;
	wallet: string;
	acquiredAt: string;
	acquiredMs: number;
	qty: number;
	remainingQty: number;
	costUsd: number | null;
	remainingCostUsd: number | null;
	basisSource: BasisSource;
	origin: LotOrigin;
	originLotId: string | null;
	sourceRef: string;
	/** Units the January 1 positions had no basis for: a sale of them is unmatched, not settled. */
	placeholder: boolean;
	allocation?: LotAllocation;
	/** Cut from another lot by a move (as opposed to a January 1 split). */
	moved: boolean;
}

/** Units taken out of a lot, with the cost that went with them. */
interface Piece {
	lot: Lot;
	qty: number;
	cost: number | null;
}

interface NManual {
	pricePerToken: number;
	buyDate: string;
	buyMs: number | null;
	notes: string | null;
}

interface NAcquire {
	kind: 'acquire';
	id: string;
	asset: string;
	wallet: string;
	at: string;
	ms: number;
	qty: number;
	costUsd: number | null;
	origin: AcquireOrigin;
	sourceRef: string;
}

interface NDispose {
	kind: 'dispose';
	id: string;
	asset: string;
	wallet: string;
	at: string;
	ms: number;
	qty: number;
	proceedsUsd: number | null;
	taxable: boolean;
	category: string;
	sourceRef: string;
	manual: NManual | null;
}

interface NMove {
	kind: 'move';
	id: string;
	asset: string;
	from: string;
	to: string;
	outAt: string;
	outMs: number;
	/** When the units land: the later of the two times. */
	landAt: string;
	landMs: number;
	qtyOut: number;
	qtyIn: number;
	link: MoveLink;
	ownersDiffer: boolean;
	outRef: string;
	inRef: string;
	hadManualBasis: boolean;
}

interface NSend {
	kind: 'send';
	id: string;
	asset: string;
	wallet: string;
	at: string;
	ms: number;
	qty: number;
	valueUsd: number | null;
	sourceRef: string;
}

/** A move between its two phases. */
interface MoveState {
	ev: NMove;
	/** The pool mode when the units left. */
	mode: 'universal' | 'wallet';
	/** Wallet mode: the slices taken from the source, in order, on their way. */
	taken: Piece[];
	/** Wallet mode: units the source had no lots for. */
	lack: number;
	/** Universal mode: the January 1 allocation already counted these units in the destination. */
	landedAtBoundary: boolean;
	/** Universal mode: a guess at the basis and date of the units a fee will take, made when they leave. */
	feeEstimate: { costUsd: number | null; acquiredAt: string | null } | null;
}

type OpType = 'acquire' | 'moveOut' | 'send' | 'moveIn' | 'dispose';

interface Op {
	type: OpType;
	ms: number;
	rank: number;
	sourceRef: string;
	id: string;
	canon: string;
	acquire?: NAcquire;
	dispose?: NDispose;
	send?: NSend;
	move?: MoveState;
}

// At equal times: coins arrive, then leave or move out, then land, then are sold.
const RANK: Record<OpType, number> = { acquire: 0, moveOut: 1, send: 1, moveIn: 2, dispose: 3 };

const ORIGINS: ReadonlySet<string> = new Set<AcquireOrigin>(['purchase', 'income', 'airdrop', 'swap_in', 'loan_proceeds', 'transfer_in_untracked', 'other']);
const LINKS: ReadonlySet<string> = new Set<MoveLink>(['hash', 'confirmed', 'heuristic']);

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isoOf = (ms: number): string => new Date(ms).toISOString();
const dateOf = (ms: number): string => isoOf(ms).slice(0, 10);
const text = (v: unknown): string => (v == null ? '' : String(v)).trim();
/** USD or null: anything that is not a finite, non-negative number is unknown. */
const money = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
/**
 * Quantities are rounded to 1e-12, two orders below dust, and dollar amounts to 1e-8, wherever
 * the ledger works one out, so sums of decimals carry no float noise (1.001 - 1 is 0.001, not
 * 0.00099999999999989). Adding 0 turns -0 into 0. Past 9000 units (9e7 dollars) a float cannot hold
 * that many decimals, so the number is left as it is and `tol` decides what counts as nothing.
 */
const q = (x: number): number => (Math.abs(x) >= 9000 ? x : Math.round(x * 1e12) / 1e12 + 0);
const usd = (x: number): number => (Math.abs(x) >= 9e7 ? x : Math.round(x * 1e8) / 1e8 + 0);
/** What counts as nothing next to quantities of these sizes: EPSILON, or 1e-12 of the biggest, whichever is more. */
const tol = (...sizes: number[]): number => {
	let big = 0;
	for (const x of sizes) if (Math.abs(x) > big) big = Math.abs(x);
	return Math.max(EPSILON, big * 1e-12);
};

function termOf(acquiredMs: number, disposedMs: number): Term {
	return isLongTermHold(isoOf(acquiredMs), isoOf(disposedMs)) ? 'long' : 'short';
}

/** A price per unit as plain text: no locale, no exponent for the sizes prices have. */
function priceText(v: number): string {
	const [whole, fraction = ''] = v.toFixed(v >= 1 ? 2 : 8).split('.');
	return `${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

type Qty = { ok: number } | 'dust' | 'invalid';
function cleanQty(v: unknown): Qty {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'invalid';
	return v <= EPSILON ? 'dust' : { ok: v };
}

/** Insert keeping a pool ordered by original acquisition time, then lot id. */
function insertSorted(pool: Lot[], lot: Lot): void {
	let lo = 0;
	let hi = pool.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const m = pool[mid];
		if (m.acquiredMs < lot.acquiredMs || (m.acquiredMs === lot.acquiredMs && m.id < lot.id)) lo = mid + 1;
		else hi = mid;
	}
	pool.splice(lo, 0, lot);
}

const cmpLot = (a: Lot, b: Lot): number => a.acquiredMs - b.acquiredMs || cmpStr(a.id, b.id);

function originNote(lot: Lot): string {
	const when = dateOf(lot.acquiredMs);
	let note: string;
	if (lot.basisSource === 'estimated') {
		note = `Arrived ${when} from a source Almstins does not track. Basis is the value on arrival (estimated) and the holding period starts on that date. Add the sending wallet or enter the original basis to replace it.`;
	} else if (lot.basisSource === 'missing') {
		note = `Acquired ${when}. No recorded cost basis: add one, or check where these coins came from.`;
	} else {
		note = `Acquired ${when} (recorded cost basis).`;
	}
	if (lot.moved) note += ' Moved between your own wallets with its original date and cost.';
	else if (lot.allocation?.pass === 'override') note += ' Placed in this wallet by the January 1, 2025 allocation you entered.';
	else if (lot.allocation && lot.allocation.pass !== 'origin') note += ' Placed in this wallet by the reconstructed January 1, 2025 positions.';
	return note;
}

function manualNote(m: NManual, asset: string): string {
	return m.notes ? `Basis you entered: ${m.notes}` : `Basis you entered: $${priceText(m.pricePerToken)} per ${asset}, acquired ${m.buyDate.slice(0, 10)}.`;
}

// ── The run ──────────────────────────────────────────────────────────────────

class Run {
	private readonly method: CostBasisMethod;
	private readonly pins: Map<string, { acquiredAt: string; amountHint: number }> | undefined;
	private readonly boundaryMs: number | null;
	private readonly boundaryIso: string | null;
	private readonly overrides = new Map<string, AllocationOverride>();
	private readonly duplicateOverrides = new Set<string>();

	private mode: 'universal' | 'wallet' = 'universal';
	private boundaryDone = false;

	private readonly allLots: Lot[] = [];
	private readonly lotIds = new Set<string>();
	private readonly sliceIds = new Set<string>();
	private readonly universal = new Map<string, Lot[]>();
	private readonly byWallet = new Map<string, Map<string, Lot[]>>();
	/** Units per asset and wallet, kept while pools are universal. */
	private readonly units = new Map<string, Map<string, number>>();
	/** The biggest quantity or balance each of those has been, which sets how much noise its balance can carry. */
	private readonly unitScales = new Map<string, Map<string, number>>();
	private readonly moveLog = new Map<string, { from: string; to: string; ms: number }[]>();
	private readonly inFlight = new Set<MoveState>();

	readonly slices: LedgerSlice[] = [];
	readonly unmatched: LedgerUnmatched[] = [];
	readonly findings: LedgerFinding[] = [];
	readonly jan1: Jan1Asset[] = [];
	readonly snapshots: LedgerSnapshot[] = [];

	constructor(opts: LedgerOptions) {
		this.method = opts.method ?? 'fifo';
		this.pins = opts.lotPins;
		if (opts.perWalletFrom == null) {
			this.boundaryMs = null;
			this.boundaryIso = null;
		} else {
			const ms = /^\d{4}-\d{2}-\d{2}$/.test(opts.perWalletFrom) ? Date.parse(`${opts.perWalletFrom}T00:00:00.000Z`) : Number.NaN;
			if (!Number.isFinite(ms) || dateOf(ms) !== opts.perWalletFrom) throw new RangeError(`perWalletFrom must be a UTC date (YYYY-MM-DD) or null, got ${opts.perWalletFrom}`);
			this.boundaryMs = ms;
			this.boundaryIso = isoOf(ms);
		}
		for (const o of opts.allocationOverrides ?? []) {
			const asset = normalizeAsset(text(o.asset));
			if (this.overrides.has(asset)) this.duplicateOverrides.add(asset);
			else this.overrides.set(asset, o);
		}
	}

	// ── Findings ──

	private find(f: Partial<LedgerFinding> & { reason: FindingReason }): void {
		this.findings.push({
			reason: f.reason,
			asset: f.asset ?? '',
			wallet: f.wallet ?? null,
			toWallet: f.toWallet ?? null,
			at: f.at ?? null,
			qty: f.qty ?? null,
			costUsd: f.costUsd ?? null,
			valueUsd: f.valueUsd ?? null,
			acquiredAt: f.acquiredAt ?? null,
			refs: f.refs ?? [],
			detail: f.detail ?? null,
		});
	}

	// ── Reading the events ──

	private buildOps(events: readonly LedgerEvent[]): Op[] {
		const ops: Op[] = [];
		// An event left out still says what it was: its quantity and amount ride on the finding, so nothing is lost from view.
		const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		const bad = (reason: 'invalid_event' | 'unreadable_event_date', event: object, detail: string, at?: unknown) => {
			const e = event as Record<string, unknown>;
			this.find({
				reason,
				asset: text(e.asset) ? normalizeAsset(text(e.asset)) : '',
				wallet: text(e.wallet ?? e.fromWallet) || null,
				toWallet: text(e.toWallet) || null,
				at: text(at ?? e.at ?? e.outAt) || null,
				qty: num(e.qty ?? e.qtyOut),
				costUsd: num(e.costUsd),
				valueUsd: num(e.proceedsUsd ?? e.valueUsd),
				refs: [text(e.sourceRef ?? e.outRef)].filter(Boolean),
				detail,
			});
		};
		// A name this ledger uses for its own pseudo-wallets cannot be a real wallet's: read it as no wallet.
		const wallet = (v: unknown) => {
			const w = text(v);
			return !w || w === UNALLOCATED_WALLET || w === TRANSIT_WALLET ? UNRESOLVED_WALLET : w;
		};

		for (const raw of events) {
			const kind: unknown = raw?.kind;
			if (kind === 'acquire') {
				const e = raw as AcquireEvent;
				const asset = text(e.asset) ? normalizeAsset(text(e.asset)) : '';
				const qty = cleanQty(e.qty);
				if (!asset) { bad('invalid_event', e, 'acquire_asset'); continue; }
				if (qty === 'invalid') { bad('invalid_event', e, 'acquire_qty'); continue; }
				if (qty === 'dust') continue;
				const ms = parseInstant(e.at);
				if (ms === null) { bad('unreadable_event_date', e, 'acquire'); continue; }
				const n: NAcquire = {
					kind: 'acquire', id: text(e.id) || text(e.sourceRef), asset, wallet: wallet(e.wallet), at: text(e.at), ms, qty: qty.ok,
					costUsd: money(e.costUsd), origin: ORIGINS.has(e.origin) ? e.origin : 'other', sourceRef: text(e.sourceRef),
				};
				ops.push({
					type: 'acquire', ms, rank: RANK.acquire, sourceRef: n.sourceRef, id: n.id, acquire: n,
					canon: JSON.stringify(['acquire', n.asset, n.wallet, n.at, n.qty, n.costUsd, n.origin]),
				});
			} else if (kind === 'dispose') {
				const e = raw as DisposeEvent;
				const asset = text(e.asset) ? normalizeAsset(text(e.asset)) : '';
				const qty = cleanQty(e.qty);
				if (!asset) { bad('invalid_event', e, 'dispose_asset'); continue; }
				if (qty === 'invalid') { bad('invalid_event', e, 'dispose_qty'); continue; }
				if (qty === 'dust') continue;
				const ms = parseInstant(e.at);
				if (ms === null) { bad('unreadable_event_date', e, 'dispose'); continue; }
				let manual: NManual | null = null;
				if (e.manualBasis) {
					const ppt = money(e.manualBasis.pricePerToken);
					if (ppt === null) bad('invalid_event', e, 'manual_basis');
					else {
						const buyDate = text(e.manualBasis.buyDateIso) || text(e.at);
						manual = { pricePerToken: ppt, buyDate, buyMs: parseInstant(buyDate), notes: text(e.manualBasis.notes) || null };
					}
				}
				const n: NDispose = {
					kind: 'dispose', id: text(e.id) || text(e.sourceRef), asset, wallet: wallet(e.wallet), at: text(e.at), ms, qty: qty.ok,
					proceedsUsd: money(e.proceedsUsd), taxable: e.taxable !== false, category: text(e.category), sourceRef: text(e.sourceRef), manual,
				};
				ops.push({
					type: 'dispose', ms, rank: RANK.dispose, sourceRef: n.sourceRef, id: n.id, dispose: n,
					canon: JSON.stringify(['dispose', n.asset, n.wallet, n.at, n.qty, n.proceedsUsd, n.taxable, n.category, n.manual?.pricePerToken ?? null, n.manual?.buyDate ?? null]),
				});
			} else if (kind === 'sendUnmatched') {
				const e = raw as SendUnmatchedEvent;
				const asset = text(e.asset) ? normalizeAsset(text(e.asset)) : '';
				const qty = cleanQty(e.qty);
				if (!asset) { bad('invalid_event', e, 'send_asset'); continue; }
				if (qty === 'invalid') { bad('invalid_event', e, 'send_qty'); continue; }
				if (qty === 'dust') continue;
				const ms = parseInstant(e.at);
				if (ms === null) { bad('unreadable_event_date', e, 'send'); continue; }
				const n: NSend = {
					kind: 'send', id: text(e.id) || text(e.sourceRef), asset, wallet: wallet(e.wallet), at: text(e.at), ms, qty: qty.ok,
					valueUsd: money(e.valueUsd), sourceRef: text(e.sourceRef),
				};
				ops.push({
					type: 'send', ms, rank: RANK.send, sourceRef: n.sourceRef, id: n.id, send: n,
					canon: JSON.stringify(['send', n.asset, n.wallet, n.at, n.qty, n.valueUsd]),
				});
			} else if (kind === 'move') {
				const e = raw as MoveEvent;
				const asset = text(e.asset) ? normalizeAsset(text(e.asset)) : '';
				const out = cleanQty(e.qtyOut);
				const inn = cleanQty(e.qtyIn);
				if (!asset) { bad('invalid_event', e, 'move_asset'); continue; }
				if (out === 'invalid' || inn === 'invalid') { bad('invalid_event', e, 'move_qty'); continue; }
				if (out === 'dust' && inn === 'dust') continue;
				const outMs = parseInstant(e.outAt);
				const inMs = parseInstant(e.inAt);
				if (outMs === null || inMs === null) { bad('unreadable_event_date', e, outMs === null ? 'move_out_date' : 'move_in_date', outMs === null ? e.outAt : e.inAt); continue; }
				const late = inMs > outMs;
				const n: NMove = {
					kind: 'move', id: text(e.id) || text(e.outRef), asset, from: wallet(e.fromWallet), to: wallet(e.toWallet),
					outAt: text(e.outAt), outMs, landAt: late ? text(e.inAt) : text(e.outAt), landMs: late ? inMs : outMs,
					qtyOut: out === 'dust' ? 0 : out.ok, qtyIn: inn === 'dust' ? 0 : inn.ok,
					link: LINKS.has(e.link) ? e.link : 'heuristic', ownersDiffer: e.ownersDiffer === true,
					outRef: text(e.outRef), inRef: text(e.inRef), hadManualBasis: !!e.manualBasis,
				};
				const canon = JSON.stringify(['move', n.asset, n.from, n.to, n.outAt, n.landAt, n.qtyOut, n.qtyIn, n.link, n.ownersDiffer, n.hadManualBasis]);
				const state: MoveState = { ev: n, mode: 'universal', taken: [], lack: 0, landedAtBoundary: false, feeEstimate: null };
				ops.push({ type: 'moveOut', ms: outMs, rank: RANK.moveOut, sourceRef: n.outRef, id: n.id, canon, move: state });
				ops.push({ type: 'moveIn', ms: n.landMs, rank: RANK.moveIn, sourceRef: n.inRef, id: n.id, canon, move: state });
			} else {
				this.find({ reason: 'invalid_event', detail: 'kind' });
			}
		}
		return ops.sort((a, b) => a.ms - b.ms || a.rank - b.rank || cmpStr(a.sourceRef, b.sourceRef) || cmpStr(a.id, b.id) || cmpStr(a.canon, b.canon));
	}

	// ── Lots and pools ──

	private uniqueId(base: string): string {
		let id = base;
		for (let n = 2; this.lotIds.has(id); n++) id = `${base}~${n}`;
		this.lotIds.add(id);
		return id;
	}

	private uniqueSliceId(base: string): string {
		let id = base;
		for (let k = 2; this.sliceIds.has(id); k++) id = `${base}~${k}`;
		this.sliceIds.add(id);
		return id;
	}

	private newLot(l: Omit<Lot, 'id' | 'placeholder' | 'moved'> & { id: string; placeholder?: boolean; moved?: boolean }): Lot {
		const lot: Lot = { ...l, id: this.uniqueId(l.id), placeholder: l.placeholder ?? false, moved: l.moved ?? false };
		this.allLots.push(lot);
		return lot;
	}

	private universalPool(asset: string): Lot[] {
		let pool = this.universal.get(asset);
		if (!pool) this.universal.set(asset, (pool = []));
		return pool;
	}

	private walletPool(asset: string, wallet: string): Lot[] {
		let wallets = this.byWallet.get(asset);
		if (!wallets) this.byWallet.set(asset, (wallets = new Map()));
		let pool = wallets.get(wallet);
		if (!pool) wallets.set(wallet, (pool = []));
		return pool;
	}

	/** The pool a lot of `wallet` lives in right now. */
	private poolFor(asset: string, wallet: string): Lot[] {
		return this.mode === 'universal' ? this.universalPool(asset) : this.walletPool(asset, wallet);
	}

	private unitsOf(asset: string): Map<string, number> {
		let m = this.units.get(asset);
		if (!m) this.units.set(asset, (m = new Map()));
		return m;
	}

	private addUnits(asset: string, wallet: string, qty: number): void {
		if (this.mode !== 'universal') return;
		const m = this.unitsOf(asset);
		const next = q((m.get(wallet) ?? 0) + qty);
		m.set(wallet, next);
		this.noteScale(asset, wallet, qty, next);
	}

	private noteScale(asset: string, wallet: string, ...sizes: number[]): void {
		let m = this.unitScales.get(asset);
		if (!m) this.unitScales.set(asset, (m = new Map()));
		m.set(wallet, Math.max(m.get(wallet) ?? 0, ...sizes.map(Math.abs)));
	}

	private unitScale(asset: string, wallet: string): number {
		return this.unitScales.get(asset)?.get(wallet) ?? 0;
	}

	/** Choose the next lot to sell from `pool`. */
	private pick(pool: Lot[], sourceRef: string): number {
		if (pool.length <= 1 || this.method === 'fifo') return 0;
		const view: SelectableLot[] = pool.map((l) => ({ amount: l.remainingQty, timestamp: l.acquiredAt, costUsd: l.remainingCostUsd }));
		return selectLotIndex(view, this.method, sourceRef, this.pins);
	}

	/**
	 * Take `want` units out of `pool`, one lot at a time, in the order `pickIndex` chooses. A lot
	 * that would be left with dust is taken whole. Returns the pieces and what the pool could not cover.
	 */
	private take(pool: Lot[], want: number, pickIndex: () => number): { pieces: Piece[]; left: number } {
		const pieces: Piece[] = [];
		const dust = tol(want);
		let left = want;
		while (left > dust && pool.length > 0) {
			const i = pickIndex();
			const lot = pool[i];
			let qty = Math.min(left, lot.remainingQty);
			if (lot.remainingQty - qty <= tol(lot.remainingQty, want)) qty = lot.remainingQty;
			const whole = qty >= lot.remainingQty;
			const cost = lot.remainingCostUsd === null ? null : whole ? lot.remainingCostUsd : usd(lot.remainingCostUsd * (qty / lot.remainingQty));
			lot.remainingQty = whole ? 0 : q(lot.remainingQty - qty);
			lot.remainingCostUsd = lot.remainingCostUsd === null ? null : whole ? 0 : usd(lot.remainingCostUsd - (cost as number));
			if (whole) pool.splice(i, 1);
			pieces.push({ lot, qty, cost });
			left = q(left - qty);
		}
		return { pieces, left: left > dust ? left : 0 };
	}

	// ── Acquire ──

	private applyAcquire(e: NAcquire): void {
		const basisSource: BasisSource = e.costUsd === null ? 'missing' : e.origin === 'transfer_in_untracked' ? 'estimated' : 'recorded';
		const lot = this.newLot({
			id: `lot:${e.id}`, asset: e.asset, wallet: e.wallet, acquiredAt: e.at, acquiredMs: e.ms, qty: e.qty, remainingQty: e.qty,
			costUsd: e.costUsd, remainingCostUsd: e.costUsd, basisSource, origin: e.origin, originLotId: null, sourceRef: e.sourceRef,
		});
		insertSorted(this.poolFor(e.asset, e.wallet), lot);
		this.addUnits(e.asset, e.wallet, e.qty);
		if (basisSource === 'estimated') {
			this.find({ reason: 'estimated_transfer_basis', asset: e.asset, wallet: e.wallet, at: e.at, qty: e.qty, costUsd: e.costUsd, valueUsd: e.costUsd, refs: [e.sourceRef] });
		}
	}

	// ── Dispose and unmatched send ──

	private applyDispose(e: NDispose): void {
		const pool = this.poolFor(e.asset, e.wallet);
		const { pieces, left } = this.take(pool, e.qty, () => this.pick(pool, e.sourceRef));
		this.addUnits(e.asset, e.wallet, -e.qty);
		this.book(
			{ id: e.id, asset: e.asset, wallet: e.wallet, at: e.at, ms: e.ms, qty: e.qty, proceeds: e.proceedsUsd, taxable: e.taxable, category: e.category, sourceRef: e.sourceRef, manual: e.taxable ? e.manual : null },
			pieces,
			left,
		);
	}

	private applySend(e: NSend): void {
		const pool = this.poolFor(e.asset, e.wallet);
		const { pieces, left } = this.take(pool, e.qty, () => 0);
		this.addUnits(e.asset, e.wallet, -e.qty);
		const { lotQty, lotCost, firstAcquiredAt, covered } = this.book(
			{ id: e.id, asset: e.asset, wallet: e.wallet, at: e.at, ms: e.ms, qty: e.qty, proceeds: e.valueUsd, taxable: false, category: 'unmatched_transfer', sourceRef: e.sourceRef, manual: null },
			pieces,
			left,
		);
		this.find({
			reason: 'unmatched_transfer', asset: e.asset, wallet: e.wallet, at: e.at, qty: e.qty,
			costUsd: lotQty > 0 ? lotCost : null, valueUsd: e.valueUsd, acquiredAt: firstAcquiredAt, refs: [e.sourceRef],
			detail: covered ? null : 'partly_untracked',
		});
	}

	/**
	 * Turn consumed pieces (and the uncovered rest) into slices and an unmatched row. Proceeds are
	 * shared out by quantity; the last piece takes what is left so they add up exactly.
	 */
	private book(
		d: { id: string; asset: string; wallet: string; at: string; ms: number; qty: number; proceeds: number | null; taxable: boolean; category: string; sourceRef: string; manual: NManual | null },
		pieces: Piece[],
		left: number,
	): { lotQty: number; lotCost: number | null; firstAcquiredAt: string | null; covered: boolean } {
		type Entry = { lot: Lot | null; qty: number; cost: number | null };
		const entries: Entry[] = pieces.map((p) => ({ lot: p.lot, qty: p.qty, cost: p.cost }));
		if (left > 0) entries.push({ lot: null, qty: left, cost: null });
		const total = q(entries.reduce((a, x) => a + x.qty, 0));

		let given = 0;
		const proceedsOf = (x: Entry, last: boolean): number | null => {
			if (d.proceeds === null) return null;
			const share = last ? Math.max(0, usd(d.proceeds - given)) : usd(d.proceeds * (x.qty / total));
			given = usd(given + share);
			return share;
		};

		let n = 0;
		let unmatchedQty = 0;
		let placeholderQty = 0;
		let unmatchedProceeds: number | null = d.proceeds === null ? null : 0;
		let lotQty = 0;
		let lotCost: number | null = null;
		let firstAcquiredAt: string | null = null;
		entries.forEach((x, i) => {
			const proceeds = proceedsOf(x, i === entries.length - 1);
			const lot = x.lot;
			// Units no lot backs, or only a placeholder, are the owner's to sort out: unmatched.
			if (!d.manual && (lot === null || lot.placeholder)) {
				unmatchedQty = q(unmatchedQty + x.qty);
				if (lot !== null) placeholderQty = q(placeholderQty + x.qty);
				if (unmatchedProceeds !== null) unmatchedProceeds = usd(unmatchedProceeds + (proceeds ?? 0));
				return;
			}
			if (lot) {
				lotQty = q(lotQty + x.qty);
				if (x.cost !== null) lotCost = usd((lotCost ?? 0) + x.cost);
				firstAcquiredAt = firstAcquiredAt ?? lot.acquiredAt;
			}
			let cost: number | null;
			let acquiredAt: string;
			let acquiredMs: number;
			let basisSource: BasisSource;
			let note: string;
			if (d.manual) {
				cost = usd(x.qty * d.manual.pricePerToken);
				acquiredAt = d.manual.buyDate;
				acquiredMs = d.manual.buyMs ?? d.ms;
				basisSource = 'manual';
				note = manualNote(d.manual, d.asset);
			} else {
				const l = lot as Lot;
				cost = x.cost;
				acquiredAt = l.acquiredAt;
				acquiredMs = l.acquiredMs;
				basisSource = l.basisSource;
				note = originNote(l);
			}
			this.slices.push({
				id: this.uniqueSliceId(`${d.id}#${++n}`),
				lotId: lot ? lot.id : null,
				asset: d.asset,
				wallet: d.wallet,
				acquiredAt,
				disposedAt: d.at,
				qty: x.qty,
				cost,
				proceeds,
				gain: proceeds !== null && cost !== null ? usd(proceeds - cost) : null,
				term: termOf(acquiredMs, d.ms),
				taxable: d.taxable,
				basisSource,
				originNote: note,
				category: d.category,
				sourceRef: d.sourceRef,
			});
		});
		const uncovered = unmatchedQty > tol(d.qty);
		if (uncovered) {
			this.unmatched.push({ asset: d.asset, wallet: d.wallet, at: d.at, qty: unmatchedQty, placeholderQty, proceeds: unmatchedProceeds, taxable: d.taxable, category: d.category, sourceRef: d.sourceRef });
		}
		return { lotQty, lotCost, firstAcquiredAt, covered: !uncovered };
	}

	// ── Moves ──

	private applyMoveOut(s: MoveState): void {
		const e = s.ev;
		const refs = [e.outRef, e.inRef].filter(Boolean);
		const base = { asset: e.asset, wallet: e.from, toWallet: e.to, at: e.outAt, qty: e.qtyOut, refs };
		if (e.ownersDiffer) this.find({ reason: 'transfer_between_owners', ...base });
		if (e.link === 'heuristic') this.find({ reason: 'transfer_link_unconfirmed', ...base, detail: e.link });
		if (e.hadManualBasis) this.find({ reason: 'manual_basis_on_transfer', ...base });

		s.mode = this.mode;
		this.inFlight.add(s);
		if (this.mode === 'universal') {
			this.addUnits(e.asset, e.from, -e.qtyOut);
			const lost = q(e.qtyOut - e.qtyIn);
			if (lost > tol(e.qtyOut, e.qtyIn)) s.feeEstimate = this.estimateUnits(e.asset, e.from, lost);
			let log = this.moveLog.get(e.asset);
			if (!log) this.moveLog.set(e.asset, (log = []));
			log.push({ from: e.from, to: e.to, ms: e.outMs });
			return;
		}
		// The source wallet's oldest units leave, whatever the method says for sales.
		const pool = this.walletPool(e.asset, e.from);
		const { pieces, left } = this.take(pool, e.qtyOut, () => 0);
		s.taken = pieces;
		s.lack = left;
		if (left > 0) this.find({ reason: 'transfer_source_shortfall', ...base, qty: left });
	}

	private applyMoveIn(s: MoveState): void {
		const e = s.ev;
		this.inFlight.delete(s);
		const refs = [e.outRef, e.inRef].filter(Boolean);
		const base = { asset: e.asset, wallet: e.from, toWallet: e.to, at: e.outAt, refs };
		const fee = q(e.qtyOut - e.qtyIn);
		const surplus = q(e.qtyIn - e.qtyOut);
		const dust = tol(e.qtyOut, e.qtyIn);

		if (s.mode === 'universal') {
			// Before the boundary a move changes no lot: units shift in the quantity ledger, and a
			// shortfall or surplus is only reported. The pooled lots stay as they are.
			if (!s.landedAtBoundary) this.addUnits(e.asset, e.to, e.qtyIn);
			if (fee > dust) {
				const est = s.feeEstimate ?? { costUsd: null, acquiredAt: null };
				this.find({ reason: 'transfer_fee_units', ...base, qty: fee, costUsd: est.costUsd, acquiredAt: est.acquiredAt, detail: 'universal_estimate' });
			}
			if (surplus > dust) this.find({ reason: 'transfer_amount_mismatch', ...base, qty: surplus, detail: 'surplus_missing_basis' });
			return;
		}

		// After the boundary the units that left land as lots in the destination.
		let feeLeft = fee > dust ? fee : 0;
		// The fee comes off the end of what left: the units no lot backed first, then the last slices.
		const fromUnbacked = Math.min(s.lack, feeLeft);
		feeLeft = q(feeLeft - fromUnbacked);
		const slices = s.taken.map((p) => ({ ...p }));
		let carvedQty = 0;
		let carvedCost: number | null = null;
		let carvedAcquiredAt: string | null = null;
		for (let i = slices.length - 1; i >= 0 && feeLeft > dust; i--) {
			const p = slices[i];
			let cut = Math.min(feeLeft, p.qty);
			if (p.qty - cut <= tol(p.qty, e.qtyOut)) cut = p.qty;
			const whole = cut >= p.qty;
			const cutCost = p.cost === null ? null : whole ? p.cost : usd(p.cost * (cut / p.qty));
			p.qty = whole ? 0 : q(p.qty - cut);
			p.cost = p.cost === null ? null : whole ? 0 : usd(p.cost - (cutCost as number));
			carvedQty = q(carvedQty + cut);
			if (cutCost !== null) carvedCost = usd((carvedCost ?? 0) + cutCost);
			carvedAcquiredAt = carvedAcquiredAt ?? p.lot.acquiredAt;
			feeLeft = q(feeLeft - cut);
		}
		if (carvedQty > dust) {
			this.find({ reason: 'transfer_fee_units', ...base, qty: carvedQty, costUsd: carvedCost, acquiredAt: carvedAcquiredAt, detail: 'carved_from_lots' });
		}
		const dest = this.walletPool(e.asset, e.to);
		for (const p of slices) {
			if (p.qty <= dust) continue;
			insertSorted(
				dest,
				this.newLot({
					id: `${p.lot.id}>${e.id}`, asset: e.asset, wallet: e.to, acquiredAt: p.lot.acquiredAt, acquiredMs: p.lot.acquiredMs,
					qty: p.qty, remainingQty: p.qty, costUsd: p.cost, remainingCostUsd: p.cost, basisSource: p.lot.basisSource,
					origin: p.lot.origin, originLotId: p.lot.id, sourceRef: p.lot.sourceRef, placeholder: p.lot.placeholder, moved: true,
				}),
			);
		}
		// Units that arrived with nothing behind them arrive with missing basis, and say so.
		const unbacked = q(s.lack - fromUnbacked);
		if (unbacked > dust) {
			insertSorted(dest, this.untracked(e, `${e.id}:unbacked`, unbacked, 'transfer_in_untracked'));
		}
		if (surplus > dust) {
			insertSorted(dest, this.untracked(e, `${e.id}:surplus`, surplus, 'transfer_surplus'));
			this.find({ reason: 'transfer_amount_mismatch', ...base, qty: surplus, detail: 'surplus_missing_basis' });
		}
	}

	/** Units that landed with no lot behind them: dated at the landing, with missing basis. */
	private untracked(e: NMove, id: string, qty: number, origin: LotOrigin): Lot {
		return this.newLot({
			id: `lot:${id}`, asset: e.asset, wallet: e.to, acquiredAt: e.landAt, acquiredMs: e.landMs, qty, remainingQty: qty,
			costUsd: null, remainingCostUsd: null, basisSource: 'missing', origin, originLotId: null, sourceRef: e.inRef || e.outRef,
		});
	}

	/** A guess at the basis and date of units that left before the boundary, for a finding only. */
	private estimateUnits(asset: string, wallet: string, qty: number): { costUsd: number | null; acquiredAt: string | null } {
		// One pass, no copy: this runs for every transfer that lost coins to a fee.
		let lot: Lot | undefined;
		let fallback: Lot | undefined;
		for (const l of this.universal.get(asset) ?? []) {
			if (l.remainingQty <= EPSILON) continue;
			if (l.wallet === wallet) {
				lot = l;
				break;
			}
			fallback = fallback ?? l;
		}
		lot = lot ?? fallback;
		if (!lot) return { costUsd: null, acquiredAt: null };
		return { costUsd: lot.remainingCostUsd === null ? null : usd((lot.remainingCostUsd / lot.remainingQty) * qty), acquiredAt: lot.acquiredAt };
	}

	// ── The January 1 boundary ──

	/**
	 * Allocate the pooled lots left at the end of December 31 to the wallets that hold the units.
	 *
	 * The units come from the quantity ledger (units in flight count for their destination); the
	 * basis from the pool. Origin pass: oldest lot first, into the wallet it was acquired in, up to
	 * what that wallet holds. Fill pass: what is left of each lot, oldest first, into wallets that
	 * received a move from its origin wallet (latest move first), then by wallet key. Units left
	 * without a lot get a placeholder with missing basis; basis left without units stays
	 * unallocated. Both are findings. An allocation the owner recorded replaces all of this for its
	 * asset when it holds the same units per wallet and draws only on the lots left.
	 */
	private runBoundary(): void {
		this.boundaryDone = true;
		const arrivals = new Map<string, Map<string, number>>();
		for (const s of this.inFlight) {
			if (s.mode !== 'universal') continue;
			s.landedAtBoundary = true;
			let m = arrivals.get(s.ev.asset);
			if (!m) arrivals.set(s.ev.asset, (m = new Map()));
			m.set(s.ev.to, q((m.get(s.ev.to) ?? 0) + s.ev.qtyIn));
			this.noteScale(s.ev.asset, s.ev.to, s.ev.qtyIn);
		}
		const assets = [...new Set([...this.universal.keys(), ...this.units.keys(), ...arrivals.keys()])].sort(cmpStr);
		for (const asset of assets) this.reconstruct(asset, arrivals.get(asset));
		// An allocation for an asset there is nothing of cannot apply to anything.
		for (const asset of [...this.overrides.keys()].sort(cmpStr)) {
			if (!assets.includes(asset)) this.find({ reason: 'allocation_override_rejected', asset, at: this.boundaryIso, detail: 'unknown_asset' });
		}
		this.mode = 'wallet';
		this.universal.clear();
	}

	private reconstruct(asset: string, arriving: Map<string, number> | undefined): void {
		const at = this.boundaryIso as string;
		const pool = (this.universal.get(asset) ?? []).filter((l) => l.remainingQty > EPSILON).sort(cmpLot);

		// What each wallet holds. A negative balance means sales the wallet's own records do not cover.
		const balance = new Map<string, number>();
		for (const [w, n] of this.units.get(asset) ?? []) balance.set(w, n);
		for (const [w, n] of arriving ?? []) balance.set(w, q((balance.get(w) ?? 0) + n));
		for (const w of [...balance.keys()].sort(cmpStr)) {
			const v = balance.get(w) as number;
			const dust = tol(this.unitScale(asset, w), v);
			if (v < -dust) this.find({ reason: 'jan1_position_gap', asset, wallet: w, at, qty: -v, detail: 'negative_balance' });
			if (v <= dust) balance.delete(w);
		}

		const unused: Jan1UnusedLot[] = pool.map((l) => ({ lotId: l.id, wallet: l.wallet, acquiredAt: l.acquiredAt, qty: l.remainingQty, costUsd: l.remainingCostUsd }));

		type Portion = { wallet: string; qty: number; pass: LotAllocation['pass'] };
		let portions = new Map<Lot, Portion[]>();
		let source: 'reconstruction' | 'override' = 'reconstruction';
		let overrideRejected = false;

		const override = this.overrides.get(asset);
		if (override && this.duplicateOverrides.has(asset)) {
			overrideRejected = true;
			this.find({ reason: 'allocation_override_rejected', asset, at, detail: 'duplicate_asset' });
		} else if (override) {
			const checked = this.checkOverride(override, pool, balance);
			if (checked.ok) {
				portions = checked.portions;
				source = 'override';
			} else {
				overrideRejected = true;
				this.find({ reason: 'allocation_override_rejected', asset, at, detail: checked.detail });
			}
		}
		if (source === 'reconstruction') portions = this.allocate(asset, pool, balance);

		// Materialize: the first portion of a lot stays in its record, the rest become lots cut from it.
		const positions = new Map<string, Jan1Position>();
		const position = (wallet: string): Jan1Position => {
			let p = positions.get(wallet);
			if (!p) positions.set(wallet, (p = { wallet, units: 0, costUsd: null, lots: [] }));
			return p;
		};
		const place = (lot: Lot, pass: LotAllocation['pass'], fromLotId: string | null) => {
			const p = position(lot.wallet);
			p.units = q(p.units + lot.remainingQty);
			if (lot.remainingCostUsd !== null) p.costUsd = usd((p.costUsd ?? 0) + lot.remainingCostUsd);
			p.lots.push({ lotId: lot.id, fromLotId, acquiredAt: lot.acquiredAt, qty: lot.remainingQty, costUsd: lot.remainingCostUsd, basisSource: lot.basisSource, pass });
			insertSorted(this.walletPool(asset, lot.wallet), lot);
		};
		const placed: Lot[] = [];
		let unallocatedQty = 0;
		let unallocatedCost: number | null = null;
		for (const lot of pool) {
			const list = [...(portions.get(lot) ?? [])];
			const taken = q(list.reduce((a, p) => a + p.qty, 0));
			if (lot.remainingQty - taken > tol(lot.remainingQty)) list.push({ wallet: UNALLOCATED_WALLET, qty: q(lot.remainingQty - taken), pass: 'unallocated' });
			let rq = lot.remainingQty;
			let rc = lot.remainingCostUsd;
			const originWallet = lot.wallet;
			// The lot's own record stays with the wallet it was acquired in, when the allocation leaves it any;
			// otherwise with the first wallet by key. Unallocated basis comes last. So which record is which
			// does not depend on the order a reconstruction or an owner's allocation happened to name them in.
			const rank = (p: Portion) => (p.wallet === originWallet ? 0 : p.wallet === UNALLOCATED_WALLET ? 2 : 1);
			list.sort((a, b) => rank(a) - rank(b) || cmpStr(a.wallet, b.wallet));
			list.forEach((p, i) => {
				const last = i === list.length - 1;
				const qty = last || rq - p.qty <= tol(lot.remainingQty) ? rq : p.qty;
				const whole = qty >= rq;
				const cost = rc === null ? null : whole ? rc : usd(rc * (qty / rq));
				rq = whole ? 0 : q(rq - qty);
				rc = rc === null ? null : whole ? 0 : usd(rc - (cost as number));
				if (i > 0 && qty <= tol(lot.remainingQty)) return;
				if (i === 0) {
					lot.remainingQty = qty;
					lot.remainingCostUsd = cost;
					lot.wallet = p.wallet;
					lot.allocation = { pass: p.pass, fromWallet: p.wallet === originWallet ? null : originWallet };
					placed.push(lot);
					place(lot, p.pass, null);
				} else {
					const derived = this.newLot({
						id: `${lot.id}@${p.wallet}`, asset, wallet: p.wallet, acquiredAt: lot.acquiredAt, acquiredMs: lot.acquiredMs, qty, remainingQty: qty,
						costUsd: cost, remainingCostUsd: cost, basisSource: lot.basisSource, origin: lot.origin, originLotId: lot.id, sourceRef: lot.sourceRef,
						placeholder: lot.placeholder, allocation: { pass: p.pass, fromWallet: p.wallet === originWallet ? null : originWallet },
					});
					placed.push(derived);
					place(derived, p.pass, lot.id);
				}
				if (p.wallet === UNALLOCATED_WALLET) {
					unallocatedQty = q(unallocatedQty + qty);
					if (cost !== null) unallocatedCost = usd((unallocatedCost ?? 0) + cost);
				}
			});
		}
		if (unallocatedQty > 0) {
			this.find({ reason: 'jan1_position_gap', asset, wallet: UNALLOCATED_WALLET, at, qty: unallocatedQty, costUsd: unallocatedCost, detail: 'basis_without_units' });
		}

		// Units the wallets hold that no lot covers.
		const covered = new Map<string, number>();
		for (const lot of placed) if (lot.wallet !== UNALLOCATED_WALLET) covered.set(lot.wallet, q((covered.get(lot.wallet) ?? 0) + lot.remainingQty));
		for (const [wallet, units] of [...balance].sort((a, b) => cmpStr(a[0], b[0]))) {
			const short = q(units - (covered.get(wallet) ?? 0));
			if (short <= tol(units, this.unitScale(asset, wallet))) continue;
			const lot = this.newLot({
				id: `jan1:${asset}:${wallet}`, asset, wallet, acquiredAt: at, acquiredMs: this.boundaryMs as number, qty: short, remainingQty: short,
				costUsd: null, remainingCostUsd: null, basisSource: 'missing', origin: 'jan1_placeholder', originLotId: null, sourceRef: `jan1:${asset}:${wallet}`,
				placeholder: true, allocation: { pass: 'placeholder', fromWallet: null },
			});
			place(lot, 'placeholder', null);
			this.find({ reason: 'jan1_position_gap', asset, wallet, at, qty: short, detail: 'units_without_basis' });
		}

		if (unused.length || positions.size) {
			this.jan1.push({
				asset, at, source, overrideRejected,
				positions: [...positions.values()].sort((a, b) => cmpStr(a.wallet, b.wallet)),
				unused,
			});
		}
	}

	/** The origin and fill passes. */
	private allocate(asset: string, pool: Lot[], balance: Map<string, number>): Map<Lot, { wallet: string; qty: number; pass: 'origin' | 'fill' }[]> {
		const out = new Map<Lot, { wallet: string; qty: number; pass: 'origin' | 'fill' }[]>();
		const room = new Map(balance);
		const left = new Map<Lot, number>(pool.map((l) => [l, l.remainingQty]));
		const put = (lot: Lot, wallet: string, pass: 'origin' | 'fill') => {
			const cap = room.get(wallet) ?? 0;
			const qty = Math.min(left.get(lot) as number, cap);
			if (qty <= tol(lot.remainingQty)) return;
			const list = out.get(lot) ?? [];
			list.push({ wallet, qty, pass });
			out.set(lot, list);
			room.set(wallet, q(cap - qty));
			left.set(lot, q((left.get(lot) as number) - qty));
		};

		for (const lot of pool) put(lot, lot.wallet, 'origin');

		// Wallets that received a move from a lot's wallet, the latest move first.
		const log = this.moveLog.get(asset) ?? [];
		const received = new Map<string, string[]>();
		const receivers = (from: string): string[] => {
			let known = received.get(from);
			if (!known) {
				const latest = new Map<string, number>();
				for (const m of log) if (m.from === from && m.to !== from) latest.set(m.to, Math.max(latest.get(m.to) ?? -Infinity, m.ms));
				known = [...latest].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0])).map((x) => x[0]);
				received.set(from, known);
			}
			return known;
		};
		const byKey = [...room.keys()].sort(cmpStr);
		for (const lot of pool) {
			if ((left.get(lot) as number) <= tol(lot.remainingQty)) continue;
			const order = [...receivers(lot.wallet), ...byKey];
			for (const wallet of order) {
				if ((left.get(lot) as number) <= tol(lot.remainingQty)) break;
				put(lot, wallet, 'fill');
			}
		}
		return out;
	}

	/** Check the owner's allocation against the units and lots there are; all or nothing. */
	private checkOverride(
		o: AllocationOverride,
		pool: Lot[],
		balance: Map<string, number>,
	): { ok: true; portions: Map<Lot, { wallet: string; qty: number; pass: 'override' }[]> } | { ok: false; detail: string } {
		const close = (a: number, b: number) => Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
		const rows = [...(o.rows ?? [])].map((r) => ({ wallet: text(r.wallet), ms: parseInstant(r.acquiredAt), qty: r.qty, costUsd: r.costUsd ?? null }));
		if (!rows.length) return { ok: false, detail: 'no_rows' };
		for (const r of rows) {
			if (!r.wallet || r.ms === null || typeof r.qty !== 'number' || !Number.isFinite(r.qty) || r.qty <= EPSILON) return { ok: false, detail: 'invalid_rows' };
			if (r.costUsd !== null && (typeof r.costUsd !== 'number' || !Number.isFinite(r.costUsd) || r.costUsd < 0)) return { ok: false, detail: 'invalid_rows' };
		}
		if (!pool.length && !balance.size) return { ok: false, detail: 'unknown_asset' };

		// The same units per wallet as the January 1 balances. When the lots left cover fewer units than the
		// wallets hold (the books know of less than the wallets do), there is basis for fewer: then all of it
		// must be placed, no wallet is given more than it holds, and a wallet's other units are placeholders.
		const given = new Map<string, number>();
		for (const r of rows) given.set(r.wallet, (given.get(r.wallet) ?? 0) + r.qty);
		const unusedUnits = pool.reduce((a, l) => a + l.remainingQty, 0);
		const heldUnits = [...balance.values()].reduce((a, v) => a + v, 0);
		const covers = unusedUnits + tol(unusedUnits, heldUnits) >= heldUnits;
		for (const w of new Set([...given.keys(), ...balance.keys()])) {
			const g = given.get(w) ?? 0;
			const b = balance.get(w) ?? 0;
			if (covers ? !close(g, b) : g > b && !close(g, b)) return { ok: false, detail: 'units_mismatch' };
		}
		if (!covers && !close([...given.values()].reduce((a, v) => a + v, 0), unusedUnits)) return { ok: false, detail: 'units_mismatch' };

		// Only lots that are left, and no more of each than is left.
		const portions = new Map<Lot, { wallet: string; qty: number; pass: 'override' }[]>();
		const room = new Map<Lot, number>(pool.map((l) => [l, l.remainingQty]));
		const sorted = rows.sort((a, b) => cmpStr(a.wallet, b.wallet) || (a.ms as number) - (b.ms as number) || a.qty - b.qty);
		for (const r of sorted) {
			let want = r.qty;
			let basis = 0;
			for (const lot of pool) {
				if (lot.acquiredMs !== r.ms || want <= tol(r.qty)) continue;
				const have = room.get(lot) as number;
				const qty = Math.min(want, have);
				if (qty <= tol(lot.remainingQty)) continue;
				const list = portions.get(lot) ?? [];
				list.push({ wallet: r.wallet, qty, pass: 'override' });
				portions.set(lot, list);
				room.set(lot, q(have - qty));
				if (lot.remainingCostUsd !== null) basis += lot.remainingCostUsd * (qty / lot.remainingQty);
				want = q(want - qty);
			}
			if (want > tol(r.qty)) return { ok: false, detail: 'lot_not_unused' };
			if (r.costUsd !== null && Math.abs(r.costUsd - basis) > Math.max(0.01, 1e-6 * basis)) return { ok: false, detail: 'basis_mismatch' };
		}
		return { ok: true, portions };
	}

	// ── Snapshots ──

	private capture(at: string): LedgerSnapshot {
		const rows: { ms: number; lot: SnapshotLot }[] = [];
		const add = (l: Lot, wallet: string, id: string, qty: number, cost: number | null) =>
			rows.push({
				ms: l.acquiredMs,
				lot: { lotId: id, asset: l.asset, wallet, acquiredAt: l.acquiredAt, qty, costUsd: cost, basisSource: l.basisSource, origin: l.origin, originLotId: l.originLotId },
			});
		if (this.mode === 'universal') {
			for (const pool of this.universal.values()) for (const l of pool) add(l, l.wallet, l.id, l.remainingQty, l.remainingCostUsd);
		} else {
			for (const wallets of this.byWallet.values()) for (const pool of wallets.values()) for (const l of pool) add(l, l.wallet, l.id, l.remainingQty, l.remainingCostUsd);
			for (const s of this.inFlight) {
				if (s.mode !== 'wallet') continue;
				for (const p of s.taken) add(p.lot, TRANSIT_WALLET, `${p.lot.id}>${s.ev.id}`, p.qty, p.cost);
			}
		}
		rows.sort((a, b) => cmpStr(a.lot.asset, b.lot.asset) || cmpStr(a.lot.wallet, b.lot.wallet) || a.ms - b.ms || cmpStr(a.lot.lotId, b.lot.lotId));
		return { at, lots: rows.map((r) => r.lot) };
	}

	// ── Driver ──

	run(events: readonly LedgerEvent[], snapshotsAt: readonly string[]): LedgerResult {
		const ops = this.buildOps(events);
		// Findings about events that could not be read come first, in an order of their own, so they
		// do not depend on the order the events were passed in.
		this.findings.sort((a, b) => cmpStr(JSON.stringify(a), JSON.stringify(b)));

		const snaps: { at: string; ms: number }[] = [];
		const seen = new Set<number>();
		for (const raw of snapshotsAt) {
			const ms = parseInstant(raw);
			if (ms === null) throw new RangeError(`snapshotsAt holds a time that cannot be read: ${raw}`);
			if (seen.has(ms)) continue;
			seen.add(ms);
			snaps.push({ at: text(raw), ms });
		}
		snaps.sort((a, b) => a.ms - b.ms);

		const crossBoundaryBy = (ms: number) => {
			if (this.boundaryMs !== null && !this.boundaryDone && this.boundaryMs <= ms) this.runBoundary();
		};
		let si = 0;
		const snapshotBefore = (ms: number) => {
			while (si < snaps.length && snaps[si].ms < ms) {
				crossBoundaryBy(snaps[si].ms);
				this.snapshots.push(this.capture(snaps[si].at));
				si++;
			}
		};

		for (const op of ops) {
			snapshotBefore(op.ms);
			if (this.boundaryMs !== null && !this.boundaryDone && op.ms >= this.boundaryMs) this.runBoundary();
			switch (op.type) {
				case 'acquire': this.applyAcquire(op.acquire as NAcquire); break;
				case 'dispose': this.applyDispose(op.dispose as NDispose); break;
				case 'send': this.applySend(op.send as NSend); break;
				case 'moveOut': this.applyMoveOut(op.move as MoveState); break;
				case 'moveIn': this.applyMoveIn(op.move as MoveState); break;
			}
		}
		snapshotBefore(Number.POSITIVE_INFINITY);
		// The boundary happens even when no event reaches it: the January 1 positions are asked for on their own.
		if (this.boundaryMs !== null && !this.boundaryDone) this.runBoundary();

		return {
			engineVersion: ENGINE_VERSION,
			lots: [...this.allLots]
				.sort((a, b) => cmpStr(a.asset, b.asset) || a.acquiredMs - b.acquiredMs || cmpStr(a.id, b.id))
				.map<LedgerLot>((l) => ({
					id: l.id, asset: l.asset, wallet: l.wallet, acquiredAt: l.acquiredAt, qty: l.qty, remainingQty: l.remainingQty,
					costUsd: l.costUsd, remainingCostUsd: l.remainingCostUsd, basisSource: l.basisSource, origin: l.origin,
					originLotId: l.originLotId, sourceRef: l.sourceRef, ...(l.allocation ? { allocation: l.allocation } : {}),
				})),
			slices: this.slices,
			unmatched: this.unmatched,
			findings: this.findings,
			jan1: this.jan1.sort((a, b) => cmpStr(a.asset, b.asset)),
			snapshots: this.snapshots,
		};
	}
}

/**
 * Run the events through the ledger and report every lot, sale slice, unmatched remainder,
 * finding, January 1 position and requested snapshot. Deterministic: the same events in any order
 * give the same result.
 *
 * Throws RangeError for an option that cannot be read (perWalletFrom, snapshotsAt): those are
 * set in code. An event that cannot be read becomes a finding instead.
 */
export function runLotLedger(events: readonly LedgerEvent[], opts: LedgerOptions = {}): LedgerResult {
	return new Run(opts).run(events, opts.snapshotsAt ?? []);
}
