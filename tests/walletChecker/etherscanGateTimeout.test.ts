import { describe, it, expect, vi } from 'vitest';

/**
 * A full rate gate means our own queue is busy, not that Etherscan failed. etherscan.ts used
 * to retry it 3 times, so one call could block about 90 s (3 x the 30 s wait) and fail
 * without reaching Etherscan, close to Cloudflare's 100 s origin timeout on the Verify
 * self-send proof route. It now gives up on the first gate timeout.
 *
 * The gate is stubbed to time out at once; no network, no database, no secrets.
 */

const gate = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../../src/lib/explorerGates', async () => {
	const { RateGateTimeout } = await vi.importActual<typeof import('../../src/lib/rateGate')>('../../src/lib/rateGate');
	return {
		BACKGROUND_MAX_WAIT_MS: 30_000,
		GATE_PRIORITY: { safety: 0, background: 1, activityFirst: 10, activityLater: 20 },
		gateForUrl: () => ({
			schedule: async () => {
				gate.calls += 1;
				throw new RateGateTimeout();
			},
		}),
	};
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('etherscan.ts with a full rate gate', () => {
	it('fails on the first gate timeout instead of retrying it', async () => {
		vi.stubEnv('ETHERSCAN_API_KEY', 'test-key');
		const { buildEtherscanV2Url, requestEtherscan, _debugClearCaches } = await import('../../src/lib/etherscan');
		const { RateGateTimeout } = await import('../../src/lib/rateGate');
		_debugClearCaches();

		const url = buildEtherscanV2Url(1, { module: 'account', action: 'txlist', address: '0x0000000000000000000000000000000000000001' });
		await expect(requestEtherscan(url, { minIntervalMs: 0 })).rejects.toBeInstanceOf(RateGateTimeout);
		expect(gate.calls).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
