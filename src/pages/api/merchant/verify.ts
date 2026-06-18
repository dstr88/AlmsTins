/**
 * POST /api/merchant/verify
 *
 * Anti-MITM merchant self-verify (Phase 1). Body: { payload } — the decoded QR
 * string (or a pasted address / payment URI). Classifies it, normalizes it, and
 * compares against this tenant's registered `merchant_destinations`. A match means
 * the sign still points to the merchant's own wallet; a mismatch means a possible
 * swap. Crypto destinations also get a best-effort safety overlay (checkWallet).
 *
 * Pure equality against the merchant's own ground truth — catches a brand-new
 * "clean" thief address that no blacklist would flag.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { checkWallet } from '@/lib/walletChecker';

export const prerender = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BTC_RE = /^(bc1[0-9a-z]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
const LTC_RE = /^(ltc1[0-9a-z]{6,87}|[LM3][a-km-zA-HJ-NP-Z1-9]{26,33})$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Parsed = { kind: 'crypto' | 'url' | 'unknown'; value: string; chain: string | null };

function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    // scheme + host + path identify the destination; drop query/hash + trailing slash.
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function parsePayload(raw: string): Parsed {
  const s = (raw ?? '').trim();
  if (!s) return { kind: 'unknown', value: '', chain: null };

  // Payment URI: scheme:address(?params)
  const uri = /^(ethereum|bitcoin|litecoin|solana|polygon|bnb):([^?]+)/i.exec(s);
  if (uri) {
    const scheme = uri[1].toLowerCase();
    let addr = uri[2].trim();
    try { addr = decodeURIComponent(addr); } catch { /* keep raw */ }
    return { kind: 'crypto', value: EVM_RE.test(addr) ? addr.toLowerCase() : addr, chain: scheme };
  }

  // Payment URL (tradfi / Stripe link) — Phase 2 adds the dapp-check overlay; here we
  // classify + exact-match against any registered url destination.
  if (/^https?:\/\//i.test(s)) return { kind: 'url', value: canonicalUrl(s), chain: null };

  // Bare address
  if (EVM_RE.test(s)) return { kind: 'crypto', value: s.toLowerCase(), chain: 'evm' };
  if (BTC_RE.test(s)) return { kind: 'crypto', value: s, chain: 'bitcoin' };
  if (LTC_RE.test(s)) return { kind: 'crypto', value: s, chain: 'litecoin' };
  if (SOL_RE.test(s)) return { kind: 'crypto', value: s, chain: 'solana' };

  return { kind: 'unknown', value: s, chain: null };
}

/** Best-effort safety check, time-bounded so a slow upstream never hangs verify. */
async function safetyOverlay(address: string): Promise<unknown | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000));
  const check = checkWallet(address)
    .then((r) => ({
      scamLevel: r.scamLevel,
      scamScore: r.scamScore,
      flags: r.flags,
    }))
    .catch(() => null);
  return Promise.race([check, timeout]);
}

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
  const { tenantId } = session;

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const payload = typeof body.payload === 'string' ? body.payload : '';
  const parsed = parsePayload(payload);

  if (parsed.kind === 'unknown' || !parsed.value) {
    return json({ ok: true, verdict: 'unrecognized', payload, kind: parsed.kind, value: parsed.value });
  }

  // 1. Match against the merchant's registered destinations of record (the core).
  const matchRes = await db.execute({
    sql: `SELECT id, label FROM merchant_destinations
          WHERE tenant_id = ? AND kind = ? AND value = ? LIMIT 1`,
    args: [tenantId, parsed.kind, parsed.value],
  });
  const matched = matchRes.rows[0] as unknown as { id: unknown; label: unknown } | undefined;

  // 2. Crypto extras: is it one of their tracked wallets, plus a safety overlay.
  let isTrackedWallet = false;
  let safety: unknown | null = null;
  if (parsed.kind === 'crypto') {
    try {
      const w = await db.execute({
        sql: `SELECT 1 FROM wallets WHERE tenant_id = ? AND lower(address) = ? LIMIT 1`,
        args: [tenantId, parsed.value.toLowerCase()],
      });
      isTrackedWallet = Boolean(w.rows?.length);
    } catch { /* non-fatal */ }
    safety = await safetyOverlay(parsed.value);
  }

  const verdict = matched ? 'verified' : isTrackedWallet ? 'own_unregistered' : 'mismatch';

  return json({
    ok: true,
    verdict,
    payload,
    kind: parsed.kind,
    value: parsed.value,
    chain: parsed.chain,
    matched: matched ? { id: String(matched.id), label: matched.label ? String(matched.label) : null } : null,
    isTrackedWallet,
    safety,
  });
};
