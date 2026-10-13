import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ownerCopy from '../../src/i18n/components/ownerLabel';
import { OWNER_LABEL_MAX } from '../../src/lib/walletOwnerLabel';

/**
 * The "Whose account is this?" field on the wallet cards (WalletOverview.tsx) and the exchange
 * account cards (ExchangeAccountCard.astro), the routes behind them, and the demo seed.
 *
 *   - The copy is EN/ES/FR with the same keys, no em dash, and no tax-product wording.
 *   - The typed owner label is only rendered as text: an Astro attribute or text expression
 *     (escaped), React text, or textContent; never innerHTML or dangerouslySetInnerHTML.
 *   - Every exchange route passes its own stored source to the shared handler.
 *   - The dead blur listener in CryptoComAccounts.astro is gone.
 *   - The demo's owners are generic roles, never names.
 */

// Hermetic: the constant comes from a module that imports the database client.
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [] }), batch: async () => [] } }));

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'fr'] as const;

const TAX_PRODUCT = /tax-ready|tax ready|listo para impuestos|prêt pour les impôts|Form 8949|Schedule D|1099/i;

describe('the copy', () => {
	it.each([
		['en', 'Whose account is this?'],
		['es', '¿De quién es esta cuenta?'],
		['fr', 'À qui appartient ce compte ?'],
	] as const)('%s: the field label', (lang, label) => {
		expect(ownerCopy[lang].fieldLabel).toBe(label);
	});

	it.each(LANGS)('%s: same keys as English, no em dash, no tax product', (lang) => {
		const { lang: _l, ...rest } = ownerCopy[lang];
		const { lang: _e, ...enRest } = ownerCopy.en;
		expect(Object.keys(rest).sort()).toEqual(Object.keys(enRest).sort());
		const text = JSON.stringify(rest);
		expect(text).not.toMatch(/—/);
		expect(text).not.toMatch(TAX_PRODUCT);
		expect(Object.values(rest).every((v) => typeof v === 'string' && v.trim() !== '')).toBe(true);
	});

	it.each(LANGS)('%s: the limit in the copy is the limit the server applies', (lang) => {
		expect(ownerCopy[lang].tooLong).toContain(String(OWNER_LABEL_MAX));
		expect(ownerCopy[lang].hint).toContain(String(OWNER_LABEL_MAX));
	});
});

describe('the exchange account card', () => {
	const card = read('src/components/ExchangeAccountCard.astro');
	const ownerScript = card.slice(card.indexOf("exchangeOwnerInit !== 'true'"), card.indexOf('// Show selected filename'));

	it('shows the saved owner in an input, escaped by Astro, limited to the server maximum', () => {
		expect(card).toMatch(/ownerLabel\?: string \| null;/);
		expect(card).toMatch(/<label class="exchange-account__owner-label" for=\{ownerInputId\}>\{ot\.fieldLabel\}<\/label>/);
		expect(card).toMatch(/maxlength=\{OWNER_LABEL_MAX\}/);
		expect(card).toMatch(/value=\{ownerLabel \?\? ''\}/);
		expect(card).not.toMatch(/set:html/);
	});

	it('saves through the account update route and only ever writes text into the page', () => {
		expect(ownerScript.length).toBeGreaterThan(200);
		expect(ownerScript).toMatch(/fetch\(`\/api\/exchanges\/\$\{encodeURIComponent\(source\)\}\/accounts\/update`/);
		expect(ownerScript).toMatch(/body: JSON\.stringify\(\{ accountId, ownerLabel \}\)/);
		expect(ownerScript).toMatch(/status\.textContent = text/);
		expect(ownerScript).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
	});

	it('both exchange tins pass each account its saved owner', () => {
		expect(read('src/components/ExchangeAccounts.astro')).toMatch(/ownerLabel=\{ownerForAccount\(owners, source, account\.id\)\}/);
		expect(read('src/components/CryptoComAccounts.astro')).toMatch(/ownerLabel=\{ownerForAccount\(owners, 'crypto_com', account\.id\)\}/);
	});

	it('the dead blur listener in CryptoComAccounts.astro is gone (no element has that class)', () => {
		const crypto = read('src/components/CryptoComAccounts.astro');
		expect(crypto).not.toMatch(/exchange-account__name/);
		expect(crypto).not.toMatch(/addEventListener\('blur'/);
		// Renaming still has its live handler, on the card's real class.
		expect(read('src/components/ExchangeAccounts.astro')).toMatch(/classList\.contains\('exchange-account__input'\)/);
	});
});

describe('the wallet card', () => {
	const overview = read('src/components/dashboard/WalletOverview.tsx');

	it('shows the owner as React text and edits it next to the rename, with the server limit', () => {
		expect(overview).toMatch(/<span style=\{\{ color: 'var\(--text-primary\)', fontWeight: 600 \}\}>\{wallet\.ownerLabel\}<\/span>/);
		expect(overview).toMatch(/\{ot\.fieldLabel\}/);
		expect(overview).toMatch(/maxLength=\{OWNER_LABEL_MAX\}/);
		expect(overview).toMatch(new RegExp(`const OWNER_LABEL_MAX = ${OWNER_LABEL_MAX};`));
		expect(overview).not.toMatch(/dangerouslySetInnerHTML/);
	});

	it('sends the owner with the rename only when it changed', () => {
		expect(overview).toMatch(/JSON\.stringify\(ownerChanged \? \{ label: trimmed, ownerLabel: owner \} : \{ label: trimmed \}\)/);
	});

	it('the Wallets page loads each wallet its saved owner', () => {
		expect(read('src/pages/dashboard/wallets.astro')).toMatch(/ownerLabel: ownerForWalletAddress\(owners, row\.address\),/);
	});
});

describe('every exchange route uses the shared handler with its own stored source', () => {
	const ROUTES: Array<[string, string]> = [
		['cashapp', 'cashapp'],
		['coinbase', 'coinbase'],
		['crypto-com', 'crypto_com'],
		['exodus', 'exodus'],
		['gemini', 'gemini'],
		['kraken', 'kraken'],
		['robinhood', 'robinhood'],
		['venmo', 'venmo'],
	];

	it.each(ROUTES)('%s', (slug, source) => {
		expect(read(`src/pages/api/exchanges/${slug}/accounts.ts`)).toContain(
			`export const POST: APIRoute = ({ request }) => createExchangeAccount(request, '${source}');`,
		);
		expect(read(`src/pages/api/exchanges/${slug}/accounts/update.ts`)).toContain(
			`export const POST: APIRoute = ({ request }) => updateExchangeAccount(request, '${source}');`,
		);
		expect(read(`src/pages/api/exchanges/${slug}/accounts/delete.ts`)).toContain(`removeAccountIdentity(tenantId, '${source}', accountId)`);
	});

	it('avalanche_cchain (delete only) removes its identity row too', () => {
		expect(read('src/pages/api/exchanges/avalanche_cchain/accounts/delete.ts')).toContain(
			"removeAccountIdentity(tenantId, 'avalanche_cchain', accountId)",
		);
	});
});

describe('the demo', () => {
	const start = read('src/pages/api/demo/start.ts');

	it('gives its wallets and accounts generic owners, Me and Spouse', () => {
		expect(start).toMatch(/const DEMO_OWNER_ME = 'Me';/);
		expect(start).toMatch(/const DEMO_OWNER_SPOUSE = 'Spouse';/);
		const block = start.slice(start.indexOf('const owned:'), start.indexOf("return batch('owner-labels'"));
		for (const addr of ['ADDR_BTC', 'ADDR_ETH', 'ADDR_POL', 'ADDR_AVAX']) expect(block).toContain(`walletKeysFromChains(${addr},`);
		expect(block).toContain("cexWalletKey('coinbase', ACCT_CB)");
		expect(block).toContain("cexWalletKey('crypto_com', ACCT_CRY)");
		expect(block.match(/\[k, DEMO_OWNER_(ME|SPOUSE)\]|, DEMO_OWNER_(ME|SPOUSE)\]/g)).toHaveLength(6);
	});

	it('clears the demo owners on cleanup, scoped to the demo tenant', () => {
		expect(start).toMatch(/DELETE FROM wallet_identity WHERE tenant_id = \?`, args: \[DEMO_TENANT_ID\]/);
		expect(read('src/pages/api/demo/cleanup.ts')).toMatch(/'wallet_identity',/);
	});
});
