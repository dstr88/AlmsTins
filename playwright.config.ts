import { defineConfig, devices } from '@playwright/test';

/**
 * Almstins E2E test config.
 *
 * Local:  BASE_URL defaults to https://almstins.com (override for localhost)
 * CI/CD:  BASE_URL=https://almstins.com (GitHub Actions secret E2E_BASE_URL)
 *
 * Auth credentials (for authenticated tests):
 *   E2E_EMAIL / E2E_PASSWORD — set in .env or GitHub Actions secrets.
 *
 * The auth-dependent projects (setup + authenticated) only register when those
 * credentials are present. Without them the run is PUBLIC-ONLY and passes, instead
 * of failing the whole suite on a missing login (which used to spam failure emails).
 */
const hasAuthCreds = !!(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? 'https://almstins.com',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'on-first-retry',
	},
	projects: [
		// ── Public pages (no auth needed) — always run ───────────────────
		{
			name: 'public',
			testMatch: /public\.spec\.ts/,
			use: { ...devices['Desktop Chrome'] },
		},

		// ── Auth-dependent projects — only when E2E_EMAIL/PASSWORD are set ─
		...(hasAuthCreds
			? [
					{
						name: 'setup',
						testMatch: /auth\.setup\.ts/,
						use: { ...devices['Desktop Chrome'] },
					},
					{
						name: 'authenticated',
						testMatch: /vault\.spec\.ts|bookkeeping\.spec\.ts/,
						use: {
							...devices['Desktop Chrome'],
							storageState: 'tests/e2e/.auth/user.json',
						},
						dependencies: ['setup'],
					},
				]
			: []),
	],
});
