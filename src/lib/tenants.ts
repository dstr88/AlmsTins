import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { db } from './db';

const TENANT_ALERT_EMAIL = 'donnie@titaniumhut.com';

async function sendTenantAlert(userId: string, tenantId: string) {
	const server = import.meta.env.EMAIL_SERVER;
	const from = import.meta.env.EMAIL_FROM;
	if (!server || !from) return;

	let email: string | null = null;
	try {
		const userResult = await db.execute({
			sql: 'SELECT email FROM auth_users WHERE id = ? LIMIT 1',
			args: [userId],
		});
		email = ((userResult.rows[0] as Record<string, unknown> | undefined)?.email as string | null | undefined) ?? null;
	} catch {
		email = null;
	}

	try {
		const transport = nodemailer.createTransport(server);
		await transport.sendMail({
			to: TENANT_ALERT_EMAIL,
			from,
			subject: 'New tenant created',
			text: `A new tenant was created.\nUser: ${userId}\nEmail: ${email ?? 'unknown'}\nTenant: ${tenantId}`,
		});
	} catch (error) {
		console.warn('[tenants] Failed to send tenant alert email', error);
	}
}

type UserTenantRow = {
	activeTenantId: string | null;
	isOnboarded: unknown;
	setupCompletedAt: unknown;
};

async function readUserTenantRow(userId: string): Promise<UserTenantRow | null> {
	try {
		const result = await db.execute({
			sql: 'SELECT active_tenant_id, is_onboarded, setup_completed_at FROM auth_users WHERE id = ? LIMIT 1',
			args: [userId],
		});
		const row = result.rows[0] as Record<string, unknown> | undefined;
		if (!row) return null;
		const activeRaw = row.active_tenant_id;
		return {
			activeTenantId: activeRaw ? String(activeRaw) : null,
			isOnboarded: row.is_onboarded,
			setupCompletedAt: row.setup_completed_at,
		};
	} catch {
		const fallback = await db.execute({
			sql: 'SELECT active_tenant_id FROM auth_users WHERE id = ? LIMIT 1',
			args: [userId],
		});
		const row = fallback.rows[0] as Record<string, unknown> | undefined;
		if (!row) return null;
		const activeRaw = row.active_tenant_id;
		return {
			activeTenantId: activeRaw ? String(activeRaw) : null,
			isOnboarded: null,
			setupCompletedAt: null,
		};
	}
}

export async function resolveActiveTenantId(userId: string): Promise<string | null> {
	const row = await readUserTenantRow(userId);
	return row?.activeTenantId ?? null;
}

export type TenantStateDetails = {
	activeTenantId: string | null;
	hasTenant: boolean;
	onboardingComplete: boolean;
};

async function hasTenantMembership(userId: string, tenantId: string): Promise<boolean> {
	const membership = await db.execute({
		sql: `
      SELECT 1 as ok
      FROM tenant_memberships
      WHERE user_id = ? AND tenant_id = ?
      LIMIT 1
    `,
		args: [userId, tenantId],
	});
	return Boolean(membership.rows?.length);
}

function parseOnboardingFlag(isOnboarded: unknown, setupCompletedAt: unknown): boolean | null {
	if (typeof isOnboarded === 'number') return isOnboarded === 1;
	if (typeof isOnboarded === 'string') {
		const normalized = isOnboarded.toLowerCase();
		return normalized === '1' || normalized === 'true';
	}
	if (setupCompletedAt !== null && setupCompletedAt !== undefined && String(setupCompletedAt).length > 0) return true;
	if (isOnboarded === null || isOnboarded === undefined) return null;
	return false;
}

export async function getTenantStateDetails(userId: string): Promise<TenantStateDetails> {
	const userRow = await readUserTenantRow(userId);
	const activeTenantId = userRow?.activeTenantId ?? null;
	if (!activeTenantId || activeTenantId === 'default') {
		return { activeTenantId: null, hasTenant: false, onboardingComplete: false };
	}

	const hasTenant = await hasTenantMembership(userId, activeTenantId);
	const schemaOnboardingComplete = parseOnboardingFlag(userRow?.isOnboarded, userRow?.setupCompletedAt);
	// TODO: remove fallback after schema flag rollout is complete in all environments.
	const onboardingComplete = schemaOnboardingComplete ?? (hasTenant && activeTenantId !== 'default');

	return { activeTenantId, hasTenant, onboardingComplete };
}

export async function getTenantState(userId: string): Promise<{ hasTenant: boolean; onboardingComplete: boolean }> {
	const state = await getTenantStateDetails(userId);
	return { hasTenant: state.hasTenant, onboardingComplete: state.onboardingComplete };
}

export async function markOnboardingComplete(userId: string): Promise<void> {
	try {
		await db.execute({
			sql: `
        UPDATE auth_users
        SET is_onboarded = 1,
            setup_completed_at = COALESCE(setup_completed_at, CURRENT_TIMESTAMP)
        WHERE id = ?
      `,
			args: [userId],
		});
	} catch {
		// Ignore when schema columns are not yet deployed.
	}
}

export async function ensureTenantForUser(userId: string, label?: string | null): Promise<string> {
	const MAX_RETRIES = 3;
	const BACKOFF_MS = 15;

	const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

	const readActiveTenantWithRetry = async (): Promise<string | null> => {
		for (let i = 0; i < MAX_RETRIES; i += 1) {
			const active = await resolveActiveTenantId(userId);
			if (active) return active;
			if (i < MAX_RETRIES - 1) {
				await sleep(BACKOFF_MS);
			}
		}
		return null;
	};

	const tryCasActiveTenant = async (tenantId: string): Promise<boolean> => {
		const updated = await db.execute({
			sql: 'UPDATE auth_users SET active_tenant_id = ? WHERE id = ? AND active_tenant_id IS NULL',
			args: [tenantId, userId],
		});
		return (updated.rowsAffected ?? 0) > 0;
	};

	const existing = await resolveActiveTenantId(userId);
	if (existing) return existing;

	const membershipResult = await db.execute({
		sql: `SELECT tenant_id
      FROM tenant_memberships
      WHERE user_id = ? AND tenant_id != 'default'
      ORDER BY
        CASE WHEN role = 'owner' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
      LIMIT 1`,
		args: [userId],
	});
	const membershipRow = membershipResult.rows[0] as Record<string, unknown> | undefined;
	if (membershipRow?.tenant_id) {
		const tenantId = String(membershipRow.tenant_id);
		if (await tryCasActiveTenant(tenantId)) {
			return tenantId;
		}
		const activeAfterConflict = await readActiveTenantWithRetry();
		if (activeAfterConflict) {
			return activeAfterConflict;
		}
		if (await tryCasActiveTenant(tenantId)) {
			return tenantId;
		}
		throw new Error('Failed to attach active tenant');
	}

	const tenantId: string = crypto.randomUUID();
	const membershipId: string = crypto.randomUUID();
	const tenantName = (label && label.trim().length ? label.trim() : 'Primary').slice(0, 120);

	await db.execute({
		sql: 'INSERT INTO tenants (id, name, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
		args: [tenantId, tenantName],
	});
	try {
		await db.execute({
			sql: `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			args: [membershipId, tenantId, userId, 'owner'],
		});
	} catch (error) {
		await db.execute({ sql: 'DELETE FROM tenants WHERE id = ?', args: [tenantId] });
		throw error;
	}

	if (await tryCasActiveTenant(tenantId)) {
		await sendTenantAlert(userId, tenantId);
		return tenantId;
	}

	const activeAfterConflict = await readActiveTenantWithRetry();
	if (activeAfterConflict) {
		try {
			await db.execute({ sql: 'DELETE FROM tenant_memberships WHERE id = ?', args: [membershipId] });
			await db.execute({ sql: 'DELETE FROM tenants WHERE id = ?', args: [tenantId] });
		} catch {
			// noop
		}
		return activeAfterConflict;
	}

	if (await tryCasActiveTenant(tenantId)) {
		await sendTenantAlert(userId, tenantId);
		return tenantId;
	}

	try {
		await db.execute({ sql: 'DELETE FROM tenant_memberships WHERE id = ?', args: [membershipId] });
		await db.execute({ sql: 'DELETE FROM tenants WHERE id = ?', args: [tenantId] });
	} catch {
		// noop
	}
	throw new Error('Failed to set active tenant');
}

export async function requireActiveTenantId(userId: string): Promise<string> {
	const tenantId = await resolveActiveTenantId(userId);

	if (!tenantId) {
		const err = new Error('Forbidden: no active tenant selected');
		(err as any).status = 403;
		throw err;
	}

	// Validate membership
	const membership = await db.execute({
		sql: `
      SELECT 1 as ok
      FROM tenant_memberships
      WHERE user_id = ? AND tenant_id = ?
      LIMIT 1
    `,
		args: [userId, tenantId],
	});

	if (!membership.rows?.length) {
		const err = new Error('Forbidden: user is not a member of active tenant');
		(err as any).status = 403;
		throw err;
	}

	if (tenantId === 'default') {
		const err = new Error('Forbidden: "default" tenant is not allowed in app runtime');
		(err as any).status = 403;
		throw err;
	}

	return tenantId;
}
