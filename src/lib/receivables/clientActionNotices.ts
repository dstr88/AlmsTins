/**
 * Client notices on a lender's action (Part B, approved 2026-11-28) — the pure half: what the
 * client's email says when the lender releases (repaid), extends or flags unpaid a claim against
 * the client's invoice, or the receivable is settled. No database and no clock in here.
 *
 * The rules are the aging notices' (notices.ts): the identifier block (invoice number, amount and
 * currency, the day the claim or record was recorded), no party name, a generic subject, the public
 * check link, the boundary footer and the opt-out line. An email never says more than the public
 * record shows: an extension's new promised date is on the public status history, its reason is
 * the lender's own signed-in record, which the client cannot read either, so the extension email
 * says the reason stays off the public record and carries none.
 * No action buttons: links only.
 */
import { fillCopy } from './fillCopy';
import { formatMoney } from '@/lib/format';
import {
	ACTION_CLIENT_EXTENDED,
	ACTION_CLIENT_REPAID,
	ACTION_CLIENT_SETTLED,
	ACTION_CLIENT_UNPAID,
	ACTION_FACTS,
	ACTION_SUBJECT_CLIENT,
	NOTICE_CLIENT_CHECK,
	NOTICE_FOOTER,
	NOTICE_OPTOUT_LINE,
} from './copy/notices';

export const CLIENT_ACTION_KINDS = ['repaid', 'extended', 'unpaid', 'settled'] as const;
export type ClientActionKind = (typeof CLIENT_ACTION_KINDS)[number];
export function isClientActionKind(x: unknown): x is ClientActionKind {
	return typeof x === 'string' && (CLIENT_ACTION_KINDS as readonly string[]).includes(x);
}

/** How long the daily job keeps retrying a send that failed: past this the news is stale. */
export const CLIENT_ACTION_RETRY_DAYS = 3;

/** The outbox key: one email per action, ever. Settled is per receivable; the others per claim
 *  (repaid) or per signed status event (extended, unpaid: every extension is its own news). */
export function clientActionKey(kind: ClientActionKind, ref: string): string {
	return `${kind}:${ref}`;
}

/** What one action email reads, already resolved by the server half. */
export interface ClientActionDeal {
	receivableId: string;
	invoiceNo: string;
	face: number;
	currency: string;
	/** The claim's recorded day (YMD) for a claim action; the receivable's for settled. */
	recordedDay: string;
	/** The new promised date of an extension (public on the status history), else null. */
	newPromisedDate: string | null;
}

export function buildClientActionEmail(
	kind: ClientActionKind,
	deal: ClientActionDeal,
	base: string,
	opts: { optoutUrl?: string } = {},
): { subject: string; text: string } {
	const origin = base.replace(/\/+$/, '');
	const vars = {
		invoice: deal.invoiceNo,
		facts: fillCopy(ACTION_FACTS, { amount: formatMoney(deal.face, deal.currency) }),
		recorded: deal.recordedDay.slice(0, 10),
		promised: deal.newPromisedDate ?? '',
	};
	const line =
		kind === 'repaid' ? fillCopy(ACTION_CLIENT_REPAID, vars)
		: kind === 'extended' ? fillCopy(ACTION_CLIENT_EXTENDED, vars)
		: kind === 'unpaid' ? fillCopy(ACTION_CLIENT_UNPAID, vars)
		: fillCopy(ACTION_CLIENT_SETTLED, vars);
	const id = encodeURIComponent(deal.receivableId);
	const parts = [line];
	parts.push(fillCopy(NOTICE_CLIENT_CHECK, { url: `${origin}/verify/registry?id=${id}` }));
	parts.push(NOTICE_FOOTER);
	if (opts.optoutUrl) parts.push(fillCopy(NOTICE_OPTOUT_LINE, { url: opts.optoutUrl }));
	return { subject: ACTION_SUBJECT_CLIENT, text: parts.join('\n\n') };
}
