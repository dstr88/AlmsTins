/**
 * GET /api/records/history-by-wallet[?year=YYYY]
 *
 * Your records, organized by wallet, for you and your tax professional: a ZIP with one CSV
 * per wallet and exchange account, one combined CSV, and a wallets.csv index
 * (src/lib/historyExport.ts). No cost basis, gain/loss, lot or holding-period columns.
 *
 * Any paid plan, the cheapest included, and the owner always (owner decision, Oct 12 2026;
 * src/lib/historyAccess.ts). Free accounts get a JSON 403, and the pages never link a Free
 * account here (they show the locked button instead). Demo sessions follow the demo tenant's
 * own plan, like the bookkeeping CSVs and the Year Summary PDF.
 *
 * More than MAX_HISTORY_ROWS rows (counted before anything is loaded) is a JSON 413, and the
 * page asks for one year at a time; a second request while this account's file is still being
 * built is a JSON 429. Both files are built in memory, so these keep one account from tying up
 * the web process.
 *
 * The tenant comes from the session only; nothing in the request selects it.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { canDownloadHistoryByWallet } from '@/lib/historyAccess';
import { buildHistoryByWallet, HistoryBusyError, parseYearParam } from '@/lib/historyExport';
import { HistoryTooLargeError } from '@/lib/historyRows';
import { getLang } from '@/lib/i18n/locale';

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = session;

	const plan = await getActivePlan(tenantId);
	if (!canDownloadHistoryByWallet(plan.id, tenantId)) {
		return json(
			{
				error: 'Downloading your history by wallet is included in every paid plan. Upgrade at almstins.com/dashboard/billing.',
				planRequired: 'paid',
				currentPlan: plan.id,
			},
			403,
		);
	}

	const parsed = parseYearParam(new URL(request.url).searchParams.get('year'));
	if (!parsed.ok) return json({ error: 'Invalid year.' }, 400);

	try {
		const { filename, bytes } = await buildHistoryByWallet(tenantId, { year: parsed.year, lang: getLang(request) });
		// The ZIP bytes go out as built, with no second copy.
		return new Response(bytes as BodyInit, {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (err) {
		if (err instanceof HistoryTooLargeError) {
			return json({ error: 'Too many rows for one file. Choose a year.', tooManyRows: true, limit: err.limit }, 413);
		}
		if (err instanceof HistoryBusyError) {
			return json({ error: 'A download is already being prepared for this account.' }, 429);
		}
		console.error('[records/history-by-wallet] build failed', err);
		return json({ error: 'The download could not be prepared. Please try again.' }, 500);
	}
};
