import 'dotenv/config';
import type { Client } from '@libsql/client';
import { makeTursoDb } from './db.turso';
import { makePgDb } from './db.pg';

// Engine switch. Postgres is the live engine and the DEFAULT; Turso has been
// retired. Set DB_ENGINE=turso only to reach the legacy libSQL path — it's kept
// temporarily so the default flip is reversible, but with Turso destroyed it points
// at nothing. Defaulting to pg means a missing/stray DB_ENGINE can never silently
// route the app at the dead database. The ~800 `import { db }` call sites are
// unaffected — only the engine behind this export changes.
// Read settings from process.env only: Astro 6 copies import.meta.env values into the
// built files, which would put secrets in the build output. `dotenv/config` loads .env
// for local dev; on Render there is no .env file and it does nothing.
const engine = process.env.DB_ENGINE === 'turso' ? 'turso' : 'pg';

const db: Client = engine === 'pg' ? makePgDb() : makeTursoDb();

export { db };
