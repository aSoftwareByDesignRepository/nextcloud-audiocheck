#!/usr/bin/env node
/**
 * Prove global mini-player mounts on Files after playing in AudioCheck.
 * Usage:
 *   NC_BASE_URL=http://127.0.0.1:8081 NC_ADMIN_PASS='…' \
 *     node scripts/proof-global-mini-player.cjs
 */
const { chromium } = require('@playwright/test');

const BASE = (process.env.NC_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const USER = process.env.NC_ADMIN_USER || 'admin';
const PASS = process.env.NC_ADMIN_PASS || process.env.E2E_PASS || 'StoreShot1!';

async function login(page) {
	await page.goto(`${BASE}/logout`, { waitUntil: 'domcontentloaded' }).catch(() => {});
	await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
	if (!page.url().includes('/login')) return;
	await page.locator('input#user, input[name="user"]').first().fill(USER);
	await page.locator('input#password, input[name="password"]').first().fill(PASS);
	await page.locator('button[type="submit"], input[type="submit"]').first().click();
	await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
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

function fail(msg, extra) {
	console.error('FAIL:', msg);
	if (extra) console.error(JSON.stringify(extra, null, 2));
	process.exit(1);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	const consoleErrors = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});

	await login(page);

	await page.goto(`${BASE}/apps/audiocheck/library`, { waitUntil: 'domcontentloaded', timeout: 90000 });
	await page.waitForSelector('#ac-view-root, #ac-main-content, #app-content', { timeout: 60000 });

	// Ensure there is something playable.
	let fileId = null;
	try {
		const tracks = await api(page, 'GET', '/apps/audiocheck/api/tracks?limit=10');
		const rows = tracks?.tracks || tracks?.items || [];
		const t = Array.isArray(rows) ? rows.find((x) => x && (x.fileId || x.file_id)) : null;
		if (t) fileId = t.fileId || t.file_id;
	} catch (e) {
		console.warn('tracks probe:', e.message);
	}

	if (!fileId) {
		const progress = await api(page, 'GET', '/apps/audiocheck/api/progress').catch(() => null);
		const cont = progress?.progress?.continue || [];
		if (cont[0]?.fileId) fileId = cont[0].fileId;
	}

	if (!fileId) {
		fail('No playable fileId found — seed a library first');
	}

	const playable = await api(page, 'GET', `/apps/audiocheck/api/playable/${fileId}`);
	const track = playable?.track;
	if (!track || track.unavailable) fail('Track unavailable', playable);

	await page.evaluate((tr) => {
		if (!window.AudioCheckPlayer || typeof AudioCheckPlayer.playQueue !== 'function') {
			throw new Error('AudioCheckPlayer.playQueue missing');
		}
		AudioCheckPlayer.playQueue([tr], 0, 0, true);
	}, track);

	await page.waitForFunction(() => {
		const p = document.getElementById('ac-mini-player');
		const t = window.AudioCheckPlayer && AudioCheckPlayer.getCurrentTrack && AudioCheckPlayer.getCurrentTrack();
		return !!(p && t && t.fileId);
	}, { timeout: 15000 });

	const inApp = await page.evaluate(() => ({
		session: !!sessionStorage.getItem('audiocheck_playback_session'),
		track: AudioCheckPlayer.getCurrentTrack()?.fileId || null,
		hidden: document.getElementById('ac-mini-player')?.hidden,
	}));
	console.log('in-app:', inApp);
	if (!inApp.session) fail('sessionStorage not set after play');

	await page.goto(`${BASE}/apps/files/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
	await page.waitForTimeout(2500);

	const onFiles = await page.evaluate(() => {
		const loadType =
			typeof OCP !== 'undefined' && OCP.InitialState
				? {
						loadState: typeof OCP.InitialState.loadState,
						load: typeof OCP.InitialState.load,
					}
				: null;
		let state = null;
		try {
			if (loadType?.loadState === 'function') {
				state = OCP.InitialState.loadState('audiocheck', 'global-mini-player');
			}
		} catch (e) {
			state = { error: String(e) };
		}
		const player = document.getElementById('ac-mini-player');
		const script = document.querySelector('script[src*="global-mini-player"]');
		const input = document.getElementById('initial-state-audiocheck-global-mini-player');
		const dep = document.querySelector('script[data-ac-global-dep="common/player"]');
		return {
			loadType,
			hasMarkup: !!(state && state.markup),
			hasServerPlayback: !!(state && state.hasServerPlayback),
			assetVersion: state && state.assetVersion ? String(state.assetVersion) : null,
			hasInput: !!input,
			hasScript: !!script,
			session: !!sessionStorage.getItem('audiocheck_playback_session'),
			playerExists: !!player,
			playerHidden: player ? player.hidden : null,
			isGlobal: player ? player.classList.contains('ac-mini-player--global') : false,
			trackTitle: player?.querySelector('.ac-mini-player__title')?.textContent?.trim() || '',
			bodyVisibleClass: document.body.classList.contains('ac-global-mini-player-visible'),
			playerMode: document.documentElement.dataset.acPlayerMode || null,
			hasAudioCheckPlayer: typeof window.AudioCheckPlayer !== 'undefined',
			volumeOpen: !!player?.querySelector('details.ac-volume-popover[open]'),
			depHasVersion: !!(dep && /[?&]v=/.test(dep.src || '')),
			bootedOnce: !!window.__acGlobalMiniPlayerBooted,
		};
	});

	console.log('on-files:', onFiles);
	if (consoleErrors.length) {
		console.log('console errors (sample):', consoleErrors.slice(0, 8));
	}

	if (!onFiles.hasScript) fail('global-mini-player.js not loaded on Files', onFiles);
	if (!onFiles.hasInput && !onFiles.hasMarkup) fail('InitialState missing on Files', onFiles);
	if (!onFiles.session) fail('sessionStorage lost on Files navigation', onFiles);
	if (!onFiles.playerExists) fail('#ac-mini-player never mounted on Files', onFiles);
	if (onFiles.playerHidden) fail('#ac-mini-player mounted but still hidden', onFiles);
	if (!onFiles.isGlobal) fail('player missing ac-mini-player--global', onFiles);
	if (!onFiles.assetVersion) fail('assetVersion missing from InitialState', onFiles);
	if (!onFiles.bootedOnce) fail('boot flag missing', onFiles);
	if (onFiles.volumeOpen) fail('volume popover must stay closed on global overlay', onFiles);
	if (!onFiles.depHasVersion) fail('player dep script missing cache-bust ?v=', onFiles);

	console.log('PASS: global mini-player visible on Files after leaving AudioCheck');
	await browser.close();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
