import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { db } from './db';
import { ensureFreeSubscription } from './subscriptions';

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

export async function markOnboardingComplete(userId: string): Promise<boolean> {
	const debug = process.env.TENANT_DEBUG === '1';
	try {
		const res = await db.execute({
			sql: `
        UPDATE auth_users
        SET is_onboarded = 1,
            setup_completed_at = COALESCE(setup_completed_at, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
        WHERE id = ?
      `,
			args: [userId],
		});
		const affected = Number(res.rowsAffected ?? 0);
		if (debug) {
			console.log('[tenants] markOnboardingComplete', { userId, affected });
		}
		if (affected === 0) {
			console.warn('[tenants] markOnboardingComplete affected 0 rows', { userId });
		}
		return affected > 0;
	} catch (error) {
		const message =
			error instanceof Error ? error.message : typeof error === 'string' ? error : String(error ?? '');
		const missingColumns =
			message.includes('no such column') ||
			message.includes('has no column named') ||
			message.includes('unknown column');
		if (missingColumns) {
			console.warn('[tenants] markOnboardingComplete failed (likely missing columns)', {
				userId,
				error: message,
			});
			return false;
		}
		console.error('[tenants] markOnboardingComplete failed (unexpected)', {
			userId,
			error: message,
		});
		throw error;
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

	// Email-based tenant deduplication: if another auth_users row with the same
	// email already has an active tenant, join that tenant instead of creating a
	// new one.  This prevents a second OAuth provider login (e.g. GitHub after
	// Google) from spawning a duplicate tenant when both providers share the same
	// verified email address.
	try {
		const emailRow = await db.execute({
			sql: 'SELECT email FROM auth_users WHERE id = ? LIMIT 1',
			args: [userId],
		});
		const email = (emailRow.rows[0] as Record<string, unknown> | undefined)?.email;
		if (email && typeof email === 'string' && email.includes('@')) {
			const siblingRow = await db.execute({
				sql: `SELECT active_tenant_id
				      FROM auth_users
				      WHERE email = ?
				        AND id != ?
				        AND active_tenant_id IS NOT NULL
				        AND active_tenant_id != 'default'
				      LIMIT 1`,
				args: [email, userId],
			});
			const siblingTenantId = (siblingRow.rows[0] as Record<string, unknown> | undefined)?.active_tenant_id;
			if (siblingTenantId && typeof siblingTenantId === 'string') {
				// Adopt the existing tenant — add membership and set active
				const membershipId = crypto.randomUUID();
				try {
					await db.execute({
						sql: `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at)
						      VALUES (?, ?, ?, 'member', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
						args: [membershipId, siblingTenantId, userId],
					});
				} catch {
					// membership may already exist — non-fatal
				}
				if (await tryCasActiveTenant(siblingTenantId)) {
					return siblingTenantId;
				}
				const afterConflict = await readActiveTenantWithRetry();
				if (afterConflict) return afterConflict;
			}
		}
	} catch {
		// non-fatal — fall through to normal tenant creation
	}

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
		sql: `INSERT INTO tenants (id, name, created_at) VALUES (?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
		args: [tenantId, tenantName],
	});
	try {
		await db.execute({
			sql: `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
			args: [membershipId, tenantId, userId, 'owner'],
		});
	} catch (error) {
		await db.execute({ sql: 'DELETE FROM tenants WHERE id = ?', args: [tenantId] });
		throw error;
	}

	if (await tryCasActiveTenant(tenantId)) {
		// Provision a free subscription row for every new tenant
		await ensureFreeSubscription(tenantId).catch(() => { /* non-fatal */ });
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
		// Provision a free subscription row for every new tenant
		await ensureFreeSubscription(tenantId).catch(() => { /* non-fatal */ });
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
