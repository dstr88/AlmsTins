import { useState, useCallback } from 'react';

interface Row {
  date: string;
  description: string;
  expense: string;
  income: string;
}

const NUM_ROWS = 10;

function emptyRows(): Row[] {
  return Array.from({ length: NUM_ROWS }, () => ({ date: '', description: '', expense: '', income: '' }));
}

function parseNum(val: string): number {
  const n = parseFloat(val.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function QuickCalcTable() {
  const [rows, setRows] = useState<Row[]>(emptyRows);

  const update = useCallback((i: number, field: keyof Row, val: string) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }, []);

  const totalExpense = rows.reduce((s, r) => s + parseNum(r.expense), 0);
  const totalIncome  = rows.reduce((s, r) => s + parseNum(r.income), 0);
  const net = totalIncome - totalExpense;

  return (
    <div className="qct-wrap">
      <div className="pt-summary__divider" style={{ margin: '1.25rem 0 1rem' }} />
      <div className="pt-summary__title">Quick Calculator</div>
      <div className="qct-scroll">
        <table className="qct">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Expense</th>
              <th>Income</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="date"
                    className="qct-input qct-input--date"
                    value={row.date}
                    onChange={e => update(i, 'date', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="qct-input qct-input--desc"
                    placeholder="Description"
                    value={row.description}
                    onChange={e => update(i, 'description', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="qct-input qct-input--amount"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={row.expense}
                    onChange={e => update(i, 'expense', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="qct-input qct-input--amount"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={row.income}
                    onChange={e => update(i, 'income', e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="qct-totals">
              <td colSpan={2} className="qct-totals__label">Total</td>
              <td className="qct-totals__val loss">{fmt(totalExpense)}</td>
              <td className="qct-totals__val gain">{fmt(totalIncome)}</td>
            </tr>
            <tr className="qct-net">
              <td colSpan={2} className="qct-net__label">Net</td>
              <td colSpan={2} className={`qct-net__val ${net >= 0 ? 'gain' : 'loss'}`}>{fmt(Math.abs(net))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
