export type NetWorthSummary = {
  totalUsd: number;

  totalAssetsUsd: number;
  totalFreeAssetsUsd: number;
  totalDebtUsd: number;

  byWallet: Array<{
    walletId: string;
    walletLabel: string | null;
    walletAddress?: string | null;
    assetsUsd?: number;
    freeAssetsUsd?: number;
    debtUsd?: number;
    totalUsd: number;
  }>;

  byChain: Array<{
    chain: string;
    totalUsd: number;
    assetsUsd: number;
    freeAssetsUsd: number;
    debtUsd: number;
    capturedAt?: string | null;
  }>;

  tins: Array<{
    tinId: string;
    tinName: string;
    assetsUsd: number;
    freeAssetsUsd: number;
    debtUsd: number;
    netUsd: number;
    aaveIncluded?: boolean;
  }>;

  /** Total count of all tins: on-chain wallets + exchange accounts + custom wallets */
  tinCount?: number;
};

// --- helpers: do NOT coerce null/"" -> 0, and never return NaN ---
const toFiniteNumberOrUndef = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined; // "" should not become 0
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }

  return undefined;
};

const toFiniteNumberOrZero = (value: unknown): number => {
  const n = toFiniteNumberOrUndef(value);
  return n ?? 0;
};

const toStringOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
};

const toNonEmptyString = (value: unknown): string => {
  const s = String(value ?? '').trim();
  return s;
};

export function normalizeNetWorthSummary(payload: any): NetWorthSummary {
  // Support both shapes:
  // 1) { summary: {...} }
  // 2) { totalUsd, byWallet, ... }  (already normalized upstream)
  const s = payload?.summary ?? payload ?? {};

  // Pull raw numeric candidates WITHOUT inventing zeros
  const rawAssets = toFiniteNumberOrUndef(s.totalAssetsUsd ?? s.assetsUsd);
  const rawFreeAssets = toFiniteNumberOrUndef(s.totalFreeAssetsUsd ?? s.freeAssetsUsd);
  const rawDebt = toFiniteNumberOrUndef(s.totalDebtUsd ?? s.debtUsd);
  const rawTotal = toFiniteNumberOrUndef(s.totalUsd);

  // Compute totals with sane fallbacks:
  // - If a field is missing/invalid, treat as 0 for display totals only.
  // - But do not let "missing" masquerade as a meaningful 0 inside sub-objects.
  const totalAssetsUsd = rawAssets ?? 0;
  const totalDebtUsd = rawDebt ?? 0;

  // If freeAssets missing, prefer assets; otherwise use parsed value.
  const totalFreeAssetsUsd =
    rawFreeAssets ?? rawAssets ?? 0;

  // If total missing, compute assets - debt (both already display-safe).
  const totalUsd =
    rawTotal ?? (totalAssetsUsd - totalDebtUsd);

  const byWallet = Array.isArray(s.byWallet)
    ? s.byWallet
        .map((w: any) => {
          const walletId = toNonEmptyString(w.walletId);
          // If walletId is missing, skip loudly-ish (you can throw in dev if you prefer)
          if (!walletId) return null;

          const assetsUsd = toFiniteNumberOrUndef(w.assetsUsd);
          const freeAssetsUsd = toFiniteNumberOrUndef(w.freeAssetsUsd);
          const debtUsd = toFiniteNumberOrUndef(w.debtUsd);

          const wTotal =
            toFiniteNumberOrUndef(w.totalUsd) ??
            ((assetsUsd ?? 0) - (debtUsd ?? 0));

          return {
            walletId,
            walletLabel: toStringOrNull(w.walletLabel),
            walletAddress: toStringOrNull(w.walletAddress),
            assetsUsd,
            freeAssetsUsd,
            debtUsd,
            totalUsd: wTotal,
          };
        })
        .filter((x: any): x is NonNullable<typeof x> => Boolean(x))
    : [];

  // Keep newest capturedAt per chain, but parse dates safely
  const rawChains = Array.isArray(s.byChain) ? s.byChain : [];
  const chainMap = new Map<string, any>();
  for (const c of rawChains) {
    const chain = toNonEmptyString(c?.chain).toLowerCase();
    if (!chain) continue;

    const nextCapturedAt = toStringOrNull(c?.capturedAt);
    const nextTime = nextCapturedAt ? Date.parse(nextCapturedAt) : -1;

    const existing = chainMap.get(chain);
    const existingCapturedAt = toStringOrNull(existing?.capturedAt);
    const existingTime = existingCapturedAt ? Date.parse(existingCapturedAt) : -1;

    if (!existing || nextTime >= existingTime) chainMap.set(chain, c);
  }

  const byChain = Array.from(chainMap.values()).map((c: any) => ({
    chain: toNonEmptyString(c.chain),
    totalUsd: toFiniteNumberOrZero(c.totalUsd),
    assetsUsd: toFiniteNumberOrZero(c.assetsUsd),
    freeAssetsUsd: toFiniteNumberOrZero(c.freeAssetsUsd),
    debtUsd: toFiniteNumberOrZero(c.debtUsd),
    capturedAt: toStringOrNull(c.capturedAt),
  }));

  const tins = Array.isArray(s.tins)
    ? s.tins.map((t: any) => {
        const assets = toFiniteNumberOrZero(t.assetsUsd);
        const debt = toFiniteNumberOrZero(t.debtUsd);
        const net =
          toFiniteNumberOrUndef(t.netUsd) ??
          (assets - debt);

        return {
          tinId: toNonEmptyString(t.tinId),
          tinName: toNonEmptyString(t.tinName),
          assetsUsd: assets,
          freeAssetsUsd: toFiniteNumberOrZero(t.freeAssetsUsd),
          debtUsd: debt,
          netUsd: net,
          aaveIncluded: typeof t.aaveIncluded === 'boolean' ? t.aaveIncluded : undefined,
        };
      })
    : [];

  const tinCount =
    typeof s.tinCount === 'number' && Number.isFinite(s.tinCount) ? s.tinCount : undefined;

  return {
    totalUsd,
    totalAssetsUsd,
    totalFreeAssetsUsd,
    totalDebtUsd,
    byWallet,
    byChain,
    tins,
    tinCount,
  };
}
