/**
 * GET /api/cron/refresh-threat-lists
 *
 * Refreshes the local threat mirror in Postgres — MetaMask + ScamSniffer phishing domains and
 * the OFAC sanctioned-address list — hash-gated, so an unchanged source is a cheap no-op. The
 * mirror backs the wallet-checker's domain/sanctions screens and the mailbox scanner; without a
 * scheduled refresh those go stale, and the OFAC source never populates at all. (The lib has a
 * lazy on-demand self-heal too, but a dedicated cron is the reliable driver.)
 *
 * Doubles as the heartbeat monitor: this cron runs often and independently of verify-monitor, so
 * it is the natural place to notice the watchman going quiet (a dead-man's-switch) and alert the
 * owner. Users stay safe regardless — Verify badges fail closed via the max-stale TTL.
 *
 * Protected by CRON_SECRET (header or ?secret=). Pass ?force=1 to reload even when unchanged.
 */
import type { APIRoute } from 'astro';
import { refreshThreatLists } from '@/lib/threatLists';
import { claimStaleAlerts } from '@/lib/cronHeartbeat';
import { sendMail } from '@/lib/email';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    console.warn('[cron/refresh-threat-lists] Unauthorized attempt');
    return json({ error: 'Unauthorized' }, 401);
  }

  const force = new URL(request.url).searchParams.get('force') === '1';
  const startedAt = Date.now();

  let lists: Record<string, unknown> = {};
  try {
    lists = await refreshThreatLists({ force });
    console.log('[cron/refresh-threat-lists] done', lists);
  } catch (e) {
    console.error('[cron/refresh-threat-lists] refresh failed:', e instanceof Error ? e.message : e);
    lists = { error: 'refresh failed' };
  }

  // Dead-man's-switch: alert the owner if the Verify watchman has gone quiet (>26h ≈ 4 missed
  // 6-hourly runs). De-duped to one email per stale window. Never fails the refresh.
  const heartbeat: { alerted: string[] } = { alerted: [] };
  try {
    const stale = await claimStaleAlerts([{ name: 'verify-monitor', maxAgeHours: 26 }]);
    if (stale.length) {
      const linesTxt = stale.map(
        (s) => `${s.name}: last success ${s.lastSuccessAt ?? 'never'}${s.ageHours == null ? '' : ` (${s.ageHours.toFixed(1)}h ago)`}`,
      );
      await sendMail({
        to: 'donnie@titaniumhut.com',
        subject: 'Almstins cron heartbeat — verify-monitor is stale',
        text:
          `A scheduled job has not reported success within its window:\n\n${linesTxt.join('\n')}\n\n` +
          `Verify badges fail safe while it is down (they lapse to unverified within the max-stale TTL), ` +
          `but re-verification has stopped. Check the GitHub Actions schedule and the ` +
          `/api/cron/verify-monitor run logs.`,
      });
      heartbeat.alerted = stale.map((s) => s.name);
    }
  } catch (e) {
    console.error('[cron/refresh-threat-lists] heartbeat check failed:', e instanceof Error ? e.message : e);
  }

  return json({ ok: true, elapsed_ms: Date.now() - startedAt, lists, heartbeat });
};
