import { useState, useCallback } from 'react';
import type { PetroTin } from './types';
import './SlushTin.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

interface Props {
  tin: PetroTin;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export default function SlushTin({ tin, onDelete, onRefresh }: Props) {
  const [amount,  setAmount]  = useState('');
  const [desc,    setDesc]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [mode,    setMode]    = useState<'add' | 'withdraw' | null>(null);

  // Balance = sum of all entries
  const entries = [...(tin.entries ?? [])].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const balance = entries.reduce((sum, e) => {
    return e.kind === 'income' ? sum + e.amount : sum - e.amount;
  }, 0);

  const adjust = useCallback(async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0 || !mode) return;
    setSaving(true);
    const kind = mode === 'add' ? 'income' : 'expense';
    const description = desc.trim() || (mode === 'add' ? 'Manual deposit' : 'Manual withdrawal');
    await fetch('/api/petro-tins/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tinId: tin.id,
        kind,
        amount: val,
        entryDate: new Date().toISOString().slice(0, 10),
        description,
      }),
    });
    setAmount('');
    setDesc('');
    setMode(null);
    setSaving(false);
    onRefresh();
  }, [amount, desc, mode, tin.id, onRefresh]);

  const deleteEntry = useCallback(async (entryId: string) => {
    await fetch(`/api/petro-tins/entries?id=${entryId}&tinId=${tin.id}`, { method: 'DELETE' });
    onRefresh();
  }, [tin.id, onRefresh]);

  return (
    <div className="pt-slush-tin">
      <div className="pt-slush-tin__header">
        <span className="pt-slush-tin__name">🪣 {tin.name}</span>
        <button
          className="pt-slush-tin__del"
          title="Delete slush fund"
          onClick={() => onDelete(tin.id)}
        >🗑</button>
      </div>

      {/* Balance */}
      <div className="pt-slush-tin__balance-wrap">
        <div className={`pt-slush-tin__balance ${balance < 0 ? 'loss' : 'gain'}`}>
          {fmt(balance)}
        </div>
        <div className="pt-slush-tin__balance-label">available</div>
      </div>

      {/* Adjust controls */}
      <div className="pt-slush-tin__controls">
        <button
          className={`pt-slush-btn pt-slush-btn--add${mode === 'add' ? ' active' : ''}`}
          onClick={() => setMode(mode === 'add' ? null : 'add')}
        >＋ Add</button>
        <button
          className={`pt-slush-btn pt-slush-btn--withdraw${mode === 'withdraw' ? ' active' : ''}`}
          onClick={() => setMode(mode === 'withdraw' ? null : 'withdraw')}
        >− Withdraw</button>
      </div>

      {mode && (
        <div className="pt-slush-tin__adjust">
          <input
            className="pt-slush-input"
            type="number"
            step="0.01"
            min="0.01"
            placeholder={mode === 'add' ? 'Amount to add' : 'Amount to withdraw'}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adjust()}
            autoFocus
          />
          <input
            className="pt-slush-input"
            type="text"
            placeholder="Note (optional)"
            maxLength={80}
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adjust()}
          />
          <button
            className="pt-slush-save"
            onClick={adjust}
            disabled={saving || !amount}
          >{saving ? '…' : mode === 'add' ? '＋ Add' : '− Withdraw'}</button>
        </div>
      )}

      {/* History */}
      {entries.length > 0 && (
        <div className="pt-slush-tin__history">
          {[...entries].reverse().map(e => (
            <div key={e.id} className="pt-slush-history-row">
              <span className="pt-slush-history-date">{e.entryDate}</span>
              <span className="pt-slush-history-desc">{e.description || '—'}</span>
              <span className={`pt-slush-history-amt ${e.kind === 'income' ? 'gain' : 'loss'}`}>
                {e.kind === 'income' ? '+' : '−'}{fmt(e.amount)}
              </span>
              <button
                className="pt-slush-history-del"
                onClick={() => deleteEntry(e.id)}
                title="Remove"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
