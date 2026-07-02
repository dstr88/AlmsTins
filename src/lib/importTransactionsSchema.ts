import { db } from './db';

type ColumnSet = Set<string>;

let cachedColumns: ColumnSet | null = null;

/** Drop the cached column set — call after an ALTER TABLE adds/removes a column. */
export function resetImportTransactionColumnsCache(): void {
	cachedColumns = null;
}

export async function getImportTransactionColumns(): Promise<ColumnSet> {
	if (cachedColumns) return cachedColumns;
	const result = await db.execute({ sql: `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'import_transactions'` });
	const columns = new Set<string>(
		result.rows.map((row) => String((row as { name?: string }).name ?? '').trim()).filter(Boolean),
	);
	cachedColumns = columns;
	return columns;
}

export function selectImportColumn(columns: ColumnSet, name: string, alias = name): string {
	if (columns.has(name)) {
		return alias === name ? name : `${name} AS ${alias}`;
	}
	return `NULL AS ${alias}`;
}

export function selectImportNotes(columns: ColumnSet, alias = 'notes'): string {
	if (columns.has('notes')) {
		return alias === 'notes' ? 'notes' : `notes AS ${alias}`;
	}
	if (columns.has('note')) {
		return `note AS ${alias}`;
	}
	return `NULL AS ${alias}`;
}

export function resolveImportNoteColumn(columns: ColumnSet): string | null {
	if (columns.has('note')) return 'note';
	if (columns.has('notes')) return 'notes';
	return null;
}
