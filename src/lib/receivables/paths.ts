/**
 * Canonical /receivables paths for the financing pages. Import-free and client-safe.
 * Never lists the private milestone desk.
 *
 * Today these are aliases (src/middleware/legacyRedirects.ts rewrites them to the /verify/
 * pages); links built with these helpers keep working through every later phase.
 */
export const RECEIVABLES_PAGES = [
  'registry', 'desk', 'client', 'confirm', 'invite', 'offer', 'countersign',
  'attest', 'authenticate', 'runsheet', 'guide', 'changelog', 'thanks', 'login', 'faq',
] as const;
export type ReceivablesPage = (typeof RECEIVABLES_PAGES)[number];

export const receivablesPath = (p: ReceivablesPage, search = '') => `/receivables/${p}${search}`;

/** The financing sign-in, returning to `next` (a /receivables path) after sign-in. */
export const receivablesLogin = (next = '/receivables') =>
  `/receivables/login?next=${encodeURIComponent(next)}`;
