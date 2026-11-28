import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { en, es, fr } from '@/i18n/dashboard/walletApprovals';

/**
 * The standing approvals copy is honest (Donnie, Nov 28, 2026): no approval is ever called safe, and
 * nothing says Almstins protects anyone. The one place the word appears is the negated "How it works"
 * heading he wrote, "Why none of these is safe", allowed here word for word in each language and
 * nowhere else. No em dashes. The lead line and empty state are his wording.
 */

const LOCALES = { en, es, fr };

/** The only strings allowed to contain the word, one per language: the negated heading. */
const NEGATED_HEADING: Record<keyof typeof LOCALES, string> = {
	en: 'Why none of these is safe',
	es: 'Por qué ninguna de estas es segura',
	fr: 'Pourquoi aucune n’est sûre',
};

const SAFE = /\bsafe|\bsafety|segur[oa]s?\b|seguridad|\bsûr(e|s|es)?\b|sécuris/i;
const PROTECT = /protect|proteg|protèg|protég/i;

/** Every string in a locale, with functions called on sample values. */
function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'function') return [String((value as (...a: unknown[]) => unknown)(3, 'Example'))];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('standing approvals copy', () => {
	for (const [lang, t] of Object.entries(LOCALES) as Array<[keyof typeof LOCALES, typeof en]>) {
		describe(lang, () => {
			const all = strings(t);

			it('the word "safe" appears only in the negated heading', () => {
				expect(t.howItWorks.map((i) => i.title)).toContain(NEGATED_HEADING[lang]);
				const offenders = all.filter((s) => SAFE.test(s) && s !== NEGATED_HEADING[lang]);
				expect(offenders).toEqual([]);
			});

			it('never says Almstins protects', () => {
				expect(all.filter((s) => PROTECT.test(s))).toEqual([]);
			});

			it('has no em dashes', () => {
				expect(all.filter((s) => s.includes('—'))).toEqual([]);
			});

			it('says Almstins never asks for a signature, and names revoke.cash', () => {
				expect(t.cancelNote).toMatch(/revoke\.cash/);
				expect(t.howItWorks.some((i) => /revoke\.cash/.test(i.body))).toBe(true);
			});

			it('covers the six points of the plan in five items, the time shown at the top', () => {
				expect(t.howItWorks).toHaveLength(5);
			});
		});
	}

	it("the lead line and empty state are Donnie's wording", () => {
		expect(en.lead).toBe('Each approval below lets a contract take these tokens or NFTs without asking you again, until you cancel it.');
		expect(en.empty).toBe('No standing approvals found on Ethereum, Polygon, Avalanche or Arbitrum.');
		expect(en.groupRevokeFirst).toBe('Revoke first');
		expect(en.groupStillARisk).toBe('Still a risk');
		expect(en.howItWorks[1].body.endsWith('The list is as of the time shown at the top.')).toBe(true);
	});

	it('the component and its stylesheet draw nothing as fine: no gain colour, no "safe" or "ok" state', () => {
		const root = path.resolve(__dirname, '../..');
		const tsx = readFileSync(path.join(root, 'src/components/dashboard/WalletApprovals.tsx'), 'utf8');
		const css = readFileSync(path.join(root, 'src/components/dashboard/walletApprovals.css'), 'utf8');
		const types = readFileSync(path.join(root, 'src/lib/approvals/types.ts'), 'utf8');
		expect(css).not.toMatch(/--gain/);
		expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
		expect(tsx).not.toMatch(/'safe'|'ok'|"safe"/);
		expect(types).not.toMatch(/'safe'|'ok'/);
	});

	it('credits GoPlus (licence s.3 and s.5) only when GoPlus answered for a spender', () => {
		const tsx = readFileSync(path.resolve(__dirname, '../../src/components/dashboard/WalletApprovals.tsx'), 'utf8');
		expect(tsx).toContain("import PoweredByGoPlus from '@/components/PoweredByGoPlus';");
		expect(tsx).toMatch(/approvals\.some\(\(a\) => a\.spender\.checker\?\.goplus\) && <PoweredByGoPlus label=\{t\.poweredByGoPlus\} \/>/);
		for (const t of [en, es, fr]) expect(t.poweredByGoPlus).toBe('Powered by GoPlus Security');
	});
});
