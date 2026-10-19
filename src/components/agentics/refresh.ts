/**
 * What "Read the chain now" says when it is done. The API answers with a report of the pass (one
 * line for each of the agent's wallets, how many registered addresses were watched, how many
 * transfers were newly recorded); this turns it into a few plain sentences, honestly: a wallet
 * that could not be read says so, and says nothing about any address outside the registry.
 *
 * Pure, so every branch is a unit test.
 */
import { copy } from './copy';

/** The part of a pass report these sentences read. Anything else in the answer is ignored. */
export interface PassReport {
  watchedDestinations: number;
  notWatched: { overLimit: number };
  wallets: Array<{ status: string }>;
  recorded: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The report from an answer, or null when it is not one. */
export function passOf(body: Record<string, unknown> | null): PassReport | null {
  const pass = body?.pass;
  if (!pass || typeof pass !== 'object') return null;
  const p = pass as Record<string, unknown>;
  const notWatched = (p.notWatched && typeof p.notWatched === 'object' ? p.notWatched : {}) as Record<string, unknown>;
  const wallets = Array.isArray(p.wallets) ? p.wallets.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object') : [];
  return {
    watchedDestinations: num(p.watchedDestinations),
    notWatched: { overLimit: num(notWatched.overLimit) },
    wallets: wallets.map((w) => ({ status: typeof w.status === 'string' ? w.status : 'failed' })),
    recorded: num(p.recorded),
  };
}

/** The daily read covers this many trusted addresses for an account (src/lib/agentVault/watcher.ts MAX_WATCHED_PER_TENANT). */
export const DAILY_READ_COVERS = 15;

/** The sentences that say what the read did, in the order a person wants them. */
export function describeRefresh(pass: PassReport): string[] {
  const lines: string[] = [];
  if (pass.wallets.length === 0) {
    lines.push(pass.watchedDestinations === 0 ? copy.refresh.nothingTrusted : copy.refresh.nothingPaired);
  } else {
    const count = (status: string) => pass.wallets.filter((w) => w.status === status).length;
    for (const status of ['complete', 'partial', 'unavailable', 'failed', 'idle'] as const) {
      const n = count(status);
      if (n > 0) lines.push(copy.refresh.wallets[status](n));
    }
    // A status this code does not know is a wallet that was not read: say so, never hide it.
    const unknown = pass.wallets.filter((w) => !['complete', 'partial', 'unavailable', 'failed', 'idle'].includes(w.status)).length;
    if (unknown > 0) lines.push(copy.refresh.wallets.failed(unknown));
    lines.push(copy.refresh.recorded(pass.recorded));
  }
  if (pass.notWatched.overLimit > 0) lines.push(copy.refresh.overLimit(pass.notWatched.overLimit, DAILY_READ_COVERS));
  return lines;
}
