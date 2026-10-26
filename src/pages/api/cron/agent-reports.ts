/**
 * GET /api/cron/agent-reports
 *
 * The Agent Vault's daily report job: make yesterday's report for every agent that did anything,
 * then send each account that asked for one its digest (src/lib/agentVault/reportJob.ts). Runs
 * after the chain watcher (sync-agent-wallets), because a transfer is only in the ledger once the
 * watcher has recorded it. Nobody is emailed who has not turned a digest on.
 *
 * It stops starting new work after about nine minutes and picks up the next day. The answer is
 * numbers and true/false only: the workflow prints it in a public log, so it names no account,
 * agent, address or email.
 *
 * Protected by CRON_SECRET, compared in constant time and closed when it is not set (header or
 * ?secret=, like the other cron routes; the workflow sends the header only, so the secret is never in
 * a URL). Called by .github/workflows/agent-reports.yml
 */
import type { APIRoute } from 'astro';
import { cronSecretMatches } from '@/lib/agentVault/cronAuth';
import { defaultJobDeps, runAgentReports } from '@/lib/agentVault/reportJob';
import { json } from '@/lib/http';

export const prerender = false;

/** The workflow gives the request ten minutes; the run stops starting work a minute before that. */
const RUN_BUDGET_MS = 9 * 60_000;

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!cronSecretMatches(secret, provided)) return json({ ok: false, error: 'unauthorized' }, 401, { noStore: true });

  const started = Date.now();
  try {
    const summary = await runAgentReports(defaultJobDeps(), { deadlineAt: started + RUN_BUDGET_MS });
    return json({ ok: true, elapsed_ms: Date.now() - started, ...summary }, 200, { noStore: true });
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error('[cron/agent-reports] run failed', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
    return json({ ok: false, error: 'run_failed' }, 500, { noStore: true });
  }
};
