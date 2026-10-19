/**
 * Builders for the Agent Vault tests. Every address, label, tenant and amount here is invented:
 * the addresses are a recognizable filler ("c0ffee", zero padded) and belong to no one.
 */
import type { WalletCheckResult } from '../../src/lib/walletChecker';
import type { TrustDeps } from '../../src/lib/agentVault/trustChecks';
import type { VerifyLookup } from '../../src/lib/agentVault/trustPolicy';

/** The success branch of a result, or a thrown error that shows what came back instead. */
export function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** A well-formed EVM address, lowercase, numbered. */
export const addr = (n: number): string => `0x${'c0ffee'.padEnd(36, '0')}${n.toString(16).padStart(4, '0')}`;
/** The same address with its hex letters in capitals (the digits are unchanged). */
export const upper = (a: string): string => `0x${a.slice(2).toUpperCase()}`;

type Flags = WalletCheckResult['flags'];
type Coverage = WalletCheckResult['coverage'];

/** A complete, clean answer from the public checker (every source ran, nothing flagged), with overrides. */
export function walletResult(over: { flags?: Partial<Flags>; coverage?: Partial<Coverage>; chainabuseReports?: number | null; checkedAt?: string } = {}): WalletCheckResult {
  return {
    address: addr(0),
    chain: 'evm',
    // The moment fakeDeps() answers at, so a readout made from it carries the same time either way.
    checkedAt: over.checkedAt ?? '2026-10-01T12:00:00.000Z',
    scamScore: 0,
    scamLevel: 'clean',
    flags: {
      blacklisted: false, phishing: false, honeypotRelated: false, stealingAttack: false,
      darkwebTransactions: false, cybercrime: false, moneyLaundering: false, financialCrime: false,
      blackmail: false, mixer: false, sanctioned: false,
      ...over.flags,
    },
    ensName: null,
    multiSig: null,
    chainabuseReports: over.chainabuseReports ?? null,
    holdings: [],
    activity: {} as WalletCheckResult['activity'],
    honeypot: { checked: true, isHoneypot: false, reason: null },
    fundingSource: { fromMixer: null, fromExchange: null, label: null },
    entityLabel: null,
    errors: [],
    coverage: { goplus: 'ran', honeypot: 'ran', chainabuse: 'ran', sanctions: 'ran', chainalysis: 'skipped', ...over.coverage },
    partialCoverage: false,
  };
}

export const NO_VERIFY_RECORD: VerifyLookup = { level: null, domain: null, claimedElsewhere: false };

export interface FakeDeps extends TrustDeps {
  /** Answers by address; an Error is thrown. Anything not listed is a clean answer. */
  wallets: Record<string, WalletCheckResult | Error>;
  verifies: Record<string, VerifyLookup | Error>;
  calls: { wallet: string[]; verify: Array<{ tenantId: string; address: string }>; fresh: string[] };
  inFlight: { now: number; max: number };
}

/** Checks that answer from tables instead of the network, and remember how they were called. */
export function fakeDeps(): FakeDeps {
  const deps: FakeDeps = {
    wallets: {},
    verifies: {},
    calls: { wallet: [], verify: [], fresh: [] },
    inFlight: { now: 0, max: 0 },
    now: () => new Date('2026-10-01T12:00:00.000Z'),
    async wallet(address, opts) {
      deps.calls.wallet.push(address);
      if (opts?.fresh) deps.calls.fresh.push(address);
      deps.inFlight.now += 1;
      deps.inFlight.max = Math.max(deps.inFlight.max, deps.inFlight.now);
      try {
        await new Promise((r) => setTimeout(r, 1));
        const answer = deps.wallets[address];
        if (answer instanceof Error) throw answer;
        return answer ?? walletResult();
      } finally {
        deps.inFlight.now -= 1;
      }
    },
    async verify(tenantId, address) {
      deps.calls.verify.push({ tenantId, address });
      const answer = deps.verifies[address];
      if (answer instanceof Error) throw answer;
      return answer ?? NO_VERIFY_RECORD;
    },
  };
  return deps;
}
