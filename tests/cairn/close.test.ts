import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The work paper's close and the funder's payment record (receivables tier T5, D13 and D14), end to
 * end through the registry against the db fake: completed needs the inspector's attestation on the
 * final milestone AND the funder's record of its tranche paid; terminated and abandoned take the
 * funder's signature alone; a closed project stays fully readable, frees the account's contract
 * slot, takes nothing new, and nothing on it ever expires. Signing seed set; the Bitcoin stamp fails
 * quietly, as the code allows. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-funder', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/owner', () => ({
	OWNER_TENANT_ID: 'tenant-owner',
	isOwner: (t: unknown) => String(t ?? '').toLowerCase() === 'tenant-owner',
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('no stamping in this suite'); }
		async upgrade(): Promise<never> { throw new Error('no upgrading in this suite'); }
	},
}));

let fake: ReceivablesDbFake;
let cairn: typeof import('../../src/lib/cairnRegistry');
let ent: typeof import('../../src/lib/receivables/server/entitlements');

const FUNDER = 'tenant-funder';
const OTHER = 'tenant-other';
const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const NOW = new Date('2026-11-08T12:00:00Z');

let msSeq = 0;
function seedMilestone(projectId: string, tenantId: string, over: Record<string, unknown> = {}) {
	msSeq++;
	return fake.seed('cairn_milestones', {
		id: `ms-${msSeq}`, project_id: projectId, tenant_id: tenantId, seq: msSeq, title: `Stage ${msSeq}`,
		description: null, tranche_amount: 300_000, target_date: '2026-10-01', status: 'pending',
		manifest_json: '{}', signature_json: null, digest: '0'.repeat(64), anchor_json: null,
		created_at: '2026-09-05 10:00:00', paid_at: null, paid_amount: null,
		...over,
	});
}

/** A sealed project with `n` milestones, through createProject and sealProject (the real writes). */
async function sealedProject(tenantId = FUNDER, n = 2, isTest = false): Promise<{ id: string; milestones: string[] }> {
	// Room for every tranche: the seal refuses a schedule that promises more than the project total.
	const created = await cairn.createProject(tenantId, { name: 'Ring road, section 2', counterparty: 'Works Ltd', totalValue: 300_000 * Math.max(n, 1) + 100_000, currency: 'NGN', isTest });
	expect(created.ok).toBe(true);
	const milestones: string[] = [];
	for (let i = 0; i < n; i++) milestones.push(seedMilestone(created.id!, tenantId).id as string);
	const sealed = await cairn.sealProject(tenantId, created.id!);
	expect(sealed.ok).toBe(true);
	return { id: created.id!, milestones };
}

const row = (table: string, id: string) => fake.rows(table).find((r) => r.id === id)!;
const attest = (milestoneId: string) => { row('cairn_milestones', milestoneId).status = 'attested'; };

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	mem.session = { tenantId: FUNDER, isDemo: false };
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	msSeq = 0;
	const reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
	cairn = await import('../../src/lib/cairnRegistry');
	await cairn.ensureCairnTables();
	ent = await import('../../src/lib/receivables/server/entitlements');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('the funder records a tranche paid', () => {
	it('needs a name, needs the inspector first, then signs once in the funder role and marks the milestone', async () => {
		const { milestones: [m1] } = await sealedProject();
		expect(await cairn.acknowledgeTranche(FUNDER, m1, { by: '' }, NOW)).toMatchObject({ ok: false, error: 'name_required' });
		expect(await cairn.acknowledgeTranche(FUNDER, m1, { by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'not_attested' });
		attest(m1);
		const paid = await cairn.acknowledgeTranche(FUNDER, m1, { by: 'Ama Mensah', note: 'Wire 4411' }, NOW);
		expect(paid).toMatchObject({ ok: true, milestoneId: m1, signed: true, anchored: false, paidAt: '2026-11-08 12:00:00' });
		const att = fake.rows('cairn_attestations').find((a) => a.milestone_id === m1)!;
		expect(att).toMatchObject({ role: 'funder', attested_by: 'Ama Mensah', attested_at: '2026-11-08', tenant_id: FUNDER });
		expect(att.statement).toMatch(/^PAID\. The funder records the tranche for milestone 1, "Stage 1" as paid on 2026-11-08 \(300000 NGN\)\. Note: Wire 4411\. Recorded by Ama Mensah/);
		expect(att.signature_json).toBeTruthy();
		expect(JSON.parse(att.manifest_json)).toMatchObject({ kind: 'cairn_tranche_paid', role: 'funder', by: 'Ama Mensah', amount: 300000, currency: 'NGN' });
		expect(row('cairn_milestones', m1)).toMatchObject({ paid_at: '2026-11-08 12:00:00', paid_amount: 300000, status: 'attested' });
		expect(await cairn.acknowledgeTranche(FUNDER, m1, { by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'already_paid' });
	});

	it('is scoped to the owner and refused on a draft', async () => {
		const { milestones: [m1] } = await sealedProject();
		attest(m1);
		expect(await cairn.acknowledgeTranche(OTHER, m1, { by: 'Someone' }, NOW)).toMatchObject({ ok: false, error: 'not_found' });
		const draft = await cairn.createProject(FUNDER, { name: 'Draft', counterparty: 'Works Ltd', totalValue: 10, currency: 'NGN' });
		const d1 = seedMilestone(draft.id!, FUNDER, { status: 'attested' }).id as string;
		expect(await cairn.acknowledgeTranche(FUNDER, d1, { by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'draft' });
	});
});

describe('the close (D13, D14)', () => {
	it('completed is refused without the inspector on the final milestone, then without the funder\'s payment record, then accepted', async () => {
		const { id, milestones: [m1, m2] } = await sealedProject();
		attest(m1);
		await cairn.acknowledgeTranche(FUNDER, m1, { by: 'Ama Mensah' }, NOW);
		expect(await cairn.closeProject(FUNDER, id, { kind: 'completed', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'final_milestone_unattested' });
		attest(m2);
		expect(await cairn.closeProject(FUNDER, id, { kind: 'completed', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'final_tranche_unpaid' });
		await cairn.acknowledgeTranche(FUNDER, m2, { by: 'Ama Mensah' }, NOW);
		const closed = await cairn.closeProject(FUNDER, id, { kind: 'completed', by: 'Ama Mensah' }, NOW);
		expect(closed).toMatchObject({ ok: true, kind: 'completed', signed: true, anchored: false, closedAt: '2026-11-08 12:00:00' });
		const c = fake.rows('cairn_closures')[0];
		expect(c).toMatchObject({ project_id: id, tenant_id: FUNDER, kind: 'completed', signer_role: 'funder', signed_by: 'Ama Mensah', created_at: '2026-11-08 12:00:00' });
		expect(c.statement).toMatch(/^COMPLETED\. The funder closes "Ring road, section 2" as completed/);
		expect(c.statement).toContain('Signed by Ama Mensah, funder, on 2026-11-08.');
		expect(JSON.parse(c.manifest_json)).toMatchObject({ kind: 'cairn_closure', closeKind: 'completed', signerRole: 'funder', milestones: [{ seq: 1, status: 'attested', paid: true }, { seq: 2, status: 'attested', paid: true }] });
		expect(row('cairn_projects', id)).toMatchObject({ closed_at: '2026-11-08 12:00:00', close_kind: 'completed' });
	});

	it('terminated and abandoned are the funder\'s statement alone, with the note in the words; a second close is refused', async () => {
		const a = await sealedProject();
		const terminated = await cairn.closeProject(FUNDER, a.id, { kind: 'terminated', by: 'Ama Mensah', note: 'Contractor left site in October' }, NOW);
		expect(terminated).toMatchObject({ ok: true, kind: 'terminated' });
		const c = fake.rows('cairn_closures').find((x) => x.project_id === a.id)!;
		expect(c.statement).toMatch(/^TERMINATED — Contractor left site in October\. The funder closes/);
		expect(c.statement).toContain("This is the funder's statement; the other party may dispute it.");
		expect(c.signer_role).toBe('funder');
		expect(await cairn.closeProject(FUNDER, a.id, { kind: 'abandoned', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'already_closed' });

		const b = await sealedProject();
		expect(await cairn.closeProject(FUNDER, b.id, { kind: 'abandoned', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: true, kind: 'abandoned' });
		expect(fake.rows('cairn_closures').find((x) => x.project_id === b.id)!.statement).toMatch(/^ABANDONED\. The funder closes/);
	});

	it('refuses an unknown kind, a missing name, a draft, and another tenant\'s project', async () => {
		const { id } = await sealedProject();
		expect(await cairn.closeProject(FUNDER, id, { kind: 'expired', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'invalid_kind' });
		expect(await cairn.closeProject(FUNDER, id, { kind: 'terminated', by: '  ' }, NOW)).toMatchObject({ ok: false, error: 'name_required' });
		expect(await cairn.closeProject(OTHER, id, { kind: 'terminated', by: 'Someone' }, NOW)).toMatchObject({ ok: false, error: 'not_found' });
		const draft = await cairn.createProject(FUNDER, { name: 'Draft', counterparty: 'Works Ltd', totalValue: 10, currency: 'NGN' });
		expect(await cairn.closeProject(FUNDER, draft.id!, { kind: 'terminated', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'draft' });
		expect(fake.rows('cairn_closures')).toHaveLength(0);
	});

	it('a closed project stays fully readable with its close, frees the contract slot, and takes nothing new', async () => {
		const { id, milestones: [m1, m2] } = await sealedProject();
		const invite = await cairn.createInspectorInvite(FUNDER, { projectId: id, milestoneId: m2 });
		expect(invite.ok).toBe(true);
		expect(await ent.countContracts(FUNDER)).toEqual({ claims: 0, projects: 1, total: 1 });
		expect((await ent.gateNewContract(FUNDER)).ok).toBe(false);

		await cairn.closeProject(FUNDER, id, { kind: 'terminated', by: 'Ama Mensah', note: 'Funding withdrawn' }, NOW);

		const read = await cairn.getProjectForOwner(FUNDER, id);
		expect(read).not.toBeNull();
		expect(read!.project).toMatchObject({ closedAt: '2026-11-08 12:00:00', closeKind: 'terminated', sealedAt: expect.any(String) });
		expect(read!.milestones).toHaveLength(2);
		expect(read!.closure).toMatchObject({ kind: 'terminated', signerRole: 'funder', by: 'Ama Mensah', closedAt: '2026-11-08 12:00:00', signed: true, anchored: false });
		// (listProjects is not exercised here: its COUNT(*) subquery is outside the db fake's SQL.)

		expect(await ent.countContracts(FUNDER)).toEqual({ claims: 0, projects: 0, total: 0 });
		expect((await ent.gateNewContract(FUNDER)).ok).toBe(true);

		expect(fake.rows('cairn_invites')[0].revoked_at).toBe('2026-11-08 12:00:00');
		expect(await cairn.createInspectorInvite(FUNDER, { projectId: id, milestoneId: m1 })).toEqual({ ok: false, error: 'closed' });
		attest(m1);
		expect(await cairn.acknowledgeTranche(FUNDER, m1, { by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: false, error: 'closed' });
	});

	it('a practice project closes like any other and never counted anyway', async () => {
		const { id } = await sealedProject(FUNDER, 1, true);
		expect(await ent.countContracts(FUNDER)).toEqual({ claims: 0, projects: 0, total: 0 });
		expect(await cairn.closeProject(FUNDER, id, { kind: 'abandoned', by: 'Ama Mensah' }, NOW)).toMatchObject({ ok: true });
	});
});

describe('the milestone state on the read', () => {
	it('each milestone carries its derived state and the last signature on it; nothing on the read ever reads lapsed or expired', async () => {
		const { id, milestones: [m1, m2] } = await sealedProject(FUNDER, 4);
		const [, , m3, m4] = fake.rows('cairn_milestones').filter((m) => m.project_id === id).map((m) => m.id as string);
		row('cairn_milestones', m1).target_date = '2027-02-01';
		row('cairn_milestones', m2).target_date = '2026-10-01';
		row('cairn_milestones', m3).target_date = null;
		attest(m4);
		await cairn.acknowledgeTranche(FUNDER, m4, { by: 'Ama Mensah' }, NOW);
		const ms = await cairn.listMilestones(FUNDER, id, NOW);
		expect(ms.map((m) => [m.seq, m.aging])).toEqual([[1, 'scheduled'], [2, 'past_target_no_update'], [3, 'no_target_date'], [4, 'paid']]);
		expect(ms[3].lastSignedAt).toBeTruthy();
		expect(ms[3].paidAt).toBe('2026-11-08 12:00:00');
		expect(ms[1].lastSignedAt).toBeNull();
		expect(JSON.stringify(await cairn.getProjectForOwner(FUNDER, id))).not.toMatch(/lapse|expir/i);
	});
});

describe('the routes', () => {
	async function post(route: 'close' | 'tranche', body: unknown) {
		const mod = await import(`../../src/pages/api/verify/cairn/${route}.ts`);
		const request = new Request(`https://almstins.com/api/verify/cairn/${route}`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
		});
		const res: Response = await (mod.POST as any)({ request });
		return { status: res.status, body: await res.json() };
	}

	it('close: 409 for a close the record does not yet allow, 400 for an unknown kind, 404 for another tenant\'s project, 403 for the demo', async () => {
		const { id } = await sealedProject();
		expect((await post('close', { projectId: id, kind: 'completed', by: 'Ama Mensah' })).status).toBe(409);
		expect((await post('close', { projectId: id, kind: 'expired', by: 'Ama Mensah' })).status).toBe(400);
		expect((await post('close', { projectId: 'nope', kind: 'terminated', by: 'Ama Mensah' })).status).toBe(404);
		mem.session = { tenantId: 'tenant-demo', isDemo: true };
		expect((await post('close', { projectId: id, kind: 'terminated', by: 'Ama Mensah' })).status).toBe(403);
		mem.session = { tenantId: FUNDER, isDemo: false };
		const ok = await post('close', { projectId: id, kind: 'terminated', by: 'Ama Mensah', note: 'Funding withdrawn' });
		expect(ok.status).toBe(200);
		expect(ok.body).toMatchObject({ ok: true, kind: 'terminated', signed: true });
	});

	it('tranche: 409 before the inspector, 200 after, 409 again', async () => {
		const { milestones: [m1] } = await sealedProject();
		expect((await post('tranche', { milestoneId: m1, by: 'Ama Mensah' })).status).toBe(409);
		attest(m1);
		const ok = await post('tranche', { milestoneId: m1, by: 'Ama Mensah', amount: '250000' });
		expect(ok.status).toBe(200);
		expect(ok.body).toMatchObject({ ok: true, milestoneId: m1 });
		expect(row('cairn_milestones', m1).paid_amount).toBe(250000);
		expect((await post('tranche', { milestoneId: m1, by: 'Ama Mensah' })).status).toBe(409);
	});
});
