import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Vault's welcome card and tour for an empty account (Nov 25, 2026, option B of
 * Planning/claudeWalletWatcherWelcome-plan.html):
 *
 *   - the first-run rule: an account with no wallet, exchange account or import sees it; the
 *     demo, an account with anything in it, and an account whose records could not be read never do;
 *   - the facts loader reads only what the rule needs, and answers "unknown" on a database error;
 *   - the card's English is the wording Donnie approved, and the three languages line up;
 *   - every tour step points at something an empty Vault actually renders, and the tour ends on
 *     the wallet address field;
 *   - the card is rendered hidden (the client script shows it), with its styles in its own sheet;
 *   - the demo no longer promises to save the sample vault into a new account;
 *   - the FAQ answers "Where do I start?" in all three languages.
 *
 * The client behaviour (show unless answered, the tour, the focus) runs in a browser and is not
 * covered here.
 */

const state = vi.hoisted(() => ({
	rows: [] as Record<string, unknown>[],
	fail: false,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
}));
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args: unknown[] }) => {
			state.calls.push(stmt);
			if (state.fail) throw new Error('connection refused');
			return { rows: state.rows, rowsAffected: 0 };
		},
	},
}));

import { isVaultFirstRun, VAULT_TOUR_SELECTORS, VAULT_ADDRESS_FIELD, VAULT_WELCOME_SEEN_KEY } from '../../src/lib/vaultFirstRun';
import { loadVaultFirstRunFacts } from '../../src/lib/vaultFirstRunFacts';
import { en, es, fr, getVaultWelcome } from '../../src/i18n/components/vaultWelcome';
import * as vaultCopy from '../../src/i18n/dashboard/vault';
import { items as faqEn } from '../../src/i18n/faq/en';
import { items as faqEs } from '../../src/i18n/faq/es';
import { items as faqFr } from '../../src/i18n/faq/fr';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LOCALES = { en, es, fr };

describe('the first-run rule', () => {
	it('an empty account sees the welcome', () => {
		expect(isVaultFirstRun({ isDemo: false, walletCount: 0, importCount: 0 })).toBe(true);
	});
	it('the demo never does', () => {
		expect(isVaultFirstRun({ isDemo: true, walletCount: 0, importCount: 0 })).toBe(false);
	});
	it('an account with a wallet (on-chain or custom) does not', () => {
		expect(isVaultFirstRun({ isDemo: false, walletCount: 1, importCount: 0 })).toBe(false);
	});
	it('an account with an exchange account or an import does not', () => {
		expect(isVaultFirstRun({ isDemo: false, walletCount: 0, importCount: 1 })).toBe(false);
	});
	it('an account whose records could not be read does not', () => {
		expect(isVaultFirstRun({ isDemo: false, walletCount: 0, importCount: null })).toBe(false);
	});
});

describe('the facts loader', () => {
	beforeEach(() => {
		state.rows = [];
		state.fail = false;
		state.calls = [];
	});

	it('reads exchange accounts and imports for the tenant, and nothing for the demo or a wallet holder', async () => {
		state.rows = [{ has_exchange: false, has_import: false }];
		expect(await loadVaultFirstRunFacts({ tenantId: 't-1', isDemo: false, walletCount: 0 })).toEqual({ isDemo: false, walletCount: 0, importCount: 0 });
		expect(state.calls).toHaveLength(1);
		expect(state.calls[0].sql).toContain('exchange_accounts');
		expect(state.calls[0].sql).toContain('import_transactions');
		expect(state.calls[0].args).toEqual(['t-1', 't-1']);

		state.calls = [];
		expect((await loadVaultFirstRunFacts({ tenantId: 't-1', isDemo: true, walletCount: 0 })).isDemo).toBe(true);
		expect((await loadVaultFirstRunFacts({ tenantId: 't-1', isDemo: false, walletCount: 2 })).walletCount).toBe(2);
		expect(state.calls).toHaveLength(0);
	});

	it('counts an exchange account or an import, as Postgres or SQLite returns it', async () => {
		for (const row of [{ has_exchange: true, has_import: false }, { has_exchange: 0, has_import: 1 }, { has_exchange: 't', has_import: 'f' }]) {
			state.rows = [row];
			const facts = await loadVaultFirstRunFacts({ tenantId: 't-1', isDemo: false, walletCount: 0 });
			expect(facts.importCount).toBe(1);
			expect(isVaultFirstRun(facts)).toBe(false);
		}
	});

	it('answers unknown on a database error, so the account gets the Vault as before', async () => {
		state.fail = true;
		const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
		const facts = await loadVaultFirstRunFacts({ tenantId: 't-1', isDemo: false, walletCount: 0 });
		expect(facts.importCount).toBeNull();
		expect(isVaultFirstRun(facts)).toBe(false);
		warn.mockRestore();
	});
});

describe('the welcome copy', () => {
	it('the English card is the wording Donnie approved on Nov 25, 2026', () => {
		expect(en.title).toBe('Thanks so much for trying Almstins.');
		expect(en.paragraphs).toEqual([
			"Our goal is to give you the tools to track your crypto: what you paid for it, what you own, a disposal cost and where you sent it. Almstins reads public data only, so there's nothing to connect.",
			"To get started, paste the public address of a wallet you hold yourself into the Add field, and Almstins will work out which chain it's on. If your crypto is on an exchange, upload the CSV file the exchange lets you download, from Coinbase, Kraken or any of the others listed below.",
		]);
		expect(en.tourQuestion).toBe('Want a quick tour of this page first?');
		expect(en.yes).toBe('Yes, show me');
		expect(en.notNow).toBe('Not now');
	});

	for (const [lang, t] of Object.entries(LOCALES)) {
		it(`${lang}: same shape as English, one step per tour target, nothing empty`, () => {
			expect(t.lang).toBe(lang);
			expect(getVaultWelcome(t.lang)).toBe(t);
			expect(t.paragraphs).toHaveLength(en.paragraphs.length);
			expect(t.steps).toHaveLength(VAULT_TOUR_SELECTORS.length);
			for (const s of [t.title, t.tourQuestion, t.yes, t.notNow, t.regionLabel, ...t.paragraphs, ...t.steps.flatMap((x) => [x.title, x.body]), ...Object.values(t.labels)]) {
				expect(s.trim().length).toBeGreaterThan(0);
			}
		});

		it(`${lang}: no em dashes, and never says it blocks or makes anything safe`, () => {
			const all = JSON.stringify(t);
			expect(all).not.toContain('—');
			expect(all).not.toMatch(/\bblock|\bsafe\b|bloque|segur[oa]s?\b|sécuris|sûr\b/i);
		});
	}
});

describe('the tour targets', () => {
	const vault = read('src/pages/dashboard/vault.astro');

	it('there are four steps, each pointing at a class the Vault renders for an empty account', () => {
		expect(VAULT_TOUR_SELECTORS).toHaveLength(4);
		for (const selector of VAULT_TOUR_SELECTORS) {
			const cls = selector.replace(/^\./, '');
			expect(vault).toMatch(new RegExp(`class="[^"]*\\b${cls}\\b`));
		}
	});

	it('none of them is a wallet tin, which an empty account does not have', () => {
		for (const selector of VAULT_TOUR_SELECTORS) expect(selector).not.toMatch(/wallet-tin/);
	});

	it('the tour ends on the wallet address field of the Add Asset tile', () => {
		expect(VAULT_ADDRESS_FIELD).toBe('[data-add-address]');
		expect(read('src/components/dashboard/AddAssetTin.astro')).toContain('data-add-address');
		expect(read('src/components/dashboard/vaultWelcome.client.ts')).toContain('onFinish: focus');
	});
});

describe('the card on the page', () => {
	const vault = read('src/pages/dashboard/vault.astro');
	const card = read('src/components/dashboard/VaultWelcome.astro');

	it('the Vault renders it only when the rule says so', () => {
		expect(vault).toContain('{vaultFirstRun && <VaultWelcome />}');
		expect(vault).toMatch(/isVaultFirstRun\(\s*await loadVaultFirstRunFacts\(/);
	});

	it('it is rendered hidden, on the shared tour engine, with no inline styles', () => {
		expect(card).toMatch(/<div class="vault-welcome-wrap" id="vault-welcome"[^>]*\bhidden>/);
		expect(card).toContain("import './VaultWelcome.css';");
		expect(card).toContain('<TourEngine tourId="vault-start"');
		expect(card).not.toMatch(/<style|style=/);
		expect(read('src/components/dashboard/VaultWelcome.css')).toContain('.vault-welcome-wrap[hidden]');
	});

	it('the answer stays in the browser: one local-storage key, and no request is sent', () => {
		const client = read('src/components/dashboard/vaultWelcome.client.ts');
		expect(VAULT_WELCOME_SEEN_KEY).toBe('almstins-vault-welcome-seen');
		expect(client).toContain('localStorage');
		expect(client).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|gtag/);
	});
});

describe('the demo no longer promises to save its sample vault', () => {
	const copies = { en: vaultCopy.en, es: vaultCopy.es, fr: vaultCopy.fr };

	it('the button reads "Start your own vault for free" in each language', () => {
		expect(vaultCopy.en.saveCta).toBe('Start your own vault for free →');
		expect(vaultCopy.es.saveCta).toBe('Crea tu propia bóveda gratis →');
		expect(vaultCopy.fr.saveCta).toBe('Créez votre propre coffre gratuitement →');
	});

	for (const [lang, t] of Object.entries(copies)) {
		it(`${lang}: no "save my vault", "saved to your account" or "make it yours"`, () => {
			const all = [t.saveCta, t.keepRecords, t.keepRecordsSub, t.demoBanner(1), t.demoBanner(3)].join(' ');
			expect(all).not.toMatch(/save my vault|saved to your account|make it yours|guardar mi bóveda|guardada en tu cuenta|hazla tuya|enregistrer mon coffre|enregistré sur votre compte|faites-le vôtre/i);
		});
	}

	it('the note says the sample wallets stay in the demo', () => {
		expect(vaultCopy.en.keepRecordsSub).toContain('The sample wallets stay in the demo.');
		expect(vaultCopy.es.keepRecordsSub).toContain('Las wallets de muestra se quedan en la demo.');
		expect(vaultCopy.fr.keepRecordsSub).toContain("Les wallets d'exemple restent dans la démo.");
	});
});

describe('the changelog entry', () => {
	const page = read('src/pages/changelog.astro');
	const start = page.indexOf('A new Wallet Watcher account now opens the Vault with a short welcome.');
	const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
	const text = article.replace(/<[^>]+>/g, ' ');

	it('is public and the newest entry', () => {
		expect(start).toBeGreaterThan(-1);
		expect(page.indexOf('<article')).toBe(page.lastIndexOf('<article', start));
		expect(article).toMatch(/<time class="entry-date">[A-Z][a-z]+ \d{1,2}, 2026<\/time>/);
	});

	it('says what is kept where, and what the demo button now promises', () => {
		expect(text).toContain('either answer to it is kept in your browser only');
		expect(text).toContain('"Start your own vault for free"');
		expect(text).toContain('nothing from the demo carries over to a new account');
		expect(text).not.toContain('—');
	});
});

describe('the FAQ', () => {
	it('answers "Where do I start?" in all three languages, in the same place', () => {
		for (const items of [faqEn, faqEs, faqFr]) {
			expect(items[1].id).toBe('faq-getting-started');
			expect(items.map((i) => i.id)).toEqual(faqEn.map((i) => i.id));
		}
		expect(faqEn[1].q).toBe('I just signed up. Where do I start?');
		expect(faqEn[1].a).toContain('four-step tour');
	});
});
