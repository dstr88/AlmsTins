import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Money and dates are written in one place: src/lib/format.ts (Area 3). About 20 dollar
 * formatters and 26 date formatters had drifted apart: some wrote en-US, some the browser's
 * language, some `$-5.00`, so the same amount looked different from screen to screen. This fails
 * the day someone writes a new copy instead of importing the shared one:
 *   - a currency NumberFormat or toLocaleString (`style: 'currency'`),
 *   - a dollar amount built by hand (`$${n.toFixed(2)}`, `'$' + n.toLocaleString()`),
 *   - a currency code glued to a toLocaleString amount (`${ccy} ${n.toLocaleString()}`),
 *   - a date formatter (toLocaleDateString, toLocaleTimeString, Intl.DateTimeFormat, or
 *     toLocaleString on a Date or with date options).
 *
 * ALLOWED lists the files that cannot move, each with the reason. It only shrinks: an entry whose
 * file no longer has the copy fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');
const HOME = 'src/lib/format.ts';

const RULES = {
	currencyStyle: {
		pattern: /style\s*:\s*['"]currency['"]/g,
		fix: 'use formatUsd (or formatMoney for another currency) from src/lib/format.ts',
	},
	handBuiltDollars: {
		pattern: /\$\$\{[^}`]*?\b(?:toLocaleString|toFixed)\(|\$['"]\s*\+\s*[^;\n]*?\b(?:toLocaleString|toFixed)\(/g,
		fix: 'use formatUsd from src/lib/format.ts (signed, cents and empty cover the variants)',
	},
	currencyCodeAmount: {
		pattern: /\$\{\s*[\w.]*(?:ccy|currency|Currency)\s*\}\s\$\{[^}]*?\btoLocaleString\(/g,
		fix: 'use formatMoney from src/lib/format.ts',
	},
	dateFormatter: {
		pattern:
			/\.toLocaleDateString\(|\.toLocaleTimeString\(|\bIntl\.DateTimeFormat\(|\bnew Date\([^()]*(?:\([^()]*\))?[^()]*\)\.toLocaleString\(|\.toLocaleString\([^)]*\b(?:month|hour|weekday|dateStyle|timeStyle)\s*:/g,
		fix: 'use formatDate / formatDateTime / formatTime (screens, in the user language) or formatFileDate / formatUtc (files) from src/lib/format.ts',
	},
} as const;
type Rule = keyof typeof RULES;

const ALLOWED: Record<Rule, Record<string, string>> = {
	currencyStyle: {},
	handBuiltDollars: {
		'src/lib/annualBreakdown.ts':
			'the estimated-basis note is part of the breakdown the tax files print; changing it would change those files.',
		'src/lib/aave/syncAaveLiquidations.ts':
			'builds the description stored on each liquidation row; changing it would change stored data.',
		'src/pages/api/research/attachment.ts':
			'the mismatch text is stored in transaction_screenshots.validation_json; changing it would change stored data.',
		'src/pages/api/research/ai-triage.ts':
			'a plain $12.34 inside the prompt sent to the model, never shown to a person.',
		'src/pages/api/billing/webhook.ts':
			'the owner notification email; Area 3 changes screens only, so its text stays as it is.',
		'src/pages/aave-alisis.astro':
			'chart axis labels in its own compact style ($1.23B, $4.5K); formatUsd compact rounds to one decimal.',
		'src/pages/dashboard/yearEnd/gains.astro':
			'the year chart labels its bars in thousands (+$1.2k, ($3.4k)), its own compact style.',
		'src/pages/dashboard/petro-tins.astro':
			'one large is:inline script whose functions inline onclick handlers call; amounts are dynamic, so no data- attribute. en-US already.',
		'src/pages/dashboard/research.astro':
			'the first, inline renderer of Needs Attention (must stay synchronous, see CLAUDE.md); en-US like formatUsd, and the module re-renders with formatUsd.',
		'src/scripts/diagnoseAssets.mjs': 'a command-line diagnostic, not part of the app.',
		'src/scripts/diagnosePortfolio.mjs': 'a command-line diagnostic, not part of the app.',
	},
	currencyCodeAmount: {
		'src/lib/receivablesRegistry.ts':
			'builds the text of signed, stored attestation statements (up to 3 decimals); changing it would change new records.',
	},
	dateFormatter: {
		'src/pages/dashboard/research.astro':
			'the admin activity log script is rendered inside {isAdmin && ...}, so Astro leaves it inline (no imports); admin only.',
		'src/pages/dashboard/transactions.astro':
			'a 240-line untyped inline module script; it gets the user locale from the define:vars bridge, typing it to bundle is its own task.',
		'src/pages/dashboard/yearEnd/report.astro':
			'the "Generated" line of the downloaded HTML report, a file; files keep their formats (D2).',
	},
};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(p);
	}
	return out;
}

const hits = new Map<Rule, Map<string, string[]>>();
for (const rule of Object.keys(RULES) as Rule[]) hits.set(rule, new Map());
for (const file of walk(path.join(ROOT, 'src'))) {
	const rel = path.relative(ROOT, file).split(path.sep).join('/');
	if (rel === HOME) continue;
	const text = readFileSync(file, 'utf8');
	for (const rule of Object.keys(RULES) as Rule[]) {
		const found = [...text.matchAll(RULES[rule].pattern)].map((m) => `line ${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
		if (found.length) hits.get(rule)!.set(rel, found);
	}
}

describe('money and dates are formatted in one place', () => {
	for (const rule of Object.keys(RULES) as Rule[]) {
		const { fix } = RULES[rule];

		it(`${rule}: no copy outside ${HOME}`, () => {
			const strays = Object.fromEntries([...hits.get(rule)!].filter(([f]) => !(f in ALLOWED[rule])));
			expect(strays, fix).toEqual({});
		});

		it(`${rule}: every allowlisted file still has its copy, and a reason`, () => {
			for (const [file, reason] of Object.entries(ALLOWED[rule])) {
				expect(hits.get(rule)!.has(file), `${file} no longer has a ${rule} copy: remove it from ALLOWED`).toBe(true);
				expect(reason.length).toBeGreaterThan(20);
			}
		});
	}

	it('the patterns still find the copies they are for', () => {
		const sample = [
			"new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })",
			"const a = `$${n.toFixed(2)}`;",
			"const b = '$' + Number(n).toLocaleString();",
			"html += '<b>$' + n.toLocaleString('en-US') + '</b>';",
			"const c = `${ccy} ${n.toLocaleString('en-US')}`;",
			"d.toLocaleDateString('en-US')",
			"d.toLocaleTimeString()",
			"new Intl.DateTimeFormat('fr-FR', {})",
			"new Date(iso).toLocaleString()",
			"new Date(Number(x)).toLocaleString('es-ES')",
			"x.toLocaleString(undefined, { month: 'short' })",
			"n.toLocaleString('en-US', { maximumFractionDigits: 6 })",
		];
		const found = sample.map((line) => (Object.keys(RULES) as Rule[]).filter((r) => new RegExp(RULES[r].pattern.source).test(line)));
		expect(found).toEqual([
			['currencyStyle'], ['handBuiltDollars'], ['handBuiltDollars'], ['handBuiltDollars'], ['currencyCodeAmount'],
			['dateFormatter'], ['dateFormatter'], ['dateFormatter'], ['dateFormatter'], ['dateFormatter'], ['dateFormatter'],
			[],
		]);
	});
});
