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
  transactionClass: string;
  sourceType: string;
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
  from_address: string | null;
  to_address: string | null;
  chain: string | null;
  wallet_label: string | null;
  wallet_address: string | null;
  from_label: string | null;
  to_label: string | null;
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

  const [actionMode, setActionMode] = useState<'idle' | 'dispose' | 'forward'>('idle');
  const [disposeCategory, setDisposeCategory] = useState('sell');
  const [disposeNote, setDisposeNote] = useState('');
  const [forwardDest, setForwardDest] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [actionStatus, setActionStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  // Token trail — inline address label form
  const [trailLabelText, setTrailLabelText] = useState('');
  const [trailLabelSaving, setTrailLabelSaving] = useState(false);
  const [trailLabelSaved, setTrailLabelSaved] = useState(false);

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
      setActionMode('idle');
      setDisposeCategory('sell');
      setDisposeNote('');
      setForwardDest('');
      setForwardNote('');
      setActionStatus('idle');
      setActionError(null);
      setTrailLabelText('');
      setTrailLabelSaving(false);
      setTrailLabelSaved(false);
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
      // Close the drawer and reload so the resolved item disappears from the list
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1500);
    } catch (err: unknown) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [item, pricePerToken, buyDate, notes, onClose]);

  const handleAnnotate = useCallback(async (category: string, note: string) => {
    if (!item) return;
    setActionStatus('saving');
    setActionError(null);
    try {
      const res = await fetch(`/api/research/annotate/${item.sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, note: note || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActionStatus('success');
      setTimeout(() => { onClose(); window.location.reload(); }, 1200);
    } catch (err: unknown) {
      setActionStatus('error');
      setActionError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [item, onClose]);

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

          {/* ── Token Trail ──────────────────────────────────────────────── */}
          {!historyLoading && history.length > 0 && (() => {
            const outEvts = history.filter(e => e.direction === 'out');
            if (outEvts.length === 0) return null;
            const outEvt = outEvts[outEvts.length - 1];
            const walletName = outEvt.wallet_label || (outEvt.wallet_address ? truncateHash(outEvt.wallet_address) : null);
            const destAddr   = outEvt.to_address;
            const destLabel  = trailLabelSaved ? trailLabelText : (outEvt.to_label ?? null);
            const inBook     = !!destLabel;
            const chain      = outEvt.chain ?? null;
            const explorerBase = chain === 'avalanche' ? 'https://snowtrace.io'
              : chain === 'polygon' ? 'https://polygonscan.com'
              : chain === 'bsc'     ? 'https://bscscan.com'
              : 'https://etherscan.io';

            return (
              <section style={{
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: 'rgba(251,191,36,0.05)',
                border: '1px solid rgba(251,191,36,0.18)',
                display: 'flex', flexDirection: 'column', gap: '0.6rem',
                fontSize: '0.83rem',
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.74rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  🔍 Token Trail
                </div>

                {/* Source wallet */}
                {walletName && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ opacity: 0.4, fontSize: '0.69rem', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: '4.5rem', flexShrink: 0 }}>In wallet</span>
                    <span style={{ color: '#fbbf24', fontWeight: 700 }}>{walletName}</span>
                    {outEvt.wallet_address && (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.69rem', opacity: 0.4 }}>
                        ({truncateHash(outEvt.wallet_address)})
                      </span>
                    )}
                  </div>
                )}

                {/* Destination */}
                {destAddr && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ opacity: 0.4, fontSize: '0.69rem', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: '4.5rem', flexShrink: 0, paddingTop: '0.15rem' }}>Sent to</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1 }}>
                      {/* Address book status */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {inBook ? (
                          <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>
                            ✓ {destLabel}
                            <span style={{ color: 'rgba(74,222,128,0.5)', fontWeight: 400, fontSize: '0.72rem', marginLeft: '0.35rem' }}>in address book</span>
                          </span>
                        ) : (
                          <span style={{ color: '#f87171', fontWeight: 600, fontSize: '0.78rem' }}>✗ Not in your address book</span>
                        )}
                      </div>
                      {/* Address link */}
                      <a href={`${explorerBase}/address/${destAddr}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'rgba(96,165,250,0.75)', textDecoration: 'none', wordBreak: 'break-all' }}>
                        {destAddr} ↗
                      </a>
                      {/* Inline add-label form */}
                      {!inBook && (
                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            placeholder="Label this address…"
                            value={trailLabelText}
                            onChange={e => setTrailLabelText(e.target.value)}
                            style={{
                              flex: 1, minWidth: '130px',
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: '6px', padding: '0.35rem 0.6rem',
                              color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit',
                              outline: 'none',
                            }}
                          />
                          <button
                            disabled={!trailLabelText.trim() || trailLabelSaving}
                            onClick={async () => {
                              if (!trailLabelText.trim()) return;
                              setTrailLabelSaving(true);
                              try {
                                await fetch('/api/address-labels', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ address: destAddr, label: trailLabelText.trim(), chain }),
                                });
                                setTrailLabelSaved(true);
                              } finally {
                                setTrailLabelSaving(false);
                              }
                            }}
                            style={{
                              padding: '0.35rem 0.75rem', borderRadius: '6px',
                              border: '1px solid rgba(99,102,241,0.4)',
                              background: 'rgba(99,102,241,0.15)',
                              color: '#a5b4fc', fontSize: '0.78rem', fontWeight: 600,
                              cursor: trailLabelText.trim() ? 'pointer' : 'not-allowed',
                              opacity: trailLabelText.trim() ? 1 : 0.4,
                              fontFamily: 'inherit',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {trailLabelSaving ? 'Saving…' : '+ Add to book'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })()}

          {/* ── Dispose / Forward actions ────────────────────────────────── */}
          <section>
            <SectionHeading>Actions</SectionHeading>

            {/* Source badge */}
            {item.sourceType && (
              <div style={{ fontSize: '0.78rem', opacity: 0.5, marginBottom: '0.85rem' }}>
                From: <span style={{ fontWeight: 600, opacity: 1, color: 'rgba(255,255,255,0.75)' }}>{item.sourceType}</span>
              </div>
            )}

            {/* Action toggle buttons */}
            {actionMode === 'idle' && (
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setActionMode('dispose')}
                  style={{
                    padding: '0.45rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(248,113,113,0.35)',
                    background: 'rgba(248,113,113,0.1)',
                    color: '#fca5a5',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                >
                  📤 Dispose
                </button>
                <button
                  type="button"
                  onClick={() => setActionMode('forward')}
                  style={{
                    padding: '0.45rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(96,165,250,0.35)',
                    background: 'rgba(96,165,250,0.1)',
                    color: '#93c5fd',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                >
                  ↗ Forward
                </button>
              </div>
            )}

            {/* Dispose form */}
            {actionMode === 'dispose' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ fontSize: '0.8rem', opacity: 0.45, margin: 0, fontStyle: 'italic' }}>
                  Mark how this asset left your wallet.
                </p>
                <FormField label="Disposal type">
                  <select
                    value={disposeCategory}
                    onChange={(e) => setDisposeCategory(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="sell">Sale</option>
                    <option value="trade">Trade / Swap</option>
                    <option value="gift_out">Gift Out</option>
                    <option value="lost">Lost / Stolen</option>
                    <option value="donation">Donation</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
                <FormField label="Note (optional)">
                  <textarea
                    rows={2}
                    placeholder="Add a note…"
                    value={disposeNote}
                    onChange={(e) => setDisposeNote(e.target.value)}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: '56px', fontFamily: 'inherit', lineHeight: 1.5 }}
                  />
                </FormField>
                {actionError && <p style={{ fontSize: '0.82rem', color: '#f87171', margin: 0 }}>{actionError}</p>}
                {actionStatus === 'success' && <p style={{ fontSize: '0.82rem', color: '#4ade80', margin: 0 }}>✓ Saved — refreshing…</p>}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={actionStatus === 'saving'}
                    onClick={() => handleAnnotate(disposeCategory, disposeNote)}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(248,113,113,0.4)',
                      background: actionStatus === 'saving' ? 'rgba(248,113,113,0.06)' : 'rgba(248,113,113,0.15)',
                      color: actionStatus === 'saving' ? 'rgba(248,113,113,0.4)' : '#fca5a5',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: actionStatus === 'saving' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {actionStatus === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActionMode('idle'); setActionError(null); }}
                    style={{
                      padding: '0.45rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'transparent',
                      color: 'rgba(255,255,255,0.35)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Forward form */}
            {actionMode === 'forward' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ fontSize: '0.8rem', opacity: 0.45, margin: 0, fontStyle: 'italic' }}>
                  Mark this as a transfer to one of your own wallets.
                </p>
                <FormField label="Forwarded to (wallet / exchange)">
                  <input
                    type="text"
                    placeholder="e.g. Coinbase, My Ledger, 0x1234…"
                    value={forwardDest}
                    onChange={(e) => setForwardDest(e.target.value)}
                    style={inputStyle}
                  />
                </FormField>
                <FormField label="Note (optional)">
                  <textarea
                    rows={2}
                    placeholder="Add a note…"
                    value={forwardNote}
                    onChange={(e) => setForwardNote(e.target.value)}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: '56px', fontFamily: 'inherit', lineHeight: 1.5 }}
                  />
                </FormField>
                {actionError && <p style={{ fontSize: '0.82rem', color: '#f87171', margin: 0 }}>{actionError}</p>}
                {actionStatus === 'success' && <p style={{ fontSize: '0.82rem', color: '#4ade80', margin: 0 }}>✓ Saved — refreshing…</p>}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={actionStatus === 'saving' || !forwardDest.trim()}
                    onClick={() => handleAnnotate('own_wallet', [forwardDest.trim(), forwardNote.trim()].filter(Boolean).join(' — '))}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(96,165,250,0.4)',
                      background: (actionStatus === 'saving' || !forwardDest.trim()) ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.15)',
                      color: (actionStatus === 'saving' || !forwardDest.trim()) ? 'rgba(96,165,250,0.4)' : '#93c5fd',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: (actionStatus === 'saving' || !forwardDest.trim()) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {actionStatus === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActionMode('idle'); setActionError(null); }}
                    style={{
                      padding: '0.45rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'transparent',
                      color: 'rgba(255,255,255,0.35)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Scam / unrecognised warning banner ───────────────────────── */}
          {item.transactionClass === 'other' && (() => {
            const isRound = item.amount >= 100 && item.amount === Math.floor(item.amount);
            const txHash = item.txHash;
            const polygonscanUrl = txHash ? `https://polygonscan.com/tx/${txHash}` : null;
            const dexscreenerUrl = `https://dexscreener.com/search?q=${encodeURIComponent(item.asset)}`;
            const coinGeckoUrl = `https://www.coingecko.com/en/search?query=${encodeURIComponent(item.asset)}`;
            return (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '10px',
                  border: `1px solid ${isRound ? 'rgba(251,191,36,0.4)' : 'rgba(251,191,36,0.2)'}`,
                  background: `${isRound ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.05)'}`,
                  fontSize: '0.82rem',
                  lineHeight: 1.55,
                  color: isRound ? '#fbbf24' : 'rgba(251,191,36,0.75)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                  {isRound ? '⚠ Possible Scam / Airdrop' : '⚠ Unrecognised Transfer'}
                </div>
                <p style={{ margin: '0 0 0.75rem' }}>
                  {isRound
                    ? "This transfer has an unrecognised pattern and a suspiciously round amount — both are hallmarks of scam airdrops. Use the links below to verify before assigning a cost basis. If it's worthless, use \"Worthless Airdrop · $0\" in the form below."
                    : "This transfer couldn't be matched to a known transaction pattern. Verify the hash on the block explorer to confirm what happened."}
                </p>

                {/* How to tell if it's worthless */}
                <div style={{ fontSize: '0.77rem', opacity: 0.85, marginBottom: '0.65rem', lineHeight: 1.6 }}>
                  <strong>How to tell if it's worthless:</strong><br />
                  1. Click <em>Polygonscan</em> below → open the "ERC-20 Token Txns" tab → click the token name.<br />
                  2. Check for a red <strong>"Scam Token"</strong> banner on its contract page — that's definitive.<br />
                  3. Search <em>DexScreener</em> — no liquidity / no trading pairs = likely worthless.<br />
                  4. If the token appeared without you buying it, it's almost certainly a scam airdrop.
                </div>

                {/* Quick-check links */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                  {polygonscanUrl && (
                    <a
                      href={polygonscanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={checkLinkStyle}
                    >
                      🔍 Polygonscan ↗
                    </a>
                  )}
                  <a href={dexscreenerUrl} target="_blank" rel="noopener noreferrer" style={checkLinkStyle}>
                    📊 DexScreener ↗
                  </a>
                  <a href={coinGeckoUrl} target="_blank" rel="noopener noreferrer" style={checkLinkStyle}>
                    🦎 CoinGecko ↗
                  </a>
                </div>
              </div>
            );
          })()}

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
                {buildDisplayRows(history).map((row, idx) =>
                  row.type === 'accumulation' ? (
                    <AccumulationRow key={`acc-${idx}`} group={row} />
                  ) : (
                    <HistoryRow key={row.evt.id || idx} evt={row.evt} />
                  )
                )}
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
                  ✓ Saved — refreshing…
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

// ─── History grouping ─────────────────────────────────────────────────────────

type AccumulationGroup = {
  type: 'accumulation';
  events: HistoryEvent[];
  firstDate: string;
  lastDate: string;
  totalAmount: number;
  totalUsd: number | null;
  count: number;
};

type DisplayRow =
  | AccumulationGroup
  | { type: 'event'; evt: HistoryEvent };

/**
 * Group consecutive IN events into a single AccumulationRow.
 * OUT events are always shown individually — they're the taxable events.
 */
function buildDisplayRows(events: HistoryEvent[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  let inBucket: HistoryEvent[] = [];

  const flushBucket = () => {
    if (inBucket.length === 0) return;
    if (inBucket.length === 1) {
      // Single buy — still show as accumulation for consistency
    }
    const totalAmount = inBucket.reduce((s, e) => s + (e.amount ?? 0), 0);
    const totalUsd = inBucket.some(e => e.native_usd != null)
      ? inBucket.reduce((s, e) => s + (e.native_usd ?? 0), 0)
      : null;
    rows.push({
      type: 'accumulation',
      events: [...inBucket],
      firstDate: inBucket[0].timestamp_utc,
      lastDate: inBucket[inBucket.length - 1].timestamp_utc,
      totalAmount,
      totalUsd,
      count: inBucket.length,
    });
    inBucket = [];
  };

  for (const evt of events) {
    if (evt.direction === 'in') {
      inBucket.push(evt);
    } else {
      flushBucket();
      rows.push({ type: 'event', evt });
    }
  }
  flushBucket();
  return rows;
}

function fMonthYear(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  } catch { return iso; }
}

function AccumulationRow({ group }: { group: AccumulationGroup }) {
  const sameDay = group.firstDate.slice(0, 10) === group.lastDate.slice(0, 10);
  const dateRange = sameDay
    ? fDate(group.firstDate)
    : `${fMonthYear(group.firstDate)} – ${fMonthYear(group.lastDate)}`;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      padding: '0.6rem 0.75rem',
      borderRadius: '7px',
      background: 'rgba(74,222,128,0.05)',
      borderLeft: '3px solid rgba(74,222,128,0.3)',
      fontSize: '0.83rem',
    }}>
      {/* Line 1: badge + date range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{
          fontWeight: 700, fontSize: '0.72rem', color: '#4ade80',
          letterSpacing: '0.06em', minWidth: '2.5rem',
        }}>
          IN
        </span>
        <span style={{ color: '#4ade80', fontWeight: 600 }}>
          {group.count > 1 ? 'Accumulated' : 'Purchased'}
        </span>
        <span style={{ opacity: 0.55, fontSize: '0.78rem' }}>{dateRange}</span>
        {group.count > 1 && (
          <span style={{ opacity: 0.35, fontSize: '0.72rem', marginLeft: 'auto', fontStyle: 'italic' }}>
            {group.count} transactions
          </span>
        )}
      </div>
      {/* Line 2: total tokens + total cost */}
      <div style={{ paddingLeft: '3.25rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ opacity: 0.45, fontSize: '0.72rem', marginRight: '0.3rem' }}>total</span>
          {fQty(group.totalAmount)} tokens
        </span>
        {group.totalUsd != null && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ opacity: 0.45, fontSize: '0.72rem', marginRight: '0.3rem' }}>cost</span>
            {fUsd(group.totalUsd)}
          </span>
        )}
      </div>
    </div>
  );
}

function AddrRow({
  label,
  address,
  chain,
  addressLabel,
}: {
  label: string;
  address: string;
  chain?: string | null;
  addressLabel?: string | null;
}) {
  const url = chain === 'avalanche'
    ? `https://snowtrace.io/address/${address}`
    : chain === 'polygon'
    ? `https://polygonscan.com/address/${address}`
    : chain === 'bsc'
    ? `https://bscscan.com/address/${address}`
    : `https://etherscan.io/address/${address}`;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem', flexWrap: 'wrap' }}>
      <span style={{ opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem', flexShrink: 0 }}>{label}</span>
      {addressLabel && (
        <span style={{ color: '#a78bfa', fontWeight: 600, flexShrink: 0 }}>{addressLabel}</span>
      )}
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{
          color: addressLabel ? 'rgba(167,139,250,0.5)' : 'rgba(96,165,250,0.8)',
          textDecoration: 'none',
          fontFamily: 'monospace',
          fontSize: addressLabel ? '0.66rem' : '0.73rem',
        }}>
        {truncateHash(address)} ↗
      </a>
      <CopyButton text={address} />
    </span>
  );
}

function HistoryRow({ evt }: { evt: HistoryEvent }) {
  const isIn = evt.direction === 'in';
  const dirColor = isIn ? '#4ade80' : '#f87171';
  const dirLabel = isIn ? 'IN' : 'OUT';

  // Determine which side is "my wallet" vs "counterparty"
  const myAddr = evt.wallet_address?.toLowerCase();
  const fromIsMe = myAddr && evt.from_address?.toLowerCase() === myAddr;
  const toIsMe   = myAddr && evt.to_address?.toLowerCase()   === myAddr;

  const walletName = evt.wallet_label || (evt.wallet_address ? truncateHash(evt.wallet_address) : null);
  const counterparty = isIn ? evt.from_address : evt.to_address;
  const myWalletAddr = isIn ? evt.to_address : evt.from_address;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        padding: '0.6rem 0.75rem',
        borderRadius: '7px',
        background: 'rgba(255,255,255,0.04)',
        borderLeft: `3px solid ${dirColor}40`,
        fontSize: '0.83rem',
      }}
    >
      {/* Row 1: direction · date · amount · USD · class */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem 0.75rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.72rem', color: dirColor, letterSpacing: '0.06em', minWidth: '2.5rem' }}>
          {dirLabel}
        </span>
        <span style={{ opacity: 0.55, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
          {fDateTime(evt.timestamp_utc)}
        </span>
        {evt.amount != null && (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fQty(evt.amount)}</span>
        )}
        {evt.native_usd != null && (
          <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{fUsd(evt.native_usd)}</span>
        )}
        <span style={{ fontSize: '0.72rem', opacity: 0.4, marginLeft: 'auto', fontStyle: 'italic' }}>
          {evt.transaction_class.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Row 2: wallet (source) → destination */}
      {(myWalletAddr || counterparty) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingLeft: '3.25rem' }}>
          {myWalletAddr && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem' }}>
              <span style={{ opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem', flexShrink: 0 }}>
                {isIn ? 'to wallet' : 'from wallet'}
              </span>
              {walletName && (
                <span style={{ color: '#fbbf24', fontWeight: 600, marginRight: '0.2rem' }}>{walletName}</span>
              )}
              <a href={`https://etherscan.io/address/${myWalletAddr}`} target="_blank" rel="noopener noreferrer"
                style={{ color: 'rgba(96,165,250,0.8)', textDecoration: 'none', fontFamily: 'monospace' }}>
                {truncateHash(myWalletAddr)} ↗
              </a>
              <CopyButton text={myWalletAddr} />
            </span>
          )}
          {counterparty && (
            <AddrRow
              label={isIn ? 'from' : 'to'}
              address={counterparty}
              chain={evt.chain}
              addressLabel={isIn ? evt.from_label : evt.to_label}
            />
          )}
          {evt.chain && (
            <span style={{ fontSize: '0.65rem', opacity: 0.35, textTransform: 'uppercase', letterSpacing: '0.05em', paddingLeft: '0' }}>
              {evt.chain}
            </span>
          )}
        </div>
      )}

      {/* Row 3: tx hash */}
      {evt.tx_hash && (
        <span style={{ fontSize: '0.73rem', paddingLeft: '3.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ opacity: 0.35, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.65rem' }}>tx</span>
          {explorerUrl(evt.tx_hash) ? (
            <a href={explorerUrl(evt.tx_hash)} target="_blank" rel="noopener noreferrer"
              style={{ color: 'rgba(96,165,250,0.8)', textDecoration: 'none', fontFamily: 'monospace' }}>
              {truncateHash(evt.tx_hash)} ↗
            </a>
          ) : (
            <span style={{ opacity: 0.4, fontFamily: 'monospace' }}>{truncateHash(evt.tx_hash)}</span>
          )}
          <CopyButton text={evt.tx_hash} />
        </span>
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const checkLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.3rem 0.65rem',
  borderRadius: '6px',
  border: '1px solid rgba(251,191,36,0.3)',
  background: 'rgba(251,191,36,0.08)',
  color: '#fbbf24',
  fontSize: '0.77rem',
  fontWeight: 600,
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
};

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
