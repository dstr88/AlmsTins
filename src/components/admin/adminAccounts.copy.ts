/**
 * adminAccounts.copy.ts: every word on the /admin New accounts list, the Accounts by country
 * count above it and the Verify steps table.
 *
 * Markup lives in NewAccounts.astro and VerifySteps.astro, presentation in their stylesheets,
 * the rules in src/lib/adminNewAccounts.ts and src/lib/adminVerifySteps.ts. English only: /admin
 * is the owner's screen.
 *
 * Product names, sign-in method names, plan names and plan numbers are not here. They come from
 * src/lib/signupService.ts and src/lib/verifyPlans.ts.
 */
import type { EvidenceTagId } from '@/lib/adminNewAccounts';

export const NEW_ACCOUNTS_COPY = {
	title: 'New accounts',
	intro: 'The newest {n} accounts, newest first. The tags are evidence worked out from what is already kept. None of them is a verdict about a person.',
	failed: 'The list could not be loaded. The reason is in the server log.',
	empty: 'No accounts yet',
	recordsUnknown: 'The check for wallets, imports and other records could not be read, so no row shows "Set something up" this time.',
	verifyUnknown: 'Verify could not be read, so no row shows "At limit" or a Verify plan this time.',

	colSignedUp: 'Signed up',
	colCountry: 'Country',
	colAccount: 'Account',
	colProduct: 'Signed up for',
	colMethods: 'Signs in with',
	colLastSignIn: 'Last sign-in',
	colLastActive: 'Last active (UTC day)',
	colEvidence: 'Evidence',

	/** An empty last sign-in, and an account never seen active. */
	never: 'Never',
	/** An account from before sign-up times were kept. */
	noSignUpTime: 'Earlier account',
	noEmail: 'no email',

	tags: {
		'proven-sign-in': {
			label: 'Proven sign-in',
			title: 'A linked Google or GitHub account, or an email address the person confirmed.',
		},
		'company-email': {
			label: 'Company email',
			title: 'The address is not at a free-mail provider.',
		},
		'set-up': {
			label: 'Set something up',
			title: 'The account has at least one wallet, import, document, receivable, Verify destination, agent or other record.',
		},
		'at-limit': {
			label: 'At limit',
			title: 'On the Free Verify plan and at a cap: {a} wallet addresses or {q} payment QR.',
		},
		'verify-plan': {
			label: 'Verify {plan}',
			title: 'On a paid Verify plan today.',
		},
	} satisfies Record<EvidenceTagId, { label: string; title: string }>,
} as const;

export const ACCOUNTS_BY_COUNTRY_COPY = {
	title: 'Accounts by country',
	intro: 'The country each account last signed in from. A VPN or a trip changes it, and it is not a billing country. An account with no recorded sign-in reads Unknown.',
	failed: 'The count could not be loaded. The reason is in the server log.',
	empty: 'No accounts yet',
} as const;

export const VERIFY_STEPS_COPY = {
	title: 'Verify steps',
	intro: 'Every account that signed up through Verify or holds a Verify destination. Claimed is an address whose control is proven. Verified is a claimed address that a proven domain lists, confirmed in the last 24 hours. Each step counts the ones after it.',
	failed: 'The table could not be loaded. The reason is in the server log.',
	empty: 'No Verify accounts yet',
	shown: 'Showing the newest {n} of {total} accounts. The totals cover all of them.',

	statAccounts: 'Verify accounts',
	statAccountsSub: 'signed up through Verify, or hold a destination',
	statRegistered: 'Registered an address',
	statClaimed: 'Claimed an address',
	statVerified: 'Verified an address',
	/** Under each step's account count. */
	statAddresses: '{n} addresses in all',
	statAddressesOne: '1 address in all',

	colAccount: 'Account',
	colSignedUp: 'Signed up',
	colProduct: 'Signed up for',
	colRegistered: 'Addresses registered',
	colClaimed: 'Claimed',
	colVerified: 'Verified',
	colQrs: 'Payment QRs',

	noSignUpTime: 'Earlier account',
	noEmail: 'no email',
} as const;
