/**
 * /api/verify/receivables/update-request — ask a claim's lender to update it (Part A, approved
 * 2026-11-28). The lender's update is the answer: there is no reply and no conversation.
 *
 * GET ?receivableId=<id>  What the caller may see about requests on the record: per claim, whether
 *   the caller may ask now and the public "update requested" days. The record's client also gets
 *   its own dated requests; a claim's lender gets the client requests on his own claims with their
 *   notes. Signed out, only the day counts. Rate-limited per network like the public lookup.
 *
 * POST { receivableId, claimId, note? }
 *   - signed out, or signed in as anyone but the record's client: an anonymous request, allowed
 *     only while the claim reads past_due_not_updated or lapsed (A1). Stored once per claim per
 *     day; the lender hears in the next daily summary and never learns who asked. A note is ignored.
 *   - signed in as the record's client (the accepted borrower account): allowed on any open claim;
 *     the lender is emailed at once, every time, told the client asked; an optional note of at
 *     most 280 characters (A2) goes to the lender only, never the public record.
 *   Answers { ok, askedAt } so the page shows the same honest line to every clicker: "The lender
 *   has been asked to update this record. Last asked: ...". Never says an email went out.
 *
 * Refusals: 400 invalid / note_too_long, 403 demo_readonly (the demo writes nothing) and
 * own_claim (a lender asking himself), 404 not_found, 409 not_open, 410 withdrawn, 429.
 * Headers and limits come from src/lib/http/publicApi.ts (JSON, no-store, no CORS). The lender's
 * address and every requester's identity stay server-side.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getReceivableStatus } from '@/lib/receivablesRegistry';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { admitByIp, admitByKey, publicJson } from '@/lib/http/publicApi';
import { canAskUpdate, cleanRequestNote } from '@/lib/receivables/updateRequests';
import {
	emailLenderAboutClientRequest,
	isClientOf,
	loadRequestContext,
	recordUpdateRequest,
	requestViewFor,
} from '@/lib/receivables/server/updateRequestStore';

export const prerender = false;

const WINDOW_MS = 60_000;
/** The public lookup's budget: 30 a minute per network, for reads and for requests alike. */
const readLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 30 });
const askLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 30 });
/** A client's own budget on top: each of its requests is an email to the lender. */
const clientLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 10 });

const isHex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
const TOO_MANY = { body: { ok: false, error: 'rate_limited' }, retryAfterSeconds: WINDOW_MS / 1000 };

async function sessionOf(request: Request) {
	return requireTenantSession(request).catch(() => null);
}

export const GET: APIRoute = async ({ request, url }) => {
	const raw = url.searchParams.get('receivableId');
	if (!isHex64(raw)) return publicJson({ ok: false, error: 'invalid' }, 400);
	const limited = admitByIp(readLimiter, request, TOO_MANY);
	if (limited) return limited;
	try {
		const rcv = await getReceivableStatus(raw.toLowerCase());
		if (!rcv) return publicJson({ ok: false, error: 'not_found' }, 404);
		const session = await sessionOf(request);
		const view = await requestViewFor(rcv, { tenantId: session?.tenantId ?? null });
		// The demo browses but never asks.
		if (session?.isDemo) view.claims.forEach((c) => { c.canAsk = false; });
		return publicJson({ ok: true, ...view });
	} catch (err) {
		console.error('[receivables-update-request] read failed:', err instanceof Error ? err.message : err);
		return publicJson({ ok: false, error: 'failed' }, 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
	let body: any = {};
	try { body = await request.json(); } catch { /* ignore */ }
	const receivableId = String(body.receivableId ?? '').toLowerCase();
	const claimId = String(body.claimId ?? '').trim();
	if (!isHex64(receivableId) || !claimId || claimId.length > 100) return publicJson({ ok: false, error: 'invalid' }, 400);

	const limited = admitByIp(askLimiter, request, TOO_MANY);
	if (limited) return limited;

	const session = await sessionOf(request);
	if (session?.isDemo) return publicJson({ ok: false, error: 'demo_readonly' }, 403);

	try {
		const ctx = await loadRequestContext(receivableId, claimId);
		if (!ctx) return publicJson({ ok: false, error: 'not_found' }, 404);
		if (ctx.rcv.withdrawn) return publicJson({ ok: false, error: 'withdrawn' }, 410);
		if (session && session.tenantId === ctx.lenderTenantId) return publicJson({ ok: false, error: 'own_claim' }, 403);

		const isClient = session ? await isClientOf(session.tenantId, receivableId) : false;
		const viewer = isClient ? 'client' : 'public';
		if (!canAskUpdate(viewer, { settled: ctx.rcv.settled, withdrawn: ctx.rcv.withdrawn === true }, ctx.claim)) {
			return publicJson({ ok: false, error: 'not_open' }, 409);
		}

		if (!isClient) {
			const { askedAt } = await recordUpdateRequest(ctx, 'public');
			return publicJson({ ok: true, askedAt });
		}

		const note = cleanRequestNote(body.note);
		if (note === 'too_long') return publicJson({ ok: false, error: 'note_too_long' }, 400);
		const overClient = admitByKey(clientLimiter, `tenant:${session!.tenantId}`, TOO_MANY);
		if (overClient) return overClient;
		const { id, askedAt } = await recordUpdateRequest(ctx, 'client', { requesterTenantId: session!.tenantId, note });
		await emailLenderAboutClientRequest(ctx, id, note);
		return publicJson({ ok: true, askedAt });
	} catch (err) {
		console.error('[receivables-update-request] request failed:', err instanceof Error ? err.message : err);
		return publicJson({ ok: false, error: 'failed' }, 500);
	}
};
