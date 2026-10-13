// src/lib/transferMatcher.ts
//
// Transfer matching engine — finds pairs of (out, in) transactions across
// different sources/accounts that represent the same coins moving through
// the user's ecosystem (e.g. Crypto.com withdrawal → Exodus deposit).
//
// Design principles:
//   • Raw transaction data is NEVER modified. Matches are annotations only.
//   • Multiple independent signals must agree before auto-confirming.
//   • Every match records which signals fired and their scores (audit trail).
//   • Any match can be rejected by the user and reverts to unmatched.
//   • Re-running is always safe — ON CONFLICT DO NOTHING prevents duplicates.

import { randomUUID } from 'node:crypto';
import { db } from './db';

// ─── Types ────────────────────────────────────────────────────────────────────

type TxRow = {
	id: string;
	tenant_id: string;
	source: string;
	account_id: string | null;
	timestamp_utc: string;
	direction: string;
	asset_symbol: string;
	amount: number | null;
	to_currency: string | null;
	to_amount: number | null;
	tx_hash: string | null;
	description: string | null;
	kind: string | null;
};

type Signal = { signal: string; points: number };

type MatchCandidate = {
	inTx: TxRow;
	score: number;
	signals: Signal[];
	fee: number | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

// Confidence thresholds
const THRESHOLD_AUTO_HIGH   = 90;  // silent auto-match
const THRESHOLD_AUTO_MEDIUM = 60;  // auto-match, shown as pending review
const THRESHOLD_SUGGEST     = 35;  // surface as suggestion only

// Time window: transfers can take up to 72 hours (Bitcoin can be slow)
const MAX_TRANSFER_WINDOW_MS = 72 * 60 * 60 * 1000;

// Fee tolerance: allow up to 2% difference between out and in amounts
const FEE_TOLERANCE_PCT = 0.02;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizeSymbol = (s: string): string => {
	const u = s.trim().toUpperCase();
	if (u === 'MATIC' || u === 'WMATIC') return 'POL';
	if (u === 'WBTC') return 'BTC';
	if (u === 'WETH') return 'ETH';
	if (u.endsWith('.E')) return u.slice(0, -2);
	return u;
};

// Extract the effective quantity for an asset from a transaction row.
// For swap rows (currency=USD, to_currency=BTC) the qty is in to_amount.
const effectiveQty = (tx: TxRow): number => {
	const sym = normalizeSymbol(tx.asset_symbol);
	if (tx.to_currency && normalizeSymbol(tx.to_currency) === sym && tx.to_amount != null) {
		return Math.abs(tx.to_amount);
	}
	return tx.amount != null ? Math.abs(tx.amount) : 0;
};

// Parse a UTC timestamp string into a JS Date, tolerating multiple formats.
const parseTs = (s: string): Date => new Date(s.replace(' UTC', 'Z').replace(' ', 'T'));

// ─── Score a single (out, in) candidate pair ──────────────────────────────────

function scoreCandidate(outTx: TxRow, inTx: TxRow): MatchCandidate | null {
	const signals: Signal[] = [];
	let score = 0;

	const outQty = effectiveQty(outTx);
	const inQty  = effectiveQty(inTx);
	if (outQty === 0 || inQty === 0) return null;

	// ── Signal 1: tx_hash identity (gold standard) ───────────────────────────
	if (
		outTx.tx_hash && inTx.tx_hash &&
		outTx.tx_hash.length > 20 &&
		outTx.tx_hash.toLowerCase() === inTx.tx_hash.toLowerCase()
	) {
		signals.push({ signal: 'tx_hash_match', points: 100 });
		score += 100;
	}

	// ── Signal 2: address cross-reference ────────────────────────────────────
	// Some CSVs embed the destination address in the description field.
	// If the same address appears in outTx.description and inTx.description
	// (or inTx's account address field) it's strong corroborating evidence.
	if (outTx.description && inTx.description) {
		// Extract hex-like or base58-like substrings ≥ 20 chars
		const addrRe = /[A-Za-z0-9]{20,}/g;
		const outAddrs = new Set((outTx.description.match(addrRe) ?? []).map(a => a.toLowerCase()));
		const inAddrs  = new Set((inTx.description.match(addrRe)  ?? []).map(a => a.toLowerCase()));
		const overlap  = [...outAddrs].filter(a => inAddrs.has(a));
		if (overlap.length > 0) {
			signals.push({ signal: 'address_in_description', points: 50 });
			score += 50;
		}
	}

	// ── Signal 3: amount within fee tolerance ────────────────────────────────
	const feePct = outQty > 0 ? (outQty - inQty) / outQty : 1;
	const fee    = outQty - inQty;

	if (feePct >= 0 && feePct <= FEE_TOLERANCE_PCT) {
		// Full 40 pts at 0 diff, scaled down toward 2%
		const pts = Math.round(40 * (1 - feePct / FEE_TOLERANCE_PCT));
		signals.push({ signal: 'amount_within_tolerance', points: pts });
		score += pts;
	} else {
		// Amounts don't match at all — not a valid transfer
		return null;
	}

	// ── Signal 4: timestamp ordering + window ────────────────────────────────
	const outTs = parseTs(outTx.timestamp_utc).getTime();
	const inTs  = parseTs(inTx.timestamp_utc).getTime();
	const diffMs = inTs - outTs;

	if (diffMs < 0) return null; // deposit can't come before withdrawal

	if (diffMs <= MAX_TRANSFER_WINDOW_MS) {
		// 30 pts within same hour, scaled to 5 pts at 72h
		const hoursDiff = diffMs / (60 * 60 * 1000);
		const pts = Math.max(5, Math.round(30 * (1 - hoursDiff / 72)));
		signals.push({ signal: 'timestamp_window', points: pts });
		score += pts;
	} else {
		return null; // outside window
	}

	// ── Signal 5: exact amount match bonus ───────────────────────────────────
	if (Math.abs(outQty - inQty) < 0.000001) {
		signals.push({ signal: 'exact_amount_match', points: 10 });
		score += 10;
	}

	// Minimum threshold to be worth storing
	if (score < THRESHOLD_SUGGEST) return null;

	return {
		inTx,
		score,
		signals,
		fee: fee > 0.000001 ? fee : null,
	};
}

// ─── Determine initial status from score ─────────────────────────────────────

function statusFromScore(score: number): string {
	if (score >= THRESHOLD_AUTO_HIGH)   return 'auto';
	if (score >= THRESHOLD_AUTO_MEDIUM) return 'auto';
	return 'suggested';
}

// ─── Write a match + update address_labels ───────────────────────────────────

async function persistMatch(
	tenantId: string,
	outTx: TxRow,
	best: MatchCandidate,
): Promise<void> {
	const matchId = randomUUID();
	const status  = statusFromScore(best.score);

	await db.execute({
		sql: `INSERT INTO transfer_matches
		        (id, tenant_id, out_tx_id, in_tx_id, asset_symbol,
		         out_amount, in_amount, fee_amount, confidence_score,
		         signals_json, status)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO NOTHING`,
		args: [
			matchId,
			tenantId,
			outTx.id,
			best.inTx.id,
			normalizeSymbol(outTx.asset_symbol),
			effectiveQty(outTx),
			effectiveQty(best.inTx),
			best.fee ?? null,
			best.score,
			JSON.stringify(best.signals),
			status,
		],
	});

	// Auto-build address labels from high-confidence matches:
	// label the in-side source with the out-side source name.
	if (best.score >= THRESHOLD_AUTO_MEDIUM) {
		const outLabel   = outTx.source;   // e.g. 'crypto_com'
		const inLabel    = inTx_label(best.inTx);
		const inCategory = inTx_category(best.inTx.source);

		// Label the in account address so it shows up everywhere
		const inAddress = best.inTx.account_id
			? `cex:${best.inTx.source}:${best.inTx.account_id}`
			: null;

		if (inAddress) {
			await db.execute({
				sql: `INSERT INTO address_labels (id, tenant_id, address, label, source, category)
				      VALUES (?, ?, ?, ?, 'auto', ?)
ON CONFLICT DO NOTHING`,
				args: [randomUUID(), tenantId, inAddress, inLabel, inCategory],
			}).catch(() => { /* non-fatal: label may already exist */ });
		}

		// Label any raw destination address found in the out description
		if (outTx.description) {
			const addrMatch = outTx.description.match(/\b([A-Za-z0-9]{25,})\b/);
			if (addrMatch) {
				const rawAddr = addrMatch[1];
				await db.execute({
					sql: `INSERT INTO address_labels (id, tenant_id, address, label, source, category)
					      VALUES (?, ?, ?, ?, 'auto', ?)
ON CONFLICT DO NOTHING`,
					args: [randomUUID(), tenantId, rawAddr, inLabel, inCategory],
				}).catch(() => { /* non-fatal */ });
			}
		}
	}
}

// Sources that are centralized exchange platforms — their addresses must not be
// auto-classified as own-wallet transfers (sending to Coinbase could be a deposit
// to your own account OR a disposal to another user; only both-sides-confirmed
// transfer matches can resolve that ambiguity).
const EXCHANGE_SOURCES = new Set([
	'coinbase', 'crypto_com', 'gemini', 'kraken',
	'venmo', 'cashapp', 'robinhood', 'binance',
]);

function inTx_label(inTx: TxRow): string {
	const map: Record<string, string> = {
		coinbase:   'Coinbase',
		crypto_com: 'Crypto.com',
		gemini:     'Gemini',
		kraken:     'Kraken',
		exodus:     'Exodus',
		venmo:      'Venmo',
		cashapp:    'Cash App',
		robinhood:  'Robinhood',
	};
	return map[inTx.source] ?? inTx.source;
}

function inTx_category(source: string): string {
	return EXCHANGE_SOURCES.has(source) ? 'exchange' : 'own_wallet';
}

// ─── Main matching function ───────────────────────────────────────────────────

/**
 * Runs the transfer matching engine for a tenant.
 * Safe to call after every CSV import — ON CONFLICT DO NOTHING prevents duplicates.
 *
 * If accountId is provided, only out-transactions from that account are
 * scanned as new candidates (much faster for post-import incremental runs).
 * The in-side search is always tenant-wide.
 */
export async function runTransferMatching(
	tenantId: string,
	accountId?: string,
): Promise<{ matched: number; skipped: number }> {
	let matched = 0;
	let skipped = 0;

	// Load unmatched OUT transactions
	const outResult = await db.execute({
		sql: `SELECT t.*
		      FROM import_transactions t
		      LEFT JOIN transfer_matches m ON m.tenant_id = t.tenant_id AND m.out_tx_id = t.id
		      WHERE t.tenant_id = ?
		        AND t.direction = 'out'
		        AND m.id IS NULL
		        ${accountId ? 'AND t.account_id = ?' : ''}
		        AND t.asset_symbol IS NOT NULL
		      ORDER BY t.timestamp_utc ASC`,
		args: accountId ? [tenantId, accountId] : [tenantId],
	});

	if (!outResult.rows.length) return { matched, skipped };

	// Load ALL in-transactions for this tenant (candidate pool)
	const inResult = await db.execute({
		sql: `SELECT t.*
		      FROM import_transactions t
		      LEFT JOIN transfer_matches m ON m.tenant_id = t.tenant_id AND m.in_tx_id = t.id
		      WHERE t.tenant_id = ?
		        AND t.direction = 'in'
		        AND m.id IS NULL
		        AND t.asset_symbol IS NOT NULL
		      ORDER BY t.timestamp_utc ASC`,
		args: [tenantId],
	});

	// Group in-transactions by normalised symbol for fast lookup
	const inBySymbol = new Map<string, TxRow[]>();
	for (const row of inResult.rows) {
		const tx = row as unknown as TxRow;
		const sym = normalizeSymbol(tx.asset_symbol ?? '');
		if (!sym) continue;
		const list = inBySymbol.get(sym) ?? [];
		list.push(tx);
		inBySymbol.set(sym, list);
	}

	for (const row of outResult.rows) {
		const outTx = row as unknown as TxRow;
		if (!outTx.asset_symbol) { skipped++; continue; }

		const sym = normalizeSymbol(outTx.asset_symbol);
		const candidates = inBySymbol.get(sym) ?? [];

		// Hard guard: never match to the same source+account
		const validCandidates = candidates.filter(
			inTx => !(inTx.source === outTx.source && inTx.account_id === outTx.account_id)
		);

		// Score every candidate and pick the best
		let best: MatchCandidate | null = null;
		let bestCount = 0;

		for (const inTx of validCandidates) {
			const candidate = scoreCandidate(outTx, inTx);
			if (!candidate) continue;
			bestCount++;
			if (!best || candidate.score > best.score) {
				best = candidate;
			}
		}

		if (!best) { skipped++; continue; }

		// If multiple candidates score above threshold, lower confidence
		// to avoid a wrong auto-match — flag for user review instead
		if (bestCount > 1 && best.score < THRESHOLD_AUTO_HIGH) {
			best.score = Math.max(THRESHOLD_SUGGEST, best.score - 20);
			best.signals.push({ signal: 'ambiguous_multiple_candidates', points: -20 });
		}

		await persistMatch(tenantId, outTx, best);

		// Remove matched in-tx from the pool so it can't match twice
		const list = inBySymbol.get(sym) ?? [];
		const idx = list.indexOf(best.inTx);
		if (idx !== -1) list.splice(idx, 1);

		matched++;
	}

	console.log('[transferMatcher] run complete', { tenantId, accountId: accountId ?? 'all', matched, skipped });
	return { matched, skipped };
}
