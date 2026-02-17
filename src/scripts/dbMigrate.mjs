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

const splitStatements = (sqlText) => {
	const lines = sqlText.split('\n');
	const statements = [];
	let buffer = [];
	let inTrigger = false;
	let triggerBeginDepth = 0;
	let sawTriggerBegin = false;

	for (const line of lines) {
		const normalizedLine = line.replace(/\r$/, '');
		const trimmed = normalizedLine.trim();
		if (!inTrigger && /^CREATE\s+TRIGGER\b/i.test(trimmed)) {
			inTrigger = true;
			triggerBeginDepth = 0;
			sawTriggerBegin = false;
		}
		buffer.push(normalizedLine);

		if (inTrigger) {
			const beginMatches = trimmed.match(/\bBEGIN\b/gi);
			if (beginMatches?.length) {
				triggerBeginDepth += beginMatches.length;
				sawTriggerBegin = true;
			}
			if (normalizedLine === 'END;') {
				if (triggerBeginDepth > 0) {
					triggerBeginDepth -= 1;
				}
				if (sawTriggerBegin && triggerBeginDepth === 0) {
					const stmt = buffer.join('\n').trim();
					if (stmt) statements.push(stmt);
					buffer = [];
					inTrigger = false;
				}
			}
			continue;
		}

		if (trimmed.endsWith(';')) {
			const stmt = buffer.join('\n').trim();
			if (stmt) {
				statements.push(stmt.slice(0, -1).trim());
			}
			buffer = [];
		}
	}

	const tail = buffer.join('\n').trim();
	if (tail) {
		statements.push(tail);
	}

	return statements.filter(Boolean);
};

const isIgnorableMigrationError = (error) => {
	const message = error?.message ?? '';
	return message.includes('duplicate column name');
};

const runMigrations = async () => {
	await db.execute('PRAGMA foreign_keys = ON');
	const fkResult = await db.execute('PRAGMA foreign_keys');
	const fkEnabled = Number(fkResult.rows?.[0]?.foreign_keys ?? 0) === 1;
	console.log('[db:migrate] foreign_keys', fkEnabled ? 'on' : 'off');
	if (!fkEnabled) {
		console.warn('[db:migrate] WARNING: PRAGMA foreign_keys is OFF; ON DELETE CASCADE guarantees are not enforced');
	}
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
			try {
				await db.execute(statement);
			} catch (error) {
				if (isIgnorableMigrationError(error)) {
					console.warn(`Skipping statement due to existing column: ${statement}`);
					continue;
				}
				throw error;
			}
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
