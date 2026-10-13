/**
 * GET /api/petro-tins/receipts/:id/photo — stream a receipt's photo bytes.
 *
 * Tenant-scoped: only returns the photo if the receipt belongs to the caller's
 * tenant. Served inline with the stored mime type so it renders in <img> and
 * can be opened/downloaded directly. Demo sessions may view their own (none).
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isOwner } from '@/lib/owner';
import { getReceiptPhoto } from '@/lib/petroReceipts';

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!isOwner(session.tenantId)) return new Response('Not found', { status: 404 });
  const { tenantId } = session;

  const id = String(params.id ?? '').trim();
  if (!id) return new Response('Missing id', { status: 400 });

  const photo = await getReceiptPhoto(tenantId, id);
  if (!photo) return new Response('Not found', { status: 404 });

  const bytes = new Uint8Array(Buffer.from(photo.data, 'base64'));

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type':         photo.mimeType,
      'Content-Disposition':  'inline',
      // Serve user-uploaded bytes as-is; never let the browser sniff a different type.
      'X-Content-Type-Options': 'nosniff',
      // Private to the signed-in user; never cached by shared/edge caches.
      'Cache-Control':        'private, max-age=300',
    },
  });
};
