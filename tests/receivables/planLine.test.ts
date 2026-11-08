import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PLAN_LINE_UNLIMITED } from '../../src/lib/receivables/copy/plan';

/**
 * src/components/receivables/PlanLine/planLine.client.ts (tier T3): the desk's plan line. The pure
 * parts are pinned directly; the mount runs against a two-element fake root and a stubbed fetch,
 * with no DOM. The host bridge is the real module, reset for every test so each mount is the only
 * listener (on the desk there is one), and the replay of a record already on screen is part of
 * what is pinned: it must cost no extra request.
 */

type PlanLineModule = typeof import('../../src/components/receivables/PlanLine/planLine.client');
type Bridge = typeof import('../../src/lib/receivables/client/hostBridge');
let mod: PlanLineModule;
let bridge: Bridge;

interface FakeEl { textContent: string; hidden: boolean }
function fakeRoot(withChildren = true) {
	const text: FakeEl = { textContent: '', hidden: false };
	const lock: FakeEl = { textContent: '', hidden: true };
	const root = {
		hidden: true,
		querySelector(sel: string) {
			if (!withChildren) return null;
			return sel === '[data-plan-text]' ? text : sel === '[data-plan-lock]' ? lock : null;
		},
	};
	return { root: root as unknown as HTMLElement, text, lock, rootEl: root };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 2));
const settle = async () => { await tick(); await tick(); await tick(); };

const FREE_ONE = { ok: true, plan: 'free', label: 'Free', limits: { contracts: 1 }, freeLockedAt: null, freeLockedReason: null, use: { claims: 1, projects: 0, total: 1 } };
const NONE = { label: 'Free', limit: 1, used: 0, lockedAt: null, lapsedAts: [] as string[] };

let fetchMock: ReturnType<typeof vi.fn>;
function answer(status: number, body: unknown) {
	fetchMock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
	vi.stubGlobal('fetch', fetchMock);
}

beforeEach(async () => {
	vi.resetModules();
	mod = await import('../../src/components/receivables/PlanLine/planLine.client');
	bridge = await import('../../src/lib/receivables/client/hostBridge');
	answer(200, FREE_ONE);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('readPlanAnswer', () => {
	it('reads the route answer and nothing else', () => {
		expect(mod.readPlanAnswer(FREE_ONE)).toEqual({ label: 'Free', limit: 1, used: 1, lockedAt: null, lapsedAts: [] });
		expect(mod.readPlanAnswer({ ...FREE_ONE, plan: 'unlimited', label: 'Unlimited', limits: { contracts: null }, use: { claims: 50, projects: 2, total: 52 } }))
			.toEqual({ label: 'Unlimited', limit: null, used: 52, lockedAt: null, lapsedAts: [] });
		expect(mod.readPlanAnswer({
			...FREE_ONE, freeLockedAt: '2026-10-20 09:00:00',
			freeLockedReason: { claimIds: ['a', 'b'], lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00', 7] },
		})).toMatchObject({ lockedAt: '2026-10-20 09:00:00', lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] });
	});

	it('refuses what it cannot read', () => {
		expect(mod.readPlanAnswer(null)).toBeNull();
		expect(mod.readPlanAnswer({ ok: false, error: 'unauthenticated' })).toBeNull();
		expect(mod.readPlanAnswer({ ...FREE_ONE, label: '' })).toBeNull();
		expect(mod.readPlanAnswer({ ...FREE_ONE, limits: { contracts: 'ten' } })).toBeNull();
		expect(mod.readPlanAnswer({ ...FREE_ONE, use: {} })).toBeNull();
	});
});

describe('planLineText and planLockText', () => {
	it('words the plan line from the copy', () => {
		expect(mod.planLineText({ ...NONE, used: 1 })).toBe('1 of 1 contracts on the Free plan');
		expect(mod.planLineText({ ...NONE, label: 'Standard', limit: 10, used: 7 })).toBe('7 of 10 contracts on the Standard plan');
		expect(mod.planLineText({ ...NONE, label: 'Unlimited', limit: null, used: 52 })).toBe(PLAN_LINE_UNLIMITED);
	});

	it('the lock sentence names the two days, or none, and is null when not locked', () => {
		expect(mod.planLockText(NONE)).toBeNull();
		expect(mod.planLockText({ ...NONE, lockedAt: '2026-10-20 09:00:00', lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] }))
			.toBe('Two claims on this account passed their promised dates and were not maintained for six months (2026-04-01, 2026-10-20). The free plan records no new contracts until the account moves to Standard.');
		expect(mod.planLockText({ ...NONE, lockedAt: '2026-10-20 09:00:00' }))
			.toBe('Two claims on this account passed their promised dates and were not maintained for six months. The free plan records no new contracts until the account moves to Standard.');
	});
});

describe('mountPlanLine', () => {
	it('fetches once, fills the text, shows the line, keeps the lock hidden', async () => {
		const { root, text, lock, rootEl } = fakeRoot();
		mod.mountPlanLine(root);
		expect(rootEl.hidden).toBe(true);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/verify/receivables/plan');
		expect(text.textContent).toBe('1 of 1 contracts on the Free plan');
		expect(lock.hidden).toBe(true);
		expect(lock.textContent).toBe('');
		expect(rootEl.hidden).toBe(false);
	});

	it('a locked free plan shows the second sentence', async () => {
		answer(200, { ...FREE_ONE, use: { claims: 0, projects: 0, total: 0 }, freeLockedAt: '2026-10-20 09:00:00', freeLockedReason: { claimIds: ['a', 'b'], lapsedAts: ['2026-04-01 09:00:00', '2026-10-20 09:00:00'] } });
		const { root, text, lock } = fakeRoot();
		mod.mountPlanLine(root);
		await settle();
		expect(text.textContent).toBe('0 of 1 contracts on the Free plan');
		expect(lock.hidden).toBe(false);
		expect(lock.textContent).toContain('(2026-04-01, 2026-10-20)');
	});

	it('stays hidden on 401, on a body it cannot read, and when fetch throws', async () => {
		for (const setup of [
			() => answer(401, { ok: false, error: 'unauthenticated' }),
			() => answer(200, { ok: true, nonsense: true }),
			() => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); })),
		]) {
			setup();
			const { root, rootEl, text } = fakeRoot();
			mod.mountPlanLine(root);
			await settle();
			expect(rootEl.hidden).toBe(true);
			expect(text.textContent).toBe('');
		}
	});

	it('does nothing without its two children', async () => {
		const { root } = fakeRoot(false);
		mod.mountPlanLine(root);
		await settle();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('the first load and the bridge replay of a record on screen cost one request; a burst of later reloads costs one more', async () => {
		bridge.emitRecordLoaded({ id: 'before-mount' } as any);
		const { root, text } = fakeRoot();
		mod.mountPlanLine(root);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		answer(200, { ...FREE_ONE, use: { claims: 0, projects: 0, total: 0 } });
		bridge.emitRecordLoaded({ id: 'after-release' } as any);
		bridge.emitRecordLoaded(null);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(text.textContent).toBe('0 of 1 contracts on the Free plan');
	});
});
