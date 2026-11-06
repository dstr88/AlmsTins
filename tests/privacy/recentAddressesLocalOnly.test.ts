import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/privacyPolicy';
import { RECENT_ADDRESSES_MAX } from '../../src/lib/recentAddresses';

/**
 * The wallet checker keeps the addresses a person checked recently in their own browser
 * (src/lib/recentAddresses.ts). The privacy policy's cookie and browser storage section must say
 * so, in all three languages: kept only in the browser, never sent to Almstins, and how to clear
 * it. The changelog announces it with the same promise. Pure copy checks.
 */

const bodies = { en: en.body, es: es.body, fr: fr.body };

/** Section 9, Cookies & Analytics, in one language. */
function sectionNine(body: string): string {
	const start = body.indexOf('<h2>9.');
	const end = body.indexOf('<h2>10.');
	expect(start, 'section 9 found').toBeGreaterThan(-1);
	expect(end, 'section 10 found').toBeGreaterThan(start);
	return body.slice(start, end);
}

const lines = {
	en: /<li><strong>Recently checked addresses:<\/strong>[^<]*kept only in your browser and is never sent to Almstins\.[^<]*Clear list[^<]*<\/li>/,
	es: /<li><strong>Direcciones consultadas recientemente:<\/strong>[^<]*se guarda solo en su navegador y nunca se envía a Almstins\.[^<]*Borrar lista[^<]*<\/li>/,
	fr: /<li><strong>Adresses consultées récemment :<\/strong>[^<]*conservée uniquement dans votre navigateur et n'est jamais envoyée à Almstins\.[^<]*Effacer la liste[^<]*<\/li>/,
};

describe('the recently checked addresses line in the privacy policy', () => {
	for (const lang of ['en', 'es', 'fr'] as const) {
		it(`is in Section 9, right after Preferences (${lang})`, () => {
			const section = sectionNine(bodies[lang]);
			expect(section).toMatch(lines[lang]);
			const items = [...section.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
			const at = items.findIndex((i) => lines[lang].test(`<li>${i}</li>`));
			expect(items[at - 1]).toMatch(/^<strong>(Preferences|Preferencias|Préférences) ?:<\/strong>/);
			expect(items[at]).not.toMatch(/—/);
		});
	}

	it('is announced in the changelog with the same promise and the real cap', async () => {
		const { readFileSync } = await import('node:fs');
		const path = await import('node:path');
		const log = readFileSync(path.resolve(__dirname, '../../src/pages/changelog.astro'), 'utf8');
		expect(log).toContain(`remembers the last ${RECENT_ADDRESSES_MAX} addresses you checked`);
		expect(log).toContain('kept only in your browser and is never sent to Almstins');
	});
});
