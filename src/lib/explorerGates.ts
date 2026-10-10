/**
 * explorerGates.ts — one rate gate per explorer API, shared by every caller in this process:
 * the wallet checker's lookups (walletChecker.ts), its activity reads (evmActivity.ts) and
 * the helpers in etherscan.ts (wallet sync, holdings, Verify deposit checks). Calls that
 * bypass the gate would push the shared key over its limit, and the provider would then
 * answer the gated calls with errors (see rateGate.ts).
 *
 * Limits: Etherscan's free plan allows 3 calls per second per key; Routescan allows 2 per
 * second keyless. A paid Etherscan plan or a Routescan key allows more: set
 * ETHERSCAN_CALLS_PER_SEC / ROUTESCAN_CALLS_PER_SEC (whole numbers, 1 to 50).
 *
 * Priorities, lower first. The verdict's safety lookups go first, then the app's existing
 * work (Verify self-send proofs, wallet sync, holdings), then the public Activity tab. Under
 * load every check still gets its Ethereum history before any check's later chains:
 *   safety         0     contract-name and multi-sig lookups (part of the verdict)
 *   background     1     etherscan.ts helpers: Verify proofs and signed-in features must not
 *                        wait behind anonymous activity reads. etherscan.ts already spaces its
 *                        own calls 1.2 s apart, so it takes about one slot per window at most.
 *   activityFirst  10+n  oldest-first history pages of the n-th activity chain
 *   activityLater  20+n  newest-first pages, nonce and balance fallbacks
 * An activity read that waits too long fails closed ("could not be read right now").
 */

import { createRateGate } from './rateGate';

// Each window is 1.1 s rather than 1 s: a margin for network jitter between our start time
// and the provider's arrival time.
const WINDOW_MS = 1_100;

function callsPerWindow(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : fallback;
}

export const GATE_PRIORITY = { safety: 0, background: 1, activityFirst: 10, activityLater: 20 } as const;

/** Safety lookups wait at most this long for a slot (the gates' default). */
export const SAFETY_MAX_WAIT_MS = 5_000;
/**
 * An activity read waits at most this long for a slot, then that chain reads as "could not
 * be read right now". One busy wallet alone needs up to 4 windows on the free plan (6 first
 * pages, up to 6 newest-first pages), so its last pages wait about 3 s; anything longer is
 * other checks' load, and the priorities above already give every check its Ethereum first.
 */
export const ACTIVITY_MAX_WAIT_MS = 4_000;
/** etherscan.ts calls: a long wait is fine for background work, an endless one is not. */
export const BACKGROUND_MAX_WAIT_MS = 30_000;

export const etherscanGate = createRateGate({
  limit: callsPerWindow(import.meta.env.ETHERSCAN_CALLS_PER_SEC ?? process.env.ETHERSCAN_CALLS_PER_SEC, 3),
  intervalMs: WINDOW_MS,
  maxWaitMs: SAFETY_MAX_WAIT_MS,
});

export const routescanGate = createRateGate({
  limit: callsPerWindow(import.meta.env.ROUTESCAN_CALLS_PER_SEC ?? process.env.ROUTESCAN_CALLS_PER_SEC, 2),
  intervalMs: WINDOW_MS,
  maxWaitMs: SAFETY_MAX_WAIT_MS,
});

/** The gate for an Etherscan-style API URL: Routescan's for api.routescan.io, else Etherscan's. */
export function gateForUrl(url: string) {
  return /^https:\/\/api\.routescan\.io\//i.test(url) ? routescanGate : etherscanGate;
}
