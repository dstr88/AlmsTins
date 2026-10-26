/**
 * Where CoinGecko requests go and which key header they carry. CoinGecko has two keyed plans with
 * different hosts and headers, and a key sent to the wrong host is refused:
 *
 *   - no COINGECKO_API_KEY: api.coingecko.com, no key header (the public API);
 *   - COINGECKO_API_PLAN=pro: pro-api.coingecko.com with x-cg-pro-api-key (paid; full history);
 *   - COINGECKO_API_PLAN=demo, or unset: api.coingecko.com with x-cg-demo-api-key (the free key).
 *
 * The plan is set explicitly because both kinds of key look alike (CoinGecko documents no prefix
 * that tells them apart). An unset plan means demo: the free key is the common one, and a Pro key
 * sent as demo only loses the older history, while a demo key sent as Pro gets nothing.
 * Only the public and demo plans are limited to the past 365 days of history.
 */

export type CoingeckoPlan = 'public' | 'demo' | 'pro';

export type CoingeckoConfig = {
	plan: CoingeckoPlan;
	baseUrl: string;
	/** The key header, empty for the public API. */
	headers: Record<string, string>;
	/** Whether historical prices reach back further than 365 days. */
	fullHistory: boolean;
};

type Env = Record<string, string | boolean | undefined>;

export function coingeckoConfig(env: Env = process.env): CoingeckoConfig {
	const key = String(env.COINGECKO_API_KEY ?? '').trim();
	if (!key) return { plan: 'public', baseUrl: 'https://api.coingecko.com/api/v3', headers: {}, fullHistory: false };
	if (String(env.COINGECKO_API_PLAN ?? '').trim().toLowerCase() === 'pro') {
		return { plan: 'pro', baseUrl: 'https://pro-api.coingecko.com/api/v3', headers: { 'x-cg-pro-api-key': key }, fullHistory: true };
	}
	return { plan: 'demo', baseUrl: 'https://api.coingecko.com/api/v3', headers: { 'x-cg-demo-api-key': key }, fullHistory: false };
}
