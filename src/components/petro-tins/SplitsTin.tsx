import React, { useState, useMemo } from 'react';
import type { SplitsTin, SplitsPerson, SplitsBill, SplitsPayment, PetroTinEntry } from './types';
import './SplitsTin.css';

/** Evaluate a formula like =1200+150, plain "1350", or =[Rent]*0.5.
 *  [Name] resolves against splits bills first, then budget entries by description. */
function evalFormula(
  input: string,
  bills?: Array<{ name: string; amount: number }>,
  budgetEntries?: Array<{ description: string; amount: number; kind: string }>,
): number {
  let s = input.trim().startsWith('=') ? input.trim().slice(1) : input.trim();
  if (!s) return NaN;
  if (bills || budgetEntries) {
    let allResolved = true;
    s = s.replace(/\[([^\]]+)\]/g, (_, name) => {
      const key = name.trim().toLowerCase();
      const bill = bills?.find(b => b.name.toLowerCase() === key);
      if (bill != null) return String(bill.amount);
      // Fall back to budget entries — match by description, use expense amount
      const entry = budgetEntries?.find(e => e.description.toLowerCase() === key);
      if (entry != null) return String(entry.amount);
      allResolved = false;
      return '0';
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

/** One named part of a person's share of a bill: "Rent" + "400", or a formula. */
type BillLine = { name: string; amount: string };

interface Props {
  tin: SplitsTin;
  budgetTinOptions: { id: string; name: string }[];
  budgetEntries: PetroTinEntry[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

export default function SplitsTin({ tin, budgetTinOptions, budgetEntries, onRefresh, onDelete }: Props) {
  const [addingPerson, setAddingPerson]   = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonOwner, setNewPersonOwner] = useState(false);

  // Bill form — each person has an array of line items that sum to their total

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

  // ── Spreadsheet edits ─────────────────────────────────────────────────────
  // Each row is a bill plus this person's share of it. The raw entry (a number or a
  // formula) is kept as the breakdown label so it survives a reload and stays editable.
  function clearDraft(key: string) { setDraft(d => { const n = { ...d }; delete n[key]; return n; }); }

  async function commitPerson(personId: string, current: string, key: string) {
    const next = (draft[key] ?? '').trim();
    clearDraft(key);
    if (!next || next === current) return;
    await api({ action: 'update_person', personId, name: next });
    onRefresh();
  }

  async function commitBill(billId: string, current: string, amount: number, key: string) {
    const next = (draft[key] ?? '').trim();
    clearDraft(key);
    if (!next || next === current) return;
    await api({ action: 'update_bill', billId, name: next, amount });
    onRefresh();
  }

  async function commitAmount(billId: string, personId: string, current: string, key: string) {
    const next = (draft[key] ?? '').trim();
    clearDraft(key);
    if (!next || next === current) return;
    const v = evalFormula(next, tin.bills, budgetEntries);
    if (isNaN(v)) return; // unresolved reference — leave the stored value alone
    await api({
      action: 'set_assignment', billId, personId, type: 'flat', value: v,
      breakdown: JSON.stringify([{ label: next, value: v }]),
    });
    onRefresh();
  }

  async function addRow(personId: string) {
    const lk = `new:${personId}:label`, ak = `new:${personId}:amt`;
    const label = (draft[lk] ?? '').trim();
    const raw = (draft[ak] ?? '').trim();
    if (!label || !raw) return;
    const v = evalFormula(raw, tin.bills, budgetEntries);
    if (isNaN(v)) return;
    setDraft(d => { const n = { ...d }; delete n[lk]; delete n[ak]; return n; });
    // isDefault false = this line belongs to one person, not the whole household
    const res = await api({ action: 'add_bill', splitsId: tin.id, name: label, amount: v, isDefault: false });
    if (res?.id) {
      await api({
        action: 'set_assignment', billId: res.id, personId, type: 'flat', value: v,
        breakdown: JSON.stringify([{ label: raw, value: v }]),
      });
    }
    onRefresh();
  }

  async function deletePerson(personId: string) {
    if (!confirm('Remove this person and all their payment history?')) return;
    await api({ action: 'delete_person', personId });
    onRefresh();
  }







  async function saveBillEdit() {
    if (!editBill || !editBill.name.trim()) return;
    const amount = evalFormula(editBill.amount, tin.bills, budgetEntries);
    if (isNaN(amount) || amount <= 0) return;
    setSaving(true);
    await api({ action: 'update_bill', billId: editBill.billId, name: editBill.name.trim(), amount });
    setEditBill(null);
    setSaving(false);
    onRefresh();
  }

  async function saveAndForm() {
    if (!andForm || !andForm.name.trim()) return;
    const amt = evalFormula(andForm.amount, tin.bills, budgetEntries);
    if (isNaN(amt) || amt <= 0) return;
    setSaving(true);
    // isDefault=false marks this as a person-specific bill (other people's cells stay blank)
    const res = await api({ action: 'add_bill', splitsId: tin.id, name: andForm.name.trim(), amount: amt, isDefault: false, noBudget: andForm.noBudget });
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
    <div className="pt-splits-layout">
    <div className="pt-splits-tin">
      {/* Header */}
      <div className="pt-splits-tin__header">
        <span className="pt-splits-tin__name">{tin.name}</span>
        <button className="pt-splits-tin__del" onClick={() => onDelete(tin.id)} title="Delete">✕</button>
      </div>

      {/* People list — always shown */}
      {tin.people.length === 0 && (
        <div style={{ padding: '1rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Add people below, then add shared bills to split between them.
        </div>
      )}

      {/* One plain spreadsheet per person: what they owe, how it was worked out, what it costs. */}
      {tin.people.length > 0 && (
        <div className="pt-splits-sheets">
          {tin.people.map(person => {
            const rows = tin.bills.filter(b => b.assignments.some(a => a.personId === person.id));
            const totals = personTotals.find(t => t.personId === person.id);
            const carried = tin.carriedBalances[person.id] ?? 0;
            const nk = `p:${person.id}`;
            const newLabel = draft[`new:${person.id}:label`] ?? '';
            const newAmt = draft[`new:${person.id}:amt`] ?? '';
            const newVal = evalFormula(newAmt, tin.bills, budgetEntries);
            return (
              <div key={person.id} className="pt-sheet">
                <div className="pt-sheet__head">
                  <input className="pt-sheet__name"
                    value={draft[nk] ?? person.name}
                    onChange={e => setDraft(d => ({ ...d, [nk]: e.target.value }))}
                    onBlur={() => commitPerson(person.id, person.name, nk)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  <button className="pt-sheet__pay"
                    onClick={() => setPersonPanelId(id => id === person.id ? null : person.id)}>Payments</button>
                  <button className="pt-sheet__del" title="Remove person"
                    onClick={() => deletePerson(person.id)}>✕</button>
                </div>

                <table className="pt-sheet__table">
                  <thead>
                    <tr>
                      <th>Item</th><th>Formula or amount</th>
                      <th className="pt-sheet__cost">Cost</th>
                      <th className="pt-sheet__cost">Paid</th>
                      <th className="pt-sheet__cost">Left</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(bill => {
                      const assign = bill.assignments.find(a => a.personId === person.id);
                      // The raw entry lives in the breakdown label, so a formula stays a formula.
                      let raw = String(assign?.value ?? '');
                      if (assign?.breakdown) {
                        try {
                          const ls = JSON.parse(assign.breakdown);
                          if (ls?.[0]?.label) raw = String(ls[0].label);
                        } catch { /* fall back to the number */ }
                      }
                      const owed = owedMap[person.id]?.[bill.id] ?? 0;
                      const paid = paidMap[person.id]?.[bill.id] ?? 0;
                      const left = owed - paid;
                      const lk = `b:${bill.id}`;
                      const ak = `a:${bill.id}:${person.id}`;
                      const shown = draft[ak] ?? raw;
                      const bad = shown.trim() !== '' && isNaN(evalFormula(shown, tin.bills, budgetEntries));
                      return (
                        <tr key={bill.id}>
                          <td>
                            <input value={draft[lk] ?? bill.name}
                              onChange={e => setDraft(d => ({ ...d, [lk]: e.target.value }))}
                              onBlur={() => commitBill(bill.id, bill.name, bill.amount, lk)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                          </td>
                          <td>
                            <input className={bad ? 'pt-sheet__bad' : ''}
                              value={shown}
                              onChange={e => setDraft(d => ({ ...d, [ak]: e.target.value }))}
                              onBlur={() => commitAmount(bill.id, person.id, raw, ak)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                          </td>
                          <td className="pt-sheet__cost">{fmt(owed)}</td>
                          <td className="pt-sheet__cost pt-sheet__paid">{paid > 0 ? fmt(paid) : '—'}</td>
                          <td className={`pt-sheet__cost ${left <= 0 ? 'pt-sheet__done' : 'pt-sheet__owed'}`}>{left <= 0 ? '✓' : fmt(left)}</td>
                          <td><button className="pt-sheet__del" title="Remove" onClick={() => deleteBill(bill.id)}>✕</button></td>
                        </tr>
                      );
                    })}

                    {/* Blank row — type a name and an amount to add a line */}
                    <tr>
                      <td>
                        <input placeholder="Rent" value={newLabel}
                          onChange={e => setDraft(d => ({ ...d, [`new:${person.id}:label`]: e.target.value }))} />
                      </td>
                      <td>
                        <input placeholder="=[Rent]*0.25 or 300" value={newAmt}
                          onChange={e => setDraft(d => ({ ...d, [`new:${person.id}:amt`]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') addRow(person.id); }}
                          onBlur={() => addRow(person.id)} />
                      </td>
                      <td className="pt-sheet__cost">{!isNaN(newVal) && newAmt.trim() ? fmt(newVal) : ''}</td>
                      <td></td><td></td><td></td>
                    </tr>

                    {carried > 0 && (
                      <tr>
                        <td colSpan={2} className="pt-sheet__muted">Carried from last month</td>
                        <td className="pt-sheet__cost">{fmt(carried)}</td>
                        <td className="pt-sheet__cost">—</td>
                        <td className="pt-sheet__cost pt-sheet__owed">{fmt(carried)}</td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="pt-sheet__foot">
                      <td colSpan={2}>Total</td>
                      <td className="pt-sheet__cost pt-sheet__totalcost">{fmt(totals?.owed ?? 0)}</td>
                      <td className="pt-sheet__cost pt-sheet__paid">{fmt(totals?.paid ?? 0)}</td>
                      <td className="pt-sheet__total">{fmt(Math.max(0, totals?.balance ?? 0))}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Person responsibility panel */}
      {personPanelId && (() => {
        const person = tin.people.find(p => p.id === personPanelId);
        if (!person) return null;
        const bills = tin.bills.filter(b => {
          const assign = b.assignments.find(a => a.personId === person.id);
          return assign != null;
        });
        const totals = personTotals.find(t => t.personId === person.id);
        return (
          <div className="pt-person-panel">
            <div className="pt-person-panel__header">
              <span className="pt-person-panel__name">{person.name}{person.isOwner ? ' 👑' : ''}</span>
              <span className="pt-person-panel__sub">Responsibilities this month</span>
              <button className="pt-person-panel__close" onClick={() => setPersonPanelId(null)}>✕</button>
            </div>
            <div className="pt-person-panel__list">
              {bills.length === 0 ? (
                <div className="pt-person-panel__empty">No bills assigned yet.</div>
              ) : bills.map(bill => {
                const owed = owedMap[person.id]?.[bill.id] ?? 0;
                const paid = paidMap[person.id]?.[bill.id] ?? 0;
                const done = owed > 0 && paid >= owed;
                const isPayingThis = payMode?.personId === person.id && payMode?.billId === bill.id;
                return (
                  <div key={bill.id} className={`pt-person-panel__row${done ? ' done' : ''}`}>
                    <div className="pt-person-panel__bill-left" style={{ flexWrap: 'wrap', gap: '0.3rem' }}>
                      {editBill?.billId === bill.id ? (
                        <div className="pt-splits-bill-edit">
                          <input className="pt-splits-bill-edit__name" value={editBill.name}
                            onChange={e => setEditBill(eb => eb ? { ...eb, name: e.target.value } : eb)}
                            onKeyDown={e => { if (e.key === 'Enter') saveBillEdit(); if (e.key === 'Escape') setEditBill(null); }}
                            autoFocus />
                          <input className="pt-splits-bill-edit__amt" value={editBill.amount}
                            onChange={e => setEditBill(eb => eb ? { ...eb, amount: e.target.value } : eb)}
                            onKeyDown={e => { if (e.key === 'Enter') saveBillEdit(); if (e.key === 'Escape') setEditBill(null); }}
                            onBlur={saveBillEdit} />
                          <button className="pt-splits-assign-save" onClick={saveBillEdit}>✓</button>
                        </div>
                      ) : (
                        <>
                          <button className="pt-splits-bill-name-btn"
                            onClick={() => setEditBill({ billId: bill.id, name: bill.name, amount: String(bill.amount) })}>
                            {bill.name}
                          </button>
                          <span className="pt-person-panel__bill-amt">{fmt(owed)}</span>
                          {(() => {
                            const assign = bill.assignments.find(a => a.personId === person.id);
                            if (!assign?.breakdown) return null;
                            try {
                              const lines: { label: string; value: number }[] = JSON.parse(assign.breakdown);
                              if (lines.length <= 1) return null;
                              return (
                                <div className="pt-panel-breakdown">
                                  {lines.map((l, i) => (
                                    <span key={i} className="pt-panel-breakdown__line">
                                      {l.label} = {fmt(l.value)}
                                    </span>
                                  ))}
                                </div>
                              );
                            } catch { return null; }
                          })()}
                        </>
                      )}
                    </div>
                    <div className="pt-person-panel__bill-right">
                      {done ? (
                        <span className="pt-person-panel__status paid">✓ paid</span>
                      ) : isPayingThis ? (
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
                        <>
                          <span className="pt-person-panel__status unpaid">-{fmt(owed - paid)}</span>
                          <button className="pt-splits-pay-btn" onClick={() => { setPayMode({ personId: person.id, billId: bill.id }); setPayAmt(String(owed - paid)); }}>+ Pay</button>
                          <button className="pt-splits-remove-bill" onClick={() => deleteBill(bill.id)} title="Remove">✕</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* + and button inside panel */}
            {andForm?.personId === person.id ? (
              <div className="pt-splits-and-form" style={{ margin: '0.5rem 0' }}>
                <input className="pt-splits-and-input" placeholder="Bill name"
                  value={andForm.name}
                  onChange={e => setAndForm(f => f ? { ...f, name: e.target.value } : f)}
                  onKeyDown={e => e.key === 'Escape' && setAndForm(null)} autoFocus />
                <input className="pt-splits-and-input pt-splits-and-input--amt"
                  placeholder="$ or =formula"
                  value={andForm.amount}
                  onChange={e => setAndForm(f => f ? { ...f, amount: e.target.value } : f)}
                  onKeyDown={e => { if (e.key === 'Enter') saveAndForm(); if (e.key === 'Escape') setAndForm(null); }} />
                <div className="pt-splits-and-actions">
                  <button className="pt-splits-add-save" onClick={saveAndForm}
                    disabled={saving || !andForm.name.trim() || isNaN(evalFormula(andForm.amount, tin.bills, budgetEntries))}>
                    Add
                  </button>
                  <button className="pt-splits-add-cancel" onClick={() => setAndForm(null)}>✕</button>
                </div>
              </div>
            ) : (
              <button className="pt-splits-and-btn" style={{ margin: '0.4rem 0 0' }}
                onClick={() => setAndForm({ personId: person.id, name: '', amount: '', noBudget: false })}>
                + add bill for {person.name}
              </button>
            )}
            {totals && (
              <div className="pt-person-panel__footer">
                <span>Total owed</span>
                <span className={totals.balance <= 0 ? 'gain' : 'loss'}>{fmt(totals.owed)}</span>
                <span>Paid</span>
                <span className="gain">{fmt(totals.paid)}</span>
                <span>Remaining</span>
                <span className={totals.balance <= 0 ? 'gain' : 'loss'}>{totals.balance <= 0 ? '✓ All paid' : fmt(totals.balance)}</span>
              </div>
            )}
          </div>
        );
      })()}

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

    </div>

    </div>
  );
}
