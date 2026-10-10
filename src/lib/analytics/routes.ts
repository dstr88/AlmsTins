export function normalizeRouteKey(pathname: string): string {
	if (pathname.startsWith('/_astro/')) return '/_astro/*';
	if (pathname.startsWith('/assets/')) return '/assets/*';
	if (pathname === '/favicon.ico') return '/favicon.ico';
	if (pathname === '/wallet') return '/wallet';
	if (pathname.startsWith('/wallet/')) return '/wallet/:address';
	if (pathname.startsWith('/dashboard/')) return '/dashboard/*';
	if (pathname === '/login') return '/login';
	if (pathname.startsWith('/api/')) return '/api/*';
	return pathname;
}

// '/wallet/:address' is not logged: its path is a wallet address, and the request log
// keeps only hashes of who asked (privacy policy v1.2, section 3.2).
export function isDetailedAnalyticsRoute(routeKey: string): boolean {
	return routeKey === '/dashboard/*' || routeKey === '/login';
}

export function extractWalletAddress(pathname: string): string | null {
	if (!pathname.startsWith('/wallet/')) return null;
	const segment = pathname.slice('/wallet/'.length).split('/')[0]?.trim();
	return segment || null;
}
