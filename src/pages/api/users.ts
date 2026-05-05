import type { APIRoute } from 'astro';
import { db } from '../../lib/db';
import { requireTenantSession } from '../../lib/requireTenantSession';

const USER_FIELDS = [
	'id',
	'full_name',
	'street_address',
	'city',
	'state',
	'postal_code',
	'country',
	'phone_number',
	'email',
	'secondary_email',
	'created_at',
] as const;

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const result = await db.execute({
			sql: `SELECT ${USER_FIELDS.join(', ')} FROM users WHERE tenant_id = ? ORDER BY created_at DESC`,
			args: [tenantId],
		});
		const users = result.rows.map(mapUserRow);
		return new Response(JSON.stringify(users), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to fetch users', error);
		return responseWithError('Unable to load user profiles.', 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const body = await request.json();
		const email = validateEmail(body.email);
		if (!email) {
			return responseWithError('A valid email address is required.', 400);
		}

		const payload = {
			fullName: sanitize(body.fullName),
			streetAddress: sanitize(body.streetAddress),
			city: sanitize(body.city),
			state: sanitize(body.state),
			postalCode: sanitize(body.postalCode),
			country: sanitize(body.country),
			phoneNumber: sanitize(body.phoneNumber),
			secondaryEmail: body.secondaryEmail ? validateEmail(body.secondaryEmail) : null,
		};

		const existing = await db.execute({
			sql: 'SELECT id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1',
			args: [email, tenantId],
		});

		let result;
		if (existing.rows.length) {
			result = await db.execute({
				sql: `UPDATE users
              SET full_name = ?, street_address = ?, city = ?, state = ?, postal_code = ?, country = ?, phone_number = ?, secondary_email = ?
              WHERE id = ? AND tenant_id = ?
              RETURNING ${USER_FIELDS.join(', ')}`,
				args: [
					payload.fullName,
					payload.streetAddress,
					payload.city,
					payload.state,
					payload.postalCode,
					payload.country,
					payload.phoneNumber,
					payload.secondaryEmail,
					existing.rows[0].id,
					tenantId,
				],
			});
		} else {
			result = await db.execute({
				sql: `INSERT INTO users (tenant_id, full_name, street_address, city, state, postal_code, country, phone_number, email, secondary_email)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING ${USER_FIELDS.join(', ')}`,
				args: [
					tenantId,
					payload.fullName,
					payload.streetAddress,
					payload.city,
					payload.state,
					payload.postalCode,
					payload.country,
					payload.phoneNumber,
					email,
					payload.secondaryEmail,
				],
			});
		}

		return new Response(JSON.stringify(mapUserRow(result.rows[0])), {
			status: existing.rows.length ? 200 : 201,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Failed to upsert user', error);
		return responseWithError('Unable to save user profile.', 500);
	}
};

function mapUserRow(row: Record<string, any>) {
	return {
		id: row.id,
		fullName: row.full_name,
		streetAddress: row.street_address,
		city: row.city,
		state: row.state,
		postalCode: row.postal_code,
		country: row.country,
		phoneNumber: row.phone_number,
		email: row.email,
		secondaryEmail: row.secondary_email,
		createdAt: row.created_at,
	};
}

function validateEmail(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const value = input.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function sanitize(input: unknown, maxLength = 160) {
	if (typeof input !== 'string') return null;
	const value = input.trim();
	return value.length ? value.slice(0, maxLength) : null;
}

function responseWithError(message: string, status = 400) {
	return new Response(JSON.stringify({ error: true, message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
