import type { VerifyDashboardLocale } from '../../i18n/dashboard/verify';
import { conflictCountLine, conflictWord, type EntityConflictView } from './conflictWords';

/**
 * Under a platform's entity card: how many of its pulled entries are conflicts, and which (guard
 * PR B, spec 3h). Presentation only: conflictWords.ts chooses the words, the locale holds them,
 * VerifyDashboard.css (.ve-conflicts) styles them. Renders nothing when the count is zero.
 */
export function ConflictList({ count, conflicts, t }: {
  count: number; conflicts: EntityConflictView[]; t: VerifyDashboardLocale;
}) {
  const line = conflictCountLine(count, t);
  if (!line) return null;
  return (
    <div className="ve-conflicts">
      <p className="ve-conflicts__line">{line}</p>
      {conflicts.length > 0 && (
        <details className="ve-conflicts__details">
          <summary className="ve-conflicts__summary">{t.entConflictsShow}</summary>
          <ul className="ve-conflicts__list">
            {conflicts.map((c) => (
              <li className="ve-conflicts__item" key={`${c.chain}:${c.address}`}>
                <span className="ve-conflicts__address" title={c.address}>{c.address}</span>
                <span className="ve-conflicts__word">{conflictWord(c.conflictWith, t)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
