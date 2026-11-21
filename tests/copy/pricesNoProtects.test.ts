import { describe, it, expect } from 'vitest';
import * as prices from '../../src/i18n/prices';
import * as loginPage from '../../src/i18n/loginPage';

/**
 * The prices page and the home page's search description (Nov 20, 2026). The prices page said
 * Verify "protects" the payment addresses a business publishes, in its search description and in
 * the Verify heading, in all three languages, and the French home description said "protégez vos
 * QR codes" where English and Spanish say "verify". Almstins never says it protects, stops, blocks
 * or makes anything safe: Verify lets payers check a published address before they send. The
 * French home description now matches the English and Spanish.
 */

const PROTECTS = /protect|proteg|protég|protèg/i;
const LANGS = ['en', 'es', 'fr'] as const;

const HEADING = {
	en: 'Verify: let payers check your payment addresses before they send',
	es: 'Verify: que quien te paga compruebe tus direcciones de pago antes de enviar',
	fr: 'Verify : vos payeurs vérifient vos adresses de paiement avant d’envoyer',
};

describe('the prices page says what Verify does, never that it protects', () => {
	for (const lang of LANGS) {
		it(lang, () => {
			const t = prices[lang];
			expect(t.verify.heading).toBe(HEADING[lang]);
			expect(t.verify.heading).not.toContain('—');
			expect(t.meta.description).not.toMatch(PROTECTS);
			expect(JSON.stringify(t)).not.toMatch(PROTECTS);
		});
	}
});

describe('the home page search description never says protects', () => {
	for (const lang of LANGS) {
		it(lang, () => {
			expect(JSON.stringify(loginPage[lang])).not.toMatch(PROTECTS);
		});
	}
	it('the French description verifies the QR codes, like English and Spanish', () => {
		expect(JSON.stringify(loginPage.fr)).toContain('et vérifiez les QR codes que publie votre entreprise.');
	});
});
