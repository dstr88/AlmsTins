/**
 * GET /api/cron/sync-defi
 *
 * GitHub Actions BACKUP DeFi scheduler. Runs the IDENTICAL handler as the Render
 * `sync-aave` cron — Aave health/positions → wallet_defi_sync for every EVM wallet
 * across all tenants, plus liquidation bookkeeping. If Render's cron ever fails to
 * fire, the weekly GitHub Actions job hits this and the sync still happens.
 *
 * Redundancy by design: two independent SCHEDULERS (Render + GitHub), one source of
 * truth for the sync LOGIC (sync-aave) — so the backup can never drift from the
 * primary. The 6-day staleness skip in that logic means whichever scheduler runs
 * first does the work and the other harmlessly skips already-fresh wallets.
 *
 * Same CRON_SECRET auth (x-cron-secret header or ?secret= query).
 */
import { GET as syncAaveCron } from './sync-aave';

export const prerender = false;
export const GET = syncAaveCron;
