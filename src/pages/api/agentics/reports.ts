/**
 * Agent Vault operator reports: one per agent per UTC day. Owner only (a plain 404 for anyone
 * else); not public.
 *
 * GET ?tinId=&limit=&before=  -> the tin's reports, one per day (the newest version of each), newest
 *          day first. `limit` is 1 to 90 (30 when omitted); `before` is a day (`YYYY-MM-DD`) and
 *          returns only older days. `next` in the answer is the `before` value for the following
 *          page, or null when this is the last one. A list item carries the headline counts and
 *          no address.
 * GET ?id=                    -> one report: its content (the four buckets, each address listed once in
 *          its most severe bucket, and the bought and sold strip), every version of its day, and
 *          `verification`: verified, unsigned, unverifiable or altered.
 * POST {tinId, day}           -> make the report for a UTC day (`YYYY-MM-DD`) from the ledger as it
 *          stands now. 201 when a new version was written; 200 with the version that already says
 *          the same, when nothing has changed. Today is allowed and gives a report that says it is
 *          partial. The day may not be in the future or before the tin existed.
 *
 * A report is a snapshot of what the Vault had recorded when it was made (`generatedAt`). A later
 * transfer for the same day makes the next call write a new version; older versions stay.
 *
 * Text fields (`tin.label`, `label` on an address) are the owner's own and untrusted: escape them
 * before putting them in a page. Reports are append-only; there is no way to change or remove one.
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { generateReportFor, getReportDetail, listTinReports } from '@/lib/agentVault/reports';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId, url }) => {
  const id = url.searchParams.get('id');
  if (id !== null) {
    const r = await getReportDetail(tenantId, id);
    return r.ok ? json({ ok: true, report: r.report }) : failure(r);
  }
  const r = await listTinReports(tenantId, url.searchParams.get('tinId'), {
    limit: url.searchParams.get('limit'),
    before: url.searchParams.get('before'),
  });
  return r.ok ? json({ ok: true, tinId: r.tinId, reports: r.reports, next: r.next }) : failure(r);
});

export const POST = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await generateReportFor(tenantId, parsed.body.tinId, parsed.body.day);
  return r.ok ? json({ ok: true, created: r.created, report: r.report }, r.created ? 201 : 200) : failure(r);
});
