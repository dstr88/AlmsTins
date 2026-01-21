const loggedFlag = '__ledgerlense_env_status_logged__';

export function logEnvStatus() {
	const globalAny = globalThis as typeof globalThis & { [loggedFlag]?: boolean };
	if (globalAny[loggedFlag]) return;
	globalAny[loggedFlag] = true;

	const status = {
		AUTH_SECRET: Boolean(import.meta.env.AUTH_SECRET),
		AUTH_URL: Boolean(import.meta.env.AUTH_URL),
		GOOGLE_ID: Boolean(import.meta.env.GOOGLE_ID),
		GOOGLE_SECRET: Boolean(import.meta.env.GOOGLE_SECRET),
		GITHUB_ID: Boolean(import.meta.env.GITHUB_ID),
		GITHUB_SECRET: Boolean(import.meta.env.GITHUB_SECRET),
		EMAIL_SERVER: Boolean(import.meta.env.EMAIL_SERVER),
		EMAIL_FROM: Boolean(import.meta.env.EMAIL_FROM),
		TURSO_DATABASE_URL: Boolean(import.meta.env.TURSO_DATABASE_URL),
		TURSO_AUTH_TOKEN: Boolean(import.meta.env.TURSO_AUTH_TOKEN),
	};

	console.log('[env] presence', status);

	const authUrl = import.meta.env.AUTH_URL ?? '';
	let authUrlHost = 'unknown';
	try {
		authUrlHost = authUrl ? new URL(authUrl).host : 'missing';
	} catch {
		authUrlHost = 'invalid';
	}

	const providers = {
		google: status.GOOGLE_ID && status.GOOGLE_SECRET,
		github: status.GITHUB_ID && status.GITHUB_SECRET,
		email: status.EMAIL_SERVER && status.EMAIL_FROM,
		credentials: true,
	};

	console.log('[env] auth_url_host', authUrlHost);
	console.log('[env] providers', providers);
}
