const loggedFlag = '__ledgerlense_env_status_logged__';

export function logEnvStatus() {
	const globalAny = globalThis as typeof globalThis & { [loggedFlag]?: boolean };
	if (globalAny[loggedFlag]) return;
	globalAny[loggedFlag] = true;

	const status = {
		AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
		AUTH_URL: Boolean(process.env.AUTH_URL),
		GOOGLE_ID: Boolean(process.env.GOOGLE_ID),
		GOOGLE_SECRET: Boolean(process.env.GOOGLE_SECRET),
		GITHUB_ID: Boolean(process.env.GITHUB_ID),
		GITHUB_SECRET: Boolean(process.env.GITHUB_SECRET),
		EMAIL_SERVER: Boolean(process.env.EMAIL_SERVER),
		EMAIL_FROM: Boolean(process.env.EMAIL_FROM),
		// Both database logins: owner (public pages, crons) and web (signed-in pages).
		DATABASE_URL: Boolean(process.env.DATABASE_URL),
		WEB_DATABASE_URL: Boolean(process.env.WEB_DATABASE_URL),
	};

	console.log('[env] presence', status);

	const authUrl = process.env.AUTH_URL ?? '';
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
