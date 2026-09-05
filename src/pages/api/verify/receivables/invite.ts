/**
 * Invitations onto a receivable.
 *
 * POST   { role, receivableId?, label?, email? }  -> mint a single-use token
 * POST   { action: 'accept', token }              -> spend it, writing the access grant
 * POST   { action: 'revoke', token }              -> withdraw one you sent
 * GET    ?token=…                                 -> what an invitee sees before signing in
 * GET                                             -> invitations this tenant has sent
 *
 * An invitation binds one account to one role on one record. Accepting writes a grant,
 * which is what makes "who is my client" answerable without anyone reading anyone else's
 * tenant. The token is random and single-use; a predictable one would be a standing key.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import {
  createInvite, readInvite, acceptInvite, revokeInvite, listInvitesFrom,
  type InviteRole,
} from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ROLES: InviteRole[] = ['borrower', 'buyer', 'financier'];

// Reading an invitation needs no account — you are being asked to make one.
export const GET: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get('token');
  if (token) return json(await readInvite(token));

  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  return json({ ok: true, invites: await listInvitesFrom(session.tenantId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  if (body.action === 'accept') {
    const result = await acceptInvite(String(body.token ?? ''), session.tenantId);
    return result.ok ? json(result) : json(result, 400);
  }

  if (body.action === 'revoke') {
    const done = await revokeInvite(session.tenantId, String(body.token ?? ''));
    return done ? json({ ok: true }) : json({ ok: false, error: 'not_found' }, 404);
  }

  const role = body.role as InviteRole;
  if (!ROLES.includes(role)) return json({ ok: false, error: 'invalid_role' }, 400);

  const result = await createInvite(session.tenantId, {
    role,
    receivableId: body.receivableId ?? null,
    label: body.label ?? null,
    email: body.email ?? null,
  });
  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 400);
};
