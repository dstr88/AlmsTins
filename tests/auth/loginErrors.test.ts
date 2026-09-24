import { describe, it, expect } from 'vitest';
import { routeSignInError, cutSignInQuery, loginPathForLang } from '../../src/lib/authErrorRedirect';
import { resolveLoginAlert, signInErrorMessage } from '../../src/lib/loginPageData';
import { withoutSessionCookies } from '../../src/lib/authSession';
import { en, es, fr } from '../../src/i18n/loginPage';

/**
 * How a refused password sign-in reaches the visitor: Auth.js redirects every error to
 * /login?error=CredentialsSignin&code=<code>; routeSignInError sends it back to the page
 * the form was on, and resolveLoginAlert turns the code into the page's message.
 */
const authRedirect = (qs: string) => Response.redirect(`https://almstins.com/login?${qs}`, 302);
const post = (referer?: string) =>
	new Request('https://almstins.com/api/auth/callback/credentials', {
		method: 'POST',
		headers: referer ? { referer } : {},
	});

describe('routeSignInError', () => {
	it('returns a Spanish-page error to /es, keeping error and code', () => {
		const res = routeSignInError(post('https://almstins.com/es'), authRedirect('error=CredentialsSignin&code=email_unverified'));
		const loc = new URL(res.headers.get('Location')!);
		expect(loc.pathname).toBe('/es');
		expect(loc.searchParams.get('error')).toBe('CredentialsSignin');
		expect(loc.searchParams.get('code')).toBe('email_unverified');
		expect(res.status).toBe(302);
	});

	it('returns /verify/login errors there with a safe next, and drops an unsafe one', () => {
		const ok = routeSignInError(post('https://almstins.com/verify/login?next=%2Fverify%2Fdesk'), authRedirect('error=CredentialsSignin&code=email_unverified'));
		const loc = new URL(ok.headers.get('Location')!);
		expect(loc.pathname).toBe('/verify/login');
		expect(loc.searchParams.get('next')).toBe('/verify/desk');

		const bad = routeSignInError(post('https://almstins.com/verify/login?next=%2F%2Fevil.com'), authRedirect('error=CredentialsSignin'));
		const loc2 = new URL(bad.headers.get('Location')!);
		expect(loc2.pathname).toBe('/verify/login');
		expect(loc2.searchParams.has('next')).toBe(false);
	});

	it('returns /receivables/login errors there (it is served as a rewrite of /verify/login), keeping a safe next', () => {
		const res = routeSignInError(post('https://almstins.com/receivables/login?next=%2Freceivables%2Fdesk'), authRedirect('error=CredentialsSignin&code=use_provider'));
		const loc = new URL(res.headers.get('Location')!);
		expect(loc.pathname).toBe('/receivables/login');
		expect(loc.searchParams.get('code')).toBe('use_provider');
		expect(loc.searchParams.get('next')).toBe('/receivables/desk');
	});

	it('returns PetroTins errors to /petro-tins', () => {
		const res = routeSignInError(post('https://almstins.com/petro-tins'), authRedirect('error=CredentialsSignin&code=credentials'));
		expect(new URL(res.headers.get('Location')!).pathname).toBe('/petro-tins');
	});

	it('leaves /login alone for any other page, another host, no Referer, or a success redirect', () => {
		const target = 'https://almstins.com/login?error=CredentialsSignin&code=email_unverified';
		expect(routeSignInError(post('https://almstins.com/dashboard'), authRedirect('error=CredentialsSignin')).headers.get('Location'))
			.toBe('https://almstins.com/login?error=CredentialsSignin');
		expect(routeSignInError(post('https://evil.example/es'), authRedirect('error=CredentialsSignin&code=email_unverified')).headers.get('Location')).toBe(target);
		expect(routeSignInError(post(), authRedirect('error=CredentialsSignin&code=email_unverified')).headers.get('Location')).toBe(target);
		const success = Response.redirect('https://almstins.com/dashboard/vault', 302);
		expect(routeSignInError(post('https://almstins.com/es'), success).headers.get('Location')).toBe('https://almstins.com/dashboard/vault');
	});
});

describe('resolveLoginAlert', () => {
	const base = { error: null, code: null, signup: null, verified: null };

	it('explains an unverified address in each language', () => {
		for (const t of [en, es, fr]) {
			const a = resolveLoginAlert(t, { ...base, error: 'CredentialsSignin', code: 'email_unverified' });
			expect(a.message).toBe(t.errors.emailUnverified);
			expect(a.message.length).toBeGreaterThan(20);
			expect(a.hasAlert).toBe(true);
		}
		expect(es.errors.emailUnverified).not.toBe(en.errors.emailUnverified);
		expect(fr.errors.emailUnverified).not.toBe(en.errors.emailUnverified);
	});

	it('explains rate limiting, and keeps the generic message for a plain wrong password', () => {
		expect(resolveLoginAlert(en, { ...base, error: 'CredentialsSignin', code: 'rate_limited' }).message).toBe(en.errors.rateLimited);
		expect(resolveLoginAlert(en, { ...base, error: 'rate_limited' }).message).toBe(en.errors.rateLimited);
		expect(resolveLoginAlert(en, { ...base, error: 'CredentialsSignin', code: 'credentials' }).message).toBe(en.errors.generic);
		// A code only means something on a CredentialsSignin error.
		expect(resolveLoginAlert(en, { ...base, error: 'AccessDenied', code: 'email_unverified' }).message).toBe(en.errors.generic);
	});

	it('keeps the existing mappings', () => {
		expect(resolveLoginAlert(en, { ...base, error: 'OAuthAccountNotLinked' }).message).toBe('LOCKED_OUT');
		expect(resolveLoginAlert(en, { ...base, error: 'OAuthAccountNotLinked' }).hasAlert).toBe(false);
		expect(resolveLoginAlert(en, { ...base, error: 'Configuration' }).message).toBe(en.errors.configuration);
		expect(resolveLoginAlert(en, { ...base, error: 'missing' })).toEqual({ message: '', notice: '', hasAlert: true });
		expect(resolveLoginAlert(en, { ...base, verified: 'success' }).notice).toBe(en.notices.verifiedSuccess);
		expect(resolveLoginAlert(en, base)).toEqual({ message: '', notice: '', hasAlert: false });
	});
});

describe('the verified-email codes', () => {
	const base = { error: null, code: null, signup: null, verified: null };

	it('each code has its own message in every language', () => {
		for (const t of [en, es, fr]) {
			expect(resolveLoginAlert(t, { ...base, error: 'CredentialsSignin', code: 'use_provider' }).message).toBe(t.errors.useProvider);
			expect(resolveLoginAlert(t, { ...base, error: 'CredentialsSignin', code: 'verify_required' }).message).toBe(t.errors.verifyRequired);
			expect(resolveLoginAlert(t, { ...base, error: 'provider_unverified' }).message).toBe(t.errors.providerUnverified);
			const msgs = [t.errors.emailUnverified, t.errors.useProvider, t.errors.verifyRequired, t.errors.providerUnverified];
			expect(new Set(msgs).size).toBe(4);
		}
		expect(es.errors.useProvider).not.toBe(en.errors.useProvider);
		expect(fr.errors.verifyRequired).not.toBe(en.errors.verifyRequired);
	});

	it('no message tells a password user to use an email link (that would silently replace the password)', () => {
		for (const t of [en, es, fr]) {
			for (const m of [t.errors.emailUnverified, t.errors.useProvider, t.errors.verifyRequired]) {
				expect(m).not.toMatch(/email link|enlace por correo|lien par e-mail/);
			}
		}
	});

	it('signInErrorMessage is null for anything it does not own (pages fall back to their generic text)', () => {
		expect(signInErrorMessage(en, 'CredentialsSignin', 'credentials')).toBeNull();
		expect(signInErrorMessage(en, 'AccessDenied', 'use_provider')).toBeNull();
		expect(signInErrorMessage(en, null, null)).toBeNull();
	});

	it('a cut session maps to the right code; revoked or deleted gets a plain sign-in page', () => {
		expect(cutSignInQuery('unverified_password')).toBe('error=CredentialsSignin&code=verify_required');
		expect(cutSignInQuery('password_needs_provider')).toBe('error=CredentialsSignin&code=use_provider');
		expect(cutSignInQuery('revoked')).toBe('');
		expect(cutSignInQuery('missing_user')).toBe('');
		expect(cutSignInQuery(null)).toBe('');
	});

	it('the sign-in page for an account language', () => {
		expect(loginPathForLang('es')).toBe('/es');
		expect(loginPathForLang('fr')).toBe('/fr');
		expect(loginPathForLang('en')).toBe('/login');
		expect(loginPathForLang(undefined)).toBe('/login');
	});
});

describe('withoutSessionCookies', () => {
	it('drops every Auth.js session cookie and chunk, keeps the rest', () => {
		const header = [
			'almstins-lang=es',
			'__Secure-authjs.session-token=abc',
			'__Secure-authjs.session-token.0=part0',
			'__Secure-authjs.session-token.1=part1',
			'authjs.session-token=dev',
			'__Host-authjs.csrf-token=csrf',
			'__Secure-authjs.callback-url=cb',
		].join('; ');
		expect(withoutSessionCookies(header)).toBe('almstins-lang=es; __Host-authjs.csrf-token=csrf; __Secure-authjs.callback-url=cb');
		expect(withoutSessionCookies('authjs.session-token=x')).toBe('');
	});
});
