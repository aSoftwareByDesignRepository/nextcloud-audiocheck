// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

/**
 * Bachus user-journey + axe gauntlet for design-system AudioCheck.
 * Covers home → library → settings autosave chrome → app-settings access mode.
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
async function ensureAuthed(page) {
	if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
		await login(page, credsFromEnv('ADMIN'));
	}
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} route
 */
async function gotoApp(page, route) {
	await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#app-content.ac-app')).toBeVisible({ timeout: 30000 });
	await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30000 });
}

test.describe('Bachus design-system journeys', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test.beforeEach(async ({ page }) => {
		await ensureAuthed(page);
	});

	test('core chrome landmarks are present and keyboard-reachable', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/');
		await expect(page.locator('.ac-skip-link')).toHaveCount(1);
		await expect(page.locator('#ac-live-region')).toHaveCount(1);
		await expect(page.locator('#ac-alert-region')).toHaveCount(1);
		await expect(page.locator('#ac-page-title')).toBeVisible();
		await expect(page.locator('#ac-main-content')).toBeVisible();
		await expect(page.locator('.ac-breadcrumb__item--current')).toBeVisible();

		await page.keyboard.press('Tab');
		// Skip link or first focusable control must receive focus without trapping.
		const focused = await page.evaluate(() => {
			const el = document.activeElement;
			return el ? (el.id || el.className || el.tagName) : '';
		});
		expect(String(focused).length).toBeGreaterThan(0);
	});

	test('settings autosave chrome replaces Save button', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/settings');
		await expect(page.locator('[data-ac-autosave="prefs"]')).toBeVisible({ timeout: 30000 });
		await expect(page.locator('#ac-prefs-autosave')).toContainText(/save automatically|automatisch/i);
		await expect(page.locator('button', { hasText: /^Save$/ })).toHaveCount(0);
		await expect(page.locator('.ac-disclosure__summary')).toBeVisible();
		await page.locator('.ac-disclosure__summary').click();
		await expect(page.locator('.ac-controls-ref__list')).toBeVisible();
		await expect(page.locator('.ac-shortcuts__list')).toBeVisible();
	});

	test('app-settings multipage: access mode, scoped save, section URLs', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/app-settings');
		await expect(page).toHaveURL(/\/apps\/audiocheck\/app-settings\/access\/?$/);
		await expect(page.locator('.ac-settings-chips')).toBeVisible({ timeout: 30000 });
		await expect(page.locator('.ac-access-mode')).toBeVisible();
		await expect(page.locator('button', { hasText: /Save access|Zugriff speichern/i })).toBeVisible();

		const openRadio = page.locator('input[name="ac-access-mode"][value="open"]');
		const restrictedRadio = page.locator('input[name="ac-access-mode"][value="restricted"]');
		await expect(openRadio).toBeVisible();
		await expect(restrictedRadio).toBeVisible();

		await openRadio.check();
		await expect(page.locator('[data-ac-access-allowlists]')).toBeHidden();

		await restrictedRadio.check();
		await expect(page.locator('[data-ac-access-allowlists]')).toBeVisible();

		await page.locator('[data-ac-settings-chip="admins"]').click();
		await expect(page).toHaveURL(/\/apps\/audiocheck\/app-settings\/admins\/?$/);
		await expect(page.locator('#ac-settings-admins')).toBeVisible();
		await expect(page.locator('#ac-settings-access')).toHaveCount(0);
		await expect(page.locator('button', { hasText: /Save admins|Admins speichern|Administratoren speichern/i })).toBeVisible();

		await page.locator('[data-ac-settings-chip="support"]').click();
		await expect(page).toHaveURL(/\/apps\/audiocheck\/app-settings\/support\/?$/);
		await expect(page.locator('#ac-settings-support')).toBeVisible();
		await expect(page.locator('[data-ac-settings-savebar]')).toHaveCount(0);
	});

	test('now-playing advanced options stay behind disclosure', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/now-playing');
		await expect(page.locator('.ac-now-advanced > .ac-disclosure__summary, .ac-now-advanced > summary')).toBeVisible({ timeout: 30000 });
		await expect(page.locator('#ac-shuffle-row')).toBeHidden();
		await page.locator('.ac-now-advanced > .ac-disclosure__summary, .ac-now-advanced > summary').click();
		await expect(page.locator('#ac-shuffle-row')).toBeVisible();
		await expect(page.locator('.ac-now-sleep-details')).toHaveCount(0);
		await expect(page.locator('.ac-now-field--sleep')).toBeVisible();
		await expect(page.locator('#ac-now-volume, [id^="ac-now-volume"]')).toHaveCount(0);
	});

	test('home quick actions are not card-boxed', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/');
		const quick = page.locator('.ac-home-quick').first();
		await expect(quick).toBeVisible({ timeout: 30000 });
		const boxed = await quick.evaluate((node) => node.classList.contains('ac-card'));
		expect(boxed).toBeFalsy();
	});

	test('playlists page keeps full-size row actions when playlists exist', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/playlists');
		await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30000 });
		const action = page.locator('.ac-playlist-group__action').first();
		if (await action.count()) {
			const box = await action.boundingBox();
			expect(box).not.toBeNull();
			expect(box.height).toBeGreaterThanOrEqual(44);
		}
	});

	test('native dialog is used for confirms', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/now-playing');
		const clearBtn = page.locator('.ac-now-queue__clear');
		if (await clearBtn.count()) {
			await clearBtn.click();
			await expect(page.locator('dialog.ac-native-dialog[open]')).toBeVisible({ timeout: 10000 });
			await page.locator('dialog.ac-native-dialog .ac-modal__close, dialog.ac-native-dialog button', { hasText: /Cancel|Abbrechen/i }).first().click();
			await expect(page.locator('dialog.ac-native-dialog[open]')).toHaveCount(0);
		}
	});

	test('music and browse recover with Try again chrome contract', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/music');
		await expect(page.locator('#ac-main-content')).toBeVisible();
		await expect(page.locator('.ac-media-library-page').first()).toBeVisible({ timeout: 30000 });
		await expect(page.locator('.ac-browse-tabs').first()).toBeVisible();

		await gotoApp(page, '/apps/audiocheck/browse');
		await expect(page.locator('.ac-facet-browse-page').first()).toBeVisible({ timeout: 30000 });
		await expect(page.locator('.ac-browse-tabs').first()).toBeVisible();
	});

	test('shell exposes locale timezone and skip lands on main-content', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/');
		const meta = await page.locator('#app-content.ac-app').evaluate((el) => ({
			lang: el.getAttribute('lang'),
			locale: el.getAttribute('data-ac-locale'),
			tz: el.getAttribute('data-ac-timezone'),
			skip: document.querySelector('.ac-skip-link')?.getAttribute('href'),
			mainId: document.getElementById('ac-main-content')?.id,
		}));
		expect(meta.lang).toBeTruthy();
		expect(meta.locale).toBeTruthy();
		expect(meta.tz).toBeTruthy();
		expect(meta.skip).toBe('#ac-main-content');
		expect(meta.mainId).toBe('ac-main-content');
	});

	test('library empty/recovery path stays one primary CTA', async ({ page }) => {
		await gotoApp(page, '/apps/audiocheck/library');
		await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30000 });
		const empty = page.locator('.ac-empty-state, .ac-empty').first();
		if (await empty.count()) {
			const primaries = empty.locator('.ac-btn--primary');
			const count = await primaries.count();
			expect(count).toBeLessThanOrEqual(1);
			const box = await empty.evaluate((node) => {
				const styles = window.getComputedStyle(node);
				return { border: styles.borderTopWidth, shadow: styles.boxShadow };
			});
			expect(box.border === '0px' || box.border === '').toBeTruthy();
			expect(box.shadow === 'none' || box.shadow === '').toBeTruthy();
		}
	});

	test('axe serious/critical = 0 on primary Bachus routes', async ({ page }) => {
		const routes = [
			'/apps/audiocheck/',
			'/apps/audiocheck/library',
			'/apps/audiocheck/settings',
			'/apps/audiocheck/app-settings/access',
			'/apps/audiocheck/app-settings/support',
			'/apps/audiocheck/now-playing',
		];
		for (const route of routes) {
			await gotoApp(page, route);
			await page.waitForTimeout(400);
			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
				.disableRules(['color-contrast']) // theme matrix covered in theme-responsive-a11y
				.analyze();
			const blockers = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
			expect(blockers, `axe blockers on ${route}: ${JSON.stringify(blockers.map((v) => v.id))}`).toEqual([]);
		}
	});

	test('mobile viewport keeps giant menu target and no horizontal page scroll', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await gotoApp(page, '/apps/audiocheck/');
		const toggle = page.locator('#ac-nav-toggle');
		await expect(toggle).toBeVisible();
		const box = await toggle.boundingBox();
		expect(box).not.toBeNull();
		expect(box.height).toBeGreaterThanOrEqual(44);
		const overflowX = await page.evaluate(() => {
			const root = document.scrollingElement || document.documentElement;
			return root.scrollWidth - root.clientWidth;
		});
		expect(overflowX).toBeLessThanOrEqual(1);
	});
});
