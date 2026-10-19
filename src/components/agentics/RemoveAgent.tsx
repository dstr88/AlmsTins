/**
 * Removing an agent. The agent, its wallets and its registered addresses leave use and free their
 * places on the plan; what the agent recorded stays on record and is no longer shown. It asks once
 * more before it does it, in the page, so a stray click removes nothing.
 */
import { useState } from 'react';
import { failureText, send } from './client';
import { copy } from './copy';
import { HOME_PATH } from './paths';
import { Status } from './ui';

export default function RemoveAgent({ tinId }: { tinId: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setMessage(null);
    const r = await send('DELETE', `/api/agentics/tins?id=${encodeURIComponent(tinId)}`);
    if (r.ok) {
      window.location.assign(HOME_PATH);
      return;
    }
    setMessage(failureText(r));
    setBusy(false);
  }

  return (
    <section className="ag-card" aria-labelledby="ag-remove-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-remove-h">
          {copy.agent.remove.title}
        </h2>
      </div>
      <p className="ag-hint">{copy.agent.remove.lede}</p>
      {asking ? (
        <div className="ag-confirm" role="group" aria-label={copy.agent.remove.confirm}>
          <span className="ag-confirm__text">{copy.agent.remove.confirm}</span>
          <button className="ag-btn ag-btn--danger" type="button" disabled={busy} onClick={() => void remove()}>
            {busy ? copy.agent.remove.removing : copy.agent.remove.yes}
          </button>
          <button className="ag-btn" type="button" disabled={busy} onClick={() => setAsking(false)}>
            {copy.agent.remove.keep}
          </button>
        </div>
      ) : (
        <div className="ag-form">
          <button className="ag-btn ag-btn--danger" type="button" onClick={() => setAsking(true)}>
            {copy.agent.remove.button}
          </button>
        </div>
      )}
      <Status kind="bad">{message}</Status>
    </section>
  );
}
