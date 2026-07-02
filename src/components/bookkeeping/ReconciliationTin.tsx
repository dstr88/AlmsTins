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
  ok:        'var(--gain)',
  over:      'var(--accent)',
  under:     'var(--loss)',
  missing:   'var(--loss)',
  untracked: 'var(--text-secondary)',
};
const STATUS_BG: Record<ReconciliationStatus, string> = {
  ok:        'var(--gain-bg)',
  over:      'var(--accent-soft)',
  under:     'var(--loss-bg)',
  missing:   'var(--loss-bg)',
  untracked: 'var(--surface-card-2)',
};
const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  ok:        'Balanced',
  over:      'Over',
  under:     'Under',
  missing:   'Missing',
  untracked: 'No cost basis',
};

// Row order by tax importance: a holding with no acquisition record (no cost
// basis) is the most severe — you can't compute a gain without it — then a
// wallet holding more than the books (untracked inflow), then a recorded
// holding the wallet no longer shows, then the inverse.
const STATUS_PRIORITY: Record<ReconciliationStatus, number> = {
  untracked: 1, // no cost basis
  over:      2,
  missing:   3,
  under:     4,
  ok:        5, // hidden from the table anyway
};

// Plain-English guide shown in the "What is this?" modal — ordered by importance.
const STATUS_GUIDE: { status: ReconciliationStatus; what: string; fix: string }[] = [
  { status: 'untracked', what: 'Your wallet holds this coin, but there is no acquisition record — so there is no cost basis to compute a gain against.', fix: 'Add the acquisition: import the source CSV, or trace it in Memory Lane.' },
  { status: 'over',       what: 'Your wallet holds more than your records show — an inflow (a buy, income, or transfer in) was never imported.', fix: 'Import the missing transaction.' },
  { status: 'missing',    what: 'Your records show a balance your wallet no longer reports.', fix: 'Sync the wallet, or record the disposal / transfer that emptied it.' },
  { status: 'under',      what: 'Your wallet holds less than your records show — a sale or transfer out was not recorded.', fix: 'Record the disposal or transfer.' },
];

// Spam classification is now server-side (single source of truth), override-aware:
// the /api/reconciliation endpoint sets item.filtered. This kills the duplicate
// pattern list that used to live here.

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
        background: 'var(--surface-bg)',
        border: '1px solid var(--border-bright)',
        borderRadius: 16,
        padding: '1.75rem',
        width: '100%', maxWidth: 480,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Reconciliation note
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {item.asset}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.25rem', cursor: 'pointer', padding: 4 }}
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
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Tin says</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(item.tinAmount)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Wallet has</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(item.liveAmount)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Difference</div>
            <div style={{ fontWeight: 600, color: STATUS_COLOR[item.status] }}>
              {item.deltaCoins >= 0 ? '+' : ''}{fmt(item.deltaCoins)}
            </div>
          </div>
        </div>

        {/* Note textarea */}
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
            What do you think happened?
          </div>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="e.g. This BTC was sent to a hardware wallet not yet connected…"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--border-subtle)',
              border: '1px solid var(--border-bright)',
              borderRadius: 8, padding: '0.75rem',
              color: 'var(--text-primary)', fontSize: '0.9rem',
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
            <div style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}>
              Flag for support
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: 2 }}>
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
            background: status === 'success' ? 'var(--gain)' : 'salmon',
            color: status === 'success' ? 'var(--surface-bg)' : 'var(--text-primary)',
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

// ── "What is this?" explainer modal ──────────────────────────────────────────
function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="What is reconciliation?"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--surface-bg)', border: '1px solid var(--border-bright)',
        borderRadius: 16, padding: '1.75rem',
        width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>What is reconciliation?</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.25rem', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          This panel cross-checks two independent sources: what your transaction records say you own
          (<strong style={{ color: 'var(--text-primary)' }}>Tin says</strong>) versus what your connected wallets and
          exchanges actually report holding right now (<strong style={{ color: 'var(--text-primary)' }}>Wallet has</strong>).
          Coins that agree within 1% are hidden — only discrepancies appear, ordered by tax importance.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {STATUS_GUIDE.map(({ status, what, fix }) => (
            <div key={status} style={{ background: STATUS_BG[status], border: `1px solid ${STATUS_COLOR[status]}33`, borderRadius: 10, padding: '0.75rem 0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status] }} />
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
              </div>
              <div style={{ fontSize: '0.83rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{what}</div>
              <div style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-muted)', marginTop: '0.3rem' }}>→ {fix}</div>
            </div>
          ))}
        </div>

        <p style={{ margin: '1rem 0 0', fontSize: '0.8rem', lineHeight: 1.55, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--gain)' }}>Balanced</strong> holdings (within 1%) reconcile cleanly and are
          hidden to keep the list focused. A clean panel means your records match what your wallets actually hold.
        </p>
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
  const [showInfo, setShowInfo] = useState(false);
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
  const cleanItems = items.filter(i => !i.filtered);
  const scamItems  = items.filter(i =>  i.filtered);

  // ── Counters (based on clean items only) ─────────────────────────────────
  const flaggedCount   = cleanItems.filter(i => i.existingNote?.flaggedForSupport).length;
  const problemCount   = cleanItems.filter(i => i.status !== 'ok' && i.status !== 'untracked').length;
  const untrackedCount = cleanItems.filter(i => i.status === 'untracked').length;
  const balancedCount  = cleanItems.filter(i => i.status === 'ok').length;

  // Balanced tokens reconcile cleanly and need no action, so they're hidden from
  // the table to keep the list focused on discrepancies. The count stays in the
  // header so the "everything reconciled" signal isn't lost. Remaining rows are
  // ordered by tax importance (no cost basis → over → missing → under), then by
  // size of the discrepancy within each group.
  const displayItems   = cleanItems
    .filter(i => i.status !== 'ok')
    .sort((a, b) =>
      (STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]) ||
      (Math.abs(b.deltaPercent ?? 0) - Math.abs(a.deltaPercent ?? 0)) ||
      a.asset.localeCompare(b.asset)
    );

  return (
    <div style={{ fontFamily: 'inherit', color: 'var(--text-primary)' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '0.5rem',
        marginBottom: '1rem',
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Reconciliation
            <button
              onClick={() => setShowInfo(true)}
              aria-label="What is reconciliation?"
              title="What is this?"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '50%',
                border: '1px solid var(--border-bright)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 700,
                cursor: 'pointer', lineHeight: 1, padding: 0,
              }}
            >i</button>
          </h3>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Compares your FIFO "Still in Wallet" lots against live balances from connected wallets and exchanges.
          </p>
        </div>
        {!loading && !error && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {problemCount > 0 && (
              <span style={{ background: 'var(--loss-bg)', border: '1px solid var(--loss-border)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: 'var(--loss)' }}>
                {problemCount} discrepanc{problemCount === 1 ? 'y' : 'ies'}
              </span>
            )}
            {untrackedCount > 0 && (
              <span style={{ background: 'var(--surface-card-2)', border: '1px solid var(--border-bright)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {untrackedCount} no cost basis
              </span>
            )}
            {flaggedCount > 0 && (
              <span style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-dim)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: 'var(--accent)' }}>
                {flaggedCount} flagged for support
              </span>
            )}
            {balancedCount > 0 && displayItems.length > 0 && (
              <span style={{ background: 'var(--gain-bg)', border: '1px solid var(--gain-border)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: 'var(--gain)' }}>
                {balancedCount} balanced · hidden
              </span>
            )}
            {problemCount === 0 && untrackedCount === 0 && flaggedCount === 0 && (
              <span style={{ background: 'var(--gain-bg)', border: '1px solid var(--gain-border)', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: 'var(--gain)' }}>
                ✓ All balanced
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Loading / Error ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Loading reconciliation data…
        </div>
      )}
      {error && (
        <div style={{ background: 'var(--loss-bg)', border: '1px solid var(--loss-border)', borderRadius: 10, padding: '1rem', color: 'var(--loss)', fontSize: '0.875rem' }}>
          Failed to load reconciliation data: {error}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!loading && !error && cleanItems.length === 0 && scamItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          No data yet — upload some CSV files or connect a wallet to get started.
        </div>
      )}

      {!loading && !error && cleanItems.length > 0 && displayItems.length === 0 && scamItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--gain)', fontSize: '0.9rem' }}>
          ✓ All {balancedCount} holding{balancedCount === 1 ? '' : 's'} reconcile — nothing needs attention.
        </div>
      )}

      {!loading && !error && (displayItems.length > 0 || scamItems.length > 0) && (
        <div style={{ overflowX: 'auto' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr 1fr 1fr 1fr 120px 36px',
            gap: '0.5rem',
            padding: '0.4rem 0.75rem',
            fontSize: '0.7rem', fontWeight: 600,
            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div>Asset</div>
            <div style={{ textAlign: 'right' }}>Tin says</div>
            <div style={{ textAlign: 'right' }}>Wallet has</div>
            <div style={{ textAlign: 'right' }}>Δ Coins</div>
            <div style={{ textAlign: 'right' }}>est. Δ USD</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div />
          </div>

          {/* Rows (balanced items are hidden — see displayItems) */}
          {displayItems.map(item => {
            const isExpanded = expanded === item.asset;
            const isFlagged  = item.existingNote?.flaggedForSupport;
            const hasNote    = item.existingNote?.note;
            return (
              <div key={item.asset} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {/* Main row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 1fr 1fr 1fr 120px 36px',
                  gap: '0.5rem',
                  alignItems: 'center',
                  padding: '0.6rem 0.75rem',
                  background: isFlagged ? 'var(--accent-soft)' : 'transparent',
                  transition: 'background 0.15s',
                }}>
                  {/* Asset */}
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    {item.asset}
                    {isFlagged && <span title="Flagged for support" style={{ marginLeft: 4, fontSize: '0.7rem', color: 'var(--loss)' }}>●</span>}
                    {hasNote && !isFlagged && <span title="Has note" style={{ marginLeft: 4, fontSize: '0.7rem', color: 'var(--accent)' }}>●</span>}
                  </div>

                  {/* Tin says */}
                  <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {fmt(item.tinAmount)}
                  </div>

                  {/* Wallet has */}
                  <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {item.liveAmount > 0 ? fmt(item.liveAmount) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </div>

                  {/* Δ Coins */}
                  <div style={{
                    textAlign: 'right', fontSize: '0.85rem', fontWeight: 600,
                    color: item.deltaCoins === 0 ? 'var(--text-muted)' : item.deltaCoins > 0 ? 'var(--gain)' : 'var(--loss)',
                  }}>
                    {item.deltaCoins === 0 ? '—' : (item.deltaCoins > 0 ? '+' : '') + fmt(item.deltaCoins)}
                  </div>

                  {/* est. Δ USD */}
                  <div style={{
                    textAlign: 'right', fontSize: '0.8rem',
                    color: item.deltaUsd == null ? 'var(--text-muted)' : item.deltaUsd === 0 ? 'var(--text-muted)' : item.deltaUsd > 0 ? 'var(--gain)' : 'var(--loss)',
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
                        color: 'var(--text-muted)', fontSize: '0.8rem', padding: 4,
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
                    background: 'var(--border-subtle)',
                    borderTop: '1px solid var(--border-subtle)',
                  }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '1rem', marginBottom: '1rem',
                    }}>
                      {/* Last known transaction */}
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                          Last known transaction
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {fmtDate(item.lastTxDate)}
                        </div>
                      </div>

                      {/* Delta percent */}
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
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
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                          Live balance sources
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {item.sources.map((s, i) => (
                            <span key={i} style={{
                              background: s.kind === 'wallet' ? 'var(--accent-soft)' : 'var(--accent-soft)',
                              border: `1px solid ${s.kind === 'wallet' ? 'var(--accent-dim)' : 'var(--accent-dim)'}`,
                              borderRadius: 8, padding: '0.2rem 0.6rem',
                              fontSize: '0.78rem', color: 'var(--text-secondary)',
                            }}>
                              {s.label}: <strong>{fmt(s.amount)}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Existing note */}
                    {item.existingNote?.note && (
                      <div style={{
                        background: 'var(--accent-soft)', border: '1px solid var(--accent-soft)',
                        borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: '0.75rem',
                        fontSize: '0.85rem', color: 'var(--accent)',
                      }}>
                        {item.existingNote.note}
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {item.status !== 'ok' && (
                        <button
                          onClick={() => openNote(item)}
                          style={{
                            background: 'var(--loss-bg)',
                            border: '1px solid var(--loss-border)',
                            borderRadius: 8, padding: '0.4rem 0.8rem',
                            color: 'var(--loss)', fontSize: '0.8rem', cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          I can't find this
                        </button>
                      )}
                      <button
                        onClick={() => openNote(item)}
                        style={{
                          background: 'var(--border-subtle)',
                          border: '1px solid var(--border-bright)',
                          borderRadius: 8, padding: '0.4rem 0.8rem',
                          color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {item.existingNote?.note ? 'Edit note' : 'Add note'}
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
            background: 'var(--loss-bg)',
            border: '1px solid var(--loss-bg)',
            borderRadius: 10,
            fontSize: '0.85rem', fontWeight: 600, color: 'var(--loss)',
            listStyle: 'none',
          }}>
            <span>Worthless Airdrops</span>
            <span style={{
              background: 'var(--loss-bg)',
              border: '1px solid var(--loss-border)',
              borderRadius: 999, padding: '0.1rem 0.55rem',
              fontSize: '0.72rem', fontWeight: 700,
            }}>{scamItems.length}</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
              click to expand
            </span>
          </summary>
          <div style={{
            border: '1px solid var(--loss-bg)',
            borderTop: 'none',
            borderRadius: '0 0 10px 10px',
            padding: '0.75rem',
            background: 'var(--loss-bg)',
          }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
              These tokens were sent to your wallet unsolicited. Their names contain phishing URLs or "claim" prompts designed to drain your wallet if clicked. They have <strong style={{ color: 'var(--loss)' }}>no real value</strong> and are excluded from your reconciliation totals. Do not interact with them.
            </p>
            {scamItems.map(item => (
              <div key={item.asset} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.4rem 0.5rem',
                borderRadius: 6,
                borderBottom: '1px solid var(--border-subtle)',
                gap: '1rem',
              }}>
                <span style={{
                  fontSize: '0.82rem', color: 'var(--text-muted)',
                  fontFamily: 'monospace', wordBreak: 'break-all',
                  textDecoration: 'line-through',
                }}>
                  {item.asset}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  $0.00
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Info Modal ─────────────────────────────────────────────────────── */}
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

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
