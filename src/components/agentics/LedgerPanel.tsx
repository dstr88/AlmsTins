/**
 * The ledger of one agent: what it asked and what moved, newest first. A `checked` row is the
 * moment the agent asked about an address and what it was answered; a `transaction` row is funds
 * that moved between the agent's wallet and a registered, trusted address once the chain confirmed
 * them, with the status it took from the check that came before. Above the rows, the totals: raw
 * value in (bought) and out (sold), priced at the time of each transfer, with nothing set against
 * anything else. A button reads the chain now instead of waiting for the daily job.
 *
 * Everything that came from the ledger or the chain (an address, an asset's symbol) is rendered as
 * text by React, which escapes it, and a link to the chain's explorer is built only from a chain
 * the Vault reads and a hash that is 0x and 64 hex digits (./paths.ts). Nothing here builds HTML
 * from data.
 */
import { useState } from 'react';
import type { TinTotals } from '@/lib/agentVault/events';
import { parseLedgerRows, type LedgerRow } from '@/lib/agentVault/ledgerView';
import { formatUsd, formatUtc, plural } from '@/lib/agentVault/reportFormat';
import { reasonText, VERIFY_STATUS_TITLE } from '@/lib/agentVault/reportText';
import { failureText, send } from './client';
import { clockOrDate, writtenIso } from './feedRows';
import { copy } from './copy';
import { explorerTxHref } from './paths';
import { describeRefresh, passOf } from './refresh';
import { Status } from './ui';

export const ANSWER_CLASS: Record<string, string> = {
  proven: 'ag-pill ag-pill--gain',
  'consistent-with-history': 'ag-pill ag-pill--accent',
  flagged: 'ag-pill ag-pill--bad',
  unknown: 'ag-pill',
};

const PAGE = 50;

/** The totals in an answer, or null when it is not a set of totals. */
export function totalsOf(body: Record<string, unknown> | null): TinTotals | null {
  const t = body?.totals as Record<string, unknown> | undefined;
  const side = (v: unknown) => {
    const s = v as Record<string, unknown> | undefined;
    if (!s || typeof s.count !== 'number' || typeof s.usd !== 'number') return null;
    return { count: s.count, pricedCount: Number(s.pricedCount ?? 0), unpricedCount: Number(s.unpricedCount ?? 0), usd: s.usd };
  };
  const bought = side(t?.bought);
  const sold = side(t?.sold);
  if (!t || !bought || !sold || typeof t.transactions !== 'number') return null;
  return { transactions: t.transactions, bought, sold };
}

function Strip({ totals }: { totals: TinTotals }) {
  const sides = [
    { label: copy.strip.bought, side: totals.bought },
    { label: copy.strip.sold, side: totals.sold },
  ];
  return (
    <>
      <div className="ag-strip">
        {sides.map(({ label, side }) => (
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
      <p className="ag-note">{copy.ledger.totalsNote}</p>
    </>
  );
}

/**
 * One row of the ledger. The live feed shows the rows of every agent in one list, so it also gives the agent's
 * name and the owner's label for the address; the agent's own page gives neither. Both are the account's own
 * text, rendered as text.
 */
export function LedgerItem({ row, agent, label, recorded }: { row: LedgerRow; agent?: string; label?: string | null; recorded?: string }) {
  const tx = row.kind === 'transaction' ? row.tx : null;
  const kind = tx ? (tx.direction === 'in' ? copy.ledger.kind.in : copy.ledger.kind.out) : copy.ledger.kind.checked;
  const answer = row.answer ? VERIFY_STATUS_TITLE[row.answer] : copy.ledger.noAnswer;
  const registry = row.registry ? copy.ledger.registry[row.registry] : null;
  const href = tx ? explorerTxHref(row.chain, tx.hash) : null;
  return (
    <li className="ag-event">
      <div className="ag-event__top">
        <time className="ag-event__time" dateTime={row.at}>
          {formatUtc(row.at)}
        </time>
        <span className="ag-pill ag-pill--kind">{kind}</span>
        <span className={row.answer ? ANSWER_CLASS[row.answer] : 'ag-pill ag-pill--muted'}>{row.answer ? copy.ledger.answer(answer) : answer}</span>
        {registry ? <span className="ag-event__registry">{copy.ledger.registryIs(registry)}</span> : null}
      </div>
      {agent ? <p className="ag-event__agent">{agent}</p> : null}
      <p className="ag-event__addr ag-mono">{row.address}</p>
      {label ? <p className="ag-event__line">{copy.ledger.addressLabel(label)}</p> : null}
      {recorded ? <p className="ag-event__line">{copy.feed.recorded(clockOrDate(writtenIso(recorded), row.at))}</p> : null}
      {tx ? (
        <>
          <p className="ag-event__line">
            <span className="ag-mono">{copy.ledger.amount(tx.amount, tx.asset)}</span>
            {'  ·  '}
            {tx.usd === null ? copy.ledger.noUsd : copy.ledger.usd(formatUsd(tx.usd))}
          </p>
          <p className="ag-event__line">{row.linkReason ? copy.ledger.linkReason[row.linkReason] : copy.ledger.inheritedFrom}</p>
          {href ? (
            <p className="ag-event__line">
              <a className="ag-link" href={href} target="_blank" rel="noopener noreferrer">
                {copy.ledger.chainTx}
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="ag-event__line">{reasonText(row.basis ?? 'other')}</p>
          {row.keyState === 'revoked' ? <p className="ag-event__line">{copy.ledger.keyRevoked}</p> : null}
          {row.keyState === 'unknown' ? <p className="ag-event__line">{copy.ledger.keyUnknown}</p> : null}
          {row.limitReached ? <p className="ag-event__line ag-event__line--warn">{copy.ledger.limitReached}</p> : null}
        </>
      )}
    </li>
  );
}

export interface LedgerPanelProps {
  tinId: string;
  ledger: { rows: LedgerRow[]; next: string | null };
  totals: TinTotals;
}

export default function LedgerPanel({ tinId, ledger, totals: initialTotals }: LedgerPanelProps) {
  const [rows, setRows] = useState<LedgerRow[]>(ledger.rows);
  const [next, setNext] = useState<string | null>(ledger.next);
  const [totals, setTotals] = useState<TinTotals>(initialTotals);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readLines, setReadLines] = useState<string[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  async function loadMore() {
    if (!next) return;
    setLoading(true);
    setLoadError(null);
    const r = await send('GET', `/api/agentics/events?tinId=${encodeURIComponent(tinId)}&limit=${PAGE}&before=${encodeURIComponent(next)}`);
    if (r.ok) {
      const more = parseLedgerRows(r.body?.events);
      setRows((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...more.filter((x) => !seen.has(x.id))];
      });
      setNext(typeof r.body?.next === 'string' ? r.body.next : null);
    } else {
      setLoadError(failureText(r));
    }
    setLoading(false);
  }

  async function readChain() {
    setReading(true);
    setReadLines(null);
    setReadError(null);
    const r = await send('POST', '/api/agentics/refresh', { tinId });
    const pass = r.ok ? passOf(r.body) : null;
    if (!pass) {
      setReadError(r.ok ? copy.errors.generic : failureText(r));
      setReading(false);
      return;
    }
    setReadLines(describeRefresh(pass));
    // The rows and the totals as they stand now, including whatever the read just recorded.
    const [fresh, sums] = await Promise.all([
      send('GET', `/api/agentics/events?tinId=${encodeURIComponent(tinId)}&limit=${PAGE}`),
      send('GET', `/api/agentics/totals?tinId=${encodeURIComponent(tinId)}`),
    ]);
    if (fresh.ok) {
      setRows(parseLedgerRows(fresh.body?.events));
      setNext(typeof fresh.body?.next === 'string' ? fresh.body.next : null);
    }
    const t = sums.ok ? totalsOf(sums.body) : null;
    if (t) setTotals(t);
    setReading(false);
  }

  return (
    <section className="ag-card" aria-labelledby="ag-ledger-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-ledger-h">
          {copy.ledger.title}
        </h2>
        <span className="ag-card__meta">{copy.ledger.transfers(totals.transactions)}</span>
      </div>
      <p className="ag-hint">{copy.ledger.lede}</p>

      <h3 className="ag-subtitle">{copy.ledger.totalsTitle}</h3>
      <Strip totals={totals} />

      <h3 className="ag-subtitle">{copy.ledger.readTitle}</h3>
      <p className="ag-hint">{copy.ledger.readLede}</p>
      <div className="ag-form">
        <button className="ag-btn" type="button" aria-disabled={reading || undefined} onClick={() => { if (!reading) void readChain(); }}>
          {reading ? copy.ledger.reading : copy.ledger.readButton}
        </button>
      </div>
      <div role="status" aria-live="polite" className="ag-readresult">
        {reading ? <p className="ag-status">{copy.ledger.reading}</p> : null}
        {readLines ? (
          <ul className="ag-summary__list">
            {readLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <Status kind="bad">{readError}</Status>

      {rows.length === 0 ? (
        <p className="ag-empty">{copy.ledger.empty}</p>
      ) : (
        <ol className="ag-events" aria-label={copy.ledger.listLabel}>
          {rows.map((row) => (
            <LedgerItem key={row.id} row={row} />
          ))}
        </ol>
      )}
      <Status kind="bad">{loadError}</Status>
      {next ? (
        <div className="ag-form">
          <button className="ag-btn" type="button" aria-disabled={loading || undefined} onClick={() => { if (!loading) void loadMore(); }}>
            {loading ? copy.ledger.loadingMore : copy.ledger.loadMore}
          </button>
        </div>
      ) : rows.length > 0 ? (
        <p className="ag-hint">{copy.ledger.allLoaded}</p>
      ) : null}
    </section>
  );
}
