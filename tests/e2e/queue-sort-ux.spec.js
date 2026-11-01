// @ts-check
/**
 * Queue sort chips gauntlet (Now playing → Queue section).
 *
 * Covers the four-mode live-queue sort: chip a11y contract, durable reorder
 * through the same PUT /api/queue path as manual moves, current-track pinning
 * (the playing element keeps its index remap — seeded mid-queue), derived
 * active-state (a manual arrow move clears the chip without extra state), and
 * the shuffle interaction (chips disabled while shuffle is on).
 *
 * Fixture discipline: three real indexed tracks pushed via PUT /api/queue,
 * queue deleted afterwards via DELETE /api/queue.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { login, resolveE2eCreds } = require('./helpers/auth.js');

// Load the app's real comparator so expectations share natural-sort semantics
// (localeCompare orders '01-*' titles differently than the app does).
const NS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'common', 'natural-sort.js'), 'utf8');
const nsSandbox = { window: {}, Intl };
vm.createContext(nsSandbox);
vm.runInContext(NS_SRC, nsSandbox);
const NS = nsSandbox.window.AudioCheckNaturalSort;

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const APP = `${BASE}/index.php/apps/audiocheck`;

function hasAnyCreds() {
	return !!(
		process.env.NC_ADMIN_USER
		|| process.env.E2E_USER
		|| fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))
	);
}

/** session-cookie JSON call into the app API */
async function api(page, method, path, body) {
	const r = await page.evaluate(async ({ method: m, path: p, body: b }) => {
		const token = (typeof window.OC !== 'undefined' && window.OC.requestToken)
			|| document.querySelector('input[name="requesttoken"]')?.getAttribute('value')
			|| '';
		const res = await fetch(p, {
			method: m,
			credentials: 'same-origin',
			headers: {
				requesttoken: token,
				'OCS-APIRequest': 'true',
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: b === undefined ? undefined : JSON.stringify(b),
		});
		return { status: res.status, body: await res.text() };
	}, { method, path: `${APP}${path}`, body });
	return { status: r.status, json: r.body ? JSON.parse(r.body) : null };
}

test.describe('Queue sort chips (Now playing)', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test('chips reorder the live queue, pin the current track, and persist server-side', async ({ page }) => {
		test.setTimeout(120_000);
		// Prefer env creds; a live storage state is already authenticated —
		// login() then early-returns on the /login redirect.
		try {
			await login(page, resolveE2eCreds('ADMIN'));
		} catch (err) {
			if (!fs.existsSync(path.join(__dirname, '..', '..', '.auth', 'storage-state.json'))) throw err;
		}
		await page.goto(`${BASE}/apps/audiocheck/browse`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30_000 });

		// ── fixture: 3 playable tracks, queue seeded in a non-sorted order ─
		const tracksRes = await api(page, 'GET', '/api/tracks?limit=8&sort=title');
		expect(tracksRes.status).toBe(200);
		const tracks = (tracksRes.json.items || []).filter((t) => t && !t.unavailable).slice(0, 3);
		expect(tracks.length, 'need >=3 indexed tracks for the queue fixture').toBe(3);

		// Order: middle track first, then last, then first — matches no mode.
		const order = [tracks[1].fileId, tracks[2].fileId, tracks[0].fileId];
		const put = await api(page, 'PUT', '/api/queue', {
			fileIds: order,
			currentIndex: 1, // the last fixture entry — remap must follow it
			playbackSpeed: 100,
			shuffle: false,
			repeatMode: 'off',
		});
		expect(put.status).toBe(200);

		try {
			await page.goto(`${BASE}/apps/audiocheck/now-playing`, { waitUntil: 'domcontentloaded' });
			await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30_000 });
			// Bootstrap restore is racy (progress vs queue restore) — drive the
			// seeded queue through the player API for a deterministic fixture;
			// durability is asserted via GET /api/queue afterwards anyway.
			await page.waitForFunction(() => window.AudioCheckPlayer && typeof AudioCheckPlayer.playQueue === 'function');
			await page.evaluate(async (fileIds) => {
				const items = [];
				for (const fileId of fileIds) {
					const r = await AudioCheckApi.get('/apps/audiocheck/api/playable/{fileId}', null, { params: { fileId } });
					items.push(r.track);
				}
				AudioCheckPlayer.playQueue(items, 1, 0, false);
			}, order);
			const list = page.locator('#ac-queue-list');
			await expect(list.locator('.ac-track-list__item')).toHaveCount(3, { timeout: 20_000 });

			// ── chip contract: group role + 4 modes, no 'manual' ────────────
			const sortRow = page.locator('.ac-now-queue__sort[role="group"]');
			await expect(sortRow).toBeVisible();
			await expect(sortRow).toHaveAttribute('aria-label', /./);
			const chips = sortRow.locator('.ac-filter-chip');
			await expect(chips).toHaveCount(4);
			for (const mode of ['name', 'name_desc', 'track', 'track_desc']) {
				await expect(sortRow.locator(`[data-sort="${mode}"]`)).toBeVisible();
			}
			await expect(sortRow.locator('[data-sort="manual"]')).toHaveCount(0);
			// Derived-state invariant: the active chip (if any) must equal the
			// mode the app's own comparator computes for the rendered order.
			const queueItemsFromApi = async () => (await api(page, 'GET', '/api/queue')).json.queue.items;
			const seededItems = await queueItemsFromApi();
			const derived = NS.queueSortModeFor(seededItems);
			const activeCount = await sortRow.locator('.ac-filter-chip--active').count();
			const activeNow = activeCount
				? await sortRow.locator('.ac-filter-chip--active').first().getAttribute('data-sort')
				: null;
			expect(activeNow ?? null, `active chip must equal derived mode ${derived}`).toBe(derived);

			const titles = tracks.map((t) => t.title || t.fileName);
			// Click a mode guaranteed to reorder — clicking the already-matching
			// mode is a no-op (no PUT) by design.
			const targetMode = (derived === 'name' || derived === 'track') ? 'name_desc' : 'name';
			const expectedOrder = NS.sortQueueTracks(seededItems, targetMode).map((t) => t.title || t.fileName);
			const currentTitle = titles[2]; // queue currentIndex=1 → order[1]=tracks[2].fileId

			// ── sort chip: PUT fires, rows reorder, active chip lights ──────
			const putResp = page.waitForResponse((r) => r.url().includes('/api/queue') && r.request().method() === 'PUT');
			await sortRow.locator(`[data-sort="${targetMode}"]`).click();
			expect((await putResp).status()).toBe(200);
			await expect(sortRow.locator(`[data-sort="${targetMode}"]`)).toHaveClass(/ac-filter-chip--active/);
			await expect(sortRow.locator(`[data-sort="${targetMode}"]`)).toHaveAttribute('aria-pressed', 'true');
			await expect(list.locator('.ac-track-list__title')).toHaveText(expectedOrder);

			// Durable postcondition: server queue reflects the new order and the
			// current pointer still addresses the same element.
			const after = await api(page, 'GET', '/api/queue');
			expect(after.status).toBe(200);
			expect(after.json.queue.items.map((it) => it.title)).toEqual(expectedOrder);
			const curItem = after.json.queue.items[after.json.queue.currentIndex];
			expect(curItem.title, 'current track must stay the same element after sort').toBe(currentTitle);

			// ── trackNo/discNo now ride the queue payload ───────────────────
			expect(after.json.queue.items[0]).toHaveProperty('trackNo');
			expect(after.json.queue.items[0]).toHaveProperty('discNo');

			// ── derived state: a manual arrow move must drop the chip unless
			//    the new order still equals a sort mode (recompute, don't assume)
			const downBtn = list.locator('.ac-track-list__item').nth(1).locator('button').nth(1);
			if (await downBtn.count()) await downBtn.click();
			const postItems = await queueItemsFromApi();
			const postDerived = NS.queueSortModeFor(postItems);
			await expect
				.poll(async () => (await sortRow.locator('.ac-filter-chip--active').count())
					? await sortRow.locator('.ac-filter-chip--active').getAttribute('data-sort')
					: null)
				.toBe(postDerived);

			// ── shuffle: sort is meaningless under a permutation → disabled ─
			const shuffleRow = page.locator('#ac-shuffle-row');
			await page.locator('.ac-now-advanced summary').click();
			await shuffleRow.click();
			await expect(sortRow.locator('[data-sort="name"]')).toBeDisabled();
			await expect(sortRow.locator('[data-sort="track_desc"]')).toBeDisabled();
			await shuffleRow.click(); // shuffle back off
			await expect(sortRow.locator('[data-sort="name"]')).toBeEnabled();

			// ── axe on the queue section with sort chrome visible ──────────
			const axe = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
				.include('#app-content.ac-app')
				.exclude('.ac-toast')
				.exclude('.ac-toast-fallback')
				.analyze();
			expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
		} finally {
			await api(page, 'DELETE', '/api/queue').catch(() => {});
		}
	});
});
