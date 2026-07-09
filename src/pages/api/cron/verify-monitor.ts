/**
 * GET /api/cron/verify-monitor — Almstins Verify "watchman" (Phase 5).
 *
 * One cron, two re-validation passes (each isolated — a failure in one never blocks
 * the other), using the freshness design: ≤24h max-stale TTL (enforced in the public
 * lookup, not here), detection-driven revocation, fail-safe to *unverified*.
 *
 *  A. Verified Entities — re-pull each proven entity's hosted list, refreshing the
 *     public mirror's `refreshed_at`. Alert the owner on a revocation (an address
 *     dropped from their list) or on the ok->fail TRANSITION of their endpoint
 *     (the public badge will lapse within the TTL — fail-safe, never stale-verified).
 *
 *  B. Merchant .well-known proofs — re-fetch each proven domain's proof file. On a
 *     DEFINITIVE change (challenge/file no longer validates, or a proven address is
 *     no longer vouched) the affected destinations lapse and the owner is alerted.
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
import { checkWallet } from '@/lib/walletChecker';
import {
  listProvenDomainsForMonitor, getProvenAddressDestinations,
  markDestinationsLapsed, markDomainProofFailed, markDomainProofRechecked,
  normalizeDestinationValue, listMonitoredDestinations, recordMonitorResult,
} from '@/lib/verifyRegistry';
import { verifyDomainProof } from '@/lib/verifyProof';
import { checkPublishedSource } from '@/lib/verifyPublishedSource';

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

  // Chains GoPlus supports — only check addresses on these chains for sanctions/blacklist flags.
  const GOPLUS_CHAINS = new Set(['ethereum', 'polygon', 'avalanche', 'solana', 'tron']);
  // Max addresses to safety-check per entity per run (API cost guard).
  const SAFETY_CHECK_LIMIT = 50;
  // Flag fields that warrant an alert.
  const SAFETY_FLAGS: Array<[string, string]> = [
    ['sanctioned',       'OFAC sanctioned'],
    ['blacklisted',      'on global blacklist'],
    ['moneyLaundering',  'money laundering activity'],
    ['mixer',            'mixer/Tornado Cash connections'],
  ];

  // ── Pass A: Verified Entity mirror re-validation ──────────────────────────────
  const entity = { checked: 0, revokedAlerts: 0, unreachableAlerts: 0, sanctionAlerts: 0, errors: 0 };
  try {
    const targets = await listEntitiesForMonitor();
    for (const t of targets) {
      entity.checked++;
      try {
        const r = await monitorEntity(t.tenantId, t.id);
        if (!r.pull.ok) {
          // Alert only on the ok->fail transition — a persistent failure won't re-spam.
          if (t.lastPullStatus === 'ok' && (await alert(t.tenantId, 'unreachable', t.domain, []))) {
            entity.unreachableAlerts++;
          }
        } else {
          if (r.removed.length) {
            if (await alert(t.tenantId, 'revoked', t.domain, r.removed)) entity.revokedAlerts++;
          }
          // Safety check: run GoPlus/OFAC/blacklist on each mirrored address.
          // Only GoPlus-supported chains; capped to avoid API cost overrun on large lists.
          try {
            const mirrorRes = await db.execute({
              sql: `SELECT address, chain FROM verified_address_mirror
                    WHERE entity_id = $1 AND tenant_id = $2
                    LIMIT ${SAFETY_CHECK_LIMIT}`,
              args: [t.id, t.tenantId],
            });
            const checkTargets = (mirrorRes.rows as unknown as Array<{ address: string; chain: string }>)
              .filter(row => GOPLUS_CHAINS.has(String(row.chain)))
              .map(row => String(row.address));

            const flaggedItems: string[] = [];
            for (const addr of checkTargets) {
              try {
                const wc = await checkWallet(addr);
                const triggered = SAFETY_FLAGS
                  .filter(([field]) => (wc.flags as Record<string, boolean>)[field])
                  .map(([, label]) => label);
                if (triggered.length) {
                  flaggedItems.push(`${addr} — ${triggered.join(', ')}`);
                }
              } catch { /* non-fatal per-address */ }
              await sleep(300);
            }
            if (flaggedItems.length) {
              if (await alert(t.tenantId, 'sanctions_flag', t.domain, flaggedItems)) {
                entity.sanctionAlerts++;
              }
            }
          } catch (err) {
            console.error(`[cron/verify-monitor] safety check for entity ${t.id} failed`, err);
          }
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
            // Definitive: the published proof changed. Lapse its addresses + alert once.
            await markDestinationsLapsed(d.tenantId, proven.map((p) => p.id));
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
          const vouched = new Set(res.addresses.map(normalizeDestinationValue));
          const missing = proven.filter((p) => !vouched.has(normalizeDestinationValue(p.value)));
          if (missing.length) {
            await markDestinationsLapsed(d.tenantId, missing.map((m) => m.id));
            if (await alert(d.tenantId, 'revoked', d.domain, missing.map((m) => m.value))) {
              merchant.addressDroppedAlerts++;
            }
          }
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
  // ambiguous 'missing' / transient 'unreachable' is recorded but never alerted.
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
