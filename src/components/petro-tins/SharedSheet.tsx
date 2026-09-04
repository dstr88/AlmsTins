import { useMemo } from 'react';
import type { SplitsTin, PetroTinEntry } from './types';
import ExpenseGrid, { evalFormula, type GridRow } from './ExpenseGrid';
import './SharedSheet.css';

interface Props {
  tin: SplitsTin;
  budgetEntries: PetroTinEntry[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

/**
 * Lays ExpenseGrid out on one row: one grid per person, plus a spare.
 *
 * The row expands as people are added — two boys and a spare is three grids today,
 * three people and a spare is four. Naming the spare creates that person and a fresh
 * spare takes its place.
 */
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

  const month = new Date().toISOString().slice(0, 7);

  /** Deposits are payments recorded against a row this month. */
  const deposits = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const pmt of tin.payments.filter(p => p.month === month)) {
      if (!map[pmt.personId]) map[pmt.personId] = {};
      map[pmt.personId][pmt.billId] = (map[pmt.personId][pmt.billId] ?? 0) + pmt.amount;
    }
    return map;
  }, [tin.payments, month]);

  async function api(body: Record<string, unknown>) {
    const res = await fetch('/api/petro-tins/splits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /** The raw entry is stored as the breakdown label, so a formula survives a reload. */
  function rowsFor(personId: string): GridRow[] {
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
        return { id: b.id, name: b.name, amount: owed[personId]?.[b.id] ?? 0, raw, deposit: deposits[personId]?.[b.id] ?? 0 };
      });
  }

  async function saveAmount(personId: string, billId: string, raw: string, lookup: Array<{ name: string; amount: number }>) {
    const value = evalFormula(raw, lookup, budgetEntries);
    if (isNaN(value)) return; // unresolved name — keep what is stored
    await api({
      action: 'set_assignment', billId, personId, type: 'flat', value,
      breakdown: JSON.stringify([{ label: raw, value }]),
    });
    onRefresh();
  }

  async function setDeposit(personId: string, billId: string, amount: number) {
    // Clear this month's payments for the row, then record the new figure. The cell is
    // the source of truth, so typing over it corrects rather than accumulates.
    const existing = tin.payments.filter(
      p => p.month === month && p.personId === personId && p.billId === billId,
    );
    for (const p of existing) await api({ action: 'delete_payment', paymentId: p.id });
    if (amount > 0) {
      await api({
        action: 'add_payment', splitsId: tin.id, personId, billId,
        amount, paidDate: new Date().toISOString().slice(0, 10),
        budgetTinId: tin.budgetTinId,
      });
    }
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

      <div className="sh__row">
        {tin.people.map(person => {
          const rows = rowsFor(person.id);
          const lookup = rows.map(r => ({ name: r.name, amount: r.amount }));
          return (
            <ExpenseGrid
              key={person.id}
              title={person.name}
              rows={rows}
              carried={tin.carriedBalances[person.id] ?? 0}
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
              onAmount={(billId, raw) => saveAmount(person.id, billId, raw, lookup)}
              onDeposit={(billId, amount) => setDeposit(person.id, billId, amount)}
              onAddRow={(name, raw) => addRow(person.id, name, raw, lookup)}
              onRemoveRow={async (billId, name) => {
                if (!confirm(`Remove "${name}"?`)) return;
                await api({ action: 'delete_bill', billId });
                onRefresh();
              }}
            />
          );
        })}

        {/* The spare. Name it and it becomes a person's grid; a new spare replaces it. */}
        <ExpenseGrid
          key={`spare-${tin.people.length}`}
          title=""
          namePlaceholder="New person"
          rows={[]}
          budgetEntries={budgetEntries}
          locked
          onRename={async next => { await api({ action: 'add_person', splitsId: tin.id, name: next, isOwner: false }); onRefresh(); }}
        />
      </div>
    </div>
  );
}
