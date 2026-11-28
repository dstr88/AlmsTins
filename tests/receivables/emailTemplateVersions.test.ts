import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import * as notices from '../../src/lib/receivables/copy/notices';
import * as updateRequests from '../../src/lib/receivables/copy/updateRequests';
import { AGING_STATE_LABELS } from '../../src/lib/receivables/copy/aging';
import { ES_TEMPLATE_FILES } from '../../src/lib/receivables/copy/emailStatement';
import { templateFile } from '../../src/lib/receivables/emailStatement';

/**
 * Email template versions (email statement, approved 2026-11-28). Each send writes the version of
 * the template it used, and a signed statement names that version so the wording can be rebuilt
 * from git. That only holds if the version moves whenever the wording does: this pins a hash of
 * every string each version covers. When one fails, the email wording changed: bump that
 * *_TEMPLATE_VERSION constant and update its pin here, in the same change.
 */

const hashOf = (mod: Record<string, unknown>, names: readonly string[]) =>
	createHash('sha256').update(JSON.stringify(names.map((n) => [n, mod[n]]))).digest('hex').slice(0, 16);

const NOTICE_STRINGS = [
	'NOTICE_SUBJECT_LENDER', 'NOTICE_SUBJECT_CLIENT', 'NOTICE_SUBJECT_FREE_LOCKED', 'NOTICE_FACTS_DATED',
	'NOTICE_FACTS_UNDATED', 'NOTICE_LENDER_DEAL', 'NOTICE_LENDER_DAY9', 'NOTICE_LENDER_DAY15', 'NOTICE_LENDER_DAY20',
	'NOTICE_LENDER_LAPSE_WARN', 'NOTICE_LENDER_LAPSED', 'NOTICE_LENDER_FREE_LOCKED', 'NOTICE_CLIENT_DAY15',
	'NOTICE_CLIENT_DAY20', 'NOTICE_CLIENT_LAPSED', 'NOTICE_LENDER_OPEN', 'NOTICE_LENDER_DESK', 'NOTICE_CLIENT_CHECK',
	'NOTICE_FOOTER', 'NOTICE_OPTOUT_LINE',
] as const;
const ACTION_STRINGS = [
	'ACTION_SUBJECT_CLIENT', 'ACTION_FACTS', 'ACTION_CLIENT_REPAID', 'ACTION_CLIENT_EXTENDED', 'ACTION_CLIENT_UNPAID',
	'ACTION_CLIENT_SETTLED', 'NOTICE_CLIENT_CHECK', 'NOTICE_FOOTER', 'NOTICE_OPTOUT_LINE',
] as const;
/** The request emails also embed the notices' deal block and the public aging labels. */
const UR_SHARED = ['NOTICE_FACTS_DATED', 'NOTICE_FACTS_UNDATED', 'NOTICE_FOOTER', 'NOTICE_LENDER_DEAL', 'NOTICE_LENDER_OPEN'] as const;
const UR_STRINGS = [
	'UR_SUBJECT_CLIENT', 'UR_SUBJECT_SUMMARY', 'UR_EMAIL_CLIENT', 'UR_EMAIL_CLIENT_NOTE', 'UR_EMAIL_SUMMARY_LEAD',
	'UR_EMAIL_SUMMARY_ITEM', 'UR_EMAIL_ANSWER',
] as const;

describe('email template versions move with their wording', () => {
	it('every string a version covers exists', () => {
		for (const n of [...NOTICE_STRINGS, ...ACTION_STRINGS]) expect(typeof (notices as Record<string, unknown>)[n], n).toBe('string');
		for (const n of UR_STRINGS) expect(typeof (updateRequests as Record<string, unknown>)[n], n).toBe('string');
	});

	it('pins each version to its wording', () => {
		const pins = {
			[notices.NOTICE_TEMPLATE_VERSION]: hashOf(notices, NOTICE_STRINGS),
			[notices.ACTION_TEMPLATE_VERSION]: hashOf(notices, ACTION_STRINGS),
			[updateRequests.UR_TEMPLATE_VERSION]: hashOf(
				{ ...updateRequests, ...Object.fromEntries(UR_SHARED.map((n) => [n, (notices as Record<string, unknown>)[n]])), AGING_STATE_LABELS },
				[...UR_STRINGS, ...UR_SHARED, 'AGING_STATE_LABELS'],
			),
		};
		expect(pins).toEqual({
			'notices/1': '2afbaf174efa97e4',
			'client-actions/1': '727b342731c4fd41',
			'update-requests/1': '9155e5909641c97d',
		});
	});

	it('every version names the file its wording lives in', () => {
		for (const v of [notices.NOTICE_TEMPLATE_VERSION, notices.ACTION_TEMPLATE_VERSION, updateRequests.UR_TEMPLATE_VERSION]) {
			expect(templateFile(v), v).toBeTruthy();
		}
		expect(Object.keys(ES_TEMPLATE_FILES).sort()).toEqual(['client-actions', 'notices', 'update-requests']);
	});
});
