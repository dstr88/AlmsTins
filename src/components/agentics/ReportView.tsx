/**
 * One operator report, as a page: the four buckets, the bought and sold strip, each listed address,
 * the versions of the day, and the signature with its downloads. Static: it has no state, and it
 * renders the same on the server as anywhere else, so it needs no script.
 *
 * The report's own text (the agent's name, a registry label, an address) is the owner's and the
 * chain's, and is untrusted. It is rendered as text by React, which escapes it; nothing here builds
 * HTML from data, and tests/agentics/agenticsUi.test.ts renders hostile text to prove it.
 */
import type { ReportAddress, ListedBucketName } from '@/lib/agentVault/report';
import { LISTED_BUCKETS } from '@/lib/agentVault/report';
import type { ReportDetail } from '@/lib/agentVault/reports';
import { formatClock, formatCount, formatDayLong, formatUsd, formatUtc, plural } from '@/lib/agentVault/reportFormat';
import { BUCKET_MEANING, BUCKET_TITLE, VERIFY_STATUS_TITLE, reasonText } from '@/lib/agentVault/reportText';
import { copy } from './copy';
import { bundleHref, pdfHref, reportHref, REPORTS_PATH, VERIFY_RECORD_PATH } from './paths';

const TILE_CLASS: Record<ListedBucketName | 'no_issues', string> = {
  issues: 'ag-tile--issues',
  not_confirmed: 'ag-tile--confirm',
  new: 'ag-tile--new',
  no_issues: 'ag-tile--clear',
};
const DOT_CLASS: Record<ListedBucketName | 'no_issues', string> = {
  issues: 'ag-dot--issues',
  not_confirmed: 'ag-dot--confirm',
  new: 'ag-dot--new',
  no_issues: 'ag-dot--clear',
};

function AddressTable({ rows }: { rows: ReportAddress[] }) {
  return (
    <div className="ag-tablewrap">
      <table className="ag-table">
        <thead>
          <tr>
            <th>{copy.view.columns.first}</th>
            <th>{copy.view.columns.address}</th>
            <th>{copy.view.columns.label}</th>
            <th>{copy.view.columns.what}</th>
            <th className="ag-num">{copy.view.columns.checks}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.address}>
              <td>{formatClock(a.firstAt)}</td>
              <td>
                <span className="ag-mono">{a.address}</span>
              </td>
              <td>{a.label ?? ''}</td>
              <td>{a.reasons.map(reasonText).join(' ')}</td>
              <td className="ag-num">{a.checksInPeriod > a.checks ? copy.view.checksOf(a.checks, a.checksInPeriod) : a.checks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportView({ report, signing }: { report: ReportDetail; signing: { available: boolean } }) {
  const c = report.content;
  const attention = c.buckets.issues.addresses + c.buckets.not_confirmed.addresses;
  const tiles: Array<{ key: ListedBucketName | 'no_issues'; n: number; checks: number }> = [
    { key: 'issues', n: c.buckets.issues.addresses, checks: c.buckets.issues.checks },
    { key: 'not_confirmed', n: c.buckets.not_confirmed.addresses, checks: c.buckets.not_confirmed.checks },
    { key: 'new', n: c.buckets.new.addresses, checks: c.buckets.new.checks },
    { key: 'no_issues', n: c.buckets.no_issues.addresses, checks: c.buckets.no_issues.checks },
  ];
  const verified = report.verification === 'verified';

  return (
    <div className="ag-page">
      <a className="ag-back" href={REPORTS_PATH}>
        {copy.view.back}
      </a>
      <header className="ag-hero">
        <p className="ag-kicker">{copy.view.kicker}</p>
        <h1 className="ag-title">{copy.view.title}</h1>
        <p className="ag-sub">
          {formatDayLong(report.day)} (UTC day)  ·  {c.tin.label}
        </p>
        <p className="ag-hint">
          <span className="ag-pill">{copy.pills.version(report.version)}</span>{' '}
          {report.partial ? <span className="ag-pill ag-pill--warn">{copy.pills.partial}</span> : null}{' '}
          {report.signed ? <span className="ag-pill ag-pill--gain">{copy.pills.signed}</span> : <span className="ag-pill ag-pill--muted">{copy.pills.unsigned}</span>}{' '}
          {copy.verification.generated} {formatUtc(report.generatedAt)}
        </p>
      </header>

      {report.partial ? <p className="ag-notice ag-notice--warn">{copy.view.partialNote(formatUtc(report.generatedAt))}</p> : null}
      <p className="ag-note">{copy.view.snapshotNote}</p>

      <div className="ag-tiles">
        {tiles.map((t) => (
          <div key={t.key} className={`ag-tile ${TILE_CLASS[t.key]}`}>
            <div className="ag-tile__n">{formatCount(t.n)}</div>
            <div className="ag-tile__label">{BUCKET_TITLE[t.key]}</div>
            <div className="ag-tile__sub">
              {plural(t.n, 'address', 'addresses')}  ·  {plural(t.checks, 'check', 'checks')}
            </div>
          </div>
        ))}
      </div>
      <p className="ag-note">{copy.view.listedNote}</p>

      <div className="ag-strip">
        {(
          [
            { label: copy.strip.bought, side: c.strip.bought },
            { label: copy.strip.sold, side: c.strip.sold },
          ] as const
        ).map(({ label, side }) => (
          <div key={label} className="ag-strip__side">
            <div className="ag-strip__label">{label}</div>
            <div className="ag-strip__value">{formatUsd(side.usd)}</div>
            <div className="ag-strip__sub">
              {side.count === 0
                ? copy.strip.none
                : `${plural(side.count, 'transfer', 'transfers')}${side.unpricedCount ? `, ${copy.strip.withoutValue(side.unpricedCount)}` : ''}`}
            </div>
          </div>
        ))}
      </div>
      <p className="ag-note">{copy.strip.note}</p>
      {c.strip.transfers > 0 ? (
        <p className="ag-note">
          {copy.strip.statuses}:{' '}
          {(['proven', 'consistent-with-history', 'flagged', 'unknown'] as const).map((k) => `${VERIFY_STATUS_TITLE[k].toLowerCase()} ${formatCount(c.strip.byStatus[k])}`).join('  ·  ')}
          {c.strip.noPrecedingCheck ? ` (${copy.strip.noCheckBefore(c.strip.noPrecedingCheck)})` : ''}.
        </p>
      ) : null}

      {LISTED_BUCKETS.map((b) =>
        c.buckets[b].listed.length === 0 ? null : (
          <section key={b} className="ag-group" aria-label={BUCKET_TITLE[b]}>
            <div className="ag-group__head">
              <span className={`ag-dot ${DOT_CLASS[b]}`} aria-hidden="true" />
              <h2 className="ag-group__title">
                {BUCKET_TITLE[b]}  ·  {formatCount(c.buckets[b].addresses)}
              </h2>
            </div>
            <p className="ag-group__meaning">{BUCKET_MEANING[b]}</p>
            <AddressTable rows={c.buckets[b].listed} />
            {c.buckets[b].omitted > 0 ? <p className="ag-note">{copy.view.omitted(c.buckets[b].omitted)}</p> : null}
          </section>
        ),
      )}

      <div className="ag-clear">
        <p className="ag-clear__lead">{attention === 0 ? copy.view.nothingNeeds : `${plural(attention, 'address calls', 'addresses call')} for a look.`}</p>
        <p className="ag-clear__text">
          {c.buckets.no_issues.checks === 0
            ? copy.view.noIssuesNone
            : copy.view.noIssuesLine(plural(c.buckets.no_issues.checks, 'check', 'checks'), plural(c.buckets.no_issues.addresses, 'address', 'addresses'))}{' '}
          {copy.view.clearNote}
        </p>
      </div>

      <section className="ag-card ag-card--spaced" aria-label={copy.view.versionsTitle}>
        <div className="ag-card__head">
          <h2 className="ag-card__title">{copy.view.versionsTitle}</h2>
          <span className="ag-card__meta">{copy.view.versionsNote}</span>
        </div>
        <ul className="ag-versions">
          {report.versions.map((v) => (
            <li key={v.id}>
              {v.id === report.id ? (
                <span className="ag-pill ag-pill--gain">{copy.view.current}</span>
              ) : null}
              <a className="ag-link" href={reportHref(v.id)}>
                {copy.pills.version(v.version)}
              </a>
              <span>{formatUtc(v.generatedAt)}</span>
              {v.partial ? <span className="ag-pill ag-pill--warn">{copy.pills.partial}</span> : null}
              {v.signed ? <span className="ag-pill ag-pill--gain">{copy.pills.signed}</span> : <span className="ag-pill ag-pill--muted">{copy.pills.unsigned}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="ag-card" aria-label={copy.verification.title}>
        <div className="ag-card__head">
          <h2 className="ag-card__title">{copy.verification.title}</h2>
        </div>
        <p className={`ag-notice${verified ? '' : report.verification === 'altered' ? ' ag-notice--bad' : ' ag-notice--warn'}`}>{copy.verification[report.verification]}</p>
        {!signing.available && report.verification !== 'verified' ? <p className="ag-note">{copy.reports.signingOff}</p> : null}
        <dl className="ag-dl">
          <dt>{copy.verification.recordId}</dt>
          <dd className="ag-mono">{report.id}</dd>
          <dt>{copy.verification.merkleRoot}</dt>
          <dd className="ag-mono">{report.merkleRoot ?? ''}</dd>
          <dt>{copy.verification.signedBy}</dt>
          <dd className="ag-mono">{report.keyId ?? ''}</dd>
          <dt>{copy.verification.generated}</dt>
          <dd>{formatUtc(report.generatedAt)}</dd>
        </dl>
        {verified ? (
          <div className="ag-actions">
            <a className="ag-btn ag-btn--primary" href={pdfHref(report.id)}>
              {copy.verification.downloadPdf}
            </a>
            <a className="ag-btn" href={bundleHref(report.id)}>
              {copy.verification.downloadBundle}
            </a>
            <a className="ag-btn" href={VERIFY_RECORD_PATH}>
              {copy.verification.verifyLink}
            </a>
          </div>
        ) : null}
        <p className="ag-note">{copy.verification.howTo}</p>
      </section>
    </div>
  );
}
