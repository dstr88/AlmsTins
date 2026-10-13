import type { WalletActivity } from '@/lib/walletActivity';
import { emptyActivity, isNotCovered, isUnread, showNewWalletNote } from '@/lib/walletActivity';
import { fillTemplate } from '@/lib/verifyPublicCard';
import type { WalletCheckerLocale } from '@/i18n/walletChecker';
import './WalletActivityPanel.css';

type CheckerStrings = WalletCheckerLocale['checker'];

function fmt(iso: string | null, locale: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  } catch { return '—'; }
}

/**
 * The wallet checker's Activity tab: first and last activity (with the chain each was found
 * on), the native balance and the transaction count, then which chains were read and which
 * were not. Facts only; nothing here is part of the verdict. The facts come from their own
 * request (/api/wallet-activity), loaded after the verdict: `status` is 'loading' until it
 * answers and 'failed' when it did not.
 *
 * A dash means unknown. "None found" is shown only when every chain with a source was read,
 * so an unread chain is never presented as "new" or "no history"; while one is unread, a
 * date found elsewhere is only "on or before" (first) or "on or after" (last). The new-wallet
 * note is a caution (amber) that states both sides, and follows showNewWalletNote() in
 * src/lib/walletActivity.ts.
 *
 * `now` is injectable for tests; it defaults to the render time.
 */
export default function WalletActivityPanel({ activity, status, chain, c, now = Date.now() }: {
  activity: WalletActivity | null;
  status?: 'loading' | 'failed';
  chain: string;
  c: CheckerStrings;
  now?: number;
}) {
  // No activity source for Bitcoin, Litecoin, Tron, Solana or an unknown chain: say so,
  // rather than a grid of dashes and a source line about explorers that were never asked.
  if (chain !== 'evm' && chain !== 'sui') {
    return (
      <div className="wallet-activity">
        <p className="wallet-activity__unknown">{c.activityNotAvailable}</p>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="wallet-activity">
        <p className="wallet-activity__unknown" role="status">{c.activityLoading}</p>
      </div>
    );
  }

  const failed = status === 'failed' || !activity;
  const a = failed ? emptyActivity() : activity;
  const chains = a.chains ?? [];
  const checked = chains.filter((x) => x.checked);
  const unread = chains.filter(isUnread);
  const notCovered = chains.filter(isNotCovered);
  const multiChain = chains.length > 1;
  const readSomething = checked.length > 0;
  const date = (iso: string | null) => fmt(iso, c.dateLocale);

  // "None found" only when nothing could hide elsewhere; older results (no chain list) and
  // partial reads keep the plain dash.
  const firstValue = a.firstSeen
    ? (a.firstSeenComplete === false ? fillTemplate(c.activityOnOrBefore, { date: date(a.firstSeen) }) : date(a.firstSeen))
    : (readSomething && a.firstSeenComplete !== false ? c.activityNoneFound : '—');
  const lastValue = a.lastActivity
    ? (a.lastActivityComplete === false ? fillTemplate(c.activityOnOrAfter, { date: date(a.lastActivity) }) : date(a.lastActivity))
    : (readSomething && a.lastActivityComplete !== false ? c.activityNoneFound : '—');
  const txValue = a.txCount === null
    ? '—'
    : `${a.txCount.toLocaleString(c.dateLocale)}${a.txCountIsMinimum ? '+' : ''}`;
  const onChain = (name: string | null | undefined) =>
    multiChain && name ? fillTemplate(c.activityOnChain, { chain: name }) : null;

  const stats: Array<{ label: string; value: string; on?: string | null }> = [
    { label: c.firstSeen,    value: firstValue, on: a.firstSeen ? onChain(a.firstSeenChain) : null },
    { label: c.lastActivity, value: lastValue,  on: a.lastActivity ? onChain(a.lastActivityChain) : null },
    { label: chain === 'sui' ? c.suiBalance : c.ethBalance, value: a.ethBalance ?? '—' },
    { label: a.txCountBasis === 'all' ? c.txCountAll : c.txCount, value: txValue },
  ];
  const names = (list: typeof chains) => list.map((x) => x.name).join(', ');

  return (
    <div className="wallet-activity">
      <div className="wallet-activity__stats">
        {stats.map(({ label, value, on }) => (
          <div key={label} className="wallet-activity__stat">
            <p className="wallet-activity__stat-label">{label}</p>
            <p className="wallet-activity__stat-value">{value}</p>
            {on && <p className="wallet-activity__stat-chain">{on}</p>}
          </div>
        ))}
      </div>

      {showNewWalletNote(a, now) && (
        <div className="wallet-activity__note" role="note">
          <span aria-hidden="true">⚠ </span>{c.newWalletNote}
        </div>
      )}

      {(failed || (chains.length > 0 && !readSomething)) && (
        <p className="wallet-activity__unknown">{c.activityUnknownNote}</p>
      )}

      {/* Right under the facts it qualifies: checking again may fill these in. */}
      {unread.length > 0 && (
        <p className="wallet-activity__not-checked">
          {fillTemplate(c.activityNotRead, { chains: names(unread) })}
        </p>
      )}

      {multiChain && readSomething && (
        <div className="wallet-activity__chains">
          <p className="wallet-activity__heading">{c.activityByChain}</p>
          <ul className="wallet-activity__chain-list">
            {checked.map((x) => (
              <li key={x.id} className="wallet-activity__chain">
                <span className="wallet-activity__chain-name">{x.name}</span>
                <span className="wallet-activity__chain-detail">
                  {x.firstSeen
                    ? `${date(x.firstSeen)} – ${x.lastActivityComplete === false
                      ? fillTemplate(c.activityOnOrAfter, { date: date(x.lastActivity) })
                      : date(x.lastActivity)}`
                    : c.activityChainNone}
                  {x.firstSeen && x.txCount !== null &&
                    ` · ${fillTemplate(c.activityChainSent, { n: x.txCount.toLocaleString(c.dateLocale) })}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notCovered.length > 0 && (
        <p className="wallet-activity__not-checked">
          {fillTemplate(c.activityNotCovered, { chains: names(notCovered) })}
        </p>
      )}

      <p className="wallet-activity__source">
        {chain === 'sui' ? c.activitySourceSui : c.activitySource}
      </p>
    </div>
  );
}
