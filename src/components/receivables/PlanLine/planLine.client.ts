/**
 * PlanLine (tier T3): fills the desk's plan line from GET /api/verify/receivables/plan, the same
 * numbers the claim write counts, computed on load and stored nowhere. "1 of 1 contracts on the
 * Free plan"; the owner's account reads "No contract limit on this account". While the free plan
 * is locked (two claims lapsed within a year, T2) a second sentence names the two dates, in the
 * caution tone, and says the one way to clear it.
 *
 * Re-reads itself whenever the inline script announces a record (hostBridge.onRecordLoaded): a
 * claim recorded or released reloads the record, and the count changes with it. Reads are
 * coalesced through one timer, so the first load and the bridge's replay of the last record cost
 * one request, and a burst of reloads costs one.
 *
 * Text is set with textContent only. Any failure leaves the line as it was, hidden on first load:
 * the desk works without it.
 */
import { onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { FREE_PLAN_LOCKED, PLAN_LINE, PLAN_LINE_UNLIMITED } from '@/lib/receivables/copy/plan';

const PLAN_URL = '/api/verify/receivables/plan';

/** The plan route's answer, as the line reads it: every field checked, nothing trusted. */
export interface PlanAnswer {
	label: string;
	/** null: no limit (the deployment owner's account). */
	limit: number | null;
	used: number;
	lockedAt: string | null;
	lapsedAts: string[];
}

export function readPlanAnswer(j: unknown): PlanAnswer | null {
	if (!j || typeof j !== 'object') return null;
	const o = j as Record<string, unknown>;
	if (o.ok !== true || typeof o.label !== 'string' || !o.label) return null;
	const limits = o.limits as Record<string, unknown> | undefined;
	const use = o.use as Record<string, unknown> | undefined;
	const rawLimit = limits?.contracts;
	if (rawLimit !== null && !(typeof rawLimit === 'number' && Number.isFinite(rawLimit))) return null;
	if (typeof use?.total !== 'number' || !Number.isFinite(use.total)) return null;
	const lockedAt = typeof o.freeLockedAt === 'string' && o.freeLockedAt ? o.freeLockedAt : null;
	const reason = o.freeLockedReason as Record<string, unknown> | null | undefined;
	const lapsedAts = Array.isArray(reason?.lapsedAts) ? reason!.lapsedAts.filter((s): s is string => typeof s === 'string') : [];
	return { label: o.label, limit: rawLimit as number | null, used: use.total, lockedAt, lapsedAts };
}

export function planLineText(a: PlanAnswer): string {
	if (a.limit === null) return PLAN_LINE_UNLIMITED;
	return fillCopy(PLAN_LINE, { used: String(a.used), limit: String(a.limit), plan: a.label });
}

/** The lock sentence, or null when the plan is not locked. The dates are the two lapses' days. */
export function planLockText(a: PlanAnswer): string | null {
	if (!a.lockedAt) return null;
	const dates = a.lapsedAts.map((s) => s.slice(0, 10)).filter(Boolean);
	return FREE_PLAN_LOCKED.replace('{dates}', dates.length ? ` (${dates.join(', ')})` : '');
}

export function mountPlanLine(root: HTMLElement): void {
	const text = root.querySelector<HTMLElement>('[data-plan-text]');
	const lock = root.querySelector<HTMLElement>('[data-plan-lock]');
	if (!text || !lock) return;

	const load = async (): Promise<void> => {
		try {
			const r = await fetch(PLAN_URL);
			if (!r.ok) return;
			const a = readPlanAnswer(await r.json());
			if (!a) return;
			text.textContent = planLineText(a);
			const lockText = planLockText(a);
			lock.textContent = lockText ?? '';
			lock.hidden = lockText === null;
			root.hidden = false;
		} catch { /* stays as it was */ }
	};

	let queued = false;
	const schedule = (): void => {
		if (queued) return;
		queued = true;
		setTimeout(() => { queued = false; void load(); }, 0);
	};

	schedule();
	onRecordLoaded(() => schedule());
}
