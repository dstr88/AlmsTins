const transitionPage = import.meta.glob('../pages/transition.astro');
const hasTransitionPage = Object.keys(transitionPage).length > 0;

function normalizeNextPath(nextValue: FormDataEntryValue | string | null | undefined) {
	if (typeof nextValue !== 'string' || nextValue.length === 0) {
		return null;
	}

	if (nextValue.startsWith('/') && !nextValue.startsWith('//')) {
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

	if (hasTransitionPage) {
		return '/dashboard/vault';
	}

	return '/dashboard/vault';
}
