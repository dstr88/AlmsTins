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

export function isDetailedAnalyticsRoute(routeKey: string): boolean {
	return routeKey === '/wallet/:address' || routeKey === '/dashboard/*' || routeKey === '/login';
}

export function extractWalletAddress(pathname: string): string | null {
	if (!pathname.startsWith('/wallet/')) return null;
	const segment = pathname.slice('/wallet/'.length).split('/')[0]?.trim();
	return segment || null;
}
