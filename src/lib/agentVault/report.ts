/**
 * The operator report: what one tin's ledger says about one stretch of time (a UTC day by
 * default), sorted into the four buckets the operator asked for, plus the bought and sold strip.
 * Pure (no database, no clock, no network), so every rule below is a unit test.
 *
 * THE FOUR BUCKETS come from the answer of each `checked` event (./checkLog.ts deriveAnswer):
 *
 *   had issues     answer `flagged`: the registry flagged the address, or its proof is on a
 *                  different domain than the agent expected.
 *   not confirmed  answer `unknown` and NOT cleared: the address is not in the registry
 *                  (basis not_in_registry) or is in it but its checks have not finished
 *                  (registry_pending). An address swap shows up here, because a swapped address
 *                  is not on the owner's list. Any `unknown` whose basis is not recognized is
 *                  also here: when in doubt the report asks for a look, it never files quietly.
 *   new            the first check of a registered, trusted address (basis registered_first_check):
 *                  `unknown`, but cleared on the owner's own say-so, with its history baseline
 *                  started. Informational; it does not call for action.
 *   no issues      `proven` or `consistent-with-history`. Shown as a count only, never listed.
 *
 * ONE PLACE PER ADDRESS. An address is listed once per period, in its most severe bucket
 * (had issues > not confirmed > new). An address whose every check was clear is counted under no
 * issues. So the buckets split the addresses asked about: each address is in exactly one of them.
 * Counts of checks are kept separately: each bucket also says how many checks fell in it, by the
 * check's own answer, whichever bucket its address was placed in (an address flagged once and
 * proven nine times is listed under had issues, and its nine clear checks still count as clear).
 *
 * THE STRIP is raw value in and out from the `transaction` events of the period: in is bought,
 * out is sold, in USD at the time of each transfer. A transfer with no USD value on record is
 * counted on its own and never added in as zero. Nothing here sets what was bought against what was
 * sold, and no figure is derived from the two: it is raw value in and raw value out, and no more.
 *
 * Whatever order the events come in, the report is the same (every tie is broken by time, then id),
 * so rebuilding it from the same ledger gives the same content, byte for byte.
 */
import type { AnswerBasis } from './checkLog';
import type { LedgerEvent, RegistryVerdict, VaultAnswer } from './events';
import { addTransfer, emptySums, toSideTotal, type SideTotal } from './money';

export const REPORT_SCHEMA = 1;

/** The most addresses a report lists under one bucket; the rest are counted and said to be left out. */
export const MAX_LISTED_PER_BUCKET = 200;

export const REPORT_BUCKETS = ['issues', 'not_confirmed', 'new', 'no_issues'] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];
/** The buckets whose addresses are listed (no issues is a count only). */
export const LISTED_BUCKETS = ['issues', 'not_confirmed', 'new'] as const;
export type ListedBucketName = (typeof LISTED_BUCKETS)[number];

/** Most severe first. An address goes to the highest of the buckets any of its checks fell in. */
const SEVERITY: Record<ReportBucket, number> = { issues: 3, not_confirmed: 2, new: 1, no_issues: 0 };

/** The reasons a check can carry (checkLog.ts AnswerBasis). Anything else is shown as `other`, never as the text it carries. */
export const ANSWER_BASES = [
  'registry_flagged',
  'domain_mismatch',
  'not_in_registry',
  'registry_pending',
  'domain_proof',
  'registered_and_checked_before',
  'registered_first_check',
] as const satisfies readonly AnswerBasis[];
// Compile-time: a basis added to checkLog.ts without a line here fails the build, so no check can
// reach the report with a reason this file has not decided how to bucket.
const _everyBasisIsListed: Exclude<AnswerBasis, (typeof ANSWER_BASES)[number]> extends never ? true : never = true;
void _everyBasisIsListed;

const BASES: ReadonlySet<string> = new Set(ANSWER_BASES);

/**
 * Whether a check's detail carries the daily-limit marker: the check that found the agent's limit on recorded
 * checks used up is written with `limit.reached` in its detail (./checkLog.ts), so the ledger, the report and the
 * export show the moment a day was cut. Pure, so the browser can use it too.
 */
export function hasLimitMarker(detail: Record<string, unknown> | null | undefined): boolean {
  const limit = detail?.limit;
  return !!limit && typeof limit === 'object' && (limit as { reached?: unknown }).reached === true;
}

/** The basis of a check's answer, or `other` when it is missing or not one this file knows. */
export function basisOf(detail: Record<string, unknown> | null): string {
  const raw = detail?.basis;
  return typeof raw === 'string' && BASES.has(raw) ? raw : 'other';
}

/**
 * Which bucket one `checked` event falls in, by its own answer. Pure; every row of the table in the
 * header is a test. A check with no readable answer cannot be confirmed, so it is `not_confirmed`.
 */
export function classifyCheck(event: { answer: VaultAnswer | null; detail: Record<string, unknown> | null }): ReportBucket {
  switch (event.answer) {
    case 'flagged':
      return 'issues';
    case 'proven':
    case 'consistent-with-history':
      return 'no_issues';
    case 'unknown':
      return basisOf(event.detail) === 'registered_first_check' ? 'new' : 'not_confirmed';
    default:
      return 'not_confirmed';
  }
}

// ── Days ─────────────────────────────────────────────────────────────────────

export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` when `raw` is a real calendar date in that form (2026-02-30 is not), else null. */
export function parseDay(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === raw ? raw : null;
}

/** The UTC day a moment falls in, as `YYYY-MM-DD`. */
export const utcDay = (moment: Date | number | string): string => new Date(moment).toISOString().slice(0, 10);

/** The day `n` days after (or before, if negative) `day`. */
export const addDays = (day: string, n: number): string => utcDay(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS);

/** The first moment of `day` and the first moment of the next one, UTC ISO-8601 with milliseconds. The end is exclusive. */
export function dayBounds(day: string): { start: string; end: string } {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return { start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

// ── The report ───────────────────────────────────────────────────────────────

export interface ReportPeriod {
  /** First moment, UTC ISO-8601 with milliseconds. */
  start: string;
  /** First moment after the period (exclusive). */
  end: string;
  /** True when the report was made before the period ended, so it covers part of it. */
  partial: boolean;
}

/** One address listed under a bucket. */
export interface ReportAddress {
  address: string;
  /** The chain of the registry row for this address, as the last of these checks saw it; null when it is not registered. */
  chain: string | null;
  /** The registry's label for the address when the report was made (the owner's own text; untrusted); null when it has none. */
  label: string | null;
  /** What the registry said about it on the last of these checks. */
  registry: RegistryVerdict | null;
  /** The reasons these checks gave (ANSWER_BASES, or `other`), sorted. */
  reasons: string[];
  /** Checks about this address in the period that fell in this bucket. */
  checks: number;
  /** All checks about this address in the period, whatever bucket each fell in. */
  checksInPeriod: number;
  firstAt: string;
  lastAt: string;
  /** The ledger event of the first of these checks. */
  eventId: string;
}

export interface BucketCounts {
  /** Addresses placed in this bucket: each address is placed in its most severe bucket only. */
  addresses: number;
  /** Checks that fell in this bucket by their own answer, whichever bucket their address was placed in. */
  checks: number;
}

export interface BucketListing extends BucketCounts {
  /** At most MAX_LISTED_PER_BUCKET, in the order they first appeared. */
  listed: ReportAddress[];
  /** Addresses in the bucket that are counted above but not listed. */
  omitted: number;
}

/** The bought and sold strip, and how the period's transfers were verified. */
export interface ReportStrip {
  transfers: number;
  /** Value that reached the agent's wallet from a trusted destination. */
  bought: SideTotal;
  /** Value that left the agent's wallet for a trusted destination. */
  sold: SideTotal;
  /** The transfers by the verify-status they inherited from the check that came before them. */
  byStatus: Record<VaultAnswer, number>;
  /** Transfers with the status `unknown` because no check came before them (reason no_preceding_check). */
  noPrecedingCheck: number;
}

export interface ReportContent {
  v: typeof REPORT_SCHEMA;
  tin: { id: string; label: string };
  period: ReportPeriod;
  /** The events in the period that the report is made of. */
  events: { checked: number; transaction: number };
  /** Distinct addresses the agent asked about in the period. */
  addresses: number;
  buckets: {
    issues: BucketListing;
    not_confirmed: BucketListing;
    new: BucketListing;
    no_issues: BucketCounts;
  };
  strip: ReportStrip;
  /**
   * Present only when the agent reached its daily limit of recorded checks during the period: the time of the check
   * that found the limit used up. Checks after it were answered and not recorded, except flagged ones, so the counts
   * above cover the recorded checks, not necessarily every check the agent asked.
   */
  limit?: { reachedAt: string };
}

export interface ReportOptions {
  tin: { id: string; label: string };
  period: ReportPeriod;
  /** Registry labels by normalized address, used for the addresses that get listed. */
  labels?: ReadonlyMap<string, string>;
}

interface Stamp {
  at: string;
  id: string;
}
const earlier = (a: Stamp, b: Stamp): boolean => a.at < b.at || (a.at === b.at && a.id < b.id);

interface BucketAggregate {
  checks: number;
  first: Stamp;
  last: Stamp & { chain: string | null; registry: RegistryVerdict | null };
  reasons: Set<string>;
}

interface AddressState {
  checks: number;
  buckets: Partial<Record<ReportBucket, BucketAggregate>>;
}

const zeroStatuses = (): Record<VaultAnswer, number> => ({ proven: 0, 'consistent-with-history': 0, flagged: 0, unknown: 0 });

/**
 * Builds a report from a tin's events, one at a time, so a busy day never has to sit in memory
 * whole: it keeps one small record per address asked about, not one per check.
 */
export class ReportBuilder {
  private readonly addresses = new Map<string, AddressState>();
  private readonly bucketChecks: Record<ReportBucket, number> = { issues: 0, not_confirmed: 0, new: 0, no_issues: 0 };
  private checked = 0;
  private transactions = 0;
  private readonly bought = emptySums();
  private readonly sold = emptySums();
  private readonly byStatus = zeroStatuses();
  private noPrecedingCheck = 0;
  private limitReachedAt: string | null = null;

  constructor(private readonly opts: ReportOptions) {}

  /** Adds one event. An event outside the period, or of a kind the report does not read, is ignored. */
  add(event: LedgerEvent): void {
    if (event.at < this.opts.period.start || event.at >= this.opts.period.end) return;
    if (event.kind === 'checked') this.addCheck(event);
    else if (event.kind === 'transaction') this.addMovement(event);
  }

  private addCheck(event: LedgerEvent): void {
    const bucket = classifyCheck(event);
    this.checked += 1;
    if (hasLimitMarker(event.detail) && (this.limitReachedAt === null || event.at < this.limitReachedAt)) this.limitReachedAt = event.at;
    this.bucketChecks[bucket] += 1;

    let state = this.addresses.get(event.address);
    if (!state) this.addresses.set(event.address, (state = { checks: 0, buckets: {} }));
    state.checks += 1;

    const stamp: Stamp = { at: event.at, id: event.id };
    const agg = state.buckets[bucket];
    if (!agg) {
      state.buckets[bucket] = {
        checks: 1,
        first: stamp,
        last: { ...stamp, chain: event.chain, registry: event.registry },
        reasons: new Set([basisOf(event.detail)]),
      };
      return;
    }
    agg.checks += 1;
    agg.reasons.add(basisOf(event.detail));
    if (earlier(stamp, agg.first)) agg.first = stamp;
    if (earlier(agg.last, stamp)) agg.last = { ...stamp, chain: event.chain, registry: event.registry };
  }

  private addMovement(event: LedgerEvent): void {
    const tx = event.tx;
    if (!tx) return;
    this.transactions += 1;
    addTransfer(tx.direction === 'out' ? this.sold : this.bought, tx.usd);
    const status: VaultAnswer = event.answer ?? 'unknown';
    this.byStatus[status] += 1;
    if (status === 'unknown' && event.detail?.reason === 'no_preceding_check') this.noPrecedingCheck += 1;
  }

  /** The report. Call once all events are in; calling it again after more events is allowed and gives the report so far. */
  finish(): ReportContent {
    const counts: Record<ReportBucket, number> = { issues: 0, not_confirmed: 0, new: 0, no_issues: 0 };
    const entries: Record<ListedBucketName, ReportAddress[]> = { issues: [], not_confirmed: [], new: [] };
    for (const [address, state] of this.addresses) {
      const placed = REPORT_BUCKETS.filter((b) => state.buckets[b]).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
      counts[placed] += 1;
      if (placed === 'no_issues') continue;
      const agg = state.buckets[placed]!;
      entries[placed].push({
        address,
        chain: agg.last.chain,
        label: this.opts.labels?.get(address) ?? null,
        registry: agg.last.registry,
        reasons: [...agg.reasons].sort(),
        checks: agg.checks,
        checksInPeriod: state.checks,
        firstAt: agg.first.at,
        lastAt: agg.last.at,
        eventId: agg.first.id,
      });
    }

    const listed = (bucket: ListedBucketName): BucketListing => {
      const all = entries[bucket].sort((a, b) => (a.firstAt < b.firstAt ? -1 : a.firstAt > b.firstAt ? 1 : a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
      const shown = all.slice(0, MAX_LISTED_PER_BUCKET);
      return { addresses: counts[bucket], checks: this.bucketChecks[bucket], listed: shown, omitted: all.length - shown.length };
    };

    return {
      v: REPORT_SCHEMA,
      tin: { id: this.opts.tin.id, label: this.opts.tin.label },
      period: { start: this.opts.period.start, end: this.opts.period.end, partial: this.opts.period.partial },
      events: { checked: this.checked, transaction: this.transactions },
      addresses: this.addresses.size,
      buckets: {
        issues: listed('issues'),
        not_confirmed: listed('not_confirmed'),
        new: listed('new'),
        no_issues: { addresses: counts.no_issues, checks: this.bucketChecks.no_issues },
      },
      strip: {
        transfers: this.transactions,
        bought: toSideTotal(this.bought),
        sold: toSideTotal(this.sold),
        byStatus: { ...this.byStatus },
        noPrecedingCheck: this.noPrecedingCheck,
      },
      ...(this.limitReachedAt !== null ? { limit: { reachedAt: this.limitReachedAt } } : {}),
    };
  }
}

/** A report from a list of events in any order (see ReportBuilder for the streaming form). */
export function buildReport(events: Iterable<LedgerEvent>, opts: ReportOptions): ReportContent {
  const builder = new ReportBuilder(opts);
  for (const event of events) builder.add(event);
  return builder.finish();
}

// ── What needs a person ──────────────────────────────────────────────────────

/** Addresses in the report that call for a look: had issues, plus not confirmed. New and clear addresses do not. */
export function attentionCount(content: Pick<ReportContent, 'buckets'>): number {
  return content.buckets.issues.addresses + content.buckets.not_confirmed.addresses;
}

/** The numbers a list row or a digest needs from a report, without the addresses. */
export interface ReportHeadline {
  /** Addresses per bucket. */
  issues: number;
  notConfirmed: number;
  new: number;
  noIssues: number;
  /** All checks in the period, and the ones that came back proven or consistent with history. */
  checks: number;
  noIssuesChecks: number;
  transfers: number;
  bought: SideTotal;
  sold: SideTotal;
  /** Whether the agent reached its daily limit of recorded checks in the period (see ReportContent.limit). */
  limitReached: boolean;
}

export function headlineOf(content: ReportContent): ReportHeadline {
  return {
    issues: content.buckets.issues.addresses,
    notConfirmed: content.buckets.not_confirmed.addresses,
    new: content.buckets.new.addresses,
    noIssues: content.buckets.no_issues.addresses,
    checks: content.events.checked,
    noIssuesChecks: content.buckets.no_issues.checks,
    transfers: content.strip.transfers,
    bought: content.strip.bought,
    sold: content.strip.sold,
    limitReached: content.limit !== undefined,
  };
}
