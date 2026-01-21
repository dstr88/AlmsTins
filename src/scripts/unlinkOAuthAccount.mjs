import { createClient } from '@libsql/client';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
	const key = process.argv[i];
	const value = process.argv[i + 1];
	if (!key || !value || !key.startsWith('--')) continue;
	args.set(key, value);
}

const provider = args.get('--provider');
const email = args.get('--email');
const providerAccountId = args.get('--providerAccountId');

if (!provider || (!email && !providerAccountId)) {
	console.log('Usage: node src/scripts/unlinkOAuthAccount.mjs --provider github --email you@example.com');
	console.log('   or: node src/scripts/unlinkOAuthAccount.mjs --provider github --providerAccountId 12345');
	process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
	throw new Error('Missing TURSO_DATABASE_URL env var');
}

if (!authToken) {
	throw new Error('Missing TURSO_AUTH_TOKEN env var');
}

const db = createClient({ url, authToken });

if (providerAccountId) {
	const result = await db.execute({
		sql: 'DELETE FROM auth_accounts WHERE provider = ? AND provider_account_id = ?',
		args: [provider, providerAccountId],
	});
	console.log('Removed rows by provider account id:', Number(result.rowsAffected ?? 0));
	process.exit(0);
}

const normalizedEmail = email.trim().toLowerCase();
const userResult = await db.execute({
	sql: 'SELECT id FROM auth_users WHERE lower(email) = ? LIMIT 1',
	args: [normalizedEmail],
});

if (!userResult.rows.length) {
	console.log('No user found for email:', normalizedEmail);
	process.exit(1);
}

const userId = String(userResult.rows[0].id);
const deleteResult = await db.execute({
	sql: 'DELETE FROM auth_accounts WHERE provider = ? AND user_id = ?',
	args: [provider, userId],
});

console.log('Removed rows by user id:', Number(deleteResult.rowsAffected ?? 0));
