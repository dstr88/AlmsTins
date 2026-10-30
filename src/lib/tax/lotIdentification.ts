/**
 * lotIdentification.ts: dated, standing identifications of which units a wallet's sales use. Pure:
 * no database, no clock, no I/O.
 *
 * Treas. Reg. 1.1012-1(j): units not held by a broker are disposed of earliest acquired first unless
 * the taxpayer identifies the units in their books and records no later than the date and time of
 * the sale. Earliest acquired, latest acquired and highest basis are ways of identifying, not a
 * method of accounting. An identification here is therefore a record made at a date and time, never
 * an edit: a change is a new entry.
 *
 * Which entry a sale uses. For a sale in a wallet at instant T, an entry counts when
 *   - it names that wallet,
 *   - it was recorded (createdAt, set by the server) strictly before T, and
 *   - its effective time is at or before T.
 * Among those the one with the latest effective time wins (then the latest createdAt, then id). When
 * none counts the sale falls back to earliest acquired within its own wallet: the default rule, not
 * the report-time toggle. An entry recorded after the sale never counts, whatever date it carries.
 */

import { parseInstant } from './normalize';
import type { CostBasisMethod } from '../yearEnd/lotSelection';

export const IDENTIFICATION_METHODS = ['earliest', 'latest', 'highest_basis'] as const;
export type IdentificationMethod = (typeof IDENTIFICATION_METHODS)[number];

export function isIdentificationMethod(value: unknown): value is IdentificationMethod {
	return typeof value === 'string' && (IDENTIFICATION_METHODS as readonly string[]).includes(value);
}

/** The lot selector's name for each identification method. 'latest' orders by original acquisition date. */
export const ENGINE_METHOD: Readonly<Record<IdentificationMethod, CostBasisMethod>> = {
	earliest: 'fifo',
	latest: 'lifo',
	highest_basis: 'hifo',
};

export const NOTE_MAX = 500;

/** One recorded identification. Immutable once written. */
export interface LotIdentification {
	id: string;
	walletKey: string;
	method: IdentificationMethod;
	/** ISO instant (UTC) the choice takes effect. Never earlier than createdAt. */
	effectiveAt: string;
	/** ISO instant (UTC) the server wrote it. */
	createdAt: string;
	note: string | null;
	/** Entries written by one click share a batch (and one Bitcoin timestamp). */
	batchId: string;
	/** How the entry came to be written. Not part of the timestamped record. */
	source?: EntrySource;
}

/** apply_all: the Apply to all button. prompt_use: "Use X for this wallet too" when a wallet was added. manual: anything else. */
export type EntrySource = 'apply_all' | 'prompt_use' | 'manual';
export const isEntrySource = (v: unknown): v is EntrySource => v === 'apply_all' || v === 'prompt_use' || v === 'manual';

/** What a sale used: the entry that was in force, or nothing (the default). */
export interface SaleSelection {
	identificationId: string | null;
	method: CostBasisMethod;
}

/**
 * The entry in force for a sale in `walletKey` at `saleMs`, or null. `entries` may be in any order.
 * Entries whose times cannot be read are ignored.
 */
export function identificationInForce(entries: readonly LotIdentification[], walletKey: string, saleMs: number): LotIdentification | null {
	let best: { e: LotIdentification; eff: number; cre: number } | null = null;
	for (const e of entries) {
		if (e.walletKey !== walletKey) continue;
		const cre = parseInstant(e.createdAt);
		const eff = parseInstant(e.effectiveAt);
		if (cre === null || eff === null) continue;
		if (!(cre < saleMs) || !(eff <= saleMs)) continue;
		if (
			!best ||
			eff > best.eff ||
			(eff === best.eff && (cre > best.cre || (cre === best.cre && e.id > best.e.id)))
		) {
			best = { e, eff, cre };
		}
	}
	return best ? best.e : null;
}

/** A lookup the ledger calls once per sale. */
export type SelectionFor = (wallet: string, saleMs: number) => { identificationId: string; method: CostBasisMethod } | null;

export function selectionResolver(entries: readonly LotIdentification[]): SelectionFor {
	const byWallet = new Map<string, LotIdentification[]>();
	for (const e of entries) {
		const list = byWallet.get(e.walletKey);
		if (list) list.push(e);
		else byWallet.set(e.walletKey, [e]);
	}
	return (wallet, saleMs) => {
		const list = byWallet.get(wallet);
		if (!list) return null;
		const hit = identificationInForce(list, wallet, saleMs);
		return hit ? { identificationId: hit.id, method: ENGINE_METHOD[hit.method] } : null;
	};
}

/** A stable fingerprint of a set of entries, for cache keys. */
export function identificationsKey(entries: readonly LotIdentification[]): string {
	if (entries.length === 0) return '';
	return entries
		.map((e) => e.id)
		.sort()
		.join(',');
}

// ── Writing: validation ──────────────────────────────────────────────────────

export type NewEntryError =
	| 'wallet_invalid'
	| 'method_invalid'
	| 'effective_invalid'
	| 'effective_before_recorded'
	| 'note_too_long'
	| 'too_many_entries'
	| 'no_entries';

export interface NewEntryInput {
	walletKey: string;
	method: IdentificationMethod;
	/** Absent: effective when recorded. */
	effectiveAt?: string | null;
	note?: string | null;
}

export type ParsedEntries = { ok: true; entries: { walletKey: string; method: IdentificationMethod; effectiveAt: string; note: string | null }[] } | { ok: false; error: NewEntryError };

export const MAX_ENTRIES_PER_REQUEST = 200;
const WALLET_KEY_RE = /^[A-Za-z0-9_.:\-]{3,200}$/;

/**
 * Check entries from a request against the server's own clock (`nowIso`, passed in so this stays
 * pure). The effective time may not be earlier than the moment the server records the entry: an
 * identification cannot be backdated. A missing effective time means "from now".
 */
export function parseNewEntries(raw: unknown, nowIso: string): ParsedEntries {
	if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'no_entries' };
	if (raw.length > MAX_ENTRIES_PER_REQUEST) return { ok: false, error: 'too_many_entries' };
	const nowMs = Date.parse(nowIso);
	const out: { walletKey: string; method: IdentificationMethod; effectiveAt: string; note: string | null }[] = [];
	for (const item of raw) {
		const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
		const walletKey = typeof r.walletKey === 'string' ? r.walletKey.trim() : '';
		if (!WALLET_KEY_RE.test(walletKey) || /unassigned$|^unresolved$|^unallocated$|^transit$/.test(walletKey)) return { ok: false, error: 'wallet_invalid' };
		if (!isIdentificationMethod(r.method)) return { ok: false, error: 'method_invalid' };
		let effectiveAt = nowIso;
		if (r.effectiveAt !== undefined && r.effectiveAt !== null && r.effectiveAt !== '') {
			const ms = typeof r.effectiveAt === 'string' ? Date.parse(r.effectiveAt) : Number.NaN;
			if (!Number.isFinite(ms)) return { ok: false, error: 'effective_invalid' };
			if (ms < nowMs) return { ok: false, error: 'effective_before_recorded' };
			effectiveAt = new Date(ms).toISOString();
		}
		let note: string | null = null;
		if (r.note !== undefined && r.note !== null) {
			if (typeof r.note !== 'string') return { ok: false, error: 'note_too_long' };
			const trimmed = r.note.trim();
			if (trimmed.length > NOTE_MAX) return { ok: false, error: 'note_too_long' };
			note = trimmed || null;
		}
		out.push({ walletKey, method: r.method, effectiveAt, note });
	}
	return { ok: true, entries: out };
}

// ── Exchange-held accounts ───────────────────────────────────────────────────

/** An exchange account (cex:...) holds the coins, so the exchange also has to be told. */
export function isExchangeHeld(walletKey: string): boolean {
	return walletKey.toLowerCase().startsWith('cex:');
}

export type ExchangeStatus = 'not_needed' | 'not_confirmed' | 'confirmed';

export function exchangeStatusOf(walletKey: string, confirmedIds: ReadonlySet<string>, id: string): ExchangeStatus {
	if (!isExchangeHeld(walletKey)) return 'not_needed';
	return confirmedIds.has(id) ? 'confirmed' : 'not_confirmed';
}
