import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/walletChecker';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { getPrivacy } from '../../src/i18n/privacyPolicy';

/**
 * The checker's copy claims only what is live (code review 2026-10-11):
 *   - the sanctions card names the list that runs (the OFAC SDN mirror), not "international lists";
 *   - the Funding tab claims no funding-source tracing (it shows the mixer flag only);
 *   - a clean link reads "no flags found", never "safe";
 *   - the privacy policy says Chainabuse gets an address only while that lookup is on;
 *   - the page title asks no "is it safe?" question, and no copy promises "a verdict": the
 *     checker shows what each listed source reports (fact-check of the week's copy, 2026-10-11).
 * New copy carries no em dashes.
 */

const LOCALES = [['en', en], ['es', es], ['fr', fr]] as const;
const sanctionsCard = (l: typeof en) => l.signals.walletCards.find((c) => c.icon === '⚖️')!;

describe.each(LOCALES)('%s', (_lang, l) => {
	it('sanctions card names the OFAC SDN list and no "international" lists', () => {
		const body = sanctionsCard(l).body;
		expect(body).toContain('OFAC SDN');
		expect(body).not.toMatch(/international|internacional/i);
		expect(body).not.toMatch(/Chainalysis/);
	});

	it('Funding copy claims no tracing', () => {
		for (const s of [l.checker.fundingNone, l.checker.fundingEvmOnly, l.checker.fundingScope, l.checker.fundingUnavailable]) {
			expect(s).not.toMatch(/detailed|tracing|rastreo detallado|traçage détaillé/i);
		}
	});

	it('the link checker never calls a site safe', () => {
		expect(l.js.verdictSafe).not.toMatch(/SAFE|SEGUR|SÛR/i);
		expect(l.js.tipGreen).not.toMatch(/No threats detected|No se detectaron amenazas|Aucune menace détectée/i);
	});

	it('the page and SEO title is a checking task, never "is it safe?"', () => {
		expect(l.meta.title).not.toMatch(/safe|segur|sûr/i);
		expect(l.meta.title).not.toContain('—');
		expect(l.meta.title).toMatch(/Check an Address or Link Before You Send|Revisa una Dirección o un Enlace Antes de Enviar|vérifiez une adresse ou un lien avant d’envoyer/);
	});

	// Per walletChecker.ts: GoPlus and honeypot.is run for EVM only; Solana, Bitcoin, Litecoin and
	// Tron get the OFAC SDN mirror (and the Chainalysis fallback); no list covers Sui.
	it('the search and JSON-LD descriptions claim per chain only what runs', () => {
		const { description } = l.meta;
		const { appDescription } = l.jsonld;
		for (const s of [description, appDescription]) {
			expect(s, s).toMatch(/EVM/);
			expect(s, s).toMatch(/OFAC/);
			expect(s, s).toMatch(/Solana, Bitcoin, Litecoin (and|y|et) Tron/);
			expect(s, s).not.toMatch(/Solana,? (or|o|ou|and|y|et) Sui/);
			expect(s, s).not.toContain('—');
		}
		// The short description leaves Sui out; the long one says Sui gets no screening yet.
		expect(description).not.toMatch(/\bSui\b/);
		expect(appDescription).toMatch(/Sui[^.]*(no scam or sanctions screening|sin revisión de estafas ni de sanciones|sans vérification d’arnaques ni de sanctions)/);
	});

	it('no copy promises a verdict; the checker shows what each source reports', () => {
		const all = JSON.stringify(l);
		expect(all).not.toMatch(/return a verdict|devolvemos un veredicto|renvoyons un verdict|comprehensive verdict|veredicto completo|verdict complet/i);
		expect(l.modals.phishing.tip).toMatch(/what each one reports|lo que informa cada una|ce que chacune rapporte/);
		expect(l.modals.phishing.tip).toMatch(/up to 7|hasta 7|jusqu’à 7/);
	});

	it('new and changed strings carry no em dashes', () => {
		const changed = [
			l.js.verdictSafe, l.js.verdictLimited, l.js.tipGreen, l.js.tipLimited, l.js.cleanNotSafe, l.js.rateLimited,
			l.checker.limitedSanctionsBody, l.checker.safetySource,
			l.checker.fundingNone, l.checker.fundingUnavailable, l.checker.fundingScope, l.checker.fundingEvmOnly,
			sanctionsCard(l).body, l.signals.dappCards.find((c) => c.label === 'VirusTotal')!.body,
		];
		for (const s of changed) expect(s, s).not.toContain('—');
	});
});

describe('/verify/scan clean note', () => {
	it.each(['en', 'es', 'fr'] as const)('%s: present, no em dashes, never calls it safe', (lang) => {
		const note = verifyScanCopy[lang].safetyCleanNote;
		for (const s of [note.address, note.link]) {
			expect(s.length).toBeGreaterThan(40);
			expect(s).not.toContain('—');
		}
	});
});

describe('privacy policy', () => {
	it.each([
		['en', /Chainabuse<\/strong> \(run by TRM Labs, and only while we have that lookup switched on\)/],
		['es', /Chainabuse<\/strong> \(operado por TRM Labs, y solo mientras tengamos activada esa consulta\)/],
		['fr', /Chainabuse<\/strong> \(exploité par TRM Labs, et uniquement tant que cette consultation est activée\)/],
	] as const)('%s: Chainabuse receives an address only while that lookup is switched on', (lang, re) => {
		expect(getPrivacy(lang).body).toMatch(re);
	});
});
