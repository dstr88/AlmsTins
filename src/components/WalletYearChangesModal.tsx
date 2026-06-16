import { useState, useEffect } from 'react';
import './wallet-year-changes.css';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getWalletYearChanges } from '@/i18n/components/walletYearChanges';

interface YearChangesData {
  ok: boolean;
  walletId: string;
  walletLabel: string;
  year: number;
  startDate: string;
  endDate: string;
  holdingsDelta: Array<{ symbol: string; startQty: number; endQty: number; deltaQty: number; endValueUsd: number }>;
  netChange: Array<{ symbol: string; netQty: number }>;
  transactions: Array<{ id: string; date: string; type: string; asset: string; amount: number; usdValue: number; description: string }>;
}

interface Props {
  walletId: string;
  year: number;
  onClose: () => void;
}

export default function WalletYearChangesModal({ walletId, year, onClose }: Props) {
  const t = getWalletYearChanges(getClientLang());
  const [data, setData] = useState<YearChangesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'delta' | 'netChange' | 'transactions'>('delta');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/wallet/year-changes?walletId=${walletId}&year=${year}`);
        if (!res.ok) throw new Error('Failed to fetch wallet changes');
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'Unknown error');
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [walletId, year]);

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  const fmtUsd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="wallet-modal-backdrop" onClick={onClose}>
      <div className="wallet-modal" onClick={e => e.stopPropagation()}>
        <div className="wallet-modal__header">
          <div>
            <h2 className="wallet-modal__title">{data?.walletLabel}</h2>
            <p className="wallet-modal__subtitle">{t.changesTitle(year)}</p>
          </div>
          <button className="wallet-modal__close" onClick={onClose} aria-label={t.closeBtn}>✕</button>
        </div>

        {loading && (
          <div className="wallet-modal__body wallet-modal__body--loading">
            <p>{t.loading}</p>
          </div>
        )}

        {error && (
          <div className="wallet-modal__body wallet-modal__body--error">
            <p>⚠️ {error}</p>
          </div>
        )}

        {data && (
          <>
            <div className="wallet-modal__tabs">
              <button
                className={`wallet-modal__tab ${activeTab === 'delta' ? 'wallet-modal__tab--active' : ''}`}
                onClick={() => setActiveTab('delta')}
              >
                {t.tabHoldingsDelta}
              </button>
              <button
                className={`wallet-modal__tab ${activeTab === 'netChange' ? 'wallet-modal__tab--active' : ''}`}
                onClick={() => setActiveTab('netChange')}
              >
                {t.tabNetChange}
              </button>
              <button
                className={`wallet-modal__tab ${activeTab === 'transactions' ? 'wallet-modal__tab--active' : ''}`}
                onClick={() => setActiveTab('transactions')}
              >
                {t.tabTransactions}
              </button>
            </div>

            <div className="wallet-modal__body">
              {/* Holdings Delta Tab */}
              {activeTab === 'delta' && (
                <div className="wallet-modal__content">
                  <p className="wallet-modal__content-label">{t.dateRange(data.startDate, data.endDate)}</p>
                  {data.holdingsDelta.length === 0 ? (
                    <p className="wallet-modal__empty">{t.emptyHoldings(year)}</p>
                  ) : (
                    <table className="wallet-modal__table">
                      <thead>
                        <tr>
                          <th>{t.colAsset}</th>
                          <th align="right">{t.colStart}</th>
                          <th align="right">{t.colEnd}</th>
                          <th align="right">{t.colChange}</th>
                          <th align="right">{t.colEndValue}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.holdingsDelta.map(row => (
                          <tr key={row.symbol}>
                            <td className="wallet-modal__col-symbol">{row.symbol}</td>
                            <td align="right" className="wallet-modal__col-qty">{fmt(row.startQty)}</td>
                            <td align="right" className="wallet-modal__col-qty">{fmt(row.endQty)}</td>
                            <td align="right" className={`wallet-modal__col-qty ${row.deltaQty > 0 ? 'wallet-modal__col--positive' : row.deltaQty < 0 ? 'wallet-modal__col--negative' : ''}`}>
                              {row.deltaQty > 0 ? '+' : ''}{fmt(row.deltaQty)}
                            </td>
                            <td align="right" className="wallet-modal__col-usd">{fmtUsd(row.endValueUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Net Change Tab */}
              {activeTab === 'netChange' && (
                <div className="wallet-modal__content">
                  {data.netChange.length === 0 ? (
                    <p className="wallet-modal__empty">{t.emptyNetChange(year)}</p>
                  ) : (
                    <table className="wallet-modal__table">
                      <thead>
                        <tr>
                          <th>{t.colAsset}</th>
                          <th align="right">{t.colNetChange}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.netChange.map(row => (
                          <tr key={row.symbol}>
                            <td className="wallet-modal__col-symbol">{row.symbol}</td>
                            <td align="right" className={`wallet-modal__col-qty ${row.netQty > 0 ? 'wallet-modal__col--positive' : 'wallet-modal__col--negative'}`}>
                              {row.netQty > 0 ? '+' : ''}{fmt(row.netQty)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Transactions Tab */}
              {activeTab === 'transactions' && (
                <div className="wallet-modal__content">
                  {data.transactions.length === 0 ? (
                    <p className="wallet-modal__empty">{t.emptyTransactions(year)}</p>
                  ) : (
                    <table className="wallet-modal__table">
                      <thead>
                        <tr>
                          <th>{t.colDate}</th>
                          <th>{t.colType}</th>
                          <th>{t.colAsset}</th>
                          <th align="right">{t.colAmount}</th>
                          <th align="right">{t.colUsdValue}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map(tx => (
                          <tr key={tx.id} title={tx.description}>
                            <td className="wallet-modal__col-date">{tx.date}</td>
                            <td className={`wallet-modal__col-type ${tx.type === 'Receive' ? 'wallet-modal__col-type--receive' : 'wallet-modal__col-type--send'}`}>
                              {tx.type}
                            </td>
                            <td className="wallet-modal__col-symbol">{tx.asset}</td>
                            <td align="right" className="wallet-modal__col-qty">{fmt(tx.amount)}</td>
                            <td align="right" className="wallet-modal__col-usd">{fmtUsd(tx.usdValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
