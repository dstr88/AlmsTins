import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '.auth/user.json');

/**
 * Logs in once using email+password credentials and saves the browser
 * session to disk.  All "authenticated" tests load from this file so
 * they skip the login flow entirely.
 *
 * Requires env vars:  E2E_EMAIL  E2E_PASSWORD
 */
setup('authenticate', async ({ page }) => {
	const email    = process.env.E2E_EMAIL;
	const password = process.env.E2E_PASSWORD;

	if (!email || !password) {
		throw new Error(
			'E2E_EMAIL and E2E_PASSWORD must be set.\n' +
			'Add them to .env or pass them inline:\n' +
			'  E2E_EMAIL=you@example.com E2E_PASSWORD=yourpass npx playwright test',
		);
	}

	await page.goto('/login');

	// Wait for the credentials form to be interactive
	await expect(page.locator('input[name="email"]').first()).toBeVisible({ timeout: 15000 });

	// Fill the email+password form (first email input on the page)
	await page.locator('form').filter({ has: page.locator('input[name="password"]') })
		.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.locator('button[type="submit"]').filter({ hasText: /sign in with email/i }).click();

	// Should land on a dashboard page
	await page.waitForURL(/\/dashboard/, { timeout: 20000 });

	await page.context().storageState({ path: authFile });
	console.log(`✓ Auth state saved to ${authFile}`);
});
