/**
 * POST /api/verify/receivables/attest — record a party attestation (authenticated).
 *
 * Body: { receivableId, role, label, statement, date? }
 *
 * Stage 2 (verification): a party signs a statement about the receivable. The
 * load-bearing one is the BUYER acknowledging the debt ("I owe ₦100m for invoice X,
 * due Y") — the obligor attesting against their own interest, which is what makes a
 * financing claim trustworthy. Signed with the Almstins key; digest Bitcoin-anchorable.
 * Only the self-chosen label is ever public — never tenant_id/identity.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addAttestation, type AttesterRole } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 'buyer' is deliberately excluded. It must only ever come from the token-gated
// debtor confirmation (confirmByToken, backing /verify/authenticate), where the
// person answering had to type their own reference number and tick four specific
// boxes. This endpoint has no way to check the caller is actually the debtor --
// allowing 'buyer' here let anyone holding the receivable ID (the financier, or
// the borrower themselves) self-attest as the debtor, indistinguishable
// downstream from a real confirmation.
const ROLES: AttesterRole[] = ['supplier', 'inspector', 'other'];

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  if (body.role === 'buyer') {
    return json({ ok: false, error: 'role_requires_token' }, 403);
  }

  const role = ROLES.includes(body.role) ? (body.role as AttesterRole) : 'other';
  const result = await addAttestation(session.tenantId, String(body.receivableId ?? ''), {
    role,
    label: String(body.label ?? ''),
    statement: String(body.statement ?? ''),
    date: body.date ? String(body.date) : undefined,
  });

  if (result.ok) return json(result);
  return json(result, result.error === 'not_found' ? 404 : 400);
};
