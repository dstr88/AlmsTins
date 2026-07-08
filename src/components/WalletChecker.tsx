import { useState, useRef, useCallback, useEffect } from 'react';
import jsQR from 'jsqr';
import type { WalletCheckResult } from '@/lib/walletChecker';
import type { WalletCheckerLocale } from '@/i18n/walletChecker';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'safety' | 'holdings' | 'activity' | 'honeypot' | 'funding' | 'multisig';
type CheckerStrings = WalletCheckerLocale['checker'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null, locale: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  } catch { return '—'; }
}

function chainLabel(chain: string, c: CheckerStrings): string {
  return {
    evm:      c.chains.evm,
    sui:      c.chains.sui,
    solana:   c.chains.solana,
    bitcoin:  c.chains.bitcoin,
    litecoin: c.chains.litecoin,
    tron:     c.chains.tron,
    xrp:      c.chains.xrp,
    dogecoin: c.chains.dogecoin,
    cardano:  c.chains.cardano,
    cosmos:   c.chains.cosmos,
  }[chain] ?? c.chains.unknown;
}

function isNewWallet(firstSeen: string | null): boolean {
  if (!firstSeen) return false;
  const days = (Date.now() - new Date(firstSeen).getTime()) / 86_400_000;
  return days < 30;
}

// Extracts a blockchain address from a scanned QR payload.
// Handles raw addresses and URI forms like "ethereum:0x..@1?value=..", "bitcoin:bc1..?amount=..".
function parseAddressFromQR(raw: string): string {
  const s = raw.trim();
  // EVM addresses are unambiguous — grab the first one if present (covers EIP-681 URIs too)
  const evm = s.match(/0x[a-fA-F0-9]{40}/);
  if (evm) return evm[0];
  // Otherwise strip any URI scheme ("bitcoin:", "litecoin:", "solana:", …) and trailing params
  const noScheme = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, '');
  return noScheme.split(/[?@\s]/)[0].trim();
}

// Name-service handles (vitalik.eth, foo.sol …) resolve to an address — they go to the
// wallet check, NOT the website/dApp check, even though they contain a dot.
const NAME_SERVICE_TLD = /\.(eth|sol|crypto|nft|wallet|bnb|x|dao|zil|blockchain|888)$/i;

// Decide whether a scanned QR payload is a website / dApp URL (→ dapp-check) or a
// blockchain address / payment URI (→ wallet-check).
function classifyScan(raw: string): { kind: 'url' | 'address'; value: string } {
  const s = raw.trim();
  // Explicit web URL → website / dApp check
  if (/^https?:\/\//i.test(s)) return { kind: 'url', value: s };
  // An EVM address anywhere wins (covers EIP-681 "ethereum:0x..@1?value=" URIs)
  if (/0x[a-fA-F0-9]{40}/.test(s)) return { kind: 'address', value: parseAddressFromQR(s) };
  // A bare domain ("app.uniswap.org", "example.com/path") → website check, but never a
  // name-service handle like "vitalik.eth" (those resolve to an address).
  const host = s.split(/[/?#\s]/)[0];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && !NAME_SERVICE_TLD.test(host)) {
    return { kind: 'url', value: s };
  }
  // Everything else — bitcoin:/solana:/litecoin: URIs, raw addresses, ENS names → wallet check
  return { kind: 'address', value: parseAddressFromQR(s) };
}

// Which scam sources actually ran for this result's chain (P0/P1 honesty).
// goplus 'skipped' (chain unsupported) counts as unavailable — it's the gap that matters;
// honeypot 'skipped' is EVM-only N/A, so it's omitted rather than shown as a failure.
function coverageSummary(result: WalletCheckResult): { ran: string[]; unavailable: string[] } {
  const ran: string[] = [];
  const unavailable: string[] = [];
  const cov = result.coverage;
  if (!cov) return { ran, unavailable };
  if (cov.goplus === 'ran') ran.push('GoPlus'); else unavailable.push('GoPlus');
  if (cov.honeypot === 'ran') ran.push('honeypot.is'); else if (cov.honeypot === 'error') unavailable.push('honeypot.is');
  if (cov.chainabuse === 'ran') ran.push('Chainabuse'); else unavailable.push('Chainabuse');
  return { ran, unavailable };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScamMeter({ score, level, partialCoverage, c }: { score: number; level: string; partialCoverage?: boolean; c: CheckerStrings }) {
  // A "clean" verdict on a chain we couldn't fully check must NOT read as a confident green.
  const limited = level === 'clean' && Boolean(partialCoverage);
  const color =
    limited             ? 'var(--warning)' :
    level === 'clean'   ? '#22c55e' :
    level === 'caution' ? '#f59e0b' :
                          '#ef4444';
  const label =
    limited             ? c.scamLimited :
    level === 'clean'   ? c.scamClean :
    level === 'caution' ? c.scamCaution :
                          c.scamHigh;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{c.scamRiskScore}</span>
        <span style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
      </div>
      {/* Track */}
      <div style={{ height: '10px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${score}%`,
          background: color,
          borderRadius: '999px',
          transition: 'width 0.8s ease',
          boxShadow: `0 0 12px ${color}66`,
        }} />
      </div>
      <p style={{ marginTop: '0.75rem', fontSize: '1.05rem', fontWeight: 600, color }}>{label}</p>
    </div>
  );
}

function FlagRow({ label, active, c }: { label: string; active: boolean; c: CheckerStrings }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '0.9rem',
    }}>
      <span style={{ color: 'rgba(255,255,255,0.75)' }}>{label}</span>
      <span style={{ color: active ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
        {active ? c.reported : c.clear}
      </span>
    </div>
  );
}

function TabContent({ tab, result, c }: { tab: Tab; result: WalletCheckResult; c: CheckerStrings }) {
  if (tab === 'safety') {
    const f = result.flags;
    return (
      <div>
        {result.entityLabel && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', borderRadius: '10px', marginBottom: '1rem',
            background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
          }}>
            <span style={{ fontSize: '1.4rem' }}>
              {result.entityLabel.type === 'exchange' ? '🏦'
                : result.entityLabel.type === 'defi' ? '🔷'
                : result.entityLabel.type === 'bridge' ? '🌉'
                : '📄'}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                {result.entityLabel.name}
                {result.entityLabel.subLabel && (
                  <span style={{ fontWeight: 400, fontSize: '0.82rem', opacity: 0.6, marginLeft: '0.5rem' }}>
                    {result.entityLabel.subLabel}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.78rem', opacity: 0.55, textTransform: 'capitalize' }}>
                {result.entityLabel.type} · {result.entityLabel.confidence} {c.identification}
                {result.entityLabel.url && (
                  <> · <a href={result.entityLabel.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'rgba(147,196,255,0.8)', textDecoration: 'none' }}>
                    {c.visit}
                  </a></>
                )}
              </div>
            </div>
          </div>
        )}
        {[
          { label: c.flags.blacklisted,     active: f.blacklisted },
          { label: c.flags.phishing,        active: f.phishing },
          { label: c.flags.sanctioned,      active: f.sanctioned },
          { label: c.flags.stealing,        active: f.stealingAttack },
          { label: c.flags.honeypotRelated, active: f.honeypotRelated },
          { label: c.flags.cybercrime,      active: f.cybercrime },
          { label: c.flags.darkweb,         active: f.darkwebTransactions },
          { label: c.flags.moneyLaundering, active: f.moneyLaundering },
          { label: c.flags.financialCrime,  active: f.financialCrime },
          { label: c.flags.blackmail,       active: f.blackmail },
          { label: c.flags.mixer,           active: f.mixer },
        ].sort((a, b) => Number(b.active) - Number(a.active))
          .map(({ label, active }) => (
            <FlagRow key={label} label={label} active={active} c={c} />
          ))}

        {/* Chainabuse community reports */}
        {result.chainabuseReports !== null && (
          <div style={{
            marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '10px',
            background: result.chainabuseReports > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${result.chainabuseReports > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}>
            <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: result.chainabuseReports > 0 ? '#fca5a5' : 'rgba(255,255,255,0.55)' }}>
              {result.chainabuseReports > 0
                ? (result.chainabuseReports === 1 ? c.chainabuseOne : c.chainabuseMany).replace('{n}', String(result.chainabuseReports))
                : c.chainabuseNone}
            </p>
          </div>
        )}

        <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
          {(() => {
            const { ran, unavailable } = coverageSummary(result);
            if (ran.length === 0 && unavailable.length === 0) return c.safetySource;
            return `${c.checksRan}: ${ran.join(', ') || '—'}${unavailable.length ? ` · ${c.checksUnavailable}: ${unavailable.join(', ')}` : ''}`;
          })()}
        </p>
      </div>
    );
  }

  if (tab === 'holdings') {
    const h = result.holdings;
    if (result.chain !== 'evm' && result.chain !== 'sui' && result.chain !== 'tron') return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
        {c.holdingsEvmSuiOnly}
      </p>
    );
    const noHoldingsMsg = result.chain === 'sui' ? c.noCoinBalances : result.chain === 'tron' ? c.noTrc20 : c.noErc20;
    if (h.length === 0) return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
        {noHoldingsMsg}
      </p>
    );
    const nativeBalanceLabel = result.chain === 'tron' ? c.trxBalanceRow : c.ethBalanceRow;
    const nativeSymbol = result.chain === 'tron' ? 'TRX' : 'ETH';
    const sourceNote = result.chain === 'sui' ? c.holdingsSourceSui : result.chain === 'tron' ? c.holdingsSourceTron : c.holdingsSourceEvm;
    return (
      <div>
        {result.activity?.ethBalance && result.chain !== 'sui' && (
          <div style={{ padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem' }}>{nativeBalanceLabel}</span>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{result.activity.ethBalance} {nativeSymbol}</span>
          </div>
        )}
        {h.map((token, i) => (
          <div key={i} style={{ padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{token.symbol}</span>
              <span style={{ marginLeft: '0.5rem', color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem' }}>{token.name}</span>
            </div>
            <span style={{ fontSize: '0.9rem' }}>{token.balance}</span>
          </div>
        ))}
        <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
          {sourceNote}
        </p>
      </div>
    );
  }

  if (tab === 'activity') {
    const a = result.activity;
    const newWallet = isNewWallet(a.firstSeen);
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          {[
            { label: c.firstSeen,    value: fmt(a.firstSeen, c.dateLocale)    },
            { label: c.lastActivity, value: fmt(a.lastActivity, c.dateLocale) },
            { label: result.chain === 'sui' ? c.suiBalance : c.ethBalance, value: a.ethBalance ?? '—' },
            { label: c.txCount,      value: a.txCount !== null ? String(a.txCount) : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600, fontSize: '0.95rem' }}>{value}</p>
            </div>
          ))}
        </div>
        {newWallet && (
          <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#fca5a5' }}>
            🚩 <strong>{c.newWallet}</strong>{c.newWalletRest}
          </div>
        )}
        <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
          {c.activitySource}
        </p>
      </div>
    );
  }

  if (tab === 'honeypot') {
    const h = result.honeypot;
    if (result.chain !== 'evm') return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
        {c.honeypotEvmOnly}
      </p>
    );
    if (!h.checked) return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>{c.honeypotUnavailable}</p>
    );
    return (
      <div>
        <div style={{
          padding: '1.25rem',
          borderRadius: '12px',
          background: h.isHoneypot ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${h.isHoneypot ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
          marginBottom: '1rem',
        }}>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: h.isHoneypot ? '#ef4444' : '#22c55e' }}>
            {h.isHoneypot ? c.honeypotDetected : c.honeypotSellable}
          </p>
          {h.reason && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>{h.reason}</p>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          {c.honeypotExplain}
        </p>
        <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>{c.honeypotSource}</p>
      </div>
    );
  }

  if (tab === 'funding') {
    const fs = result.fundingSource;
    return (
      <div>
        <div style={{ marginBottom: '1rem' }}>
          {fs.label ? (
            <div style={{ padding: '1rem', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <p style={{ margin: 0, fontWeight: 600, color: '#fca5a5', fontSize: '0.95rem' }}>🚨 {fs.label}</p>
            </div>
          ) : (
            <div style={{ padding: '1rem', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.55)', fontSize: '0.9rem' }}>{c.fundingNone}</p>
            </div>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          {c.fundingExplain}
        </p>
        {result.chain !== 'evm' && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
            {c.fundingEvmOnly}
          </p>
        )}
      </div>
    );
  }

  if (tab === 'multisig') {
    const ms = result.multiSig;
    return (
      <div>
        <div style={{
          padding: '1.25rem', borderRadius: '12px', marginBottom: '1rem',
          background: ms === true ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${ms === true ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.1)'}`,
        }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: ms === true ? '#f59e0b' : 'rgba(255,255,255,0.8)' }}>
            {ms === null ? c.multisigUnknown : ms ? c.multisigYes : c.multisigNo}
          </p>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
          <strong style={{ color: 'rgba(255,255,255,0.75)' }}>{c.multisigWhatLabel}</strong>{c.multisigWhat}
        </p>
        <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#fbbf24', lineHeight: 1.6 }}>
          {c.multisigWarning}
        </p>
        {result.chain !== 'evm' && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
            {c.multisigEvmOnly}
          </p>
        )}
      </div>
    );
  }

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  prefilledAddress?: string;
  c: CheckerStrings;
}

export default function WalletChecker({ prefilledAddress = '', c }: Props) {
  const [address, setAddress]     = useState(prefilledAddress);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<WalletCheckResult | null>(null);
  const [verifiedPublisher, setVerifiedPublisher] = useState<{ domain: string | null; label: string | null } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('safety');
  const [cached, setCached]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const didAutoCheck = useRef(false);

  // QR camera scanning state
  const [scanning, setScanning]   = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef       = useRef<HTMLVideoElement | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const rafRef         = useRef<number | null>(null);
  const handleCheckRef = useRef<(addr: string) => void>(() => {});

  const TABS: { id: Tab; label: string }[] = [
    { id: 'safety',   label: c.tabs.safety   },
    { id: 'holdings', label: c.tabs.holdings },
    { id: 'activity', label: c.tabs.activity },
    { id: 'honeypot', label: c.tabs.honeypot },
    { id: 'funding',  label: c.tabs.funding  },
    { id: 'multisig', label: c.tabs.multisig },
  ];

  const handleCheck = useCallback(async (overrideAddr?: string) => {
    const addr = (overrideAddr ?? address).trim();
    if (!addr) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setResult(null);
    setVerifiedPublisher(null);

    try {
      // Independent, non-fatal: is this a domain-verified published address? Runs
      // concurrently with the safety scan, sets its own state, and never throws into
      // the main flow — the safety verdict stands on its own if this lookup fails.
      void fetch(`/api/verify/lookup?address=${encodeURIComponent(addr)}`, {
        signal: abortRef.current.signal,
      })
        .then(r => r.json())
        .then((d: any) => {
          // Show a verified claim whether it's a domain-verified entity (domain) or a
          // merchant who proved control and named it (label) — or both.
          if (d?.ok && d.verified && (typeof d.domain === 'string' || typeof d.label === 'string')) {
            setVerifiedPublisher({
              domain: typeof d.domain === 'string' ? d.domain : null,
              label: typeof d.label === 'string' ? d.label : null,
            });
          }
        })
        .catch(() => { /* non-fatal — includes AbortError when a check is superseded */ });

      const res = await fetch('/api/wallet-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
        signal: abortRef.current.signal,
      });
      const data = await res.json() as { ok: boolean; result?: WalletCheckResult; error?: string; cached?: boolean };

      if (!data.ok || !data.result) {
        setError(data.error ?? c.checkFailed);
      } else {
        setResult(data.result);
        setCached(Boolean(data.cached));
        setActiveTab('safety');
        if (typeof (window as any).gtag === 'function') {
          (window as any).gtag('event', 'wallet_check_submitted', {
            event_category: 'interactive_tool',
            event_label: 'wallet_checker',
          });
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(c.networkError);
      }
    } finally {
      setLoading(false);
    }
  }, [address, c]);

  // Auto-check on first mount when a prefilled address is provided
  useEffect(() => {
    if (prefilledAddress && !didAutoCheck.current) {
      didAutoCheck.current = true;
      handleCheck(prefilledAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a live ref to handleCheck so the scanner loop always calls the latest version
  useEffect(() => { handleCheckRef.current = handleCheck; }, [handleCheck]);

  // Notify the page when a result arrives so the community ratings panel can update
  useEffect(() => {
    if (result) {
      window.dispatchEvent(new CustomEvent('almstins:wallet-checked', { detail: { address: address.trim() } }));
    }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // Allow an external trigger (e.g. the prominent button at the top of the page) to open the scanner
  useEffect(() => {
    const open = () => { setScanError(null); setScanning(true); };
    window.addEventListener('almstins:open-qr', open);
    return () => window.removeEventListener('almstins:open-qr', open);
  }, []);

  // Camera QR scanning — runs while `scanning` is true; tears down the stream on close/unmount
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (code?.data) {
            const { kind, value } = classifyScan(code.data);
            // A scanned website / dApp URL is checked by the dApp checker (lives in the
            // page script) — hand it off via an event and close the camera.
            if (kind === 'url') {
              cancelled = true;
              setScanning(false);
              window.dispatchEvent(new CustomEvent('almstins:scanned-url', { detail: { url: value } }));
              return;
            }
            if (value) {
              cancelled = true;
              setAddress(value);
              setScanning(false);
              handleCheckRef.current(value);
              return;
            }
          }
        } catch { /* getImageData can throw mid-teardown; ignore and keep looping */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setScanning(false); };
    window.addEventListener('keydown', onKey);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError(c.scanUnsupported);
        setScanning(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (err: any) {
        const name = err?.name;
        setScanError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? c.scanDenied
            : name === 'NotFoundError'
            ? c.scanNoCamera
            : c.scanGeneric,
        );
        setScanning(false);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [scanning, c]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCheck(); }
  };

  const flagKeyToLabel: Record<string, string> = {
    blacklisted: c.flags.blacklisted,
    phishing: c.flags.phishing,
    sanctioned: c.flags.sanctioned,
    stealingAttack: c.flags.stealing,
    honeypotRelated: c.flags.honeypotRelated,
    cybercrime: c.flags.cybercrime,
    darkwebTransactions: c.flags.darkweb,
    moneyLaundering: c.flags.moneyLaundering,
    financialCrime: c.flags.financialCrime,
    blackmail: c.flags.blackmail,
    mixer: c.flags.mixer,
  };
  const activeFlags = result
    ? Object.entries(result.flags).filter(([, v]) => v).map(([k]) => k)
    : [];

  return (
    <div style={{ width: '100%', maxWidth: '680px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Input area */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <label htmlFor="wallet-input" style={{ display: 'block', fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
          {c.inputLabel}
        </label>
        <textarea
          id="wallet-input"
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={handleKey}
          maxLength={128}
          rows={2}
          placeholder={c.placeholder}
          spellCheck={false}
          autoComplete="off"
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '10px',
            color: '#f5f8ff',
            fontSize: '0.9rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            padding: '0.75rem 1rem',
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)' }}>
            {address.length}/128
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => { setScanError(null); setScanning(true); }}
              disabled={loading}
              aria-label={c.scanAria}
              style={{
                background: 'transparent',
                border: '1px solid rgba(165,180,252,0.45)',
                borderRadius: '999px',
                color: loading ? 'rgba(255,255,255,0.35)' : '#a5b4fc',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                fontWeight: 600,
                padding: '0.65rem 1.1rem',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                whiteSpace: 'nowrap',
              }}
            >
              {c.scanQr}
            </button>
            <button
              onClick={() => handleCheck()}
              disabled={loading || !address.trim()}
              style={{
                background: loading || !address.trim()
                  ? 'rgba(255,255,255,0.08)'
                  : 'linear-gradient(135deg, #5767ff, #934dff)',
                border: 'none',
                borderRadius: '999px',
                color: loading || !address.trim() ? 'rgba(255,255,255,0.35)' : '#fff',
                cursor: loading || !address.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                fontWeight: 600,
                padding: '0.65rem 1.5rem',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {loading ? (
                <>
                  <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  {c.checking}
                </>
              ) : c.checkWallet}
            </button>
          </div>
        </div>

        {error && (
          <p style={{ marginTop: '0.75rem', color: '#fca5a5', fontSize: '0.875rem', margin: '0.75rem 0 0' }}>
            {error}
          </p>
        )}

        {scanError && (
          <p style={{ marginTop: '0.75rem', color: '#fca5a5', fontSize: '0.875rem', margin: '0.75rem 0 0' }}>
            {scanError}
          </p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem' }}>

          {/* Verified claim — a domain-verified entity, or a merchant who proved + named it */}
          {verifiedPublisher && (
            <div style={{
              marginBottom: '1.25rem', padding: '0.85rem 1rem', borderRadius: '12px',
              background: 'var(--gain-bg)', border: '1px solid var(--gain-border)',
              display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
            }}>
              <span aria-hidden="true" style={{ fontSize: '1.1rem', lineHeight: 1.3 }}>✓</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--gain)', fontSize: '0.95rem' }}>
                  {c.verifiedTitle}
                </div>
                <p style={{ margin: '0.3rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {verifiedPublisher.label
                    ? c.verifiedMerchant.replace('{name}', verifiedPublisher.label)
                      + (verifiedPublisher.domain ? c.verifiedVia.replace('{domain}', verifiedPublisher.domain) : '')
                    : c.verifiedBody.replace('{domain}', verifiedPublisher.domain ?? '')}
                </p>
                <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  {c.verifiedSub}
                </p>
              </div>
            </div>
          )}

          {/* Chain + ENS + cache badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', padding: '0.3rem 0.75rem', borderRadius: '999px' }}>
              {chainLabel(result.chain, c)}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {result.chainabuseReports !== null && result.chainabuseReports > 0 && (
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', padding: '0.3rem 0.75rem', borderRadius: '999px' }}>
                  {(result.chainabuseReports === 1 ? c.reportBadgeOne : c.reportBadgeMany).replace('{n}', String(result.chainabuseReports))}
                </span>
              )}
              {cached && (
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>{c.cached}</span>
              )}
            </div>
          </div>

          {/* Chain network note */}
          {c.chainNote[result.chain as keyof typeof c.chainNote] && (
            <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.38)', lineHeight: 1.5 }}>
              {c.chainNote[result.chain as keyof typeof c.chainNote]}
            </p>
          )}

          {/* ENS name */}
          {result.ensName && (
            <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.ens}</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#a78bfa', fontFamily: 'ui-monospace, monospace' }}>
                {result.ensName}
              </span>
              <a
                href={`https://app.ens.domains/${result.ensName}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: 'rgba(167,139,250,0.6)', textDecoration: 'none' }}
              >
                ↗
              </a>
            </div>
          )}

          {/* Scam meter */}
          <ScamMeter score={result.scamScore} level={result.scamLevel} partialCoverage={result.partialCoverage} c={c} />

          {/* Coverage honesty: a "clean" on a chain we couldn't fully check is NOT a green bill of health */}
          {(result.partialCoverage || (result.errors?.length ?? 0) > 0) && (() => {
            const { ran, unavailable } = coverageSummary(result);
            return (
              <div style={{
                marginBottom: '1.25rem', padding: '0.75rem 1rem', borderRadius: '10px', fontSize: '0.85rem',
                background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                color: 'var(--warning)',
              }}>
                <strong>
                  {result.partialCoverage
                    ? c.limitedCoverageTitle.replace('{chain}', chainLabel(result.chain, c))
                    : c.checksUnavailableTitle}
                </strong>
                {result.partialCoverage && (
                  <p style={{ margin: '0.4rem 0 0', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
                    {c.limitedCoverageBody.replace('{chain}', chainLabel(result.chain, c))}
                  </p>
                )}
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)' }}>
                  {ran.length > 0 && <>{c.checksRan}: {ran.join(', ')}. </>}
                  {unavailable.length > 0 && <>{c.checksUnavailable}: {unavailable.join(', ')}.</>}
                </p>
              </div>
            );
          })()}

          {/* Active flags summary */}
          {activeFlags.length > 0 && (
            <div style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', fontSize: '0.85rem', color: '#fca5a5' }}>
              <strong>{c.flaggedFor}</strong>{' '}
              {activeFlags.map(f => (flagKeyToLabel[f] ?? f).toLowerCase()).join(', ')}
            </div>
          )}

          {/* Disclaimer */}
          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            {c.resultsDisclaimer}
          </p>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  background: activeTab === t.id ? 'rgba(87,103,255,0.25)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${activeTab === t.id ? 'rgba(87,103,255,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '999px',
                  color: activeTab === t.id ? '#a5b4fc' : 'rgba(255,255,255,0.55)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.8rem',
                  fontWeight: activeTab === t.id ? 600 : 400,
                  padding: '0.35rem 0.85rem',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ minHeight: '120px' }}>
            <TabContent tab={activeTab} result={result} c={c} />
          </div>
        </div>
      )}

      {/* QR scanner camera overlay */}
      {scanning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={c.scanTitle}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(5,7,15,0.92)', backdropFilter: 'blur(6px)', padding: '1.5rem',
          }}
        >
          <p style={{ color: '#f5f8ff', fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem', textAlign: 'center' }}>
            {c.scanTitle}
          </p>
          <div style={{ position: 'relative', width: 'min(78vw, 320px)', aspectRatio: '1 / 1', borderRadius: '18px', overflow: 'hidden', background: '#000', boxShadow: '0 0 0 1px rgba(165,180,252,0.25)' }}>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div style={{ position: 'absolute', inset: '12%', border: '2px solid rgba(165,180,252,0.9)', borderRadius: '12px' }} />
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', margin: '1rem 0 1.25rem', textAlign: 'center', maxWidth: '320px', lineHeight: 1.5 }}>
            {c.scanPrivacy}
          </p>
          <button
            onClick={() => setScanning(false)}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '999px', color: '#f5f8ff', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 600, padding: '0.6rem 1.6rem',
            }}
          >
            {c.cancel}
          </button>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
