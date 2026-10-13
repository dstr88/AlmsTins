import { safeNextPath } from './safeNext';

const transitionPage = import.meta.glob('../pages/transition.astro');
const hasTransitionPage = Object.keys(transitionPage).length > 0;

function normalizeNextPath(nextValue: FormDataEntryValue | string | null | undefined) {
	// Same-origin paths only (see safeNext.ts for the tricks this refuses).
	const safe = safeNextPath(nextValue);
	if (!safe) {
		return null;
	}

	// Never treat API endpoints as post-login destinations.
	if (safe.startsWith('/api/')) {
		return '/onboarding/tenant-setup';
	}
	return safe;
}

export function getPostLoginRedirect(nextValue: FormDataEntryValue | string | null | undefined) {
	const normalized = normalizeNextPath(nextValue);
	if (normalized) {
		return normalized;
	}

	// /dashboard checks the user's role and redirects to /admin or /dashboard/vault
	return '/dashboard';
}
