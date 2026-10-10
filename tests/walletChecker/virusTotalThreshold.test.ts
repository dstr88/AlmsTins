import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * VirusTotal alone makes a site red only when 3 or more engines call it malicious.
 *
 * Before: one engine rating a site malicious OR merely suspicious turned the whole site
 * check red. On 2026-10-08 the live checker showed DANGER for uniswap.org (1/93) and
 * google.com (2/93). One or two flags out of ~90 engines are usually false alarms, so they
 * are now a caution (yellow) with the count shown.
 *
 * The db, the check log and every outside fetch are stubbed: no database, no network.
 */

vi.mock('@/lib/db', () => ({
	db: {
		execute: async () => ({ rows: [], rowsAffected: 0 }),
		batch: async () => [],
	},
}));
vi.mock('@/lib/checkLog', () => ({ recordCheck: () => {} }));

// VirusTotal's last_analysis_stats per site; a site not listed has never been scanned (404).
const VT_STATS: Record<string, Record<string, number>> = {
	'clean-site.io':      { malicious: 0, suspicious: 0, harmless: 70, undetected: 23 },
	'one-flag.io':        { malicious: 1, suspicious: 0, harmless: 69, undetected: 23 },
	'two-flags.io':       { malicious: 1, suspicious: 1, harmless: 68, undetected: 23 },
	'suspicious-only.io': { malicious: 0, suspicious: 6, harmless: 64, undetected: 23 },
	'three-malicious.io': { malicious: 3, suspicious: 0, harmless: 67, undetected: 23 },
	'many-malicious.io':  { malicious: 12, suspicious: 2, harmless: 56, undetected: 23 },
};

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input);
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
	if (url.includes('eth-phishing-detect')) return json({ blacklist: [], whitelist: [] });
	if (url.includes('scamsniffer')) return json([]);
	if (url.includes('openphish')) return new Response('https://phish.example/login\n', { status: 200 });
	if (url.includes('gopluslabs.io')) return json({ result: { phishing_site: 0, website_contract_security: [] } });
	if (url.includes('urlscan.io/api/v1/search')) {
		return json({ results: [{ task: { time: '2026-10-01T00:00:00Z' }, verdicts: { overall: { malicious: false, score: 0 } } }] });
	}
	if (url === 'https://www.virustotal.com/api/v3/urls' && init?.method === 'POST') {
		throw new Error('VirusTotal must never be asked to scan a link (lookup only)');
	}
	const vt = url.match(/^https:\/\/www\.virustotal\.com\/api\/v3\/urls\/([A-Za-z0-9_-]+)$/);
	if (vt) {
		const domain = Buffer.from(vt[1], 'base64url').toString().replace(/^https:\/\//, '');
		const stats = VT_STATS[domain];
		return stats ? json({ data: { attributes: { last_analysis_stats: stats } } }) : json({ error: 'NotFound' }, 404);
	}
	throw new Error(`unexpected fetch in a hermetic test: ${url}`);
});
vi.stubGlobal('fetch', fetchMock);

type Source = { name: string; verdict: string; detail: string };
type DappResult = { verdict: 'red' | 'yellow' | 'green'; sources: Source[]; vtPending: boolean };

let GET: (ctx: { url: URL; request: Request }) => Promise<Response>;

async function checkSite(domain: string, phase = 'all'): Promise<DappResult> {
	const url = new URL(`http://localhost/api/dapp-check?url=${encodeURIComponent(domain)}&phase=${phase}`);
	const res = await GET({ url, request: new Request(url) });
	return (await res.json()) as DappResult;
}

const vtSource = (r: DappResult) => r.sources.find((s) => s.name === 'VirusTotal')!;

beforeAll(async () => {
	vi.stubEnv('VIRUSTOTAL_API_KEY', 'test-vt-key');
	vi.stubEnv('GOOGLE_SAFE_BROWSING_KEY', '');
	({ GET } = (await import('../../src/pages/api/dapp-check')) as unknown as { GET: typeof GET });
	// The lists load in the background at import; wait until they have arrived.
	await vi.waitFor(async () => {
		const r = await checkSite('clean-site.io', 'fast');
		expect(r.sources[0].verdict).toBe('clean');
	});
});

describe('/api/dapp-check with VirusTotal as the only source that flags', () => {
	it('no engine flags → green', async () => {
		const r = await checkSite('clean-site.io');
		expect(r.verdict).toBe('green');
		expect(vtSource(r).verdict).toBe('clean');
	});

	it('1 malicious engine → caution (yellow), not danger, with the count shown', async () => {
		const r = await checkSite('one-flag.io');
		expect(r.verdict).toBe('yellow');
		expect(vtSource(r).verdict).toBe('caution');
		expect(vtSource(r).detail).toBe('1 of 93 security engines flagged this URL. One or two flags are often a false alarm.');
	});

	it('1 malicious + 1 suspicious → caution (yellow)', async () => {
		const r = await checkSite('two-flags.io');
		expect(r.verdict).toBe('yellow');
		expect(vtSource(r).verdict).toBe('caution');
		expect(vtSource(r).detail).toContain('2 of 93');
	});

	it('"suspicious" ratings alone stay a caution, however many', async () => {
		const r = await checkSite('suspicious-only.io');
		expect(r.verdict).toBe('yellow');
		expect(vtSource(r).verdict).toBe('caution');
	});

	it('3 malicious engines → red', async () => {
		const r = await checkSite('three-malicious.io');
		expect(r.verdict).toBe('red');
		expect(vtSource(r).verdict).toBe('flagged');
		expect(vtSource(r).detail).toBe('3/93 security engines flagged this URL as malicious');
	});

	it('many malicious engines → red', async () => {
		const r = await checkSite('many-malicious.io');
		expect(r.verdict).toBe('red');
	});

	it('a site VirusTotal has never seen is looked up only: no scan request, not penalized', async () => {
		fetchMock.mockClear();
		const r = await checkSite('brand-new.io');
		expect(vtSource(r).verdict).toBe('unscanned');
		expect(vtSource(r).detail).toBe('VirusTotal has no record of this link yet');
		expect(r.vtPending).toBe(false);
		expect(r.verdict).toBe('green');
		const posts = fetchMock.mock.calls.filter(([u, init]) =>
			String(u).startsWith('https://www.virustotal.com') && (init as RequestInit | undefined)?.method === 'POST');
		expect(posts).toEqual([]);
	});
});
