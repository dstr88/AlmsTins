import React, { useState, useMemo } from 'react';
import type { SplitsTin, SplitsPerson, SplitsBill, SplitsPayment } from './types';
import './SplitsTin.css';

/** Evaluate a formula like =1200+150, plain "1350", or =[Rent]*0.5. Returns NaN on invalid. */
function evalFormula(input: string, bills?: Array<{ name: string; amount: number }>): number {
  let s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  // Resolve [Bill Name] references
  if (bills) {
    let allResolved = true;
    s = s.replace(/\[([^\]]+)\]/g, (_, name) => {
      const bill = bills.find(b => b.name.toLowerCase() === name.trim().toLowerCase());
      if (bill == null) { allResolved = false; return '0'; }
      return String(bill.amount);
    });
    if (!allResolved) return NaN;
  }
  if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
  try { return Function('"use strict"; return (' + s + ')')(); }
  catch { return NaN; }
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

interface Props {
  tin: SplitsTin;
  budgetTinOptions: { id: string; name: string }[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

export default function SplitsTin({ tin, budgetTinOptions, onRefresh, onDelete }: Props) {
  const [addingPerson, setAddingPerson]   = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonOwner, setNewPersonOwner] = useState(false);

  // Bill form — inline grid with per-person amounts
  const [billForm, setBillForm] = useState<{
    name: string;
    total: string;
    perPerson: Record<string, string>;
  } | null>(null);

  const [payMode, setPayMode]             = useState<{ personId: string; billId: string } | null>(null);
  const [payAmt, setPayAmt]               = useState('');
  const [payDate, setPayDate]             = useState(today());
  const [saving, setSaving]               = useState(false);

  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [editAssign, setEditAssign]       = useState<{ billId: string; personId: string; type: 'flat' | 'pct'; value: string } | null>(null);
  const [andForm, setAndForm]             = useState<{ personId: string; name: string; amount: string } | null>(null);

  const curMonth = thisMonth();

  // ── Compute owed per person per bill this month ───────────────────────────
  const owedMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}; // personId → billId → owed
    for (const person of tin.people) {
      map[person.id] = {};
      for (const bill of tin.bills) {
        const assign = bill.assignments.find(a => a.personId === person.id);
        if (!assign) { map[person.id][bill.id] = 0; continue; }
        if (assign.type === 'flat') {
          map[person.id][bill.id] = assign.value;
        } else {
          map[person.id][bill.id] = bill.amount * (assign.value / 100);
        }
      }
    }
    return map;
  }, [tin.people, tin.bills]);

  // ── Payments this month per person per bill ───────────────────────────────
  const paidMap = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const pmt of tin.payments.filter(p => p.month === curMonth)) {
      if (!map[pmt.personId]) map[pmt.personId] = {};
      map[pmt.personId][pmt.billId] = (map[pmt.personId][pmt.billId] ?? 0) + pmt.amount;
    }
    return map;
  }, [tin.payments, curMonth]);

  // ── Total owed / paid / balance per person ────────────────────────────────
  const personTotals = useMemo(() => {
    return tin.people.map(person => {
      const carried = tin.carriedBalances[person.id] ?? 0;
      let owed = carried;
      let paid = 0;
      for (const bill of tin.bills) {
        owed += owedMap[person.id]?.[bill.id] ?? 0;
        paid += paidMap[person.id]?.[bill.id] ?? 0;
      }
      return { personId: person.id, owed, paid, balance: owed - paid };
    });
  }, [tin.people, tin.bills, owedMap, paidMap, tin.carriedBalances]);

  const allPaid = personTotals.every(t => t.balance <= 0);

  // ── Is a specific person/bill fully paid? ─────────────────────────────────
  function isCellPaid(personId: string, billId: string) {
    const owed = owedMap[personId]?.[billId] ?? 0;
    const paid = paidMap[personId]?.[billId] ?? 0;
    return owed > 0 && paid >= owed;
  }

  function cellPayments(personId: string, billId: string) {
    return tin.payments.filter(p => p.personId === personId && p.billId === billId && p.month === curMonth);
  }

  // ── API helpers ───────────────────────────────────────────────────────────
  async function api(body: object) {
    const res = await fetch('/api/petro-tins/splits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function addPerson() {
    if (!newPersonName.trim()) return;
    setSaving(true);
    await api({ action: 'add_person', splitsId: tin.id, name: newPersonName.trim(), isOwner: newPersonOwner });
    setNewPersonName(''); setAddingPerson(false); setNewPersonOwner(false);
    setSaving(false); onRefresh();
  }

  async function deletePerson(personId: string) {
    if (!confirm('Remove this person and all their payment history?')) return;
    await api({ action: 'delete_person', personId });
    onRefresh();
  }

  function openBillForm() {
    setBillForm({
      name: '',
      total: '',
      perPerson: Object.fromEntries(tin.people.map(p => [p.id, ''])),
    });
  }

  function splitEvenly() {
    if (!billForm) return;
    const total = evalFormula(billForm.total, tin.bills);
    if (isNaN(total) || tin.people.length === 0) return;
    const share = (total / tin.people.length).toFixed(2);
    setBillForm(f => f ? { ...f, perPerson: Object.fromEntries(tin.people.map(p => [p.id, share])) } : f);
  }

  function copyToAll(fromId: string) {
    if (!billForm) return;
    const val = billForm.perPerson[fromId];
    setBillForm(f => f ? { ...f, perPerson: Object.fromEntries(tin.people.map(p => [p.id, val])) } : f);
  }

  async function saveBillForm() {
    if (!billForm || !billForm.name.trim()) return;
    const total = evalFormula(billForm.total, tin.bills);
    if (isNaN(total) || total <= 0) return;
    setSaving(true);
    const res = await api({ action: 'add_bill', splitsId: tin.id, name: billForm.name.trim(), amount: total });
    if (res.id) {
      const assigns = tin.people
        .filter(p => billForm.perPerson[p.id]?.trim())
        .map(p => {
          const val = evalFormula(billForm.perPerson[p.id], tin.bills);
          return isNaN(val) ? null : api({ action: 'set_assignment', billId: res.id, personId: p.id, type: 'flat', value: val });
        })
        .filter(Boolean);
      await Promise.all(assigns);
    }
    setBillForm(null);
    setSaving(false);
    onRefresh();
  }

  async function saveAndForm() {
    if (!andForm || !andForm.name.trim()) return;
    const amt = evalFormula(andForm.amount, tin.bills);
    if (isNaN(amt) || amt <= 0) return;
    setSaving(true);
    // isDefault=false marks this as a person-specific bill (other people's cells stay blank)
    const res = await api({ action: 'add_bill', splitsId: tin.id, name: andForm.name.trim(), amount: amt, isDefault: false });
    if (res.id) {
      await api({ action: 'set_assignment', billId: res.id, personId: andForm.personId, type: 'flat', value: amt });
    }
    setAndForm(null);
    setSaving(false);
    onRefresh();
  }

  async function deleteBill(billId: string) {
    if (!confirm('Remove this bill and all its payments?')) return;
    await api({ action: 'delete_bill', billId });
    onRefresh();
  }

  async function saveAssignment() {
    if (!editAssign) return;
    const val = editAssign.type === 'pct'
      ? parseFloat(editAssign.value) || 0
      : evalFormula(editAssign.value);
    if (isNaN(val)) return;
    setSaving(true);
    await api({ action: 'set_assignment', billId: editAssign.billId, personId: editAssign.personId, type: editAssign.type, value: val });
    setEditAssign(null);
    setSaving(false); onRefresh();
  }

  async function recordPayment() {
    if (!payMode || !payAmt) return;
    const amt = parseFloat(payAmt);
    if (isNaN(amt) || amt <= 0) return;
    setSaving(true);
    await api({ action: 'add_payment', splitsId: tin.id, personId: payMode.personId, billId: payMode.billId, amount: amt, paidDate: payDate, budgetTinId: tin.budgetTinId });
    setPayMode(null); setPayAmt(''); setPayDate(today());
    setSaving(false); onRefresh();
  }

  async function deletePayment(paymentId: string) {
    await api({ action: 'delete_payment', paymentId });
    onRefresh();
  }

  function toggleHistory(key: string) {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (allPaid && tin.people.length > 0 && tin.bills.length > 0) {
    return (
      <div className="pt-splits-tin pt-splits-tin--allpaid">
        <div className="pt-splits-tin__header">
          <span className="pt-splits-tin__name">{tin.name}</span>
          <span className="pt-splits-allpaid-badge">✓ All paid</span>
          <button className="pt-splits-tin__del" onClick={() => onDelete(tin.id)} title="Delete">✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-splits-tin">
      {/* Header */}
      <div className="pt-splits-tin__header">
        <span className="pt-splits-tin__name">{tin.name}</span>
        <button className="pt-splits-tin__del" onClick={() => onDelete(tin.id)} title="Delete">✕</button>
      </div>

      {/* Empty state / people list when no bills yet */}
      {tin.people.length === 0 && (
        <div style={{ padding: '1rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Add people below, then add shared bills to split between them.
        </div>
      )}
      {tin.people.length > 0 && tin.bills.length === 0 && (
        <div style={{ padding: '0.75rem 1.25rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>People</div>
          {tin.people.map(person => (
            <div key={person.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
              <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', flex: 1 }}>{person.name}{person.isOwner ? ' 👑' : ''}</span>
              <button className="pt-splits-remove-person" style={{ opacity: 0.7, fontSize: '0.78rem' }} onClick={() => deletePerson(person.id)} title="Remove">✕ Remove</button>
            </div>
          ))}
          <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Add a bill below to start splitting.</div>
        </div>
      )}

      {/* Grid: rows = bills, columns = people */}
      {tin.people.length > 0 && tin.bills.length > 0 && (
        <div className="pt-splits-grid" style={{ '--col-count': tin.people.length + 1 } as any}>

          {/* Row 1: Names */}
          <div className="pt-splits-cell pt-splits-cell--label" />
          {tin.people.map(person => (
            <div key={person.id} className="pt-splits-cell pt-splits-cell--name">
              <span>{person.name}{person.isOwner ? ' 👑' : ''}</span>
              <button className="pt-splits-remove-person" onClick={() => deletePerson(person.id)} title="Remove">✕</button>
            </div>
          ))}

          {/* Row 2: Totals */}
          <div className="pt-splits-cell pt-splits-cell--label pt-splits-cell--total-label">Total</div>
          {personTotals.map(t => (
            <div key={t.personId} className={`pt-splits-cell pt-splits-cell--total ${t.balance <= 0 ? 'paid' : 'owed'}`}>
              {t.balance <= 0 ? '✓' : fmt(t.balance)}
              {(tin.carriedBalances[t.personId] ?? 0) > 0 && (
                <span className="pt-splits-carried-badge" title="Includes carried balance">
                  +{fmt(tin.carriedBalances[t.personId])} carried
                </span>
              )}
            </div>
          ))}

          {/* Bill rows */}
          {tin.bills.map(bill => (
            <React.Fragment key={bill.id}>
              <div className="pt-splits-cell pt-splits-cell--bill-label">
                <span>{bill.name}</span>
                <span className="pt-splits-bill-total">{fmt(bill.amount)}</span>
                <button className="pt-splits-remove-bill" onClick={() => deleteBill(bill.id)} title="Remove">✕</button>
              </div>

              {tin.people.map(person => {
                const owed   = owedMap[person.id]?.[bill.id] ?? 0;
                const paid   = paidMap[person.id]?.[bill.id] ?? 0;
                const done   = owed > 0 && paid >= owed;
                const pmts   = cellPayments(person.id, bill.id);
                const histKey = `${person.id}-${bill.id}`;
                const assign = bill.assignments.find(a => a.personId === person.id);

                // For person-specific bills (isDefault=false), blank cell for unassigned people
                const isPersonSpecific = !bill.isDefault && !assign;

                return (
                  <div key={`cell-${person.id}-${bill.id}`} className={`pt-splits-cell pt-splits-cell--data ${done ? 'done' : owed > 0 ? 'pending' : isPersonSpecific ? 'blank' : 'unset'}`}>
                    {/* Assignment display / edit */}
                    {isPersonSpecific ? null : editAssign?.billId === bill.id && editAssign?.personId === person.id ? (
                      <div className="pt-splits-assign-edit">
                        <select value={editAssign.type} onChange={e => setEditAssign(ea => ea ? { ...ea, type: e.target.value as 'flat' | 'pct' } : ea)} className="pt-splits-assign-select">
                          <option value="flat">$</option>
                          <option value="pct">%</option>
                        </select>
                        <input className="pt-splits-assign-input" type="number" value={editAssign.value}
                          onChange={e => setEditAssign(ea => ea ? { ...ea, value: e.target.value } : ea)}
                          onKeyDown={e => { if (e.key === 'Enter') saveAssignment(); if (e.key === 'Escape') setEditAssign(null); }}
                          autoFocus />
                        <button className="pt-splits-assign-save" onClick={saveAssignment} disabled={saving}>✓</button>
                      </div>
                    ) : (
                      <button className="pt-splits-assign-display" onClick={() => setEditAssign({ billId: bill.id, personId: person.id, type: assign?.type ?? 'flat', value: String(assign?.value ?? '') })}>
                        {owed > 0 ? (assign?.type === 'pct' ? `${assign.value}%` : fmt(owed)) : <span className="pt-splits-unset">set</span>}
                      </button>
                    )}

                    {/* Payment progress */}
                    {owed > 0 && !done && (
                      <div className="pt-splits-progress-wrap">
                        <div className="pt-splits-progress-bar" style={{ width: `${Math.min(100, (paid / owed) * 100)}%` }} />
                      </div>
                    )}

                    {/* Balance remaining */}
                    {owed > 0 && (
                      <div className={`pt-splits-balance ${done ? 'pt-splits-balance--done' : 'pt-splits-balance--owed'}`}>
                        {done ? '✓' : `-${fmt(owed - paid)}`}
                      </div>
                    )}

                    {/* Pay button */}
                    {owed > 0 && !done && (
                      payMode?.personId === person.id && payMode?.billId === bill.id ? (
                        <div className="pt-splits-pay-form">
                          <input className="pt-splits-pay-input" type="number" placeholder={fmt(owed - paid)} value={payAmt}
                            onChange={e => setPayAmt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') recordPayment(); if (e.key === 'Escape') setPayMode(null); }}
                            autoFocus />
                          <input className="pt-splits-pay-date" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
                          <div className="pt-splits-pay-actions">
                            <button className="pt-splits-pay-save" onClick={recordPayment} disabled={saving}>Save</button>
                            <button className="pt-splits-pay-cancel" onClick={() => setPayMode(null)}>✕</button>
                          </div>
                        </div>
                      ) : (
                        <button className="pt-splits-pay-btn" onClick={() => { setPayMode({ personId: person.id, billId: bill.id }); setPayAmt(String(owed - paid)); }}>
                          + Pay
                        </button>
                      )
                    )}

                    {/* Payment history — hidden when done, expandable when partial */}
                    {pmts.length > 0 && !done && (
                      <button className="pt-splits-history-toggle" onClick={() => toggleHistory(histKey)}>
                        {expandedHistory.has(histKey) ? '▲ hide' : `▼ ${pmts.length} payment${pmts.length > 1 ? 's' : ''}`}
                      </button>
                    )}
                    {expandedHistory.has(histKey) && pmts.map(pmt => (
                      <div key={pmt.id} className="pt-splits-history-row">
                        <span className="pt-splits-history-date">{pmt.paidDate}</span>
                        <span className="pt-splits-history-amt">{fmt(pmt.amount)}</span>
                        <button className="pt-splits-history-del" onClick={() => deletePayment(pmt.id)} title="Delete payment">✕</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}

          {/* "And" footer row — quick add a bill for one person */}
          <div className="pt-splits-cell pt-splits-cell--label pt-splits-cell--and-label" />
          {tin.people.map(person => (
            <div key={`and-${person.id}`} className="pt-splits-cell pt-splits-cell--and">
              {andForm?.personId === person.id ? (
                <div className="pt-splits-and-form">
                  <input className="pt-splits-and-input" placeholder="Bill name"
                    value={andForm.name}
                    onChange={e => setAndForm(f => f ? { ...f, name: e.target.value } : f)}
                    onKeyDown={e => e.key === 'Escape' && setAndForm(null)}
                    autoFocus />
                  <input className="pt-splits-and-input pt-splits-and-input--amt"
                    placeholder={tin.bills.length > 0 ? `=[${tin.bills[0].name}]*0.5` : '$ or =formula'}
                    value={andForm.amount}
                    onChange={e => setAndForm(f => f ? { ...f, amount: e.target.value } : f)}
                    onKeyDown={e => { if (e.key === 'Enter') saveAndForm(); if (e.key === 'Escape') setAndForm(null); }} />
                  {andForm.amount.trim().startsWith('=') && !isNaN(evalFormula(andForm.amount, tin.bills)) && (
                    <span className="pt-splits-formula-result">{fmt(evalFormula(andForm.amount, tin.bills))}</span>
                  )}
                  <div className="pt-splits-and-actions">
                    <button className="pt-splits-add-save" onClick={saveAndForm}
                      disabled={saving || !andForm.name.trim() || isNaN(evalFormula(andForm.amount, tin.bills))}>
                      Add
                    </button>
                    <button className="pt-splits-add-cancel" onClick={() => setAndForm(null)}>✕</button>
                  </div>
                </div>
              ) : (
                <button className="pt-splits-and-btn"
                  onClick={() => setAndForm({ personId: person.id, name: '', amount: '' })}>
                  + and
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add person */}
      <div className="pt-splits-add-row">
        {addingPerson ? (
          <div className="pt-splits-add-form">
            <input className="pt-splits-add-input" placeholder="Name" value={newPersonName}
              onChange={e => setNewPersonName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addPerson(); if (e.key === 'Escape') setAddingPerson(false); }}
              autoFocus />
            <label className="pt-splits-owner-label">
              <input type="checkbox" checked={newPersonOwner} onChange={e => setNewPersonOwner(e.target.checked)} />
              &nbsp;That's me
            </label>
            <button className="pt-splits-add-save" onClick={addPerson} disabled={saving}>Add</button>
            <button className="pt-splits-add-cancel" onClick={() => setAddingPerson(false)}>✕</button>
          </div>
        ) : (
          <button className="pt-splits-add-btn" onClick={() => setAddingPerson(true)}>+ Add person</button>
        )}
      </div>

      {/* Add bill — grid form */}
      <div className="pt-splits-add-row">
        {billForm ? (
          <div className="pt-splits-bill-form">
            {/* Bill name */}
            <input className="pt-splits-add-input pt-splits-bill-form__name"
              placeholder="Bill name (e.g. Rent)" value={billForm.name}
              onChange={e => setBillForm(f => f ? { ...f, name: e.target.value } : f)}
              onKeyDown={e => e.key === 'Escape' && setBillForm(null)}
              autoFocus />

            {/* Total row */}
            <div className="pt-splits-bill-form__total-row">
              <input className="pt-splits-add-input pt-splits-bill-form__total-input"
                placeholder="Total $ or =1200+150"
                value={billForm.total}
                onChange={e => setBillForm(f => f ? { ...f, total: e.target.value } : f)} />
              {!isNaN(evalFormula(billForm.total, tin.bills)) && billForm.total.trim().startsWith('=') && (
                <span className="pt-splits-formula-result">= {fmt(evalFormula(billForm.total, tin.bills))}</span>
              )}
              <button className="pt-splits-evenly-btn" onClick={splitEvenly}
                disabled={isNaN(evalFormula(billForm.total, tin.bills)) || tin.people.length === 0}
                title="Divide total evenly among all people">
                Split evenly
              </button>
            </div>

            {/* Per-person rows */}
            {tin.people.length > 0 && (
              <div className="pt-splits-bill-form__people">
                {tin.people.map((person, i) => (
                  <div key={person.id} className="pt-splits-bill-form__person-row">
                    <span className="pt-splits-bill-form__person-name">{person.name}{person.isOwner ? ' 👑' : ''}</span>
                    <input className="pt-splits-add-input pt-splits-add-input--amt"
                      placeholder="$ or =[Rent]*0.5"
                      value={billForm.perPerson[person.id] ?? ''}
                      onChange={e => setBillForm(f => f ? { ...f, perPerson: { ...f.perPerson, [person.id]: e.target.value } } : f)} />
                    {i === 0 && tin.people.length > 1 && (
                      <button className="pt-splits-copy-btn"
                        onClick={() => copyToAll(person.id)}
                        title="Copy this amount to everyone">
                        Copy to all ↓
                      </button>
                    )}
                    {billForm.perPerson[person.id]?.trim().startsWith('=') && !isNaN(evalFormula(billForm.perPerson[person.id], tin.bills)) && (
                      <span className="pt-splits-formula-result">{fmt(evalFormula(billForm.perPerson[person.id], tin.bills))}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-splits-add-form" style={{ marginTop: '0.5rem' }}>
              <button className="pt-splits-add-save" onClick={saveBillForm} disabled={saving || !billForm.name.trim() || isNaN(evalFormula(billForm.total, tin.bills))}>
                {saving ? 'Saving…' : 'Add Bill'}
              </button>
              <button className="pt-splits-add-cancel" onClick={() => setBillForm(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="pt-splits-add-btn" onClick={openBillForm}>+ Add bill</button>
        )}
      </div>
    </div>
  );
}
