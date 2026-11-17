/**
 * The look-alike test the Agent Vault uses (phase 5 of the poisoning warnings), in a module of its own
 * so the check (./checkLog.ts) and the alerts (./alerts.ts) both use it without importing each other.
 */

import { isLookalike } from '@/lib/addressPoisoning';
import type { TrustStatus } from './trustPolicy';

/**
 * Phase 5 of the poisoning warnings (Donnie, Nov 17, 2026): whether an address that is NOT on the
 * agent's list looks like one that is on a list in the account, by any agent: the same first 4 and
 * last 4 characters after the shared prefix (src/lib/addressPoisoning.ts), and a different address.
 * Only entries the owner registered count (trusted or pending); one the owner flagged is not a
 * reference. Pure.
 */
export function looksLikeListed(address: string, listed: ReadonlyArray<{ address: string; trustStatus: TrustStatus }>): boolean {
  return listed.some((d) => d.trustStatus !== 'flagged' && isLookalike(address, d.address));
}
