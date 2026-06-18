import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID, createHash } from 'node:crypto';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { db } from '../../../lib/db';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const VALID_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ValidMime = (typeof VALID_TYPES)[number];

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const formData = await request.formData();
	const file = formData.get('file');

	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: 'Missing file.' }), { status: 400 });
	}
	if (file.size > MAX_SIZE_BYTES) {
		return new Response(JSON.stringify({ error: 'File too large (max 5 MB).' }), { status: 413 });
	}
	const mimeType = (file.type || 'image/jpeg') as ValidMime;
	if (!VALID_TYPES.includes(mimeType)) {
		return new Response(JSON.stringify({ error: 'Invalid file type. Use JPEG, PNG, GIF, or WebP.' }), { status: 400 });
	}

	const buffer = await file.arrayBuffer();
	const base64Data = Buffer.from(buffer).toString('base64');

	const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

	let parsed: Record<string, unknown>;
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
							source: { type: 'base64', media_type: mimeType, data: base64Data },
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
		const jsonText = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
		parsed = JSON.parse(jsonText);
	} catch (err) {
		console.error('[portfolio/import-screenshot] Claude parse failed', err);
		return new Response(JSON.stringify({ error: 'Failed to parse screenshot with AI.' }), { status: 500 });
	}

	if (!parsed.timestampUtc || !parsed.currency || !parsed.direction) {
		return new Response(
			JSON.stringify({ error: 'Could not extract enough transaction data from the screenshot.' }),
			{ status: 422 },
		);
	}

	const source =
		typeof parsed.source === 'string' ? parsed.source.toLowerCase().trim() : 'unknown';

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
			sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at) VALUES (?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
			args: [accountId, tenantId, source, source.charAt(0).toUpperCase() + source.slice(1)],
		});
	}

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
			String(parsed.timestampUtc),
			parsed.description ?? null,
			String(parsed.currency),
			parsed.amount ?? null,
			parsed.nativeUsd ?? null,
			parsed.kind ?? null,
			parsed.txHash ?? null,
			String(parsed.direction),
			String(parsed.currency),
			rowHash,
			parsed.feeUsd ?? null,
		],
	});

	const isDuplicate = (insertResult.rowsAffected ?? 0) === 0;

	return new Response(
		JSON.stringify({
			ok: true,
			duplicate: isDuplicate,
			source,
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
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
