import { test, expect } from '@playwright/test';

/**
 * Vault dashboard tests — require authentication.
 * Session is provided by tests/e2e/auth.setup.ts via storageState.
 *
 * These tests cover the interactions most likely to break silently,
 * i.e. things that have no visible JS error but simply stop working.
 */

test.describe('Vault page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/dashboard/vault');
		// Must not bounce to login
		await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
		// Page shell should be visible
		await expect(page.locator('.add-tin')).toBeVisible({ timeout: 15000 });
	});

	// ── Page load ──────────────────────────────────────────────────────────

	test('page loads and Add Asset tin is visible', async ({ page }) => {
		await expect(page.getByText('Add Asset')).toBeVisible();
	});

	test('Wallet tab is active by default', async ({ page }) => {
		const tin = page.locator('.add-tin');
		await expect(tin.locator('[data-add-tab="wallet"]')).toHaveClass(/is-active/);
		await expect(tin.locator('[data-add-panel="wallet"]')).toBeVisible();
		await expect(tin.locator('[data-add-panel="exchange"]')).toBeHidden();
		await expect(tin.locator('[data-add-panel="custom"]')).toBeHidden();
	});

	// ── Tab switching ──────────────────────────────────────────────────────
	// These are the tests that would have caught the broken tab bug.

	test('Exchange tab switches panel', async ({ page }) => {
		const tin = page.locator('.add-tin');
		await tin.locator('[data-add-tab="exchange"]').click();

		await expect(tin.locator('[data-add-panel="exchange"]')).toBeVisible();
		await expect(tin.locator('[data-add-tab="exchange"]')).toHaveClass(/is-active/);
		await expect(tin.locator('[data-add-panel="wallet"]')).toBeHidden();
	});

	test('Custom tab switches panel', async ({ page }) => {
		const tin = page.locator('.add-tin');
		await tin.locator('[data-add-tab="custom"]').click();

		await expect(tin.locator('[data-add-panel="custom"]')).toBeVisible();
		await expect(tin.locator('[data-add-tab="custom"]')).toHaveClass(/is-active/);
		await expect(tin.locator('[data-add-panel="wallet"]')).toBeHidden();
	});

	test('tabs can switch back and forth', async ({ page }) => {
		const tin = page.locator('.add-tin');

		await tin.locator('[data-add-tab="exchange"]').click();
		await expect(tin.locator('[data-add-panel="exchange"]')).toBeVisible();

		await tin.locator('[data-add-tab="wallet"]').click();
		await expect(tin.locator('[data-add-panel="wallet"]')).toBeVisible();
		await expect(tin.locator('[data-add-panel="exchange"]')).toBeHidden();
	});

	// ── Exchange list ──────────────────────────────────────────────────────

	test('Exchange list contains all expected sources', async ({ page }) => {
		const tin = page.locator('.add-tin');
		await tin.locator('[data-add-tab="exchange"]').click();

		const list = tin.locator('.add-tin__exchange-list');
		await expect(list.locator('[data-add-exchange="crypto-com"]')).toBeVisible();
		await expect(list.locator('[data-add-exchange="coinbase"]')).toBeVisible();
		await expect(list.locator('[data-add-exchange="gemini"]')).toBeVisible();
		await expect(list.locator('[data-add-exchange="venmo"]')).toBeVisible();
		await expect(list.locator('[data-add-exchange="cashapp"]')).toBeVisible();
		await expect(list.locator('[data-add-exchange="exodus"]')).toBeAttached();
	});

	// ── Exchange tins in vault ─────────────────────────────────────────────

	test('Coinbase tin has Add account button', async ({ page }) => {
		await expect(
			page.locator('[data-exchange-add][data-exchange-source="coinbase"]'),
		).toBeVisible();
	});

	test('Exodus tin has Add account button', async ({ page }) => {
		await expect(
			page.locator('[data-exchange-add][data-exchange-source="exodus"]'),
		).toBeVisible();
	});

	// ── Custom wallet panel ────────────────────────────────────────────────

	test('Custom panel has label input and save button', async ({ page }) => {
		const tin = page.locator('.add-tin');
		await tin.locator('[data-add-tab="custom"]').click();

		await expect(tin.locator('[data-custom-label]')).toBeVisible();
		await expect(tin.locator('[data-custom-submit]')).toBeVisible();
	});
});
