import { describe, it, expect } from 'vitest';
import * as faq from '../../src/i18n/faq';
import * as form8949 from '../../src/i18n/dashboard/yearEnd/form8949';
import * as scheduleD from '../../src/i18n/dashboard/yearEnd/schedule-d';

/**
 * Cost-basis copy must match what the engines do (tests/tax/perWalletBasisGap.test.ts):
 * lots are pooled across all wallets and accounts, while US rules identify basis wallet by
 * wallet for disposals on or after 2025-01-01. And Almstins organizes records; it does not
 * prepare returns, so nothing may call the Form 8949-style PDF ready to attach to a return.
 */

const LANGS = ['en', 'es', 'fr'] as const;
const faqText = (lang: (typeof LANGS)[number]) => faq[lang].items.map((i) => `${i.q}\n${i.a}`).join('\n');

describe('FAQ cost-basis wording', () => {
	it.each(LANGS)('%s: no "ready to attach to your return" style wording', (lang) => {
		expect(faqText(lang)).not.toMatch(
			/ready to attach|attach to your return|listo para adjuntar|adjuntar a tu declaración|prêt à joindre|joindre à votre déclaration/i,
		);
	});

	it.each(LANGS)('%s: FIFO is not presented as the method the IRS expects', (lang) => {
		expect(faqText(lang)).not.toMatch(/same method the IRS expects|mismo método que el IRS espera|même méthode attendue par l'IRS/);
	});

	it.each(LANGS)('%s: says lots are pooled across wallets and accounts', (lang) => {
		expect(faqText(lang)).not.toMatch(/across all your imported transactions|en todas tus transacciones importadas|sur toutes vos transactions importées/);
		expect(faqText(lang)).toMatch(/pooled across all your wallets and accounts|de todos tus wallets y cuentas|de tous vos wallets et comptes/);
	});

	it.each(LANGS)('%s: names the January 1, 2025 per-wallet rule', (lang) => {
		expect(faqText(lang)).toMatch(/January 1, 2025|1 de enero de 2025|1er janvier 2025/);
	});
});

describe('Form 8949-style summary and Schedule D page', () => {
	it.each(LANGS)('%s: the printed header carries a pooled-basis note for 2025 and later', (lang) => {
		const note = form8949[lang].irsHeaderPooledNote;
		expect(note).toMatch(/2025/);
		expect(note).toMatch(/FIFO/);
		expect(note).not.toMatch(/—/);
	});

	it.each(LANGS)('%s: Schedule D next steps do not say to attach the summary to a return', (lang) => {
		const step = scheduleD[lang].nextStep1;
		expect(step).not.toMatch(/^Attach Form 8949|^Adjunta el Form 8949|^Joindre le Form 8949/);
		expect(step).toMatch(/tax professional|profesional de impuestos|professionnel fiscal/);
	});
});
