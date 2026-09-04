import { useState, useMemo } from 'react';
import type { SplitsTin, PetroTinEntry } from './types';
import './SharedSheet.css';

/** Evaluate "300", "=1200*0.25", or "=[Rent]*0.25".
 *  [Name] resolves against another row on the same grid, then a budget entry. */
function evalFormula(
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

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

type Row = { id: string; name: string; amount: number; raw: string };

interface GridProps {
  /** Blank for the spare grid at the bottom. */
  title: string;
  rows: Row[];
  carried: number;
  namePlaceholder?: string;
  onRename: (next: string) => void;
  onRemove?: () => void;
  onItemName: (rowId: string, next: string) => void;
  onAmount: (rowId: string, raw: string) => void;
  onAddRow: (name: string, raw: string) => void;
  onRemoveRow: (rowId: string, name: string) => void;
  /** Rows visible to [Name] lookups on this grid. */
  lookup: Array<{ name: string; amount: number }>;
  budgetEntries: PetroTinEntry[];
  /** The spare grid takes a name first; its rows stay disabled until it has one. */
  locked?: boolean;
}

/** One grid. Rendered once per person, plus one spare. */
function Grid(p: GridProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newAmt, setNewAmt] = useState('');

  const set = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const drop = (k: string) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });
  const calc = (raw: string) => evalFormula(raw, p.lookup, p.budgetEntries);

  const total = p.rows.reduce((s, r) => s + r.amount, 0) + p.carried;
  const preview = calc(newAmt);

  return (
    <table className="grid">
      <thead>
        <tr>
          <th colSpan={3} className="grid__title">
            <input
              className="grid__name"
              placeholder={p.namePlaceholder ?? 'Name'}
              value={draft.__n ?? p.title}
              onChange={e => set('__n', e.target.value)}
              onBlur={() => { const v = (draft.__n ?? '').trim(); drop('__n'); if (v && v !== p.title) p.onRename(v); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            {p.onRemove && (
              <button className="grid__x" title="Remove" onClick={p.onRemove}>✕</button>
            )}
          </th>
        </tr>
        <tr>
          <th>Item</th>
          <th className="grid__num">Amount</th>
          <th></th>
        </tr>
      </thead>

      <tbody>
        {p.rows.map(row => {
          const aKey = `a:${row.id}`;
          const iKey = `i:${row.id}`;
          const editing = draft[aKey] !== undefined;
          const bad = editing && draft[aKey].trim() !== '' && isNaN(calc(draft[aKey]));
          return (
            <tr key={row.id}>
              <td>
                <input
                  value={draft[iKey] ?? row.name}
                  onChange={e => set(iKey, e.target.value)}
                  onBlur={() => { const v = (draft[iKey] ?? '').trim(); drop(iKey); if (v && v !== row.name) p.onItemName(row.id, v); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>
              <td className="grid__num">
                {/* Shows the value; shows the formula once you click in, like a spreadsheet cell. */}
                <input
                  className={bad ? 'grid__bad' : ''}
                  value={editing ? draft[aKey] : money(row.amount)}
                  onFocus={() => set(aKey, row.raw)}
                  onChange={e => set(aKey, e.target.value)}
                  onBlur={() => { const v = (draft[aKey] ?? '').trim(); drop(aKey); if (v && v !== row.raw) p.onAmount(row.id, v); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </td>
              <td>
                <button className="grid__x" title="Remove row"
                  onClick={() => p.onRemoveRow(row.id, row.name)}>✕</button>
              </td>
            </tr>
          );
        })}

        {p.carried > 0 && (
          <tr>
            <td className="grid__muted">Carried from last month</td>
            <td className="grid__num">{money(p.carried)}</td>
            <td></td>
          </tr>
        )}

        <tr>
          <td>
            <input placeholder={p.locked ? '' : 'Rent'} value={newName} disabled={p.locked}
              onChange={e => setNewName(e.target.value)} />
          </td>
          <td className="grid__num">
            <input placeholder={p.locked ? '' : '=[Rent]*0.25'} value={newAmt} disabled={p.locked}
              onChange={e => setNewAmt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newName.trim() && newAmt.trim() && !isNaN(preview)) {
                  p.onAddRow(newName.trim(), newAmt.trim()); setNewName(''); setNewAmt('');
                }
              }}
              onBlur={() => {
                if (newName.trim() && newAmt.trim() && !isNaN(preview)) {
                  p.onAddRow(newName.trim(), newAmt.trim()); setNewName(''); setNewAmt('');
                }
              }} />
          </td>
          <td></td>
        </tr>
      </tbody>

      <tfoot>
        <tr>
          <td className="grid__foot">Total</td>
          <td className="grid__foot grid__num grid__total">{money(total)}</td>
          <td className="grid__foot"></td>
        </tr>
      </tfoot>
    </table>
  );
}

interface Props {
  tin: SplitsTin;
  budgetEntries: PetroTinEntry[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

export default function SharedSheet({ tin, budgetEntries, onRefresh, onDelete }: Props) {
  const owed = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const person of tin.people) {
      map[person.id] = {};
      for (const bill of tin.bills) {
        const a = bill.assignments.find(x => x.personId === person.id);
        map[person.id][bill.id] = !a ? 0 : a.type === 'flat' ? a.value : bill.amount * (a.value / 100);
      }
    }
    return map;
  }, [tin.people, tin.bills]);

  async function api(body: Record<string, unknown>) {
    const res = await fetch('/api/petro-tins/splits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /** The raw entry is stored as the breakdown label, so a formula survives a reload. */
  function rowsFor(personId: string): Row[] {
    return tin.bills
      .filter(b => b.assignments.some(a => a.personId === personId))
      .map(b => {
        const a = b.assignments.find(x => x.personId === personId);
        let raw = String(a?.value ?? '');
        if (a?.breakdown) {
          try {
            const parsed = JSON.parse(a.breakdown);
            if (parsed?.[0]?.label) raw = String(parsed[0].label);
          } catch { /* keep the plain number */ }
        }
        return { id: b.id, name: b.name, amount: owed[personId]?.[b.id] ?? 0, raw };
      });
  }

  async function setAmount(personId: string, billId: string, raw: string, lookup: Array<{ name: string; amount: number }>) {
    const value = evalFormula(raw, lookup, budgetEntries);
    if (isNaN(value)) return; // unresolved name — keep what is stored
    await api({
      action: 'set_assignment', billId, personId, type: 'flat', value,
      breakdown: JSON.stringify([{ label: raw, value }]),
    });
    onRefresh();
  }

  async function addRow(personId: string, name: string, raw: string, lookup: Array<{ name: string; amount: number }>) {
    const value = evalFormula(raw, lookup, budgetEntries);
    if (isNaN(value)) return;
    const res = await api({ action: 'add_bill', splitsId: tin.id, name, amount: value, isDefault: false });
    if (res?.id) {
      await api({
        action: 'set_assignment', billId: res.id, personId, type: 'flat', value,
        breakdown: JSON.stringify([{ label: raw, value }]),
      });
    }
    onRefresh();
  }

  return (
    <div>
      <div className="sh__head">
        <span className="sh__title">{tin.name}</span>
        <button className="sh__x" title="Delete this tin" onClick={() => onDelete(tin.id)}>✕</button>
      </div>

      <div className="sh__grids">
        {tin.people.map(person => {
          const rows = rowsFor(person.id);
          const lookup = rows.map(r => ({ name: r.name, amount: r.amount }));
          return (
            <Grid
              key={person.id}
              title={person.name}
              rows={rows}
              carried={tin.carriedBalances[person.id] ?? 0}
              lookup={lookup}
              budgetEntries={budgetEntries}
              onRename={async next => { await api({ action: 'update_person', personId: person.id, name: next }); onRefresh(); }}
              onRemove={async () => {
                if (!confirm(`Remove ${person.name} and their grid?`)) return;
                await api({ action: 'delete_person', personId: person.id });
                onRefresh();
              }}
              onItemName={async (billId, next) => {
                const row = rows.find(r => r.id === billId);
                await api({ action: 'update_bill', billId, name: next, amount: row?.amount ?? 0 });
                onRefresh();
              }}
              onAmount={(billId, raw) => setAmount(person.id, billId, raw, lookup)}
              onAddRow={(name, raw) => addRow(person.id, name, raw, lookup)}
              onRemoveRow={async (billId, name) => {
                if (!confirm(`Remove "${name}"?`)) return;
                await api({ action: 'delete_bill', billId });
                onRefresh();
              }}
            />
          );
        })}

        {/* The spare grid: name it and it becomes a real one. */}
        <Grid
          key={`spare-${tin.people.length}`}
          title=""
          namePlaceholder="New person"
          rows={[]}
          carried={0}
          lookup={[]}
          budgetEntries={budgetEntries}
          locked
          onRename={async next => { await api({ action: 'add_person', splitsId: tin.id, name: next, isOwner: false }); onRefresh(); }}
          onItemName={() => {}}
          onAmount={() => {}}
          onAddRow={() => {}}
          onRemoveRow={() => {}}
        />
      </div>
    </div>
  );
}
