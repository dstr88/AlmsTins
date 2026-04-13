/**
 * ReconciliationTin.tsx
 *
 * Compares "Still in Wallet" FIFO lots against live wallet + exchange balances.
 * Shows coin-quantity and estimated USD deltas per asset, with severity colour coding.
 * Users can add notes and flag assets for support when they can't explain a discrepancy.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ReconciliationItem, ReconciliationStatus } from '../../lib/reconciliation';

// ── Colour maps ──────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<ReconciliationStatus, string> = {
  ok:        '#4ade80',
  over:      '#fbbf24',
  under:     '#ef4444',
  missing:   '#ef4444',
  untracked: '#94a3b8',
};
const STATUS_BG: Record<ReconciliationStatus, string> = {
  ok:        'rgba(74,222,128,0.08)',
  over:      'rgba(251,191,36,0.08)',
  under:     'rgba(239,68,68,0.08)',
  missing:   'rgba(239,68,68,0.08)',
  untracked: 'rgba(148,163,184,0.06)',
};
const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  ok:        '✅ Balanced',
  over:      '⚠️ Over',
  under:     '🔴 Under',
  missing:   '🔴 Missing',
  untracked: '⬜ Untracked',
};

// ── Scam token detector (mirrors bookkeeping.astro) ──────────────────────────
const SCAM_PATTERNS = [
  /https?:\/\//i, /www\./i,
  /\.com/i, /\.net/i, /\.xyz/i, /\.site/i, /\.io/i, /\.fi/i,
  /\.org/i, /\.info/i, /\.co/i, /\.app/i, /\.gg/i,
  /t\.me\//i, /claim/i, /visit/i, /reward/i, /airdrop/i, /official.link/i,
  /check:/i, /\bwpol\b/i,
];
const isScamToken = (s: string) => SCAM_PATTERNS.some(p => p.test(s));

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number, dp = 6): string {
  if (Math.abs(n) < 1e-8) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}
function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

// ── Note Modal ───────────────────────────────────────────────────────────────
function NoteModal({
  item,
  onClose,
  onSaved,
}: {
  item: ReconciliationItem;
  onClose: () => void;
  onSaved: (asset: string, note: string | null, flagged: boolean) => void;
}) {
  const [noteText, setNoteText]   = useState(item.existingNote?.note ?? '');
  const [flagged, setFlagged]     = useState(item.existingNote?.flaggedForSupport ?? false);
  const [status, setStatus]       = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    setStatus('saving');
    try {
      const res = await fetch('/api/reconciliation/note', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assetSymbol: item.asset, note: noteText, flaggedForSupport: flagged }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('success');
      onSaved(item.asset, noteText || null, flagged);
      setTimeout(onClose, 1200);
    } catch {
      setStatus('error');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Note for ${item.asset}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      />

      {/* Panel */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: '#0f172a',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16,
        padding: '1.75rem',
        width: '100%', maxWidth: 480,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Reconciliation note
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f7f2eb' }}>
              {item.asset}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer', padding: 4 }}
            aria-label="Close"
          >✕</button>
        </div>

        {/* Discrepancy summary */}
        <div style={{
          background: STATUS_BG[item.status],
          border: `1px solid ${STATUS_COLOR[item.status]}33`,
          borderRadius: 10, padding: '0.75rem 1rem',
          marginBottom: '1.25rem',
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem',
        }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Tin says</div>
            <div style={{ fontWeight: 600, color: '#f7f2eb' }}>{fmt(item.tinAmount)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Wallet has</div>
            <div style={{ fontWeight: 600, color: '#f7f2eb' }}>{fmt(item.liveAmount)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Difference</div>
            <div style={{ fontWeight: 600, color: STATUS_COLOR[item.status] }}>
              {item.deltaCoins >= 0 ? '+' : ''}{fmt(item.deltaCoins)}
            </div>
          </div>
        </div>

        {/* Note textarea */}
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
            What do you think happened?
          </div>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="e.g. This BTC was sent to a hardware wallet not yet connected…"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, padding: '0.75rem',
              color: '#f7f2eb', fontSize: '0.9rem',
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        </label>

        {/* Flag for support */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={flagged}
            onChange={e => setFlagged(e.target.checked)}
            style={{ marginTop: 3, accentColor: 'salmon', cursor: 'pointer' }}
          />
          <div>
            <div style={{ color: '#f7f2eb', fontSize: '0.875rem', fontWeight: 500 }}>
              Flag for support
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 2 }}>
              Notify Donnie — he'll look at your data and follow up.
            </div>
          </div>
        </label>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={status === 'saving' || status === 'success'}
          style={{
            width: '100%', padding: '0.75rem',
            background: status === 'success' ? '#4ade80' : 'salmon',
            color: status === 'success' ? '#0f172a' : '#fff',
            border: 'none', borderRadius: 10,
            fontSize: '0.95rem', fontWeight: 600,
            cursor: status === 'saving' ? 'wait' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {status === 'saving'  ? 'Saving…'  :
           status === 'success' ? '✓ Saved'  :
           status === 'error'   ? 'Error — try again' :
           'Save Note'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ReconciliationTin() {
  const [items, setItems]     = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<ReconciliationItem | null>(null);

  useEffect(() => {
    fetch('/api/reconciliation')
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((data: ReconciliationItem[]) => { setItems(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  const handleNoteSaved = useCallback((asset: string, note: string | null, flagged: boolean) => {
    setItems(prev => prev.map(i =>
      i.asset === asset
        ? { ...i, existingNote: { note, flaggedForSupport: flagged } }
        : i
    ));
  }, []);

  const openNote = (item: ReconciliationItem) => {
    setNoteTarget(item);
  };

  // ── Split scam tokens out of main view ───────────────────────────────────
  const cleanItems = items.filter(i => !isScamToken(i.asset));
  const scamItems  = items.filter(i =>  isScamToken(i.asset));

  // ── Counters (based on clean items only) ─────────────────────────────────
  const flaggedCount   = cleanItems.filter(i => i.existingNote?.flaggedForSupport).length;
  const problemCount   = cleanItems.filter(i => i.status !== 'ok' && i.status !== 'untracked').length;
  const untrackedCount = cleanItems.filter(i => i.status === 'untracked').length;

  return (
    <div style={{ fontFamily: 'inherit', color: '#f7f2eb' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '0.5rem',
        marginBottom: '1rem',
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            🔍 Reconciliation
          </h3>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Compares your FIFO "Still in Wallet" lots against live balances from connected wallets and exchanges.
          </p>
        </div>
        {!loading && !error && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {problemCount > 0 && (
              <span style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: '#ef4444' }}>
                {problemCount} discrepanc{problemCount === 1 ? 'y' : 'ies'}
              </span>
            )}
            {untrackedCount > 0 && (
              <span style={{ background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                {untrackedCount} untracked
              </span>
            )}
            {flaggedCount > 0 && (
              <span style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: '#fbbf24' }}>
                {flaggedCount} flagged for support
              </span>
            )}
            {problemCount === 0 && untrackedCount === 0 && flaggedCount === 0 && (
              <span style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: '#4ade80' }}>
                ✅ All balanced
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Loading / Error ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.9rem' }}>
          Loading reconciliation data…
        </div>
      )}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '1rem', color: '#ef4444', fontSize: '0.875rem' }}>
          Failed to load reconciliation data: {error}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!loading && !error && cleanItems.length === 0 && scamItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.9rem' }}>
          No data yet — upload some CSV files or connect a wallet to get started.
        </div>
      )}

      {!loading && !error && (cleanItems.length > 0 || scamItems.length > 0) && (
        <div style={{ overflowX: 'auto' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr 1fr 1fr 1fr 120px 36px',
            gap: '0.5rem',
            padding: '0.4rem 0.75rem',
            fontSize: '0.7rem', fontWeight: 600,
            color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>Asset</div>
            <div style={{ textAlign: 'right' }}>Tin says</div>
            <div style={{ textAlign: 'right' }}>Wallet has</div>
            <div style={{ textAlign: 'right' }}>Δ Coins</div>
            <div style={{ textAlign: 'right' }}>est. Δ USD</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div />
          </div>

          {/* Rows */}
          {cleanItems.map(item => {
            const isExpanded = expanded === item.asset;
            const isFlagged  = item.existingNote?.flaggedForSupport;
            const hasNote    = item.existingNote?.note;
            return (
              <div key={item.asset} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {/* Main row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 1fr 1fr 1fr 120px 36px',
                  gap: '0.5rem',
                  alignItems: 'center',
                  padding: '0.6rem 0.75rem',
                  background: isFlagged ? 'rgba(251,191,36,0.04)' : 'transparent',
                  transition: 'background 0.15s',
                }}>
                  {/* Asset */}
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    {item.asset}
                    {isFlagged && <span title="Flagged for support" style={{ marginLeft: 4, fontSize: '0.7rem' }}>🚩</span>}
                    {hasNote && !isFlagged && <span title="Has note" style={{ marginLeft: 4, fontSize: '0.7rem' }}>📝</span>}
                  </div>

                  {/* Tin says */}
                  <div style={{ textAlign: 'right', fontSize: '0.85rem', color: '#cbd5e1' }}>
                    {fmt(item.tinAmount)}
                  </div>

                  {/* Wallet has */}
                  <div style={{ textAlign: 'right', fontSize: '0.85rem', color: '#cbd5e1' }}>
                    {item.liveAmount > 0 ? fmt(item.liveAmount) : <span style={{ color: '#475569' }}>—</span>}
                  </div>

                  {/* Δ Coins */}
                  <div style={{
                    textAlign: 'right', fontSize: '0.85rem', fontWeight: 600,
                    color: item.deltaCoins === 0 ? '#64748b' : item.deltaCoins > 0 ? '#4ade80' : '#ef4444',
                  }}>
                    {item.deltaCoins === 0 ? '—' : (item.deltaCoins > 0 ? '+' : '') + fmt(item.deltaCoins)}
                  </div>

                  {/* est. Δ USD */}
                  <div style={{
                    textAlign: 'right', fontSize: '0.8rem',
                    color: item.deltaUsd == null ? '#475569' : item.deltaUsd === 0 ? '#64748b' : item.deltaUsd > 0 ? '#4ade80' : '#ef4444',
                  }}>
                    {item.deltaUsd == null ? '—' : item.deltaUsd === 0 ? '—' : (item.deltaUsd > 0 ? '+' : '-') + fmtUsd(item.deltaUsd)}
                  </div>

                  {/* Status badge */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      background: STATUS_BG[item.status],
                      color: STATUS_COLOR[item.status],
                      border: `1px solid ${STATUS_COLOR[item.status]}44`,
                      borderRadius: 20, padding: '0.15rem 0.55rem',
                      fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>

                  {/* Expand chevron */}
                  <div style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : item.asset)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#64748b', fontSize: '0.8rem', padding: 4,
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }}
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >▼</button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{
                    padding: '0.75rem 1.25rem 1rem',
                    background: 'rgba(255,255,255,0.02)',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '1rem', marginBottom: '1rem',
                    }}>
                      {/* Last known transaction */}
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                          Last known transaction
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#cbd5e1' }}>
                          {fmtDate(item.lastTxDate)}
                        </div>
                      </div>

                      {/* Delta percent */}
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                          Δ Percent
                        </div>
                        <div style={{ fontSize: '0.875rem', color: STATUS_COLOR[item.status] }}>
                          {fmtPct(item.deltaPercent)}
                        </div>
                      </div>
                    </div>

                    {/* Sources breakdown */}
                    {item.sources.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                          Live balance sources
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {item.sources.map((s, i) => (
                            <span key={i} style={{
                              background: s.kind === 'wallet' ? 'rgba(59,130,246,0.12)' : 'rgba(251,191,36,0.1)',
                              border: `1px solid ${s.kind === 'wallet' ? 'rgba(59,130,246,0.3)' : 'rgba(251,191,36,0.25)'}`,
                              borderRadius: 8, padding: '0.2rem 0.6rem',
                              fontSize: '0.78rem', color: '#cbd5e1',
                            }}>
                              {s.kind === 'wallet' ? '🔗' : '🏦'} {s.label}: <strong>{fmt(s.amount)}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Existing note */}
                    {item.existingNote?.note && (
                      <div style={{
                        background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
                        borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: '0.75rem',
                        fontSize: '0.85rem', color: '#fde68a',
                      }}>
                        📝 {item.existingNote.note}
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {item.status !== 'ok' && (
                        <button
                          onClick={() => openNote(item)}
                          style={{
                            background: 'rgba(239,68,68,0.12)',
                            border: '1px solid rgba(239,68,68,0.35)',
                            borderRadius: 8, padding: '0.4rem 0.8rem',
                            color: '#fca5a5', fontSize: '0.8rem', cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          🤔 I can't find this
                        </button>
                      )}
                      <button
                        onClick={() => openNote(item)}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 8, padding: '0.4rem 0.8rem',
                          color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {item.existingNote?.note ? '✏️ Edit note' : '📝 Add note'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Worthless Airdrops ─────────────────────────────────────────────── */}
      {!loading && !error && scamItems.length > 0 && (
        <details style={{ marginTop: '1.5rem' }}>
          <summary style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            cursor: 'pointer', userSelect: 'none',
            padding: '0.65rem 0.75rem',
            background: 'rgba(248,113,113,0.05)',
            border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: 10,
            fontSize: '0.85rem', fontWeight: 600, color: '#fca5a5',
            listStyle: 'none',
          }}>
            <span>☣️</span>
            <span>Worthless Airdrops</span>
            <span style={{
              background: 'rgba(248,113,113,0.15)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 999, padding: '0.1rem 0.55rem',
              fontSize: '0.72rem', fontWeight: 700,
            }}>{scamItems.length}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 }}>
              click to expand
            </span>
          </summary>
          <div style={{
            border: '1px solid rgba(248,113,113,0.15)',
            borderTop: 'none',
            borderRadius: '0 0 10px 10px',
            padding: '0.75rem',
            background: 'rgba(248,113,113,0.03)',
          }}>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
              These tokens were sent to your wallet unsolicited. Their names contain phishing URLs or "claim" prompts designed to drain your wallet if clicked. They have <strong style={{ color: '#fca5a5' }}>no real value</strong> and are excluded from your reconciliation totals. Do not interact with them.
            </p>
            {scamItems.map(item => (
              <div key={item.asset} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.4rem 0.5rem',
                borderRadius: 6,
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                gap: '1rem',
              }}>
                <span style={{
                  fontSize: '0.82rem', color: 'rgba(255,255,255,0.35)',
                  fontFamily: 'monospace', wordBreak: 'break-all',
                  textDecoration: 'line-through',
                }}>
                  {item.asset}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b', flexShrink: 0 }}>
                  $0.00
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Note Modal ─────────────────────────────────────────────────────── */}
      {noteTarget && (
        <NoteModal
          item={noteTarget}
          onClose={() => setNoteTarget(null)}
          onSaved={handleNoteSaved}
        />
      )}
    </div>
  );
}
