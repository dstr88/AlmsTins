/**
 * Where money came from: every address that sent money to one of the account's agents' own wallets in a
 * year, largest first, each a line that opens to what it sent, when, to which agent, and its latest
 * transfers with their hashes. Shown on the Agentics History page and, for an account with agents, on
 * Memory Lane, from the same data (src/lib/agentVault/vaultPages.ts loadMoneySources).
 *
 * Static on purpose: a line opens with a native disclosure, and the year and agent are plain links, so
 * the list works with no script, and a page can render it without hydrating it. Built from the ledger's
 * own parts: its status pills (COUNTERPARTY_CLASS), its USD wording (usdLine), its explorer links. Every
 * value that came from the registry or the chain (an address, a label, a token's symbol, an agent's name)
 * is rendered as text by React, which escapes it.
 */
import { shortenAddress } from '@/lib/addressDisplay';
import { formatUsd, formatUtc } from '@/lib/agentVault/reportFormat';
import type { MoneySource } from '@/lib/agentVault/moneySources';
import type { MoneySourcesData } from '@/lib/agentVault/vaultPages';
import type { SideTotal } from '@/lib/agentVault/money';
import { copy } from './copy';
import { COUNTERPARTY_CLASS, usdLine } from './LedgerPanel';
import { explorerTxHref, historyHref, WALLETS_PATH } from './paths';

const chainName = (chain: string): string => (Object.prototype.hasOwnProperty.call(copy.registry.chains, chain) ? copy.registry.chains[chain] : chain);
const day = (iso: string): string => iso.slice(0, 10);

/** A sum of USD values as a line: the total at the time, and how many had none. Never "$0.00" for values that are missing. */
function totalLine(t: SideTotal): string {
  const parts: string[] = [];
  if (t.pricedCount > 0) parts.push(t.usd > 0 && t.usd < 0.01 ? copy.ledger.usdUnderCent : copy.sources.total(formatUsd(t.usd)));
  if (t.unpricedCount > 0) parts.push(t.pricedCount > 0 ? copy.sources.withoutValue(t.unpricedCount) : copy.sources.noUsd);
  return parts.join(', ');
}

/** Who a sender is, in the account's own words where it has them; its short address otherwise. */
function nameOf(s: MoneySource): string {
  if (s.ownWalletOf) return copy.sources.ownWallet(s.ownWalletOf);
  return s.label ?? shortenAddress(s.address);
}

function SourceRow({ source: s }: { source: MoneySource }) {
  const amounts = s.assets.map((a) => copy.ledger.amount(a.amount, a.asset)).join(', ');
  const earlier = s.usd.count - s.recent.length;
  return (
    <li className={s.status === 'unregistered' ? 'ag-source ag-source--unlisted' : 'ag-source'}>
      <details>
        <summary className="ag-source__line">
          <span className="ag-source__who">{nameOf(s)}</span>
          {s.status ? <span className={COUNTERPARTY_CLASS[s.status]}>{copy.ledger.counterparty[s.status]}</span> : null}
          <span className="ag-source__chain">{chainName(s.chain)}</span>
          <span className="ag-source__usd">{totalLine(s.usd)}</span>
          <span className="ag-source__count">{copy.sources.transfers(s.usd.count)}</span>
          <span className="ag-source__last">{copy.sources.last(day(s.lastAt))}</span>
        </summary>
        <div className="ag-source__more">
          <p className="ag-event__addr ag-mono">{s.address}</p>
          {s.ownWalletOf && s.label ? <p className="ag-event__line">{copy.ledger.addressLabel(s.label)}</p> : null}
          <p className="ag-event__line ag-mono">{copy.sources.sent(amounts)}</p>
          <p className="ag-event__line">{copy.sources.span(day(s.firstAt), day(s.lastAt))}</p>
          <p className="ag-event__line">{copy.sources.toAgents(s.agents.join(', '))}</p>
          {s.contract ? <p className="ag-event__line">{copy.sources.contract}</p> : null}
          {s.pendingCount > 0 ? <p className="ag-event__line">{copy.sources.pending(s.pendingCount)}</p> : null}
          <ol className="ag-source__recent" aria-label={copy.sources.recentLabel}>
            {s.recent.map((t) => {
              const href = explorerTxHref(s.chain, t.hash);
              return (
                <li key={t.id} className="ag-source__tx">
                  <time dateTime={t.at}>{formatUtc(t.at)}</time>
                  <span className="ag-mono">{copy.ledger.amount(t.amount, t.asset)}</span>
                  <span>{usdLine(t)}</span>
                  <span>{copy.sources.toAgent(t.agent)}</span>
                  <span className="ag-mono">
                    {href ? (
                      <a className="ag-link" href={href} target="_blank" rel="noopener noreferrer">
                        {copy.ledger.hash(shortenAddress(t.hash))}
                      </a>
                    ) : (
                      copy.ledger.hash(shortenAddress(t.hash))
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {earlier > 0 ? (
            <p className="ag-event__line">
              {copy.sources.more(earlier)}{' '}
              <a className="ag-link" href={WALLETS_PATH}>
                {copy.sources.seeWallets}
              </a>
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export interface MoneySourcesProps {
  data: MoneySourcesData;
  /** The page the year and agent links go to (the History page, or Memory Lane). */
  base: string;
  /** Whether to show the year links. A page with its own year picker leaves them out. */
  yearLinks?: boolean;
}

export default function MoneySources({ data, base, yearLinks = true }: MoneySourcesProps) {
  const { year, total } = data;
  const titleId = `ag-sources-title-${year}`;
  return (
    <section className="ag-card ag-sources" aria-labelledby={titleId}>
      <h2 id={titleId} className="ag-sources__title">
        {copy.sources.title}
      </h2>
      <p className="ag-sources__lede">{copy.sources.lede(year)}</p>

      {yearLinks && data.years.length > 1 ? (
        <nav className="ag-sources__pick" aria-label={copy.historyPage.yearsLabel}>
          {data.years.map((y) => (
            <a key={y} className="ag-chip" href={historyHref(base, y, data.agentId)} aria-current={y === year ? 'page' : undefined}>
              {y}
            </a>
          ))}
        </nav>
      ) : null}

      {data.agents.length > 1 ? (
        <nav className="ag-sources__pick" aria-label={copy.historyPage.agentsLabel}>
          <a className="ag-chip" href={historyHref(base, year, null)} aria-current={data.agentId === null ? 'page' : undefined}>
            {copy.historyPage.allAgents}
          </a>
          {data.agents.map((a) => (
            <a key={a.id} className="ag-chip" href={historyHref(base, year, a.id)} aria-current={data.agentId === a.id ? 'page' : undefined}>
              {a.label}
            </a>
          ))}
        </nav>
      ) : null}

      {data.agents.length === 0 ? (
        <p className="ag-empty">{copy.sources.noAgents}</p>
      ) : total.senders === 0 ? (
        <p className="ag-empty">{copy.sources.empty(year)}</p>
      ) : (
        <>
          <dl className="ag-sources__totals">
            <div>
              <dt>{copy.sources.received(year)}</dt>
              <dd>
                {totalLine(total.usd)}
                <span className="ag-sources__sub">{copy.sources.transfers(total.usd.count)}</span>
              </dd>
            </div>
            <div>
              <dt>{copy.sources.senders}</dt>
              <dd>{total.senders.toLocaleString('en-US')}</dd>
            </div>
            <div className={total.notOnList.usd.count > 0 ? 'ag-sources__warn' : undefined}>
              <dt>{copy.sources.notOnList}</dt>
              <dd>
                {total.notOnList.usd.count > 0 ? totalLine(total.notOnList.usd) : copy.sources.notOnListNone}
                {total.notOnList.usd.count > 0 ? <span className="ag-sources__sub">{copy.sources.transfers(total.notOnList.usd.count)}</span> : null}
              </dd>
            </div>
          </dl>
          {total.pendingCount > 0 ? <p className="ag-sources__note">{copy.sources.pending(total.pendingCount)}</p> : null}
          {data.truncated ? <p className="ag-sources__note">{copy.sources.truncated(total.usd.count)}</p> : null}
          <ol className="ag-sources__list" aria-label={copy.sources.listLabel(year)}>
            {data.sources.map((s) => (
              <SourceRow key={s.key} source={s} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
