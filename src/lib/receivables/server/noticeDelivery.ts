/**
 * Aging-notice delivery (A4 / D8) — the daily pass the cron endpoint runs. Marries the pure
 * schedule (notices.ts: which notices are due) to the registry's IO (candidates, the notice
 * log, the suppression flags, the client address) and the existing sendMail() transport.
 *
 * Rules enforced here, in order:
 *   - idempotency: a (claim, notice, recipient) already in receivable_notice_log is never
 *     prepared again — one email per claim per notice per recipient, ever. The log row is
 *     written only AFTER the send succeeded, so a failed send retries on the next run.
 *   - practice records: an isTest claim sends NOTHING, to either side — a test deal must never
 *     email a real address. The desk inbox still shows it, marked TEST (that path is
 *     listNeedsUpdate, not this one).
 *   - addresses: the lender is the claim's own tenant (resolveAlertRecipient — alert_email,
 *     else the account email). The client comes ONLY from the record's own flow
 *     (clientNoticeTarget: the accepted borrower account, else the banker-entered invite
 *     address); when neither exists the client side is skipped silently.
 *   - suppression: a client address that opted out gets nothing, checked before every send;
 *     every client email carries the opt-out link that sets that flag. Lender notices are
 *     account mail about his own claim and carry no opt-out — his opt-out is updating the
 *     record, which stops the schedule at the source.
 *   - digest: one email per recipient per run — every qualifying claim becomes one block in
 *     that email, so a neglectful lender's client is informed, not flooded.
 */
import { sendMail } from '@/lib/email';
import { resolveAlertRecipient } from '@/lib/verifyAlertRecipient';
import {
	clientNoticeTarget,
	listAgingNoticeCandidates,
	listSentNotices,
	noticeOptoutFor,
	recordNoticeSent,
} from '@/lib/receivablesRegistry';
import {
	buildNoticeEmail,
	dueNotices,
	noticeBlock,
	NOTICE_RECIPIENTS,
	type NoticeKind,
	type NoticeRole,
} from '@/lib/receivables/notices';

export interface NoticeRunCounts {
	/** Active claims the pass looked at. */
	candidates: number;
	/** (claim, notice, recipient) pairs due today and not yet in the log. */
	due: number;
	/** Digest emails that went out. */
	sent: number;
	/** Log rows written (one per claim × notice × recipient that was sent). */
	logged: number;
	/** Pairs dropped because the claim is a practice record (isTest). */
	skippedTest: number;
	/** Pairs dropped for want of an address — silent by design. */
	skippedNoAddress: number;
	/** Client pairs dropped because the address opted out. */
	suppressed: number;
	/** Digest emails whose send threw; nothing was logged, so the next run retries them. */
	failed: number;
}

interface Bucket {
	role: NoticeRole;
	email: string;
	blocks: string[];
	log: Array<{ claimId: string; notice: NoticeKind }>;
	optoutUrl?: string;
}

const baseUrl = (): string => (process.env.AUTH_URL ?? 'https://almstins.com').replace(/\/+$/, '');

export async function runAgingNotices(now: Date = new Date()): Promise<NoticeRunCounts> {
	const counts: NoticeRunCounts = {
		candidates: 0, due: 0, sent: 0, logged: 0,
		skippedTest: 0, skippedNoAddress: 0, suppressed: 0, failed: 0,
	};
	const base = baseUrl();
	const candidates = await listAgingNoticeCandidates(now);
	counts.candidates = candidates.length;
	if (!candidates.length) return counts;

	const alreadySent = await listSentNotices(candidates.map((c) => c.claimId));

	// Resolved per run, once per tenant / receivable / address.
	const lenderEmail = new Map<string, string | null>();
	const clientEmail = new Map<string, string | null>();
	const optout = new Map<string, { token: string; suppressed: boolean }>();
	const buckets = new Map<string, Bucket>();

	const resolveLender = async (tenantId: string): Promise<string | null> => {
		if (!lenderEmail.has(tenantId)) lenderEmail.set(tenantId, (await resolveAlertRecipient(tenantId)).email);
		return lenderEmail.get(tenantId) ?? null;
	};
	const resolveClient = async (receivableId: string): Promise<string | null> => {
		if (!clientEmail.has(receivableId)) {
			const target = await clientNoticeTarget(receivableId);
			clientEmail.set(
				receivableId,
				target === null ? null
				: target.kind === 'email' ? target.email
				: (await resolveAlertRecipient(target.tenantId)).email,
			);
		}
		return clientEmail.get(receivableId) ?? null;
	};

	for (const c of candidates) {
		for (const notice of dueNotices(c, now)) {
			for (const role of NOTICE_RECIPIENTS[notice]) {
				if (alreadySent.has(`${c.claimId}|${notice}|${role}`)) continue;
				counts.due++;
				// A practice record reaches no inbox, on either side.
				if (c.isTest) { counts.skippedTest++; continue; }

				const email = role === 'lender' ? await resolveLender(c.lenderTenantId) : await resolveClient(c.receivableId);
				if (!email) { counts.skippedNoAddress++; continue; }

				let optoutUrl: string | undefined;
				if (role === 'client') {
					const key = email.trim().toLowerCase();
					if (!optout.has(key)) optout.set(key, await noticeOptoutFor(key));
					const o = optout.get(key)!;
					if (o.suppressed) { counts.suppressed++; continue; }
					optoutUrl = `${base}/api/verify/receivables/notice-optout?token=${encodeURIComponent(o.token)}`;
				}

				const block = noticeBlock(notice, role, c, base, now);
				if (!block) continue; // a pair the schedule never sends; NOTICE_RECIPIENTS already keeps this out
				const key = `${role}|${email.trim().toLowerCase()}`;
				const bucket = buckets.get(key) ?? { role, email, blocks: [], log: [] };
				if (!buckets.has(key)) buckets.set(key, bucket);
				bucket.blocks.push(block);
				bucket.log.push({ claimId: c.claimId, notice });
				if (optoutUrl) bucket.optoutUrl = optoutUrl;
			}
		}
	}

	for (const bucket of buckets.values()) {
		const { subject, text } = buildNoticeEmail(bucket.role, bucket.blocks, { optoutUrl: bucket.optoutUrl });
		try {
			await sendMail({ to: bucket.email, subject, text });
		} catch (err) {
			counts.failed++;
			console.error('[receivables-notices] send failed:', (err as Error)?.message ?? err);
			continue; // nothing logged: the next run retries this recipient's pairs
		}
		counts.sent++;
		for (const row of bucket.log) {
			await recordNoticeSent(row.claimId, row.notice, bucket.role, now);
			counts.logged++;
		}
	}
	return counts;
}
