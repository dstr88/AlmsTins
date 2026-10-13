import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Almstins never files scam reports in its own name (decided 2026-10-08), and its own
 * spam-airdrop domain list can only raise a caution.
 *
 * Before: every new domain harvested from a spam token name was submitted to VirusTotal
 * and to URLScan as a public scan, and a hit on that list turned the site check red
 * ("Almstins Community") and hid every other source, even for a site MetaMask lists as
 * verified-safe. A token name is attacker-chosen text, so anyone could airdrop "Claim at
 * <real site>" and make a real site read DANGER. Separately, any contract whose
 * Etherscan name contained "hack", "drain" or "exploit" was marked blacklisted.
 *
 * The db, the check log and every outside fetch are stubbed: no database, no network.
 */

// known_phishing_domains, as the stubbed database holds it.
const state = vi.hoisted(() => ({ airdropList: new Set<string>(), batches: [] as unknown[] }));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (q: { sql: string; args?: unknown[] } | string) => {
			const sql = typeof q === 'string' ? q : q.sql;
			const args = typeof q === 'string' ? [] : (q.args ?? []);
			if (sql.includes('FROM known_phishing_domains WHERE domain = ?')) {
				const domain = String(args[0]);
				return { rows: state.airdropList.has(domain) ? [{ domain, source: 'token_airdrop' }] : [], rowsAffected: 0 };
			}
			return { rows: [], rowsAffected: 0 };
		},
		batch: async (stmts: unknown[]) => { state.batches.push(stmts); return []; },
	},
}));
vi.mock('@/lib/checkLog', () => ({ recordCheck: () => {} }));
vi.mock('@/lib/threatLists', () => ({ lookupSanctionedAddress: async () => false }));

// The outside world: the three GitHub lists, GoPlus and URLScan search.
const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
	const url = String(input);
	const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
	if (url.includes('eth-phishing-detect')) return json({ blacklist: ['mm-blocked.site'], whitelist: ['uniswap.org'] });
	if (url.includes('scamsniffer')) return json(['sniffer-blocked.site']);
	if (url.includes('openphish')) return new Response('https://phish.example/login\n', { status: 200 });
	if (url.includes('gopluslabs.io')) return json({ result: { phishing_site: 0, website_contract_security: [] } });
	if (url.includes('urlscan.io/api/v1/search')) {
		return json({ results: [{ task: { time: '2026-10-01T00:00:00Z' }, verdicts: { overall: { malicious: false, score: 0 } } }] });
	}
	throw new Error(`unexpected fetch in a hermetic test: ${url}`);
});
vi.stubGlobal('fetch', fetchMock);

type Source = { name: string; verdict: string; detail: string };
type DappResult = { verdict: 'red' | 'yellow' | 'green'; sources: Source[] };

let GET: (ctx: { url: URL; request: Request }) => Promise<Response>;

async function checkSite(domain: string, phase = 'all'): Promise<DappResult> {
	const url = new URL(`http://localhost/api/dapp-check?url=${encodeURIComponent(domain)}&phase=${phase}`);
	const res = await GET({ url, request: new Request(url) });
	return (await res.json()) as DappResult;
}

beforeAll(async () => {
	vi.stubEnv('VIRUSTOTAL_API_KEY', '');
	vi.stubEnv('GOOGLE_SAFE_BROWSING_KEY', '');
	({ GET } = (await import('../../src/pages/api/dapp-check')) as unknown as { GET: typeof GET });
	// The lists load in the background at import; wait until MetaMask's has arrived.
	await vi.waitFor(async () => {
		const r = await checkSite('uniswap.org', 'fast');
		expect(r.sources[0].verdict).toBe('whitelisted');
	});
});

beforeEach(() => {
	state.airdropList.clear();
	state.batches.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. NOTHING IS REPORTED OR SUBMITTED ANYWHERE
// ─────────────────────────────────────────────────────────────────────────────

describe('savePhishingDomains', () => {
	afterEach(() => {
		vi.stubEnv('VIRUSTOTAL_API_KEY', '');
		vi.stubEnv('URLSCAN_API_KEY', '');
	});

	it('stores harvested domains and sends them nowhere, even with VirusTotal and URLScan keys set', async () => {
		vi.stubEnv('VIRUSTOTAL_API_KEY', 'test-vt-key');
		vi.stubEnv('URLSCAN_API_KEY', 'test-urlscan-key');
		const { savePhishingDomains } = await import('../../src/lib/phishingDomains');
		fetchMock.mockClear();

		await savePhishingDomains(['claim-rewards.site', 'drainer.xyz']);
		await new Promise((r) => setTimeout(r, 0)); // let any stray background work start

		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.stringify(state.batches)).toContain('claim-rewards.site');
	});
});

describe('no code submits to a scan or report service', () => {
	// Reading a service (lookups, list downloads) is fine. Submitting to one is not.
	const SUBMIT_ENDPOINTS = [
		'urlscan.io/api/v1/scan',          // URLScan submission (search is /api/v1/search)
		'chainabuse.com/v0/reports/batch', // Chainabuse report filing
	];

	function sourceFiles(dir: string): string[] {
		return readdirSync(dir).flatMap((name) => {
			const p = path.join(dir, name);
			return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx|astro|mjs|js)$/.test(name) ? [p] : [];
		});
	}

	it('has no submission endpoint anywhere in src/', () => {
		const hits = sourceFiles(path.resolve(__dirname, '../../src')).flatMap((file) => {
			const text = readFileSync(file, 'utf8');
			return SUBMIT_ENDPOINTS.filter((e) => text.includes(e)).map((e) => `${path.relative(process.cwd(), file)}: ${e}`);
		});
		expect(hits).toEqual([]);
	});

	it('phishingDomains.ts makes no network calls at all', () => {
		const text = readFileSync(path.resolve(__dirname, '../../src/lib/phishingDomains.ts'), 'utf8');
		expect(text).not.toMatch(/\bfetch\(/);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SPAM-AIRDROP LIST IS A CAUTION, NEVER A VERDICT
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/dapp-check with the spam-airdrop list', () => {
	it('a list hit alone is a caution (yellow), shown next to every other source', async () => {
		state.airdropList.add('real-project.io');
		const r = await checkSite('real-project.io');

		expect(r.verdict).toBe('yellow');
		const own = r.sources.find((s) => s.verdict === 'caution');
		expect(own?.name).toBe('Spam airdrop names (Almstins)');
		expect(own?.detail).toContain('not a scam report');
		// The other sources still show: the hit no longer hides them.
		expect(r.sources.map((s) => s.name)).toEqual(expect.arrayContaining(['MetaMask Blocklist', 'ScamSniffer', 'GoPlus Security']));
		expect(r.sources.some((s) => s.verdict === 'flagged')).toBe(false);
	});

	it('a site MetaMask lists as verified-safe stays green, with no airdrop caution', async () => {
		state.airdropList.add('uniswap.org'); // e.g. an airdropped "Claim at uniswap.org"
		const r = await checkSite('uniswap.org');

		expect(r.verdict).toBe('green');
		expect(r.sources.some((s) => s.verdict === 'caution')).toBe(false);
	});

	it('an outside blocklist still makes a site red', async () => {
		const r = await checkSite('sniffer-blocked.site');
		expect(r.verdict).toBe('red');
		expect(r.sources.find((s) => s.name === 'ScamSniffer')?.verdict).toBe('flagged');
	});

	it('an outside flag plus a list hit is red, with both shown', async () => {
		state.airdropList.add('mm-blocked.site');
		const r = await checkSite('mm-blocked.site');
		expect(r.verdict).toBe('red');
		expect(r.sources.some((s) => s.verdict === 'caution')).toBe(true);
	});

	it('a site on no list is green', async () => {
		const r = await checkSite('quiet-project.io');
		expect(r.verdict).toBe('green');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ONLY OUR CURATED LIST MARKS A CONTRACT COMPROMISED
// ─────────────────────────────────────────────────────────────────────────────

describe('isCompromisedAddress', () => {
	it('flags a curated compromised contract (the Multichain router)', async () => {
		const { isCompromisedAddress } = await import('../../src/lib/walletChecker');
		expect(isCompromisedAddress('0x765277EebeCA2e31912C9946eAe1021199B39C61')).toBe(true);
	});

	it('never flags an address off the curated list, whatever its contract is named', async () => {
		const { isCompromisedAddress, isCompromisedEntity } = await import('../../src/lib/walletChecker');
		// The words alone would match a deployer-chosen name; that is why the gate is the address.
		expect(isCompromisedEntity({ name: 'HackathonRewards', type: 'contract', subLabel: null, url: null, confidence: 'definite' } as never)).toBe(true);
		expect(isCompromisedAddress('0x000000000000000000000000000000000000dEaD')).toBe(false);
		expect(isCompromisedAddress('0x1111111111111111111111111111111111111111')).toBe(false);
	});
});
