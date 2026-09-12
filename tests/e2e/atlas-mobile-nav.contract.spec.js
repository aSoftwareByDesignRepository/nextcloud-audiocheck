// @ts-check
/** ATLAS_MOBILE_NAV_CONTRACT — phone Menu → open nav + no h-scroll */
const { test } = require('@playwright/test');
const path = require('path');
const { assertAtlasMobileNav } = require(path.join(__dirname, '../../../_shared/e2e/atlas-mobile-nav-contract'));
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

test('ATLAS_MOBILE_NAV_CONTRACT in-page Menu opens drawer', async ({ page }) => {
	const creds = resolveE2eCreds();
	test.skip(!creds, 'Needs NC_* / E2E_* credentials or storage state');
	await page.setViewportSize({ width: 375, height: 812 });
	if (creds) {
		await login(page, creds);
	}
	await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#ac-nav-toggle', { timeout: 30000 });
	await assertAtlasMobileNav(page, {
		toggle: page.locator('#ac-nav-toggle'),
		nav: page.locator('#app-navigation'),
		openClass: /ac-nav--open/,
	});
});
