/**
 * Running an approvals check, and its 30-minute cache. Shared by GET /api/wallets/[id]/approvals and the
 * monthly check-up (src/pages/api/cron/monthly-digest.ts).
 *
 * A check can take longer than one web request may (Render cuts a request off at about 30 seconds,
 * see CLAUDE.md "Needs Attention"), so it runs as a background job per wallet. A request waits at
 * most REQUEST_BUDGET_MS and answers with the list so far: chains still being read are `pending` and
 * the report says `complete: false`. The page then polls (`?poll=1`) until it is complete.
 *
 * Only a complete report is cached: in a bounded in-memory Map and in the existing `cache` table
 * (src/lib/tursoCache.ts), so a restart, or a poll that lands on another instance, still finds it. No
 * new table: the approvals are public and change, so a stored copy would go stale; this is a cache.
 * Keys sit under the t:{tenantId}: prefix that clearing an account's cache removes.
 */

import { getCache, setCache } from '@/lib/tursoCache';
import { buildReport, checkWalletApprovals, type ChainOutcome } from './index';
import type { ApprovalsReport } from './types';
import { APPROVAL_CHAINS } from '@/lib/chains';

export const APPROVALS_CACHE_TTL_SECONDS = 30 * 60;
/** The longest one request waits for a check before answering with the list so far (under Render's ~30 s cutoff). */
export const REQUEST_BUDGET_MS = 20_000;
/** A finished job stays readable by polls this long (the cache table holds it for the full 30 minutes). */
const FINISHED_JOB_TTL_MS = 5 * 60_000;
const MEM_MAX = 500;

type Job = {
	walletId: string;
	address: string;
	outcomes: Array<ChainOutcome | undefined>;
	done: Promise<ApprovalsReport>;
	report: ApprovalsReport | null;
	finishedAt: number | null;
};

const mem = new Map<string, { expiresAt: number; report: ApprovalsReport }>();
const jobs = new Map<string, Job>();
let requestBudgetMs = REQUEST_BUDGET_MS;
let checker: typeof checkWalletApprovals = checkWalletApprovals;

export function approvalsCacheKey(tenantId: string, walletId: string): string {
	return `t:${tenantId}:approvals:${walletId}:v2`;
}

function remember(key: string, report: ApprovalsReport, expiresAt: number) {
	mem.delete(key);
	mem.set(key, { expiresAt, report });
	if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
}

/** The cached complete report, or null when there is none younger than 30 minutes. A cache read that fails is a miss. */
export async function readCachedApprovals(tenantId: string, walletId: string): Promise<ApprovalsReport | null> {
	const key = approvalsCacheKey(tenantId, walletId);
	const hit = mem.get(key);
	if (hit && hit.expiresAt > Date.now()) return hit.report;
	if (hit) mem.delete(key);
	try {
		const stored = await getCache<ApprovalsReport>(key);
		if (stored && stored.ok === true && stored.walletId === walletId && stored.complete === true) {
			remember(key, stored, Date.parse(stored.checkedAt) + APPROVALS_CACHE_TTL_SECONDS * 1000);
			return stored;
		}
	} catch (err) {
		console.warn('[approvals] cache read failed', err instanceof Error ? err.message.slice(0, 120) : 'unknown');
	}
	return null;
}

function liveJob(key: string): Job | null {
	const job = jobs.get(key);
	if (!job) return null;
	if (job.finishedAt !== null && Date.now() - job.finishedAt > FINISHED_JOB_TTL_MS) {
		jobs.delete(key);
		return null;
	}
	return job;
}

/** The job's report so far: its finished report, or the chains read up to now. */
function snapshot(job: Job): ApprovalsReport {
	return job.report ?? buildReport(job.walletId, job.address, job.outcomes, Date.now());
}

/** True when a check for this wallet is running in this process. */
export function isCheckRunning(tenantId: string, walletId: string): boolean {
	const job = liveJob(approvalsCacheKey(tenantId, walletId));
	return Boolean(job && job.report === null);
}

/** Starts a check for the wallet, or joins the one already running. */
function startJob(tenantId: string, walletId: string, address: string): Job {
	const key = approvalsCacheKey(tenantId, walletId);
	const running = liveJob(key);
	if (running && running.report === null) return running;
	const job: Job = {
		walletId,
		address,
		outcomes: new Array(APPROVAL_CHAINS.length).fill(undefined),
		done: Promise.resolve(null as unknown as ApprovalsReport),
		report: null,
		finishedAt: null,
	};
	job.done = (async () => {
		try {
			const report = await checker(walletId, address, {
				onChain: (i, outcome) => {
					job.outcomes[i] = outcome;
				},
			});
			job.report = report;
			remember(key, report, Date.now() + APPROVALS_CACHE_TTL_SECONDS * 1000);
			await setCache(key, report, APPROVALS_CACHE_TTL_SECONDS).catch((err) =>
				console.warn('[approvals] cache write failed', err instanceof Error ? err.message.slice(0, 120) : 'unknown'),
			);
			return report;
		} catch (err) {
			// checkWalletApprovals doesn't throw for a chain; anything here is unexpected. Every chain not yet
			// read is reported as couldn't be read, so the page never waits forever.
			console.error('[approvals] check failed', err instanceof Error ? err.message.slice(0, 160) : 'unknown');
			const outcomes = job.outcomes.map((o) => o ?? { status: 'unavailable' as const, approvals: [] });
			job.report = buildReport(walletId, address, outcomes, Date.now());
			return job.report;
		} finally {
			job.finishedAt = Date.now();
		}
	})();
	jobs.set(key, job);
	if (jobs.size > MEM_MAX) jobs.delete(jobs.keys().next().value as string);
	return job;
}

/**
 * Starts (or joins) a check and answers within the request budget: the finished report, or the list so
 * far with `complete: false`.
 */
export async function startApprovalsCheck(tenantId: string, walletId: string, address: string): Promise<ApprovalsReport> {
	const job = startJob(tenantId, walletId, address);
	return waitForJob(job);
}

async function waitForJob(job: Job): Promise<ApprovalsReport> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const budget = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), requestBudgetMs);
	});
	const finished = await Promise.race([job.done, budget]);
	clearTimeout(timer);
	return finished ?? snapshot(job);
}

/**
 * What a poll sees: the running or just-finished job's report in this process, else the cached complete
 * report, else null (no check known here: the page offers to check again).
 */
export async function pollApprovals(tenantId: string, walletId: string): Promise<ApprovalsReport | null> {
	const job = liveJob(approvalsCacheKey(tenantId, walletId));
	if (job) return snapshot(job);
	return readCachedApprovals(tenantId, walletId);
}

/** For the monthly check-up: waits for the whole report (each chain is still held to its own deadline). */
export async function runApprovalsCheck(tenantId: string, walletId: string, address: string): Promise<ApprovalsReport> {
	return startJob(tenantId, walletId, address).done;
}

/** For tests. */
export function _clearApprovalsCache() {
	mem.clear();
	jobs.clear();
}
export function _setRequestBudgetMs(ms: number) {
	requestBudgetMs = ms;
}
export function _setChecker(fn: typeof checkWalletApprovals | null) {
	checker = fn ?? checkWalletApprovals;
}
