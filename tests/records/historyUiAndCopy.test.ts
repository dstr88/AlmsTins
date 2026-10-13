import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as history from '../../src/i18n/historyExport';
import * as faq from '../../src/i18n/faq';

/**
 * The buttons and the words around the history download.
 *
 *   - Wallets and Bookkeeping offer "Download history by wallet" to any paid plan and the
 *     owner (src/lib/historyAccess.ts); a Free account sees it locked, linking to billing,
 *     never to the route, and next to it "Download my transactions (CSV)", the plain CSV
 *     every plan keeps (the privacy policy's portability promise). Both are fetched, and only
 *     the file type the button asked for is saved, so no JSON error is ever saved as a file.
 *   - Bookkeeping's Needs Attention and Income CSV buttons render for paid plans only (the
 *     rule breakdown-csv.ts applies); a Free account sees them locked.
 *   - The copy is the line the owner approved, in EN/ES/FR; it never calls the files
 *     tax-ready, and the new strings carry no em dash.
 *   - The FAQ promises only what is built: a plain CSV on every plan, the grouped download on
 *     paid plans.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'fr'] as const;

const TAX_PRODUCT =
	/tax-ready|tax ready|listo para impuestos|prêt pour les impôts|ready to attach|attach (it )?to (a|your) return|adjuntar a tu declaración|joindre à votre déclaration|tax PDF|PDF fiscal|tax breakdown|desglose fiscal|récapitulatif fiscal|Form 8949|Schedule D|1099/i;

describe('the copy', () => {
	it.each([
		['en', 'Your records, organized by wallet, for you and your tax professional.'],
		['es', 'Sus registros, organizados por billetera, para usted y su profesional de impuestos.'],
		['fr', 'Vos registres, classés par portefeuille, pour vous et votre professionnel de la fiscalité.'],
	] as const)('%s: the approved line, on the button and at the top of the index', (lang, line) => {
		expect(history[lang].ui.copyLine).toBe(line);
		expect(history[lang].file.notes.copyLine).toBe(line);
	});

	it.each(LANGS)('%s: never sells a tax product and has no em dash', (lang) => {
		const loc = history[lang];
		const text = JSON.stringify(loc) + [loc.ui.btnLabelYear(2025), loc.file.unassignedName('X'), loc.file.removedAccountName('X'), loc.file.notes.generated('d', 'p')].join(' ');
		expect(text).not.toMatch(TAX_PRODUCT);
		expect(text).not.toMatch(/—/);
	});

	it.each(LANGS)('%s: every language has the same keys', (lang) => {
		const shape = (o: unknown): unknown =>
			o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : typeof o;
		const { lang: _l, ...rest } = history[lang];
		const { lang: _e, ...enRest } = history.en;
		expect(shape(rest)).toEqual(shape(enRest));
	});

	it.each(LANGS)('%s: no column offers basis, gains, lots or holding period', (lang) => {
		const cols = [...Object.values(history[lang].file.columns), ...Object.values(history[lang].file.plainColumns)].join(' | ');
		expect(cols).not.toMatch(/basis|gain|loss|lot|holding|base|ganancia|pérdida|plus-value|moins-value|détention|tenencia/i);
	});
});

describe('the buttons', () => {
	const component = read('src/components/dashboard/HistoryDownload.astro');

	const freeBranch = component.slice(component.indexOf(') : ('), component.indexOf('<p class="hbw-copy">'));

	it('the locked button links to billing, never to the route', () => {
		expect(freeBranch).toMatch(/<a class="hbw-btn hbw-btn--locked" href="\/dashboard\/billing"/);
		expect(freeBranch).not.toMatch(/history-by-wallet/);
	});

	it('a Free account gets the plain CSV button, for the selected year on Bookkeeping', () => {
		expect(component).toMatch(/const plainHref = `\/api\/transactions\/export\$\{query\}`;/);
		expect(component).toMatch(/const query = year \? `\?year=\$\{year\}` : '';/);
		expect(freeBranch).toMatch(/href=\{plainHref\}\s+data-hbw-download\s+data-hbw-type="text\/csv"/);
		expect(freeBranch).toMatch(/\{year \? t\.plainLabelYear\(year\) : t\.plainLabel\}/);
		expect(component).toMatch(/<p class="hbw-copy">\{canDownload \? t\.copyLine : t\.lockedNote\}<\/p>/);
	});

	it.each([
		['en', '↓ Download my transactions (CSV)'],
		['es', '↓ Descargar mis transacciones (CSV)'],
		['fr', '↓ Télécharger mes transactions (CSV)'],
	] as const)('%s: the plain button label', (lang, label) => {
		expect(history[lang].ui.plainLabel).toBe(label);
	});

	it('the paid button asks for a ZIP; a download is saved only when the answer is that type', () => {
		const paid = component.slice(component.indexOf('{canDownload ? ('), component.indexOf(') : ('));
		expect(paid).toMatch(/href=\{href\}\s+data-hbw-download\s+data-hbw-type="application\/zip"/);
		expect(component).toMatch(/if \(!res\.ok \|\| !\(res\.headers\.get\('Content-Type'\) \?\? ''\)\.includes\(expected\)\) throw/);
		// No native download attribute anywhere: every save goes through that check.
		expect(component).not.toMatch(/<a\b[^>]*\sdownload(?=[\s=>])/);
	});

	it('too many rows (413) and a download already being prepared (429) show their own message', () => {
		expect(component).toMatch(/if \(res\.status === 413\) message = a\.dataset\.tooMany/);
		expect(component).toMatch(/else if \(res\.status === 429\) message = a\.dataset\.inProgress/);
		expect(component).toMatch(/const tooMany = year \? t\.btnTooManyYear : t\.btnTooMany;/);
	});

	it('Wallets shows it, decided by the plan and the owner rule', () => {
		const page = read('src/pages/dashboard/wallets.astro');
		expect(page).toMatch(/const canDownloadHistory = canDownloadHistoryByWallet\(activePlan\.id, tenantId\);/);
		expect(page).toMatch(/<HistoryDownload lang=\{lang\} canDownload=\{canDownloadHistory\} \/>/);
	});

	it('Bookkeeping shows it for the selected year, next to the Year Summary', () => {
		const page = read('src/pages/dashboard/bookkeeping.astro');
		expect(page).toMatch(/const canDownloadHistory = canDownloadHistoryByWallet\(activePlan\.id, tenantId\);/);
		expect(page).toMatch(/<HistoryDownload lang=\{lang\} canDownload=\{canDownloadHistory\} year=\{selectedYear\} layout="bar" \/>/);
	});

	it('Bookkeeping offers the Needs Attention and Income CSVs to paid plans only, locked for Free', () => {
		const page = read('src/pages/dashboard/bookkeeping.astro');
		expect(page).toMatch(/const canCsv = canDownloadBookkeepingCsv\(activePlan\.id\);/);
		for (const section of ['needsAttention', 'income']) {
			const re = new RegExp(
				`\\{canCsv \\? \\(\\s*<a href=\\{csvBase\\('${section}'\\)\\} download class="tin-csv-btn">↓ CSV</a>\\s*\\) : \\(\\s*<a href="/dashboard/billing" class="tin-csv-btn tin-csv-btn--locked"`,
			);
			expect(page, section).toMatch(re);
		}
	});
});

describe('the FAQ promises what is built', () => {
	it.each(LANGS)('%s: a plain CSV on every plan, the history download by wallet on paid plans', (lang) => {
		const text = faq[lang].items.map((i) => i.a).join('\n');
		expect(text).not.toMatch(/full transaction list as a CSV at any time|lista completa de transacciones como CSV en cualquier momento|liste complète de transactions en CSV à tout moment/);
		expect(text).not.toMatch(/<li>(Downloadable transaction list|Lista de transacciones descargable|Liste de transactions téléchargeable)<\/li>/);
		expect(text).toMatch(/Download history by wallet|Descargar historial por billetera|Télécharger l'historique par portefeuille/);
		expect(text).toMatch(/On every plan, you can download your transactions as a CSV file|En todos los planes puedes descargar tus transacciones como archivo CSV|Avec tous les forfaits, vous pouvez télécharger vos transactions dans un fichier CSV/);
		expect(text).toContain(history[lang].ui.plainLabel.replace(/^↓ /, ''));
		expect(text).toMatch(/\((every plan|todos los planes|tous les forfaits)\)<\/li>/);
	});
});
