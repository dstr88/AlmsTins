/**
 * verifyPlans.copy.ts: every word on the /admin Verify plans panel.
 *
 * Markup lives in VerifyPlans.astro, behavior in verifyPlans.client.ts, presentation in
 * VerifyPlans.css. The component and the client both read this file, so a label and the
 * message that answers it are worded in one place. English only: /admin is the owner's screen.
 *
 * Plan names and numbers are not here. They come from src/lib/verifyPlans.ts.
 */
export const VERIFY_PLANS_COPY = {
	title: 'Verify plans',
	intro: 'Put an account on a paid Verify plan once it has paid, or take it back to Free. A plan here changes Verify only.',

	// The form.
	account: 'Account',
	accountHint: 'Email or tenant id',
	plan: 'Plan',
	planTotal: '{name}: {n} destinations',
	planPerKind: '{name}: {a} wallet addresses, {q} payment QR',
	paidThrough: 'Paid through',
	paidThroughHint: 'The last day paid for. Empty is no end date.',
	note: 'Note',
	noteHint: 'The invoice or wire that paid for it',
	submit: 'Set plan',
	submitting: 'Setting',

	// What a change answers.
	done: 'Set {account} to {plan}.',
	doneThrough: 'Set {account} to {plan}, paid through {date}.',
	unchanged: '{account} is already on Free. Nothing was changed.',

	// The list.
	colAccount: 'Account',
	colPlan: 'Plan',
	colState: 'State',
	colReadsAs: 'Counts as',
	colPaidThrough: 'Paid through',
	colDestinations: 'Destinations',
	colNote: 'Note',
	colChanged: 'Changed (UTC)',
	edit: 'Edit',
	noEmail: 'no member',
	noEndDate: 'no end date',
	destinationsOf: '{n} of {total}',
	loading: 'Loading',
	empty: 'No account has a plan row yet, so every account is on Free.',
	loadFailed: 'Could not load the plans.',

	/** A row's state: live, set back to Free, or past its paid-through date. */
	states: {
		live: 'Live',
		canceled: 'Canceled',
		ended: 'Ended',
	},

	/** The route's error codes, worded. */
	errors: {
		account_required: 'Enter an email or a tenant id.',
		account_not_found: 'No account has that email or tenant id.',
		owner_account: 'The owner account has no limit, so it takes no plan.',
		invalid_plan: 'Choose a plan.',
		invalid_paid_through: 'Paid through must be a date.',
		paid_through_past: 'Paid through cannot be in the past.',
		note_too_long: 'The note is longer than {n} characters.',
		invalid_body: 'The request was not understood.',
		unauthorized: 'Sign in again.',
		forbidden: 'This account is not an admin.',
		unavailable: 'The plan could not be saved. Try again.',
	} as Record<string, string>,
};
