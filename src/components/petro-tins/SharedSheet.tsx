import { useState, useMemo } from 'react';
import type { SplitsTin, PetroTinEntry } from './types';
import './SharedSheet.css';

/** Evaluate "300", "=1200*0.25", or "=[Rent]*0.25".
 *  [Name] resolves against another row's name first, then a budget entry description. */
function evalFormula(
  input: string,
  rows?: Array<{ name: string; amount: number }>,
  budgetEntries?: Array<{ description: string; amount: number }>,
): number {
  let s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  let resolved = true;
  s = s.replace(/\[([^\]]+)\]/g, (_m, name: string) => {
    const key = String(name).trim().toLowerCase();
    const row = rows?.find(r => r.name.toLowerCase() === key);
    if (row) return String(row.amount);
    const entry = budgetEntries?.find(e => (e.description ?? '').toLowerCase() === key);
    if (entry) return String(entry.amount);
    resolved = false;
    return '0';
  });
  if (!resolved) return NaN;
  if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
  try { return Function('"use strict"; return (' + s + ')')(); }
  catch { return NaN; }
}

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface Props {
  tin: SplitsTin;
  budgetEntries: PetroTinEntry[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

/** One sheet per person. Every cell is typed directly; nothing hides behind a modal. */
export default function SharedSheet({ tin, budgetEntries, onRefresh, onDelete }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPerson, setNewPerson] = useState('');

  // What each person owes on each row.
  const owed = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const p of tin.people) {
      map[p.id] = {};
      for (const b of tin.bills) {
        const a = b.assignments.find(x => x.personId === p.id);
        map[p.id][b.id] = !a ? 0 : a.type === 'flat' ? a.value : b.amount * (a.value / 100);
      }
    }
    return map;
  }, [tin.people, tin.bills]);

  async function api(body: Record<string, unknown>) {
    const res = await fetch('/api/petro-tins/splits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  const setCell = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));
  const dropCell = (k: string) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });

  /** Rows a person has, as {name, amount} — also the lookup table for [Name] formulas. */
  function rowsFor(personId: string) {
    return tin.bills
      .filter(b => b.assignments.some(a => a.personId === personId))
      .map(b => ({ id: b.id, name: b.name, amount: owed[personId]?.[b.id] ?? 0 }));
  }

  /** The raw thing typed into a cell is kept as the breakdown label, so a formula stays one. */
  function rawOf(billId: string, personId: string) {
    const b = tin.bills.find(x => x.id === billId);
    const a = b?.assignments.find(x => x.personId === personId);
    if (!a) return '';
    if (a.breakdown) {
      try {
        const parsed = JSON.parse(a.breakdown);
        if (parsed?.[0]?.label) return String(parsed[0].label);
      } catch { /* fall through to the plain number */ }
    }
    return String(a.value);
  }

  async function saveName(personId: string, current: string, key: string) {
    const next = (draft[key] ?? '').trim();
    dropCell(key);
    if (!next || next === current) return;
    setBusy(true);
    await api({ action: 'update_person', personId, name: next });
    setBusy(false);
    onRefresh();
  }

  async function saveItem(billId: string, current: string, amount: number, key: string) {
    const next = (draft[key] ?? '').trim();
    dropCell(key);
    if (!next || next === current) return;
    setBusy(true);
    await api({ action: 'update_bill', billId, name: next, amount });
    setBusy(false);
    onRefresh();
  }

  async function saveAmount(billId: string, personId: string, current: string, key: string) {
    const next = (draft[key] ?? '').trim();
    dropCell(key);
    if (!next || next === current) return;
    const value = evalFormula(next, rowsFor(personId), budgetEntries);
    if (isNaN(value)) return; // unresolved reference — leave the stored number alone
    setBusy(true);
    await api({
      action: 'set_assignment', billId, personId, type: 'flat', value,
      breakdown: JSON.stringify([{ label: next, value }]),
    });
    setBusy(false);
    onRefresh();
  }

  async function addRow(personId: string) {
    const nk = `n:${personId}`, ak = `a:${personId}`;
    const name = (draft[nk] ?? '').trim();
    const raw = (draft[ak] ?? '').trim();
    if (!name || !raw) return;
    const value = evalFormula(raw, rowsFor(personId), budgetEntries);
    if (isNaN(value)) return;
    setDraft(d => { const n = { ...d }; delete n[nk]; delete n[ak]; return n; });
    setBusy(true);
    const res = await api({ action: 'add_bill', splitsId: tin.id, name, amount: value, isDefault: false });
    if (res?.id) {
      await api({
        action: 'set_assignment', billId: res.id, personId, type: 'flat', value,
        breakdown: JSON.stringify([{ label: raw, value }]),
      });
    }
    setBusy(false);
    onRefresh();
  }

  /** Typing in Paid records the difference as a payment, so the column is editable too. */

  async function removeRow(billId: string, name: string) {
    if (!confirm(`Remove "${name}" and any payments against it?`)) return;
    setBusy(true);
    await api({ action: 'delete_bill', billId });
    setBusy(false);
    onRefresh();
  }

  async function removePerson(personId: string, name: string) {
    if (!confirm(`Remove ${name} and their whole sheet?`)) return;
    setBusy(true);
    await api({ action: 'delete_person', personId });
    setBusy(false);
    onRefresh();
  }

  async function addPerson() {
    const name = newPerson.trim();
    if (!name) return;
    setBusy(true);
    await api({ action: 'add_person', splitsId: tin.id, name, isOwner: false });
    setNewPerson('');
    setAdding(false);
    setBusy(false);
    onRefresh();
  }

  return (
    <div className="sh">
      <div className="sh__head">
        <span className="sh__title">{tin.name}</span>
        <button className="sh__x" title="Delete this tin" onClick={() => onDelete(tin.id)}>✕</button>
      </div>

      {tin.people.length === 0 && (
        <p className="sh__empty">Add a person to start a sheet.</p>
      )}

      <div className="sh__sheets">
        {tin.people.map(person => {
          const rows = rowsFor(person.id);
          const carried = tin.carriedBalances[person.id] ?? 0;
          const totalCost = rows.reduce((s, r) => s + r.amount, 0) + carried;
          const nameKey = `p:${person.id}`;
          const newName = draft[`n:${person.id}`] ?? '';
          const newAmt = draft[`a:${person.id}`] ?? '';
          const preview = evalFormula(newAmt, rows, budgetEntries);

          return (
            <div key={person.id} className="sh__sheet">
              <div className="sh__person">
                <input
                  className="sh__name"
                  value={draft[nameKey] ?? person.name}
                  onChange={e => setCell(nameKey, e.target.value)}
                  onBlur={() => saveName(person.id, person.name, nameKey)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                <button className="sh__x" title="Remove person"
                  onClick={() => removePerson(person.id, person.name)}>✕</button>
              </div>

              <table className="sh__table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Formula or amount</th>
                    <th className="sh__num">Cost</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const raw = rawOf(row.id, person.id);
                    const iKey = `i:${row.id}`;
                    const aKey = `v:${row.id}:${person.id}`;
                    const shown = draft[aKey] ?? raw;
                    const bad = shown.trim() !== '' && isNaN(evalFormula(shown, rows, budgetEntries));
                    return (
                      <tr key={row.id}>
                        <td>
                          <input
                            value={draft[iKey] ?? row.name}
                            onChange={e => setCell(iKey, e.target.value)}
                            onBlur={() => saveItem(row.id, row.name, row.amount, iKey)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          />
                        </td>
                        <td>
                          <input
                            className={bad ? 'sh__bad' : ''}
                            value={shown}
                            onChange={e => setCell(aKey, e.target.value)}
                            onBlur={() => saveAmount(row.id, person.id, raw, aKey)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          />
                        </td>
                        <td className="sh__num">{money(row.amount)}</td>
                        <td>
                          <button className="sh__x" title="Remove row"
                            onClick={() => removeRow(row.id, row.name)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}

                  <tr>
                    <td>
                      <input placeholder="Rent" value={newName}
                        onChange={e => setCell(`n:${person.id}`, e.target.value)} />
                    </td>
                    <td>
                      <input placeholder="=[Rent]*0.25 or 300" value={newAmt}
                        onChange={e => setCell(`a:${person.id}`, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addRow(person.id); }}
                        onBlur={() => addRow(person.id)} />
                    </td>
                    <td className="sh__num">
                      {newAmt.trim() && !isNaN(preview) ? money(preview) : ''}
                    </td>
                    <td></td>
                  </tr>

                  {carried > 0 && (
                    <tr>
                      <td colSpan={2} className="sh__muted">Carried from last month</td>
                      <td className="sh__num">{money(carried)}</td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="sh__foot">
                    <td colSpan={2}>Total</td>
                    <td className="sh__num sh__total">{money(totalCost)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </div>

      <div className="sh__add">
        {adding ? (
          <>
            <input className="sh__addinput" placeholder="Name" value={newPerson} autoFocus
              onChange={e => setNewPerson(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addPerson();
                if (e.key === 'Escape') { setAdding(false); setNewPerson(''); }
              }} />
            <button className="sh__save" onClick={addPerson} disabled={busy}>Add</button>
            <button className="sh__cancel" onClick={() => { setAdding(false); setNewPerson(''); }}>✕</button>
          </>
        ) : (
          <button className="sh__addbtn" onClick={() => setAdding(true)}>+ Add person</button>
        )}
      </div>
    </div>
  );
}
