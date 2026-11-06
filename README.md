# Almstins

The code behind [almstins.com](https://almstins.com): a read-only crypto wallet tracker with
dated records, plus Almstins Verify (proof that a payment destination belongs to a domain) and
Almstins Agentics (a pre-send check for AI agents, and the Agent Vault that records what an
agent asked and what its wallet did).

Almstins reads public chain data and the files you import. It never holds keys, never connects
to a wallet, and never signs or sends a transaction. It verifies, flags and records; it is not
tax software, and its year-end output is a record of what happened, not advice.

## Stack

- [Astro 5](https://astro.build) in server mode on the Node adapter, with React islands.
- Postgres on Render. `src/lib/db.ts` exports one `db` client (`execute` and `batch`), and every
  query names `tenant_id`.
- Auth.js for sign-in (email link, Google, GitHub).
- Vitest for unit tests, Playwright for end-to-end tests.
- Node 20 (`.node-version`, the same file Render reads).

## Layout

```text
src/
  pages/          routes: pages, and the JSON endpoints under pages/api
  components/     Astro and React components (agentics/ is the Agentics app)
  lib/            the logic, one module per concern
    agentVault/   the Agent Vault: registry, ledger, watcher, reports, export
    recordProof/  canonical leaves, Merkle roots and Ed25519 signatures for signed records
    tax/, yearEnd/  year-end records and lot tracking
    chains.ts     the facts about each chain and which features read it
  i18n/           copy, including the Privacy Policy and the User Agreement (EN, ES, FR)
  middleware.ts   session and access gates
migrations-pg/    Postgres schema, numbered; each file mirrors a lazy runtime ensure
scripts/          one-off tools: leak scan, record verifier, signing key tools
tests/            unit tests (hermetic), plus e2e/ for Playwright
.github/workflows CI and every scheduled job
docs/             runbooks for the public key log and for checking a record without Almstins
```

## Getting started

```bash
npm install
cp .env.example .env   # then fill in what you need
npm run dev            # http://localhost:4321
```

`npm run dev:env` reports which environment variables are set. `AUTH_DISABLED="true"` skips
sign-in for local work only.

| Command | What it does |
| :-- | :-- |
| `npm run dev` | Dev server at `localhost:4321` |
| `npm run build` | Production build into `./dist/` |
| `npm start` | Runs the built server (what Render runs) |
| `npm run check` | `astro check` (type checks `.astro` and `.ts`) |
| `npx vitest run --config vitest.ci.config.ts` | The unit suite exactly as CI runs it |
| `npm run test:e2e` | Playwright end-to-end tests |

## Environment

`.env.example` lists the variables with comments. The main groups:

- **Database:** `DATABASE_URL` (owner role: jobs and migrations) and `WEB_DATABASE_URL` (the web
  role, constrained by row-level security). `DB_ENGINE` defaults to `pg`.
- **Auth:** `AUTH_SECRET`, `AUTH_URL`, `EMAIL_SERVER`, `EMAIL_FROM`, and the OAuth client ids.
- **Chains and prices:** `ETHERSCAN_API_KEY` (Ethereum and Polygon), `SNOWTRACE_API_KEY`
  (Avalanche), and optionally `COINGECKO_API_KEY`.
- **Signing:** `ALMSTINS_SIGNING_KEY`. Without it, reports and exports are not signed, and the
  signed Agent Vault export is refused rather than served unsigned.
- **Jobs:** `CRON_SECRET`, which every `/api/cron/*` endpoint requires.
- **Analytics:** `LOG_SALT` for the salted caller hash, and the optional GA4 variables.

Never commit a real value. `.env` is gitignored.

## Database and migrations

Tables are created lazily at runtime: each module runs its own `CREATE TABLE IF NOT EXISTS` the
first time it is used. Each `migrations-pg/NNNN_*.sql` file holds the same statements word for
word, and a guard test keeps the two equal. Run a migration by hand with `psql` before a table
grows large (an index build on a big table should not happen on a live request). Every file is
safe to run more than once. Deleting an account removes its rows from every table listed in
`src/lib/accountDeleteTables.ts`.

The older `migrations/` folder and `npm run db:migrate` belong to the retired SQLite (Turso)
setup; see `POSTGRES_MIGRATION.md`.

## Scheduled jobs

Every scheduled job is a GitHub Actions workflow in `.github/workflows/` that calls an
`/api/cron/*` endpoint on the live service with the `CRON_SECRET` header. Each job prints a
summary of numbers only, so a public log never names an account or a wallet.

## Agent Vault

The Agent Vault lives in `src/lib/agentVault/`, with its pages under
`src/pages/dashboard/agentics/` and its endpoints under `src/pages/api/agentics/`. It is
owner-only until `AGENTICS_VAULT_PUBLIC` in `src/lib/agenticsFlag.mjs` is set to `true`.

- **Registry:** the agents an account creates, each agent's own wallets, and the destination
  addresses it may pay. Each destination is screened when it is added and is `trusted`,
  `pending` or `flagged`.
- **Ledger** (`events.ts`): append-only. A `checked` event is a pre-send check an agent asked
  with its API key. A `transaction` event is a direct transfer of the agent's own wallet.
- **Watcher** (`watcher.ts`): reads the explorer listings for each own wallet on Ethereum,
  Polygon and Avalanche, and records every direct transfer with the wallet on one side, in
  both directions, with the transaction hash and the other side's address. Each transfer
  records what the registry said about the other side when it was written: `trusted`,
  `pending`, `flagged`, or not on the list (`registry = none`, shown as `unregistered`). An
  outflow to an address not on the list, with no check about it in the hour before, is marked
  **unmatched**. A payment routed through a contract is recorded as a transfer to the
  contract, labeled where the listing says so. The newest few minutes are never read, so a
  reorganization cannot undo a recorded block.
- **Cursors** (`watchState.ts`): one per wallet (`agent_wallet_cursors`). A wallet's first read
  under it starts from the oldest of its earlier per-destination cursors, or from its
  registration. Event ids are derived from the transaction hash and leg, so reading the same
  history twice never writes a row twice.
- **Reports and export:** a daily report per agent, signed as a PDF and a proof bundle, and a
  signed export of the ledger for any range of days. Both count the transfers to addresses not
  on the list and the unmatched ones. Anyone can check a signed file at `/verify-record`, or
  offline with `scripts/verify-record.mjs`; see `docs/verify-without-almstins.md`.

## Working in this repo

- Branch from `production` and open a pull request into it. CI runs the hermetic unit suite,
  two Postgres integration tests against a throwaway container, and a full build. A merge is
  not a deploy: production deploys are started by hand on Render.
- Unit tests must pass with no database, no network and no secrets. Stub `@/lib/db` (the
  in-memory fake is `tests/helpers/receivablesDbFake.ts`).
- Every address, amount and name in code, tests, commits and docs is invented. Never use a
  real wallet, holding or person.
- Before a commit, run `bash scripts/scan-leak.sh --staged`. The same scan runs as a pre-push
  hook (`git config core.hooksPath .githooks`). It needs a local, gitignored `.scan-patterns`
  file and fails closed without one.
- User-facing words say Almstins verifies, flags and records. They never say it stops, blocks
  or holds a payment, and never call an address safe. Guard tests check the Agentics copy.
- American spelling in code comments and commit messages.

## Aave GraphQL checks

Markets:

```bash
curl -s https://api.v3.aave.com/graphql \
  -H "content-type: application/json" \
  --data-binary '{
    "query":"query($chainIds:[ChainId!]!,$user:EvmAddress){ markets(request:{chainIds:$chainIds,user:$user}){ name address chain{chainId} } }",
    "variables": { "chainIds":[1,137,43114], "user":"0xYOUR_WALLET_ADDRESS" }
  }' | jq
```

User market state (replace the market address with one from the markets result):

```bash
curl -s https://api.v3.aave.com/graphql \
  -H "content-type: application/json" \
  --data-binary '{
    "query":"query($request:UserMarketStateRequest!){ userMarketState(request:$request){ healthFactor totalCollateralBase totalDebtBase availableBorrowsBase } }",
    "variables": { "request": { "chainId":137, "market":"0xMARKETADDRESS", "user":"0xYOUR_WALLET_ADDRESS" } }
  }' | jq
```
