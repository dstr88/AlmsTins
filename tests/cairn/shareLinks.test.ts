import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * Download links for a milestone desk project: one labeled link per party, opening that project's
 * live paperwork read-only. The token is kept only as its SHA-256 hash, a link expires (180 days by
 * default, 365 at most), a revoked or expired link opens nothing, and a link never reaches another
 * project or another account. Run through the registry against the db fake. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
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

const OWNER = 'tenant-funder';
const OTHER = 'tenant-other';
const DAY_MS = 86_400_000;

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const daysFromNow = (stamp: string) => (Date.parse(stamp.replace(' ', 'T') + 'Z') - Date.now()) / DAY_MS;

function seedProject(id: string, tenantId: string) {
	return fake.seed('cairn_projects', {
		id, tenant_id: tenantId, name: `Project ${id}`, counterparty: 'Works Ltd', total_value: 900_000,
		currency: 'NGN', description: null, is_test: false, manifest_json: '{}', signature_json: null,
		digest: '0'.repeat(64), anchor_json: null, signed_at: '2026-09-05 10:00:00',
		created_at: '2026-09-05 10:00:00', updated_at: null,
	});
}

function seedDoc(id: string, projectId: string, tenantId: string, over: Record<string, unknown> = {}) {
	return fake.seed('cairn_documents', {
		id, milestone_id: `ms-${projectId}`, project_id: projectId, tenant_id: tenantId, uploaded_by: 'inspector',
		kind: 'report', filename: `${id}.pdf`, mime_type: 'application/pdf', file_size: 5,
		sha256: sha(id), data: Buffer.from('hello').toString('base64'), uploaded_at: '2026-09-06 10:00:00',
		purged_at: null, location_json: null,
		...over,
	});
}

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	cairn = await import('../../src/lib/cairnRegistry');
	await cairn.ensureCairnTables();
	seedProject('p1', OWNER);
	seedProject('p2', OWNER);
	seedProject('p-other', OTHER);
});

describe('minting a link', () => {
	it('returns the token once, and stores only its hash', async () => {
		const made = await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Contractor' });
		expect(made.ok).toBe(true);
		if (!made.ok) return;
		expect(made.token.length).toBeGreaterThanOrEqual(40);
		const row = await fake.execute({ sql: 'SELECT token_hash, label FROM cairn_share_links WHERE id = ?', args: [made.id] });
		expect(row.rows[0].token_hash).toBe(sha(made.token));
		expect(JSON.stringify(row.rows[0])).not.toContain(made.token);
		expect(row.rows[0].label).toBe('Contractor');
	});

	it('expires in 180 days by default, and is capped at 365', async () => {
		const byDefault = await cairn.createShareLink(OWNER, { projectId: 'p1' });
		const capped = await cairn.createShareLink(OWNER, { projectId: 'p1', days: 9_999 });
		const floored = await cairn.createShareLink(OWNER, { projectId: 'p1', days: 0 });
		if (!byDefault.ok || !capped.ok || !floored.ok) throw new Error('mint failed');
		expect(Math.round(daysFromNow(byDefault.expiresAt))).toBe(180);
		expect(Math.round(daysFromNow(capped.expiresAt))).toBe(365);
		expect(Math.round(daysFromNow(floored.expiresAt))).toBe(1);
	});

	it('refuses a project the account does not own', async () => {
		expect(await cairn.createShareLink(OTHER, { projectId: 'p1' })).toEqual({ ok: false, error: 'not_found' });
	});
});

describe('opening a link', () => {
	it('opens the project it was minted for, and records the use', async () => {
		const made = await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Funder' });
		if (!made.ok) throw new Error('mint failed');
		const opened = await cairn.readShareLink(made.token);
		expect(opened).toEqual({ tenantId: OWNER, projectId: 'p1', label: 'Funder', milestoneId: null });
		const row = await fake.execute({ sql: 'SELECT last_used_at FROM cairn_share_links WHERE id = ?', args: [made.id] });
		expect(row.rows[0].last_used_at).not.toBeNull();
	});

	it('opens nothing for an unknown token', async () => {
		expect(await cairn.readShareLink('not-a-real-token')).toBeNull();
		expect(await cairn.readShareLink('')).toBeNull();
	});

	it('opens nothing once revoked, and only the minting account can revoke', async () => {
		const made = await cairn.createShareLink(OWNER, { projectId: 'p1' });
		if (!made.ok) throw new Error('mint failed');
		expect(await cairn.revokeShareLink(OTHER, made.id)).toBe(false);
		expect(await cairn.readShareLink(made.token)).not.toBeNull();
		expect(await cairn.revokeShareLink(OWNER, made.id)).toBe(true);
		expect(await cairn.readShareLink(made.token)).toBeNull();
	});

	it('opens nothing after it expires', async () => {
		const made = await cairn.createShareLink(OWNER, { projectId: 'p1' });
		if (!made.ok) throw new Error('mint failed');
		await fake.execute({ sql: 'UPDATE cairn_share_links SET expires_at = ? WHERE id = ?', args: ['2000-01-01 00:00:00', made.id] });
		expect(await cairn.readShareLink(made.token)).toBeNull();
	});
});

describe('the files behind a link', () => {
	it('lists only the live files of its own project', async () => {
		seedDoc('d-live', 'p1', OWNER);
		seedDoc('d-purged', 'p1', OWNER, { purged_at: '2026-10-01 00:00:00', data: null });
		seedDoc('d-elsewhere', 'p2', OWNER);
		const docs = await cairn.listShareDocuments(OWNER, 'p1');
		expect(docs.map((d) => d.id)).toEqual(['d-live']);
	});

	it('reads a file of its own project, and nothing from another project of the same account', async () => {
		seedDoc('d-live', 'p1', OWNER);
		seedDoc('d-elsewhere', 'p2', OWNER);
		const own = await cairn.readShareDocument(OWNER, 'p1', 'd-live');
		expect(own?.data.toString('utf8')).toBe('hello');
		expect(await cairn.readShareDocument(OWNER, 'p1', 'd-elsewhere')).toBeNull();
	});

	it('reads nothing from another account', async () => {
		seedDoc('d-other', 'p-other', OTHER);
		expect(await cairn.readShareDocument(OWNER, 'p-other', 'd-other')).toBeNull();
	});
});

describe('the owner’s list of links', () => {
	it('shows each link’s state and never its token', async () => {
		const active = await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Contractor' });
		const withdrawn = await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Old funder' });
		if (!active.ok || !withdrawn.ok) throw new Error('mint failed');
		await cairn.revokeShareLink(OWNER, withdrawn.id);
		const list = await cairn.listShareLinks(OWNER, 'p1');
		const byLabel = Object.fromEntries(list.map((l) => [l.label, l.state]));
		expect(byLabel).toEqual({ Contractor: 'active', 'Old funder': 'revoked' });
		expect(JSON.stringify(list)).not.toContain(active.token);
	});
});

describe('a link limited to one milestone', () => {
	const milestone = (id: string, projectId: string, seq: number, title: string) => ({
		id, project_id: projectId, tenant_id: OWNER, seq, title, description: null, tranche_amount: 100_000,
		target_date: '2026-10-01', status: 'pending', manifest_json: '{}', signature_json: null,
		digest: '0'.repeat(64), anchor_json: null, created_at: '2026-09-05 10:00:00', paid_at: null, paid_amount: null,
	});

	beforeEach(() => {
		fake.seed('cairn_milestones', milestone('ms-a', 'p1', 1, 'Foundation'));
		fake.seed('cairn_milestones', milestone('ms-b', 'p1', 2, 'Roof'));
		fake.seed('cairn_milestones', milestone('ms-other', 'p2', 1, 'Elsewhere'));
	});

	it('lists and reads only that milestone’s files', async () => {
		seedDoc('d-a', 'p1', OWNER, { milestone_id: 'ms-a' });
		seedDoc('d-b', 'p1', OWNER, { milestone_id: 'ms-b' });
		const made = await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Inspector', milestoneId: 'ms-a' });
		if (!made.ok) throw new Error('mint failed');
		const opened = await cairn.readShareLink(made.token);
		expect(opened?.milestoneId).toBe('ms-a');
		const listed = await cairn.listShareDocuments(OWNER, 'p1', opened?.milestoneId ?? null);
		expect(listed.map((d) => d.id)).toEqual(['d-a']);
		expect(await cairn.readShareDocument(OWNER, 'p1', 'd-b', 'ms-a')).toBeNull();
		expect((await cairn.readShareDocument(OWNER, 'p1', 'd-a', 'ms-a'))?.data.toString('utf8')).toBe('hello');
	});

	it('a project-wide link still lists every live file', async () => {
		seedDoc('d-a', 'p1', OWNER, { milestone_id: 'ms-a' });
		seedDoc('d-b', 'p1', OWNER, { milestone_id: 'ms-b' });
		const listed = await cairn.listShareDocuments(OWNER, 'p1', null);
		expect(listed.map((d) => d.id).sort()).toEqual(['d-a', 'd-b']);
	});

	it('refuses a milestone from another project', async () => {
		expect(await cairn.createShareLink(OWNER, { projectId: 'p1', milestoneId: 'ms-other' }))
			.toEqual({ ok: false, error: 'milestone_not_found' });
	});

	it('the owner’s list names the milestone a link is limited to', async () => {
		await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Inspector', milestoneId: 'ms-a' });
		await cairn.createShareLink(OWNER, { projectId: 'p1', label: 'Funder' });
		const list = await cairn.listShareLinks(OWNER, 'p1');
		const byLabel = Object.fromEntries(list.map((l) => [l.label, l.milestoneTitle]));
		expect(byLabel).toEqual({ Inspector: 'Foundation', Funder: null });
	});
});
