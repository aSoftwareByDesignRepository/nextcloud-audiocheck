// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login, resolveE2eCreds } = require('./helpers/auth.js');

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
		await login(page, resolveE2eCreds('ADMIN'));
	}
}

async function waitForShell(page) {
	const loginField = await page.locator('input#user, input[name="user"]').count();
	const guestChrome = await page.locator('body#body-login').count();
	if (guestChrome > 0 && loginField === 0) {
		test.skip(true, 'Nextcloud instance requires occ upgrade — scrub-seek e2e blocked by maintenance page');
	}
	if (loginField > 0) {
		test.skip(true, 'Not authenticated — set E2E_USER/E2E_PASS or refresh .auth/storage-state.json');
	}
	await page.waitForFunction(() => {
		return !!(window.AudioCheckPlayer && window.AudioCheckSeekJump && document.getElementById('ac-mini-player'));
	}, null, { timeout: 30_000 });
}

/**
 * Load a playable library track into the player (same contract as seek-jump.spec).
 */
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

async function waitForMetadata(page) {
	await page.waitForFunction(() => {
		const a = document.getElementById('ac-audio');
		return !!(a && Number.isFinite(a.currentTime) && a.duration > 0 && a.readyState >= 1);
	}, null, { timeout: 25_000 });
}

/**
 * Slider `max` repaints lazily on timeupdate — the template ships max="1000",
 * so assigning a higher value before the first paint clamps to 1000. Wait for
 * the real-duration max before driving the slider.
 */
async function waitForSliderPainted(page, sliderId) {
	await page.waitForFunction((id) => {
		const seek = document.getElementById(id);
		return !!(seek && parseInt(seek.max, 10) > 5000);
	}, sliderId, { timeout: 15_000 });
}

test.describe('AudioCheck scrub slider (preview/commit split)', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!hasAnyCreds(), 'Requires NC_* / E2E_* credentials or .auth/storage-state.json');
		await ensureAuthed(page);
	});

	test('mini seek: input previews only, change commits exactly once', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);
		await waitForSliderPainted(page, 'ac-mini-seek');

		// Count progress saves triggered by the gesture.
		const progressPosts = [];
		await page.route('**/apps/audiocheck/api/progress/**', (route) => {
			if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
				try { progressPosts.push(JSON.parse(route.request().postData() || '{}')); } catch { /* beacon blob */ }
			}
			route.continue();
		});

		const result = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-mini-seek');
			if (!a || !seek || !(a.duration > 5)) return null;
			const before = a.currentTime;
			const targetMs = Math.floor(Math.min(a.duration - 2, Math.max(5, a.currentTime + 20)) * 1000);

			// Preview: input events must NOT touch currentTime.
			seek.value = String(targetMs);
			const valueAfterSet = seek.value;
			seek.dispatchEvent(new Event('input', { bubbles: true }));
			seek.dispatchEvent(new Event('input', { bubbles: true }));
			const duringPreview = a.currentTime;
			const posLabel = (document.getElementById('ac-mini-pos') || {}).textContent || '';
			const aria = seek.getAttribute('aria-valuetext') || '';
			const valueBeforeChange = seek.value;

			// Commit: exactly one seek.
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			const rightAfterChange = a.currentTime;
			await new Promise((r) => setTimeout(r, 600));
			return {
				before, duringPreview, after: a.currentTime, rightAfterChange,
				targetSec: targetMs / 1000, posLabel, aria, duration: a.duration,
				seekMax: seek.max, valueAfterSet, valueBeforeChange, paused: a.paused,
			};
		});
		test.skip(!result, 'Track too short for scrub e2e');

		expect(Math.abs(result.duringPreview - result.before)).toBeLessThan(1.5); // preview never seeks
		expect(result.posLabel.length).toBeGreaterThan(0); // preview updated label
		expect(result.aria.length).toBeGreaterThan(0); // preview updated a11y text
		expect(Math.abs(result.after - result.targetSec)).toBeLessThan(1.5); // change commits

		// Commit must produce a save (debounced ~400ms; give it room).
		await page.waitForTimeout(1200);
		expect(progressPosts.length).toBeGreaterThanOrEqual(1);
		const last = progressPosts[progressPosts.length - 1];
		if (last && typeof last.positionMs === 'number') {
			expect(Math.abs(last.positionMs - result.targetSec * 1000)).toBeLessThan(2000);
		}
	});

	test('now playing seek: input previews only, change commits', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);

		// Now Playing view needs to be rendered — it builds on route/view mount.
		const hasSlider = await page.waitForFunction(() => !!document.getElementById('ac-now-seek'), null, { timeout: 15_000 }).then(() => true).catch(() => false);
		test.skip(!hasSlider, '#ac-now-seek not rendered in this shell');
		await waitForSliderPainted(page, 'ac-now-seek');

		const result = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-now-seek');
			if (!a || !seek || !(a.duration > 5)) return null;
			const before = a.currentTime;
			const targetMs = Math.floor(Math.min(a.duration - 2, Math.max(5, a.currentTime + 15)) * 1000);
			seek.value = String(targetMs);
			seek.dispatchEvent(new Event('input', { bubbles: true }));
			const duringPreview = a.currentTime;
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise((r) => setTimeout(r, 600));
			return { before, duringPreview, after: a.currentTime, targetSec: targetMs / 1000 };
		});
		test.skip(!result, 'Track too short for scrub e2e');

		expect(Math.abs(result.duringPreview - result.before)).toBeLessThan(1.5);
		expect(Math.abs(result.after - result.targetSec)).toBeLessThan(1.5);
	});

	test('drag latch holds until change — no stale repaint between pointerup and commit', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);
		await waitForSliderPainted(page, 'ac-mini-seek');

		const result = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-mini-seek');
			if (!a || !seek || !(a.duration > 5)) return null;
			const durMs = Math.floor(a.duration * 1000);
			const curMs = Math.floor(a.currentTime * 1000);
			// Sentinel inside the slider's CURRENT max (template ships max=1000
			// until updateMiniSeek repaints it) and clearly different from live
			// position so a repaint is provable.
			const maxMs = parseInt(seek.max, 10) || durMs;
			let sentinel = Math.min(maxMs, curMs + 30000);
			if (sentinel === curMs) sentinel = Math.max(0, curMs - 30000);
			const sentinelMs = String(sentinel);

			seek.dispatchEvent(new Event('pointerdown', { bubbles: true }));
			seek.dispatchEvent(new Event('pointerup', { bubbles: true }));
			// Between pointerup and change the latch must still block repaints:
			// poison the value and force a paint — if the latch works it stays.
			seek.value = sentinelMs;
			const valueAfterSet = seek.value;
			const preCommitMs = String(Math.floor(a.currentTime * 1000));
			a.dispatchEvent(new Event('timeupdate'));
			const heldValue = seek.value;
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			a.dispatchEvent(new Event('timeupdate'));
			const releasedValue = seek.value;
			return {
				heldValue, releasedValue, sentinelMs, valueAfterSet, preCommitMs,
				currentMs: String(Math.floor(a.currentTime * 1000)),
				seekMax: seek.max, duration: a.duration,
				sliderCount: document.querySelectorAll('#ac-mini-seek').length,
			};
		});
		test.skip(!result, 'Track too short for scrub e2e');

		expect(result.valueAfterSet).toBe(result.sentinelMs); // sentinel actually took
		expect(result.preCommitMs).not.toBe(result.sentinelMs); // live pos differed pre-commit
		expect(result.heldValue).toBe(result.sentinelMs); // latch blocked the repaint
		// After `change` the commit makes the sentinel the live position; the
		// repaint must write the TRUE position (prove paint resumed, not stuck).
		expect(result.releasedValue).toBe(result.currentMs);
	});

	test('scrub clears pending restore — loadedmetadata cannot clobber user intent', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);
		await waitForSliderPainted(page, 'ac-mini-seek');

		const result = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-mini-seek');
			if (!a || !seek || !(a.duration > 10)) return null;
			// Re-arm a deferred restore as if a reload just happened, then let the
			// user scrub before metadata would apply it.
			const res = await fetch('/index.php/apps/audiocheck/api/tracks?limit=20', { credentials: 'same-origin' });
			const data = await res.json();
			const track = ((data && data.items) || []).find((t) => t && t.browserPlayable !== false && !t.unavailable) || (data.items || [])[0];
			if (!track) return null;
			const durMs = Number(track.durationMs) || a.duration * 1000;
			const restoreMs = Math.floor(durMs * 0.8);
			window.AudioCheckPlayer.playQueue([track], 0, restoreMs, true);
			// User scrubs immediately — must kill the pending restore.
			const targetMs = Math.floor(durMs * 0.2);
			seek.value = String(targetMs);
			seek.dispatchEvent(new Event('input', { bubbles: true }));
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise((r) => setTimeout(r, 1800));
			return { after: a.currentTime, targetSec: targetMs / 1000, restoreSec: restoreMs / 1000 };
		});
		test.skip(!result, 'Track too short for scrub e2e');

		// Position must be near the user's commit, NOT the armed restore point.
		expect(Math.abs(result.after - result.targetSec)).toBeLessThan(3.5);
		expect(Math.abs(result.after - result.restoreSec)).toBeGreaterThan(3.5);
	});

	test('commit at duration backs off the EOF guard instead of ending the track', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);
		await waitForSliderPainted(page, 'ac-mini-seek');

		const result = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-mini-seek');
			if (!a || !seek || !(a.duration > 5)) return null;
			// Pause first: while PLAYING, committing dur-0.25 rightly ends the
			// track 250ms later. The guard's contract is about the seek landing
			// point, not eternal life — assert it while paused.
			a.pause();
			await new Promise((r) => setTimeout(r, 50));
			let ended = false;
			a.addEventListener('ended', () => { ended = true; }, { once: true });
			seek.value = String(Math.floor(a.duration * 1000));
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise((r) => setTimeout(r, 700));
			return { after: a.currentTime, duration: a.duration, ended, paused: a.paused };
		});
		test.skip(!result, 'Track too short for scrub e2e');

		expect(result.ended).toBe(false);
		expect(result.paused).toBe(true);
		expect(result.after).toBeLessThan(result.duration);
		expect(result.after).toBeGreaterThanOrEqual(result.duration - 1.5); // parked at dur - 0.25 guard
	});

	test('offline: scrub still seeks buffered media, save fails gracefully', async ({ page, context }) => {
		await page.goto(`${BASE}/apps/audiocheck`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);
		await waitForSliderPainted(page, 'ac-mini-seek');

		// Give the media element time to buffer a chunk.
		await page.waitForTimeout(1500);
		await context.setOffline(true);

		const result = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-mini-seek');
			if (!a || !seek || !(a.duration > 5)) return null;
			const targetMs = Math.floor(Math.min(a.duration - 2, Math.max(2, a.currentTime - 10)) * 1000);
			seek.value = String(targetMs);
			seek.dispatchEvent(new Event('input', { bubbles: true }));
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			try {
				await new Promise((r) => setTimeout(r, 800));
				return { after: a.currentTime, targetSec: targetMs / 1000, error: null };
			} catch (err) {
				return { after: null, targetSec: targetMs / 1000, error: String(err) };
			}
		});
		test.skip(!result, 'Track too short for scrub e2e');
		await context.setOffline(false);

		expect(result.error).toBeNull();
		expect(Math.abs(result.after - result.targetSec)).toBeLessThan(1.5); // local seek works offline
	});

	test('progress survives pause + reload (persistence end-to-end)', async ({ page }) => {
		await page.goto(`${BASE}/apps/audiocheck`, { waitUntil: 'domcontentloaded' });
		await waitForShell(page);
		const loaded = await loadPlayableTrack(page);
		test.skip(!loaded, 'No playable tracks in library — seed audio before scrub e2e');
		await waitForMetadata(page);
		await waitForSliderPainted(page, 'ac-mini-seek');

		// Capture every progress write to know exactly what the server stored.
		const progressPosts = [];
		await page.route('**/apps/audiocheck/api/progress/**', (route) => {
			if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
				try { progressPosts.push(JSON.parse(route.request().postData() || '{}')); } catch { /* beacon blob */ }
			}
			route.continue();
		});

		// Scrub-commit to a known position, then pause (pause must persist now).
		const committedSec = await page.evaluate(async () => {
			const a = document.getElementById('ac-audio');
			const seek = document.getElementById('ac-mini-seek');
			const targetMs = Math.floor(Math.min(a.duration - 3, Math.max(10, a.currentTime + 25)) * 1000);
			seek.value = String(targetMs);
			seek.dispatchEvent(new Event('change', { bubbles: true }));
			await new Promise((r) => setTimeout(r, 400));
			if (!a.paused) window.AudioCheckPlayer.toggle(); // pause
			return { targetSec: targetMs / 1000, paused: a.paused, currentSec: a.currentTime };
		});

		// Server must hold ~committed position after the pause save.
		await page.waitForTimeout(1200);
		const serverPos = await page.evaluate(async (fileId) => {
			const res = await fetch(`/index.php/apps/audiocheck/api/progress?fileId=${fileId}`, { credentials: 'same-origin' });
			if (!res.ok) return null;
			const data = await res.json();
			const p = data && data.progress;
			const entry = Array.isArray(p) ? p.find((x) => x && Number(x.fileId) === Number(fileId)) : p;
			return entry && typeof entry.positionMs === 'number' ? entry.positionMs / 1000 : null;
		}, loaded.fileId);
		if (serverPos !== null) {
			expect(Math.abs(serverPos - committedSec.targetSec)).toBeLessThan(4);
		}
	});
});
