/**
 * The live feed: the ledger of every agent on the account as the Vault writes it. A card for each new row,
 * one at a time, three seconds each (the player is ./feedPlayer.ts), and under it the list of rows, which is
 * the record: every row is in it the moment it arrives, whether its card was shown, folded or skipped.
 *
 * The page opens with the newest rows already in it (the server read them), then asks /api/agentics/feed
 * every few seconds while the tab is showing (./feedPoller.ts). While it is open and showing, and the person
 * has not turned it off, it also asks the Vault, about once a minute, to read one agent's wallets
 * (./feedReader.ts), so a transfer reaches the feed soon after the Vault is allowed to record it. The page
 * does no reading itself; it asks, and the Vault decides.
 *
 * A card that goes away by itself needs a way to stop it: Pause holds the card and the queue. Cards fade in
 * unless the person prefers reduced motion (agentics.css). The list is where a screen reader goes; the stage
 * is not announced. The connection's state and the wallet reads' state are (role="status").
 *
 * Everything that came from the ledger, the chain or the account's own words (an address, an asset's symbol,
 * an agent's name, a label) is rendered as text by React, which escapes it. Nothing here builds HTML from data.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, formatUsd } from '@/lib/agentVault/reportFormat';
import { reasonText, VERIFY_STATUS_TITLE } from '@/lib/agentVault/reportText';
import type { FeedPageData } from '@/lib/agentVault/vaultPages';
import { failureText, send } from './client';
import { copy } from './copy';
import { clearStage, enqueue, initialPlayer, isFlagged, nextDelay, pause, resume, tick, waiting, type Card, type PlayerState } from './feedPlayer';
import { createFeedPoller, type ConnState, type FeedPoller } from './feedPoller';
import { createFeedReader, type FeedReader, type ReaderState, type ReadResult } from './feedReader';
import { addRows, clockOrDate, mergeRows, parseFeedRows, releaseRows, visibleRows, writtenIso, type ListState } from './feedRows';
import { ANSWER_CLASS, LedgerItem } from './LedgerPanel';
import { HOME_PATH } from './paths';
import { describeRefresh, passOf } from './refresh';
import { Status } from './ui';
import { shortenAddress } from '@/lib/addressDisplay';

const PREF_KEY = 'ag-feed-read';

/** Whether this browser has wallet reads switched on (on unless it was turned off). Private windows and blocked storage read as on. */
function readPref(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

function writePref(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* storage is blocked; the choice lasts until the page closes */
  }
}

const DOT: Record<ConnState, string> = { live: 'live', reconnecting: 'wait', slow: 'wait', hidden: 'off', closed: 'bad' };

/** One card on the stage. */
export function StageCard({ card }: { card: Card }) {
  if (card.kind === 'folded') {
    return (
      <div className="ag-feed__card">
        <p className="ag-feed__big">{copy.feed.folded(card.count)}</p>
      </div>
    );
  }
  const row = card.row;
  const tx = row.kind === 'transaction' ? row.tx : null;
  const kind = tx ? (tx.direction === 'in' ? copy.ledger.kind.in : copy.ledger.kind.out) : copy.ledger.kind.checked;
  const answer = row.answer ? VERIFY_STATUS_TITLE[row.answer] : copy.ledger.noAnswer;
  const short = shortenAddress(row.address);
  return (
    <div className={`ag-feed__card${isFlagged(row) ? ' ag-feed__card--flag' : ''}`}>
      <div className="ag-feed__top">
        <span className="ag-pill ag-pill--kind">{kind}</span>
        <span className={row.answer ? ANSWER_CLASS[row.answer] : 'ag-pill ag-pill--muted'}>{row.answer ? copy.ledger.answer(answer) : answer}</span>
        <time className="ag-feed__time" dateTime={writtenIso(row.writtenAt)}>
          {clockOrDate(writtenIso(row.writtenAt), row.at)} UTC
        </time>
      </div>
      <p className="ag-feed__agent">{row.agent}</p>
      {tx ? (
        <>
          <p className="ag-feed__big ag-mono">{copy.ledger.amount(tx.amount, tx.asset)}</p>
          <p className="ag-feed__line">{tx.usd === null ? copy.ledger.noUsd : copy.ledger.usd(formatUsd(tx.usd))}</p>
          <p className="ag-feed__line ag-mono">{row.label ? `${row.label} · ${short}` : short}</p>
          <p className="ag-feed__line">{copy.feed.onTheChain(clockOrDate(row.at, writtenIso(row.writtenAt)))}</p>
        </>
      ) : (
        <>
          <p className="ag-feed__big">{row.label ?? short}</p>
          <p className="ag-feed__line">{reasonText(row.basis ?? 'other')}</p>
          {row.label ? <p className="ag-feed__line ag-mono">{short}</p> : null}
        </>
      )}
    </div>
  );
}

export interface FeedPageProps {
  data: FeedPageData;
}

export default function FeedPage({ data }: FeedPageProps) {
  const initialRows = useMemo(() => mergeRows([], parseFeedRows(data.initial.events)), [data]);
  const [list, setList] = useState<ListState>({ rows: initialRows, held: [] });
  const [player, setPlayer] = useState<PlayerState>(initialPlayer);
  const [filter, setFilter] = useState('');
  const [conn, setConn] = useState<ConnState>('live');
  const [lastGood, setLastGood] = useState<string | null>(null);
  const [readOn, setReadOn] = useState(true);
  const [readState, setReadState] = useState<ReaderState>('waiting');
  const [readLine, setReadLine] = useState<string | null>(null);
  const [manual, setManual] = useState<{ busy: boolean; lines: string[] | null; error: string | null }>({ busy: false, lines: null, error: null });

  const filterRef = useRef('');
  const pausedRef = useRef(false);
  const readOnRef = useRef(true);
  const poller = useRef<FeedPoller | null>(null);
  const reader = useRef<FeedReader | null>(null);
  const agentName = useRef(new Map(data.agents.map((a) => [a.id, a.label] as const)));

  // The browser's own choice about wallet reads, read once the page is in the browser (not while it is rendered on the server).
  useEffect(() => {
    const on = readPref();
    readOnRef.current = on;
    setReadOn(on);
  }, []);

  // The poll and the wallet reads, for as long as the page is open.
  useEffect(() => {
    const visible = () => document.visibilityState !== 'hidden';
    const timers = { setTimer: (fn: () => void, ms: number) => window.setTimeout(fn, ms), clearTimer: (h: unknown) => window.clearTimeout(h as number) };
    const feed = createFeedPoller(
      {
        send,
        ...timers,
        visible,
        // The poll settles what it has seen by elapsed time, so its clock must only ever move forward: a wall clock that is set (or
        // corrected) jumps, and a jump forward would count a row as settled before it is.
        now: () => performance.now(),
        onRows: (fresh) => {
          // While paused the list holds still too; the rows wait and the page says how many.
          setList((s) => addRows(s, fresh, pausedRef.current));
          const shown = fresh.filter((r) => !filterRef.current || r.tinId === filterRef.current);
          if (shown.length) setPlayer((p) => enqueue(p, shown, Date.now()));
        },
        onState: (state, at) => {
          setConn(state);
          if (at) setLastGood(at);
        },
      },
      { since: data.initial.since, seen: initialRows },
    );
    const wallets = createFeedReader({
      send,
      ...timers,
      visible,
      enabled: () => readOnRef.current,
      tinId: () => filterRef.current || null,
      onResult: (r: ReadResult) => {
        if (r.status !== 'read') return;
        const who = (r.tinId && agentName.current.get(r.tinId)) || copy.feed.reader.anAgent;
        setReadLine(`${copy.feed.reader.readOf(who, formatClock(new Date().toISOString()))} ${r.lines.join(' ')}`.trim());
        if (r.recorded > 0) feed.pollNow();
      },
      onState: setReadState,
    });
    poller.current = feed;
    reader.current = wallets;
    const shown = () => {
      feed.visibilityChanged();
      wallets.changed();
    };
    document.addEventListener('visibilitychange', shown);
    feed.start();
    wallets.start();
    return () => {
      document.removeEventListener('visibilitychange', shown);
      feed.stop();
      wallets.stop();
      poller.current = null;
      reader.current = null;
    };
  }, [data, initialRows]);

  // The list holds still while the cards are paused, however they came to be paused or not; rows that waited join it when they are not.
  useEffect(() => {
    pausedRef.current = player.paused;
    if (!player.paused) setList(releaseRows);
  }, [player.paused]);

  // The card on the stage gives way to the next after three seconds.
  useEffect(() => {
    const delay = nextDelay(player, Date.now());
    if (delay === null) return;
    const handle = window.setTimeout(() => setPlayer((p) => ({ ...tick(p, Date.now()) })), delay);
    return () => window.clearTimeout(handle);
  }, [player]);

  // Choosing an agent: the stage starts over for it, wallet reads follow it, and its own latest rows are fetched when few are at hand.
  function chooseAgent(id: string) {
    filterRef.current = id;
    setFilter(id);
    // A pause stays as the person left it: the list holds still with the cards, whichever agent is chosen.
    setPlayer(clearStage);
    setManual({ busy: false, lines: null, error: null });
    reader.current?.changed();
    if (id && list.rows.filter((r) => r.tinId === id).length < 10) {
      void send('GET', `/api/agentics/feed?tinId=${encodeURIComponent(id)}&limit=30`).then((r) => {
        if (r.ok) setList((s) => ({ ...s, rows: mergeRows(s.rows, parseFeedRows(r.body?.events)) }));
      });
    }
  }

  function togglePause() {
    const now = Date.now();
    // The pause lives in the player; the list's hold follows it (the effect above), and is set here as well so a row that arrives this instant is held or not at once.
    pausedRef.current = !player.paused;
    setPlayer((p) => (p.paused ? resume(p, now) : pause(p, now)));
  }

  function switchReads(on: boolean) {
    readOnRef.current = on;
    setReadOn(on);
    writePref(on);
    reader.current?.changed();
  }

  async function readNow() {
    if (!filter || manual.busy) return;
    setManual({ busy: true, lines: null, error: null });
    const r = await send('POST', '/api/agentics/refresh', { tinId: filter });
    const pass = r.ok ? passOf(r.body) : null;
    if (!pass) {
      setManual({ busy: false, lines: null, error: r.ok ? copy.errors.generic : failureText(r) });
      return;
    }
    setManual({ busy: false, lines: describeRefresh(pass), error: null });
    poller.current?.pollNow();
  }

  if (data.agents.length === 0) {
    return (
      <div className="ag-page">
        <header className="ag-hero">
          <p className="ag-kicker">{copy.feed.kicker}</p>
          <h1 className="ag-title">{copy.feed.title}</h1>
          <p className="ag-sub">{copy.feed.lede}</p>
        </header>
        <p className="ag-notice">
          {copy.feed.noAgents}{' '}
          <a className="ag-link" href={HOME_PATH}>
            {copy.nav.agents}
          </a>
        </p>
      </div>
    );
  }

  const shown = visibleRows(list.rows, filter);
  const current = player.current?.card ?? null;
  const queued = waiting(player);
  const stateText: Partial<Record<ReaderState, string>> = {
    reading: copy.feed.reader.reading,
    nothing: copy.feed.reader.nothing,
    limit: copy.feed.reader.limit,
    failing: copy.feed.reader.failing,
    closed: copy.feed.reader.closed,
  };
  const readText = !readOn ? copy.feed.reader.off : (stateText[readState] ?? `${readLine ? `${readLine} ` : ''}${copy.feed.reader.waiting}`);

  return (
    <div className="ag-page">
      <header className="ag-hero">
        <p className="ag-kicker">{copy.feed.kicker}</p>
        <h1 className="ag-title">{copy.feed.title}</h1>
        <p className="ag-sub">{copy.feed.lede}</p>
      </header>

      <section className="ag-card" aria-labelledby="ag-feed-h">
        <h2 className="ag-card__title--plain ag-sr" id="ag-feed-h">
          {copy.feed.title}
        </h2>
        <p className="ag-feed__state">
          <span className={`ag-feed__dot ag-feed__dot--${DOT[conn]}`} aria-hidden="true" />
          {/* Only the state is announced. The time of the last update changes every few seconds and is not. */}
          <span role="status">{copy.feed.state[conn]}</span>
          {lastGood ? <span>{` · ${copy.feed.lastUpdate(formatClock(lastGood))}`}</span> : null}
        </p>

        <div className="ag-feed__stage" aria-live="off">
          {current ? (
            <StageCard key={current.kind === 'row' ? current.row.id : `folded-${player.current?.shownAt}`} card={current} />
          ) : (
            <p className="ag-feed__idle">{player.paused ? copy.feed.paused : copy.feed.idle}</p>
          )}
        </div>
        <p className="ag-feed__queue">
          {queued > 0 ? copy.feed.waitingMore(queued) : ''}
          {queued > 0 && player.skipped > 0 ? ' · ' : ''}
          {player.skipped > 0 ? copy.feed.skipped(player.skipped) : ''}
        </p>

        <div className="ag-form">
          <label className="ag-field">
            {copy.feed.agentLabel}
            <select className="ag-select" value={filter} onChange={(e) => chooseAgent(e.target.value)}>
              <option value="">{copy.feed.allAgents}</option>
              {data.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {/* The label says what pressing it does; it is not also a pressed/unpressed toggle (a screen reader would say both). */}
          <button className="ag-btn" type="button" onClick={togglePause}>
            {player.paused ? copy.feed.resume : copy.feed.pause}
          </button>
          {filter ? (
            <button className="ag-btn" type="button" aria-disabled={manual.busy || undefined} onClick={() => void readNow()}>
              {manual.busy ? copy.ledger.reading : copy.ledger.readButton}
            </button>
          ) : null}
        </div>
        {manual.lines ? (
          <ul className="ag-summary__list" role="status">
            {manual.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <Status kind="bad">{manual.error}</Status>

        <label className="ag-check">
          <input type="checkbox" checked={readOn} onChange={(e) => switchReads(e.target.checked)} />
          <span>{copy.feed.readSwitch}</span>
        </label>
        {/* A wallet read happens about once a minute; only a failure is worth interrupting a screen reader for. */}
        <p className="ag-hint" role={readState === 'failing' || readState === 'closed' ? 'status' : undefined}>
          {readText}
        </p>
        <p className="ag-hint">{copy.feed.readHint}</p>
        <p className="ag-note">{copy.feed.timing}</p>
      </section>

      <section className="ag-card" aria-labelledby="ag-feed-list-h">
        <div className="ag-card__head">
          <h2 className="ag-card__title" id="ag-feed-list-h">
            {copy.feed.listTitle}
          </h2>
        </div>
        {list.held.length > 0 ? <p className="ag-hint">{copy.feed.held(list.held.length)}</p> : null}
        {shown.length === 0 ? (
          <p className="ag-empty">{copy.feed.empty}</p>
        ) : (
          <ol className="ag-events" aria-label={copy.feed.listLabel}>
            {shown.map((row) => (
              <LedgerItem key={row.id} row={row} agent={row.agent} label={row.label} recorded={row.writtenAt} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
