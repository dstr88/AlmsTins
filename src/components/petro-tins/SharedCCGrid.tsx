import { useState, useEffect } from 'react';
import type { PetroTin } from './types';
import './SharedCCGrid.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

interface SharedItem {
  id: string;
  tinId: string;
  description: string;
  amount: number;
}

interface Props {
  debtTins: PetroTin[];
}

export default function SharedCCGrid({ debtTins }: Props) {
  const [items, setItems]       = useState<SharedItem[]>([]);
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ tinId: '', description: '', amount: '' });

  useEffect(() => {
    fetch('/api/petro-tins/shared-cc')
      .then(r => r.json())
      .then(d => { if (d.ok) setItems(d.items); });
  }, []);

  async function add() {
    const amt = parseFloat(form.amount);
    if (!form.tinId || !form.description.trim() || isNaN(amt) || amt <= 0) return;
    setSaving(true);
    const res = await fetch('/api/petro-tins/shared-cc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', tinId: form.tinId, description: form.description.trim(), amount: amt }),
    });
    const data = await res.json();
    if (data.ok) {
      setItems(prev => [...prev, { id: data.id, tinId: form.tinId, description: form.description.trim(), amount: amt }]);
      setForm({ tinId: form.tinId, description: '', amount: '' }); // keep card selected
      setAdding(false);
    }
    setSaving(false);
  }

  async function remove(id: string) {
    await fetch('/api/petro-tins/shared-cc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  function getWarning(item: SharedItem) {
    const tin = debtTins.find(t => t.id === item.tinId);
    if (!tin || !tin.creditLimit) return null;
    const bal = tin.balance ?? 0;
    const limit = tin.creditLimit;
    if (bal + item.amount > limit) return 'over';
    if (bal + item.amount > limit * 0.9) return 'near';
    return null;
  }

  const totalAmount = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="scc-grid">
      <div className="scc-grid__header">
        <span className="scc-grid__title">Shared credit card expenses</span>
        <button className="scc-grid__add-btn" onClick={() => setAdding(v => !v)}>
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {adding && (
        <div className="scc-add-form">
          <select className="scc-add-select" value={form.tinId}
            onChange={e => setForm(f => ({ ...f, tinId: e.target.value }))}>
            <option value="">Select card…</option>
            {debtTins.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input className="scc-add-input" placeholder="Description"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} />
          <input className="scc-add-input scc-add-input--amt" placeholder="Amount"
            type="number" min="0" step="0.01"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} />
          <button className="scc-add-save" onClick={add} disabled={saving || !form.tinId || !form.description.trim() || !form.amount}>
            {saving ? '…' : 'Add'}
          </button>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <p className="scc-empty">No shared credit card expenses yet.</p>
      ) : items.length > 0 && (
        <table className="scc-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Description</th>
              <th className="scc-col-amt">Amount</th>
              <th className="scc-col-status">Status</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const tin     = debtTins.find(t => t.id === item.tinId);
              const warning = getWarning(item);
              return (
                <tr key={item.id} className={warning === 'over' ? 'scc-row--over' : warning === 'near' ? 'scc-row--near' : ''}>
                  <td className="scc-col-card">{tin?.name ?? '—'}</td>
                  <td>{item.description}</td>
                  <td className="scc-col-amt scc-amount">{fmt(item.amount)}</td>
                  <td className="scc-col-status">
                    {warning === 'over' ? (
                      <span className="scc-warning scc-warning--over"
                        title={tin ? `Balance ${fmt(tin.balance ?? 0)} + ${fmt(item.amount)} = ${fmt((tin.balance ?? 0) + item.amount)} — exceeds ${fmt(tin.creditLimit ?? 0)} limit` : ''}>
                        ⚠ Over limit
                      </span>
                    ) : warning === 'near' ? (
                      <span className="scc-warning scc-warning--near">⚡ Near limit</span>
                    ) : (
                      <span className="scc-ok">✓</span>
                    )}
                  </td>
                  <td>
                    <button className="scc-del-btn" onClick={() => remove(item.id)} title="Remove">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="scc-foot-label">Total</td>
              <td className="scc-col-amt scc-foot-total">{fmt(totalAmount)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
