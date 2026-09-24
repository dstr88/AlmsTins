/**
 * What a PUBLIC Verify card (wallet-checker, /verify/scan) may say about a lookup hit.
 * Pure: no DB, no Node APIs, safe in the browser.
 *
 * Rules:
 *  - A freeform label is never shown. It is whatever the account typed ("Coinbase
 *    Support" goes through), so printing it as the publisher lets anyone impersonate a
 *    brand, and it can be a person's name.
 *  - A Claimed result shows no name and no domain at all. Its copy must hold for every
 *    row the lookup reports as Claimed: a self-send, a domain listing that went stale,
 *    or an older claim, so it says the address was claimed, not that control was proven.
 *  - A Verified result (anchored to a proven domain and re-confirmed within the freshness
 *    window) names a domain, plus a business name only when that name derives from the
 *    domain under the same DNS-arbitrated rule the registry uses to reserve a verified
 *    business name (nameMatchesDomain), is written in plain characters, and the domain is
 *    not on a shared host. Anything else is dropped and only the domain is shown.
 *  - "Listed on {domain}" is said only when `provingDomain` — the domain that actually
 *    vouches for THIS destination, never the account's business-name domain — is the one
 *    shown (C5/S7b). Otherwise (the shown `domain` is the account's business name, and it
 *    differs from what actually anchors this destination) the card says "verified via
 *    {domain}": true, but a step removed from a direct guarantee.
 *  - A green Verified never sits next to a flagged safety verdict: when the safety screen
 *    flags the value (including community reports), the warning leads and the Verify
 *    fact is shown in a neutral style. Verify warns and flags; it never blocks a payment.
 */
import { nameMatchesDomain } from './verifyNameMatch';

/** The fields of GET /api/verify/lookup a public card reads. */
export interface PublicVerifyLookup {
  level: 'verified' | 'claimed' | null;
  since: string | null;
  domain: string | null;
  /** The domain that actually vouches for this destination, or null — see check.ts /
   *  verifyEntities.ts VerifiedAddressHit for the full contract. Used only to decide
   *  "Listed on" vs "verified via"; the card still shows `domain` either way. */
  provingDomain?: string | null;
  label: string | null;
  /** 'entity' = the domain's own published list; 'merchant' = an account's proven destination. */
  source?: 'entity' | 'merchant' | null;
}

export interface PublicPublisher {
  /** A business name derived from `domain`, or null to show the domain only. */
  name: string | null;
  domain: string;
  /** True only when `domain` itself publishes the address ("Listed on"), else "verified via". */
  listed: boolean;
}

export type VerifyCardTone = 'positive' | 'caution' | 'neutral';

export interface PublicVerifyCard {
  level: 'verified' | 'claimed';
  /** 'positive' (green) only for a Verified result the safety screen did not flag. */
  tone: VerifyCardTone;
  /** Who listed the destination. Always null for Claimed. */
  publisher: PublicPublisher | null;
  since: string | null;
  /** The safety warning renders first and this card after it. */
  afterSafety: boolean;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A safety verdict that raised a flag: any confirmed hit (danger) or caution-grade flag. */
export function safetyFlagged(verdict: string | null | undefined): boolean {
  return verdict === 'danger' || verdict === 'caution';
}

/**
 * The verdict an address's Verify card is toned against. Community reports never feed the
 * scam score, but they are a warning the page shows, so any report makes a non-danger
 * verdict a caution: a green Verified must not sit above a red "N community reports".
 */
export function addressSafetyVerdict(
  scamLevel: string | null | undefined,
  communityReports?: number | null,
): string | null | undefined {
  if (scamLevel !== 'danger' && typeof communityReports === 'number' && communityReports > 0) return 'caution';
  return scamLevel;
}

// A shown name is plain text: Latin letters, digits, spaces and basic punctuation, up to
// 80 characters. This rejects emoji and check marks ("Acme ✅"), bidi and zero-width
// controls (a right-to-left override reorders the rest of the sentence), and non-Latin
// lookalikes ("Cоіոbаѕе"), none of which the alphanumeric domain match looks at.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 &'’.,-]{0,79}$/;

// Hosts where many unrelated sites share one registrable domain. On these the platform's
// own name derives from every site's domain ("GitHub" on x.github.io), so a name is never
// shown; the full host still is.
const SHARED_HOSTS = [
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'railway.app',
  'myshopify.com', 'wixsite.com', 'squarespace.com', 'wordpress.com', 'blogspot.com',
  'webflow.io', 'framer.website', 'notion.site', 'carrd.co', 'glitch.me', 'replit.app',
  'surge.sh', 'neocities.org', 'azurewebsites.net', 'azurestaticapps.net', 'appspot.com',
  'cloudfront.net', 'amazonaws.com', 'ngrok.io', 'ngrok-free.app',
];

/** Is `domain` a site on a shared host (or the shared host itself)? */
export function onSharedHost(domain: string): boolean {
  const host = domain.toLowerCase().replace(/\.$/, '');
  return SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
}

/** The business name a Verified card may show for `domain`, or null to show the domain only. */
export function displayableName(label: string | null | undefined, domain: string): string | null {
  const name = clean(label);
  if (!name || !SAFE_NAME.test(name)) return null;
  if (onSharedHost(domain)) return null;
  return nameMatchesDomain(name, domain) ? name : null;
}

/** The publisher a Verified card may show. Null for Claimed, and for a hit with no domain. */
export function publicPublisher(lookup: PublicVerifyLookup | null | undefined): PublicPublisher | null {
  if (!lookup || lookup.level !== 'verified') return null;
  const domain = clean(lookup.domain);
  if (!domain) return null;
  // "Listed on" when the shown domain is also the one that actually vouches for this
  // destination (an entity's own list always is; a merchant hit is only when its
  // business-name domain happens to be the one anchoring it, not a different domain of
  // the same account). Older lookup responses with no provingDomain field default to the
  // entity-only rule this replaces, so an out-of-date caller degrades safely to "verified
  // via", never wrongly upgrades to "Listed on".
  const listed = lookup.source === 'entity' || (!!lookup.provingDomain && clean(lookup.provingDomain) === domain);
  return { name: displayableName(lookup.label, domain), domain, listed };
}

/**
 * The card to render for a lookup hit, given the safety verdict for the same value
 * ('clean' | 'caution' | 'danger' | 'unclear' | …). Null when there is no Verify hit.
 */
export function publicVerifyCard(
  lookup: PublicVerifyLookup | null | undefined,
  safetyVerdict: string | null | undefined,
): PublicVerifyCard | null {
  if (!lookup || (lookup.level !== 'verified' && lookup.level !== 'claimed')) return null;
  const flagged = safetyFlagged(safetyVerdict);
  const since = clean(lookup.since);
  return {
    level: lookup.level,
    tone: flagged ? 'neutral' : lookup.level === 'verified' ? 'positive' : 'caution',
    publisher: publicPublisher(lookup),
    since: since || null,
    afterSafety: flagged,
  };
}

/** Fill a template's {name}/{domain}/{date} slots. Values are inserted literally. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}

/** The four publisher-line templates: listed on the domain, or verified via it; with or without a name. */
export interface PublisherTemplates {
  listedBy: string;
  listedOn: string;
  viaBy: string;
  viaOn: string;
}

/** The publisher line, e.g. "Listed on {domain}" or "{name}, verified via {domain}". */
export function publisherText(publisher: PublicPublisher | null, t: PublisherTemplates): string | null {
  if (!publisher) return null;
  const { name, domain, listed } = publisher;
  if (name) return fillTemplate(listed ? t.listedBy : t.viaBy, { name, domain });
  return fillTemplate(listed ? t.listedOn : t.viaOn, { domain });
}

/** Split "text with a [[term]] in it" into its parts, or null when there is no marker. */
export function splitTip(text: string): { before: string; term: string; after: string } | null {
  const m = text.match(/^([\s\S]*?)\[\[([\s\S]+?)\]\]([\s\S]*)$/);
  return m ? { before: m[1], term: m[2], after: m[3] } : null;
}
