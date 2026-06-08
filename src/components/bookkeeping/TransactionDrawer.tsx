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
        padding: '0 0.15rem', color: copied ? 'var(--gain)' : 'var(--text-muted)',
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

  // Destination trace — "where did it go at Venmo?"
  type ImportEvent = {
    id: string;
    timestamp_utc: string;
    direction: string | null;
    amount: number | null;
    native_usd: number | null;
    kind: string | null;
    description: string | null;
    tx_hash: string | null;
  };
  const [traceSource, setTraceSource] = useState('');
  const [traceInput, setTraceInput] = useState('');
  const [traceEvents, setTraceEvents] = useState<ImportEvent[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  const handleTrace = useCallback(async (source: string) => {
    if (!item || !source.trim()) return;
    setTraceSource(source.trim());
    setTraceLoading(true);
    setTraceError(null);
    setTraceEvents([]);
    try {
      const res = await fetch(
        `/api/bookkeeping/import-activity?asset=${encodeURIComponent(item.asset)}&source=${encodeURIComponent(source.trim().toLowerCase())}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ImportEvent[];
      setTraceEvents(data);
    } catch (err: unknown) {
      setTraceError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setTraceLoading(false);
    }
  }, [item]);

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
      setTraceSource('');
      setTraceInput('');
      setTraceEvents([]);
      setTraceLoading(false);
      setTraceError(null);
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
          background: 'var(--surface-bg)',
          borderLeft: '1px solid var(--border-bright)',
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
            borderBottom: '1px solid var(--border-bright)',
            position: 'sticky',
            top: 0,
            background: 'var(--surface-bg)',
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
                  color: 'var(--text-primary)',
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
                  background: 'var(--loss-bg)',
                  color: 'var(--loss)',
                  border: '1px solid var(--loss-border)',
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
              <span>
                {item.transactionClass === 'sell'
                  ? 'Sold'
                  : item.transactionClass === 'transfer' || item.transactionClass === 'forward'
                  ? 'Sent'
                  : 'Left wallet'}{' '}
                {fDate(item.sellDate)}
              </span>
              {item.sourceType && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span>from {item.sourceType}</span>
                </>
              )}
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{fQty(item.amount)} {item.asset}</span>
              {item.proceedsUsd != null && item.proceedsUsd > 0 && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span
                    style={{ color: 'var(--accent)' }}
                    title="The USD value recorded at the time of this transaction."
                  >
                    {fUsd(item.proceedsUsd)} proceeds
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            ref={firstFocusRef}
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'var(--border-bright)',
              border: '1px solid var(--border-bright)',
              borderRadius: '8px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: '0.4rem 0.55rem',
              flexShrink: 0,
              marginLeft: '1rem',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = 'var(--border-bright)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = 'var(--border-bright)')
            }
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

          {/* ── Why flagged? ─────────────────────────────────────────────── */}
          {(() => {
            const cls = item.transactionClass;
            const src = item.sourceType;
            const assetAmt = `${fQty(item.amount)} ${item.asset}`;
            const date = fDate(item.sellDate);
            let headline = '';
            let body = '';
            let action = '';
            if (cls === 'sell') {
              headline = `${assetAmt} was sold on ${date}`;
              body = 'We have a sale record but no matching purchase. To calculate your gain or loss, enter the price you paid when you originally acquired this asset.';
              action = 'Use "Set Cost Basis" below → enter what you paid per coin.';
            } else if (cls === 'transfer' || cls === 'forward') {
              headline = `${assetAmt} left ${src || 'your wallet'} on ${date}`;
              body = 'This looks like a transfer, but we couldn\'t match it to a purchase. If you moved it to another wallet you own, mark it as a Forward. If it was a sale or gift, use Dispose.';
              action = 'Use "Forward" if it went to your own wallet, or "Dispose" if it was a sale/gift/loss.';
            } else {
              headline = `${assetAmt} left ${src || 'your wallet'} on ${date}`;
              body = 'We couldn\'t identify this transaction. Check the Coin Journey and Transaction History below to see what happened, then choose the action that fits.';
              action = 'Set the cost basis, forward it, or dispose of it using the options below.';
            }
            return (
              <div style={{
                padding: '0.9rem 1rem',
                borderRadius: '10px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-soft)',
                fontSize: '0.83rem',
                lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.88rem', marginBottom: '0.35rem' }}>
                  Why is this flagged?
                </div>
                <p style={{ margin: '0 0 0.4rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {headline}
                </p>
                <p style={{ margin: '0 0 0.45rem', color: 'var(--text-muted)' }}>
                  {body}
                </p>
                <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.78rem' }}>
                  → {action}
                </p>
              </div>
            );
          })()}

          {/* ── Coin Journey ─────────────────────────────────────────────── */}
          {!historyLoading && history.length > 0 && (() => {
            // Sort all events oldest → newest
            const sorted = [...history].sort(
              (a, b) => new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime()
            );

            // Last OUT event for the inline label form
            const outEvts = sorted.filter(e => e.direction === 'out');
            const lastOut = outEvts[outEvts.length - 1] ?? null;
            const lastOutDest   = lastOut?.to_address ?? null;
            const lastOutLabel  = trailLabelSaved ? trailLabelText : (lastOut?.to_label ?? null);
            const lastOutInBook = !!lastOutLabel;
            const lastOutChain  = lastOut?.chain ?? null;

            function explorerBaseFor(chain: string | null) {
              if (chain === 'avalanche') return 'https://snowtrace.io';
              if (chain === 'polygon')   return 'https://polygonscan.com';
              if (chain === 'bsc')       return 'https://bscscan.com';
              if (chain === 'litecoin')  return 'https://blockexplorer.one/litecoin/mainnet';
              return 'https://etherscan.io';
            }

            function addrUrl(chain: string | null, addr: string) {
              if (chain === 'litecoin') return `https://blockexplorer.one/litecoin/mainnet/address/${addr}`;
              return `${explorerBaseFor(chain)}/address/${addr}`;
            }

            function eventIcon(evt: HistoryEvent) {
              if (evt.direction === 'in')  return '';
              if (evt.direction === 'out') return '';
              return '';
            }

            function eventTitle(evt: HistoryEvent) {
              const src = evt.source_type ?? '';
              const cls = evt.transaction_class ?? '';
              if (evt.direction === 'in') {
                if (src) return `Received from ${src}`;
                if (evt.from_label) return `Received from ${evt.from_label}`;
                return 'Received';
              }
              if (evt.direction === 'out') {
                if (cls === 'transfer' || cls === 'forward') {
                  const dest = (trailLabelSaved && evt === lastOut) ? trailLabelText : (evt.to_label ?? null);
                  if (dest) return `Transferred to ${dest}`;
                  return 'Transferred out';
                }
                if (cls === 'sell') return 'Sold';
                if (src) return `Sent via ${src}`;
                return 'Sent out';
              }
              if (cls === 'buy') return `Acquired${src ? ` on ${src}` : ''}`;
              return cls || 'Event';
            }

            const dotColor = (evt: HistoryEvent) =>
              evt.direction === 'in' ? 'var(--gain)' : evt.direction === 'out' ? 'var(--loss)' : 'var(--accent)';

            return (
              <section style={{
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-soft)',
                display: 'flex', flexDirection: 'column', gap: '0',
                fontSize: '0.83rem',
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.74rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.9rem' }}>
                  Coin Journey
                </div>

                {/* Timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {sorted.map((evt, idx) => {
                    const isLast = idx === sorted.length - 1;
                    const isLastOutEvt = evt === lastOut;
                    const walletName = evt.wallet_label || (evt.wallet_address ? truncateHash(evt.wallet_address) : null);
                    const destAddr = evt.to_address;
                    const destLabel = (trailLabelSaved && isLastOutEvt) ? trailLabelText : (evt.to_label ?? null);
                    const destInBook = !!destLabel;
                    const chain = evt.chain ?? null;

                    return (
                      <div key={evt.id} style={{ display: 'flex', gap: '0.75rem' }}>
                        {/* Spine */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '16px' }}>
                          <div style={{
                            width: '12px', height: '12px', borderRadius: '50%',
                            background: dotColor(evt),
                            boxShadow: `0 0 6px ${dotColor(evt)}66`,
                            flexShrink: 0, marginTop: '0.15rem',
                          }} />
                          {!isLast && (
                            <div style={{ width: '2px', flex: 1, background: 'var(--border-bright)', minHeight: '1.5rem' }} />
                          )}
                        </div>

                        {/* Content */}
                        <div style={{ paddingBottom: isLast ? 0 : '1rem', flex: 1, minWidth: 0 }}>
                          {/* Date + title */}
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                              {fDateTime(evt.timestamp_utc)}
                            </span>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.83rem' }}>
                              {eventIcon(evt)} {eventTitle(evt)}
                            </span>
                          </div>

                          {/* Amount */}
                          {evt.amount != null && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                              {fQty(evt.amount)} {item.asset}
                              {evt.native_usd != null && (
                                <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>· {fUsd(evt.native_usd)}</span>
                              )}
                            </div>
                          )}

                          {/* Wallet holding the coin */}
                          {walletName && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--accent)', opacity: 0.85 }}>
                              Wallet: <span style={{ fontWeight: 700 }}>{walletName}</span>
                              {evt.wallet_address && (
                                <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', opacity: 0.45, marginLeft: '0.35rem' }}>
                                  ({truncateHash(evt.wallet_address)})
                                </span>
                              )}
                            </div>
                          )}

                          {/* Destination address (OUT events) */}
                          {destAddr && evt.direction === 'out' && (
                            <div style={{ marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              {destInBook ? (
                                <span style={{ fontSize: '0.75rem', color: 'var(--gain)', fontWeight: 600 }}>
                                  ✓ {destLabel}
                                  <span style={{ color: 'var(--gain-border)', fontWeight: 400, marginLeft: '0.3rem' }}>in address book</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.73rem', color: 'var(--loss)', fontWeight: 600 }}>✗ Not in your address book</span>
                              )}
                              <a
                                href={addrUrl(chain, destAddr)}
                                target="_blank" rel="noopener noreferrer"
                                style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all' }}
                              >
                                {destAddr} ↗
                              </a>
                              {/* Inline label form for unknown last-out destination */}
                              {isLastOutEvt && !lastOutInBook && (
                                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.1rem', flexWrap: 'wrap' }}>
                                  <input
                                    type="text"
                                    placeholder="Label this address…"
                                    value={trailLabelText}
                                    onChange={e => setTrailLabelText(e.target.value)}
                                    style={{
                                      flex: 1, minWidth: '130px',
                                      background: 'var(--border-subtle)',
                                      border: '1px solid var(--border-bright)',
                                      borderRadius: '6px', padding: '0.35rem 0.6rem',
                                      color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'inherit',
                                      outline: 'none',
                                    }}
                                  />
                                  <button
                                    disabled={!trailLabelText.trim() || trailLabelSaving}
                                    onClick={async () => {
                                      if (!trailLabelText.trim() || !lastOutDest) return;
                                      setTrailLabelSaving(true);
                                      try {
                                        await fetch('/api/address-labels', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ address: lastOutDest, label: trailLabelText.trim(), chain: lastOutChain }),
                                        });
                                        setTrailLabelSaved(true);
                                      } finally {
                                        setTrailLabelSaving(false);
                                      }
                                    }}
                                    style={{
                                      padding: '0.35rem 0.75rem', borderRadius: '6px',
                                      border: '1px solid var(--accent-dim)',
                                      background: 'var(--accent-soft)',
                                      color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600,
                                      cursor: trailLabelText.trim() ? 'pointer' : 'not-allowed',
                                      opacity: trailLabelText.trim() ? 1 : 0.4,
                                      fontFamily: 'inherit', whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {trailLabelSaving ? 'Saving…' : '+ Add to book'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Source address (IN events) */}
                          {evt.from_address && evt.direction === 'in' && !evt.from_label && (
                            <a
                              href={addrUrl(chain, evt.from_address)}
                              target="_blank" rel="noopener noreferrer"
                              style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all' }}
                            >
                              {evt.from_address} ↗
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* ── Destination trace ────────────────────────────────────────── */}
          <section style={{
            padding: '0.85rem 1rem',
            borderRadius: '10px',
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-soft)',
          }}>
            <div style={{ fontWeight: 700, fontSize: '0.74rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
              Trace at Destination
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.65rem', lineHeight: 1.5 }}>
              Know where this {item.asset} landed? Enter the platform name to see its full history there.
            </p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="e.g. venmo, coinbase, kraken…"
                value={traceInput}
                onChange={(e) => setTraceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleTrace(traceInput); }}
                style={{
                  flex: 1, minWidth: '140px',
                  background: 'var(--border-subtle)',
                  border: '1px solid var(--border-bright)',
                  borderRadius: '6px', padding: '0.38rem 0.65rem',
                  color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <button
                disabled={!traceInput.trim() || traceLoading}
                onClick={() => void handleTrace(traceInput)}
                style={{
                  padding: '0.38rem 0.85rem', borderRadius: '6px',
                  border: '1px solid var(--accent-dim)',
                  background: traceInput.trim() ? 'var(--accent-soft)' : 'var(--accent-soft)',
                  color: traceInput.trim() ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: 700, fontSize: '0.8rem', cursor: traceInput.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {traceLoading ? 'Loading…' : 'Look up'}
              </button>
            </div>

            {traceError && (
              <p style={{ fontSize: '0.8rem', color: 'var(--loss)', margin: '0.5rem 0 0' }}>{traceError}</p>
            )}

            {!traceLoading && traceSource && traceEvents.length === 0 && !traceError && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.6rem 0 0', fontStyle: 'italic' }}>
                No {item.asset} transactions found at {traceSource}.
              </p>
            )}

            {traceEvents.length > 0 && (() => {
              function kindLabel(kind: string | null, direction: string | null): string {
                if (kind === 'crypto_purchase' || kind === 'crypto_deposit') return direction === 'in' ? 'Received / Deposit' : 'Sent';
                if (kind === 'crypto_to_van_sell_order') return 'Sold';
                if (kind === 'crypto_withdrawal') return 'Withdrawal / Sent out';
                if (direction === 'in') return 'Received';
                if (direction === 'out') return 'Sent out';
                return kind ?? 'Event';
              }
              const dotColor = (dir: string | null) =>
                dir === 'in' ? 'var(--gain)' : dir === 'out' ? 'var(--loss)' : 'var(--accent)';

              return (
                <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--accent)', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {item.asset} at {traceSource} — {traceEvents.length} event{traceEvents.length !== 1 ? 's' : ''}
                  </div>
                  {traceEvents.map((evt, idx) => {
                    const isLast = idx === traceEvents.length - 1;
                    return (
                      <div key={evt.id} style={{ display: 'flex', gap: '0.65rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '14px' }}>
                          <div style={{
                            width: '10px', height: '10px', borderRadius: '50%',
                            background: dotColor(evt.direction),
                            boxShadow: `0 0 5px ${dotColor(evt.direction)}66`,
                            flexShrink: 0, marginTop: '0.2rem',
                          }} />
                          {!isLast && <div style={{ width: '2px', flex: 1, background: 'var(--border-bright)', minHeight: '1.2rem' }} />}
                        </div>
                        <div style={{ paddingBottom: isLast ? 0 : '0.75rem', flex: 1 }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap', marginBottom: '0.15rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                              {fDateTime(evt.timestamp_utc)}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                              {evt.direction === 'in' ? '' : evt.direction === 'out' ? '' : ''}{' '}
                              {kindLabel(evt.kind, evt.direction)}
                            </span>
                          </div>
                          {evt.amount != null && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {fQty(Math.abs(evt.amount))} {item.asset}
                              {evt.native_usd != null && (
                                <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>· {fUsd(evt.native_usd)}</span>
                              )}
                            </div>
                          )}
                          {evt.description && evt.description !== 'Transfer In' && evt.description !== 'Transfer Out' && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{evt.description}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>

          {/* ── Dispose / Forward actions ────────────────────────────────── */}
          <section>
            <SectionHeading>Actions</SectionHeading>

            {/* Source badge */}
            {item.sourceType && (
              <div style={{ fontSize: '0.78rem', opacity: 0.5, marginBottom: '0.85rem' }}>
                From: <span style={{ fontWeight: 600, opacity: 1, color: 'var(--text-secondary)' }}>{item.sourceType}</span>
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
                    border: '1px solid var(--loss-border)',
                    background: 'var(--loss-bg)',
                    color: 'var(--loss)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                >
                  Dispose
                </button>
                <button
                  type="button"
                  onClick={() => setActionMode('forward')}
                  style={{
                    padding: '0.45rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--accent-dim)',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
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
                {actionError && <p style={{ fontSize: '0.82rem', color: 'var(--loss)', margin: 0 }}>{actionError}</p>}
                {actionStatus === 'success' && <p style={{ fontSize: '0.82rem', color: 'var(--gain)', margin: 0 }}>✓ Saved — refreshing…</p>}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={actionStatus === 'saving'}
                    onClick={() => handleAnnotate(disposeCategory, disposeNote)}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--text-muted)',
                      background: actionStatus === 'saving' ? 'var(--loss-bg)' : 'var(--loss-bg)',
                      color: actionStatus === 'saving' ? 'var(--text-muted)' : 'var(--loss)',
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
                      border: '1px solid var(--border-bright)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
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
                {actionError && <p style={{ fontSize: '0.82rem', color: 'var(--loss)', margin: 0 }}>{actionError}</p>}
                {actionStatus === 'success' && <p style={{ fontSize: '0.82rem', color: 'var(--gain)', margin: 0 }}>✓ Saved — refreshing…</p>}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={actionStatus === 'saving' || !forwardDest.trim()}
                    onClick={() => handleAnnotate('own_wallet', [forwardDest.trim(), forwardNote.trim()].filter(Boolean).join(' — '))}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--text-muted)',
                      background: (actionStatus === 'saving' || !forwardDest.trim()) ? 'var(--accent-soft)' : 'var(--accent-soft)',
                      color: (actionStatus === 'saving' || !forwardDest.trim()) ? 'var(--text-muted)' : 'var(--accent)',
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
                      border: '1px solid var(--border-bright)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
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
                  border: '1px solid var(--loss-border)',
                  background: 'var(--loss-bg)',
                  fontSize: '0.82rem',
                  lineHeight: 1.55,
                  color: 'var(--loss)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                  {isRound ? 'Possible Scam / Airdrop' : 'Unrecognised Transfer'}
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
                      Polygonscan ↗
                    </a>
                  )}
                  <a href={dexscreenerUrl} target="_blank" rel="noopener noreferrer" style={checkLinkStyle}>
                    DexScreener ↗
                  </a>
                  <a href={coinGeckoUrl} target="_blank" rel="noopener noreferrer" style={checkLinkStyle}>
                    CoinGecko ↗
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
              <p style={{ fontSize: '0.85rem', color: 'var(--loss)' }}>{historyError}</p>
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
              {item.transactionClass === 'sell'
                ? `Enter the average price you paid per ${item.asset} so this sale can be matched.`
                : `Enter the average price you paid per ${item.asset} when you originally acquired it.`}
            </p>

            {/* ── Quick-fill buttons ──────────────────────────────────── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              {isStablecoin(item.asset) && (
                <QuickButton
                  label={`Stablecoin · $1.00`}
                  tone="gain"
                  onClick={() => handleQuickFill('1', 'Stablecoin — cost basis $1.00/token')}
                  active={pricePerToken === '1'}
                />
              )}
              <QuickButton
                label="Worthless Airdrop · $0"
                tone="muted"
                onClick={() => handleQuickFill('0', 'Scam / worthless airdrop — zero taxable value')}
                active={pricePerToken === '0' && notes.includes('airdrop')}
              />
            </div>

            {/* ERC-20 note — only shown when proceeds > 0 and block-explorer value looks confusing */}
            {item.proceedsUsd != null && item.proceedsUsd > 0 && (
              <div
                style={{
                  fontSize: '0.77rem',
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-soft)',
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
              <FormField label={`Price per ${item.asset} (USD)`}>
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
                <p style={{ fontSize: '0.82rem', color: 'var(--loss)', margin: 0 }}>{saveError}</p>
              )}

              {saveStatus === 'success' && (
                <p style={{ fontSize: '0.82rem', color: 'var(--gain)', margin: 0 }}>
                  ✓ Saved — refreshing…
                </p>
              )}

              <button
                onClick={handleSave}
                disabled={saveStatus === 'saving'}
                style={{
                  padding: '0.55rem 1.25rem',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-dim)',
                  background:
                    saveStatus === 'saving'
                      ? 'var(--accent-soft)'
                      : 'var(--accent-soft)',
                  color: saveStatus === 'saving' ? 'var(--accent-dim)' : 'var(--accent)',
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
  tone,
  onClick,
  active,
}: {
  label: string;
  tone: 'gain' | 'muted';
  onClick: () => void;
  active: boolean;
}) {
  const palette = tone === 'gain'
    ? { border: active ? 'var(--gain)' : 'var(--gain-border)', bg: 'var(--gain-bg)', text: 'var(--gain)' }
    : { border: active ? 'var(--text-muted)' : 'var(--border-bright)', bg: 'var(--surface-card-2)', text: active ? 'var(--text-secondary)' : 'var(--text-muted)' };
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
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.text,
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 0.12s, border-color 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
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
        borderBottom: '1px solid var(--border-bright)',
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
      background: 'var(--gain-bg)',
      borderLeft: '3px solid var(--gain-border)',
      fontSize: '0.83rem',
    }}>
      {/* Line 1: badge + date range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{
          fontWeight: 700, fontSize: '0.72rem', color: 'var(--gain)',
          letterSpacing: '0.06em', minWidth: '2.5rem',
        }}>
          IN
        </span>
        <span style={{ color: 'var(--gain)', fontWeight: 600 }}>
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
        <span style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>{addressLabel}</span>
      )}
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{
          color: addressLabel ? 'var(--accent-dim)' : 'var(--accent)',
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
  const dirColor = isIn ? 'var(--gain)' : 'var(--loss)';
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
        background: 'var(--border-subtle)',
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
                <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: '0.2rem' }}>{walletName}</span>
              )}
              <a href={`https://etherscan.io/address/${myWalletAddr}`} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'monospace' }}>
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
              style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'monospace' }}>
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
  border: '1px solid var(--accent-dim)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontSize: '0.77rem',
  fontWeight: 600,
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
};

const inputStyle: React.CSSProperties = {
  background: 'var(--border-subtle)',
  border: '1px solid var(--border-bright)',
  borderRadius: '7px',
  color: 'var(--text-secondary)',
  fontSize: '0.9rem',
  padding: '0.45rem 0.7rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.12s',
};
