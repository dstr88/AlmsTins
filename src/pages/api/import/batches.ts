import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const url = new URL(request.url);
	const accountId = url.searchParams.get('accountId');
	const source = url.searchParams.get('source');

	if (!accountId || !source) {
		return new Response(JSON.stringify({ error: 'Missing accountId or source.' }), { status: 400 });
	}

	const result = await db.execute({
		sql: `SELECT
		        import_batch_id AS "batchId",
		        COUNT(*) AS "rowCount",
		        MIN(timestamp_utc) AS "earliestTx",
		        MAX(timestamp_utc) AS "latestTx",
		        MAX(created_at) AS "importedAt"
		      FROM import_transactions
		      WHERE tenant_id = ? AND source = ? AND account_id = ?
		      GROUP BY import_batch_id
		      ORDER BY "importedAt" DESC`,
		args: [tenantId, source, accountId],
	});

	const batches = result.rows.map((row) => ({
		batchId: row.batchId,
		rowCount: row.rowCount,
		earliestTx: row.earliestTx,
		latestTx: row.latestTx,
		importedAt: row.importedAt,
	}));

	return new Response(JSON.stringify({ batches }), { status: 200 });
};

export const DELETE: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const url = new URL(request.url);
	const batchId = url.searchParams.get('batchId');
	const source = url.searchParams.get('source');

	if (!batchId || !source) {
		return new Response(JSON.stringify({ error: 'Missing batchId or source.' }), { status: 400 });
	}

	// Collect the IDs of every import_transaction in this batch first
	const idResult = await db.execute({
		sql: `SELECT id FROM import_transactions WHERE import_batch_id = ? AND tenant_id = ? AND source = ?`,
		args: [batchId, tenantId, source],
	});

	const txIds = idResult.rows.map((r) => String(r.id));

	if (txIds.length) {
		const placeholders = txIds.map(() => '?').join(',');

		// Collect tax lot IDs so we can delete their disposals
		const lotResult = await db.execute({
			sql: `SELECT id FROM tax_lots WHERE tenant_id = ? AND source_type = 'import' AND source_id IN (${placeholders})`,
			args: [tenantId, ...txIds],
		});
		const lotIds = lotResult.rows.map((r) => String(r.id));

		if (lotIds.length) {
			const lotPlaceholders = lotIds.map(() => '?').join(',');
			await db.execute({
				sql: `DELETE FROM tax_disposals WHERE tenant_id = ? AND lot_id IN (${lotPlaceholders})`,
				args: [tenantId, ...lotIds],
			});
		}

		await db.execute({
			sql: `DELETE FROM tax_lots WHERE tenant_id = ? AND source_type = 'import' AND source_id IN (${placeholders})`,
			args: [tenantId, ...txIds],
		});

		await db.execute({
			sql: `DELETE FROM tax_classifications WHERE tenant_id = ? AND source_type = 'import' AND source_id IN (${placeholders})`,
			args: [tenantId, ...txIds],
		});

		await db.execute({
			sql: `DELETE FROM tax_review_items WHERE tenant_id = ? AND source_type = 'import' AND source_id IN (${placeholders})`,
			args: [tenantId, ...txIds],
		});

		await db.execute({
			sql: `DELETE FROM asset_lifecycle_events WHERE tenant_id = ? AND source_type = 'import' AND source_id IN (${placeholders})`,
			args: [tenantId, ...txIds],
		});
	}

	const txResult = await db.execute({
		sql: `DELETE FROM import_transactions WHERE import_batch_id = ? AND tenant_id = ? AND source = ?`,
		args: [batchId, tenantId, source],
	});

	await db.execute({
		sql: `DELETE FROM import_raw_rows WHERE import_batch_id = ? AND tenant_id = ? AND source = ?`,
		args: [batchId, tenantId, source],
	});

	return new Response(JSON.stringify({ ok: true, deleted: txResult.rowsAffected ?? 0 }), { status: 200 });
};
