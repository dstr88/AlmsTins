/**
 * The registry of one agent: the addresses it may pay. Each row is an address with a Pass, Fail or
 * Limited pill (always a word), the readout of the checks behind it, and what can be done with it:
 * trust it (run the checks), remove it. A paste box adds more, any number at a time: a long paste
 * is sent ten lines to a request, one request after another, with the progress in view and a plain
 * summary at the end that accounts for every line.
 *
 * A flagged address stays flagged. There is no way to trust it anyway; to check it again it is
 * removed and added back, and the page says so.
 *
 * Everything that came from the registry (an address, a label) is rendered as text by React, which
 * escapes it. Nothing here builds HTML from data.
 */
import { useRef, useState } from 'react';
import type { PlanSummary } from '@/lib/agentVault/entitlements';
import type { Destination } from '@/lib/agentVault/store';
import { failureText, send } from './client';
import { copy } from './copy';
import { describePaste, PASTE_MAX_LINES, planPaste, runPaste, type PasteOutcome } from './paste';
import { ConfirmRemove, CopyButton, pillOf, Readout, shouldTakeFocus, Status, TrustPill } from './ui';

/** What the registry says for the codes it knows better than the general words do: a wait is about checks here. */
const REGISTRY_ERRORS: Readonly<Record<string, string>> = { rate_limited: copy.registry.rateLimited };

/** The destinations in an answer that look like destinations (an id and an address), and nothing else. */
export function asDestinations(list: unknown): Destination[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is Destination => !!x && typeof x === 'object' && typeof (x as Destination).id === 'string' && typeof (x as Destination).address === 'string');
}

const chainName = (chain: string): string => (Object.prototype.hasOwnProperty.call(copy.registry.chains, chain) ? copy.registry.chains[chain] : chain);

interface RowMessage {
  kind: 'ok' | 'bad';
  text: string;
}

function PasteSummary({ outcome }: { outcome: PasteOutcome }) {
  return (
    <div className="ag-summary" role="region" aria-labelledby="ag-summary-h">
      <h3 className="ag-summary__title" id="ag-summary-h">
        {copy.registry.summaryTitle}
      </h3>
      <ul className="ag-summary__list">
        {describePaste(outcome).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {outcome.lines.length > 0 ? (
        <details className="ag-details">
          <summary>{copy.registry.issues(outcome.lines.length)}</summary>
          <ul className="ag-issues">
            {outcome.lines.map((l) => (
              <li key={`${l.line}:${l.reason}:${l.text}`}>
                <span className="ag-issues__line">{l.line}</span>
                <span className="ag-mono">{l.text}</span>
                <span>{Object.prototype.hasOwnProperty.call(copy.registry.lineReasons, l.reason) ? copy.registry.lineReasons[l.reason] : copy.errors.generic}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export interface RegistryPanelProps {
  tinId: string;
  destinations: Destination[];
  plan: PlanSummary;
  /** Called after the registry changed, so the page can read the plan again and update its meter. */
  onChanged?: () => void | Promise<void>;
}

export default function RegistryPanel({ tinId, destinations, plan, onChanged }: RegistryPanelProps) {
  const [list, setList] = useState<Destination[]>(destinations);
  const [text, setText] = useState('');
  const [chain, setChain] = useState('ethereum');
  const [busy, setBusy] = useState<null | 'paste' | 'pending'>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PasteOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // Each row has its own busy flag and its own message: one row finishing never clears another's.
  const [rowBusy, setRowBusy] = useState<ReadonlySet<string>>(new Set());
  const [rowMessages, setRowMessages] = useState<Readonly<Record<string, RowMessage>>>({});
  /** The heading of the card, where focus goes when the row the person was on has been removed. */
  const heading = useRef<HTMLHeadingElement | null>(null);

  const markBusy = (id: string, on: boolean) =>
    setRowBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const say = (id: string, message: RowMessage | null) =>
    setRowMessages((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });

  const limit = plan.limits.addresses;
  const full = limit !== null && plan.use.addresses >= limit;
  const pending = list.filter((d) => d.trustStatus === 'pending').length;

  async function reload() {
    const r = await send('GET', `/api/agentics/destinations?tinId=${encodeURIComponent(tinId)}`);
    if (r.ok) setList(asDestinations(r.body?.destinations));
    await onChanged?.();
  }

  const merge = (updated: Destination[]) => {
    if (updated.length) setList((prev) => prev.map((d) => updated.find((u) => u.id === d.id) ?? d));
  };

  async function submitPaste() {
    setError(null);
    setNote(null);
    setOutcome(null);
    const planned = planPaste(text);
    if (planned.lines === 0) {
      setError(copy.registry.nothing);
      return;
    }
    if (planned.tooLong) {
      setError(copy.registry.tooLong(PASTE_MAX_LINES));
      return;
    }
    setBusy('paste');
    const result = await runPaste(planned, {
      tinId,
      chain,
      call: send,
      errors: REGISTRY_ERRORS,
      onProgress: (p) => setProgress(p.done >= p.total ? null : copy.registry.progress(p.done + 1, p.total, p.fromLine, p.toLine)),
    });
    setProgress(null);
    setOutcome(result);
    // What was not tried stays in the box, so the paste can be run again; everything else has an answer.
    if (result.notTried === 0) setText('');
    await reload();
    setBusy(null);
  }

  async function trustOne(d: Destination) {
    markBusy(d.id, true);
    say(d.id, null);
    const r = await send('POST', '/api/agentics/destinations/trust', { tinId, ids: [d.id] });
    if (!r.ok) {
      say(d.id, { kind: 'bad', text: failureText(r, REGISTRY_ERRORS) });
      markBusy(d.id, false);
      return;
    }
    const updated = asDestinations(r.body?.destinations);
    merge(updated);
    const still = Array.isArray(r.body?.stillFlagged) && (r.body?.stillFlagged as unknown[]).includes(d.id);
    const now = updated.find((u) => u.id === d.id);
    if (still) say(d.id, { kind: 'bad', text: copy.registry.stillFlagged });
    else if (!now || now.trustStatus === 'pending') say(d.id, { kind: 'bad', text: copy.registry.couldNotRun });
    else say(d.id, { kind: 'ok', text: copy.registry.checkedNow });
    markBusy(d.id, false);
  }

  async function trustPending() {
    setBusy('pending');
    setPendingNote(null);
    setNote(null);
    for (let i = 0; i < 20; i += 1) {
      const r = await send('POST', '/api/agentics/destinations/trust', { tinId });
      if (!r.ok) {
        setPendingNote(failureText(r, REGISTRY_ERRORS));
        break;
      }
      const updated = asDestinations(r.body?.destinations);
      merge(updated);
      const remaining = typeof r.body?.remaining === 'number' ? r.body.remaining : 0;
      // Stop when none is left, or when this round moved nothing (the checks could not run): another would only repeat it.
      const moved = updated.some((u) => u.trustStatus !== 'pending');
      if (updated.length > 0 && !moved) setPendingNote(copy.registry.couldNotRun);
      if (remaining === 0 || !moved) break;
    }
    await reload();
    setBusy(null);
  }

  async function removeOne(d: Destination) {
    markBusy(d.id, true);
    say(d.id, null);
    const r = await send('DELETE', `/api/agentics/destinations?id=${encodeURIComponent(d.id)}`);
    if (!r.ok) {
      say(d.id, { kind: 'bad', text: failureText(r) });
      markBusy(d.id, false);
      return;
    }
    // Asked while the row is still on the page: focus moves to the card's heading only if it was on
    // this row (its button is about to be gone) or nowhere, never away from something the person
    // moved on to while the request ran.
    const takeFocus = shouldTakeFocus(document.activeElement, document.getElementById(`ag-dest-${d.id}`), document.body);
    setList((prev) => prev.filter((x) => x.id !== d.id));
    say(d.id, null);
    setNote(copy.registry.removed);
    markBusy(d.id, false);
    if (takeFocus) heading.current?.focus();
    await onChanged?.();
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <section className="ag-card" aria-labelledby="ag-registry-h">
      <div className="ag-card__head">
        <h2 className="ag-card__title" id="ag-registry-h" ref={heading} tabIndex={-1}>
          {copy.registry.title}
        </h2>
        <span className="ag-card__meta">{limit === null ? copy.registry.count(list.length) : copy.registry.countOf(plan.use.addresses, limit)}</span>
      </div>
      <p className="ag-hint">{copy.registry.lede}</p>

      <form
        className="ag-paste"
        onSubmit={(e) => {
          e.preventDefault();
          // The button is aria-disabled while a paste runs (it keeps focus), and a press on it still submits.
          if (busy !== null || full || !text.trim()) return;
          void submitPaste();
        }}
      >
        <label className="ag-field" htmlFor="ag-paste-text">
          {copy.registry.pasteLabel}
        </label>
        <textarea
          id="ag-paste-text"
          className="ag-textarea"
          rows={5}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-describedby="ag-paste-help"
          disabled={busy !== null || full}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="ag-hint" id="ag-paste-help">
          {copy.registry.pasteHelp}
        </p>
        <div className="ag-form">
          <label className="ag-field">
            {copy.registry.chainLabel}
            <select className="ag-select" value={chain} onChange={(e) => setChain(e.target.value)} disabled={busy !== null || full}>
              {Object.keys(copy.registry.chains).map((c) => (
                <option key={c} value={c}>
                  {chainName(c)}
                </option>
              ))}
            </select>
          </label>
          <button className="ag-btn ag-btn--primary" type="submit" aria-disabled={busy !== null || full || !text.trim() || undefined}>
            {busy === 'paste' ? copy.registry.adding : copy.registry.add}
          </button>
        </div>
        {full ? <p className="ag-notice ag-notice--warn">{copy.plan.full.addresses}</p> : null}
        <Status kind={error ? 'bad' : 'working'}>{error ?? progress}</Status>
      </form>

      {/* Said aloud when a paste ends (the card below it is for the eyes): present before the text, so it is announced. */}
      <p className="ag-sr" role="status" aria-live="polite" aria-atomic="true">
        {outcome ? describePaste(outcome).join('. ') : ''}
      </p>
      {outcome ? <PasteSummary outcome={outcome} /> : null}

      {pending > 0 ? (
        <div className="ag-form">
          <button className="ag-btn" type="button" aria-disabled={busy !== null || undefined} onClick={() => { if (busy === null) void trustPending(); }}>
            {busy === 'pending' ? copy.registry.checkingPending : copy.registry.checkPending}
          </button>
        </div>
      ) : null}
      <Status kind="bad">{pendingNote}</Status>
      <Status kind="ok">{note}</Status>

      <p className="ag-hint">{copy.registry.pillLegend}</p>
      <p className="ag-hint">{copy.registry.flaggedNote}</p>

      {list.length === 0 ? (
        <p className="ag-empty">{copy.registry.empty}</p>
      ) : (
        <ul className="ag-dests" aria-label={copy.registry.listLabel}>
          {list.map((d) => {
            const shown = open.has(d.id);
            const mine = rowMessages[d.id] ?? null;
            const working = rowBusy.has(d.id);
            return (
              <li className="ag-dest" key={d.id} id={`ag-dest-${d.id}`}>
                <div className="ag-dest__main">
                  <TrustPill kind={pillOf(d)} />
                  <span className="ag-addr ag-mono">{d.address}</span>
                  <CopyButton value={d.address} />
                </div>
                <p className="ag-dest__meta">
                  {chainName(d.chain)}
                  {'  ·  '}
                  {d.label ?? copy.registry.noLabel}
                </p>
                <div className="ag-dest__actions">
                  {d.trustStatus === 'flagged' ? null : (
                    <button
                      className="ag-btn ag-btn--small"
                      type="button"
                      aria-disabled={working || busy !== null || undefined}
                      onClick={() => {
                        if (!working && busy === null) void trustOne(d);
                      }}
                    >
                      {working ? copy.registry.checking : d.trustStatus === 'trusted' ? copy.registry.recheck : copy.registry.trust}
                    </button>
                  )}
                  <button
                    className="ag-btn ag-btn--small"
                    type="button"
                    aria-expanded={shown}
                    aria-controls={`ag-readout-${d.id}`}
                    onClick={() => toggle(d.id)}
                  >
                    {shown ? copy.readout.hide : copy.readout.show}
                  </button>
                  <ConfirmRemove
                    small
                    label={copy.registry.remove}
                    question={copy.registry.removeConfirm}
                    yes={copy.registry.removeYes}
                    yesWorking={copy.registry.removing}
                    keep={copy.registry.removeKeep}
                    working={working}
                    disabled={working || busy !== null}
                    onConfirm={() => void removeOne(d)}
                  />
                </div>
                {mine ? <Status kind={mine.kind}>{mine.text}</Status> : null}
                {shown ? <Readout id={`ag-readout-${d.id}`} d={d} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
