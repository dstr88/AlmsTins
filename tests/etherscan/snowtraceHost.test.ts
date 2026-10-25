import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Snowtrace's old API host (api.snowtrace.io) has answered 404 since Routescan took it over, and
 * the wallet holdings route kept calling it, so Avalanche holdings never loaded. Every Avalanche
 * API call goes to Routescan through SNOWTRACE_BASE_URL in src/lib/etherscan.ts. The snowtrace.io
 * website itself (explorer pages, the CSV download) is still live and is not matched here.
 */

const ROOT = path.resolve(__dirname, '../..');
const walk = (dir: string, out: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

describe('Avalanche API host', () => {
	it('nothing in src names api.snowtrace.io', () => {
		const hits = walk(path.join(ROOT, 'src')).filter((f) => /api\.snowtrace\.io/i.test(readFileSync(f, 'utf8'))).map(rel);
		expect(hits).toEqual([]);
	});

	it('the holdings route takes its Avalanche base URL from etherscan.ts, which points at Routescan', () => {
		const holdings = readFileSync(path.join(ROOT, 'src/pages/api/wallets/[id]/holdings.ts'), 'utf8');
		expect(holdings).toMatch(/import \{[^}]*\bSNOWTRACE_BASE_URL\b[^}]*\} from '@\/lib\/etherscan'/);
		expect(holdings).not.toMatch(/const SNOWTRACE_BASE_URL\s*=/);
		const etherscan = readFileSync(path.join(ROOT, 'src/lib/etherscan.ts'), 'utf8');
		expect(etherscan).toMatch(/export const SNOWTRACE_BASE_URL = 'https:\/\/api\.routescan\.io\/v2\/network\/mainnet\/evm\/43114\/etherscan\/api'/);
	});
});
