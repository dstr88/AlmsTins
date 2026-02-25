function firstCsvValue(value: string | null): string | null {
	if (!value) return null;
	const first = value.split(',')[0]?.trim();
	return first || null;
}

export function getClientIp(request: Request): string | null {
	return (
		firstCsvValue(request.headers.get('x-forwarded-for')) ??
		firstCsvValue(request.headers.get('cf-connecting-ip')) ??
		firstCsvValue(request.headers.get('x-real-ip')) ??
		firstCsvValue(request.headers.get('fly-client-ip')) ??
		firstCsvValue(request.headers.get('fastly-client-ip')) ??
		null
	);
}

