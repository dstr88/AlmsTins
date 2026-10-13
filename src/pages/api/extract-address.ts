/**
 * POST /api/extract-address
 *
 * Accepts a multipart form upload containing an image (screenshot).
 * Passes the image to Claude Vision and returns any wallet addresses found.
 *
 * Response: { addresses: string[] }
 */

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';
import { requireTenantSession } from '../../lib/requireTenantSession';

export const prerender = false;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ error: true, message: 'Expected multipart form data' }, 400);
	}

	const file = formData.get('image');
	if (!(file instanceof File)) {
		return json({ error: true, message: 'No image file provided' }, 400);
	}

	if (!ALLOWED_TYPES.has(file.type)) {
		return json({ error: true, message: 'Unsupported image type. Use PNG, JPEG, GIF, or WebP.' }, 400);
	}

	const bytes = await file.arrayBuffer();
	if (bytes.byteLength > MAX_BYTES) {
		return json({ error: true, message: 'Image too large (max 5 MB)' }, 400);
	}

	const base64 = Buffer.from(bytes).toString('base64');
	const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

	try {
		const msg = await anthropic.messages.create({
			model: 'claude-opus-4-5',
			max_tokens: 256,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: { type: 'base64', media_type: mediaType, data: base64 },
						},
						{
							type: 'text',
							text: `Look at this screenshot and extract any cryptocurrency wallet addresses visible in the image.

Return ONLY a JSON object in this exact format, with no other text:
{"addresses": ["0xabc...", "bc1q..."]}

Rules:
- Include EVM addresses (0x + 40 hex chars), Bitcoin addresses (starting with 1, 3, or bc1), Solana addresses (base58, 32-44 chars), and any other blockchain addresses you can identify.
- Normalize EVM addresses to lowercase.
- Remove spaces or line breaks that may have been introduced by the screenshot.
- If no wallet address is visible, return {"addresses": []}.
- Do not include transaction hashes (0x + 64 hex chars) — only wallet/contract addresses.`,
						},
					],
				},
			],
		});

		const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

		// Parse the JSON response from Claude
		let parsed: { addresses: string[] };
		try {
			// Handle case where Claude wraps in markdown code block
			const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
			parsed = JSON.parse(clean);
		} catch {
			console.error('[extract-address] Failed to parse Claude response:', text);
			return json({ error: true, message: 'Could not parse addresses from image' }, 422);
		}

		const addresses = Array.isArray(parsed.addresses)
			? parsed.addresses.filter((a): a is string => typeof a === 'string' && a.length > 0)
			: [];

		return json({ addresses });
	} catch (err) {
		console.error('[extract-address] Claude API error:', err);
		return json({ error: true, message: 'Failed to analyse image' }, 500);
	}
};
