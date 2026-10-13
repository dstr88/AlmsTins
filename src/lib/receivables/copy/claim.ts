/**
 * Copy for registering a financing claim on the desk and the registry page: the duplicate-
 * financing (headroom) warning, the diligence prompt, validation and the notes the claim flow
 * shows (components/receivables/claimFlow.client.ts and AckPrompt). Pure and import-free.
 *
 * Plain text only: the flow sets every string with textContent. {name} placeholders are filled
 * by src/lib/receivables/fillCopy.ts. Almstins warns; the person decides whether to record.
 */

export const UNKNOWN_ERROR = 'unknown error';

// Headroom warning (409 exceeds_headroom). Same words on both pages.
export const HEADROOM_TITLE = 'Duplicate-financing risk.';
export const HEADROOM_BODY = 'Only {available} is unencumbered but {requested} was requested. {claimed} is already claimed against this receivable. Financing the full amount would double-pledge it.';
export const HEADROOM_TAKE_AVAILABLE = 'Register only the available {available}';
export const HEADROOM_RECORD_ANYWAY = 'Record it anyway (acknowledged over-claim)';

// Diligence prompt (409 diligence_required). The two pages differ in one phrase and the placeholder.
export const DILIGENCE_TITLE = 'No debtor confirmation is on record.';
export const DILIGENCE_BODY_DESK = "Financing this receivable would rest entirely on the supplier's word. Almstins does not verify the debtor's identity for you — that is your own job, and your own risk. A real debtor confirmation can be requested above; to finance now instead, accept responsibility for having verified this debtor yourself.";
export const DILIGENCE_BODY_REGISTRY = "Financing this receivable would rest entirely on the supplier's word. Almstins does not verify the debtor's identity for you — that is your own job, and your own risk. A real debtor confirmation can be requested from the financing desk; to finance now instead, accept responsibility for having verified this debtor yourself.";
export const DILIGENCE_METHOD_LABEL = 'How did you verify this debtor?';
/** Values must match METHODS in src/pages/api/verify/receivables/diligence-accept.ts L26. */
export const DILIGENCE_METHODS: ReadonlyArray<readonly [string, string]> = [
	['phone', 'Phone call'],
	['relationship', 'Existing relationship'],
	['correspondence', 'Written correspondence'],
	['other', 'Other'],
];
export const DILIGENCE_NOTE_LABEL = 'Note (optional)';
export const DILIGENCE_NOTE_PLACEHOLDER_DESK = 'Note (optional) — e.g. called their AP line';
export const DILIGENCE_NOTE_PLACEHOLDER_REGISTRY = 'e.g. called their AP line, spoke with Jane';
export const DILIGENCE_FINE_PRINT = 'By clicking below you are personally attesting that you verified this debtor as described above. This acceptance is signed under your account and permanently timestamped to Bitcoin — it cannot be edited or removed afterward.';
export const DILIGENCE_ACCEPT = 'I accept responsibility — continue';

// Validation
export const CLAIM_CHECK_FIRST = 'Check a receivable first.';
export const CLAIM_NEED_FIRM = 'Enter your firm name.';
export const CLAIM_NEED_AMOUNT = 'Enter the amount you are advancing.';
export const CLAIM_NEED_FIELDS = 'A valid receivable ID, a financier name, and a positive amount are required.';

/** The desk claim card's hint (desk L804). Replaces "A claim over the remaining headroom is refused." */
export const CLAIM_CARD_HINT_DESK = 'Signed and timestamped to Bitcoin. A claim over the remaining headroom shows a duplicate-financing warning first, and you decide whether to record it. Financing without a debtor confirmation on file requires you to accept responsibility for having verified the debtor yourself.';

/** Everything that differs between the desk's and the registry's claim notes. */
export interface ClaimHostCopy {
	/** Info note while the claim posts; null shows nothing. */
	sending: string | null;
	/** Note on a 401 from the claim post; null when the host's post handles 401 itself. */
	sessionEnded: { lead: string; link: string; href: string; tail: string } | null;
	/** {code} = error code or UNKNOWN_ERROR; {message} = message or failedFallback. */
	failed: string;
	failedFallback: string;
	/** Note when a post throws; null when the host's post never throws (rethrown). */
	unreachable: string | null;
	/** {financier}, {signed} = doneSigned when the claim was signed, else ''. */
	doneTitle: string;
	doneSigned: string;
	/** {claimed}, {available}, already formatted. */
	doneBody: string;
	/** {detail} = message or error or UNKNOWN_ERROR; {message} = message or diligenceFailedFallback. */
	diligenceFailed: string;
	diligenceFailedFallback: string;
}

export const CLAIM_COPY_DESK: ClaimHostCopy = {
	sending: 'Signing and registering…',
	sessionEnded: { lead: 'Your session ended. ', link: 'Sign in again', href: '/verify/login?next=/verify/desk', tail: ' to register the claim.' },
	failed: 'Could not register that claim: {code}',
	failedFallback: 'Could not register the claim.',
	unreachable: 'Could not reach the registry. Try again.',
	doneTitle: 'Claim registered and signed.',
	doneSigned: ' and signed',
	doneBody: 'Now {claimed} claimed, {available} unencumbered.',
	diligenceFailed: 'Could not record your acceptance: {detail}',
	diligenceFailedFallback: 'Could not record your acceptance.',
};

export const CLAIM_COPY_REGISTRY: ClaimHostCopy = {
	sending: null,
	sessionEnded: null,
	failed: '{message}',
	failedFallback: 'Could not register the claim.',
	unreachable: null,
	doneTitle: "{financier}'s claim registered{signed}.",
	doneSigned: ' and signed',
	doneBody: 'Now {claimed} claimed · {available} unencumbered.',
	diligenceFailed: '{message}',
	diligenceFailedFallback: 'Could not record your acceptance.',
};
