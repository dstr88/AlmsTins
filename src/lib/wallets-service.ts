import { DEFAULT_ERC20_CHAINS } from './constants';

export type WalletRow = Record<string, any>;

export function sanitizeAddress(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const value = input.trim();
	const lower = value.toLowerCase();
	// EVM address: 0x + 40 hex chars
	if (/^0x[a-f0-9]{40}$/.test(lower)) return lower;
	// Sui address: 0x + 1–64 hex chars → canonicalize to 0x + 64 chars
	if (/^0x[a-f0-9]{1,64}$/.test(lower)) return '0x' + lower.slice(2).padStart(64, '0');
	// Bitcoin native SegWit bech32 (bc1q...) and Taproot bech32m (bc1p...)
	if (/^bc1[a-z0-9]{6,87}$/.test(lower)) return lower;
	// Bitcoin legacy P2PKH (1...) and P2SH (3...) — case-sensitive Base58, preserve original case
	if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) return value;
	// Litecoin native SegWit bech32 (ltc1q...) and Taproot bech32m (ltc1p...)
	if (/^ltc1[a-z0-9]{6,87}$/.test(lower)) return lower;
	// Solana — base58 public key, 32–44 chars from the base58 alphabet
	if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return value;
	return null;
}

export function sanitizeSuiAddress(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const value = input.trim().toLowerCase();
	if (!/^0x[a-f0-9]{1,64}$/.test(value)) return null;
	return '0x' + value.slice(2).padStart(64, '0');
}

export function normalizeChains(input: unknown): string[] {
	if (Array.isArray(input)) {
		const cleaned = input
			.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
			.filter(Boolean)
			.slice(0, 6);
		return cleaned.length ? cleaned : [...DEFAULT_ERC20_CHAINS];
	}

	if (typeof input === 'string') {
		const parsed = input
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
			.slice(0, 6);
		return parsed.length ? parsed : [...DEFAULT_ERC20_CHAINS];
	}

	return [...DEFAULT_ERC20_CHAINS];
}

export function transformWalletRow(row: WalletRow) {
	return {
		id: row.id,
		address: row.address,
		label: row.label,
		isDefault: Boolean(row.is_default),
		createdAt: row.created_at,
		chains: safeParseChains(row.chains),
		walletType: (row.wallet_type ?? 'onchain') as 'onchain' | 'custom',
	};
}

export function safeParseChains(value: unknown) {
	if (typeof value !== 'string') return [...DEFAULT_ERC20_CHAINS];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [...DEFAULT_ERC20_CHAINS];
		return parsed.length ? parsed : [...DEFAULT_ERC20_CHAINS];
	} catch {
		return [...DEFAULT_ERC20_CHAINS];
	}
}
