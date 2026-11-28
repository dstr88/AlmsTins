/**
 * Email statement copy (approved 2026-11-28): every string the statement of the emails about a
 * claim shows, on the desk, the Client Portal and inside its signed manifest. Pure and import-free,
 * like the other copy modules.
 *
 * Rules: it counts emails Almstins sent and never says anyone read one; it names roles, dates,
 * email types and template versions only (no address, no email text, no note, no requester); the
 * next-scheduled line is a forecast and is never counted as sent. No em dashes.
 */

/** The statement's first line. {date} is the as-of day, `November 28, 2026`. */
export const ES_HEAD = 'Emails about this claim, as of {date}';

/** The four groups, in the order they are shown. */
export const ES_GROUP = {
	scheduled: 'Scheduled',
	interested: 'Interested parties',
	client: 'Client',
	lender_acted: 'Lender acted',
} as const;

/** One group's line: label, count, dates. Two on one day reads `Nov 3 (2)`. */
export const ES_LINE = '{label}: {count}, on {dates}.';
export const ES_LINE_NONE = '{label}: 0.';
export const ES_SAME_DAY = '{date} ({count})';
export const ES_AND = ' and ';

/** The forecast (E1). Computed from the schedule the notices job uses; never counted as sent. */
export const ES_NEXT = 'Next scheduled: {notice}, {date}, unless the lender updates the claim first.';

/** What the counts mean, under the four lines. */
export const ES_SENT_NOTE =
	'These are emails Almstins sent. Sent does not mean anyone read them. No email text is kept here: each one can be rebuilt from the template version listed for it. The next scheduled line is a forecast, not an email sent.';

/** Where the history starts. Dates are the first day each log holds. */
export const ES_HISTORY =
	'History starts: scheduled from {scheduled}, interested parties from {interested}, client from {client}, lender acted from {lender_acted}. Dates are UTC.';

/** The list under the summary: one line per email. */
export const ES_EACH_TITLE = 'Each email';
export const ES_EMAIL_LINE = '{date}: {type}, to the {to}. {template}.';
export const ES_TEMPLATE = 'Template {version}';
export const ES_TEMPLATE_NOT_RECORDED = 'Template version not recorded';

/** Who an email went to, by role only. */
export const ES_TO: Record<string, string> = {
	lender: 'lender',
	client: 'client',
};

/** Each email's type, by its log's own key. */
export const ES_TYPE: Record<string, string> = {
	day9: 'day-9 notice',
	day15: 'day-15 notice',
	day20: 'day-20 notice',
	lapse_warn: 'lapse warning',
	lapsed: 'lapse notice',
	summary: 'daily summary of update requests',
	client_request: 'update request from the client',
	repaid: 'claim released notice',
	extended: 'due date extended notice',
	unpaid: 'marked unpaid notice',
	settled: 'settlement notice',
};

/** Where each template version's wording lives, so the text can be rebuilt from git. */
export const ES_TEMPLATE_FILES: Record<string, string> = {
	notices: 'src/lib/receivables/copy/notices.ts',
	'client-actions': 'src/lib/receivables/copy/notices.ts',
	'update-requests': 'src/lib/receivables/copy/updateRequests.ts',
};

// ── On the desk and the Client Portal ──────────────────────────────────────────

export const ES_SECTION_TITLE = 'Emails about each claim';
export const ES_SECTION_LEDE =
	'What Almstins emailed about each claim you can see, and when. Download makes a signed statement as of now, with its own Bitcoin timestamp.';
export const ES_CLAIM_LABEL = '{financier}, {amount}';
export const ES_DOWNLOAD = 'Download signed statement';
