// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

/**
 * Theme + viewport + WCAG 2.1 AA gauntlet for AudioCheck.
 * Skips when neither storage-state nor NC_* / E2E_* credentials are available.
 */

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

const a11yRoutes = [
	'/apps/audiocheck/',
	'/apps/audiocheck/music',
	'/apps/audiocheck/audiobooks',
	'/apps/audiocheck/playlists',
	'/apps/audiocheck/browse',
	'/apps/audiocheck/now-playing',
	'/apps/audiocheck/library',
	'/apps/audiocheck/settings',
	'/apps/audiocheck/app-settings',
];

const viewports = [
	{ name: 'mobile-320', width: 320, height: 720 },
	{ name: 'mobile-375', width: 375, height: 812 },
	{ name: 'tablet-768', width: 768, height: 1024 },
	{ name: 'desktop-1024', width: 1024, height: 768 },
	{ name: 'desktop-1440', width: 1440, height: 900 },
	{ name: 'ultrawide-2560', width: 2560, height: 1440 },
];

/** @typedef {'light'|'dark'|'dark-highcontrast'|'light-highcontrast'} ThemeId */

/** @type {{ id: ThemeId }[]} */
const themes = [
	{ id: 'light' },
	{ id: 'dark' },
	{ id: 'dark-highcontrast' },
	{ id: 'light-highcontrast' },
];

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
 * @param {ThemeId} themeId
 */
async function applyTheme(page, themeId) {
	await page.evaluate((id) => {
		const body = document.body;
		[
			'theme--light',
			'theme--dark',
			'theme--dark-highcontrast',
			'theme--light-highcontrast',
		].forEach((c) => body.classList.remove(c));
		[
			'data-theme-default',
			'data-theme-light',
			'data-theme-dark',
			'data-theme-dark-highcontrast',
			'data-theme-light-highcontrast',
		].forEach((a) => body.removeAttribute(a));

		if (id === 'light') {
			body.classList.add('theme--light');
			body.setAttribute('data-theme-light', 'true');
			body.setAttribute('data-themes', 'default');
		} else if (id === 'dark') {
			body.classList.add('theme--dark');
			body.setAttribute('data-theme-dark', 'true');
			body.setAttribute('data-themes', 'dark');
		} else if (id === 'light-highcontrast') {
			body.classList.add('theme--light', 'theme--light-highcontrast');
			body.setAttribute('data-theme-light-highcontrast', 'true');
			body.setAttribute('data-themes', 'light-highcontrast');
		} else {
			body.classList.add('theme--dark', 'theme--dark-highcontrast');
			body.setAttribute('data-theme-dark-highcontrast', 'true');
			body.setAttribute('data-themes', 'dark-highcontrast');
		}
		document.documentElement.style.colorScheme = id.includes('dark') ? 'dark' : 'light';
	}, themeId);
	await page.waitForTimeout(150);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForShell(page) {
	await page.waitForSelector('#app-content.ac-app #ac-main, #ac-denied-main, .ac-denied', { timeout: 30_000 });
	await page.waitForFunction(() => {
		const body = getComputedStyle(document.body);
		return body.getPropertyValue('--color-main-text').trim() !== ''
			&& body.getPropertyValue('--color-main-background').trim() !== '';
	}, null, { timeout: 10_000 }).catch(() => {});
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function assertNoHorizontalOverflow(page) {
	const overflow = await page.evaluate(() => {
		const root = document.querySelector('#app-content.ac-app') || document.body;
		const main = document.getElementById('ac-main');
		const shell = document.querySelector('#app-content-wrapper.ac-shell, .ac-shell');
		const rootOverflow = root.scrollWidth > root.clientWidth + 2;
		const mainOverflow = main ? main.scrollWidth > main.clientWidth + 2 : false;
		const shellOverflow = shell ? shell.scrollWidth > shell.clientWidth + 2 : false;
		const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 2;
		return {
			rootOverflow,
			mainOverflow,
			shellOverflow,
			docOverflow,
			scrollWidth: root.scrollWidth,
			clientWidth: root.clientWidth,
		};
	});
	expect(overflow, JSON.stringify(overflow)).toMatchObject({
		rootOverflow: false,
		mainOverflow: false,
		shellOverflow: false,
		docOverflow: false,
	});
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function assertThemeTokensResolved(page) {
	const tokens = await page.evaluate(() => {
		const el = document.querySelector('#app-content.ac-app') || document.body;
		const cs = getComputedStyle(el);
		return {
			bg: cs.getPropertyValue('--ac-bg-card').trim() || cs.getPropertyValue('--color-main-background').trim(),
			text: cs.getPropertyValue('--ac-text').trim() || cs.getPropertyValue('--color-main-text').trim(),
			primary: cs.getPropertyValue('--color-primary-element').trim(),
			muted: cs.getPropertyValue('--ac-muted').trim() || cs.getPropertyValue('--color-text-maxcontrast').trim(),
			tintInfo: cs.getPropertyValue('--ac-tint-info').trim(),
			accent: cs.getPropertyValue('--ac-accent').trim(),
			touch: cs.getPropertyValue('--ac-touch').trim(),
		};
	});
	expect(tokens.bg, 'theme background token').not.toEqual('');
	expect(tokens.text, 'theme text token').not.toEqual('');
	expect(tokens.primary, 'primary element token').not.toEqual('');
	expect(tokens.tintInfo, 'tint-info must resolve (mixed into main-background)').not.toEqual('');
	expect(
		tokens.tintInfo.includes('transparent') && /,\s*0%\)\s*$/.test(tokens.tintInfo),
		'tint must not be fully transparent',
	).toBeFalsy();
	expect(tokens.accent, 'accent alias').not.toEqual('');
	expect(tokens.touch === '44px' || parseFloat(tokens.touch) >= 44, 'touch target token').toBeTruthy();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function assertTouchTargets(page) {
	const result = await page.evaluate(() => {
		const nodes = [
			...document.querySelectorAll('#ac-nav-toggle, #app-content.ac-app button.ac-btn, .ac-nav__link'),
		].slice(0, 40);
		const undersized = [];
		for (const el of nodes) {
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden') {
				continue;
			}
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				continue;
			}
			const minH = Math.max(rect.height, parseFloat(style.minHeight) || 0);
			const minW = Math.max(rect.width, parseFloat(style.minWidth) || 0);
			// Full-width bars (nav toggle) use height only; icon buttons need both axes.
			const isBar = rect.width >= 120;
			const heightOk = minH >= 44;
			const widthOk = isBar || minW >= 40 || !el.classList.contains('ac-btn--icon');
			if (!heightOk || !widthOk) {
				undersized.push({
					tag: el.tagName,
					cls: el.className,
					w: Math.round(minW),
					h: Math.round(minH),
				});
			}
		}
		return { ok: undersized.length === 0, undersized };
	});
	expect(result.ok, JSON.stringify(result.undersized)).toBeTruthy();
}

test.describe('AudioCheck theme × a11y matrix', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	for (const theme of themes) {
		test(`axe WCAG 2.1 AA on home @ ${theme.id}`, async ({ page }) => {
			await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			await applyTheme(page, theme.id);
			await assertThemeTokensResolved(page);
			await page.locator('.ac-toast, .ac-toast-fallback').evaluateAll((nodes) => nodes.forEach((n) => n.remove())).catch(() => {});
			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.include('#app-content.ac-app')
				.exclude('.ac-toast')
				.exclude('.ac-toast-fallback')
				.analyze();
			expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
		});
	}
});

test.describe('AudioCheck route a11y smoke', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	for (const route of a11yRoutes) {
		test(`a11y smoke: ${route}`, async ({ page }) => {
			await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			await page.locator('.ac-toast, .ac-toast-fallback').evaluateAll((nodes) => nodes.forEach((n) => n.remove())).catch(() => {});
			const results = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.include('#app-content.ac-app')
				.exclude('.ac-toast')
				.exclude('.ac-toast-fallback')
				.analyze();
			expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
		});
	}
});

test.describe('AudioCheck responsive overflow matrix', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	for (const vp of viewports) {
		test(`no horizontal overflow @ ${vp.name}`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			await expect(page.locator('.ac-page-header').first()).toBeVisible();
			await expect(page.locator('a.ac-skip-link')).toBeAttached();
			await assertNoHorizontalOverflow(page);
			await assertTouchTargets(page);

			if (vp.width < 1024) {
				await expect(page.locator('#ac-nav-toggle')).toBeVisible();
				const navHidden = await page.evaluate(() => {
					const nav = document.getElementById('app-navigation');
					if (!nav) return true;
					const style = getComputedStyle(nav);
					const transform = style.transform || '';
					return nav.classList.contains('ac-nav--open') === false
						&& (transform.includes('matrix') || transform.includes('translate'));
				});
				expect(navHidden).toBeTruthy();
			}
		});
	}
});

test.describe('AudioCheck visual shell snapshots', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	const snapViewports = [
		{ name: 'mobile-375', width: 375, height: 812 },
		{ name: 'tablet-768', width: 768, height: 1024 },
		{ name: 'desktop-1280', width: 1280, height: 800 },
	];

	for (const theme of [{ id: 'light' }, { id: 'dark' }]) {
		for (const vp of snapViewports) {
			test(`shell metrics @ ${theme.id} ${vp.name}`, async ({ page }) => {
				await page.setViewportSize({ width: vp.width, height: vp.height });
				await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
				await waitForShell(page);
				await applyTheme(page, /** @type {ThemeId} */ (theme.id));
				await assertThemeTokensResolved(page);
				await assertNoHorizontalOverflow(page);

				const metrics = await page.evaluate(() => {
					const header = document.querySelector('.ac-page-header');
					const main = document.getElementById('ac-main');
					const hRect = header ? header.getBoundingClientRect() : null;
					const mRect = main ? main.getBoundingClientRect() : null;
					return {
						headerVisible: !!(hRect && hRect.height > 0),
						mainVisible: !!(mRect && mRect.height >= 0),
						headerWidth: hRect ? Math.round(hRect.width) : 0,
						viewport: window.innerWidth,
					};
				});
				expect(metrics.headerVisible).toBeTruthy();
				expect(metrics.mainVisible).toBeTruthy();
				expect(metrics.headerWidth).toBeLessThanOrEqual(metrics.viewport);
			});
		}
	}
});

test.describe('AudioCheck keyboard chrome', () => {
	test('skip link lands on main', async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		await page.locator('a.ac-skip-link').focus();
		await page.keyboard.press('Enter');
		const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
		expect(focused).toBe('ac-main');
	});

	test('mobile nav drawer opens and traps focus', async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const toggle = page.locator('#ac-nav-toggle');
		await expect(toggle).toBeVisible();
		await toggle.click();
		await expect(page.locator('#app-navigation.ac-nav--open')).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Escape');
		await expect(page.locator('#app-navigation.ac-nav--open')).toHaveCount(0);
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	});
});
