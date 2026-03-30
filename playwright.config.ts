import { defineConfig, devices } from '@playwright/test';

/**
 * Almstins E2E test config.
 *
 * Local:  BASE_URL defaults to http://localhost:10000 (npm run dev)
 * CI/CD:  BASE_URL=https://almstins.com (set in GitHub Actions secret)
 *
 * Auth credentials (for authenticated tests):
 *   E2E_EMAIL / E2E_PASSWORD — set in .env or GitHub Actions secrets.
 */
export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: process.env.BASE_URL ?? 'http://localhost:10000',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'on-first-retry',
	},
	projects: [
		// ── Step 1: log in and save session state ────────────────────────
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/,
			use: { ...devices['Desktop Chrome'] },
		},

		// ── Public pages (no auth needed) ────────────────────────────────
		{
			name: 'public',
			testMatch: /public\.spec\.ts/,
			use: { ...devices['Desktop Chrome'] },
		},

		// ── Authenticated pages (depend on setup) ────────────────────────
		{
			name: 'authenticated',
			testMatch: /vault\.spec\.ts|bookkeeping\.spec\.ts/,
			use: {
				...devices['Desktop Chrome'],
				storageState: 'tests/e2e/.auth/user.json',
			},
			dependencies: ['setup'],
		},
	],
});
