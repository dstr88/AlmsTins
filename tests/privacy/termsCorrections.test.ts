import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/termsOfService';

/**
 * Corrections to User Agreement v1.2 before it takes effect on October 12, 2026:
 * B.3.2 said weighted-average cost, but every tax output uses FIFO (and averaging is not
 * a US method for crypto), with lots pooled across wallets (not yet the 2025 per-wallet
 * rule); A.2.2 left out Sevastopol, which the geo-block covers; B.4 described a community
 * trust layer that is not offered.
 */

const bodies = { en: en.body, es: es.body, fr: fr.body } as Record<string, string>;

describe('User Agreement v1.2 corrections', () => {
	it.each(Object.keys(bodies))('%s: B.3.2 says FIFO for realized gains; weighted average only for the Portfolio page', (lang) => {
		const b = bodies[lang];
		expect(b).toMatch(/FIFO/);
		expect(b).not.toMatch(/weighted-average cost|costo promedio ponderado salvo|coût moyen pondéré sauf/);
		expect(b).toMatch(/Portfolio page's average cost|página Portfolio|page Portfolio/);
	});

	// Since 2025-01-01 US basis is identified wallet by wallet (Treas. Reg. 1.1012-1(j)); the
	// engine still pools lots across wallets, so B.3.2 must say so rather than imply the rule is met.
	it.each(Object.keys(bodies))('%s: B.3.2 discloses the pooled method and the 2025 per-wallet rule', (lang) => {
		const b = bodies[lang];
		expect(b).toMatch(/1\.1012-1\(j\)/);
		expect(b).toMatch(/January 1, 2025|1 de enero de 2025|1er janvier 2025/);
	});

	it('B.3.2 says Almstins does not yet compute basis wallet by wallet', () => {
		expect(bodies.en).toMatch(/pooled across all the wallets and accounts you track/);
		expect(bodies.en).toMatch(/does not yet compute cost basis wallet by wallet/);
		expect(bodies.es).toMatch(/todavía no calcula la base de costo wallet por wallet/);
		expect(bodies.fr).toMatch(/ne calcule pas encore la base de coût wallet par wallet/);
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
