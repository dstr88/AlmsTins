function firstCsvValue(value: string | null): string | null {
	if (!value) return null;
	const first = value.split(',')[0]?.trim();
	return first || null;
}

export function getClientIp(request: Request): string | null {
	// CF-Connecting-IP FIRST: almstins.com is behind Cloudflare, which sets this
	// to the real connecting client and strips any client-supplied value, so it
	// can't be spoofed. X-Forwarded-For's leftmost entry IS client-controlled, so
	// it must not take precedence — trusting it let anyone forge their IP and
	// thereby bypass rate limiting and geoblocking. XFF/real-ip/CDN headers remain
	// as fallbacks only for requests that don't arrive through Cloudflare.
	return (
		firstCsvValue(request.headers.get('cf-connecting-ip')) ??
		firstCsvValue(request.headers.get('x-real-ip')) ??
		firstCsvValue(request.headers.get('fly-client-ip')) ??
		firstCsvValue(request.headers.get('fastly-client-ip')) ??
		firstCsvValue(request.headers.get('x-forwarded-for')) ??
		null
	);
}

