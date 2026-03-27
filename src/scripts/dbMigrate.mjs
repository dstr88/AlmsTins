import 'dotenv/config';
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

const normalizeStatementForLibsql = (statement) =>
	statement.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+/gi, 'ADD COLUMN ');

const shouldSkipMigrationStatementError = (statement, error) => {
	// Strip single-line comments before checking — splitStatements keeps them in the buffer
	const stripped = statement
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n')
		.trim()
		.toUpperCase();
	const isAlterAddColumn = stripped.startsWith('ALTER TABLE') && stripped.includes('ADD COLUMN');
	if (!isAlterAddColumn) return false;

	const message = String(error?.message ?? '').toLowerCase();
	return message.includes('duplicate column name') || message.includes('already exists');
};

const logAuthUserOnboardingColumns = async () => {
	try {
		const result = await db.execute('PRAGMA table_info(auth_users)');
		const columns = new Set(result.rows.map((row) => String(row.name ?? '')));
		console.log('[db:migrate] auth_users onboarding columns', {
			is_onboarded: columns.has('is_onboarded'),
			setup_completed_at: columns.has('setup_completed_at'),
		});
	} catch (error) {
		console.warn('[db:migrate] failed to inspect auth_users columns', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
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
		for (const [statementIndex, statement] of statements.entries()) {
			const normalizedStatement = normalizeStatementForLibsql(statement);
			if (normalizedStatement !== statement) {
				console.log('[db:migrate] normalized', {
					migrationId: file,
					statementIndex,
					original: statement,
					normalized: normalizedStatement,
				});
			}
			console.log('[db:migrate] exec', {
				migrationId: file,
				statementIndex,
				statement: normalizedStatement,
			});
			try {
				await db.execute(normalizedStatement);
			} catch (error) {
				if (shouldSkipMigrationStatementError(normalizedStatement, error)) {
					console.warn('[db:migrate] skip existing column', {
						statement: normalizedStatement,
						error: error instanceof Error ? error.message : String(error),
					});
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

	await logAuthUserOnboardingColumns();
	console.log('Migrations complete.');
};

await runMigrations();
