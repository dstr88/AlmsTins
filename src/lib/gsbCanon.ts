/**
 * Google Safe Browsing v4 — URL canonicalization, expression generation, and
 * hashing. Implemented to Google's published spec
 * (https://developers.google.com/safe-browsing/v4/urls-hashing) and verified
 * against Google's official canonicalization test vectors (see SELFTEST below).
 *
 * Correctness here is SECURITY-CRITICAL: a canonicalization bug silently causes
 * a false negative (a malicious URL reads as clean). The GSB source is therefore
 * gated on runSelfTest() passing — if these vectors don't match, the caller
 * disables the local GSB lookup rather than trusting a wrong answer.
 */
import crypto from 'node:crypto';

/** Repeatedly percent-unescape until no %XX escapes remain. Terminates because
 * each pass strictly reduces the number of escapes. */
function unescapeRepeatedly(s: string): string {
	let prev: string;
	do {
		prev = s;
		s = s.replace(/%([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
	} while (s !== prev);
	return s;
}

/** Escape chars <=0x20, >=0x7f, '#', '%' as uppercase %XX. Result is pure ASCII. */
function escapeSpecial(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		const c = s[i];
		if (code <= 0x20 || code >= 0x7f || c === '#' || c === '%') {
			out += '%' + code.toString(16).toUpperCase().padStart(2, '0');
		} else {
			out += c;
		}
	}
	return out;
}

/** inet_aton-style parse → dotted-decimal, or null if the host isn't an IP. */
function canonicalizeIp(host: string): string | null {
	const parts = host.split('.');
	if (parts.length === 0 || parts.length > 4) return null;
	const nums: number[] = [];
	for (const p of parts) {
		if (p === '') return null;
		let n: number;
		if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
		else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
		else if (/^\d+$/.test(p)) n = parseInt(p, 10);
		else return null;
		if (!Number.isFinite(n)) return null;
		nums.push(n);
	}
	// Combine per inet_aton: last part fills the remaining low bytes.
	let value: number;
	const k = nums.length;
	if (k === 1) {
		value = nums[0];
	} else {
		// leading parts must each be a single byte; final part fills the rest
		for (let i = 0; i < k - 1; i++) if (nums[i] > 255) return null;
		const maxLast = Math.pow(256, 4 - (k - 1));
		if (nums[k - 1] >= maxLast) return null;
		value = 0;
		for (let i = 0; i < k - 1; i++) value = value * 256 + nums[i];
		value = value * maxLast + nums[k - 1];
	}
	if (value < 0 || value > 0xffffffff) return null;
	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

function canonicalizeHost(host: string): string {
	host = host.replace(/^\.+/, '').replace(/\.+$/, ''); // strip leading/trailing dots
	host = host.replace(/\.{2,}/g, '.'); // collapse consecutive dots
	host = host.toLowerCase();
	const ip = canonicalizeIp(host);
	return ip ?? host;
}

function canonicalizePath(path: string): string {
	if (path === '') return '/';
	// Resolve /./ and /../
	const segments = path.split('/');
	const out: string[] = [];
	for (const seg of segments) {
		if (seg === '.') continue;
		if (seg === '..') { if (out.length > 1) out.pop(); continue; }
		out.push(seg);
	}
	let resolved = out.join('/');
	if (!resolved.startsWith('/')) resolved = '/' + resolved;
	resolved = resolved.replace(/\/{2,}/g, '/'); // collapse consecutive slashes
	return resolved;
}

/** Full canonicalization → a pure-ASCII canonical URL. */
export function canonicalizeUrl(input: string): string {
	// 1. Remove tab/CR/LF; trim outer whitespace.
	let url = input.replace(/[\t\r\n]/g, '').trim();
	// 2. Remove fragment (literal '#' onward).
	const hashIdx = url.indexOf('#');
	if (hashIdx >= 0) url = url.slice(0, hashIdx);
	// 3. Add scheme if missing.
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = 'http://' + url;
	// 4. Split scheme://authority/path?query.
	const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?]*)([^?]*)(\?.*)?$/);
	if (!m) return url;
	const scheme = m[1].toLowerCase();
	let authority = m[2];
	let path = m[3] ?? '';
	let query = m[4] ?? ''; // includes leading '?'
	// authority → host (strip userinfo@ and :port).
	authority = authority.substring(authority.lastIndexOf('@') + 1);
	const colon = authority.indexOf(':');
	let host = colon >= 0 ? authority.substring(0, colon) : authority;
	// 5. Repeatedly unescape host + path + query.
	host = unescapeRepeatedly(host);
	path = unescapeRepeatedly(path);
	if (query) query = '?' + unescapeRepeatedly(query.slice(1));
	// 6. Canonicalize host + path.
	host = canonicalizeHost(host);
	path = canonicalizePath(path);
	// 7. Re-escape.
	return scheme + '://' + escapeSpecial(host) + escapeSpecial(path) + escapeSpecial(query);
}

/** Strip scheme + trailing query for the host/path expression matching. Returns
 * { host, path, query } from an already-canonical URL. */
function splitCanonical(canonical: string): { host: string; path: string; query: string } {
	const noScheme = canonical.replace(/^https?:\/\//, '');
	const slash = noScheme.indexOf('/');
	const host = slash >= 0 ? noScheme.slice(0, slash) : noScheme;
	const rest = slash >= 0 ? noScheme.slice(slash) : '/';
	const q = rest.indexOf('?');
	const path = q >= 0 ? rest.slice(0, q) : rest;
	const query = q >= 0 ? rest.slice(q) : '';
	return { host, path, query };
}

/**
 * Generate the up-to-30 host-suffix × path-prefix expressions Google specifies.
 * Input is a raw URL; it is canonicalized first.
 */
export function generateExpressions(rawUrl: string): string[] {
	const canonical = canonicalizeUrl(rawUrl);
	const { host, path, query } = splitCanonical(canonical);

	// Host suffixes: exact host, plus up to 4 from the last 5 components (skip for IPs).
	const hosts: string[] = [];
	const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
	if (isIp) {
		hosts.push(host);
	} else {
		hosts.push(host);
		const labels = host.split('.');
		// last 5 components, successively dropping the leading label
		const start = Math.max(0, labels.length - 5);
		for (let i = start; i < labels.length - 1; i++) {
			const suffix = labels.slice(i).join('.');
			if (suffix !== host && !hosts.includes(suffix)) hosts.push(suffix);
		}
	}

	// Path prefixes: full path+query, full path, then up to 4 root-based dir
	// prefixes (root "/" plus each directory component with a trailing slash,
	// EXCLUDING the final filename segment).
	const paths: string[] = [];
	if (query) paths.push(path + query);
	paths.push(path);
	const segs = path.split('/').filter((s) => s.length > 0);
	const dirs = segs.slice(0, -1); // drop the filename
	const rootBased: string[] = ['/'];
	let acc = '/';
	for (let i = 0; i < dirs.length && rootBased.length < 4; i++) {
		acc += dirs[i] + '/';
		rootBased.push(acc);
	}
	for (const p of rootBased) if (!paths.includes(p)) paths.push(p);

	const exprs = new Set<string>();
	for (const h of hosts) for (const p of paths) exprs.add(h + p);
	return [...exprs];
}

/** SHA256 hex of an expression (full hash). */
export function fullHash(expression: string): string {
	return crypto.createHash('sha256').update(expression).digest('hex');
}

/** The N-byte prefix (as hex) of a full hash. Google uses 4-byte prefixes. */
export function hashPrefix(expression: string, bytes = 4): string {
	return fullHash(expression).slice(0, bytes * 2);
}

// ── Self-test against Google's official vectors ──────────────────────────────
const CANON_VECTORS: Array<[string, string]> = [
	['http://host/%25%32%35', 'http://host/%25'],
	['http://host/%25%32%35%25%32%35', 'http://host/%25%25'],
	['http://host/%2525252525252525', 'http://host/%25'],
	['http://host/asdf%25%32%35asd', 'http://host/asdf%25asd'],
	['http://host/%%%25%32%35asd%%', 'http://host/%25%25%25asd%25%25'],
	['http://www.google.com/', 'http://www.google.com/'],
	['http://%31%36%38%2e%31%38%38%2e%39%39%2e%32%36/%2E%73%65%63%75%72%65/%77%77%77%2E%65%62%61%79%2E%63%6F%6D/', 'http://168.188.99.26/.secure/www.ebay.com/'],
	['http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/', 'http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/'],
	['http://host%23.com/%257Ea%2521b%2540c%2523d%2524e%25f%255E00%252611%252A22%252833%252944_55%252B', 'http://host%23.com/~a!b@c%23d$e%25f^00&11*22(33)44_55+'],
	['http://3279880203/blah', 'http://195.127.0.11/blah'],
	['http://www.google.com/blah/..', 'http://www.google.com/'],
	['www.google.com/', 'http://www.google.com/'],
	['www.google.com', 'http://www.google.com/'],
	['http://www.evil.com/blah#frag', 'http://www.evil.com/blah'],
	['http://www.GOOgle.com/', 'http://www.google.com/'],
	['http://www.google.com.../', 'http://www.google.com/'],
	['http://www.google.com/foo\tbar\rbaz\n2', 'http://www.google.com/foobarbaz2'],
	['http://www.google.com/q?', 'http://www.google.com/q?'],
	['http://www.google.com/q?r?', 'http://www.google.com/q?r?'],
	['http://www.google.com/q?r?s', 'http://www.google.com/q?r?s'],
	['http://evil.com/foo#bar#baz', 'http://evil.com/foo'],
	['http://evil.com/foo;', 'http://evil.com/foo;'],
	['http://evil.com/foo?bar;', 'http://evil.com/foo?bar;'],
	['http://\x01\x80.com/', 'http://%01%80.com/'],
	['http://notrailingslash.com', 'http://notrailingslash.com/'],
	['http://www.gotaport.com:1234/', 'http://www.gotaport.com/'],
	['  http://www.google.com/  ', 'http://www.google.com/'],
	['http:// leadingspace.com/', 'http://%20leadingspace.com/'],
	['http://%20leadingspace.com/', 'http://%20leadingspace.com/'],
	['%20leadingspace.com/', 'http://%20leadingspace.com/'],
	['https://www.securesite.com/', 'https://www.securesite.com/'],
	['http://host.com/ab%23cd', 'http://host.com/ab%23cd'],
	['http://host.com//twoslashes?more//slashes', 'http://host.com/twoslashes?more//slashes'],
];

let selfTestResult: boolean | null = null;

/** Run (and memoize) the canonicalization self-test. Returns true iff every
 * official vector matches. The GSB source is disabled unless this is true. */
export function runSelfTest(): boolean {
	if (selfTestResult !== null) return selfTestResult;
	let ok = true;
	for (const [input, expected] of CANON_VECTORS) {
		let got: string;
		try { got = canonicalizeUrl(input); } catch { got = '<threw>'; }
		if (got !== expected) {
			ok = false;
			console.warn('[gsbCanon] self-test MISMATCH', { input, expected, got });
		}
	}
	// Expression example: http://a.b.c/1/2.html?param=1
	const exprExpected = [
		'a.b.c/1/2.html?param=1', 'a.b.c/1/2.html', 'a.b.c/', 'a.b.c/1/',
		'b.c/1/2.html?param=1', 'b.c/1/2.html', 'b.c/', 'b.c/1/',
	].sort();
	const exprGot = generateExpressions('http://a.b.c/1/2.html?param=1').sort();
	if (JSON.stringify(exprExpected) !== JSON.stringify(exprGot)) {
		ok = false;
		console.warn('[gsbCanon] expression self-test MISMATCH', { expected: exprExpected, got: exprGot });
	}
	selfTestResult = ok;
	return ok;
}
