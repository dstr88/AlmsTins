import React, { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DrawerItem {
  asset: string;
  amount: number;
  sellDate: string;
  proceedsUsd: number | null;
  sourceId: string;
  groupId: string;
  txHash: string | null;
}

interface TransactionDrawerProps {
  item: DrawerItem | null;
  onClose: () => void;
}

interface HistoryEvent {
  id: string;
  timestamp_utc: string;
  direction: string | null;
  amount: number | null;
  native_usd: number | null;
  tx_hash: string | null;
  transaction_class: string;
  source_type: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function fDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fQty(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy to clipboard"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '0 0.15rem', color: copied ? '#4ade80' : 'rgba(255,255,255,0.35)',
        fontSize: '0.85rem', lineHeight: 1, transition: 'color 0.15s',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

// 0x + 64 hex = could be EVM tx hash OR Sui address — treat as EVM tx hash
// 0x + 40 hex = EVM wallet address → link to Etherscan address page
// anything else = unknown identifier, show as plain monospace text
function hashType(hash: string): 'evm-tx' | 'evm-address' | 'other' {
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) return 'evm-tx';
  if (/^0x[0-9a-fA-F]{40}$/.test(hash)) return 'evm-address';
  return 'other';
}

function explorerUrl(hash: string): string {
  const t = hashType(hash);
  if (t === 'evm-tx')      return `https://etherscan.io/tx/${hash}`;
  if (t === 'evm-address') return `https://etherscan.io/address/${hash}`;
  return '';
}

function explorerLabel(hash: string): string {
  const t = hashType(hash);
  if (t === 'evm-tx')      return 'tx';
  if (t === 'evm-address') return 'address';
  return '';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STABLECOINS = new Set([
  'USDC', 'USDT', 'DAI', 'BUSD', 'FRAX', 'TUSD', 'USDP', 'GUSD', 'LUSD',
  'USDC.E', 'USDC_E', 'BRIDGED_USDC',
]);

function isStablecoin(asset: string): boolean {
  return STABLECOINS.has(asset.toUpperCase().replace(/[^A-Z0-9]/g, '_'));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransactionDrawer({ item, onClose }: TransactionDrawerProps) {
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [pricePerToken, setPricePerToken] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  const isOpen = item !== null;

  // Fetch history when item changes
  useEffect(() => {
    if (!item) {
      setHistory([]);
      setHistoryError(null);
      return;
    }

    if (!item.groupId) {
      setHistory([]);
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);

    const controller = new AbortController();
    fetch(`/api/bookkeeping/transaction-history?groupId=${encodeURIComponent(item.groupId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HistoryEvent[]>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setHistory(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });

    return () => controller.abort();
  }, [item?.groupId]);

  // Reset form when item changes
  useEffect(() => {
    if (item) {
      setPricePerToken('');
      setBuyDate('');
      setNotes('');
      setSaveStatus('idle');
      setSaveError(null);
    }
  }, [item?.sourceId]);

  // Focus trap + Escape key
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Focus the close button on open
    setTimeout(() => firstFocusRef.current?.focus(), 50);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleQuickFill = useCallback(
    (price: string, noteText: string) => {
      setPricePerToken(price);
      setNotes(noteText);
      setSaveStatus('idle');
      setSaveError(null);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!item) return;
    const price = parseFloat(pricePerToken);
    if (!Number.isFinite(price) || price < 0) {
      setSaveError('Enter a valid price per token (≥ 0).');
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);

    try {
      const res = await fetch('/api/bookkeeping/cost-basis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellSourceId: item.sourceId,
          quantity: item.amount,
          pricePerToken: price,
          buyDateIso: buyDate || undefined,
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      setSaveStatus('success');
    } catch (err: unknown) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [item, pricePerToken, buyDate, notes]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 9998,
          backdropFilter: 'blur(2px)',
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Transaction detail for ${item.asset}`}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(480px, 100vw)',
          background: '#0b0f1a',
          borderLeft: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          transform: 'translateX(0)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '1.25rem 1.25rem 1rem',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            position: 'sticky',
            top: 0,
            background: '#0b0f1a',
            zIndex: 1,
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                marginBottom: '0.25rem',
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  letterSpacing: '0.04em',
                  color: '#fff',
                }}
              >
                {item.asset}
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  background: 'rgba(239,68,68,0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239,68,68,0.3)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Needs Attention
              </span>
            </div>
            <div
              style={{
                fontSize: '0.83rem',
                opacity: 0.55,
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <span>Sold {fDate(item.sellDate)}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{fQty(item.amount)} tokens</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span
                style={{ color: '#fbbf24' }}
                title="ERC-20 transfers show $0 in the 'Value' field on block explorers — this is the token amount, not the native coin value."
              >
                {fUsd(item.proceedsUsd)} proceeds ⓘ
              </span>
            </div>
          </div>

          <button
            ref={firstFocusRef}
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: '0.4rem 0.55rem',
              flexShrink: 0,
              marginLeft: '1rem',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.13)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)')
            }
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

          {/* ── Transaction history ──────────────────────────────────────── */}
          <section>
            <SectionHeading>Transaction History</SectionHeading>

            {historyLoading && (
              <p style={{ fontSize: '0.85rem', opacity: 0.45, fontStyle: 'italic' }}>
                Loading…
              </p>
            )}

            {historyError && (
              <p style={{ fontSize: '0.85rem', color: '#f87171' }}>{historyError}</p>
            )}

            {!historyLoading && !historyError && history.length === 0 && (
              <p style={{ fontSize: '0.85rem', opacity: 0.4, fontStyle: 'italic' }}>
                No events found for this asset group.
              </p>
            )}

            {!historyLoading && history.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {history.map((evt, idx) => (
                  <HistoryRow key={evt.id || idx} evt={evt} />
                ))}
              </div>
            )}
          </section>

          {/* ── Cost basis form ──────────────────────────────────────────── */}
          <section>
            <SectionHeading>Set Cost Basis</SectionHeading>
            <p
              style={{
                fontSize: '0.8rem',
                opacity: 0.45,
                marginTop: '-0.5rem',
                marginBottom: '0.85rem',
                fontStyle: 'italic',
              }}
            >
              Enter the average price you paid per token so this sale can be matched.
            </p>

            {/* ── Quick-fill buttons ──────────────────────────────────── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              {isStablecoin(item.asset) && (
                <QuickButton
                  label={`Stablecoin · $1.00`}
                  emoji="💵"
                  color="rgba(74,222,128"
                  onClick={() => handleQuickFill('1', 'Stablecoin — cost basis $1.00/token')}
                  active={pricePerToken === '1'}
                />
              )}
              <QuickButton
                label="Worthless Airdrop · $0"
                emoji="🗑"
                color="rgba(148,163,184"
                onClick={() => handleQuickFill('0', 'Scam / worthless airdrop — zero taxable value')}
                active={pricePerToken === '0' && notes.includes('airdrop')}
              />
            </div>

            {/* ERC-20 note — only shown when proceeds > 0 and block-explorer value looks confusing */}
            {item.proceedsUsd != null && item.proceedsUsd > 0 && (
              <div
                style={{
                  fontSize: '0.77rem',
                  color: 'rgba(251,191,36,0.8)',
                  background: 'rgba(251,191,36,0.07)',
                  border: '1px solid rgba(251,191,36,0.2)',
                  borderRadius: '7px',
                  padding: '0.55rem 0.75rem',
                  marginBottom: '0.85rem',
                  lineHeight: 1.5,
                }}
              >
                <strong>Why does Polyscan show $0?</strong> ERC-20 transfers (USDC, USDT, etc.) always
                show <em>Value: 0 MATIC</em> in the main tx view — the token amount is in the
                "ERC-20 Token Txns" tab. The {fUsd(item.proceedsUsd)} above is correct.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <FormField label="Price per Token (USD)">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 1850.00"
                  value={pricePerToken}
                  onChange={(e) => setPricePerToken(e.target.value)}
                  style={inputStyle}
                />
              </FormField>

              <FormField label="Buy Date (optional)">
                <input
                  type="date"
                  value={buyDate}
                  onChange={(e) => setBuyDate(e.target.value)}
                  style={inputStyle}
                />
              </FormField>

              <FormField label="Notes (optional)">
                <textarea
                  rows={3}
                  placeholder="Add a note about this transaction…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    minHeight: '72px',
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                  }}
                />
              </FormField>

              {saveError && (
                <p style={{ fontSize: '0.82rem', color: '#f87171', margin: 0 }}>{saveError}</p>
              )}

              {saveStatus === 'success' && (
                <p style={{ fontSize: '0.82rem', color: '#4ade80', margin: 0 }}>
                  Cost basis saved successfully.
                </p>
              )}

              <button
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
                style={{
                  padding: '0.55rem 1.25rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(250,128,114,0.4)',
                  background:
                    saveStatus === 'saving'
                      ? 'rgba(250,128,114,0.08)'
                      : 'rgba(250,128,114,0.15)',
                  color: saveStatus === 'saving' ? 'rgba(250,128,114,0.4)' : 'rgba(250,128,114,0.9)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                  alignSelf: 'flex-start',
                  transition: 'background 0.12s',
                }}
              >
                {saveStatus === 'saving' ? 'Saving…' : 'Save Cost Basis'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function QuickButton({
  label,
  emoji,
  color,
  onClick,
  active,
}: {
  label: string;
  emoji: string;
  color: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.35rem 0.75rem',
        borderRadius: '999px',
        border: `1px solid ${color},${active ? '0.5)' : '0.25)'}`,
        background: `${color},${active ? '0.15)' : '0.07)'})`,
        color: `${color},${active ? '1)' : '0.7)'})`,
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      <span>{emoji}</span>
      {label}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        opacity: 0.45,
        marginBottom: '0.75rem',
        marginTop: 0,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        paddingBottom: '0.4rem',
      }}
    >
      {children}
    </h3>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <span
        style={{
          fontSize: '0.78rem',
          fontWeight: 600,
          opacity: 0.55,
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function HistoryRow({ evt }: { evt: HistoryEvent }) {
  const isIn = evt.direction === 'in';
  const dirColor = isIn ? '#4ade80' : '#f87171';
  const dirLabel = isIn ? 'IN' : 'OUT';

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.4rem 0.75rem',
        padding: '0.55rem 0.75rem',
        borderRadius: '7px',
        background: 'rgba(255,255,255,0.04)',
        borderLeft: `3px solid ${dirColor}40`,
        fontSize: '0.83rem',
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: '0.72rem',
          color: dirColor,
          letterSpacing: '0.06em',
          minWidth: '2.5rem',
        }}
      >
        {dirLabel}
      </span>

      <span style={{ opacity: 0.55, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
        {fDateTime(evt.timestamp_utc)}
      </span>

      {evt.amount != null && (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fQty(evt.amount)}</span>
      )}

      {evt.native_usd != null && (
        <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
          {fUsd(evt.native_usd)}
        </span>
      )}

      <span
        style={{
          fontSize: '0.72rem',
          opacity: 0.4,
          marginLeft: 'auto',
          fontStyle: 'italic',
        }}
      >
        {evt.transaction_class.replace(/_/g, ' ')}
      </span>

      {evt.tx_hash && (
        <span style={{ width: '100%', fontSize: '0.73rem', paddingLeft: '3.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ opacity: 0.35, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>
            {hashType(evt.tx_hash) === 'evm-address' ? 'wallet' : 'tx'}
          </span>
          {explorerUrl(evt.tx_hash) ? (
            <a
              href={explorerUrl(evt.tx_hash)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'rgba(96,165,250,0.8)', textDecoration: 'none', fontFamily: 'monospace' }}
            >
              {truncateHash(evt.tx_hash)} ↗
            </a>
          ) : (
            <span style={{ opacity: 0.4, fontFamily: 'monospace' }}>
              {truncateHash(evt.tx_hash)}
            </span>
          )}
          <CopyButton text={evt.tx_hash} />
        </span>
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '7px',
  color: 'rgba(255,255,255,0.9)',
  fontSize: '0.9rem',
  padding: '0.45rem 0.7rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.12s',
};
