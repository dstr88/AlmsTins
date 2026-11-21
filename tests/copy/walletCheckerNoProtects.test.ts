import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/walletChecker';

/**
 * The wallet checker's "What is this?" panels (Nov 20, 2026). Two headings in each language said
 * the checker protects the reader ("How our wallet checker protects you"). Almstins never says it
 * protects, stops, blocks or makes anything safe: it reports what the sources found, and the
 * decision stays the reader's. The headings now say what the checker does. The third panel's
 * "How to protect yourself" tells the reader what they can do, and stays.
 */

const PANELS = ['phishing', 'scam'] as const;
const EXPECTED = {
	en: ['What our dApp checker does:', 'What our wallet checker does:'],
	es: ['Qué hace nuestro verificador de dApps:', 'Qué hace nuestro verificador de billeteras:'],
	fr: ['Ce que fait notre vérificateur de dApp :', 'Ce que fait notre vérificateur de portefeuille :'],
};

describe('the checker panels say what the checker does, never that it protects', () => {
	for (const [lang, t] of Object.entries({ en, es, fr }) as [keyof typeof EXPECTED, typeof en][]) {
		it(lang, () => {
			const tips = PANELS.map((k) => (t.modals as Record<string, { tip: string }>)[k].tip);
			tips.forEach((tip, i) => expect(tip).toContain(`<strong>${EXPECTED[lang][i]}</strong>`));
			const all = JSON.stringify(t);
			expect(all).not.toMatch(/protects you|te protege|vous protège/i);
		});
	}
});
