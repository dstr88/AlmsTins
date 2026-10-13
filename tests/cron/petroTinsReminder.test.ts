import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/cron/petro-tins-reminder keeps running while PetroTins is owner-only, but it may
 * only ever read or email the owner's tenant: the tenant query is limited to the owner tenant,
 * and anything else that comes back is skipped. The response goes to the scheduled workflow in a
 * public repo, so while owner-only it is a bare { ok: true }: no tenant IDs, no counts. The
 * email's link goes through sign-in. No database: '@/lib/db' records each statement and
 * answers from `state`.
 */
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

const state = vi.hoisted(() => ({
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	tenantRows: [] as Array<Record<string, unknown>>,
	failTenantQuery: false,
}));

vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));
vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
			const sql = typeof stmt === 'string' ? stmt : stmt.sql;
			const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
			state.calls.push({ sql, args });
			if (/SELECT DISTINCT tenant_id FROM petro_tins/.test(sql)) {
				if (state.failTenantQuery) throw new Error('relation "petro_tins" does not exist');
				return { rows: state.tenantRows };
			}
			if (/FROM petro_tin_entries/.test(sql)) {
				return { rows: [{ description: 'Rent', amount: 1000, kind: 'expense', entry_date: '2026-09-01', tin_name: 'Home' }] };
			}
			if (/FROM tenant_memberships/.test(sql)) return { rows: [{ alert_email: null, email: `${String(args[0])}@example.test` }] };
			return { rows: [] };
		},
	},
}));

const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/email', () => mail);

import { GET } from '../../src/pages/api/cron/petro-tins-reminder';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

const run = (secret = 'test-secret') =>
	GET({
		request: new Request('https://app.test/api/cron/petro-tins-reminder', { headers: { 'x-cron-secret': secret } }),
	} as never) as Promise<Response>;

beforeEach(() => {
	state.calls = [];
	state.tenantRows = [];
	state.failTenantQuery = false;
	mail.sendMail.mockReset();
	mail.sendMail.mockResolvedValue(undefined);
	vi.stubEnv('CRON_SECRET', 'test-secret');
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('PetroTins reminder cron while PetroTins is owner-only', () => {
	it('asks the database for the owner tenant only', async () => {
		await run();
		const [tenantQuery] = state.calls;
		expect(tenantQuery.sql).toMatch(/SELECT DISTINCT tenant_id FROM petro_tins WHERE type = 'budget' AND LOWER\(tenant_id\) = \?/);
		expect(tenantQuery.args).toEqual([OWNER_TENANT_ID]);
	});

	it('processes and emails only the owner, even if other tenants come back', async () => {
		state.tenantRows = [{ tenant_id: OTHER_TENANT_ID }, { tenant_id: OWNER_TENANT_ID.toUpperCase() }, { tenant_id: 'demo-00000000000000000000000000000001' }];
		const res = await run();
		const body = await res.json();

		expect(mail.sendMail).toHaveBeenCalledTimes(1);
		expect(mail.sendMail.mock.calls[0][0].to).toBe(`${OWNER_TENANT_ID.toUpperCase()}@example.test`);

		const perTenant = state.calls.slice(1);
		expect(perTenant.length).toBeGreaterThan(0);
		for (const c of perTenant) expect(String(c.args[0]).toLowerCase(), c.sql).toBe(OWNER_TENANT_ID);

		// Nothing about the owner's bills (no counts, no statuses, no IDs) for the public log.
		expect(body).toEqual({ ok: true });
	});

	it("links the email through sign-in, since a signed-out visit to PetroTins is a 404", async () => {
		state.tenantRows = [{ tenant_id: OWNER_TENANT_ID }];
		await run();
		const { text, html } = mail.sendMail.mock.calls[0][0];
		const link = 'https://almstins.com/login?next=%2Fdashboard%2Fpetro-tins';
		expect(text).toContain(link);
		expect(html).toContain(`href="${link}"`);
		expect(`${text}${html}`).not.toMatch(/almstins\.com\/dashboard\/petro-tins/);
	});

	it('does nothing when the owner has no budget tin, and still says only { ok: true }', async () => {
		const res = await run();
		expect(mail.sendMail).not.toHaveBeenCalled();
		expect(await res.json()).toEqual({ ok: true });
	});

	it('says only { ok: true } when the table is missing, too', async () => {
		state.failTenantQuery = true;
		const res = await run();
		expect(await res.json()).toEqual({ ok: true });
	});

	it('still refuses a wrong secret', async () => {
		const res = await run('nope');
		expect(res.status).toBe(401);
		expect(state.calls).toEqual([]);
	});
});
