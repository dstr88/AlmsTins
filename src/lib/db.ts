import type { Client } from '@libsql/client';
import { makeTursoDb } from './db.turso';
import { makePgDb } from './db.pg';

// Engine switch for the Turso -> Postgres migration. Default stays Turso (and is
// the instant rollback); set DB_ENGINE=pg (with DATABASE_URL) to run on Postgres.
// Keeping the selection here means the ~800 call sites that `import { db }` never
// change — only the engine behind this export does.
const importMetaEnv = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const engine = (importMetaEnv.DB_ENGINE ?? process.env.DB_ENGINE) === 'pg' ? 'pg' : 'turso';

const db: Client = engine === 'pg' ? makePgDb() : makeTursoDb();

export { db };
