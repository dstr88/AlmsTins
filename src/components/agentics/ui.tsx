/**
 * The small pieces the Agent Vault's screens share: the Pass / Fail / Limited pill, the readout of
 * the checks behind it, a button that copies an address, and the line that tells the truth about
 * something that is happening or went wrong.
 *
 * Everything that came from the registry, the ledger or the chain (an address, a label, an asset's
 * symbol) is rendered as text by React, which escapes it. Nothing here builds HTML from data.
 * A status is always a word: color adds to it and never replaces it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Destination } from '@/lib/agentVault/store';
import { formatUtc } from '@/lib/agentVault/reportFormat';
import { copy } from './copy';

// ── Status lines ─────────────────────────────────────────────────────────────

/**
 * A message about something that just happened. An error is announced at once (role alert), progress
 * and success politely (role status). The element is always in the page, so a screen reader hears a
 * change to it; with no text it is empty and says nothing.
 */
export function Status({ kind, children }: { kind: 'ok' | 'bad' | 'working'; children?: ReactNode }) {
  const cls = kind === 'ok' ? 'ag-status ag-status--ok' : kind === 'bad' ? 'ag-status ag-status--bad' : 'ag-status';
  return (
    <p className={cls} role={kind === 'bad' ? 'alert' : 'status'} aria-live={kind === 'bad' ? 'assertive' : 'polite'}>
      {children}
    </p>
  );
}

// ── The pill ─────────────────────────────────────────────────────────────────

export type PillKind = 'pass' | 'fail' | 'limited' | 'unchecked';

/**
 * Where an address stands, as the word on its pill. Flagged is Fail and trusted is Pass, whatever
 * else is stored. A pending address is Limited when a check could not run, and Not checked when the
 * checks have never run for it.
 */
export function pillOf(d: Pick<Destination, 'trustStatus' | 'trust'>): PillKind {
  if (d.trustStatus === 'flagged') return 'fail';
  if (d.trustStatus === 'trusted') return 'pass';
  return d.trust === null ? 'unchecked' : 'limited';
}

const PILL_CLASS: Record<PillKind, string> = {
  pass: 'ag-pill ag-pill--gain',
  fail: 'ag-pill ag-pill--bad',
  limited: 'ag-pill ag-pill--warn',
  unchecked: 'ag-pill ag-pill--muted',
};

/** A mark beside the word, for people who cannot tell the colors apart. Hidden from a screen reader, which has the word. */
const PILL_MARK: Record<PillKind, string> = { pass: '✓', fail: '✕', limited: '◐', unchecked: '–' };

export function TrustPill({ kind }: { kind: PillKind }) {
  return (
    <span className={PILL_CLASS[kind]}>
      <span aria-hidden="true">{PILL_MARK[kind]} </span>
      {copy.registry.pills[kind]}
    </span>
  );
}

// ── The readout behind the pill ──────────────────────────────────────────────

/** Each check that ran for an address and what it said, as a list: the sanctions lists, the security screening and the Verify registry. */
export function Readout({ id, d }: { id: string; d: Pick<Destination, 'trust'> }) {
  const t = d.trust;
  if (!t) {
    return (
      <div className="ag-readout" id={id}>
        <p className="ag-hint">{copy.readout.never}</p>
      </div>
    );
  }
  const verify =
    t.verify === 'proven'
      ? copy.readout.verify.proven(t.provenBy)
      : t.verify === 'claimed'
        ? copy.readout.verify.claimed
        : t.verify === 'unknown'
          ? copy.readout.verify.unknown
          : copy.readout.verify.unavailable;
  return (
    <div className="ag-readout" id={id}>
      <dl className="ag-dl ag-dl--tight">
        <dt>{copy.readout.rows.sanctions}</dt>
        <dd>{copy.readout.state[t.sanctions] ?? copy.readout.state.unavailable}</dd>
        <dt>{copy.readout.rows.screening}</dt>
        <dd>{copy.readout.state[t.screening] ?? copy.readout.state.unavailable}</dd>
        <dt>{copy.readout.rows.verify}</dt>
        <dd>{verify}</dd>
      </dl>
      {t.hits.length > 0 ? (
        <ul className="ag-hits">
          {t.hits.map((h) => (
            <li key={h}>{copy.readout.hits[h] ?? copy.readout.state.hit}</li>
          ))}
        </ul>
      ) : null}
      {typeof t.communityReports === 'number' && t.communityReports > 0 ? <p className="ag-hint">{copy.readout.community(t.communityReports)}</p> : null}
      <p className="ag-hint">{copy.readout.checkedAt(formatUtc(t.checkedAt))}</p>
    </div>
  );
}

// ── Copy an address ──────────────────────────────────────────────────────────

/**
 * Puts text on the clipboard with the page's clipboard API, and says whether it worked. Where the API
 * is missing (a page that is not served securely) or the browser refuses, it says no, and the button
 * says "Copy failed": the address is on the page in full, to select by hand.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/** A button that copies an address and says it did. The address in the label is cut short: a screen reader does not need all 42 characters. */
export function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const short = value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
  return (
    <button
      type="button"
      className="ag-btn ag-btn--small"
      aria-label={copy.registry.copyLabel(short)}
      onClick={async () => {
        setState((await copyText(value)) ? 'copied' : 'failed');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
    >
      {state === 'copied' ? copy.registry.copied : state === 'failed' ? copy.registry.copyFailed : copy.registry.copy}
    </button>
  );
}
