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
// FAIL-CLOSED for public IPs: if a public client IP cannot be resolved to a
// country, or the lookup throws, the request is REFUSED (451) rather than let
// through — the conservative sanctions posture. Internal/private IPs (health
// checks, backend calls) are exempt so infra traffic is never blocked. geoip-lite
// resolves the vast majority of public IPv4/IPv6, so this rarely turns away a
// legitimate visitor; when it does, it is the deliberate compliance tradeoff.
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

// OFAC "Covered Regions" of Ukraine — ISO-3166-2 subdivision codes.
//   43 Crimea · 40 Sevastopol · 14 Donetsk · 09 Luhansk · 65 Kherson · 23 Zaporizhzhia
// (Original four confirmed against geoip-lite output, e.g. a Sevastopol IP → UA/"40";
//  Kherson/Zaporizhzhia added to match OFAC's late-2022 extension of the covered
//  regions. As with Donetsk/Luhansk, geoip can't distinguish occupied from
//  Ukrainian-controlled areas within an oblast, so the whole oblast is blocked.)
export const BLOCKED_UA_REGIONS = new Set<string>(['43', '40', '14', '09', '65', '23']);

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

/** Internal / private / loopback IPs — infra traffic (health checks, backend
 * calls), never a foreign visitor. Exempt from geo-blocking. */
function isPrivateIp(ip: string): boolean {
	return (
		ip === '127.0.0.1' || ip === '::1' ||
		ip.startsWith('10.') ||
		ip.startsWith('192.168.') ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||       // 172.16.0.0/12
		ip.startsWith('169.254.') ||                    // link-local
		/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || // 100.64.0.0/10 CGNAT
		/^f[cd]/i.test(ip) || ip.toLowerCase().startsWith('fe80') // IPv6 ULA / link-local
	);
}

/** The 451 block page. Exported so the middleware can fail closed if the geo
 * check itself errors (e.g. the module can't load). */
export function geoblockedResponse(): Response {
	return new Response(BLOCKED_PAGE, {
		status: 451,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	});
}

/**
 * Returns a 451 Response if the request's location is sanctioned OR cannot be
 * verified (fail-closed for public IPs), else null. Does not throw — internal
 * lookup errors resolve to a block.
 */
export async function getGeoblockResponse(request: Request): Promise<Response | null> {
	const ip = getClientIp(request);
	// No IP, or an internal/private IP → not a foreign visitor; allow.
	if (!ip || isPrivateIp(ip)) return null;

	let geo: ReturnType<typeof geoip.lookup>;
	try {
		geo = geoip.lookup(ip);
	} catch {
		return geoblockedResponse(); // FAIL-CLOSED: public IP we couldn't check
	}

	// FAIL-CLOSED: a public IP with no country data is treated as unverified.
	if (!geo || !geo.country) return geoblockedResponse();

	if (isBlockedLocation(geo.country, geo.region)) return geoblockedResponse();
	return null;
}
