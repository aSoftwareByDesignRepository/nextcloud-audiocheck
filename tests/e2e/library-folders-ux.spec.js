// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv, resolveE2eCreds } = require('./helpers/auth.js');

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
	// DE formal is "Ihre Ordner" (not "Deine"); prefer stable id over locale-fragile name.
	await expect(page.locator('#ac-library-folders-heading').first()).toBeVisible({ timeout: 30000 });
}

test.describe('Library folders UX simplification', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test.beforeEach(async ({ page }) => {
		if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
			await login(page, resolveE2eCreds('ADMIN'));
		}
	});

	test('library surface stays simple, keyboardable, and WCAG AA', async ({ page }) => {
		await openLibrary(page);

		const status = page.locator('.ac-library-bar__status').first();
		await expect(status).toBeVisible();
		await expect(status).toHaveAttribute('aria-live', 'polite');

		const scan = page.locator('.ac-library-bar__scan').first();
		await expect(scan).toBeVisible();

		const cards = page.locator('.ac-library-card');
		const empty = page.locator('.ac-library-empty');
		const cardCount = await cards.count();
		const emptyVisible = await empty.isVisible().catch(() => false);

		if (emptyVisible || cardCount === 0) {
			// Empty-state CTAs render in fixed order: music, audiobook, auto-detect
			// (js/views/library.js renderEmptyFolders) — assert all three by class.
			const emptyBtns = page.locator('.ac-library-empty__actions .ac-library-empty__btn');
			await expect(emptyBtns).toHaveCount(3);
			await expect(emptyBtns.nth(0)).toBeVisible();
			await expect(emptyBtns.nth(1)).toBeVisible();
			await expect(emptyBtns.nth(2)).toHaveClass(/ac-btn--primary/);
			// No always-on content-type modal on the page itself
			await expect(page.getByRole('dialog')).toHaveCount(0);
		} else {
			const first = cards.first();
			await expect(first.locator('.ac-library-card__main')).toBeVisible();
			await expect(first.locator('.ac-library-card__name')).toBeVisible();
			await expect(first.locator('.ac-library-card__count')).toBeVisible();
			await expect(first.locator('.ac-library-card__remove')).toBeVisible();

			// Advanced controls are collapsed by default (progressive disclosure)
			const options = first.locator('details.ac-library-card__options');
			await expect(options).toBeVisible();
			await expect(options).not.toHaveAttribute('open', '');
			await expect(first.locator('.ac-seg')).toBeHidden();

			await options.locator('summary').click();
			await expect(options).toHaveAttribute('open', '');
			await expect(first.locator('.ac-seg[role="radiogroup"]')).toBeVisible();
			// Two opt-in checkboxes: include-subfolders scope + group-by-folder.
			await expect(first.locator('.ac-library-card__check[type="checkbox"]')).toHaveCount(2);
			const groupToggle = first.locator('input[id^="ac-library-group-"]');
			await expect(groupToggle).toBeVisible();
			// The hint text must be wired via aria-describedby to a real element.
			const hintId = await groupToggle.getAttribute('aria-describedby');
			expect(hintId, 'group toggle needs aria-describedby').toBeTruthy();
			await expect(first.locator(`[id="${hintId}"]`)).toHaveText(/./);
			// Label association: clicking the label must toggle the input.
			const groupLabel = first.locator(`label[for="${await groupToggle.getAttribute('id')}"]`);
			await expect(groupLabel).toBeVisible();

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
		// Locale-safe: the nesting-layout hint keeps a "X / Y / Z" slash pattern in
		// every shipped l10n (e.g. pt_BR "Autor / Livro / capítulo").
		await expect(page.locator('.ac-library-layout-hint')).toContainText(/\w+ ?\/ ?\w+/);

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

		const scan = page.locator('.ac-library-bar__scan').first();
		const scanBox = await scan.boundingBox();
		expect(scanBox, 'Scan now must be visible').toBeTruthy();
		expect(scanBox.height).toBeGreaterThanOrEqual(40);

		const cards = page.locator('.ac-library-card');
		if (await cards.count()) {
			const remove = cards.first().locator('.ac-library-card__remove');
			const box = await remove.boundingBox();
			expect(box).toBeTruthy();
			expect(box.height).toBeGreaterThanOrEqual(40);
		} else {
			const music = page.locator('.ac-library-empty__actions .ac-library-empty__btn').first();
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

	test('group-by-folder toggle persists through the API and restores', async ({ page }) => {
		test.skip(!hasAnyCreds(), 'needs creds');
		await openLibrary(page);

		const cards = page.locator('.ac-library-card');
		test.skip((await cards.count()) === 0, 'no library cards on this fixture');

		// Pick the lightest library so the triggered rescan stays cheap.
		const listRes = await page.evaluate(async () => {
			const token = document.querySelector('input[name="requesttoken"]')?.getAttribute('value') || '';
			const res = await fetch('/index.php/apps/audiocheck/api/libraries', {
				credentials: 'same-origin',
				headers: { requesttoken: token, 'OCS-APIRequest': 'true', Accept: 'application/json' },
			});
			return res.json();
		});
		const libs = (listRes.libraries || []).filter((l) => l && l.id);
		test.skip(libs.length === 0, 'no libraries for this user');
		const target = libs.reduce((a, b) => (a.trackCount <= b.trackCount ? a : b));

		const input = page.locator(`#ac-library-group-${target.id}`);
		const card = page.locator('.ac-library-card', { has: input });
		const options = card.locator('details.ac-library-card__options');
		if (!(await options.getAttribute('open'))) {
			await options.locator('summary').click();
		}
		await expect(input).toBeVisible();
		const before = target.groupByFolder === true;
		await expect(input).toBeChecked({ checked: before });

		const readBack = async () => {
			const r = await page.evaluate(async () => {
				const token = document.querySelector('input[name="requesttoken"]')?.getAttribute('value') || '';
				const res = await fetch('/index.php/apps/audiocheck/api/libraries', {
					credentials: 'same-origin',
					headers: { requesttoken: token, 'OCS-APIRequest': 'true', Accept: 'application/json' },
				});
				return res.json();
			});
			return (r.libraries || []).find((l) => l.id === target.id);
		};

		try {
			// Flip → PUT persists → API re-read shows the new flag.
			const putResp = page.waitForResponse(
				(r) => r.url().includes(`/api/libraries/${target.id}`) && r.request().method() === 'PUT',
			);
			await input.click();
			expect((await putResp).status()).toBe(200);
			await expect.poll(async () => (await readBack())?.groupByFolder).toBe(!before);
			// The card re-rendered on refresh (options collapsed) — reopen and
			// confirm the control reflects the persisted server flag.
			const freshCard = page.locator('.ac-library-card', { has: page.locator(`#ac-library-group-${target.id}`) });
			await freshCard.locator('details.ac-library-card__options summary').click();
			const freshInput = page.locator(`#ac-library-group-${target.id}`);
			await expect(freshInput).toBeChecked({ checked: !before });
		} finally {
			// Restore via the API (the card re-renders closed on refresh — a UI
			// re-click is teardown churn, not additional contract).
			const now = (await readBack())?.groupByFolder === true;
			if (now !== before) {
				const res = await page.evaluate(async ({ id, val }) => {
					const token = document.querySelector('input[name="requesttoken"]')?.getAttribute('value') || '';
					const r = await fetch(`/index.php/apps/audiocheck/api/libraries/${id}`, {
						method: 'PUT',
						credentials: 'same-origin',
						headers: {
							requesttoken: token,
							'OCS-APIRequest': 'true',
							Accept: 'application/json',
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({ groupByFolder: val }),
					});
					return r.status;
				}, { id: target.id, val: before });
				expect(res).toBe(200);
			}
			await expect.poll(async () => (await readBack())?.groupByFolder).toBe(before);
		}
	});

	test('settings still explains Author/Book nesting for scan defaults', async ({ page }) => {
		await page.goto(BASE + '/apps/audiocheck/settings', { waitUntil: 'domcontentloaded' });
		// Structural anchor: the scan-subfolders checkbox row carries the
		// nested-layout hint; its "A/B/C" example keeps slashes in every l10n.
		const subRow = page.locator('.ac-form-row--checkbox', { has: page.locator('#ac-scan-subfolders') });
		await expect(subRow).toBeVisible({ timeout: 30000 });
		await expect(subRow.locator('.ac-field__hint')).toContainText(/\w+\/\w+/);

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.include('#app-content.ac-app')
			.exclude('.ac-toast')
			.exclude('.ac-toast-fallback')
			.analyze();
		expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
	});
});
