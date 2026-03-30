import { test, expect } from '@playwright/test';

/**
 * Bookkeeping dashboard tests — require authentication.
 */

test.describe('Bookkeeping page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/dashboard/bookkeeping');
		await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
	});

	test('page loads without redirecting to login', async ({ page }) => {
		await expect(page).toHaveURL(/bookkeeping/);
	});

	test('page renders a tin or empty state (not a blank page)', async ({ page }) => {
		// At minimum the body should have meaningful content
		const body = page.locator('body');
		await expect(body).not.toBeEmpty();
		// Should not show a raw error/exception
		await expect(page.getByText(/internal server error/i)).not.toBeVisible();
		await expect(page.getByText(/unexpected token/i)).not.toBeVisible();
	});
});
