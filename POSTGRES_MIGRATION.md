# Postgres Migration

Moving the app from Turso/libSQL (SQLite) to **Render Postgres** — primarily to get
**Row-Level Security** as a *structural* backstop for tenant isolation. Today the
`tenant_id` filter depends on every one of ~835 hand-written queries remembering it
(the June audit found one that didn't: `petro-tins/splits.ts`).

## Decisions (locked)
- **Host:** Render Postgres — direct connections, standard pooling.
- **Data:** migrate **everything** from Turso (preserves 2025 tax work, manual annotations, classifications, cost basis, lifecycle records).
- **Strategy:** a compatibility **shim** keeps the libSQL `db.execute` / `db.batch` interface, so the ~835 call sites don't change — only the engine behind `src/lib/db.ts` does.
- **Branch:** `postgres-migration`. `production` stays on Turso until Phase 2 passes and we cut over deliberately.

## Engine switch
`src/lib/db.ts` dispatches on `DB_ENGINE`:
- unset (default) → Turso (`db.turso.ts`) — also the instant rollback
- `pg` → Postgres shim (`db.pg.ts`)

The shim translates `?` → `$1,$2…`, runs `batch()` as a transaction, returns `{ rows, rowsAffected, columns }`, and coerces `bigint`/`numeric` back to JS numbers (parity with SQLite).

## Dialect inventory — the bounded edit list (~150 spots, not 835)
| Construct | Count | Becomes |
|---|---|---|
| `INSERT OR IGNORE` | 87 | `ON CONFLICT … DO NOTHING` |
| `INSERT OR REPLACE` / `REPLACE INTO` | ~15 | `ON CONFLICT … DO UPDATE` |
| `strftime(...)` | 37 | `to_char()` / `date_trunc()` |
| `PRAGMA` | 11 | delete (FKs on by default) / `information_schema` |
| `randomblob` id defaults | 5 | `gen_random_uuid()` (DDL only) |
| `json_extract` | 2 | `->>` / `jsonb` |
| `.batch()` calls | 39 | handled once, in the shim |

Clean wins: **0** `AUTOINCREMENT`, **0** `IFNULL`, **0** `WITHOUT ROWID` (TEXT UUIDs + `COALESCE` throughout — already portable).
Type watch: pg returns `bigint`/`numeric` as strings and `0/1` flags as booleans. Shim coerces numerics; the PG DDL keeps flag columns `integer` and ISO-timestamp columns `text` for behavior parity.

## Checker history — keep `wallet_check_log` (do NOT drop)
Powers the **repeat-scan warning** ("you checked this address before — it's now flagged").
Already logs `created_at, ip_hash, addr_hash, chain, cache_hit` (hashed checker + hashed address + time), fire-and-forget. Migrate to PG **and extend**:
- add a `status` column (verdict at check time) → enables "checked on X; was clean, now flagged" (bare "seen before" is too weak to bother)
- index `(addr_hash, ip_hash)` so the repeat-lookup on each check is instant
- `hashWithSalt` must use a **stable/persistent** salt, or hashes won't match across deploys and the warning silently never fires
- **bound retention (~90d)** — a warning tool, not a permanent who-checked-what archive
- reliability note: hashed IP is a fuzzy identity (misses repeats / false-matches shared IPs); a device cookie or the logged-in account is firmer if we want it strict

## Phases
- [x] **0a Foundation** — branch, `pg` installed, shim (`db.pg.ts`), dispatcher (`db.ts`), Turso factory (`db.turso.ts`), schema-dump script (`src/scripts/dumpTursoSchema.mjs`).
- [x] **0b Schema** — DONE. Render PG (PostgreSQL 18.4, ohio) has all **96 tables, exact parity with Turso** (0 missing / 0 extra). Empty (0 rows); FKs not yet applied (companion file `pg-foreign-keys.sql`, post-data-load); RLS off (Phase 4). Probes: `src/scripts/pgState.mjs`, `src/scripts/pgPing.mjs`.
- [~] **0c Build-verify** — `tsc --noEmit` holds at the 50-error baseline (no new TS/syntax errors from the dialect edits; all edits are SQL-string contents the bundler never parses). Full `astro build` is **blocked locally** by a corrupted esbuild native-binary install (`esbuild` JS 0.25.12 vs binary 0.27.7 on disk — fails esbuild's own `validateBinaryVersion`; pre-existing, unrelated to migration). Fix when wanted: `rm -rf node_modules package-lock.json && npm install`. Render verifies the bundle on its clean-container build at deploy.
- [x] **1 Dialect fixes** — DONE. ~244 spots across 7 commits (1a→1f): `datetime/strftime`→`to_char`, `CURRENT_TIMESTAMP`→`to_char`, `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING` (84), `INSERT OR REPLACE`→`ON CONFLICT DO UPDATE` (15), `PRAGMA table_info`→`information_schema`, `randomblob`→`gen_random_uuid`. Final sweep clean; tsc=50.
- [~] **2 Parity test** — **dialect parity PASSED** (`src/scripts/pgParity.mjs`, 11/11): every translated construct (to_char ×2, substr year/month, gen_random_uuid, interval, information_schema, real demo/stats queries, ON CONFLICT DO NOTHING + DO UPDATE) executes correctly on PG 18.4, transactionally rolled back so PG stays empty. Remaining: full-app `DB_ENGINE=pg` endpoint smoke — deferred to Render's clean build (local `astro dev` blocked by the same esbuild-binary corruption as 0c; `rm -rf node_modules package-lock.json && npm install` unblocks it locally).
- [x] **3 Data move** — DONE. **89,413 rows / 96 tables** copied (`migrateData.mjs`), **exact row-count parity** Turso↔PG (all 96 match). **22 foreign keys applied clean (0 orphans)** — `src/scripts/sql/20260618_foreign_keys.sql`. Real-data RLS isolation verified: `almstins_web` set to tenant X sees exactly its rows (e.g. 3681 of 6246, not all), 0 when unset (3/3). NOTE: production still writes to Turso, so PG is a snapshot — a final catch-up sync is needed at cutover (re-run is idempotent for all keyed tables; truncate `request_log` first to avoid analytics dupes).
- [x] **4 RLS** — BUILT + APPLIED to PG (enforcement goes live in production at cutover). Policy SQL applied via `applyRlsPolicies.mjs` → **74 RLS-enabled tables / 72 policies**. Non-owner role `almstins_web` created + granted (SELECT/INSERT/UPDATE/DELETE on all tables + sequences + default privileges); `WEB_DATABASE_URL` in local `.env` (gitignored). Shim: `dbContext.ts` (ALS) + `db.pg.ts` two-pool (owner bypass / web-role `set_config(app.tenant_id,app.user_id, is_local)`), inert until `WEB_DATABASE_URL` is set; middleware establishes context per request; app-level filters kept. Proofs: `pgRlsProof.mjs` 10/10 (tenant_id / user_id / FK-subquery isolate + fail-closed + WITH CHECK, rolled back) + web-role fail-closed verified on a real table. **Production untouched (still Turso).** For cutover: add `WEB_DATABASE_URL` to Render web env.
- [ ] **5 Cutover** — swap env on `production`, deploy, keep Turso as instant rollback.

## Your action item
Add Render's **external** connection string to `.env` (don't paste it in chat — just drop it in the file):
```
DATABASE_URL=postgres://USER:PASS@HOST.oregon-postgres.render.com/DBNAME
```
Leave `DB_ENGINE` **unset** for now so the app stays on Turso. We flip to `DB_ENGINE=pg` only after Phase 0c.
