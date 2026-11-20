import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as policy from '../../src/i18n/privacyPolicy';

/**
 * Privacy Policy v1.6 says what else is kept about an account, and what the admin tools show,
 * in English, Spanish and French. (The policy has moved on to v1.7 since; that wording is unchanged.)
 *
 * Two things are newly kept (src/lib/accountActivity.ts): the product an account signed up for
 * and the last day it was active. The country and product of the last sign-in were already kept
 * (migrations-pg/0074) and now lead each row of the admin page's New accounts list, so the
 * policy names them too. This file holds the policy to the code: each fact the code keeps is in
 * the list of account information (Section 3.1), and each thing the admin page shows about an
 * account is in the sentence about the admin tools (Section 1), in every language.
 *
 * The version and date are held by tests/privacy/agenticsPolicyV13.test.ts. Pure copy checks.
 */
const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];
const bodies: Record<Lang, string> = { en: policy.en.body, es: policy.es.body, fr: policy.fr.body };
const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/** One list item or paragraph, found by the bold words it opens with. */
function passage(body: string, opening: string): string {
	const start = body.indexOf(opening);
	expect(start, opening).toBeGreaterThan(-1);
	const end = Math.min(...['</li>', '</p>'].map((tag) => body.indexOf(tag, start)).filter((i) => i > -1));
	return body.slice(start, end);
}

const ACCOUNT_INFO: Record<Lang, string> = {
	en: '<strong>Account information:</strong>',
	es: '<strong>Información de cuenta:</strong>',
	fr: '<strong>Informations de compte :</strong>',
};
const ADMIN_TOOLS: Record<Lang, string> = {
	en: '<strong>Core principle — tenant isolation.</strong>',
	es: '<strong>Principio fundamental — aislamiento de inquilinos.</strong>',
	fr: '<strong>Principe fondamental — isolation des locataires.</strong>',
};

describe('the list of account information names what is kept', () => {
	const lastActiveDay: Record<Lang, string> = {
		en: 'the last day you used the Service while signed in (the day only)',
		es: 'el último día en que usó el Servicio con la sesión iniciada (solo el día)',
		fr: 'le dernier jour où vous avez utilisé le Service en étant connecté (le jour uniquement)',
	};
	const signedUpFor: Record<Lang, string> = {
		en: 'the Almstins product you signed up for',
		es: 'el producto de Almstins con el que se dio de alta',
		fr: 'le produit Almstins pour lequel vous vous êtes inscrit',
	};
	const lastSignIn: Record<Lang, string> = {
		en: 'your sign-up and last sign-in dates, with the country and the Almstins product of your last sign-in',
		es: 'sus fechas de alta y de último inicio de sesión, con el país y el producto de Almstins de su último inicio de sesión',
		fr: "vos dates d'inscription et de dernière connexion, avec le pays et le produit Almstins de votre dernière connexion",
	};

	it.each(LANGS)('%s: the last active day, and that it is the day only', (lang) => {
		expect(passage(bodies[lang], ACCOUNT_INFO[lang])).toContain(lastActiveDay[lang]);
	});

	it.each(LANGS)('%s: the product signed up for', (lang) => {
		expect(passage(bodies[lang], ACCOUNT_INFO[lang])).toContain(signedUpFor[lang]);
	});

	it.each(LANGS)('%s: the country and product of the last sign-in', (lang) => {
		expect(passage(bodies[lang], ACCOUNT_INFO[lang])).toContain(lastSignIn[lang]);
	});

	it('those are the facts the code keeps', () => {
		// Read as source: the module itself needs a database to load.
		const stamp = read('src/lib/accountActivity.ts');
		expect(stamp).toContain("export const ACCOUNT_ACTIVITY_COLUMNS = ['signup_service', 'last_active_on'] as const;");
		expect(stamp).toContain('UPDATE auth_users SET last_login_service = ?, last_login_country = ? WHERE id = ?');
		expect(stamp).toContain('UPDATE auth_users SET last_active_on = ?');
		expect(stamp).toContain('UPDATE auth_users SET signup_service = ?');
	});
});

describe('the sentence about the admin tools names what they show', () => {
	const shown: Record<Lang, string[]> = {
		en: [
			"each account's email and whether it is confirmed",
			'how the account signs in (Google, GitHub, a password, or an emailed link)',
			'its sign-up and last sign-in dates, with the country and the Almstins product of its last sign-in',
			'the Almstins product it signed up for',
			'the last day it was active',
			'its subscription tier',
			'how many wallets, exchange accounts, imports, and Verify Destinations it has, and how many of those Destinations are Claimed or Verified',
		],
		es: [
			'el correo electrónico de cada cuenta y si está confirmado',
			'cómo inicia sesión la cuenta (Google, GitHub, una contraseña o un enlace enviado por correo electrónico)',
			'sus fechas de alta y de último inicio de sesión, con el país y el producto de Almstins de su último inicio de sesión',
			'el producto de Almstins con el que se dio de alta',
			'el último día en que estuvo activa',
			'su nivel de suscripción',
			'cuántas wallets, cuentas de exchange, importaciones y Destinos de Verify tiene, y cuántos de esos Destinos están Reclamados o Verificados',
		],
		fr: [
			"l'adresse e-mail de chaque compte et si elle est confirmée",
			'la façon dont le compte se connecte (Google, GitHub, un mot de passe ou un lien envoyé par e-mail)',
			"ses dates d'inscription et de dernière connexion, avec le pays et le produit Almstins de sa dernière connexion",
			"le produit Almstins pour lequel il s'est inscrit",
			'le dernier jour où il a été actif',
			"son niveau d'abonnement",
			"le nombre de wallets, de comptes d'exchange, d'importations et de Destinations Verify qu'il comporte, y compris le nombre de ces Destinations qui sont Revendiquées ou Vérifiées",
		],
	};

	it.each(LANGS)('%s: every fact, in one order', (lang) => {
		const sentence = passage(bodies[lang], ADMIN_TOOLS[lang]);
		const at = shown[lang].map((words) => sentence.indexOf(words));
		expect(at.every((i) => i > -1), JSON.stringify(shown[lang].filter((_, i) => at[i] === -1))).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
	});

	it.each(LANGS)('%s: still says what the admin tools do not show', (lang) => {
		const sentence = passage(bodies[lang], ADMIN_TOOLS[lang]);
		const notShown: Record<Lang, string> = {
			en: 'Our admin tools do not show your transactions, wallet addresses, or documents.',
			es: 'Nuestras herramientas de administración no muestran sus transacciones, sus direcciones de wallet ni sus documentos.',
			fr: "Nos outils d'administration n'affichent ni vos transactions, ni vos adresses de wallet, ni vos documents.",
		};
		expect(sentence).toContain(notShown[lang]);
	});

	it('those are the columns the admin page shows about an account', () => {
		const list = read('src/components/admin/NewAccounts.astro');
		for (const shownOnPage of ['a.createdAt', 'a.lastLoginCountry', 'a.email', 'a.signupService', 'a.methods', 'a.lastLogin', 'a.lastActiveDay', 'a.tags']) {
			expect(list, shownOnPage).toContain(shownOnPage);
		}
		const steps = read('src/components/admin/VerifySteps.astro');
		expect(steps).toContain('row.counts.registered, row.counts.claimed, row.counts.verified, row.counts.qrs');
	});
});

describe('the three languages agree', () => {
	it('each is version 1.7, the version in effect', () => {
		expect(bodies.en).toContain('<strong>Version:</strong> 1.7');
		expect(bodies.es).toContain('<strong>Versión:</strong> 1.7');
		expect(bodies.fr).toContain('<strong>Version :</strong> 1.7');
	});

	it('none says a sign-in or an active day is "not recorded", and none describes a referring site', () => {
		for (const lang of LANGS) {
			expect(bodies[lang], lang).not.toMatch(/referr|sitio que le envió|site qui vous a envoyé/i);
		}
	});
});
