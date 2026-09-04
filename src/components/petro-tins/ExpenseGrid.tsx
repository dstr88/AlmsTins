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
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `raw` is what was typed: a formula like "=[Rent]*0.25", or just a number. */
export type GridRow = { id: string; name: string; amount: number; raw: string };

const isFormula = (raw: string) => raw.trim().startsWith('=') || /\[[^\]]+\]/.test(raw);

export interface ExpenseGridProps {
  title: string;
  rows: GridRow[];
  carried?: number;
  namePlaceholder?: string;
  budgetEntries?: PetroTinEntry[];
  onRename: (next: string) => void;
  onRemove?: () => void;
  onItemName?: (rowId: string, next: string) => void;
  /** Saves whatever was typed — a formula or a plain number. */
  onAmount?: (rowId: string, raw: string) => void;
  onAddRow?: (name: string, raw: string) => void;
  onRemoveRow?: (rowId: string, name: string) => void;
  locked?: boolean;
}

/**
 * One expense grid: item, the formula behind it, and the amount it comes to.
 *
 * The formula column holds the working (e.g. =[Rent]*0.25) and stays blank when a row is
 * just a number. Editing either the formula or the amount updates the row; typing a plain
 * number into the amount clears the formula.
 */
export default function ExpenseGrid({
  title, rows, carried = 0, namePlaceholder, budgetEntries = [],
  onRename, onRemove, onItemName, onAmount, onAddRow, onRemoveRow, locked,
}: ExpenseGridProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newFormula, setNewFormula] = useState('');
  const [newAmt, setNewAmt] = useState('');

  const set = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const drop = (k: string) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });

  const lookup = rows.map(r => ({ name: r.name, amount: r.amount }));
  const calc = (raw: string) => evalFormula(raw, lookup, budgetEntries);
  const total = rows.reduce((s, r) => s + r.amount, 0) + carried;

  function commitNew() {
    if (locked || !onAddRow) return;
    const name = newName.trim();
    const raw = (newFormula.trim() || newAmt.trim());
    if (!name || !raw || isNaN(calc(raw))) return;
    onAddRow(name, raw);
    setNewName(''); setNewFormula(''); setNewAmt('');
  }

  return (
    <table className="xg">
      <tbody>
        {/* Name sits in the middle column, as in a sheet */}
        <tr className="xg__namerow">
          <td></td>
          <td>
            <input
              className="xg__name"
              placeholder={namePlaceholder ?? 'Name'}
              value={draft.__n ?? title}
              onChange={e => set('__n', e.target.value)}
              onBlur={() => { const v = (draft.__n ?? '').trim(); drop('__n'); if (v && v !== title) onRename(v); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
          </td>
          <td className="xg__right">
            {onRemove && <button className="xg__x" title="Remove" onClick={onRemove}>✕</button>}
          </td>
        </tr>

        {rows.map(row => {
          const iKey = `i:${row.id}`, fKey = `f:${row.id}`, aKey = `a:${row.id}`;
          const shownFormula = draft[fKey] ?? (isFormula(row.raw) ? row.raw : '');
          const badFormula = shownFormula.trim() !== '' && isNaN(calc(shownFormula));
          return (
            <tr key={row.id} className="xg__row">
              <td className="xg__item">
                <input
                  value={draft[iKey] ?? row.name}
                  onChange={e => set(iKey, e.target.value)}
                  onBlur={() => { const v = (draft[iKey] ?? '').trim(); drop(iKey); if (v && v !== row.name) onItemName?.(row.id, v); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                {onRemoveRow && (
                  <button className="xg__x xg__rowx" title="Remove row"
                    onClick={() => onRemoveRow(row.id, row.name)}>✕</button>
                )}
              </td>

              <td className="xg__formula">
                <input
                  className={badFormula ? 'xg__bad' : ''}
                  placeholder="formula"
                  value={shownFormula}
                  onChange={e => set(fKey, e.target.value)}
                  onBlur={() => {
                    const v = (draft[fKey] ?? '').trim();
                    drop(fKey);
                    if (v && v !== row.raw && !isNaN(calc(v))) onAmount?.(row.id, v);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>

              <td className="xg__amount">
                <input
                  value={draft[aKey] ?? money(row.amount)}
                  onFocus={() => set(aKey, isFormula(row.raw) ? String(row.amount) : row.raw)}
                  onChange={e => set(aKey, e.target.value)}
                  onBlur={() => {
                    const v = (draft[aKey] ?? '').trim();
                    drop(aKey);
                    // Typing a number here replaces the row's working with that number.
                    if (v && !isNaN(calc(v)) && v !== row.raw) onAmount?.(row.id, v);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>
            </tr>
          );
        })}

        {carried > 0 && (
          <tr className="xg__row">
            <td className="xg__item xg__muted">Carried</td>
            <td className="xg__formula"></td>
            <td className="xg__amount xg__muted">{money(carried)}</td>
          </tr>
        )}

        <tr className="xg__row">
          <td className="xg__item">
            <input placeholder={locked ? '' : 'item'} value={newName} disabled={locked}
              onChange={e => setNewName(e.target.value)} />
          </td>
          <td className="xg__formula">
            <input placeholder={locked ? '' : 'formula'} value={newFormula} disabled={locked}
              onChange={e => setNewFormula(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitNew(); }}
              onBlur={commitNew} />
          </td>
          <td className="xg__amount">
            <input placeholder={locked ? '' : '0'} value={newAmt} disabled={locked}
              onChange={e => setNewAmt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitNew(); }}
              onBlur={commitNew} />
          </td>
        </tr>

        <tr className="xg__totalrow">
          <td className="xg__item">Total</td>
          <td className="xg__formula"></td>
          <td className="xg__amount xg__total">{money(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
