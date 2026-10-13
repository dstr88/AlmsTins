// Email-domain blocklist, checked at account signup (credentials + OAuth).
//
// SANCTIONS CAVEAT: an email domain is a WEAK location signal — most users in
// sanctioned countries use global providers (gmail / outlook / proton), so this
// catches few and is NOT a substitute for the IP geo-block
// (src/middleware/geoblock.ts). Treat it as a light supplementary screen.
//
// Extend BLOCKED_DOMAINS with specific domains (e.g., known disposable / abuse
// providers) as needed.

// Sanctioned-country ccTLDs — suffix match (e.g. "x.ir"). Supplementary only.
const BLOCKED_TLDS = ['.ir', '.cu', '.kp', '.sy'];

// Exact domains to block (lowercased). Add disposable / abuse domains here.
const BLOCKED_DOMAINS = new Set<string>([
	// 'mailinator.com',
	// 'tempmail.com',
]);

/** Extracts the lowercased domain from an email address, or null. */
export function emailDomain(email: string): string | null {
	const at = email.lastIndexOf('@');
	if (at < 0) return null;
	const domain = email.slice(at + 1).toLowerCase().trim();
	return domain || null;
}

/** True if the email's domain is on the blocklist (exact match or sanctioned ccTLD). */
export function isEmailDomainBlocked(email: string): boolean {
	const domain = emailDomain(email);
	if (!domain) return false;
	if (BLOCKED_DOMAINS.has(domain)) return true;
	return BLOCKED_TLDS.some((tld) => domain.endsWith(tld));
}
