/**
 * POST /api/verify/cairn/seal — the deliberate act (authenticated).
 *
 * Body: { projectId }
 *
 * Signs the whole schedule at once: every milestone gets its signed manifest, the project
 * manifest embeds every milestone digest and is signed over the lot, and the project
 * digest is stamped to Bitcoin. After this the schedule is read-only and inspectors can
 * be invited. Owner-scoped; refuses an empty or already-sealed schedule.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { sealProject } from '@/lib/cairnRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const result = await sealProject(session.tenantId, String(body.projectId ?? ''));
  return result.ok ? json(result)
    : json(result, result.error === 'not_found' ? 404 : result.error === 'already_sealed' ? 409 : 400);
};
