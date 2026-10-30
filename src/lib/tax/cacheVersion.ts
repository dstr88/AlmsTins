/**
 * Part of every cache key that holds a computed tax figure (the summary, Form 8949, the P&L number).
 * Change it whenever a rule changes results, so a figure computed under the old rule is not served
 * under the new one. v2: transfers between a tenant's own wallets are moves, not sales.
 */
export const TAX_CACHE_VERSION = 'v2';
