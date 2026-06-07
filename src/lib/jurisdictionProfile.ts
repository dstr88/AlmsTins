/**
 * jurisdictionProfile.ts — Phase D
 *
 * Each jurisdiction is a plain config object (a "profile").  Page templates
 * read profile fields instead of branching on a jurisdiction string.
 * Adding a new jurisdiction means adding a profile entry here — no page
 * code needs to change.
 *
 * Profiles are intentionally narrow: Almstins is a bookkeeping /
 * record-keeping tool.  Nothing here constitutes tax advice or implies
 * Almstins performs jurisdiction-specific compliance functions.
 */

import { db } from './db';
import type { CostBasisMethod } from './yearEnd/lotSelection';

// ── Types ────────────────────────────────────────────────────────────────────

export type Jurisdiction = 'us' | 'intl';

export type JurisdictionProfile = {
  /** The jurisdiction key — use to read back what was persisted. */
  jurisdiction: Jurisdiction;
  /** Human-readable name shown in toggles / settings. */
  label: string;
  /**
   * Label for the shorter-held disposal tin.
   * US:   "Short-Term G/L"  (< 1 year, IRS rule)
   * Intl: "Held < 1 year"   (informational; no statutory significance)
   */
  shortTermLabel: string;
  /**
   * Label for the longer-held disposal tin.
   * US:   "Long-Term G/L"   (≥ 1 year, IRS rule)
   * Intl: "Held ≥ 1 year"   (informational)
   */
  longTermLabel: string;
  /**
   * When true, disposals are split into two tins by holding period
   * (US: short-term < 1 year, long-term ≥ 1 year).
   * When false, all disposals appear in a single date-ordered "Realized G/L" tin.
   */
  splitByTerm: boolean;
  /**
   * When true, show US-IRS-specific informational notes:
   *   "taxed as ordinary income" on the short-term total
   *   "preferential rate"        on the long-term total
   * Always informational — never filing advice.
   */
  showUsTaxNotes: boolean;
  /**
   * When true, expose US tax form references (Form 8949, Schedule D, 1099)
   * in Tax Center navigation and export surfaces.
   */
  showUsForms: boolean;
  /** Default cost-basis method for this jurisdiction. */
  defaultMethod: CostBasisMethod;
};

// ── Profile registry ─────────────────────────────────────────────────────────

export const PROFILES: Record<Jurisdiction, JurisdictionProfile> = {
  us: {
    jurisdiction:   'us',
    label:          'United States (IRS)',
    shortTermLabel: 'Short-Term G/L',
    longTermLabel:  'Long-Term G/L',
    splitByTerm:    true,
    showUsTaxNotes: true,
    showUsForms:    true,
    defaultMethod:  'fifo',
  },
  intl: {
    jurisdiction:   'intl',
    label:          'International',
    shortTermLabel: 'Held < 1 year',
    longTermLabel:  'Held ≥ 1 year',
    splitByTerm:    false,
    showUsTaxNotes: false,
    showUsForms:    false,
    defaultMethod:  'fifo',
  },
};

// ── Persistence helpers ───────────────────────────────────────────────────────

/**
 * Returns the jurisdiction profile for a tenant.
 * Falls back to the US profile if no setting row exists (preserves current
 * behaviour for all existing tenants after the migration runs).
 */
export async function getJurisdictionProfile(tenantId: string): Promise<JurisdictionProfile> {
  try {
    const result = await db.execute({
      sql:  'SELECT jurisdiction FROM tenant_settings WHERE tenant_id = ?',
      args: [tenantId],
    });
    const row = result.rows[0] as { jurisdiction?: unknown } | undefined;
    const jur = String(row?.jurisdiction ?? 'us');
    return PROFILES[(jur as Jurisdiction) in PROFILES ? (jur as Jurisdiction) : 'us'];
  } catch {
    // Table may not exist yet (pre-migration run) — fail open to the US
    // default so existing pages keep working without a 500.
    return PROFILES.us;
  }
}

/**
 * Persists a jurisdiction choice for a tenant (upsert).
 */
export async function setJurisdiction(
  tenantId:     string,
  jurisdiction: Jurisdiction,
): Promise<void> {
  await db.execute({
    sql: `
      INSERT INTO tenant_settings (tenant_id, jurisdiction)
      VALUES (?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        jurisdiction = excluded.jurisdiction,
        updated_at   = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `,
    args: [tenantId, jurisdiction],
  });
}
