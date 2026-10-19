/**
 * The signed export of one agent's ledger. Owner only (a plain 404 for anyone else); not public.
 *
 * GET ?tinId=&from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]
 *      -> the agent's ledger for the UTC days from `from` to `to`, both counted, as a download.
 *
 *      JSON (the default): a SIGNED proof bundle of the record type `agent_ledger`: a manifest (the
 *      agent, the range, how many checks and transfers, when the file was made, the Merkle root, the
 *      key that signed it), the events as the ordered leaves, and an Ed25519 signature. It verifies
 *      with scripts/verify-record.mjs, POST /api/verify-record and the page /verify-record. Each
 *      event is a leaf under the root, so any single one is individually provable.
 *
 *      format=csv: a convenience copy of the same events. It is NOT signed. Its first line names the
 *      signed file it is a copy of (bundle id and Merkle root) and says so, so the two can be matched.
 *
 *      Refused, as a code and no file:
 *        400 invalid_period      a day that is not a real date, a start after the end, or an end in the future
 *        400 invalid_format      a format other than json or csv
 *        404 tin_not_found       no such agent on this account
 *        413 export_too_large    a range of more than 366 days, or one that holds more than 50,000 events
 *        429 rate_limited        more than 6 in a minute for the account (Retry-After in seconds; the
 *                                count is per process and resets on a restart)
 *        503 signing_unavailable no signing key is configured, or Almstins does not publish the one that is
 *
 * The file is the ledger as the Vault stored it when it was made (`generated_at` in the manifest):
 * it does not show that the agent asked before every payment, and it holds nothing about a transfer to
 * an address that was never registered. It is sent as an attachment, never stored or shared by a
 * cache, and never sniffed as anything else.
 */
import { failure, vaultRoute } from '@/lib/agentVault/api';
import { fail } from '@/lib/agentVault/errors';
import { createExportRequestLimiter, exportLedger, ledgerCsv, ledgerFileName, serializeBundle } from '@/lib/agentVault/ledgerExport';

export const prerender = false;

/** Six requests a minute for each account (see ledgerExport.ts); the 429 tells the caller to wait RETRY_AFTER_SECONDS (api.ts), the length of that window. */
const requestLimiter = createExportRequestLimiter();

const FILE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export const GET = vaultRoute(async ({ tenantId, url }) => {
  // Counted before anything is read, so a malformed request spends the budget too.
  if (requestLimiter.tooMany(tenantId)) return failure(fail('rate_limited'));

  const format = url.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') return failure(fail('invalid_format'));

  const r = await exportLedger(tenantId, url.searchParams.get('tinId'), url.searchParams.get('from'), url.searchParams.get('to'));
  if (!r.ok) return failure(r);

  if (format === 'csv') {
    return new Response(ledgerCsv(r.bundle), {
      status: 200,
      headers: {
        ...FILE_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${ledgerFileName(r.bundle.manifest, 'csv')}"`,
      },
    });
  }
  return new Response(serializeBundle(r.bundle), {
    status: 200,
    headers: {
      ...FILE_HEADERS,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${ledgerFileName(r.bundle.manifest, 'json')}"`,
    },
  });
});
