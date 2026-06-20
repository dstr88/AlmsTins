import { useEffect, useState } from 'react';
import './VerifyDashboard.css';

type ProofStatus = 'unproven' | 'proven' | 'lapsed' | 'revoked';
interface Destination {
  id: string;
  kind: 'address' | 'qr';
  rail: string;
  value: string;
  label: string | null;
  proofStatus: ProofStatus;
  registeredAt: string;
}

const ADDRESS_RAILS = ['ethereum', 'polygon', 'avalanche', 'bitcoin', 'solana', 'litecoin'];
const LIMITS = { address: 3, qr: 1 } as const;
const RAIL_LABEL: Record<string, string> = {
  ethereum: 'Ethereum', polygon: 'Polygon', avalanche: 'Avalanche',
  bitcoin: 'Bitcoin', solana: 'Solana', litecoin: 'Litecoin', url: 'Link / URL',
};

function short(v: string): string {
  return v.length <= 24 ? v : `${v.slice(0, 12)}…${v.slice(-8)}`;
}

export default function VerifyDashboard() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/verify/destinations');
      const data = await res.json();
      if (data.ok) { setDestinations(data.destinations); setError(null); }
      else setError('Could not load your destinations.');
    } catch {
      setError('Could not load your destinations.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const addresses = destinations.filter(d => d.kind === 'address');
  const qrs = destinations.filter(d => d.kind === 'qr');

  return (
    <div className="vd">
      <div className="vd__notice">
        Ownership proof and live monitoring arrive in the next update. For now, register the
        destinations you want to watch — they're held privately under your account.
      </div>

      {error && <div className="vd__error">{error}</div>}

      <DestSection title="Receiving addresses" kind="address" limit={LIMITS.address}
        items={addresses} loading={loading} onChange={load} />
      <DestSection title="Payment QR" kind="qr" limit={LIMITS.qr}
        items={qrs} loading={loading} onChange={load} />
    </div>
  );
}

function DestSection({ title, kind, limit, items, loading, onChange }: {
  title: string; kind: 'address' | 'qr'; limit: number;
  items: Destination[]; loading: boolean; onChange: () => void;
}) {
  const atLimit = items.length >= limit;
  return (
    <section className="vd-sec">
      <div className="vd-sec__head">
        <h2 className="vd-sec__title">{title}</h2>
        <span className="vd-sec__count">{items.length} / {limit}</span>
      </div>
      <div className="vd-list">
        {items.map(d => <DestRow key={d.id} d={d} onChange={onChange} />)}
        {!loading && items.length === 0 && <p className="vd-sec__empty">None yet.</p>}
        {loading && items.length === 0 && <p className="vd-sec__empty">Loading…</p>}
      </div>
      {atLimit
        ? <p className="vd-sec__limit">Free early-access limit reached ({limit}). More capacity is coming.</p>
        : <AddForm kind={kind} onChange={onChange} />}
    </section>
  );
}

function DestRow({ d, onChange }: { d: Destination; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!window.confirm('Remove this destination?')) return;
    setBusy(true);
    try {
      await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      onChange();
    } finally { setBusy(false); }
  }
  return (
    <div className="vd-row">
      <span className="vd-row__rail">{RAIL_LABEL[d.rail] ?? d.rail}</span>
      <span className="vd-row__value" title={d.value}>{short(d.value)}</span>
      {d.label && <span className="vd-row__label">{d.label}</span>}
      <span className={`vd-badge vd-badge--${d.proofStatus}`}>{d.proofStatus}</span>
      <button className="vd-row__del" onClick={del} disabled={busy} aria-label="Remove destination">✕</button>
    </div>
  );
}

function AddForm({ kind, onChange }: { kind: 'address' | 'qr'; onChange: () => void }) {
  const [rail, setRail] = useState(kind === 'qr' ? 'url' : 'ethereum');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/verify/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, rail, value: value.trim(), label: label.trim() || null }),
      });
      const data = await res.json();
      if (data.ok) { setValue(''); setLabel(''); onChange(); }
      else setErr(data.message ?? 'Could not add that destination.');
    } catch {
      setErr('Could not add that destination.');
    } finally { setBusy(false); }
  }

  return (
    <form className="vd-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {kind === 'address' && (
        <select className="vd-add__rail" value={rail} onChange={e => setRail(e.target.value)} aria-label="Chain">
          {ADDRESS_RAILS.map(r => <option key={r} value={r}>{RAIL_LABEL[r]}</option>)}
        </select>
      )}
      <input className="vd-add__value" value={value} onChange={e => setValue(e.target.value)}
        placeholder={kind === 'qr' ? 'Payment link or address the QR encodes' : 'Receiving address'}
        spellCheck={false} autoComplete="off" />
      <input className="vd-add__label" value={label} onChange={e => setLabel(e.target.value)}
        placeholder="Label (optional)" maxLength={80} />
      <button className="vd-add__btn" type="submit" disabled={busy || !value.trim()}>
        {busy ? 'Adding…' : 'Register'}
      </button>
      {err && <span className="vd-add__err">{err}</span>}
    </form>
  );
}
