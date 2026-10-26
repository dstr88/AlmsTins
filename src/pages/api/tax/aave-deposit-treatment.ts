/**
 * POST /api/tax/aave-deposit-treatment  { treatment: 'tax_event' | 'undecided' | 'not_tax_event' }
 *
 * The tenant's district-level choice for how supplying assets into a DeFi contract
 * (Aave) is treated. Informational/organizational — Almstins never files. Persists
 * via jurisdictionProfile.setAaveDepositTax; the annual breakdown reads it back.
 *
 * Owner only: the choice feeds the gain/loss figures, which are tax documents
 * (src/lib/taxAuth.ts). Everyone else, the demo included, gets the generic 404.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { setAaveDepositTax, type AaveDepositTax } from '@/lib/jurisdictionProfile';
import { json } from '@/lib/http';

export const prerender = false;

const VALID: readonly AaveDepositTax[] = ['tax_event', 'undecided', 'not_tax_event'];

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireTaxOwner(request); // tax documents: owner only
  if (denied) return denied;

  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: { treatment?: unknown } = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const treatment = String(body.treatment ?? '');
  if (!VALID.includes(treatment as AaveDepositTax)) return json({ ok: false, error: 'invalid' }, 400);

  await setAaveDepositTax(session.tenantId, treatment as AaveDepositTax);
  return json({ ok: true, treatment });
};
