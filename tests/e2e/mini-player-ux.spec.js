// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

/**
 * Bachus mini-player gauntlet: idle simplicity, active chrome, Close, themes,
 * viewports, WCAG 2.1 AA (axe), settings opt-in default off.
 */

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

async function ensureAuthed(page) {
	if (process.env.NC_ADMIN_USER || process.env.E2E_USER) {
		await login(page, credsFromEnv('ADMIN'));
	}
}

async function waitForShell(page) {
	const upgradeNeeded = await page.getByRole('heading', { name: /Update needed/i }).count();
	if (upgradeNeeded > 0) {
		test.skip(true, 'Nextcloud instance requires occ upgrade');
	}
	const loginForm = await page.getByRole('heading', { name: /Log in to Nextcloud/i }).count();
	if (loginForm > 0) {
		test.skip(true, 'Not authenticated — set E2E_USER/E2E_PASS or refresh .auth/storage-state.json');
	}
	await page.waitForFunction(() => {
		return !!(window.AudioCheckPlayer && document.getElementById('ac-mini-player'));
	}, null, { timeout: 30_000 });
}

async function loadPlayableTrack(page) {
	return page.evaluate(async () => {
		if (typeof window.AudioCheckPlayer.whenReady === 'function') {
			await window.AudioCheckPlayer.whenReady();
		}
		const deadline = Date.now() + 10_000;
		while (typeof window.AudioCheckPlayer.isRestoring === 'function' && window.AudioCheckPlayer.isRestoring() && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
		}
		const res = await fetch('/index.php/apps/audiocheck/api/tracks?limit=20', { credentials: 'same-origin' });
		const data = await res.json();
		const items = (data && data.items) || [];
		const track = items.find((t) => t && t.browserPlayable !== false && !t.unavailable && Number(t.sizeBytes) > 1000)
			|| items.find((t) => t && t.browserPlayable !== false && !t.unavailable)
			|| items[0];
		if (!track) return null;
		window.AudioCheckPlayer.playQueue([track], 0, 0, true);
		return { fileId: track.fileId };
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'light'|'dark'|'dark-highcontrast'|'light-highcontrast'} themeId
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
		} else if (id === 'dark') {
			body.classList.add('theme--dark');
			body.setAttribute('data-theme-dark', 'true');
		} else if (id === 'light-highcontrast') {
			body.classList.add('theme--light', 'theme--light-highcontrast');
			body.setAttribute('data-theme-light-highcontrast', 'true');
		} else {
			body.classList.add('theme--dark', 'theme--dark-highcontrast');
			body.setAttribute('data-theme-dark-highcontrast', 'true');
		}
		document.documentElement.style.colorScheme = id.includes('dark') ? 'dark' : 'light';
	}, themeId);
	await page.waitForTimeout(100);
}

async function api(page, method, urlPath, body) {
	return page.evaluate(async ({ method, urlPath, body }) => {
		const token =
			(window.OC && window.OC.requestToken)
			|| document.querySelector('head')?.getAttribute('data-requesttoken')
			|| document.querySelector('meta[name="requesttoken"]')?.content
			|| '';
		const opts = {
			method,
			credentials: 'same-origin',
			headers: { Accept: 'application/json', requesttoken: token },
		};
		if (body !== undefined) {
			opts.headers['Content-Type'] = 'application/json';
			opts.body = JSON.stringify(body);
		}
		const res = await fetch(urlPath, opts);
		const text = await res.text();
		let json = null;
		try { json = JSON.parse(text); } catch { json = { raw: text }; }
		if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 200)}`);
		return json;
	}, { method, urlPath, body });
}

test.describe('Bachus mini-player UX', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	test('idle dock is one calm line — no dead transport wall', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		await page.evaluate(() => {
			if (window.AudioCheckPlayer && typeof AudioCheckPlayer.clearQueue === 'function') {
				AudioCheckPlayer.clearQueue();
			}
		});
		await page.waitForFunction(() => {
			const mini = document.getElementById('ac-mini-player');
			return mini && mini.getAttribute('data-ac-mini-state') === 'idle';
		}, null, { timeout: 10_000 });

		const idle = await page.evaluate(() => {
			const mini = document.getElementById('ac-mini-player');
			const transport = mini?.querySelector('.ac-mini-player__transport');
			const seek = document.getElementById('ac-mini-seek-wrap');
			const side = mini?.querySelector('.ac-mini-player__side');
			const close = document.getElementById('ac-mini-close');
			const title = document.getElementById('ac-mini-title')?.textContent?.trim();
			return {
				state: mini?.getAttribute('data-ac-mini-state'),
				idleClass: mini?.classList.contains('ac-mini-player--idle'),
				transportHidden: !!(transport && transport.hidden),
				seekHidden: !!(seek && seek.hidden),
				sideHidden: !!(side && side.hidden),
				closeHidden: !!(close && close.hidden),
				title,
			};
		});
		expect(idle.state).toBe('idle');
		expect(idle.idleClass).toBe(true);
		expect(idle.transportHidden).toBe(true);
		expect(idle.seekHidden).toBe(true);
		expect(idle.sideHidden).toBe(true);
		expect(idle.closeHidden).toBe(true);
		expect(idle.title).toMatch(/Nothing playing|Nichts wird abgespielt|Rien n’est en cours|Rien n'est en cours/i);
	});

	test('active dock: Play + Close are obvious, Close clears the bar', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks — seed library first');

		await page.waitForFunction(() => {
			const mini = document.getElementById('ac-mini-player');
			const play = document.getElementById('ac-mini-play');
			const close = document.getElementById('ac-mini-close');
			return mini?.getAttribute('data-ac-mini-state') === 'active'
				&& play && !play.closest('[hidden]')
				&& close && !close.hidden;
		}, null, { timeout: 20_000 });

		const chrome = await page.evaluate(() => {
			const play = document.getElementById('ac-mini-play');
			const close = document.getElementById('ac-mini-close');
			const pr = play.getBoundingClientRect();
			const cr = close.getBoundingClientRect();
			return {
				playH: pr.height,
				playW: pr.width,
				closeH: cr.height,
				closeW: cr.width,
				closeLabel: close.getAttribute('aria-label'),
				activeClass: document.getElementById('ac-mini-player')?.classList.contains('ac-mini-player--active'),
			};
		});
		expect(chrome.activeClass).toBe(true);
		expect(chrome.playH).toBeGreaterThanOrEqual(44);
		expect(chrome.playW).toBeGreaterThanOrEqual(44);
		expect(chrome.closeH).toBeGreaterThanOrEqual(44);
		expect(chrome.closeW).toBeGreaterThanOrEqual(44);
		expect(chrome.closeLabel).toMatch(/Close player|Player schließen/i);

		await page.locator('#ac-mini-close').click();
		await page.waitForFunction(() => {
			const mini = document.getElementById('ac-mini-player');
			return mini?.getAttribute('data-ac-mini-state') === 'idle'
				&& !window.AudioCheckPlayer.getCurrentTrack();
		}, null, { timeout: 10_000 });
	});

	test('settings opt-in defaults off and global overlay stays away', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/settings`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		await page.waitForSelector('#ac-show-global-mini', { timeout: 20_000 });

		// Reset to default-off for a clean assertion.
		await api(page, 'PUT', '/apps/audiocheck/api/prefs', { showGlobalMiniPlayer: false });
		await page.reload({ waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		await page.waitForSelector('#ac-show-global-mini', { timeout: 20_000 });

		const checked = await page.locator('#ac-show-global-mini').isChecked();
		expect(checked).toBe(false);

		await page.goto(`${BASE}/apps/files/`, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1500);
		const onFiles = await page.evaluate(() => ({
			hasScript: !!document.querySelector('script[src*="global-mini-player"]'),
			hasPlayer: !!document.getElementById('ac-mini-player'),
			hasInput: !!document.getElementById('initial-state-audiocheck-global-mini-player'),
		}));
		expect(onFiles.hasScript).toBe(false);
		expect(onFiles.hasPlayer).toBe(false);
		expect(onFiles.hasInput).toBe(false);
	});

	for (const theme of ['light', 'dark', 'light-highcontrast', 'dark-highcontrast']) {
		test(`axe WCAG 2.1 AA on active mini-player @ ${theme}`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			await applyTheme(page, /** @type {any} */ (theme));
			const loaded = await loadPlayableTrack(page);
			test.skip(!loaded, 'No playable tracks — seed library first');
			await page.waitForFunction(() => {
				return document.getElementById('ac-mini-player')?.getAttribute('data-ac-mini-state') === 'active';
			}, null, { timeout: 20_000 });

			const results = await new AxeBuilder({ page })
				.include('#ac-mini-player')
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				.analyze();
			const blockers = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
			expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
		});
	}

	const viewports = [
		{ name: 'phone-320', width: 320, height: 640 },
		{ name: 'phone-390', width: 390, height: 844 },
		{ name: 'tablet-768', width: 768, height: 1024 },
		{ name: 'desktop-1280', width: 1280, height: 800 },
	];

	for (const vp of viewports) {
		test(`responsive active chrome @ ${vp.name}`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
			await waitForShell(page);
			const loaded = await loadPlayableTrack(page);
			test.skip(!loaded, 'No playable tracks — seed library first');
			await page.waitForFunction(() => {
				return document.getElementById('ac-mini-player')?.getAttribute('data-ac-mini-state') === 'active';
			}, null, { timeout: 20_000 });

			const layout = await page.evaluate(() => {
				const mini = document.getElementById('ac-mini-player');
				const play = document.getElementById('ac-mini-play');
				const close = document.getElementById('ac-mini-close');
				const jump = document.getElementById('ac-mini-jump-back');
				const mr = mini.getBoundingClientRect();
				const pr = play.getBoundingClientRect();
				const cr = close.getBoundingClientRect();
				const jumpDisplay = jump ? window.getComputedStyle(jump).display : 'none';
				return {
					miniBottom: mr.bottom,
					viewportH: window.innerHeight,
					playOk: pr.height >= 44 && pr.width >= 44,
					closeOk: cr.height >= 44 && cr.width >= 44 && !close.hidden,
					jumpDisplay,
					overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
				};
			});
			expect(layout.playOk).toBe(true);
			expect(layout.closeOk).toBe(true);
			expect(layout.overflowX).toBe(false);
			if (vp.width < 640) {
				expect(layout.jumpDisplay).toBe('none');
			} else {
				expect(layout.jumpDisplay).not.toBe('none');
			}
		});
	}
});
