/**
 * Part of every cache key that holds a computed tax figure (the summary, Form 8949, the P&L number).
 * Change it whenever a rule changes results, so a figure computed under the old rule is not served
 * under the new one. v2: transfers between a tenant's own wallets are moves, not sales.
 * v3: sales from 2025-01-01 draw on the wallet or account they were made from (tenants in the rollout).
 * v4: in those wallets a sale uses the lot identification in force at its time, else earliest acquired.
 */
export const TAX_CACHE_VERSION = 'v4';
