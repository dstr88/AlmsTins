import crypto from 'node:crypto';
import { db } from './db';

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

	const existingTenant = await db.execute({
		sql: 'SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1',
		args: [],
	});
	const existingTenantId = (existingTenant.rows[0] as Record<string, any> | undefined)?.id;

	const tenantId = existingTenantId ? String(existingTenantId) : crypto.randomUUID();
	const tenantName = (label && label.trim().length ? label.trim() : 'Primary').slice(0, 120);

	if (!existingTenantId) {
		await db.execute({
			sql: 'INSERT INTO tenants (id, name, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
			args: [tenantId, tenantName],
		});
	}
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
