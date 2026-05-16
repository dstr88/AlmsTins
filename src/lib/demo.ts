/**
 * demo.ts — Demo mode constants and helpers
 *
 * A visitor who clicks "Try Demo" gets a signed cookie (almstins-demo=1)
 * that makes the entire dashboard render with the pre-seeded demo tenant.
 * No auth session required.  All write operations are blocked at middleware.
 */

export const DEMO_TENANT_ID = 'demo-00000000000000000000000000000001';
export const DEMO_COOKIE_NAME = 'almstins-demo';
export const DEMO_COOKIE_VALUE = '1';

/** Returns true when the request carries the demo session cookie. */
export function isDemoRequest(request: Request): boolean {
	const cookie = request.headers.get('cookie') ?? '';
	return cookie.split(';').some(
		(c) => c.trim() === `${DEMO_COOKIE_NAME}=${DEMO_COOKIE_VALUE}`,
	);
}

/** Set-Cookie header value that starts a demo session (7 days). */
export function demoCookieSet(): string {
	return `${DEMO_COOKIE_NAME}=${DEMO_COOKIE_VALUE}; Path=/; SameSite=Lax; Max-Age=604800`;
}

/** Set-Cookie header value that clears the demo session. */
export function demoCookieClear(): string {
	return `${DEMO_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}

// ── Demo wallet addresses ─────────────────────────────────────────────────────

type TokenEntry = {
	symbol: string;
	amount: number;
	priceUsd: number;
	valueUsd: number;
	tokenAddress: null;
};

export interface DemoWalletConfig {
	label:  string;
	chain:  string;
	chains: string[];
	tokens: TokenEntry[];
}

export const DEMO_WALLET_CONFIGS: Record<string, DemoWalletConfig> = {
	'1': {
		label:  'Ethereum Wallet',
		chain:  'ethereum',
		chains: ['ethereum', 'polygon', 'avalanche'],
		tokens: [
			{ symbol: 'ETH',  amount: 0.02, priceUsd: 3100, valueUsd: 62, tokenAddress: null },
			{ symbol: 'USDC', amount: 20,   priceUsd: 1,    valueUsd: 20, tokenAddress: null },
		],
	},
	'2': {
		label:  'Solana Wallet',
		chain:  'solana',
		chains: ['solana'],
		tokens: [
			{ symbol: 'SOL',  amount: 0.4,    priceUsd: 145,     valueUsd: 58, tokenAddress: null },
			{ symbol: 'BONK', amount: 500000, priceUsd: 0.00003, valueUsd: 15, tokenAddress: null },
		],
	},
	'3': {
		label:  'DeFi Wallet',
		chain:  'avalanche',
		chains: ['ethereum', 'polygon', 'avalanche'],
		tokens: [
			{ symbol: 'WETH', amount: 0.015, priceUsd: 3100, valueUsd: 46.50, tokenAddress: null },
			{ symbol: 'AVAX', amount: 1.5,   priceUsd: 25,   valueUsd: 37.50, tokenAddress: null },
		],
	},
};

export function isDemoWalletAddress(address: string): boolean {
	return Object.prototype.hasOwnProperty.call(DEMO_WALLET_CONFIGS, address);
}
