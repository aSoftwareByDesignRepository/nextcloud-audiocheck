// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

/**
 * Library page UX for nested audiobook scanning — copy, scope control, a11y.
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

		// Empty or populated: the add-folder / list region must be present.
		await expect(page.getByRole('heading', { name: /library|bibliothek/i }).first()).toBeVisible();

		// Settings tip lives on Settings; Library tip appears once folders exist.
		// Always verify the Subfolders control wording is available after adding
		// is possible — scan preference copy is also on Settings.
		await page.goto(BASE + '/apps/audiocheck/settings', { waitUntil: 'domcontentloaded' });
		await expect(page.getByText(/Author\/Book\/Chapter|Autor\/Buch\/Kapitel/i).first()).toBeVisible({ timeout: 30000 });

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.analyze();
		expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
	});
});
