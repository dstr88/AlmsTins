import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/termsOfService';

/**
 * Corrections to User Agreement v1.2 before it takes effect on October 12, 2026:
 * B.3.2 said weighted-average cost, but every tax output uses FIFO (and averaging is not
 * a US method for crypto); A.2.2 left out Sevastopol, which the geo-block covers; B.4
 * described a community trust layer that is not offered.
 */

const bodies = { en: en.body, es: es.body, fr: fr.body } as Record<string, string>;

describe('User Agreement v1.2 corrections', () => {
	it.each(Object.keys(bodies))('%s: B.3.2 says FIFO, not weighted average', (lang) => {
		const b = bodies[lang];
		expect(b).toMatch(/FIFO/);
		expect(b).not.toMatch(/weighted-average|promedio ponderado|moyen pondéré/);
	});

	it('A.2.2 names Sevastopol in all three languages', () => {
		expect(bodies.en).toMatch(/Crimea, Sevastopol, Donetsk, or Luhansk/);
		expect(bodies.es).toMatch(/Crimea, Sebastopol, Donetsk o Luhansk de Ucrania/);
		expect(bodies.fr).toMatch(/Crimée, de Sébastopol, de Donetsk ou de Louhansk/);
	});

	it('B.4 says the community trust layer is not offered', () => {
		expect(bodies.en).toMatch(/Not currently offered\. Almstins does not run fraud flags, reviews, or trust badges today/);
		expect(bodies.es).toMatch(/No se ofrece actualmente/);
		expect(bodies.fr).toMatch(/Non proposée actuellement/);
	});
});
