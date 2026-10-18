/**
 * The campaign label on an Agentics link (/agentics?src=linkedin), kept with the signup so it is
 * possible to tell which post or message brought someone in. Pure, so the landing page can use it
 * without importing the database.
 */

export const DEFAULT_SOURCE = 'direct';

/** A campaign label from a link (?src=...): lowercase letters, digits, hyphen and underscore, 1 to 24 characters. Anything else is `direct`. */
export function cleanSource(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[a-z0-9_-]{1,24}$/.test(s) ? s : DEFAULT_SOURCE;
}

/** The path a new account lands on after signing in, carrying the campaign label when there is one. */
export function welcomePath(source: string): string {
  return source !== DEFAULT_SOURCE ? `/dashboard/agentics?src=${source}` : '/dashboard/agentics';
}

/** The Agentics sign-in link that returns to the welcome page. */
export function signupHref(source: string): string {
  return `/agentics/login?next=${encodeURIComponent(welcomePath(source))}`;
}
