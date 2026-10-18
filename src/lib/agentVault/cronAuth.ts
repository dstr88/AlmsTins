/**
 * Who may call the Vault's two scheduled endpoints (/api/cron/agent-reports and
 * /api/cron/sync-agent-wallets): whoever holds CRON_SECRET. The comparison is the part that
 * matters here, so it lives in one place both routes share.
 *
 *   - Constant time. A plain `!==` stops at the first byte that differs, and how long it took tells
 *     a caller how much of the secret it has right. Both sides are hashed with SHA-256 first, so the
 *     two buffers handed to crypto.timingSafeEqual are always 32 bytes, whatever was sent and
 *     however long the real secret is (timingSafeEqual throws on buffers of different lengths, and
 *     a length check of our own would leak the length).
 *   - Fail closed. No secret configured (unset or empty) is never a match, not even for a caller
 *     that sends nothing: an unconfigured server is closed, never open to "".
 *
 * The secret is read by the route (`import.meta.env.CRON_SECRET`, which has to be in the
 * environment at build time as well as at run time); this file only compares. It logs nothing.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** True only when `provided` is exactly the configured secret. */
export function cronSecretMatches(configured: unknown, provided: unknown): boolean {
  if (typeof configured !== 'string' || configured === '') return false;
  if (typeof provided !== 'string' || provided === '') return false;
  return timingSafeEqual(digest(configured), digest(provided));
}
