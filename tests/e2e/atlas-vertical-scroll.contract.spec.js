// @ts-check
/**
 * ATLAS_VERTICAL_SCROLL_CONTRACT — tall settings page must scroll to the end.
 * Catches unpaired overflow-x:clip shells that truncate bottom content.
 */
const { test } = require('@playwright/test');
const path = require('path');
const { assertAtlasVerticalScrollReachable } = require(
	path.join(__dirname, '../../../_shared/e2e/atlas-vertical-scroll-contract'),
);
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

test.describe('ATLAS_VERTICAL_SCROLL_CONTRACT', () => {
	test('user settings scrolls to library scanning / Open Library', async ({ page }) => {
		const creds = resolveE2eCreds();
		test.skip(!creds, 'Needs NC_* / E2E_* credentials or storage state');
		await page.setViewportSize({ width: 1280, height: 640 });
		if (creds) {
			await login(page, creds);
		}
		await page.goto(`${BASE}/apps/audiocheck/settings`, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#ac-scan-subfolders, #ac-default-speed', { timeout: 45_000 });
		await assertAtlasVerticalScrollReachable(page, {
			scrollport: '#app-content',
			target: '#ac-scan-subfolders, .ac-settings-library, .ac-shortcuts__list',
			bottomSlopPx: 12,
		});
	});

	test('user settings stays reachable at phone height', async ({ page }) => {
		const creds = resolveE2eCreds();
		test.skip(!creds, 'Needs NC_* / E2E_* credentials or storage state');
		await page.setViewportSize({ width: 390, height: 667 });
		if (creds) {
			await login(page, creds);
		}
		await page.goto(`${BASE}/apps/audiocheck/settings`, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#ac-scan-subfolders, #ac-default-speed', { timeout: 45_000 });
		await assertAtlasVerticalScrollReachable(page, {
			scrollport: '#app-content',
			target: '#ac-scan-subfolders, .ac-settings-library, .ac-shortcuts__list',
			bottomSlopPx: 16,
		});
	});
});
