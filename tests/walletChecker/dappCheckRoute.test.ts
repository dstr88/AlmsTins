import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * /api/dapp-check end to end, with every outside source stubbed (code review 2026-10-11):
 *   - any flag wins over MetaMask's verified-safe list;
 *   - an unreachable live source (GoPlus, URLScan.io) keeps the site off green ("limited");
 *   - an upstream failure is reported in plain words, never with the raw error text;
 *   - the route is rate limited per client IP, like /api/wallet-check.
 *
 * No database, no network: the db, the check log, our airdrop-name list and fetch are stubbed.
 */

vi.mock('@/lib/db', () => {
	const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
	return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/checkLog', () => ({ recordCheck: () => {} }));
const airdropNamed = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/phishingDomains', () => ({ checkLocalPhishingDb: async (d: string) => airdropNamed.has(d) }));

// Raw text an upstream failure carries. It must never reach the response.
const RAW_GOPLUS = 'connect ECONNREFUSED 10.0.0.7:443 (internal-goplus-edge)';

const METAMASK = {
	blacklist: ['mm-allow-and-block.io', 'mm-blocked.io'],
	whitelist: ['allowlisted.io', 'mm-allow-and-block.io', 'allowlisted-ss-flagged.io', 'allowlisted-goplus-flagged.io', 'allowlisted-goplus-down.io', 'allowlisted-airdrop.io'],
};
const SCAMSNIFFER = ['allowlisted-ss-flagged.io', 'ss-flagged.io'];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
	const url = String(input);
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
	if (url.includes('eth-phishing-detect')) return json(METAMASK);
	if (url.includes('scamsniffer')) return json(SCAMSNIFFER);
	if (url.includes('openphish')) return new Response('https://phish.example/login\n', { status: 200 });
	if (url.includes('gopluslabs.io')) {
		const target = decodeURIComponent(new URL(url).searchParams.get('url') ?? '');
		if (target.includes('goplus-down')) throw new Error(RAW_GOPLUS);
		if (target.includes('goplus-flagged')) return json({ result: { phishing_site: 1 } });
		return json({ result: { phishing_site: 0, website_contract_security: [] } });
	}
	if (url.includes('urlscan.io/api/v1/search')) {
		if (url.includes('urlscan-down')) return new Response('upstream exploded: stack at /srv/urlscan/x.js:12', { status: 503 });
		return json({ results: [{ task: { time: '2026-10-01T00:00:00Z' }, verdicts: { overall: { malicious: false, score: 0 } } }] });
	}
	throw new Error(`unexpected fetch in a hermetic test: ${url}`);
});
vi.stubGlobal('fetch', fetchMock);

type Source = { name: string; verdict: string; detail: string };
type DappResult = { verdict: 'red' | 'yellow' | 'green'; limited: boolean; sources: Source[]; error?: boolean; rateLimited?: boolean; message?: string };

let GET: (ctx: { url: URL; request: Request }) => Promise<Response>;
let ipSeq = 0;
const freshIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

async function call(target: string, opts: { phase?: string; ip?: string } = {}): Promise<{ status: number; body: string; data: DappResult }> {
	const url = new URL(`http://localhost/api/dapp-check?url=${encodeURIComponent(target)}&phase=${opts.phase ?? 'all'}`);
	const request = new Request(url, { headers: { 'cf-connecting-ip': opts.ip ?? freshIp() } });
	const res = await GET({ url, request });
	const body = await res.text();
	return { status: res.status, body, data: JSON.parse(body) as DappResult };
}
const check = async (target: string, phase = 'all') => (await call(target, { phase })).data;
const source = (r: DappResult, name: string) => r.sources.find((s) => s.name === name)!;

beforeAll(async () => {
	vi.stubEnv('VIRUSTOTAL_API_KEY', '');
	vi.stubEnv('GOOGLE_SAFE_BROWSING_KEY', '');
	({ GET } = (await import('../../src/pages/api/dapp-check')) as unknown as { GET: typeof GET });
	// The lists load in the background at import; wait until they have arrived.
	await vi.waitFor(async () => {
		const r = await check('allowlisted.io', 'fast');
		expect(r.sources[0].verdict).toBe('whitelisted');
	});
});

describe('any flag wins over the MetaMask allowlist', () => {
	it('allowlisted and clean everywhere else → green', async () => {
		const r = await check('allowlisted.io');
		expect(r.verdict).toBe('green');
		expect(r.limited).toBe(false);
	});

	it('allowlisted but on ScamSniffer → red', async () => {
		const r = await check('allowlisted-ss-flagged.io');
		expect(source(r, 'MetaMask Blocklist').verdict).toBe('whitelisted');
		expect(source(r, 'ScamSniffer').verdict).toBe('flagged');
		expect(r.verdict).toBe('red');
	});

	it('allowlisted but GoPlus reports phishing → red', async () => {
		const r = await check('allowlisted-goplus-flagged.io');
		expect(r.verdict).toBe('red');
	});

	it('on both MetaMask lists: the allowlist softens MetaMask\'s own hit', async () => {
		const r = await check('mm-allow-and-block.io');
		expect(source(r, 'MetaMask Blocklist').verdict).toBe('whitelisted');
		expect(r.verdict).toBe('green');
	});

	it('on the MetaMask blocklist only → red', async () => {
		expect((await check('mm-blocked.io')).verdict).toBe('red');
	});

	it('our airdrop-name list stays a caution, and is dropped for an allowlisted site', async () => {
		airdropNamed.add('airdrop-named.io');
		airdropNamed.add('allowlisted-airdrop.io');
		const plain = await check('airdrop-named.io');
		expect(plain.verdict).toBe('yellow');
		expect(plain.limited).toBe(false);
		expect(plain.sources.some((s) => s.name === 'Spam airdrop names (Almstins)')).toBe(true);
		const allowed = await check('allowlisted-airdrop.io');
		expect(allowed.verdict).toBe('green');
		expect(allowed.sources.some((s) => s.name === 'Spam airdrop names (Almstins)')).toBe(false);
	});
});

describe('an unreachable live source keeps the site off green', () => {
	it('GoPlus down → yellow, limited, plain wording, no raw error text', async () => {
		const { data, body } = await call('goplus-down.io');
		expect(data.verdict).toBe('yellow');
		expect(data.limited).toBe(true);
		expect(source(data, 'GoPlus Security')).toMatchObject({ verdict: 'error', detail: 'GoPlus Security could not be reached' });
		expect(body).not.toContain('ECONNREFUSED');
		expect(body).not.toContain('10.0.0.7');
		expect(body).not.toContain('internal-goplus-edge');
	});

	it('URLScan.io down → yellow, limited, no upstream status or body', async () => {
		const { data, body } = await call('urlscan-down.io');
		expect(data.verdict).toBe('yellow');
		expect(data.limited).toBe(true);
		expect(source(data, 'URLScan.io')).toMatchObject({ verdict: 'error', detail: 'URLScan.io could not be reached' });
		expect(body).not.toContain('HTTP 503');
		expect(body).not.toContain('/srv/urlscan');
	});

	it('every live source down → yellow, limited (it used to read green)', async () => {
		const r = await check('goplus-down.urlscan-down.io');
		expect(source(r, 'GoPlus Security').verdict).toBe('error');
		expect(source(r, 'URLScan.io').verdict).toBe('error');
		expect(r.verdict).toBe('yellow');
		expect(r.limited).toBe(true);
	});

	it('the allowlist does not turn an unreachable source green', async () => {
		const r = await check('allowlisted-goplus-down.io');
		expect(r.verdict).toBe('yellow');
		expect(r.limited).toBe(true);
	});

	it('a flag still wins while a source is down', async () => {
		// ScamSniffer lists the domain; GoPlus gets the full link, and the path makes it fail.
		const flagged = await check('https://ss-flagged.io/goplus-down');
		expect(source(flagged, 'GoPlus Security').verdict).toBe('error');
		expect(flagged.verdict).toBe('red');
	});
});

describe('fast phase (downloaded lists only)', () => {
	it('is never green: the live sources have not been asked', async () => {
		const r = await check('allowlisted.io', 'fast');
		expect(r.verdict).toBe('yellow');
		expect(r.limited).toBe(true);
	});

	it('a list flag is still red', async () => {
		expect((await check('allowlisted-ss-flagged.io', 'fast')).verdict).toBe('red');
	});
});

describe('rate limit (10 a minute per client IP)', () => {
	it('the 11th check from one IP gets 429 with a plain message and calls no outside source', async () => {
		const ip = '203.0.113.9';
		for (let i = 0; i < 10; i++) expect((await call('allowlisted.io', { ip })).status).toBe(200);
		fetchMock.mockClear();
		const limited = await call('allowlisted.io', { ip });
		expect(limited.status).toBe(429);
		expect(limited.data).toMatchObject({ error: true, rateLimited: true });
		expect(limited.data.message).toBe('Too many checks. Please wait a minute and try again.');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('another client IP is not affected', async () => {
		expect((await call('allowlisted.io', { ip: '203.0.113.10' })).status).toBe(200);
	});

	it('an IPv6 client is limited by its /64, so rotating addresses inside it does not reset the budget', async () => {
		for (let i = 1; i <= 10; i++) expect((await call('allowlisted.io', { ip: `2001:db8:1:2::${i.toString(16)}` })).status).toBe(200);
		expect((await call('allowlisted.io', { ip: '2001:db8:1:2::ff' })).status).toBe(429);
	});
});

describe('input', () => {
	it('a missing url is a 400', async () => {
		const url = new URL('http://localhost/api/dapp-check');
		const res = await GET({ url, request: new Request(url, { headers: { 'cf-connecting-ip': freshIp() } }) });
		expect(res.status).toBe(400);
	});

	it('a url over 2048 characters is a 400 and calls no outside source', async () => {
		fetchMock.mockClear();
		const { status } = await call(`https://example.io/${'a'.repeat(2100)}`);
		expect(status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
