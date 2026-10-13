import { GOPLUS_URL } from '@/lib/goplusCredit';
import goplusLogo from '../assets/goplus-horizontal-logo-all-white.svg?url';
import './PoweredByGoPlus.css';

/**
 * The GoPlus Security credit: the GoPlus logo and the text "Powered by GoPlus Security" in one
 * backlink to GoPlus. Required by the GoPlus API License Agreement wherever results from its API
 * are shown (see src/lib/goplusCredit.ts for the rule, where it is used, and where the logo comes
 * from).
 *
 * One element for every surface, so the wording, logo, link and styling cannot drift. It renders
 * to plain markup, so an .astro page can include it server-side (visible without JS) and a React
 * island can include it too. `label` comes from the surface's i18n copy: the same English
 * phrase in every language, on purpose (it is a brand credit that mirrors the license).
 * lang="en" tells screen readers the phrase is English on the es/fr pages.
 *
 * The logo is decorative (alt=""): the visible text already names GoPlus, so the link's accessible
 * name is that text and a screen reader does not say it twice. The kit file is 446 x 90, so 99 x 20
 * is the same shape at the CSS height of 1.25rem (the explicit size just stops layout shift).
 */
export default function PoweredByGoPlus({ label }: { label: string }) {
  return (
    <p className="powered-by-goplus">
      <a href={GOPLUS_URL} target="_blank" rel="noopener noreferrer" lang="en">
        <img className="powered-by-goplus__logo" src={goplusLogo} alt="" width={99} height={20} decoding="async" />
        {label}
      </a>
    </p>
  );
}
