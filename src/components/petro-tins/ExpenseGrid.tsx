import { useRef, useState } from 'react';
import type { PetroTinEntry } from './types';
import './ExpenseGrid.css';

/** The parts of a budget entry that a bracketed name needs. */
type BudgetRef = { description: string; amount: number; entryDate?: string };

/**
 * Which budget entry "[Name]" means. The register keeps every month, so the first entry
 * with that description is the oldest one (an "Electric" from June), which is not the bill
 * being split. This takes this month's entry; if the name has none yet this month, the most
 * recent earlier month; and only if every match is in a later month, the nearest of those.
 * Entries with no date fall back to the first match.
 */
export function budgetEntryFor(
  name: string,
  entries: BudgetRef[] | undefined,
  month: string = new Date().toISOString().slice(0, 7),
): BudgetRef | undefined {
  const key = name.trim().toLowerCase();
  const matches = (entries ?? []).filter(e => (e.description ?? '').toLowerCase() === key);
  const dated = matches.filter(e => e.entryDate);
  if (dated.length === 0) return matches[0];
  const thisMonth = dated.find(e => e.entryDate!.startsWith(month));
  if (thisMonth) return thisMonth;
  const newestFirst = [...dated].sort((a, b) => b.entryDate!.localeCompare(a.entryDate!));
  return newestFirst.find(e => e.entryDate!.slice(0, 7) < month) ?? newestFirst[newestFirst.length - 1];
}

/** Evaluate "300", "=1200*0.25", or "=[Rent]*0.25".
 *  [Name] resolves against another row on the same grid, then a budget entry (this month's,
 *  see budgetEntryFor). `month` is YYYY-MM and only needs passing in tests. */
export function evalFormula(
  input: string,
  rows?: Array<{ name: string; amount: number }>,
  budgetEntries?: BudgetRef[],
  month?: string,
): number {
  let s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  let ok = true;
  s = s.replace(/\[([^\]]+)\]/g, (_m, name: string) => {
    const key = String(name).trim().toLowerCase();
    const row = rows?.find(r => r.name.toLowerCase() === key);
    if (row) return String(row.amount);
    const entry = budgetEntryFor(name, budgetEntries, month);
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
export type GridRow = { id: string; name: string; amount: number; raw: string; deposit: number };

const isFormula = (raw: string) => raw.trim().startsWith('=') || /\[[^\]]+\]/.test(raw);

/**
 * What leaving the formula cell should save, or null for "nothing". `typed` is the draft:
 * undefined means the cell was never typed in. Clicking in just to read a formula (it is cut
 * off in the narrow column) and clicking away is not an edit. It used to save an empty
 * formula, which erased the one that was there and left the old figure standing.
 */
export function formulaCommit(typed: string | undefined, raw: string): string | null {
  if (typed === undefined) return null;
  const v = typed.trim();
  return v !== (isFormula(raw) ? raw : '') ? v : null;
}

/**
 * What leaving the amount cell should save, or null for "nothing". `seed` is what focusing
 * put in the cell: a formula row's computed figure, or a plain row's number. Only a change
 * from that is an edit. Leaving it alone used to overwrite the formula with its own result.
 */
export function amountCommit(typed: string | undefined, seed: string | undefined): string | null {
  const v = (typed ?? '').trim();
  return v && v !== seed ? v : null;
}

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
  onAddRow?: (name: string, raw: string, deposit?: number) => void;
  onRemoveRow?: (rowId: string, name: string) => void;
  /** Sets the deposit recorded against a row, replacing whatever was there. */
  onDeposit?: (rowId: string, amount: number) => void;
  locked?: boolean;
}

/**
 * A blank entry line. Each one owns its own draft, so pressing ＋ gives a real editable
 * row (not a dead read-only one), and several can be filled before any is committed.
 * Commits on Enter or blur of the formula/amount, then clears itself for the next entry.
 */
function NewEntryRow({ locked, onAddRow, calc }: {
  locked?: boolean;
  onAddRow?: (name: string, raw: string, deposit?: number) => void;
  calc: (raw: string) => number;
}) {
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');
  const [amt, setAmt] = useState('');
  const [dep, setDep] = useState('');
  function commit() {
    if (locked || !onAddRow) return;
    const n = name.trim();
    const rawExp = formula.trim() || amt.trim();
    const depNum = dep.trim() === '' ? 0 : Number(dep.replace(/[$,\s]/g, ''));
    const hasExp = rawExp !== '';
    const hasDep = Number.isFinite(depNum) && depNum > 0;
    // A name plus at least one side of the line — an expense, income, or both.
    if (!n || (!hasExp && !hasDep)) return;
    if (hasExp) {
      // Keep a formula that cannot resolve yet (a name it will match later); reject only a
      // plain value that is not a number.
      const looksLikeFormula = rawExp.startsWith('=') || /\[[^\]]+\]/.test(rawExp);
      if (!looksLikeFormula && isNaN(calc(rawExp))) return;
    }
    onAddRow(n, hasExp ? rawExp : '0', hasDep ? depNum : 0);
    setName(''); setFormula(''); setAmt(''); setDep('');
  }
  const enter = (e: { key: string }) => { if (e.key === 'Enter') commit(); };
  return (
    <tr className="xg__row">
      <td className="xg__item">
        <input placeholder={locked ? '' : 'item'} value={name} disabled={locked}
          onChange={e => setName(e.target.value)} onKeyDown={enter} onBlur={commit} />
      </td>
      <td className="xg__formula">
        <input placeholder={locked ? '' : 'formula'} value={formula} disabled={locked}
          onChange={e => setFormula(e.target.value)} onKeyDown={enter} onBlur={commit} />
      </td>
      <td className="xg__amount">
        <input placeholder={locked ? '' : 'expense'} value={amt} disabled={locked}
          onChange={e => setAmt(e.target.value)} onKeyDown={enter} onBlur={commit} />
      </td>
      <td className="xg__amount">
        <input placeholder={locked ? '' : 'deposit'} value={dep} disabled={locked}
          onChange={e => setDep(e.target.value)} onKeyDown={enter} onBlur={commit} />
      </td>
    </tr>
  );
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
  onRename, onRemove, onItemName, onAmount, onAddRow, onRemoveRow, onDeposit, locked,
}: ExpenseGridProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [extraBlanks, setExtraBlanks] = useState(0);
  /** What focusing an amount cell put in it, so leaving it unchanged is not saved as an edit. */
  const seeds = useRef<Record<string, string>>({});

  const set = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const drop = (k: string) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });

  /** A row never resolves a name against itself, or =[rent]/4 on the row called "rent"
   *  quietly divides its own figure and shrinks every time it recomputes. */
  const lookupFor = (excludeId?: string) =>
    rows.filter(r => r.id !== excludeId).map(r => ({ name: r.name, amount: r.amount }));
  const calc = (raw: string, excludeId?: string) =>
    evalFormula(raw, lookupFor(excludeId), budgetEntries);
  // Expenses draw the balance down, deposits build it back up.
  const expenses = rows.reduce((s, r) => s + r.amount, 0) + carried;
  const deposits = rows.reduce((s, r) => s + r.deposit, 0);
  const balance = deposits - expenses;

  return (
    <table className="xg">
      <tbody>
        {/* Name sits in the middle column, as in a sheet */}
        <tr className="xg__namerow">
          <td></td>
          <td colSpan={2}>
            <input
              className={locked ? 'xg__name xg__name--start' : 'xg__name'}
              placeholder={namePlaceholder ?? 'Name'}
              value={draft.__n ?? title}
              onChange={e => set('__n', e.target.value)}
              onBlur={() => { const v = (draft.__n ?? '').trim(); drop('__n'); if (v && v !== title) onRename(v); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
          </td>
          <td className="xg__right">
            {onRemove && (
              <button type="button" className="xg__del" title="Delete this person and their sheet"
                onClick={onRemove}>Delete</button>
            )}
          </td>
        </tr>

        {/* The unnamed spare: name the person first — that is what creates them, and a bill
            cannot attach to someone who does not exist yet. Once named, the real grid below
            appears and takes expenses and income. So show a prompt here, not a dead grid. */}
        {locked && (
          <tr className="xg__starthint">
            <td colSpan={4}>Type a name above to start this person's sheet, then add their expenses and income.</td>
          </tr>
        )}

        {!locked && (<>
        <tr className="xg__labels">
          <td></td><td></td>
          <td className="xg__amount">Expense (&minus;)</td>
          <td className="xg__amount">Deposit (+)</td>
        </tr>

        {rows.map(row => {
          const iKey = `i:${row.id}`, fKey = `f:${row.id}`, aKey = `a:${row.id}`, dKey = `d:${row.id}`;
          const shownFormula = draft[fKey] ?? (isFormula(row.raw) ? row.raw : '');
          const badFormula = shownFormula.trim() !== '' && isNaN(calc(shownFormula, row.id));
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
                    const next = formulaCommit(draft[fKey], row.raw);
                    drop(fKey);
                    // Save it even when it does not resolve yet. Discarding what someone
                    // typed is worse than holding a formula that is waiting on a name.
                    if (next !== null) onAmount?.(row.id, next);
                  }}
                  title={badFormula ? "This name does not match a row on this grid or an entry in the budget register, so the amount is unchanged." : undefined}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>

              <td className="xg__amount">
                <input
                  value={draft[aKey] ?? money(row.amount)}
                  onFocus={() => {
                    const seed = isFormula(row.raw) ? String(row.amount) : row.raw;
                    seeds.current[aKey] = seed;
                    set(aKey, seed);
                  }}
                  onChange={e => set(aKey, e.target.value)}
                  onBlur={() => {
                    const next = amountCommit(draft[aKey], seeds.current[aKey]);
                    drop(aKey);
                    delete seeds.current[aKey];
                    // Typing a number here replaces the row's working with that number;
                    // leaving the cell as focusing left it does not.
                    if (next !== null) onAmount?.(row.id, next);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>

              <td className="xg__amount">
                <input
                  value={draft[dKey] ?? (row.deposit ? money(row.deposit) : '')}
                  onFocus={() => set(dKey, row.deposit ? String(row.deposit) : '')}
                  onChange={e => set(dKey, e.target.value)}
                  onBlur={() => {
                    const v = (draft[dKey] ?? '').trim();
                    drop(dKey);
                    const n = v === '' ? 0 : Number(v.replace(/[$,\s]/g, ''));
                    if (Number.isFinite(n) && Math.abs(n - row.deposit) > 0.005) onDeposit?.(row.id, n);
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
            <td className="xg__amount"></td>
          </tr>
        )}

        {/* One entry line, plus one more per press of ＋ — each independently editable. */}
        {Array.from({ length: 1 + extraBlanks }).map((_, i) => (
          <NewEntryRow key={`new:${i}`} locked={locked} onAddRow={onAddRow} calc={raw => calc(raw)} />
        ))}

        <tr className="xg__addrow">
          <td colSpan={4}>
            <button className="xg__add" title="Add a row" disabled={locked}
              onClick={() => setExtraBlanks(n => n + 1)}>+</button>
          </td>
        </tr>

        <tr className="xg__totalrow">
          <td className="xg__item">Total</td>
          <td className="xg__formula"></td>
          <td className="xg__amount xg__total">{money(expenses)}</td>
          <td className="xg__amount xg__deposittotal">{deposits ? money(deposits) : ''}</td>
        </tr>

        <tr className="xg__balancerow">
          <td className="xg__item">Balance</td>
          <td className="xg__formula"></td>
          <td className="xg__amount"></td>
          <td className={`xg__amount xg__balance ${balance < 0 ? 'xg__neg' : 'xg__pos'}`}>
            {money(balance)}
          </td>
        </tr>
        </>)}
      </tbody>
    </table>
  );
}
