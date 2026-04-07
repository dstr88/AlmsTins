import { useState, useRef, useCallback, useEffect } from 'react';
import type { WalletCheckResult } from '@/lib/walletChecker';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'safety' | 'holdings' | 'activity' | 'honeypot' | 'funding' | 'multisig';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  } catch { return '—'; }
}

function chainLabel(chain: string): string {
  return {
    evm:      'Ethereum / EVM',
    sui:      'Sui',
    solana:   'Solana',
    bitcoin:  'Bitcoin',
    litecoin: 'Litecoin',
  }[chain] ?? 'Unknown chain';
}

function isNewWallet(firstSeen: string | null): boolean {
  if (!firstSeen) return false;
  const days = (Date.now() - new Date(firstSeen).getTime()) / 86_400_000;
  return days < 30;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScamMeter({ score, level }: { score: number; level: string }) {
  const color =
    level === 'clean'   ? '#22c55e' :
    level === 'caution' ? '#f59e0b' :
                          '#ef4444';
  const label =
    level === 'clean'   ? '✅ No known risks detected' :
    level === 'caution' ? '⚠️ Exercise caution' :
                          '🚨 High risk — likely a scam';

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Scam Risk Score</span>
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

function FlagRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '0.9rem',
    }}>
      <span style={{ color: 'rgba(255,255,255,0.75)' }}>{label}</span>
      <span style={{ color: active ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
        {active ? '🚨 Reported' : '✅ Clear'}
      </span>
    </div>
  );
}

function TabContent({ tab, result }: { tab: Tab; result: WalletCheckResult }) {
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
                {result.entityLabel.type} · {result.entityLabel.confidence} identification
                {result.entityLabel.url && (
                  <> · <a href={result.entityLabel.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'rgba(147,196,255,0.8)', textDecoration: 'none' }}>
                    Visit ↗
                  </a></>
                )}
              </div>
            </div>
          </div>
        )}
        <FlagRow label="Blacklisted address"          active={f.blacklisted} />
        <FlagRow label="Phishing activity"            active={f.phishing} />
        <FlagRow label="Sanctioned (OFAC/etc)"        active={f.sanctioned} />
        <FlagRow label="Stealing / drainer"           active={f.stealingAttack} />
        <FlagRow label="Honeypot-related"             active={f.honeypotRelated} />
        <FlagRow label="Cybercrime involvement"       active={f.cybercrime} />
        <FlagRow label="Dark web transactions"        active={f.darkwebTransactions} />
        <FlagRow label="Money laundering"             active={f.moneyLaundering} />
        <FlagRow label="Financial crime"              active={f.financialCrime} />
        <FlagRow label="Blackmail / extortion"        active={f.blackmail} />
        <FlagRow label="Mixer / Tornado Cash use"     active={f.mixer} />

        {/* Chainabuse community reports */}
        {result.chainabuseReports !== null && (
          <div style={{
            marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '10px',
            background: result.chainabuseReports > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${result.chainabuseReports > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}>
            <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: result.chainabuseReports > 0 ? '#fca5a5' : 'rgba(255,255,255,0.55)' }}>
              {result.chainabuseReports > 0
                ? `🚨 ${result.chainabuseReports} community scam report${result.chainabuseReports !== 1 ? 's' : ''} on Chainabuse`
                : '✅ No Chainabuse community reports'}
            </p>
          </div>
        )}

        <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
          Source: GoPlus Security (ETH, BSC, Polygon) + Chainabuse community reports. Results are reported, not legally confirmed.
        </p>
      </div>
    );
  }

  if (tab === 'holdings') {
    const h = result.holdings;
    if (result.chain !== 'evm' && result.chain !== 'sui') return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
        Token balance lookup is only available for EVM and Sui addresses.
      </p>
    );
    if (h.length === 0) return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
        {result.chain === 'sui' ? 'No coin balances found.' : 'No ERC-20 token holdings found.'}
      </p>
    );
    return (
      <div>
        {result.activity?.ethBalance && result.chain !== 'sui' && (
          <div style={{ padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem' }}>ETH Balance</span>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{result.activity.ethBalance} ETH</span>
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
          {result.chain === 'sui'
            ? 'Data via Sui RPC · All coin balances shown · SUI price via CoinGecko'
            : 'Data via Alchemy · Ethereum Mainnet only · Top 10 tokens shown'}
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
            { label: 'First seen',     value: fmt(a.firstSeen)    },
            { label: 'Last activity',  value: fmt(a.lastActivity) },
            { label: result.chain === 'sui' ? 'SUI balance' : 'ETH balance', value: a.ethBalance ?? '—' },
            { label: 'Tx count',       value: a.txCount !== null ? String(a.txCount) : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600, fontSize: '0.95rem' }}>{value}</p>
            </div>
          ))}
        </div>
        {newWallet && (
          <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#fca5a5' }}>
            🚩 <strong>New wallet</strong> — created less than 30 days ago. Scam wallets are often brand new.
          </div>
        )}
        <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
          Activity data via Etherscan · Ethereum Mainnet only
        </p>
      </div>
    );
  }

  if (tab === 'honeypot') {
    const h = result.honeypot;
    if (result.chain !== 'evm') return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>
        Honeypot detection is only available for EVM addresses.
      </p>
    );
    if (!h.checked) return (
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem' }}>Honeypot check unavailable.</p>
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
            {h.isHoneypot
              ? '🚨 Honeypot detected — tokens CANNOT be sold'
              : '✅ Tokens appear sellable'}
          </p>
          {h.reason && (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>{h.reason}</p>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          A honeypot is a token that can be bought but never sold. Scammers use them to steal funds — you send ETH in, your tokens are locked, they keep the ETH.
        </p>
        <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>Source: honeypot.is</p>
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
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.55)', fontSize: '0.9rem' }}>No mixer or high-risk funding source detected via GoPlus flags.</p>
            </div>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          Scammers often fund their wallets through mixers like Tornado Cash to hide where the ETH came from. Mixer use is a significant red flag even without other scam indicators.
        </p>
        {result.chain !== 'evm' && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
            Detailed funding source tracing only available for EVM addresses.
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
            {ms === null
              ? '— Multi-sig status unknown (EOA or check unavailable)'
              : ms
              ? '⚠️ This is a multi-sig contract wallet'
              : '✅ Standard EOA wallet — not a multi-sig'}
          </p>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
          <strong style={{ color: 'rgba(255,255,255,0.75)' }}>What is multi-sig?</strong> A multi-sig wallet requires multiple private keys to approve transactions. While legitimate protocols use them, scammers sometimes use multi-sig setups to create the illusion that funds are secure — while they control all the keys.
        </p>
        <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#fbbf24', lineHeight: 1.6 }}>
          ⚠️ Legitimate investments never ask you to deposit into their wallet. If someone is asking you to send tokens to any address — multi-sig or not — it is very likely a scam.
        </p>
        {result.chain !== 'evm' && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>
            Multi-sig detection only available for EVM addresses.
          </p>
        )}
      </div>
    );
  }

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'safety',   label: '🛡 Safety Report' },
  { id: 'holdings', label: '💰 Holdings'       },
  { id: 'activity', label: '📊 Activity'       },
  { id: 'honeypot', label: '🍯 Honeypot'       },
  { id: 'funding',  label: '🔗 Funding'        },
  { id: 'multisig', label: '🔑 Multi-sig'      },
];

interface Props {
  prefilledAddress?: string;
}

export default function WalletChecker({ prefilledAddress = '' }: Props) {
  const [address, setAddress]     = useState(prefilledAddress);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [result, setResult]       = useState<WalletCheckResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('safety');
  const [cached, setCached]       = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const didAutoCheck = useRef(false);

  const handleCheck = useCallback(async (overrideAddr?: string) => {
    const addr = (overrideAddr ?? address).trim();
    if (!addr) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/wallet-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
        signal: abortRef.current.signal,
      });
      const data = await res.json() as { ok: boolean; result?: WalletCheckResult; error?: string; cached?: boolean };

      if (!data.ok || !data.result) {
        setError(data.error ?? 'Check failed. Please try again.');
      } else {
        setResult(data.result);
        setCached(Boolean(data.cached));
        setActiveTab('safety');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError('Network error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Auto-check on first mount when a prefilled address is provided
  useEffect(() => {
    if (prefilledAddress && !didAutoCheck.current) {
      didAutoCheck.current = true;
      handleCheck(prefilledAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCheck(); }
  };

  const activeFlags = result
    ? Object.entries(result.flags).filter(([, v]) => v).map(([k]) => k)
    : [];

  return (
    <div style={{ width: '100%', maxWidth: '680px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Input area */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <label htmlFor="wallet-input" style={{ display: 'block', fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
          Wallet Address
        </label>
        <textarea
          id="wallet-input"
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={handleKey}
          maxLength={128}
          rows={2}
          placeholder="Paste any wallet address — Ethereum, Bitcoin, Solana, Litecoin, Sui..."
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)' }}>
            {address.length}/128
          </span>
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
                Checking…
              </>
            ) : '🔍 Check Wallet'}
          </button>
        </div>

        {error && (
          <p style={{ marginTop: '0.75rem', color: '#fca5a5', fontSize: '0.875rem', margin: '0.75rem 0 0' }}>
            {error}
          </p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem' }}>

          {/* Chain + ENS + cache badges */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: result.ensName ? '0.5rem' : '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', padding: '0.3rem 0.75rem', borderRadius: '999px' }}>
              {chainLabel(result.chain)}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {result.chainabuseReports !== null && result.chainabuseReports > 0 && (
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', padding: '0.3rem 0.75rem', borderRadius: '999px' }}>
                  🚨 {result.chainabuseReports} community report{result.chainabuseReports !== 1 ? 's' : ''}
                </span>
              )}
              {cached && (
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>⚡ Cached</span>
              )}
            </div>
          </div>

          {/* ENS name */}
          {result.ensName && (
            <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ENS</span>
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
          <ScamMeter score={result.scamScore} level={result.scamLevel} />

          {/* Active flags summary */}
          {activeFlags.length > 0 && (
            <div style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', fontSize: '0.85rem', color: '#fca5a5' }}>
              <strong>Flagged for:</strong>{' '}
              {activeFlags.map(f => f.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')}
            </div>
          )}

          {/* Disclaimer */}
          <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            Results sourced from public scam databases (GoPlus, Etherscan, honeypot.is). Reported, not legally confirmed. Not financial or legal advice.
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
            <TabContent tab={activeTab} result={result} />
          </div>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
