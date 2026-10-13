import { useState, useCallback, useMemo } from 'react';
import type { PetroTin, PetroTinEntry } from './types';
import './DebtTin.css';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function fmtPct(r: number) {
  return (r * 100).toFixed(2) + '%';
}
function evalFormula(input: string): number {
  const s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
  try { return Function('"use strict"; return (' + s + ')')(); }
  catch { return NaN; }
}
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

interface Props {
  tin: PetroTin;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onAddEntry: (id: string) => void;
  onRefresh: () => void;
}

export default function DebtTin({ tin, onEdit, onDelete, onAddEntry, onRefresh }: Props) {
  const bal     = tin.balance ?? 0;
  const limit   = tin.creditLimit ?? 0;
  const apr     = tin.apr ?? 0;
  const pct     = limit > 0 ? Math.min(100, (bal / limit) * 100) : 0;
  const monthly = bal * (apr / 12);
  const isSample = tin.notes === '__sample__';

  const curMonth = thisMonth();

  const [editingEntry, setEditingEntry] = useState<{ id: string; amount: string; desc: string } | null>(null);
  const [addForm, setAddForm]           = useState<{ desc: string; amount: string; recurring: boolean } | null>(null);
  const [showOneTime, setShowOneTime]   = useState(false);
  const [sortBy, setSortBy]             = useState<'date' | 'amount' | 'checked'>('date');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc');

  // Partition entries
  const { recurring, oneTime } = useMemo(() => {
    const all = (tin.entries ?? []).filter(e => e.entryDate.startsWith(curMonth));
    return {
      recurring: all.filter(e => e.isDefault && e.kind === 'charge'),
      oneTime:   all.filter(e => !e.isDefault || e.kind === 'payment'),
    };
  }, [tin.entries, curMonth]);

  const allRecurringChecked = recurring.length > 0 && recurring.every(e => e.checked);

  const toggleSort = useCallback((col: 'date' | 'amount' | 'checked') => {
    if (sortBy === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  }, [sortBy, sortDir]);

  const getSortArrow = (col: 'date' | 'amount' | 'checked') => {
    if (sortBy !== col) return '⇅';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  const sortEntries = (entries: PetroTinEntry[]) => {
    const sorted = [...entries];
    if (sortBy === 'date') {
      sorted.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    } else if (sortBy === 'amount') {
      sorted.sort((a, b) => a.amount - b.amount);
    } else if (sortBy === 'checked') {
      sorted.sort((a, b) => (a.checked ? 1 : 0) - (b.checked ? 1 : 0));
    }
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const toggleChecked = useCallback(async (entryId: string, current: boolean) => {
    await fetch('/api/petro-tins/entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, checked: !current }),
    });
    // If all recurring just got checked, roll over to next month
    const willAllBeDone = recurring.every(e => e.id === entryId ? !current : e.checked);
    if (willAllBeDone && recurring.length > 0) {
      await fetch('/api/petro-tins/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tinId: tin.id }),
      });
    }
    onRefresh();
  }, [recurring, tin.id, onRefresh]);

  const deleteEntry = useCallback(async (entryId: string) => {
    await fetch(`/api/petro-tins/entries?id=${entryId}&tinId=${tin.id}`, { method: 'DELETE' });
    onRefresh();
  }, [tin.id, onRefresh]);

  const saveEditEntry = useCallback(async () => {
    if (!editingEntry) return;
    const amount = evalFormula(editingEntry.amount);
    if (isNaN(amount) || amount < 0) return;
    await fetch('/api/petro-tins/entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: editingEntry.id, amount, description: editingEntry.desc }),
    });
    setEditingEntry(null);
    onRefresh();
  }, [editingEntry, onRefresh]);

  const saveAddForm = useCallback(async () => {
    if (!addForm || !addForm.desc.trim()) return;
    const amount = evalFormula(addForm.amount);
    if (isNaN(amount) || amount <= 0) return;
    await fetch('/api/petro-tins/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tinId: tin.id,
        kind: 'charge',
        amount,
        entryDate: today(),
        description: addForm.desc.trim(),
        isDefault: addForm.recurring ? 1 : 0,
      }),
    });
    setAddForm(null);
    onRefresh();
  }, [addForm, tin.id, onRefresh]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pt-debt-tin" data-tin-id={tin.id}>
      {isSample && <span className="pt-debt-tin__sample">sample</span>}
      <span className="pt-debt-tin__label">Debt</span>

      {/* Header */}
      <div className="pt-debt-tin__header">
        <span className="pt-debt-tin__name">{tin.name}</span>
        <div className="pt-debt-tin__actions">
          <button className="pt-debt-tin__icon-btn" title="Edit" onClick={() => onEdit(tin.id)}>✏️</button>
          <button className="pt-debt-tin__icon-btn pt-debt-tin__icon-btn--del" title="Delete" onClick={() => onDelete(tin.id)}>🗑</button>
        </div>
      </div>

      {/* Utilization bar */}
      {limit > 0 && (
        <div className="pt-debt-tin__progress-wrap">
          <div className="pt-debt-tin__progress-track">
            <div className="pt-debt-tin__progress-fill" style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <div className="pt-debt-tin__progress-labels">
            <span className="pt-debt-tin__progress-pct">{pct.toFixed(0)}% of {fmt(limit)}</span>
          </div>
        </div>
      )}

      {/* Key numbers */}
      <div className="pt-debt-tin__nums">
        <div className="pt-debt-tin__num-row">
          <span className="pt-debt-tin__num-label">Balance</span>
          <span className="pt-debt-tin__num-value loss">{fmt(bal)}</span>
        </div>
        <div className="pt-debt-tin__num-row">
          <span className="pt-debt-tin__num-label">APR</span>
          <span className="pt-debt-tin__num-value">{apr ? fmtPct(apr) : '—'}</span>
        </div>
        <div className="pt-debt-tin__num-row">
          <span className="pt-debt-tin__num-label">Monthly interest</span>
          <span className="pt-debt-tin__num-value loss">{fmt(monthly)}</span>
        </div>
        {tin.minPayment != null && (
          <div className="pt-debt-tin__num-row">
            <span className="pt-debt-tin__num-label">Min payment</span>
            <span className="pt-debt-tin__num-value">{fmt(tin.minPayment)}</span>
          </div>
        )}
      </div>

      {/* ── Recurring charges register ── */}
      <div className="pt-debt-register">
        <div className="pt-debt-register__header">
          <span className="pt-debt-register__title">Recurring charges</span>
          {allRecurringChecked && recurring.length > 0 && (
            <span className="pt-debt-register__allchecked">✓ All posted</span>
          )}
        </div>

        {recurring.length === 0 && !addForm && (
          <p className="pt-debt-register__empty">No recurring charges yet — add one below.</p>
        )}

        <div className="pt-debt-register__sort-header" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
          <button onClick={() => toggleSort('checked')} style={{ flex: 0 }} title="Sort by completion">
            Done {getSortArrow('checked')}
          </button>
          <button onClick={() => toggleSort('date')} title="Sort by date">
            Date {getSortArrow('date')}
          </button>
          <button onClick={() => toggleSort('amount')} style={{ marginLeft: 'auto' }} title="Sort by amount">
            Amount {getSortArrow('amount')}
          </button>
        </div>

        {sortEntries(recurring).map(e => {
          const isEditing = editingEntry?.id === e.id;
          return (
            <div key={e.id} className={`pt-debt-register__row${e.checked ? ' checked' : ''}`}>
              <input type="checkbox" className="pt-debt-register__chk"
                checked={e.checked} onChange={() => toggleChecked(e.id, e.checked)}
                title="Mark as posted to card this month" />
              {isEditing ? (
                <>
                  <input className="pt-debt-register__edit-input" value={editingEntry!.desc}
                    onChange={ev => setEditingEntry(ed => ed ? { ...ed, desc: ev.target.value } : ed)}
                    onKeyDown={ev => { if (ev.key === 'Enter') saveEditEntry(); if (ev.key === 'Escape') setEditingEntry(null); }} />
                  <input className="pt-debt-register__edit-input pt-debt-register__edit-amt" value={editingEntry!.amount}
                    onChange={ev => setEditingEntry(ed => ed ? { ...ed, amount: ev.target.value } : ed)}
                    onKeyDown={ev => { if (ev.key === 'Enter') saveEditEntry(); if (ev.key === 'Escape') setEditingEntry(null); }}
                    onBlur={saveEditEntry} autoFocus />
                  <button className="pt-debt-register__save-btn" onClick={saveEditEntry}>✓</button>
                  <button className="pt-debt-register__del-btn" onClick={() => setEditingEntry(null)}>✕</button>
                </>
              ) : (
                <>
                  <span className="pt-debt-register__desc pt-debt-register__editable"
                    onClick={() => setEditingEntry({ id: e.id, amount: String(e.amount), desc: e.description ?? '' })}>
                    {e.description}
                  </span>
                  <span className="pt-debt-register__amt pt-debt-register__editable loss"
                    onClick={() => setEditingEntry({ id: e.id, amount: String(e.amount), desc: e.description ?? '' })}>
                    {fmt(e.amount)}
                  </span>
                  <button className="pt-debt-register__del-btn" onClick={() => deleteEntry(e.id)} title="Remove">✕</button>
                </>
              )}
            </div>
          );
        })}

        {/* Add charge form */}
        {addForm ? (
          <div className="pt-debt-register__add-form">
            <input className="pt-debt-register__add-input" placeholder="Description (e.g. Netflix)"
              value={addForm.desc} autoFocus
              onChange={e => setAddForm(f => f ? { ...f, desc: e.target.value } : f)}
              onKeyDown={e => { if (e.key === 'Escape') setAddForm(null); }} />
            <input className="pt-debt-register__add-input pt-debt-register__add-amt" placeholder="$ or =formula"
              value={addForm.amount}
              onChange={e => setAddForm(f => f ? { ...f, amount: e.target.value } : f)}
              onKeyDown={e => { if (e.key === 'Enter') saveAddForm(); if (e.key === 'Escape') setAddForm(null); }} />
            <label className="pt-debt-register__recurring-label">
              <input type="checkbox" checked={addForm.recurring}
                onChange={e => setAddForm(f => f ? { ...f, recurring: e.target.checked } : f)} />
              &nbsp;Recurring
            </label>
            <div className="pt-debt-register__add-actions">
              <button className="pt-debt-register__save-btn pt-debt-register__save-btn--full"
                onClick={saveAddForm}
                disabled={!addForm.desc.trim() || isNaN(evalFormula(addForm.amount))}>
                Add
              </button>
              <button className="pt-debt-register__cancel-btn" onClick={() => setAddForm(null)}>✕</button>
            </div>
          </div>
        ) : (
          <button className="pt-debt-register__add-btn"
            onClick={() => setAddForm({ desc: '', amount: '', recurring: true })}>
            + Add charge
          </button>
        )}
      </div>

      {/* ── One-time entries / payments ── */}
      {oneTime.length > 0 && (
        <div className="pt-debt-tin__accordion">
          <details open={showOneTime} onToggle={e => setShowOneTime((e.target as HTMLDetailsElement).open)}>
            <summary className="pt-debt-tin__summary">
              Payments &amp; one-time charges ({oneTime.length})
            </summary>
            <div className="pt-debt-tin__entries">
              {sortEntries(oneTime).map(e => (
                <div className="pt-debt-tin__entry" key={e.id}>
                  <div className="pt-debt-tin__entry-left">
                    <span className={`pt-debt-tin__entry-kind ${e.kind}`}>{e.kind}</span>
                    <span className="pt-debt-tin__entry-desc">{e.description}</span>
                    <span className="pt-debt-tin__entry-date">{e.entryDate}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className={`pt-debt-tin__entry-amount ${e.kind}`}>{fmt(e.amount)}</span>
                    <button className="pt-debt-register__del-btn" onClick={() => deleteEntry(e.id)} title="Delete">✕</button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="pt-debt-tin__footer">
        <button className="pt-debt-tin__add-btn" onClick={() => onAddEntry(tin.id)}>
          ＋ Log payment / one-time charge
        </button>
      </div>
    </div>
  );
}
