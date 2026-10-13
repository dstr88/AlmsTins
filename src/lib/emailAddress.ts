/**
 * Email address normalization for the password sign-up and sign-in forms.
 *
 * Two deliberately different strictness levels:
 *
 *   normalizeSignupEmail — gates NEW accounts. A conservative whitelist: lowercase letters,
 *     digits and . _ + - in the local part, plain DNS labels in the domain. It refuses
 *     quotes, backticks, angle brackets, backslashes, percent-encoding, whitespace, control
 *     characters and every other character a scanner payload is built from, even where the
 *     RFC would technically allow it. Reserved example/test domains (RFC 2606 / 6761) are
 *     refused too: nothing there can receive the verification email, so an account on one
 *     is junk by definition.
 *
 *   normalizeLoginEmail — for the credentials sign-in lookup. Lenient on purpose: an
 *     existing account with an unusual but valid address (an apostrophe, say) must still be
 *     able to sign in. The lookup is parameterized, so strictness only matters for what can
 *     be CREATED; sign-in only trims, lowercases, caps length and refuses control characters.
 */

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

// Starts with a letter, digit or underscore; never ends with a dot. Consecutive dots are
// refused separately below.
const LOCAL_RE = /^[a-z0-9_](?:[a-z0-9._+-]*[a-z0-9_+-])?$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

// Reserved for documentation and testing; they never deliver mail.
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org', 'localhost']);
const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost']);

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** The address, trimmed and lowercased, if it is safe to create an account for; else null. */
export function normalizeSignupEmail(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const value = input.trim().toLowerCase();
	if (!value || value.length > MAX_EMAIL_LENGTH) return null;

	const at = value.indexOf('@');
	if (at <= 0 || at !== value.lastIndexOf('@')) return null;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);

	if (local.length > MAX_LOCAL_LENGTH || !LOCAL_RE.test(local) || local.includes('..')) return null;

	const labels = domain.split('.');
	if (labels.length < 2) return null;
	const tld = labels[labels.length - 1];
	if (!TLD_RE.test(tld)) return null;
	if (!labels.every((label) => LABEL_RE.test(label))) return null;

	if (RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.has(tld)) return null;
	const parent = labels.slice(-2).join('.');
	if (RESERVED_DOMAINS.has(parent)) return null;

	return value;
}

/** The address as typed at sign-in, trimmed and lowercased, or null when it can't be one. */
export function normalizeLoginEmail(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const value = input.trim().toLowerCase();
	if (!value || value.length > MAX_EMAIL_LENGTH) return null;
	if (CONTROL_RE.test(value) || !value.includes('@')) return null;
	return value;
}
