import type { PetroTin } from './types';
import './DebtTin.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function fmtPct(r: number) {
  return (r * 100).toFixed(2) + '%';
}

interface Props {
  tin: PetroTin;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddEntry: (id: string) => void;
}

export default function DebtTin({ tin, onEdit, onDelete, onAddEntry }: Props) {
  const bal = tin.balance ?? 0;
  const limit = tin.creditLimit ?? 0;
  const apr = tin.apr ?? 0;
  const pct = limit > 0 ? Math.min(100, (bal / limit) * 100) : 0;
  const monthly = bal * (apr / 12);
  const isSample = tin.notes === '__sample__';

  const entries = tin.entries ?? [];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthEntries = entries.filter(e => e.entryDate.startsWith(thisMonth));

  return (
    <div className="pt-debt-tin" data-tin-id={tin.id}>
      {isSample && <span className="pt-debt-tin__sample">sample</span>}
      <span className="pt-debt-tin__label">Debt</span>

      <div className="pt-debt-tin__header">
        <span className="pt-debt-tin__name">{tin.name}</span>
        <div className="pt-debt-tin__actions">
          <button className="pt-debt-tin__icon-btn" title="Edit" onClick={() => onEdit(tin.id)}>✏️</button>
          <button className="pt-debt-tin__icon-btn pt-debt-tin__icon-btn--del" title="Delete" onClick={() => onDelete(tin.id)}>🗑</button>
        </div>
      </div>

      {limit > 0 && (
        <div className="pt-debt-tin__progress-wrap">
          <div className="pt-debt-tin__progress-track">
            <div
              className="pt-debt-tin__progress-fill"
              style={{ width: `${pct.toFixed(1)}%` }}
            />
          </div>
          <div className="pt-debt-tin__progress-labels">
            <span className="pt-debt-tin__progress-pct">{pct.toFixed(0)}% of {fmt(limit)}</span>
          </div>
        </div>
      )}

      <div className="pt-debt-tin__nums">
        <div className="pt-debt-tin__num-row">
          <span className="pt-debt-tin__num-label">Balance</span>
          <span className="pt-debt-tin__num-value loss">{fmt(bal)}</span>
        </div>
        <div className="pt-debt-tin__num-row">
          <span className="pt-debt-tin__num-label">APR</span>
          <span className="pt-debt-tin__num-value">{apr ? fmtPct(apr) : '—'}</span>
        </div>
        <div className="pt-debt-tin__num-row">
          <span className="pt-debt-tin__num-label">Monthly interest</span>
          <span className="pt-debt-tin__num-value loss">{fmt(monthly)}</span>
        </div>
        {tin.minPayment != null && (
          <div className="pt-debt-tin__num-row">
            <span className="pt-debt-tin__num-label">Min payment</span>
            <span className="pt-debt-tin__num-value">{fmt(tin.minPayment)}</span>
          </div>
        )}
      </div>

      <div className="pt-debt-tin__accordion">
        <details className="pt-debt-tin__details">
          <summary className="pt-debt-tin__summary">
            Payments &amp; charges ({monthEntries.length})
          </summary>
          <div className="pt-debt-tin__entries">
            {monthEntries.length === 0
              ? <p className="pt-debt-tin__no-entries">No entries this month.</p>
              : monthEntries.map(e => (
                <div className="pt-debt-tin__entry" key={e.id}>
                  <div className="pt-debt-tin__entry-left">
                    <span className={`pt-debt-tin__entry-kind ${e.kind}`}>{e.kind}</span>
                    <span className="pt-debt-tin__entry-desc">{e.description}</span>
                    <span className="pt-debt-tin__entry-date">{e.entryDate}</span>
                  </div>
                  <span className={`pt-debt-tin__entry-amount ${e.kind}`}>{fmt(e.amount)}</span>
                </div>
              ))
            }
          </div>
        </details>
      </div>

      <div className="pt-debt-tin__footer">
        <button className="pt-debt-tin__add-btn" onClick={() => onAddEntry(tin.id)}>
          ＋ Add entry
        </button>
      </div>
    </div>
  );
}
