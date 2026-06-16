// Client-side language resolver for React islands.
//
// Most dashboard React components are `client:only`, so they render only in the
// browser and can't use the server-side getLang(request). This reads the same
// `almstins-lang` cookie on the client. Usage inside a component:
//
//   import { getClientLang } from '@/lib/i18n/clientLang';
//   import { getThing } from '@/i18n/components/thing';
//   const t = getThing(getClientLang());
//
// (For SSR-rendered islands — client:load/visible — the server render falls back
// to DEFAULT_LANG and the client re-renders with the cookie value; for client:only
// there is no SSR pass, so no flash.)

import { type Lang, DEFAULT_LANG, LANG_COOKIE, isLang } from './locale';

export function getClientLang(): Lang {
  if (typeof document === 'undefined') return DEFAULT_LANG;
  const entry = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(LANG_COOKIE + '='));
  if (!entry) return DEFAULT_LANG;
  const val = decodeURIComponent(entry.slice(LANG_COOKIE.length + 1));
  return isLang(val) ? val : DEFAULT_LANG;
}
