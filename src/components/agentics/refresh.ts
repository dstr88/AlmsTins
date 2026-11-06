/**
 * What "Read the chain now" says when it is done. The API answers with a report of the pass (one
 * line for each of the agent's wallets, how many transfers were newly recorded, how many of the
 * transfers read went to or came from addresses not on the list, and how many of those were
 * outflows with no check before them); this turns it into a few plain sentences, honestly: a wallet
 * that could not be read says so, and a transfer to an address that is not on the list is counted,
 * never hidden.
 *
 * Pure, so every branch is a unit test.
 */
import { copy } from './copy';

/** The part of a pass report these sentences read. Anything else in the answer is ignored. */
export interface PassReport {
  wallets: Array<{ status: string }>;
  recorded: number;
  unregistered: number;
  unmatched: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The report from an answer, or null when it is not one. */
export function passOf(body: Record<string, unknown> | null): PassReport | null {
  const pass = body?.pass;
  if (!pass || typeof pass !== 'object') return null;
  const p = pass as Record<string, unknown>;
  const wallets = Array.isArray(p.wallets) ? p.wallets.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object') : [];
  return {
    wallets: wallets.map((w) => ({ status: typeof w.status === 'string' ? w.status : 'failed' })),
    recorded: num(p.recorded),
    unregistered: num(p.unregistered),
    unmatched: num(p.unmatched),
  };
}

const KNOWN = ['complete', 'partial', 'unavailable', 'failed', 'idle'] as const;

/** The sentences that say what the read did, in the order a person wants them. */
export function describeRefresh(pass: PassReport): string[] {
  const lines: string[] = [];
  if (pass.wallets.length === 0) {
    lines.push(copy.refresh.noWallets);
    return lines;
  }
  const count = (status: string) => pass.wallets.filter((w) => w.status === status).length;
  for (const status of KNOWN) {
    const n = count(status);
    if (n > 0) lines.push(copy.refresh.wallets[status](n));
  }
  // A status this code does not know is a wallet that was not read: say so, never hide it.
  const unknown = pass.wallets.filter((w) => !(KNOWN as readonly string[]).includes(w.status)).length;
  if (unknown > 0) lines.push(copy.refresh.wallets.failed(unknown));
  lines.push(copy.refresh.recorded(pass.recorded));
  if (pass.unregistered > 0) lines.push(copy.refresh.unregistered(pass.unregistered, pass.unmatched));
  return lines;
}
