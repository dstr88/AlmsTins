/**
 * GET /api/yearEnd/completeness?year=YYYY
 *
 * Computes a 0-100 "Data Completeness Score" for the authenticated tenant's
 * tax data for the given year.  Each pillar has a max score; partial credit
 * is awarded proportionally.  The response is designed to drive both a
 * circular gauge and an expandable checklist.
 *
 * Five pillars (20 pts each = 100 total):
 *
 *  1. Review Queue — unresolved items in tax_review_items
 *  2. Wallet Sync  — onchain wallets synced within 60 days
 *  3. Price Coverage — import_transactions with native_usd present
 *  4. Transaction Data — any activity imported for the year
 *  5. Cost Basis — no orphaned sells / missing-basis flagged items
 *
 * Cached 10 minutes (tax data completeness doesn't change rapidly).
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getCache, setCache } from '@/lib/tursoCache';

export const prerender = false;

const CACHE_TTL = 10 * 60;
const STALE_DAYS = 60;      // wallets stale after this many days
const MAX_SCORE  = 120;     // 6 pillars × 20 pts each
const PILLAR_MAX = 20;      // each pillar worth 20 pts

export type PillarStatus = 'ok' | 'warning' | 'error' | 'na';

export interface Pillar {
	key:        string;
	label:      string;
	score:      number;       // 0–20
	maxScore:   number;       // always 20
	status:     PillarStatus;
	issueCount: number;
	detail:     string;       // one-line human summary
	issues:     string[];     // individual issue descriptions (first 5)
	link:       string;       // where to fix it
}

export interface CompletenessPayload {
	ok:         true;
	year:       number;
	score:      number;       // 0–100
	grade:      string;       // A B C D F
	label:      string;       // "Excellent", "Good", etc.
	pillars:    Pillar[];
	cached:     boolean;
}

function gradeFrom(score: number): { grade: string; label: string } {
	if (score >= 95) return { grade: 'A+', label: 'Excellent — ready to share with your CPA' };
	if (score >= 90) return { grade: 'A',  label: 'Excellent — minor items to review' };
	if (score >= 80) return { grade: 'B',  label: 'Good — a few gaps to close' };
	if (score >= 70) return { grade: 'C',  label: 'Fair — meaningful gaps may affect your return' };
	if (score >= 60) return { grade: 'D',  label: 'Incomplete — significant data missing' };
	return             { grade: 'F',  label: 'Critical gaps — do not file without fixing these' };
}

function pillarOk(label: string, detail: string, link: string): Pillar {
	return { key: '', label, score: PILLAR_MAX, maxScore: PILLAR_MAX, status: 'ok', issueCount: 0, detail, issues: [], link };
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ request }) => {
	try {
		const sess = await requireTenantSession(request);
		if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
		const { tenantId } = sess;

		const url  = new URL(request.url);
		const year = parseInt(url.searchParams.get('year') ?? String(new Date().getFullYear() - 1), 10);
		if (isNaN(year) || year < 2009 || year > 2100) return json({ ok: false, error: 'Invalid year' }, 400);

		const cacheKey = `t:${tenantId}:completeness:${year}:v3`;
		const cached   = await getCache<CompletenessPayload>(cacheKey, { allowStale: true, staleMaxAgeSeconds: 60 * 60 });
		if (cached.value) return json({ ...cached.value, cached: true });

		const yearStart = `${year}-01-01T00:00:00.000Z`;
		const yearEnd   = `${year}-12-31T23:59:59.999Z`;
		const staleISO  = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();

		// ── Run all queries in parallel ────────────────────────────────────────
		const [
			reviewResult,
			walletsResult,
			importCountResult,
			importUnpricedResult,
			missingBasisResult,
			lifecycleResult,
			pipelineRunResult,
		] = await Promise.all([

			// 1. Review queue — unresolved items for any year (they pile up)
			db.execute({
				sql: `SELECT reason, reason_detail FROM tax_review_items
				      WHERE tenant_id = ? AND resolved = 0
				      ORDER BY created_at DESC`,
				args: [tenantId],
			}),

			// 2. Wallets — all onchain wallets + their latest sync time
			db.execute({
				sql: `SELECT w.id, w.label, w.address,
				             MAX(s.last_run_at) AS last_sync
				      FROM wallets w
				      LEFT JOIN wallet_sync_state s ON s.wallet_id = w.id AND s.tenant_id = w.tenant_id
				      WHERE w.tenant_id = ?
				        AND (w.wallet_type = 'onchain' OR w.wallet_type IS NULL)
				      GROUP BY w.id`,
				args: [tenantId],
			}),

			// 3a. Import transaction count for the year
			db.execute({
				sql: `SELECT COUNT(*) AS cnt FROM import_transactions
				      WHERE tenant_id = ?
				        AND timestamp_utc >= ? AND timestamp_utc <= ?`,
				args: [tenantId, yearStart, yearEnd],
			}),

			// 3b. Unpriced import transactions for the year
			db.execute({
				sql: `SELECT COUNT(*) AS cnt FROM import_transactions
				      WHERE tenant_id = ?
				        AND timestamp_utc >= ? AND timestamp_utc <= ?
				        AND (native_usd IS NULL OR native_usd = 0)`,
				args: [tenantId, yearStart, yearEnd],
			}),

			// 5. Missing cost basis — review items flagged for basis issues
			db.execute({
				sql: `SELECT reason, snapshot_json FROM tax_review_items
				      WHERE tenant_id = ? AND resolved = 0
				        AND reason IN ('missing_price','missing_cost_basis','airdrop_unpriced','unmatched_transfer')
				      ORDER BY created_at DESC`,
				args: [tenantId],
			}),

			// 4b. Lifecycle events for the year (onchain activity)
			db.execute({
				sql: `SELECT COUNT(*) AS cnt FROM asset_lifecycle_events
				      WHERE tenant_id = ?
				        AND timestamp_utc >= ? AND timestamp_utc <= ?`,
				args: [tenantId, yearStart, yearEnd],
			}),

			// 6. Classification pipeline — most recent run status + age
			db.execute({
				sql: `SELECT status, started_at, completed_at, error_message, total_classified
				      FROM tax_pipeline_runs
				      WHERE tenant_id = ?
				      ORDER BY started_at DESC
				      LIMIT 1`,
				args: [tenantId],
			}).catch(() => ({ rows: [] })),  // table may not exist yet
		]);

		type DbRow = Record<string, unknown>;

		// ── Pillar 1: Review Queue ─────────────────────────────────────────────
		const reviewRows  = reviewResult.rows as DbRow[];
		const reviewCount = reviewRows.length;
		const reviewScore = Math.max(0, PILLAR_MAX - reviewCount * 2);

		const REASON_LABEL: Record<string, string> = {
			unmatched_transfer: 'Unmatched transfer',
			possible_loan:      'Possible loan event',
			airdrop_unpriced:   'Airdrop without price',
			missing_price:      'Missing USD price',
			low_confidence:     'Low-confidence classification',
			unknown_type:       'Unknown transaction type',
			missing_cost_basis: 'Missing cost basis',
		};
		const reviewIssues = reviewRows.slice(0, 5).map(r =>
			`${REASON_LABEL[String(r.reason)] ?? String(r.reason)}: ${String(r.reason_detail ?? '').slice(0, 60) || '—'}`
		);

		const p1: Pillar = {
			key: 'review_queue', label: 'Review Queue',
			score: reviewScore, maxScore: PILLAR_MAX,
			status: reviewCount === 0 ? 'ok' : reviewCount <= 5 ? 'warning' : 'error',
			issueCount: reviewCount,
			detail: reviewCount === 0
				? 'All transactions classified — no items pending review'
				: `${reviewCount} unresolved item${reviewCount !== 1 ? 's' : ''} need your attention`,
			issues: reviewIssues,
			link: '/dashboard/yearEnd/review',
		};

		// ── Pillar 2: Wallet Sync Freshness ───────────────────────────────────
		const walletRows  = walletsResult.rows as DbRow[];
		const totalWallets = walletRows.length;
		const staleWallets = walletRows.filter(w => {
			const lastSync = w.last_sync ? String(w.last_sync) : null;
			return !lastSync || lastSync < staleISO;
		});
		const freshCount  = totalWallets - staleWallets.length;
		const walletScore = totalWallets === 0 ? PILLAR_MAX    // no wallets → N/A, don't penalise
			: Math.round(PILLAR_MAX * (freshCount / totalWallets));

		const walletIssues = staleWallets.slice(0, 5).map(w => {
			const sync = w.last_sync ? String(w.last_sync).slice(0, 10) : 'never';
			const name = String(w.label ?? w.address ?? w.id).slice(0, 30);
			return `${name} — last synced ${sync}`;
		});

		const p2: Pillar = {
			key: 'wallet_sync', label: 'Wallet Sync',
			score: walletScore, maxScore: PILLAR_MAX,
			status: staleWallets.length === 0 ? 'ok'
				: staleWallets.length <= 2 ? 'warning' : 'error',
			issueCount: staleWallets.length,
			detail: totalWallets === 0
				? 'No onchain wallets added yet'
				: staleWallets.length === 0
					? `All ${totalWallets} wallet${totalWallets !== 1 ? 's' : ''} synced within ${STALE_DAYS} days`
					: `${staleWallets.length} of ${totalWallets} wallet${totalWallets !== 1 ? 's' : ''} stale (>${STALE_DAYS} days)`,
			issues: walletIssues,
			link: '/dashboard/wallets',
		};

		// ── Pillar 3: Price Coverage ───────────────────────────────────────────
		const importTotal    = Number((importCountResult.rows[0] as DbRow)?.cnt ?? 0);
		const importUnpriced = Number((importUnpricedResult.rows[0] as DbRow)?.cnt ?? 0);
		const priceScore = importTotal === 0
			? PILLAR_MAX  // no imports → don't penalise here (pillar 4 handles that)
			: Math.round(PILLAR_MAX * (1 - Math.min(importUnpriced / importTotal, 1)));

		const p3: Pillar = {
			key: 'price_coverage', label: 'Price Coverage',
			score: priceScore, maxScore: PILLAR_MAX,
			status: importUnpriced === 0 ? 'ok' : importUnpriced <= 10 ? 'warning' : 'error',
			issueCount: importUnpriced,
			detail: importTotal === 0
				? 'No transactions imported for this year yet'
				: importUnpriced === 0
					? `All ${importTotal.toLocaleString()} transactions have USD values`
					: `${importUnpriced.toLocaleString()} of ${importTotal.toLocaleString()} transactions missing USD price`,
			issues: importUnpriced > 0 ? [`${importUnpriced} transactions without a USD value — gain/loss cannot be calculated`] : [],
			link: '/dashboard/yearEnd/review',
		};

		// ── Pillar 4: Transaction Data ─────────────────────────────────────────
		const lifecycleCount = Number((lifecycleResult.rows[0] as DbRow)?.cnt ?? 0);
		const hasData = importTotal > 0 || lifecycleCount > 0;
		const hasEnough = importTotal + lifecycleCount >= 5;

		const dataScore = !hasData ? 0 : !hasEnough ? Math.round(PILLAR_MAX * 0.5) : PILLAR_MAX;
		const p4: Pillar = {
			key: 'transaction_data', label: 'Transaction Data',
			score: dataScore, maxScore: PILLAR_MAX,
			status: !hasData ? 'error' : !hasEnough ? 'warning' : 'ok',
			issueCount: hasData ? 0 : 1,
			detail: !hasData
				? `No transaction data found for ${year} — import your exchanges and wallet history`
				: `${(importTotal + lifecycleCount).toLocaleString()} transactions found for ${year}`,
			issues: !hasData ? [`No imports or onchain activity detected for ${year}`] : [],
			link: '/dashboard/transactions',
		};

		// ── Pillar 5: Cost Basis Integrity ────────────────────────────────────
		const basisRows  = missingBasisResult.rows as DbRow[];
		const basisCount = basisRows.length;
		// Weight: each missing basis item is worth more (these are audit risks)
		const basisScore = Math.max(0, PILLAR_MAX - basisCount * 3);

		const basisIssues = basisRows.slice(0, 5).map(r => {
			let snap: Record<string, unknown> = {};
			try { snap = JSON.parse(String(r.snapshot_json ?? '{}')); } catch {}
			const sym    = String(snap.symbol ?? snap.assetSymbol ?? '?');
			const reason = REASON_LABEL[String(r.reason)] ?? String(r.reason);
			return `${sym} — ${reason}`;
		});

		const p5: Pillar = {
			key: 'cost_basis', label: 'Cost Basis Integrity',
			score: basisScore, maxScore: PILLAR_MAX,
			status: basisCount === 0 ? 'ok' : basisCount <= 3 ? 'warning' : 'error',
			issueCount: basisCount,
			detail: basisCount === 0
				? 'No missing or unmatched cost basis detected'
				: `${basisCount} transaction${basisCount !== 1 ? 's' : ''} with missing or unmatched cost basis`,
			issues: basisIssues,
			link: '/dashboard/yearEnd/review',
		};

		// ── Pillar 6: Classification Pipeline ────────────────────────────────
		// Scores pipeline freshness and status.
		//   20/20 — ran successfully within 7 days
		//   15/20 — ran successfully 7–30 days ago
		//    5/20 — ran successfully >30 days ago (stale FIFO data)
		//    0/20 — last run failed (gain/loss data may be wrong)
		//   10/20 — never run (lifecycle fallback ok, but no FIFO guarantee)
		const pipelineRow = (pipelineRunResult.rows[0] ?? null) as DbRow | null;
		let pipelineScore  = 10;   // default: never run
		let pipelineStatus: PillarStatus = 'warning';
		let pipelineDetail = 'Classification pipeline has never been run — gains calculated from raw events';
		let pipelineIssues: string[] = [];

		if (pipelineRow) {
			const status      = String(pipelineRow.status ?? '');
			const completedAt = pipelineRow.completed_at ? String(pipelineRow.completed_at) : null;
			const errorMsg    = pipelineRow.error_message ? String(pipelineRow.error_message) : null;
			const classified  = pipelineRow.total_classified != null ? Number(pipelineRow.total_classified) : null;
			const ageDays     = completedAt
				? (Date.now() - new Date(completedAt).getTime()) / 86_400_000
				: null;

			if (status === 'failed') {
				pipelineScore  = 0;
				pipelineStatus = 'error';
				pipelineDetail = 'Last pipeline run failed — gains data may be stale or incorrect';
				pipelineIssues = [errorMsg ? `Error: ${errorMsg.slice(0, 120)}` : 'Pipeline failed — re-run to regenerate classification data'];
			} else if (status === 'running') {
				pipelineScore  = 10;
				pipelineStatus = 'warning';
				pipelineDetail = 'Pipeline is currently running';
			} else if (status === 'success' && ageDays !== null) {
				if (ageDays <= 7) {
					pipelineScore  = PILLAR_MAX;
					pipelineStatus = 'ok';
					pipelineDetail = classified != null
						? `Pipeline ran ${Math.round(ageDays * 24)}h ago — ${classified.toLocaleString()} transactions classified`
						: `Pipeline ran ${Math.round(ageDays * 24)}h ago — data is fresh`;
				} else if (ageDays <= 30) {
					pipelineScore  = 15;
					pipelineStatus = 'warning';
					pipelineDetail = `Pipeline last ran ${Math.round(ageDays)} days ago — consider re-running`;
					pipelineIssues = ['Pipeline data is 7–30 days old — re-run to include recent transactions'];
				} else {
					pipelineScore  = 5;
					pipelineStatus = 'error';
					pipelineDetail = `Pipeline last ran ${Math.round(ageDays)} days ago — gains data is stale`;
					pipelineIssues = [`Pipeline hasn't run in ${Math.round(ageDays)} days — re-run from the Gains page`];
				}
			}
		}

		const p6: Pillar = {
			key: 'pipeline', label: 'Classification Pipeline',
			score: pipelineScore, maxScore: PILLAR_MAX,
			status: pipelineStatus,
			issueCount: pipelineIssues.length,
			detail: pipelineDetail,
			issues: pipelineIssues,
			link: '/dashboard/yearEnd/gains',
		};

		// ── Aggregate ─────────────────────────────────────────────────────────
		const pillars = [p1, p2, p3, p4, p5, p6];
		pillars.forEach((p, i) => { p.key = ['review_queue','wallet_sync','price_coverage','transaction_data','cost_basis','pipeline'][i]; });

		const totalEarned = pillars.reduce((s, p) => s + p.score, 0);
		const score = Math.round((totalEarned / MAX_SCORE) * 100);
		const { grade, label } = gradeFrom(score);

		const payload: CompletenessPayload = { ok: true, year, score, grade, label, pillars, cached: false };
		await setCache(cacheKey, payload, CACHE_TTL);

		return json(payload);
	} catch (err) {
		console.error('[completeness] error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
