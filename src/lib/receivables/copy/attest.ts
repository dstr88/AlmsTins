/**
 * Copy for the free-text attest endpoint (POST /api/verify/receivables/attest).
 *
 * Pure and import-free, like every module under src/lib/receivables/copy/. Each string is held
 * to the bright-line wording rules by tests/helpers/brightLineWording.ts.
 */

/** The message on a 400 reserved_prefix answer. The registry form shows it to the person as
 *  is, so it says what to change rather than what went wrong. */
export const RESERVED_PREFIX_MESSAGE =
	'A statement cannot open with DISPUTED, DILIGENCE, UNANSWERED or DECLINED in capitals, or with one of those words followed by a dash. Those openings mark answers recorded through a request link, so start the statement another way.';
