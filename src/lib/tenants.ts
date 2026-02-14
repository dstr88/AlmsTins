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
		email = (userResult.rows[0] as Record<string, any> | undefined)?.email ?? null;
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

export async function resolveActiveTenantId(userId: string): Promise<string | null> {
	const result = await db.execute({
		sql: 'SELECT active_tenant_id FROM auth_users WHERE id = ? LIMIT 1',
		args: [userId],
	});
	const row = result.rows[0] as Record<string, any> | undefined;
	const tenantId = row?.active_tenant_id;
	return tenantId ? String(tenantId) : null;
}

export async function ensureTenantForUser(userId: string, label?: string | null): Promise<string> {
	const existing = await resolveActiveTenantId(userId);
	if (existing) return existing;

	const membershipResult = await db.execute({
		sql: 'SELECT tenant_id FROM tenant_memberships WHERE user_id = ? LIMIT 1',
		args: [userId],
	});
	const membershipRow = membershipResult.rows[0] as Record<string, any> | undefined;
	if (membershipRow?.tenant_id) {
		const tenantId = String(membershipRow.tenant_id);
		await db.execute({
			sql: 'UPDATE auth_users SET active_tenant_id = ? WHERE id = ?',
			args: [tenantId, userId],
		});
		return tenantId;
	}

	const tenantId = crypto.randomUUID();
	const tenantName = (label && label.trim().length ? label.trim() : 'Primary').slice(0, 120);

	await db.execute({
		sql: 'INSERT INTO tenants (id, name, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
		args: [tenantId, tenantName],
	});
	await sendTenantAlert(userId, tenantId);
	await db.execute({
		sql: `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		args: [crypto.randomUUID(), tenantId, userId, 'owner'],
	});
	await db.execute({
		sql: 'UPDATE auth_users SET active_tenant_id = ? WHERE id = ?',
		args: [tenantId, userId],
	});

	return tenantId;
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
