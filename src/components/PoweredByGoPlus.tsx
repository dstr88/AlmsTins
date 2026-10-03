import { GOPLUS_URL } from '@/lib/goplusCredit';
import './PoweredByGoPlus.css';

/**
 * The GoPlus Security credit line: muted, small, and a backlink to GoPlus. Required by the
 * GoPlus API License Agreement wherever results from its API are shown (see
 * src/lib/goplusCredit.ts for the rule, where it is used, and why there is no logo yet).
 *
 * One element for every surface, so the wording, link and styling cannot drift. It renders to
 * plain markup, so an .astro page can include it server-side (visible without JS) and a React
 * island can include it too. `label` comes from the surface's i18n copy: the same English
 * phrase in every language, on purpose (it is a brand credit that mirrors the license).
 * lang="en" tells screen readers the phrase is English on the es/fr pages.
 */
export default function PoweredByGoPlus({ label }: { label: string }) {
  return (
    <p className="powered-by-goplus">
      <a href={GOPLUS_URL} target="_blank" rel="noopener noreferrer" lang="en">{label}</a>
    </p>
  );
}
