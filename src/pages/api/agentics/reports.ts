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
 *          At most 6 a minute for an account (429 `rate_limited`, with `Retry-After` in seconds);
 *          the count is per process and resets on a restart. A day has at most 50 versions of an
 *          agent's report (409 `version_limit`, with `max`): a report that has not changed is still
 *          handed back with a 200, only a change that would need a 51st version is refused.
 *
 * A report is a snapshot of what the Vault had recorded when it was made (`generatedAt`). A later
 * transfer for the same day makes the next call write a new version; older versions stay.
 *
 * Text fields (`tin.label`, `label` on an address) are the owner's own and untrusted: escape them
 * before putting them in a page. Reports are append-only; there is no way to change or remove one.
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { fail } from '@/lib/agentVault/errors';
import { createReportRequestLimiter, generateReportFor, getReportDetail, listTinReports } from '@/lib/agentVault/reports';

export const prerender = false;

/** Six requests a minute for each account (see reports.ts); the 429 tells the caller to wait RETRY_AFTER_SECONDS (api.ts), the length of that window. */
const requestLimiter = createReportRequestLimiter();

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
  // Counted before the body is read, so a malformed request spends the budget too.
  if (requestLimiter.tooMany(tenantId)) return failure(fail('rate_limited'));
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await generateReportFor(tenantId, parsed.body.tinId, parsed.body.day);
  return r.ok ? json({ ok: true, created: r.created, report: r.report }, r.created ? 201 : 200) : failure(r);
});
