import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './ReceiptRegistry.css';

// Local shape (mirrors GET /api/petro-tins/receipts) — do NOT import the server
// lib here, or its db code would be pulled into the client bundle.
interface Receipt {
  id:          string;
  receiptDate: string;
  amount:      number;
  description: string | null;
  category:    string | null;
  filename:    string | null;
  mimeType:    string | null;
  fileSize:    number | null;
  hasPhoto:    boolean;
  createdAt:   string;
}

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReceiptRegistry({ isDemo = false }: { isDemo?: boolean }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading]   = useState(true);
  const [year, setYear]         = useState<string>('all');

  // Add-form state
  const [date, setDate]       = useState(todayIso());
  const [amount, setAmount]   = useState('');
  const [desc, setDesc]       = useState('');
  const [category, setCategory] = useState('');
  const [file, setFile]       = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/petro-tins/receipts');
      if (res.ok) {
        const data = await res.json();
        setReceipts(data.receipts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Distinct years present, newest first
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const r of receipts) set.add(r.receiptDate.slice(0, 4));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [receipts]);

  const filtered = useMemo(
    () => (year === 'all' ? receipts : receipts.filter(r => r.receiptDate.startsWith(year))),
    [receipts, year],
  );

  const total = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  const exportUrl = `/api/petro-tins/receipts/export${year !== 'all' ? `?year=${year}` : ''}`;

  async function submitReceipt() {
    setError(null);

    const amt = Number(amount);
    if (!isFinite(amt) || amt < 0) { setError('Enter a valid amount.'); return; }
    if (file) {
      if (!ALLOWED.includes(file.type)) { setError('Photo must be PNG, JPG, GIF, WEBP, or PDF.'); return; }
      if (file.size > MAX_SIZE) { setError('Photo is too large (max 5 MB).'); return; }
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set('amount', String(amt));
      fd.set('receiptDate', date || todayIso());
      fd.set('description', desc);
      fd.set('category', category);
      if (file) fd.set('file', file);

      const res = await fetch('/api/petro-tins/receipts', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not save the receipt.');
        return;
      }
      // Reset (keep the date — people often log several from one session/day)
      setAmount(''); setDesc(''); setCategory(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch {
      setError('Could not save the receipt. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this receipt and its photo? This cannot be undone.')) return;
    await fetch(`/api/petro-tins/receipts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="rcpt" id="receipts">
      <header className="rcpt__head">
        <div className="rcpt__head-text">
          <h2 className="rcpt__title">🧾 Receipts</h2>
          <p className="rcpt__subtitle">
            Log every receipt and keep the photo for your tax preparer. Stored long-term and never
            auto-deleted — use <strong>Download all</strong> for a permanent copy to hand over at tax time.
          </p>
        </div>
        <a className="rcpt__export" href={exportUrl} title="Download every receipt photo + a CSV summary as a ZIP">
          ⬇ Download all{year !== 'all' ? ` (${year})` : ''}
        </a>
      </header>

      {!isDemo && (
        <form className="rcpt__form" onSubmit={e => { e.preventDefault(); void submitReceipt(); }}>
          <div className="rcpt__field rcpt__field--date">
            <label className="rcpt__label">Date</label>
            <input className="rcpt__input" type="date" value={date}
              onChange={e => setDate(e.target.value)} required />
          </div>
          <div className="rcpt__field rcpt__field--amount">
            <label className="rcpt__label">Amount</label>
            <input className="rcpt__input rcpt__input--amount" type="number" step="0.01" min="0"
              placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div className="rcpt__field rcpt__field--desc">
            <label className="rcpt__label">What it was for</label>
            <input className="rcpt__input" type="text" maxLength={200}
              placeholder="e.g. Office supplies — Staples" value={desc}
              onChange={e => setDesc(e.target.value)} />
          </div>
          <div className="rcpt__field rcpt__field--cat">
            <label className="rcpt__label">Category <span className="rcpt__opt">(optional)</span></label>
            <input className="rcpt__input" type="text" maxLength={80}
              placeholder="e.g. Supplies" value={category} onChange={e => setCategory(e.target.value)} />
          </div>
          <div className="rcpt__field rcpt__field--file">
            <label className="rcpt__label">Photo <span className="rcpt__opt">(optional)</span></label>
            <input ref={fileRef} className="rcpt__input rcpt__input--file" type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button className="rcpt__add-btn" type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : '＋ Add receipt'}
          </button>
        </form>
      )}

      {error && <p className="rcpt__error">{error}</p>}
      {isDemo && <p className="rcpt__demo-note">Demo mode is read-only — sign in to save your own receipts.</p>}

      {/* Summary + year filter */}
      <div className="rcpt__bar">
        <div className="rcpt__totals">
          <span className="rcpt__count">{filtered.length} {filtered.length === 1 ? 'receipt' : 'receipts'}</span>
          <span className="rcpt__total-amt">{fmt(total)}</span>
        </div>
        {years.length > 0 && (
          <label className="rcpt__year">
            <span className="rcpt__year-label">Year</span>
            <select className="rcpt__select" value={year} onChange={e => setYear(e.target.value)}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <p className="rcpt__loading">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="rcpt__empty">
          {receipts.length === 0
            ? 'No receipts yet. Add your first one above — amount, what it was for, and a photo.'
            : `No receipts for ${year}.`}
        </p>
      ) : (
        <div className="rcpt__table-wrap">
          <table className="rcpt__table">
            <thead>
              <tr>
                <th className="col-date">Date</th>
                <th className="col-desc">What it was for</th>
                <th className="col-cat">Category</th>
                <th className="col-amt">Amount</th>
                <th className="col-photo">Receipt</th>
                {!isDemo && <th className="col-del" aria-label="Delete" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const photoUrl = `/api/petro-tins/receipts/${r.id}/photo`;
                const isPdf = r.mimeType === 'application/pdf';
                return (
                  <tr key={r.id}>
                    <td className="col-date">{r.receiptDate}</td>
                    <td className="col-desc">{r.description || <span className="rcpt__muted">—</span>}</td>
                    <td className="col-cat">{r.category || <span className="rcpt__muted">—</span>}</td>
                    <td className="col-amt">{fmt(r.amount)}</td>
                    <td className="col-photo">
                      {!r.hasPhoto ? (
                        <span className="rcpt__muted">—</span>
                      ) : isPdf ? (
                        <a className="rcpt__pdf" href={photoUrl} target="_blank" rel="noopener noreferrer">📄 PDF</a>
                      ) : (
                        <a href={photoUrl} target="_blank" rel="noopener noreferrer" title="View full receipt">
                          <img className="rcpt__thumb" src={photoUrl} alt="Receipt" loading="lazy" />
                        </a>
                      )}
                    </td>
                    {!isDemo && (
                      <td className="col-del">
                        <button className="rcpt__del" title="Delete receipt" onClick={() => handleDelete(r.id)}>✕</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
