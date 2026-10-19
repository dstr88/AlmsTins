/**
 * The agent's own wallets: the addresses it sends from and receives to. Almstins only reads them,
 * to find transfers between them and the registered addresses. Add one (a chain and an address),
 * remove one; the plan's limit for each agent is said before it is reached and in calm words when
 * it is.
 *
 * Everything that came from the registry (an address) is rendered as text by React, which escapes
 * it. Nothing here builds HTML from data.
 */
import { useState } from 'react';
import type { PlanSummary } from '@/lib/agentVault/entitlements';
import type { AgentWallet } from '@/lib/agentVault/store';
import { failureText, send } from './client';
import { copy } from './copy';
import { CopyButton, Status } from './ui';

const chainName = (chain: string): string => (Object.prototype.hasOwnProperty.call(copy.registry.chains, chain) ? copy.registry.chains[chain] : chain);

/** The wallets in an answer that look like wallets (an id and an address), and nothing else. */
export function asWallets(list: unknown): AgentWallet[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is AgentWallet => !!x && typeof x === 'object' && typeof (x as AgentWallet).id === 'string' && typeof (x as AgentWallet).address === 'string');
}

export interface WalletsPanelProps {
  tinId: string;
  wallets: AgentWallet[];
  plan: PlanSummary;
}

export default function WalletsPanel({ tinId, wallets, plan }: WalletsPanelProps) {
  const [list, setList] = useState<AgentWallet[]>(wallets);
  const [chain, setChain] = useState('ethereum');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const limit = plan.limits.walletsPerBot;
  const full = limit !== null && list.length >= limit;

  async function reload() {
    const r = await send('GET', `/api/agentics/tins?id=${encodeURIComponent(tinId)}`);
    if (r.ok) setList(asWallets(r.body?.wallets));
  }

  async function add() {
    setBusy(true);
    setMessage(null);
    const r = await send('POST', '/api/agentics/wallets', { tinId, chain, address });
    if (r.ok) {
      setMessage({ kind: 'ok', text: r.body?.added === false ? copy.wallets.already : copy.wallets.added });
      setAddress('');
      await reload();
    } else {
      setMessage({ kind: 'bad', text: failureText(r) });
    }
    setBusy(false);
  }

  async function remove(w: AgentWallet) {
    setRemoving(w.id);
    setMessage(null);
    const r = await send('DELETE', `/api/agentics/wallets?id=${encodeURIComponent(w.id)}`);
    if (r.ok) {
      setList((prev) => prev.filter((x) => x.id !== w.id));
      setConfirming(null);
      setMessage({ kind: 'ok', text: copy.wallets.removed });
    } else {
      setMessage({ kind: 'bad', text: failureText(r) });
    }
    setRemoving(null);
  }

  return (
    <section className="ag-card" aria-labelledby="ag-wallets-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-wallets-h">
          {copy.wallets.title}
        </h2>
        <span className="ag-card__meta">{limit === null ? copy.wallets.count(list.length) : copy.wallets.countOf(list.length, limit)}</span>
      </div>
      <p className="ag-hint">{copy.wallets.lede}</p>

      <form
        className="ag-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="ag-field">
          {copy.wallets.chainLabel}
          <select className="ag-select" value={chain} onChange={(e) => setChain(e.target.value)} disabled={busy || full}>
            {Object.keys(copy.registry.chains).map((c) => (
              <option key={c} value={c}>
                {chainName(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="ag-field ag-field--grow">
          {copy.wallets.addressLabel}
          <input
            className="ag-input ag-mono"
            type="text"
            value={address}
            placeholder={copy.wallets.addressPlaceholder}
            spellCheck={false}
            autoComplete="off"
            required
            onChange={(e) => setAddress(e.target.value)}
            disabled={busy || full}
          />
        </label>
        <button className="ag-btn ag-btn--primary" type="submit" disabled={busy || full || !address.trim()}>
          {busy ? copy.wallets.adding : copy.wallets.add}
        </button>
      </form>
      {full ? <p className="ag-notice ag-notice--warn">{copy.plan.full.wallets}</p> : null}
      <Status kind={message?.kind === 'bad' ? 'bad' : 'ok'}>{message?.text}</Status>

      {list.length === 0 ? (
        <p className="ag-empty">{copy.wallets.empty}</p>
      ) : (
        <ul className="ag-dests" aria-label={copy.wallets.listLabel}>
          {list.map((w) => (
            <li className="ag-dest" key={w.id}>
              <div className="ag-dest__main">
                <span className="ag-pill">{chainName(w.chain)}</span>
                <span className="ag-addr ag-mono">{w.address}</span>
                <CopyButton value={w.address} />
              </div>
              <div className="ag-dest__actions">
                {confirming === w.id ? (
                  <span className="ag-confirm" role="group" aria-label={copy.wallets.removeConfirm}>
                    <span className="ag-confirm__text">{copy.wallets.removeConfirm}</span>
                    <button className="ag-btn ag-btn--small ag-btn--danger" type="button" disabled={removing === w.id} onClick={() => void remove(w)}>
                      {removing === w.id ? copy.wallets.removing : copy.wallets.removeYes}
                    </button>
                    <button className="ag-btn ag-btn--small" type="button" onClick={() => setConfirming(null)}>
                      {copy.wallets.removeKeep}
                    </button>
                  </span>
                ) : (
                  <button className="ag-btn ag-btn--small" type="button" onClick={() => setConfirming(w.id)}>
                    {copy.wallets.remove}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
