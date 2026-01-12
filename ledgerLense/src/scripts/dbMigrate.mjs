import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
	throw new Error('Missing TURSO_DATABASE_URL env var');
}

if (!authToken) {
	throw new Error('Missing TURSO_AUTH_TOKEN env var');
}

const db = createClient({ url, authToken });

const ensureSchemaMigrations = async () => {
	await db.execute(
		'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
	);
};

const loadAppliedMigrations = async () => {
	const result = await db.execute('SELECT id FROM schema_migrations ORDER BY id ASC');
	return new Set(result.rows.map((row) => row.id));
};

const splitStatements = (sqlText) =>
	sqlText
		.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean);

const runMigrations = async () => {
	await ensureSchemaMigrations();
	const applied = await loadAppliedMigrations();
	const migrationsDir = path.resolve(process.cwd(), 'migrations');
	let files = [];
	try {
		files = await fs.readdir(migrationsDir);
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			console.log('No migrations directory found.');
			return;
		}
		throw error;
	}

	const migrationFiles = files.filter((file) => file.endsWith('.sql')).sort();

	for (const file of migrationFiles) {
		if (applied.has(file)) {
			continue;
		}
		const filePath = path.join(migrationsDir, file);
		const sqlText = await fs.readFile(filePath, 'utf8');
		const statements = splitStatements(sqlText);
		for (const statement of statements) {
			await db.execute(statement);
		}
		await db.execute({
			sql: 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
			args: [file, new Date().toISOString()],
		});
		console.log(`Applied migration: ${file}`);
	}

	console.log('Migrations complete.');
};

await runMigrations();
