import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { requireTenantSession } from '../../../../lib/requireTenantSession';
import { db } from '../../../../lib/db';

const KNOWN_SOURCES = ['cashapp', 'coinbase', 'gemini', 'robinhood', 'venmo', 'crypto-com'] as const;
type KnownSource = (typeof KNOWN_SOURCES)[number];

interface ParsedTransaction {
	source: string;
	timestampUtc: string;
	description: string;
	currency: string;
	amount: number | null;
	direction: 'in' | 'out';
	kind: string;
	nativeUsd: number | null;
	feeUsd: number | null;
	txHash: string | null;
}

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const body = await request.json();
	const screenshotId = body?.screenshotId;

	if (typeof screenshotId !== 'string' || !screenshotId) {
		return new Response(JSON.stringify({ error: 'Missing screenshotId.' }), { status: 400 });
	}

	// Fetch the screenshot
	const shotResult = await db.execute({
		sql: `SELECT id, mime_type, data FROM transaction_screenshots WHERE id = ? AND tenant_id = ?`,
		args: [screenshotId, tenantId],
	});

	const shot = shotResult.rows[0];
	if (!shot) {
		return new Response(JSON.stringify({ error: 'Screenshot not found.' }), { status: 404 });
	}

	const mimeType = String(shot.mime_type);
	const base64Data = String(shot.data);

	// Call Claude vision to parse the screenshot
	const anthropic = new Anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY,
	});

	let parsed: ParsedTransaction;
	try {
		const message = await anthropic.messages.create({
			model: 'claude-opus-4-6',
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: {
								type: 'base64',
								media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
								data: base64Data,
							},
						},
						{
							type: 'text',
							text: `You are a financial transaction parser. Extract the transaction details from this screenshot and respond ONLY with a single JSON object — no explanation, no markdown.

Required fields:
- source: one of "cashapp", "coinbase", "gemini", "robinhood", "venmo", "crypto-com", or a short lowercase name you detect (e.g. "chase", "wells-fargo")
- timestampUtc: ISO 8601 string (e.g. "2024-09-09T17:50:12Z"). If timezone is ambiguous, assume UTC.
- description: short description of the transaction (e.g. "Bitcoin Purchase", "Payment to John")
- currency: the asset or currency symbol (e.g. "BTC", "ETH", "USD")
- amount: numeric quantity of the asset (positive number, use null if unknown)
- direction: "in" if receiving/buying, "out" if sending/selling/spending
- kind: one of "crypto_purchase", "crypto_sale", "crypto_deposit", "crypto_withdrawal", "payment_sent", "payment_received", "transfer"
- nativeUsd: USD value of the transaction (positive number, null if not shown)
- feeUsd: fee in USD (null if not shown)
- txHash: transaction hash or ID if visible (null if not shown)

If a field cannot be determined from the image, use null.`,
						},
					],
				},
			],
		});

		const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
		// Strip any accidental markdown fences
		const jsonText = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
		parsed = JSON.parse(jsonText);
	} catch (err) {
		console.error('[screenshot/parse] Claude parse failed', err);
		return new Response(JSON.stringify({ error: 'Failed to parse screenshot with AI.' }), { status: 500 });
	}

	// Validate required fields
	if (!parsed.timestampUtc || !parsed.currency || !parsed.direction) {
		return new Response(
			JSON.stringify({ error: 'Could not extract enough transaction data from the screenshot.' }),
			{ status: 422 },
		);
	}

	const source = typeof parsed.source === 'string' ? parsed.source.toLowerCase().trim() : 'unknown';

	// Find or create an exchange account for this source
	let accountId: string;
	const existing = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = ? ORDER BY created_at ASC LIMIT 1`,
		args: [tenantId, source],
	});

	if (existing.rows.length) {
		accountId = String(existing.rows[0].id);
	} else {
		accountId = randomUUID();
		await db.execute({
			sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
			      VALUES (?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
			args: [accountId, tenantId, source, source.charAt(0).toUpperCase() + source.slice(1)],
		});
	}

	// Build a dedup hash
	const rowHash = createHash('sha256')
		.update(
			JSON.stringify([
				source,
				parsed.timestampUtc,
				parsed.currency,
				parsed.amount ?? '',
				parsed.direction,
				parsed.txHash ?? '',
			]),
		)
		.digest('hex');

	const batchId = randomUUID();
	const txId = randomUUID();

	const insertResult = await db.execute({
		sql: `INSERT INTO import_transactions
		      (id, tenant_id, source, account_id, import_batch_id, timestamp_utc, description,
		       currency, amount, native_usd, kind, tx_hash, direction, asset_symbol, row_hash,
		       fee_usd, created_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
		args: [
			txId,
			tenantId,
			source,
			accountId,
			batchId,
			parsed.timestampUtc,
			parsed.description || null,
			parsed.currency,
			parsed.amount,
			parsed.nativeUsd,
			parsed.kind || null,
			parsed.txHash,
			parsed.direction,
			parsed.currency,
			rowHash,
			parsed.feeUsd,
		],
	});

	const isDuplicate = (insertResult.rowsAffected ?? 0) === 0;

	// Delete the screenshot now that it's been processed
	await db.execute({
		sql: `DELETE FROM transaction_screenshots WHERE id = ? AND tenant_id = ?`,
		args: [screenshotId, tenantId],
	});

	return new Response(
		JSON.stringify({
			ok: true,
			duplicate: isDuplicate,
			source,
			accountId,
			transaction: isDuplicate
				? null
				: {
						id: txId,
						timestampUtc: parsed.timestampUtc,
						description: parsed.description,
						currency: parsed.currency,
						amount: parsed.amount,
						direction: parsed.direction,
						kind: parsed.kind,
						nativeUsd: parsed.nativeUsd,
					},
		}),
		{ status: 200 },
	);
};
