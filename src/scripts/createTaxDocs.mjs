import 'dotenv/config';
import { createClient } from '@libsql/client';

const db = createClient({
	url: process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN,
});

await db.execute(`CREATE TABLE IF NOT EXISTS tax_documents (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	doc_type TEXT NOT NULL,
	tax_year INTEGER NOT NULL,
	filename TEXT NOT NULL,
	file_size INTEGER,
	mime_type TEXT,
	file_data TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
)`);

await db.execute(`CREATE INDEX IF NOT EXISTS tax_documents_tenant_year_idx
	ON tax_documents (tenant_id, tax_year)`);

await db.execute({
	sql: 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)',
	args: ['20260414_tax_documents.sql', new Date().toISOString()],
});

console.log('tax_documents table created.');
