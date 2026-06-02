import type { PetroTin } from './types';
import './CreditCardChargesGrid.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

interface Props {
  debtTins: PetroTin[];
}

export default function CreditCardChargesGrid({ debtTins }: Props) {
  const curMonth = thisMonth();

  // Build rows: one per recurring charge across all cards
  const rows = debtTins.flatMap(tin => {
    const recurring = (tin.entries ?? []).filter(
      e => e.isDefault && e.kind === 'charge' && e.entryDate.startsWith(curMonth)
    );
    return recurring.map(e => {
      const balance  = tin.balance ?? 0;
      const limit    = tin.creditLimit ?? 0;
      const overLimit = limit > 0 && (balance + e.amount) > limit;
      const nearLimit = limit > 0 && !overLimit && (balance + e.amount) > limit * 0.9;
      return { tin, entry: e, overLimit, nearLimit };
    });
  });

  if (rows.length === 0) return null;

  return (
    <div className="cc-charges-grid">
      <div className="cc-charges-grid__title">Recurring charges across cards</div>
      <table className="cc-charges-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Expense</th>
            <th className="cc-col-amt">Amount</th>
            <th className="cc-col-status">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ tin, entry, overLimit, nearLimit }) => (
            <tr key={entry.id} className={overLimit ? 'cc-row--over' : nearLimit ? 'cc-row--near' : ''}>
              <td className="cc-col-card">
                <span className="cc-card-name">{tin.name}</span>
              </td>
              <td className="cc-col-desc">
                <span className={entry.checked ? 'cc-desc cc-desc--posted' : 'cc-desc'}>
                  {entry.description}
                </span>
                {entry.checked && <span className="cc-posted-badge">posted</span>}
              </td>
              <td className="cc-col-amt">
                <span className="cc-amount loss">{fmt(entry.amount)}</span>
              </td>
              <td className="cc-col-status">
                {overLimit ? (
                  <span className="cc-warning cc-warning--over" title={`Balance ${fmt(tin.balance ?? 0)} + charge ${fmt(entry.amount)} = ${fmt((tin.balance ?? 0) + entry.amount)} — exceeds ${fmt(tin.creditLimit ?? 0)} limit`}>
                    ⚠ Over limit
                  </span>
                ) : nearLimit ? (
                  <span className="cc-warning cc-warning--near" title={`Will reach ${(((tin.balance ?? 0) + entry.amount) / (tin.creditLimit ?? 1) * 100).toFixed(0)}% utilization`}>
                    ⚡ Near limit
                  </span>
                ) : (
                  <span className="cc-ok">✓</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="cc-foot-label">Total recurring this month</td>
            <td className="cc-col-amt cc-foot-total loss">{fmt(rows.reduce((s, r) => s + r.entry.amount, 0))}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
