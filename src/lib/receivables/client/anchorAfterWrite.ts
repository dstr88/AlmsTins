/**
 * After a write, asks the server to timestamp the new record and says how it went in the
 * element with id statusId. Best effort: the record is already written and signed.
 *
 * A plain fetch, never a page's auth-aware POST, so a 401 or 502 here cannot replace the note
 * that holds the status line. statusId is looked up after the answer arrives, as every page did
 * before this module existed: when the note was replaced in the meantime, the answer is dropped.
 * copy.unreachable null leaves the line as it was. The fetch is issued synchronously on call,
 * so `void anchorAfterWrite(...)` keeps a fire-and-forget caller's ordering. Never throws.
 */
import type { AnchorAfterWriteCopy } from '@/lib/receivables/copy/anchor';
import type { PageAnchorKind } from '@/lib/receivables/anchorView';

export type AnchorAfterWriteOutcome = 'submitted' | 'not_submitted' | 'unreachable';

export async function anchorAfterWrite(kind: PageAnchorKind, id: string, statusId: string, copy: AnchorAfterWriteCopy): Promise<AnchorAfterWriteOutcome> {
	let outcome: AnchorAfterWriteOutcome;
	try {
		const a = await (await fetch('/api/verify/receivables/anchor', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind, id }),
		})).json();
		outcome = a && a.ok ? 'submitted' : 'not_submitted';
	} catch {
		outcome = 'unreachable';
	}
	const text = outcome === 'submitted' ? copy.submitted : outcome === 'not_submitted' ? copy.notSubmitted : copy.unreachable;
	const el = document.getElementById(statusId);
	if (el && text !== null) el.textContent = text;
	return outcome;
}
