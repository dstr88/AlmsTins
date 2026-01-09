import { expect, test } from 'vitest';

const DEFAULT_POOL_ID = 'mainnet_v2';
const DEFAULT_RESERVE_ID = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC mainnet
const API_URL = 'https://aave-api-v2.aave.com/data/rates-history';

const REQUEST_TIMEOUT_MS = 20000;

test(
	'Aave rates API responds with historical samples',
	async () => {
		const params = new URLSearchParams({
			poolId: DEFAULT_POOL_ID,
			reserveId: DEFAULT_RESERVE_ID,
		});
		const response = await fetch(`${API_URL}?${params.toString()}`);
		expect(response.ok).toBe(true);

		const payload = await response.json();
		expect(Array.isArray(payload)).toBe(true);
		if (payload.length > 0) {
			const firstSample = payload[0];
			expect(firstSample).toBeTypeOf('object');
			expect(firstSample).toHaveProperty('timestamp');
			expect(
				firstSample.liquidityRate !== undefined ||
					firstSample.liquidityAPR !== undefined ||
					firstSample.liquidityRateRay !== undefined,
			).toBe(true);
		}
	},
	REQUEST_TIMEOUT_MS,
);
