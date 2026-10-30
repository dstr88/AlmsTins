/**
 * GET /api/lot-identifications/proof?id=<entry id>
 *
 * Downloads one entry with what is needed to check its timestamp: the entry's canonical fields, its
 * path to the Merkle root of its batch, and the OpenTimestamps proof (.ots, base64) for that root.
 * Anyone with the file can recompute the root and verify the .ots with an OpenTimestamps client; what
 * it shows is that the entry existed unchanged no later than the Bitcoin block time. Owner only.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { loadIdentifications } from '@/lib/lotIdentificationStore';
import { loadStamps } from '@/lib/lotIdentificationStamp';
import { entryProofOf } from '@/lib/tax/lotIdentificationTree';
import { json } from '@/lib/http';

export const prerender = false;

const ID_RE = /^[0-9a-f-]{36}$/i;

export const GET: APIRoute = async ({ request, url }) => {
	const denied = await requireTaxOwner(request);
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	try {
		const id = (url.searchParams.get('id') ?? '').trim();
		if (!ID_RE.test(id)) return json({ ok: false, error: 'id_invalid' }, 400);
		const entries = await loadIdentifications(sess.tenantId);
		const entry = entries.find((e) => e.id === id);
		if (!entry) return json({ ok: false, error: 'not_found' }, 404);
		const batch = entries.filter((e) => e.batchId === entry.batchId);
		const stamp = (await loadStamps(sess.tenantId)).get(entry.batchId) ?? null;
		const proof = entryProofOf(batch, id, stamp);
		if (!proof) return json({ ok: false, error: 'not_found' }, 404);
		return json(
			{
				format: 'almstins-lot-identification-proof-v1',
				note: 'The leaf is sha256(0x00 || canonical JSON of the entry); nodes are sha256(0x01 || left || right). The .ots proof stamps the root. It shows the entry existed unchanged no later than the Bitcoin block time, and nothing more.',
				entry: proof.entry,
				leaf_hash: proof.leafHash,
				inclusion: proof.inclusion,
				batch_root: proof.rootHex,
				timestamp: { status: proof.status, block_height: proof.blockHeight, block_time: proof.blockTime, ots_base64: proof.otsBase64 },
			},
			200,
			{ pretty: true, noStore: true, headers: { 'Content-Disposition': `attachment; filename="almstins-identification-${id}.json"` } },
		);
	} catch (err) {
		console.error('[lot-identifications] proof error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
