import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RESERVED_STATEMENT_PREFIXES } from '../../src/lib/receivables/attestationClass';
import { RESERVED_PREFIX_MESSAGE } from '../../src/lib/receivables/copy/attest';

/**
 * POST /api/verify/receivables/attest: free-text party statements.
 *   - a statement that opens like a system answer (a reserved word in capitals, or one in any
 *     case followed by a dash) answers 400 reserved_prefix and writes nothing;
 *   - sentence-case prose that happens to open with one of the words is recorded as usual;
 *   - an ordinary statement is recorded with source 'party_statement', under the session's
 *     tenant (a tenantId in the body is ignored);
 *   - the existing 401 / demo 403 / buyer 403 answers are unchanged.
 */

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-a', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
	add: vi.fn<(...a: any[]) => Promise<any>>(),
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/receivablesRegistry', () => ({ addAttestation: (...a: any[]) => mem.add(...a) }));

import { POST } from '../../src/pages/api/verify/receivables/attest';

const RID = 'c0'.repeat(32);
const post = async (body: Record<string, unknown>) => {
	const request = new Request('https://almstins.com/api/verify/receivables/attest', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await (POST as any)({ request });
	return { status: res.status, body: await res.json() };
};

beforeEach(() => {
	mem.session = { tenantId: 'tenant-a', isDemo: false };
	mem.add.mockReset().mockResolvedValue({ ok: true, attestationId: 'att-1', digest: 'd'.repeat(64), signed: false });
});

describe('attest: reserved prefixes', () => {
	const forged = [
		...RESERVED_STATEMENT_PREFIXES.map((p) => `${p} states this invoice is not theirs.`),
		'DISPUTED - hyphen instead of a dash',
		'disputed — lower case',
		'DILIGENCE notes in capitals',
		'  DILIGENCE — leading spaces',
		'​DECLINED — behind a zero-width space',
		'ＵＮＡＮＳＷＥＲＥＤ — full width',
	];
	for (const statement of forged) {
		it(`400 reserved_prefix: ${JSON.stringify(statement.slice(0, 24))}`, async () => {
			const { status, body } = await post({ receivableId: RID, role: 'other', label: 'Lender Co', statement });
			expect(status).toBe(400);
			expect(body).toEqual({ ok: false, error: 'reserved_prefix', message: RESERVED_PREFIX_MESSAGE });
			expect(mem.add).not.toHaveBeenCalled();
		});
	}

	it('applies to every role the endpoint accepts', async () => {
		for (const role of ['supplier', 'inspector', 'other', undefined]) {
			const { status } = await post({ receivableId: RID, role, label: 'X', statement: 'DISPUTED — x' });
			expect(status).toBe(400);
		}
		expect(mem.add).not.toHaveBeenCalled();
	});
});

describe('attest: ordinary statements', () => {
	it('records source party_statement under the session tenant, ignoring a body tenantId', async () => {
		const { status, body } = await post({
			receivableId: RID, role: 'inspector', label: 'Surveyor', statement: 'Inspected 400 cartons.',
			date: '2026-09-30', tenantId: 'tenant-b', source: 'debtor_confirmation',
		});
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, attestationId: 'att-1' });
		expect(mem.add).toHaveBeenCalledTimes(1);
		expect(mem.add).toHaveBeenCalledWith('tenant-a', RID, {
			role: 'inspector', label: 'Surveyor', statement: 'Inspected 400 cartons.', date: '2026-09-30', source: 'party_statement',
		});
	});

	it('sentence-case prose opening with one of the words is recorded as usual', async () => {
		for (const statement of [
			'Diligence visit at Lagos port on 2026-09-18 matched the invoice.',
			'Declined 20 cartons as damaged on arrival.',
			'Disputed amount settled by credit note CN-12.',
			'Unanswered queries resolved by phone.',
		]) {
			mem.add.mockClear();
			const { status } = await post({ receivableId: RID, role: 'inspector', label: 'Surveyor', statement });
			expect(status, statement).toBe(200);
			expect(mem.add.mock.calls[0][2]).toMatchObject({ statement, source: 'party_statement' });
		}
	});

	it('a statement that merely contains a reserved word is fine', async () => {
		const { status } = await post({ receivableId: RID, role: 'supplier', label: 'Acme', statement: 'Goods received; not DISPUTED — all good.' });
		expect(status).toBe(200);
		expect(mem.add.mock.calls[0][2]).toMatchObject({ source: 'party_statement' });
	});

	it('passes the registry answers through as before', async () => {
		mem.add.mockResolvedValue({ ok: false, error: 'not_found', message: 'No receivable found for that ID.' });
		expect((await post({ receivableId: RID, label: 'X', statement: 'Y' })).status).toBe(404);
		mem.add.mockResolvedValue({ ok: false, error: 'invalid', message: 'An attester name and a statement are required.' });
		expect((await post({ receivableId: RID, label: '', statement: '' })).status).toBe(400);
	});
});

describe('attest: unchanged gates', () => {
	it('401 without a session', async () => {
		mem.session = null;
		expect(await post({ receivableId: RID, statement: 'x' })).toEqual({ status: 401, body: { ok: false, error: 'unauthenticated' } });
	});

	it('403 for the demo account', async () => {
		mem.session = { tenantId: 'demo', isDemo: true };
		expect(await post({ receivableId: RID, statement: 'x' })).toEqual({ status: 403, body: { ok: false, error: 'demo_readonly' } });
	});

	it('403 for role buyer, which only a debtor link may write', async () => {
		expect(await post({ receivableId: RID, role: 'buyer', label: 'X', statement: 'Confirms invoice.' }))
			.toEqual({ status: 403, body: { ok: false, error: 'role_requires_token' } });
		expect(mem.add).not.toHaveBeenCalled();
	});
});
