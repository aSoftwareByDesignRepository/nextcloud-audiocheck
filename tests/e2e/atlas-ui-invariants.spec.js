// @ts-check
/**
 * Atlas UI invariants — shared-contract coverage for AudioCheck web surfaces.
 *
 * Wires nextcloud/apps/_shared/e2e/atlas-ui-invariants.js onto representative
 * surfaces. Covered classes: a11y-dom (icon-only names, <24px targets,
 * focusable-in-aria-hidden, unannounced error callouts), stored-xss (playlist
 * name is a free-text field rendered on /playlists), console errors, raw i18n
 * keys, n+1 request count, mutation freshness, double-submit, form-loss-on-5xx.
 */
const { execSync } = require('child_process');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
	ATLAS_XSS_PAYLOADS,
	assertA11yDom,
	assertNoConsoleErrors,
	assertNoDuplicateSubmit,
	assertNoInjection,
	assertNoRawI18nKeys,
	assertFormSurvivesFailure,
	assertSurfaceFresh,
	countApiRequests,
	trackConsoleErrors,
} = require('../../../_shared/e2e/atlas-ui-invariants');
const { login, resolveE2eCreds } = require('./helpers/auth.js');

const BASE = (process.env.E2E_BASE || process.env.BASE_URL || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const APP = `${BASE}/index.php/apps/audiocheck`;
const CONTENT = '#app-content';
const STAMP = `acuinv-${Date.now()}`;
const NC_DIR = path.join(__dirname, '..', '..', '..', '..');

/**
 * The app's own RateLimitService enforces a 120-covers/60s sliding window per
 * user (lib/Controller/CoverController.php — deliberate DoS guard on CPU-heavy
 * extraction). A full e2e burst revalidating every grid cover trips it for the
 * rest of the window and produces console 429s unrelated to the invariant
 * under test. Purge the bucket before each sweep; the limiter itself is
 * covered by RateLimitService unit tests.
 */
function purgeRateLimits() {
	try {
		execSync(
			`docker compose exec -T mariadb sh -c 'echo "DELETE FROM oc_ac_rate_limits;" | mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`,
			{ cwd: NC_DIR, stdio: 'pipe' },
		);
	} catch {
		// best effort — assertion below still reports real 429s
	}
}

/** session-cookie JSON call into the app API */
async function api(page, method, path, body) {
	return page.evaluate(async ({ method: m, path: p, body: b }) => {
		const token = (typeof window.OC !== 'undefined' && window.OC.requestToken)
			|| document.querySelector('head[data-requesttoken]')?.getAttribute('data-requesttoken')
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
}

async function gotoApp(page, url) {
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.locator(CONTENT).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
}

test.describe('AudioCheck UI invariants (atlas-ui-invariants)', () => {
	test.beforeEach(async ({ page }) => {
		test.skip(!process.env.E2E_USER && !process.env.NC_ADMIN_USER, 'Set E2E_USER + E2E_PASS in e2e/.env');
		await page.setViewportSize({ width: 1280, height: 800 });
		// Reuse global storage-state session; only form-login when the session
		// is actually expired — repeated brute-force-style logins trip NC's
		// 429 throttle and pollute the console-error sweep.
		await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
		if (new URL(page.url()).pathname.includes('/login')) {
			await login(page, resolveE2eCreds('ADMIN'));
		}
	});

	for (const [label, url] of [
		['music', `${APP}/music`],
		['playlists', `${APP}/playlists`],
		['library', `${APP}/library`],
		['settings', `${APP}/settings`],
	]) {
		test(`a11y-dom sweep /${label}`, async ({ page }) => {
			await gotoApp(page, url);
			// WCAG 2.5.8 equivalent-target exception: radios/checkboxes below 24px
			// are legal only while a wrapping <label> or sibling <label for=...>
			// provides a ≥24px pointer target for the same control. Prove that
			// before allow-listing the inputs themselves in the mechanical sweep.
			const unlabeled = await page.evaluate(() => {
				const bad = [];
				document.querySelectorAll('#app-content input[type="radio"], #app-content input[type="checkbox"]').forEach((inp) => {
					const lbl = inp.closest('label')
						|| (inp.id ? document.querySelector(`label[for="${CSS.escape(inp.id)}"]`) : null);
					if (!lbl) {
						bad.push(`no label: ${inp.id || inp.outerHTML.slice(0, 60)}`);
						return;
					}
					const r = lbl.getBoundingClientRect();
					const cs = getComputedStyle(lbl);
					if (cs.display === 'none' || cs.visibility === 'hidden') return;
					if (r.width < 24 || r.height < 24) bad.push(`label ${Math.round(r.width)}x${Math.round(r.height)} < 24px: ${inp.id}`);
				});
				return bad;
			});
			expect(unlabeled, `radio/checkbox without a ≥24px label target on /${label}:\n${unlabeled.join('\n')}`).toEqual([]);
			const findings = await assertA11yDom(page, {
				content: CONTENT,
				sizeAllow: 'input[type="radio"], input[type="checkbox"]',
			});
			expect(findings, `a11y-dom findings on /${label}:\n${findings.join('\n')}`).toEqual([]);
		});

		test(`console errors + raw i18n keys /${label}`, async ({ page }) => {
			purgeRateLimits();
			// The cover bucket (120/60s per user — deliberate DoS guard on
			// CPU-heavy extraction) is shared across parallel farm workers;
			// a full-suite run can legitimately fill it. Console 429s are
			// allowed only up to the number of /api/cover/* 429 responses
			// actually observed on this page — a 429 anywhere else still fails.
			let cover429 = 0;
			page.on('response', (r) => {
				if (r.status() === 429 && /\/apps\/audiocheck\/api\/cover\//.test(r.url())) cover429++;
			});
			const errs = trackConsoleErrors(page);
			await gotoApp(page, url);
			const e429 = errs.filter((e) => /status of 429/.test(e));
			const rest = errs.filter((e) => !/status of 429/.test(e));
			expect(
				e429.length,
				`console 429s (${e429.length}) exceed observed cover-bucket 429s (${cover429}) — a non-cover endpoint was throttled`,
			).toBeLessThanOrEqual(cover429);
			expect(rest, `console errors on surface /${label}: ${rest.join(' | ')}`).toEqual([]);
			await assertNoRawI18nKeys(page, { content: CONTENT });
		});
	}

	test('n+1: /music issues a bounded number of app DATA API requests', async ({ page }) => {
		// Per-item binary assets (cover art, stream) and playback sync endpoints
		// (queue/playable/progress writes on state change) are inherent per-item
		// traffic, not list-data N+1. The invariant guards per-row DATA fetches —
		// a grid that GETs /api/tracks/{id} once per row would trip this bound.
		const hits = await countApiRequests(page, async () => {
			await gotoApp(page, `${APP}/music`);
			await page.waitForLoadState('networkidle').catch(() => {});
		}, '/apps/audiocheck/api/');
		const dataHits = hits.filter(
			(h) => !/\/api\/(cover|stream|playable|progress|queue)\b/.test(h.url),
		);
		expect(
			dataHits.length,
			`/music fired ${dataHits.length} data API requests (N+1 suspect): ${dataHits.map((h) => `${h.method} ${h.url}`).join(' | ')}`,
		).toBeLessThanOrEqual(8);
	});

	test('stored-xss: playlist name payloads render escaped on /playlists', async ({ page }) => {
		const created = [];
		try {
			for (const payload of ATLAS_XSS_PAYLOADS.slice(0, 3)) {
				const name = `${STAMP}-${payload}`.slice(0, 250);
				const res = await api(page, 'POST', '/api/playlists', { name });
				test.skip(res.status !== 200, `playlist create ${res.status}: ${res.body.slice(0, 120)}`);
				created.push(JSON.parse(res.body).playlist.id);
			}
			await gotoApp(page, `${APP}/playlists`);
			await page.waitForLoadState('networkidle').catch(() => {});
			await assertNoInjection(page);
		} finally {
			for (const id of created) {
				await api(page, 'DELETE', `/api/playlists/${id}`);
			}
		}
	});

	test('mutation freshness: API-created playlist appears on /playlists without manual edit', async ({ page }) => {
		const name = `${STAMP}-fresh`;
		let id = null;
		try {
			await assertSurfaceFresh(page, {
				content: CONTENT,
				mutate: async () => {
					const res = await api(page, 'POST', '/api/playlists', { name });
					id = JSON.parse(res.body)?.playlist?.id ?? null;
					expect(res.status).toBe(200);
				},
				visit: () => gotoApp(page, `${APP}/playlists`),
				expect: { present: name },
			});
		} finally {
			if (id) await api(page, 'DELETE', `/api/playlists/${id}`);
		}
	});

	test('double-submit: playlist create fires at most one POST', async ({ page }) => {
		await gotoApp(page, `${APP}/playlists`);
		// empty state or header button opens the create modal — find either trigger
		const trigger = page.locator(
			'#app-content button:has-text(""), #app-content [class*="empty"] button, #app-content button',
		);
		// structural: primary action button inside playlists surface
		const openBtn = page.locator('#app-content .ac-btn--primary, #app-content [data-action="new-playlist"], #app-content .ac-empty button').first();
		await openBtn.click().catch(() => {});
		const input = page.locator('#ac-new-playlist-name');
		test.skip(!(await input.count()), 'create-playlist modal trigger not found — surface changed');
		await input.fill(`${STAMP}-dbl`);
		const submit = page.locator('.ac-modal button[type="submit"], .ac-modal .ac-btn--primary, dialog .ac-btn--primary').first();
		// dispatchEvent bypasses actionability: fires even after the button
		// disables in-flight, so this proves the app's own submit guard.
		await assertNoDuplicateSubmit(page, {
			mutatingUrl: '/apps/audiocheck/api/playlists',
			method: 'POST',
			submit: () => submit.dispatchEvent('click').catch(() => {}),
		});
		// cleanup any created probe playlists
		const list = await api(page, 'GET', '/api/playlists');
		for (const p of JSON.parse(list.body).playlists || []) {
			if (String(p.name).startsWith(STAMP)) await api(page, 'DELETE', `/api/playlists/${p.id}`);
		}
	});

	test('form survival: playlist name input survives a 500 from POST /api/playlists', async ({ page }) => {
		await gotoApp(page, `${APP}/playlists`);
		const openBtn = page.locator('#app-content .ac-btn--primary, #app-content .ac-empty button').first();
		await openBtn.click().catch(() => {});
		const input = page.locator('#ac-new-playlist-name');
		test.skip(!(await input.count()), 'create-playlist modal trigger not found — surface changed');
		const submit = page.locator('.ac-modal button[type="submit"], .ac-modal .ac-btn--primary, dialog .ac-btn--primary').first();
		await assertFormSurvivesFailure(page, {
			failUrl: '/apps/audiocheck/api/playlists',
			method: 'POST',
			fields: { '#ac-new-playlist-name': `${STAMP}-survives` },
			submit: () => submit.click(),
			errorSel: '.ac-toast--error',
		});
	});
});
