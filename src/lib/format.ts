/**
 * The one way the app writes money, token amounts and dates (Area 3 of the shared pieces plan).
 *
 * Decisions (Oct 25, 2026):
 *   D1  Dollars look like `$1,234.56` (en-US) in every language, on screens and in files.
 *   D2  Dates on screens follow the user's language (`Oct 25, 2026`, `25 oct 2026`,
 *       `25 oct. 2026`). Reports, CSVs and PDFs keep their fixed English formats, in UTC.
 *
 * Pure and isomorphic (no DOM, no Node), so React islands, bundled Astro scripts, frontmatter
 * and API routes all import the same functions. An inline script (`<script is:inline>`) cannot
 * import; compute the text in the frontmatter and pass it in a `data-` attribute instead.
 *
 * Nothing here throws. A value that is not a number or not a date comes back as `empty`
 * (default `—`) or, for dates, as the text it was given.
 */

import type { Lang } from './i18n/locale';
import { plainNumber, rawToDecimal } from './decimalText';

export type { Lang };

const EM = '—';

// ─── Dollars (D1) ─────────────────────────────────────────────────────────────

export interface UsdOptions {
	/**
	 * true: always a sign, `+$5.00` / `-$5.00` (and `+$0.00`). false (default): only a minus.
	 */
	signed?: boolean;
	/**
	 * true (default): two decimals, `$1,234.50`. false: whole dollars, `$1,235`.
	 * A number: exactly that many decimals (`$0.0123`, `$3.1000` with 4), for token prices.
	 */
	cents?: boolean | number;
	/** What a missing value (null, undefined, NaN, Infinity) shows. Default `—`. */
	empty?: string;
	/** `$1.2K`, `$3.4M`: en-US compact notation, one decimal at most. */
	compact?: boolean;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions, locale = 'en-US'): Intl.NumberFormat {
	const k = `${locale}|${key}`;
	let f = numberFormats.get(k);
	if (!f) {
		f = new Intl.NumberFormat(locale, opts);
		numberFormats.set(k, f);
	}
	return f;
}

/** A finite number, or null. Numeric strings count ("12.5"); '' and null do not. */
export function toFiniteNumber(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	if (typeof v === 'bigint') return Number(v);
	return null;
}

function usdDigits(cents: UsdOptions['cents']): { min: number; max: number } {
	if (cents === false) return { min: 0, max: 0 };
	if (typeof cents === 'number' && Number.isFinite(cents)) {
		const n = Math.min(20, Math.max(0, Math.floor(cents)));
		return { min: n, max: n };
	}
	return { min: 2, max: 2 };
}

/**
 * Dollars, en-US, in every language (D1): `$1,234.56`, `-$1,234.56`, `+$5.00` when `signed`.
 * The sign is the value's own (`v < 0`), written before the `$`, so -0 shows `$0.00`.
 */
export function formatUsd(value: unknown, opts: UsdOptions = {}): string {
	const n = toFiniteNumber(value);
	if (n === null) return opts.empty ?? EM;
	const sign = n < 0 ? '-' : opts.signed ? '+' : '';
	const abs = Math.abs(n);
	if (opts.compact) {
		return `${sign}$${nf('compact', { notation: 'compact', maximumFractionDigits: 1 }).format(abs)}`;
	}
	const { min, max } = usdDigits(opts.cents);
	return `${sign}$${nf(`d${min}-${max}`, { minimumFractionDigits: min, maximumFractionDigits: max }).format(abs)}`;
}

// ─── Other currencies (receivables) ───────────────────────────────────────────

export interface MoneyOptions {
	/**
	 * Least decimals shown. 2 (default): `NGN 1,234.00`. 0: trailing zeros dropped,
	 * `NGN 1,234` and `NGN 1,234.5` (what the two milestone pages show today).
	 */
	minDecimals?: 0 | 2;
}

/**
 * An amount in a currency named by its code, en-US digits: `NGN 1,234.00`. The code is written as
 * given. A missing or zero amount shows as 0 (`NGN 0.00`), as the receivables pages always have.
 */
export function formatMoney(value: unknown, currency: string, opts: MoneyOptions = {}): string {
	const n = toFiniteNumber(value) ?? 0;
	const min = opts.minDecimals ?? 2;
	return `${currency} ${nf(`d${min}-2`, { minimumFractionDigits: min, maximumFractionDigits: 2 }).format(n)}`;
}

// ─── Token amounts ────────────────────────────────────────────────────────────

export interface QtyOptions {
	/** Most decimals kept, cut (not rounded) so a balance is never shown larger than it is. Default: all. */
	maxDecimals?: number;
	/** Thousands separators in the whole part (`1,234,567.5`). Default true. */
	group?: boolean;
	/** What a value that is not a number shows. Default `—`. */
	empty?: string;
	/** Smallest-unit decimals: formatQty('1500000000000000000', { decimals: 18 }) → `1.5`. */
	decimals?: number;
}

/**
 * A token amount written exactly, from decimal text or a number, with no floating-point
 * arithmetic on the digits: `1,234,567.891234`, `-0.00012`. Built on plainNumber / rawToDecimal
 * (decimalText.ts, which historyRows.ts uses too), so a balance prints the same digits here and
 * in the history tables.
 */
export function formatQty(value: unknown, opts: QtyOptions = {}): string {
	const empty = opts.empty ?? EM;
	let text: string;
	let negative = false;
	if (opts.decimals !== undefined) {
		const raw = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
		negative = raw.startsWith('-');
		text = rawToDecimal(raw, opts.decimals);
	} else {
		const raw = typeof value === 'string' ? value.trim() : value;
		if (raw === '' || raw === null || raw === undefined) return empty;
		const n = toFiniteNumber(raw);
		if (n === null) return empty;
		negative = typeof raw === 'string' ? raw.startsWith('-') : n < 0;
		// A string keeps all its digits; a number is written as JavaScript would print it.
		text = typeof raw === 'string' && /^[-+]?\d*\.?\d+$/.test(raw) ? raw.replace(/^[-+]/, '').replace(/^0+(?=\d)/, '') : plainNumber(n);
	}
	if (!text) return empty;
	let [whole, fraction = ''] = text.split('.');
	if (whole === '') whole = '0';
	if (opts.maxDecimals !== undefined) fraction = fraction.slice(0, Math.max(0, Math.floor(opts.maxDecimals)));
	fraction = fraction.replace(/0+$/, '');
	if (opts.group !== false) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	const body = fraction ? `${whole}.${fraction}` : whole;
	return negative && /[1-9]/.test(body) ? `-${body}` : body;
}

/**
 * A number rounded to at most `maxDecimals`, en-US digits (`1,234,567.891234`): how the tax files
 * write token amounts. It rounds the floating-point value, so prefer formatQty on screens; this one
 * exists so those files keep their bytes. A value that is not a finite number shows `empty`.
 */
export function formatAmount(value: unknown, maxDecimals: number, opts: { empty?: string } = {}): string {
	const n = toFiniteNumber(value);
	if (n === null) return opts.empty ?? EM;
	return nf(`a${maxDecimals}`, { maximumFractionDigits: maxDecimals }).format(n);
}

// ─── Numbers and percents in the user's language ──────────────────────────────

/** The BCP 47 locale each language formats dates and plain numbers with. */
export const INTL_LOCALE: Record<Lang, string> = {
	en: 'en-US',
	es: 'es-ES',
	fr: 'fr-FR',
};

/** A plain number in the user's language (`1,234.5`, `1.234,5`, `1 234,5`). */
export function formatNumber(n: number, lang: Lang, opts: Intl.NumberFormatOptions = {}): string {
	try {
		return new Intl.NumberFormat(INTL_LOCALE[lang], opts).format(n);
	} catch {
		return String(n);
	}
}

/** `fraction` is a ratio: 0.0825 → `8.25%` (`8,25 %` in French). */
export function formatPercent(fraction: number, lang: Lang, maximumFractionDigits = 2): string {
	try {
		return new Intl.NumberFormat(INTL_LOCALE[lang], {
			style: 'percent',
			minimumFractionDigits: 0,
			maximumFractionDigits,
		}).format(fraction);
	} catch {
		return `${(fraction * 100).toFixed(maximumFractionDigits)}%`;
	}
}

// ─── Dates on screens (D2) ────────────────────────────────────────────────────

/**
 *   medium   Oct 25, 2026 · 25 oct 2026 · 25 oct. 2026
 *   long     October 25, 2026 · 25 de octubre de 2026 · 25 octobre 2026
 *   short    10/25/2026 · 25/10/2026 · 25/10/2026
 *   numeric  10/25/2026 · 25/10/2026 · 25/10/2026 (no leading zeros: 1/2/2026 · 2/1/2026)
 *   dayMonth Oct 25 · 25 oct · 25 oct.
 *   monthYear Oct 2026 · oct 2026 · oct. 2026
 */
export type DateStyle = 'medium' | 'long' | 'short' | 'numeric' | 'dayMonth' | 'monthYear';

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
	medium: { year: 'numeric', month: 'short', day: 'numeric' },
	long: { year: 'numeric', month: 'long', day: 'numeric' },
	short: { year: 'numeric', month: '2-digit', day: '2-digit' },
	numeric: { year: 'numeric', month: 'numeric', day: 'numeric' },
	dayMonth: { month: 'short', day: 'numeric' },
	monthYear: { year: 'numeric', month: 'short' },
};

export interface DateOptions {
	/** Default `medium`. */
	style?: DateStyle;
	/** `UTC` for a stored calendar day or a file; default: the reader's own zone. */
	timeZone?: 'UTC';
	/** What a missing value (null, undefined, '') shows. Default `—`. */
	empty?: string;
	/** What an unreadable value shows. Default: the text as given (or `empty` for a non-string). */
	invalid?: string;
}

export interface DateTimeOptions extends DateOptions {
	/** Show seconds. Default false. */
	seconds?: boolean;
}

const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Date from what the app stores: ISO with a zone, `YYYY-MM-DD HH:MM:SS` (UTC, the database's
 * shape), epoch milliseconds, or a Date. A bare `YYYY-MM-DD` is that calendar day, read at UTC
 * midnight (pair it with `timeZone: 'UTC'` to show that same day everywhere). Null when unreadable.
 */
export function toDate(value: unknown): Date | null {
	if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
	if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
	if (typeof value !== 'string') return null;
	const s = value.trim();
	if (!s) return null;
	const text = NAIVE_DATETIME.test(s) ? `${s.replace(' ', 'T')}Z` : DAY_ONLY.test(s) ? `${s}T00:00:00Z` : s;
	const ms = Date.parse(text);
	return Number.isFinite(ms) ? new Date(ms) : null;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dtf(lang: Lang, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const k = `${lang}|${key}|${opts.timeZone ?? ''}`;
	let f = dateFormats.get(k);
	if (!f) {
		f = new Intl.DateTimeFormat(INTL_LOCALE[lang] ?? INTL_LOCALE.en, opts);
		dateFormats.set(k, f);
	}
	return f;
}

function notADate(value: unknown, opts: DateOptions): string {
	if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return opts.empty ?? EM;
	if (opts.invalid !== undefined) return opts.invalid;
	return typeof value === 'string' ? value : opts.empty ?? EM;
}

/** A day on a screen, in the user's language (D2): `Oct 25, 2026` / `25 oct 2026` / `25 oct. 2026`. */
export function formatDate(value: unknown, lang: Lang, opts: DateOptions = {}): string {
	const d = toDate(value);
	if (!d) return notADate(value, opts);
	const style = opts.style ?? 'medium';
	return dtf(lang, `d:${style}`, { ...DATE_STYLES[style], timeZone: opts.timeZone }).format(d);
}

/**
 * A day and time on a screen, in the user's language (D2): `Oct 25, 2026, 3:04 PM` /
 * `25 oct 2026, 15:04` / `25 oct. 2026, 15:04`.
 */
export function formatDateTime(value: unknown, lang: Lang, opts: DateTimeOptions = {}): string {
	const d = toDate(value);
	if (!d) return notADate(value, opts);
	const style = opts.style ?? 'medium';
	const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', ...(opts.seconds ? { second: '2-digit' } : {}) };
	return dtf(lang, `dt:${style}:${opts.seconds ? 's' : ''}`, { ...DATE_STYLES[style], ...time, timeZone: opts.timeZone }).format(d);
}

/** A time of day on a screen, in the user's language: `3:04 PM` / `15:04`. */
export function formatTime(value: unknown, lang: Lang, opts: Omit<DateTimeOptions, 'style'> = {}): string {
	const d = toDate(value);
	if (!d) return notADate(value, opts);
	const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', ...(opts.seconds ? { second: '2-digit' } : {}) };
	return dtf(lang, `t:${opts.seconds ? 's' : ''}`, { ...time, timeZone: opts.timeZone }).format(d);
}

// ─── Dates in files (fixed, English, UTC) ─────────────────────────────────────

/**
 * A day in a report, CSV or PDF: always English, always UTC (D2 leaves files as they are), in
 * any of the screen styles: `Oct 25, 2026`, `October 25, 2026`, `10/25/2026`, `1/2/2026`.
 */
export function formatFileDate(value: unknown, opts: Omit<DateOptions, 'timeZone'> = {}): string {
	return formatDate(value, 'en', { ...opts, timeZone: 'UTC' });
}

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

/** `2026-10-18 09:10:00 UTC` from an ISO-8601 UTC time. Anything that is not one is shown as it is. */
export function formatUtc(iso: string): string {
	const m = ISO.exec(iso);
	return m ? `${m[1]} ${m[2]} UTC` : iso;
}
