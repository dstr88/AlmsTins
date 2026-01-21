const required = [
	'AUTH_SECRET',
	'AUTH_DISABLED',
	'GITHUB_ID',
	'GITHUB_SECRET',
	'GOOGLE_ID',
	'GOOGLE_SECRET',
	'EMAIL_SERVER',
	'EMAIL_FROM',
	'TURSO_DATABASE_URL',
	'TURSO_AUTH_TOKEN',
	'AUTH_URL',
];

const optional = ['DATABASE_URL', 'DATABASE_AUTH_TOKEN'];

const format = (key) => `${key}=${process.env[key] ? 'present' : 'missing'}`;

console.log('[env-check] required');
required.forEach((key) => console.log(`- ${format(key)}`));

console.log('[env-check] optional');
optional.forEach((key) => console.log(`- ${format(key)}`));
