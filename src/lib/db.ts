import type { Client } from '@libsql/client';
import { makeTursoDb } from './db.turso';
import { makePgDb } from './db.pg';

// Engine switch. Postgres is the live engine and the DEFAULT; Turso has been
// retired. Set DB_ENGINE=turso only to reach the legacy libSQL path — it's kept
// temporarily so the default flip is reversible, but with Turso destroyed it points
// at nothing. Defaulting to pg means a missing/stray DB_ENGINE can never silently
// route the app at the dead database. The ~800 `import { db }` call sites are
// unaffected — only the engine behind this export changes.
const importMetaEnv = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const engine = (importMetaEnv.DB_ENGINE ?? process.env.DB_ENGINE) === 'turso' ? 'turso' : 'pg';

const db: Client = engine === 'pg' ? makePgDb() : makeTursoDb();

export { db };
