const transitionPage = import.meta.glob('../pages/transition.astro');
const hasTransitionPage = Object.keys(transitionPage).length > 0;

function normalizeNextPath(nextValue: FormDataEntryValue | string | null | undefined) {
	if (typeof nextValue !== 'string' || nextValue.length === 0) {
		return null;
	}

	if (nextValue.startsWith('/') && !nextValue.startsWith('//')) {
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
		return '/transition';
	}

	return '/dashboard';
}
