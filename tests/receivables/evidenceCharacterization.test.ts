import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * Characterization of the registry evidence paths the receivables S0b slice touches, written and
 * run green against the ORIGINAL registry before it changed:
 *   - sign(), through createReceivable: the stored signature's shape and values;
 *   - reverifyReceivable's integrity check, for every outcome it had;
 *   - dischargeClaim and settleReceivable: what they store and what they return;
 *   - getRecordForAnchor / setRecordAnchor tenant scoping, and listPendingAnchors' answer.
 * S0b may ADD to these (kept discharge and settlement signatures, retired keys), and the one
 * assertion it changes on purpose is marked where it lives.
 *
 * Runs the registry's real SQL against tests/helpers/receivablesDbFake.ts. No network: nothing
 * here stamps.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
let fake: ReceivablesDbFake;
let reg: Registry;

const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const PUB_A = 'e6affd1a7c9d0f4d874d4883c67b9252313af956180eab8458c05bc72f0b8455';
const KID_A = 'almstins-9a753ae29c493b1c';
const SEED_B = '1b2c3d4e5f60718293a4b5c6d7e8f9010203040506070809a0b0c0d0e0f01112';

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const INPUT = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', dueDate: '2026-12-01' };
const RID = '54f86f6f10eaebcd828ba5c571b86361fdd0d198823db730d20011abc498f0e1';

const sha = (obj: unknown) => createHash('sha256').update(canonicalize(obj)!, 'utf8').digest('hex');

beforeEach(async () => {
	vi.resetModules();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-10T12:34:56.000Z'));
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

const integrity = async () => {
	const r = await reg.reverifyReceivable(LENDER, RID, { persist: false });
	if (!r.ok) throw new Error('reverify not found');
	return r.checks.find((c) => c.key === 'integrity')!;
};

describe('sign(), through createReceivable (pinned)', () => {
	it('stores the signature with the key ID and public key of the seed that signed', async () => {
		const r = await reg.createReceivable(OWNER, INPUT);
		expect(r).toEqual({ ok: true, id: RID, digest: RID, signed: true, keyId: KID_A });
		const row = fake.rows('receivables')[0];
		expect(JSON.parse(row.signature_json)).toEqual({
			keyId: KID_A, alg: 'Ed25519',
			signatureHex: 'c79b5ed33bcb9cc58ff48feb964622a10bcc7bb32e97bfafa5e8743d4e0981f195bfaff66bbee5e5c840ce419bca4d3044cac67bf13b8809afedd1532902f80e',
			publicKeyHex: PUB_A,
		});
		expect(Object.keys(JSON.parse(row.signature_json))).toEqual(['keyId', 'alg', 'signatureHex', 'publicKeyHex']);
	});

	it('stores no signature when no key is configured', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		const r = await reg.createReceivable(OWNER, INPUT);
		expect(r).toEqual({ ok: true, id: RID, digest: RID, signed: false, keyId: null });
		expect(fake.rows('receivables')[0].signature_json).toBeNull();
	});
});

describe('reverifyReceivable integrity (pinned)', () => {
	it('passes for a record signed by the current key', async () => {
		await reg.createReceivable(OWNER, INPUT);
		expect(await integrity()).toEqual({
			key: 'integrity', label: 'Record integrity', state: 'pass',
			detail: 'Signature verifies and the record is unchanged since it was signed.',
		});
	});

	it('fails for a record signed by a key that is not the current one', async () => {
		await reg.createReceivable(OWNER, INPUT);
		vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_B);
		const c = await integrity();
		expect(c.state).toBe('fail');
		// S0b changes this detail on purpose (any published key passes; the message names that).
		expect(c.detail).toMatch(/^Signed by a key that is not (the current Almstins key|a published Almstins key)\.$/);
	});

	it('fails when the stored digest no longer matches', async () => {
		await reg.createReceivable(OWNER, INPUT);
		fake.rows('receivables')[0].digest = 'f'.repeat(64);
		expect(await integrity()).toMatchObject({ state: 'fail', detail: 'The stored record no longer matches its signed fingerprint.' });
	});

	it('fails when the signature does not verify', async () => {
		await reg.createReceivable(OWNER, INPUT);
		const row = fake.rows('receivables')[0];
		const sig = JSON.parse(row.signature_json);
		row.signature_json = JSON.stringify({ ...sig, signatureHex: '00'.repeat(64) });
		expect(await integrity()).toMatchObject({ state: 'fail', detail: 'The signature does not verify.' });
	});

	it('fails for an unsigned record', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		await reg.createReceivable(OWNER, INPUT);
		vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
		expect(await integrity()).toMatchObject({ state: 'fail', detail: 'The record is not signed, so it cannot be re-verified against a key.' });
	});

	// INTENTIONAL CHANGE (S0b review): the original code passed a self-consistent signature when
	// the server had no key configured, since there was nothing to compare the signer against.
	// Any key can make a self-consistent signature, so with no published key the check is now a
	// caution ('warn', verdict 'attention'), never a pass. Pinned here so the change is visible.
	it('warns (was: passed) on a self-consistent signature when the server has no key configured', async () => {
		await reg.createReceivable(OWNER, INPUT);
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		expect((await integrity()).state).toBe('warn');
	});
});

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', terms: null, due_date: null, acknowledged_at: null, rtype: null,
		payment_method: null, details_json: null, is_test: false, manifest_json: '{}', signature_json: null,
		digest: 'd'.repeat(64), anchor_json: null, settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}
function seedClaim(id: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id, receivable_id: RID, tenant_id: LENDER, financier: 'Lender Co', amount: 400, currency: 'USD',
		claim_date: '2026-09-02', status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, discharged_at: null, discharge_json: null,
		discharge_digest: null, discharge_reason: null, affirmed_at: null, affirmed_by: null,
		created_at: '2026-09-02 10:00:00',
		...over,
	});
}

describe('dischargeClaim (pinned)', () => {
	beforeEach(async () => { await reg.ensureReceivablesTables(); seedReceivable(); });

	it('signs a dated discharge and stores the manifest, digest and reason', async () => {
		seedClaim('claim-1');
		const r = await reg.dischargeClaim(LENDER, ' claim-1 ', 'wire received Oct 9');
		const manifest = {
			v: 1, kind: 'claim_discharge', receivableId: RID, claimId: 'claim-1', financier: 'Lender Co',
			amount: 400, currency: 'USD', dischargedAt: '2026-10-10', reason: 'wire received Oct 9',
		};
		expect(r).toEqual({ ok: true, digest: sha(manifest), signed: true, claimed: 0, available: 1000, face: 1000 });
		const row = fake.rows('receivable_claims')[0];
		expect(row).toMatchObject({
			status: 'discharged', discharged_at: '2026-10-10', discharge_digest: sha(manifest),
			discharge_reason: 'wire received Oct 9',
		});
		expect(JSON.parse(row.discharge_json)).toEqual(manifest);
	});

	it('omits a blank reason from the manifest', async () => {
		seedClaim('claim-1');
		await reg.dischargeClaim(LENDER, 'claim-1');
		const row = fake.rows('receivable_claims')[0];
		expect(JSON.parse(row.discharge_json)).not.toHaveProperty('reason');
		expect(row.discharge_reason).toBeNull();
	});

	it("another tenant's claim is not_found, and nothing changes", async () => {
		seedClaim('claim-1');
		expect(await reg.dischargeClaim(OWNER, 'claim-1')).toMatchObject({ ok: false, error: 'not_found' });
		expect(fake.rows('receivable_claims')[0].status).toBe('active');
	});

	it('a discharged claim answers already_discharged', async () => {
		seedClaim('claim-1', { status: 'discharged' });
		expect(await reg.dischargeClaim(LENDER, 'claim-1')).toMatchObject({ ok: false, error: 'already_discharged' });
	});
});

describe('settleReceivable (pinned)', () => {
	beforeEach(async () => { await reg.ensureReceivablesTables(); });

	it('signs a dated settlement and stores the manifest and digest', async () => {
		seedReceivable();
		const r = await reg.settleReceivable(OWNER, ` ${RID} `);
		const manifest = { v: 1, kind: 'receivable_settlement', receivableId: RID, invoiceNo: 'INV-0042', face: 1000, currency: 'USD', settledAt: '2026-10-10' };
		expect(r).toEqual({ ok: true, digest: sha(manifest), signed: true, settledAt: '2026-10-10' });
		const row = fake.rows('receivables')[0];
		expect(row).toMatchObject({ settled_at: '2026-10-10', settlement_digest: sha(manifest) });
		expect(JSON.parse(row.settlement_json)).toEqual(manifest);
	});

	it("another tenant's receivable is not_found; a settled one is already_settled", async () => {
		seedReceivable();
		expect(await reg.settleReceivable(LENDER, RID)).toMatchObject({ ok: false, error: 'not_found' });
		fake.rows('receivables')[0].settled_at = '2026-10-01';
		expect(await reg.settleReceivable(OWNER, RID)).toMatchObject({ ok: false, error: 'already_settled' });
	});
});

describe('anchor records (pinned)', () => {
	const PENDING = JSON.stringify({ type: 'opentimestamps', digest: 'aa', receipt: 'cA==', anchoredAt: null });
	const DONE = JSON.stringify({ type: 'opentimestamps', digest: 'bb', receipt: 'cA==', anchoredAt: '2026-10-01T00:00:00.000Z' });

	beforeEach(async () => { await reg.ensureReceivablesTables(); });

	it('getRecordForAnchor and setRecordAnchor are scoped to the owning tenant', async () => {
		seedReceivable();
		seedClaim('claim-1');
		expect(await reg.getRecordForAnchor(OWNER, 'receivable', RID)).toEqual({ digest: 'd'.repeat(64), anchorJson: null });
		expect(await reg.getRecordForAnchor(LENDER, 'receivable', RID)).toBeNull();
		expect(await reg.getRecordForAnchor(OWNER, 'claim', 'claim-1')).toBeNull();
		expect(await reg.getRecordForAnchor(LENDER, 'claim', ' claim-1 ')).toEqual({ digest: 'e'.repeat(64), anchorJson: null });

		await reg.setRecordAnchor(OWNER, 'claim', 'claim-1', PENDING);
		expect(fake.rows('receivable_claims')[0].anchor_json).toBeNull();
		await reg.setRecordAnchor(LENDER, 'claim', 'claim-1', PENDING);
		expect(fake.rows('receivable_claims')[0].anchor_json).toBe(PENDING);
	});

	it('listPendingAnchors returns every pending receipt with its tenant, and skips confirmed ones', async () => {
		seedReceivable({ anchor_json: PENDING });
		seedClaim('claim-1', { anchor_json: PENDING });
		seedClaim('claim-2', { anchor_json: DONE });
		seedClaim('claim-3');
		fake.seed('receivable_attestations', {
			id: 'att-1', receivable_id: RID, tenant_id: OWNER, role: 'buyer', label: 'Bigco', statement: 'Owes it.',
			attested_at: '2026-09-03', manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64),
			anchor_json: PENDING, created_at: '2026-09-03 10:00:00',
		});
		const out = await reg.listPendingAnchors();
		expect(out).toHaveLength(3);
		expect(out).toEqual(expect.arrayContaining([
			{ kind: 'receivable', id: RID, tenantId: OWNER, anchorJson: PENDING },
			{ kind: 'claim', id: 'claim-1', tenantId: LENDER, anchorJson: PENDING },
			{ kind: 'attestation', id: 'att-1', tenantId: OWNER, anchorJson: PENDING },
		]));
		expect(await reg.listPendingAnchors(2)).toHaveLength(2);
	});
});
