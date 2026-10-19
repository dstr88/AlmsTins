/**
 * Removing an agent. The agent, its wallets and its registered addresses leave use and free their
 * places on the plan; what the agent recorded stays on record and is no longer shown. It asks once
 * more before it does it, in the page, so a stray click removes nothing.
 */
import { useState } from 'react';
import { failureText, send } from './client';
import { copy } from './copy';
import { HOME_PATH } from './paths';
import { ConfirmRemove, Status } from './ui';

export default function RemoveAgent({ tinId }: { tinId: string }) {
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
      <div className="ag-form">
        <ConfirmRemove
          label={copy.agent.remove.button}
          question={copy.agent.remove.confirm}
          yes={copy.agent.remove.yes}
          yesWorking={copy.agent.remove.removing}
          keep={copy.agent.remove.keep}
          working={busy}
          onConfirm={() => void remove()}
        />
      </div>
      <Status kind="bad">{message}</Status>
    </section>
  );
}
