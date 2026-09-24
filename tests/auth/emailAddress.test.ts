import { describe, it, expect } from 'vitest';
import { normalizeSignupEmail, normalizeLoginEmail } from '../../src/lib/emailAddress';

/**
 * The sign-up validator is the gate for NEW accounts. The payloads below are the shapes an
 * automated scanner pushed through the old /^[^\s@]+@[^\s@]+\.[^\s@]+$/ check (quote,
 * markup, backslash, percent-encoding, SQL fragments); every one must now be refused.
 */
describe('normalizeSignupEmail: scanner payloads are refused', () => {
	const payloads = [
		`testing@example.com'"`,
		'testing@example.com<script>',
		'testing@example.com\\',
		'testing@example.com%00',
		'testing@example.com)',
		`testing@example.com'||'`,
		'testing@example.com`',
		'"testing"@x.io',
		'test\u0000ing@x.io',
		'test\ning@x.io',
		'a b@x.io',
		'a@b@x.io',
		'a@x.io;drop',
		'a@[127.0.0.1]',
		'a%40b@x.io',
		'<a@x.io>',
		'a@x..io',
		'a..b@x.io',
		'.a@x.io',
		'a.@x.io',
		'a@-x.io',
		'a@x-.io',
		'a@x.i',
		'a@x.123',
		'a@localhost',
		'',
		'   ',
		'no-at-sign.io',
	];
	for (const p of payloads) {
		it(`refuses ${JSON.stringify(p)}`, () => {
			expect(normalizeSignupEmail(p)).toBeNull();
		});
	}

	it('refuses reserved example/test domains (nothing there receives the verification email)', () => {
		expect(normalizeSignupEmail('testing@example.com')).toBeNull();
		expect(normalizeSignupEmail('testing@EXAMPLE.org')).toBeNull();
		expect(normalizeSignupEmail('a@mail.example.net')).toBeNull();
		expect(normalizeSignupEmail('a@site.test')).toBeNull();
		expect(normalizeSignupEmail('a@x.invalid')).toBeNull();
		expect(normalizeSignupEmail('a@foo.example')).toBeNull();
		expect(normalizeSignupEmail('a@app.localhost')).toBeNull();
	});

	it('refuses addresses over 254 characters and local parts over 64', () => {
		const long = `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(10)}.io`;
		expect(long.length).toBeGreaterThan(254);
		expect(normalizeSignupEmail(long)).toBeNull();
		expect(normalizeSignupEmail(`${'a'.repeat(65)}@x.io`)).toBeNull();
		expect(normalizeSignupEmail(`${'a'.repeat(64)}@x.io`)).toBe(`${'a'.repeat(64)}@x.io`);
	});

	it('refuses non-strings', () => {
		expect(normalizeSignupEmail(null)).toBeNull();
		expect(normalizeSignupEmail(undefined)).toBeNull();
		expect(normalizeSignupEmail(42)).toBeNull();
	});
});

describe('normalizeSignupEmail: ordinary addresses pass, trimmed and lowercased', () => {
	it.each([
		['First.Last+tag@Sub.Domain.co.uk', 'first.last+tag@sub.domain.co.uk'],
		['a_b-c@x.io', 'a_b-c@x.io'],
		['  someone@gmail.com  ', 'someone@gmail.com'],
		['user@xn--bcher-kva.ch', 'user@xn--bcher-kva.ch'],
		['user@mail.xn--p1ai', 'user@mail.xn--p1ai'],
		['_ops@company.dev', '_ops@company.dev'],
		['o.k@my-host.com', 'o.k@my-host.com'],
	])('%s -> %s', (input, out) => {
		expect(normalizeSignupEmail(input)).toBe(out);
	});
});

describe('normalizeLoginEmail stays lenient for existing accounts', () => {
	it('keeps an unusual but valid address so its owner can still sign in', () => {
		expect(normalizeLoginEmail(" O'Brien@Example.co ")).toBe("o'brien@example.co");
	});
	it('refuses control characters, over-long input, and non-addresses', () => {
		expect(normalizeLoginEmail('a\u0000@x.io')).toBeNull();
		expect(normalizeLoginEmail(`${'a'.repeat(250)}@x.io`)).toBeNull();
		expect(normalizeLoginEmail('nobody')).toBeNull();
		expect(normalizeLoginEmail(undefined)).toBeNull();
	});
});
