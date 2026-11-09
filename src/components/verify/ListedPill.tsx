import type { VerifyDashboardLocale } from '../../i18n/dashboard/verify';
import { listedPillFor, type ListedPillInput } from './listedPillRule';

/**
 * "Listed by a platform" beside a merchant destination's status badge (guard PR B, spec 3e, 3h).
 * Presentation only: listedPillRule.ts decides, the locale says it, VerifyDashboard.css (.vd-pill) styles it.
 */
export function ListedPill({ d, t }: { d: ListedPillInput; t: VerifyDashboardLocale }) {
  const view = listedPillFor(d);
  if (!view) return null;
  return (
    <span className="vd-pill vd-pill--listed" title={t.listedTitle} data-since={view.since}>
      {t.listedPill}
    </span>
  );
}
