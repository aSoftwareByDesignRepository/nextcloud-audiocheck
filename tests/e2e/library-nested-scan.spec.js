// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

/**
 * Library page UX for nested audiobook scanning — tip lives in How it works;
 * per-folder nested toggle is under progressive “Folder options”.
 */

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

test.describe('Library nested scan UX', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test.beforeEach(async ({ page }) => {
		if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
			await login(page, credsFromEnv('ADMIN'));
		}
	});

	test('library page explains Author/Book nesting and stays WCAG AA', async ({ page }) => {
		await page.goto(BASE + '/apps/audiocheck/library', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#app-content.ac-app, #content.app-audiocheck').first()).toBeVisible({ timeout: 30000 });
		await expect(page.getByRole('heading', { name: /library|bibliothek|your folders|deine ordner/i }).first()).toBeVisible();

		const how = page.locator('#ac-library-how-heading').first();
		await expect(how).toBeVisible();
		const howDetails = page.locator('.ac-section--collapsible').filter({ has: how }).locator('details').first();
		if (!(await howDetails.getAttribute('open'))) {
			await howDetails.locator('summary').click();
		}
		await expect(page.locator('.ac-library-layout-hint')).toContainText(/Author \/ Book|Autor \/ Buch/i);

		const card = page.locator('.ac-library-card').first();
		if (await card.count()) {
			const options = card.locator('details.ac-library-card__options');
			await options.locator('summary').click();
			await expect(card.getByRole('checkbox', { name: /include nested folders|unterordner einbeziehen/i })).toBeVisible();
		}

		await page.goto(BASE + '/apps/audiocheck/settings', { waitUntil: 'domcontentloaded' });
		await expect(page.getByText(/Author\/Book\/Chapter|Autor\/Buch\/Kapitel/i).first()).toBeVisible({ timeout: 30000 });

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.include('#app-content.ac-app')
			.exclude('.ac-toast')
			.exclude('.ac-toast-fallback')
			.analyze();
		expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
	});
});
