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
};

export function normalizeNetWorthSummary(payload: any): NetWorthSummary {
	const s = payload?.summary ?? {};

	const totalAssetsUsd = Number(s.totalAssetsUsd ?? s.assetsUsd ?? 0);
	const totalFreeAssetsUsd = Number(s.totalFreeAssetsUsd ?? s.freeAssetsUsd ?? totalAssetsUsd ?? 0);
	const totalDebtUsd = Number(s.totalDebtUsd ?? s.debtUsd ?? 0);
	const totalUsd = Number(s.totalUsd ?? (totalAssetsUsd - totalDebtUsd) ?? 0);

	const byWallet = Array.isArray(s.byWallet)
		? s.byWallet.map((w: any) => ({
				walletId: String(w.walletId ?? ''),
				walletLabel: w.walletLabel != null ? String(w.walletLabel) : null,
				walletAddress: w.walletAddress != null ? String(w.walletAddress) : null,
				assetsUsd: w.assetsUsd != null ? Number(w.assetsUsd) : undefined,
				freeAssetsUsd: w.freeAssetsUsd != null ? Number(w.freeAssetsUsd) : undefined,
				debtUsd: w.debtUsd != null ? Number(w.debtUsd) : undefined,
				totalUsd: Number(w.totalUsd ?? 0),
			}))
		: [];

	const rawChains = Array.isArray(s.byChain) ? s.byChain : [];
	const chainMap = new Map<string, any>();
	for (const c of rawChains) {
		const key = String(c.chain ?? '').toLowerCase();
		if (!key) continue;
		const existing = chainMap.get(key);
		const existingTime = existing?.capturedAt ? Date.parse(existing.capturedAt) : -1;
		const nextTime = c?.capturedAt ? Date.parse(c.capturedAt) : -1;
		if (!existing || nextTime >= existingTime) chainMap.set(key, c);
	}
	const byChain = Array.from(chainMap.values()).map((c: any) => ({
		chain: String(c.chain ?? ''),
		totalUsd: Number(c.totalUsd ?? 0),
		assetsUsd: Number(c.assetsUsd ?? 0),
		freeAssetsUsd: Number(c.freeAssetsUsd ?? 0),
		debtUsd: Number(c.debtUsd ?? 0),
		capturedAt: c.capturedAt != null ? String(c.capturedAt) : null,
	}));

	const tins = Array.isArray(s.tins)
		? s.tins.map((t: any) => ({
				tinId: String(t.tinId ?? ''),
				tinName: String(t.tinName ?? ''),
				assetsUsd: Number(t.assetsUsd ?? 0),
				freeAssetsUsd: Number(t.freeAssetsUsd ?? 0),
				debtUsd: Number(t.debtUsd ?? 0),
				netUsd: Number(t.netUsd ?? (Number(t.assetsUsd ?? 0) - Number(t.debtUsd ?? 0))),
				aaveIncluded: typeof t.aaveIncluded === 'boolean' ? t.aaveIncluded : undefined,
			}))
		: [];

	return {
		totalUsd,
		totalAssetsUsd,
		totalFreeAssetsUsd,
		totalDebtUsd,
		byWallet,
		byChain,
		tins,
	};
}
