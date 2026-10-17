import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * POST /api/lifecycle/rebuild is what the Sync buttons call, and Year Summary and Annual Records send it a year.
 * The rebuild is always whole (see rebuildScope.test.ts), so the route must not narrow it: a year in the body is
 * ignored, and the rebuild is asked for with no year at all.
 *
 * Hermetic: the session, the rebuild and the cache are stubs.
 */
const state = vi.hoisted(() => ({
	session: { tenantId: 'tenant-a' } as null | { tenantId: string },
	rebuild: vi.fn(async () => {}),
	cacheWrites: [] as string[],
	cachePrefixesCleared: [] as string[],
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/lifecycle', () => ({ rebuildAssetLifecycles: state.rebuild }));
vi.mock('@/lib/tursoCache', () => ({
	setCache: async (key: string) => {
		state.cacheWrites.push(key);
	},
	deleteCachePrefix: async (prefix: string) => {
		state.cachePrefixesCleared.push(prefix);
	},
}));

import { POST } from '../../src/pages/api/lifecycle/rebuild';

const post = (body?: unknown) =>
	(POST as any)({
		request: new Request('https://almstins.test/api/lifecycle/rebuild', {
			method: 'POST',
			...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
		}),
	});

beforeEach(() => {
	state.session = { tenantId: 'tenant-a' };
	state.rebuild.mockClear();
	state.cacheWrites = [];
	state.cachePrefixesCleared = [];
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('POST /api/lifecycle/rebuild', () => {
	it('ignores a year in the body: the rebuild is asked for with no year', async () => {
		const res = await post({ year: 2025 });
		expect(res.status).toBe(200);
		expect(state.rebuild).toHaveBeenCalledTimes(1);
		const [tenantId, opts] = state.rebuild.mock.calls[0] as unknown as [string, { year?: number } | undefined];
		expect(tenantId).toBe('tenant-a');
		expect(opts?.year).toBeUndefined();
	});

	it('rebuilds the same way with no body at all', async () => {
		const res = await post();
		expect(res.status).toBe(200);
		expect(state.rebuild).toHaveBeenCalledTimes(1);
		const [tenantId, opts] = state.rebuild.mock.calls[0] as unknown as [string, { year?: number } | undefined];
		expect(tenantId).toBe('tenant-a');
		expect(opts?.year).toBeUndefined();
	});

	it('still refreshes the lifecycle cache and clears the stale portfolio cache after a rebuild', async () => {
		await post({ year: 2025 });
		expect(state.cacheWrites).toEqual(['lifecycle:tenant-a']);
		expect(state.cachePrefixesCleared).toEqual(['t:tenant-a:portfolio:performance:']);
	});

	it('refuses an anonymous request before it rebuilds anything', async () => {
		state.session = null;
		const res = await post({ year: 2025 });
		expect(res.status).toBe(401);
		expect(state.rebuild).not.toHaveBeenCalled();
	});
});
