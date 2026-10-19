/**
 * The agent key linked to one agent. A key is how the agent identifies itself when it asks Almstins
 * about an address before it pays: a check asked with a linked key is recorded in this agent's
 * ledger, and one asked without it is not. Link one of this account's own active keys that no other
 * agent uses, or unlink the one that is linked. Minting a key is a domain proof, on its own page.
 *
 * The key itself is never here: only which domain proved it and whether it can still be used.
 * Everything from the account (a domain) is rendered as text by React, which escapes it.
 */
import { useState } from 'react';
import type { KeyInfo } from '@/lib/agentVault/vaultPages';
import { failureText, send } from './client';
import { copy } from './copy';
import { KEYS_PATH } from './paths';
import { Status } from './ui';

/** What the card says about the key linked now. */
export function keyStateLine(key: KeyInfo | null): string {
  if (!key) return copy.agent.key.none;
  if (key.status === 'active') return copy.agent.key.linked(key.domain);
  return key.status === 'revoked' ? copy.agent.key.revoked(key.domain) : copy.agent.key.unused(key.domain);
}

export interface AgentKeyCardProps {
  tinId: string;
  linked: KeyInfo | null;
  available: KeyInfo[];
}

export default function AgentKeyCard({ tinId, linked, available }: AgentKeyCardProps) {
  const [key, setKey] = useState<KeyInfo | null>(linked);
  const [choices, setChoices] = useState<KeyInfo[]>(available);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  async function change(next: KeyInfo | null) {
    setBusy(true);
    setMessage(null);
    const r = await send('PATCH', '/api/agentics/tins', { id: tinId, agentKeyId: next ? next.id : null });
    if (r.ok) {
      // The key that was linked is free again if it can still be used; the one just linked is taken.
      setChoices((prev) => {
        const without = prev.filter((k) => !next || k.id !== next.id);
        return key && key.status === 'active' && (!next || next.id !== key.id) ? [...without, key] : without;
      });
      setKey(next);
      setChosen('');
      setMessage({ kind: 'ok', text: next ? copy.agent.key.linkedOk : copy.agent.key.unlinkedOk });
    } else {
      setMessage({ kind: 'bad', text: failureText(r) });
    }
    setBusy(false);
  }

  return (
    <section className="ag-card" aria-labelledby="ag-key-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-key-h">
          {copy.agent.key.title}
        </h2>
      </div>
      <p className="ag-hint">{keyStateLine(key)}</p>
      <form
        className="ag-form"
        onSubmit={(e) => {
          e.preventDefault();
          // aria-disabled keeps focus on the button, and a press on it still submits.
          if (busy) return;
          const next = choices.find((k) => k.id === chosen);
          if (next) void change(next);
        }}
      >
        {choices.length > 0 ? (
          <>
            <label className="ag-field">
              {copy.agent.key.choose}
              <select className="ag-select" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={busy}>
                <option value="">{copy.home.add.keyNone}</option>
                {choices.map((k) => (
                  <option key={k.id} value={k.id}>
                    {copy.home.add.keyOption(k.domain)}
                  </option>
                ))}
              </select>
            </label>
            <button className="ag-btn ag-btn--primary" type="submit" aria-disabled={busy || !chosen || undefined}>
              {busy ? copy.agent.key.linking : copy.agent.key.link}
            </button>
          </>
        ) : (
          <p className="ag-hint">{copy.agent.key.noneAvailable}</p>
        )}
        {key ? (
          <button className="ag-btn" type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) void change(null); }}>
            {copy.agent.key.unlink}
          </button>
        ) : null}
        <a className="ag-btn" href={KEYS_PATH}>
          {copy.agent.key.mint}
        </a>
      </form>
      <Status kind={message?.kind === 'bad' ? 'bad' : 'ok'}>{message?.text}</Status>
    </section>
  );
}
