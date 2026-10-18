/**
 * What every /api/agentics endpoint shares: the owner check, JSON in and out, and plain errors.
 *
 * The middleware gate (src/lib/agenticsAccess.ts) already answers anyone but the owner with the
 * 404 page before an endpoint runs. Each endpoint checks again, through vaultRoute, so the data
 * stays closed even if that gate is ever loosened or bypassed: a signed-out visitor, a demo
 * session and any other account all get the same plain 404 an unknown path gets. These endpoints
 * are not public and must never be added to isPublicPath.
 *
 * Errors are codes, never raw error text. An unexpected failure is logged by name and code only
 * (a database error message can carry the values it was given) and answered with a plain 500.
 */
import type { APIRoute } from 'astro';
import { canAccessAgenticsVault } from '@/lib/agenticsAccess';
import { requireTenantSession } from '@/lib/requireTenantSession';
import type { Failure, VaultError } from './vault';

/** The largest request body accepted, in characters. A pasted list is capped separately (MAX_TEXT_CHARS). */
export const MAX_BODY_CHARS = 60_000;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers },
  });

/** What a throttled caller is told to wait, in whole seconds: the length of the throttle's window. */
export const RETRY_AFTER_SECONDS = 60;

const STATUS: Record<VaultError, number> = {
  invalid_label: 400,
  invalid_chain: 400,
  invalid_address: 400,
  invalid_id: 400,
  nothing_to_add: 400,
  too_many: 400,
  text_too_long: 413,
  invalid_cursor: 400,
  refresh_in_progress: 409,
  tin_not_found: 404,
  wallet_not_found: 404,
  destination_not_found: 404,
  key_not_found: 404,
  key_not_active: 409,
  key_in_use: 409,
  invalid_period: 400,
  report_not_found: 404,
  not_signed: 409,
  report_altered: 409,
  signing_unavailable: 503,
  invalid_settings: 400,
  rate_limited: 429,
  version_limit: 409,
};

/** A vault operation's failure as a response: its code, and its HTTP status (a throttled caller also gets a Retry-After). */
export const failure = (f: Failure): Response =>
  json(f, STATUS[f.error], f.error === 'rate_limited' ? { 'Retry-After': String(RETRY_AFTER_SECONDS) } : {});

const notFound = (): Response => new Response('Not found', { status: 404 });

export interface VaultContext {
  tenantId: string;
  request: Request;
  url: URL;
}

/** Wraps an endpoint method: owner only (a plain 404 for anyone else), and no raw error text in a 500. */
export function vaultRoute(handler: (ctx: VaultContext) => Promise<Response>): APIRoute {
  return async ({ request, url }) => {
    const session = await requireTenantSession(request);
    if (!session || !canAccessAgenticsVault(session)) return notFound();
    try {
      return await handler({ tenantId: session.tenantId, request, url });
    } catch (err) {
      const e = err as { name?: unknown; code?: unknown } | null;
      console.error('[agent-vault] request failed', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
      return json({ ok: false, error: 'server_error' }, 500);
    }
  };
}

/** The request's JSON body as an object, or the response to send instead. */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_CHARS * 4) return { ok: false, response: json({ ok: false, error: 'too_large' }, 413) };
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: json({ ok: false, error: 'expected_json' }, 400) };
  }
  if (raw.length > MAX_BODY_CHARS) return { ok: false, response: json({ ok: false, error: 'too_large' }, 413) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: json({ ok: false, error: 'expected_json' }, 400) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, response: json({ ok: false, error: 'expected_json' }, 400) };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}
