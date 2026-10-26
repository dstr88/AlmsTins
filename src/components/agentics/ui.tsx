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
import { CopyButton as SharedCopyButton } from '@/components/ui/CopyButton';
import { shortenAddress } from '@/lib/addressDisplay';
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
 * A button that copies an address and says it did: the shared <CopyButton> (src/components/ui), in
 * the Agent Vault's words and classes. The button's name stays the same ("Copy address
 * 0x1234ab…89abcd"), so the result is also said in a live region next to it ("Copied", "Copy
 * failed"), which is announced without moving focus.
 */
export function VaultCopyButton({ value }: { value: string }) {
  return (
    <SharedCopyButton
      value={value}
      lang="en"
      className="ag-btn ag-btn--small"
      srClassName="ag-sr"
      label={copy.registry.copyLabel(shortenAddress(value))}
      words={{ idle: copy.registry.copy, copied: copy.registry.copied, failed: copy.registry.copyFailed }}
    />
  );
}

// ── Where focus goes when a row is removed ───────────────────────────────────

/**
 * After the row a person was on has been removed: whether focus should move to the card's heading.
 * It should when focus was on that row (the control the person pressed is gone with it) or is nowhere
 * (the page body); it must not when the person has moved on to something else, such as the paste box
 * they are typing in, because a request that finishes late would take their place away.
 */
export function shouldTakeFocus(active: unknown, row: { contains(node: never): boolean } | null, body: unknown): boolean {
  return active == null || active === body || (row !== null && row.contains(active as never));
}

// ── Remove, with one more question in place ──────────────────────────────────

export interface ConfirmRemoveProps {
  /** The button that begins it ("Remove"). */
  label: string;
  /** What is asked, and the words of the two answers and of the yes while it works. */
  question: string;
  yes: string;
  yesWorking: string;
  keep: string;
  /** The yes is being carried out (its request is running). */
  working: boolean;
  /** The button that begins it is not offered for now (another action on this page is running). It stays where it is (aria-disabled), so focus is not lost. */
  disabled?: boolean;
  /** A smaller button, for a row in a list. */
  small?: boolean;
  /** Called on the yes. */
  onConfirm: () => void;
}

/**
 * A remove button that asks once more where it stands: it is replaced by the question and its two
 * answers. Because the button the person pressed leaves the page, focus would fall to the top of the
 * page for a keyboard or screen-reader user, so it is handled here: asking puts focus on "Keep it"
 * (the answer that does nothing), and "Keep it" puts focus back on "Remove". After a yes that worked
 * the thing is gone and the page that removed it decides where focus goes.
 */
export function ConfirmRemove({ label, question, yes, yesWorking, keep, working, disabled, small, onConfirm }: ConfirmRemoveProps) {
  const [asking, setAsking] = useState(false);
  const removeRef = useRef<HTMLButtonElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  /** What the next render should do with focus: none, put it on "Keep it", or put it back on "Remove". */
  const focusNext = useRef<'none' | 'keep' | 'remove'>('none');
  useEffect(() => {
    if (focusNext.current === 'keep') keepRef.current?.focus();
    else if (focusNext.current === 'remove') removeRef.current?.focus();
    focusNext.current = 'none';
  }, [asking]);
  const size = small ? ' ag-btn--small' : '';
  if (asking) {
    const Wrapper = small ? 'span' : 'div';
    return (
      <Wrapper className="ag-confirm" role="group" aria-label={question}>
        <span className="ag-confirm__text">{question}</span>
        {/* aria-disabled, not disabled, while it works: a disabled button drops the focus it holds. */}
        <button className={`ag-btn${size} ag-btn--danger`} type="button" aria-disabled={working || undefined} onClick={() => { if (!working) onConfirm(); }}>
          {working ? yesWorking : yes}
        </button>
        <button
          ref={keepRef}
          className={`ag-btn${size}`}
          type="button"
          aria-disabled={working || undefined}
          onClick={() => {
            if (working) return;
            focusNext.current = 'remove';
            setAsking(false);
          }}
        >
          {keep}
        </button>
      </Wrapper>
    );
  }
  return (
    <button
      ref={removeRef}
      className={`ag-btn${size}${small ? '' : ' ag-btn--danger'}`}
      type="button"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        focusNext.current = 'keep';
        setAsking(true);
      }}
    >
      {label}
    </button>
  );
}
