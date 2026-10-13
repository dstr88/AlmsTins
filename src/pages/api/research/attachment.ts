import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getResearchErrors } from '@/i18n/apiErrors/research';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
	'image/png', 'image/jpeg', 'image/gif', 'image/webp',
	'application/pdf',
];

export const prerender = false;

// ── Validation helpers ────────────────────────────────────────────────────────

interface ReceiptFields {
	asset:        string | null;
	cryptoAmount: number | null;
	usdTotal:     number | null;
	feeUsd:       number | null;
	dateIso:      string | null;
	status:       string | null;
}

interface ValidationResult {
	status:     'matched' | 'rejected' | 'skipped';
	receipt:    ReceiptFields;
	mismatches: string[];
}

async function validateReceipt(
	base64: string,
	mimeType: string,
	txAsset: string,
	txCryptoAmount: number,
	txNativeUsd: number,
	txTimestampUtc: string,
): Promise<ValidationResult> {
	// PDFs can't be sent as images to Claude vision
	if (mimeType === 'application/pdf') {
		return { status: 'skipped', receipt: { asset: null, cryptoAmount: null, usdTotal: null, feeUsd: null, dateIso: null, status: null }, mismatches: [] };
	}

	const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

	const msg = await anthropic.messages.create({
		model: 'claude-haiku-4-5-20251001',
		max_tokens: 512,
		messages: [{
			role: 'user',
			content: [
				{
					type: 'image',
					source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 },
				},
				{
					type: 'text',
					text: `Extract these fields from this financial receipt. Respond ONLY with a JSON object — no explanation, no markdown fences.

Fields:
- asset: crypto ticker (e.g. "BTC", "ETH") or null
- cryptoAmount: quantity of crypto as a number or null
- usdTotal: total USD paid/received including fees as a number or null
- feeUsd: fee in USD as a number or null
- dateIso: transaction date/time as ISO 8601 string or null (assume UTC if timezone unclear)
- status: transaction status string (e.g. "Complete") or null`,
				},
			],
		}],
	});

	const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
	const jsonText = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
	const receipt: ReceiptFields = JSON.parse(jsonText);

	const mismatches: string[] = [];

	// Asset check
	if (receipt.asset && receipt.asset.toUpperCase() !== txAsset.toUpperCase()) {
		mismatches.push(`Asset: receipt shows ${receipt.asset}, transaction is ${txAsset}`);
	}

	// Crypto amount check (within 0.01%)
	if (receipt.cryptoAmount !== null && txCryptoAmount > 0) {
		const delta = Math.abs(receipt.cryptoAmount - txCryptoAmount) / txCryptoAmount;
		if (delta > 0.0001) {
			mismatches.push(`Amount: receipt shows ${receipt.cryptoAmount} ${txAsset}, transaction has ${txCryptoAmount}`);
		}
	}

	// USD total check (within $0.05)
	if (receipt.usdTotal !== null && txNativeUsd > 0) {
		const delta = Math.abs(receipt.usdTotal - txNativeUsd);
		if (delta > 0.05) {
			mismatches.push(`USD amount: receipt shows $${receipt.usdTotal.toFixed(2)}, transaction has $${txNativeUsd.toFixed(2)}`);
		}
	}

	// Date check (within 5 minutes)
	if (receipt.dateIso) {
		const receiptMs  = new Date(receipt.dateIso).getTime();
		const txMs       = new Date(txTimestampUtc).getTime();
		const diffMin    = Math.abs(receiptMs - txMs) / 60_000;
		if (!isNaN(diffMin) && diffMin > 5) {
			mismatches.push(`Date: receipt shows ${receipt.dateIso.slice(0, 16)}, transaction is ${txTimestampUtc.slice(0, 16)}`);
		}
	}

	return {
		status:     mismatches.length === 0 ? 'matched' : 'rejected',
		receipt,
		mismatches,
	};
}

// ── GET ?txId=xxx ─────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const url  = new URL(request.url);
	const txId = url.searchParams.get('txId');
	if (!txId) return new Response(JSON.stringify({ error: 'Missing txId' }), { status: 400 });

	const result = await db.execute({
		sql: `SELECT id, filename, mime_type, created_at, validation_json, override_note
		      FROM transaction_screenshots
		      WHERE tenant_id = ? AND tx_hash = ? AND chain = 'import'
		      ORDER BY created_at ASC`,
		args: [tenantId, txId],
	});

	return new Response(JSON.stringify({
		attachments: result.rows.map(r => ({
			id:             r.id,
			filename:       r.filename,
			mimeType:       r.mime_type,
			createdAt:      r.created_at,
			validation:     r.validation_json ? JSON.parse(String(r.validation_json)) : null,
			overrideNote:   r.override_note ?? null,
		})),
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// ── POST (multipart) — upload + validate ─────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const t = getResearchErrors(getLang(request));

	const formData = await request.formData();
	const txId            = formData.get('txId');
	const file            = formData.get('file');
	const txAsset         = String(formData.get('txAsset')         ?? '');
	const txCryptoAmount  = parseFloat(String(formData.get('txCryptoAmount') ?? '0'));
	const txNativeUsd     = parseFloat(String(formData.get('txNativeUsd')    ?? '0'));
	const txTimestampUtc  = String(formData.get('txTimestampUtc')  ?? '');

	if (typeof txId !== 'string' || !txId) {
		return new Response(JSON.stringify({ error: 'Missing txId' }), { status: 400 });
	}
	if (!(file instanceof File)) {
		return new Response(JSON.stringify({ error: t.missingFile }), { status: 400 });
	}
	if (!ALLOWED_TYPES.includes(file.type)) {
		return new Response(JSON.stringify({ error: t.unsupportedFileType }), { status: 400 });
	}
	if (file.size > MAX_SIZE_BYTES) {
		return new Response(JSON.stringify({ error: t.fileTooLarge }), { status: 400 });
	}

	const buffer  = await file.arrayBuffer();
	const base64  = Buffer.from(buffer).toString('base64');
	const id      = crypto.randomUUID();
	const created = new Date().toISOString();

	// ── Paywall: validation is a paid feature ─────────────────────────────────
	const plan      = await getActivePlan(tenantId);
	const isPaid    = plan.id !== 'free';
	const paywalled = !isPaid;

	// Run Claude vision validation (paid plans only; non-fatal if it fails)
	let validation: ValidationResult | null = null;
	if (isPaid && txAsset && process.env.ANTHROPIC_API_KEY) {
		try {
			validation = await validateReceipt(base64, file.type, txAsset, txCryptoAmount, txNativeUsd, txTimestampUtc);
		} catch (err) {
			console.error('[attachment] validation failed:', err);
		}
	}

	const validationJson = validation ? JSON.stringify(validation) : null;

	await db.execute({
		sql: `INSERT INTO transaction_screenshots
		        (id, tenant_id, tx_hash, chain, filename, mime_type, data, created_at, validation_json)
		      VALUES (?, ?, ?, 'import', ?, ?, ?, ?, ?)`,
		args: [id, tenantId, txId, file.name, file.type, base64, created, validationJson],
	});

	return new Response(JSON.stringify({
		ok: true, id, filename: file.name, createdAt: created, validation, paywalled,
	}), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

// ── PATCH — mark override ─────────────────────────────────────────────────────
export const PATCH: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json();
	const id   = body?.id;
	const note = body?.overrideNote ?? '';

	if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

	// Fetch existing validation to merge status
	const row = await db.execute({
		sql: `SELECT validation_json FROM transaction_screenshots WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});
	if (!row.rows[0]) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

	const existing = row.rows[0].validation_json ? JSON.parse(String(row.rows[0].validation_json)) : {};
	const updated  = { ...existing, status: 'overridden' };

	await db.execute({
		sql: `UPDATE transaction_screenshots SET validation_json = ?, override_note = ? WHERE id = ? AND tenant_id = ?`,
		args: [JSON.stringify(updated), note, id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

// ── DELETE ?id=xxx ────────────────────────────────────────────────────────────
export const DELETE: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const url = new URL(request.url);
	const id  = url.searchParams.get('id');
	if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

	await db.execute({
		sql: `DELETE FROM transaction_screenshots WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
