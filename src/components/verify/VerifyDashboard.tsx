import { useEffect, useState } from 'react';
import { decodeQrFromImageFile } from '../../lib/qrScan';
import type { VerifyDashboardLocale } from '../../i18n/dashboard/verify';
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
// Chain names are proper nouns (kept across languages); only the URL rail is localized.
const CHAIN_LABEL: Record<string, string> = {
  ethereum: 'Ethereum', polygon: 'Polygon', avalanche: 'Avalanche',
  bitcoin: 'Bitcoin', solana: 'Solana', litecoin: 'Litecoin',
};
function railLabel(rail: string, t: VerifyDashboardLocale): string {
  return rail === 'url' ? t.railUrl : (CHAIN_LABEL[rail] ?? rail);
}

function short(v: string): string {
  return v.length <= 24 ? v : `${v.slice(0, 12)}…${v.slice(-8)}`;
}

export default function VerifyDashboard({ t }: { t: VerifyDashboardLocale }) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/verify/destinations');
      const data = await res.json();
      if (data.ok) { setDestinations(data.destinations); setError(null); }
      else setError(t.loadError);
    } catch {
      setError(t.loadError);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const addresses = destinations.filter(d => d.kind === 'address');
  const qrs = destinations.filter(d => d.kind === 'qr');

  return (
    <div className="vd">
      <div className="vd__notice">{t.notice}</div>

      {error && <div className="vd__error">{error}</div>}

      {!loading && destinations.length > 0 && <VerifySign t={t} />}

      <DestSection title={t.addressesTitle} kind="address" limit={LIMITS.address}
        items={addresses} loading={loading} onChange={load} t={t} />
      <DestSection title={t.qrTitle} kind="qr" limit={LIMITS.qr}
        items={qrs} loading={loading} onChange={load} t={t} />
    </div>
  );
}

function DestSection({ title, kind, limit, items, loading, onChange, t }: {
  title: string; kind: 'address' | 'qr'; limit: number;
  items: Destination[]; loading: boolean; onChange: () => void; t: VerifyDashboardLocale;
}) {
  const atLimit = items.length >= limit;
  return (
    <section className="vd-sec">
      <div className="vd-sec__head">
        <h2 className="vd-sec__title">{title}</h2>
        <span className="vd-sec__count">{items.length} / {limit}</span>
      </div>
      <div className="vd-list">
        {items.map(d => <DestRow key={d.id} d={d} onChange={onChange} t={t} />)}
        {!loading && items.length === 0 && <p className="vd-sec__empty">{t.emptyNone}</p>}
        {loading && items.length === 0 && <p className="vd-sec__empty">{t.loading}</p>}
      </div>
      {atLimit
        ? <p className="vd-sec__limit">{t.limitReached.replace('{n}', String(limit))}</p>
        : <AddForm kind={kind} onChange={onChange} t={t} />}
    </section>
  );
}

function DestRow({ d, onChange, t }: { d: Destination; onChange: () => void; t: VerifyDashboardLocale }) {
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!window.confirm(t.confirmRemove)) return;
    setBusy(true);
    try {
      await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      onChange();
    } finally { setBusy(false); }
  }
  return (
    <div className="vd-row">
      <span className="vd-row__rail">{railLabel(d.rail, t)}</span>
      <span className="vd-row__value" title={d.value}>{short(d.value)}</span>
      {d.label && <span className="vd-row__label">{d.label}</span>}
      <span className={`vd-badge vd-badge--${d.proofStatus}`}>{d.proofStatus}</span>
      <button className="vd-row__del" onClick={del} disabled={busy} aria-label={t.removeAria}>✕</button>
    </div>
  );
}

function AddForm({ kind, onChange, t }: { kind: 'address' | 'qr'; onChange: () => void; t: VerifyDashboardLocale }) {
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
      else setErr(
        data.error === 'limit_reached' ? t.limitReached.replace('{n}', String(LIMITS[kind]))
        : data.error === 'duplicate' ? t.addErrDuplicate
        : data.error === 'invalid' ? t.addErrInvalid
        : (data.message ?? t.addError),
      );
    } catch {
      setErr(t.addError);
    } finally { setBusy(false); }
  }

  return (
    <form className="vd-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {kind === 'address' && (
        <select className="vd-add__rail" value={rail} onChange={e => setRail(e.target.value)} aria-label={t.chainAria}>
          {ADDRESS_RAILS.map(r => <option key={r} value={r}>{railLabel(r, t)}</option>)}
        </select>
      )}
      <input className="vd-add__value" value={value} onChange={e => setValue(e.target.value)}
        placeholder={kind === 'qr' ? t.qrPlaceholder : t.addrPlaceholder}
        spellCheck={false} autoComplete="off" />
      <input className="vd-add__label" value={label} onChange={e => setLabel(e.target.value)}
        placeholder={t.labelPlaceholder} maxLength={80} />
      <button className="vd-add__btn" type="submit" disabled={busy || !value.trim()}>
        {busy ? t.addingBtn : t.registerBtn}
      </button>
      {err && <span className="vd-add__err">{err}</span>}
    </form>
  );
}

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'match'; label: string | null; rail: string }
  | { status: 'nomatch'; value: string }
  | { status: 'error'; message: string };

// Scan or paste a payment QR/address and check it against the tenant's OWN
// registered destinations — "✓ still yours" vs "⚠ swapped". The QR is decoded
// on-device (jsQR via qrScan.ts); only the decoded string is sent.
function VerifySign({ t }: { t: VerifyDashboardLocale }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const [scanning, setScanning] = useState(false);

  async function check(override?: string) {
    const q = (override ?? value).trim();
    if (!q) return;
    setState({ status: 'checking' });
    try {
      const res = await fetch('/api/verify/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: q }),
      });
      const data = await res.json();
      if (!data.ok) { setState({ status: 'error', message: data.message ?? t.checkFailed }); return; }
      if (data.matched) setState({ status: 'match', label: data.destination?.label ?? null, rail: data.destination?.rail ?? '' });
      else setState({ status: 'nomatch', value: q });
    } catch {
      setState({ status: 'error', message: t.verifyNetworkError });
    }
  }

  // Open camera / photo picker, decode on-device, then check the payload.
  function scan() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment'); // rear camera on mobile
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return; // cancelled — stay silent
      setScanning(true);
      setState({ status: 'idle' });
      try {
        const payload = await decodeQrFromImageFile(file);
        if (!payload) { setState({ status: 'error', message: t.noQrFound }); return; }
        setValue(payload);
        await check(payload);
      } catch {
        setState({ status: 'error', message: t.scanReadError });
      } finally {
        setScanning(false);
      }
    };
    input.click();
  }

  const matchDetail =
    state.status === 'match'
      ? (state.label ? `“${state.label}”` : state.rail ? railLabel(state.rail, t) : '')
      : '';

  return (
    <section className="vd-verify">
      <h2 className="vd-verify__title">{t.verifyTitle}</h2>
      <p className="vd-verify__hint">{t.verifyHint}</p>
      <form className="vd-verify__row" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <input
          className="vd-verify__input"
          value={value}
          onChange={(e) => { setValue(e.target.value); if (state.status !== 'idle' && state.status !== 'checking') setState({ status: 'idle' }); }}
          placeholder={t.verifyPlaceholder}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="vd-verify__scan" onClick={scan} disabled={scanning}>
          {scanning ? t.scanningBtn : t.scanBtn}
        </button>
        <button type="submit" className="vd-verify__btn" disabled={state.status === 'checking' || !value.trim()}>
          {state.status === 'checking' ? t.checkingBtn : t.checkBtn}
        </button>
      </form>

      {state.status === 'match' && (
        <div className="vd-verify__result vd-verify__result--ok">
          {matchDetail ? t.matchWith.replace('{what}', matchDetail) : t.match}
        </div>
      )}
      {state.status === 'nomatch' && (
        <div className="vd-verify__result vd-verify__result--warn">{t.noMatch}</div>
      )}
      {state.status === 'error' && (
        <div className="vd-verify__result vd-verify__result--err">{state.message}</div>
      )}
    </section>
  );
}
