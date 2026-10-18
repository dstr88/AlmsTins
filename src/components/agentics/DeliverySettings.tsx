/**
 * Report email settings: how often to be sent a digest, and whether to be told at once about a
 * flagged check. Everything is off until the owner turns it on. One form for the account, not one
 * per agent: there is one inbox and one digest.
 *
 * Rendered on the server with the saved settings and hydrated, so the form is in the page before
 * any script runs. The only text that is not this file's own copy is the API's error code, and
 * that goes through errorText, which only ever answers with the copy.
 */
import { useState } from 'react';
import type { ReportSettings } from '@/lib/agentVault/delivery';
import { copy } from './copy';
import { errorText } from './errors';

const CADENCES = ['off', 'daily', 'weekly', 'issues'] as const;

export interface DeliveryProps {
  settings: ReportSettings;
  /** Whether the account has an email address to send to. */
  recipientAvailable: boolean;
}

export default function DeliverySettings({ settings, recipientAvailable }: DeliveryProps) {
  const [cadence, setCadence] = useState<ReportSettings['cadence']>(settings.cadence);
  const [alerts, setAlerts] = useState(settings.alerts);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/agentics/report-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence, alerts }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null;
      setStatus(res.ok && body?.ok ? { kind: 'ok', text: copy.delivery.saved } : { kind: 'bad', text: errorText(body?.error) });
    } catch {
      setStatus({ kind: 'bad', text: errorText(null) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ag-card" aria-label={copy.delivery.title}>
      <div className="ag-card__head">
        <h2 className="ag-card__title">{copy.delivery.title}</h2>
      </div>
      <p className="ag-hint">{copy.delivery.lede}</p>
      {recipientAvailable ? null : <p className="ag-notice ag-notice--warn">{copy.delivery.noRecipient}</p>}
      <form
        className="ag-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ag-field">
          {copy.delivery.cadenceLabel}
          <select className="ag-select" value={cadence} onChange={(e) => setCadence(e.target.value as ReportSettings['cadence'])}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {copy.delivery.cadence[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="ag-check">
          <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
          <span>{copy.delivery.alertsLabel}</span>
        </label>
        <button className="ag-btn ag-btn--primary" type="submit" disabled={busy}>
          {busy ? copy.delivery.saving : copy.delivery.save}
        </button>
        {status ? (
          <span className={`ag-status ${status.kind === 'ok' ? 'ag-status--ok' : 'ag-status--bad'}`} role={status.kind === 'ok' ? 'status' : 'alert'}>
            {status.text}
          </span>
        ) : null}
      </form>
      <p className="ag-note">{copy.delivery.countsOnly}</p>
    </section>
  );
}
