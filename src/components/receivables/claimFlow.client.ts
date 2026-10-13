/**
 * Registering a financing claim, for the financing desk and the registry page: post the claim;
 * on a duplicate-financing warning, a missing debtor confirmation or a possible duplicate, show
 * AckPrompt and resubmit the way the person chose; on success, show the note and ask for a
 * Bitcoin timestamp.
 *
 * Almstins warns; the person decides. A claim over the headroom is recorded when the person
 * chooses "Record it anyway" (force:true), and the server signs that acknowledgment into it.
 *
 * Possible duplicate (S4): every claim declares acceptsWarnings: true, so when the receivable
 * matches another record at Almstins (for a verified account, one recorded as financed) the server
 * answers 409 possible_duplicate instead of recording the claim with a notice. The prompt shows
 * what the answer carries (duplicateView: the financed detail only for a verified account), and
 * "Record my claim anyway" sends the claim again with acknowledge: ['possible_duplicate'], which the
 * server signs into it. "Not now" closes the prompt and posts nothing. The server raises one
 * warning per answer, in its order (debtor confirmation, headroom, possible duplicate), so one
 * claim can take up to three prompts; each answer is carried into the next pass. A 200 that still
 * carries notices (the check could not run) says so in the note.
 *
 * A receivable its owner withdrew (S2) answers 410 withdrawn to the claim, or to the diligence
 * acceptance if it was withdrawn while the prompt was open. That is said plainly (copy/withdrawn.ts),
 * never as a prompt, and the page refreshes so the record shows as withdrawn.
 *
 * The page keeps what is page-specific through `host`: its inputs, its note box, its number
 * formats, and what it refreshes afterward. Notes are built from DOM nodes with textContent.
 */
import { askToAcknowledge, ackInputs, closeAck, setAckBusy } from './AckPrompt/ackPrompt.client';
import { anchorAfterWrite } from '@/lib/receivables/client/anchorAfterWrite';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { ANCHOR_TIMESTAMPING, type AnchorAfterWriteCopy } from '@/lib/receivables/copy/anchor';
import { UNKNOWN_ERROR, type ClaimHostCopy } from '@/lib/receivables/copy/claim';
import { WITHDRAWN_CLAIM_NOTE } from '@/lib/receivables/copy/withdrawn';
import {
	CLAIM_DUPLICATE_STILL, CLAIM_NOTICE_ACKNOWLEDGED, CLAIM_NOTICE_POSSIBLE_DUPLICATE, CLAIM_NOTICE_UNAVAILABLE,
} from '@/lib/receivables/copy/duplicate';
import { claimDuplicateLines } from '@/lib/receivables/duplicateView';
import type { AckCode } from '@/lib/receivables/acknowledgments';

const CLAIM_URL = '/api/verify/receivables/claim';
const DILIGENCE_URL = '/api/verify/receivables/diligence-accept';

export type NoteTone = 'info' | 'gain' | 'loss';
export interface ClaimInput { receivableId: string; financier: string; amount: number; date: string | undefined }
export interface ClaimPostResult { body: any; status?: number }
/** Parsed body (plus status when the host has it). null: the host already showed why
 *  (sign-in, demo, network). May throw when the host's copy.unreachable is set. */
export type ClaimPost = (url: string, body: Record<string, unknown>) => Promise<ClaimPostResult | null>;

export interface ClaimHost {
	/** Re-read on every pass, as both pages always did. */
	read(): ClaimInput;
	invalid(input: ClaimInput): string | null;
	/** The page owns its note box. */
	note(tone: NoteTone, nodes: Node[]): void;
	/** Hide the note box while a prompt shows. */
	clear(): void;
	/** Figures in the success note. */
	formatAmount(n: number): string;
	/** Figures in the headroom prompt. */
	formatHeadroom(n: number): string;
	/** "Register only the available ..." writes the amount field. */
	setAmount(value: string): void;
	/** Around the claim post only. */
	busy?(on: boolean): void;
	/** The receivable the diligence acceptance is for, read when the person accepts.
	 *  Default: the receivable of the pass that raised the prompt. */
	diligenceReceivableId?(pass: ClaimInput): string;
	/** Awaited after a failure note: an answer that recorded nothing and asked nothing. Not
	 *  awaited when the answer is the duplicate-financing, the diligence or the possible-duplicate
	 *  prompt: nothing was written, and the prompt has to stay where the person is reading it.
	 *  Their answer runs another pass, which ends in afterSaved or afterNotOk like any other. */
	afterNotOk?(): unknown;
	/** Awaited after the timestamp request. */
	afterSaved?(input: ClaimInput): unknown;
}

/** What the person has already answered on this claim, carried into the next pass. */
export interface ClaimAcks {
	/** "Record it anyway" on the headroom warning. */
	force?: boolean;
	/** Codes acknowledged on a prompt (possible_duplicate). */
	acknowledge?: readonly AckCode[];
}

export interface SubmitClaimOptions {
	root: HTMLElement;
	post: ClaimPost;
	copy: ClaimHostCopy;
	anchor: { statusId: string; copy: AnchorAfterWriteCopy };
	host: ClaimHost;
}

const txt = (s: string): Node => document.createTextNode(s);

/**
 * A prompt answers for the record that raised it. If the page has moved to another record (or
 * the ID was edited) since, the answer posts nothing: "Record it anyway" must never force a
 * claim onto a receivable whose figures the person did not see.
 */
const sameRecord = (host: ClaimHost, input: ClaimInput): boolean => host.read().receivableId === input.receivableId;
function bold(s: string): Node {
	const b = document.createElement('b');
	b.textContent = s;
	return b;
}

export async function submitClaim(o: SubmitClaimOptions, acks: ClaimAcks = {}): Promise<void> {
	const { root, post, copy, host } = o;
	const say = (tone: NoteTone, nodes: Node[]) => { closeAck(root); host.note(tone, nodes); };
	const input = host.read();
	const bad = host.invalid(input);
	if (bad) { say('loss', [txt(bad)]); return; }
	const acknowledge = [...(acks.acknowledge ?? [])];
	if (copy.sending) say('info', [txt(copy.sending)]);
	try {
		let res: ClaimPostResult | null;
		host.busy?.(true);
		try {
			res = await post(CLAIM_URL, {
				receivableId: input.receivableId, financier: input.financier, amount: input.amount, date: input.date,
				force: acks.force === true, acceptsWarnings: true, ...(acknowledge.length ? { acknowledge } : {}),
			});
		} finally {
			host.busy?.(false);
		}
		if (!res) { closeAck(root); return; }
		const j = res.body;
		if (res.status === 401 && copy.sessionEnded) {
			const s = copy.sessionEnded;
			const a = document.createElement('a');
			a.href = s.href;
			a.className = 'rcv-link';
			a.textContent = s.link;
			say('loss', [txt(s.lead), a, txt(s.tail)]);
			return;
		}
		if (j.ok) { await recorded(o, input, j, acknowledge); return; }
		if (j.error === 'withdrawn') {
			say('loss', [txt(WITHDRAWN_CLAIM_NOTE)]);
			await host.afterNotOk?.();
			return;
		}
		if (j.error === 'exceeds_headroom') {
			host.clear();
			void askToAcknowledge(root, [{
				code: 'exceeds_headroom',
				available: host.formatHeadroom(Number(j.available)),
				requested: host.formatHeadroom(input.amount),
				claimed: host.formatHeadroom(Number(j.claimed)),
			}]).then((codes) => {
				if (codes === null) return;
				if (!sameRecord(host, input)) { closeAck(root); return; }
				if (codes.length === 0) host.setAmount(String(j.available));
				return submitClaim(o, { ...acks, force: codes.includes('exceeds_headroom') });
			});
			return;
		}
		if (j.error === 'diligence_required') {
			host.clear();
			void askToAcknowledge(root, [{ code: 'diligence_required' }]).then((codes) => {
				if (codes === null) return;
				if (!sameRecord(host, input)) { closeAck(root); return; }
				return acceptDiligence(o, input, acks);
			});
			return;
		}
		if (j.error === 'possible_duplicate') {
			// Already acknowledged on this claim: never ask the same question twice in a row.
			if (acknowledge.includes('possible_duplicate')) {
				say('loss', [txt(CLAIM_DUPLICATE_STILL)]);
				await host.afterNotOk?.();
				return;
			}
			host.clear();
			void askToAcknowledge(root, [{ code: 'possible_duplicate', lines: claimDuplicateLines(j.duplicateCheck) }]).then((codes) => {
				if (codes === null || !codes.includes('possible_duplicate')) return;
				if (!sameRecord(host, input)) { closeAck(root); return; }
				return submitClaim(o, { ...acks, acknowledge: [...acknowledge, 'possible_duplicate'] });
			});
			return;
		}
		say('loss', [txt(fillCopy(copy.failed, { code: String(j.error || UNKNOWN_ERROR), message: String(j.message || copy.failedFallback) }))]);
		await host.afterNotOk?.();
	} catch (e) {
		if (copy.unreachable === null) throw e;
		say('loss', [txt(copy.unreachable)]);
	}
}

/** What the note adds about the duplicate check: the signed acknowledgment, then any notices. */
function duplicateNotes(j: any, acknowledged: readonly AckCode[]): string[] {
	const notices: unknown[] = Array.isArray(j.notices) ? j.notices : [];
	return [
		...(acknowledged.includes('possible_duplicate') ? [CLAIM_NOTICE_ACKNOWLEDGED] : []),
		...(notices.includes('possible_duplicate') ? [CLAIM_NOTICE_POSSIBLE_DUPLICATE] : []),
		...(notices.includes('duplicate_check_unavailable') ? [CLAIM_NOTICE_UNAVAILABLE] : []),
	];
}

async function recorded(o: SubmitClaimOptions, input: ClaimInput, j: any, acknowledged: readonly AckCode[]): Promise<void> {
	const { root, copy, host, anchor } = o;
	const status = document.createElement('span');
	status.id = anchor.statusId;
	status.textContent = ANCHOR_TIMESTAMPING;
	closeAck(root);
	host.note('gain', [
		bold(fillCopy(copy.doneTitle, { financier: input.financier, signed: j.signed ? copy.doneSigned : '' })),
		txt(' ' + fillCopy(copy.doneBody, {
			claimed: host.formatAmount(Number(j.claimed || 0)),
			available: host.formatAmount(Math.max(0, Number(j.available || 0))),
		})),
		...duplicateNotes(j, acknowledged).map((line) => txt(' ' + line)),
		document.createElement('br'),
		status,
	]);
	await anchorAfterWrite('claim', String(j.claimId), anchor.statusId, anchor.copy);
	await host.afterSaved?.(input);
}

async function acceptDiligence(o: SubmitClaimOptions, input: ClaimInput, acks: ClaimAcks): Promise<void> {
	const { root, post, copy, host } = o;
	const say = (tone: NoteTone, nodes: Node[]) => { closeAck(root); host.note(tone, nodes); };
	const { method, note } = ackInputs(root);
	const receivableId = host.diligenceReceivableId ? host.diligenceReceivableId(input) : input.receivableId;
	let d: ClaimPostResult | null;
	setAckBusy(root, true);
	try {
		d = await post(DILIGENCE_URL, { receivableId, financier: input.financier, method, note: note || undefined });
	} catch (e) {
		if (copy.unreachable === null) throw e;
		say('loss', [txt(copy.unreachable)]);
		return;
	} finally {
		setAckBusy(root, false);
	}
	if (!d) { closeAck(root); return; }
	if (d.body.error === 'withdrawn') {
		say('loss', [txt(WITHDRAWN_CLAIM_NOTE)]);
		await host.afterNotOk?.();
		return;
	}
	if (!d.body.ok) {
		say('loss', [txt(fillCopy(copy.diligenceFailed, {
			detail: String(d.body.message || d.body.error || UNKNOWN_ERROR),
			message: String(d.body.message || copy.diligenceFailedFallback),
		}))]);
		return;
	}
	if (!sameRecord(host, input)) { closeAck(root); return; }
	await submitClaim(o, acks);
}
