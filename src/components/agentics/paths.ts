/**
 * Where the Agentics pages and their downloads live. One place, so a link can never drift from the
 * route it names (tests/agentics/agenticsUi.test.ts checks each one against the files under
 * src/pages).
 */
export const REPORTS_PATH = '/dashboard/agentics/reports';

/** The page of one report. */
export const reportHref = (id: string): string => `${REPORTS_PATH}/${encodeURIComponent(id)}`;

/** The signed PDF of one report. */
export const pdfHref = (id: string): string => `/api/agentics/reports/pdf?id=${encodeURIComponent(id)}`;

/** The proof bundle of one report (what /verify-record reads). */
export const bundleHref = (id: string): string => `/api/agentics/reports/bundle?id=${encodeURIComponent(id)}`;

/** The public page that checks a proof bundle in the browser. */
export const VERIFY_RECORD_PATH = '/verify-record';
