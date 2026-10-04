// @ts-check
/**
 * ATLAS_RENDERED_SURFACE_CONTRACT — AudioCheck page surfaces.
 *
 * Asserts the *rendered* truth of each app page: content lists keep markers,
 * selects vertically centre their value, icons render non-zero, form controls
 * are not centred by shell leaks. DOM-only specs pass on visually broken pages
 * (marker resets, sunken selects, 0×0 icons) — this catches them.
 *
 * Every AudioCheck page surface is listed in SURFACES. Marker-less list
 * designs (track rows, chip lists, card grids, picker listboxes, nav trees)
 * are AudioCheck design language and opt out via listAllow — never silently
 * skipped.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login, resolveE2eCreds } = require('./helpers/auth.js');
const { assertAtlasRenderedSurface } = require(path.join(__dirname, '../../../_shared/e2e/atlas-rendered-surface-contract'));

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

// Every routed page surface (appinfo/routes.php page#* routes). The playlist
// detail template is covered by /playlists/favorites (same shell('playlist')).
const SURFACES = [
	['/apps/audiocheck/', 'home'],
	['/apps/audiocheck/audiobooks', 'audiobooks'],
	['/apps/audiocheck/music', 'music'],
	['/apps/audiocheck/playlists', 'playlists'],
	['/apps/audiocheck/playlists/favorites', 'playlist-favorites'],
	['/apps/audiocheck/browse', 'browse'],
	['/apps/audiocheck/now-playing', 'now-playing'],
	['/apps/audiocheck/library', 'library'],
	['/apps/audiocheck/settings', 'settings'],
	['/apps/audiocheck/get-the-app', 'get-the-app'],
	['/apps/audiocheck/app-settings/access', 'app-settings-access'],
	['/apps/audiocheck/app-settings/admins', 'app-settings-admins'],
	['/apps/audiocheck/app-settings/defaults', 'app-settings-defaults'],
	['/apps/audiocheck/app-settings/support', 'app-settings-support'],
];

const CONTRACT_OPTS = {
	content: '#ac-view-root',
	navExclude:
		'#app-navigation, nav, .ac-nav, .ac-breadcrumb, .ac-mini-player, .ac-player-bar',
	// Marker-less by design (css/app.css sets list-style:none intentionally on
	// these components: track/row grids, chip rows, picker listboxes, nav trees).
	listAllow:
		'.ac-track-list, .ac-chip-list, .ac-entity-picker__listbox, ' +
		'.ac-chapter-list, .ac-nav__list, .ac-nav__children, .ac-playlist-pick-list, ' +
		'.ac-library-list, .ac-collection-grid, .ac-card-grid, .ac-queue-list, ' +
		'.ac-facet-list, .ac-playlist-list, .ac-admin-list, .ac-get-app__features',
	// Player transport / volume controls and the speed stepper (– [select] +)
	// are deliberately centred components.
	centerAllow: '.ac-mini-player, .ac-player-bar, .ac-now-playing__controls, .ac-now-speed__controls',
};

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

test.describe('ATLAS_RENDERED_SURFACE_CONTRACT', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test.beforeEach(async ({ page }) => {
		if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
			await login(page, resolveE2eCreds('ADMIN'));
		}
	});

	for (const [path_, name] of SURFACES) {
		test(`ATLAS_RENDERED_SURFACE_CONTRACT ${name}`, async ({ page }) => {
			await page.goto(`${BASE}${path_}`, { waitUntil: 'domcontentloaded' });
			// Wait for the SPA view to finish rendering (loading skeleton removed).
			await expect(page.locator('#ac-view-root').first()).toBeAttached({ timeout: 30_000 });
			await expect(page.locator('#ac-view-root .ac-view-loading')).toHaveCount(0, { timeout: 30_000 });
			await assertAtlasRenderedSurface(page, CONTRACT_OPTS);
		});
	}
});
