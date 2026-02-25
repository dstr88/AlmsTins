import crypto from 'node:crypto';

const DEV_FALLBACK_SALT = 'almstins-dev-log-salt';
let warnedMissingSalt = false;

function getSalt() {
	const envSalt = process.env.LOG_SALT;
	if (envSalt && envSalt.length > 0) {
		return envSalt;
	}

	const isDev = process.env.NODE_ENV !== 'production';
	if (!warnedMissingSalt) {
		warnedMissingSalt = true;
		console.warn('[analytics] LOG_SALT missing', {
			mode: isDev ? 'dev' : 'production',
			fallback: isDev ? 'dev-fixed' : 'auth-secret-or-emergency',
		});
	}

	if (isDev) return DEV_FALLBACK_SALT;
	return process.env.AUTH_SECRET || 'almstins-prod-log-salt-missing';
}

export function hashWithSalt(value: string): string {
	return crypto.createHmac('sha256', getSalt()).update(value).digest('hex');
}

