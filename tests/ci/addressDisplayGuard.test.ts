import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Addresses are shortened, copied and shown in one place (Area 4). Four copy buttons and about
 * twenty shorteners with six different lengths (6…4, 8…4, 8…6, 9…7, 10…6, 10…8, 12…8) had drifted
 * apart, so the same address looked different from screen to screen. This fails the day someone
 * writes a new copy instead of using the shared one:
 *   - a copy button component of its own (use src/components/ui/CopyButton.tsx),
 *   - an address or hash cut to its head and tail by hand (use shortenAddress from
 *     src/lib/addressDisplay.ts, or <Address> / <AddressText> from src/components/ui),
 *   - an address cut to its head alone (`address.slice(0, 8) + '…'`), which hides the tail an
 *     address-poisoning look-alike gets wrong,
 *   - a clipboard write (use copyText from src/lib/clipboard.ts, or <CopyButton>).
 *
 * ALLOWED lists the files that cannot move, each with the reason. It only shrinks: an entry whose
 * file no longer has the copy fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');
const HOMES = new Set([
	'src/lib/addressDisplay.ts',
	'src/lib/clipboard.ts',
	'src/components/ui/CopyButton.tsx',
	'src/components/ui/Address.tsx',
	'src/components/ui/AddressText.astro',
]);

const RULES = {
	copyButton: {
		pattern: /\b(?:function|const|let)\s+Copy(?:Button|Address)\b/g,
		fix: 'use <CopyButton> from src/components/ui/CopyButton.tsx (variant, words, className and style cover the looks)',
	},
	headAndTail: {
		pattern: /\.slice\(0,\s*\d+\)[^;\n]{0,60}?(?:…|\\u2026|\.\.\.|&hellip;)[^;]{0,60}?\.slice\(-\d+\)/g,
		fix: 'use shortenAddress from src/lib/addressDisplay.ts (8…6, D4), or <Address> / <AddressText>',
	},
	headOnlyAddress: {
		pattern: /\b\w*(?:address|Address|addr|Addr)\)?\.slice\(0,\s*\d+\)\s*(?:\+\s*['"`]|\})(?:…|\\u2026|\.\.\.|&hellip;)(?![^;\n]{0,60}\.slice\(-\d+\))/g,
		fix: 'use shortenAddress from src/lib/addressDisplay.ts: it keeps the tail too (D4)',
	},
	clipboardWrite: {
		pattern: /\bclipboard\??\.writeText\b/g,
		fix: 'use copyText from src/lib/clipboard.ts, or <CopyButton> in React',
	},
} as const;
type Rule = keyof typeof RULES;

const STORED = 'changing it would change stored data (Area 4 changes screens only).';

const ALLOWED: Record<Rule, Record<string, string>> = {
	copyButton: {},
	headAndTail: {
		'src/lib/sync/syncSolanaTransactions.ts': `the fallback for an unknown mint is stored as the row's asset symbol; ${STORED}`,
		'src/pages/api/cron/monthly-digest.ts': `the counterparty is part of the description saved in monthly_digests.items_json; ${STORED}`,
		'src/pages/verify/desk.astro':
			'a receivable ID, not an address, on the live receivables pilot desk, whose imports componentSplit.test.ts pins to receivables modules.',
	},
	headOnlyAddress: {
		'src/lib/sync/syncBtcAddress.ts': `the account name and the counterparty text it writes are stored; ${STORED}`,
		'src/lib/sync/syncSolanaTransactions.ts': `the account name it writes is stored; ${STORED}`,
		'src/pages/api/import/snowtrace.ts': `the account name and the description it writes are stored; ${STORED}`,
		'src/pages/api/import/snowtrace-sync.ts': `the account name and the counterparty text it writes are stored; ${STORED}`,
		'src/pages/dashboard/research.astro':
			'the fallback wallet label is also the value of the wallet <option> a person picks, not only text; changing it changes what is picked.',
	},
	clipboardWrite: {
		'src/lib/receivables/client/copyText.ts':
			'the live receivables pilot pages\' copy helper: it tells "no clipboard" (button left alone) from "refused" (failed label), which copyText does not; its pages may import receivables modules only.',
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
	if (HOMES.has(rel)) continue;
	const text = readFileSync(file, 'utf8');
	for (const rule of Object.keys(RULES) as Rule[]) {
		const found = [...text.matchAll(RULES[rule].pattern)].map((m) => `line ${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
		if (found.length) hits.get(rule)!.set(rel, found);
	}
}

describe('addresses are shortened, copied and shown in one place', () => {
	for (const rule of Object.keys(RULES) as Rule[]) {
		const { fix } = RULES[rule];

		it(`${rule}: no copy outside the shared pieces`, () => {
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

	it('the shared pieces are where the rules point', () => {
		for (const home of HOMES) expect(statSync(path.join(ROOT, home)).isFile(), home).toBe(true);
		expect(readFileSync(path.join(ROOT, 'src/lib/clipboard.ts'), 'utf8')).toMatch(/navigator\.clipboard\.writeText\(value\)/);
		expect(readFileSync(path.join(ROOT, 'src/components/ui/CopyButton.tsx'), 'utf8')).toMatch(/from '@\/lib\/clipboard'/);
		expect(readFileSync(path.join(ROOT, 'src/components/ui/CopyButton.tsx'), 'utf8')).toMatch(/aria-label=\{name\}/);
	});

	it('the patterns still find the copies they are for', () => {
		const sample = [
			'function CopyButton({ text }: { text: string }) {',
			'const CopyAddress = () => null;',
			'return `${addr.slice(0, 9)}…${addr.slice(-7)}`;',
			"wallet.walletAddress.slice(0, 6) + '...' + wallet.walletAddress.slice(-4)",
			'<span>{address.slice(0, 6)}…{address.slice(-4)}</span>',
			'const short = `${id.slice(0, 10)}\\u2026${id.slice(-6)}`;',
			"{w.label || w.address.slice(0,14) + '…'}",
			'`Bitcoin Wallet (${address.slice(0, 12)}…)`',
			'navigator.clipboard.writeText(text)',
			'void navigator.clipboard?.writeText(file);',
			'const year = date.getFullYear().toString().slice(-2);',
			"name.textContent = doc.filename.length > 18 ? doc.filename.slice(0, 15) + '…' : doc.filename;",
			'export function VaultCopyButton({ value }: { value: string }) {',
		];
		const found = sample.map((line) => (Object.keys(RULES) as Rule[]).filter((r) => new RegExp(RULES[r].pattern.source).test(line)));
		expect(found).toEqual([
			['copyButton'], ['copyButton'],
			['headAndTail'], ['headAndTail'], ['headAndTail'], ['headAndTail'],
			['headOnlyAddress'], ['headOnlyAddress'],
			['clipboardWrite'], ['clipboardWrite'],
			[], [], [],
		]);
	});
});
