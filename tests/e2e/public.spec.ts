import { test, expect } from '@playwright/test';

/**
 * Public page tests — no authentication required.
 * These run on every push and verify that unauthenticated visitors
 * see a working, non-broken landing and login experience.
 */

test.describe('Login page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/login');
		// Wait for the page to finish hydrating
		await expect(page.locator('h2').filter({ hasText: /sign in/i })).toBeVisible({ timeout: 15000 });
	});

	test('page loads and heading is visible', async ({ page }) => {
		await expect(page).toHaveTitle(/almstins/i);
	});

	test('Google and GitHub buttons are enabled', async ({ page }) => {
		await expect(page.getByRole('button', { name: /continue with google/i })).toBeEnabled();
		await expect(page.getByRole('button', { name: /continue with github/i })).toBeEnabled();
	});

	test('email sign-in form is present and enabled', async ({ page }) => {
		const form = page.locator('form').filter({ has: page.locator('input[name="password"]') });
		await expect(form.locator('input[name="email"]')).toBeVisible();
		await expect(form.locator('input[name="password"]')).toBeVisible();
		await expect(form.getByRole('button', { name: /sign in with email/i })).toBeEnabled();
	});

	test('magic link form is present and enabled', async ({ page }) => {
		const form = page.locator('form[action*="signin/email"]');
		await expect(form.locator('input[name="email"]')).toBeVisible();
		await expect(form.getByRole('button', { name: /send magic link/i })).toBeEnabled();
	});

	test('create account link is visible', async ({ page }) => {
		await expect(page.getByRole('link', { name: /create an account/i })).toBeVisible();
	});
});

test.describe('Wallet checker page', () => {
	test('loads without redirecting to login', async ({ page }) => {
		await page.goto('/wallet-checker');
		await expect(page).not.toHaveURL(/\/login/);
		await expect(page).toHaveURL(/wallet-checker/);
	});
});
