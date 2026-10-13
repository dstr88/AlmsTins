/**
 * historyExport.ts: turns the rows from historyRows.ts into files.
 *
 *   Plain CSV (every plan, GET /api/transactions/export): one file, with an Owner column (whose
 *   account each row is in, from the same resolver as the ZIP) and no wallet or label columns.
 *   History by wallet (paid plans, GET /api/records/history-by-wallet): a ZIP with
 *     all-wallets.csv   every row, sorted by Owner, then Wallet, then time
 *     wallets/NN-*.csv  one file per wallet (safe names: a number and the wallet's name)
 *     wallets.csv       the index: key, wallet, owner, account type, address or account,
 *                       first and last date, row count, file; a header note on top
 *
 * Every cell goes through csvCell(): a cell that starts with = + - @, a tab or a carriage
 * return gets a leading ' so a spreadsheet shows it as text instead of running it (token
 * symbols come from the blockchain, and labels are typed by people). Numbers are written
 * without a sign, so no number is changed by this.
 *
 * Only the tenant's own rows and the tenant's own address labels go in; nothing is looked up
 * outside Almstins while the file is built.
 *
 * Memory: both files are built in memory, so a build is refused above MAX_HISTORY_ROWS rows
 * (counted before anything is loaded; the routes answer 413), and one account builds one file
 * at a time (a second request while one is building gets HistoryBusyError, a 429).
 */

import JSZip from 'jszip';
import { db } from './db';
import { loadHistoryRows, MAX_HISTORY_ROWS, type HistoryRow } from './historyRows';
import {
	addressLookupKey,
	chainDisplayName,
	loadWalletDirectory,
	resolveWalletRef,
	sourceDisplayName,
	type WalletDirectory,
	type WalletIdentity,
} from './walletIdentity';
import type { Lang } from './i18n/locale';
import { getHistoryExport, type HistoryFileStrings } from '@/i18n/historyExport';

// ── CSV cells ────────────────────────────────────────────────────────────────

const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefix ' to text a spreadsheet would read as a formula. */
export function escapeFormula(value: unknown): string {
	const s = value == null ? '' : String(value);
	return FORMULA_START.test(s) ? `'${s}` : s;
}

/** One CSV cell: formula-escaped, then quoted when it holds a quote, comma or line break. */
export function csvCell(value: unknown): string {
	const s = escapeFormula(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: readonly unknown[]): string {
	return cells.map(csvCell).join(',');
}

/** A whole file: UTF-8 BOM (so Excel reads accents), CRLF line ends. */
export function csvDocument(lines: readonly string[]): string {
	return `﻿${lines.join('\r\n')}\r\n`;
}

/** Filesystem-safe name part: ASCII letters and digits, dashes, at most 40 characters. */
export function fileSlug(text: unknown, fallback = 'wallet'): string {
	const s = String(text ?? '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase()
		.slice(0, 40)
		.replace(/-+$/g, '');
	return s || fallback;
}

/** ?year= : absent → all years; a 4-digit year from 2009 to next year → that year; anything else → invalid. */
export function parseYearParam(raw: string | null, now = new Date()): { ok: true; year?: number } | { ok: false } {
	if (raw === null || raw === '') return { ok: true };
	if (!/^\d{4}$/.test(raw)) return { ok: false };
	const year = Number(raw);
	if (year < 2009 || year > now.getUTCFullYear() + 1) return { ok: false };
	return { ok: true, year };
}

// ── Labels and identities ────────────────────────────────────────────────────

/** The tenant's own address labels, by address (lowercased, as address_labels stores them). */
export async function loadCounterpartyLabels(tenantId: string): Promise<Map<string, string>> {
	const res = await db.execute({
		sql: `SELECT al.address, al.label FROM address_labels al
		      WHERE al.tenant_id = ?
		      ORDER BY CASE WHEN al.source = 'user' THEN 0 ELSE 1 END, al.created_at DESC`,
		args: [tenantId],
	});
	const out = new Map<string, string>();
	for (const r of res.rows as Record<string, unknown>[]) {
		const address = String(r.address ?? '').trim().toLowerCase();
		const label = String(r.label ?? '').trim();
		if (address && label && !out.has(address)) out.set(address, label);
	}
	return out;
}

export interface ResolvedRow {
	row: HistoryRow;
	identity: WalletIdentity;
	counterpartyLabel: string;
}

const refSignature = (row: HistoryRow) =>
	row.ref.kind === 'wallet' ? `w|${row.ref.walletId ?? ''}|${row.ref.chain}` : `a|${row.ref.source}|${row.ref.accountId ?? ''}`;

export function resolveRows(
	rows: readonly HistoryRow[],
	dir: WalletDirectory,
	labels: ReadonlyMap<string, string>,
	strings: HistoryFileStrings,
): ResolvedRow[] {
	const cache = new Map<string, WalletIdentity>();
	const identityOf = (row: HistoryRow) => {
		const sig = refSignature(row);
		let id = cache.get(sig);
		if (!id) {
			id = resolveWalletRef(dir, row.ref, strings);
			cache.set(sig, id);
		}
		return id;
	};
	return rows.map((row) => {
		let counterpartyLabel = '';
		if (row.counterparty) {
			counterpartyLabel = labels.get(row.counterparty.trim().toLowerCase()) ?? '';
			if (!counterpartyLabel) {
				// One of the tenant's own wallets on the same chain: its wallet name.
				const own = dir.walletsByAddress.get(addressLookupKey(row.counterparty));
				if (own) counterpartyLabel = resolveWalletRef(dir, { kind: 'wallet', walletId: own.id, chain: row.chain }, strings).label;
			}
		}
		return { row, identity: identityOf(row), counterpartyLabel };
	});
}

// ── File contents ────────────────────────────────────────────────────────────

function notesFor(row: HistoryRow, strings: HistoryFileStrings): string {
	if (!row.failed) return row.notes;
	return row.notes ? `${strings.failedTx} ${row.notes}` : strings.failedTx;
}

function chainCell(row: HistoryRow, strings: HistoryFileStrings): string {
	return row.chain ? chainDisplayName(row.chain, strings) : '';
}

export function walletHeader(strings: HistoryFileStrings): string[] {
	const c = strings.columns;
	return [
		c.wallet, c.owner, c.accountType, c.walletKey, c.addressOrAccount, c.chain, c.date, c.direction, c.asset, c.amount,
		c.usdValue, c.fee, c.feeAsset, c.txHash, c.counterparty, c.counterpartyLabel, c.category, c.notes, c.transferId,
		c.transferOtherWallet,
	];
}

export function walletCells(r: ResolvedRow, strings: HistoryFileStrings): string[] {
	const { row, identity } = r;
	return [
		identity.label,
		identity.ownerLabel ?? strings.ownerNotSet,
		strings.accountTypes[identity.accountType],
		identity.key,
		identity.addressOrAccount,
		chainCell(row, strings),
		row.date,
		row.direction,
		row.asset,
		row.amount,
		row.usdValue,
		row.fee,
		row.feeAsset,
		row.txHash,
		row.counterparty,
		r.counterpartyLabel,
		row.category,
		notesFor(row, strings),
		'', // Transfer ID: slice 4 links both sides of a transfer between your own wallets
		'', // Transfer other wallet: slice 4
	];
}

export function plainHeader(strings: HistoryFileStrings): string[] {
	const c = strings.plainColumns;
	return [c.date, c.source, c.owner, c.chain, c.direction, c.asset, c.amount, c.usdValue, c.fee, c.feeAsset, c.txHash, c.counterparty, c.category, c.notes];
}

export function plainCells(row: HistoryRow, strings: HistoryFileStrings, ownerLabel: string | null = null): string[] {
	const source = row.origin === 'import' ? sourceDisplayName(row.source, strings) : chainDisplayName(row.chain, strings);
	return [
		row.date,
		source,
		ownerLabel ?? strings.ownerNotSet,
		chainCell(row, strings),
		row.direction,
		row.asset,
		row.amount,
		row.usdValue,
		row.fee,
		row.feeAsset,
		row.txHash,
		row.counterparty,
		row.category,
		notesFor(row, strings),
	];
}

/**
 * Each row's owner label, from the same resolver as the ZIP (resolved once per wallet).
 * null where no owner is set.
 */
export function rowOwners(rows: readonly HistoryRow[], dir: WalletDirectory, strings: HistoryFileStrings): (string | null)[] {
	const cache = new Map<string, string | null>();
	return rows.map((row) => {
		const sig = refSignature(row);
		if (!cache.has(sig)) cache.set(sig, resolveWalletRef(dir, row.ref, strings).ownerLabel);
		return cache.get(sig)!;
	});
}

/** The plain CSV: every row in time order, with each row's owner (owners[i] for rows[i]). */
export function buildPlainCsv(rows: readonly HistoryRow[], strings: HistoryFileStrings, owners: readonly (string | null)[] = []): string {
	return csvDocument([csvLine(plainHeader(strings)), ...rows.map((r, i) => csvLine(plainCells(r, strings, owners[i] ?? null)))]);
}

// ── Grouping ─────────────────────────────────────────────────────────────────

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export interface WalletGroup {
	identity: WalletIdentity;
	rows: ResolvedRow[];
	file: string;
}

/** Owners that are set first (alphabetical), then the unset ones; then wallet name; then key. */
export function compareIdentities(a: WalletIdentity, b: WalletIdentity): number {
	if (!!a.ownerLabel !== !!b.ownerLabel) return a.ownerLabel ? -1 : 1;
	if (a.ownerLabel && b.ownerLabel) {
		const o = collator.compare(a.ownerLabel, b.ownerLabel);
		if (o) return o;
	}
	const l = collator.compare(a.label, b.label);
	if (l) return l;
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Rows grouped by wallet key, groups in owner/wallet order, each group in time order. */
export function groupByWallet(resolved: readonly ResolvedRow[]): WalletGroup[] {
	const byKey = new Map<string, WalletGroup>();
	for (const r of resolved) {
		let g = byKey.get(r.identity.key);
		if (!g) {
			g = { identity: r.identity, rows: [], file: '' };
			byKey.set(r.identity.key, g);
		}
		g.rows.push(r);
	}
	const groups = [...byKey.values()].sort((a, b) => compareIdentities(a.identity, b.identity));
	const width = Math.max(2, String(groups.length).length);
	groups.forEach((g, i) => {
		g.file = `wallets/${String(i + 1).padStart(width, '0')}-${fileSlug(g.identity.label)}.csv`;
	});
	return groups;
}

export interface ZipMeta {
	generatedAt: Date;
	year?: number;
}

/** The ZIP: all-wallets.csv, wallets/NN-name.csv per wallet, and the wallets.csv index. */
export async function buildHistoryZip(resolved: readonly ResolvedRow[], strings: HistoryFileStrings, meta: ZipMeta): Promise<Uint8Array> {
	const groups = groupByWallet(resolved);
	const head = `\uFEFF${csvLine(walletHeader(strings))}\r\n`;
	const zip = new JSZip();
	const date = meta.generatedAt;

	// Each wallet's rows are written once, as one block of lines; its own file and all-wallets.csv
	// both use that block (no second array of every line).
	const bodies: string[] = [];
	for (const g of groups) {
		const body = g.rows.map((r) => csvLine(walletCells(r, strings))).join('\r\n');
		bodies.push(body);
		zip.file(g.file, `${head}${body}\r\n`, { date });
	}
	zip.file('all-wallets.csv', bodies.length ? `${head}${bodies.join('\r\n')}\r\n` : head, { date });
	bodies.length = 0;

	const n = strings.notes;
	const stamp = date.toISOString();
	const period = meta.year === undefined ? n.allYears : String(meta.year);
	const indexLines = [
		csvLine([n.copyLine]),
		csvLine([n.generated(`${stamp.slice(0, 10)} ${stamp.slice(11, 19)}`, period)]),
		csvLine([n.recordsOnly]),
		csvLine([n.duplicates]),
		csvLine([n.transfers]),
	];
	if (groups.some((g) => g.identity.accountType === 'unassigned')) indexLines.push(csvLine([n.unassigned]));
	if (resolved.some((r) => r.row.direction === 'lost')) indexLines.push(csvLine([n.lost]));
	const ic = strings.indexColumns;
	indexLines.push(
		'',
		csvLine([ic.walletKey, ic.wallet, ic.owner, ic.accountType, ic.addressOrAccount, ic.firstDate, ic.lastDate, ic.rows, ic.file]),
	);
	for (const g of groups) {
		const dated = g.rows.map((r) => r.row.date).filter(Boolean);
		indexLines.push(
			csvLine([
				g.identity.key,
				g.identity.label,
				g.identity.ownerLabel ?? strings.ownerNotSet,
				strings.accountTypes[g.identity.accountType],
				g.identity.addressOrAccount,
				dated[0] ?? '',
				dated[dated.length - 1] ?? '',
				String(g.rows.length),
				g.file,
			]),
		);
	}
	zip.file('wallets.csv', csvDocument(indexLines), { date });

	return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

// ── Entry points for the two routes ──────────────────────────────────────────

/** This account already has a file being built. */
export class HistoryBusyError extends Error {
	constructor() {
		super('a history download is already being built for this account');
		this.name = 'HistoryBusyError';
	}
}

const building = new Set<string>();

/** One build per account at a time, in this process. */
async function oneBuildPerTenant<T>(tenantId: string, build: () => Promise<T>): Promise<T> {
	if (building.has(tenantId)) throw new HistoryBusyError();
	building.add(tenantId);
	try {
		return await build();
	} finally {
		building.delete(tenantId);
	}
}

/** GET /api/records/history-by-wallet: the caller has already checked the plan. */
export async function buildHistoryByWallet(
	tenantId: string,
	opts: { year?: number; lang: Lang; now?: Date },
): Promise<{ filename: string; bytes: Uint8Array }> {
	return oneBuildPerTenant(tenantId, async () => {
		const strings = getHistoryExport(opts.lang).file;
		const [rows, dir, labels] = await Promise.all([
			loadHistoryRows(tenantId, { year: opts.year }, MAX_HISTORY_ROWS),
			loadWalletDirectory(tenantId),
			loadCounterpartyLabels(tenantId),
		]);
		const bytes = await buildHistoryZip(resolveRows(rows, dir, labels, strings), strings, {
			generatedAt: opts.now ?? new Date(),
			year: opts.year,
		});
		return { filename: `almstins-history-by-wallet-${opts.year ?? 'all-years'}.zip`, bytes };
	});
}

/** GET /api/transactions/export: the wallet, when given, has already been checked to be the tenant's. */
export async function buildPlainHistory(
	tenantId: string,
	opts: { year?: number; wallet?: { id: string; address: string; label: string | null }; lang: Lang },
): Promise<{ filename: string; csv: string }> {
	return oneBuildPerTenant(tenantId, async () => {
		const strings = getHistoryExport(opts.lang).file;
		const rows = await loadHistoryRows(
			tenantId,
			{ year: opts.year, wallet: opts.wallet ? { id: opts.wallet.id, address: opts.wallet.address } : undefined },
			MAX_HISTORY_ROWS,
		);
		const dir = await loadWalletDirectory(tenantId);
		const parts = ['almstins-transactions'];
		if (opts.wallet) parts.push(fileSlug(opts.wallet.label));
		if (opts.year !== undefined) parts.push(String(opts.year));
		return { filename: `${parts.join('-')}.csv`, csv: buildPlainCsv(rows, strings, rowOwners(rows, dir, strings)) };
	});
}
