import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * QR codes are made in one place and read in one place (Area 5). The same lazy `import('qrcode')`
 * block had been copied into three screens, and three camera scanners called jsQR themselves. This
 * fails the day someone loads either library somewhere else:
 *   - `qrcode` only in src/lib/qrMake.ts (use toQrDataUrl, or <QrImage> from src/components/ui/QrImage.tsx),
 *   - `jsqr` only in src/lib/qrScan.ts (use decodeQrFromImageData for a camera frame, or
 *     decodeQrFromImageFile / promptScan / <qr-scan-button> for a photo).
 *
 * ALLOWED lists files that cannot move yet, each with the reason. It is empty and only shrinks: an
 * entry whose file no longer loads the library fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');

const RULES = {
	qrcode: {
		home: 'src/lib/qrMake.ts',
		pattern: /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]qrcode['"]/g,
		fix: 'use toQrDataUrl from src/lib/qrMake.ts, or <QrImage> from src/components/ui/QrImage.tsx',
	},
	jsqr: {
		home: 'src/lib/qrScan.ts',
		pattern: /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]jsqr['"]/g,
		fix: 'use decodeQrFromImageData (a camera frame) or decodeQrFromImageFile (a photo) from src/lib/qrScan.ts',
	},
} as const;
type Rule = keyof typeof RULES;

const ALLOWED: Record<Rule, Record<string, string>> = {
	qrcode: {},
	jsqr: {},
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
	const text = readFileSync(file, 'utf8');
	for (const rule of Object.keys(RULES) as Rule[]) {
		if (rel === RULES[rule].home) continue;
		const found = [...text.matchAll(RULES[rule].pattern)].map((m) => `line ${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
		if (found.length) hits.get(rule)!.set(rel, found);
	}
}

describe('QR codes are made in one place and read in one place', () => {
	for (const rule of Object.keys(RULES) as Rule[]) {
		const { fix, home } = RULES[rule];

		it(`${rule}: loaded only in ${home}`, () => {
			const strays = Object.fromEntries([...hits.get(rule)!].filter(([f]) => !(f in ALLOWED[rule])));
			expect(strays, fix).toEqual({});
		});

		it(`${rule}: every allowlisted file still loads it, and has a reason`, () => {
			for (const [file, reason] of Object.entries(ALLOWED[rule])) {
				expect(hits.get(rule)!.has(file), `${file} no longer loads ${rule}: remove it from ALLOWED`).toBe(true);
				expect(reason.length).toBeGreaterThan(20);
			}
		});

		it(`${rule}: its home still loads it`, () => {
			expect(readFileSync(path.join(ROOT, home), 'utf8')).toMatch(new RegExp(RULES[rule].pattern.source));
		});
	}

	it('the shared pieces are where the rules point', () => {
		expect(readFileSync(path.join(ROOT, 'src/lib/qrMake.ts'), 'utf8')).toMatch(/await import\('qrcode'\)/); // lazy: no page pays for it until it draws a QR
		expect(readFileSync(path.join(ROOT, 'src/components/ui/QrImage.tsx'), 'utf8')).toMatch(/from '@\/lib\/qrMake'/);
		expect(readFileSync(path.join(ROOT, 'src/lib/qrScan.ts'), 'utf8')).toMatch(/inversionAttempts: 'attemptBoth'/);
	});

	it('the patterns still find the loads they are for', () => {
		const sample = [
			"import QRCode from 'qrcode';",
			"const mod = (await import('qrcode')) as unknown as {",
			'const q = require("qrcode");',
			"import jsQR from 'jsqr';",
			"const { default: jsQR } = await import( 'jsqr' );",
			"import type { QRCodeRenderersOptions } from 'qrcode-svg';",
			"if (!toDataURL) throw new Error('qrcode');",
			'// on-device (jsQR via qrScan.ts)',
		];
		const found = sample.map((line) => (Object.keys(RULES) as Rule[]).filter((r) => new RegExp(RULES[r].pattern.source).test(line)));
		expect(found).toEqual([['qrcode'], ['qrcode'], ['qrcode'], ['jsqr'], ['jsqr'], [], [], []]);
	});
});
