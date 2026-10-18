/**
 * GET /api/cron/sync-agent-wallets
 *
 * The Agent Vault's daily read of the chain. For every tin with a trusted destination, look for
 * movements of funds between the agent's own wallets and those destinations, and record the new
 * ones in the ledger (src/lib/agentVault/watcher.ts). Only trusted, registered destinations are
 * watched; a transfer to any other address is read past and never kept.
 *
 * It paces itself on the shared explorer rate limit, stops starting new reads after about nine
 * minutes, and picks up where it stopped the next day (the cursors keep what was read). The
 * answer is numbers and true/false only: the workflow prints it in a public log, so it names no
 * wallet and no account.
 *
 * Protected by CRON_SECRET (header or ?secret=). Called by .github/workflows/sync-agent-wallets.yml
 */
import type { APIRoute } from 'astro';
import { defaultWatchDeps, runAllTins } from '@/lib/agentVault/watcher';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The workflow gives the request ten minutes; the run stops starting work a minute before that. */
const RUN_BUDGET_MS = 9 * 60_000;

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();
  try {
    const summary = await runAllTins(defaultWatchDeps, { deadlineAt: started + RUN_BUDGET_MS });
    return json({ ok: true, elapsed_ms: Date.now() - started, ...summary });
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error('[cron/sync-agent-wallets] run failed', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
    return json({ ok: false, error: 'run_failed' }, 500);
  }
};
