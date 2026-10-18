/**
 * The Reports page: each agent with its reports, newest day first, and a form to make a report for
 * a day. Rendered on the server and hydrated, so the list is in the page before any script runs.
 *
 * Everything that came from the ledger or the registry (an agent's name) is rendered as text by
 * React, which escapes it. Nothing here builds HTML from data, and no class belongs to anyone but
 * Agentics (every one starts with ag-; see agentics.css).
 */
import { useState } from 'react';
import type { ReportsPageData, ReportsPageTin } from '@/lib/agentVault/reportPages';
import type { ReportListItem } from '@/lib/agentVault/reports';
import { formatCount, formatDayLong, formatUsd, formatUtc } from '@/lib/agentVault/reportFormat';
import { copy } from './copy';
import { reportHref } from './paths';

/** The text for an error code the API answered with, or the plain fallback for a code this page does not know. */
export function errorText(code: unknown): string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(copy.errors, code) ? copy.errors[code] : copy.errors.generic;
}

function Counts({ h }: { h: ReportListItem['headline'] }) {
  const items: Array<{ key: string; n: number; label: string; on: string }> = [
    { key: 'issues', n: h.issues, label: copy.buckets.issues, on: 'ag-count--issues' },
    { key: 'confirm', n: h.notConfirmed, label: copy.buckets.notConfirmed, on: 'ag-count--confirm' },
    { key: 'new', n: h.new, label: copy.buckets.new, on: 'ag-count--new' },
    { key: 'clear', n: h.noIssues, label: copy.buckets.noIssues, on: 'ag-count--clear' },
  ];
  return (
    <span className="ag-counts">
      {items.map((i) => (
        <span key={i.key} className={`ag-count ${i.n > 0 ? i.on : 'ag-count--zero'}`}>
          {formatCount(i.n)} {i.label.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

function ReportRow({ r }: { r: ReportListItem }) {
  const moved =
    r.headline.transfers === 0
      ? copy.strip.none
      : `${copy.strip.bought} ${formatUsd(r.headline.bought.usd)}  ·  ${copy.strip.sold} ${formatUsd(r.headline.sold.usd)}`;
  return (
    <li className="ag-row">
      <span className="ag-row__day">
        <a className="ag-link" href={reportHref(r.id)}>
          {formatDayLong(r.day)}
        </a>
        <span className="ag-pill">{copy.pills.version(r.version)}</span>
        {r.partial ? <span className="ag-pill ag-pill--warn">{copy.pills.partial}</span> : null}
        {r.signed ? <span className="ag-pill ag-pill--gain">{copy.pills.signed}</span> : <span className="ag-pill ag-pill--muted">{copy.pills.unsigned}</span>}
      </span>
      <Counts h={r.headline} />
      <span className="ag-row__moved">{moved}</span>
      <span className="ag-row__made">{formatUtc(r.generatedAt)}</span>
    </li>
  );
}

function MakeReport({ tin, today, yesterday }: { tin: ReportsPageTin; today: string; yesterday: string }) {
  const [day, setDay] = useState(yesterday);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/agentics/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tinId: tin.id, day }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; report?: { id?: unknown } } | null;
      if (!res.ok || !body?.ok || typeof body.report?.id !== 'string') {
        setMessage(errorText(body?.error));
        return;
      }
      window.location.assign(reportHref(body.report.id));
    } catch {
      setMessage(errorText(null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-label={`${copy.reports.makeTitle}: ${tin.label}`}>
      <label className="ag-field">
        {copy.reports.makeDay}
        <input className="ag-input" type="date" value={day} min={tin.since} max={today} required onChange={(e) => setDay(e.target.value)} />
      </label>
      <button className="ag-btn ag-btn--primary" type="submit" disabled={busy || !day}>
        {busy ? copy.reports.making : copy.reports.makeButton}
      </button>
      {message ? (
        <span className="ag-status ag-status--bad" role="alert">
          {message}
        </span>
      ) : null}
    </form>
  );
}

export default function ReportsPage({ data }: { data: ReportsPageData }) {
  return (
    <div className="ag-page">
      <header className="ag-hero">
        <p className="ag-kicker">{copy.reports.kicker}</p>
        <h1 className="ag-title">{copy.reports.title}</h1>
        <p className="ag-sub">{copy.reports.lede}</p>
      </header>

      {data.signing.available ? null : <p className="ag-notice ag-notice--warn">{copy.reports.signingOff}</p>}

      {data.tins.length === 0 ? <p className="ag-empty">{copy.reports.noAgents}</p> : null}

      {data.tins.map((tin) => (
        <section key={tin.id} className="ag-card" aria-label={tin.label}>
          <div className="ag-card__head">
            <h2 className="ag-card__title">{tin.label}</h2>
          </div>
          <MakeReport tin={tin} today={data.today} yesterday={data.yesterday} />
          <p className="ag-hint">{copy.reports.todayNote}</p>
          {tin.reports.length === 0 ? (
            <p className="ag-empty">{copy.reports.noReports}</p>
          ) : (
            <>
              <div className="ag-listhead" aria-hidden="true">
                <span>{copy.reports.columns.day}</span>
                <span>{copy.reports.columns.counts}</span>
                <span>{copy.reports.columns.moved}</span>
                <span>{copy.reports.columns.made}</span>
              </div>
              <ul className="ag-list">
                {tin.reports.map((r) => (
                  <ReportRow key={r.id} r={r} />
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
