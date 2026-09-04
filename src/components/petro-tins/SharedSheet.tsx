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
        return { id: b.id, name: b.name, amount: owed[personId]?.[b.id] ?? 0, raw };
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
          templateRows={['deposit']}
          onRename={async next => {
            const person = await api({ action: 'add_person', splitsId: tin.id, name: next, isOwner: false });
            // Seed the deposit line so a new grid arrives with somewhere to record payments.
            if (person?.id) {
              const bill = await api({ action: 'add_bill', splitsId: tin.id, name: 'deposit', amount: 0, isDefault: false });
              if (bill?.id) {
                await api({
                  action: 'set_assignment', billId: bill.id, personId: person.id, type: 'flat', value: 0,
                  breakdown: JSON.stringify([{ label: '0', value: 0 }]),
                });
              }
            }
            onRefresh();
          }}
        />
      </div>
    </div>
  );
}
