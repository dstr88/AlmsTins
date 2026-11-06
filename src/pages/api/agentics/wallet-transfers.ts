/**
 * The windows of the Wallets page: the transfers of one of an agent's own wallets in one direction.
 * Owner only (a plain 404 for anyone else); not public.
 *
 * GET ?tinId=&walletId=&direction=in|out&limit=&before=
 *      -> one page, newest first: `in` is what the wallet received, `out` what it sent. `limit` is 1 to
 *         200 (25 when omitted); `next` is the `before` value for the following (older) page, or null.
 *         The events are the ledger's own (see /api/agentics/events), transfers only.
 *
 * GET ...&format=csv
 *      -> every transfer of that wallet in that direction, oldest first, as a CSV download. A
 *         convenience file and not a signed one: the signed export, by day, is the record.
 *
 * Refused, as a code and no file:
 *        400 invalid_id          no agent or wallet id
 *        400 invalid_format      a direction other than in or out, or a format other than csv
 *        400 invalid_cursor      a `before` this server did not make
 *        404 tin_not_found       no such agent on this account
 *        404 wallet_not_found    no such wallet on that agent
 *        413 export_too_large    more than 50,000 transfers in one download
 *        429 rate_limited        more than 6 downloads in a minute for the account
 *        429 export_busy         a download is already being made for this account, or for the server
 *
 * Text fields such as `tx.asset` come from the chain and are untrusted: escape them before putting them
 * in a page. A file is sent as an attachment, never stored or shared by a cache, and never sniffed.
 */
import { failure, json, vaultRoute } from '@/lib/agentVault/api';
import { fail } from '@/lib/agentVault/errors';
import { createExportGate, createExportRequestLimiter } from '@/lib/agentVault/ledgerExport';
import { utcDay } from '@/lib/agentVault/report';
import { listWalletWindow } from '@/lib/agentVault/vault';
import { walletCsvFileName, walletWindowCsv } from '@/lib/agentVault/walletCsv';

export const prerender = false;

/** Downloads have their own budget and their own one-at-a-time gate, apart from the signed export's. */
const requestLimiter = createExportRequestLimiter();
const gate = createExportGate();

const FILE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const q = url.searchParams;
  const format = q.get('format');
  const ids = { tinId: q.get('tinId'), walletId: q.get('walletId'), direction: q.get('direction') };

  if (format === null) {
    const r = await listWalletWindow(tenantId, { ...ids, limit: q.get('limit'), before: q.get('before') });
    if (!r.ok) return failure(r);
    return json({ ok: true, events: r.events, next: r.next });
  }

  // Counted before anything is read, so a malformed request spends the budget too.
  if (requestLimiter.tooMany(tenantId)) return failure(fail('rate_limited'));
  if (format !== 'csv') return failure(fail('invalid_format'));
  const release = gate.enter(tenantId);
  if (!release) return failure(fail('export_busy'));
  try {
    const r = await walletWindowCsv(tenantId, ids);
    if (!r.ok) return failure(r);
    return new Response(r.csv, {
      status: 200,
      headers: {
        ...FILE_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${walletCsvFileName(r.chain, r.direction, utcDay(new Date()))}"`,
      },
    });
  } finally {
    release();
  }
});
