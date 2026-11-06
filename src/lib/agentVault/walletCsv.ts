/**
 * The download beside a wallet window: every transfer of one of the agent's own wallets in one
 * direction (what it received, or what it sent), as a CSV, oldest first. A convenience file, not a
 * signed one: the signed export of the agent's ledger, by day, is the record (./ledgerExport.ts). Its
 * cells are written by the same csvCell, so a token's symbol that reads like a spreadsheet formula is
 * kept as text, and it starts with the same byte-order mark.
 *
 * The values are the ones the signed export carries for a transfer (leafOf): the other side's status,
 * the unmatched mark, the contract mark, the USD value to the micro-dollar, and whether that value was
 * still pending when the file was made. Nothing here is about any address but the agent's own wallet
 * and the other side of each of its transfers.
 */
import { fail, type Failure } from './errors';
import { CSV_BOM, csvCell, leafOf, type TransferLeaf } from './ledgerExport';
import type { LedgerEvent, TransferDirection } from './events';
import { listWalletWindow, type EventView } from './vault';

/** The most transfers one download carries. More than that is refused: the signed export, by day, covers any size. */
export const MAX_WALLET_CSV_ROWS = 50_000;

/** Rows read per database call while a download is made. */
const READ_PAGE = 200;

export const WALLET_CSV_COLUMNS = [
  'time_utc', 'direction', 'wallet', 'chain', 'other_side', 'counterparty', 'unmatched', 'amount', 'asset', 'asset_contract',
  'usd', 'usd_pending', 'tx_hash', 'block_number', 'contract', 'linked_check', 'event_id',
] as const;

/** The file's name: what it is, the chain, the direction and the day it was made. Never an address or a label. */
export function walletCsvFileName(chain: string, direction: TransferDirection, day: string): string {
  return `almstins-agent-wallet-${chain}-${direction === 'in' ? 'received' : 'sent'}-${day}.csv`;
}

/** The CSV of some transfers, in the order given. Events that are not transfers are left out. Pure. */
export function walletCsv(events: readonly (LedgerEvent | EventView)[]): string {
  const lines: string[] = [];
  for (const e of events) {
    const leaf = leafOf({ ...e, sourceIp: null } as LedgerEvent);
    if (!leaf || leaf.kind !== 'transaction') continue;
    const t = leaf as TransferLeaf;
    lines.push(
      [
        t.date, t.direction === 'in' ? 'received' : 'sent', t.wallet, t.chain, t.address, t.counterparty, t.unmatched ? 'true' : 'false', t.amount, t.asset, t.asset_contract,
        t.usd, t.price_pending ? 'true' : 'false', t.tx_hash, t.block_number, t.contract === null ? '' : t.contract ? 'true' : 'false', t.linked_check, t.event_id,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return CSV_BOM + [WALLET_CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
}

export type WalletCsvResult = { ok: true; csv: string; chain: string; direction: TransferDirection; rows: number } | Failure;

/**
 * Reads every transfer of one wallet in one direction, through the same checks a window's page goes
 * through (the agent and the wallet must be this account's), and makes the file. Refuses with
 * export_too_large past MAX_WALLET_CSV_ROWS rather than hand over part of the history as if it were all.
 */
export async function walletWindowCsv(tenantId: string, opts: { tinId: unknown; walletId: unknown; direction: unknown }): Promise<WalletCsvResult> {
  const all: EventView[] = [];
  let before: string | null = null;
  let chain = '';
  for (;;) {
    const page = await listWalletWindow(tenantId, { ...opts, limit: READ_PAGE, before });
    if (!page.ok) return page;
    chain = page.chain;
    all.push(...page.events);
    if (all.length > MAX_WALLET_CSV_ROWS) return fail('export_too_large', MAX_WALLET_CSV_ROWS);
    if (!page.next) break;
    before = page.next;
  }
  const direction = opts.direction === 'in' ? 'in' : 'out';
  return { ok: true, csv: walletCsv(all.slice().reverse()), chain, direction, rows: all.length };
}
