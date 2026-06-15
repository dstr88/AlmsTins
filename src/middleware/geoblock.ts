// Sanctions geo-blocking — local lookup via geoip-lite (bundled MaxMind data).
//
// Returns a 451 (Unavailable For Legal Reasons) response when a request comes
// from a comprehensively-sanctioned jurisdiction, otherwise null.
//
// Detection is a fully LOCAL lookup — no external API, no token, no DB — so the
// block can't be silently disabled by a missing key. geoip-lite returns both
// country AND region, which lets us block the sanctioned *regions* of Ukraine
// (Crimea / Sevastopol / Donetsk / Luhansk) without blocking the whole country.
//
// FAIL-OPEN BY DESIGN: any error (lookup throws, unknown/empty country) lets the
// request through — a geo failure must never take the site or login offline.
// (Confirm fail-open vs. fail-closed with counsel.)
//
// BEST-EFFORT for the UA regions: many occupied-region IPs route through Russian
// networks and geolocate to RU, so this catches only the subset that still
// resolves to UA. The ToS region attestation is the dependable control; this is
// a supplement on top of it.

import geoip from 'geoip-lite';
import { getClientIp } from '../lib/analytics/ip';

// OFAC comprehensively-sanctioned countries — ISO-3166-1 alpha-2.
//   CU Cuba · IR Iran · KP North Korea · SY Syria
export const BLOCKED_COUNTRIES = new Set<string>(['CU', 'IR', 'KP', 'SY']);

// Sanctioned regions within Ukraine (UA) — ISO-3166-2 subdivision codes.
//   43 Crimea · 40 Sevastopol · 14 Donetsk · 09 Luhansk
// (Codes confirmed against geoip-lite output, e.g. a Sevastopol IP → UA/"40".)
export const BLOCKED_UA_REGIONS = new Set<string>(['43', '40', '14', '09']);

export function isBlockedLocation(country: string, region: string): boolean {
	if (BLOCKED_COUNTRIES.has(country)) return true;
	if (country === 'UA' && BLOCKED_UA_REGIONS.has(region)) return true;
	return false;
}

const BLOCKED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Not available in your region</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0f1a;color:#f5f8ff;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:24px}
  main{max-width:480px;text-align:center}
  h1{font-size:1.4rem;margin:0 0 12px}
  p{color:rgba(245,248,255,0.7);line-height:1.6;margin:0 0 10px}
  .muted{font-size:0.85rem;color:rgba(245,248,255,0.45)}
</style></head>
<body><main>
  <h1>Almstins isn't available in your region</h1>
  <p>For legal and compliance reasons, Almstins cannot be offered in your location. We're sorry for the inconvenience.</p>
  <p class="muted">If you believe this is an error, contact support@titaniumhut.com.</p>
</main></body></html>`;

/**
 * Returns a 451 Response if the request's location is sanctioned, else null.
 * May throw; callers MUST wrap in try/catch and fail open.
 */
export async function getGeoblockResponse(request: Request): Promise<Response | null> {
	const ip = getClientIp(request);
	if (!ip) return null;

	const geo = geoip.lookup(ip);
	if (!geo || !geo.country) return null;

	if (!isBlockedLocation(geo.country, geo.region)) return null;

	return new Response(BLOCKED_PAGE, {
		status: 451,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	});
}
