import { test, expect } from '@playwright/test';

/**
 * Public page smoke tests — no authentication required. Run on every push and
 * every 6h against the live site.
 *
 * Kept deliberately ROBUST: assert only stable, visible public content (the
 * homepage hub + the public tool pages). The hub redesign moved the actual
 * sign-in controls into a dropdown pill, so we no longer assert on the auth
 * form internals here — that belongs in an authenticated/interaction test.
 */

test.describe('Homepage hub', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/login');
		// The hub hero <h1> is the stable anchor that the page has rendered.
		await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
	});

	test('loads with the Almstins title', async ({ page }) => {
		await expect(page).toHaveTitle(/almstins/i);
	});

	test('shows the three product doors', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /wallet checker/i }).first()).toBeVisible();
		await expect(page.getByRole('heading', { name: /wallet watcher/i }).first()).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Verify', exact: true }).first()).toBeVisible();
	});
});

test.describe('Public tool pages stay public (no login redirect)', () => {
	test('wallet checker loads', async ({ page }) => {
		await page.goto('/wallet-checker');
		await expect(page).not.toHaveURL(/\/login/);
		await expect(page).toHaveURL(/wallet-checker/);
	});

	test('verify loads', async ({ page }) => {
		await page.goto('/verify');
		await expect(page).not.toHaveURL(/\/login/);
		await expect(page).toHaveURL(/\/verify/);
	});
});
