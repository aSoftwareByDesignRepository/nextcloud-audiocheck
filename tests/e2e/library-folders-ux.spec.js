// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

/**
 * Library folders UX gauntlet — simplified one-row cards, progressive options,
 * empty-state add shortcuts, WCAG 2.1 AA, and keyboard reachability.
 */

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openLibrary(page) {
	await page.goto(BASE + '/apps/audiocheck/library', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#app-content.ac-app, #content.app-audiocheck').first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByRole('heading', { name: /your folders|deine ordner/i }).first()).toBeVisible({ timeout: 30000 });
}

test.describe('Library folders UX simplification', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test.beforeEach(async ({ page }) => {
		if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
			await login(page, credsFromEnv('ADMIN'));
		}
	});

	test('library surface stays simple, keyboardable, and WCAG AA', async ({ page }) => {
		await openLibrary(page);

		const status = page.locator('.ac-library-bar__status').first();
		await expect(status).toBeVisible();
		await expect(status).toHaveAttribute('aria-live', 'polite');

		const scan = page.getByRole('button', { name: /scan now|jetzt scannen|scanning/i }).first();
		await expect(scan).toBeVisible();

		const cards = page.locator('.ac-library-card');
		const empty = page.locator('.ac-library-empty');
		const cardCount = await cards.count();
		const emptyVisible = await empty.isVisible().catch(() => false);

		if (emptyVisible || cardCount === 0) {
			await expect(page.getByRole('button', { name: /add music folder|musikordner hinzufügen/i }).first()).toBeVisible();
			await expect(page.getByRole('button', { name: /add audiobook folder|hörbuchordner hinzufügen/i }).first()).toBeVisible();
			await expect(page.getByRole('button', { name: /auto-detect|automatisch/i }).first()).toBeVisible();
			// No always-on content-type modal on the page itself
			await expect(page.getByRole('dialog')).toHaveCount(0);
		} else {
			const first = cards.first();
			await expect(first.locator('.ac-library-card__main')).toBeVisible();
			await expect(first.locator('.ac-library-card__name')).toBeVisible();
			await expect(first.locator('.ac-library-card__count')).toBeVisible();
			await expect(first.getByRole('button', { name: /remove|entfernen/i })).toBeVisible();

			// Advanced controls are collapsed by default (progressive disclosure)
			const options = first.locator('details.ac-library-card__options');
			await expect(options).toBeVisible();
			await expect(options).not.toHaveAttribute('open', '');
			await expect(first.locator('.ac-seg')).toBeHidden();

			await options.locator('summary').click();
			await expect(options).toHaveAttribute('open', '');
			await expect(first.locator('.ac-seg[role="radiogroup"]')).toBeVisible();
			await expect(first.getByRole('checkbox', { name: /include nested folders|unterordner einbeziehen/i })).toBeVisible();

			// Keyboard: focus summary and toggle with Enter
			await options.locator('summary').focus();
			await page.keyboard.press('Enter');
			await expect(options).not.toHaveAttribute('open', '');
		}

		// How it works stays collapsible and contains the nested-layout tip
		const how = page.locator('#ac-library-how-heading').first();
		await expect(how).toBeVisible();
		const howDetails = page.locator('.ac-section--collapsible').filter({ has: how }).locator('details').first();
		if (!(await howDetails.getAttribute('open'))) {
			await howDetails.locator('summary').click();
		}
		await expect(page.locator('.ac-library-layout-hint')).toContainText(/Author \/ Book|Autor \/ Buch/i);

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.include('#app-content.ac-app')
			.exclude('.ac-toast')
			.exclude('.ac-toast-fallback')
			.analyze();
		expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
	});

	test('library stays usable at mobile width with large touch targets', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await openLibrary(page);

		const scan = page.getByRole('button', { name: /scan now|jetzt scannen|scanning/i }).first();
		const scanBox = await scan.boundingBox();
		expect(scanBox, 'Scan now must be visible').toBeTruthy();
		expect(scanBox.height).toBeGreaterThanOrEqual(40);

		const cards = page.locator('.ac-library-card');
		if (await cards.count()) {
			const remove = cards.first().getByRole('button', { name: /remove|entfernen/i });
			const box = await remove.boundingBox();
			expect(box).toBeTruthy();
			expect(box.height).toBeGreaterThanOrEqual(40);
		} else {
			const music = page.getByRole('button', { name: /add music folder|musikordner hinzufügen/i }).first();
			const box = await music.boundingBox();
			expect(box).toBeTruthy();
			expect(box.height).toBeGreaterThanOrEqual(40);
		}

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.include('#app-content.ac-app')
			.exclude('.ac-toast')
			.exclude('.ac-toast-fallback')
			.analyze();
		expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
	});

	test('settings still explains Author/Book nesting for scan defaults', async ({ page }) => {
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
