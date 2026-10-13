// Dashboard (app) i18n foundation — Phase 0.
//
// Public marketing pages use route-based i18n (es.astro / fr.astro per page).
// The logged-in app instead uses a *language preference* read from a cookie,
// so a single set of routes serves all languages. Account-level persistence
// can layer on later; the cookie is the source of truth for now.

export const SUPPORTED_LANGS = ['en', 'es', 'fr'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

/** Cookie that stores the user's app language preference. */
export const LANG_COOKIE = 'almstins-lang';

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(v);
}

/** Resolve the active language from a raw Cookie header (or any cookie string). */
export function langFromCookieHeader(cookieHeader: string | null | undefined): Lang {
  if (!cookieHeader) return DEFAULT_LANG;
  const entry = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(LANG_COOKIE + '='));
  if (!entry) return DEFAULT_LANG;
  const val = decodeURIComponent(entry.slice(LANG_COOKIE.length + 1));
  return isLang(val) ? val : DEFAULT_LANG;
}

/** Resolve the active language from an incoming request. */
export function getLang(request: Request): Lang {
  return langFromCookieHeader(request.headers.get('cookie'));
}

/** Human-readable language names (for a language switcher). */
export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
};
