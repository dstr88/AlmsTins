/**
 * The Wallets page: every agent's own wallets, ten to a page, each with two windows side by side,
 * like an inbox and an outbox: what the wallet received and what it sent, newest first. A window
 * shows about eight rows and scrolls; Expand lets it grow to all its rows; Load more fetches the next
 * ones. A row is one line (when, how much, the USD value, the other side and its status) and opens
 * to the rest of the ledger's facts for that transfer. Beside each window is a download of every
 * transfer in it, as a CSV.
 *
 * Built from the ledger's own parts: the rows are the ledger's (LedgerRow, src/lib/agentVault/
 * ledgerView.ts), the USD value is the ledger's own words (usdLine), the status pills are the
 * ledger's (COUNTERPARTY_CLASS), and the wallet's address has the same copy button and QR code as on
 * the agent's page. Everything that came from the registry or the chain (an address, a label, a
 * token's symbol) is rendered as text by React, which escapes it. Nothing here builds HTML from data.
 */
import { useId, useState } from 'react';
import { shortenAddress } from '@/lib/addressDisplay';
import { parseLedgerRows, type LedgerRow } from '@/lib/agentVault/ledgerView';
import { formatUtc } from '@/lib/agentVault/reportFormat';
import type { WalletBox, WalletsPageData, WalletWindowData } from '@/lib/agentVault/vaultPages';
import { failureText, send } from './client';
import { copy } from './copy';
import { requestWalletCsv, saveBlob } from './exportDownload';
import { COUNTERPARTY_CLASS, usdLine } from './LedgerPanel';
import { agentHref, explorerTxHref, walletsHref, walletWindowUrl } from './paths';
import { Status, VaultCopyButton } from './ui';
import WalletQrButton from './WalletQr';

type Direction = 'in' | 'out';

const chainName = (chain: string): string => (Object.prototype.hasOwnProperty.call(copy.registry.chains, chain) ? copy.registry.chains[chain] : chain);

/** One transfer: a line that opens to its facts. A native disclosure, so it works by keyboard and screen reader with no script. */
export function TransferRow({ row, direction, label }: { row: LedgerRow; direction: Direction; label: string | null }) {
  const tx = row.tx;
  if (!tx) return null;
  const href = explorerTxHref(row.chain, tx.hash);
  const other = shortenAddress(row.address);
  return (
    <li className={row.unmatched ? 'ag-wrow ag-wrow--unmatched' : 'ag-wrow'}>
      <details>
        <summary className="ag-wrow__line">
          <time className="ag-wrow__time" dateTime={row.at}>
            {formatUtc(row.at)}
          </time>
          <span className="ag-wrow__amount ag-mono">{copy.ledger.amount(tx.amount, tx.asset)}</span>
          <span className="ag-wrow__usd">{usdLine(tx)}</span>
          <span className="ag-wrow__who ag-mono">{direction === 'in' ? copy.walletsPage.from(other) : copy.walletsPage.to(other)}</span>
          {row.counterparty ? <span className={COUNTERPARTY_CLASS[row.counterparty]}>{copy.ledger.counterparty[row.counterparty]}</span> : null}
          {row.unmatched ? <span className="ag-pill ag-pill--warn">{copy.walletsPage.unmatched}</span> : null}
        </summary>
        <div className="ag-wrow__more">
          <p className="ag-event__addr ag-mono">{row.address}</p>
          {label ? <p className="ag-event__line">{copy.ledger.addressLabel(label)}</p> : null}
          <p className="ag-event__line">{row.linkReason ? copy.ledger.linkReason[row.linkReason] : copy.ledger.inheritedFrom}</p>
          {row.unmatched ? <p className="ag-event__line ag-event__line--warn">{copy.ledger.unmatched}</p> : null}
          {row.contract ? <p className="ag-event__line">{copy.ledger.contractCall}</p> : null}
          <p className="ag-event__line ag-mono">
            {copy.ledger.hash(shortenAddress(tx.hash))}
            {href ? (
              <>
                {'  ·  '}
                <a className="ag-link" href={href} target="_blank" rel="noopener noreferrer">
                  {copy.ledger.chainTx}
                </a>
              </>
            ) : null}
          </p>
        </div>
      </details>
    </li>
  );
}

/** One window: a wallet's transfers in one direction, with its download beside it. */
export function TransferWindow({ box, direction, initial }: { box: Pick<WalletBox, 'agent' | 'wallet' | 'labels'>; direction: Direction; initial: WalletWindowData }) {
  const [rows, setRows] = useState<LedgerRow[]>(initial.rows);
  const [next, setNext] = useState<string | null>(initial.next);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const titleId = useId();
  const listId = useId();
  const short = shortenAddress(box.wallet.address);
  const ids = { tinId: box.agent.id, walletId: box.wallet.id, direction };

  async function loadMore() {
    if (!next || loading) return;
    setLoading(true);
    setMessage(null);
    const r = await send('GET', walletWindowUrl({ ...ids, before: next }));
    if (r.ok) {
      const more = parseLedgerRows(r.body?.events);
      setRows((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...more.filter((x) => !seen.has(x.id))];
      });
      setNext(typeof r.body?.next === 'string' ? r.body.next : null);
    } else {
      setMessage({ kind: 'bad', text: failureText(r) });
    }
    setLoading(false);
  }

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setMessage(null);
    const r = await requestWalletCsv(walletWindowUrl({ ...ids, csv: true }), `almstins-agent-wallet-${direction === 'in' ? 'received' : 'sent'}.csv`);
    if (r.ok) {
      saveBlob(r.blob, r.filename);
      setMessage({ kind: 'ok', text: copy.walletsPage.downloaded });
    } else {
      setMessage({ kind: 'bad', text: r.message });
    }
    setDownloading(false);
  }

  return (
    <section className="ag-window" aria-labelledby={titleId}>
      <div className="ag-window__head">
        <h3 className="ag-window__title" id={titleId}>
          {copy.walletsPage.windows[direction]}
        </h3>
        <span className="ag-card__meta">{rows.length ? copy.walletsPage.shown(rows.length, next !== null) : null}</span>
        <div className="ag-window__actions">
          <button
            className="ag-btn ag-btn--small"
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={copy.walletsPage.expandLabel[direction](short)}
            onClick={() => setExpanded((on) => !on)}
          >
            {expanded ? copy.walletsPage.collapse : copy.walletsPage.expand}
          </button>
          <button className="ag-btn ag-btn--small" type="button" aria-label={copy.walletsPage.downloadLabel[direction](short)} aria-disabled={downloading || undefined} onClick={() => void download()}>
            {downloading ? copy.walletsPage.downloading : copy.walletsPage.download}
          </button>
        </div>
      </div>
      {/* The list scrolls; it is focusable so the keyboard can scroll it too, and it says what it is. */}
      <div className={expanded ? 'ag-window__scroll ag-window__scroll--open' : 'ag-window__scroll'} id={listId} tabIndex={0} role="region" aria-label={copy.walletsPage.windowLabel[direction](short)}>
        {rows.length === 0 ? (
          <p className="ag-empty">{copy.walletsPage.windowEmpty[direction]}</p>
        ) : (
          <ul className="ag-wrows">
            {rows.map((row) => (
              <TransferRow key={row.id} row={row} direction={direction} label={box.labels[`${row.chain}|${row.address}`] ?? null} />
            ))}
          </ul>
        )}
        {next ? (
          <button className="ag-btn ag-btn--small ag-window__more" type="button" aria-disabled={loading || undefined} onClick={() => void loadMore()}>
            {loading ? copy.walletsPage.loading : copy.walletsPage.more}
          </button>
        ) : null}
      </div>
      <Status kind={message?.kind === 'bad' ? 'bad' : 'ok'}>{message?.text}</Status>
    </section>
  );
}

/** One wallet: whose it is, its address, and its two windows. */
export function WalletCard({ box }: { box: WalletBox }) {
  const headingId = useId();
  return (
    <section className="ag-card ag-card--spaced" aria-labelledby={headingId}>
      <div className="ag-card__head">
        <h2 className="ag-card__title" id={headingId}>
          <a className="ag-link" href={agentHref(box.agent.id)}>
            {copy.walletsPage.agent(box.agent.label)}
          </a>
        </h2>
        <span className="ag-pill">{chainName(box.wallet.chain)}</span>
      </div>
      <div className="ag-dest__main">
        <span className="ag-addr ag-mono">{box.wallet.address}</span>
        <VaultCopyButton value={box.wallet.address} />
        <WalletQrButton wallet={box.wallet} chainName={chainName(box.wallet.chain)} />
      </div>
      <div className="ag-windows">
        <TransferWindow box={box} direction="in" initial={box.received} />
        <TransferWindow box={box} direction="out" initial={box.sent} />
      </div>
    </section>
  );
}

/** Previous and next, and where this page sits. Plain links: each page is its own address. */
function Pager({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav className="ag-pager" aria-label={copy.walletsPage.pagerLabel}>
      {page > 1 ? (
        <a className="ag-btn ag-btn--small" href={walletsHref(page - 1)} rel="prev">
          {copy.walletsPage.prev}
        </a>
      ) : null}
      <span className="ag-card__meta">{copy.walletsPage.pageOf(page, pages)}</span>
      {page < pages ? (
        <a className="ag-btn ag-btn--small" href={walletsHref(page + 1)} rel="next">
          {copy.walletsPage.next}
        </a>
      ) : null}
    </nav>
  );
}

export default function WalletsPage({ data }: { data: WalletsPageData }) {
  const last = data.first ? data.first + data.wallets.length - 1 : 0;
  return (
    <div className="ag-page">
      <header className="ag-hero">
        <p className="ag-kicker">{copy.walletsPage.kicker}</p>
        <h1 className="ag-title">{copy.walletsPage.title}</h1>
        <p className="ag-sub">{copy.walletsPage.lede}</p>
      </header>
      {data.total === 0 ? (
        <p className="ag-empty">{copy.walletsPage.empty}</p>
      ) : (
        <>
          <div className="ag-pager-row">
            <span className="ag-card__meta">{copy.walletsPage.range(data.first, last, data.total)}</span>
            <Pager page={data.page} pages={data.pages} />
          </div>
          <p className="ag-hint">{copy.walletsPage.csvNote}</p>
          {data.wallets.map((box) => (
            <WalletCard key={box.wallet.id} box={box} />
          ))}
          <div className="ag-pager-row">
            <Pager page={data.page} pages={data.pages} />
          </div>
        </>
      )}
    </div>
  );
}
