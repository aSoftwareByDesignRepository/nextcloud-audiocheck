#!/usr/bin/env node
/**
 * Capture App Store screenshots for AudioCheck (English UI, dark theme).
 * Outputs: screenshots/audiocheck-screenshot-01.png … 07.png
 *
 * Mapping:
 *  01 Library | 02 Music | 03 Playlists | 04 Favorites | 05 Browse | 06 Settings | 07 App settings
 *
 * Usage (from apps/audiocheck):
 *   NC_BASE_URL=http://127.0.0.1:8081 NC_ADMIN_USER=admin NC_ADMIN_PASS=… \
 *     node scripts/capture-store-screenshots.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const NC_DIR = path.resolve(ROOT, '../..');
const BASE = (process.env.NC_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const USER = process.env.NC_ADMIN_USER || process.env.E2E_USER || 'admin';
const PASS = process.env.NC_ADMIN_PASS || process.env.E2E_PASS || process.env.E2E_PASSWORD || '';
const VIEWPORT = { width: 1280, height: 720 };
const WAIT_APP = '#ac-view-root, #ac-main-content, #app-content, main';

const SHOTS = [
	{ n: '01', route: '/library' },
	{ n: '02', route: '/music' },
	{ n: '03', route: '/playlists' },
	{ n: '04', route: '/playlists/favorites' },
	{ n: '05', route: '/browse' },
	{ n: '06', route: '/settings' },
	{ n: '07', route: '/app-settings' },
];

function occ(args) {
	return execSync(`docker compose exec -u www-data -T nextcloud php occ ${args}`, {
		cwd: NC_DIR,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

async function login(page) {
	await page.goto(`${BASE}/logout`, { waitUntil: 'domcontentloaded' }).catch(() => {});
	await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
	if (!page.url().includes('/login')) return;
	await page.locator('input#user, input[name="user"]').first().fill(USER);
	await page.locator('input#password, input[name="password"]').first().fill(PASS);
	await page.locator('button[type="submit"], input[type="submit"]').first().click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
	await page.waitForLoadState('domcontentloaded');
}

async function api(page, method, urlPath, body) {
	return page.evaluate(
		async ({ method, urlPath, body }) => {
			const token =
				(window.OC && window.OC.requestToken) ||
				document.querySelector('head')?.getAttribute('data-requesttoken') ||
				document.querySelector('meta[name="requesttoken"]')?.content ||
				'';
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
			try {
				json = JSON.parse(text);
			} catch {
				json = { raw: text };
			}
			if (!res.ok) {
				throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`);
			}
			return json;
		},
		{ method, urlPath, body },
	);
}

async function tidyChrome(page) {
	await page.evaluate(() => {
		document.querySelectorAll('.toastify, .ac-toast, .toast, [data-ac-toast]').forEach((el) => el.remove());
		document.querySelectorAll('.ac-manual-marker').forEach((el) => el.remove());
		[...document.querySelectorAll('div, aside, section')].forEach((el) => {
			const t = el.innerText || '';
			if (t.includes('Introducing the new') && t.includes('Hub') && el.childElementCount < 40) {
				el.remove();
			}
		});
	});
	await page.waitForTimeout(150);
}

async function prepareContent(page) {
	await page.goto(`${BASE}/apps/audiocheck/library`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector(WAIT_APP, { timeout: 60000 });
	await tidyChrome(page);
	await page.waitForTimeout(600);

	const list = await api(page, 'GET', '/apps/audiocheck/api/libraries');
	const libs = list?.libraries || list?.items || [];
	const arr = Array.isArray(libs) ? libs : [];
	const paths = arr.map((l) => l.folderPath || l.path || '');

	async function addIfMissing(folderPath, contentKind) {
		if (paths.includes(folderPath)) return;
		try {
			await api(page, 'POST', '/apps/audiocheck/api/libraries', {
				folderPath,
				includeSubfolders: true,
				contentKind,
			});
			console.log(`  + library ${folderPath}`);
		} catch (e) {
			console.warn(`  ! library ${folderPath}: ${e.message}`);
		}
	}

	await addIfMissing('/Music', 'music');
	await addIfMissing('/Audiobooks', 'audiobook');

	try {
		await api(page, 'POST', '/apps/audiocheck/api/scan', {});
		console.log('  + scan triggered');
	} catch (e) {
		console.warn('  ! scan:', e.message);
	}
	for (let i = 0; i < 10; i++) {
		try {
			await api(page, 'GET', '/apps/audiocheck/api/scan/ajax-cron');
		} catch {
			/* ignore */
		}
		await page.waitForTimeout(400);
	}

	try {
		const pl = await api(page, 'GET', '/apps/audiocheck/api/playlists');
		const items = pl?.playlists || pl?.items || [];
		if (!Array.isArray(items) || items.length === 0) {
			await api(page, 'POST', '/apps/audiocheck/api/playlists', { name: 'Evening mix' });
			console.log('  + playlist Evening mix');
		}
	} catch (e) {
		console.warn('  ! playlist:', e.message);
	}

	try {
		const tracks = await api(page, 'GET', '/apps/audiocheck/api/tracks?limit=5&kind=music');
		const rows = tracks?.tracks || tracks?.items || [];
		for (const row of (Array.isArray(rows) ? rows : []).slice(0, 3)) {
			const fileId = row?.fileId || row?.file_id || row?.id;
			if (fileId) {
				await api(page, 'PUT', `/apps/audiocheck/api/tracks/${fileId}/favorite`, { favorite: true });
			}
		}
		console.log('  + favorites seeded');
	} catch (e) {
		console.warn('  ! favorite:', e.message);
	}
}

async function shot(page, n, route) {
	await page.goto(`${BASE}/apps/audiocheck${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
	await page.waitForSelector(WAIT_APP, { timeout: 60000 });
	await page.waitForTimeout(1200);
	await tidyChrome(page);
	const hub = await page.getByText('Introducing the new').isVisible().catch(() => false);
	if (hub) {
		throw new Error(`Hub wizard still visible on ${route} — disable firstrunwizard or mark show=99.0.0`);
	}
	const file = path.join(OUT, `audiocheck-screenshot-${n}.png`);
	await page.screenshot({ path: file, fullPage: false, type: 'png' });
	console.log(`  ✓ ${path.basename(file)} (${fs.statSync(file).size} bytes) ${route}`);
}

async function main() {
	if (!PASS) {
		throw new Error('Set NC_ADMIN_PASS (or E2E_PASS)');
	}
	fs.mkdirSync(OUT, { recursive: true });

	try {
		occ(`user:setting ${USER} core lang en`);
	} catch {
		/* optional */
	}
	try {
		// Prevent Hub / changelog modal from covering App Store shots.
		occ(`user:setting ${USER} firstrunwizard show 99.0.0`);
	} catch {
		/* optional */
	}
	try {
		occ(`user:setting ${USER} accessibility theme dark`);
	} catch {
		/* optional */
	}
	try {
		execSync(
			'docker compose exec -T mariadb mysql -unextcloud -pnextcloud_password nextcloud -e "TRUNCATE TABLE oc_bruteforce_attempts;"',
			{ cwd: NC_DIR, stdio: 'ignore' },
		);
	} catch {
		/* ignore */
	}

	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		locale: 'en-US',
		colorScheme: 'dark',
	});
	const page = await context.newPage();
	page.setDefaultTimeout(90000);

	console.log(`Logging in as ${USER} @ ${BASE}`);
	await login(page);
	console.log('Preparing library content…');
	await prepareContent(page);

	console.log('Capturing store screenshots…');
	for (const s of SHOTS) {
		await shot(page, s.n, s.route);
	}

	await browser.close();
	console.log('Done →', OUT);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
