import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Privacy claims outside the policy must stay exactly true (privacy audit, 2026-10-10).
 * Each case pins a claim the audit found false or overstated, in all three languages, so
 * an edit to one language cannot quietly bring the old wording back in another.
 * Pure copy checks: no database, no network.
 */
import * as login from '../../src/i18n/loginPage';
import { copy as verifyCopy } from '../../src/i18n/verify';
import { items as faqEn } from '../../src/i18n/faq/en';
import { items as faqEs } from '../../src/i18n/faq/es';
import { items as faqFr } from '../../src/i18n/faq/fr';
import * as terms from '../../src/i18n/termsOfService';

const LANGS = ['en', 'es', 'fr'] as const;

describe('Wallet Watcher card (finding E-B3)', () => {
	it('no longer says the email is the only thing stored, in any language', () => {
		for (const lang of LANGS) {
			const free = login[lang].hub.watcher.free;
			expect(free).not.toMatch(/only store your email|Solo guardamos tu correo|ne stockons que votre e-mail/i);
		}
	});

	it('says sign-in never stores a name or photo, in all three languages', () => {
		expect(login.en.hub.watcher.free).toMatch(/never stores your name or photo/);
		expect(login.es.hub.watcher.free).toMatch(/nunca guardamos tu nombre ni tu foto/);
		expect(login.fr.hub.watcher.free).toMatch(/jamais votre nom ni votre photo/);
	});

	it('no longer claims data is never shared (it goes to the services the policy lists)', () => {
		for (const lang of LANGS) {
			const cards = JSON.stringify(login[lang].featureCards);
			expect(cards).not.toMatch(/Never shared|Nunca compartido|Jamais partagé/);
		}
	});
});

describe('Verify landing trust card and FAQ (finding E-B6)', () => {
	const NO_TRACKING = /No tracking|no tracking built|Sin rastreo|ningún rastreo|Aucun pistage|n’intègre de suivi/i;

	it('drops the "no tracking" claims', () => {
		for (const lang of LANGS) {
			const c = verifyCopy[lang];
			const text = JSON.stringify([c.free, c.trust, c.faq]);
			expect(text).not.toMatch(NO_TRACKING);
		}
	});

	it('discloses the hashed check log and Google Analytics where it reassures', () => {
		for (const lang of LANGS) {
			const c = verifyCopy[lang];
			const card = c.trust.points[2].body;
			const faq = c.faq.items.find((i) => /customers|clientes|clients/.test(i.q))!.a;
			for (const text of [card, faq]) {
				expect(text).toMatch(/Google Analytics/);
				expect(text).toMatch(/one-way|unidireccional|sens unique/);
				expect(text).toMatch(/IP/);
			}
		}
	});
});

describe('Footer FAQ "Is it private" (finding E-B8)', () => {
	const answer = (items: Array<{ id: string; a: string }>) => items.find((i) => i.id === 'faq-privacy')!.a;

	it('no longer calls tracking a future plan or mentions API keys', () => {
		for (const a of [answer(faqEn), answer(faqEs), answer(faqFr)]) {
			expect(a).not.toMatch(/API keys|clés API|eventually|Eventualmente|éventuellement|encrypts everything|lo encripta todo|chiffre tout/i);
		}
	});

	it('no longer describes cross-account label voting in the Address Book answer', () => {
		const labels = (items: Array<{ id: string; a: string }>) => items.find((i) => i.id === 'faq-address-labels')!.a;
		for (const a of [labels(faqEn), labels(faqEs), labels(faqFr)]) {
			expect(a).not.toMatch(/community vote|voto comunitario|vote communautaire|global label|etiqueta global|étiquette globale/i);
		}
		expect(labels(faqEn)).toMatch(/stays in your account only/);
		expect(labels(faqEs)).toMatch(/se queda solo en tu cuenta/);
		expect(labels(faqFr)).toMatch(/reste uniquement dans votre compte/);
	});

	it('names Google Analytics and points to the Privacy Policy in all three languages', () => {
		expect(answer(faqEn)).toMatch(/Google Analytics[\s\S]*Privacy Policy/);
		expect(answer(faqEs)).toMatch(/Google Analytics[\s\S]*Política de Privacidad/);
		expect(answer(faqFr)).toMatch(/Google Analytics[\s\S]*Politique de Confidentialité/);
	});
});

describe('Terms of Service (findings B-A7, B-A8, B-A3, A-A1)', () => {
	const bodies = { en: terms.en.body, es: terms.es.body, fr: terms.fr.body };

	it('describes no repeated or always-on camera monitoring', () => {
		for (const body of Object.values(bodies)) {
			expect(body).not.toMatch(/repeatedly confirm|confirmar repetidamente|de manière répétée/);
		}
		expect(bodies.en).toMatch(/Each scan is a one-time action/);
		expect(bodies.es).toMatch(/Cada escaneo es una acción única/);
		expect(bodies.fr).toMatch(/Chaque scan est une action ponctuelle/);
	});

	it('describes no signature-based ownership proof', () => {
		for (const body of Object.values(bodies)) {
			expect(body).not.toMatch(
				/signature you generate|wallet-generated signature|per-address cryptographic signature|firma que usted mismo genera|firma generada por el wallet|firma criptográfica por dirección|signature que vous générez|signature générée par un wallet|signature cryptographique par adresse/,
			);
		}
	});

	it('no longer promises a proven Destination is never shown to the public', () => {
		for (const body of Object.values(bodies)) {
			expect(body).not.toMatch(/never displayed to other users, the public|nunca mostrado a otros usuarios, al público|jamais affiché à d'autres utilisateurs, au public/);
			expect(body).not.toMatch(/does <strong>not<\/strong> itself display any verdict|no<\/strong> muestra por sí misma|n'affiche pas<\/strong> elle-même/);
		}
		expect(bodies.en).toMatch(/A label you type is never shown publicly/);
		expect(bodies.es).toMatch(/Una etiqueta que usted escribe nunca se muestra públicamente/);
		expect(bodies.fr).toMatch(/Un libellé que vous saisissez n'est jamais affiché publiquement/);
	});

	it('no longer says data is isolated from any operator', () => {
		for (const body of Object.values(bodies)) {
			expect(body).not.toMatch(/isolated from every other user and from any operator|aislados de los de cualquier otro usuario y de cualquier operador|isolées de celles de tout autre utilisateur et de tout opérateur/);
		}
	});

	it('is version 1.2, effective October 12, 2026, so readers can tell the wording changed', () => {
		expect(bodies.en).toMatch(/October 12, 2026 &nbsp;·&nbsp; <strong>Version:<\/strong> 1\.2/);
		expect(bodies.es).toMatch(/12 de octubre de 2026 &nbsp;·&nbsp; <strong>Versión:<\/strong> 1\.2/);
		expect(bodies.fr).toMatch(/12 octobre 2026 &nbsp;·&nbsp; <strong>Version :<\/strong> 1\.2/);
	});
});

describe('Changelog October 12, 2026 entry (findings E-B7, E-B3)', () => {
	const src = readFileSync(path.resolve(__dirname, '../../src/pages/changelog.astro'), 'utf8');
	const start = src.indexOf('October 12, 2026');
	const entry = src.slice(start, src.indexOf('</article>', start));

	it('no longer overstates what VirusTotal keeps or what sign-in keeps', () => {
		expect(start).toBeGreaterThan(-1);
		expect(entry).not.toMatch(/not kept by VirusTotal/);
		expect(entry).not.toMatch(/we keep only your email/);
		expect(entry).toMatch(/still sends VirusTotal the full link/);
	});

	it('lists the further changes in this set', () => {
		expect(entry).toMatch(/Shared address labels are gone/);
		expect(entry).toMatch(/never includes a label you typed/);
		expect(entry).toMatch(/no longer keep a decrypted copy of the whole list; the saved copy is encrypted/);
		expect(entry).toMatch(/Deleting your account now removes all of your data/);
		expect(entry).toMatch(/waits until you press Check/);
		expect(entry).toMatch(/\(Google signals and ad personalization\) are switched off/);
	});
});
