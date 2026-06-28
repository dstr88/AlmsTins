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
  proofDomain: string | null;
  registeredAt: string;
  monitorUrl: string | null;
  monitorStatus: string | null;
  monitorCheckedAt: string | null;
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

// Localized proof-status badge label. The raw status still drives the CSS class.
function statusLabel(s: ProofStatus, t: VerifyDashboardLocale): string {
  return s === 'proven' ? t.statusProven
    : s === 'lapsed' ? t.statusLapsed
    : s === 'revoked' ? t.statusRevoked
    : t.statusUnproven;
}

// Name-service handles (vitalik.eth, foo.sol …) resolve to an address — they take
// the wallet safety check, not the website check, despite containing a dot.
const NAME_SERVICE_TLD = /\.(eth|sol|crypto|nft|wallet|bnb|x|dao|zil|blockchain|888)$/i;

// Decide whether a scanned/pasted payload is a website / payment URL (→ dapp-check)
// or a blockchain address / payment URI (→ wallet-check). Mirrors the public
// wallet-checker's classifier so both surfaces route a scan the same way.
function classifyScan(raw: string): { kind: 'url' | 'address'; value: string } {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return { kind: 'url', value: s };
  const evm = s.match(/0x[a-fA-F0-9]{40}/);
  if (evm) return { kind: 'address', value: evm[0] };
  const host = s.split(/[/?#\s]/)[0];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && !NAME_SERVICE_TLD.test(host)) {
    return { kind: 'url', value: s };
  }
  const noScheme = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, '');
  return { kind: 'address', value: noScheme.split(/[?@\s]/)[0].trim() };
}

export default function VerifyDashboard({ t, isDemo = false }: { t: VerifyDashboardLocale; isDemo?: boolean }) {
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
      {isDemo
        ? <div className="vd__demo-banner"><span>{t.demoBanner}</span></div>
        : <div className="vd__notice">{t.notice}</div>}

      {error && <div className="vd__error">{error}</div>}

      {!loading && destinations.length > 0 && <VerifySign t={t} />}

      <DestSection title={t.addressesTitle} kind="address" limit={LIMITS.address}
        items={addresses} loading={loading} onChange={load} t={t} isDemo={isDemo} />
      <DestSection title={t.qrTitle} kind="qr" limit={LIMITS.qr}
        items={qrs} loading={loading} onChange={load} t={t} isDemo={isDemo} />

      {isDemo ? <HowToAdd t={t} /> : <EntitiesSection t={t} />}
    </div>
  );
}

// Demo-only "how to register your own" guide — wallet address, Stripe link, and the
// exchange path. Pure explainer (no writes); shown in place of the live tools in demo.
function HowToAdd({ t }: { t: VerifyDashboardLocale }) {
  const blocks = [
    { title: t.howToWalletTitle, steps: t.howToWalletSteps },
    { title: t.howToStripeTitle, steps: t.howToStripeSteps },
    { title: t.howToExchangeTitle, steps: t.howToExchangeSteps },
    { title: t.howToCustomerTitle, steps: t.howToCustomerSteps },
  ];
  return (
    <section className="vd-howto">
      <h2 className="vd-howto__heading">{t.howToHeading}</h2>
      {blocks.map((b, i) => (
        <details className="vd-howto__item" key={i} open={i === 0}>
          <summary className="vd-howto__summary">{b.title}</summary>
          <ol className="vd-howto__steps">
            {b.steps.map((s, j) => <li key={j}>{s}</li>)}
          </ol>
        </details>
      ))}
      <a className="vd-howto__cta" href="/login">{t.demoSignupCta}</a>
    </section>
  );
}

// ── Verified entities (hosted-API-endpoint variant: exchanges / large platforms) ──
interface VEntity {
  id: string;
  domain: string;
  proofStatus: 'unproven' | 'proven';
  challenge: string;
  hasEndpoint: boolean;
  hasKey: boolean;
  apiEndpoint: string | null;
  lastPullStatus: string | null;
  lastPullCount: number;
}

const ENTITY_WK_PATH = '/.well-known/almstins-verify.json';
// Mirrors buildProofFile(challenge, []) in verifyProof.ts — entity proof is
// domain-only, so the published file carries the challenge and an empty list.
function entityProofFile(challenge: string): string {
  return JSON.stringify({ almstins: { version: 1, challenge, addresses: [] } }, null, 2);
}

function EntitiesSection({ t }: { t: VerifyDashboardLocale }) {
  const [entities, setEntities] = useState<VEntity[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/verify/entities');
      const data = await res.json();
      if (data.ok) setEntities(data.entities);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return (
    <section className="vd-sec ve">
      <div className="vd-sec__head"><h2 className="vd-sec__title">{t.entHeading}</h2></div>
      <p className="ve__intro">{t.entIntro}</p>
      <div className="vd-list">
        {entities.map(e => <EntityCard key={e.id} e={e} t={t} onChange={load} />)}
        {!loading && entities.length === 0 && <p className="vd-sec__empty">{t.entEmpty}</p>}
        {loading && entities.length === 0 && <p className="vd-sec__empty">{t.loading}</p>}
      </div>
      <EntityAddForm t={t} onChange={load} />
    </section>
  );
}

function EntityAddForm({ t, onChange }: { t: VerifyDashboardLocale; onChange: () => void }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    const d = domain.trim();
    if (!d) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/verify/entities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: d }),
      });
      const data = await res.json();
      if (data.outcome === 'invalid_domain') { setErr(t.proofInvalidDomain); return; }
      if (data.ok && data.entity) { setDomain(''); onChange(); }
      else setErr(t.entError);
    } catch { setErr(t.entError); } finally { setBusy(false); }
  }
  return (
    <form className="vd-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input className="vd-add__value" value={domain} onChange={(e) => setDomain(e.target.value)}
        placeholder={t.entDomainPlaceholder} spellCheck={false} autoComplete="off" />
      <button className="vd-add__btn" type="submit" disabled={busy || !domain.trim()}>
        {busy ? t.entAddingBtn : t.entAddBtn}
      </button>
      {err && <span className="vd-add__err">{err}</span>}
    </form>
  );
}

function EntityCard({ e, t, onChange }: { e: VEntity; t: VerifyDashboardLocale; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);
  const [endpoint, setEndpoint] = useState(e.apiEndpoint ?? '');
  const [apiKey, setApiKey] = useState('');
  const proven = e.proofStatus === 'proven';

  async function del() {
    if (!window.confirm(t.confirmRemove)) return;
    setBusy(true);
    try { await fetch(`/api/verify/entities/${encodeURIComponent(e.id)}`, { method: 'DELETE' }); onChange(); }
    finally { setBusy(false); }
  }

  async function prove() {
    setBusy(true); setOutcome(null);
    try {
      const res = await fetch(`/api/verify/entities/${encodeURIComponent(e.id)}/prove`, { method: 'POST' });
      const data = await res.json();
      const ok = data.outcome === 'proven';
      const map: Record<string, string> = {
        proven: t.proofProven, challenge_mismatch: t.proofChallengeMismatch,
        unreachable: t.proofUnreachable, malformed: t.proofMalformed, invalid_domain: t.proofInvalidDomain,
      };
      setOutcome({ text: data.ok ? (map[data.outcome] ?? t.entError) : t.entError, ok });
      if (ok) setTimeout(onChange, 1200);
    } catch { setOutcome({ text: t.entError, ok: false }); } finally { setBusy(false); }
  }

  async function connect() {
    if (!endpoint.trim() || !apiKey.trim()) return;
    setBusy(true); setOutcome(null);
    try {
      const res = await fetch(`/api/verify/entities/${encodeURIComponent(e.id)}/connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpoint.trim(), apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      const ok = data.outcome === 'pulled';
      const map: Record<string, string> = {
        invalid_endpoint: t.entInvalidEndpoint, no_endpoint: t.entInvalidEndpoint, invalid_domain: t.entInvalidEndpoint,
        not_proven: t.entNotProven, encryption_unavailable: t.entEncUnavailable,
        unauthorized: t.entUnauthorized, unreachable: t.entUnreachable, malformed: t.entMalformed,
      };
      const text = ok ? t.entPulled.replace('{n}', String(data.count ?? 0)) : (map[data.outcome] ?? t.entError);
      setOutcome({ text, ok });
      if (ok) { setApiKey(''); setTimeout(onChange, 1400); }
    } catch { setOutcome({ text: t.entError, ok: false }); } finally { setBusy(false); }
  }

  const file = entityProofFile(e.challenge);
  const wkUrl = `https://${e.domain}${ENTITY_WK_PATH}`;

  return (
    <div className="ve-card">
      <div className="ve-card__head">
        <span className="ve-card__domain">{e.domain}</span>
        <span className={`vd-badge vd-badge--${e.proofStatus}`}>{proven ? t.statusProven : t.statusUnproven}</span>
        {proven && e.hasEndpoint && e.lastPullStatus === 'ok' && (
          <span className="ve-card__synced">{t.entSynced.replace('{n}', String(e.lastPullCount))}</span>
        )}
        <button className="vd-row__del" onClick={del} disabled={busy} aria-label={t.removeAria}>✕</button>
      </div>

      {!proven && (
        <div className="vd-prove">
          <p className="vd-prove__steps">{t.proveStep1.replace('{url}', wkUrl)}</p>
          <pre className="vd-prove__pre">{file}</pre>
          <div className="vd-prove__row">
            <button className="vd-prove__copy" onClick={() => { void navigator.clipboard?.writeText(file); }}>{t.proveCopyBtn}</button>
            <button className="vd-prove__verify" onClick={prove} disabled={busy}>{busy ? t.proveVerifyingBtn : t.proveVerifyBtn}</button>
          </div>
        </div>
      )}

      {proven && (
        <div className="vd-prove">
          <p className="vd-prove__hint">{t.entConnectPrompt}</p>
          <input className="vd-prove__input" value={endpoint} onChange={(ev) => setEndpoint(ev.target.value)}
            placeholder={t.entEndpointPlaceholder} spellCheck={false} autoComplete="off" />
          <input className="vd-prove__input" type="password" value={apiKey} onChange={(ev) => setApiKey(ev.target.value)}
            placeholder={t.entKeyPlaceholder} autoComplete="off" style={{ marginTop: '0.5rem' }} />
          <div className="vd-prove__row" style={{ marginTop: '0.5rem' }}>
            <button className="vd-prove__verify" onClick={connect} disabled={busy || !endpoint.trim() || !apiKey.trim()}>
              {busy ? t.entConnectingBtn : t.entConnectBtn}
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <div className={`vd-prove__outcome ${outcome.ok ? 'vd-prove__outcome--ok' : 'vd-prove__outcome--warn'}`}>{outcome.text}</div>
      )}
    </div>
  );
}

function DestSection({ title, kind, limit, items, loading, onChange, t, isDemo }: {
  title: string; kind: 'address' | 'qr'; limit: number;
  items: Destination[]; loading: boolean; onChange: () => void; t: VerifyDashboardLocale; isDemo?: boolean;
}) {
  const atLimit = items.length >= limit;
  return (
    <section className="vd-sec">
      <div className="vd-sec__head">
        <h2 className="vd-sec__title">{title}</h2>
        <span className="vd-sec__count">{items.length} / {limit}</span>
      </div>
      <div className="vd-list">
        {items.map(d => <DestRow key={d.id} d={d} onChange={onChange} t={t} isDemo={isDemo} />)}
        {!loading && items.length === 0 && <p className="vd-sec__empty">{t.emptyNone}</p>}
        {loading && items.length === 0 && <p className="vd-sec__empty">{t.loading}</p>}
      </div>
      {/* Live add-form is hidden in the demo — registering is a real-account action. */}
      {!isDemo && (atLimit
        ? <p className="vd-sec__limit">{t.limitReached.replace('{n}', String(limit))}</p>
        : <AddForm kind={kind} onChange={onChange} t={t} />)}
    </section>
  );
}

// A proven address gets a shareable QR badge. It encodes the public scan URL, so a
// customer scanning it lands on /verify/scan and sees "✓ Verified". Generated in the
// browser (qrcode, lazy-loaded) and downloadable as a PNG to print or display.
function QrBadge({ d, t }: { d: Destination; t: VerifyDashboardLocale }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    let alive = true;
    const scanUrl = `https://almstins.com/verify/scan?address=${encodeURIComponent(d.value)}`;
    (async () => {
      try {
        const mod = (await import('qrcode')) as unknown as {
          toDataURL?: (text: string, opts?: unknown) => Promise<string>;
          default?: { toDataURL: (text: string, opts?: unknown) => Promise<string> };
        };
        const toDataURL = mod.toDataURL ?? mod.default?.toDataURL;
        if (!toDataURL) return;
        const url = await toDataURL(scanUrl, { width: 220, margin: 1 });
        if (alive) setDataUrl(url);
      } catch { /* ignore — the badge just won't render */ }
    })();
    return () => { alive = false; };
  }, [d.value]);

  return (
    <div className="vd-qr">
      {dataUrl
        ? <img className="vd-qr__img" src={dataUrl} alt="Verification QR" width={220} height={220} />
        : <div className="vd-qr__img vd-qr__img--loading" />}
      <p className="vd-qr__hint">{t.qrBadgeHint}</p>
      {dataUrl && (
        <a className="vd-qr__dl" href={dataUrl} download={`almstins-verified-${d.rail}.png`}>{t.qrBadgeDownload}</a>
      )}
    </div>
  );
}

function DestRow({ d, onChange, t, isDemo }: { d: Destination; onChange: () => void; t: VerifyDashboardLocale; isDemo?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [proving, setProving] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  // Domain attestation proves a domain vouches for an address — only meaningful for
  // address destinations, and only until one is proven.
  const canProve = d.kind === 'address' && d.proofStatus !== 'proven';
  // A proven address can show its shareable QR badge.
  const canBadge = d.kind === 'address' && d.proofStatus === 'proven';
  // Any proven destination can be watched on its published page for a swap.
  const canMonitor = d.proofStatus === 'proven';
  async function del() {
    if (!window.confirm(t.confirmRemove)) return;
    setBusy(true);
    try {
      await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      onChange();
    } finally { setBusy(false); }
  }
  return (
    <div className="vd-rowwrap">
      <div className="vd-row">
        <span className="vd-row__rail">{railLabel(d.rail, t)}</span>
        <span className="vd-row__value" title={d.value}>{short(d.value)}</span>
        {d.label && <span className="vd-row__label">{d.label}</span>}
        <span
          className={`vd-badge vd-badge--${d.proofStatus}`}
          title={d.proofStatus === 'proven' && d.proofDomain ? t.provenBy.replace('{domain}', d.proofDomain) : undefined}
        >{statusLabel(d.proofStatus, t)}</span>
        {canProve && (
          <button className="vd-row__prove" onClick={() => setProving(p => !p)} aria-expanded={proving}>
            {t.proveBtn}
          </button>
        )}
        {canBadge && (
          <button className="vd-row__prove" onClick={() => setShowBadge(s => !s)} aria-expanded={showBadge}>
            {t.qrBadgeBtn}
          </button>
        )}
        {canMonitor && (
          <button className="vd-row__prove" onClick={() => setMonitoring(m => !m)} aria-expanded={monitoring}>
            {d.monitorUrl ? t.monitorOnBtn : t.monitorBtn}
          </button>
        )}
        {!isDemo && (
          <button className="vd-row__del" onClick={del} disabled={busy} aria-label={t.removeAria}>✕</button>
        )}
      </div>
      {proving && canProve && (
        isDemo
          ? <div className="vd-prove"><p className="vd-prove__hint">{t.demoProveNote}</p></div>
          : <ProvePanel d={d} t={t} onProven={() => { setProving(false); onChange(); }} />
      )}
      {showBadge && canBadge && <QrBadge d={d} t={t} />}
      {monitoring && canMonitor && (
        isDemo
          ? <div className="vd-prove"><p className="vd-prove__hint">{t.monitorDemoNote}</p></div>
          : <MonitorPanel d={d} t={t} onSaved={onChange} />
      )}
    </div>
  );
}

// Published-source swap monitor — the merchant gives the public page where this
// destination appears; the watchman cron re-fetches it and alerts on a swap.
function MonitorPanel({ d, t, onSaved }: { d: Destination; t: VerifyDashboardLocale; onSaved: () => void }) {
  const [url, setUrl] = useState(d.monitorUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: string | null) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorUrl: next }),
      });
      const data = await res.json();
      if (data.ok) onSaved();
      else setErr(data.message ?? t.monitorError);
    } catch {
      setErr(t.monitorError);
    } finally { setBusy(false); }
  }

  // Last-check readout: 'swapped' is the only alarm state; the rest are informational.
  const status = d.monitorStatus;
  const statusText =
    status === 'swapped' ? t.monitorStatusSwapped
    : status === 'present' ? t.monitorStatusPresent
    : status === 'missing' ? t.monitorStatusMissing
    : status === 'unreachable' || status === 'invalid_url' ? t.monitorStatusUnreachable
    : null;

  return (
    <div className="vd-prove">
      <p className="vd-prove__hint">{t.monitorHint}</p>
      <div className="vd-prove__row">
        <input
          className="vd-prove__input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t.monitorPlaceholder}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="vd-prove__verify" onClick={() => save(url.trim() || null)} disabled={busy || !url.trim()}>
          {busy ? t.monitorSavingBtn : t.monitorSaveBtn}
        </button>
        {d.monitorUrl && (
          <button className="vd-prove__copy" onClick={() => { setUrl(''); void save(null); }} disabled={busy}>
            {t.monitorStopBtn}
          </button>
        )}
      </div>
      {statusText && <p className="vd-prove__hint" data-monitor={status ?? ''}>{statusText}</p>}
      {err && <span className="vd-add__err">{err}</span>}
    </div>
  );
}

// Self-send proof — the merchant sends any outgoing tx FROM the address. We issue a
// challenge on open (stamps the start), then read the chain for a new outgoing tx
// after it. Read-only: we never ask them to connect or sign, and never move funds.
function SelfSendProof({ d, t, onProven }: { d: Destination; t: VerifyDashboardLocale; onProven: () => void }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);

  // Issue the challenge on mount so issued_at predates the merchant's send.
  useEffect(() => {
    void fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}/deposit-challenge`, { method: 'POST' }).catch(() => {});
  }, [d.id]);

  async function check() {
    setBusy(true); setOutcome(null);
    try {
      const res = await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}/deposit-verify`, { method: 'POST' });
      const data = await res.json();
      const ok = data.outcome === 'proven' || data.outcome === 'already_proven';
      const map: Record<string, string> = {
        proven: t.ssProven, already_proven: t.ssProven, not_yet: t.ssNotYet, no_challenge: t.ssNotYet,
        claimed_elsewhere: t.ssClaimedElsewhere, unsupported_rail: t.ssUnsupported, unavailable: t.ssUnavailable,
      };
      setOutcome({ text: data.ok ? (map[String(data.outcome)] ?? t.proveError) : t.proveError, ok });
      if (ok) setTimeout(onProven, 1400);
    } catch {
      setOutcome({ text: t.proveError, ok: false });
    } finally { setBusy(false); }
  }

  return (
    <>
      <p className="vd-prove__hint">{t.ssHint.replace('{address}', d.value)}</p>
      <div className="vd-prove__row">
        <button className="vd-prove__verify" onClick={check} disabled={busy}>{busy ? t.ssCheckingBtn : t.ssCheckBtn}</button>
      </div>
      {outcome && (
        <div className={`vd-prove__outcome ${outcome.ok ? 'vd-prove__outcome--ok' : 'vd-prove__outcome--warn'}`}>{outcome.text}</div>
      )}
    </>
  );
}

// "Prove ownership" — two methods. Self-send (no website): the merchant signs an
// outgoing tx from the address. Domain: the owner publishes a /.well-known file we
// fetch and match. Proof is per-address (self-send) or per-domain (the file covers
// every address it lists).
function ProvePanel({ d, t, onProven }: { d: Destination; t: VerifyDashboardLocale; onProven: () => void }) {
  const [method, setMethod] = useState<'selfsend' | 'domain'>('selfsend');
  const [domain, setDomain] = useState('');
  const [file, setFile] = useState<{ path: string; file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);

  // Map a prove-endpoint outcome code → localized copy.
  const proofString = (code: string): string => ({
    proven: t.proofProven,
    challenge_mismatch: t.proofChallengeMismatch,
    address_not_listed: t.proofAddressNotListed,
    unreachable: t.proofUnreachable,
    malformed: t.proofMalformed,
    invalid_domain: t.proofInvalidDomain,
  } as Record<string, string>)[code] ?? t.proveError;

  async function getFile() {
    const dom = domain.trim();
    if (!dom) return;
    setBusy(true); setOutcome(null);
    try {
      const res = await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}/challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: dom }),
      });
      const data = await res.json();
      if (data.outcome === 'invalid_domain') { setFile(null); setOutcome({ text: t.proofInvalidDomain, ok: false }); return; }
      if (!data.ok) { setOutcome({ text: t.proveError, ok: false }); return; }
      setFile({ path: data.path, file: data.file });
    } catch {
      setOutcome({ text: t.proveError, ok: false });
    } finally { setBusy(false); }
  }

  async function prove() {
    setBusy(true); setOutcome(null);
    try {
      const res = await fetch(`/api/verify/destinations/${encodeURIComponent(d.id)}/prove`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json();
      const ok = data.outcome === 'proven';
      setOutcome({ text: data.ok ? proofString(data.outcome) : t.proveError, ok });
      if (ok) setTimeout(onProven, 1400); // let the success show, then refresh the list
    } catch {
      setOutcome({ text: t.proveError, ok: false });
    } finally { setBusy(false); }
  }

  const url = `https://${domain.trim() || 'yourdomain.com'}${file?.path ?? ''}`;

  return (
    <div className="vd-prove">
      <div className="vd-prove__methods">
        <button type="button" className={`vd-prove__method${method === 'selfsend' ? ' vd-prove__method--on' : ''}`}
          onClick={() => setMethod('selfsend')}>{t.proveMethodSelfSend}</button>
        <button type="button" className={`vd-prove__method${method === 'domain' ? ' vd-prove__method--on' : ''}`}
          onClick={() => setMethod('domain')}>{t.proveMethodDomain}</button>
      </div>
      {method === 'selfsend' ? (
        <SelfSendProof d={d} t={t} onProven={onProven} />
      ) : (
        <>
          <p className="vd-prove__hint">{t.proveHint}</p>
          <div className="vd-prove__row">
            <input className="vd-prove__input" value={domain} onChange={(e) => setDomain(e.target.value)}
              placeholder={t.proveDomainPlaceholder} spellCheck={false} autoComplete="off" />
            <button className="vd-prove__get" onClick={getFile} disabled={busy || !domain.trim()}>{t.proveGetFileBtn}</button>
          </div>
          {file && (
            <div className="vd-prove__file">
              <p className="vd-prove__steps">{t.proveStep1.replace('{url}', url)}</p>
              <pre className="vd-prove__pre">{file.file}</pre>
              <div className="vd-prove__row">
                <button className="vd-prove__copy" onClick={() => { void navigator.clipboard?.writeText(file.file); }}>{t.proveCopyBtn}</button>
                <button className="vd-prove__verify" onClick={prove} disabled={busy}>{busy ? t.proveVerifyingBtn : t.proveVerifyBtn}</button>
              </div>
            </div>
          )}
          {outcome && (
            <div className={`vd-prove__outcome ${outcome.ok ? 'vd-prove__outcome--ok' : 'vd-prove__outcome--warn'}`}>{outcome.text}</div>
          )}
        </>
      )}
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
        : data.error === 'claimed_elsewhere' ? t.addErrClaimed
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

// Independent scam screen on the scanned value, run in parallel with the match
// check. 'unclear' = a yellow/partial-coverage result that can't be cleared.
type SafetyState =
  | { s: 'idle' } | { s: 'checking' } | { s: 'clean' } | { s: 'caution' }
  | { s: 'unclear' } | { s: 'danger' } | { s: 'error' };

// Scan or paste a payment QR/address and check it against the tenant's OWN
// registered destinations — "✓ still yours" vs "⚠ swapped". The QR is decoded
// on-device (jsQR via qrScan.ts); only the decoded string is sent.
function VerifySign({ t }: { t: VerifyDashboardLocale }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const [safety, setSafety] = useState<SafetyState>({ s: 'idle' });
  const [scanning, setScanning] = useState(false);

  async function check(override?: string) {
    const q = (override ?? value).trim();
    if (!q) return;
    setState({ status: 'checking' });
    setSafety({ s: 'checking' });
    void runSafety(q); // independent scam screen, in parallel with the match check
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

  // Screen the scanned value for scam signals — reusing the public safety
  // checkers. A URL goes to dapp-check (phishing lists); an address goes to
  // wallet-check (GoPlus / OFAC / honeypot / age). This is independent of the
  // match: a "still yours" address is reassuringly clean; a swapped one is most
  // useful to screen because it's brand-new and a registry match alone can't flag it.
  async function runSafety(q: string) {
    const { kind, value: target } = classifyScan(q);
    try {
      if (kind === 'url') {
        const res = await fetch(`/api/dapp-check?url=${encodeURIComponent(target)}`);
        const d = await res.json();
        setSafety({ s: d.verdict === 'red' ? 'danger' : d.verdict === 'yellow' ? 'unclear' : 'clean' });
      } else {
        const res = await fetch('/api/wallet-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: target }),
        });
        const d = await res.json();
        if (!d.ok || !d.result) { setSafety({ s: 'error' }); return; }
        const lvl = d.result.scamLevel;
        setSafety({
          s: lvl === 'danger' ? 'danger'
            : lvl === 'caution' ? 'caution'
            : d.result.partialCoverage ? 'unclear'
            : 'clean',
        });
      }
    } catch {
      setSafety({ s: 'error' });
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
          onChange={(e) => { setValue(e.target.value); if (state.status !== 'idle' && state.status !== 'checking') { setState({ status: 'idle' }); setSafety({ s: 'idle' }); } }}
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

      {safety.s !== 'idle' && (
        <div className={
          'vd-verify__result'
          + (safety.s === 'clean' ? ' vd-verify__result--ok'
            : safety.s === 'danger' ? ' vd-verify__result--err'
            : (safety.s === 'caution' || safety.s === 'unclear' || safety.s === 'error') ? ' vd-verify__result--warn'
            : '')
        }>
          {t.safetyLabel} {
            safety.s === 'checking' ? t.safetyChecking
            : safety.s === 'clean' ? t.safetyClean
            : safety.s === 'caution' ? t.safetyCaution
            : safety.s === 'unclear' ? t.safetyUnclear
            : safety.s === 'danger' ? t.safetyDanger
            : t.safetyError
          }
        </div>
      )}
    </section>
  );
}
