/**
 * The two public legal pages. Each renders the same source as its footer pop-up, so there is
 * one User Agreement (src/i18n/termsOfService.ts) and one Privacy Policy (src/i18n/privacyPolicy.ts).
 * Both are public through isPublicPath in src/middleware/auth.ts.
 */
export const TERMS_HREF = '/terms';
export const PRIVACY_HREF = '/privacy';
