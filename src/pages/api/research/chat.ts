import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { askPortfolioChat, getChatUsage, CHAT_LIMITS } from '@/lib/aiChat';
import { auditChatQuestion } from '@/lib/securityEvents';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  let body: { question?: unknown } = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const question = String(body.question ?? '').trim().slice(0, 1000);
  if (!question) return json({ ok: false, error: 'Question is required' }, 400);

  // Audit for injection attempts — fire-and-forget, never blocks
  void auditChatQuestion(tenantId, question);

  const plan = await getActivePlan(tenantId);
  const planId = plan.id;

  // Check usage before calling Claude
  const usage = await getChatUsage(tenantId, planId);
  if (!usage.ok) {
    return json({
      ok: false,
      error: 'limit_reached',
      used: usage.used,
      limit: usage.limit,
      upgradeUrl: '/dashboard/billing',
    }, 429);
  }

  try {
    const { answer, usage: updatedUsage } = await askPortfolioChat(tenantId, planId, question);
    return json({ ok: true, answer, usage: updatedUsage });
  } catch (e) {
    console.error('[chat] Claude error', e);
    return json({ ok: false, error: 'AI service unavailable. Please try again.' }, 502);
  }
};

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  const plan = await getActivePlan(tenantId);
  const usage = await getChatUsage(tenantId, plan.id);
  return json({ ok: true, usage, planId: plan.id });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
