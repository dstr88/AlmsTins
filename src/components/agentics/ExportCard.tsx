/**
 * The export card: this agent's ledger for a range of UTC days, as a signed file or as a CSV. It says
 * what the signature covers (the ledger as Almstins stored it when you exported it) and what it does
 * not (that the agent asked before every payment, and transfers to addresses that were never
 * registered), and that the CSV is only a convenience copy, not signed.
 *
 * The file is fetched by the page and handed to the browser's own download, so a refusal (a range that
 * is too large, a server with no signing key, too many in a minute) is said in plain words on the page
 * and not as a page of JSON. With no signing key there is nothing to download, and the card says so.
 */
import { useState } from 'react';
import { presetRange, requestExport, saveBlob, timeOfDay } from './exportDownload';
import { copy } from './copy';
import { VERIFY_RECORD_PATH } from './paths';
import { Status } from './ui';

export interface ExportCardProps {
  tinId: string;
  /** The UTC day the agent was created: nothing earlier has anything in it. */
  since: string;
  /** Today in UTC: the last day a file can cover. */
  today: string;
  /** Whether this server can sign a file. */
  signing: { available: boolean };
}

export default function ExportCard({ tinId, since, today, signing }: ExportCardProps) {
  const initial = presetRange(today, 30, since);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  // Optional: a time of day (UTC) to start at on the first day and to end at on the last. Empty means whole days.
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [busy, setBusy] = useState<null | 'json' | 'csv'>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  // The times are a hint to the person, never a rule: the server decides what is a real range.
  const sameDayBackwards = from === to && !!timeOfDay(fromTime) && !!timeOfDay(toTime) && timeOfDay(fromTime) > timeOfDay(toTime);
  const usable = signing.available && !!from && !!to && from <= to && !sameDayBackwards;

  async function download(format: 'json' | 'csv') {
    setBusy(format);
    setMessage(null);
    const r = await requestExport({ tinId, from, to, fromTime, toTime, format });
    if (r.ok) {
      saveBlob(r.blob, r.filename);
      setMessage({ kind: 'ok', text: copy.export.done(r.filename) });
    } else {
      setMessage({ kind: 'bad', text: r.message });
    }
    setBusy(null);
  }

  return (
    <section className="ag-card" aria-labelledby="ag-export-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-export-h">
          {copy.export.title}
        </h2>
      </div>
      <p className="ag-hint">{copy.export.lede}</p>
      {signing.available ? null : <p className="ag-notice ag-notice--warn">{copy.export.noSigning}</p>}

      <div className="ag-form" role="group" aria-label={copy.export.presetsLabel}>
        {(
          [
            [7, copy.export.last7],
            [30, copy.export.last30],
          ] as const
        ).map(([days, label]) => (
          <button
            key={days}
            type="button"
            className="ag-btn ag-btn--small"
            disabled={busy !== null}
            onClick={() => {
              const r = presetRange(today, days, since);
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="ag-form" onSubmit={(e) => e.preventDefault()}>
        <label className="ag-field">
          {copy.export.from}
          <input className="ag-input" type="date" value={from} min={since} max={to || today} required onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="ag-field">
          {copy.export.to}
          <input className="ag-input" type="date" value={to} min={from || since} max={today} required onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="ag-btn ag-btn--primary" type="button" disabled={busy !== null || !usable} onClick={() => void download('json')}>
          {busy === 'json' ? copy.export.preparing : copy.export.signed}
        </button>
        <button className="ag-btn" type="button" disabled={busy !== null || !usable} onClick={() => void download('csv')}>
          {busy === 'csv' ? copy.export.preparing : copy.export.csv}
        </button>
      </form>
      <details className="ag-details">
        <summary>{copy.export.timeSummary}</summary>
        <p className="ag-hint">{copy.export.timeHelp}</p>
        <div className="ag-form">
          <label className="ag-field">
            {copy.export.fromTime}
            <input className="ag-input" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
          </label>
          <label className="ag-field">
            {copy.export.toTime}
            <input className="ag-input" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
          </label>
          <button
            className="ag-btn ag-btn--small"
            type="button"
            disabled={busy !== null || (!fromTime && !toTime)}
            onClick={() => {
              setFromTime('');
              setToTime('');
            }}
          >
            {copy.export.wholeDays}
          </button>
        </div>
        {sameDayBackwards ? <p className="ag-notice ag-notice--warn">{copy.export.timeBackwards}</p> : null}
      </details>
      <Status kind={message?.kind === 'bad' ? 'bad' : 'ok'}>{message?.text}</Status>

      <p className="ag-note">{copy.export.covers}</p>
      <p className="ag-note">{copy.export.doesNotCover}</p>
      <p className="ag-note">{copy.export.csvNote}</p>
      <p className="ag-note">{copy.export.limits}</p>
      <p className="ag-hint">
        <a className="ag-link" href={VERIFY_RECORD_PATH}>
          {copy.export.verify}
        </a>
        {'  '}
        {copy.export.verifyNote}
      </p>
    </section>
  );
}
