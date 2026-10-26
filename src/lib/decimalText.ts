/**
 * Amounts as exact decimal text, with no floating-point arithmetic on the digits. Pure, so the
 * history tables (historyRows.ts, server) and the shared formatter (format.ts, screens too) print
 * a balance the same way.
 */

const str = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v));

function finite(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Expand a decimal string that may be in exponent form ("1.5e-7") to plain digits. */
export function expandExponent(s: string): string {
	const m = /^(-?)(\d+)(?:\.(\d*))?e([+-]?\d+)$/i.exec(s.trim());
	if (!m) return s.trim();
	const [, sign, int, frac = '', expRaw] = m;
	const exp = Number(expRaw);
	let digits = int + frac;
	let point = int.length + exp;
	if (point <= 0) {
		digits = '0'.repeat(1 - point) + digits;
		point = 1;
	} else if (point > digits.length) {
		digits = digits + '0'.repeat(point - digits.length);
	}
	const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '');
	const fraction = digits.slice(point).replace(/0+$/, '');
	return `${sign}${whole}${fraction ? '.' + fraction : ''}`;
}

/** A number as plain decimal text, absolute value: 1e-7 → "0.0000001", -12.5 → "12.5". */
export function plainNumber(v: unknown): string {
	const n = finite(v);
	if (n === null) return '';
	const s = expandExponent(String(Math.abs(n)));
	return s === '-0' ? '0' : s;
}

/**
 * A raw integer amount in the smallest unit, exactly, as decimal text:
 * rawToDecimal('1500000000000000000', 18) → "1.5". Sign dropped. A value that already has a
 * decimal point is returned as a plain number. '' when it is not a number.
 */
export function rawToDecimal(raw: unknown, decimals: unknown): string {
	let s = str(raw).trim();
	if (!s) return '';
	if (/^0x[0-9a-f]+$/i.test(s)) {
		try {
			s = BigInt(s).toString();
		} catch {
			return '';
		}
	} else if (/e/i.test(s)) s = expandExponent(s);
	s = s.replace(/^[-+]/, '');
	if (/^\d+\.\d*$/.test(s)) return plainNumber(s);
	if (!/^\d+$/.test(s)) return '';
	const d = finite(decimals);
	const places = d === null || d < 0 || d > 77 ? 18 : Math.floor(d);
	if (places === 0) return s.replace(/^0+(?=\d)/, '');
	const padded = s.padStart(places + 1, '0');
	const whole = padded.slice(0, -places).replace(/^0+(?=\d)/, '');
	const fraction = padded.slice(-places).replace(/0+$/, '');
	return fraction ? `${whole}.${fraction}` : whole;
}
