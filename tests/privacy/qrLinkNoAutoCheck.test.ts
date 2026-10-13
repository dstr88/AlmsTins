import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { en, es, fr } from '../../src/i18n/walletChecker';

/**
 * A scanned QR link waits for the person to press Check site (privacy policy v1.2,
 * section 7). Checking sends the full link to GoPlus, Google Safe Browsing and VirusTotal,
 * and a link from a QR code can carry a private code. A scanned wallet address is public
 * and is still checked right away. The page script cannot run hermetically, so this pins
 * the source.
 */

const page = readFileSync(path.resolve(__dirname, '../../src/components/WalletCheckerPage.astro'), 'utf8');

describe('a scanned QR link', () => {
	it('fills the site checker without starting the check', () => {
		const handler = page.slice(page.indexOf("'almstins:scanned-url'"));
		expect(handler.slice(0, 300)).toMatch(/activateDappCheck\(url, false\)/);
	});

	it('only clicks Check on its own when asked to run', () => {
		expect(page).toMatch(/if \(run\) setTimeout\(\(\) => checkBtn\.click\(\), 350\);/);
		expect(page).not.toMatch(/^\s*setTimeout\(\(\) => checkBtn\.click\(\), 350\);/m);
	});
});

describe('scanner copy says exactly that', () => {
	it.each([
		['en', en, /checked right away.*waits until you press Check site/],
		['es', es, /se verifica de inmediato.*espera hasta que pulses Verificar sitio/],
		['fr', fr, /vérifiée immédiatement.*attend que vous appuyiez sur Vérifier le site/],
	])('%s', (_lang, locale, pattern) => {
		expect((locale as typeof en).checker.scanPrivacy).toMatch(pattern);
	});
});
