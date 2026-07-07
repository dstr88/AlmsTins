import { useState, useEffect, useCallback, useRef } from 'react';
import type { PetroTin, SplitsTin } from './types';
import DebtTin from './DebtTin';
import CreditCardChargesGrid from './CreditCardChargesGrid';
import SharedCCGrid from './SharedCCGrid';
import BudgetTin from './BudgetTin';
import SlushTin from './SlushTin';
import SplitsTinComponent from './SplitsTin';
import QuickCalcTable from './QuickCalcTable';
import './PetroTinsGrid.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function PetroTinsGrid() {
  const [tins, setTins] = useState<PetroTin[]>([]);
  const [splitsTins, setSplitsTins] = useState<SplitsTin[]>([]);
  const [loading, setLoading] = useState(true);

  const scrolledToHash = useRef(false);

  const load = useCallback(async () => {
    try {
      const [res, splitsRes] = await Promise.all([
        fetch('/api/petro-tins'),
        fetch('/api/petro-tins/splits'),
      ]);
      if (res.ok) {
        const data = await res.json();
        setTins(data.tins ?? []);
      }
      if (splitsRes.ok) {
        const data = await splitsRes.json();
        setSplitsTins(data.splits ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Scroll to #splits after data loads if hash is present
  useEffect(() => {
    if (!loading && !scrolledToHash.current && window.location.hash === '#splits') {
      scrolledToHash.current = true;
      setTimeout(() => {
        document.getElementById('splits')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [loading]);

  useEffect(() => { load(); }, [load]);

  // Listen for tin creation/deletion from modal
  useEffect(() => {
    const handleRefresh = () => { load(); };
    window.addEventListener('petro-tins-changed', handleRefresh);
    return () => window.removeEventListener('petro-tins-changed', handleRefresh);
  }, [load]);

  const handleEdit   = (id: string) => { (window as any).openEditTin?.(id); };
  const handleDelete = (id: string) => { (window as any).deleteTin?.(id); };
  const handleAddEntry = (id: string) => {
    const tin = tins.find(t => t.id === id);
    if (tin) (window as any).openAddEntry?.(id, tin.type);
  };

  if (loading) return <p className="pt-grid__loading">Loading…</p>;

  const debtTins     = tins.filter(t => t.type === 'debt');
  const budgetTins   = tins.filter(t => t.type === 'budget' && !t.isSlush);
  const businessTins = tins.filter(t => t.type === 'business');
  const slushTins    = tins.filter(t => t.isSlush);

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
            : budgetTins.map(tin => (
              <BudgetTin
                key={tin.id}
                tin={tin}
                debtTins={debtTins}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onRefresh={load}
              />
            ))
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
          <QuickCalcTable />
        </div>
      </div>

      {/* Row 2: debt tins */}
      {debtTins.length > 0 && (
        <div className="pt-grid__zone pt-grid__zone--debt">
          <div className="pt-grid__zone-label">Debt</div>
          <CreditCardChargesGrid debtTins={debtTins} />
          <div className="pt-grid__debt-grid">
            {debtTins.map(tin => (
              <DebtTin
                key={tin.id}
                tin={tin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddEntry={handleAddEntry}
                onRefresh={load}
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

      {/* Slush tin — simple balance card, not a register */}
      {slushTins.map(tin => (
        <div key={tin.id} className="pt-grid__zone pt-grid__zone--slush">
          <SlushTin
            tin={tin}
            onDelete={handleDelete}
            onRefresh={load}
          />
        </div>
      ))}

      {/* Splits tins — shared expense calculator */}
      {splitsTins.length > 0 && (
        <div id="splits" className="pt-grid__zone pt-grid__zone--splits">
          <div className="pt-grid__zone-label">Shared Expenses</div>
          <SharedCCGrid debtTins={debtTins} />
          <div className="pt-grid__splits-grid">
            {splitsTins.map(tin => (
              <SplitsTinComponent
                key={tin.id}
                tin={tin}
                budgetTinOptions={tins.filter(t => t.type === 'budget' && !t.isSlush).map(t => ({ id: t.id, name: t.name }))}
                budgetEntries={tins.filter(t => t.type === 'budget' && !t.isSlush).flatMap(t => t.entries ?? [])}
                onRefresh={load}
                onDelete={async (id) => {
                  if (!confirm('Delete this splits tin and all its data?')) return;
                  await fetch('/api/petro-tins/splits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_splits', splitsId: id }) });
                  load();
                }}
              />
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
