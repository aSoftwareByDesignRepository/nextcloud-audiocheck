#!/usr/bin/env node
/**
 * AudioCheck NC App Store gallery — DE UI @ 1920×1040 (~8 shots).
 * No empty home hero, no EN chrome bleed, no lab junk, no companion pages.
 *
 * Usage (from apps/audiocheck):
 *   node scripts/capture-store-shots.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn } from 'child_process'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = resolve(appRoot, 'e2e/.env')
if (existsSync(envFile)) {
	for (const line of readFileSync(envFile, 'utf8').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq <= 0) continue
		const key = trimmed.slice(0, eq).trim()
		let value = trimmed.slice(eq + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		if (process.env[key] === undefined) process.env[key] = value
	}
}

const base = (process.env.E2E_BASE || process.env.NC_BASE_URL || 'http://localhost:8081').replace(/\/$/, '')
const user = process.env.E2E_USER || process.env.NC_ADMIN_USER || 'admin'
const pass = process.env.E2E_PASSWORD || process.env.E2E_PASS || process.env.NC_ADMIN_PASS || ''
const outDir = resolve(appRoot, 'screenshots')
mkdirSync(outDir, { recursive: true })

const VIEWPORT = { width: 1920, height: 1040 }
const WAIT_APP = '#ac-view-root, #ac-main-content, #ac-mini-player, main'

const SHOTS = [
	{ file: 'audiocheck-screenshot-01-home.png', path: '/apps/audiocheck/', action: 'home' },
	{ file: 'audiocheck-screenshot-02-music.png', path: '/apps/audiocheck/music', action: 'list' },
	{ file: 'audiocheck-screenshot-03-audiobooks.png', path: '/apps/audiocheck/audiobooks', action: 'list' },
	{ file: 'audiocheck-screenshot-04-playlists.png', path: '/apps/audiocheck/playlists', action: 'list' },
	{ file: 'audiocheck-screenshot-05-favorites.png', path: '/apps/audiocheck/playlists/favorites', action: 'list' },
	{ file: 'audiocheck-screenshot-06-browse.png', path: '/apps/audiocheck/browse', action: 'browse' },
	{ file: 'audiocheck-screenshot-07-now-playing.png', path: '/apps/audiocheck/now-playing', action: 'now' },
	{ file: 'audiocheck-screenshot-08-settings.png', path: '/apps/audiocheck/settings', action: 'settings' },
]

const FORBIDDEN = [
	'smoke-mobile',
	'Evening mix',
	'Nothing in progress',
	'Derzeit nichts in Wiedergabe',
	'Get the app',
	'Google Play',
	'Play Store',
	'Introducing the new',
]

function pinDe() {
	try {
		execSync(
			`flock -w 8 /tmp/nc-force-lang.lock -c 'docker exec -u www-data nextcloud-app php occ config:system:set force_language --value=de && docker exec -u www-data nextcloud-app php occ config:system:set force_locale --value=de_DE && docker exec -u www-data nextcloud-app php occ config:system:set default_language --value=de && docker exec -u www-data nextcloud-app php occ config:system:set default_locale --value=de_DE'`,
			{ stdio: 'ignore', timeout: 20000 },
		)
	} catch {
		/* ignore */
	}
	try {
		execSync(`docker exec -u www-data nextcloud-app php occ user:setting ${user} core lang de`, {
			stdio: 'ignore',
			timeout: 15000,
		})
		execSync(`docker exec -u www-data nextcloud-app php occ user:setting ${user} core locale de_DE`, {
			stdio: 'ignore',
			timeout: 15000,
		})
		execSync(`docker exec -u www-data nextcloud-app php occ user:setting ${user} firstrunwizard show 99.0.0`, {
			stdio: 'ignore',
			timeout: 15000,
		})
	} catch {
		/* ignore */
	}
}

function seed() {
	execSync(
		'docker exec -u www-data nextcloud-app php /var/www/html/custom_apps/audiocheck/scripts/seed-store-demo.php',
		{ stdio: 'inherit', timeout: 180000 },
	)
}

function clearBrute() {
	try {
		execSync(
			'docker exec nextcloud-mariadb mysql -unextcloud -pnextcloud_password nextcloud -e "TRUNCATE TABLE oc_bruteforce_attempts;"',
			{ stdio: 'ignore', timeout: 15000 },
		)
	} catch {
		/* ignore */
	}
}

pinDe()
if (!process.env.AC_SKIP_SEED) {
	seed()
} else {
	console.log('AC_SKIP_SEED set — skipping seed')
}
pinDe()
clearBrute()

let langPin = null
if (!process.env.AC_SKIP_LANG_PIN) {
	langPin = spawn(
		'bash',
		[
			'-c',
			`while true; do flock -w 2 /tmp/nc-force-lang.lock -c 'docker exec -u www-data nextcloud-app php occ config:system:set force_language --value=de >/dev/null 2>&1; docker exec -u www-data nextcloud-app php occ config:system:set force_locale --value=de_DE >/dev/null 2>&1'; sleep 2; done`,
		],
		{ stdio: 'ignore', detached: true },
	)
	langPin.unref()
} else {
	console.log('AC_SKIP_LANG_PIN set — relying on ?forceLanguage=de + user lang')
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
	viewport: VIEWPORT,
	locale: 'de-DE',
	timezoneId: 'Europe/Berlin',
	colorScheme: 'light',
	extraHTTPHeaders: { 'Accept-Language': 'de-DE,de;q=0.9' },
})
const page = await context.newPage()
page.setDefaultTimeout(60000)

async function login() {
	clearBrute()
	pinDe()
	await page.goto(`${base}/index.php/logout`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
	await page.waitForTimeout(300)
	for (let i = 1; i <= 5; i++) {
		clearBrute()
		pinDe()
		await page.goto(`${base}/index.php/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
		const box = page.locator('#user, input[name="user"]').first()
		await box.waitFor({ state: 'visible', timeout: 15000 })
		await box.fill(user)
		await page.locator('#password, input[name="password"]').first().fill(pass)
		await page.locator('button[type="submit"], input[type="submit"]').first().click()
		try {
			await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30000 })
			return
		} catch {
			console.warn('login retry', i)
		}
	}
	throw new Error('login failed')
}

async function polish(opts = {}) {
	await page.evaluate((denseNow) => {
		document
			.querySelectorAll(
				'.toastify,.toast,.oc-dialog,.firstrunwizard,#firstrunwizard,.ac-toast,[data-ac-toast],.ac-manual-marker',
			)
			.forEach((e) => e.remove())
		// Hide Play-companion nav (store gallery = web only)
		document
			.querySelectorAll(
				'[data-ac-nav-id="get-the-app"], a[href*="get-the-app"], .ac-get-app',
			)
			.forEach((el) => {
				const item = el.closest('.ac-nav__item') || el
				item.style.setProperty('display', 'none', 'important')
			})
		;[...document.querySelectorAll('div, aside, section')].forEach((el) => {
			const t = el.innerText || ''
			if (t.includes('Introducing the new') && t.includes('Hub') && el.childElementCount < 40) {
				el.remove()
			}
		})
		// Store-shot density: keep cover + chapters + queue in the 1040px fold
		let style = document.getElementById('ac-store-shot-css')
		if (!style) {
			style = document.createElement('style')
			style.id = 'ac-store-shot-css'
			document.head.appendChild(style)
		}
		style.textContent = denseNow
			? `
			.ac-now-section--track .ac-now-card__cover-wrap { max-width: 6.5rem !important; }
			.ac-now-section--options { display: none !important; }
			.ac-now-section--track .ac-now-track-actions { display: none !important; }
			.ac-now-section--track .ac-now-mode-banners { display: none !important; }
			.ac-now-queue__hint { display: none !important; }
			.ac-now-section--track .ac-now-card__title { font-size: 1.15rem !important; margin: 0.25rem 0 !important; }
			.ac-now-section--track .ac-now-card__subtitle { margin: 0 0 0.35rem !important; }
			.ac-now-section--track .ac-now-seek { margin: 0.25rem auto !important; }
			.ac-now-section--track .ac-now-transport { margin: 0.25rem 0 !important; }
			.ac-chapter-list li:nth-child(n+5) { display: none !important; }
			.ac-now-queue .ac-track-list__item:nth-child(n+5) { display: none !important; }
			.ac-home-quick-actions, .ac-home-section--quick { margin-block: 0.35rem !important; }
			.ac-mini-player { max-height: 4.25rem !important; }
			`
			: `
			.ac-home-quick-actions, .ac-home-section--quick { margin-block: 0.35rem !important; }
			.ac-mini-player { max-height: 4.25rem !important; }
			.ac-page-body { padding-bottom: 5rem !important; }
			`
	}, !!opts.denseNow)
	await page.waitForTimeout(120)
}

async function waitCovers() {
	await page.evaluate(async () => {
		const imgs = [...document.querySelectorAll('img.ac-card__cover, img.ac-now-card__cover')]
		await Promise.all(
			imgs.slice(0, 24).map(
				(img) =>
					new Promise((resolve) => {
						if (img.complete && img.naturalWidth > 0) return resolve()
						img.addEventListener('load', () => resolve(), { once: true })
						img.addEventListener('error', () => resolve(), { once: true })
						setTimeout(resolve, 2500)
					}),
			),
		)
	})
}

async function clickTab(tabId) {
	await page.waitForSelector(`[data-tab-id="${tabId}"]`, { timeout: 15000 }).catch(() => null)
	const btn = page.locator(`[data-tab-id="${tabId}"]`).first()
	if (!(await btn.count())) return false
	await btn.click()
	await page.waitForTimeout(500)
	await page
		.waitForFunction(
			(id) => {
				const el = document.querySelector(`[data-tab-id="${id}"]`)
				return el && el.getAttribute('aria-selected') === 'true'
			},
			tabId,
			{ timeout: 8000 },
		)
		.catch(() => {})
	await page.waitForTimeout(600)
	return true
}

async function ensureAudiobookNowPlaying() {
	await page.waitForFunction(() => !!(window.AudioCheckPlayer && window.AudioCheckApi), { timeout: 45000 })
	await page.evaluate(async () => {
		const P = window.AudioCheckPlayer
		const Api = window.AudioCheckApi
		if (typeof P.whenReady === 'function') {
			try {
				await P.whenReady()
			} catch {
				/* ignore */
			}
		}
		const data = await Api.get('/apps/audiocheck/api/tracks', {
			kind: 'audiobook',
			limit: 12,
			page: 1,
			sort: 'title',
		})
		let items = (data && data.items) || []
		// Prefer Die letzte Fähre chapter 1 when present
		const prefer =
			items.find((t) => /Ankunft/i.test(t.title || '')) ||
			items.find((t) => (t.chapters && t.chapters.length > 1) || t.hasChapters) ||
			items[0]
		if (!prefer) return
		// Hydrate full playable payloads (chapters_json lives on playable, not list)
		const hydrated = []
		for (const tr of items.slice(0, 8)) {
			try {
				const r = await Api.get('/apps/audiocheck/api/playable/{fileId}', null, {
					params: { fileId: tr.fileId },
				})
				hydrated.push(r && r.track ? Object.assign({}, tr, r.track) : tr)
			} catch {
				hydrated.push(tr)
			}
		}
		let head = hydrated.find((t) => t.fileId === prefer.fileId)
		if (!head) {
			try {
				const r = await Api.get('/apps/audiocheck/api/playable/{fileId}', null, {
					params: { fileId: prefer.fileId },
				})
				head = r && r.track ? Object.assign({}, prefer, r.track) : prefer
			} catch {
				head = prefer
			}
			hydrated.unshift(head)
		}
		const ordered = [head].concat(hydrated.filter((t) => t.fileId !== head.fileId)).slice(0, 8)
		// Mid-chapter seek — avoid end-of-file auto-finish wiping continue state
		P.playQueue(ordered, 0, 45000, false)
		const a = document.getElementById('ac-audio')
		if (a) {
			if (!a.paused) a.pause()
			try {
				a.currentTime = 45
			} catch {
				/* ignore */
			}
		}
	})
	await page.waitForTimeout(800)
	await page
		.waitForFunction(() => {
			const body = (document.body && document.body.innerText) || ''
			const loading = body.includes('Kapitel werden geladen') || body.includes('Loading chapters')
			const hasChButtons = !!document.querySelector('#ac-chapter-list .ac-chapter-list__btn')
			const hasQueue = body.includes('Warteschlange') || body.includes('Queue')
			return hasQueue && hasChButtons && !loading
		}, { timeout: 20000 })
		.catch(async () => {
			// Last resort: patch chapters onto current track from playable and force repaint
			await page.evaluate(async () => {
				const P = window.AudioCheckPlayer
				const Api = window.AudioCheckApi
				if (!P || !Api) return
				const cur = P.getCurrentTrack && P.getCurrentTrack()
				if (!cur) return
				try {
					const r = await Api.get('/apps/audiocheck/api/playable/{fileId}', null, {
						params: { fileId: cur.fileId },
					})
					if (r && r.track && r.track.chapters && r.track.chapters.length) {
						const q = (P.getQueue && P.getQueue()) || []
						const idx = P.getCurrentIndex ? P.getCurrentIndex() : 0
						if (q[idx]) Object.assign(q[idx], r.track)
						if (typeof P.notify === 'function') P.notify()
						// Trigger now-playing repaint via hash nudge
						window.dispatchEvent(new Event('ac-player-change'))
					}
				} catch {
					/* ignore */
				}
			})
			await page.waitForTimeout(1500)
		})
}

async function resetContentScroll() {
	await page.evaluate(() => {
		const hosts = [
			document.querySelector('#app-content'),
			document.querySelector('#app-content-vue'),
			document.querySelector('.app-content'),
			document.querySelector('#ac-main-content'),
			document.querySelector('.ac-page-body'),
			document.scrollingElement,
			document.documentElement,
			document.body,
		]
		hosts.forEach((el) => {
			if (el && typeof el.scrollTo === 'function') el.scrollTo(0, 0)
			else if (el) el.scrollTop = 0
		})
		window.scrollTo(0, 0)
	})
}

async function ensureContinueHome() {
	await page.waitForFunction(() => !!(window.AudioCheckPlayer && document.getElementById('ac-mini-player')), {
		timeout: 45000,
	})
	await page.evaluate(async () => {
		const P = window.AudioCheckPlayer
		const Api = window.AudioCheckApi
		if (!P || !Api) return
		if (typeof P.whenReady === 'function') {
			try {
				await P.whenReady()
			} catch {
				/* ignore */
			}
		}
		// Prefer a music track with cover for Weiterhören hero
		const data = await Api.get('/apps/audiocheck/api/tracks', {
			kind: 'music',
			limit: 8,
			page: 1,
			sort: 'title',
		})
		const items = (data && data.items) || []
		const pick =
			items.find((t) => /Morgenlicht|Skyline|Signal/i.test(t.title || '')) || items[0]
		if (pick) {
			const queue = items.slice(0, 5)
			const idx = Math.max(0, queue.findIndex((t) => t.fileId === pick.fileId))
			P.playQueue(idx >= 0 ? queue : [pick, ...queue].slice(0, 5), idx >= 0 ? idx : 0, 95000, false)
		}
		const a = document.getElementById('ac-audio')
		if (a) {
			if (!a.paused) a.pause()
			try {
				a.currentTime = 95
			} catch {
				/* ignore */
			}
		}
	})
	await page.waitForTimeout(700)
	// Reload home so Continue listening merges live player + progress
	await page.goto(`${base}/apps/audiocheck/?forceLanguage=de`, {
		waitUntil: 'domcontentloaded',
		timeout: 90000,
	})
	await page.waitForSelector(WAIT_APP, { timeout: 60000 })
	await page.waitForTimeout(900)
	await polish()
	await resetContentScroll()
	await page.waitForFunction(() => {
		const mini = document.getElementById('ac-mini-player')
		const active = mini && mini.getAttribute('data-ac-mini-state') === 'active'
		const body = (document.body && document.body.innerText) || ''
		const empty =
			body.includes('Derzeit nichts in Wiedergabe') || body.includes('Nothing in progress right now')
		const hero =
			document.querySelector('.ac-home-hero') ||
			document.querySelector('.ac-home-continue') ||
			[...document.querySelectorAll('h2')].some((h) => /Weiterhören|Continue listening/.test(h.textContent || ''))
		return active && !!hero && !empty
	}, { timeout: 20000 }).catch(() => {
		console.warn('ensureContinueHome: soft-timeout (continuing with current home state)')
	})
	await resetContentScroll()
}

async function assertClean(label) {
	const body = await page.locator('body').innerText()
	for (const bad of FORBIDDEN) {
		if (label === '01-home' && (bad.includes('Nichts') || bad.includes('Nothing') || bad.includes('Derzeit'))) {
			if (body.includes(bad)) throw new Error(`${label}: empty hero text "${bad}"`)
			continue
		}
		if (body.includes(bad)) {
			throw new Error(`${label}: forbidden text "${bad}"`)
		}
	}
	// EN chrome bleed on nav — require at least one DE nav word on content pages
	if (label !== '08-settings') {
		const hasDe =
			/Start|Musik|Hörbücher|Playlists|Durchsuchen|Bibliothek|Einstellungen|Aktuelle Wiedergabe|Favoriten|Weiterhören/.test(
				body,
			)
		if (!hasDe) throw new Error(`${label}: missing DE chrome (possible EN bleed)`)
	}
}

if (!pass) throw new Error('Set E2E_PASSWORD / NC_ADMIN_PASS')

console.log(`Login ${user} @ ${base}`)
await login()

const meta = { captured_at: new Date().toISOString(), viewport: VIEWPORT, locale: 'de', shots: [] }

for (const shot of SHOTS) {
	pinDe()
	const url = `${base}${shot.path}${shot.path.includes('?') ? '&' : '?'}forceLanguage=de`
	console.log('→', shot.file, url)
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
	await page.waitForSelector(WAIT_APP, { timeout: 60000 })
	await page.waitForTimeout(900)
	await polish()

	if (shot.action === 'home') {
		await ensureContinueHome()
		await polish()
		await waitCovers()
		await resetContentScroll()
		await page.waitForTimeout(300)
	} else if (shot.action === 'now') {
		await ensureAudiobookNowPlaying()
		await polish({ denseNow: true })
		await waitCovers()
		await resetContentScroll()
		await page.waitForTimeout(400)
	} else if (shot.action === 'browse') {
		await page.waitForFunction(() => !!(window.AudioCheckPlayer), { timeout: 30000 }).catch(() => {})
		await clickTab('artists')
		await page.waitForTimeout(700)
		await polish()
		const body = await page.locator('body').innerText()
		if (!/Nordlicht|Fahrspur|Klarheit|Hafenfunk|Strandcafé|Waldschritt|Ambient|Indie/.test(body)) {
			await clickTab('genres')
			await page.waitForTimeout(700)
		}
		await waitCovers()
	} else if (shot.action === 'list') {
		await page.waitForFunction(() => !!(window.AudioCheckPlayer), { timeout: 30000 }).catch(() => {})
		await page.waitForSelector('[data-tab-id]', { timeout: 15000 }).catch(() => {})
		if (shot.path.includes('/music') || shot.path.includes('/audiobooks')) {
			const ok = await clickTab('albums')
			if (!ok) {
				// Fallback: click by visible DE/EN label
				const lab = shot.path.includes('/audiobooks') ? /Nach Buch|By book/ : /Alben|Albums/
				const byLabel = page.locator('button[role="tab"], [data-tab-id]').filter({ hasText: lab }).first()
				if (await byLabel.count()) {
					await byLabel.click()
					await page.waitForTimeout(900)
				}
			}
		}
		await page.evaluate(async () => {
			const P = window.AudioCheckPlayer
			if (!P || !window.AudioCheckApi) return
			if (typeof P.whenReady === 'function') {
				try {
					await P.whenReady()
				} catch {
					/* ignore */
				}
			}
			if (!(P.getCurrentTrack && P.getCurrentTrack())) {
				const data = await window.AudioCheckApi.get('/apps/audiocheck/api/tracks', {
					kind: 'music',
					limit: 5,
					page: 1,
					sort: 'title',
				})
				const items = (data && data.items) || []
				if (items[0]) P.playQueue(items.slice(0, 5), 0, 95000, false)
			}
			const a = document.getElementById('ac-audio')
			if (a && !a.paused) a.pause()
		})
		await page.waitForTimeout(700)
		await polish()
		await waitCovers()
	} else if (shot.action === 'settings') {
		await polish()
	}

	const label = shot.file.replace('audiocheck-screenshot-', '').replace('.png', '')
	await assertClean(label)

	const dest = resolve(outDir, shot.file)
	await page.screenshot({ path: dest, fullPage: false, type: 'png' })
	console.log('✓', shot.file)
	meta.shots.push({ file: shot.file, path: shot.path, action: shot.action })

	// Also keep legacy numbered names for older info.xml refs during transition
	const n = shot.file.match(/screenshot-(\d+)/)?.[1]
	if (n) {
		const legacy = resolve(outDir, `audiocheck-screenshot-${n}.png`)
		await page.screenshot({ path: legacy, fullPage: false, type: 'png' })
	}
}

writeFileSync(resolve(outDir, '_store-capture-meta.json'), JSON.stringify(meta, null, 2))
await browser.close()
if (langPin) {
	try {
		process.kill(-langPin.pid, 'SIGTERM')
	} catch {
		/* ignore */
	}
}
console.log('Done →', outDir)
