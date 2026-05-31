import { useState, useEffect, useCallback } from 'react';
import type { PetroTin } from './types';
import DebtTin from './DebtTin';
import './PetroTinsGrid.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function PetroTinsGrid() {
  const [tins, setTins] = useState<PetroTin[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/petro-tins');
      if (!res.ok) return;
      const data = await res.json();
      setTins(data.tins ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleEdit   = (id: string) => { (window as any).openEditTin?.(id); };
  const handleDelete = (id: string) => { (window as any).deleteTin?.(id); };
  const handleAddEntry = (id: string) => {
    const tin = tins.find(t => t.id === id);
    if (tin) (window as any).openAddEntry?.(id, tin.type);
  };

  if (loading) return <p className="pt-grid__loading">Loading…</p>;

  const debtTins     = tins.filter(t => t.type === 'debt');
  const budgetTins   = tins.filter(t => t.type === 'budget');
  const businessTins = tins.filter(t => t.type === 'business');

  // Summary numbers
  const thisMonth = new Date().toISOString().slice(0, 7);
  let totalIncome = 0, totalExpense = 0, totalDebt = 0, monthlyInterest = 0;
  for (const tin of tins) {
    if (tin.type === 'debt') {
      totalDebt += tin.balance ?? 0;
      monthlyInterest += (tin.balance ?? 0) * ((tin.apr ?? 0) / 12);
    }
    for (const e of (tin.entries ?? [])) {
      if (!e.entryDate.startsWith(thisMonth)) continue;
      if (e.kind === 'income')  totalIncome  += e.amount;
      if (e.kind === 'expense') totalExpense += e.amount;
    }
  }
  const net = totalIncome - totalExpense;

  return (
    <div className="pt-grid">
      {/* Row 1: budget (left) + summary (right) */}
      <div className="pt-grid__top">
        <div className="pt-grid__budget-slot">
          {budgetTins.length === 0
            ? <p className="pt-grid__empty-hint">No budget tin yet.</p>
            : budgetTins.map(tin => {
              const monthEntries = (tin.entries ?? []).filter(e => e.entryDate.startsWith(thisMonth));
              const income  = monthEntries.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
              const expense = monthEntries.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
              return (
                <div key={tin.id} className="pt-budget-card">
                  <div className="pt-budget-card__header">
                    <span className="pt-budget-card__name">{tin.name}</span>
                    <span className="pt-budget-card__meta">
                      Income <strong className="gain">{fmt(income)}</strong>
                      {' · '}Expenses <strong className="loss">{fmt(expense)}</strong>
                      {' · '}Net <strong className={net >= 0 ? 'gain' : 'loss'}>{fmt(income - expense)}</strong>
                    </span>
                  </div>
                  <div className="pt-budget-card__entries">
                    {monthEntries.length === 0
                      ? <p className="pt-budget-card__empty">No entries this month.</p>
                      : monthEntries.map(e => (
                        <div key={e.id} className="pt-budget-card__row">
                          <span className="pt-budget-card__date">{e.entryDate}</span>
                          <span className="pt-budget-card__desc">{e.description}</span>
                          <span className={`pt-budget-card__amount ${e.kind}`}>{fmt(e.amount)}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              );
            })
          }
        </div>
        <div className="pt-grid__summary">
          <div className="pt-summary__title">Cash Flow Summary</div>
          <div className="pt-summary__row">
            <span className="pt-summary__label">Total Income</span>
            <span className="pt-summary__val gain">{fmt(totalIncome)}</span>
          </div>
          <div className="pt-summary__row">
            <span className="pt-summary__label">Total Expenses</span>
            <span className="pt-summary__val loss">{fmt(totalExpense)}</span>
          </div>
          <div className="pt-summary__divider" />
          <div className="pt-summary__row pt-summary__row--net">
            <span className="pt-summary__label">Net Cash Flow</span>
            <span className={`pt-summary__val ${net >= 0 ? 'gain' : 'loss'}`}>{fmt(Math.abs(net))}</span>
          </div>
          <div className="pt-summary__divider" />
          <div className="pt-summary__row">
            <span className="pt-summary__label">Total Debt</span>
            <span className="pt-summary__val loss">{fmt(totalDebt)}</span>
          </div>
          <div className="pt-summary__row">
            <span className="pt-summary__label">Monthly Interest</span>
            <span className="pt-summary__val loss">{fmt(monthlyInterest)}</span>
          </div>
          <div className="pt-summary__row">
            <span className="pt-summary__label">Est. Annual Interest</span>
            <span className="pt-summary__val loss">{fmt(monthlyInterest * 12)}</span>
          </div>
        </div>
      </div>

      {/* Row 2: debt tins */}
      {debtTins.length > 0 && (
        <div className="pt-grid__zone pt-grid__zone--debt">
          <div className="pt-grid__zone-label">Debt</div>
          <div className="pt-grid__debt-grid">
            {debtTins.map(tin => (
              <DebtTin
                key={tin.id}
                tin={tin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddEntry={handleAddEntry}
              />
            ))}
          </div>
        </div>
      )}

      {/* Divider + business tins */}
      {businessTins.length > 0 && (
        <div className="pt-grid__zone pt-grid__zone--income">
          <div className="pt-grid__zone-divider" />
          <div className="pt-grid__zone-label">Income &amp; Business</div>
          <div className="pt-grid__income-grid">
            {businessTins.map(tin => (
              <div key={tin.id} className="pt-business-placeholder">
                {/* BusinessTin component goes here */}
                <p style={{ color: 'var(--text-muted)', padding: '1rem' }}>{tin.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tins.length === 0 && (
        <div className="pt-grid__empty">
          <p>No tins yet. Add a Debt Tin to start tracking what you owe.</p>
        </div>
      )}
    </div>
  );
}
