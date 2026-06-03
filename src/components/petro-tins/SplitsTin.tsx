import React, { useState, useMemo, useRef } from 'react';
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
  const [billForm, setBillForm] = useState<{
    name: string;
    total: string;
    perPerson: Record<string, string[]>;
    noBudget: boolean;
    editingBillId?: string; // set when editing an existing bill
  } | null>(null);

  const [payMode, setPayMode]             = useState<{ personId: string; billId: string } | null>(null);
  const [payAmt, setPayAmt]               = useState('');
  const [payDate, setPayDate]             = useState(today());
  const [saving, setSaving]               = useState(false);
  const [billNameError, setBillNameError] = useState(false);

  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const [editAssign, setEditAssign]       = useState<{ billId: string; personId: string; type: 'flat' | 'pct'; value: string } | null>(null);
  const [editBill, setEditBill]           = useState<{ billId: string; name: string; amount: string } | null>(null);
  const [andForm, setAndForm]             = useState<{ personId: string; name: string; amount: string; noBudget: boolean } | null>(null);
  const [focusedPersonId, setFocusedPersonId] = useState<string | null>(null);
  const [personPanelId, setPersonPanelId]     = useState<string | null>(null);
  const billFormRef = useRef<HTMLDivElement>(null);

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
    setBillNameError(false);
    setBillForm({
      name: '',
      total: '',
      perPerson: Object.fromEntries(tin.people.map(p => [p.id, ['']])),
      noBudget: false,
    });
  }

  function splitEvenly() {
    if (!billForm) return;
    const total = evalFormula(billForm.total, tin.bills, budgetEntries);
    if (isNaN(total) || tin.people.length === 0) return;
    const share = (total / tin.people.length).toFixed(2);
    setBillForm(f => f ? { ...f, perPerson: Object.fromEntries(tin.people.map(p => [p.id, [share]])) } : f);
  }

  function copyToAll(fromId: string) {
    if (!billForm) return;
    const lines = billForm.perPerson[fromId];
    setBillForm(f => f ? { ...f, perPerson: Object.fromEntries(tin.people.map(p => [p.id, [...lines]])) } : f);
  }

  function personLineTotal(personId: string): number {
    if (!billForm) return NaN;
    const lines = billForm.perPerson[personId] ?? [''];
    const sum = lines.reduce((s, line) => {
      const v = evalFormula(line, tin.bills, budgetEntries);
      return s + (isNaN(v) ? 0 : v);
    }, 0);
    return lines.some(l => l.trim()) ? sum : NaN;
  }

  async function doSaveBillForm(andAnother: boolean) {
    if (!billForm) return;
    if (!billForm.name.trim()) {
      setBillNameError(true);
      return;
    }

    // Total optional — auto-sum from per-person line items
    let total = evalFormula(billForm.total, tin.bills, budgetEntries);
    if (isNaN(total) && !billForm.total.trim()) {
      total = tin.people.reduce((s, p) => {
        const v = personLineTotal(p.id);
        return s + (isNaN(v) ? 0 : v);
      }, 0);
    }
    if (isNaN(total) || total <= 0) return;

    setSaving(true);
    let billId: string | null = billForm.editingBillId ?? null;

    if (billId) {
      // Update existing bill
      await api({ action: 'update_bill', billId, name: billForm.name.trim(), amount: total });
    } else {
      // Create new bill
      const res = await api({ action: 'add_bill', splitsId: tin.id, name: billForm.name.trim(), amount: total, noBudget: billForm.noBudget });
      billId = res.id ?? null;
    }

    if (billId) {
      const assigns = tin.people
        .filter(p => {
          const v = personLineTotal(p.id);
          return !isNaN(v) && v > 0;
        })
        .map(p => {
          const lines = (billForm.perPerson[p.id] ?? ['']).filter(l => l.trim());
          const breakdown = JSON.stringify(lines.map(l => ({
            label: l,
            value: evalFormula(l, tin.bills, budgetEntries),
          })).filter(item => !isNaN(item.value)));
          return api({ action: 'set_assignment', billId: billId!, personId: p.id, type: 'flat', value: personLineTotal(p.id), breakdown });
        });
      await Promise.all(assigns);
    }

    if (andAnother) {
      setBillForm({ name: '', total: '', perPerson: Object.fromEntries(tin.people.map(p => [p.id, ['']])), noBudget: false });
    } else {
      setBillForm(null);
    }
    setSaving(false);
    onRefresh();
  }

  const saveBillForm        = () => doSaveBillForm(false);
  const saveBillFormAndAnother = () => doSaveBillForm(true);

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

      {/* People list — always shown */}
      {tin.people.length === 0 && (
        <div style={{ padding: '1rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Add people below, then add shared bills to split between them.
        </div>
      )}

      {/* Person summary list */}
      {tin.people.length > 0 && (
        <div className="pt-splits-summary">
          {tin.people.map(person => {
            const totals = personTotals.find(t => t.personId === person.id);
            const isPaid = tin.bills.length > 0 && (totals?.balance ?? 0) <= 0;
            return (
              <div key={person.id} className="pt-splits-person-row">
                <input type="checkbox" className="pt-splits-person-chk"
                  checked={isPaid} readOnly
                  onClick={() => tin.bills.length > 0 && setPersonPanelId(id => id === person.id ? null : person.id)} />
                <button className="pt-splits-person-name-btn"
                  onClick={() => setPersonPanelId(id => id === person.id ? null : person.id)}>
                  {person.name}{person.isOwner ? ' 👑' : ''}
                </button>
                {tin.bills.length > 0 && (
                  <span className={`pt-splits-person-bal ${isPaid ? 'paid' : 'owed'}`}>
                    {isPaid ? '✓ Paid' : fmt(totals?.balance ?? 0)}
                  </span>
                )}
                <button className="pt-splits-remove-person" onClick={() => deletePerson(person.id)} title="Remove">✕</button>
              </div>
            );
          })}
          {tin.bills.length > 0 && (
            <div className="pt-splits-total-row">
              <span>Total</span>
              <span className="loss">{fmt(personTotals.reduce((s, t) => s + Math.max(0, t.balance), 0))}</span>
            </div>
          )}
          {tin.bills.length === 0 && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '0.25rem 0' }}>Add a bill below to start splitting.</div>
          )}
        </div>
      )}

      {tin.people.length > 0 && tin.bills.length > 0 && false && (
        <div className="pt-splits-grid" style={{ '--col-count': tin.people.length + 1 } as any}>

          {/* Row 1: Names */}
          <div className="pt-splits-cell pt-splits-cell--label" />
          {tin.people.map(person => (
            <div key={person.id} className="pt-splits-cell pt-splits-cell--name">
              <button className="pt-splits-person-name-btn"
                onClick={() => setPersonPanelId(id => id === person.id ? null : person.id)}
                title="View responsibilities">
                {person.name}{person.isOwner ? ' 👑' : ''}
              </button>
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
                {editBill?.billId === bill.id ? (
                  <div className="pt-splits-bill-edit">
                    <input className="pt-splits-bill-edit__name" value={editBill.name}
                      onChange={e => setEditBill(eb => eb ? { ...eb, name: e.target.value } : eb)}
                      onKeyDown={e => { if (e.key === 'Enter') saveBillEdit(); if (e.key === 'Escape') setEditBill(null); }}
                      autoFocus />
                    <input className="pt-splits-bill-edit__amt" value={editBill.amount}
                      placeholder="Amount"
                      onChange={e => setEditBill(eb => eb ? { ...eb, amount: e.target.value } : eb)}
                      onKeyDown={e => { if (e.key === 'Enter') saveBillEdit(); if (e.key === 'Escape') setEditBill(null); }}
                      onBlur={saveBillEdit} />
                    <button className="pt-splits-assign-save" onClick={saveBillEdit} disabled={saving}>✓</button>
                  </div>
                ) : (
                  <>
                    <button className="pt-splits-bill-name-btn"
                      onClick={() => setEditBill({ billId: bill.id, name: bill.name, amount: String(bill.amount) })}
                      title="Click to edit">
                      {bill.name}
                    </button>
                    {bill.noBudget && <span className="pt-splits-nobudget-badge" title="Other charge — not tracked in budget">other</span>}
                    <span className="pt-splits-bill-total">{fmt(bill.amount)}</span>
                    <button className="pt-splits-remove-bill" onClick={() => deleteBill(bill.id)} title="Remove">✕</button>
                  </>
                )}
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
                  {andForm.amount.trim().startsWith('=') && !isNaN(evalFormula(andForm.amount, tin.bills, budgetEntries)) && (
                    <span className="pt-splits-formula-result">{fmt(evalFormula(andForm.amount, tin.bills, budgetEntries))}</span>
                  )}
                  {budgetEntries.length > 0 && (
                    <div className="pt-splits-ref-chips pt-splits-ref-chips--compact">
                      {budgetEntries.map((e, i) => (
                        <button key={i} className="pt-splits-ref-chip"
                          onMouseDown={ev => {
                            ev.preventDefault();
                            setAndForm(f => f ? { ...f, amount: `=[${e.description}]` } : f);
                          }}
                          title={fmt(e.amount)}>
                          {e.description}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="pt-splits-nobudget-label">
                    <input type="checkbox" checked={andForm.noBudget}
                      onChange={e => setAndForm(f => f ? { ...f, noBudget: e.target.checked } : f)} />
                    &nbsp;Other charge — don't post to budget
                  </label>
                  <div className="pt-splits-and-actions">
                    <button className="pt-splits-add-save" onClick={saveAndForm}
                      disabled={saving || !andForm.name.trim() || isNaN(evalFormula(andForm.amount, tin.bills, budgetEntries))}>
                      Add
                    </button>
                    <button className="pt-splits-add-cancel" onClick={() => setAndForm(null)}>✕</button>
                  </div>
                </div>
              ) : (
                <button className="pt-splits-and-btn"
                  onClick={() => setAndForm({ personId: person.id, name: '', amount: '', noBudget: false })}>
                  + and
                </button>
              )}
            </div>
          ))}
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
                      {!done && !isPayingThis && (
                        <button className="pt-splits-bill-edit-btn"
                          title="Edit amounts"
                          onClick={() => {
                            const perPerson: Record<string, string[]> = Object.fromEntries(
                              tin.people.map(p => {
                                const assign = bill.assignments.find(a => a.personId === p.id);
                                return [p.id, assign ? [String(assign.value)] : ['']];
                              })
                            );
                            setBillNameError(false);
                            setFocusedPersonId(person.id);
                            setBillForm({ name: bill.name, total: '', perPerson, noBudget: bill.noBudget, editingBillId: bill.id });
                            setTimeout(() => billFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                          }}>
                          ✏️
                        </button>
                      )}
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

      {/* Add bill — grid form */}
      <div className="pt-splits-add-row" ref={billFormRef}>
        {billForm ? (
          <div className="pt-splits-bill-form">
            {/* Bill name */}
            <input className={`pt-splits-add-input pt-splits-bill-form__name${billNameError ? ' pt-splits-input--warn' : ''}`}
              placeholder={billNameError ? '⚠ Bill name is required' : 'Bill name (e.g. Rent)'}
              value={billForm.name}
              onChange={e => { setBillNameError(false); setBillForm(f => f ? { ...f, name: e.target.value } : f); }}
              onKeyDown={e => e.key === 'Escape' && setBillForm(null)}
              autoFocus />

            {/* Total row */}
            <div className="pt-splits-bill-form__total-row">
              <input className="pt-splits-add-input pt-splits-bill-form__total-input"
                placeholder="Total $ or =1200+150"
                value={billForm.total}
                onChange={e => setBillForm(f => f ? { ...f, total: e.target.value } : f)} />
              {!isNaN(evalFormula(billForm.total, tin.bills, budgetEntries)) && billForm.total.trim().startsWith('=') && (
                <span className="pt-splits-formula-result">= {fmt(evalFormula(billForm.total, tin.bills, budgetEntries))}</span>
              )}
              <button className="pt-splits-evenly-btn" onClick={splitEvenly}
                disabled={isNaN(evalFormula(billForm.total, tin.bills, budgetEntries)) || tin.people.length === 0}
                title="Divide total evenly among all people">
                Split evenly
              </button>
            </div>

            {/* Per-person rows */}
            {tin.people.length > 0 && (
              <div className="pt-splits-bill-form__people">
                {tin.people.map((person, i) => {
                  const lines = billForm.perPerson[person.id] ?? [''];
                  const lineTotal = personLineTotal(person.id);
                  return (
                    <div key={person.id} className={`pt-splits-bill-form__person-block${focusedPersonId === person.id ? ' pt-splits-bill-form__person-block--focused' : ''}`}>
                      <div className="pt-splits-bill-form__person-header">
                        <span className="pt-splits-bill-form__person-name">{person.name}{person.isOwner ? ' 👑' : ''}</span>
                        {!isNaN(lineTotal) && lines.length > 1 && (
                          <span className="pt-splits-formula-result pt-splits-line-total">= {fmt(lineTotal)}</span>
                        )}
                        {i === 0 && tin.people.length > 1 && (
                          <button className="pt-splits-copy-btn" onClick={() => copyToAll(person.id)} title="Copy to everyone">
                            Copy to all ↓
                          </button>
                        )}
                      </div>
                      {lines.map((line, li) => {
                        const resolved = evalFormula(line, tin.bills, budgetEntries);
                        const hasRef = /\[([^\]]+)\]/.test(line);
                        const unresolved = hasRef && isNaN(resolved);
                        return (
                          <div key={li} className="pt-splits-bill-form__line-row">
                            <input
                              className={`pt-splits-add-input pt-splits-add-input--amt${unresolved ? ' pt-splits-input--warn' : ''}`}
                              placeholder="$ or =[Rent]*0.5"
                              value={line}
                              onFocus={() => { setFocusedPersonId(person.id); }}
                              onChange={e => setBillForm(f => {
                                if (!f) return f;
                                const next = [...(f.perPerson[person.id] ?? [''])];
                                next[li] = e.target.value;
                                return { ...f, perPerson: { ...f.perPerson, [person.id]: next } };
                              })} />
                            {!isNaN(resolved) && line.trim() && (
                              <span className="pt-splits-formula-result">{fmt(resolved)}</span>
                            )}
                            {unresolved && (
                              <span className="pt-splits-ref-warn">not found</span>
                            )}
                            {lines.length > 1 && (
                              <button className="pt-splits-line-del" title="Remove line"
                                onClick={() => setBillForm(f => {
                                  if (!f) return f;
                                  const next = (f.perPerson[person.id] ?? ['']).filter((_, idx) => idx !== li);
                                  return { ...f, perPerson: { ...f.perPerson, [person.id]: next.length ? next : [''] } };
                                })}>✕</button>
                            )}
                          </div>
                        );
                      })}
                      <button className="pt-splits-add-line-btn"
                        onClick={() => setBillForm(f => {
                          if (!f) return f;
                          const next = [...(f.perPerson[person.id] ?? ['']), ''];
                          return { ...f, perPerson: { ...f.perPerson, [person.id]: next } };
                        })}>
                        + add line
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* No-budget toggle */}
            <label className="pt-splits-nobudget-label">
              <input type="checkbox" checked={billForm.noBudget}
                onChange={e => setBillForm(f => f ? { ...f, noBudget: e.target.checked } : f)} />
              &nbsp;Other charge — don't post to budget when paid
            </label>

            {/* Budget entry reference chips */}
            {budgetEntries.length > 0 && (
              <div className="pt-splits-ref-chips">
                <span className="pt-splits-ref-chips__label">From budget:</span>
                {budgetEntries.map((e, i) => (
                  <button key={i} className="pt-splits-ref-chip"
                    onMouseDown={ev => {
                      ev.preventDefault();
                      const targetId = focusedPersonId ?? tin.people[0]?.id;
                      if (!targetId) return;
                      setBillForm(f => {
                        if (!f) return f;
                        const lines = f.perPerson[targetId] ?? [''];
                        // Fill the last empty line, or append a new one
                        const lastEmpty = lines.map((l, i) => ({ l, i })).reverse().find(x => !x.l.trim());
                        const next = [...lines];
                        if (lastEmpty != null) next[lastEmpty.i] = `=[${e.description}]`;
                        else next.push(`=[${e.description}]`);
                        return { ...f, perPerson: { ...f.perPerson, [targetId]: next } };
                      });
                    }}
                    title={`Insert =[${e.description}] → ${fmt(e.amount)}`}>
                    {e.description} <span className="pt-splits-ref-chip__amt">{fmt(e.amount)}</span>
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const totalVal = evalFormula(billForm.total, tin.bills, budgetEntries);
              const personSum = tin.people.reduce((s, p) => {
                const v = personLineTotal(p.id);
                return s + (isNaN(v) ? 0 : v);
              }, 0);
              const canSave = billForm.name.trim() && ((!isNaN(totalVal) && totalVal > 0) || personSum > 0);
              const derivedTotal = !isNaN(totalVal) ? totalVal : personSum;
              return (
                <div className="pt-splits-add-form" style={{ marginTop: '0.5rem' }}>
                  <button className="pt-splits-add-save" onClick={saveBillForm} disabled={saving || !canSave}>
                    {saving ? 'Saving…' : billForm.editingBillId ? `Update Bill${derivedTotal > 0 && !billForm.total.trim() ? ` (${fmt(derivedTotal)})` : ''}` : `Save Bill${derivedTotal > 0 && !billForm.total.trim() ? ` (${fmt(derivedTotal)})` : ''}`}
                  </button>
                  <button className="pt-splits-add-save pt-splits-add-save--another" onClick={saveBillFormAndAnother} disabled={saving || !canSave}
                    title="Save this bill and immediately add another">
                    + another
                  </button>
                  <button className="pt-splits-add-cancel" onClick={() => setBillForm(null)}>Cancel</button>
                </div>
              );
            })()}
          </div>
        ) : (
          <button className="pt-splits-add-btn" onClick={openBillForm}>+ Add bill</button>
        )}
      </div>
    </div>
  );
}
