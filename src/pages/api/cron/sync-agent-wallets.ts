/**
 * GET /api/cron/sync-agent-wallets
 *
 * One call of the Agent Vault's daily read of the chain. For every agent wallet, read every direct
 * transfer it made or received, mark what the registry says about the other side, and record the
 * new ones in the ledger (src/lib/agentVault/watcher.ts).
 *
 * The day is one pass made of as many calls as it takes (src/lib/agentVault/syncPass.ts): each call
 * reads the wallets the pass has not read yet, least recently read first, stops starting new reads
 * after about nine minutes, and answers `done` and how many are `remaining`. The workflow calls
 * again until `done`. The answer is numbers and true/false only: the workflow prints it in a public
 * log, so it names no wallet and no account.
 *
 * Protected by CRON_SECRET, compared in constant time and closed when it is not set (header or
 * ?secret=, like the other cron routes; the workflow sends the header only, so the secret is never in
 * a URL). Called by .github/workflows/sync-agent-wallets.yml
 */
import type { APIRoute } from 'astro';
import { cronSecretMatches } from '@/lib/agentVault/cronAuth';
import { runSyncCall } from '@/lib/agentVault/syncPass';
import { defaultWatchDeps } from '@/lib/agentVault/watcher';
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
    const summary = await runSyncCall(defaultWatchDeps, { deadlineAt: started + RUN_BUDGET_MS });
    return json({ ok: true, elapsed_ms: Date.now() - started, ...summary }, 200, { noStore: true });
  } catch (err) {
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error('[cron/sync-agent-wallets] run failed', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
    return json({ ok: false, error: 'run_failed' }, 500, { noStore: true });
  }
};
