/**
 * GET /api/cron/verify-monitor — Almstins Verify "watchman" (Phase 5).
 *
 * One cron, two re-validation passes (each isolated — a failure in one never blocks
 * the other), using the freshness design: ≤24h max-stale TTL (enforced in the public
 * lookup, not here), detection-driven revocation, fail-safe to *unverified*.
 *
 *  A. Verified Entities — re-pull each proven entity's hosted list, refreshing the
 *     public mirror's `refreshed_at`. Only tenants approved to publish a platform list
 *     (verifyEntityAccess.ts) are refreshed; any other list is never re-pulled. Alert the
 *     owner on a revocation (an address dropped from their list) or on the ok->fail
 *     TRANSITION of their endpoint (the public badge will lapse within the TTL — fail-safe,
 *     never stale-verified).
 *
 *  B. Merchant .well-known proofs — re-fetch each proven domain's proof file. On a
 *     DEFINITIVE change (challenge/file no longer validates, or a proven address is
 *     no longer vouched) the affected destinations lose the domain anchor and the owner
 *     is alerted: a file-proven address lapses; a self-send-proven one keeps its control
 *     proof and drops verified→claimed (releaseDomainAnchor).
 *     A transient unreachable is NOT treated as a swap (no lapse, no alert).
 *
 * Protected by CRON_SECRET (header or ?secret=). Alerts reuse the liquidation-email
 * pattern (alert_email + sendMail + per-recipient language). Owner→world boundary
 * intact: we only ever read what the owner published about their OWN destinations.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { sendMail } from '@/lib/email';
import { isLang, type Lang } from '@/lib/i18n/locale';
import { ensureUserLangColumn } from '@/lib/i18n/userLang';
import { getVerifyAlert, type VerifyAlertKind } from '@/i18n/emails/verifyAlert';
import { listEntitiesForMonitor, monitorEntity } from '@/lib/verifyEntities';
import { ENTITY_NOT_APPROVED } from '@/lib/verifyEntityAccess';
import {
  listProvenDomainsForMonitor, getProvenAddressDestinations,
  releaseDomainAnchor, markDestinationsConfirmed, markDomainProofFailed, markDomainProofRechecked,
  addressKey, listMonitoredDestinations, recordMonitorResult,
} from '@/lib/verifyRegistry';
import { verifyDomainProof } from '@/lib/verifyProof';
import { checkPublishedSource } from '@/lib/verifyPublishedSource';
import { recordCronSuccess } from '@/lib/cronHeartbeat';

export const prerender = false;

const APP_BASE = process.env.AUTH_URL ?? 'https://almstins.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET: APIRoute = async ({ request }) => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) {
    console.warn('[cron/verify-monitor] Unauthorized attempt');
    return json({ error: 'Unauthorized' }, 401);
  }

  const startedAt = Date.now();
  await ensureUserLangColumn();

  // Resolve a tenant's alert email + language once per run (entities/domains can share one).
  const ownerCache = new Map<string, { email: string | null; lang: Lang }>();
  async function getOwner(tenantId: string): Promise<{ email: string | null; lang: Lang }> {
    const hit = ownerCache.get(tenantId);
    if (hit) return hit;
    let email: string | null = null;
    let lang: Lang = 'en';
    try {
      const res = await db.execute({
        sql: `SELECT au.alert_email, au.lang
              FROM tenant_memberships tm
              JOIN auth_users au ON au.id = tm.user_id
              WHERE tm.tenant_id = ? AND au.alert_email IS NOT NULL
              LIMIT 1`,
        args: [tenantId],
      });
      const row = res.rows[0] as Record<string, unknown> | undefined;
      if (row) {
        email = typeof row.alert_email === 'string' ? row.alert_email : null;
        lang = typeof row.lang === 'string' && isLang(row.lang) ? row.lang : 'en';
      }
    } catch { /* non-fatal — no email just means no alert */ }
    const out = { email, lang };
    ownerCache.set(tenantId, out);
    return out;
  }

  async function alert(tenantId: string, kind: VerifyAlertKind, domain: string, items: string[]): Promise<boolean> {
    const { email, lang } = await getOwner(tenantId);
    if (!email) return false;
    try {
      const { subject, text } = getVerifyAlert(lang).render({ kind, domain, items, appBase: APP_BASE });
      await sendMail({ to: email, subject, text });
      return true;
    } catch (err) {
      console.error('[cron/verify-monitor] email send failed', err);
      return false;
    }
  }

  // ── Pass A: Verified Entity mirror re-validation ──────────────────────────────
  const entity = { checked: 0, revokedAlerts: 0, unreachableAlerts: 0, errors: 0 };
  try {
    const targets = await listEntitiesForMonitor();
    for (const t of targets) {
      entity.checked++;
      try {
        const r = await monitorEntity(t.tenantId, t.id);
        if (!r.pull.ok) {
          // Alert only on the ok->fail transition — a persistent failure won't re-spam.
          // A tenant that is not approved to publish is skipped, not reported as unreachable
          // (listEntitiesForMonitor already leaves them out; this is the backstop).
          if (r.pull.code !== ENTITY_NOT_APPROVED && t.lastPullStatus === 'ok'
              && (await alert(t.tenantId, 'unreachable', t.domain, []))) {
            entity.unreachableAlerts++;
          }
        } else if (r.removed.length) {
          if (await alert(t.tenantId, 'revoked', t.domain, r.removed)) entity.revokedAlerts++;
        }
      } catch (err) {
        entity.errors++;
        console.error(`[cron/verify-monitor] entity ${t.id} failed`, err);
      }
      await sleep(500);
    }
  } catch (err) {
    console.error('[cron/verify-monitor] entity pass failed', err);
  }

  // ── Pass B: Merchant .well-known proof re-validation ──────────────────────────
  const merchant = { checked: 0, proofChangedAlerts: 0, addressDroppedAlerts: 0, errors: 0 };
  try {
    const domains = await listProvenDomainsForMonitor();
    for (const d of domains) {
      merchant.checked++;
      try {
        const proven = await getProvenAddressDestinations(d.tenantId, d.domain);
        const res = await verifyDomainProof(d.domain, d.challenge);
        if (!res.ok) {
          if (res.code === 'challenge_mismatch' || res.code === 'malformed') {
            // Definitive: the published proof changed. Release its addresses + alert once.
            await releaseDomainAnchor(d.tenantId, d.domain, proven);
            await markDomainProofFailed(d.tenantId, d.domain);
            if (proven.length && (await alert(d.tenantId, 'proof_changed', d.domain, proven.map((p) => p.value)))) {
              merchant.proofChangedAlerts++;
            }
          } else {
            // Transient (unreachable / invalid_domain) — don't treat as a swap.
            await markDomainProofRechecked(d.tenantId, d.domain);
          }
        } else {
          // Proof still holds — check each proven address is still vouched.
          // addressKey, as the owner's proof matched them (recordProofResult): a listed 'BC1Q…'
          // still vouches for a registered 'bc1q…'.
          const vouched = new Set(res.addresses.map(addressKey));
          const missing = proven.filter((p) => !vouched.has(addressKey(p.value)));
          if (missing.length) {
            await releaseDomainAnchor(d.tenantId, d.domain, missing);
            if (await alert(d.tenantId, 'revoked', d.domain, missing.map((m) => m.value))) {
              merchant.addressDroppedAlerts++;
            }
          }
          // Positively re-confirm the addresses the (re-validated) proof still vouches — advances
          // last_confirmed_at so their public badge stays 'verified'. Addresses NOT confirmed this
          // run keep their old timestamp and lapse 'verified'→'claimed' via the max-stale TTL.
          const stillVouched = proven.filter((p) => vouched.has(addressKey(p.value)));
          if (stillVouched.length) await markDestinationsConfirmed(d.tenantId, stillVouched.map((p) => p.id));
          await markDomainProofRechecked(d.tenantId, d.domain);
        }
      } catch (err) {
        merchant.errors++;
        console.error(`[cron/verify-monitor] domain ${d.domain} failed`, err);
      }
      await sleep(500);
    }
  } catch (err) {
    console.error('[cron/verify-monitor] domain pass failed', err);
  }

  // ── Pass C: Published-source swap monitor ─────────────────────────────────────
  // For each destination the owner attached a public page to, re-fetch that page and
  // check the registered value is still the one shown. A definitive 'swapped' (the
  // value is gone and a conflicting same-kind value is present) alerts the owner. An
  // ambiguous 'missing' / transient 'unreachable' is recorded but never alerted. A
  // 'present' keeps a payment link's badge fresh, never an address's: an address stays
  // 'verified' only while Pass B finds it in its domain's file (recordMonitorResult).
  const watch = { checked: 0, swapAlerts: 0, errors: 0 };
  try {
    const targets = await listMonitoredDestinations();
    for (const t of targets) {
      watch.checked++;
      try {
        const r = await checkPublishedSource(t.kind, t.rail, t.value, t.monitorUrl);
        await recordMonitorResult(t.tenantId, t.id, r.outcome);
        if (r.outcome === 'swapped') {
          const label = t.label || t.value;
          if (await alert(t.tenantId, 'destination_swap', label, [t.value, ...r.found])) {
            watch.swapAlerts++;
          }
        }
      } catch (err) {
        watch.errors++;
        console.error(`[cron/verify-monitor] monitor ${t.id} failed`, err);
      }
      await sleep(500);
    }
  } catch (err) {
    console.error('[cron/verify-monitor] watch pass failed', err);
  }

  // Heartbeat: this run completed. A separate, frequently-running cron (refresh-threat-lists)
  // alerts the owner if this heartbeat goes stale — the dead-man's-switch for a silently-stopped
  // watchman. (Users stay safe regardless: badges fail closed to unverified via the max-stale TTL.)
  await recordCronSuccess('verify-monitor');

  const elapsed_ms = Date.now() - startedAt;
  console.log(`[cron/verify-monitor] done in ${elapsed_ms}ms — entity:`, entity, 'merchant:', merchant, 'watch:', watch);
  return json({ ok: true, elapsed_ms, entity, merchant, watch });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
