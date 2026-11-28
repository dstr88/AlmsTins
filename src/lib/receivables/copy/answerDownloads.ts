/**
 * Copy for an answered emailed request (receivables downloads, Part B): the panel the debtor or
 * the client sees when they open a link they have already answered, or right after answering.
 * Pure and import-free, like the other copy modules.
 */

export const ANSWERED_TITLE = 'You answered this request';
export const ANSWERED_LEDE =
	'Keep a copy of your answer, and of the receivable it is about. Each file carries its Almstins signature and Bitcoin timestamp, so anyone can check it at almstins.com/verify-record, or offline without Almstins.';
export const DOWNLOAD_ANSWER = 'Download your answer';
export const DOWNLOAD_RECEIVABLE = 'Download the receivable';
/** {date}: the last day the link reads, YYYY-MM-DD. */
export const ANSWERED_UNTIL =
	'Anyone with this link can download these two files until {date}. It can’t be used to answer again.';
export const ANSWERED_DONE = 'Done';
/** {date}: the day downloads closed. */
export const ANSWERED_CLOSED = 'Downloads from this link closed on {date}. Ask whoever sent it for a copy.';
