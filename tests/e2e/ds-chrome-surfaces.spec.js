// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, resolveE2eCreds } = require('./helpers/auth.js');

/**
 * ds_chrome gauntlet: role surfaces (anon/denied/user/admin), dialog shapes
 * (open/confirm/cancel + focus management), form validation, empty/error
 * states — plus craft screenshots when AC_CRAFT_DIR is set.
 *
 * Probe role tests need AC_DS_PROBE_USER + AC_DS_PROBE_PASS (non-admin user).
 */

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const CRAFT = process.env.AC_CRAFT_DIR || '';
const PROBE_USER = process.env.AC_DS_PROBE_USER || '';
const PROBE_PASS = process.env.AC_DS_PROBE_PASS || '';

const ROUTES = [
	'/apps/audiocheck/',
	'/apps/audiocheck/music',
	'/apps/audiocheck/audiobooks',
	'/apps/audiocheck/playlists',
	'/apps/audiocheck/playlists/favorites',
	'/apps/audiocheck/browse',
	'/apps/audiocheck/now-playing',
	'/apps/audiocheck/library',
	'/apps/audiocheck/settings',
	'/apps/audiocheck/get-the-app',
	'/apps/audiocheck/app-settings/access',
	'/apps/audiocheck/app-settings/admins',
	'/apps/audiocheck/app-settings/defaults',
	'/apps/audiocheck/app-settings/support',
];

function hasAdminCreds() {
	return !!(process.env.E2E_USER && (process.env.E2E_PASSWORD || process.env.E2E_PASS))
		|| !!process.env.NC_ADMIN_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'));
}

async function shot(page, name) {
	if (!CRAFT) return;
	fs.mkdirSync(CRAFT, { recursive: true });
	await page.screenshot({ path: path.join(CRAFT, name + '.png'), fullPage: false });
}

async function waitForShell(page) {
	await page.waitForSelector('#ac-main-content, #ac-denied-main, .ac-denied', { timeout: 30_000 });
}

const EMPTY_STATE = { cookies: [], origins: [] };

/** Probe-role tests must run in a session-free context (shared storageState
 * may carry an admin session; login() early-returns when already authed). */
async function newProbePage(browser) {
	const ctx = await browser.newContext({ storageState: EMPTY_STATE });
	const page = await ctx.newPage();
	await login(page, { username: PROBE_USER, password: PROBE_PASS });
	return { ctx, page };
}

test.describe('ds_chrome role surfaces', () => {
	test('anon is redirected to login', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await context.newPage();
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await expect(page).toHaveURL(/\/login/);
		await expect(page.locator('input#user, input[name="user"]').first()).toBeVisible();
		await context.close();
	});

	test('denied surface when access restriction is enabled', async ({ page, browser }) => {
		test.skip(!hasAdminCreds(), 'needs admin creds');
		test.skip(!PROBE_USER || !PROBE_PASS, 'needs AC_DS_PROBE_*');
		await login(page, resolveE2eCreds('ADMIN'));
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const setRestriction = (enabled) => page.evaluate(async (on) => {
			const r = await window.AudioCheckApi.get('/apps/audiocheck/api/admin/policy');
			const p = r.policy || {};
			await window.AudioCheckApi.post('/apps/audiocheck/api/admin/policy', {
				section: 'access',
				policyVersion: p.policyVersion,
				accessRestrictionEnabled: on,
				allowedUserIds: on ? ['admin'] : (p.allowedUserIds || []),
				allowedGroupIds: p.allowedGroupIds || [],
			});
		}, enabled);
		// Enable restriction through the app's own API layer (real CSRF path).
		await setRestriction(true);
		try {
			const { ctx, page: denied } = await newProbePage(browser);
			await denied.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
			await expect(denied.locator('#ac-denied-main')).toBeVisible({ timeout: 30_000 });
			await expect(denied.locator('#ac-denied-main')).toHaveAttribute('role', 'alert');
			await expect(denied.locator('#ac-denied-title')).toBeVisible();
			await expect(denied.locator('#ac-denied-main a.ac-btn--primary')).toBeVisible();
			await expect(denied.locator('#app-navigation')).toHaveCount(0);
			await shot(denied, 'ac-role-denied');
			const results = await new AxeBuilder({ page: denied })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.include('#app-content')
				.analyze();
			expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
			await ctx.close();
		} finally {
			await setRestriction(false);
		}
	});

	test('user role: no admin nav, app-settings routes denied', async ({ browser }) => {
		test.skip(!PROBE_USER || !PROBE_PASS, 'needs AC_DS_PROBE_*');
		const { ctx, page } = await newProbePage(browser);
		try {
			await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			await expect(page.locator('#ac-main-content')).toBeVisible();
			await expect(page.locator('#app-navigation')).toBeVisible();
			// Non-admin must not see the App settings nav item.
			await expect(page.locator('#app-navigation [data-ac-nav-id="app-settings"]')).toHaveCount(0);
			await shot(page, 'ac-role-user-home');
			// Direct app-settings URL must not leak the admin form: the controller
			// redirects non-admins back to the app home (deny + recovery path).
			await page.goto(`${BASE}/apps/audiocheck/app-settings/access`, { waitUntil: 'domcontentloaded' });
			await expect(page).toHaveURL(/\/apps\/audiocheck\/?$/, { timeout: 30_000 });
			await waitForShell(page);
			await expect(page.locator('form[data-ac-policy-form]')).toHaveCount(0);
			await expect(page.locator('#ac-main-content')).toBeVisible();
			await shot(page, 'ac-role-user-appsettings-redirect');
		} finally {
			await ctx.close();
		}
	});

	test('admin role: all routes render main content', async ({ page }) => {
		test.skip(!hasAdminCreds(), 'needs admin creds');
		await login(page, resolveE2eCreds('ADMIN'));
		for (const route of ROUTES) {
			await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			await expect(page.locator('#ac-main-content'), route).toBeVisible();
			await expect(page.locator('.ac-page-header'), route).toBeVisible();
		}
		await expect(page.locator('#app-navigation [data-ac-nav-id="app-settings"]')).toHaveCount(1);
		await page.goto(`${BASE}/apps/audiocheck/app-settings/access`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		await expect(page.locator('form[data-ac-policy-form]')).toBeVisible();
		await shot(page, 'ac-role-admin-appsettings-access');
	});
});

test.describe('ds_chrome dialogs + validation', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAdminCreds(), 'needs admin creds');
		await login(page, resolveE2eCreds('ADMIN'));
	});

	test('create playlist modal: focus trap, esc, cancel, empty-name validation, create', async ({ page }) => {
		const name = 'Atlas DS Probe ' + Date.now().toString(36);
		await page.goto(`${BASE}/apps/audiocheck/playlists`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const trigger = page.locator('button', { hasText: /New playlist|Neue Playlist/ }).first();
		await expect(trigger).toBeVisible();
		await trigger.focus();
		await trigger.click();

		const dialog = page.locator('dialog.ac-native-dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('aria-labelledby', /ac-modal-title-/);
		await shot(page, 'ac-dialog-create-playlist-open');
		// Initial focus inside dialog (input preferred).
		const focusedTag = await page.evaluate(() => document.activeElement && document.activeElement.id);
		expect(focusedTag).toBe('ac-new-playlist-name');
		// Focus trap: Shift+Tab on first focusable wraps to last.
		await page.keyboard.press('Shift+Tab');
		const wrapped = await page.evaluate(() => {
			const d = document.querySelector('dialog.ac-native-dialog');
			return d && d.contains(document.activeElement);
		});
		expect(wrapped).toBeTruthy();
		// Escape closes and restores focus to the trigger.
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		const backOnTrigger = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
		expect(backOnTrigger).toMatch(/New playlist|Neue Playlist/);

		// Re-open → Cancel → no POST.
		let posts = 0;
		page.on('request', (req) => {
			if (req.method() === 'POST' && req.url().includes('/api/playlists')) posts += 1;
		});
		await trigger.click();
		await expect(dialog).toBeVisible();
		await dialog.locator('.ac-modal__actions button', { hasText: /Cancel|Abbrechen/ }).click();
		await expect(dialog).toHaveCount(0);
		expect(posts).toBe(0);

		// Re-open → empty name → warning toast, dialog stays, input refocused.
		await trigger.click();
		await expect(dialog).toBeVisible();
		await dialog.locator('.ac-modal__actions button', { hasText: /Create|Erstellen/ }).click();
		await expect(dialog).toBeVisible();
		await expect(page.locator('.ac-toast, .ac-toast-fallback').first()).toBeVisible();
		const stillFocused = await page.evaluate(() => document.activeElement && document.activeElement.id);
		expect(stillFocused).toBe('ac-new-playlist-name');
		expect(posts).toBe(0);

		// Valid name → POST fires → dialog closes → playlist listed.
		await dialog.locator('#ac-new-playlist-name').fill(name);
		await dialog.locator('.ac-modal__actions button', { hasText: /Create|Erstellen/ }).click();
		await expect(dialog).toHaveCount(0);
		expect(posts).toBe(1);
		await expect(page.locator('#ac-main-content')).toContainText(name, { timeout: 15_000 });
		await shot(page, 'ac-playlist-created');

		// Rename modal: open → save new name → PUT fires.
		const row = page.locator('.ac-playlist-group', { hasText: name }).first();
		// Groups auto-open only for a single unpinned playlist; with several
		// lists the created group renders collapsed — expand via summary first.
		if (!(await row.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
			await row.locator('summary').first().click();
		}
		await row.locator('button', { hasText: /Rename|Umbenennen/ }).first().click();
		await expect(dialog).toBeVisible();
		const renamed = name + ' R';
		await dialog.locator('#ac-rename-playlist').fill(renamed);
		let puts = 0;
		page.on('request', (req) => {
			if (req.method() === 'PUT' && req.url().includes('/api/playlists')) puts += 1;
		});
		await dialog.locator('.ac-modal__actions button', { hasText: /Save|Speichern/ }).click();
		await expect(dialog).toHaveCount(0);
		expect(puts).toBe(1);
		await expect(page.locator('#ac-main-content')).toContainText(renamed, { timeout: 15_000 });

		// Delete confirm: cancel shape (no DELETE), then confirm shape (DELETE).
		let deletes = 0;
		page.on('request', (req) => {
			if (req.method() === 'DELETE' && req.url().includes('/api/playlists')) deletes += 1;
		});
		const row2 = page.locator('.ac-playlist-group', { hasText: renamed }).first();
		if (!(await row2.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
			await row2.locator('summary').first().click();
		}
		await row2.locator('button', { hasText: /^Delete$|^Löschen$/ }).first().click();
		await expect(dialog).toBeVisible();
		await shot(page, 'ac-dialog-delete-confirm');
		await dialog.locator('.ac-modal__actions button', { hasText: /Cancel|Abbrechen/ }).click();
		await expect(dialog).toHaveCount(0);
		expect(deletes).toBe(0);
		await row2.locator('button', { hasText: /^Delete$|^Löschen$/ }).first().click();
		await expect(dialog).toBeVisible();
		await dialog.locator('.ac-modal__actions button', { hasText: /Delete playlist|Playlist löschen/ }).click();
		await expect(dialog).toHaveCount(0);
		expect(deletes).toBe(1);
		await expect(page.locator('#ac-main-content')).not.toContainText(renamed, { timeout: 15_000 });
	});

	test('access form validation: restricted+empty allowlists blocked client-side', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/app-settings/access`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const form = page.locator('form[data-ac-policy-form]');
		await expect(form).toBeVisible();
		let posts = 0;
		page.on('request', (req) => {
			if (req.method() === 'POST' && req.url().includes('/api/admin/policy')) posts += 1;
		});
		const restore = async () => page.evaluate(async () => {
			const r = await window.AudioCheckApi.get('/apps/audiocheck/api/admin/policy');
			const p = r.policy || {};
			if (!p.accessRestrictionEnabled) return;
			await window.AudioCheckApi.post('/apps/audiocheck/api/admin/policy', {
				section: 'access',
				policyVersion: p.policyVersion,
				accessRestrictionEnabled: false,
				allowedUserIds: p.allowedUserIds || [],
				allowedGroupIds: p.allowedGroupIds || [],
			});
		});
		try {
			// Restricted with no allowlist entries → client-side warning, no POST.
			await page.locator('#ac-access-restricted').check();
			// Deterministic: clear any pre-existing allowlist chips first.
			const removeBtns = page.locator('#ac-access-allowlists .ac-chip__remove');
			while ((await removeBtns.count()) > 0) {
				await removeBtns.first().click();
			}
			await form.locator('button[type="submit"], button.ac-btn--primary').first().click();
			await expect(page.locator('.ac-toast, .ac-toast-fallback').first()).toBeVisible();
			expect(posts).toBe(0);
			await shot(page, 'ac-form-access-validation-warning');
			// Back to open — radio control recovers without reload.
			await page.locator('#ac-access-open').check();
		} finally {
			await restore();
		}
	});
});

test.describe('ds_chrome states', () => {
	test('empty library states on media pages (probe user)', async ({ browser }) => {
		test.skip(!PROBE_USER || !PROBE_PASS, 'needs AC_DS_PROBE_*');
		const { ctx, page } = await newProbePage(browser);
		try {
			for (const route of ['/apps/audiocheck/music', '/apps/audiocheck/audiobooks']) {
				await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
				await waitForShell(page);
				const empty = page.locator('#ac-main-content .ac-empty-state, #ac-main-content .ac-empty');
				await expect(empty.first(), route).toBeVisible({ timeout: 30_000 });
			}
			await shot(page, 'ac-state-empty-music');
		} finally {
			await ctx.close();
		}
	});

	test('error state + retry on API failure', async ({ page }) => {
		test.skip(!hasAdminCreds(), 'needs admin creds');
		await login(page, resolveE2eCreds('ADMIN'));
		await page.route('**/apps/audiocheck/api/tracks*', (route) => route.abort());
		await page.goto(`${BASE}/apps/audiocheck/music`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const errorWell = page.locator('#ac-main-content .ac-empty-state');
		await expect(errorWell.first()).toBeVisible({ timeout: 30_000 });
		await expect(errorWell.first()).toContainText(/Could not load|konnte nicht geladen werden/);
		const retry = errorWell.locator('button', { hasText: /Try again|Erneut versuchen/ }).first();
		await expect(retry).toBeVisible();
		await shot(page, 'ac-state-error-music-retry');
		await page.unroute('**/apps/audiocheck/api/tracks*');
		await retry.click();
		// After retry the error well must be gone (either content or honest empty state).
		await expect(page.locator('#ac-main-content')).not.toContainText(/Could not load|konnte nicht geladen werden/, { timeout: 30_000 });
	});
});
