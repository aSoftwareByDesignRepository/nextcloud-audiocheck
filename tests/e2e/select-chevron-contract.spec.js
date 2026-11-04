// @ts-check
/**
 * Rendered regression proof for the 2026-11-04 farm class-gate sweep
 * (required_field_or_step_undiscoverable / check-select-background-shorthand.py):
 * the `.ac-form-row select, …, .ac-input` form-control rule in css/app.css
 * painted the bare `background:` shorthand, resetting the NC core picker
 * caret (image/position/repeat/size) — the control read as a plain text
 * field in light and a tiled caret grid in dark.
 *
 * Leg (computed style, light AND dark):
 *  Settings `#ac-default-speed` — `select.ac-input` inside `.ac-form-row`,
 *  exercising both selector arms of the fixed rule.
 *
 * Theme is flipped by body-class mutation (same mechanism as
 * theme-responsive-a11y.spec.js) — no user-pref write, safe on shared farms.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const SETTINGS_URL = '/apps/audiocheck/settings';
const THEMES = ['light', 'dark'];

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

async function ensureAuthed(page) {
	if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
		await login(page, resolveE2eCreds('ADMIN'));
	}
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'light'|'dark'} themeId
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
		} else {
			body.classList.add('theme--dark');
			body.setAttribute('data-theme-dark', 'true');
			body.setAttribute('data-themes', 'dark');
		}
		document.documentElement.style.colorScheme = id === 'dark' ? 'dark' : 'light';
	}, themeId);
	await page.waitForTimeout(150);
}

/** Computed chevron probe: core caret = url() image + no-repeat + positioned. */
async function probeChevron(select, theme) {
	const probe = await select.evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			image: cs.backgroundImage,
			repeat: cs.backgroundRepeat,
			position: cs.backgroundPosition,
		};
	});
	expect(probe.image, `${theme}: chevron background-image missing (bare background: regression)`).toContain('url(');
	expect(probe.repeat, `${theme}: chevron tiles (dark-grid regression)`).toBe('no-repeat');
	expect(probe.position, `${theme}: chevron unpositioned`).not.toBe('0% 0%');
}

test.describe('select chevron contract', () => {
	test.skip(!hasAnyCreds(), 'no NC credentials or storage-state available');

	test('settings #ac-default-speed select keeps the picker chevron (light+dark)', async ({ page }) => {
		test.setTimeout(120_000);
		await ensureAuthed(page);
		await page.setViewportSize({ width: 1280, height: 900 });

		for (const theme of THEMES) {
			await page.goto(`${BASE}${SETTINGS_URL}`, { waitUntil: 'domcontentloaded' });
			await applyTheme(page, theme);
			const select = page.locator('.ac-form-row select#ac-default-speed.ac-input');
			await expect(select).toBeVisible({ timeout: 30_000 });
			await probeChevron(select, theme);
		}
	});
});
