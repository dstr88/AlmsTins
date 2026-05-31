import { useState, useCallback } from 'react';
import type { PetroTin, PetroTinEntry } from './types';
import './BudgetTin.css';

const BLANK_ROWS = 10;
const today = () => new Date().toISOString().slice(0, 10);

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

interface BlankRow {
  date: string;
  desc: string;
  payment: string;
  deposit: string;
}

interface Props {
  tin: PetroTin;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export default function BudgetTin({ tin, onEdit, onDelete, onRefresh }: Props) {
  const isSample = tin.notes === '__sample__';
  const thisMonth = new Date().toISOString().slice(0, 7);

  const entries = [...(tin.entries ?? [])].sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  // Running balance from saved entries
  let running = 0;
  const savedRows = entries.map(e => {
    if (e.kind === 'income')  running += e.amount;
    if (e.kind === 'expense') running -= e.amount;
    return { ...e, balance: running };
  });

  const income  = entries.filter(e => e.kind === 'income'  && e.entryDate.startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter(e => e.kind === 'expense' && e.entryDate.startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
  const net = income - expense;

  // Blank input rows state
  const emptyRow = (): BlankRow => ({ date: today(), desc: '', payment: '', deposit: '' });
  const [rows, setRows] = useState<BlankRow[]>(() => Array.from({ length: BLANK_ROWS }, emptyRow));
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  const updateRow = (i: number, field: keyof BlankRow, value: string) => {
    setRows(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      // Mutual exclusion on payment/deposit
      if (field === 'payment' && value) next[i].deposit = '';
      if (field === 'deposit' && value) next[i].payment = '';
      return next;
    });
  };

  const previewBalance = (row: BlankRow) => {
    const dep = parseFloat(row.deposit);
    const pay = parseFloat(row.payment);
    if (dep > 0) return running + dep;
    if (pay > 0) return running - pay;
    return null;
  };

  const trySave = useCallback(async (i: number) => {
    const row = rows[i];
    const dep = parseFloat(row.deposit);
    const pay = parseFloat(row.payment);
    if (!row.date || !row.desc.trim()) return;
    if (!dep && !pay) return;

    const kind   = dep > 0 ? 'income' : 'expense';
    const amount = dep > 0 ? dep : pay;

    setSaving(prev => ({ ...prev, [i]: true }));
    await fetch('/api/petro-tins/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tinId: tin.id, kind, amount, entryDate: row.date, description: row.desc.trim() }),
    });
    setSaving(prev => ({ ...prev, [i]: false }));
    onRefresh();
  }, [rows, tin.id, onRefresh]);

  const deleteEntry = async (entryId: string) => {
    await fetch(`/api/petro-tins/entries?id=${entryId}&tinId=${tin.id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="pt-budget-tin" data-tin-id={tin.id}>
      {isSample && <span className="pt-budget-tin__sample">sample</span>}

      <div className="pt-budget-tin__header">
        <span className="pt-budget-tin__name">{tin.name}</span>
        <span className="pt-budget-tin__meta">
          Income <strong className="gain">{fmt(income)}</strong>
          {' · '}Expenses <strong className="loss">{fmt(expense)}</strong>
          {' · '}Net <strong className={net >= 0 ? 'gain' : 'loss'}>{fmt(net)}</strong>
        </span>
        <div className="pt-budget-tin__actions">
          <button className="pt-budget-tin__icon-btn" title="Edit" onClick={() => onEdit(tin.id)}>✏️</button>
          <button className="pt-budget-tin__icon-btn pt-budget-tin__icon-btn--del" title="Delete" onClick={() => onDelete(tin.id)}>🗑</button>
        </div>
      </div>

      <div className="pt-budget-tin__register">
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Date</th>
              <th>Description</th>
              <th className="col-amt" style={{ width: 120 }}>Payment (−)</th>
              <th className="col-amt" style={{ width: 120 }}>Deposit (+)</th>
              <th className="col-bal" style={{ width: 120 }}>Balance</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {/* Saved entries */}
            {savedRows.map(e => (
              <tr key={e.id} className="pt-reg-saved">
                <td className="col-date">{e.entryDate}</td>
                <td className="col-desc">{e.description}</td>
                <td className="col-pay">{e.kind === 'expense' ? fmt(e.amount) : ''}</td>
                <td className="col-dep">{e.kind === 'income'  ? fmt(e.amount) : ''}</td>
                <td className={`col-bal ${e.balance >= 0 ? 'gain' : 'loss'}`}>{fmt(e.balance)}</td>
                <td className="col-del">
                  <button className="pt-reg-del" onClick={() => deleteEntry(e.id)} title="Delete">✕</button>
                </td>
              </tr>
            ))}

            {/* Blank input rows */}
            {rows.map((row, i) => {
              const preview = previewBalance(row);
              return (
                <tr key={i} className="pt-reg-blank">
                  <td>
                    <input
                      className="pt-reg-input"
                      type="date"
                      value={row.date}
                      onChange={e => updateRow(i, 'date', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      disabled={saving[i]}
                    />
                  </td>
                  <td>
                    <input
                      className="pt-reg-input"
                      type="text"
                      placeholder="Description"
                      maxLength={120}
                      value={row.desc}
                      onChange={e => updateRow(i, 'desc', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      disabled={saving[i]}
                    />
                  </td>
                  <td>
                    <input
                      className="pt-reg-input col-amt"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="—"
                      value={row.payment}
                      onChange={e => updateRow(i, 'payment', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      onBlur={() => setTimeout(() => trySave(i), 120)}
                      disabled={saving[i]}
                    />
                  </td>
                  <td>
                    <input
                      className="pt-reg-input col-amt"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="—"
                      value={row.deposit}
                      onChange={e => updateRow(i, 'deposit', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      onBlur={() => setTimeout(() => trySave(i), 120)}
                      disabled={saving[i]}
                    />
                  </td>
                  <td className="col-bal">
                    {preview !== null
                      ? <span className={preview >= 0 ? 'gain' : 'loss'}>{fmt(preview)}</span>
                      : <span className="muted">—</span>
                    }
                  </td>
                  <td className="col-del"></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
