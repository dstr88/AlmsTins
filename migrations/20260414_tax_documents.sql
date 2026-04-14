-- Generic tax document storage (W-2, 1099-INT, 1099-DIV, etc.)
-- Files stored as base64 TEXT; capped at 5 MB per document.

CREATE TABLE IF NOT EXISTS tax_documents (
	id          TEXT    PRIMARY KEY,
	tenant_id   TEXT    NOT NULL,
	doc_type    TEXT    NOT NULL,   -- 'w2' | '1099-int' | '1099-div' | '1099-r' | '1099-misc' | 'ssa-1099'
	tax_year    INTEGER NOT NULL,
	filename    TEXT    NOT NULL,
	file_size   INTEGER,
	mime_type   TEXT,
	file_data   TEXT    NOT NULL,   -- base64-encoded file bytes
	created_at  TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS tax_documents_tenant_year_idx
	ON tax_documents (tenant_id, tax_year);
