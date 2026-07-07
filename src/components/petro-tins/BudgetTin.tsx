import { useState, useCallback, useMemo } from 'react';
import type { PetroTin, PetroTinEntry } from './types';
import './BudgetTin.css';

const BLANK_ROWS = 5;

/** Evaluate a formula like =1200+150 or a plain number. Returns NaN on invalid. */
function evalFormula(input: string): number {
  const s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
  try { return Function('"use strict"; return (' + s + ')')(); }
  catch { return NaN; }
}
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const nextMonth = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

interface BlankRow { date: string; desc: string; payment: string; deposit: string; }

interface Props {
  tin: PetroTin;
  debtTins?: PetroTin[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

export default function BudgetTin({ tin, debtTins = [], onEdit, onDelete, onRefresh }: Props) {
  const isSample   = tin.notes === '__sample__';
  const curMonth  = thisMonth();
  const nxtMonth  = nextMonth();

  const allPaidKey = `petro_allpaid_${tin.id}_${curMonth}`;

  const [calcAmount,    setCalcAmount]    = useState('');
  const [saving,        setSaving]        = useState<Record<number, boolean>>({});
  const [showDefaults,  setShowDefaults]  = useState(false);
  const [showSurplus,   setShowSurplus]   = useState(false);
  const [editingEntry,  setEditingEntry]  = useState<{ id: string; amount: string; desc: string; url: string } | null>(null);
  const [allPaidBanner, setAllPaidBanner] = useState(() => {
    try { return localStorage.getItem(allPaidKey) === '1'; } catch { return false; }
  });
  const [rows, setRows] = useState<BlankRow[]>(() =>
    Array.from({ length: BLANK_ROWS }, () => ({ date: today(), desc: '', payment: '', deposit: '' }))
  );

  // ── Partition entries ──────────────────────────────────────────────────────
  const { carriedOver, curIncome, curBills, nxtIncome, nxtBills } = useMemo(() => {
    const carriedOver: PetroTinEntry[] = [];
    const curIncome:   PetroTinEntry[] = [];
    const curBills:    PetroTinEntry[] = [];
    const nxtIncome:   PetroTinEntry[] = [];
    const nxtBills:    PetroTinEntry[] = [];

    for (const e of tin.entries ?? []) {
      const em = e.entryDate.slice(0, 7);
      if (em < curMonth && !e.checked) {
        carriedOver.push(e);
      } else if (em === curMonth) {
        if (e.kind === 'income') curIncome.push(e);
        else                     curBills.push(e);
      } else if (em === nxtMonth) {
        if (e.kind === 'income') nxtIncome.push(e);
        else                     nxtBills.push(e);
      }
    }
    carriedOver.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    return { carriedOver, curIncome, curBills, nxtIncome, nxtBills };
  }, [tin.entries, curMonth, nxtMonth]);

  // ── Summary numbers ────────────────────────────────────────────────────────
  const totalIncome   = curIncome.reduce((s, e) => s + e.amount, 0);
  const totalExpenses = curBills.reduce((s, e) => s + e.amount, 0);
  const surplus       = totalIncome - totalExpenses;
  const carriedTotal  = carriedOver.reduce((s, e) => e.kind === 'expense' ? s + e.amount : s, 0);

  const allCurrentPaid = curBills.length > 0 && curBills.every(e => e.checked);

  // Persist the banner if all bills are paid (catches page reloads where
  // the last-check path didn't fire, e.g. user paid on another device)
  if (allCurrentPaid && !allPaidBanner) {
    try { if (localStorage.getItem(allPaidKey) !== '1') localStorage.setItem(allPaidKey, '1'); } catch { /* ignore */ }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const toggleChecked = useCallback(async (entryId: string, current: boolean) => {
    await fetch('/api/petro-tins/entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, checked: !current }),
    });

    // After toggling, check if all bills are now paid
    const updated = curBills.map(e => e.id === entryId ? { ...e, checked: !current } : e);
    if (updated.length > 0 && updated.every(e => e.checked)) {
      setAllPaidBanner(true);
      try { localStorage.setItem(allPaidKey, '1'); } catch { /* ignore */ }
      // Seed next month immediately so it's ready to go
      await fetch('/api/petro-tins/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tinId: tin.id }),
      });
      // Sweep surplus to slush if enabled
      if (tin.surplusMode === 'slush' && surplus > 0) {
        await fetch('/api/petro-tins/sweep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tinId: tin.id }),
        });
      }
    }
    onRefresh();
  }, [curBills, tin.id, tin.surplusMode, surplus, onRefresh]);

  const toggleDefault = useCallback(async (entryId: string, current: boolean) => {
    await fetch('/api/petro-tins/entries', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, isDefault: !current }),
    });
    onRefresh();
  }, [onRefresh]);

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
      body: JSON.stringify({ entryId: editingEntry.id, amount, description: editingEntry.desc, url: editingEntry.url || null }),
    });
    setEditingEntry(null);
    onRefresh();
  }, [editingEntry, onRefresh]);

  const updateRow = (i: number, field: keyof BlankRow, value: string) => {
    setRows(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (field === 'payment' && value) next[i].deposit = '';
      if (field === 'deposit' && value)  next[i].payment = '';
      return next;
    });
  };

  const trySave = useCallback(async (i: number) => {
    const row = rows[i];
    const dep = evalFormula(row.deposit);
    const pay = evalFormula(row.payment);
    if (!row.date || !row.desc.trim()) return;
    const depValid = !isNaN(dep) && dep >= 0;
    const payValid = !isNaN(pay) && pay >= 0;
    if (!depValid && !payValid) return;
    const isDeposit = depValid && dep >= 0 && !(payValid && pay > 0);
    const kind      = isDeposit ? 'income' : 'expense';
    const amount    = isDeposit ? (dep || 0) : (pay || 0);

    setSaving(prev => ({ ...prev, [i]: true }));
    await fetch('/api/petro-tins/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tinId: tin.id, kind, amount, entryDate: row.date, description: row.desc.trim() }),
    });

    // If this is an expense whose description matches a debt tin, post a payment to that tin too
    if (kind === 'expense' && debtTins.length > 0) {
      const needle = row.desc.trim().toLowerCase();
      const matched = debtTins.find(dt =>
        needle.includes(dt.name.toLowerCase()) || dt.name.toLowerCase().includes(needle)
      );
      if (matched) {
        await fetch('/api/petro-tins/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tinId: matched.id, kind: 'payment', amount, entryDate: row.date, description: `Payment from ${tin.name}` }),
        });
      }
    }

    setSaving(prev => ({ ...prev, [i]: false }));
    setRows(prev => {
      const next = [...prev];
      next[i] = { date: today(), desc: '', payment: '', deposit: '' };
      return next;
    });
    onRefresh();
  }, [rows, tin.id, tin.name, debtTins, onRefresh]);

  const saveSurplusMode = useCallback(async (mode: 'none' | 'slush') => {
    await fetch(`/api/petro-tins/${tin.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surplusMode: mode }),
    });
    setShowSurplus(false);
    onRefresh();
  }, [tin.id, onRefresh]);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderRow = (e: PetroTinEntry, showDefault = false) => {
    const isEditing = editingEntry?.id === e.id;
    return (
      <tr key={e.id} className={`pt-reg-saved${e.checked ? ' pt-reg-checked' : ''}`}>
        <td className="col-chk">
          <input
            type="checkbox"
            className="pt-reg-checkbox"
            checked={e.checked}
            onChange={() => toggleChecked(e.id, e.checked)}
            title="Mark as paid"
          />
        </td>
        <td className="col-date">{e.entryDate.slice(0, 7) !== curMonth
          ? <span className="pt-carried-month">{e.entryDate.slice(0, 7)}</span>
          : e.entryDate}
        </td>
        <td className="col-desc">
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <input className="pt-reg-input pt-reg-edit-input" value={editingEntry!.desc}
                placeholder="Description"
                onChange={ev => setEditingEntry(ed => ed ? { ...ed, desc: ev.target.value } : ed)}
                onKeyDown={ev => { if (ev.key === 'Enter') saveEditEntry(); if (ev.key === 'Escape') setEditingEntry(null); }} />
              <input className="pt-reg-input pt-reg-edit-input" value={editingEntry!.url}
                placeholder="Payment URL (optional)"
                onChange={ev => setEditingEntry(ed => ed ? { ...ed, url: ev.target.value } : ed)}
                onKeyDown={ev => { if (ev.key === 'Enter') saveEditEntry(); if (ev.key === 'Escape') setEditingEntry(null); }} />
            </div>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="pt-reg-editable" onClick={() => setEditingEntry({ id: e.id, amount: String(e.amount), desc: e.description ?? '', url: e.url ?? '' })}>{e.description}</span>
              {e.url && (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="pt-reg-pay-link" title="Pay online">🔗</a>
              )}
            </span>
          )}
        </td>
        <td className="col-pay">
          {isEditing && e.kind === 'expense'
            ? <input className="pt-reg-input pt-reg-edit-input col-amt" value={editingEntry!.amount}
                onChange={ev => setEditingEntry(ed => ed ? { ...ed, amount: ev.target.value } : ed)}
                onKeyDown={ev => { if (ev.key === 'Enter') saveEditEntry(); if (ev.key === 'Escape') setEditingEntry(null); }}
                onBlur={saveEditEntry} autoFocus />
            : e.kind === 'expense'
              ? <span className="pt-reg-editable" onClick={() => setEditingEntry({ id: e.id, amount: String(e.amount), desc: e.description ?? '', url: e.url ?? '' })}>{fmt(e.amount)}</span>
              : ''
          }
        </td>
        <td className="col-dep">
          {isEditing && e.kind === 'income'
            ? <input className="pt-reg-input pt-reg-edit-input col-amt" value={editingEntry!.amount}
                onChange={ev => setEditingEntry(ed => ed ? { ...ed, amount: ev.target.value } : ed)}
                onKeyDown={ev => { if (ev.key === 'Enter') saveEditEntry(); if (ev.key === 'Escape') setEditingEntry(null); }}
                onBlur={saveEditEntry} autoFocus />
            : e.kind === 'income'
              ? <span className="pt-reg-editable" onClick={() => setEditingEntry({ id: e.id, amount: String(e.amount), desc: e.description ?? '', url: e.url ?? '' })}>{fmt(e.amount)}</span>
              : ''
          }
        </td>
        <td className="col-del">
          {isEditing ? (
            <>
              <button className="pt-reg-edit-save" onClick={saveEditEntry} title="Save">✓</button>
              <button className="pt-reg-del" onClick={() => setEditingEntry(null)} title="Cancel">✕</button>
            </>
          ) : (
            <>
              {showDefault && (
                <button
                  className={`pt-reg-default-btn${e.isDefault ? ' active' : ''}`}
                  title={e.isDefault ? 'Repeats monthly — click to make one-time' : 'One-time — click to repeat monthly'}
                  onClick={() => toggleDefault(e.id, e.isDefault)}
                >↻</button>
              )}
              <button className="pt-reg-del" onClick={() => deleteEntry(e.id)} title="Delete">✕</button>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="pt-budget-tin" data-tin-id={tin.id}>
      {isSample && <span className="pt-budget-tin__sample">sample</span>}

      {/* Header */}
      <div className="pt-budget-tin__header">
        <span className="pt-budget-tin__name">{tin.name}</span>
        <div className="pt-budget-tin__actions">
          <button className="pt-budget-tin__icon-btn" title="Edit" onClick={() => onEdit(tin.id)}>✏️</button>
          <button className="pt-budget-tin__icon-btn pt-budget-tin__icon-btn--del" title="Delete" onClick={() => onDelete(tin.id)}>🗑</button>
        </div>
      </div>

      {/* Summary row */}
      <div className="pt-budget-tin__meta">
        <span>Income <strong className="gain">{fmt(totalIncome)}</strong></span>
        <span>Bills <strong className="loss">{fmt(totalExpenses)}</strong></span>
        <span>Net <strong className={surplus >= 0 ? 'gain' : 'loss'}>{fmt(surplus)}</strong></span>
        {carriedTotal > 0 && (
          <span className="pt-carried-badge">⚠ {fmt(carriedTotal)} carried over</span>
        )}
      </div>

      {/* All-paid banner */}
      {allPaidBanner && (
        <div className="pt-allpaid-banner">
          🎉 All bills paid for {monthLabel(curMonth)}!
          {tin.surplusMode === 'slush' && surplus > 0 && (
            <span> {fmt(surplus)} swept to your Slush Fund.</span>
          )}
        </div>
      )}

      <div className="pt-budget-tin__register">
        <table>
          <thead>
            <tr>
              <th className="col-chk" title="Paid?">✓</th>
              <th style={{ width: 100 }}>Date</th>
              <th>Description</th>
              <th className="col-amt" style={{ width: 110 }}>Expense (−)</th>
              <th className="col-amt" style={{ width: 110 }}>Income (+)</th>
              <th style={{ width: 52 }}></th>
            </tr>
          </thead>
          <tbody>

            {/* ── Carried over ── */}
            {carriedOver.length > 0 && (
              <>
                <tr className="pt-reg-section-header">
                  <td colSpan={6}>⚠ Carried over — unpaid from prior months</td>
                </tr>
                {carriedOver.map(e => renderRow(e))}
              </>
            )}

            {/* ── This month income ── */}
            <tr className="pt-reg-section-header pt-reg-section-header--income">
              <td colSpan={6}>
                {monthLabel(curMonth)} — Income
                <button
                  className="pt-reg-defaults-toggle"
                  onClick={() => setShowDefaults(v => !v)}
                  title="Set which income repeats monthly"
                >⚙ Defaults</button>
              </td>
            </tr>
            {curIncome.length === 0
              ? <tr className="pt-reg-empty"><td colSpan={6}>No income entered yet this month.</td></tr>
              : curIncome.map(e => renderRow(e, showDefaults))
            }

            {/* ── This month bills ── */}
            <tr className="pt-reg-section-header pt-reg-section-header--bills">
              <td colSpan={6}>{monthLabel(curMonth)} — Bills</td>
            </tr>
            {curBills.length === 0
              ? <tr className="pt-reg-empty"><td colSpan={6}>No bills yet — add them below.</td></tr>
              : curBills.map(e => renderRow(e))
            }

            {/* ── Next month (visible when seeded early) ── */}
            {(nxtBills.length > 0 || nxtIncome.length > 0) && (
              <>
                <tr className="pt-reg-section-header pt-reg-section-header--next">
                  <td colSpan={6}>🗓 {monthLabel(nxtMonth)} — paying ahead</td>
                </tr>
                {nxtIncome.map(e => renderRow(e, showDefaults))}
                {nxtBills.map(e => renderRow(e))}
              </>
            )}

            {/* ── Quick calculator ── */}
            <tr className="pt-reg-calc-row">
              <td colSpan={2}>
                <span className="pt-calc-label">I have</span>
                <input
                  className="pt-reg-input col-amt pt-calc-input"
                  type="text"
                  placeholder={fmt(totalIncome)}
                  value={calcAmount}
                  onChange={e => setCalcAmount(e.target.value)}
                />
              </td>
              <td colSpan={2}>
                <span className="pt-calc-label">Expenses total</span>
                <span className="pt-calc-value loss">{fmt(totalExpenses)}</span>
              </td>
              <td colSpan={2}>
                <span className="pt-calc-label">Left over</span>
                {(() => {
                  const base = calcAmount.trim() ? evalFormula(calcAmount) : totalIncome;
                  const rem = isNaN(base) ? NaN : base - totalExpenses;
                  return (
                    <span className={`pt-calc-value${isNaN(rem) ? ' pt-calc-empty' : rem >= 0 ? ' gain' : ' loss'}`}>
                      {isNaN(rem) ? '—' : fmt(rem)}
                    </span>
                  );
                })()}
              </td>
            </tr>

            {/* ── Blank input rows ── */}
            <tr className="pt-reg-section-header">
              <td colSpan={6}>Add entry</td>
            </tr>
            {rows.map((row, i) => {
              return (
                <tr key={i} className="pt-reg-blank">
                  <td className="col-chk"></td>
                  <td>
                    <input className="pt-reg-input" type="date" value={row.date}
                      onChange={e => updateRow(i, 'date', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      disabled={saving[i]} />
                  </td>
                  <td>
                    <input className="pt-reg-input" type="text" placeholder="Description" maxLength={120}
                      value={row.desc}
                      onChange={e => updateRow(i, 'desc', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      disabled={saving[i]} />
                  </td>
                  <td style={{ position: 'relative' }}>
                    <input className="pt-reg-input col-amt" type="text" placeholder="— or =500+50"
                      value={row.payment}
                      onChange={e => updateRow(i, 'payment', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      onBlur={() => setTimeout(() => trySave(i), 120)}
                      disabled={saving[i]} />
                    {row.payment.trim().startsWith('=') && !isNaN(evalFormula(row.payment)) && (
                      <span style={{ position: 'absolute', bottom: '-1.1rem', left: 0, fontSize: '0.7rem', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                        = {fmt(evalFormula(row.payment))}
                      </span>
                    )}
                  </td>
                  <td style={{ position: 'relative' }}>
                    <input className="pt-reg-input col-amt" type="text" placeholder="— or =500+50"
                      value={row.deposit}
                      onChange={e => updateRow(i, 'deposit', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && trySave(i)}
                      onBlur={() => setTimeout(() => trySave(i), 120)}
                      disabled={saving[i]} />
                    {row.deposit.trim().startsWith('=') && !isNaN(evalFormula(row.deposit)) && (
                      <span style={{ position: 'absolute', bottom: '-1.1rem', left: 0, fontSize: '0.7rem', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                        = {fmt(evalFormula(row.deposit))}
                      </span>
                    )}
                  </td>
                  <td></td>
                </tr>
              );
            })}
            <tr className="pt-reg-add-row">
              <td colSpan={6}>
                <button
                  className="pt-reg-add-row-btn"
                  onClick={() => setRows(prev => [...prev, { date: today(), desc: '', payment: '', deposit: '' }])}
                >
                  + Add row
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Defaults panel */}
      {showDefaults && (
        <div className="pt-defaults-panel">
          <div className="pt-defaults-panel__title">Regular income — repeats monthly</div>
          <div className="pt-defaults-panel__sub">Toggle ↻ on any income entry above to make it repeat next month automatically.</div>
          {curIncome.length === 0
            ? <p className="pt-defaults-panel__empty">No income entries this month yet.</p>
            : curIncome.map(e => (
              <div key={e.id} className="pt-defaults-panel__row">
                <span className="pt-defaults-panel__desc">{e.description || '(no description)'}</span>
                <span className="pt-defaults-panel__amt gain">{fmt(e.amount)}</span>
                <button
                  className={`pt-defaults-panel__btn${e.isDefault ? ' active' : ''}`}
                  onClick={() => toggleDefault(e.id, e.isDefault)}
                >
                  {e.isDefault ? '↻ Repeats' : '↻ One-time'}
                </button>
              </div>
            ))
          }
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="pt-budget-tin__toolbar">
        <button className="pt-toolbar-btn" onClick={() => setShowSurplus(v => !v)}>
          ⚙ Month-end surplus: <strong>{tin.surplusMode === 'slush' ? 'Slush fund' : 'Clear'}</strong>
        </button>
      </div>

      {/* Surplus mode picker */}
      {showSurplus && (
        <div className="pt-surplus-panel">
          <div className="pt-surplus-panel__title">What happens to leftover money at month end?</div>
          <div className="pt-surplus-panel__options">
            <button
              className={`pt-surplus-opt${tin.surplusMode === 'none' ? ' active' : ''}`}
              onClick={() => saveSurplusMode('none')}
            >
              <span className="pt-surplus-opt__icon">🧹</span>
              <span className="pt-surplus-opt__label">Clear</span>
              <span className="pt-surplus-opt__desc">Month closes clean. Surplus disappears.</span>
            </button>
            <button
              className={`pt-surplus-opt${tin.surplusMode === 'slush' ? ' active' : ''}`}
              onClick={() => saveSurplusMode('slush')}
            >
              <span className="pt-surplus-opt__icon">🪣</span>
              <span className="pt-surplus-opt__label">Slush fund</span>
              <span className="pt-surplus-opt__desc">Surplus sweeps into a separate tin and builds up over time.</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
