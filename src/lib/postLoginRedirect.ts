const transitionPage = import.meta.glob('../pages/transition.astro');
const hasTransitionPage = Object.keys(transitionPage).length > 0;

function normalizeNextPath(nextValue: FormDataEntryValue | string | null | undefined) {
	if (typeof nextValue !== 'string' || nextValue.length === 0) {
		return null;
	}

	// Reject `//host` and `/\host` — both are treated as protocol-relative
	// external URLs by browsers (Chrome normalizes `\` to `/`).
	if (nextValue.startsWith('/') && !nextValue.startsWith('//') && !nextValue.startsWith('/\\')) {
		// Never treat API endpoints as post-login destinations.
		if (nextValue.startsWith('/api/')) {
			return '/onboarding/tenant-setup';
		}
		return nextValue;
	}

	return null;
}

export function getPostLoginRedirect(nextValue: FormDataEntryValue | string | null | undefined) {
	const normalized = normalizeNextPath(nextValue);
	if (normalized) {
		return normalized;
	}

	// /dashboard checks the user's role and redirects to /admin or /dashboard/vault
	return '/dashboard';
}
