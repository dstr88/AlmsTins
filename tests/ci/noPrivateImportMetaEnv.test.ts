import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Astro 6 copies every import.meta.env value into the built files at build time. A secret read
 * that way (import.meta.env.CRON_SECRET, or the whole import.meta.env object) ends up written
 * inside dist/server on Render, and changing it in Render does nothing until the next build.
 * Server settings are read from process.env instead (db.ts loads .env for local dev).
 *
 * Allowed: the PUBLIC_ names (meant for the browser) and Astro's own build flags.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const ALLOWED_NAMES = /^(PUBLIC_[A-Z0-9_]*|DEV|PROD|SSR|MODE|SITE|BASE_URL)$/;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(ts|tsx|js|mjs|astro)$/.test(name)) out.push(full);
	}
	return out;
}

/** Strip // and block comments so a comment that mentions import.meta.env doesn't count. */
function code(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no private import.meta.env reads', () => {
	const files = walk(SRC);

	it('reads no non-public name through import.meta.env', () => {
		const bad: string[] = [];
		for (const file of files) {
			for (const m of code(readFileSync(file, 'utf8')).matchAll(/import\.meta\.env\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
				if (!ALLOWED_NAMES.test(m[1])) bad.push(`${path.relative(ROOT, file)}: import.meta.env.${m[1]}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('never reads the whole import.meta.env object', () => {
		const bad: string[] = [];
		for (const file of files) {
			const text = code(readFileSync(file, 'utf8'));
			// import.meta.env not followed by a property access, and (import.meta as ...).env
			if (/import\.meta\.env(?!\??\.[A-Za-z_])/.test(text) || /\(\s*import\.meta\s+as\b[^)]*\)\s*\.env/.test(text)) {
				bad.push(path.relative(ROOT, file));
			}
		}
		expect(bad).toEqual([]);
	});
});
