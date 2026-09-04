import { useState } from 'react';
import type { PetroTinEntry } from './types';
import './ExpenseGrid.css';

/** Evaluate "300", "=1200*0.25", or "=[Rent]*0.25".
 *  [Name] resolves against another row on the same grid, then a budget entry. */
export function evalFormula(
  input: string,
  rows?: Array<{ name: string; amount: number }>,
  budgetEntries?: Array<{ description: string; amount: number }>,
): number {
  let s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  let ok = true;
  s = s.replace(/\[([^\]]+)\]/g, (_m, name: string) => {
    const key = String(name).trim().toLowerCase();
    const row = rows?.find(r => r.name.toLowerCase() === key);
    if (row) return String(row.amount);
    const entry = budgetEntries?.find(e => (e.description ?? '').toLowerCase() === key);
    if (entry) return String(entry.amount);
    ok = false;
    return '0';
  });
  if (!ok) return NaN;
  if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
  try { return Function('"use strict"; return (' + s + ')')(); }
  catch { return NaN; }
}

export const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export type GridRow = { id: string; name: string; amount: number; raw: string };

export interface ExpenseGridProps {
  /** Blank for the spare grid. */
  title: string;
  rows: GridRow[];
  carried?: number;
  namePlaceholder?: string;
  budgetEntries?: PetroTinEntry[];
  onRename: (next: string) => void;
  onRemove?: () => void;
  onItemName?: (rowId: string, next: string) => void;
  onAmount?: (rowId: string, raw: string) => void;
  onAddRow?: (name: string, raw: string) => void;
  onRemoveRow?: (rowId: string, name: string) => void;
  /** Rows stay disabled until the grid has a name (used by the spare). */
  locked?: boolean;
}

/**
 * One expense grid: a name, rows of item + amount, and a total.
 *
 * The amount cell shows the money value and swaps to the underlying formula when you
 * click into it, the way a spreadsheet cell behaves. Import this once per person, plus
 * one spare — the row grows as more are needed.
 */
export default function ExpenseGrid({
  title, rows, carried = 0, namePlaceholder, budgetEntries = [],
  onRename, onRemove, onItemName, onAmount, onAddRow, onRemoveRow, locked,
}: ExpenseGridProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newAmt, setNewAmt] = useState('');

  const set = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const drop = (k: string) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });

  const lookup = rows.map(r => ({ name: r.name, amount: r.amount }));
  const calc = (raw: string) => evalFormula(raw, lookup, budgetEntries);

  const total = rows.reduce((s, r) => s + r.amount, 0) + carried;
  const preview = calc(newAmt);

  function commitNew() {
    if (locked || !onAddRow) return;
    if (!newName.trim() || !newAmt.trim() || isNaN(preview)) return;
    onAddRow(newName.trim(), newAmt.trim());
    setNewName(''); setNewAmt('');
  }

  return (
    <table className="xg">
      <thead>
        <tr>
          <th colSpan={3} className="xg__titlecell">
            <input
              className="xg__name"
              placeholder={namePlaceholder ?? 'Name'}
              value={draft.__n ?? title}
              onChange={e => set('__n', e.target.value)}
              onBlur={() => { const v = (draft.__n ?? '').trim(); drop('__n'); if (v && v !== title) onRename(v); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            {onRemove && <button className="xg__x" title="Remove" onClick={onRemove}>✕</button>}
          </th>
        </tr>
        <tr>
          <th>Item</th>
          <th className="xg__num">Amount</th>
          <th></th>
        </tr>
      </thead>

      <tbody>
        {rows.map(row => {
          const aKey = `a:${row.id}`, iKey = `i:${row.id}`;
          const editing = draft[aKey] !== undefined;
          const bad = editing && draft[aKey].trim() !== '' && isNaN(calc(draft[aKey]));
          return (
            <tr key={row.id}>
              <td>
                <input
                  value={draft[iKey] ?? row.name}
                  onChange={e => set(iKey, e.target.value)}
                  onBlur={() => { const v = (draft[iKey] ?? '').trim(); drop(iKey); if (v && v !== row.name) onItemName?.(row.id, v); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>
              <td className="xg__num">
                <input
                  className={bad ? 'xg__bad' : ''}
                  value={editing ? draft[aKey] : money(row.amount)}
                  onFocus={() => set(aKey, row.raw)}
                  onChange={e => set(aKey, e.target.value)}
                  onBlur={() => { const v = (draft[aKey] ?? '').trim(); drop(aKey); if (v && v !== row.raw) onAmount?.(row.id, v); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>
              <td>
                {onRemoveRow && (
                  <button className="xg__x" title="Remove row"
                    onClick={() => onRemoveRow(row.id, row.name)}>✕</button>
                )}
              </td>
            </tr>
          );
        })}

        {carried > 0 && (
          <tr>
            <td className="xg__muted">Carried from last month</td>
            <td className="xg__num xg__muted">{money(carried)}</td>
            <td></td>
          </tr>
        )}

        <tr>
          <td>
            <input placeholder={locked ? '' : 'Rent'} value={newName} disabled={locked}
              onChange={e => setNewName(e.target.value)} />
          </td>
          <td className="xg__num">
            <input placeholder={locked ? '' : '=[Rent]*0.25'} value={newAmt} disabled={locked}
              onChange={e => setNewAmt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitNew(); }}
              onBlur={commitNew} />
          </td>
          <td></td>
        </tr>
      </tbody>

      <tfoot>
        <tr>
          <td className="xg__foot">Total</td>
          <td className="xg__foot xg__num xg__total">{money(total)}</td>
          <td className="xg__foot"></td>
        </tr>
      </tfoot>
    </table>
  );
}
