/**
 * Almstins Verify: the satoshi test, detection rule `bound_v1` (read-only).
 *
 * Proof model: the merchant sends EXACTLY the challenge's amount FROM the address they
 * registered TO that same address, inside the challenge window. Only the key holder can
 * originate that transaction; the random exact amount (verifyTestAmount.ts) binds it to
 * this one challenge; and from == to means nothing leaves the merchant's wallet except
 * the network fee. Almstins never sends, holds, or signs, and never gives anyone an
 * address to send to: it only READS public chain data. A breach of Almstins still can't
 * move a coin, because there is nothing to move.
 *
 * Why bound: the old rule accepted ANY outgoing transaction after the challenge opened,
 * with no amount and no recipient, so someone could open a challenge on an address they
 * don't control and be credited with the real owner's next routine send.
 *
 * Match per rail (all amounts are BigInt base units, never floats):
 *   - EVM (ethereum/polygon/avalanche): a txlist row with from == to == address,
 *     value == expected wei and isError == "0", paged ascending from the block at the
 *     window start (getblocknobytime).
 *   - Bitcoin / Litecoin (esplora): at least one input whose prevout address is the
 *     address, AND an output to that same address worth exactly the amount. Mempool
 *     counts. Confirmed pages are read newest first back to the window start.
 *   - Solana: a system `transfer` with source == destination == address and lamports ==
 *     amount, in a successful transaction read with jsonParsed at commitment 'confirmed'.
 *
 * Time window: [issued_at, expires_at], widened by per-chain slack. A confirmed BTC/LTC
 * block time gets 2h, because block timestamps can drift from real time. EVM and Solana
 * get 2 minutes. A mempool transaction has no timestamp, so our own sighting (the check
 * time) must fall inside the window plus the same 2h a block gets.
 *
 * Baseline (BTC/LTC): nothing that was already visible when the amount was issued can
 * prove it. A wallet that reuses its address sends change back to it, and that change
 * output is exactly the shape of a self-send, so without this an amount drawn to match an
 * old change output would "prove" the address for whoever drew it. At issuance we record
 * the address's mempool txids and the chain tip height (captureSelfSendBaseline); a
 * transaction in that mempool list, or confirmed at or below that height, never counts.
 * Account chains need no baseline: a routine send there is never from == to.
 *
 * Errors: an explorer or RPC failure is 'unavailable', never 'not yet'. Etherscan's
 * "No transactions found" is an empty result, so it is 'not_yet'.
 *
 * Diagnostics (cheap, read from the same pages; never shown with amounts, hashes or
 * counterparties): wrong_amount (the address sent something, but not the exact test),
 * wrong_recipient (the exact amount left for another address), sent_to_not_from (the
 * exact amount arrived from somewhere else).
 *
 * TODO(PR-6): persist a scan cursor on the challenge so a very busy address resumes
 * where the last check stopped instead of re-reading from the window start each time.
 * TODO(D7): sweep the other two EVM rails too (same key on all three), so a test sent
 * on "the wrong EVM network" still counts. Today only the registered rail is read.
 */
import { buildEtherscanV2Url, requestEtherscan, CHAIN_IDS } from '@/lib/etherscan';

/** What a BTC/LTC address already showed on chain when its amount was issued. */
export interface SelfSendBaseline {
  /** Chain tip height at issuance: a transaction confirmed at or below it was already there. */
  tipHeight: number;
  /** Unconfirmed txids touching the address at issuance. */
  mempool: string[];
}

export interface SelfSendChallenge {
  rail: string;
  /** The registered address, as stored. */
  address: string;
  /** Exact amount in base units (sats, litoshis, wei, lamports). */
  expected: bigint;
  /** Challenge window, epoch seconds. */
  issuedAt: number;
  expiresAt: number;
  /** BTC/LTC: required (see captureSelfSendBaseline). Ignored on account chains. */
  baseline?: SelfSendBaseline | null;
}

export type SelfSendHint = 'wrong_amount' | 'wrong_recipient' | 'sent_to_not_from';
export type SelfSendMiss = 'not_yet' | SelfSendHint | 'unavailable' | 'unsupported_rail';
export type SelfSendOutcome =
  | { found: true; ref: string } // the proving tx hash / signature
  | { found: false; reason: SelfSendMiss };

/** One transaction's verdict against the challenge. null = irrelevant to the test. */
export type TxVerdict = 'pass' | SelfSendHint | null;

interface TimeWindow { start: number; end: number }

const EVM_RAILS = new Set(['ethereum', 'polygon', 'avalanche']);
const ESPLORA_BASE: Record<string, string> = {
  bitcoin: 'https://blockstream.info/api',
  litecoin: 'https://litecoinspace.org/api',
};
// Set SOLANA_RPC_URL to a keyed RPC before any background polling (PR-6): the public
// RPC's rate limits are low.
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const HTTP_TIMEOUT_MS = 8000;

/** Per-chain slack on the window, seconds. */
export const SLACK_UTXO_BLOCK_S = 2 * 60 * 60;
export const SLACK_ACCOUNT_S = 2 * 60;

/** txlist end block: far above any chain height. The customary 99999999 is only 10^8,
 *  which Avalanche C-chain and Polygon pass in late 2026; past it every read would come
 *  back empty and a valid test would never be found. */
export const EVM_END_BLOCK = 9_999_999_999;

// Page caps per check (each check re-reads from the window start; see the TODO above).
export const EVM_PAGE_SIZE = 100;
export const EVM_MAX_PAGES = 5;
/** esplora returns 25 confirmed transactions per /txs/chain page. */
export const ESPLORA_CHAIN_PAGE = 25;
export const ESPLORA_MAX_PAGES = 8;
export const SOL_SIG_PAGE = 50;
export const SOL_MAX_PAGES = 4;
export const SOL_MAX_TX_READS = 60;

const unavailable: SelfSendOutcome = { found: false, reason: 'unavailable' };

// Stronger diagnostics win when several transactions in the window say different things.
const HINT_RANK: Record<SelfSendHint, number> = { wrong_amount: 1, sent_to_not_from: 2, wrong_recipient: 3 };
function stronger(a: SelfSendHint | null, b: TxVerdict): SelfSendHint | null {
  if (!b || b === 'pass') return a;
  if (!a) return b;
  return HINT_RANK[b] > HINT_RANK[a] ? b : a;
}
const missWith = (hint: SelfSendHint | null): SelfSendOutcome => ({ found: false, reason: hint ?? 'not_yet' });

const within = (t: number, w: TimeWindow): boolean => Number.isFinite(t) && t >= w.start && t <= w.end;

/** A non-negative integer amount as BigInt, or null. Never goes through a float for strings. */
function toBig(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v >= 0n ? v : null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

/**
 * Did the registered address send exactly the expected amount to itself inside the
 * challenge window? Read-only. Never throws: any failure is 'unavailable'.
 */
export async function detectBoundSelfSend(
  ch: SelfSendChallenge,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<SelfSendOutcome> {
  const address = String(ch.address ?? '').trim();
  if (!address || ch.expected <= 0n) return { found: false, reason: 'unsupported_rail' };
  const c = { ...ch, address };
  try {
    if (EVM_RAILS.has(c.rail)) return await detectEvm(c);
    const esplora = esploraBase(c.rail);
    if (esplora) return await detectEsplora(esplora, c, nowSec);
    if (c.rail === 'solana') return await detectSolana(c, nowSec);
    return { found: false, reason: 'unsupported_rail' };
  } catch {
    return unavailable;
  }
}

// ── EVM (Etherscan v2 / Routescan) ───────────────────────────────────────────

/** One txlist row against the challenge (address lowercased by the caller). */
export function evmRowVerdict(
  row: Record<string, unknown>,
  addressLower: string,
  expected: bigint,
  window: TimeWindow,
): TxVerdict {
  if (!within(Number(row.timeStamp), window)) return null;
  // A reverted transaction never counts, and says nothing about the test.
  if (String(row.isError ?? '') !== '0' || String(row.txreceipt_status ?? '') === '0') return null;
  const value = toBig(row.value);
  if (value === null) return null;
  const from = String(row.from ?? '').toLowerCase();
  const to = String(row.to ?? '').toLowerCase();
  const exact = value === expected;
  if (from === addressLower && to === addressLower) return exact ? 'pass' : 'wrong_amount';
  if (from === addressLower) return exact ? 'wrong_recipient' : 'wrong_amount';
  if (to === addressLower && exact) return 'sent_to_not_from';
  return null;
}

/**
 * An Etherscan-style txlist payload to rows, or null when the explorer failed. "No
 * transactions found" is an empty result (not yet), never an error; NOTOK, a rate limit,
 * or any non-array result is unavailable.
 */
export function readEtherscanRows(payload: unknown): Array<Record<string, unknown>> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { status?: unknown; message?: unknown; result?: unknown };
  const noTx = /no transactions found/i;
  if (noTx.test(String(p.message ?? '')) || (typeof p.result === 'string' && noTx.test(p.result))) return [];
  if (String(p.status ?? '') === '1' && Array.isArray(p.result)) return p.result as Array<Record<string, unknown>>;
  return null;
}

// The block at a window start never changes, so remember it across polls.
const blockAtCache = new Map<string, number>();

async function evmBlockAt(chainId: number, timestamp: number): Promise<number | null> {
  const key = `${chainId}:${timestamp}`;
  const cached = blockAtCache.get(key);
  if (cached !== undefined) return cached;
  const url = buildEtherscanV2Url(chainId, {
    module: 'block', action: 'getblocknobytime', timestamp, closest: 'before',
  });
  if (!url) return null; // explorer API key not configured
  const p = (await requestEtherscan(url)) as { status?: unknown; result?: unknown } | null;
  if (String(p?.status ?? '') !== '1') return null;
  const raw = p?.result && typeof p.result === 'object' ? (p.result as { blockNumber?: unknown }).blockNumber : p?.result;
  const block = Number(raw);
  if (!Number.isSafeInteger(block) || block < 0) return null;
  if (blockAtCache.size > 1000) blockAtCache.clear();
  blockAtCache.set(key, block);
  return block;
}

async function detectEvm(ch: SelfSendChallenge): Promise<SelfSendOutcome> {
  const chainId = (CHAIN_IDS as Record<string, number>)[ch.rail];
  const window: TimeWindow = { start: ch.issuedAt - SLACK_ACCOUNT_S, end: ch.expiresAt + SLACK_ACCOUNT_S };
  const startBlock = await evmBlockAt(chainId, window.start);
  if (startBlock === null) return unavailable;
  const addr = ch.address.toLowerCase();
  let hint: SelfSendHint | null = null;
  for (let page = 1; page <= EVM_MAX_PAGES; page++) {
    const url = buildEtherscanV2Url(chainId, {
      module: 'account', action: 'txlist', address: addr,
      startblock: startBlock, endblock: EVM_END_BLOCK, page, offset: EVM_PAGE_SIZE, sort: 'asc',
    });
    if (!url) return unavailable;
    const rows = readEtherscanRows(await requestEtherscan(url));
    if (rows === null) return unavailable;
    for (const row of rows) {
      const v = evmRowVerdict(row, addr, ch.expected, window);
      if (v === 'pass') return { found: true, ref: String(row.hash ?? '') };
      hint = stronger(hint, v);
    }
    if (rows.length < EVM_PAGE_SIZE) break;
    // Ascending: once a page runs past the window end, later pages can't match.
    if (Number(rows[rows.length - 1]?.timeStamp) > window.end) break;
  }
  return missWith(hint);
}

// ── Bitcoin / Litecoin (esplora) ─────────────────────────────────────────────

const BECH32_PREFIX = /^(bc1|tb1|bcrt1|ltc1|tltc1)/i;
/** esplora reports bech32 lowercase; base58 stays exact. */
function utxoAddress(v: unknown): string {
  const s = String(v ?? '').trim();
  return BECH32_PREFIX.test(s) ? s.toLowerCase() : s;
}

/** One esplora transaction against the challenge (address canonicalized by the caller). */
export function utxoTxVerdict(tx: Record<string, any>, address: string, expected: bigint): TxVerdict {
  const vin: any[] = Array.isArray(tx?.vin) ? tx.vin : [];
  const vout: any[] = Array.isArray(tx?.vout) ? tx.vout : [];
  const spendsHere = vin.some((i) => utxoAddress(i?.prevout?.scriptpubkey_address) === address);
  let exactToSelf = false;
  let exactElsewhere = false;
  for (const o of vout) {
    if (toBig(o?.value) !== expected) continue;
    if (utxoAddress(o?.scriptpubkey_address) === address) exactToSelf = true;
    else exactElsewhere = true;
  }
  if (spendsHere && exactToSelf) return 'pass';
  if (spendsHere && exactElsewhere) return 'wrong_recipient';
  if (!spendsHere && exactToSelf) return 'sent_to_not_from';
  // Spent from here with no exact output: a different amount, or change merged into
  // the test output (the wallet folded the change into it).
  if (spendsHere) return 'wrong_amount';
  return null;
}

async function getJsonArray(url: string): Promise<any[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** The esplora API for a UTXO rail, or null (own keys only: a rail is user data). */
function esploraBase(rail: string): string | null {
  return Object.prototype.hasOwnProperty.call(ESPLORA_BASE, rail) ? ESPLORA_BASE[rail] : null;
}

/** True when the rail's test needs a baseline captured at issuance (Bitcoin, Litecoin). */
export function railNeedsBaseline(rail: string): boolean {
  return esploraBase(rail) !== null;
}

/** esplora's chain tip height (plain-text body), or null. */
async function getTipHeight(base: string): Promise<number | null> {
  try {
    const res = await fetch(`${base}/blocks/tip/height`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.text()).trim();
    const height = /^\d+$/.test(body) ? Number(body) : NaN;
    return Number.isSafeInteger(height) ? height : null;
  } catch {
    return null;
  }
}

/**
 * Record what a BTC/LTC address already shows, BEFORE its amount is drawn (see "Baseline"
 * above). The mempool is read before the tip, so a transaction that confirms between the
 * two reads is still caught by its txid. Returns null on account chains (none needed) and
 * 'unavailable' when the explorer can't be read: no amount is issued without a baseline.
 */
export async function captureSelfSendBaseline(
  rail: string,
  address: string,
): Promise<SelfSendBaseline | null | 'unavailable'> {
  const base = esploraBase(rail);
  if (!base) return null;
  const addr = utxoAddress(address);
  const mempool = await getJsonArray(`${base}/address/${encodeURIComponent(addr)}/txs/mempool`);
  if (mempool === null) return 'unavailable';
  const tipHeight = await getTipHeight(base);
  if (tipHeight === null) return 'unavailable';
  return { tipHeight, mempool: mempool.map((tx) => String(tx?.txid ?? '')).filter(Boolean) };
}

/** A stored baseline (JSON) back to its shape, or null when it is missing or malformed. */
export function parseSelfSendBaseline(raw: unknown): SelfSendBaseline | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const b = JSON.parse(raw) as { tipHeight?: unknown; mempool?: unknown };
    if (!Number.isSafeInteger(b?.tipHeight) || (b.tipHeight as number) < 0) return null;
    if (!Array.isArray(b.mempool) || !b.mempool.every((t) => typeof t === 'string')) return null;
    return { tipHeight: b.tipHeight as number, mempool: b.mempool as string[] };
  } catch {
    return null;
  }
}

async function detectEsplora(base: string, ch: SelfSendChallenge, nowSec: number): Promise<SelfSendOutcome> {
  // Fail closed: without the baseline, a transaction that was already on chain when the
  // amount was issued can't be told from the test. The registry never issues one without it.
  const baseline = ch.baseline;
  if (!baseline) return unavailable;
  const seenAtIssue = new Set(baseline.mempool);
  const addr = utxoAddress(ch.address);
  const path = `${base}/address/${encodeURIComponent(addr)}`;
  let hint: SelfSendHint | null = null;

  // Mempool: no timestamp. Anything not in the issuance mempool was broadcast after the
  // amount was issued; our sighting (now) must fall before the window end plus the 2h a
  // block gets, so a send made in time and seen late (the check grace) still counts.
  const mempool = await getJsonArray(`${path}/txs/mempool`);
  if (mempool === null) return unavailable;
  if (within(nowSec, { start: ch.issuedAt, end: ch.expiresAt + SLACK_UTXO_BLOCK_S })) {
    for (const tx of mempool) {
      if (seenAtIssue.has(String(tx?.txid ?? ''))) continue;
      const v = utxoTxVerdict(tx, addr, ch.expected);
      if (v === 'pass') return { found: true, ref: String(tx?.txid ?? '') };
      hint = stronger(hint, v);
    }
  }

  // Confirmed, newest first: page back until a block time falls before the window.
  const window: TimeWindow = { start: ch.issuedAt - SLACK_UTXO_BLOCK_S, end: ch.expiresAt + SLACK_UTXO_BLOCK_S };
  let url = `${path}/txs/chain`;
  for (let page = 0; page < ESPLORA_MAX_PAGES; page++) {
    const txs = await getJsonArray(url);
    if (txs === null) return unavailable;
    let pastStart = false;
    for (const tx of txs) {
      if (!tx?.status?.confirmed) continue;
      const t = Number(tx.status.block_time);
      if (t < window.start) { pastStart = true; break; }
      if (!within(t, window)) continue;
      // Already on chain, or already in the mempool, when the amount was issued: the 2h
      // block-time slack is for clock drift, never for a transaction older than the amount.
      const height = Number(tx.status.block_height);
      if (!Number.isSafeInteger(height) || height <= baseline.tipHeight) continue;
      if (seenAtIssue.has(String(tx.txid ?? ''))) continue;
      const v = utxoTxVerdict(tx, addr, ch.expected);
      if (v === 'pass') return { found: true, ref: String(tx.txid ?? '') };
      hint = stronger(hint, v);
    }
    if (pastStart || txs.length < ESPLORA_CHAIN_PAGE) break;
    const lastTxid = String(txs[txs.length - 1]?.txid ?? '');
    if (!lastTxid) break;
    url = `${path}/txs/chain/${encodeURIComponent(lastTxid)}`;
  }
  return missWith(hint);
}

// ── Solana (JSON-RPC) ────────────────────────────────────────────────────────

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/** What the matcher needs from one parsed transaction (confirmed transactions never change). */
interface SolTxSummary {
  ok: boolean;
  transfers: Array<{ source: string; destination: string; lamports: bigint | null }>;
  signers: string[];
}

export function summarizeSolanaTx(tx: any): SolTxSummary {
  const msg = tx?.transaction?.message ?? {};
  const instructions: any[] = Array.isArray(msg.instructions) ? msg.instructions : [];
  const transfers = instructions
    .filter((ix) => (ix?.program === 'system' || ix?.programId === SYSTEM_PROGRAM_ID) && ix?.parsed?.type === 'transfer')
    .map((ix) => ({
      source: String(ix.parsed.info?.source ?? ''),
      destination: String(ix.parsed.info?.destination ?? ''),
      lamports: toBig(ix.parsed.info?.lamports),
    }));
  const keys: any[] = Array.isArray(msg.accountKeys) ? msg.accountKeys : [];
  const signers = keys.filter((k) => k && typeof k === 'object' && k.signer).map((k) => String(k.pubkey ?? ''));
  return { ok: tx?.meta != null && tx.meta.err == null, transfers, signers };
}

/** One parsed Solana transaction against the challenge. */
export function solanaTxVerdict(tx: any, address: string, expected: bigint): TxVerdict {
  return solanaSummaryVerdict(summarizeSolanaTx(tx), address, expected);
}

function solanaSummaryVerdict(s: SolTxSummary, address: string, expected: bigint): TxVerdict {
  if (!s.ok) return null; // a failed transaction never counts
  let hint: SelfSendHint | null = null;
  for (const tr of s.transfers) {
    const exact = tr.lamports === expected;
    const fromHere = tr.source === address;
    const toHere = tr.destination === address;
    if (fromHere && toHere && exact) return 'pass';
    if (fromHere && exact) hint = stronger(hint, 'wrong_recipient');
    else if (toHere && exact) hint = stronger(hint, 'sent_to_not_from');
    else if (fromHere) hint = stronger(hint, 'wrong_amount');
  }
  // Signed by the address with no matching transfer (a token send, a swap): not the test.
  if (!hint && s.signers.includes(address)) hint = 'wrong_amount';
  return hint;
}

// Parsed transactions by signature, so repeat polls only read what is new.
const solTxCache = new Map<string, SolTxSummary>();

async function detectSolana(ch: SelfSendChallenge, nowSec: number): Promise<SelfSendOutcome> {
  const window: TimeWindow = { start: ch.issuedAt - SLACK_ACCOUNT_S, end: ch.expiresAt + SLACK_ACCOUNT_S };

  // Signatures come newest first; page with `before` until one predates the window.
  const candidates: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < SOL_MAX_PAGES; page++) {
    const opts: Record<string, unknown> = { limit: SOL_SIG_PAGE, commitment: 'confirmed' };
    if (before) opts.before = before;
    const sigs = await solRpc<Array<{ signature: string; blockTime?: number | null; err?: unknown }>>(
      'getSignaturesForAddress', [ch.address, opts],
    );
    if (!Array.isArray(sigs)) return unavailable;
    let pastStart = false;
    for (const s of sigs) {
      // A signature without a block time yet is judged by our own first sighting.
      const t = typeof s?.blockTime === 'number' ? s.blockTime : nowSec;
      if (t < window.start) { pastStart = true; break; }
      if (!within(t, window) || s?.err != null) continue;
      candidates.push(String(s.signature));
    }
    if (pastStart || sigs.length < SOL_SIG_PAGE) break;
    before = String(sigs[sigs.length - 1]?.signature ?? '');
    if (!before) break;
  }

  let hint: SelfSendHint | null = null;
  let sawUnavailable = false;
  for (const sig of candidates.slice(0, SOL_MAX_TX_READS)) {
    let summary = solTxCache.get(sig);
    if (!summary) {
      const tx = await solRpc<any>('getTransaction', [
        sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ]);
      // A signature we were just handed with no transaction behind it is an RPC gap.
      if (!tx) { sawUnavailable = true; continue; }
      summary = summarizeSolanaTx(tx);
      if (solTxCache.size > 2000) solTxCache.clear();
      solTxCache.set(sig, summary);
    }
    const v = solanaSummaryVerdict(summary, ch.address, ch.expected);
    if (v === 'pass') return { found: true, ref: sig };
    hint = stronger(hint, v);
  }
  if (sawUnavailable) return unavailable;
  return missWith(hint);
}

/** JSON-RPC call; null on any transport or RPC error, or a null result. */
async function solRpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T };
    return json?.result ?? null;
  } catch {
    return null;
  }
}

/** Test hook: forget the per-process caches. */
export function _resetSelfSendCaches(): void {
  blockAtCache.clear();
  solTxCache.clear();
}
