/**
 * costBasisMethodSetting.ts
 *
 * Persists each tenant's default cost-basis method (FIFO or HIFO) in
 * tenant_settings.cost_basis_method. Mirrors the persistence pattern in
 * jurisdictionProfile.ts.
 *
 * This is record-keeping, not tax advice and not a filing. The method only
 * controls how Almstins *computes the tenant's own record* (Year Summary,
 * gain/loss and transaction exports). It transmits nothing to any exchange or
 * broker and does not change what a broker reports to the IRS on Form 1099-DA.
 * Specific identification for broker-held units is made with the broker (or,
 * for the 2025 tax year, via the taxpayer's own records under Notice 2025-7);
 * for self-custody it is the taxpayer's own contemporaneous records. Users
 * should confirm specifics with a qualified tax professional.
 */

import { db } from './db';
import type { CostBasisMethod } from './yearEnd/lotSelection';

/**
 * The methods a user may choose in Settings. The lot-selection engine also
 * supports 'lifo' and 'spec_id', but those are not user-selectable here —
 * 'spec_id' is driven by per-lot pins on the owner's tax pages.
 */
export type UserCostBasisMethod = 'fifo' | 'hifo';

export function isUserCostBasisMethod(value: unknown): value is UserCostBasisMethod {
  return value === 'fifo' || value === 'hifo';
}

/**
 * The tenant's persisted default cost-basis method. Fails open to 'fifo' (the
 * IRS default) if the row, column or table is unavailable, so a read never
 * 500s and existing tenants keep today's behaviour until they opt in.
 */
export async function getCostBasisMethod(tenantId: string): Promise<CostBasisMethod> {
  try {
    const result = await db.execute({
      sql: 'SELECT cost_basis_method FROM tenant_settings WHERE tenant_id = ?',
      args: [tenantId],
    });
    const raw = String(
      (result.rows[0] as { cost_basis_method?: unknown } | undefined)?.cost_basis_method ?? 'fifo',
    );
    return raw === 'hifo' || raw === 'lifo' || raw === 'spec_id' ? (raw as CostBasisMethod) : 'fifo';
  } catch {
    return 'fifo';
  }
}

/** Persist the tenant's cost-basis method choice (upsert). */
export async function setCostBasisMethod(
  tenantId: string,
  method: UserCostBasisMethod,
): Promise<void> {
  await db.execute({
    sql: `
      INSERT INTO tenant_settings (tenant_id, cost_basis_method)
      VALUES (?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        cost_basis_method = excluded.cost_basis_method,
        updated_at        = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
    `,
    args: [tenantId, method],
  });
}
