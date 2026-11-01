// @ts-check
/**
 * Playlist sort picker gauntlet (atlas ds_chrome, feature wave 1.3.12).
 *
 * Covers the five-mode server-persisted sort chips inside each expandable
 * playlist group: chip a11y contract, durable ordering (ui_sort survives a
 * full page reload — not just an in-memory flag), true track-number ordering
 * (requires trackNo/discNo in the items payload), failure rollback (a
 * rejected PUT restores the previous chip + shows an error toast), and the
 * same-chip no-op guard (no duplicate PUT).
 *
 * Fixture discipline: everything runs on a scratch playlist created via the
 * app's own API and deleted in finally. The 'track' leg seeds m.track_no on
 * the three fixture meta rows (all lab meta ships track_no=NULL), restores
 * NULL afterwards — the window is seconds and confined to our own items.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const APP = `${BASE}/index.php/apps/audiocheck`;
const NC_DIR = path.join(__dirname, '..', '..', '..', '..');
const STAMP = `acsort-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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

/** Set/clear track numbers on the meta rows of the given fileIds. */
function seedTrackNos(assignments) {
	const statements = Object.entries(assignments)
		.map(([metaId, no]) => `UPDATE oc_ac_file_meta SET track_no=${no === null ? 'NULL' : Number(no)} WHERE id=${Number(metaId)};`)
		.join(' ');
	execSync(
		`docker compose exec -T mariadb sh -c 'echo "${statements}" | mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`,
		{ cwd: NC_DIR, stdio: 'pipe' },
	);
}

function metaIdsFor(fileIds) {
	const out = execSync(
		`docker compose exec -T mariadb sh -c 'echo "SELECT file_id,meta_id FROM oc_ac_tracks WHERE file_id IN (${fileIds.join(',')});" | mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N'`,
		{ cwd: NC_DIR, stdio: 'pipe' },
	).toString();
	const map = {};
	out.trim().split('\n').forEach((line) => {
		const [fid, mid] = line.split('\t');
		if (fid && mid) map[Number(fid)] = Number(mid);
	});
	return map;
}

test.describe('Playlist sort picker', () => {
	test.skip(!hasAnyCreds(), 'No Nextcloud credentials / storage state for e2e');

	test('sort chips persist server-side, honor track numbers, and roll back on failure', async ({ page }) => {
		await login(page, resolveE2eCreds('ADMIN'));
		await page.goto(`${BASE}/apps/audiocheck/playlists`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30_000 });

		// ── scratch fixture: playlist + 3 real tracks ──────────────────────
		const tracksRes = await api(page, 'GET', '/api/tracks?limit=6&sort=title');
		expect(tracksRes.status).toBe(200);
		const tracks = (tracksRes.json.items || []).filter((t) => t && !t.unavailable).slice(0, 3);
		expect(tracks.length, 'need >=3 indexed tracks for the sort fixture').toBe(3);

		const created = await api(page, 'POST', '/api/playlists', { name: STAMP });
		expect(created.status).toBe(200);
		const plId = created.json.playlist.id;
		let metaMap = {};
		try {
			for (const tr of tracks) {
				const add = await api(page, 'POST', `/api/playlists/${plId}/items`, { fileId: tr.fileId });
				expect(add.status).toBe(200);
			}
			// Seed track numbers that INVERT the title order — a 'track' sort that
			// secretly falls back to title ordering fails this arrangement.
			metaMap = metaIdsFor(tracks.map((t) => t.fileId));
			const assignments = {};
			tracks.forEach((tr, i) => { assignments[metaMap[tr.fileId]] = tracks.length - i; });
			seedTrackNos(assignments);

			// ── open the group: search isolates the scratch playlist ────────
			const search = page.locator('#ac-global-search-input');
			await search.fill(STAMP);
			const group = page.locator('details.ac-playlist-group:not(.ac-playlist-group--favorites)').first();
			await expect(group).toBeVisible({ timeout: 15_000 });
			await expect(group).toHaveAttribute('open', '', { timeout: 15_000 });
			const list = group.locator('ul.ac-track-list');
			await expect(list.locator('.ac-track-list__item')).toHaveCount(3, { timeout: 15_000 });

			// ── chip contract: group role + 5 modes + pressed states ────────
			const sortRow = group.locator('.ac-facet-group__sort[role="group"]');
			await expect(sortRow).toBeVisible();
			await expect(sortRow).toHaveAttribute('aria-label', /./);
			const chips = sortRow.locator('.ac-filter-chip');
			await expect(chips).toHaveCount(5);
			for (const mode of ['manual', 'name', 'name_desc', 'track', 'track_desc']) {
				await expect(sortRow.locator(`[data-sort="${mode}"]`)).toBeVisible();
			}
			await expect(sortRow.locator('[data-sort="manual"]')).toHaveClass(/ac-filter-chip--active/);
			await expect(sortRow.locator('[data-sort="manual"]')).toHaveAttribute('aria-pressed', 'true');
			await expect(sortRow.locator('[data-sort="name"]')).toHaveAttribute('aria-pressed', 'false');

			const apiOrder = async () => {
				const r = await api(page, 'GET', `/api/playlists/${plId}`);
				return (r.json.playlist.items || []).map((it) => it.title || '');
			};
			const titles = tracks.map((t) => t.title || t.fileName);
			const byTitleDesc = [...titles].sort((a, b) => b.localeCompare(a));

			// ── name_desc: PUT fires once, order flips, persists server-side ─
			const putResp = page.waitForResponse((r) => r.url().includes(`/api/playlists/${plId}/items/sort`) && r.request().method() === 'PUT');
			await sortRow.locator('[data-sort="name_desc"]').click();
			expect((await putResp).status()).toBe(200);
			await expect(sortRow.locator('[data-sort="name_desc"]')).toHaveClass(/ac-filter-chip--active/);
			// reloadPage() rebuilds the group DOM — re-query before asserting rows.
			const regroup = page.locator('details.ac-playlist-group:not(.ac-playlist-group--favorites)').first();
			await expect(regroup).toHaveAttribute('open', '', { timeout: 15_000 });
			const regroupList = regroup.locator('ul.ac-track-list');
			await expect(regroupList.locator('.ac-track-list__item')).toHaveCount(3, { timeout: 15_000 });
			await expect(regroupList.locator('.ac-track-list__title')).toHaveText(byTitleDesc);
			// Durable postcondition: stored item order itself is now desc.
			expect(await apiOrder()).toEqual(byTitleDesc);

			// ── full page reload: ui_sort is server-side, not in-memory ──────
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30_000 });
			await page.locator('#ac-global-search-input').fill(STAMP);
			const group2 = page.locator('details.ac-playlist-group:not(.ac-playlist-group--favorites)').first();
			await expect(group2).toHaveAttribute('open', '', { timeout: 15_000 });
			await expect(group2.locator('[data-sort="name_desc"]')).toHaveClass(/ac-filter-chip--active/, { timeout: 15_000 });
			await expect(group2.locator('ul.ac-track-list .ac-track-list__item')).toHaveCount(3, { timeout: 15_000 });
			await expect(group2.locator('.ac-track-list__title')).toHaveText(byTitleDesc);

			// ── track mode: seeded track numbers invert the title order ─────
			const expectedTrackOrder = tracks
				.slice()
				.sort((a, b) => assignments[metaMap[a.fileId]] - assignments[metaMap[b.fileId]])
				.map((t) => t.title || t.fileName); // ascending seeded track_no
			const putResp2 = page.waitForResponse((r) => r.url().includes(`/api/playlists/${plId}/items/sort`) && r.request().method() === 'PUT');
			await group2.locator('[data-sort="track"]').click();
			expect((await putResp2).status()).toBe(200);
			const group3 = page.locator('details.ac-playlist-group:not(.ac-playlist-group--favorites)').first();
			await expect(group3).toHaveAttribute('open', '', { timeout: 15_000 });
			const list3 = group3.locator('ul.ac-track-list');
			await expect(list3.locator('.ac-track-list__item')).toHaveCount(3, { timeout: 15_000 });
			await expect(list3.locator('.ac-track-list__title'), 'track sort must honor seeded track_no, not title order').toHaveText(expectedTrackOrder);
			expect(expectedTrackOrder, 'track order must differ from title asc here (fixture guarantee)').not.toEqual([...titles].sort((a, b) => a.localeCompare(b)));

			// ── same chip = no-op: a second click must not fire another PUT ──
			let extraPuts = 0;
			page.on('request', (req) => {
				if (req.url().includes(`/api/playlists/${plId}/items/sort`) && req.method() === 'PUT') extraPuts += 1;
			});
			await group3.locator('[data-sort="track"]').click();
			await page.waitForTimeout(600);
			expect(extraPuts, 'same-mode chip click must not re-PUT').toBe(0);

			// ── failure path: rejected sort rolls chips back + error toast ──
			await page.route(`**/api/playlists/${plId}/items/sort`, (route) => {
				route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
			});
			await group3.locator('[data-sort="name"]').click();
			const toast = page.locator('.ac-toast').first();
			await expect(toast).toBeVisible({ timeout: 10_000 });
			await expect(group3.locator('[data-sort="track"]')).toHaveClass(/ac-filter-chip--active/, { timeout: 10_000 });
			await expect(group3.locator('[data-sort="name"]')).not.toHaveClass(/ac-filter-chip--active/);
			await page.unroute(`**/api/playlists/${plId}/items/sort`);
			// Nothing persisted on the server: stored mode is still 'track'.
			const plRes = await api(page, 'GET', `/api/playlists/${plId}`);
			expect(plRes.json.playlist.sortMode).toBe('track');

			// ── axe on the fully-expanded sorted group ──────────────────────
			const axe = await new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
				.include('#app-content.ac-app')
				.exclude('.ac-toast')
				.exclude('.ac-toast-fallback')
				.analyze();
			expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
		} finally {
			await page.unrouteAll().catch(() => {});
			if (plId) await api(page, 'DELETE', `/api/playlists/${plId}`).catch(() => {});
			const cleared = {};
			Object.values(metaMap).forEach((mid) => { cleared[mid] = null; });
			if (Object.keys(cleared).length) {
				try { seedTrackNos(cleared); } catch { /* restore best-effort */ }
			}
		}
	});

	test('nav footer menu labels keep normal word breaks (no mid-word tears)', async ({ page }) => {
		await login(page, resolveE2eCreds('ADMIN'));
		await page.goto(`${BASE}/apps/audiocheck/`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#ac-main-content')).toBeVisible({ timeout: 30_000 });
		const item = page.locator('.ac-nav-footer__menu-item').first();
		if ((await item.count()) === 0) {
			test.skip(true, 'nav footer menu item not present on this surface');
		}
		const wrap = await item.evaluate((el) => getComputedStyle(el).overflowWrap);
		expect(wrap, 'menu labels must use break-word — anywhere tears mid-word').toBe('break-word');
	});
});
