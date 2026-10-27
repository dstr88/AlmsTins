import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * "Email me a download link": the endpoint emails the account's own address a link to the dashboard
 * page, and never attaches the report. Google blocks some archives in mail, so the file is always
 * downloaded from the page. The route runs with fake session, plan and mail modules; no network.
 */
const state = vi.hoisted(() => ({
	session: { tenantId: 'tenant_paid', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
	auth: { user: { id: 'user_1', email: 'owner@example.test' } } as { user: { id: string; email?: string | null } } | null,
	planId: 'starter',
	sendMail: vi.fn(async (_opts: Record<string, unknown>) => {}),
}));

vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => state.session,
}));
vi.mock('../../src/lib/authSession', () => ({
	getAuthSession: async () => state.auth,
}));
vi.mock('../../src/lib/subscriptions', () => ({
	getActivePlan: async () => ({ id: state.planId }),
}));
vi.mock('../../src/lib/email', () => ({
	sendMail: state.sendMail,
}));

import { POST } from '../../src/pages/api/records/email-download-link';
import { resetEmailCooldowns, safeDashboardPath } from '../../src/lib/historyDownloadLink';

const ROOT = path.resolve(__dirname, '../..');

const post = async (body: unknown = { path: '/dashboard/wallets' }) =>
	POST({
		request: new Request('https://almstins.test/api/records/email-download-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}),
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	resetEmailCooldowns();
	state.session = { tenantId: 'tenant_paid', isDemo: false };
	state.auth = { user: { id: 'user_1', email: 'owner@example.test' } };
	state.planId = 'starter';
	state.sendMail.mockClear();
});

describe('the emailed link points to the page, never the file', () => {
	it('sends one email to the account address with the dashboard link and no attachment', async () => {
		const res = await post({ path: '/dashboard/bookkeeping?year=2025' });
		expect(res.status).toBe(200);
		expect(state.sendMail).toHaveBeenCalledTimes(1);
		const mail = state.sendMail.mock.calls[0][0];
		expect(mail.to).toBe('owner@example.test');
		expect(mail.text).toContain('https://almstins.test/dashboard/bookkeeping?year=2025');
		expect(mail).not.toHaveProperty('attachments');
		expect(String(mail.text)).not.toMatch(/\.zip|\.csv/i);
	});

	it('the mail helper never passes attachments', () => {
		const src = readFileSync(path.join(ROOT, 'src/lib/email.ts'), 'utf8');
		expect(src).not.toMatch(/attachments/);
	});
});

describe('who may ask for the link', () => {
	it('refuses a free account, and sends nothing', async () => {
		state.planId = 'free';
		const res = await post();
		expect(res.status).toBe(403);
		expect(state.sendMail).not.toHaveBeenCalled();
	});

	it('refuses a demo session, and sends nothing', async () => {
		state.session = { tenantId: 'tenant_demo', isDemo: true };
		const res = await post();
		expect(res.status).toBe(403);
		expect(state.sendMail).not.toHaveBeenCalled();
	});

	it('refuses an account with no email address', async () => {
		state.auth = { user: { id: 'user_2', email: null } };
		const res = await post();
		expect(res.status).toBe(400);
		expect(state.sendMail).not.toHaveBeenCalled();
	});
});

describe('the cooldown', () => {
	it('answers a second request inside the window with 429 and sends only one email', async () => {
		expect((await post()).status).toBe(200);
		const again = await post();
		expect(again.status).toBe(429);
		const body = await again.json();
		expect(body.retryAfterSeconds).toBeGreaterThan(0);
		expect(state.sendMail).toHaveBeenCalledTimes(1);
	});
});

describe('the path the email links to', () => {
	it('keeps a dashboard page and its query', () => {
		expect(safeDashboardPath('/dashboard/wallets')).toBe('/dashboard/wallets');
		expect(safeDashboardPath('/dashboard/bookkeeping?year=2024')).toBe('/dashboard/bookkeeping?year=2024');
	});

	it('falls back to the wallets page for anything that is not a dashboard page', () => {
		expect(safeDashboardPath('https://evil.test/dashboard')).toBe('/dashboard/wallets');
		expect(safeDashboardPath('/api/records/history-by-wallet')).toBe('/dashboard/wallets');
		expect(safeDashboardPath('/dashboard//evil')).toBe('/dashboard/wallets');
		expect(safeDashboardPath(42)).toBe('/dashboard/wallets');
	});
});
