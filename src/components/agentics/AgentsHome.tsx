/**
 * The Agent Vault's home: one card for each agent, a form to add an agent, and, before there is
 * any, a short walk through what to do first. Rendered on the server and hydrated, so the cards are
 * in the page before any script runs.
 *
 * Everything that came from the registry or the ledger (an agent's name, a key's domain) is
 * rendered as text by React, which escapes it. Nothing here builds HTML from data, and no class
 * belongs to anyone but Agentics (every one starts with ag-; see agentics.css).
 */
import { useState } from 'react';
import { formatUtc } from '@/lib/agentVault/reportFormat';
import type { AgentCard, HomePageData, KeyInfo } from '@/lib/agentVault/vaultPages';
import { failureText, send } from './client';
import { copy } from './copy';
import { agentHref, DOCS_PATH, KEYS_PATH } from './paths';

/** What a card says about the key linked to its agent. */
export function keyLine(key: KeyInfo | null): string {
  if (!key) return copy.home.card.keyNone;
  if (key.status === 'active') return copy.home.card.keyLinked(key.domain);
  return key.status === 'revoked' ? copy.home.card.keyRevoked(key.domain) : copy.home.card.keyUnused(key.domain);
}

function Chip({ n, on, text }: { n: number; on: string; text: string }) {
  return <li className={`ag-count ${n > 0 ? on : 'ag-count--zero'}`}>{text}</li>;
}

function Card({ a }: { a: AgentCard }) {
  const d = a.destinations;
  const none = d.trusted + d.flagged + d.pending === 0;
  return (
    <li className="ag-agent">
      <h3 className="ag-agent__name">
        <a className="ag-link" href={agentHref(a.id)}>
          {a.label}
        </a>
      </h3>
      <p className="ag-agent__line">{keyLine(a.key)}</p>
      {none ? (
        <p className="ag-agent__line">{copy.home.card.noAddresses}</p>
      ) : (
        <ul className="ag-counts" aria-label={copy.registry.listLabel}>
          <Chip n={d.trusted} on="ag-count--clear" text={copy.home.card.trusted(d.trusted)} />
          <Chip n={d.flagged} on="ag-count--issues" text={copy.home.card.flagged(d.flagged)} />
          <Chip n={d.pending} on="ag-count--confirm" text={copy.home.card.pending(d.pending)} />
        </ul>
      )}
      <p className="ag-agent__line">{copy.home.card.wallets(a.wallets)}</p>
      <p className="ag-agent__line">{a.lastCheckAt ? copy.home.card.lastCheck(formatUtc(a.lastCheckAt)) : copy.home.card.noChecks}</p>
      <p className="ag-agent__line">{a.lastTransferAt ? copy.home.card.lastTransfer(formatUtc(a.lastTransferAt)) : copy.home.card.noTransfers}</p>
      <a className="ag-btn" href={agentHref(a.id)} aria-label={`${copy.home.open}: ${a.label}`}>
        {copy.home.open}
      </a>
    </li>
  );
}

function AddAgent({ data }: { data: HomePageData }) {
  const [name, setName] = useState('');
  const [keyId, setKeyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { limits, use } = data.plan;
  const full = limits.bots !== null && use.bots >= limits.bots;

  async function create() {
    setBusy(true);
    setMessage(null);
    const r = await send('POST', '/api/agentics/tins', { label: name, agentKeyId: keyId || undefined });
    const tin = r.body?.tin as { id?: unknown } | undefined;
    if (r.ok && typeof tin?.id === 'string') {
      window.location.assign(agentHref(tin.id));
      return;
    }
    setMessage(failureText(r));
    setBusy(false);
  }

  return (
    <section className="ag-card" aria-labelledby="ag-add-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-add-h">
          {copy.home.add.title}
        </h2>
      </div>
      <form
        className="ag-form"
        onSubmit={(e) => {
          e.preventDefault();
          // aria-disabled keeps focus on the button, and a press on it still submits.
          if (busy || full || !name.trim()) return;
          void create();
        }}
      >
        <label className="ag-field">
          {copy.home.add.nameLabel}
          <input
            className="ag-input"
            type="text"
            value={name}
            maxLength={80}
            required
            placeholder={copy.home.add.namePlaceholder}
            readOnly={full}
            aria-disabled={full || undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="ag-field">
          {copy.home.add.keyLabel}
          <select
            className="ag-select"
            value={keyId}
            aria-disabled={full || undefined}
            onChange={(e) => {
              if (!full) setKeyId(e.target.value);
            }}
          >
            <option value="">{copy.home.add.keyNone}</option>
            {data.availableKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {copy.home.add.keyOption(k.domain)}
              </option>
            ))}
          </select>
        </label>
        <button className="ag-btn ag-btn--primary" type="submit" aria-disabled={busy || full || !name.trim() || undefined}>
          {busy ? copy.home.add.creating : copy.home.add.create}
        </button>
      </form>
      <p className="ag-hint">
        {copy.home.add.keyHelp}{' '}
        <a className="ag-link" href={KEYS_PATH}>
          {copy.home.add.mint}
        </a>
      </p>
      {full ? <p className="ag-notice ag-notice--warn">{copy.plan.full.bots}</p> : null}
      <p className="ag-status ag-status--bad" role="alert" aria-live="assertive">
        {message}
      </p>
    </section>
  );
}

export default function AgentsHome({ data }: { data: HomePageData }) {
  const empty = data.agents.length === 0;
  return (
    <div className="ag-page">
      <header className="ag-hero">
        <p className="ag-kicker">{copy.home.kicker}</p>
        <h1 className="ag-title">{copy.home.title}</h1>
        <p className="ag-sub">{copy.home.lede}</p>
      </header>
      <p className="ag-notice">{copy.home.limits}</p>

      {empty ? (
        <section className="ag-card" aria-labelledby="ag-start-h">
          <div className="ag-card__head">
            <h2 className="ag-card__title" id="ag-start-h">
              {copy.home.emptyTitle}
            </h2>
          </div>
          <p className="ag-hint">{copy.home.emptyLede}</p>
          <ol className="ag-steps">
            {copy.home.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="ag-hint">
            <a className="ag-link" href={DOCS_PATH}>
              {copy.home.docs}
            </a>
          </p>
        </section>
      ) : (
        <section aria-labelledby="ag-list-h">
          <h2 className="ag-card__title ag-card__title--plain" id="ag-list-h">
            {copy.home.listTitle}
          </h2>
          <ul className="ag-agents">
            {data.agents.map((a) => (
              <Card key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}

      <AddAgent data={data} />
    </div>
  );
}
