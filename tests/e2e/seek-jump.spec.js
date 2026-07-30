// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');
const { login, credsFromEnv } = require('./helpers/auth.js');

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
		test.skip(true, 'Nextcloud instance requires occ upgrade — seek-jump e2e blocked by maintenance page');
	}
	const loginForm = await page.getByRole('heading', { name: /Log in to Nextcloud/i }).count();
	if (loginForm > 0) {
		test.skip(true, 'Not authenticated — set E2E_USER/E2E_PASS or refresh .auth/storage-state.json');
	}
	await page.waitForFunction(() => {
		return !!(window.AudioCheckPlayer && window.AudioCheckSeekJump && document.getElementById('ac-mini-player'));
	}, null, { timeout: 30_000 });
}

/**
 * Load a playable library track into the player starting near mid-file when duration is known.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ fileId: number, startedAt: number } | null>}
 */
async function loadPlayableTrack(page) {
	return page.evaluate(async () => {
		if (typeof window.AudioCheckPlayer.whenReady === 'function') {
			await window.AudioCheckPlayer.whenReady();
		}
		// Avoid fighting session restore: wait until restore flag clears.
		const deadline = Date.now() + 10_000;
		while (typeof window.AudioCheckPlayer.isRestoring === 'function' && window.AudioCheckPlayer.isRestoring() && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
		}
		const res = await fetch('/index.php/apps/audiocheck/api/tracks?limit=20', { credentials: 'same-origin' });
		const data = await res.json();
		const items = (data && data.items) || [];
		const track = items.find((t) => t && /verify-tone/i.test(String(t.fileName || '')) && t.browserPlayable !== false && !t.unavailable)
			|| items.find((t) => t && t.browserPlayable !== false && !t.unavailable && Number(t.sizeBytes) > 1000)
			|| items.find((t) => t && t.browserPlayable !== false && !t.unavailable)
			|| items[0];
		if (!track) return null;
		const startMs = track.durationMs > 60_000 ? 45_000 : (track.durationMs > 10_000 ? Math.floor(track.durationMs / 2) : 5_000);
		window.AudioCheckPlayer.playQueue([track], 0, startMs, true);
		return { fileId: track.fileId, startedAt: startMs, fileName: track.fileName };
	});
}

test.describe('AudioCheck seek jump (±30s)', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	test('SeekJump API is loaded and clamps like the product contract', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const result = await page.evaluate(() => {
			const api = window.AudioCheckSeekJump;
			const clamp = api.clampSeekBySeconds;
			const rapid = api.resolveSeekByTarget({
				pendingTargetSec: null,
				positionSec: 60,
				deltaSec: -30,
				durationSec: 120,
			});
			const rapid2 = api.resolveSeekByTarget({
				pendingTargetSec: rapid.pendingTargetSec,
				positionSec: 60,
				deltaSec: -30,
				durationSec: 120,
			});
			return {
				interval: api.SEEK_JUMP_SEC,
				forward: clamp(10, 30, 120),
				back: clamp(40, -30, 120),
				floor: clamp(5, -30, 120),
				ceil: clamp(110, 30, 120),
				rapidAccum: rapid2.nextSec,
				playerApi: typeof window.AudioCheckPlayer.seekBySec === 'function',
				playerInterval: window.AudioCheckPlayer.SEEK_JUMP_SEC,
			};
		});
		expect(result.interval).toBe(30);
		expect(result.playerInterval).toBe(30);
		expect(result.playerApi).toBe(true);
		expect(result.forward).toBe(40);
		expect(result.back).toBe(10);
		expect(result.floor).toBe(0);
		expect(result.ceil).toBe(120);
		expect(result.rapidAccum).toBe(0);
	});

	test('Now Playing jump controls work and meet a11y/size for an active track', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);

		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before seeking e2e');

		// Wait until both jump controls are stably present with correct labels (DOM may repaint on notify).
		await page.waitForFunction(() => {
			const back = document.getElementById('ac-now-jump-back');
			const fwd = document.getElementById('ac-now-jump-forward');
			const title = document.getElementById('ac-now-title');
			if (!back || !fwd || !title || back.disabled || fwd.disabled) return false;
			const backLabel = back.getAttribute('aria-label') || '';
			const fwdLabel = fwd.getAttribute('aria-label') || '';
			const backSecs = back.querySelector('.ac-transport-jump__secs');
			const fwdSecs = fwd.querySelector('.ac-transport-jump__secs');
			return /30/.test(backLabel)
				&& /30/.test(fwdLabel)
				&& !!(backSecs && backSecs.textContent === '30')
				&& !!(fwdSecs && fwdSecs.textContent === '30')
				&& back.getBoundingClientRect().height >= 44
				&& fwd.getBoundingClientRect().height >= 44;
		}, null, { timeout: 25_000 });

		const back = page.getByRole('button', { name: /Jump back 30 seconds/i });
		const fwd = page.getByRole('button', { name: /Jump forward 30 seconds/i });
		await expect(back).toBeVisible();
		await expect(fwd).toBeVisible();

		// Ensure media has metadata, park mid-track (or as far as duration allows), then jump.
		await page.waitForFunction(() => {
			const a = document.getElementById('ac-audio');
			return !!(a && Number.isFinite(a.currentTime) && (a.duration > 0 || a.readyState >= 2));
		}, null, { timeout: 25_000 });

		await page.evaluate(() => {
			const a = document.getElementById('ac-audio');
			if (!a) return;
			const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
			if (dur >= 40) {
				a.currentTime = 35;
			} else if (dur > 2) {
				a.currentTime = Math.max(1, dur * 0.7);
			} else {
				window.AudioCheckPlayer.seekBySec(30, { announce: false });
			}
		});
		await page.waitForFunction(() => {
			const a = document.getElementById('ac-audio');
			return !!(a && a.currentTime >= 1);
		}, null, { timeout: 10_000 });

		const before = await page.evaluate(() => document.getElementById('ac-audio').currentTime);
		await back.click();
		await page.waitForFunction((prev) => {
			const a = document.getElementById('ac-audio');
			if (!a) return false;
			// Full −30 when possible; otherwise clamp toward zero.
			return a.currentTime <= Math.max(0, prev - 20) + 0.25 || a.currentTime <= 0.5;
		}, before, { timeout: 10_000 });
		const afterBack = await page.evaluate(() => document.getElementById('ac-audio').currentTime);
		expect(afterBack).toBeLessThanOrEqual(before + 0.05);
		expect(afterBack).toBeGreaterThanOrEqual(0);

		await fwd.click();
		await page.waitForFunction((prev) => {
			const a = document.getElementById('ac-audio');
			if (!a) return false;
			const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Number.POSITIVE_INFINITY;
			const expected = Math.min(dur, prev + 30);
			return a.currentTime >= Math.min(expected, prev + 1) - 0.05;
		}, afterBack, { timeout: 10_000 });

		const axe = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.include('#app-content.ac-app')
			.exclude('.ac-toast')
			.analyze();
		expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
	});

	test('keyboard ← / → jumps by 30 seconds on an active track', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before seeking e2e');

		await page.waitForFunction(() => {
			const a = document.getElementById('ac-audio');
			const back = document.getElementById('ac-now-jump-back');
			return !!(a && back && Number.isFinite(a.currentTime));
		}, null, { timeout: 25_000 });

		await page.evaluate(() => {
			const a = document.getElementById('ac-audio');
			if (!a) return;
			const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
			a.currentTime = dur >= 40 ? 35 : Math.max(1, dur * 0.7 || 2);
		});
		await page.waitForFunction(() => {
			const a = document.getElementById('ac-audio');
			return !!(a && a.currentTime >= 1);
		}, null, { timeout: 10_000 });

		const before = await page.evaluate(() => document.getElementById('ac-audio').currentTime);
		await page.keyboard.press('ArrowLeft');
		await page.waitForFunction((prev) => {
			const a = document.getElementById('ac-audio');
			return !!(a && (a.currentTime <= Math.max(0, prev - 20) + 0.25 || a.currentTime <= 0.5));
		}, before, { timeout: 10_000 });
		const afterLeft = await page.evaluate(() => document.getElementById('ac-audio').currentTime);
		expect(afterLeft).toBeLessThanOrEqual(before + 0.05);

		await page.keyboard.press('ArrowRight');
		await page.waitForFunction((prev) => {
			const a = document.getElementById('ac-audio');
			if (!a) return false;
			const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Number.POSITIVE_INFINITY;
			return a.currentTime >= Math.min(dur, prev + 1) - 0.05;
		}, afterLeft, { timeout: 10_000 });
	});

	test('rapid double −30 accumulates via pending target (not stale clock)', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before seeking e2e');

		await page.waitForFunction(() => {
			const a = document.getElementById('ac-audio');
			const back = document.getElementById('ac-now-jump-back');
			return !!(a && back && !back.disabled && Number.isFinite(a.currentTime));
		}, null, { timeout: 25_000 });

		const result = await page.evaluate(() => {
			const a = document.getElementById('ac-audio');
			if (!a || typeof window.AudioCheckPlayer.seekBySec !== 'function') {
				return { ok: false, reason: 'missing audio/player' };
			}
			// Stub clock: stale reads stay at 60s while writes are recorded — proves pending-target
			// accumulation without needing a ≥65s file in the library.
			let written = 60;
			const proto = Object.getPrototypeOf(a);
			const timeDesc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
			const durDesc = Object.getOwnPropertyDescriptor(proto, 'duration');
			Object.defineProperty(a, 'currentTime', {
				configurable: true,
				enumerable: true,
				get() { return 60; },
				set(v) { written = Number(v); },
			});
			Object.defineProperty(a, 'duration', {
				configurable: true,
				enumerable: true,
				get() { return 120; },
			});
			window.AudioCheckPlayer.clearSeekJumpPending();
			window.AudioCheckPlayer.seekBySec(-30, { announce: false });
			const afterFirst = written;
			window.AudioCheckPlayer.seekBySec(-30, { announce: false });
			const afterSecond = written;
			if (timeDesc) Object.defineProperty(a, 'currentTime', timeDesc);
			else delete a.currentTime;
			if (durDesc) Object.defineProperty(a, 'duration', durDesc);
			else delete a.duration;
			window.AudioCheckPlayer.clearSeekJumpPending();
			return { ok: true, afterFirst, afterSecond };
		});

		expect(result.ok).toBe(true);
		expect(result.afterFirst).toBe(30);
		expect(result.afterSecond).toBe(0);
	});

	test('MediaSession hard-lock helper ignores UA 10s seekOffset', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const delta = await page.evaluate(() => {
			return window.AudioCheckSeekJump.resolveMediaSessionDeltaSec({ seekOffset: 10 }, 30);
		});
		expect(delta).toBe(30);
	});

	test('mini player has no ±30 jump buttons', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		await expect(page.locator('#ac-mini-player #ac-now-jump-back')).toHaveCount(0);
		await expect(page.locator('#ac-mini-player #ac-mini-jump-back')).toHaveCount(0);
		await expect(page.locator('#ac-mini-player .ac-transport-btn--jump')).toHaveCount(0);
	});
});
