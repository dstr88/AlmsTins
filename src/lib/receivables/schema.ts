/**
 * Receivables schema additions, as import-free constants.
 *
 * db:migrate is retired. The registry creates and extends its own tables at runtime with
 * idempotent DDL (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS), run by
 * ensureReceivablesTables in src/lib/receivablesRegistry.ts. Every new statement lands here
 * rather than in the registry, so the schema changes read as one list.
 *
 * New tables are created with the registry's own tables: a failed CREATE fails the whole ensure,
 * which is forgotten and retried on the next call, so no read ever meets a missing relation.
 *
 * Column adds run one at a time, after the tables exist. A failed add is logged, leaves
 * receivableColumnsEnsured() false and is retried on a later call. Readers and writers of a
 * column added here check that flag first and fall back to what they did before the column
 * existed, so a failed ALTER degrades one feature instead of failing every read.
 */

/**
 * receivable_attestations.source: who wrote the row, as an AttestationSource (see
 * src/lib/receivables/attestationClass.ts). NULL on rows written before it existed; those are
 * classified by their statement prefix.
 */
export const ADD_ATTESTATION_SOURCE = 'ALTER TABLE receivable_attestations ADD COLUMN IF NOT EXISTS source TEXT';

/**
 * A discharge's own evidence, kept beside the discharge manifest and digest that were already
 * stored: the signature over that manifest (it used to be computed and thrown away), the
 * Bitcoin timestamp receipt for its digest, and the full recorded-at time (discharged_at holds
 * only the date). NULL on discharges recorded before these columns existed.
 */
export const ADD_DISCHARGE_SIGNATURE = 'ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_signature_json TEXT';
export const ADD_DISCHARGE_ANCHOR = 'ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_anchor_json TEXT';
export const ADD_DISCHARGE_RECORDED_AT = 'ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_recorded_at TEXT';

/** The same three for a settlement, on the receivable row. */
export const ADD_SETTLEMENT_SIGNATURE = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_signature_json TEXT';
export const ADD_SETTLEMENT_ANCHOR = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_anchor_json TEXT';
export const ADD_SETTLEMENT_RECORDED_AT = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_recorded_at TEXT';

/**
 * receivables.deleted_at: when the owner withdrew the record (S2 soft delete). Deleting a
 * receivable sets this and keeps every row, so other parties' claims and statements stay
 * answerable and a re-recorded duplicate is still matched against it. NULL on a live record;
 * cleared again when the owner records the same details. Until this column is confirmed in the
 * process, reads ignore it and deleting answers unavailable rather than removing rows. It is
 * confirmed on its own (the registry's deletedAtReady: this add succeeded, or a read of the column
 * did), not with the rest of this list, so another add that fails never makes a withdrawn record
 * read as live.
 */
export const ADD_RECEIVABLE_DELETED_AT = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS deleted_at TEXT';

/**
 * The duplicate check's fingerprints (S3): keyed hashes of the record's canonical form (see
 * src/lib/receivables/fingerprintNormalize.ts and server/fingerprint.ts), never the plaintext.
 * fingerprint_ref is the strong key (debtor + the debtor's own reference + amount), fingerprint_inv
 * the fallback (debtor + supplier + invoice number + amount), fingerprint_doc the shipment key
 * (debtor + supplier + transport document number, no amount), fingerprint_kid the key and scheme that
 * made them. NULL until computed: a create writes them, and the backfill fills older rows and any
 * row whose kid is not the current one. Nullable with no default, so each add changes the catalog
 * only and rewrites no rows. Confirmed on their own (the registry's fingerprintColumnsReady: all five
 * adds below succeeded, or a read of the five did), so another add that fails never makes the duplicate
 * check read as clear.
 */
export const ADD_FINGERPRINT_REF = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_ref TEXT';
export const ADD_FINGERPRINT_INV = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_inv TEXT';
export const ADD_FINGERPRINT_KID = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_kid TEXT';
export const ADD_FINGERPRINT_DOC = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_doc TEXT';
/** The owner's private copy of the transport document number, encrypted (AES-256-GCM,
 *  verifyCrypto.ts); never in details_json or the manifest, which hold a keyed commitment only.
 *  Read only for the record's owner, and by the backfill to recompute fingerprint_doc. Confirmed
 *  with the fingerprint columns, so a create never writes a number it cannot also keep private. */
export const ADD_TRANSPORT_DOC_OWNER = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS transport_doc_owner TEXT';
export const FINGERPRINT_COLUMN_ADDS: readonly string[] = [ADD_FINGERPRINT_REF, ADD_FINGERPRINT_INV, ADD_FINGERPRINT_KID, ADD_FINGERPRINT_DOC, ADD_TRANSPORT_DOC_OWNER];

/** New column adds, in order. They run after the registry's original column list. */
/**
 * Which record an emailed request's answer created (receivables downloads, Part B). Set when the
 * answer is written, so the same link can later hand the person who answered their own record and
 * the receivable it is about, read-only, until six months after the due date. answer_kind is the
 * record kind (anchorSpec) and answer_id its id. Links answered before this existed have neither.
 */
export const ADD_INVITE_ANSWER_KIND = 'ALTER TABLE receivable_invites ADD COLUMN IF NOT EXISTS answer_kind TEXT';
export const ADD_INVITE_ANSWER_ID = 'ALTER TABLE receivable_invites ADD COLUMN IF NOT EXISTS answer_id TEXT';
export const INVITE_ANSWER_COLUMN_ADDS: readonly string[] = [ADD_INVITE_ANSWER_KIND, ADD_INVITE_ANSWER_ID];

/**
 * The template version each email used (email statement, approved 2026-11-28): written by the send
 * to its own log row, so a statement of the emails about a claim names the wording without keeping
 * the text. NULL on rows sent before these columns existed; a statement says "template version not
 * recorded" for those rather than guessing. Confirmed on their own (the registry's
 * emailTemplateReady: all four adds below succeeded, or a read of the four did); until then sends
 * write the old way and statements read every version as not recorded.
 */
export const ADD_NOTICE_LOG_TEMPLATE = 'ALTER TABLE receivable_notice_log ADD COLUMN IF NOT EXISTS template_version TEXT';
export const ADD_CLIENT_ACTION_TEMPLATE = 'ALTER TABLE receivable_client_action_notices ADD COLUMN IF NOT EXISTS template_version TEXT';
export const ADD_UPDATE_REQUEST_TEMPLATE = 'ALTER TABLE receivable_update_requests ADD COLUMN IF NOT EXISTS template_version TEXT';
export const ADD_UPDATE_DIGEST_TEMPLATE = 'ALTER TABLE receivable_update_request_digests ADD COLUMN IF NOT EXISTS template_version TEXT';
export const EMAIL_TEMPLATE_COLUMN_ADDS: readonly string[] = [
  ADD_NOTICE_LOG_TEMPLATE, ADD_CLIENT_ACTION_TEMPLATE, ADD_UPDATE_REQUEST_TEMPLATE, ADD_UPDATE_DIGEST_TEMPLATE,
];

export const RECEIVABLE_COLUMN_ADDS: readonly string[] = [
  ADD_ATTESTATION_SOURCE,
  ADD_DISCHARGE_SIGNATURE,
  ADD_DISCHARGE_ANCHOR,
  ADD_DISCHARGE_RECORDED_AT,
  ADD_SETTLEMENT_SIGNATURE,
  ADD_SETTLEMENT_ANCHOR,
  ADD_SETTLEMENT_RECORDED_AT,
  ADD_RECEIVABLE_DELETED_AT,
  ...FINGERPRINT_COLUMN_ADDS,
  ...INVITE_ANSWER_COLUMN_ADDS,
  ...EMAIL_TEMPLATE_COLUMN_ADDS,
];

/**
 * Partial indexes for the duplicate check's twin query: only rows that carry a fingerprint are
 * indexed. They run after the column adds, each on its own. A failed index is logged and retried
 * on its own a minute later (the column adds do not run again for it), and gates nothing: without
 * it the twin query is a slower scan, never a wrong answer.
 *
 * Built without CONCURRENTLY on purpose: they are created while every fingerprint is still NULL,
 * so the build is one scan into an empty index. If this is ever switched to CONCURRENTLY, note
 * that IF NOT EXISTS skips an INVALID index left by a cancelled build forever, so the ensure would
 * then need a pg_index.indisvalid check that drops and recreates it.
 */
export const CREATE_FP_REF_IDX = 'CREATE INDEX IF NOT EXISTS receivables_fp_ref ON receivables (fingerprint_ref) WHERE fingerprint_ref IS NOT NULL';
export const CREATE_FP_INV_IDX = 'CREATE INDEX IF NOT EXISTS receivables_fp_inv ON receivables (fingerprint_inv) WHERE fingerprint_inv IS NOT NULL';
export const CREATE_FP_DOC_IDX = 'CREATE INDEX IF NOT EXISTS receivables_fp_doc ON receivables (fingerprint_doc) WHERE fingerprint_doc IS NOT NULL';

/** New indexes on added columns, in order. They run after every column add. */
export const RECEIVABLE_INDEX_CREATES: readonly string[] = [CREATE_FP_REF_IDX, CREATE_FP_INV_IDX, CREATE_FP_DOC_IDX];

/**
 * Run before each column add and each index above, in the same transaction (one db.batch, which
 * the Postgres shim sends to the owner pool and wraps in BEGIN/COMMIT). ADD COLUMN IF NOT EXISTS
 * takes an ACCESS EXCLUSIVE lock even when the column is already there, and CREATE INDEX IF NOT
 * EXISTS takes a SHARE lock before it checks the name. Without a limit, one of them waiting behind
 * a long transaction on the table would queue every later read and write of that table behind it.
 * With it, the statement gives up after three seconds and the ensure carries on: a column whose add
 * timed out is confirmed by a zero-row read when it is already there, its feature stays off (fail
 * closed) when it is not, and the add is retried a minute later.
 */
export const DDL_LOCK_TIMEOUT = `SET LOCAL lock_timeout = '3s'`;

/**
 * receivable_anchor_attempts: when the anchor cron last asked about a record's timestamp, and
 * how many times. Rate bookkeeping only, keyed by (kind, record_id) and holding no tenant data.
 * The cron reads the oldest attempts first, so a receipt the calendars never confirm drops to
 * the back of the queue instead of taking a slot on every run.
 */
export const CREATE_ANCHOR_ATTEMPTS = `
  CREATE TABLE IF NOT EXISTS receivable_anchor_attempts (
    kind            TEXT NOT NULL,
    record_id       TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, record_id)
  )
`;

/**
 * receivable_status_events (aging A1): a claim's one-click status updates, append-only. One row =
 * one signed, dated event by the claim's own financier — `extended` (new_promised_date + a
 * mandatory structured reason_code, optional reason_note) or `unpaid` (optional reason_note).
 * Nothing here is ever updated or deleted; only the Bitcoin receipt (anchor_json) is written onto
 * a row after the fact, through the generic tenant-scoped setRecordAnchor (ANCHOR_SPEC
 * status_event). The receivable's own due_date is never rewritten — it sits inside the signed
 * manifest and the record's ID — these events layer the dated chain that moved it.
 *
 * reason_code / reason_note are tenant-tier data: the public status never selects them (D3) —
 * the aging state and the dated chain are public, the reasons are not.
 */
export const CREATE_STATUS_EVENTS = `
  CREATE TABLE IF NOT EXISTS receivable_status_events (
    id                TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    receivable_id     TEXT NOT NULL,
    claim_id          TEXT NOT NULL,
    kind              TEXT NOT NULL,
    new_promised_date TEXT,
    reason_code       TEXT,
    reason_note       TEXT,
    manifest_json     TEXT NOT NULL,
    signature_json    TEXT,
    digest            TEXT NOT NULL,
    anchor_json       TEXT,
    created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
/** The new table's own indexes. The registry creates them right after the table creates, the
 *  same way the core tables' indexes run (not RECEIVABLE_INDEX_CREATES, which holds only
 *  indexes on columns added at runtime); a failure fails the whole ensure, which is retried. */
export const CREATE_STATUS_EVENTS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_status_events_rcv ON receivable_status_events (receivable_id)`;
export const CREATE_STATUS_EVENTS_CLAIM_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_status_events_claim ON receivable_status_events (claim_id)`;
/** The lock's count (tier T2 / D11): an account's lapsed events in a trailing year. Partial, so
 *  the owner-written chain pays nothing for it. */
export const CREATE_STATUS_EVENTS_LAPSED_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_status_events_lapsed ON receivable_status_events (tenant_id, created_at) WHERE kind = 'lapsed'`;

/**
 * receivable_notice_log (aging A4 / D8): which aging-notice emails have gone out, one row per
 * (claim, notice, recipient role) — ever. The daily cron checks this before sending, so a
 * notice email is sent at most once per claim per recipient, however many runs see it due.
 * A row is written only after the send succeeded; a failed send leaves no row and is retried
 * on the next run. Bookkeeping only, like receivable_anchor_attempts: the claim id scopes it,
 * and no address or tenant is stored here.
 */
export const CREATE_NOTICE_LOG = `
  CREATE TABLE IF NOT EXISTS receivable_notice_log (
    claim_id       TEXT NOT NULL,
    notice         TEXT NOT NULL,
    recipient_role TEXT NOT NULL,
    sent_at        TEXT NOT NULL,
    PRIMARY KEY (claim_id, notice, recipient_role)
  )
`;

/**
 * receivable_notice_optouts (aging A4 / D8): the client-side suppression flag behind the
 * opt-out link every client notice carries. Keyed by lowercased address; the token is the
 * unguessable capability the link carries (the pattern of campaign_drip.unsub_token). A row
 * exists once a client notice is first prepared for that address; suppressed_at set means no
 * further client notices to it. Lender notices are account mail and carry no opt-out, so they
 * never read this table.
 */
export const CREATE_NOTICE_OPTOUTS = `
  CREATE TABLE IF NOT EXISTS receivable_notice_optouts (
    email         TEXT NOT NULL PRIMARY KEY,
    token         TEXT NOT NULL,
    suppressed_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;

/**
 * receivables_subscriptions (tier T1 / D9, D11, D15): the plan a receivables account is on, as a
 * table of this product's own. Never the tracker's `subscriptions` row: a tracker plan unlocks
 * nothing here and a receivables plan unlocks nothing there (the same seam the Agent Vault keeps).
 *
 * No row means the free plan. A row is written by billing (T4) when an account moves to Standard,
 * and by the aging cron (T2) when two lapses in a trailing year lock the free plan: free_locked_at
 * set means the account records no new contracts until it moves to Standard. The lock is account
 * state only; nothing on any record or public surface ever reads it.
 */
export const CREATE_RECEIVABLES_SUBSCRIPTIONS = `
  CREATE TABLE IF NOT EXISTS receivables_subscriptions (
    tenant_id               TEXT NOT NULL PRIMARY KEY,
    plan                    TEXT NOT NULL DEFAULT 'free',
    status                  TEXT NOT NULL DEFAULT 'active',
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    stripe_price_id         TEXT,
    current_period_end      TEXT,
    free_locked_at          TEXT,
    free_locked_reason_json TEXT,
    created_at              TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at              TEXT
  )
`;

/**
 * receivable_client_action_notices (Part B, approved 2026-11-28): the outbox behind the client
 * email sent when a lender acts on a claim (repaid, extended, marked unpaid) or the receivable is
 * settled. One row per action, ever, keyed by event_key ('repaid:<claim>', 'extended:<event>',
 * 'unpaid:<event>', 'settled:<receivable>'). The action route writes the row and tries the send at
 * once; the daily notices job retries any row still pending (sent_at and skipped both null) for a
 * few days. skipped records why a row never sends (test record, no address, opted out, the client
 * acted itself, withdrawn). Bookkeeping only: ids and dates, no address, no reason or note.
 */
export const CREATE_CLIENT_ACTION_NOTICES = `
  CREATE TABLE IF NOT EXISTS receivable_client_action_notices (
    event_key       TEXT NOT NULL PRIMARY KEY,
    kind            TEXT NOT NULL,
    receivable_id   TEXT NOT NULL,
    claim_id        TEXT,
    actor_tenant_id TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    sent_at         TEXT,
    skipped         TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0
  )
`;

/**
 * receivable_update_requests (Part A, approved 2026-11-28): requests that a lender update a claim.
 * An anonymous request is stored once per claim per UTC day (id 'pub:<claim>:<day>', clicks and
 * last_at bumped on a repeat), so a bot within the rate limit cannot flood the log and the public
 * line counts days. A client request is one row per click (id random) with the client's account
 * and an optional note of at most 280 characters that only the lender is shown. emailed_at: when
 * the lender was emailed about it (a client request at once, anonymous ones in the daily summary);
 * skipped: why it never will be (test record, withdrawn, answered, no address). Every read is
 * scoped: the lender by lender_tenant_id, the client by requester_tenant_id, the public answer
 * by claim to day counts only.
 */
export const CREATE_UPDATE_REQUESTS = `
  CREATE TABLE IF NOT EXISTS receivable_update_requests (
    id                  TEXT NOT NULL PRIMARY KEY,
    claim_id            TEXT NOT NULL,
    receivable_id       TEXT NOT NULL,
    lender_tenant_id    TEXT NOT NULL,
    source              TEXT NOT NULL,
    requester_tenant_id TEXT,
    day                 TEXT NOT NULL,
    note                TEXT,
    clicks              INTEGER NOT NULL DEFAULT 1,
    first_at            TEXT NOT NULL,
    last_at             TEXT NOT NULL,
    emailed_at          TEXT,
    skipped             TEXT
  )
`;
export const CREATE_UPDATE_REQUESTS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_update_requests_rcv ON receivable_update_requests (receivable_id)`;

/**
 * receivable_update_request_digests (Part A): one row per lender per UTC day once that day's
 * summary of anonymous requests went out, so a lender gets at most one summary a day however
 * often the job runs.
 */
export const CREATE_UPDATE_REQUEST_DIGESTS = `
  CREATE TABLE IF NOT EXISTS receivable_update_request_digests (
    lender_tenant_id TEXT NOT NULL,
    day              TEXT NOT NULL,
    sent_at          TEXT NOT NULL,
    PRIMARY KEY (lender_tenant_id, day)
  )
`;

/**
 * receivable_update_summary_claims (email statement): which claims each lender's daily summary of
 * anonymous update requests covered, one row per (claim, day) the summary went out. The digest row
 * above is per lender per day and an anonymous request row's emailed_at is cleared by a repeat
 * click, so neither alone can say later which summaries mentioned a claim; this can. Bookkeeping
 * only: ids, the day, when it was sent and the template version. No address, no requester.
 */
export const CREATE_UPDATE_SUMMARY_CLAIMS = `
  CREATE TABLE IF NOT EXISTS receivable_update_summary_claims (
    claim_id         TEXT NOT NULL,
    day              TEXT NOT NULL,
    lender_tenant_id TEXT NOT NULL,
    sent_at          TEXT NOT NULL,
    template_version TEXT,
    PRIMARY KEY (claim_id, day)
  )
`;

/**
 * receivable_email_statements (email statement, approved 2026-11-28): a signed statement of the
 * emails Almstins sent about one claim, as of the moment it was made (record kind
 * email_statement in anchorSpec). Made when the claim's lender or the receivable's client
 * downloads it; tenant_id is that viewer's account, so the proof-file route hands it back to
 * them alone. The manifest names roles, dates, email types and template versions only: no
 * address, no email text, no note and no requester.
 */
export const CREATE_EMAIL_STATEMENTS = `
  CREATE TABLE IF NOT EXISTS receivable_email_statements (
    id             TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    receivable_id  TEXT NOT NULL,
    claim_id       TEXT NOT NULL,
    viewer_role    TEXT NOT NULL,
    as_of          TEXT NOT NULL,
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    created_at     TEXT NOT NULL
  )
`;
export const CREATE_EMAIL_STATEMENTS_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_email_statements_rcv ON receivable_email_statements (receivable_id, tenant_id)`;

/**
 * receivable_email_log_epochs (email statement): from when each email log holds emails, so every
 * statement can say where its history starts. Written once per log, the first time a statement is
 * made: the earliest send that log holds then, or that moment when it holds none (so no email of
 * that kind was logged before it). Global bookkeeping, one row per log name, no tenant data.
 */
export const CREATE_EMAIL_LOG_EPOCHS = `
  CREATE TABLE IF NOT EXISTS receivable_email_log_epochs (
    log   TEXT NOT NULL PRIMARY KEY,
    since TEXT NOT NULL
  )
`;

/** New tables, in order. They run after the registry's own CREATEs and before any column add. */
export const RECEIVABLE_TABLE_CREATES: readonly string[] = [
  CREATE_ANCHOR_ATTEMPTS,
  CREATE_STATUS_EVENTS,
  CREATE_NOTICE_LOG,
  CREATE_NOTICE_OPTOUTS,
  CREATE_RECEIVABLES_SUBSCRIPTIONS,
  CREATE_CLIENT_ACTION_NOTICES,
  CREATE_UPDATE_REQUESTS,
  CREATE_UPDATE_REQUEST_DIGESTS,
  CREATE_UPDATE_SUMMARY_CLAIMS,
  CREATE_EMAIL_STATEMENTS,
  CREATE_EMAIL_LOG_EPOCHS,
];
